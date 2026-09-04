# Why a slot costs 19 seconds when the Lua costs 45 ms

**Answered 2026-09-01, on a local node, from HyperBEAM's own per-slot log.**

## The answer, first

All of the growth is in **`execution_ms`**. `prep_ms` is 0 at every population
measured and never moves. `store_ms` grows but stays under half a second.

`execution_ms` is not HyperBEAM marshalling the base message — it is **the
contract's own Lua**, and inside that, the dominant term is the
**`collectgarbage("collect")` at the end of every `compute`**.

Luerl's collector is **O(live tables²), and blind to bytes**. Measured directly:
the same payload costs 23,599 ms to collect held as nested tables and **0.3 ms**
held as strings, and every doubling of the table count costs 4x. So the axis is
retention — as expected — but of *tables*, not of bytes, and it surfaces in
`execution_ms` rather than `store_ms` because the collect runs inside the
contract rather than in the node's snapshot.

That is why cutting per-record size 37% changed nothing: bytes were never the
quantity. An empty account minted by `Admin.Unlock` is ~6 live tables that are
never freed, and every message from every player re-sweeps all of them,
quadratically.

**None of this is implemented.** This document is the measurement; the contract
is unchanged.

## The number to explain

Measured 2026-09-01 against `4hI1b77TLsbCb0UTulVaCZXlL9vE1nylzV41n3-qIp0`
(50 bots, ~3 h of play), driving the real UI with a `fetch` hook:

| call | time |
|---|---|
| `schedule` (the signed write) | 262 ms |
| `now/at-slot` | 159 ms |
| **`compute&slot=N/results/output/data`** | **19,022 ms** |
| `now/access`, `challenges`, `catalog`, `factions`, `leaderboard` | 157–309 ms |

Re-requesting an **already computed** slot returns in 0.37 s, so the 19 s is the
cost of executing one fresh message, not of fetching a result.

## What had already been ruled out

**It is not the contract as a diff.** The offline profiler
(`run-local-profile.mjs`) measured HEAD against the current tree on identical
50-player fixtures and the current tree was 27% *faster* on both `User.Info` and
`Monster.Feed`. That remains true and remains beside the point: the profiler
runs on ao-loader — real Lua 5.3 with a real generational collector — where
`collectgarbage("collect")` is cheap. Luerl is not that, and the profiler
therefore cannot see the thing that costs the 19 seconds.

**It is not new.** `OVERNIGHT.md` recorded the same curve before any of this
work: median action 7.6 s early in a run, 18.5 s by the end.

## How this was measured

Four instruments, all local, all in `backend/native/battle-fleet/hblab/`:

* **`soak-game.mjs`** — spawns real game processes on a local node, drives them,
  and reads the node's own `computed_slot` log (`prep_ms` / `execution_ms` /
  `store_ms` / `computed_slot_size`). Arms are `<shape>[-<variant>…]`, where a
  variant patches exactly one line of `game.lua` so a pair of arms differs by
  one cause.
* **`analyze-slots.mjs`** — per-handler medians and heap-kept-per-message from a
  run's slot log.
* **`gc-shape.mjs`** — the same payload held as tables and as strings, collected
  the same number of times. It is what turns "the collect is expensive" into
  "the collect is quadratic in table count and free in bytes".
* **`lua-cost.mjs`** — the same contract on the free unsigned `~lua@5.3a`
  device, where `compute()` is called directly: no base message encoded in, no
  result decoded out, no cache write. It isolates the contract's Lua from
  everything HyperBEAM does around it.

`computed_slot_size` is `erlang:external_size` of the whole process state
message, and `dev_lua` keeps the **live Luerl state** in that message's `priv`
between slots (`snapshot/3`), so that column is a direct read of the interpreter
heap. It is not the published map: on a fresh game process the two are **3.46 MB
and 15 KB**.

## Test 1 — the three-way split

Four arms, each a freshly spawned process, each probed identically before and
after its growth phase (15 alternating `User.Info` / `User.Login` from one
wallet — the same function; `H["User.Login"] = H["User.Info"]`).

Medians over the probe's slots:

