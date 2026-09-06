# Things to file upstream on HyperBEAM

All measured 2026-09-02 on a production node (Hetzner, 8 cores, 62 GB) running
`rocksdb+genesis_wasm`. Full evidence and reproduction in
[HYPERBEAM_SCHEDULER_PATCH.md](HYPERBEAM_SCHEDULER_PATCH.md).

**PR 5 (2026-09-06) supersedes PR 4's root-cause theory.** PR 4's "What this
breaks if you file it as-is" section below argues the corruption is a *future*
slot served from a fresh VM with empty globals, and proposes making
`compute_to_slot/5` refuse a target beyond the head. That was disproven:
`compute_to_slot/5` already returns a clean `{error, get-schedule}` past the head
and restores from a snapshot *with* priv; the actual corruption is an
*in-range* slot recomputed from a divergent base under concurrency and cached
last-writer-wins (PR 5). The unwrap in PR 4 is still correct and worth filing;
only its explanation of the state loss is wrong. Read PR 5 first.

**PR 4 was found on 2026-09-05, and is the only performance PR of the four that
changes behaviour.** Read its own "What this breaks if
you file it as-is" section before sending it anywhere: the unwrap is correct
only alongside a caller that never asks for a slot the head has not reached, and
filing it without that caveat would hand someone a silent failure in place of a
loud one.

**Upstream suitability.** Only TWO source files are modified across all of this
(`dev_scheduler_server.erl`, +23/-9; and for PR 4 `dev_process.erl` +30/-8 with
`dev_process_worker.erl` -6). Everything else we run is stock plus
ordinary node-config options any operator may set (`process-snapshot-slots`,
`process-snapshot-time`, `process-now-from-cache`,
`scheduler-default-commitment-spec`). Nothing below is Rune-Realm-specific or
depends on our workload: the fix helps any node hosting a process that takes
writes, and it changes no message bytes, so a node that adopts it stays
byte-compatible with one that does not.

---

## PR 1 — Take the bundler upload off the scheduling loop

**Patch:** `hyperbeam-scheduler-async-upload.patch` (one hunk)

**Title:** `perf(scheduler): run bundler uploads off the scheduling loop`

**Body:**

> `dev_scheduler_server:do_assign/3` ends its `DispatchFun` with two
> synchronous `hb_client_remote:upload/2` calls to the bundler. Only the literal
> mode `aggressive` takes the `spawn(DispatchFun)` branch, so under the
> `local_confirmation` default the uploads run inline on the single Erlang
> process that serializes slot assignment for that AO process. Slot N+1 cannot
> be assigned until slot N has been uploaded.
>
> On our node `up.arweave.net` is a ~370 ms round trip, which caps writes at a
> flat **~2.7 assignments/s per process at every concurrency level**. Latency is
> then pure queue depth, and past ~25 concurrent writers the queue exceeds the
> 10 s `?DEFAULT_TIMEOUT` in `schedule/2`, so callers get **HTTP 500** instead of
> a slow answer. Measured on a freshly spawned process with a 4-line contract,
> so none of it is contract cost:
>
> | concurrency | stock | patched |
> |---|---|---|
> | 1 | 2.3/s, p50 417 ms | 5.3/s, p50 182 ms |
> | 25 | 2.4/s, p50 5,428 ms | 33.3/s, p50 551 ms |
> | 50 | 47/50 fail (500) | 31.6/s, 0 errors |
>
> Stock was re-measured after reverting and reproduced exactly (2.3/2.4), so the
> control is clean. The box was idle throughout (load 1.3 of 8 cores, disk
> %util 2.8) — a sampling profiler showed request handlers parked in
> `schedule/2`'s `receive` and `do_assign` never hot. Everything local inside
> `do_assign` totals **under 0.4 ms** (`ar_timestamp` 0.009, commit httpsig
> 0.041, commit ans104 0.125, `hb_cache:write` 0.151, `hb_message:id` 0.048).
>
> This patch wraps the two uploads, and the `remote_confirmation` inform that
> follows them, in a `spawn`.
>
> **Why it is safe:**
> 1. Slot ordering is untouched — `NextSlot` is assigned and `current` updated
>    synchronously in the loop, before any dispatch.
> 2. Signing is untouched — `commit_assignment/2` still runs inline, so the
>    assignment bytes a verifier replays are identical.
> 3. The caller's guarantee is unchanged. Under `local_confirmation` the caller
>    is already informed after the local write and **before** the uploads
>    finish, so the inline upload never protected the caller — it only delayed
>    the next one.
> 4. `remote_confirmation` still waits for the uploads; the inform moved inside
>    the spawn.
> 5. **The upload's result is already discarded.** `do_assign` calls
>    `hb_client_remote:upload(Message, Opts),` with no match on the return,
>    unlike `dev_scheduler.erl:487` which does `{ok, Results} = ...`. Blocking
>    on a call whose outcome is ignored provides no durability guarantee — a
>    failed upload is dropped silently in stock exactly as it is here.
>
> **Residual risks, stated plainly:** a crash between the local cache write and
> upload completion loses that Arweave push (stock has no retry either, per
> point 5 — the window just widens); and there is now one unbounded `spawn` per
> assignment, where a bounded pool would be the hardened form. Happy to add a
> pool if reviewers prefer.

