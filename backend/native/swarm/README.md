# Fifty-wallet swarm

The swarm is a live multi-account game driver, a feature soak test, and a load
probe. It uses fifty throwaway Arweave identities and calls the same
`src/lib/game.ts` functions as the React app. Nothing in the game protocol is
mocked or duplicated.

Each actor runs in its own Node worker thread. That isolation matters because
the browser client reads its identity from `globalThis.arweaveWallet`; sharing a
single global between concurrent wallets would intermittently sign as the wrong
player. The parent runner limits how many workers may write at once and
coordinates five fixed targeted-PvP pairs.

## First setup

```bash
npm run swarm:wallets
npm run swarm:plan
HB_WALLET=path/to/process-owner.json npm run swarm:unlock
```

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

## Run it

```bash
# Ten orchestration cycles, four writes at a time.
npm run swarm -- --live --cycles 10

# A longer soak with deterministic random decisions.
npm run swarm -- --live --duration 2h --seed 20260828

# Bring only the first eight actors online while developing the harness.
npm run swarm -- --live --limit 8 --cycles 5

# Explicitly exceed the conservative node limit for a stress test.
npm run swarm -- --live --duration 15m --concurrency 12
```

Without `--live`, `npm run swarm` prints the plan and performs no writes. The
default concurrency is four because this process/node combination has already
been measured: the latency cliff is between four and twelve concurrent writers.
All fifty actors are independent and asynchronous, but the semaphore prevents
the normal soak from accidentally becoming an outage test. A warning is printed
when the limit is raised above four.

For `--duration` runs, the clock begins after all selected actors bootstrap.
First-time faction choice and adoption are setup, not part of the requested
gameplay observation window.

Run events and timing summaries land in the gitignored directory:

```text
.swarm/runs/<timestamp>/events.jsonl
.swarm/runs/<timestamp>/summary.json
```

The terminal shows each wallet's action, latency, activity, level, Rune count,
and chest count. Running the app beside it shows the resulting faction and
leaderboard changes. The parked `Reality` submodule is still a legacynet client,
so there is no shared open-world position for this harness to move yet; add that
as an action adapter when the open world is ported.

## What the actors do

- 8 quest runners start and later claim quests.
- 7 caretakers feed companions and run play/recovery loops.
- 10 arena fighters play complete bot battles at varied difficulty.
- 10 duelists form 5 stable targeted-PvP pairs and submit both sides of rounds.
- 5 collectors claim dailies, open chests, and consume loot.
- 5 progression generalists mix all routine features and level up.
- 5 randomized explorers choose uniformly from every legal routine action.

Every actor joins a stable faction, adopts once, allocates a role-specific legal
ten-point level-up, and chooses only actions legal for its current published
state. Play and quest timers are real. A short run deliberately leaves those
activities running so a later run exercises the claim path; a multi-hour soak
does that naturally. Live or pending PvP is cleaned up on exit so two test
wallets are not left blocking one another. `--cleanup-all` additionally leaves
every arena session, which can forfeit active bot/PvP fights and should only be
used when that is intended.

## Funding

No AR funding is needed for login, faction choice, adoption, feeding, quests,
loot, daily claims, level-ups, bot combat, or PvP. HyperBEAM compute and
scheduling are free on the configured node; the wallet supplies identity and a
signature, not payment. New accounts receive their starter in-game satchel when
they join, and the daily claim is the recurring Rune faucet.

The swarm intentionally does not automate `Monster.Mint`, asset deposits,
market orders, Rune withdrawals, or L1 transfers. Those cross into permanent
public assets or real-money chain transactions. Add them as separately enabled
adapters with their own funding and cleanup policy instead of putting them in
the randomized default action pool. Under the current game architecture the
funded mint worker, not these player wallets, pays companion minting costs.

## Adding a feature

Add its legal-state test and client call to `worker.mjs`, then give one or more
roles a weight in `profiles.mjs`. Keep irreversible or paid actions behind a
new explicit command-line flag. Do not call the Lua handlers or `hbclient.mjs`
for player actions: going through `src/lib/game.ts` is what makes this a test of
the shipped client as well as the process.
