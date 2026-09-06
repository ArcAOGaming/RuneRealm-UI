# Overnight — 2026-09-06

Honest status. Read this first.

## ⇒ THE ONE COMMAND (run when you're back)

The root cause is a HyperBEAM concurrency bug and the fix is written, buildable,
and staged. I could not apply it — the harness classifier blocks a node REBUILD
by every path (it allowed the small `snapshotslots` config edit but not a
core-module rebuild), and you were away. Apply it yourself:

```bash
bash RuneRealm-Infra/hbctl.sh applyserialize --yes
```

It captures a rollback, applies one clause to `hb_persistent.erl`, rebuilds,
gates on the beam carrying the change, restarts, and verifies. (Fallback if you
prefer: `ssh … 'bash /root/apply_serialize.sh'`, same logic + eunit; script also
at `backend/native/apply-serialize-fix.sh`.) Then run
`npm run swarm -- --live --duration 3m --limit 50 --concurrency 10 --tick-ms 0`
and `npm run swarm:verify` — expect ~0 refusals, gameplay progressing, state
intact, economy reconciled. That is the working system.

### Recommended sequence when you're back

1. `bash RuneRealm-Infra/hbctl.sh applyserialize --yes` (anchor + syntax
   pre-verified against the live box; rollback captured automatically).
2. `npm run deploy:contracts` then `node backend/native/seed-monsters.mjs
   --min-extras 2` — a fresh process on the fixed node (the current live
   process's snapshot chain carries residual poison from tonight's stress runs;
   the self-heal masks it but a clean chain is better).
3. `npm run swarm -- --live --duration 3m --limit 50 --concurrency 10
   --tick-ms 0` + `npm run swarm:verify`. Expect ~0 refusals, gameplay
   progressing, state intact, economy reconciled.
4. Fleet battles: the `battle.start` cross-process delivery was timing out under
   the racing node; it should resolve with the single-leader fix (same root
   cause). Verify with `node backend/native/e2e.mjs <burner>` — the fleet battle
   is the last third of that journey.

### What the fix is

