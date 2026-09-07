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

**LIVE from 2026-09-04.** Sealed into
`o_jsAb7YIdJvvWV8Cu3V0pa7QJU9IAteDU8dAP9w1ak` as three `lua@5.3a` workers
(`wOvfPH7n…`, `0o_CK0uE…`, `BigBDSmJ…`). Until then the game published
`battlefleet = {"enabled":false,"workers":[]}` and every arena battle ran in the
monolith.

Worth being precise about what that bought, because it is not latency. An
individual battle got SLOWER — six hops it did not pay before. What it removes
is serialisation, and the ceiling has moved since this table was written: the
scheduler's 2.7 assignments/s per process was an inline bundler upload and is
patched, so **compute is the constraint now**, and every uncomputed compute for
one process funnels through a single `dev_process_worker:compute_group/3`.
Concurrent arena battles queued behind each other on the authority.

The larger effect is the published map. A slot costs the size of the WHOLE
published map, five times over, whatever the handler did — so a battle round in
the monolith paid for every `player-<address>` key, which is O(wallets ever
seen). On a worker with bounded state it pays almost nothing. That is the same
reason hunt does not degrade with the player count and the arena did.

### 2026-09-08: measured on the live fleet, and hops 4-6 were never delivered

Node `hyperbeam.tylerw.ai` = **BOX B, 176.9.219.106** (i9-9900K, 8c/16t),
container `hyperbeam-prod`, game
`2xESlFS9AwACNgQQviiyp9krhhbr-d1gBLkVEkjMxow`, workers `JEQiNb0y…`,
`ay8fImI6…`, `HL1StM5U…`. Numbers are HyperBEAM's own `computed_slot` log over
the whole container lifetime, read at load average 9.82 / 13.68 / 8.01.

**`Battle.Attack` is already off the authority.** Not one `Battle.Attack` slot
has ever been computed by the game process on this deployment. All 92 of them
ran on the three workers:

| where | n | mean | p50 | p90 | max | published map |
|---|---:|---:|---:|---:|---:|---:|
| `Battle.Attack`, on workers | 92 | 37 ms | 28 ms | 70 ms | 100 ms | — |
| every worker action | 269 | 31 ms | 25 ms | 60 ms | 100 ms | 1.85 MB peak |
| every authority action | 2409 | 157 ms | 64 ms | 445 ms | 4372 ms | **4.83 MB** |

So a slot on a worker is **6.4x cheaper at p90** than a slot on the authority,
and the reason is the published map, exactly as the rule says: 1.85 MB against
4.83 MB, marshalled five times per slot whatever the handler did.

**But it is not a latency win, and the round trip says so.** Sign a mutation
and read the handler's own reply back, interleaved A/B/B/A, two independent
runs:

| run | load avg | authority p50 | worker p50 | ratio |
|---|---|---:|---:|---:|
| 1, n=8 per arm | 15.04 | 2096 ms | 1862 ms | 1.13x |
| 2, n=6 per arm | 7.21 | 2388 ms | 1934 ms | 1.23x |

~230-450 ms out of a ~2 s round trip. **Under the 3x believability floor.** The
125 ms of execution the move saves is real and it is ~10% of what the player
waits through; the rest is transport. The fleet remains what BATTLE_FLEET.md
already called it — insurance against serialisation, not a latency win.

**The defect: hops 4, 5 and 6 had never run.** `Fleet.Settlement.Ack`,
`Fleet.Cancellation.Ack`, `Battle.Fleet.FinalAcked` and
`Fleet.FinalAcked.Release` had **zero** computed slots across all three
workers. Every authority tombstone read `deliveryConfirmed:false`; every worker
held every final it had ever produced. Since "unacknowledged settlements and
cancellations are never pruned" and admission stops at `pendingLimit`, each
worker would have refused every new `Battle.Open` after 100 finished
battles — silently.

