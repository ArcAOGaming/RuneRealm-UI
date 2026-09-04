# Where we do not follow the process-shape rules

The rules are in [CLAUDE.md](../../CLAUDE.md) ("Process shape is decided by
three measured numbers"); the measurements behind them are in
[BATTLE_FLEET.md](BATTLE_FLEET.md). This is the audit against them, done
2026-08-30. Every hop count below was read out of the handlers, not estimated.

Prices, for reading the list: a message is **~100 ms**, an extra cross-process
hop is **~160 ms**, and compute is **231 us** and therefore never the reason for
anything.

---

## 1. The battle fleet costs six hops per battle, not two

**Rule:** "exactly two authority boundaries: reserve in, settle out."
**Actual:** six, on the happy path.

| # | message | direction | source |
|---|---|---|---|
| 1 | `Battle.Open` | game -> worker | `game.lua:2695` |
| 2 | `Battle.Fleet.Opened` | worker -> game | `worker.lua:546`, `:655` |
| 3 | `Battle.Fleet.Settle` | worker -> game | `worker.lua:476` |
| 4 | `Fleet.Settlement.Ack` | game -> worker | `authority.lua:186` |
| 5 | `Battle.Fleet.FinalAcked` | worker -> game | `worker.lua:592` |
| 6 | `Fleet.FinalAcked.Release` | game -> worker | `authority.lua:239`, `:260` |

Six hops is **~960 ms** of hop cost per bot battle, against **zero** on the
monolith path the game uses today. Amortised over a five-round battle that is
~190 ms per player action, not the ~64 ms the rule's table implies.

**This is not a bug.** Hops 3-6 are the exactly-once settlement handshake, and
they are what stop a lost or duplicated settlement from paying a player twice;
they also run *after* the battle ends, so they are off the player's critical
path even though the node still does the work. The two on the critical path are
1 and 2.

**RESOLVED: accepted, deliberately.** ~1 s of hop cost per battle is worth not
serialising battles behind the account authority. The rule is amended rather
than the protocol: **two boundaries on the critical path, plus whatever an
exactly-once settlement costs, counted separately.** Hops 1-2 are the critical
path; 3-6 are the settlement handshake and run after the player is done.

Still worth doing later, and cheap: ack and release could ride on the next
message to that worker instead of each taking a hop of their own, which would
take a battle from six hops to four without changing a single guarantee.

**Not yet live:** the game publishes
`battlefleet = {"enabled":false,"workers":[]}`, so battles run in the monolith
until `configure:battle-fleet` seals a manifest.

## 2. The default fleet is half Rust

**Rule:** "Keep `battle-fleet-rust/` as a working second implementation and do
not seal it into the fleet."
**Actual:** `battleWorkerSpecs` defaults `BATTLE_FLEET_RUST` to **2**
(`runtime.mjs:23`), and `manifest.local.json` carries two `rust-wasm@1` workers
at `lifecycle: ready`.

A Rust worker is **20 ms a slot against Lua's 5 ms**. Sealing that manifest puts
half of every player's battles on the slower runtime.

**FIXED.** `runtime.mjs` now defaults to `BATTLE_FLEET_LUA=3`,
`BATTLE_FLEET_RUST=0`; a deploy that does not explicitly ask for Rust does not
get it, and does not even need an image id. The Rust worker stays in the tree as
a working second implementation of the protocol and as the A/B arm. Covered by
`mixed-runtime-contract.test.mjs`, "the default plan is three Lua workers and no
Rust".

## 3. Hunt is split, and it earns it -- but nobody has counted its actions

**Rule:** fan out only when the session has enough direct actions to amortise
the hops.
**Actual:** hunt is its own process (`deploy-hunt.mjs`) and its shape is right:
the client talks straight to it for `Hunt.Search`, `Hunt.Attack`,
`Hunt.Decline`, `Hunt.Capture`, `Hunt.End`, with the game involved only at the
boundaries. Hops are `Hunt.Open` in, then `Hunt.Opened`, `Hunt.Settle`,
`Hunt.Settled` (ack) and `Hunt.Released` -- about four to five.

That is ~700 ms of hop cost per run. Whether it is worth it depends entirely on
how many direct actions a typical run has, **which has never been measured**. At
two attacks it is a bad trade; at ten it is a good one. Measure it before adding
another domain on this template.

**CHANGED: hunt is now a three-process fleet**, for the same reason battles are.
Runs are independent of each other, so serialising them behind one process buys
nothing.

The client needed no change at all: `HuntRoute` already carried `processId` and
`node` per run, so the split was wiring, not redesign. What changed in
`game.lua`:

- `HuntProcesses` holds the fleet; `HuntProcess`/`HuntNode` stay as its first
  entry so single-process deployments and existing exports keep working;
- `Hunt.Begin` assigns a worker by run sequence -- deterministic, so a replayed
  begin lands on the same worker instead of opening a second run elsewhere;
- that existing `Hunt.Open` boundary now carries the compact effective
  catchable Monster Index pool once per run. The worker can weight encounters but
  cannot invent or re-enable an entry; this adds no hop and keeps mutable
  release policy at the game authority;
- discoveries accumulate inside the worker and return on the existing
  `Hunt.Settle`/`Hunt.Released` boundaries. Recording every sighting therefore
  adds no per-search cross-process message;
- `huntMessage` targets **the run's** worker, not the global. Without this the
  fleet would exist and every player would still be routed to worker one;
- `Hunt.Opened`, `Hunt.Released` and `Hunt.Settle` require the sender to be the
  worker that run was assigned to. Fleet membership is not enough: every worker
  is a separate public process, so without the binding worker 2 could claim
  worker 1's capture or release a companion mid-roll.

`deploy-hunt.mjs` spawns `HUNT_FLEET_SIZE` (default 3) and registers them in one
`Admin.SetHuntProcess` call, then verifies the game published exactly that
fleet. Covered by `game_hunt_test.lua`: assignment spreads across all three, and
a peer can neither advance nor settle a run it was not given.

## 4. Reads: clean, no findings

Everything reads published state: `readJSON`/`readState` hit
`/<pid>~process@1.0/now/<key>` and nothing schedules a message to ask a
question (`hyperbeam.ts:179-198`, `game.ts:161-706`). The leaderboard is a
single authority key (`game.ts:222`), never sharded. Outbox pushes fire only for
`OUTBOX_ACTIONS` (`hyperbeam.ts:632`), so ordinary writes do not pay for a walk
of an outbox they cannot produce. No changes needed.

## 5. The marketplace cluster: folding in, and what stays out

**DONE.** The companion market and the new Gold goods order book, escrow,
finite NPC desks, supply ledgers, and policy controls all live in `game.lua` --
`Market.List`, `Market.Buy`, `Market.Cancel` over `Market`/`MarketHistory`,
priced in in-game Rune, with the listing itself acting as custody so a sale is
one atomic action.

`marketplace.lua` is a different thing: a curated *index* of one-unit
`token@1.0` companion assets that settle in native AR on the asset process. Its
own header says it "does not pretend to custody an L1 asset". With monsters no
longer minted as those assets it indexes nothing, the client never called it
(no `Market.Listings`, `Market.Assets` or `Listing.Create` anywhere in `src/`),
and the game never messaged it -- so it cost zero hops and folding it would have
saved none.

**It is no longer deployed.** The file and suite remain parked source outside
normal deployment/preflight; there is a TODO in MARKETPLACE.md to revisit it
only if monster minting is re-enabled. Nothing here is waiting on that: a
companion sale is already one atomic action in the authority.

Kept: `rune.lua`, `quote.lua` and `amm.lua`. Those are the exchange, not the
market, and their tokens have holders outside the game.

**Staying separate, correctly:** `rune.lua` and `quote.lua` are their own
tokens, and `amm.lua` is a market between them. Tokens have holders outside this
game and must be independently addressable, so they are not ours to condense --
this is a case where the hop cost is simply the price of the domain being real.

A companion sale is now zero hops: one action inside the authority. The hops
that remain are the Rune deposit/withdraw saga against the token processes,
which is still unmeasured and is the next thing to count.

## Published-state size — the other axis, and the one that was degrading

Hops are not the only thing a slot is charged for. HyperBEAM's `dev_lua:compute/4`
loads, encodes, Luerl-decodes, decodes back and rewrites the **whole published
map** on every message, whatever the message did — five full passes over
everything the process has ever published. See the "Every message pays for all
published state" rule in `CLAUDE.md` for the source-level walkthrough.

That makes any key that grows with the player count a tax on every action by
every player. The 2026-08-31 soak measured it: median successful action 7.6 s
early in the run, 18.5 s by the end of 5,061 actions.

**Measured on the live process** (`IAPvo71Vwa…`, 29 wallets, 332 KB total):

| key | bytes | shape |
|---|---|---|
| `player-<address>` × 29 | 202,000 | **O(wallets)** — ~7.0 KB each, never evicted |
| `leaderboard` | 61,127 | O(1), capped at 50 rows, but each row embedded a whole companion |
| `markethistory` | 20,026 | O(1), trimmed to 100 on insert — correct already |
| `battle` | 16,955 | O(1) |
| `economy` | 14,418 | O(1) |
| `player` (singleton) | 10,149 | a second full copy of a record nothing read |
| `factions` | 7,750 | O(1), capped at 50 members |

### Fixed

- **Compact moves on every outward door.** Companions were stored compactly and
  re-expanded in `playerView`, `leaderboard`, listings, hunt captures. 499 bytes
  of every 1,007-byte companion were a verbatim copy of `C.MOVE_POOLS`. The pool
  is now published once as `catalog.movePools` and `src/lib/game.ts` joins names
  against it at the read boundary. The mint queue is the one deliberate
  exception — an off-process card worker with no catalog to join against, and it
  drains, so it is O(mints in flight).
- **The `player` singleton is no longer written.** It held whichever wallet the
  process computed last; `readAuthorityPlayer` reads `player-<address>` and
  nothing reads the singleton. `playerid` stays — 43 bytes, and it is what the
  admin-target regression is asserted against.

Result, measured against that same live snapshot: **6,965 B → 4,691 B per
wallet (33% off the growing part)**, 332 KB → 236 KB total (29%).

### Known and NOT fixed

- **`monster` mirrors `monsters[activeId]` in every published record.** In the
  store they are the same Lua table; the JSON encoder does not know that and
  writes it twice. ~530 B per record after the move fix — 8%. `activeId` is
  published beside it, so a client could index one by the other, but `.monster`
  has 75 readers in `src/` and 166 assertions in `game_test.lua`. Deferred
  deliberately, not overlooked.
- **`player-<address>` is still unbounded and still the slope.** Nothing evicts
  a wallet that stopped playing, and no byte-shaving changes the shape of the
  curve — at 4.7 KB a wallet, 500 wallets is 2.3 MB marshalled five times per
  message. Eviction needs a policy decision first, because a cold wallet that
  loses its key can no longer read its own account without signing, which is the
  exact wallet prompt the addressed key was introduced to remove.
- **`leaderboard` rows still embed a whole companion** (~700 B each after the
  move fix, 50 rows). The client draws the full card from them; dropping it
  means either a smaller card or 50 extra reads to draw one screen.

Adding a published key that grows with the player count belongs in this list the
same way a cross-process message does.