---

## PR 2 — Fix operator precedence in the stale-request guard

**Patch:** `hyperbeam-schedtime-precedence.patch` (two lines)

**Title:** `fix(scheduler): bind SchedTime to the timestamp, not the comparison`

**Body:**

> In `dev_scheduler_server:server/1`:
>
> ```erlang
> case SchedTime = scheduler_time() > AbortTime of
> ```
>
> `=` binds looser than `>`, so this parses as
> `SchedTime = (scheduler_time() > AbortTime)` and `SchedTime` is bound to a
> **boolean**. The branch logic is still correct, but the
> `received_old_schedule_request` event then logs `{sched_time, true}` instead
> of the timestamp, which is misleading exactly when someone is debugging why
> requests are being dropped as stale.
>
> Found while investigating PR 1. No behaviour change.

---

## Issue — `scheduling_mode = aggressive` never replies to the caller

**Title:** `scheduling_mode = aggressive returns 500 for every schedule request`

**Body:**

> Setting `"scheduling-mode": "aggressive"` in the node config makes every
> `POST /<pid>~process@1.0/schedule` fail.
>
> - The value parses correctly — `hb_opts:load` on the config yields the atom
>   `aggressive`, and `hb_opts:get(scheduling_mode, ...)` returns it.
> - **0 of 150 requests succeeded.** Every one returned HTTP 500 after ~10.4 s
>   with `{scheduler_timeout, {proc_id, ...}}` logged — including at
>   concurrency 1, where there is no queue at all. The caller is never sent
>   `{scheduled, Message, Assignment}`.
> - It is not a crash in the spawned dispatch: the only CRASH REPORTs in the
>   window were `memsup`/`disksup` ports dying on an unrelated restart.
> - Reverting the config restored normal operation immediately.
>
> Root cause not established. Reproduced on `rocksdb+genesis_wasm`, OTP 27.
>
> Note this is independent of PR 1: that patch changes the inline path and does
> not touch the `aggressive` branch or fix this.

---

## PR 4 — A wrapped slot reference kills the process worker

**Patch:** `hyperbeam-slot-unwrap.patch` (two files, one new function)

**Title:** `fix(process): unwrap an HTTP-wrapped slot reference before coercion`

**Body:**

> `dev_process:target_slot/2` returns the slot a `compute` request asked for and
> `compute/3` passes it straight into `hb_util:int/1`. But a path segment such as
> `compute&slot=243` is parsed into a sub-message, so the value can arrive as a
> typed-result MAP rather than the bare scalar:
>
> ```erlang
> #{<<"ao-result">> => <<"body">>, <<"body">> => <<"243">>}
> ```
>
> `hb_util:int/1` has no clause for a map. It raises `function_clause` **inside
> `dev_process_worker`'s `server/3` loop**, so the worker dies and takes its
> in-memory state with it. The next request cold-resumes from the last snapshot
> and replays forward.
>
> The cost is not the crash. It is the replay, and it is invisible: every
> affected request still returns **HTTP 200**, so the symptom is latency with no
> error anywhere a client can see.
>
> Measured on a live process over a 26-minute window, 2,158 `computed_slot` lines
> for 493 distinct slots:
>
> | | |
> |---|---|
> | worker deaths | **171** (peak 33/min) |
> | executions per slot advanced | **1.99** |
> | relationship | **execution factor = 1 + crashes per slot** |
> | read latency vs replay depth | **474 ms/slot, Pearson r = 0.982**, intercept ~0 |
> | depth 1 read | 461 ms |
> | depth 50 read | 11,615 ms |
> | worst observed | depth 141, **77 s** |
> | redundant share of the node's compute for this process | **77%** |
>
> In the steady state a death costs exactly one re-execution of the preceding
> slot; after a longer gap the same death costs a full replay to the snapshot.
> The 1.99 factor and the deep bursts are the same defect at two gap lengths.
>
> **After the patch, on the same node and the same 50-wallet workload at
> concurrency 10:** worker deaths **171 → 0**, reply-read p50 **13,818 ms →
> 2,654 ms**, p90 **32,808 → 4,424 ms**, p99 **41,272 → 6,037 ms**.
>
> Treat that speed-up as an UPPER BOUND until it is re-taken. It was measured
> before the state loss below was understood, and a process that has lost its
> player table is cheaper to compute than one that has not — so some unknown
> share of it is the process doing less work rather than less wasted work.
>
### What this breaks if you file it as-is

