# Rune economy v2 — the deployed design

> Supersedes the *rates* in [ECONOMY.md](ECONOMY.md) (§3 was speculative and
> largely unimplemented). The *structure* in
> [ECONOMY_MARKETPLACE_PLAN.md](ECONOMY_MARKETPLACE_PLAN.md) still stands except
> where §2 below says otherwise, and the one place it does is load-bearing —
> read that section before changing any number here.

## 1. The one sentence

**Rune emission is the only faucet, and everything else is downstream of it.**
Gameplay is free to *do* and costs Rune to *advance*. Items are metered per day,
not per battle. Real value lives outside the process, on the open market; the
in-game economy's job is to feed that market a bounded, knowable supply and to
burn more than it emits whenever anyone actually plays.

## 2. What changed from the plan, and why it matters

ECONOMY_MARKETPLACE_PLAN.md §8.7 says the pass-pricing model must account for
the fact that

> adding attacker passes **divides fixed reward pools rather than multiplying
> them**.

**v2 abandons the fixed pool for per-player emission.** That sentence is
therefore no longer true, and the pass price is now carrying the entire sybil
defence on its own. This is a deliberate trade, made because entry is paid: a
wallet is not free, so multiplying wallets multiplies cost as well as yield.

Two consequences that are not negotiable, because they are the only things
keeping the new model bounded:

- **The pass is denominated in Rune, not dollars.** See §5. A dollar-priced pass
  with a Rune-denominated yield has a fixed strike price above which farming is
  free money — and the whole point of this design is to push the price through
  that strike.
- **`minEmissionPerEpoch` stays GLOBAL.** Applied per player it is 1,217 Rune
  per player per year, forever, and supply is unbounded. This is the single line
  that decides bounded versus infinite.

## 3. The formula

With per-player emission `E` (Rune per 30 days) and a full-intensity player
burning `B` Rune per 30 days:

```
break-even active ratio = E / B
```

Above that fraction of passholders playing, the economy deflates and Rune
appreciates. Below it, it inflates. **The emission rate is the assumed
engagement rate** — that is the whole system, and every other number is
downstream.

`B` is ~240 at 8 actions/day, and that is a floor: level-ups and hunt bids sit
on top of it, so real burn is 280–320. A lower `B` is not safer, it just moves
the ratio; halve the burn and `E` must halve to hold the same engagement
assumption.

### Why the float matters more than the rate

An active player is *supposed* to run a deficit. At `E = 48` and 20% active,
four idle players hold 48 spare each and the active player's shortfall is 192 —
they balance exactly. The active player buys ~192 Rune per month from people who
would rather sell theirs.

That is the recurring revenue, arriving as buy pressure instead of an invoice,
and it is why **gameplay must never require Rune** (§6). Demand should be
elastic — people buy to *advance*, not to *exist* — because inelastic demand
gaps the price instead of raising it, and locks out the newcomer.

## 4. Emission

| | value | note |
|---|---|---|
| `E` per player per 30 days | **48** | assumes 20% of passholders play at full intensity |
| paid as | **~1.6/day, daily drip** | accrues per calendar day, collected on any worship |
| free play at `E` | ~24 min/day | the floor; nobody is ever fully locked out |
| global epoch ceiling | derived, non-binding | a circuit breaker, not a divisor |
| `minEmissionPerEpoch` | 100, **global only** | see §2 |
| `minEmissionPerAccount` | **0** | the schedule TERMINATES in year 6; supply is hard capped |

Per-player emission removes the population divisor entirely, and with it the
launch-window bug where `emissionPopulation()` fell through to 1 and paid a
newcomer floor of 500 Rune — a quarter of the monthly pot in one claim.

**The halving applies to the per-account rate**, not to the pot. Applying it
only to the ceiling — which is what happened first — left the rate flat forever
*and* started strangling the game, because a 2,000 ceiling pays 48 to 41
accounts and 20 after one halving.

| year | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|---|
| Rune/epoch | 48 | 24 | 12 | 6 | 3 | **0** |

Lifetime is `12.17 × (48+24+12+6+3+1)` ≈ **1,144 Rune per account**, so total
supply is **hard capped** at that times passes ever sold — nothing about time
passing can add to it. Emission ends in year six, not the eighth `maxHalvings`
allows, because integer halving reaches zero first.

Accepted, and worth revisiting before it arrives: an account created after year
six earns nothing from the faucet ever, and buys Rune from someone who has it.
That is the end state this design points at anyway, but it means the secondary
market has to actually exist by then. `minEmissionPerAccount = 1` floors the
schedule instead of ending it (~12 Rune/year forever), trading the hard cap for
a newcomer who always has somewhere to start.

### The drip

