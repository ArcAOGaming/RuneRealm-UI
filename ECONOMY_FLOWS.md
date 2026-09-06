# Every faucet and every sink

What creates each asset, what destroys it, and where the number lives. This is
a map of the **deployed** economy, not a plan — if the code and this file
disagree, the code is right and this file is a bug.

It exists because of one defect. [ECONOMY_V2.md](ECONOMY_V2.md) §7 stated that
the item faucet had moved from per-battle to per-day, and it had not: the arena
half changed and `C.ACTIVITIES.quest.lootRarity = 2` was left alone, so a free
one-hour quest went on paying a ~21-berry crate against ~2.75 berries of
upkeep. **A 7.6× surplus survived for weeks inside a document that said it did
not exist**, because no page listed the faucets side by side where the second
one would have been obvious. This is that page.

Related: [ECONOMY_V2.md](ECONOMY_V2.md) is the rates and the reasoning,
[ECONOMY_MARKETPLACE_PLAN.md](ECONOMY_MARKETPLACE_PLAN.md) is the structure and
the locked decisions, [ORDERBOOK.md](ORDERBOOK.md) is the book,
[HUNT.md](HUNT.md) is the hunt.

---

## The one rule

**Items come from the calendar. Gold comes from the verbs. Rune comes from the
schedule.**

A per-action ITEM reward funds more actions, so it compounds for whoever acts
most — which is the one shape a machine beats a person at. Gold does not
compound: turning it back into playtime means finding a player willing to sell
you berries, which is the market this economy exists for. Rune is neither, and
is bounded by a published schedule that nothing in gameplay can touch.

Every table below is a consequence of that sentence. If a change would put an
item on a verb or make Rune respond to play, it is changing the rule, not
tuning it.

---

## 1. Berries

The only thing that gates play. Own-element feeds for 20 energy, any other for
10, and any berry at all satisfies a Play — which is why a surplus in three
kinds and a deficit in the fourth is the normal state of a player, and why
there is anything to trade.

### Faucets

| Source | Amount | Meter | Where |
| --- | --- | --- | --- |
| Daily worship crate | ~22 (streak 1-2), ~28.5 (3-9), ~48 (10+) | once per 20h per wallet | `C.DAILY.streakTiers`, `Daily.Claim` |
| Starter crate | ~132, once ever | `p.seeded`, paid pass only | `C.STARTER_LOOTBOXES` |
| Starter inventory | 5 of each, once ever | `p.seeded` | `C.STARTER_INVENTORY` |
| Launch shop stock | 50 per berry desk, once | genesis only | `seedDeskStock` |
| `Admin.Grant` | any | owner signature, audited | `game.lua` |

**That is the complete list.** No verb pays berries. If you are adding one,
you are changing the rule at the top of this file.

### Sinks

| Sink | Amount | Where |
| --- | --- | --- |
| Feed | 1 per feed | `Monster.Feed` |
| Play | 1 per play | `Monster.Play` |
| Arena stat boost | 3 of one kind, optional | `C.BATTLE_BERRIES` |
| Hunt entry | 2 of each = 8 per run | `C.HUNT.entry.berries` |
| Sold to an NPC desk | any | moves to `desk.stock`, not destroyed |

An **action** — a Play plus a 25-energy verb — costs ~2.75 berries: one for the
Play, plus 35 energy at 20 per own-element berry. That figure is the unit
everything else is measured in.

### The budget this produces

| Streak | Crate | Actions | Play |
| --- | --- | ---: | ---: |
| 1-2 | tier 2 | ~7.3 | **~1.8h** |
| 3-9 | tier 2 + tier 1 | ~9.5 | ~2.4h |
| 10+ | tier 3 | ~14.2 | ~3.6h |

**~2 hours a day is the promise**, and tier 2 is the number that carries it.
Moving `C.LOOT_TIERS[2]` moves the promise; nothing else does.

To play more than that, buy berries from somebody who would rather sell theirs.
That is not a workaround, it is the design.

---

## 2. The loot ladder

A box draws `picks` **distinct** elements and pays `min`..`max` of each.