| arm | growth | prep | exec | store | node total | client |
|---|---|---|---|---|---|---|
| control | nothing | 0 | 24 | 53 | 78 ms | 184 → 186 ms |
| reads | **3,000 messages**, 5 fixed wallets | 0 | 25 | 6 | 39 ms | 185 → 196 ms |
| wallets | **1,500 accounts** | 0 | 728 | 321 | 1,055 ms | 175 → **4,618 ms** |
| battles | 1,505 messages of real bot battles | 0 | 84 | 69 | 149 ms | 194 → 395 ms |

**Message count is not the axis.** Three thousand messages through a process
left it exactly as fast as it started and its heap unchanged at 3.46 MB.

**Retained battles are not the axis either**, and the brief had them as suspect
number one. 1,505 messages of real fights — `Battle.Begin` / `Start` / `Attack`
to the end / `Leave`, five wallets, restocked between sessions — moved the heap
from 3.46 MB to 4.13 MB and the probe from 81 ms to 149 ms. Per-message heap
kept, by handler: `Admin.Grant` 467 B, `Admin.SetStats` 466 B, `Battle.Begin`
418 B, `Battle.Attack` 411 B, `Battle.Leave` 411 B, `Battle.Start` 398 B —
all within noise of each other, and all an order of magnitude under one wallet's
5,326 B. `pruneBattles` is doing its job. **Do not spend a day on the turn log**
— and note the warning in the earlier brief still stands anyway, since `keep=10`
broke the battle at round six.

**Accounts are.** The full `Admin.Unlock` curve on a stock bundle, 50 accounts
per message, reproduced within 5% on two different containers:

| accounts | exec | store | heap |
|---|---|---|---|
| 50 | 109 ms | 13 ms | 3.72 MB |
| 500 | 1,269 ms | 99 ms | 6.12 MB |
| 1,000 | 3,553 ms | 302 ms | 8.78 MB |
| 1,500 | 7,016 ms | 302 ms | 11.44 MB |
| 2,000 | 10,319 ms | 350 ms | 14.11 MB |
| 2,750 | **20,370 ms** | 469 ms | 18.10 MB |

`prep_ms` is 0 on every one of those rows. Heap grows by 266,325 bytes per
50-account batch — **5,326 bytes per wallet** — with no scatter across 30
batches.

That is a 19-second slot, reproduced on a laptop with nobody playing — but read
the next section before acting on it.

## The 19 seconds is queueing, not compute

A faithful reproduction — 49 players, **5,000 mixed actions** (feed, play, quest,
altar, loot boxes, fights), which is the shape of `OVERNIGHT.md`'s run — does not
degrade:

| | prep | exec | store | node total | client |
|---|---|---|---|---|---|
| cold | 0 | 24 | 54 | 79 ms | 196 ms |
| after 5,000 actions | 0 | 53 | 104 | 156 ms | 412 ms |

Heap moved 3.46 → 4.04 MB across the whole run: ~120 bytes an action. The
contract at production's population and traffic answers in **412 ms**, and the
live process answers in 19,022 ms. Nothing in the handler explains 46x.

What does: **a process computes its slots one at a time.** `concurrency.mjs`
drives C players at that same matured process simultaneously:

| in flight | p50 | p90 | max | actions/s |
|---|---|---|---|---|
| 1 | 516 ms | 516 ms | 516 ms | 1.9 |
| 2 | 847 ms | 847 ms | 847 ms | 2.4 |
| 5 | 1,337 ms | 1,349 ms | 1,349 ms | 3.7 |
| 10 | 3,135 ms | 4,593 ms | 4,593 ms | 2.2 |
| 25 | 5,146 ms | 7,275 ms | 7,313 ms | 3.4 |
| **49** | **12,699 ms** | **16,404 ms** | 16,838 ms | 2.9 |

Throughput is **flat at ~3 actions per second** however many people are waiting,
and latency is linear in how many are. Forty-nine bots on one process buys a
12.7 s median. The live run had fifty, and measured 19 s.

`OVERNIGHT.md`'s 7.6 s → 18.5 s across a run is the same thing seen from
inside: that is a queue filling, not a handler slowing down.

**So the wait is other people's messages.** Throughput is
`1 / (slot cost x times each slot gets computed)`, and both factors are
addressable:

* The 2.79x replay is worth 12,699 ms → **7,191 ms** at 49 in flight, and 2.9 →
  3.7 actions/s. **But it is not a player-facing bug.** It comes from
  `backend/native/hbclient.mjs`, whose `sendMessage` fires a best-effort
  `pushSlot` for EVERY message, concurrently with the caller's own `compute` —
  so both walk the same slots. The browser client does not do this:
  `send()` in `src/lib/hyperbeam.ts` reads the slot first and pushes only for
  `OUTBOX_ACTIONS`, which is `{'rune.withdraw'}`. The swarm bundles that same
  client. So the honest production-representative row is the `--no-push` one,
  and fixing `hbclient.mjs` speeds up deploys, seeding and the test harness —
  not the game.
* Slot cost is the other factor, and at 51 accounts it is ~156 ms — which is why
  every byte- and table-level finding above, while real, cannot be what is
  hurting today.

At 10,000 users this is the wall that matters first. Even a perfect 6 actions/s
is 6; ten thousand players taking one action a minute is 167/s. **The authority
process cannot be on the critical path of a routine action at that scale**,
which is what `CLAUDE.md`'s process-shape rules already say and what the battle
fleet was built for — "insurance against serialisation" is now measured to be
the binding constraint rather than insurance.

## Where the tables are: the live process is 51 accounts

The mechanism above is real and measured. Its **magnitude does not match
production**, and the difference matters more than the mechanism does.

Read from the live process's published keys (plain cached GETs, no compute):

| key | value |
|---|---|
| `users` | **51** |
| `leaderboard` | 40,760 B, 50 rows, ~8 tables a row |
| `economy` | 12,079 B, ~172 tables |
| `metrics` | 2,135 B, ~9 tables |
| `checkins` | 40 B |
| `offerings` | 71 B |
| one real `player-<addr>` | 2,707 B, 28 nested objects — of which `monster` and `monsters` are the same companion published twice, so ~21 tables live |

51 accounts at ~21 tables is roughly **1,100 live tables from `Players`**, and
everything published adds order 1,700. The `gc-shape.mjs` curve puts 5,500
tables at 89 ms. **A process this shape should collect in well under 100 ms**,
and my local one with six accounts does exactly that: 78 ms.

So the local reproduction needed ~2,750 empty accounts to reach 20 s, and
production reaches it with 51 real ones. The quadratic is a real mechanism that
will certainly bite later; it is **not yet demonstrated to be what is biting
now**. Something on the live process holds far more live tables than its
published state accounts for, and the candidates are the globals that are never
published and so cannot be read from outside: `Battles`, `Market`, telemetry,
`EconomyState` internals, the withdrawal and deposit queues.

`OVERNIGHT.md` points the same way — 7.6 s to 18.5 s across 5,061 actions with
the population roughly constant. That is accumulation per **action**, and the
`battles` arm above is the only arm that reproduced any of it (heap 3.46 →
4.13 MB, slot 81 → 149 ms over 1,505 messages).

**The next experiment is therefore not a fix. It is `Admin.Export` from the live
process, loaded into a local one, and the same probe run against it** — which
turns "something accumulates" into a named structure, the way the arms above
named accounts. Until that is done, treat the ranking below as the ranking for a
problem the live process will have, not the one it has.

## Test 2 — what inside `execution_ms`

### It is the contract's Lua, not the marshalling

`lua-cost.mjs`, same bundle, `compute()` called directly with no HyperBEAM
encode/decode/cache anywhere:

| accounts | ms per `User.Info`, contract Lua only | node's `execution_ms` for the same verb |
|---|---|---|
| 0 | 14.8 | 13 |
| 250 | 64.8 | — |
| 500 | 126.3 | — |
| 1,000 | 536.0 | — |
| 1,500 | 581.8 | 514–728 |

The contract alone accounts for essentially the whole of `execution_ms`.
Marshalling the base in and out of Luerl is not the cost.

### It is the collect

Three one-line variants of `game.lua`, all at 1,500 accounts, same probe.
Node-side total (`prep + exec + store`) per read:

| bundle | p50 | p90 | max | probe exec | probe store | heap | client p50 |
|---|---|---|---|---|---|---|---|
| **stock** | 1,055 | 1,211 | 1,243 | 728 | 321 | 7.40 MB | 4,618 ms |
| **− published `player-<addr>`** | **483** | **663** | **826** | 407 | 7 | 5.45 MB | 2,216 ms |
| collect every 10th message | 525 | 1,748 | 9,478 | 183 | 304 | 16.35 MB | 3,117 ms |
| no collect at all | 458 | 4,022 | 4,298 | 167 | 295 | **238 MB** | 6,764 ms |
| both of the above | 19 | 951 | 9,071 | 12 | 5 | 10.38 MB | 585 ms |

