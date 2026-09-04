# TEST-HyperDB

This is a database-shaped HyperBEAM experiment, not game code. It exists to
answer one question with a real node: how fast can many independent writers
apply a large number of small durable updates when the process and transport
are shaped for HyperBEAM?

## The correct HyperBEAM write path

For an interactive user update, use the composed push route:

1. The client signs one `type=Message` targeted at the process.
2. An httpsig client POSTs it to `/<pid>~process@1.0/push`. A browser POSTs its
   ANS-104 item to
   `/<pid>~process@1.0/push?codec-device=ans104@1.0`.
3. That one request validates and schedules the message, computes its assigned
   slot in process order, walks any resulting outbox, and returns both the slot
   header and this message's own output.
4. Plain reads use small state already published by the process. They must not
   schedule a read handler merely to fetch data.

This was reproduced on the local node with both signature formats: httpsig
returned a valid update in 120 ms and browser-equivalent ANS-104 returned one
in 93 ms. In both cases the scheduler head advanced by one and the response
carried that slot's correlated JSON output. HyperBEAM's official
[`httpsig-examples`](https://github.com/permaweb/httpsig-examples) use the same
POST `/process-id/push` shape. The current
[`dev_process`](https://github.com/permaweb/HyperBEAM/blob/edge/src/preloaded/process/dev_process.erl)
routes `/push` into `push@1.0`; the lower-level
[`dev_scheduler`](https://github.com/permaweb/HyperBEAM/blob/edge/src/preloaded/process/dev_scheduler.erl)
still exposes POST `/schedule` separately.

The split form remains valid: POST `/schedule`, take its slot, then GET
`/compute&slot=N/results/output/data`. It is useful for fire-and-forget writes
or explicit pipeline control, but it adds a second request to an interactive
round trip. GET `/push&slot=N` is a different operation: it re-walks an already
computed slot's outbox. Do not call it after a successful composed POST `/push`.

Never poll `/now/results/output/data` for a write reply. That is the most recent
reply from any writer. Use the output returned by POST `/push`, and retain its
slot plus the application's transaction id for reconciliation if the HTTP
response is lost.

## Why a single "database process" queues

The scheduler server calls itself a deliberate bottleneck: exactly one process
assigns monotonically increasing slots so two messages cannot receive the same
position. Execution then applies those slots in order. That is the consistency
model, not an accidental implementation detail.

Therefore:

- one process is one ordered write lane;
- adding CPU or asking another node to replay the same process does not make
  that lane parallel;
- latency under load is `work ahead / lane throughput`;
- independent state must be split across multiple processes to gain write
  throughput.

The upstream
[`dev_scheduler_server`](https://github.com/permaweb/HyperBEAM/blob/edge/src/preloaded/process/dev_scheduler_server.erl)
also still performs two remote bundler uploads in the scheduling loop under
`local_confirmation`. This repository's measured patch moves those uploads off
the ordered lane; see [HYPERBEAM_SCHEDULER_PATCH.md](../HYPERBEAM_SCHEDULER_PATCH.md).
That fix removes an unrelated network wait from admission. It does not make one
process execute two state transitions concurrently.

## How I would build a shared database on HyperBEAM

Use a deterministic shard function such as `hash(tenant + key) % shardCount`.
Every client sends directly to the owning shard. Keep keys that participate in
one invariant or atomic transaction on the same shard. Cross-shard atomicity
needs a coordinator and extra messages, so it should be exceptional rather than
the default path.

Within each shard:

- batch all mutations belonging to one user intent into one message;
- use compare-and-set versions for contested records;
- retain bounded idempotency receipts, never an unbounded request log;
- store compact rows, and avoid a table-per-field/table-per-row shape;
- publish only bounded hot views and metrics;
- use one composed POST `/push` for an interactive mutation and its reply;
- never follow a successful composed push with another push of the same slot.

Set the node's `process-now-from-cache` to `always` for serving published reads.
With HyperBEAM's default `false`, `/now` is allowed to compute to the scheduler
head. Under a write backlog, an apparently passive GET then joins the work it is
waiting on and can starve alongside the writers.

For a genuinely large, indefinitely growing database, do not mistake this
prototype for a storage engine. A native Lua process still snapshots its whole
VM periodically. Partition cold data further or put a trie/custom indexed
device behind the ordered process and retain only its root in authority state.
The essential architecture remains the same: ordered mutation logs, independent
shards, bounded projections, exact-slot correlation.

## What the prototype does

[`store.lua`](store.lua) supports up to 5,000 operations in one message:

```text
P<TAB>key<TAB>value
I<TAB>key<TAB>signed-integer
C<TAB>key<TAB>expected-version<TAB>value
D<TAB>key<TAB>expected-version-or-*
```

It validates the complete batch before changing state, applies atomic
increments and compare-and-set operations, and keeps only the latest 4,096
transaction receipts for idempotency. Each retained row is one string rather
than a tree of Lua tables. The public `hyperdb` key is constant-size regardless
of row count.

The benchmark uses real signatures from throwaway `.burners` wallets, pre-signs
outside the measured interval (real users sign on different machines), assigns
each writer directly to a shard, and permits one outstanding request per writer.
It uses browser-equivalent ANS-104 plus composed POST `/push` by default. The
`--transport split` mode runs the existing POST `/schedule` + GET `/compute`
flow against the same workload for an apples-to-apples comparison.

## Run it

Start the existing local lab node:

```bash
cd backend/native/battle-fleet/hblab
./build.sh stock
docker run -d --name hb-stock -p 8734:8734 -v hb-stock-data:/data hb:stock
```

Then:

```bash
npm run test:hyperdb
npm run bench:hyperdb
```

Useful comparisons:

```bash
# One ordered lane: exposes queueing.
node backend/native/hyperdb/benchmark.mjs --shards 1 --writers 16

# Four lanes with the same writers and batch size.
node backend/native/hyperdb/benchmark.mjs --shards 4 --writers 16

# More work per scheduled message.
node backend/native/hyperdb/benchmark.mjs --shards 8 --writers 32 --ops 1000

# Compare the old two-request flow with the default composed push.
node backend/native/hyperdb/benchmark.mjs --transport split --codec ans104
```

The benchmark refuses a non-local node unless `--allow-remote` is explicit,
and every process it spawns is prefixed `TEST-`.

## Measured locally

Measured 2026-09-03 on the repository's local HyperBEAM lab node. Every row is
128 scheduled messages from 16 concurrent writers (eight sequential messages
per writer), using browser-equivalent ANS-104. Signing was completed before the
measured interval and every reported update, transaction id, and signer was
verified afterward.

| transport | shards | updates/message | total updates | wall time | updates/s | round-trip p50 |
|---|---:|---:|---:|---:|---:|---:|
| POST `/push` | 1 | 250 | 32,000 | 11.62 s | 2,753 | 1,434 ms |
| POST `/push` | 4 | 250 | 32,000 | 3.60 s | 8,879 | 419 ms |
| `/schedule` + `/compute` | 4 | 250 | 32,000 | 3.91 s | 8,182 | 450 ms |
| POST `/push` | 4 | 1,000 | 128,000 | 9.89 s | **12,941** | 973 ms |

On the 128,000-update run, the composed push round trip was 973 ms p50 /
1,740 ms p90 and a published-state GET was 73 ms p50. The comparison is the
point: HyperBEAM pays a substantial fixed cost per message, while useful work
inside that message is cheap. Four independent ordered lanes made the identical
32,000-update workload 3.2x faster than one lane and cut median response time
from 1,434 to 419 ms. The composed push also beat the two-request flow while
removing one whole HTTP request. Putting 1,000 related row changes in each
message delivered 12,941 verified updates/s.
