# Fifty-wallet swarm

The swarm is a live multi-account game driver, a feature soak test, and a load
probe. It uses fifty throwaway Arweave identities and calls the same
`src/lib/game.ts` functions as the React app. Nothing in the game protocol is
mocked or duplicated.

Each actor runs in its own Node worker thread. That isolation matters because
the browser client reads its identity from `globalThis.arweaveWallet`; sharing a
single global between concurrent wallets would intermittently sign as the wrong
player. The parent runner limits both how many worker commands may run at once
and their global start rate, and coordinates five fixed targeted-PvP pairs.

## First setup

After every redeploy, because a new process means new empty accounts:

```bash
HB_WALLET=path/to/process-owner.json npm run fleet:check     # reads only
HB_WALLET=path/to/process-owner.json npm run fleet:prepare   # wallets, unlock, seed
```

`fleet:prepare` is the three steps in the one order that works: generate the
wallets, unlock them on the process, then seed. Running them by hand is fine —
`swarm:wallets`, `swarm:unlock`, `seed:monsters` — but seeding a locked wallet
is refused for every account and reports nothing, so the order is not optional.

The order matters and the last step is not undoable.

`seed:monsters` walks every wallet through the arrival a real player makes:
it swears to a faction — which now hands over the starter in the same message —
and is then gifted up to four more into its collection, so each wallet holds
between one and five. Run `seed:monsters:plan` first: it prints the faction each
wallet is about to be committed to and how much it will hold, and sends nothing.

**Swearing is irreversible.** The process answers `You have already sworn to X`
for a second oath, so a wallet seeded into the wrong faction can only be fixed
by redeploying. The faction therefore comes from `profiles.mjs`, not from the
dice: the swarm refuses to start when a wallet's faction does not match its
plan, and the five PvP pairs are built out of deliberate element matchups —
Cinder's fire against Tide's water, Gale's air against Granite's rock — which
are the entire reason those ten wallets exist.

Because that step cannot be taken back, `seed:monsters` reads the process before
it writes to it and refuses to run when a wallet is already sworn to something
other than its plan, or when the wallets are still locked. It then reads every
account back afterwards and reports how many are genuinely sworn and holding a
companion — not how many messages it managed to schedule, which is a different
number and was the one being reported when 32 of 50 wallets ended up in the
wrong faction on an earlier deployment. A scheduled message says nothing about
what the handler decided.

A seeding run that ends `Every wallet is sworn to its plan` has been verified
against the process. One that ends with a list of problems exits non-zero, and
the swarm will not start until they are fixed.

`swarm:wallets` ensures `burner-01.json` through `burner-50.json` exist. Keys and
the generated address manifest live under `.burners/`; both `.burners/` and all
wallet-like filenames are gitignored. The committed descriptions are in
`profiles.mjs`, while `.burners/manifest.json` joins those descriptions to the
locally generated public addresses. Generating keys never reads
`live-process.txt`, calls a node, unlocks an account, or transfers funds.

`swarm:unlock` is the one explicit setup mutation. It sends a single
`Admin.Unlock` message containing all burner addresses to the process named by
`GAME_PROCESS`/`NODE_URL`, or by `live-process.txt`. It must be signed by that
process's owner. The repository's usual owner key is used when `HB_WALLET` is
not set.

If the shell is intentionally blocked from opening outbound sockets while a
local browser may reach the game node, start `browser-relay.mjs`, open its
printed local page, and set `NODE_URL` to its printed relay node. Workers keep
and use the private keys; the browser receives only already-signed requests and
returns their HTTP responses.

The relay defaults to fifty concurrent browser forwarders and a six-minute
request envelope, so it does not become a hidden throttle in a full-wallet
stress run. Both are configurable with
`--browser-concurrency` and `--request-timeout-ms`.

## Run it