Removing the collect cuts `execution_ms` by 77%, which is the measurement that
names it. It is not a fix: the heap reaches **238 MB** at 1,500 accounts and the
client gets *slower*, because everything downstream now carries it.

**Batching the collect is a trap.** `gc10`'s median read is 12 ms and four of
its 49 probe computations cost **7.7–9.1 seconds**: the collect still happens, it
just walks ten messages' worth of churn when it does. For a game where a player
is waiting on the reply, a 12 ms median with an 8 s hitch every tenth action is
a worse experience than a steady 0.8 s, and the p90/max columns say so. Any
"amortise the GC" proposal has to be judged on its tail, not its median.

**Dropping the published per-wallet record is the only change that improves
every percentile** — p50, p90 and max all fall, `store_ms` falls 97%, and the
client-visible time halves. It is also not directly shippable: that key is what
makes reading your own account a free unsigned GET (`readAuthorityPlayer` in
`src/lib/game.ts`), and without it a returning wallet cannot see itself without
signing. The measurement says where the win is, not that the key should go.

### The collect is O(live tables²), and bytes are free

`gc-shape.mjs` holds two heaps of the **identical payload** — one as nested
tables shaped like a player record, one as one string per record — and times
the collect over each:

| records | as nested tables | as strings |
|---|---|---|
| 500 | 89.0 ms | 1.3 ms |
| 1,000 | 369.0 ms | 0.0 ms |
| 2,000 | 1,423.0 ms | −0.7 ms |
| 4,000 | 5,941.7 ms | −0.3 ms |
| 8,000 | **23,599.0 ms** | 0.3 ms |

Every doubling of the table count costs **4x**. That is O(n²), cleanly, across
four doublings. The same bytes held as strings cost **nothing at any size** —
8,000 records is 0.3 ms.

Three things follow, and they redirect the whole effort:

* **The axis is the number of live Lua tables, not bytes.** This is why cutting
  per-record size 37% produced no latency improvement: it was the wrong
  quantity. It is also why `store_ms` and the published map, which *are* byte
  quantities, were never going to explain the 19 seconds.
* **Shape beats size.** Halving tables-per-account quarters the collect. Holding
  an account's cold state as one encoded string instead of ~6 tables is a ~36x
  cut on the dominant term, at identical bytes.
* **It is a wall, not a slope.** 23.6 s for one collect at 8,000 records means
  the process does not get gradually worse — at roughly twice the population it
  reproduces the 19 s figure outright, and past that it stops working. Nothing
  about this is deferrable to "after launch".

## The loop: every gameplay write read every account — fixed

**Status: fixed in `game.lua`.** `npm run test:scale` now passes (0 walks, 0
accounts seen, at both populations), `npm run test:lua`'s 636 assertions pass,
and the board is checked row-for-row against a full scan on every run. What
follows is what the guard found before the fix.


`npm run test:scale` (`scale_guard.lua`) swaps `Players` for a proxy whose
`__pairs` counts scans, and asks how many accounts ONE message visits:

| action | 20 players | 120 players | |
|---|---|---|---|
| `User.Info` (read) | 0 walks, 0 seen | 0 walks, 0 seen | ok |
| `Monster.Feed` (write) | **2 walks, 40 seen** | **2 walks, 240 seen** | FAIL |
| `Monster.Play` (write) | **2 walks, 40 seen** | **2 walks, 240 seen** | FAIL |
| `Daily.Claim` (write) | 0 walks, 0 seen | 0 walks, 0 seen | ok |

Two full walks of the player table on every gameplay write, scaling exactly
with the population. They are `factionStats()` and `leaderboard(50)` in the
publication block, reachable from any action whose `ACTION_DIRTY` entry sets
`aggregates` — feed, play, quest, level-up, adopt, join, battle begin/attack,
every hunt verb.

Each walk also builds a **table per account**: a member entry in `factionStats`,
a row in `leaderboard`. So at 10,000 players one `Monster.Feed` visits 20,000
records, allocates ~20,000 tables, sorts 10,000 rows — and then collects,
quadratically, over a heap that just grew by all of it.