| Tier | Name | Picks | Berries | Scrolls | Routine source |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Common | 1 | ~6.5 | — | streak-3 crate |
| 2 | Uncommon | 2 | **~22** | 12% | **the daily crate** |
| 3 | Rare | 3 | ~48 | 1 | ten-day streak |
| 4 | Epic | 4 | ~88 | 1.5 | none — events, admin |
| 5 | Legendary | 4 | ~132 | 2.5 | the starter crate, once |

**The first pick is always the opener's own faction berry.** Its element feeds
for double, so a run of crates without it is a run of days unable to act, and
the crate's whole job is that a player can always play.

**Every pick after the first is deliberately a different element.** That
surplus is what somebody else needs. Paying all four evenly would be tidier and
would quietly remove the reason to trade — do not "fix" it.

### What this replaced, and why it matters

Nine independent rows, each with a `chance` out of 1000 scaled by the tier and
clamped at 950. Two defects, both visible on screen:

- **A common box paid 1.53 berries**, and 31.6% of the time four 25% rolls all
  missed and it fell to a one-berry pity floor. "Rock Berry +1" is not a
  reward.
- **The tiers were indistinguishable above 2**: 20.93, 21.53, 22.14, 22.74
  berries. A Legendary was 1.8 berries better than an Uncommon and the name was
  the only difference.

Independent rows also meant the *same berry arrived twice* — once from a tier-1
row, once from a tier-2 row — so a receipt read "Rock Berry +1" above "Rock
Berry +8" as though they were two different finds. Distinct picks make that
unrepresentable rather than merely fixed.

---

## 3. Gold

Internal plumbing, never an investment asset, and it never leaves the game. Its
job is to let players trade goods without spending Rune on every small deal.

### Faucets

| Source | Amount | Meter | Where |
| --- | --- | --- | --- |
| Quest claim | 15 | shared 20h allowance | `C.ACTIVITIES.quest.goldReward` |
| Arena win | 5 | shared 20h allowance | `C.ACTIVITIES.battle.winGold` |
| Sold into an NPC desk | ladder price | desk stock, reserve and rate limits | `shopTrade`, `deskSettle` |
| Sold to another player | whatever they pay | zero-sum | order book |

**Both verbs draw on ONE allowance per account per 20-hour window** —
`C.ECONOMY.gold.rewardWindowCap`, 60 Gold. That is what makes the faucet
bot-proof: a wallet playing around the clock and a person playing for two hours
collect the same 60, exactly as they collect the same crate. Reached in ~4
quests or ~12 arena wins.

Seventeen days of collecting it in full lands on `gold.perQualifiedPlayer` —
the 1,000 Gold the policy already assumes a real player holds — so the flow and
the stock agree without a second number being invented.

**Gold rewards are MOVED, never minted.** They come out of `gold.locked`, so

```text
issued - burned = player + escrow + shop + locked
```

still holds after every payment. `M.grantGoldReward` owns both halves;
`recordPlayerDeltas` deliberately ignores a positive Gold delta from any
non-admin verb, so a handler that simply bumped `p.gold` would credit a player
against a ledger that never issued it and the invariant would fail on the next
check. Ask the engine, take what it gives, credit exactly that.

### Sinks

| Sink | Amount | Where |
| --- | --- | --- |
| Bought from an NPC desk | ladder price | 25% routed by `shopBurnBps`, 75% to the desk reserve |
| Order creation | 1 per order | `orderbook.creationCost` |
| P2P taker fee | **0** on every in-game market | `takerBps`/`makerBps` are 0 by default |

The book is free to trade on. `C.ECONOMY.orderbook.feeBps = 200` exists and
`newMarket` does not apply it — the NPC desk's spread is the Gold sink, not the
book. `ECONOMY_MARKETPLACE_PLAN.md` §4.2 still describes a 2% seller fee; the
external deployment sets 30 bps and the in-game markets set none.

`routeGoldFee` only **burns** above 110% of the Gold target; below it the same
Gold accrues to `locked`. Either way it leaves player hands, and below target it
is what refills the reward pool.

### The launch allocation

| Holder | Gold |
| --- | ---: |
| Four berry desks | 8,000 each / 32,000 |
| Scroll desk | 8,000 |
| Rune desk | 50,000 |
| Locked — gameplay rewards and contingency | 210,000 |
| **Total issued** | **300,000** |