The cause is transport, not protocol. HyperBEAM's `dev_push` cascade
(`push_result_message` -> `push_downstream`, `dev_push.erl:302`) runs only while
somebody holds the push request open, and the client stops after the leg it
needs. An unsigned `GET /<pid>~process@1.0/push&slot=N` on the slot that
PRODUCED the stuck message completes the entire remaining chain, with no
signature and no owner wallet. Measured, repairing production: 1.9 s and 10.5 s
for two stuck settlements, 2.8-57.8 s for eight stuck cancellations (n=10). All
three workers now read `pendingFinals: 0`.

It went unnoticed because `verify-battle-fleet.mjs` declared PASS at hop 3 — the
account's win counter moving — which is exactly where the stall began. It now
gates on hops 4-6 (`battle-fleet/delivery-health.mjs`,
`delivery-health.test.mjs`).

**Open, and a decision for the owner:** nothing in the running deployment
delivers hops 4-6. The options are a second client push after a settlement is
observed (+1 authority slot per battle, deduped), an operator sweep
(`npm run reconcile:battle-fleet -- --apply`, owner-signed, +1 authority slot
per stuck final), or riding ack and release on the next message to that worker —
which the section above already lists as "still worth doing later, and cheap",
and which would close this by removing hops 4-6 rather than delivering them.

### PvP is still on the authority, and moving it is a protocol change

`Battle.Attack` in `game.lua:5509` now serves exactly two callers: PvP, and the
monolith fallback for a game with no sealed manifest. PvP fits the fan-out rule
BETTER than a bot battle does — a round is two client actions, so a five-round
fight is ten, which is the band where ~320 ms of critical-path hops amortises
fine — but the fleet cannot take it as it stands. `runerealm-battle-fleet/1` is
one-sided end to end: `Battle.Open` carries one `playerId` and one `monster` and
the worker builds the NPC itself; `Battle.Attack` authenticates the single
reserved participant; `Battle.Fleet.Settle` names one player, one reservation
and one reward plan.

The extension that reuses the most: **two reservations, one worker battle, two
settlements.** The authority reserves both sides in the one `Battle.Accept`
action it already has (both stakes are already escrowed there), routes both to
the same worker under a shared `battleId`, and the worker emits one
`Battle.Fleet.Settle` per reservation in the exact existing shape — so
`authority.lua`'s dedupe, ack, FinalAcked and release machinery is untouched,
just run twice. What genuinely changes is the worker: two-participant open,
either-participant attack auth, simultaneous move commitment with the
`pvpMoveDeadline` force, and a cancel that forfeits the leaver and wins the
other. Plus the fault matrix in `worker_test.lua` doubled.

That is multi-day work and it is not started. Do it in this order, and do not
start until hops 4-6 are delivered by something other than a person, because
PvP doubles the number of finals the handshake has to carry:

1. `Battle.Open` v2 payload (two participants, no NPC construction) + worker
   validation + `worker_test.lua` coverage, with the bot path byte-identical.
2. Two-sided attack auth and pending-move resolution on the worker.
3. Paired reservation in `Battle.Accept`; two settle emissions; authority
   applies each one through the existing single-player path.
4. Cancel/forfeit disposition per side.
5. Client: direct PvP attacks at the worker, opponent's move read from the
   worker's published `battle-<id>`.
6. `verify-battle-fleet.mjs` PvP mode, gating hops 4-6 for BOTH reservations.

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

**Residual, fixed 2026-09-04.** `deploy-workers.mjs` kept its own `?? 2` in the
guard that resolves the Rust WASM image, and that guard runs BEFORE the fleet is
planned. So a deploy that asked for nothing still built and published a Rust
image to Arweave, then stood up three Lua workers that would never run it. Both
places now read `DEFAULT_BATTLE_FLEET_RUST` from `runtime.mjs`, which is the
only file that decides the fleet's shape.

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

