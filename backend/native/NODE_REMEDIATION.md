# Concurrent-compute state corruption — remediation

Measured 2026-09-06 on `hyperbeam.tylerw.ai`. Root cause and evidence in
[HYPERBEAM_PRS.md](HYPERBEAM_PRS.md) PR 5. One-line summary: under concurrent
writers the node computes a single slot more than once from different bases and
`store_result` caches whichever finishes last, so a slow cold-resume can clobber
a correct live compute and silently wipe a player's state forward to the head.

Two independent remedies. The config one needs no code and deploys now; the
patch is the durable fix.

## Config mitigation — `process-snapshot-slots: 1`

**What it does.** A cold-resume restores the last cadence snapshot and replays
every slot since. At `snapshot-slots: 50` a resume replays up to 50 slots, and
two concurrent resumers replaying that deep range independently is the window in
which their cached results diverge. At `1`, every slot is a snapshot, so a
resume restores the *immediately preceding* slot and replays ~0 — the divergence
window collapses and concurrent computes can no longer disagree. It also moves
the node **toward stock** `dev_process` (which force-snapshots every slot), not
away from it.

**Trade-off.** This is the exact knob the `c759e07e` cadence patch turned the
other way to stop store growth. At `1`, every action writes a full-heap snapshot
again: ~77 GB/day of store growth at 3 actions/s before pruning (the number
behind the earlier 177 GB store). Acceptable on a test node with pruning; not a
permanent posture. It is a stopgap until `hyperbeam-serialize-compute.patch` (or
the full serialization fix) lands.

**Reversible.** It is a single config key. Flip it back to `50` and
`config-push` to undo; no process or data is touched.

**Live value when measured:** `process-snapshot-slots: 50`, `store-all-signed:
false`, `rate-limit-requests/max: 3000`. The mitigation changes only
`process-snapshot-slots` (50 -> 1).

> Note: the staged `RuneRealm-Infra/node-config.json` referenced by the handoff
> was **not present in this working tree**, so the "only snapshot-slots drifts"
> diff could not be independently audited here. Confirm with the infra repo's
> own `hbctl.sh config-diff` before `config-push --yes` — visually verify the
> diff shows *only* `process-snapshot-slots` changing and nothing else.

## Durable fix — `hyperbeam-serialize-compute.patch`

One clause of `hb_persistent:find_or_register/4`. The leader election looks up an
existing leader, and finding none, registers itself — but throws away the
**atomic** result of `hb_name:register/2` (`ets:insert_new`, `ok` for the one
winner, `error` for the rest) and declares itself leader unconditionally. Two
concurrent requests therefore both become leaders, spawn two workers, and compute
the same slots from divergent bases. The fix honors the register result: winner
leads, everyone else awaits the winner and receives its in-order result. A slot
is computed exactly once. Details and evidence in [HYPERBEAM_PRS.md](HYPERBEAM_PRS.md)
PR 5.

**Unverified** — could not build/restart during the diagnosing window. Apply
block below; prove it with the reproduction after. Prefer landing this over
living on `snapshot-slots: 1`: it fixes the bug at the source with no store-growth
tax and no cadence change.

## Apply block — run on the box (captures rollback, builds, restarts, verifies)

