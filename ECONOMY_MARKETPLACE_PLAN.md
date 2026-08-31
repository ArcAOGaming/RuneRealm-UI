# Rune Realm economy, marketplace, and shop plan

**Status:** canonical product plan; implemented for TEST deployment with open
launch decisions explicitly paused/configurable
**Last updated:** 2026-08-30

This file preserves the decisions for the next economy build. If an older
proposal in [ECONOMY.md](ECONOMY.md) or a description of the current system in
[MARKETPLACE.md](MARKETPLACE.md) conflicts with this file, this file is the
planned direction. Repository and engineering rules in [CLAUDE.md](CLAUDE.md)
still take precedence.

The labels used below are intentional:

- **Locked** is a product or architecture decision.
- **Initial default** is the best launch setting before real-player data exists.
- **Open** must be decided or measured before release.

Nothing in this document authorizes a partial production deployment. The
market, shop, supply accounting, administration controls, and circuit breakers
are intended to launch together. The implementation may be built in dependency
order, but that is not a staged economic rollout.

---

## 1. Outcomes and boundaries

### 1.1 Economic outcome

**Locked:** Rune is the scarce asset players want to earn, collect, use, and
trade. Gold is not the investment asset. Gold is internal monetary plumbing
that lets players exchange game goods without using Rune for every small trade.

The economy should produce these pressures:

1. Gameplay and paid participation create demand for Rune.
2. Rune issuance is globally bounded and knowable, rather than multiplied by
   the number of wallets.
3. Berries and scrolls remain liquid enough to trade but cannot be farmed into
   unlimited Gold through the game shop.
4. The P2P market determines real player prices.
5. The game shop dampens temporary extremes without promising a permanent
   price floor or ceiling.
6. A player may arbitrage the P2P market against the game shop when a genuine
   price difference exists. That is useful price correction, not an exploit.
7. No closed loop using only the game shop can produce a profit.

The threat model is economic, not based on believing players will behave as
intended. Every faucet, reserve, price, limit, and pause must remain safe when a
player deliberately tries to drain it.

### 1.2 What can leave the game

**Locked:** Rune is the only game-owned item that can cross the game boundary.

- Rune may move between the game balance and the separate Rune token.
- Gold never leaves the game.
- Berries and scrolls never leave the game.
- Companions remain game records. They cannot be minted out, withdrawn as an
  Arweave asset, deposited, or returned from an external collection for now.
- Quote is an external payment/pairing token, not a game inventory item.

Existing companion-asset, collection-deployment, mint-worker, character
creator, and customiser code stays in the repository but is parked. It must be
disabled and excluded from normal deployment, with a source note explaining
that the feature is intentionally inactive. There are no stuck companion mint
jobs to migrate or settle, so the build must not invent such a migration.

### 1.3 On-chain paid participation

**Locked:** all player payments happen on-chain. Gold payments and trades are
signed state transitions in the on-chain game process; Rune and quote payments
settle through their on-chain contracts. Paid access and booster packs also use
an on-chain payment asset. There is no off-chain balance or payment rail in this
economy plan. The plan only needs to know the resulting on-chain proceeds and
does not specify the separate purchase interface.

The game is intentionally somewhat pay-to-play. Paid participation may buy
access, collectibles, convenience, or bounded acceleration. It must not create
an unlimited route from payment to withdrawable Rune or guaranteed Gold profit.
Any paid, sellable item must enter the same supply ledger and shop limits as an
earned copy of that item.

**Open:** exact pack contents, pack odds, paid access price, accepted on-chain
payment asset, and whether any pack contents affect gameplay. Until those are
decided, do not assume packs are cosmetic-only and do not assume they contain
power.

---

## 2. Process architecture

### 2.1 Game monolith

**Locked:** `backend/native/game.lua` becomes the authority for:

- player inventories and Gold balances;
- companions and the companion market;
- the P2P goods order book and its escrow;
- the game shop, stock, Gold reserves, and trade history;
- Gold and item supply ledgers;
- economic configuration, pauses, and published dashboard state.

The standalone `backend/native/marketplace.lua` process is removed from the
deployment and its wanted behavior is baked into the game monolith. Its source
can be deleted once all wanted behavior and tests have moved. The UI must not
send a game-owned trade out to a second process and wait for it to come back.

### 2.2 Contracts that remain separate

**Locked:** only these economy contracts remain separate Lua processes:

- `rune.lua` — the Rune token;
- `quote.lua` — the quote token used for the test/real pairing as configured;
- `amm.lua` — the Rune/quote automated market maker.

They remain separate because their balances and settlement exist outside the
game. All unreleased deployments retain the required `TEST-` naming.

### 2.3 Reads and reconciliation

The admin dashboard reads published game state and published Rune-token state
independently. It does not add a cross-process read-message round trip.

The game records what should have crossed the Rune bridge. The token's
published `totalsupply` records what actually exists outside. A mismatch pauses
the Rune side of the shop and bridge-sensitive actions until reconciled; it does
not silently edit a player's balance.

---

## 3. Assets and trading pairs

| Asset | P2P settlement | Game-shop desk | Can leave game? |
| --- | --- | --- | --- |
| Air, Water, Fire, Rock Berry | Gold | Buy and sell | No |
| Scroll | Gold | Buy and sell | No |
| Legendary Scroll | Gold | No at launch | No |
| In-game Rune | Gold | Buy and sell, tightly bounded | Yes, through Rune bridge |
| Companion | In-game Rune | No | No |
| Gold | Unit of account | Shop reserve currency | No |

**Locked:** Legendary Scroll is P2P-only until it has clear game utility and
enough observed supply to price honestly. The NPC must not establish a large
guaranteed bid for an item with no meaningful sink.

The companion market remains priced in Rune. Moving it to Gold would remove one
of the strongest direct reasons to want Rune.

---

## 4. The P2P marketplace