Accrual is keyed to the **calendar day**, never to the worship claim. Worship
runs on a 20-hour interval, so paying per claim would hand 36 payments per
30-day epoch instead of 30 — a silent 20% bonus for setting an alarm.

The whole part of each day is paid straight and **only the fraction is rolled**.
Rolling the whole amount lets an account come up empty for a week — `0.6^7` is a
2.8% chance of nothing at all, landing on the people likeliest to leave.
Fractional-only keeps the swing to one Rune: you get 1 or 2, never nothing.

The roll is keyed to `(address, day)` and **never to the claiming message**.
Day N's outcome is fixed the moment day N happens, so collecting on day 30 pays
exactly what collecting on day 3 would have. That is what closes both attacks
without the roll needing to be secret: nobody can decline a bad roll by waiting,
and nobody can re-sign a claim until it comes up good. `M.dayRollBps` is a
marked placeholder — a replacement must keep the `(address, day)` key, because a
"more secure" source that reads the message id would be strictly worse.

### No maturity ramp

§8.6's 25% / 50% / 100% ramp by account age is **removed**. It existed to make a
fresh farm wallet earn a quarter rate while wallets were free to create; they
are not free any more, and what the ramp actually cost was the honest newcomer's
first week. A fresh account earns the full rate from day one.

This hands the entire sybil defence to the pass price — so if the pass ever
stops tracking the Rune price (§5), this is one of the things that was holding
the line and no longer is. `maturityBps` still ramps NPC **desk quotas**; that
is a separate surface and is untouched.

## 5. The pass

**Price the pass in Rune.** Payback is `passPrice ÷ (E × runePrice)`; denominate
the price in Rune and the price term cancels, so **payback is invariant** at any
valuation, forever, with no maintenance.

| | value |
|---|---|
| pass price | **672 Rune** (14 months × `E`) |
| payback period | 14 months, invariant |
| USD price | `672 × runePrice`, floating |

A manual USD ratchet is the same mechanism with a lag, and every pass sold
during the lag is permanently underpriced — §8.8 locks that an existing holder
is never re-charged, so those mistakes are forever. There is no third option
where the dollar price is stable *and* payback holds; those are the same
variable.

Settlement is a separate choice from denomination. `policy.proceeds` already
splits `{team 50%, rune 30%, treasury 20%}` — take the payment, route 30% into
Rune, and the pass is both revenue and a sink in the proportion already decided.

**Accepted, explicitly:** a one-time pass with perpetual emission makes every
idle pass a perpetual annuity on a single payment. At ten years an idle farm has
drawn ~2,400 Rune for one purchase. Only per-player decay, recurring payment, or
a fixed pot closes that, and v2 chooses none of them. It is defensible at a 12:1
burn-to-emission ratio, but it is a choice, not an oversight.

## 6. Free to play, paid to advance

Rune stopped doing the clock's job. The timer already caps actions per hour;
charging Rune on top made zero Rune mean zero gameplay, which is the one
lockout this design cannot have.

| Free (gated by energy/happiness only) | Rune-priced |
|---|---|
| Arena entry and battles | Level-up |
| Quest | Hunt capture bid (1–5) |
| Play, feed | Roster store, mint |
| | Skins / cosmetics *(v3)* |
| | The pass |

Quest `expGain` rises 1 → 7 in the same change. At 1 exp per hour against the
arena's measured 6.84 exp in two minutes, the tutorial verb was strictly
dominated on every axis — the trap option, and the one a new player reaches for.

## 7. Items are metered per day, not per battle

This is the change that kills 24/7 botting.

| | before | after |
|---|---|---|
| item source | every battle win | the daily worship box |
| bot playing 24/7 | ~4,300 berries/day | **19 berries/day** |
| human playing 2h | ~360 berries/day | **19 berries/day** |

One tier-2 box yields `4 × 0.95 × 5` = 19 berries. An action costs 2.75 (one
berry for the Play, plus 35 energy at 20 per own-element berry). So one box
funds **~7 actions ≈ 1.75 hours** — the target, reached from the other side.

Battle loot becomes a trickle sized to what an action consumes, so playing is
roughly break-even in items rather than a 20:1 surplus engine. To play *more*
than the daily box allows, buy items from another player — which is how Rune
converts into playtime through the market without ever being required to play.

**Battle loot cannot become item-positive until the timers are long (v3).** At
15-minute timers a per-battle surplus is a bot subsidy: 96 actions/day against a
human's 16.

### The streak pays the crate

`dailyStreak` was fully tracked — counted, broken after `breakAfter`, preserved
across `Admin.Load` by `max()`, bucketed for the `Checkins` census, published in
the receipt — and paid **nothing**. `streakTiers` was `{}`.

