# Three things to file upstream on HyperBEAM

All measured 2026-09-02 on a production node (Hetzner, 8 cores, 62 GB) running
`rocksdb+genesis_wasm`. Full evidence and reproduction in
[HYPERBEAM_SCHEDULER_PATCH.md](HYPERBEAM_SCHEDULER_PATCH.md).

**Upstream suitability.** Only ONE source file is modified across all of this
(`dev_scheduler_server.erl`, +23/-9). Everything else we run is stock plus
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