### 4.1 Order model

**Locked:** the goods market is a two-sided limit-order book.

- A sell order escrows the item quantity.
- A buy order escrows the full Gold commitment.
- Orders support partial fills.
- Matching and settlement are atomic inside `game.lua`.
- Cancelling returns the remaining escrow.
- Self-trading is rejected.
- A refusal changes no balance, inventory, escrow, history, or counter.
- Prices and quantities are positive integers.
- Order and fill history is bounded so permanent state cannot grow without
  limit.

The initial matching policy should be price-time priority. A taker receives the
best available price, and an older order wins when prices are equal.

### 4.2 Initial limits

These are **initial defaults**, adjustable within admin policy bounds:

- Maximum 20 open orders per account.
- Maximum 2,000 open orders globally.
- Minimum order value: 10 Gold.
- Maximum unit price: 1,000,000 Gold as an overflow/state-abuse guard, not an
  economic price opinion.
- One-Gold non-refundable order-creation cost.
- Orders expire after 30 days and are cleaned up lazily on market activity or
  bounded maintenance work.
- P2P fee: 2% of seller proceeds, using deterministic integer rounding.

The creation cost and fee make wash activity expensive. Self-trade rejection
and the fact that trading volume never causes Gold issuance make it unable to
print a monetary expansion signal.

### 4.3 Market data

Publish bounded data for:

- best bid and ask;
- depth near the spread;
- 24-hour and 7-day volume;
- 7-day and 30-day median execution price;
- unique makers and takers;
- rejected and paused actions by reason.

The game shop must not mechanically follow the last P2P trade. Two controlled
wallets can manufacture a last trade. Longer medians are diagnostic inputs for
admins, not an automatic quote oracle.

---

## 5. The game shop

### 5.1 What the shop is

**Locked:** the shop is a finite NPC counterparty designed to keep the P2P
market from remaining wildly dislocated. It is not an infinite vending machine,
an infinite buyer, or a promise that an item is redeemable at a fixed price.

- When a player sells an item, the shop loses Gold and gains that exact item.
- When a player buys an item, the shop loses that exact item and receives Gold.
- Trading never creates the item being sold.
- Trading never creates Gold.
- Shop inventory refills only when players sell to it.
- Shop Gold reserves refill from player purchases and explicitly authorized
  monetary expansion.
- There is no timed or synthetic item restock.
- Batch trades cross stock bands one unit at a time. Splitting one trade into
  many transactions cannot improve the total execution price.

The shop bid is always below its ask. P2P fees, shop spread, and the Gold burn
ensure a player cycling through the shop alone loses value.

### 5.2 Initial price ladders

Prices are Gold per item. These are **initial defaults**, not permanent pegs.

#### Each berry type

The launch stock cap is the lower of 400 or approximately 5% of that berry's
tracked total supply. With current recovered totals near 7,000 of each berry,
the initial cap is about 350–400 each.

| Shop stock | Shop buys at | Shop sells at |
| ---: | ---: | ---: |
| 0–79 | 5 | 12 |
| 80–199 | 4 | 9 |
| 200–299 | 3 | 7 |
| 300–399 | 1 | 5 |
| At cap | Paused | 5 |

If the calculated supply-relative cap is below 400, the bands scale
proportionally and retain the same prices.

#### Scroll

The stock cap is the lower of 100 or 10% of tracked supply. The desk remains
paused if reliable total supply is unavailable.

| Shop stock | Shop buys at | Shop sells at |
| ---: | ---: | ---: |
| 0–9 | 250 | 600 |
| 10–39 | 225 | 500 |
| 40–79 | 175 | 400 |
| 80–99 | 100 | 300 |
| At cap | Paused | 250 |

Supply-relative bands scale down when the cap is below 100.

#### Rune

The Rune stock cap is the lower of 250 or approximately 6% of total accounted
Rune. At the recovered 4,200 in-game Rune, that is approximately 250.

| Shop stock | Shop buys at | Shop sells at |
| ---: | ---: | ---: |
| 0–24 | 1,000 | 2,000 |
| 25–74 | 900 | 1,700 |
| 75–149 | 800 | 1,500 |
| 150–249 | 650 | 1,250 |
| At cap | Paused | 1,100 |

The sell side is unavailable at zero stock. If player demand carries Rune above
the shop ask, arbitrageurs will empty the finite stock and the P2P market is then
free to rise. If Rune falls below the bid, arbitrageurs can sell into the desk
only until its inventory or Gold limit is reached. This is a shock absorber,
not a permanent Rune peg.

### 5.3 Initial trade limits

Each limit is per side; buying does not consume the selling allowance.

| Item | Per action | Per account / 20h | Global / side / 20h |
| --- | ---: | ---: | ---: |
| Each berry type | 100 | 250 | 500 |
| Scroll | 5 | 10 | 25 |
| Rune | 5 | 10 | 25 |

These limits exist even when the shop has enough inventory and Gold. They bound
the damage from a bad price before a pause or administrator response lands.

### 5.4 Automatic pauses

Only the affected desk or side pauses when possible:

- Buy side pauses at the item stock cap.
- Buy side pauses when its allocated Gold reserve cannot fund the next unit.
- Sell side pauses at zero item stock.
- Both sides pause on an item-supply invariant failure.
- Rune pauses on a game/token/pending reconciliation mismatch.
- A desk pauses after more than 2% of the item's tracked supply passes through
  it in one policy epoch.
- A desk pauses when its configured global quantity limit is reached.
- All shop desks pause if the Gold invariant fails.

P2P trading remains available when an NPC desk runs out of inventory or Gold.
It pauses only when safe ownership or escrow accounting cannot be proven.

---

## 6. Gold monetary policy

### 6.1 Fixed launch supply, controlled long-term supply

