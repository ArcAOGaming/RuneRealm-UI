# HyperBEAM porting facts

Reference for anyone (human or agent) moving an AO legacynet app to HyperBEAM.

**Verified 2026-08-25 against HyperBEAM HEAD `14e9f68` and live public nodes.**
Everything below marked `[V]` was reproduced by hand. Everything marked `[?]` was
not. **Do not trust the HyperBEAM docs site** — it is a five-page stub, last built
2025-11-25, and most of its own nav links 404. It still documents devices that
have been deleted from source. Reproduce before you rely on anything here too;
this ecosystem moves fast and this file will rot.

---

## 1. How to check anything yourself

### Is a device present on a node?

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "https://arweave.net/~lua@5.3a/info"
```

Read the code, not the body:

| Code | Meaning |
|------|---------|
| `500` with `hb_device:message_to_dev` in the stacktrace | device **NOT loaded** |
| `404` "hashpath cannot be resolved" | device **EXISTS**, that key doesn't |
| `200` | device exists (may be the node's default index page — check the body) |

Confirm your detector works by probing a device you know is fake, e.g.
`~totally-fake@1.0`. It should give the 500.

### Run arbitrary Lua on a live node — free, unsigned, no wallet

```bash
curl -sS -X POST "https://alpha.neo.zephyrdev.xyz/~lua@5.3a/myfn" \
  -H 'content-type: application/lua' \
  --data-binary 'function myfn(base, req) return "hello" end'
```

This is the single most useful tool for answering "does X work". Write a Lua
function that probes what you care about and read the return value. `[V]`

### Node identity and config

```bash
curl -sS "https://arweave.net/~meta@1.0/info"                      # headers = config
curl -sS "https://arweave.net/~meta@1.0/info/serialize~json@1.0"   # as JSON
curl -sS "https://arweave.net/~meta@1.0/info/address"              # operator address
```

---

## 2. Nodes

- `https://arweave.net` **is itself a HyperBEAM node.** `[V]` Not just a gateway.
- Also live: `https://alpha.neo.zephyrdev.xyz`, `https://charlie.neo2.zephyrdev.xyz`,
  `https://schedule.forward.computer`, `https://hb.arweave.net`. `[V]`
- The first three share operator address `igDTf_lKpgmsMpuDI_Xp3UNkeMyym7WpDqurrffOWmk`. `[V]`
- **Dead:** apex `https://forward.computer` (connection timeout),
  `https://state.forward.computer` (nginx 403). `[V]`
- **Compute is free.** No pricing keys in `/~meta@1.0/info`; `~p4@1.0` unconfigured
  on every node tested. Spawns and messages need no funded wallet. `[V]`
- CORS is open (`access-control-allow-origin: *`), so browser dApps can call
  nodes directly. `[V]`

---

## 3. Devices

Devices are Erlang modules at `src/preloaded/**/dev_*.erl` (~85 of them). The
device name derives from the module filename (`dev_foo_bar` → `foo-bar@1.0`)
unless an `-implements(<<"name@ver">>)` attribute overrides it.

**Present and confirmed live** `[V]`: `process@1.0`, `scheduler@1.0`, `push@1.0`,
`patch@1.0`, `message@1.0`, `meta@1.0`, `relay@1.0`, `cron@1.0`, `p4@1.0`,
`lua@5.3a`, `genesis-wasm@1.0`, `wasm-64@1.0`, `json-iface@1.0`,
`delegated-compute@1.0`, `dedup@1.0`, `hyperbuddy@1.0`.

**Do NOT exist** `[V]`:

- `wasm64@1.0` — the real name is **`wasm-64@1.0`** (hyphen). Easy hours lost here.
- **No `wasm-32` device at all.** Legacy aos sqlite modules are
  `wasm32-unknown-emscripten` and therefore cannot run on HyperBEAM's native WASM
  device. There is no legacy module that is simultaneously wasm64 and
  SQLite-capable.
- `snp@1.0`, `green-zone@1.0` — **all TEE/attestation modules have been deleted
  from source.** They survive only as stale markdown under
  `docs/resources/source-code/`. The live docs still tell you to verify nodes via
  `~snp@1.0`. Ignore that.

---

## 4. The Lua device (`~lua@5.3a`) — read this before planning any port

### It is Luerl, not Lua

`rebar.config:201` pins **luerl 1.3.0** — Lua reimplemented in Erlang. `[V]`
Consequences:

- **No C modules. Ever.** `dev_lua_require.erl` deliberately replaces `require`
  with a disk-free version resolving only from `package.preload` / `package.loaded`,
  specifically to close the filesystem escape vector. `[V]`
- **There is no SQLite anywhere in HyperBEAM.** `grep -ri sqlite` across the whole
  tree, including `native/` C code, returns zero hits outside `docs/`. `[V]`
  `require("lsqlite3")` on a live node → `module 'lsqlite3' not found`. `[V]`

### What the bare sandbox actually contains `[V]`

Probed live, not read from docs:

- **Present:** `ao`, `os.time`, `os.date`, `math.random`, `string`, `table`,
  `utf8`, `bit32`, `io`, `load`, `require`, `debug`, `package`
- **Missing:** `sqlite3`, `lsqlite3`, `json`, `crypto`, `Handlers`, `coroutine`,
  `table.move`, `string.pack`
- `package.preload` is **empty** — there is nothing to `require` until you load it
- `_VERSION` reports `Lua 5.3`

### Integers are fine — do not panic `[V]`

`math.type(1)=integer`, `math.maxinteger` correct, `9007199254740993` exact,
`//` and `%` and `string.format("%d")` all correct. Token and currency math is safe.

