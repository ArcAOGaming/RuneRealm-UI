# Streaming a published database off Arweave

A test harness for HyperBEAM's `hb_store_arlmdb`
([permaweb/HyperBEAM@c0d8146](https://github.com/permaweb/HyperBEAM/commit/c0d81469e9106089961a605e5301edc9349fe727)).
Nothing here is wired into the game. It is here to answer one question before
anything gets built on it: **what can this actually do, measured, on our data.**

## What the thing is

Someone publishes a single Arweave transaction whose data is an LMDB file of
fixed-width rows. Its tags say how to read it:

| tag | value on the live index |
|---|---|
| `device` | `lmdb@1.0` |
| `prefix` | `~arweave@2.9/offset=` |
| `normalize-key` | `~base64url@1.0/decode/~bits@1.0/take=77` |
| `normalize-result` | `~bits@1.0/from=_:77,start:49+integer,length:34+integer` |

That is the whole contract. A key is turned into row bits, the tree is
descended with **HTTP byte-range reads**, and the matching row is turned back
into a message. 77 + 49 + 34 bits is a 20-byte row; 8,560,638,056 of them is
171 GB; the file is never downloaded.

The live index maps every confirmed ANS-104 data item ID to its byte range in
the weave — the thing you normally need a gateway's index node to tell you.

## What we measured

```
container 7vg2832WFsisEcBr1oBQ8ldc4EGOkjQdwW46hDvJsOs
  171.4 GB, 8,560,638,056 rows, 20-byte rows, tree depth 3

open                    1 chunk    (meta, main root and sub-root are defragmented together)
one lookup              2 chunks   512 KB useful / 689 KB wire, 55-330 ms
a proven miss           2 chunks   same cost — a miss is read, not guessed
```

Both of HyperBEAM's own eunit vectors reproduce **exactly** from this
independent JS implementation, which is the strongest correctness signal
available short of running the Erlang:

```
AAAAhyV8_NwududSxuraAj7DLWiZHDTqVKWrZglpNok -> start=381852134215637 length=3947
1QAAJqd60JFNvY3lBfIS5CFPjXteQSHMTp8cuvBJuHA -> start=381680833668862 length=1356
```

Cross-checked against GraphQL: the index `length` is the whole ANS-104 item, so
it exceeds the payload by the header (3947 vs 2827 → 1120 bytes of header).

Rune Realm's three legacynet processes all resolve. Wire bytes run ~1.37x
useful bytes only because an Arweave peer serves `/chunk/` as JSON with the
payload base64url-encoded; a node reading ranges directly moves the useful
figure.

## What it can do

- **Query a 171 GB database for ~0.5 MB**, with no database server, no
  indexer, and no egress bill. Cost per lookup is constant in the size of the
  data — depth 3 over 8.5 billion rows.
- **Run with no backend at all.** `container.mjs` is a port of the Erlang
  store, and it talks only to Arweave peers. The same traversal runs in a
  browser, so this is not a node feature a dApp has to wait for — it is a data
  format a dApp can read directly. (The demo at `390410975380kb.arweave.net`
  does exactly this.)
- **Serve any published container, not just Arweave offsets.** The reader is
  driven by the transaction's tags. Publishing a Rune Realm index is a
  publishing job, not a fork of this code.
- **Prove its answers.** Chunks come with Arweave's Merkle proofs and can be
  sourced from any peer, so there is no trusted API in the path and no single
  host to lose.
- **Say "no" honestly.** A miss is proven by reading the leaf where the row
  would sit. A container outside the format is refused loudly at open, never
  served as empty.

## What it cannot do yet

- **Read-only, and immutable.** A container is a published snapshot. Live
  mutable state cannot live here; this is a cold tier.
- **The snapshot has a tail.** Coverage reaches at least offset
  381,852,134,215,637 while the weave is at 390,364,884,934,902 — up to ~8.5 TB
  uncovered. Everything Rune Realm uploaded in 2026-08 (the live game process,
  the site manifest, all 143 site assets) **misses**; the 2024-25 legacynet
  processes hit. Until a delta index covers the gap, anything recent still
  needs a gateway.
- **Our node cannot use it.** `probe.mjs` reports `hyperbeam.tylerw.ai` still
  on `remote-index=true` with no `hb_store_arlmdb` in its store list, so
  offsets there still come from a gateway index node.
- **Publishing a container is not solved here.** Writing an LMDB file in the
  exact shape the store demands (`MDB_DUPSORT|MDB_DUPFIXED`, depth-1 main root,
  `P_LEAF2` leaves, defragmented so the tree clusters) is a separate build.

## Running it

```bash
npm run test:arlmdb        # 17 tests: offline bit surgery + live golden vectors
npm run probe:arlmdb       # is our node capable yet?
npm run read:arlmdb        # resolve the golden vectors, with costs
npm run arlmdb:runerealm   # our own data items, and where the snapshot ends
```

```bash
node backend/native/arlmdb/read.mjs <id> [id...] [--json] [--cold] [--verify]
node backend/native/arlmdb/probe.mjs [node-url]
```

`--cold` clears the retention cache between lookups — the honest worst case.
The default keeps chunks, which is what a warm node or a browser session sees.
The live tests skip when the weave is unreachable; `ARLMDB_REQUIRE_LIVE=1`
turns a skip into a failure for CI.

## Files

| | |
|---|---|
| `weave.mjs` | chunk reads by absolute offset, with the byte meter |
| `normalize.mjs` | the two AO-Core tag paths, compiled |
| `container.mjs` | the LMDB 1.0 container: meta, descent, seek, run |
| `vectors.mjs` | known answers — HyperBEAM's, and ours |
| `probe.mjs` | node capability report |
| `read.mjs` | resolve IDs, print costs |
| `runerealm.mjs` | our corpus, snapshot coverage, cold-read cost |

## Why we care

The measured wall in this project is that `player-<address>` lives in the
process's published map, every slot marshals that whole map five times, and the
map only ever grows — median action went 7.6 s to 18.5 s over 5,061 actions
(see the repo rules, and `PROCESS_SHAPE_AUDIT.md`).

A published container is the shape of an escape hatch: a cold record costs a
bounded, constant number of chunk reads no matter how many wallets exist. That
is exactly the property the published map does not have. Whether it is the
right fix depends on the two gaps above — the snapshot tail, and having a
writer — so nothing in `src/` or the Lua processes has been touched.