**Locked:** Gold does not have a permanently fixed 300,000 lifetime supply. A
forever-fixed supply would reward early hoarding, starve a growing population,
and eventually freeze small trades. Gold also does not increase per signup,
because that would make wallet creation a faucet.

**Initial default:** 300,000 Gold is issued at launch. No player receives a
starter allocation. It begins in named shop/policy reserves:

| Allocation | Launch Gold |
| --- | ---: |
| Rune stabilization desk | 200,000 |
| Four berry desks | 5,000 each / 20,000 total |
| Scroll desk | 20,000 |
| Locked contingency allocation | 60,000 |
| **Total** | **300,000** |

The contingency cannot be spent until assigned through the delayed policy
mechanism. It is included in issued Gold and in every invariant.

At these prices, 300,000 Gold should support roughly 100–150 qualified monthly
active players comfortably and perhaps 200–300 with increasingly thin
liquidity. It is not enough for 1,000 economically active players.

### 6.2 Gold target

The initial monetary target is:

```text
target_gold = max(
  300,000,
  stabilization_reserve_requirement
    + 1,000 × qualified_30_day_active_player_equivalents
)
```

The initial stabilization requirement is approximately 180,000–200,000 Gold.
It is derived from permitted shop inventory exposure, not from pretending the
shop could buy every item in existence.

Indicative scale, using a 180,000 reserve requirement:

| Qualified monthly players | Approximate Gold target |
| ---: | ---: |
| 100 | 300,000 floor |
| 150 | 330,000 |
| 500 | 680,000 |
| 1,000 | 1,180,000 |
| 5,000 | 5,180,000 |

A qualified active-player equivalent comes from real, non-market gameplay over
multiple days and is capped per account. Creating an account, claiming, moving
tokens, listing, cancelling, or trading does not qualify. The exact qualifying
activity thresholds are **open** and must be tested against the final game
loops before implementation.

Player count sets a ceiling; it does not itself mint Gold. Expansion also
requires sustained economic need. P2P volume and P2P last price are never
expansion triggers because both can be wash-manufactured.

### 6.3 Expansion rules

**Initial defaults:**

- Recompute the target weekly from rolling 30-day measurements.
- Require the higher target to persist through two weekly observations before
  authorizing expansion.
- Release no more than 5% of current outstanding Gold per seven days.
- Enforce an absolute contract limit of 10% per seven days even if an admin
  changes the normal dial.
- Send new Gold only to an underfunded shop reserve, never directly to players.
- Do not add reserve to a desk whose inventory is already at its cap.
- Publish the calculation, authorization, destination, and resulting supply.

An initial protocol ceiling of **20,000,000 Gold** is the recommended hard
backstop. Only issued Gold exists economically; the unused ceiling is not a
balance held by an administrator. At the initial 1,000-Gold working target, the
backstop covers roughly 20,000 monthly active players. Exceeding it requires an
explicit contract/policy upgrade rather than an admin dial.

### 6.4 Burns and contraction

**Initial defaults:**

- Shop sales remove 25% of gross Gold and return 75% to that desk's reserve.
- The 2% P2P seller fee and one-Gold creation cost remove Gold.
- Below 90% of the current target, burning stops and fees accumulate in a
  locked policy reserve.
- From 90% through 110% of target, monetary policy is neutral.
- Above 110%, normal burns operate.
- No player balance is confiscated when population or target falls.

Contraction therefore happens through voluntary economic activity. Dormant or
hoarded Gold remains part of outstanding supply; the controller must not print
against supposedly inactive balances and then discover that a whale can return
and spend both supplies at once.

### 6.5 Gold invariants

At every state transition:

```text
gold_issued - gold_burned
  = player_balances
  + p2p_buy_order_escrow
  + shop_gold_reserves
  + locked_policy_reserves
```

And:

```text
gold_issued <= current_authorized_supply <= protocol_ceiling
```

There is no generic admin `Grant Gold` action. Corrections use explicit,
audited reconciliation paths that preserve these equations.

### 6.6 Gold supply and prices are separate controls

Shop prices do not rise merely because total Gold rises. If Gold and the real
player economy both grow by 10%, multiplying every price by 10% would manufacture
inflation. Item prices respond to that item's supply, shop stock, consumption,
and longer-term player trading. Gold issuance responds to economy-wide need.

Rune remains scarce because Gold expansion does not create Rune. With more
players competing for bounded Rune, Rune can become harder to acquire even
while ordinary berry trading remains liquid.

---

## 7. Exact supply accounting

### 7.1 Every internal item

For each berry type, Scroll, Legendary Scroll, Rune, and Gold, maintain
incremental counters for:

- ever issued;
- ever consumed or burned;
- held by players;
- held in P2P escrow;
- held by the shop;
- issued and consumed over rolling 7-day and 30-day windows.

For every non-Gold item:

```text
ever_issued - ever_consumed
  = player_inventory + p2p_escrow + shop_stock
```

Trades and transfers change buckets but never change total supply. Loot,
rewards, paid packs, and administrative restoration are explicit issuance
sources. Feeding, crafting, game costs, and other destructive actions are
explicit consumption sources.

### 7.2 Rune inside and outside the game

Track both views:

```text
actual_liquid_rune
  = in_game_rune + token_total_supply
```

```text
accounted_economic_rune
  = in_game_rune
  + token_total_supply
  + deducted_but_not_minted_withdrawals
  + burned_but_not_credited_deposits
```

Also reconcile accounted Rune against `Rune ever earned - Rune consumed`.
Withdrawals and deposits move Rune between buckets; they do not create an
additional economic Rune.

The Rune shop stock cap uses total accounted Rune, including the outside token
and pending bridge states. Moving Rune outside must not trick the game into
believing supply disappeared and raising its bid.

### 7.3 How total supply affects shop policy

Tracked total supply is a core input, but it does not create a guaranteed bid
for the entire supply.