Kept: `rune.lua` and `quote.lua`. Those are the exchange assets, not the market,
and their tokens have holders outside the game. `amm.lua` was deleted: this game
trades on an order book, and a constant-product pool is not one.

**Staying separate, correctly:** `rune.lua` and `quote.lua` are their own
tokens. What trades between them is an order book, and its process EXISTS now:
the external venue, `venue.lua` deployed in `external` mode. See §6. Tokens have holders outside this game and must be independently
addressable, so they are not ours to condense -- this is a case where the hop
cost is simply the price of the domain being real.

A companion sale is now zero hops: one action inside the authority. The hops
that remain are the Rune deposit/withdraw saga against the token processes,
which is still unmeasured and is the next thing to count.

## 6. The two venues: two hops in, two out, and they earn it (2026-09-06)

**Rule:** fan out only for session-shaped domains, and all three of
independent-state / client-talks-direct / two-boundaries-on-the-critical-path
must hold.

`venue.lua` is deployed twice — `internal` (in-game assets, trusted messages to
and from `game.lua`) and `external` (real tokens, `Credit-Notice` in and
`Transfer` out). Both run the same `orderbook.lua` the game runs.

**All three hold, unlike the battle fleet:**

1. **Independent while it runs.** A deposited balance is the venue's; nothing
   about a resting order needs to consult a player record. The game's supply
   ledger is not consulted between the deposit and the withdrawal.
2. **The client talks direct.** `Order.Place`/`Amend`/`Cancel`/`CancelAll` are
   signed by the trader against the venue. Nothing proxies through `game.lua`,
   and there is no verb that could.
3. **Two boundaries, and only on the internal venue.** `Venue.Send` in,
   `Venue.Return` out. Each carries an acknowledgement — `Venue.Credited` and
   `Venue.Returned` — and those are the exactly-once handshake, off the
   critical path, counted here anyway:

| # | message | direction | source |
|---|---|---|---|
| 1 | `Venue.Credit` | game -> venue | `game.lua` `H["Venue.Send"]` |
| 2 | `Venue.Credited` | venue -> game | acknowledgement, off-path |
| 3 | `Venue.Return` | venue -> game | `venue.lua` `H["Withdraw"]` |
| 4 | `Venue.Returned` | game -> venue | acknowledgement, off-path |

Two on the critical path (~320 ms), amortised over a whole trading session
rather than a single action. A session that places, amends and cancels ten
times is ~32 ms per action; one that deposits to place a single order is not
worth the trip, and nothing forces a trader to make it.

**The external venue has ZERO game hops.** Its two are against the token
processes, which are not ours to condense: TEST-RUNE and TEST-RELIC have
holders outside this game and must be independently addressable. This is the
case §5 predicted and left open — "what trades between them is an order book,
and its process does not exist yet". It exists now.

**Published state.** Neither venue publishes `orders` or `fills` in full, which
`game.lua` still does (see §4 of ORDERBOOK.md). What it does publish that grows
with the playerbase is `balance-<address>`, one addressed key per trader, and
that is the `player-<address>` problem from CLAUDE.md arriving in a process
whose entire job is holding balances. Two things bound it and neither is
optional:

- an account with nothing is DELETED from `Ledger` rather than stored as zero,
  so the map is the list of people who actually hold something;
- an emptied account's published key becomes `{}` rather than its position, so
  a departed trader costs a few dozen bytes instead of their whole book.

A published key that has been written stays in the map. That is the residual,
it is known, and the mitigation above is what caps it. If a venue ever carries
enough departed traders for that to matter, the answer is the same tombstone
this document recommends for the game — keep the key, drop the record.

**The game gained one key.** `/now/supply` — three integers per asset, ~700
bytes, and every message pays for it five times over whether it moved or not.
It is deliberately not folded into `economy` because it is the key an operator
polls to reconcile against the venue's own `supply`, and making a monitor parse
the whole flow view to read twelve rows would defeat the point. Keep it three
numbers wide.


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