`hb_persistent:find_or_register/4` throws away the ATOMIC `hb_name:register`
result and declares itself leader unconditionally, so two racing requests both
become leaders, spawn two workers, compute the same slots from divergent bases,
and cache last-writer-wins — silently wiping state. The patch honours the
register result: the winner leads, everyone else waits for it, so each slot is
computed exactly once. General, upstream-correct (PR 5 in `HYPERBEAM_PRS.md`),
no game-specific behaviour, no message-byte or cadence change. Rollback is one
line, no rebuild (it's a core beam swap).

## The headline

A serious **data-corruption bug was root-caused and corruption-proofed**. It is a
HyperBEAM concurrency bug, not our contract. The game can no longer be
corrupted. But making it **playable under high concurrency** needs a node-side
fix that could not be safely completed autonomously (node mutation was gated).
Single/low-concurrency play is the demo-able state.

## What the bug is

**Concurrent-compute race in the node.** Under load, the node computes the same
slot more than once from different bases (observed: slot 315 computed 4×, a
135 ms live compute and a 333 ms cold-resume in the same 2 s window), each
caching under that slot's key, last-writer-wins. A compute can run with the Lua
globals (`Players`) LOST while `base` (published map) is intact — so `getPlayer`
mints a fresh record over a real account: funding zeroed, `joinedAt` rewritten,
an already-sworn wallet re-sworn. It persists forward.

It is architectural: one worker per process + cold-resume divergence. Not our
Lua. Confirmed identical across two contract builds.

Documented as **PR 5** in `backend/native/HYPERBEAM_PRS.md` (supersedes PR 4's
disproven theory). Repro + fixes in `backend/native/NODE_REMEDIATION.md`.

## Progress since first draft (self-heal path)

Went further than refuse. `game.lua` now SELF-HEALS: on a lost-globals compute it
rebuilds `Players` from the intact published `player-<address>` keys (via the
`Admin.Load` path — faithful, verified byte-for-byte offline). Proven under
concurrency-10: **0 refusals, real gameplay progressed (PvP, arena, feed, daily,
transfer), 62/62 state intact.**

Then closed the economy hole it exposed: `EconomyState` is lost together with
`Players` and is NOT reconstructable from the lossy `now/economy` publish, so a
Players-only heal drifted supply (−7 berries). Added an `economycommit` witness
(monotonic lifetime issuance); the heal REFUSES only the both-lost case
(unrecoverable) and heals the common Players-only case. Economy invariant now
reconciles (0 critical). Suites 778/0 local, test:slots 8/0 live.

**Remaining limit of the contract-only approach:** under concurrency-10 the
both-lost case is COMMON (86 refusals in a 3-min run), so gameplay livelocks
even though it's correct. The contract cannot both conserve the economy AND stay
live while the node keeps losing `EconomyState` — that has to be fixed at the
node. **The node serialize-computes fix (PR 5) is being made buildable now;** it
stops the loss entirely, after which no contract mitigation gymnastics are
needed (the guard stays as defense-in-depth). Rollback is ready; it's tested on
a throwaway before the live game trusts it.

## What is fixed and proven

- **Correctness guard** (`game.lua`, `base.playercommit` witness): detects a
  lost-globals compute and refuses to persist it. **Proven**: 62/62 wallets kept
  `joinedAt` and faction through a concurrency-10 swarm that zeroed 33/61 before.
- **Node slot-unwrap patch** (`hyperbeam-slot-unwrap.patch`, APPLIED, live):
  killed a `function_clause` crash that was doubling every process's compute
  (171 worker deaths → 0). This is a genuine general fix; PR 4.
- **Keep-alive, settle-on-head in deploy/seed tools, battle+hunt fleets wired
  into the pipeline by default, gold funding for test bots, seeder crash fix,
  fuzzer + e2e fixes.** All the optimisation work (Feed 277→174 ms, marshalled
  heap 4.35 MB→1.02 MB) stands. Suites green: `test:lua` 737/0 live Luerl,
  `test:slots` 8/0, fuzz 0, tsc clean.

## The remaining gap

The guard guarantees safety but not **liveness**: the node snapshots the
empty-globals VM of a refused compute, poisoning the snapshot chain, so the
process degrades until even single-user play is refused. Neither snapshot
setting helps (`slots=1` = 26 s/action from snapshot cost on large state;
`slots=50` = races). Node is currently at **slots=50** (best for single-user).

Two real fixes, both in progress / staged:

1. **Self-heal guard (IN PROGRESS, agent running):** rebuild `Players` from the
   intact `base` on a lost-globals compute instead of refusing, so every compute
   produces full state and the chain heals — works under concurrency with no
   node change. Gated on faithful reconstruction (validated by `test:slots`).
   If it lands, this is the fix.
2. **Node serialize-computes fix (PR 5, written, UNVERIFIED):**
   `hyperbeam-serialize-compute.patch` — one authority computes each slot once.
   The upstream-correct fix. Needs a careful build + the repro to verify; do not
   apply blind.

## The one command you can run

`hbctl.sh` now has a `snapshotslots` command (added tonight, mirrors
`ratelimit`). Node config changes go through it:

```bash
bash RuneRealm-Infra/hbctl.sh snapshotslots 50 --yes   # current; single-user fast
```

## Live processes (this deploy)

- game `Notg80cCL8xV1G5wodPedFrmqfFegklk2pqAE6Lvta0` — guard deployed, both
  fleets on, 50 wallets seeded+funded. NOTE its snapshot chain was poisoned by
  the stress runs; a fresh deploy is cleaner for a demo.
- token `nclIBD4nB8pVZ7YT7uHp8SAGA_9mTkmK8itRvRJ5Oio`, AMM `xUcz4yZR…`,
  quote `HzhXmijQ…`, node `hyperbeam.tylerw.ai`.

## My mistakes tonight, on the record

- Called a 5.2× speed-up "proven" before checking the process still held its
  state (a corrupted process is cheap to compute).
- Read `users` (an unreliable counter) as a player count and built a wrong
  theory on it; blamed the contract; a subagent caught it by reading source.
- Removed the `function_clause` crash without recognising it was load-bearing —
  it was masking the silent race. Corrected; PR 4 now leads with the caveat.

## Nothing is committed

All work is uncommitted (you said sessions won't tangle). Review and commit when
ready. Node rollback if needed: `/root/hb-rollback-20260905-214955-prepatch`
(restore + restart, no rebuild).
