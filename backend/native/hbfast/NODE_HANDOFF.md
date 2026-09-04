# Make the live node behave like the lab node

Handoff for whoever has shell on `hyperbeam.tylerw.ai`. Measured 2026-09-03.

## The problem in one table

Identical Lua module, identical action, minutes apart:

| module bytes | local `hb:stock` container | hyperbeam.tylerw.ai |
|---|---|---|
| 5,828 | 142 ms | 456 ms |
| 205,845 | 131 ms | 460 ms |
| 265,845 | — | 465 ms |
| 325,845 | — | 1,236 ms |
| **355,845** | **157 ms** | **13,200 ms, or the spawn 500s** |

The deployed `game.lua` bundle is **355,351 B**, so it sits on the cliff. A
*fresh, empty* game process — no players, no state, no battles — costs 7–11 s
per message live and 180 ms local. `POST /schedule` runs no Lua at all and is
8.5 s live, so the contract is not involved.

Cleanest single signal, one write with no execution at all:

| | 5.8 KB spawn | 356 KB spawn |
|---|---|---|
| local | 186 ms | **156 ms** |
| live | 640–1,070 ms | **23,000–27,700 ms**, or 500 |

**~150x on a pure write.** That is where to look.

## What has already been ruled out

- **Node configuration.** Every scalar from the live node's
  `/~meta@1.0/info/serialize~json@1.0` was applied to the lab container —
  `profiling`, `process-sampler` + interval, every `debug-print-*`,
  `debug-trace-type`, `debug-show-priv`, `debug-stack-depth`,
  `cache-lookup-hueristics: false`, `force-signed`, `client-error-strategy`,
  `await-inprogress`, `scheduler-default-commitment-spec: ans104@1.0`,
  `scheduling-mode: local_confirmation`, `bundler-ans104` pointed at
  `https://up.arweave.net:443`, `process-snapshot-slots: 1`,
  `process-snapshot-time`, `process-worker-max-idle`,
  `process-now-from-cache`. The lab node stayed at **131–157 ms at every size**.
- **Restarting the live node.** No change.
- **The contract.** A fresh empty game process is just as slow, and a padded
  5 KB KV contract with one inert `local PAD = [[xxx…]]` line reproduces the
  whole effect. Nothing in `SLOT_LATENCY_INVESTIGATION.md` is what is biting.
- **The signature codec.** ANS-104 (browser) and httpsig (our harnesses) are
  within noise of each other on the same process.
- **Rate limiting.** Real — `dev_rate_limit`, 1,000 req/60 s, confirmed live
  (280 of 1,500 were 429) — but nginx sets `X-Real-IP`, so buckets are
  per-client. It hurts the swarm from one box, not a player.

## What the lab node is running

Near-vanilla. Built by `backend/native/battle-fleet/hblab/build.sh stock`:

- repo `github.com/tylerwarburton/HyperBEAM`, branch `node-deploy`,
  commit **`674329bf62f9f3dbc7adea0ce4e53ad0a29cb3a3`**
- rebar profiles **`rocksdb+genesis_wasm`**, WAMR profile **`stock`**
- merge-base with `permaweb/HyperBEAM` `edge` is **`14e9f68a`**; upstream edge
  is 10 commits ahead of that base
- divergence from upstream is **3 source commits, +30/−4 across 3 files**:
  - `ba7cf5f1` `dev_lua` — `term_to_binary(..., [compressed])` on the snapshot
  - `c759e07e` `dev_process` — `store_result(true → false)`, so the target slot
    snapshots on the configured cadence instead of every latest slot
  - `bb6ac1ca` `dev_process_worker` — treat an uncomputed/HTTP-wrapped slot as a
    cache miss rather than a `function_clause` 500

**The async-bundler-upload patch in `HYPERBEAM_SCHEDULER_PATCH.md` is NOT in
this branch** — `do_assign`'s `DispatchFun()` still runs inline here. The doc
says that patch is applied and running on the live node, so the live node has
at least one source change the fast lab node does not. Worth confirming: a
diverged live build is now a live hypothesis, not a footnote.

## What to check on the host, in order

```bash
df -h                                   # free space on the store volume
du -sh <data-dir>/cache-mainnet         # LMDB + fs store size
iostat -x 1 10                          # %util and await during a spawn
uptime; free -g                         # load and memory pressure
cd <hyperbeam-checkout> && git log -1   # which commit is actually running
git status --porcelain                  # uncommitted local patches
```

Then reproduce from any machine:

```bash
NODE_URL=https://hyperbeam.tylerw.ai node backend/native/hbfast/size-sweep.mjs
NODE_URL=http://localhost:8734          node backend/native/hbfast/size-sweep.mjs
```

Rebuild the lab node to compare against, if needed:

```bash
cd backend/native/battle-fleet/hblab && ./build.sh stock
docker run -d --name hbfast --rm -p 8734:8734 -v hbfast-data:/data hb:stock
```

## Two independent fixes

1. **Get the module under ~266 KB.** Measured safe: 265,845 B answers in 465 ms.
   That is a 25 % cut from 355,351 B and it takes a message from 13 s to under
   half a second, on the node as it stands today. `deploy.mjs` already enforces
   a `MODULE_BYTE_CEILING` of 480,000 for a *spawn* cliff at ~524 KB; the
   **performance** cliff is much lower and that ceiling should come down to
   ~260,000 with this measurement as the reason.
2. **Fix the host.** 157 ms vs 13,200 ms for identical bytes on identical
   config is not something to tune around, and rule 1 only buys headroom until
   the bundle grows again.