- Shop stock caps are a small percentage of total supply.
- A sudden issuance spike can lower bids, shrink the permitted stock fraction,
  or pause a desk.
- Use 30-day average supply and consumption for slow anchor changes so a player
  cannot burn or move inventory for one block and manipulate a quote.
- Long-term anchor changes default to at most 5% per seven days.
- Gold reserve budgets do not expand automatically merely because more of an
  item was issued.

### 7.4 Supply-per-player price anchor

**Locked:** total item supply and economic player population directly influence
the shop's slow price anchor. Shop stock then determines the short-term point on
the bid/ask ladder. This separates long-term scarcity from momentary NPC
inventory pressure.

For every item `i`, record a launch reference:

```text
launch_abundance_i = launch_total_supply_i / launch_policy_population
```

`genesis_pass_count` is the 168 recovered paid legacy players plus the final,
deduplicated set of promised passes described in section 8.10. Until the real
qualified population exceeds it, that genesis count remains the denominator
floor. This prevents an empty launch month from making every recovered item
appear artificially abundant.

Each weekly policy calculation uses:

```text
current_abundance_i
  = 30_day_average_total_supply_i
    / max(genesis_pass_count, 30_day_qualified_player_equivalents)

scarcity_ratio_i = launch_abundance_i / current_abundance_i

next_anchor_i
  = launch_anchor_i
    × scarcity_ratio_i ^ item_elasticity_i
    × gold_density_adjustment
```

`gold_density_adjustment` compares actual Gold per policy player with the Gold
target per policy player. It remains near 1 when Gold expands correctly and is
bounded so a short-term Gold imbalance cannot reprice the entire shop.

**Initial elasticity defaults:**

| Item | Elasticity | Reason |
| --- | ---: | --- |
| Each berry | 0.35 | Prices respond slowly; berries must remain obtainable for ordinary play. |
| Scroll | 0.60 | Scarcer than berries but still a usable game resource. |
| Rune | 1.00 | Per-player scarcity expresses itself fully; Rune is the scarce asset. |

Legendary Scroll has no NPC anchor at launch. Its P2P market supplies discovery
until utility and supply are known.

The calculated anchor does not instantly become a quote:

1. Use 30-day averages for supply and player population.
2. Limit normal anchor movement to 5% per seven days.
3. Apply the current shop-stock band around that anchor: low stock raises both
   bid and ask to attract sellers and deter buyers; high stock lowers both to
   deter sellers and clear inventory.
4. Round to positive integer prices deterministically.
5. Pause rather than quote if totals fail reconciliation or change outside the
   configured issuance envelope.

The initial price tables in section 5 are the launch result at a scarcity ratio
of 1. Future tables are those prices multiplied by the slow anchor factor,
subject to the same finite reserves, quantities, bands, and pauses.

The qualified-player denominator is not raw wallets. It counts paid/unlocked
players with qualifying non-market play over multiple days, using only on-chain
state. Market listings, transfers, trades, and claims do not qualify. Player
growth may move the slow anchor only after the rolling window and weekly rate
limit. This makes opening wallets or wash-trading an uneconomic way to push the
shop's Rune bid upward.

A pass purchase alone also does not move a quote. For item `i`, population
pressure must be confirmed by distinct paid accounts performing real game
actions that consume or require that item. Irreversible item sinks are the
strongest confirmation because manufacturing the signal destroys resources.
The qualified population is a ceiling on price pressure; confirmed gameplay
demand determines how much of that ceiling may be used.

Supply per player is not the only safety input. A growing item supply without
matching consumption lowers its price; a growing population without matching
item supply raises it. If both grow proportionally, its Gold price stays near
the launch anchor. That is the intended stabilizing behavior.

### 7.5 Accessibility versus scarcity

The shop should guide different assets differently:

- Berry and Scroll bands are relatively close to gameplay affordability and
  have low elasticity. Their purpose is availability and clearing excess stock.
- Rune has the strongest supply-per-player response, the largest Gold reserve,
  no synthetic restock, and finite inventory. Its purpose is to be scarce and
  valuable, not continuously available at a fixed NPC price.
- If the Rune shop empties, it stays empty until a player sells Rune. The P2P
  price is allowed to rise.
- Global Rune rewards and the purchased Rune Reward Reserve must provide enough
  flow for the game to remain playable. The NPC does not solve playability by
  printing cheap Rune.

The shop can guide and dampen P2P prices, but it cannot manufacture real value.
Rune's durable value comes from bounded issuance, companion and gameplay
utility, more players competing for the same supply, and recurring on-chain
proceeds purchasing existing Rune from the external AMM.

---

## 8. Rune policy and on-chain revenue loop

### 8.1 Rune scarcity

**Locked:** replace per-wallet Rune stipends with a fixed global emission
budget. A million wallets must divide a fixed amount rather than multiply the
amount emitted. Distribution can reward sustained play and progression, but
wallet count cannot increase global Rune creation.

**Open:** the exact daily/epoch Rune budget, weighting curve, eligibility bond,
and newcomer floor. These numbers require a simulation against quest, arena,
hunt, and new-player costs. Until set, do not retain the existing per-wallet
1/2/3 Rune stipend as the launch policy.

Companions continue to trade for Rune. Rune remains usable for game actions and
can be brought into the game from the token. This supplies organic utility in
addition to speculation.

### 8.2 Paid proceeds and Rune acquisition

**Locked mechanism:** part of on-chain paid proceeds goes to the team and part
is used to acquire Rune through the Rune/quote AMM. Purchased Rune goes into a
separately accounted, publicly visible **Rune Reward Reserve** inside the game.
It funds rewards by recycling existing Rune rather than minting replacement
Rune.

**Initial allocation guess:** apply the following to available on-chain
proceeds after unavoidable protocol costs and reversals:

- 50% team and operations;
- 30% Rune acquisition;
- 20% treasury/liquidity/risk reserve.