### Integers are bignums, and `math.type` will not tell you `[V]`

**Added 2026-09-01.** The section above is right that token and currency maths is
safe, and wrong if you read it as "Lua 5.3 integer semantics". Luerl integers are
Erlang bignums and **do not wrap**:

```lua
math.type(0xcbf29ce484222325)          --> integer
math.maxinteger                        --> 9223372036854775807     (correct)
0xcbf29ce484222325 * 0x100000001b3     --> 16158402040730025834900042659807
```

So both of the things you would check report a 64-bit signed integer while
arithmetic silently promotes past it. Real Lua 5.3 wraps, and `ao-loader` IS real
Lua, so a local suite cannot see this.

Anything relying on fixed-width overflow — a hash, a PRNG, a checksum — computes
a different answer here than everywhere else, with no error. Mask after every
operation that can overflow:

```lua
local M64 = 0xFFFFFFFFFFFFFFFF
h = (h * PRIME) & M64
```

That yields unsigned 0..2^64-1 and matches JavaScript `BigInt & M64` exactly.
Note also that Lua's `%` is floored, so on a real 5.3 the same bits would be
negative and `x % n` would differ again; mask the sign bit off before any modulo
to be correct on both.

### `string.gmatch` does not work at all `[V]`

**Added 2026-09-01.** It rejects **every** pattern:

```lua
string.gmatch("1:5", "[^:]+")   --> bad argument '1:5','[^:]+' to 'gmatch'
string.gmatch("1:5", "%d+")     --> bad argument '1:5','%d+' to 'gmatch'
```

`string.find`, `string.match` and `string.gsub` are all fine, patterns included.
It is specifically `gmatch`, so any tokenizer written the obvious way throws on
the deployed process having passed every local test. Use
`string.find(s, sep, start, true)` with `string.sub`.

### `string.format("%g")` IS BROKEN `[V]`

Luerl does not strip trailing zeros the way PUC Lua's C `printf` does:

```
string.format("%.14g", 100)    -->  "100.00000000000"   (PUC Lua: "100")
string.format("%.14g", 100.5)  -->  "100.50000000000"   (PUC Lua: "100.5")
```

This silently corrupts **every integer** passing through the json encoder in
`hyper-aos.lua`, which uses `%.14g` for all numbers. Audit your own code for
`%g` / `%e` / `%f` too. The fix:

```lua
local function encode_number(val)
  if math.type(val) == "integer" then return string.format("%d", val) end
  return string.format("%.14g", val)
end
```

Verified working on a live node. `[V]`

### Get Handlers and json back: `test/hyper-aos.lua`

The HyperBEAM repo ships an ~81 KB AOS compatibility layer at `test/hyper-aos.lua`
providing `Handlers`, `Handlers.utils`, `.json`, `.utils`, `.stringify`, `.eval`.
**It loads and runs on a live public node** — `Handlers.add`, `require(".json")`
and `require(".utils")` all resolve. `[V]` This is the porting base for any
legacy aos Lua. Apply the `encode_number` fix to its bundled json.

### State model

State is the message. Persistence is
`term_to_binary(luerl:externalize(State))` — **the entire Lua VM state as one
blob**, per checkpoint (`dev_lua.erl:385`). `[V]`

**Plan for this.** SQLite lets you touch one row; here every player, item and
balance may be re-serialized on every checkpoint. If your table is large, look at
`~trie@1.0` (a radix trie stored as messages) or split state across processes.
Measure this early — it is the risk most likely to invalidate a migration plan. `[?]`

### Luerl never collects, so the snapshot is every table you ever made `[V]`

**Verified 2026-08-29 on a live `~lua@5.3a`.** This is the single biggest thing
on this page for anyone whose process is slow.

The blob above is `term_to_binary` of Luerl's table store. Luerl runs no
collector of its own, so unless the process asks for one, every transient table
every message ever built is still in that store when the node checkpoints. The
snapshot is therefore sized by allocations-since-spawn, not by live state.
RuneRealm hit this at ~900x: 320 KB of game state, a 282 MB snapshot, ~1.6 MB
added per action, 5–6 s to write. 282 MB / (303 slots × ~2,400 tables per
message) is ~390 bytes per table — the whole overhead is accounted for by
uncollected tables.

**`collectgarbage` is a stub for every argument except `"collect"`.** `"count"`
and `"step"` both return nil and do nothing. A process that "collects" with
`collectgarbage("step")` is not collecting at all, and nothing will tell it so.

**You can measure the store from Lua, because `tostring` prints the index:**

```lua
tostring({})   --> "table: 5020"   -- the slot the store just handed out
```

Take that number before and after a message and the difference is the tables
that message left behind. Two loops over the same actions — one with a real
collect, one with `collectgarbage` stubbed out — separate live data from
garbage without decoding a single snapshot. `backend/native/heap_probe.lua` in
this repo does exactly that; measured against the RuneRealm bundle:

| message | tables allocated | tables kept | garbage |
|---|---|---|---|
| `User.Login` (a pure read) | 264 | ~0 | all of it |
| unlock + join + adopt (a real write) | 2,405 | 802 | 67% |

**A collect is safe only at the outermost Lua frame.** A collection renumbers
the table store, and two things hold raw indices across it and do not survive:

- **`pcall`.** It restores the interpreter state it captured on entry, so a
  collect anywhere inside a pcall frame leaves that state indexing freed tables.
  Fatal only when something is live across the collect — with pure garbage it
  passes, which is exactly how it survives a small test and kills a real
  process.
- **`ipairs`.** Its iterator holds a raw index. A collect inside an `ipairs`
  loop is fatal with no garbage at all. `pairs` (which re-resolves through
  `next`) and numeric `for` are both fine.

