# hbfast — how to make HyperBEAM go fast

> **The 12 seconds is the size of the Lua module, and it is a node problem.**
> Measured 2026-09-03. Same trivial KV contract, one line of inert padding,
> same node, same moment:
>
> | module | node | schedule | compute | total |
> |---|---|---|---|---|
> | 5,828 B | hyperbeam.tylerw.ai | 180 ms | 190 ms | **370 ms** |
> | 355,845 B | hyperbeam.tylerw.ai | 8,500 ms | 4,700 ms | **13,200 ms** |
> | 355,845 B | local `hb:stock`, same config | 49 ms | 46 ms | **95 ms** |
>
> The deployed `game.lua` bundle is **355,351 B**. A *fresh, empty* game process
> — no players, no battles, no state — costs 7–11 s per message on the live node
> and **180 ms** on a local one. `schedule` never runs a line of Lua, so 8.5 s
> there rules out the contract, the handler, the player table and the collector
> entirely. Everything in `SLOT_LATENCY_INVESTIGATION.md` is real and none of it
> is what is hurting today.
>
> **It is a cliff, not a slope**, and the bundle sits on it. Padded `kv.lua`,
> live node:
>
> | module | 5.8 KB | 206 KB | 236 KB | 266 KB | 296 KB | 326 KB | 356 KB |
> |---|---|---|---|---|---|---|---|
> | total | 456 ms | 460 ms | 449 ms | 465 ms | 677 ms | 1,236 ms | 13 s / spawn fails |
>
> So the immediate fix is **get under ~266 KB**: a 25 % cut takes a message from
> 13 s to under half a second.
>
> **It is not the node's configuration.** The live node's entire scalar config
> was copied onto a local `hb:stock` container — `profiling`, `process-sampler`,
> every `debug-print-*` flag, `debug-trace-type`, `cache-lookup-hueristics`,
> `force-signed`, `scheduler-default-commitment-spec: ans104@1.0`,
> `scheduling-mode: local_confirmation`, `bundler-ans104` pointed at
> `up.arweave.net`, `process-snapshot-slots: 1`, `process-worker-max-idle`,
> `client-error-strategy` — and the local node stayed at **131–157 ms at every
> size including 356 KB**. Restarting the live node changed nothing either.
>
> **What is left is the box.** Writing the module at spawn is the cleanest
> signal, because it is one write and no Lua runs:
>
> | | 5.8 KB spawn | 356 KB spawn |
> |---|---|---|
> | local | 186 ms | **156 ms** |
> | live | 640–1,070 ms | **23,000–27,700 ms**, or 500 |
>
> ~150x on a pure write. Check, on the live host: free disk, the size of the
> `cache-mainnet` store, `iostat -x` during a write, and which HyperBEAM commit
> it runs. The local lab is built from `674329bf62f9f3dbc7adea0ce4e53ad0a29cb3a3`
> of the repo's own `node-deploy` branch, `rocksdb+genesis_wasm`.
>
> Reproduce: `pad-probe.mjs` / `size-sweep.mjs` (scratchpad) — spawn `kv.lua`
> with and without a `local PAD = [[...]]` line and time four writes at each
> size, against both nodes.
>
> Separately, `schedule.forward.computer` schedules in **4–11 s** for a 5 KB
> module while computing in 150 ms — that is the inline-bundler-upload bug in
> `HYPERBEAM_SCHEDULER_PATCH.md`, still unpatched there. tylerw.ai schedules a
> small module in 180 ms, so the patch *is* applied there.


Not a game. One key/value contract (`kv.lua`), one harness (`lab.mjs`), and the
numbers that come out of them. It exists to answer the question "if you were
just updating a database and lots of people came in at once, how would you do
it" without any Rune Realm code in the way.

Everything below was measured 2026-09-03 on a **local `hb:stock` container on a
laptop** (`backend/native/battle-fleet/hblab/build.sh`), which is a much weaker
box than the production node. Treat the shape of the curves as the result; the
absolute numbers are a floor.

---

## The headline

One process, one shard, on a laptop:

| | writes/s | p50 |
|---|---|---|
| schedule only (durable write, no wait) | **57** | 48 ms |
| schedule + wait for your own slot | **49** | 72 ms |
| the live game, same platform | ~3 | 12,000 ms |

So HyperBEAM is not the 12 seconds. A process that keeps its state in the right
shape takes writes 15x faster than the game does, on worse hardware, and answers
reads in 9 ms while doing it.

---

## The four rules

### 1. A write is finished when the scheduler answers. Do not wait for compute.

`POST /<pid>~process@1.0/schedule` returns the slot number in ~40 ms and the
message is durable at that point — signed, ordered, written to the node's cache
(`dev_scheduler_server:do_assign/3`, `local_confirmation`). Nothing about the
write can fail after that.

`GET /<pid>~process@1.0/compute&slot=N` is a **separate, optional** request that
asks the node to run the message and hand back its reply. It is the one that
queues, because every uncomputed compute for a process funnels through a single
Erlang worker keyed on the process id (`dev_process_worker:compute_group/3`).

A client that awaits its own slot has voluntarily joined that queue. A client
that schedules, applies the change optimistically, and reconciles from published
state has not.

### 2. Reads never schedule and never compute.

`GET /<pid>~process@1.0/now/<key>` is a cached HTTP GET of whatever the handler
last published through `~patch@1.0`. Measured here: **13 ms idle, 155/s**.

This requires `"process-now-from-cache": true` in the node config. HyperBEAM
defaults it to `false`, and with the default a `/now` read computes forward to
the scheduler head — which turns every "passive" poll into the same queue as a
write. The live node already sets it; a new node will not.