```bash
# Safe soak: at most three in flight and one worker command started per second.
npm run swarm -- --live --cycles 10

# A longer soak with deterministic random decisions.
npm run swarm -- --live --duration 2h --seed 20260828

# Bring only the first eight actors online while developing the harness.
npm run swarm -- --live --limit 8 --cycles 5

# Tune a safe soak's arrival rate without removing its concurrency guard.
npm run swarm -- --live --duration 10m --actions-per-second 1.5 --concurrency 3

# Deliberate saturation: all selected wallets, no arrival-rate limit.
npm run swarm -- --live --mode stress --limit 50 --duration 10m

# Stage a stress run at a known offered load before removing the rate limit.
npm run swarm -- --live --mode stress --limit 50 --actions-per-second 5 --burst 3

# Reconcile every wallet and leave any active arena session without playing.
npm run swarm -- --live --cleanup-only
```

Without `--live`, `npm run swarm` prints the plan and performs no writes. Live
runs default to `--mode soak`: concurrency is three and one new worker command
starts per second globally. `--concurrency` limits outstanding commands;
`--actions-per-second` limits command starts even when replies are fast enough
to free those slots immediately. A rate token is taken immediately before a
worker starts, after it owns a concurrency slot, so permits cannot mature behind
a slow request and burst later. `--burst` controls the token bucket's initial
and refilled burst capacity and defaults to one.

That rate is deliberately named in terms of the CLI flag users already run, but
it is a **command-start** limit, not an exact signed-write counter. Most gameplay
commands issue one write. Bootstrap is the exception: for an uninitialized
wallet, one bootstrap command can sequentially issue login, faction choice and
adoption writes. The run prints `start rate` to make that distinction visible.

`--mode stress` (or the `--stress` shorthand) is the explicit overload mode. It
defaults to one in-flight request per selected wallet and no arrival-rate limit,
so `--limit 50` really can saturate with fifty wallets. Supplying
`--actions-per-second` in stress mode gives a controlled ramp instead. Raising
only `--concurrency` in soak mode does not silently disable its rate limit.

Routine players and all five PvP pairs still start in the same cycle through
one shared dispatcher; there is no routine-then-duelist phase barrier. Bootstrap
uses that dispatcher too. Final cleanup has a separate fixed safety gate of at
most three commands in flight and one start per second, even after an unlimited
stress run, so recovery traffic cannot extend the deliberate saturation.

For `--duration` runs, the clock begins after all selected actors bootstrap.
First-time faction choice and adoption are setup, not part of the requested
gameplay observation window. Once the deadline passes, the scheduler stops
starting new wallets and PvP pairs. An already-published challenge is cancelled
instead of being accepted late, and the normal safety cleanup still runs.

The default per-actor timeout is five minutes. A first-time bootstrap can make
three sequential signed calls, and each slot deliberately tolerates up to one
minute of node compute backlog before it reports a failure. A timed-out actor is
retired: the parent waits for its worker thread to terminate before freeing the
dispatcher slot, so a late write cannot overlap a replacement call invisibly.
If termination rejects or cannot be confirmed inside its own bounded timeout,
the actor becomes fatally retired and the run stops starting gameplay; it is
never reused as though the old write had stopped.

Run events and timing summaries land in the gitignored directory:

```text
.swarm/runs/<timestamp>/events.jsonl
.swarm/runs/<timestamp>/summary.json
```

Each summary records the mode, requested concurrency, actions-per-second and
burst, total successful and failed responses, aggregate success/failure latency
at p50/p90/p99/max, and the same latency distribution broken down by action.
The failure total includes errors with no timing sample; `timedFailures` states
how many can contribute to the failure-latency distribution. Timed-out actor
calls retain their elapsed duration, so overload remains measurable instead of
becoming a blank error sample.

The terminal shows each wallet's action, latency, activity, level, Rune count,
Gold, and chest count. Economic actors compare live P2P depth with the finite
NPC desk, retain role-specific gameplay reserves, place and cancel price-aware
orders, buy deficits from the cheaper counterparty, sell excess inventory, and
execute genuine two-leg arbitrage when the spread covers it. Running the app
beside it shows the resulting faction and
leaderboard changes. The parked `Reality` submodule is still a legacynet client,
so there is no shared open-world position for this harness to move yet; add that
as an action adapter when the open world is ported.

## The proxy ceiling — know it before you read a result

The node sits behind `nginx/1.18.0`, and that nginx rate-limits. Measured on
`hyperbeam.tylerw.ai` on 2026-08-30 against the sealed four-worker fleet:

| swarm concurrency | aggregate req/s | outcome |
| --- | --- | --- |
| 5-30 | 3-18 | healthy: reads flat at 148 ms, no drift, no read failures |
| 40 | ~25 | 5,566 of 5,702 reads rejected with 429 |
| 50 | ~31 | every read rejected, zero writes completed |

A run in that state looks exactly like the system collapsing — near-total read
failure and no write throughput — and is nothing of the sort. nginx answers
`limit_req` with 503 by default, so `limit_req_status 429` was set deliberately;
the limit is on SUSTAINED AGGREGATE rate, not burst or concurrency. Reads alone
hold 20.3 req/s with flat latency, and forty simultaneous reads all return 200.
It is reads plus writes plus the swarm's own slot polling, added together, that
crosses it.

**Keep load runs at concurrency 30 or below** unless the limiter is what you are
testing. Above that you are measuring nginx. `read-load.mjs` now says so and
exits non-zero when it sees 429s, rather than letting the run read as a capacity
finding.

Compute saturation has never actually been reached. The fleet's real ceiling
above concurrency 30 is unmeasured, and stays that way until `limit_req` is
raised or exempted on the node.

## Checking the log afterwards

```bash
npm run swarm:verify              # the newest run
npm run swarm:verify -- --all
```

The swarm writes what happened; `verify.mjs` decides whether it was correct.
The split is not tidiness. Fifty wallets act against one process at once, so no
actor can judge its own result at the time it gets it — "the listing I tried to
buy was gone" is right if somebody else bought it a moment earlier and a bug if
nobody did, and the actor does not know what the other forty-nine did. The log
does.

It asserts that every deliberately illegal probe was refused, that a listing was
sold at most once and only after it was listed, that nobody bought their own
listing, that no wallet's companion count moved without an action to explain it,
and that the roster cap held. It separates failures a concurrent run is entitled
to produce from the ones it is not, and reports whether the node got slower as
the run went on — the difference between a wrong process and a loaded one. The
report lands beside the events as `verify.json`, and a major or critical finding
exits non-zero.

## Trying things that are not allowed

Every role carries a `probe` weight, so a share of each actor's turns is spent
on a message the process **must refuse**: storing a companion that is mid-quest,
listing one that is in the roster, pricing a listing at zero or at `free`,
transferring to yourself or to a string that is not an address, cancelling
somebody else's listing, buying your own, buying with runes you do not hold,
adopting a second companion, and signing `Admin.AdjustInventory`,
`Admin.CreateMonster` or `Admin.Unlock` as an ordinary player.

None of them is garbage. A malformed message is turned away by the action lookup
and proves nothing; each of these names a real verb with real arguments and
differs from a legal call in exactly one respect. The worker sends them through
the client's raw transport rather than the typed helpers, because the typed
helpers will not build an illegal message — `listMonster` clamps a price of zero
up to one, which is right for the app and would make the probe assert nothing.

The worker records what it tried, which rule it was probing, and what came back.
It does not judge. `verify.mjs` does, over the finished run.

## The local fuzzer

`npm run fuzz` is the other half, and it does not need a deployed process.

```bash
npm run fuzz:quick                          # 1,500 ops, 20 wallets
npm run fuzz -- --ops 20000 --wallets 50 --seed 20260829
npm run fuzz -- --ops 500 --verbose --bail
```

It steps the real `game.lua` inside a local AOS module, roughly 500 ops a
second, against a model that predicts every accept and refusal before sending
and checks the exact state transition afterwards. Because it is single
threaded it can assert things the live swarm can only observe: that a store
cost exactly one rune, that a sale credited the seller exactly the asking
price, that a refusal changed nothing at all, and that the companion population
only moved when something created or destroyed one.

It runs a fixed set of adversarial scenarios first — the hostile orders a
shuffle will not reliably produce, including taking an `Admin.Export` and
loading it straight back, which is what a redeploy migration does.

The two are complementary and neither replaces the other. The fuzzer proves the
rules and does not touch signing, Luerl, or the node. The swarm signs real
ANS-104 items against a real scheduler and is the only thing that measures what
the process costs under fifty concurrent wallets.