```bash
set -euo pipefail
R=/root/HyperBEAM/_build/rocksdb+genesis_wasm/rel/hb
SRC=/root/HyperBEAM/src/core/resolver
B=/root/hb-rollback-$(date +%Y%m%d-%H%M%S)-serialize

# 1. Fresh rollback of what is running now (core module -> lib ebin; no rebuild
#    needed to restore). preloaded-store copied too, for parity with last time.
mkdir -p "$B/_build"
cp -a "$R/lib" "$R/releases" "$B/"
cp -a "$R/_build/preloaded-store" "$B/_build/"
cp -p "$SRC/hb_persistent.erl" "$B/hb_persistent.erl.orig"
( cd /root/HyperBEAM && git rev-parse HEAD && git rev-parse --abbrev-ref HEAD ) > "$B/GIT_HEAD"
cat <<EOF

============================ ROLLBACK (no rebuild) ============================
cp -a $B/lib $B/releases $R/ && cp -a $B/_build/preloaded-store $R/_build/ && systemctl restart hyperbeam
  source only: cp -p $B/hb_persistent.erl.orig $SRC/hb_persistent.erl
===============================================================================

EOF

# 2. Apply (idempotent, anchor-checked).
set +e
python3 - <<'PYEOF'
import io, sys
P = "/root/HyperBEAM/src/core/resolver/hb_persistent.erl"
s = io.open(P, "r", encoding="utf-8", newline="").read()
if "register_race_lost" in s:
    sys.stderr.write("already patched\n"); sys.exit(2)
old = """                _ ->
                    ?event({register_resolver, {group, GroupName}}),
                    register_groupname(GroupName, Opts),
                    {leader, GroupName}
            end"""
new = """                _ ->
                    ?event({register_resolver, {group, GroupName}}),
                    %% hb_name:register/2 is atomic (ets:insert_new): exactly one
                    %% racing caller gets `ok'. The rest MUST await the winner,
                    %% not become co-leaders -- two leaders compute the same slots
                    %% from divergent bases and cache last-writer-wins, silently
                    %% wiping state. (local patch over upstream edge.)
                    case register_groupname(GroupName, Opts) of
                        ok ->
                            {leader, GroupName};
                        error ->
                            ?event({register_race_lost, {group, GroupName}}),
                            case find_execution(GroupName, Opts) of
                                {ok, Leader} when Leader =/= Self ->
                                    {wait, Leader};
                                _ ->
                                    {leader, GroupName}
                            end
                    end
            end"""
if s.count(old) != 1:
    sys.stderr.write("ANCHOR MISMATCH: %d occurrences\n" % s.count(old)); sys.exit(1)
io.open(P, "w", encoding="utf-8", newline="").write(s.replace(old, new))
sys.exit(0)
PYEOF
rc=$?; set -e
case $rc in
  0) echo "[ok] patch applied" ;;
  2) echo "[skip] already patched - not rebuilding"; exit 0 ;;
  *) echo "[FAIL] anchor mismatch, source untouched"; exit 1 ;;
esac

# 3. Show the changed function before building.
echo "--- find_or_register/4 (patched) ---"
awk '/^find_or_register\(GroupName, _Base/{p=1} p{print} p&&/^    end\.$/{exit}' "$SRC/hb_persistent.erl"

# 4. Build (checked), then restart.
export PATH=/root/.nvm/versions/node/v20.11.1/bin:$PATH
cd /root/HyperBEAM
if ! rebar3 as rocksdb,genesis_wasm release; then
  echo "[FAIL] build failed - not restarting. Restore: cp -p $B/hb_persistent.erl.orig $SRC/hb_persistent.erl"
  exit 1
fi
if ! grep -aq register_race_lost "$R/lib/hb-0.0.1/ebin/hb_persistent.beam"; then
  echo "[FAIL] rebuilt beam lacks the change - not restarting"; exit 1
fi
echo "[ok] rebuilt hb_persistent.beam carries register_race_lost"
systemctl restart hyperbeam
sleep 10

# 5. Verify live game + fleet.
N=http://localhost:10000
G=bS5eru1lN5kcM38PE_y1PAQoi1AdhxfhVhVKMFBeFxo
chk () { b=$(curl -s -m 25 -o /tmp/_c.$$ -w '%{http_code}' "$2" || echo 000)
  if head -c 15 /tmp/_c.$$ 2>/dev/null | grep -qi '<!DOCTYPE\|<html'; then v='<HTML=absent>'; else v=$(head -c 80 /tmp/_c.$$); fi
  printf '  %-22s http=%s  %s\n' "$1" "$b" "$v"; rm -f /tmp/_c.$$; }
echo "service: $(systemctl is-active hyperbeam)"
chk address      "$N/~meta@1.0/info/address"
chk game/at-slot "$N/$G~process@1.0/now/at-slot"
for w in 795Ypxp2jmo8UxZpiIaS9EYJwv6FKIsoH9YpdMi_Pr8 \
         4F_AT3iPtVPcvEmi-F3lIqxf46dlNbKu_mmdNbkK8uc \
         Rq99urZZIs5g_r2fSRlgGmBvxfWR46zXyehpeQAtnrM ; do
  chk "battle ${w:0:8}" "$N/$w~process@1.0/now/fleetstatus"
done
echo "If the game process did not answer, roll back with the command printed at the top."
```

## Reproduction — prove a fix closed the race

Throwaway process, throwaway wallets, on the live node. Fires overlapping
concurrent `Faction.Join`s (the action observed injecting the wipe at slot 315)
and checks that seeded funding survives at the head. Run it BEFORE a fix to see
the wipe, and AFTER to see it hold.

```bash
set -euo pipefail
cd /path/to/RuneRealm-UI

# 1. Spawn a throwaway TEST- game process and capture its id.
#    (Uses the repo's deploy path; every spawned name carries the TEST- prefix
#     per CLAUDE.md. Do NOT point this at a real process.)
PID=$(node backend/native/deploy.mjs --throwaway --name "TEST-race-repro" --print-id)
echo "throwaway process: $PID"

# 2. Seed one wallet with funding (FundTestBots grants rune+gold), then confirm
#    it settled at the head before we race it.
node backend/native/e2e.mjs seed-one --process "$PID" --burner burner-01
ADDR=$(node backend/native/burners.mjs address burner-01)
NODE=https://hyperbeam.tylerw.ai
before=$(curl -s "$NODE/$PID~process@1.0/now/player-$ADDR")
echo "seeded: $(echo "$before" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let p=JSON.parse(s);console.log({gold:p.gold,rune:p.rune,seeded:p.seeded,joinedAt:p.joinedAt})})')"

# 3. Fire N concurrent Faction.Join writes for the SAME wallet, then immediately
#    hammer overlapping future-slot compute reads while the head is moving — the
#    two-generation race that recomputes a slot from divergent bases.
node - "$PID" "$ADDR" <<'JS'
import { installWalletShim } from './backend/native/ans104.mjs';
import { loadBurner } from './backend/native/burners.mjs';
import { sendMessage } from './backend/native/hbclient.mjs';
const [pid, addr] = process.argv.slice(2);
const w = await loadBurner('burner-01'); installWalletShim(w);
const join = () => sendMessage(pid, { Action: 'Faction.Join', Faction: 'Inferno Blades' }, w);
// 10 concurrent joins + interleaved compute reads at overlapping targets.
const node = 'https://hyperbeam.tylerw.ai';
const readAhead = s => fetch(`${node}/${pid}~process@1.0/compute&slot=${s}/player-${addr}`).catch(()=>{});
await Promise.all([ ...Array(10).fill().map(join),
                    ...Array(20).fill().map((_,i)=>readAhead(1000+i)) ]);
JS

# 4. Read authoritative state at the head. PASS = funding survived.
after=$(curl -s "$NODE/$PID~process@1.0/now/player-$ADDR")
echo "$after" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let p=JSON.parse(s);
  const ok = Number(p.gold)>0 && p.seeded===true && p.joinedAt;
  console.log(ok ? "PASS funding held: "+JSON.stringify({gold:p.gold,rune:p.rune}) 
                 : "FAIL wiped: "+JSON.stringify({gold:p.gold,rune:p.rune,seeded:p.seeded}));
  process.exit(ok?0:1);}'
```

Notes:
- Steps 1–2 use repo tooling (`deploy.mjs`, `e2e.mjs`, `burners.mjs`,
  `hbclient.mjs`) — flag names may need aligning with the current CLIs; the
  load-bearing part is step 3's concurrency, which is the race.
- A single sequential run of the same actions will NOT reproduce it — the bug is
  purely concurrent (sequential e2e passes 57/0 against a corrupted process).
- Do not declare a fix good on a latency number: a wiped process is *cheaper* to
  compute. Assert on the funding value at the head, as step 4 does.