Previously 200,000 sat on the Rune desk against an **11,700** maximum payout,
because every desk's *stock cap* binds long before its Gold reserve. Measured
before the rework: of 300,000 Gold issued, only **~35,070 could ever reach a
player**. After: **~227,500**, most of it through the gameplay allowance.

### The one thing that is not sustainable yet

The reward pool is finite. At 168 accounts collecting the full 60 a day that is
~21 days of gross payout before recycling, and shop purchases return only 75%
of what passes through them (and only to the desk, not the pool).

What makes it sustainable is `policy.gold.expansionEnabled` and the weekly
target recomputation in `ECONOMY_MARKETPLACE_PLAN.md` §6.3. **That machinery
exists and ships off.** Turning it on is a launch decision, not a follow-up.

---

## 4. Scrolls

The hunt's capture ticket, and until recently an item **nothing in the game
consumed** — it was in the catalogue, in the asset ledger, on a market and
behind a 20,000-Gold desk, and no handler anywhere spent one.

| Faucets | | Sinks | |
| --- | --- | --- | --- |
| Daily crate | 12% | Hunt capture attempt | 1, win or lose |
| Ten-day crate | 1 guaranteed | | |
| Tier 4/5 crates | 1.5 / 2.5 | | |
| Launch shop stock | 25, once | | |
| NPC desk | bought with Gold | | |

Giving it a job closes the loop the economy was missing:

```text
play  ->  Gold  ->  buy a Scroll  ->  attempt a capture  ->  burn Rune
```

That is what makes Gold worth earning, gives the Scroll desk a reason to exist,
and puts a second consumable in front of the Rune sink so capturing is a
decision with a price rather than a Rune tap.

**`legendary_scroll` still has neither faucet nor sink.** It is a live item id
with a market and no way to obtain or spend one. Either give it a job or remove
it; leaving it is how the Scroll got into this state.

---

## 5. Rune

The scarce asset, the only thing that crosses the game boundary, and the only
asset whose supply is a published promise.

### The faucet — there is exactly one

`Daily.Claim`, via `M.claimRuneReward`. **48 Rune per account per 30 days**
(`C.ECONOMY.rune.emissionPerAccount`), accrued per **calendar day** and
collected on any worship.

- Calendar day, not per claim: worship runs on a 20-hour interval, so paying
  per claim would hand 36 payments an epoch instead of 30 — a silent 20% bonus
  for setting an alarm.
- The whole part is paid straight and **only the fraction is rolled**, keyed to
  `(address, day)` and never to the claiming message. Day N's outcome is fixed
  when day N happens, so there is no bad roll to decline by waiting and no
  claim to re-sign until it comes up good.
- Halves yearly on the **per-account rate**: 48, 24, 12, 6, 3, 1, 0. Lifetime
  is ~1,144 Rune per account, so **total supply is hard capped** at that times
  passes ever sold.
- `emissionPerEpoch` is a derived circuit breaker (`perAccount × (passes +
  100)`), not a divisor. It must never bind.

Nothing about playing more produces one extra Rune. That is the property the
whole schedule rests on.

### Sinks

| Sink | Amount | Where |
| --- | --- | --- |
| Level-up | `ceil(L²/16)` — 1 at L1-3, 9 at L12, 25 at L20; ~190 for a full climb | `C.levelUpCost` |
| Hunt capture bid | 1-3, spent win or lose | `C.HUNT.capture` |
| Store a companion to the collection | 1 | `C.ROSTER.storeCost` |
| Companion mint | 10 | `C.MINT` — **disabled** |
| The pass | not yet purchasable | `passes.purchaseEnabled = false` |

The core loop is **free**. Happiness already caps a companion at four actions
an hour; charging Rune on top meant zero Rune was zero gameplay with no route
back. Rune buys **advancement**, so demand is elastic — people who buy to get
further lift the price steadily, where people forced to buy to act at all gap
it and lock out the newcomer.

### What is NOT a sink

The companion market is Rune-priced and takes **no fee** — it is a pure
transfer between players, so it creates demand for Rune without consuming any.
Deliberate, and worth knowing when reading supply figures.

### Where it is not sound yet

