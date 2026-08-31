# RuneRealm Rust battle worker

This crate is a host-testable Rust `cdylib` implementation of the Phase-1 bot
battle worker protocol. It does not replace or alter the Lua deployment path.

The immutable process configuration is read from the first call's AO
environment. The environment must contain `Process.Tags` (an AO tag array or
object; matching is case-insensitive because JSON-Iface header-cases tags) with:

- `battle-protocol=runerealm-battle-fleet/1`
- `battle-runtime=rust-wasm@1`
- `battle-abi=hyperbeam-json-iface-cstr/1`
- `battle-clock-mode=trusted-game-clock-v1`
- `battle-enabled`
- `battle-game-process`
- `battle-worker-id`
- `battle-worker-capacity`
- `battle-worker-retained`
- `battle-worker-pending`
- `battle-worker-ticket-ttl`
- `battle-worker-outcomes`
- `battle-worker-confirmations`

`Owner`, the scheduler, and the executable image bind the immutable identity.
Only `Owner` is a top-level field of the Process struct JSON-Iface builds: its
nine keys are `Id`, `Anchor`, `Owner`, `From`, `Tags`, `Target`, `Data`,
`Signature`, `PublicKey`, and everything else on the process message —
`scheduler-location`, `scheduler`, `image` included — is flattened into `Tags`
in HTTP header case. The worker reads the field first and the tag second, so
both a hand-built environment and a real node work. Reading only the field is
what made the first live worker answer
`{"error":"Process scheduler is required"}` before a single battle ran.
Game-origin actions require both `Message.Owner == Process.scheduler` and
`Message.From == battle-game-process`; this rejects a forged `from-process`
claim. Direct attacks require `Message.Owner` to equal the reserved player, and
owner operations require `Message.Owner == Process.Owner`.

JSON-Iface does not expose the assignment timestamp. Therefore every
scheduler-attested game action must carry an integer `Authority-Timestamp` tag.
The worker maintains its clock as the monotonic maximum of those trusted game
timestamps; player and public reads never advance it. `Battle.Open` additionally
requires the trusted timestamp to equal `issuedAt`.

## ABI

The module exports:

```text
malloc(size: usize) -> *mut u8
handle(message_ptr, env_ptr) -> *const u8
free(ptr)
```

Both inputs and the response are NUL-terminated UTF-8 JSON, matching the
working FORMIX/HyperBEAM JSON-Iface ABI. `handle` consumes both input buffers
when they came from this module's `malloc`; callers must not free them again.
(Foreign pointers used by native tests are copied and left alone.) JSON-Iface
does not free the returned response pointer, so the worker reclaims its previous
response at the start of the next `handle` call, bounding ABI-owned memory to
the current result. Calling `free` on the current response is also supported by
host tests.

Every successful ABI call returns the shape:

```json
{"ok":true,"response":{"Output":{"data":"{}"},"Messages":[],"Spawns":[],"patches":[]}}
```

Handler failures are serialized protocol replies in `Output.data`, so malformed
or unauthorized messages cannot trap the process.

The state publish is the **last entry of `Messages`**, tagged for `patch@1.0`:

```json
{"Tags":[{"name":"method","value":"PATCH"},{"name":"fleetstatus","value":"<json>"}]}
```

It goes in the outbox, not in `patches`, because `dev_json_iface` builds
`results/outbox` as a numbered map and leaves `results/patches` a list, and
`dev_patch:move/4` folds its source with `maps:fold/3` — a list of any length
crashes it. It goes last because `dev_patch` removes the entries it consumes and
keeps the rest under their original keys, so a patch at key 1 would leave the
real outbox numbered from 2. The same object carries the touched `battle-<id>`
tags, and removal uses the `patch@1.0` sentinel `__ao-unset__`. The `patches`
array is still emitted for a node configured to read it. AO messages use
`Target`, `Data`, and standard AO tag arrays.

## Offline validation

The pinned `serde`/`serde_json` versions are present in this repository's build
environment cache:

```powershell
cargo test --offline --manifest-path backend/native/battle-fleet-rust/Cargo.toml
cargo clippy --offline --manifest-path backend/native/battle-fleet-rust/Cargo.toml --all-targets -- -D warnings
```