**The crash was load-bearing, and this was learned the expensive way.** Applying
this patch on a node whose clients read `compute&slot=N` IMMEDIATELY after the
POST — before the head has reached N — replaces a loud failure with a silent
wrong answer.

A slot the head has not reached is served **without the live worker's `priv`**.
`dev_lua` re-runs the module against a complete `base` and EMPTY globals, so a
`~lua@5.3a` process sees every published key intact and every Lua global gone.
For Rune Realm that meant `Players` empty while `player-<address>` still read as
funded: the handler minted a fresh record over a real account, rewrote
`joinedAt`, and a wallet that had already sworn to a faction swore again.
Measured 5/5 wiped when racing the head, 3/3 clean when settling on it first,
identically across two different contract builds — so it is the read pattern,
not the contract.

Before the patch that request raised `function_clause`, killed the worker and
forced a cold resume: slow, wasteful, and *correct*. The 1.99 execution factor
above is the cost of that safety, not gratuitous waste.

So this patch belongs upstream **only together with** one of:

- callers settling on the head (`now/at-slot` >= N) before addressing a slot; or
- `compute_to_slot/5` refusing, rather than serving, a target beyond the head.

The second is the real fix and is what a PR should probably carry. Serving a
future slot from a fresh VM is the actual defect; the `function_clause` was only
ever hiding it.

> The fix goes at `target_slot/2` rather than at either call site. It is the sole
> producer of this value and has exactly two consumers, both of which coerce
> immediately — so unwrapping at the producer takes the number of unwrappers in
> the tree from two to **one**. `dev_process_worker:compute_cached/3` already
> carried a local `slot_scalar/1` for exactly this shape; the patch deletes it.
> That one-sided fix is *why* the defect survived: the worker's cache-check path
> was guarded and the compute path was not, so it only bites under the queued
> worker path and never in a sequential test.
>
> `not_found` passes through untouched — both callers depend on it.

**Not fork-specific.** `git log -S target_slot` shows the function has never been
modified locally, and stock `permaweb/HyperBEAM` `edge` has no unwrapper on
either side. Any node serving a process that is read via
`compute&slot=N/results/output/data` is paying this.

---

## PR 5 — Concurrent computes of one process cache divergent results

**Patch:** `hyperbeam-serialize-compute.patch` (one hunk, `dev_process.erl`) —
**PROPOSAL, not yet built or tested.** Node mutation was gated during diagnosis;
the write-once guard compiles by inspection but has not been exercised. The full
fix (below) is a worker-lifecycle change that also needs building.

**Title:** `fix(process): compute each slot once; never cache a divergent recompute`

**Body:**