The percentages are admin-policy dials with public history, not hidden wallet
behavior. The quote faucet used in testing cannot create real pressure; the
live mechanism needs an on-chain asset with actual value and a funded Rune pair.

### 8.3 AMM execution controls

**Initial defaults:**

- Aggregate the Rune-acquisition budget rather than buying after every pack.
- Maximum 1% estimated price impact/slippage per swap.
- Spend no more than 5% of the pool's quote reserve over seven days.
- Split execution and carry unspent budget forward when liquidity is thin.
- Every swap uses a minimum output and deadline.
- Publish quote spent, Rune received, average execution price, and Rune Reward
  Reserve balance.

The Rune-acquisition program is itself a bot target. Do not use the pool's
instantaneous spot price as a fair-price oracle and do not submit a predictable
large purchase immediately after every pass or pack. Use a time-weighted
reference, strict execution range, small bounded clips, and skip execution when
the pool has moved outside policy. Publish the allocation rule and completed
receipts without advertising the exact size and time of the next market order.

The program is a transparent purchase rule, not a guaranteed Rune price, return,
or permanent floor. The game shop and the external AMM must never pretend to
guarantee each other's quotes.

### 8.4 Paid-pack economic safety

The exact contents are open, but these constraints are locked:

- Packs never directly mint Gold.
- Packs never directly mint withdrawable Rune.
- A sellable pack item enters total supply and can make its NPC bid fall or
  pause like any earned item.
- No pack promises guaranteed redemption at the game shop.
- Duplicate conversion cannot bypass Gold or Rune issuance policy.
- Paid advantage, if any, is bounded by game timers, global rewards, inventory
  sinks, and shop limits rather than scaling without limit with spend.

This preserves the intended slightly pay-to-play character without creating a
cash-to-NPC extraction loop.

### 8.5 Eternal Pass and economic identity

**Initial default:** require an on-chain paid **Eternal Pass** for a full
economic account. This is the primary Sybil cost. The economy has no external
identity or Sybil gate: no X requirement, proof of personhood, IP limit, device
fingerprint, CAPTCHA, or claim that one account represents one human. Those
mechanisms are outside the economic model and must not increase emissions, shop
limits, Gold authorization, maturity, or price weight.

Bots are permitted economic participants. They must buy the same pass, lock the
same capital, pay the same fees, mature through the same on-chain game actions,
and compete for the same globally bounded rewards as everyone else.

The pass should be purchased with the configured external on-chain payment
asset, not Gold. Paying with Rune alone recycles the asset the attacker is
trying to extract and does not bring new outside value into the Rune-purchase
loop.

One pass represents one economic identity:

- Progression, reward history, market limits, shop limits, maturity, and risk
  flags attach to the pass/account identity, not merely the current wallet.
- Changing the controlling wallet never resets a timer, quota, order cost, or
  reward history.
- **The pass is non-transferable.** There is no pass marketplace, sale action,
  approval, delegation, rental, or transfer endpoint.
- Legacy paid wallets receive the equivalent entitlement without being charged
  again.

Non-transferability prevents a secondary market from bypassing the current
monotonic pass price and Rune-acquisition allocation. It also prevents a bot
from trustlessly buying an already mature entitlement instead of paying and
aging a new one.

Cryptographic account recovery is separate from pass transfer. A player may
pre-register an on-chain recovery controller and rotate the controlling wallet.
Recovery moves the whole account—progression, balances, orders, maturity,
limits, history, and pass entitlement—and disables the old controller. It never
creates a second account or resets economic state. Recovery triggers a
seven-day cooldown on NPC selling and global-reward qualification; owned Rune
can still be withdrawn and P2P escrow can be cancelled.

No purely economic protocol can prevent someone from privately selling a
wallet or its keys. The goal is to provide no trusted pass-transfer market and
no reset benefit: whoever acquires control inherits the complete economic
history and all remaining limits.

A pass is necessary but not sufficient. Because it is permanent, any positive
recurring subsidy can theoretically repay a finite pass price given unlimited
time. No security rule may assume that charging for entry has eliminated bots.
The pass prices identities; the global limits below bound what those identities
can extract.

### 8.6 Maturity, bond, and bounded subsidy

**Initial maturity defaults:** economic privileges ramp with the pass/account,
not its wallet:

| Account age with qualifying play | NPC sell quota | Global Rune reward weight |
| --- | ---: | ---: |
| Days 0–6 | 10% | Newcomer floor only |
| Days 7–29 | 50% | 50% of earned weight |
| Day 30 onward | 100% | 100% of earned weight |

Only non-market play on distinct days advances qualification. Automated trade,
listing, cancellation, transfers, and daily claim messages do not mature an
account. Waiting alone may age the entitlement but does not produce qualifying
economic weight.

P2P trading is not an NPC subsidy and can remain available earlier, subject to
fees and escrow safety. Owned Rune is not withdrawal-locked merely because an
account is young. The defended surfaces are newly distributed rewards, NPC Gold
outflow, and inputs that move shop policy.

The strongest additional Sybil cost is a **refundable Rune bond** for full NPC
sell quotas and full global Rune-reward eligibility. The bond:

- makes capital cost grow linearly with bot identities;
- creates a reason to acquire and hold Rune;
- is not a fee and remains the player's property;
- has a delayed unbonding period so one bond cannot rotate rapidly through many
  identities;
- cannot be counted as consumed Rune or used to manipulate a shop quote.

**Open:** exact bond amount and unbonding period. A first simulation should test
5 Rune with a 30-day unbonding delay, but those are not accepted launch values
until new-player playability is modeled.

At all times the system's maximum subsidy is globally bounded independently of
wallet or pass count:

- global Rune emission does not grow with accounts and is a maximum budget,
  not a pot guaranteed to be fully distributed;