Fatal means the **Erlang process dies**: the node answers `500` with an HTML
page and there is nothing for `pcall` to return to. So put the collect at the
end of your `compute`, as a bare statement, after every pcall has returned —
`dev_lua` calls `compute` from Erlang with no Lua frame above it, which is the
one place it is always safe. Test harnesses that drive `compute` in a loop have
to index numerically for the same reason.

None of this reproduces under `ao-loader`, which is real Lua 5.3 where all
three forms are ordinary and correct. It only shows up on Luerl.

---

## 5. There is no database device

If you are looking for somewhere to put SQL, stop.

- `dev_query` — searches the node's **message cache**, not process state
- `dev_trie` — a radix trie, usable as an indexed structure
- `dev_patch` — reorganizes message data so it is readable over HTTP
- `dev_cache`, `dev_flat`, `dev_structured` — storage plumbing, not a database

**State is the message.** SQL becomes in-state Lua tables.

---

## 6. Replacing `dryrun`: `~patch@1.0`

`dev_patch` implements the `execution-device` hooks (`init/compute/normalize/snapshot`),
so it composes with `lua@5.3a` in a stack. `[V]` A handler emits:

```lua
Send({ device = 'patch@1.0', battle = state })
```

and the client reads it as a plain cached HTTP GET:

```
GET /{process-id}~process@1.0/now/battle
```

No signature, no scheduling, no cost. **This is what Bazar does in production
today.** `[V]` Any client polling loop still going through the signed write path
is the first thing to fix in a port.

RuneRealm also reads `/now/at-slot` as its cheap completion gate. The node must
set `process-now-from-cache=always`; HyperBEAM defaults this option to `false`,
which lets a `/now/...` request compute toward the scheduler head and turns a
supposedly passive poll into more process work. Treat cached `now` behavior as a
deployment prerequisite for the client's one-pull write path.

---

## 7. `~genesis-wasm@1.0` — what it really is

It looks like a free lunch for legacy code. It is not what it appears.

`dev_genesis_wasm.erl` **spawns a local NodeJS `genesis-wasm-server` subprocess**
via `open_port({spawn_executable, ...})` and delegates compute to it at
`http://localhost:<port>` through `delegated-compute@1.0`. `[V]` It is the legacy
AO CU running as a sidecar inside the HyperBEAM node.

- Requires a node **compiled with it**, else:
  `"HyperBEAM was not compiled with genesis-wasm@1.0 on this node."` `[V]`
- It does **not** touch legacynet infrastructure — scheduling and state are
  HyperBEAM-native, so processes cannot be evicted the way legacynet apps were.
- Reported to run legacy sqlite aos modules including `lsqlite3` on a public node. `[?]`

**Judgement:** legacy execution engine, modern infrastructure. Reasonable as a
migration bridge or to read old state out. Treat it as a compat shim with an
unclear lifespan, not a destination. For Dumverse it was explicitly rejected —
see `memory/dumverse-no-legacynet-rule.md`.

---

## 8. Native process definition

From `src/preloaded/vm/dev_lua.erl:1057`:

```
device:             process@1.0
type:               Process
scheduler-device:   scheduler@1.0
execution-device:   lua@5.3a          # stack with patch@1.0 for HTTP reads
module:
  content-type:     application/lua
  body:             <lua source>
authority:          [ <address>, ... ]
scheduler-location: <scheduler address>
```

This replaces AOForm's `processes.yaml` module + scheduler pinning entirely.
Cron tags (`Cron-Interval`, `Cron-Tag-Action`) are replaced by `~cron@1.0`, which
inserts messages into a process's own schedule.

---

## 9. Clients and wallets

- **There is no separate HyperBEAM JS SDK.** `@permaweb/hyperbeam` and
  `@permaweb/hb` are 404 on npm; `hyperbeam@3.1.0` is an unrelated Hyperswarm
  package. The client is `@permaweb/aoconnect` in `MODE: 'mainnet'`, which
  delegates to `@permaweb/ao-core-libs`. `[V]`
- Current aoconnect is **0.0.98** (Jun 2026). `[V]`
- `aoconnect.dryrun()` is reported broken in mainnet mode — `normalizeOutput`
  reads `jsonRes.raw`, which the dryrun response does not carry. `[?]`
- **Bazar has dropped aoconnect entirely**, shipping a vendored `ao-wrangler`
  client that reads plain HTTP paths `/{pid}~process@1.0/now` and
  `/{pid}~process@1.0/schedule&from=N&to=M/assignments`. `[V]` For a read-heavy
  app, plain `fetch` against those paths is a legitimate and simpler choice.

### PermawebOS wallet

Chrome MV3 extension, currently distributed unpacked from
`arweave.net/egCJLmvAhdg3e_yQF7j-CYV7zXzxDVSkmx5KFs4EtNg`.

- Injects a **full ArConnect-compatible `window.arweaveWallet`** — existing wallet
  code needs no changes. `[V]`
- If another wallet already claimed `window.arweaveWallet` (ArConnect/Wander wins
  the race when both are installed), PermawebOS stays reachable at
  **`window.permawebConnect`** with the same API. Probe both. `[V]`
- Also injects **`window.aoFetch`**: a `fetch()` that ignores your URL's host and
  routes to the *user's* configured HyperBEAM peers, verifying agreement across
  them. Disagreement surfaces as `ao-wrangler-response-quorum-not-met`. `[V]`
  Extras: `.ready()`, `.peers`, `.invalidate()`, `.cacheMetadata(response)`.

**Design implication:** with `aoFetch` the dApp does not choose the read node —
the user does. "Do we run our own node" becomes a question about writes and
scheduling, not reads.