## What the actors do

- 8 quest runners start and later claim quests.
- 7 caretakers feed companions and run play/recovery loops.
- 10 arena fighters play complete bot battles at varied difficulty.
- 10 duelists form 5 stable targeted-PvP pairs and submit both sides of rounds.
- 5 collectors claim dailies, open chests, and consume loot.
- 5 progression generalists mix all routine features and level up.
- 5 randomized explorers choose uniformly from every legal routine action.

All fifty also exercise the roster, the collection and the marketplace, in
proportions set per role in `profiles.mjs`: sending a companion to the
collection and pulling it back, choosing which of up to three the untargeted
verbs act on, handing one to another actor, listing one for in-game runes,
cancelling a listing, and buying somebody else's. Collectors trade hardest,
explorers probe hardest, duelists least of either so PvP stays measurable.

The same pool also saves complete character recipes and drives Hunt all the
way through its separate process: begin, retry-open if needed, search, every
combat round, capture or decline, retry-settlement if needed, and end/release.
`ROUTINE_ACTIONS` in `profiles.mjs` is checked by `test:swarm`; every role must
make an explicit weight choice for every adapter, and every adapter must be
enabled somewhere. This is the guard against a new reversible player verb
quietly existing outside the live fleet.

An actor never stores its last idle companion. That is deliberate: a wallet with
an empty roster cannot quest, feed or fight, and would silently drop out of
every other measurement the run is taking.

Every actor is already sworn and already holding companions by the time a run
starts — `seed:monsters` does that once, not the harness on every run. A wallet
that is somehow not yet sworn still swears itself on bootstrap, which is one
message and hands over the starter with it; there is no separate adoption step
any more, and `Monster.Adopt` survives only as the door for an account that
swore under an older build.

From there each actor allocates a role-specific legal ten-point level-up and
chooses only actions legal for its current published state. Play and quest timers are real. A short run deliberately leaves those
activities running so a later run exercises the claim path; a multi-hour soak
does that naturally. Live or pending PvP is always cleaned up on exit so two
test wallets are not left blocking one another. Timed runs also leave every bot
arena session because their actors have stopped; cycle-count runs preserve bot
progress unless `--cleanup-all` is supplied explicitly.

`--pid` and `--node` may override `backend/native/live-process.txt`; this is
useful with the local browser relay when the shell cannot reach HyperBEAM.

## Funding

No AR funding is needed for login, faction choice, adoption, feeding, quests,
loot, daily claims, level-ups, bot combat, or PvP. HyperBEAM compute and
scheduling are free on the configured node; the wallet supplies identity and a
signature, not payment. New accounts receive starter berries when they join.
Rune is not a per-wallet starter or daily faucet: a contract deploy with bots
uses the owner-only, testing-mode `Admin.Economy.FundTestBots` batch to establish
a 25 Rune / 5 Scroll minimum for these exact throwaway addresses. That action
is unavailable after economy activation and every unit appears in the issuance
ledger.

Companion trading needs no funding either, and that is the point of settling
sales inside the game process in in-game runes: a listing, a purchase and a
transfer are all one message with no chain transaction behind them. Minting a
companion out to Arweave is a different matter and is currently off
(`C.MINT.enabled`), because the first time a minted card moves the network
charges a new-account fee on the card's own process address — around $0.47, once
per card, forever — which across a run that trades thousands of companions is
the entire budget for cards nobody keeps.

The swarm intentionally does not automate `Monster.Mint`, asset deposits,
Rune withdrawals, or L1 transfers. Those cross into permanent
public assets or real-money chain transactions. Add them as separately enabled
adapters with their own funding and cleanup policy instead of putting them in
the randomized default action pool. The entire companion asset path is parked;
the funded worker source is retained, but normal deployments never run it.

## Adding a feature

Add its legal-state test and client call to `worker.mjs`, then give one or more
roles a weight in `profiles.mjs`. Keep irreversible or paid actions behind a
new explicit command-line flag. Do not call the Lua handlers or `hbclient.mjs`
for player actions: going through `src/lib/game.ts` is what makes this a test of
the shipped client as well as the process.