- Rune Reward Reserve distribution does not exceed its funded epoch budget;
- every NPC desk has a fixed global item quantity and Gold outflow limit;
- the Rune desk cannot sell more Rune than its finite stock and global limit;
- Gold issuance cannot exceed the policy target, weekly rate, or protocol cap;
- each pass has its own lower limit in addition to the global limit.

Each account's Rune reward is therefore bounded twice:

```text
account_reward
  = min(
      account_age_and_activity_cap,
      weighted_share_of_global_epoch_budget
    )
```

If there are too few qualified players to use the global budget under their
individual caps, the undistributed Rune remains unissued or stays in the Rune
Reward Reserve. It is not handed to the remaining accounts and does not enlarge
the following epoch. One bot must never collect the entire daily maximum merely
because nobody else played.

Buying more passes therefore creates a roughly linear attacker cost while the
total available system subsidy remains capped. The farm may capture a larger
share of a fixed pool, but it cannot make the pool larger. Every pass purchase
also contributes outside on-chain value to the configured Rune-purchase and
treasury allocations.

### 8.7 Pass pricing test

There is no magic pass price that proves bots are gone. Before setting the live
price, simulate the maximum value one new account could receive from global Rune
rewards and NPC subsidy over 30, 90, 180, and 365 days under hostile behavior.

**Initial default:** target a 12-month modeled adversarial payback period, with
no hard payback floor. Calculate it in the external on-chain payment asset using
a conservative long-window Rune value, the per-account Rune reward cap,
maturity curve, maximum NPC subsidy, required gameplay sinks, fees, and
Rune-bond capital lock.

The 12-month target is a tuning goal, not a promise that no bot will ever profit
and not an automatic circuit breaker. A permanent pass has an unlimited life.
The purpose is to delay capital repayment while keeping the pass economically
attractive to a player who also values access, progression, entertainment, and
collectibles.

The model must include the fact that adding attacker passes divides fixed
reward pools rather than multiplying them. It must also test the low-population
case, where per-account caps—not the number of competitors—prevent one account
from consuming the entire global budget.

Recalculate modeled payback from rolling 30-day on-chain data. If it falls below
the 12-month target, the monotonic policy may raise the price of newly created
passes and admins may tune future subsidy through the normal delayed controls.
There is no automatic payback threshold that pauses the economy or forces a
contraction. Do not confiscate balances, block P2P trading, retroactively charge
existing passes, or prevent withdrawal of Rune already owned.

### 8.8 Monotonic pass-price ratchet

**Locked:** the Eternal Pass price may rise and never falls. An existing holder
is never charged again; the current price applies only to creation of the next
economic account.

The initial pricing policy should combine a growth curve and the economic
security floor:

```text
growth_price(n)
  = launch_pass_price
    × sqrt(max(1, lifetime_pass_count / genesis_pass_count))

security_price
  = 12 × modeled_maximum_monthly_system_subsidy_per_mature_pass

next_pass_price
  = max(previous_pass_price, growth_price(n), security_price)
```

The value is calculated in integer units of the configured external on-chain
payment asset. The square-root curve is the initial default to simulate; it
doubles the pass price when the permanent pass population grows fourfold and
raises it tenfold when population grows one hundredfold. It creates increasing
cost without making price linear in player count.

The finalized genesis accounts form the launch population reference and receive
their grandfathered or promised entitlements. They count in the denominator so
the first newly purchased pass starts at the defined launch price rather than
above or below it.

Each successful pass purchase advances the curve before the following purchase
is priced. Concurrent messages are serialized by the authority. If a bulk
purchase interface ever exists, it must sum every marginal price along the
curve; it can never multiply the starting quote by the requested quantity.

This gives a mass buyer three economic costs:

1. Every additional identity has a non-refundable on-chain price.
2. Later identities in the same acquisition become progressively more
   expensive.
3. Every purchase contributes to the treasury and Rune-acquisition allocation
   before the identity can compete for rewards.

A pass purchase still has zero immediate weight in shop pricing, Gold
authorization, or Rune rewards. It must satisfy the maturity, activity, sink,
and Rune-bond policy first. This prevents a wealthy Rune holder from purchasing
many dormant passes merely to change the supply-per-player denominator and then
selling into the resulting NPC quote.

The permanent ratchet has a real acquisition tradeoff: successful growth makes
entry more expensive. Do not evade the policy with discounted economic passes,
because a bot can buy the same discount. A free demo may exist only without
transferable rewards or economy access. Community or promotional sponsorships
may pay the full current on-chain price for a player without lowering the price
received by the economy.

**Open:** validate whether square-root growth is the right curve after
adversarial and player-acquisition simulation. The $25 launch default,
monotonic rule, marginal pricing, and security-floor maximum are the current
proposal.

### 8.9 Initial $0.10 Rune calibration

**Initial default:** if the launch target is $0.10 per Rune, start the Eternal
Pass at **$25 worth of the configured on-chain payment asset**. This is an
economic reference value, not an off-chain payment path.

Calibrate the hostile-account model around a maximum of approximately **20 net
system-origin Rune per mature account per rolling 30 days**:

```text
20 Rune × $0.10 = $2 maximum modeled monthly extraction

$25 pass / $2 per month = 12.5 month modeled recoup
```

`System-origin` includes newly issued game rewards and Rune distributed from the
game-controlled Rune Reward Reserve. Rune bought from another player or the AMM
is not a reward. The cap is subordinate to the fixed global budget, so 20 Rune
is an account maximum and never a promised payment.

Use net rather than gross game rewards for the account limit:

```text
net_system_rune_30d
  = system_reward_rune_30d - rune_consumed_by_gameplay_30d
```

A real player may therefore earn more than 20 gross Rune while consuming Rune
on quests, arenas, hunts, and other game actions, but cannot extract more than
20 net system-origin Rune over the window. Transfers, P2P purchases, shop
purchases, deposits, and withdrawals do not count as gameplay consumption and
cannot reset the cap.