---

## 10. Running a node locally

Per the repo `Dockerfile`: Ubuntu 22.04, Erlang/OTP built from `maint-27` **source**,
rebar3 bootstrapped from source, a Rust toolchain, cmake, and WAMR. `[V]`
Expect an hour or more on first build. On Windows you need WSL2 or Docker Desktop.

**You usually do not need one to start.** Compute on public nodes is free and
unsigned, so local development is your normal dev server pointed at a public
endpoint. Run your own node when you need offline iteration, control of your own
scheduler, or guaranteed availability.

---

## 11. Legacynet status (why apps are dying)

- The legacy CU enforces a **process allowlist**. Excluded processes get
  `403 {"error":"Process not found in whitelist"}` from `cu.ao-testnet.xyz`. `[V]`
- The SU enforces one too: `403 "Process ... is not allowed on this SU"` from
  `su201.ao-testnet.xyz`. `[V]`
- **Both** ends means an excluded process can neither be read nor written. Its
  live state cannot be queried — only reconstructed by replaying the Arweave
  message log.
- The legacy stack itself still works for allowlisted processes, so a 403 is
  exclusion, not an outage. Check a known-good process (e.g. the AO token
  `0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc`) to tell the two apart.
- Old community CUs `cu.randao.net` and `cu1.randao.net` are **NXDOMAIN**. `[V]`

**If you are diagnosing a dead AO app, check for the 403 allowlist first.** It is
the most likely cause and it is not a HyperBEAM problem.

---

## 12. Gotchas worth the ink

1. `~wasm64@1.0` does not exist; it is `~wasm-64@1.0`. `[V]`
2. There is no wasm-32 device, so legacy sqlite aos modules cannot run natively. `[V]`
3. `string.format("%g")` is broken in Luerl and corrupts json integers. `[V]`
4. `coroutine` is absent from the Lua sandbox — check your code before planning. `[V]`
5. TEE devices are gone from source but still in the docs. `[V]`
6. `/info` on a live node often returns the Hyperbuddy SPA HTML rather than device
   info, so a 200 does not mean you got what you asked for. Read the body. `[V]`
7. Never commit an Arweave keyfile. Root `.gitignore` in this repo now covers
   `*wallet*.json`, `arweave-wallet-*.json`, `*.jwk`.

---

## 13. Measured: does message-as-state scale?

Run against `alpha.neo.zephyrdev.xyz` on 2026-08-25 with Dumverse's real schema
(28-column Users, 16-column Leaderboard, 8 Inventory rows per player). `[V]`

### Hot path is O(1) and stays flat

With 2,000 players loaded, using `backend/native/store.lua`:

| Operation (x2000) | Time | Per op |
|---|---|---|
| Indexed lookup by address | 0.035s | 17.5 us |
| Primary-key update | 0.053s | 26 us |
| `findBy` on an indexed column | 0.035s | 17.5 us |

Independent of table size. **Hash lookup by wallet address is faster than the
`WHERE address = ?` it replaces.** Table growth is not the risk.

### State size is the real constraint

Measured per player, JSON-encoded:

```
Users  667 B   Leaderboard  531 B   Inventory (8 items) 1396 B   TOTAL 2594 B
```

| Players | State |
|---|---|
| 1,000 | 2.5 MB |
| 10,000 | 24.7 MB |
| 50,000 | 124 MB |

**Inventory is 54% of the footprint** because each item is a full row with string
`item_id` and `item_type`. Interning those to integers is the obvious first
optimization if the number gets uncomfortable.

Caveat: `json.encode` is a **pessimistic proxy**. The real snapshot is
`term_to_binary(luerl:externalize(State))` in Erlang, which is faster and more
compact than building a JSON string in Lua. Treat these as an upper bound; the
true checkpoint cost still needs measuring on a real process. `[?]`

### There is a per-message compute ceiling

Building 5,000+ players in one message, or JSON-encoding ~4 MB of nested tables,
returns `502` from nginx at ~25s or a `500` with `Termination type: '[No type]'`. `[V]`
Around 2,000 players per message is comfortable. **Do not do heavy full-state
serialization inside a single message** — that alone can fail a handler.

### SQL complexity in this codebase

All 181 SQL literals surveyed: **zero JOINs, zero GROUP BY, one COUNT, two LIMITs,
14 ORDER BY, 17 multi-condition WHERE.** 68 are primary-key access on Users.
The translation is mechanical, which is why `store.lua` is ~250 lines.

### The replacement

`backend/native/store.lua` — primary-key get/update, declared secondary indexes
(`user_id`, `address`, `nft_address`), multi-column `find`, ordered/limited `all`,
and snapshot/restore that rebuilds indexes from data.

Test it against any live node, no wallet needed:

```bash
./backend/native/run-test.sh                       # 16 assertions + scale probe
./backend/native/run-test.sh https://arweave.net   # or any other node
```

---

## 14. Process creation: you must sign with ans104, not httpsig

**CORRECTED 2026-08-25.** This section first claimed aoconnect could not create
processes at all. That was wrong. It can — but only with the right signing format.

### The rule

**Writes on HyperBEAM use ANS-104 data items, NOT RFC-9421 httpsig.** `[V]`
aoconnect 0.0.98 `dist/index.js:52` sets `"signing-format":"ans104"`, and
`/~message@1.0/committers` returns the signer **only** under ans104 — under
httpsig it returns none. An httpsig-signed process message therefore arrives with
no recognized commitment and the scheduler rejects it.

Pass it explicitly:

```js
c.request({ ..., 'signing-format': 'ans104' })
```

Measured effect of flipping that one field: `[V]`

