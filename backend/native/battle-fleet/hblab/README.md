# hblab — a local HyperBEAM node for measuring where a slot goes

Remote timing could not answer the question. A round trip to
`hyperbeam.tylerw.ai` is ~172 ms and the whole slot is ~380 ms, so every number
was mostly network, and client-side timing under Docker Desktop swung 2.5x
between identical runs. This runs the node locally and reads **the node's own
per-slot log** instead of timing it from outside.

## What it is

`Dockerfile` clones the node's repo (default: the `node-deploy` branch of the
fork, which carries the live node's code and its ops config) and builds it three
ways. It never copies a working tree, so a build is exactly the named ref with
nothing local in it; the resolved commit lands in `/app/.pinned-ref`.

| profile | WAMR build | result |
|---|---|---|
| `stock` | as the node builds it: classic interpreter, JITs off | baseline |
| `fastinterp` | `WAMR_BUILD_FAST_INTERP=1`, profiling off | works, ~2.7x faster execution |
| `fastjit` | `WAMR_BUILD_FAST_JIT=1`, profiling off | **builds, then fails at runtime** |

`fastjit` is worth keeping precisely because it does not work: every module
dies with `Exception: failed to compile fast jit function`, because WAMR's Fast
JIT does not support the `WAMR_BUILD_MEMORY64=1` that HyperBEAM requires. That
is the sort of thing "just turn the flag on" advice gets wrong.

## Use

```bash
./build.sh stock                      # or fastinterp | fastjit
docker run -d --name hb-stock -p 8734:8734 -v hb-stock-data:/data hb:stock

node seed.mjs http://localhost:8734   # spawns the comparison set
node harvest.mjs hb-stock workers.8734.json 30
```

`build.sh` always passes `CACHE_BUST`, so a moving branch is genuinely
re-fetched rather than served from a cached clone layer.

## The comparison set

`seed.mjs` spawns four processes that all answer the same trivial
`Fleet.Status`, so the only variable is what executes it:

- **lua** — the real Lua worker under `lua@5.3a` (Luerl, interpreted on the BEAM)
- **rust** — the real Rust worker under `json-iface@1.0` + `wasm-64@1.0`
- **floor** — `floor.wat`, 280 bytes, returns one constant, same ABI and stack
- **bulk** — `bulk.wat`, 360 KB of inert functions, returns the same constant

The two controls are what make the numbers mean anything. Without them a slow
Rust worker is just "Rust is slow"; with them you can separate the device
stack's cost, the module's size, and the module actually running.

`floor.wat` rewinds its bump allocator at the end of every `handle`. Without
that it walks off its two pages after a few dozen slots and the node reports
`{badmatch,{error,"Write request out of bounds"}}`, which looks like a node
fault rather than a two-line control module being wrong.

## Why `harvest.mjs` and not a stopwatch

HyperBEAM logs `computed_slot` per slot with `prep_ms`, `execution_ms`,
`store_ms` and the result size. Those are measured inside the node, so they are
immune to round-trip time, to Docker Desktop's networking, and to whatever else
the laptop is doing. External timing of the same four processes disagreed with
itself by 2.5x run to run and made a 280-byte module look slower than a 360 KB
one; the node's own numbers put them within 1 ms of each other, every time.

## What it measured

30 slots each, median, on this branch:

| worker | exec (stock) | exec (fastinterp) | store | slot bytes |
|---|---|---|---|---|
| lua | 3 ms | 2 ms | 2 ms | 969,791 |
| rust | 17 ms | 10 ms | 3 ms | 8,796 |
| floor (280 B) | 6 ms | 6 ms | 1 ms | 4,741 |
| bulk (360 KB) | 6 ms | 6 ms | 1 ms | 4,735 |

- **Module size is free.** 280 bytes and 360 KB cost the same, so nothing is
  re-instantiating the module per slot.
- **The ABI floor is 6 ms** and the interpreter does not touch it. A module that
  returns a constant still costs 6 ms of "execution": that is JSON-Iface
  encoding the Process message in and decoding results out, per slot.
- **Our Rust module's own work is 11 ms interpreted**, against 0.18 ms native.
- **Fast interp cuts that to 4 ms** — 2.7x, one Makefile flag, no module change,
  and it helps every WASM module on the node.
- **Rust cannot beat Lua here.** Best case is the floor: ~7 ms a slot against
  Luerl's 5 ms for the entire worker. The ABI alone costs twice what Lua's whole
  execution does.
- **Lua writes 969 KB per slot; Rust writes 8.8 KB.** Not a latency problem yet
  (`store_ms` is 2-3 ms either way), but at 12 slots/sec that is ~11 MB/s of
  writes on the Lua path, and it is the one number where Rust wins by two orders
  of magnitude.