The initial comparison is:

| Pass price | Rune value at $0.10 | Recoup at 20 net Rune/month |
| ---: | ---: | ---: |
| $15 | 150 Rune | 7.5 months |
| **$25** | **250 Rune** | **12.5 months** |
| $30 | 300 Rune | 15 months |

At the proposed 30% Rune-acquisition allocation, one $25 pass directs $7.50
toward Rune, equal to 75 Rune at the starting target price. That is 3.75 months
of the account's maximum net reward extraction purchased from existing supply
up front. More active players then consume Rune through game actions, while the
pass revenue adds recurring external demand.

The $0.10 figure is an initial AMM valuation target, not a guaranteed floor.
The opening Rune/quote reserve ratio establishes the initial AMM price. The Gold
shop can guide Rune's in-game Gold price but cannot guarantee its external
on-chain value. With only about 4,200 currently accounted Rune, the starting
market value is approximately $420, so the AMM will be thin and even modest
pass-funded purchases can move Rune above $0.10. Execution limits from section
8.3 remain necessary.

The square-root price ratchet therefore starts from $25, where `G` is the final
`genesis_pass_count`:

- around `G` permanent passes: $25;
- around `4 × G` permanent passes: $50;
- around `100 × G` permanent passes: $250.

If the final genesis set contains only the 168 recovered paid accounts, those
examples are 168, 672, and 16,800 passes respectively.

The exact on-chain integer quotes depend on the selected payment asset. The
economic targets are the $25 starting value, monotonic increases, marginal
pricing, and the 12-month modeled recoup.

### 8.10 Legacy, promised, purchased, and sponsored passes

**Locked:** every pass promise is honored. Pass origin is recorded explicitly:

| Origin | Treatment |
| --- | --- |
| Legacy paid | The 168 recovered paid wallets retain access and recovered game state without paying again. |
| Promised | A one-time pre-launch commitment grants pass access without a new payment. |
| Purchased | The account pays the current marginal on-chain pass price. |
| Sponsored | Another payer pays the full current marginal price for the named account. |

Before economy activation, create a deduplicated promised-pass manifest using
wallet addresses supplied by the owner. Publish its count and commitment hash,
load the entitlements, verify them, and permanently seal the unrestricted
genesis grant path.

If some promised users have not supplied wallets, commit a finite number of
unassigned promise slots and a claim deadline before launch. Claims are public,
one use, and cannot exceed the committed count. Unused slots expire. After that,
a missed promise can be honored through a full-price sponsored pass or an
explicit contract/policy upgrade; there is no permanent generic `Admin.GrantPass`
faucet.

A promised pass grants only the promised access entitlement:

- It does not grant Gold.
- It does not grant Rune.
- It does not grant berries, scrolls, or extra companions.
- It does not begin mature or bypass the Rune bond.
- It follows the same reward, shop, market, and activity limits as a purchased
  pass.
- A restored legacy player separately keeps the historical inventory already
  owed to that wallet.

All genesis promises count in `genesis_pass_count`, but neither an unclaimed
promise nor a fresh entitlement counts as a qualified active player. Only the
normal on-chain maturity and demand rules affect Gold targets or shop anchors.

A promised pass has no payment proceeds, so it also lacks the proposed $7.50
Rune-acquisition contribution associated with a $25 purchased pass. The admin
dashboard records this foregone acquisition amount. The preferred treatment is
for the team or another sponsor to fund it, but the promise remains valid if it
is unfunded. An unfunded promised pass never enlarges global Rune rewards or NPC
budgets to compensate.

If the modeled maximum extraction grows linearly with passes, the design is
wrong regardless of the chosen pass price. Adjust global emissions or shop
budgets rather than attempting to price over an unbounded faucet.

---

## 9. Administration and public controls

### 9.1 Dashboard

The admin economy page should show:

- Gold issued, burned, outstanding, escrowed, reserved, and per qualified
  active player;
- every item's player, escrow, shop, issued, and consumed buckets;
- Rune inside the game, outside-token supply, both pending bridge buckets, and
  reconciliation difference;
- 7-day and 30-day issuance/consumption rates;
- P2P best bid/ask, depth, volume, and median execution price;
- each shop desk's stock, Gold reserve, limits, current band, and projected
  exhaustion;
- current automatic and manual pauses with their reasons;
- Rune-acquisition budget, execution history, and Reward Reserve.

### 9.2 Dials

Admins may propose changes to:

- per-item anchor bids and asks;
- spread;
- target and maximum stock percentages;
- Gold allocation per desk;
- per-action, per-account, and global quantities;
- Gold burn percentages and target corridor;
- Gold per qualified active-player equivalent;
- maximum weekly adjustment below the contract ceiling;
- buy side, sell side, or complete desk enablement;
- Rune-acquisition allocation and AMM execution limits.

The page previews the effect on current stock, reserves, and supply before a
change is scheduled.

### 9.3 Hard rails

- Emergency pause is immediate.
- Resuming or repricing a paused desk has a 24-hour delay by default.
- Normal anchor movement is capped at 5% per seven days.
- Gold release is capped at 5% per seven days by default and 10% by contract.
- Reserve reassignment is delayed and public.
- Admins cannot edit live orders or escrow.
- Admins cannot mint items or Gold through generic adjustment actions.
- Every configuration change records old value, new value, signer, time, and
  stated reason in bounded published history.

---

## 10. Bad-actor analysis