| Node | format | result |
|---|---|---|
| jonny-ringo.xyz | ans104 | 400 (empty body) |
| jonny-ringo.xyz | httpsig | 500 `process_has_no_signers` |
| alpha.neo.zephyrdev.xyz | ans104 | 500 `scheduler_timeout` |
| alpha.neo.zephyrdev.xyz | httpsig | 500 `process_has_no_signers` |

**A genesis-wasm spawn is verified working** on `https://jonny-ringo.xyz`: process
id `LHOIiQfAFbV2Xu5fDbwUHezMGwyuUaSN8GmNkiNi9iM`, 886 ms, zero-AR throwaway JWK,
using `execution-device=genesis-wasm@1.0` with `module=<txid>`. `[V]`
Native `lua@5.3a` with an **inline** module body still returns a bare 400 — that
specific combination is unresolved. `[?]`

### Node quality is not uniform — this matters more than it sounds

- `jonny-ringo.xyz` is the **only** public node verified to do the full
  spawn -> write -> read loop. `[V]`
- `schedule.forward.computer` 504s at exactly 60s on `/now` and `/compute`. `[V]`
- `hb.arweave.net` 502s after 50s on genesis-wasm processes; it is a
  scheduler/gateway, not a compute node. `[V]`

Treat failures on the latter two as node problems, not client problems.

### The original symptom, kept for searchability

With `signing-format: httpsig`, the POST carries `content-digest` and
`inline-body-key` headers but `body: undefined`, and the node throws
`{process_has_no_signers, ...}` at `lib_process.erl:33` via `dev_scheduler.erl:400`
and `dev_push.erl:786`.

`@permaweb/aoconnect@0.0.98` in `MODE: 'mainnet'` emits a request that advertises
a body it never sends. Intercepting `globalThis.fetch` shows:

```
POST https://<node>/push
  content-digest: sha-256=:6wRdeNJzEHNIsDAMAdKbdVLWIqu8b6-Bs-xVNZqplQw:
  inline-body-key: module
  signing-format: httpsig
  Signature: http-sig-...=:EqG5n4lPmEiG...
  Signature-Input: ("authority" "content-digest" "device" "execution-device"
                    "inline-body-key" "push-device" "random-seed" "scheduler"
                    "scheduler-device" "signing-format" "type");alg="rsa-pss-sha512"
  body: undefined          <-- the bug
```

The node cannot verify a `content-digest` for a body that never arrived, so it
discards the commitment and the process message lands with no signers:

```
Error details: {process_has_no_signers, ...}
  lib_process.erl:33 -> dev_scheduler.erl:400 -> dev_push.erl:786
```

### Scope of the failure

- Reproduced on **6 nodes**: alpha.neo, charlie.neo2, arweave.net, hb.arweave.net,
  schedule.forward.computer, jonny-ringo.xyz.
- Reproduced across **11 parameter shapes**: nested `module`, flat `body`, `data`,
  `script`, string / Buffer / Uint8Array bodies, explicit `inline-body-key`.
- **Also breaks aoconnect's own `spawn()`**, so it is not specific to native Lua
  or to hand-built `request()` params.
- `init.body` is literally `undefined` in every case, never an empty or stream body.

Reattaching the raw Lua source at the fetch layer does **not** work: the digest is
not over the raw module text but over some structured encoding of the message, so
a fix means reproducing aoconnect's httpsig encoder, not just restoring a string.

### What this does and does not block

- **Blocked:** creating processes, and any signed write.
- **Not blocked:** stateless Lua compute (`POST /~lua@5.3a/<fn>`), all HTTP reads,
  `~patch@1.0` state reads, and the entire `store.lua` test suite. Development of
  process logic can continue without solving this.

### Candidate routes out, cheapest first

1. **Patch or fork aoconnect.** The defect is narrow — one encoder path that
   computes a digest and drops the body. Likely a small diff.
2. **Use a client that demonstrably works in production.** Bazar has dropped
   aoconnect for a vendored `ao-wrangler`, and PermawebOS ships `window.aoFetch`.
   Both are known to talk to these nodes successfully. Extract or reuse.
3. **Hand-roll the RFC-9421 signing** against HyperBEAM's structured encoding.
   Most control, most work.
4. **Create processes from your own node** via the Erlang API (`hb_message:commit`),
   sidestepping the JS client for spawns only.

---

## 15. Does anything cost money? (No, and it is not why writes fail)

Checked on alpha.neo, arweave.net and schedule.forward.computer. `[V]`

- None of the three has any pricing, payment, ledger, `p4` or `simple-pay` config
  key in `/~meta@1.0/info`.
- `/~simple-pay@1.0/balance` returns **0** for our test wallet on all three, and
  arbitrary Lua still executes fine. A zero balance gates nothing.
- Arbitrary Lua runs **unsigned, with no wallet at all**. See §1.

A payment failure looks completely different from an encoding failure. When a node
does charge, `dev_p4.erl:131` raises `{insufficient_funds, ...}` and the response
body is the literal string `Insufficient funds` (see `hb_examples.erl:47`,
`dev_router.erl:1229`). The process-creation blocker in §14 is
`{process_has_no_signers, ...}` thrown from the **scheduler**, a different
subsystem entirely.

**Funding a wallet will not fix §14.** It is a client-side signing/encoding bug.

Caveat: nodes may start charging at any time, and a node that refuses to serve you
at any price returns `price: infinity` (`dev_p4.erl:80`). Re-check before assuming
free compute in future.

---

## 16. Two real costs of the native `~lua@5.3a` path

Both found by running code, and both matter if you are choosing between native Lua
and `genesis-wasm@1.0`.