Measured, on the 20,000-record process, with 24 concurrent writers hammering it:

```
idle reads:        p50 13.4 ms   178/s
reads under write: p50 22.2 ms   155/s
writers:           p50 600  ms    37/s
```

Reads do **not** starve, which contradicts HYPERBEAM.md §22. The difference is
`process-now-from-cache` plus a bounded published map — §22 was measured with
neither.

### 3. The published map is the per-slot tax. Keep it O(1), not O(records).

`dev_lua:compute/4` does `hb_cache:ensure_all_loaded(Params)` → `encode/2` →
`luerl:call_function_dec` → `decode` → `hb_cache:write`, where `Params` is the
**whole base message**. Every published key is loaded, encoded into Luerl,
decoded back and re-written on every message, whatever that message did.

`kv.lua` has three publish policies so the cost can be priced. Same contract,
same store, same node:

| records | `hot` (bounded window) | `all` (a key per record) |
|---|---|---|
| 0 | 72 ms | 325 ms |
| 4,000 | 79 ms | 693 ms |
| 8,000 | 78 ms | 1,843 ms |
| 20,000 | **90 ms** | unusable |

`hot` is flat to 20,000 records with a **constant 17 KB** published map. `all`
is superlinear and, past a few thousand records, its `/now` response cannot even
be read: published keys become HTTP headers and the client dies with
`UND_ERR_HEADERS_OVERFLOW`.

This is exactly the `player-<address>` scheme. It makes reading your own record
free for one wallet and charges every other wallet's message for it, forever.

**What to publish instead:** counters, a bounded recent-activity window, and
derived views small enough to name a size limit for. **How a writer reads its
own record without publishing it:** the reply to a write is cached permanently
at `compute&slot=N/results/output/data`. You wrote it, so you know N. Re-reading
it is free and never recomputes.

### 4. Hold state as strings, not nested tables.

Luerl's collector is O(live tables²) and free in bytes
(`SLOT_LATENCY_INVESTIGATION.md`, `gc-shape.mjs`: 8,000 records cost 23,599 ms
as tables and 0.3 ms as strings). `kv.lua` holds every value as one string, and
that is the only reason the `collectgarbage("collect")` at the end of `compute`
stays free at 20,000 records.

Keep as flat scalars on the record only the fields aggregates actually read.
Everything else goes in the blob.

### 5. Throughput is per process. Shard to scale it.

There is one scheduler per process and one compute worker per process, so writes
to a process are strictly serial and adding nodes does not help — another node
replays the identical slots at the identical cost. The only way up is more
processes. Route by `hash(key) % shards`; each shard is an independent log.

Sharding earns its keep once the queue, not the CPU, is the constraint. On this
laptop the box saturates first, so 2 shards beat 1 (94/s vs 47/s at 16 in
flight) and 4 does not beat 2. On a real box it keeps going.

---

## The trap that is not in any of the above

**HyperBEAM rate-limits by IP, by default, and nobody configures it off.**

`dev_rate_limit` is in the stock `on/request` hook chain in `hb_opts.erl`. Its
defaults are 1,000 requests per 60 seconds — **16.7 req/s sustained** — with a
1,000-request burst bucket. Exceed it and the balance goes **negative to −1,000**,
so every further request is a `429 Rate limit exceeded` and a full recovery takes
two minutes of silence.

This is what the first run of `lab.mjs ceiling` hit: 64 of 64 failures at four
shards, zero once `rate-limit-requests` was raised. It is almost certainly the
"429s at ~25 req/s, source not nginx, still unlocalized" ceiling from earlier
load-test work.

**The part that makes it a production bug, not a lab curiosity.** The caller's
identity is `x-real-ip` if present, otherwise the TCP peer
(`hb_http:real_ip/2`). The live node runs behind **nginx/1.18.0**. If that nginx
does not `proxy_set_header X-Real-IP $remote_addr`, then every player, every bot
and every deploy script in the world is one caller sharing one 16.7 req/s
bucket — which is a complete explanation for "one-off tests are instant and
playing the game is twelve seconds."

Two things to check on the live node, in this order:

```bash
grep -r X-Real-IP /etc/nginx/                       # is per-client identity even reaching the node?
curl -s "$NODE/~meta@1.0/info/serialize~json@1.0" | grep -i rate   # currently: no keys, so defaults
```

and set explicitly in `node-config.json`:

```json
"rate-limit-requests": 60000,
"rate-limit-period": 60,
"rate-limit-max": 60000,
"rate-limit-min": 0
```

`rate-limit-min: 0` matters on its own: with the default `−1000` a burst does not
just get throttled, it digs a hole that takes a minute of idling to climb out of.

---

## Use

```bash
# a local node (from backend/native/battle-fleet/hblab/)
./build.sh stock
docker run -d --name hbfast --rm -p 8734:8734 -v hbfast-data:/data hb:stock

# raise the rate limit first, or every result below is a 429 measurement
docker exec hbfast node -e '...'   # see "The trap" above

node lab.mjs spawn   --shards 4 --policy hot
node lab.mjs ceiling --shards 1,2,4 --conc 1,4,16,32,64 --n 96
node lab.mjs growth  --to 20000 --step 4000
node lab.mjs reads   --conc 24
```

`lab.mjs` deliberately does **not** fire a background `push` alongside a
`compute`. `hbclient.mjs`'s `sendMessage` does, and that is the 2.79x slot
replay factor in `SLOT_LATENCY_INVESTIGATION.md` — two walkers on the same
slots, each paying full price.
