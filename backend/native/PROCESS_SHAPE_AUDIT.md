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