### bint hangs under Luerl `[V]`

Luerl's `-1 >> 16` returns `-1` instead of shifting, so bint's
`luainteger_bitsize()` never terminates. `BINT(64)`, `BINT(128)` and `BINT(256)`
all hung and had to be killed at 60/60/90s.

**Blast radius in Dumverse is small.** `bint` is used in exactly one file,
`backend/src/tokens/dumz.tl` (the DUMZ token). The game, combat, bank and chat
processes never touch it. Port DUMZ against `scripts/hyper-token.lua` in the
HyperBEAM repo — a native token implementation for the Lua device — rather than
trying to carry bint across.

### Cron is not usable as-is `[V]`

- `Cron-Interval` appears **zero times** in the 3.25 MB legacy aos module. Legacy
  cron ticks were synthesized by the legacy CU, not by the process. They do not
  come along with the code.
- `~cron@1.0` resolves 200, but `dev_cron.erl` is a bare `spawn/1` plus
  `hb_name:register`: **in-memory, dies on node restart**. Worse,
  `POST /~cron@1.0/every` was **unauthenticated on all three nodes probed**, so
  anyone can `stop` your ticker.

**Dumverse depends on this for the core loop:** `combat/main.tl:541` runs
`CronTick(msg, 30)` for NPC attacks and battle timeouts, and
`blackjack/main.tl:503` settles hands on `Action=Cron`. Combat and blackjack are
the game.

This is currently the strongest argument for running your own node: a scheduled
ticker that survives restarts and that strangers cannot stop is not something a
public node will give you today. Until then, an external heartbeat that pushes a
`Cron` message on a timer is the honest workaround.

---

## 17. Recovering state from an evicted legacynet process

The old processes are allowlisted out at both CU and SU (section 11), so their live
state cannot be queried. **The public Arweave checkpoints are still readable by
plain GET** and carve out as valid SQLite. `[V]`

Recovered for Dumverse, both passing `pragma integrity_check`:

| | game checkpoint | bank checkpoint |
|---|---|---|
| Users | 400 | - |
| Inventory | 1,720 | - |
| Leaderboard | 68 | - |
| Bank | 312 | **395** |
| BankTransactions | 12,549 | **40,932** |

Checkpoints are from different moments and **neither is complete** - the bank one
has newer Bank rows but no Users at all. Take each table from whichever checkpoint
is authoritative for it and expect referential gaps: 24 Bank rows, 13 Inventory
rows and 6 Leaderboard rows point at users absent from the Users table.
`migrate.py` reports these rather than dropping them silently.

`backend/native/migrate.py` converts the checkpoints into a `store.lua` snapshot
(`snapshot.lua`, 0.47 MB for the whole game). BankTransactions is excluded by
default: ~41k audit rows would dominate process state for no gameplay benefit.

### Verified live, end to end `[V]`

Recovered state restored into `store.lua` and queried on a live public node:

```
restore + index rebuild: 0.054s
Users=400  Inventory=1720  Leaderboard=68  Bank=395
Users wallet totals: gold=324719 dumz=310780
Bank totals: gold=1571606 dumz=778930
2000 lookups by wallet on REAL data: 0.0450s (hits=2000)
sample player: id=1 name=AAshu1412 gold=2550 -> after +500 -> 3050
  inventory rows: 7   bank: gold=642160 dumz=100295
```

Totals match the source SQLite exactly. **Rehydrating a full game's state costs
54 ms**, which settles the snapshot-scaling worry from section 13 for a player base
this size. The whole payload including the AOS shim, the store and the data is
586 KB in one message.

One caveat: `float` columns in SQLite come back as floats, and Luerl distinguishes
integer from float. `migrate.py` narrows anything exactly integral, which matters
because of the `%g` bug in section 4.

---

## 18. CORRECTION to section 14: httpsig works. Three details make or break it.

Section 14 blamed the signing format and suggested ans104. **That was wrong.**
A from-scratch client using plain httpsig spawns a native `lua@5.3a` process with
an inline module and it computes. `[V]` `signing-format` appears **nowhere** in
HyperBEAM - it is an aoconnect-internal notion.

The three real causes, each verified live:

1. **The signature label must start `comm-`.** `dev_httpsig_siginfo.erl:195`
   pattern-matches `<<"comm-", Rest/binary>>` on the header value; anything else
   hits the catch-all at `:232`, which returns `#{}` - no commitments, **silently,
   with no error**. aoconnect sends `http-sig-...`. That alone is
   `process_has_no_signers`. Label = `"comm-" + lowercase(base64url(sha256(sig)))`.
2. **keyid needs a `publickey:` prefix**, payload being the raw RSA **modulus** in
   *standard padded* base64. `keyid_to_committer/1` calls `find_scheme` with an
   empty request (`dev_httpsig_keyid.erl:122`); no prefix means no scheme, no
   committer, and empty signers even when a commitment parsed fine.
3. **`inline-body-key` does not exist.** Zero hits tree-wide. The real key is
   `ao-body-key` (`dev_httpsig_conv.erl:720`). aoconnect sets a header nothing
   reads, sends no body, and signs a `content-digest` that cannot verify.

Other traps:

- **Component order** in the signature base is re-derived server-side as sorted
  keys, not the order in your `Signature-Input`.
- **`authority`, `method`, `path`, `scheme`, `query`** and friends get `@`
  prepended in `@signature-params` but not in the component line or on the wire.
  Simplest fix: never use those names as ordinary fields.
- **`subject: self` is required** on both process creation and messages. Without
  it, `find_message_to_schedule` (`dev_scheduler.erl:1355`) grabs the request body
  as the thing to schedule, so a Process carrying inline Lua tries to schedule
  *the Lua source*, which has no signers. Symptom is a bare 400 `Message is not valid.`