- **The pass is priced in USD in code** (`launchPriceReference = 2500` cents,
  sqrt ratchet) while ECONOMY_V2 §5 calls Rune denomination non-negotiable —
  the maturity ramp was removed, so the pass now carries the entire sybil
  defence alone. At the shipped flat 48/account with no ramp, payback is **5.2
  months at $0.10 a Rune, not the 12.5** §8.9 models, and a dollar price gets
  *worse* as Rune appreciates. 250 Rune is the $25-at-$0.10 equivalent; a
  12-month payback needs ~576 and §5 says 672.
- **`economy-sim.mjs` models the pre-v2 design** — a 2,000 pot divided among
  claimants, the 0/50/100% maturity ramp, a 20/month cap. Its
  `assertScheduleMatchesContract` only checks `emissionPerEpoch`, which is now
  the non-binding breaker, so **the guard passes while the model is wrong**.
- **Nothing burns Rune on the token side.** In-game sinks decrement a number
  that was never minted, which bounds what can ever cross the bridge but creates
  no buy pressure outside. The mechanism for that is `policy.proceeds` routing
  30% of pass revenue into Rune acquisition, and it is off with pass sales.

---

## 6. The NPC desks

Finite counterparties that dampen dislocation. Not vending machines, not a
promise of redemption at a fixed price.

| | Berry ×4 | Scroll | Rune |
| --- | ---: | ---: | ---: |
| Gold reserve | 8,000 | 8,000 | 50,000 |
| Stock cap | min(400, max(300, 5% supply)) | min(300, max(150, 10%)) | min(250, 6%) |
| Opening stock | 50 | 25 | **0** |
| Opening quote | 5 / 12 | 40 / 90 | 60 / 120 |
| Per action | 100 | 10 | 5 |
| Per account / 20h | 250 | 25 | 10 |
| Global / side / 20h | 500 | 100 | 25 |

Three properties are easy to break and were:

**The desks open stocked.** Every desk used to be born with zero stock, which
paused its BUY side on "Desk is out of stock" — so on a fresh contract selling
was the only thing a player could do. The seed sits *just under* the first band
edge (50 of a 300 cap is 16.7%, and the top band runs to 20%) so the opening
quote is still the 5/12 the plan specifies. Seeding deeper opens it at 4/9
instead, which is a launch repricing wearing the costume of a shelf restock.

**The cap has a floor.** A share of outstanding supply is the right shape for a
grown economy and a disaster at launch: with a few players the cap was a dozen
units, so the price ladder spanned its whole band range inside a single
five-berry trade and the desk hit its stock cap almost immediately.

**The desk reprices after every single unit.** That is not a rounding detail —
selling five berries into a fresh desk bidding 5 pays **23, not 25**, because
the third unit crosses a band edge. Any client that multiplies a headline quote
by a quantity is wrong, and wrong in the direction that costs the player. The
published `market.depth` carries the desk's own levels with `house` counting its
units at each price; walk that.

**Rune is never seeded.** Seeding issues the item, and Rune's supply is the one
promise that cannot be quietly broken. The Rune desk stays empty until a player
sells into it.

---

## 7. What to check when changing any of this

1. **Does a verb now pay an item?** If yes, you have changed the rule at the
   top of this file, not tuned a number. Say so explicitly.
2. **Does the daily crate still fund ~2 hours?** `C.LOOT_TIERS[2]` is the
   number; `game_test.lua` asserts the range.
3. **Does the Gold invariant still hold?** `Economy.View` publishes
   `invariants.gold.ok`, and the suite asserts it after paying rewards.
4. **Did a walkthrough state the number you just moved?** See the walkthrough
   rule in [CLAUDE.md](CLAUDE.md). The tours state real prices and real odds.
5. **Did you write the number into a test?** State the rule over the constant.
   Three assertions in `game_test.lua` broke on unrelated balance work because
   they hardcoded a move count, a hit floor and a stat cap instead of reading
   `C.MOVE_SLOTS`, `Battle.TUNING` and `C.LEVEL_UP_MAX_PER_STAT`.
6. **Run them all.** `test:lua`, `test:economy:local`, `test:hunt`,
   `test:marketplace:local`, `test:rune`, `test:swarm`.