Build and ABI verification are wired through `build.mjs`, and the mixed-fleet
deployer in `../battle-fleet/deploy-workers.mjs` creates two Lua workers and two
Rust workers by default. The build requires the `wasm32-unknown-unknown` Rust
target and `wasm-tools` (pin `1.246.2 --locked` against the audited rustc 1.83;
1.258 requires rustc 1.85). It emits the canonicalized image at
`dist/runerealm-battle-worker.wasm`.

The image id is **not** the file's Arweave transaction id, though that is the
obvious guess and it half works. `dev_wasm:init/3` resolves `image` with
`hb_cache:read(Id)` and reads the `body` key of the result; a transaction the
node fetched through `hb_store_gateway` decodes with its payload under `data`,
so the read succeeds, `body` is `not_found`, and the process dies in
`hb_beamr:start(not_found, wasm)` with a bare `function_clause`. Measured on
`hyperbeam.tylerw.ai` for this module and for the aos module
`Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM` alike: `/<id>/data` serves the
bytes, `/<id>/body` 404s.

`deploy:battle-fleet` instead **schedules the module as a signed message**. A
message posted as `{ body: <bytes> }` is stored by the scheduler with its `body`
intact, which is the shape `dev_wasm` wants, and its id is content-addressed
like any other. The messages are parked on one holder process recorded in
`published.json`; nothing computes it, so the slots cost only storage.
`dev_wasm:cache_wasm_image/2` and `/~cache@1.0/write` produce the same shape and
are deliberately unused: both need the node's own `cache_writers` entry, and the
HTTP one answers 403 to everyone else.

```powershell
npm run build:battle-rust
npm run deploy:battle-fleet
```

To see the id before deploying, or to cache a new build deliberately:

```powershell
npm run publish:battle-image            # dry: prints the build's sha256 and ids
npm run publish:battle-image -- --post  # caches on the node if this build is new
npm run publish:battle-image -- --post --archive   # also publishes to Arweave
```

The Arweave copy is opt-in. It is the permanent, independently verifiable record
of exactly what the fleet runs, it is not the `image`, and no spawn depends on
it — so an iteration loop does not pay AR per rebuild for a copy nothing reads.

The deployer adds the immutable tags above, verifies the process's actual
image/device stack, and binds the cached image id, `abi`, and `clockMode` before
a Rust worker can enter the ready manifest.

## Device names are lowercase, byte for byte

The execution stack is `json-iface@1.0`, `wasm-64@1.0`, `multipass@1.0`, then
`patch@1.0`. Every name in a node's device registry is lowercase and matching is
exact, so `JSON-Iface@1.0` resolves to nothing and the process dies at init with

```
{error,{device_not_loadable,<<"JSON-Iface@1.0">>,<<"device-name-not-resolvable">>}}
```

which reads as "this node has no JSON interface" and is not that at all. This
cost two abandoned worker processes and a paragraph in BATTLE_FLEET.md asserting
a node capability that was there the whole time. `npm run probe:battle-devices`
settles it: a registered device answers `/~<name>/keys` with 200, an
unresolvable one answers that same 500.

The stack omits `wasi@1.0`, correctly — the module is self-contained with zero
imports. (That node does register `wasi@1.0`; the earlier reading that it did
not was the same casing bug.)

`npm run probe:battle-rust` spawns one throwaway worker and reports what it
published, which is the cheapest way to qualify a node before committing a fleet
to it.

## Known limitation

Without an execution timestamp from JSON-Iface, a previously unseen original
`Battle.Open` that is delayed in delivery cannot by itself prove it arrived after
`expiresAt`, because its trusted clock value is the original `issuedAt`.
Authority-driven expiry/cancellation and exact terminal settlement still prevent
economic replay, but deployment soak tests should explicitly exercise delayed
delivery before enabling Rust workers.

## Is it faster?

Natively, by about 100x. On the node, no — it loses by about 80 ms a slot,
because that node runs `wasm-allow-aot: false` and WAMR interprets the module
while Luerl is compiled Erlang on the BEAM. Two control modules pin this down:
a 275-byte WAT and a 360 KB WAT that both just return a constant cost the same
as each other and the same as a whole Lua slot, so neither the ABI nor the
module size is the gap.

The ceiling for fixing it is a tie, not a win: the per-slot floor is the device
stack (~57 ms) and the transport (~240 ms). See `BATTLE_FLEET.md`, "What has
actually been measured", for the table and for what enabling AOT would cost.