> A computed slot is immutable — its result is a pure function of assignments
> `0..Slot`. But `dev_process` provides no single authority that computes a
> process's slots exactly once in order. Under concurrent writers the same slot
> is computed by multiple short-lived computations from **different bases**, and
> `store_result/6` writes each to the cache unconditionally, so the last writer
> wins and can win with a stale or divergent base.
>
> **How divergence happens.** `dev_process_worker:compute_group/3` decides
> between leading and awaiting in `hb_persistent:find_or_register/4`. It looks up
> the leader (`find_execution/2`); finding none, it registers and returns
> `{leader, GroupName}`. `hb_name:register/2` is **atomic** — `ets:insert_new/2`,
> returning `ok` for the one winner and `error` for the rest — but
> `find_or_register/4` **discards that return** and declares itself leader
> unconditionally. So two requests that both pass `find_execution/2` before
> either registers (the check-then-act window) BOTH become leaders. Two leaders
> spawn two `dev_process` workers that each `ensure_loaded` their own base — one
> shallow from the live snapshot, one deep from a cold resume — and compute the
> SAME slots, caching each via `store_result/6` last-writer-wins. The live worker
> advances one slot from correct in-memory state (shallow, fast); the racing
> cold-resume replays from the snapshot (deep, slow); the slow one lands last.
>
> **Measured** on `awDuGuDGkiXhPvE2T8dVnKg29VLNIh1ArZ9ySJBO1yM`, 2026-09-06
> 01:34 — 3.5h *after* the PR 4 unwrap patch landed (21:50), with **zero
> `function_clause`** in the window, so this is not the PR 4 crash:
>
> | | |
> |---|---|
> | slot 315 computed | **4 times** |
> | the two overlapping computes | `01:34:04 slot=315 tgt=315 ex=135ms` (live, first) vs `01:34:06 slot=315 tgt=320 ex=333ms` (cold-resume, later) |
> | result | 333 ms deep-replay (base missing the wallet) clobbered the 135 ms correct result |
> | player `burner-01` | `gold 1000 -> 0`, `rune -> 0`, `joinedAt` rewritten, `seeded` reset |
> | persistence | every slot `>= 315` built on the wiped record, through the head (443) |
>
> **It is poisoned cache, not a contract bug.** Slot **313** is cached *clean*
> (`gold 1000`, `seeded true`); a deterministic `Faction.Join` applied to that
> state hits `if not p.seeded` = false and touches no funding. So the cached
> slot 315 was computed from a *different* base than the cached slot 313 —
> the two are mutually inconsistent, which only a non-deterministic
> compute-and-cache can produce. The injecting op was a real signed
> `Faction.Join`, not an anonymous read, so an unauthenticated reader alone
> cannot trigger it.
>
> **Bisect** (all cache-served, instant): clean at 302/310/**313**, corrupt at
> **315**/320/340/443. The break is *not* on a 50-boundary (nearest is 300,
> which reads clean), ruling out the snapshot compress/cadence patches as the
> direct cause — though `snapshot-slots: 50` widens the replay window that lets
> two resumers diverge (see the config mitigation in
> [NODE_REMEDIATION.md](NODE_REMEDIATION.md)).
>
> **The fix (`hyperbeam-serialize-compute.patch`, one clause of `hb_persistent`).**
> Honor the atomic register result. In `find_or_register/4`, match on
> `register_groupname/2`'s return: `ok` leads; `error` means another caller won
> the race, so `find_execution/2` again and `{wait, Leader}` — await the winner
> rather than becoming a co-leader. `dev_process_worker`'s `server/3` loop then
> computes the waiter's target slot **in order** from the one live base with priv
> intact. A slot is computed exactly once, from the canonical predecessor, so no
> divergent second compute exists to cache — no write-once guard is needed.
>
> **Why not write-once.** An earlier draft guarded `store_result/6` against
> overwriting a cached slot. Rejected: it only keeps whichever compute cached
> *first*, which is not guaranteed to be the correct one — a cold-resume that
> reaches a not-yet-cached slot first would lock in the wipe, and a legitimate
> later recompute would be discarded, leaving the cache internally inconsistent.
> Fixing the leader election removes the divergent compute at the source instead
> of arbitrating between two after the fact.
>
> **Guarantees / residual.** Closes the measured concurrent-leader race
> completely. Residual: if the winner finishes and unregisters between a loser's
> failed register and its follow-up lookup (a race within a race), the loser
> leads without re-registering — safe, because the winner's result is now cached
> and `compute/3` serves it, but an upstream-quality version would re-register
> cleanly. `hb_persistent` is a core resolver module, so the change must pass its
> existing eunit suite (`spawn_worker_outlives_resolution_test`,
> `ungrouped_execution_spawns_no_worker_test`) plus the reproduction in
> NODE_REMEDIATION.md before filing.
>
> **Not fork-specific, changes no message bytes.** Single-leader-per-group is the
> entire contract of `find_or_register`; ignoring the atomic register result is a
> latent bug for ANY concurrent resolver use, not just process compute. Nothing
> here is Rune-Realm-specific, snapshot cadence is untouched, and a node that
> adopts it
> stays byte-compatible with one that does not.