| streak | crate |
|---|---|
| 1–2 | 1 × tier 2 |
| 3–9 | 1 × tier 2 + 1 × tier 1 |
| 10+ | 1 × **tier 3** |

Crates rather than Rune, and the split is deliberate: Rune is the faucet, so it
is flat and daily and nothing about returning more often may raise total
emission. Crates are berries, which are consumed rather than banked, so scaling
them rewards the habit without touching supply — and a streak is wall-clock
bound and resets on a miss, which is the one thing a bot cannot compress.

**The tier-3 crate is doing a second job.** No handler had ever issued a box
above tier 2, so `scroll` — gated at `minBox 3` — had no organic supply at all
and tiers 3–5 were dead config. This is that emitter, metered by the calendar
rather than by playtime.

## 8. Ordering — several of these are only safe in sequence

1. **Berry yield negative first.** Free core loop + 20:1 berry yield + open desks
   = a mint. One arena entry currently yields ~45 berries ≈ 225 gold against a
   Rune worth 60 gold at the desk bid — already 3.75× profitable *while* costing
   a Rune. Remove the Rune before fixing the yield and a 24/7 bot clears ~180
   Rune/day.
2. **Then** free the core loop.
3. **Then** loosen the desk flow caps. The 2%-per-epoch cap looks like a lockout
   bug and currently is not — it is the only thing bounding the drain in (1).
4. **Then** run `reconcile-rune-supply.mjs` and load the recovery set.

## 9. Launch blockers carried from the audit

- **`rune.lua` `H["Mint"]` has no idempotency guard.** It credits and increments
  `TotalSupply` unconditionally; `Reference` is echoed, never used as a key. The
  handler's own comment records the incident — a retry turned 80 deducted Rune
  into 224 minted. The no-credit-notice fix removed one *cause* of retries, not
  the vulnerability. This is the bridge, which is where real value is created,
  so it is the highest-stakes line in the repo.
- **`consumed30` counts transfers as burns**, so the per-account cap is
  self-raisable at zero cost via Market.Buy, Withdraw, Bond and every refund
  path. 24% of one epoch's issuance was cap credit.
- **Signup grants 6 tier-1 boxes, not 3** — `Faction.Join` grants
  `C.STARTER_LOOTBOXES` and the inline adopt branch grants three more.

## 10. Deferred to v3

Timer lengths and the hunt-as-expedition rework, queue depth, monster rarity
tiers, skins.

**Long timers are the strongest anti-bot lever available**, and they are what
makes an item-positive loop safe. Bot advantage is `hours-present ÷
human-hours-present`, capped by how often the timer fires:

| timer | bot actions/day | human (4 check-ins) | bot edge |
|---|---|---|---|
| 15 min | 96 | ~16 | **6×** |
| 1 hour | 24 | ~8 | 3× |
| 6 hours | 4 | 4 | **1×** |

Once the timer is slower than a human's natural check-in rate, presence buys
nothing. **But long timers need queueing**, or they punish the person who sleeps
and reward the bot that restarts instantly at hour six. Queue depth is the real
anti-bot constant.

**Monsters are the store of value**, and the layer is half-built. The exp curve
is already an excellent scarcity engine and should not be flattened — at ~27
exp/day, level 12 is 22 days, level 16 is 5 months, level 20 is ~3 years. That
gradient *is* the value ladder. `ROSTER.max = 1` is the strongest scarcity
property in the game: exp only reaches the active companion, so a high-level
monster is exclusive sequential investment that cannot be farmed in parallel.
What is missing is **rarity** — all 93 species in
`monster-index.generated.lua` carry `entryNo`, stats and moves and **no rarity
field at all**, so "rare monster" has no referent. Add it, and let tier-3+ boxes
be its source; those tiers are currently dead config, which is also why `scroll`
(gated at `minBox 3`) has never had an organic faucet.

## 11. Note only — faction wars

**No action in v2 or v3. Recorded so the design is not re-derived.**

Four factions each sacrifice `C`; the winner takes `0.75 × 4C`. Per player: win
`+2c`, lose `−c`, at 1-in-4 odds → **EV = −0.25c**, exactly the burn. A fair
lottery with a 25% rake, and the rake is the deflation.

Three things follow:

- **The prize cannot be the same items back.** At −25% EV nobody rational enters
  to win back berries. Pay in something unbuyable — which makes faction wars the
  **rare-lootbox emitter** the design otherwise lacks: periodic, competitive, and
  it consumes common items to produce rare ones.
- **Score per capita, not per faction total**, or the largest faction wins every
  cycle and the other three stop entering.
- **It is the only sink that scales with population automatically**, which is the
  natural counterweight to per-player emission.

It fits cleanly because factions currently do nothing mechanically — constants.lua
is explicit that there are "no passives and no buffs, and there never were" — so
there is no existing balance to disturb.