The read path was already fixed: `ACTION_DIRTY` gives `user.info` an empty dirty
set, and `Daily.Claim` passes because `users` now comes from `TelemetryTotals`
rather than a count. `rebuildTelemetryTotals` is the pattern and its comment says
so — "the normal action path below never walks `Players`". Faction stats and the
leaderboard never got the same treatment.

This is invisible at 51 accounts (100 tables) and fatal at 10,000. It is not what
makes a slot cost 19 s today; it is what makes the number unfixable later.

## The amplifier: the node recomputes slots

The client sees 4,618 ms where the node's own three numbers total 1,055 ms.
The gap is that **each message costs about three slot computations**, not one:

```
slot: 48 User.Info exec 979  14:39:31
slot: 48 User.Info exec 949  14:39:45
slot: 48 User.Info exec 846  14:39:54
slot: 48 User.Info exec 743  14:39:58
```

Measured across the wallets arm: 63 distinct slots, **176 computations — a 2.79x
replay factor**, and each replay pays full price. Part of that is the harness
(`sendMessage` fires a best-effort `pushSlot` for every message, which starts a
walk of its own alongside the `compute` request); the app's client goes through
the same helper. It multiplies whatever a slot costs, so it is worth fixing
*after* the slot cost, not instead of it.

## Does the node have to change?

**No. Everything that causes the growth is in `game.lua`.**

* The collect is the contract's own last statement in `compute`.
* The heap it walks is the contract's `Players` table plus the `player-<address>`
  keys the contract writes into `result`.
* `prep_ms` — the node's own state preparation — is **0 at every population
  measured**, from 6 accounts to 2,750. There is nothing to tune there.
* No node config was changed to reproduce any of this, and the three lab images
  differ only in WAMR build flags, which the Lua path never touches.

The one thing that is *not* contract-side is the **2.79x replay factor**, and it
is a multiplier on the slot cost rather than a cause of it — at 78 ms a slot
nobody would have noticed it. It is also not clearly the node's fault: the
client fires a best-effort `pushSlot` alongside every `compute`, and the two
start separate walks. That is worth its own look, on the client first, after the
slot cost comes down.

## What to do, in order

**Nothing below is implemented.** This document is the measurement; the contract
is unchanged.

Ranked by measured effect against the size of the change. Every one of them is
in `game.lua`.

**Today's 19 s and the 10,000-user wall are two different problems.** Items 0a
and 0b are the first; everything after is the second, and none of it moves
today's number.

0a. **Turn the battle fleet on.** The live process publishes
    `battlefleet: {"enabled":false,"workers":[]}` — every battle round, and a
    bot battle is ~15 messages, is on the authority's single queue. This is the
    one lever that changes the ceiling rather than the constant, and the
    machinery already exists (`configure-battle-fleet.mjs`).

    Fix `hbclient.mjs`'s push race too, but know what it buys: it is the
    deploy/seed/test path only. The browser client already reads first and
    pushes only for `OUTBOX_ACTIONS` (`rune.withdraw`), and the swarm bundles
    that client — so this speeds up tooling, not the game.

    **More nodes will not help.** A process has one `scheduler-location`, and
    that scheduler alone assigns slot numbers; other nodes can compute the same
    chain and get the same answer, which is what makes reads distributable and
    the result verifiable. It does not make writes parallel — a second node
    replays the identical slots at the identical cost. Write throughput is a
    property of the process, and the only way up is more processes.

0b. **Get routine actions off the single authority queue.** Throughput is flat
    at ~3/s no matter how many people wait, so latency is just queue depth.
    Ten thousand users at one action a minute is 167/s. The battle fleet already
    implements the pattern for battles; hunts are the other session-shaped
    domain. This is the only item that changes the ceiling rather than the
    constant.
1. **Do not materialise an account until it plays.** `Admin.Unlock` calls
   `getPlayer`, which MINTS a full record — `deploy.mjs` already notes it seeds
   168 accounts this way, and the bots add more. An empty stub is ~6 live tables
   and 4,032 bytes of heap, forever, swept quadratically by every message from
   every player. An allow-list held as a set of address strings is, by the table
   above, free. This is the `wallets` arm exactly: the difference between 78 ms
   and 1,055 ms per read is stub accounts.

   **Worth almost nothing on the live process as it stands**, which holds 51
   accounts and no stub population. This is insurance against the paid list and
   a bot fleet being seeded into a process, not a fix for today.
