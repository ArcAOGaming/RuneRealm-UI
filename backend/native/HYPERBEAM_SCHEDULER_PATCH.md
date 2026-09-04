# HyperBEAM: take the bundler upload off the scheduling loop

**Handoff for the agent working in the local HyperBEAM clone.** Everything below
was measured on `hyperbeam.tylerw.ai` (Hetzner, 8 cores, 62 GB, load ~0.1 while
testing) on 2026-09-02. The patch is applied and running there now.

Patch file: `hyperbeam-scheduler-async-upload.patch` (one hunk, +18 −11).

## The bug

`dev_scheduler_server:do_assign/3` ends its `DispatchFun` with:

```erlang
ok = dev_scheduler_cache:write(Assignment, Opts),
maybe_inform_recipient(local_confirmation, ReplyPID, ...),
hb_client_remote:upload(Message, Opts),      % → https://up.arweave.net
hb_client_remote:upload(Assignment, Opts),   % → https://up.arweave.net
maybe_inform_recipient(remote_confirmation, ReplyPID, ...)
```

and only the literal mode `aggressive` takes the `spawn(DispatchFun)` branch —
every other value (including the `local_confirmation` default) runs
`DispatchFun()` **inline**, on the one Erlang process that serializes slot
assignment for that AO process.

`up.arweave.net` is a **370 ms** round trip from that node. So slot N+1 cannot
be assigned until slot N has been uploaded.

## Measured consequences

Fresh, empty process with a 4-line contract, so none of this is contract cost:

| concurrency | stock | patched |
|---|---|---|
| 1 | 2.3/s, p50 417 ms | 5.3/s, p50 182 ms |
| 25 | 2.4/s, p50 5,428 ms | 33.3/s, p50 551 ms |
| 50 | **47/50 fail — HTTP 500** | 31.6/s, **0 errors** |

- Throughput is **flat at ~2.7/s at every concurrency**; latency is pure queue
  depth, `C / 2.7` seconds. `370 ms ≈ 1 / 2.7`.
- Past ~25 concurrent writers the queue exceeds the 10 s `?DEFAULT_TIMEOUT` in
  `dev_scheduler_server:schedule/2` and callers get **500**, not slow answers.
- It is **per process**: two processes driven simultaneously got 2.5/s *each*.
- The box is idle throughout — load 1.3 of 8 cores, disk `%util` 2.8 %. The VM
  is idle-*waiting*, not busy. A sampling profiler showed ~25 request handlers
  parked in `schedule/2`'s `receive` and `do_assign` never hot.
- Component costs inside `do_assign`, measured on the live node: `ar_timestamp`
  0.009 ms, commit httpsig 0.041 ms, commit ans104 0.125 ms, `hb_cache:write`
  0.151 ms, `hb_message:id` 0.048 ms. **Everything local totals < 0.4 ms.**

Stock was re-measured after reverting the patch and reproduced exactly
(2.3 / 2.4), so the control is clean.

## Why this is safe — the argument for review

1. **Slot ordering is untouched.** `NextSlot = maps:get(current, State) + 1` and
   `current := NextSlot` happen synchronously in the loop, *before* any
   dispatch. The patch only moves work that runs after the order is decided.
2. **Signing is untouched.** `commit_assignment/2` still runs inline. The
   assignment bytes another node verifies are identical.
3. **Verifiability is untouched.** A verifier replays the signed assignment
   chain; when the bytes were pushed to Arweave has no bearing on that.
4. **The caller's guarantee is unchanged.** In `local_confirmation` — this
   node's mode, and the default at `dev_scheduler.erl:1881` — the caller is
   already informed after the *local* write and *before* the uploads finish.
   The inline upload never protected the caller. It only delayed the next one.
5. **The upload's result is already discarded.** `dev_scheduler_server.erl`
   calls `hb_client_remote:upload(Message, Opts),` with no match on the return,
   unlike `dev_scheduler.erl:487` which does `{ok, Results} = ...`. Blocking on
   a call whose outcome is ignored buys no durability guarantee: a failed
   upload is silently dropped in stock exactly as it is patched.
6. **`remote_confirmation` still means what it meant.** The inform moved
   *inside* the spawn, so that mode continues to wait for the uploads.

### Honest residual risks, state them in the PR

- A crash between the local cache write and upload completion loses the Arweave
  push for those assignments. Stock has no retry either (point 5), so the
  failure mode already exists; the patch widens the window.
- One unbounded `spawn` per assignment. Fine at 33/s; a bounded pool or queue
  would be the hardened version and is a fair review request.

## What this patch is NOT

**It does not fix `scheduling_mode = aggressive`.** Do not frame the PR that
way. Setting `"scheduling-mode": "aggressive"` in the node config was tested
separately on this node and is **broken on stock**:

- The value parses correctly — `hb_opts:load` yields the atom `aggressive`.
- **0 of 150 requests succeeded.** Every one returned 500 at the 10.4 s
  timeout with `{scheduler_timeout, ...}` logged, including at concurrency 1
  where there is no queue at all. The caller is never sent `{scheduled, ...}`.
- It is not a dispatch crash — the only CRASH REPORTs in that window were
  `memsup`/`disksup` ports dying on restart.
- **Root cause not established.** Worth a separate issue, not this PR.

## Unrelated bug spotted while reading, worth its own trivial PR

`dev_scheduler_server:server/1`:

```erlang
case SchedTime = scheduler_time() > AbortTime of
```

`=` binds looser than `>`, so this is `SchedTime = (scheduler_time() > AbortTime)`
and `SchedTime` is a **boolean**, not a timestamp. The branch logic is still
correct; the value logged in the `received_old_schedule_request` event is wrong.
Fix is `SchedTime = scheduler_time(), case SchedTime > AbortTime of`.

## Rebuilding on that node

The `genesis_wasm` profile hook fails with "Node.js is not installed" unless
nvm's node is on PATH first:

```bash
export PATH=/root/.nvm/versions/node/v20.11.1/bin:$PATH
cd /root/HyperBEAM
rebar3 as rocksdb,genesis_wasm release
systemctl restart hyperbeam     # back up in ~3 s
```

Backups on the node: `src/preloaded/process/dev_scheduler_server.erl.bak-bundler-*`
and `node-config.json.bak-bundler-*`.

## What this does and does not buy Rune Realm

A lone player gains ~30 %: in the browser, through the real client, an action
went from ~2.6 s to ~1.87 s (sign 4–12 ms, schedule 192 ms idle, compute
~1,080 ms). **The 14x is entirely about concurrency**, which is what the
50-tester runs were hitting — and the hard 500s above ~25 simultaneous writers
are gone.

Compute (~1,080 ms) is now the constraint. Separately measured: ~470 ms of that
is Lua bundle load/compile on a fresh compute even for an *empty* process, and
~316 ms is the population term at 220 accounts. Neither is addressed here.