- **Process creation posts to `/schedule`**, not `/push`.
- `scheduler_timeout` is node health, not message format. alpha.neo returns it for
  shapes that succeed on jonny-ringo.
- A `module` submessage `{content-type, body}` still fails round-trip. `[?]`
  Workarounds all verified: inline `content-type: application/lua` + `body`, or
  `module: <txid>`, or a module over 4096 bytes.

Client: `backend/native/hb.mjs` (~180 lines, no dependencies).

### Verified end to end `[V]`

`backend/native/spawn-demo.mjs` spawns a real Dumverse-shaped process carrying
`store.lua`, then drives it through nine scheduled messages:

```
spawn -> 200 pid= sqy19ol1YZrtz8dX7EqHfjIPQP5ReKejq9-DXTE8UQk slot= 0
users=2 inventory=2
ADDR_A after two purchases: id=1 name=Sup-Dumz gold=40.0 spot=0
ADDR_B (untouched)        : id=2 name=CryptoCherie gold=100 spot=0
```

100 starting gold minus two 30-gold purchases leaves 40, state persists across
messages, and the untouched player is unaffected.

### The message you send arrives at `req.body`, not `req`

`req` is the **Assignment** (`type=Assignment`, with `slot`, `timestamp`,
`block-height`, `process`, `commitments`). Your actual message is `req.body`.
Reading `req.action` silently yields nothing.

### `tonumber` returns a FLOAT in Luerl `[V]`

```
tonumber("30")            -> 30.0   math.type=float    (PUC Lua: integer)
100 - tonumber("30")      -> 70.0   float
math.tointeger(tonumber("30")) -> 30 integer
tonumber("30") | 0        -> 30     integer
```

**Every message tag arrives as a string**, so every `tonumber` on a tag silently
turns currency into floats, which then hit the `%g` bug in section 4 and serialize
as `30.00000000000`. This is exactly how `gold=40.0` appeared above. Wrap every
tag-to-number conversion: `math.tointeger(tonumber(x))` or `tonumber(x) | 0`.

---

## 19. Browser writes: ANS-104 and composed push

### The architecture (settled)

The backend and the frontend sign **differently**, and they have to:

| | signs with | used for |
|---|---|---|
| Backend / deploy (Node, raw JWK) | **httpsig** via `hbclient.mjs` | spawning processes, admin messages |
| Frontend (browser, wallet) | **ANS-104** via `signDataItem` | player messages only |

**A browser cannot produce an httpsig signature.** `[V]` The wallet's `signMessage`
is RSA-PSS with `saltLength: 32` over an already-hashed digest — WebCrypto hashes
again, making it a *double* hash. HyperBEAM's `dev_httpsig:verify` accepts only
single-hash `rsa-pss-sha512`. No wallet exposes "sign exactly these bytes", so the
`comm-` label of section 18 is unreachable from a page. ANS-104 is the only option.

Good news for the port: **that is what Dumverse already does.**
`createDataItemSigner(window.arweaveWallet)` calls the same `signDataItem`.

Also established:
- `window.aoFetch` is a **fetch proxy, not a signer** — it never touches a key. `[V]`
- It is **not required**: nodes send `access-control-allow-origin: *` and answer
  OPTIONS `/schedule` with 204, so plain `fetch` works. `[V]`
- **An ordinary Wander wallet suffices**; PermawebOS only adds peer fan-out and
  caching. `[V]`
- **ANS-104 cannot spawn a working Lua process** — the spawn is accepted (200,
  slot 0) but every later `/now/*` read 504s forever. Spawn on the backend with
  httpsig; the frontend only ever needs `sendMessage`. `[V]`

### RESOLVED: it was a duplicate tag, not the nodes `[V]`

Earlier revisions of this section blamed node instability. **That was wrong.**

`sendMessage` added `action` as a tag *and* spread the caller's `tags` object, so
the natural-looking call `sendMessage({ action, tags: { action } })` emitted the
`action` tag **twice**. A repeated tag name makes the whole ANS-104 data item
invalid, and the node answers:

```
400 Message is not valid.
```

with no indication which tag caused it. The identical failure appears whether you
sign with a throwaway JWK or a real wallet extension, which is what made it look
environmental.

Proved by A/B on one freshly spawned process, seconds apart:

```
RAW item (no duplicate)   -> 200 slot=1   count 1
hbbrowser.sendMessage     -> 400 Message is not valid.
```

and after deduplicating tags in the client:

```
duplicate action (was fatal)   OK slot=4   count=4
tags override action           OK slot=5   count=5
normal usage                   OK slot=6   count=6
```

**The browser write path works.** `src/lib/hyperbeam/browser.mjs` now builds tags
through a `Map`, so a repeated name is impossible and later entries win, letting
callers override any default.

### POST `/push` is the interactive fast path `[V]`

**Added 2026-09-03 and verified on the local node with both signature formats.**
The lower-level write path used by `src/lib/hyperbeam.ts` is valid but not the
only path:

```
POST /<pid>~process@1.0/schedule?codec-device=ans104@1.0
GET  /<pid>~process@1.0/compute&slot=N/results/output/data
```

HyperBEAM also composes admission, ordered computation, outbox delivery and the
correlated reply into one request:

```
POST /<pid>~process@1.0/push?codec-device=ans104@1.0   # browser
POST /<pid>~process@1.0/push                           # httpsig backend
```

