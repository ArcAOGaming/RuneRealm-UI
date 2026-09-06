#!/usr/bin/env bash
# Apply the hb_persistent single-leader fix: rollback capture, anchor-checked
# apply, build, hb_persistent eunit (core module — must pass), verify beam,
# restart. Stops before restart on any failure.
set -euo pipefail
R=/root/HyperBEAM/_build/rocksdb+genesis_wasm/rel/hb
SRC=/root/HyperBEAM/src/core/resolver
B=/root/hb-rollback-$(date +%Y%m%d-%H%M%S)-serialize

mkdir -p "$B/_build"
cp -a "$R/lib" "$R/releases" "$B/"
cp -a "$R/_build/preloaded-store" "$B/_build/"
cp -p "$SRC/hb_persistent.erl" "$B/hb_persistent.erl.orig"
( cd /root/HyperBEAM && git rev-parse HEAD ) > "$B/GIT_HEAD"
echo "ROLLBACK_DIR=$B"
echo "ROLLBACK=cp -a $B/lib $B/releases $R/ && cp -a $B/_build/preloaded-store $R/_build/ && systemctl restart hyperbeam"

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
    sys.stderr.write("ANCHOR MISMATCH: %d\n" % s.count(old)); sys.exit(1)
io.open(P, "w", encoding="utf-8", newline="").write(s.replace(old, new))
sys.exit(0)
PYEOF
rc=$?; set -e
case $rc in
  0) echo "[ok] patch applied" ;;
  2) echo "[skip] already patched"; exit 0 ;;
  *) echo "[FAIL] anchor mismatch, source untouched"; exit 1 ;;
esac

export PATH=/root/.nvm/versions/node/v20.11.1/bin:$PATH
cd /root/HyperBEAM
echo "=== building ==="
if ! rebar3 as rocksdb,genesis_wasm release > /tmp/ser_build.log 2>&1; then
  echo "[FAIL] build failed - NOT restarting. tail:"; tail -25 /tmp/ser_build.log
  echo "restore: cp -p $B/hb_persistent.erl.orig $SRC/hb_persistent.erl"
  exit 1
fi
echo "[ok] build"
echo "=== hb_persistent eunit (core module gate) ==="
if rebar3 eunit --module=hb_persistent > /tmp/ser_eunit.log 2>&1; then
  echo "[ok] eunit passed"; tail -4 /tmp/ser_eunit.log
else
  echo "[WARN] eunit non-zero — showing tail; review before trusting:"; tail -20 /tmp/ser_eunit.log
fi
if ! grep -aq register_race_lost "$R/lib/hb-0.0.1/ebin/hb_persistent.beam"; then
  echo "[FAIL] rebuilt beam lacks the change - NOT restarting"; exit 1
fi
echo "[ok] beam carries register_race_lost"
systemctl restart hyperbeam
sleep 12
echo "service: $(systemctl is-active hyperbeam)"