| Attack | Economic response |
| --- | --- |
| Create thousands of wallets | No starter Gold; signups and claims do not cause Gold issuance; Rune emission is globally fixed. |
| Wash-trade to move the market | No self-trades; order cost and 2% fee; shop ignores last price; volume does not expand Gold. |
| Farm one item and dump it on NPC | Falling bids, per-account/global limits, supply-relative stock cap, finite Gold reserve, then automatic pause. |
| Buy from NPC and sell back repeatedly | Bid/ask spread, P2P fee, and burn make the closed loop lose. |
| Arbitrage a real P2P/shop mismatch | Allowed; it moves stock and Gold in the direction that closes the mismatch. |
| Drain cheap Rune from NPC | Finite Rune stock, trade limits, rising ask as stock falls, then sell-side pause at zero. No Rune restock except player sales. |
| Dump Rune into NPC | Falling bid, approximately 6% stock cap, finite Rune Gold reserve, then buy-side pause. |
| Move Rune outside to fake scarcity | Shop uses in-game + token + pending total, not only the in-game bucket. |
| Hoard Gold to provoke printing, then return | Dormant balances remain outstanding; the system does not print against presumed inactivity. |
| Manipulate one block of supply | Slow anchors use rolling supply/consumption and limited weekly changes. |
| Buy many passes to raise the player denominator | A purchase alone has zero price weight; qualification requires sustained non-market play and item-specific demand/consumption; anchor movement remains capped. |
| Buy many passes to capture daily Rune | The global Rune budget remains fixed; maturity and an optional Rune bond make cost scale with identities while total issuance stays flat. |
| Be the only claimant and take the whole Rune budget | Per-account age/activity caps apply before the global cap; unused budget remains unissued or in the Reward Reserve. |
| Buy passes in bulk before growth reprices them | Every pass is charged its marginal monotonic-curve price; one batch cannot lock in the first pass's quote. |
| Rotate, rent, or privately sell control of one account | There is no pass-transfer endpoint; all limits and history remain attached; on-chain recovery rotates the whole account and triggers an NPC/reward cooldown. |
| Compromised or impulsive admin | No direct grant path; protocol ceiling, time delays, maximum adjustment rates, public history, and immediate pause but delayed resume. |
| Exploit paid packs for cash-out | No direct Gold/withdrawable Rune; sellable contents hit normal supply caps and have no guaranteed NPC redemption. |
| Front-run or sandwich the Rune-purchase program | Aggregate purchases, use a time-weighted reference and strict limits, execute small clips, skip bad prices, and never expose a deterministic purchase after each payment. |

---

## 11. Single-launch build plan

This is implementation order, not rollout order:

1. Add exact item, Rune, Gold, pending-bridge, and escrow ledgers with invariant
   tests.
2. Move the wanted marketplace behavior into `game.lua`; add the Gold order
   book, escrow, partial fills, fees, history, and published market data.
3. Add the finite game shop, price bands, stock/reserve accounting, limits,
   burns, and automatic side-specific pauses.
4. Add controlled Gold authorization/issuance and its public policy history.
5. Add the admin dashboard, previews, dials, delays, and emergency controls.
6. Update the UI to show separate P2P and game-shop desks and make the NPC
   counterparty unmistakable.
7. Remove `marketplace.lua` from deployment; retain separate Rune, quote, and
   AMM deployment.
8. Disable companion mint/export/import, collection deployment, mint worker,
   creator, and customiser from normal routes and deploys; keep their source
   with parked-feature notes.
9. Add the on-chain proceeds ledger, Rune acquisition budget, execution limits,
   and Rune Reward Reserve interfaces. The payment mechanism itself is outside
   this build plan.
10. Run invariant, fuzz, adversarial-economic, migration, live-Luerl, and UI
    tests. Launch all economy surfaces together only after the complete policy
    state is visible.

---

## 12. Required tests and launch gates

### Accounting

- Every successful action preserves all Gold, item, escrow, and Rune equations.
- Every refused or replayed action changes nothing.
- Partial fills, cancellations, expiry, integer rounding, and maximum values
  conserve balances.
- Redeploy export/import preserves balances, orders or defined cancellation
  outcomes, shop stock, reserves, histories, configuration, and pending Rune.

### Economic attacks

- Repeated shop round trips always lose Gold.
- Splitting a shop batch never improves execution.
- Wash trading cannot move shop prices or authorize Gold.
- Selling farmed inventory hits declining bands and pauses before draining more
  than the configured maximum.
- Arbitrage closes a deliberate P2P/shop mismatch without violating supply.
- Rune bridge delay, duplicate, loss, and reordering cases pause safely and
  reconcile exactly once.
- A population of claim-only wallets cannot increase global Rune emission.

### Operations

- Every automatic pause identifies the exact invariant or limit that fired.
- P2P remains usable when only the NPC runs out of stock or reserve.
- Admin preview matches the state produced when the delayed policy applies.
- No normal deployment creates a marketplace process or companion collection,
  runs a companion mint worker, or exposes creator/customiser routes.
- Only Rune, quote, and AMM remain as separate economy Lua contracts.

---

## 13. Open decisions before implementation is complete

These are intentionally not filled in by assumption:

1. Exact global Rune emission per epoch and its player-weighting formula.
2. Exact definition of a qualified active-player equivalent.
3. Final paid pack contents, odds, price, paid advantage, and duplicate policy.
4. Validate the $25 Eternal Pass launch price, maturity curve, Rune bond amount,
   and unbonding delay; confirm the square-root growth curve and 12-month target.
5. Finalize the promised-pass address manifest, any finite unassigned claim
   slots and deadline, and whether sponsors fund their missing Rune-acquisition
   allocation.
6. Live on-chain payment/quote asset and initial AMM liquidity.
7. Whether the proposed 50/30/20 proceeds split is accepted unchanged.
8. Whether the 20,000,000 Gold protocol ceiling is the desired first hard cap.
9. Scroll and Legendary Scroll current totals and finalized utility, needed
   before enabling an NPC Scroll desk or ever quoting Legendary Scroll.
10. Simulation results for the initial Gold-per-active target, price bands,
   global shop quantities, and Rune desk budget.

These open decisions do not change the locked architecture or safety model.