On a fresh TEST-HyperDB process, an httpsig push returned the assigned slot and
the correct mutation receipt in 120 ms. A browser-equivalent ANS-104 push did
the same in 93 ms. The process scheduler head advanced by exactly one in each
case. Under 16 concurrent ANS-104 writers, four shards completed the same
32,000-update workload in 3.60 s through composed push versus 3.91 s through
schedule + compute, while removing one HTTP request from every interaction.

Do not confuse that POST with `GET /<pid>~process@1.0/push&slot=N`, which walks
the outbox of an already-computed slot. Calling the GET after a successful POST
repeats delivery work and is both slower and unsafe for a non-idempotent
downstream contract.

The official `permaweb/httpsig-examples` uses POST `/process-id/push`; the
behavior above was reproduced rather than inferred from it. The runnable
contract, browser-codec benchmark, split-path control and full measurements are
in `backend/native/hyperdb/`.

### Debugging note for next time

`400 Message is not valid.` from `dev_scheduler` is emitted for at least two
unrelated causes, and it names neither:

1. a **duplicate tag name** in an ANS-104 item (this bug);
2. a missing `subject: self` on an httpsig message, where the scheduler then tries
   to schedule the request body instead (section 18).

When you hit it, first send the simplest possible item that could work and add
fields back one at a time. Assuming the node is at fault costs hours.

---

## 20. Cron is not needed: settle ticks lazily instead

Section 16 called cron the strongest argument for running your own node. That
turned out to be avoidable, and the alternative is better than cron was.

The problem: combat drove NPC attacks from a `Cron` message every 10-30s.
`Cron-Interval` exists nowhere in the legacy module (legacynet's CU synthesised
those ticks), and `~cron@1.0` is an in-memory `spawn` that dies with the node
and that anyone can stop, since the endpoint is unauthenticated.

The fix is to make ticks **lazy**. Each battle records when every NPC last
swung, and any interaction settles whatever should have happened since:

```lua
local due = math.floor((timestamp - last) / NPC_ATTACK_INTERVAL_MS)
if due > 10 then due = 10 end   -- cap the catch-up
```

The client already polls `Battle.Info` at 1 Hz, so a battle being watched is a
battle being advanced, and an idle battle costs nothing.

Three reasons this beats cron here, beyond dodging the broken device:

1. **No external heartbeat to babysit.** Nothing to restart, nothing to secure.
2. **Deterministic.** Time comes from the message's own assignment timestamp,
   never a clock read, so replaying the log reproduces the same battles. A
   wall-clock tick would not — and HyperBEAM recomputes state by replaying.
3. **No idle work.** Cron ticks every battle forever; this ticks only what
   someone is looking at.

The catch-up cap matters: without it, a battle left alone for an hour would
resolve 120 rounds inside a single message and blow the compute budget.

**If you do need real scheduled work later** (daily resets, say), an external
heartbeat pushing a message on a timer is the honest answer, and it is yours to
run. But the core loop does not need one.

## 21. Combat shape, and measured latency

Deployed as a manager plus a fleet of shards, mirroring the old
combat/combat2..combat5 split. The reasoning is stronger here than it was
before: a HyperBEAM process computes messages in order, so every battle on one
process shares a single queue. **Sharding is the concurrency answer, not just a
capacity one.**

```
battle-manager   routes players, tracks load, owns no battles itself
     |
     +-- shard 1..N   independent, swappable, each owns its battles
```

The manager stays deliberately small so it never becomes the bottleneck it
exists to prevent. Shards register at runtime, so replacing one is: drain it,
let its battles end, register the replacement. No redeploy of anything else.

Measured on jonny-ringo.xyz, round trip meaning signed write plus the read that
returns the result:

| | |
|---|---|
| Manager spawn | 1.5s |
| Shard spawn | 0.6-1.1s |
| `Manager.FindBattle` | 660-1350ms |
| Battle action (join, ready, attack) | **610-750ms** |

Routing verified: three players spread across two shards by load, sticky on
re-entry, and draining a shard excludes it from new assignments without
touching the battles already on it.

## 22. Measured concurrency, and the one result that matters

`backend/native/bench-concurrency.mjs`, against jonny-ringo.xyz.

### Sharding works, and here is the proof

| | writes/sec |
|---|---|
| 1 shard, 4 concurrent | 5.0 |
| 1 shard, 8 concurrent | 9.1 |
| 1 shard, 16 concurrent | 10.3 |
| **2 shards, 16 concurrent** | **14.9** |

One shard saturates around **10 writes/sec** no matter how much you throw at it,
which is what you would expect from a single in-order message queue. Adding one
shard lifted the same 16-way load to 14.9/sec. Sharding is doing real work, not
just spreading files around.

### The result that actually matters: writes starve reads

Two batches of concurrent reads, back to back:

```
10 concurrent reads, immediately after 32 writes:  p50 18318ms   1 read/sec
30 concurrent reads, once the node caught up   :  p50   694ms  38 reads/sec
```

Same reads, same node, ~20x apart. **A read is only fast when the node is not
computing a write backlog**, because `/now` has to bring state up to the latest
slot before it can answer.

This is the thing to design around, and it lands directly on combat: the client
polls `Battle.Info` at 1 Hz, so exactly when a fight is busiest — most writes —
the poll that renders it is slowest. Three mitigations, in order of leverage:

1. **More shards.** Fewer writes per queue means shorter backlogs. This is the
   main lever and it is why the fleet is configurable.
2. **Back off the poll under load.** A client seeing slow reads should poll less
   often, not retry harder, or it deepens the hole it is in.
3. **Read an older slot.** `/now` insists on the latest state; a battle view one
   slot stale is usually fine and much cheaper.

Steady-state numbers are comfortable — 38 reads/sec and ~600ms battle actions —
so this is a load-shape problem, not a throughput wall.
