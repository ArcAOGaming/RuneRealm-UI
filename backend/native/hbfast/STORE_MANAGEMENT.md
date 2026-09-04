# Keeping the HyperBEAM store small — the research, and the only levers that exist

Measured and read from source 2026-09-03. This is the "how do we keep it from
getting unruly again" answer, and the news is specific.

## What actually grows, and why nothing prunes it

Every computed slot is written to the store **forever**:
`dev_process_cache:write/4` calls `hb_cache:write` and links it under
`computed/<procid>/slot/N`. There is **no eviction of old slots anywhere in
HyperBEAM.** The store's only removal primitive is `hb_store:reset` — a full
wipe of an entire store. The LMDB backend (`hb_store_lmdb`) exports
`read/write/list/match/link/type/resolve` and **no `delete`**. You cannot drop
"slots older than N"; there is no API for it and no config for it.

So a process's on-disk footprint is monotonic in the number of slots it has
ever computed. Two things set the size of each of those slots:

- **`process-snapshot-slots`** — how often a slot carries a full
  `term_to_binary(luerl:externalize(State))` snapshot of the entire VM heap.
  At `1` (the old value) **every slot** carried one — megabytes each. At `50`
  (now) one slot in fifty does. This is the dominant size lever and it is why
  the store ran to 177 GB: months of soak-test processes, each computing
  thousands of slots, each slot a full heap dump.
- **`store-all-signed`** — whether every signed message body is also retained.
  Now `false`.

Both are set. They make each slot cheap; they do **not** stop the slot *count*
from accumulating. For a handful of production processes that is fine for a very
long time. For a long-lived, high-traffic process it is eventually unbounded,
and the only reset valve is re-baselining (below).

## Why you cannot fix it in place

- **No incremental prune exists** (above).
- **A full `reset` breaks live processes.** Proven 2026-09-03: renaming the
  primary store aside gave `500 {case_clause,{error,not_found}}` on the game,
  because the store holds the *only local copy* of each process's assignment
  chain and the node does **not** re-fetch it from Arweave on a `now` read.
- **Migrating to a fresh process on the same node does not make it fast.**
  Write cost is `bytes × f(store size)` — both multiply (measured: 355 KB module
  is 156 ms on a 512 KB store and 13 s on a 177 GB store; a 5 KB module is fast
  on both). A fresh process still writes its module and its slot-results into the
  same big store, so it is born slow. **The store must be small for anything on
  it to be fast.**

## The only way to actually shrink: re-baseline

1. **Export** every process's state to a file — `snapshot-live.mjs` (game, via
   paginated `Admin.Export`); the Rune token's balances; any market state.
   Read-only, safe to run any time. Done once already:
   `backend/native/snapshots/2026-09-03T14-30-52-740Z-jJCCcsPyECZm.json`
   (51 players, 3 companions).
2. **Reset the store** — stop node, wipe the primary LMDB, restart. Now empty
   and fast. This abandons every old process, which is the point.
3. **Deploy fresh** processes into the empty store (fast, because empty).
4. **Load** the exported state via `Admin.Load`, and re-point the app.

The order matters: export → wipe → deploy+load. Deploying before wiping puts the
fresh process's own assignments in the store that step 2 then destroys.

Two shapes of this:

- **Same node, short downtime.** Do the four steps above on this box. The game
  is down for the minutes between wipe and load. Fine for a pre-launch
  `TEST-` build.
- **Second clean node, zero downtime.** Stand up a second HyperBEAM node, run
  `deploy.mjs --migrate-from <old> --migrate-node <old-node>` against it (reads
  the old process over HTTP, deploys fresh, loads), point the app at the new
  node, then wipe/retire the old box at leisure. Needs a second server.

## The watchdog

`store-watch.sh` (this directory) extends what `gw-cache-maintain.sh` already
logs. It cannot prune the primary — nothing can — so its job is to **alert
before the store is a problem again**, so a re-baseline is a scheduled
maintenance window and never another 12-second surprise.

It logs primary size, gw-cache size and disk percent each run, and emits a loud
`WARN`/`CRIT` line (and optional webhook) when the primary crosses a threshold.
Install it on the existing `hyperbeam-maintain.timer` in place of, or alongside,
the current script.

Thresholds, tunable at the top of the script:

- `WARN_GIB=20` — the primary has grown past a comfortable production size;
  plan a re-baseline.
- `CRIT_GIB=60` — re-baseline now; latency is climbing.

## What does NOT need managing

- **Deploys need no node authorization.** Scheduling is open: the node serves
  any process the owner wallet signs and points at it. There is no per-wallet or
  per-process allowlist (`node-config.json` has only `trusted-devices`, three
  device hashes). Adding a process or a feature never needs a node config edit.
- **The gateway cache** (other people's Arweave data) already auto-resets at
  70 GB via the existing timer. That growth is not yours and is handled.