2. **Hold cold player state as one encoded string.** ~6 tables per account down
   to 1 is ~36x off the dominant term at identical bytes. Keep the fields the
   aggregates actually read — faction, level, wins, `totalTimesFed`/`Play`/
   `Quest` — as flat scalars on the record, so `factionStats()` and
   `leaderboard()` never decode a blob; put inventory, collection, lootboxes,
   moves and outfit in the blob.
3. **Bound the published `player-<address>` map** — evict cold wallets rather
   than deleting the scheme, since the client's free unsigned read depends on
   it. Worth ~2x at 1,500 wallets, on every percentile, and it is 97% of
   `store_ms`.
4. **Then** look at the 2.79x replay factor, on the client first.

### What each one costs

* **(1)** changes what "unlocked" means and what `users`, the leaderboard
  denominator and `Admin.Export` count. `User.Info` already answers an unknown
  wallet with a full blank record and `exists = false`, so the client tolerates
  an account that does not exist yet — that is the shape to lean on.
* **(2)** is the largest change: every handler touching a cold field needs a
  decode and re-encode, and the `Admin.Load`/export path must round-trip the
  BLOB, not a hydrated copy of it. That failure mode is already documented in
  CLAUDE.md and it is permanent once written.
* **(3)** leaves an evicted wallet unable to read itself without signing, which
  is the exact regression the per-address key was added to fix. It needs a
  fallback before it can ship.
* **Not doing any of it** costs the launch: at ~2x the measured population one
  collect alone is 19 s.

### What not to bother with

* **Shrinking bytes.** Measured twice as having no effect on the dominant term:
  the 37% per-record cut, and the strings column above.
* **Removing or batching the collect.** Both measured; both make the tail worse.
  Removing it also reproduces the 900x snapshot it was added to fix.
* **The battle turn log.** Measured at 411 bytes of retained heap per
  `Battle.Attack`, against 5,326 for one wallet.

## Do not

* Do not tune the client timeout. `readSlot` waiting is a symptom; the slot
  genuinely takes that long and the reply does not exist until it does.
* Do not re-measure with a stopwatch from outside the node. hblab exists because
  that was tried and the network dominated the signal.
* Do not trust the offline profiler on this question. It runs on real Lua 5.3,
  where the collect is cheap; it cannot see the term that dominates.
* Do not judge a GC change by its median.

## Reproducing it

```bash
docker run -d --name hb-stock -p 8734:8734 -v hb-stock-data:/data hb:stock

# the four arms of Test 1
node backend/native/battle-fleet/hblab/soak-game.mjs \
  --arms control,reads,wallets,battles --grow 1500 --probe 15

# one-line variants, same growth phase
node backend/native/battle-fleet/hblab/soak-game.mjs \
  --arms wallets,wallets-nopub,wallets-gc10,wallets-nogc --grow 1500 --probe 15

# per-handler cost and heap kept per message, from a run's slot log
node backend/native/battle-fleet/hblab/analyze-slots.mjs soak-<stamp>-slots.json

# the contract's Lua alone, at a range of populations
node backend/native/battle-fleet/hblab/lua-cost.mjs

# does the collect pay per table or per byte?
node backend/native/battle-fleet/hblab/gc-shape.mjs

# what the bytes in a slot actually are
node backend/native/battle-fleet/hblab/slot-anatomy.mjs <process-id> [slot]
```

Arms take ~5–20 minutes each at `--grow 1500`; the three lab containers
(`hb-stock`, `hb-fastinterp`, `hb-fastjit`) run the identical Luerl path, so
three arms can run in parallel on ports 8734/8735/8736.

## A note on `run-heap-probe.sh`

It was extended to cover the handlers this brief named, and its **gc-ON arm does
not work**. The probe reads the Luerl table store's index as a high-water mark,
and a real `collectgarbage("collect")` *renumbers the store* — so after a
collect the index is not comparable with the one before it, and the arm reports
negative slopes and identical readings for unrelated scenarios. Its gc-OFF arm
(pure allocation per message) is still sound and still ranks handlers: a whole
bot battle allocates 28,100 tables against 1,797 for a feed and 41 for a read.

For retention, use `computed_slot_size` from the node's own log instead — it is
`external_size` of the message that carries the live Luerl state, needs no
bundle surgery, runs on the real device stack, and the node stamps the handler
name on the line for free. `analyze-slots.mjs` reads it.
