# The order book: what it is, what it is missing, and how it leaves

Companion to [ECONOMY.md](ECONOMY.md) and [MARKETPLACE.md](MARKETPLACE.md).
This one is only about the **Gold order book** — `EconomyEngine` in
`backend/native/economy.lua`, the `Economy.Order.*` verbs in `game.lua`, and
the Trading Floor in `src/screens/Marketplace.tsx`.

Written 2026-09-04 against `economy.lua` at 1980 lines.

---

## 0. What we actually have

A real limit order book, and a better one than the phrase "game shop" implies.
It already has the things that are hard to add later:

- **Price-time priority, correctly.** `settleFill` prices at
  `maker.price` (`economy.lua:1078`) and `bestMatch` breaks ties on `seq`
  (`:1032`). The resting order sets the price. That is the whole invariant.
- **Full escrow on both sides.** A sell moves the item out of inventory into
  `assets[item].escrow`; a buy moves `price * quantity` Gold into
  `gold.escrow`. Nothing can be sold twice and nothing can be spent twice.
- **Overfill refund.** A taker buy that crosses into a cheaper ask is refunded
  `committed - gross` (`:1084`). Buyers get price improvement, which most naive
  books get wrong.
- **Idempotency.** `ActionId` receipts (`:965`) mean a retried browser request
  cannot double-place. This is the single most valuable thing in the file and
  every extension below must keep using it.
- **Conservation invariants, published.** `goldInvariant` and `itemInvariant`
  (`:1268`, `:1276`) assert issued minus burned equals player + escrow + shop +
  locked, on every read. A book that publishes proof it has not leaked is not
  normal.
- **An NPC desk with a stock-dependent price band**, per-account and global
  rate limits, and a reserve that can be exhausted (`:1223`-`:1352`).

So this is not a toy. What follows is what stands between it and a DEX.

---

## 1. Defects — fix these before adding anything

### 1.1 Fill ids collide, permanently, after 500 fills

```lua
id = "F" .. tostring(#state.fills + 1),   -- economy.lua:1100
```

`appendBounded` (`:960`) keeps `#state.fills` pinned at
`orderbook.historyLimit` (500). Once the cap is reached **every subsequent
fill is called `F501`**. Any client, receipt, dispute or analytics job keyed on
a fill id is wrong from fill 501 onward.

Fix: a monotonic `state.fillSeq`, exactly like `orderSeq`. One line, and it must
happen before anything reads a fill id.

### 1.2 An expired order can still be matched

`bestMatch` (`:1032`) does not look at `expiresAt`. `placeOrder` sweeps at most
**25** expired orders before matching (`:1170`), against a global cap of 2,000
(`constants.lua:475`). So order #26 in an expired backlog is still live
liquidity and will fill at a price its owner walked away from a month ago.

Fix: `bestMatch` skips `expiresAt <= timestamp`, and expiry becomes a lazy
per-order truth rather than a sweep race. The sweep stays, but only to release
escrow — it stops being a correctness dependency.

### 1.3 Nobody is paid to run `Economy.Order.Maintain`

Expiry needs a keeper, the keeper pays a message, and gets nothing. With
`limit` clamped to 100 (`:1220`), clearing a 2,000-order backlog costs twenty
messages someone has to volunteer for. Escrow sits locked until they do.

Fix: fold into 1.2 (matching stops being wrong) and pay the sweeper the
`creationCost` of each order they release. That makes it self-funding and turns
a chore into a faucet nobody has to think about.

### 1.4 Depth is per-order, not per-price-level

`marketStats` (`:1478`) pushes one row per order and truncates to ten. Ten
orders at the same price render as ten identical lines and the eleventh price
level is invisible. Every real book aggregates quantity by price.

Fix: aggregate into a `{price, quantity, orders}` ladder, then truncate. It is
also strictly smaller to publish, which matters — see §4.

### 1.5 Self-trade prevention rejects the whole order

`:1163` refuses a *new* order outright if it would cross the account's own
resting order. Correct on safety, hostile in use: a market maker adjusting a
quote gets an error instead of a trade, and the only remedy is
cancel-then-place, paying `creationCost` twice.

Fix: the standard three modes, `CancelResting` as the default — cancel the
account's crossing resting order and continue matching. Keep the
`candidate.account ~= taker.account` guard in `bestMatch` regardless; it is the
belt to this braces.

---

## 2. Missing mechanics, in the order they are worth adding

| # | Mechanic | Why it is the next one |
|---|---|---|
| 1 | **Time-in-force: `GTC` / `IOC` / `FOK` / `PostOnly`** | Everything else is a special case of these. `IOC` is "market order" and there is no market order today. `PostOnly` is what a maker needs to never pay taker fees. Four values on one tag. |
| 2 | **Amend (price/quantity) as one action** | Today: cancel + place = two messages (~200 ms), two creation costs, and loss of queue position. An amend that only *decreases* quantity or is price-neutral should keep `seq`; anything else re-queues. Quoting is unusable without it. |
| 3 | **Batch cancel / cancel-all-in-market** | A maker with 20 quotes pays 20 messages to leave. This is the one place batching is legitimate under the repo's "do not batch interactive actions" rule: it is one user intent over many transitions. |
| 4 | **Tick size and lot size, per market** | `maxUnitPrice` is 1,000,000 and there is no tick. Nothing stops a 1-Gold-improvement war on a berry that trades at 5. Ticks are what make a price ladder readable. |
| 5 | **A market registry** | Today "the market" is `ITEM_IDS` and the quote asset is always Gold, implicitly. One `state.markets[id] = {base, quote, tick, lot, minValue, status}` table is the single change that turns this from a game feature into a venue — and it is the seam standalone needs (§6). |
| 6 | **Price bands / fat-finger guard** | Reject a resting order more than N bps from the desk mid or the 7-day median. There is a reference price available already; nothing consults it. |
| 7 | **Per-account fill history** | `state.fills` is global and capped at 500. A trader's own fills fall off the end and there is no way to get them back. Keep a small per-account ring on the player record, or index by account. |
| 8 | **OHLCV candles** | `marketDaily` (`:1059`) has volume and gold but no open/high/low/close. The chart currently reconstructs a line from raw fills client-side and goes blank past 500 fills. Candles are ~40 bytes a day per market and they are permanent. |
| 9 | **Maker/taker fee split** | `feeBps` is charged to the seller regardless of who was resting (`:1081`). That penalises a *seller* for providing liquidity and rewards a *buyer* for taking it, which is backwards. Charge the taker; optionally rebate the maker. **This changes what `MARKET_TOUR` says out loud** — `src/screens/Marketplace.tsx:49` states "charges the seller 2%", and per the repo rule that sentence moves in the same commit. |
| 10 | **Trade receipts to both sides** | The maker is not in the message. `touchAlso` already republishes them (`game.lua:2093`), but they get no record of *what* filled beyond scanning the global fills list. |

Deliberately **not** on this list: leverage, margin, perps, oracles,
liquidations. None of them are order book features; all of them are risk
engines, and this economy does not have a solvency model to hang one on.

---

## 3. Usability decisions to make (recommendation attached)

These are the ones where doing nothing *is* a decision:

1. **Does the NPC desk quote into the book?** — **Yes, and this is the single
   highest-value change in this document.** Today the Shop and the Floor are
   two tabs, two prices, and a player must know which one is better. If the
   desk's bid/ask are injected as synthetic resting orders owned by the house,
   then: the book is never empty, every market has a permanent two-sided quote,
   the desk's price becomes the reference price §2.6 needs, and the player sees
   *one* market instead of choosing a venue. It is the desk-as-resting-order
   pattern and it costs no hops — the desk is in the same process.
2. **Market orders by quantity or by spend?** — Support both: `IOC` at a limit
   price is the honest primitive, and the UI offers "spend N Gold" by computing
   the limit from the current ask ladder client-side. Never let the process
   accept an unpriced order.
3. **Whose fee?** — Taker pays, maker free. See §2.9 and the tour rule.
4. **What happens to an order when a player's Pass is recovered?** Already
   handled and handled well — `M.rotateAccount` (`economy.lua:461`) rewrites
   `orders`, `fills`, `orderHistory`, `marketDaily` maker/taker sets, activity
   and per-desk usage. The one thing it does not rotate is `actionReceipts`,
   which is correct: the old address can no longer sign, so its replay keys are
   unreachable. No change needed; noted so nobody "fixes" it.
5. **Does the order book pause with the economy?** Placing is blocked by
   `emergency.paused` (`:1147`), cancelling is not. That is right and should be
   written down: **you can always leave.**
6. **Minimum order value.** `minValue = 10` Gold. With a berry at 5 Gold that is
   a two-unit minimum, which is fine — but it interacts with ticks and lots and
   should be one decision, not three constants set at different times.

---

## 4. The constraint that decides everything: published bytes

Per `CLAUDE.md`, a `~lua@5.3a` slot costs the size of the **whole published
map, five times over**, on every message, whatever the message did.

`publicView` publishes `orders = orderView(state)` — a full copy of every open
order — and `fills = copy(state.fills)` (`economy.lua:1642`).

- Today: `economy` is ~14 KB, and that is fine.
- At the configured caps: 2,000 orders at ~180 B = **360 KB**, plus 500 fills
  and 500 order-history rows. Call it **~550 KB in one key.**

That is not a market-screen problem. It is a tax on **every battle round, every
feed, every hunt search, for every player**, because the whole map is
marshalled five times per slot regardless of the handler. A busy order book
would make the game unplayable long before it made the book slow.

So, three rules for this file specifically:

- **Publish the ladder, not the book.** The aggregated depth from §1.4 plus the
  caller's own orders is everything any client actually draws. The full
  `orders` array should not be a published key at all.
- **Publish candles, not fills.** §2.8. Raw fills are the largest per-byte
  liability and the least-read.
- **Lower `maxGlobal` until the book is its own process.** 2,000 is a number
  that was never costed. Until extraction, cap the *published* book, not just
  the stored one.

Measure with the byte count, not by reasoning about it — `curl -s
"$NODE/$PID~process@1.0/now" -o now.bin` and sum the `economy` part.

**This — not hops, not compute — is the real argument for extraction.** A
separate process pays its own published size and nothing else does. Adding
depth to the book stops taxing people who are fighting a bot.

---

## 5. Security model

What is already right, and must stay right:

- Identity is `signer(msg)` at the `game.lua` boundary and nothing below it
  trusts a tag. Keep the book that way: **never** let an order carry an
  `Account` tag.
- Escrow is taken before matching, so no fill can execute against funds that
  are not there.
- `ActionId` receipts bound at 500 (`:978`). Note the bound: an actor who
  places 501 orders evicts their own oldest receipt and could then replay it.
  That is currently harmless because a replay would re-place a legitimate
  order, but it stops being harmless the moment a receipt guards a withdrawal.
  Key the ring per account, or make it a time window rather than a count.

What is missing:

- **Wash trading is only blocked within one account.** Two wallets cost nothing
  and defeat `:1163` entirely. Today the only thing at stake is 2% of the wash,
  so it is self-limiting — but the moment volume earns anything (a rebate, a
  rank, a quest), it is free money. **Decide this before, not after, volume
  pays.** The honest defence is that fees must always exceed any volume-linked
  reward, not that wash trading can be detected.
- **No circuit breaker.** With no price band, a single crossing order can print
  any price up to 1,000,000 and that print becomes the 7-day median that other
  systems read.
- **No cancel-on-halt.** An emergency pause freezes placement and leaves the
  existing book live for anyone whose client is still matching. Cancel-only
  mode should be an explicit state, not an emergent one.
- **Order ids are guessable** (`O` + sequence). It does not matter now —
  `cancelOrder` checks ownership (`:1206`) — but do not ever add a verb that
  acts on an order id without an ownership check.

---

## 6. Two deployments of one engine

This is the shape, and it is not "extract it later" — both halves ship:

| | **Internal book** (`game.lua`) | **Real book** (its own process) |
|---|---|---|
| purpose | low-friction on-ramp; teaches the screen | the actual contract, 1:1 with launch |
| custody | player record — no wallet prompt per trade | token deposits via `Credit-Notice` |
| assets | Gold quote, berries/scrolls/Rune base | any token pair in the registry |
| how you arrive | play the game | withdraw your Rune, free-mint the quote token |
| at launch | stays exactly as it is | Rune is real, quote is replaced by real tokens |

The internal market exists so a player learns a ladder, a spread and a resting
order without a wallet signature per action. Once they withdraw Rune and mint a
quote token they are on the **real contract**, and every byte of that path is
the thing that ships — same matching engine, same verbs, same screen, real
custody. That is what makes it real testing rather than a demo.

**Rune is the first asset listed, not a privileged one.** The registry holds
arbitrary `(base, quote)` pairs from day one; Rune is simply row one, and the
quote token is a stand-in that gets swapped for real tokens later. Nothing in
the engine may special-case either of them — the moment it does, listing the
second asset becomes a rewrite.

**So the mistake would be to fork `economy.lua`.** There is exactly one thing
coupling the book to the game:

```lua
M.placeOrder(state, players, account, side, item, price, quantity, ...)
--                  ^^^^^^^
```

`players` is reached for in six places and six only — `inventory`, `takeItem`,
`giveItem` (`:925`-`:941`) and `playerGold`, `debitGold`, `creditGold`
(`:878`-`:896`). Everything else in the matching path touches only `state`.

### The one refactor to do now

Replace the `players` parameter with a **ledger adapter**:

```lua
-- balance(account, asset) -> integer
-- debit(account, asset, amount) -> boolean
-- credit(account, asset, amount)
```

Two implementations, same book:

| | in-game adapter | standalone adapter |
|---|---|---|
| Gold | `player.gold` plus `state.gold.*` accounting | ledger row, quote asset |
| Items | `player.inventory[item]` | ledger row per asset |
| Deposits | already in the account | `Credit-Notice` from the asset's token process |
| Withdrawals | never leaves | signed `Withdraw` through `process-outbox@1.0` |

That is a mechanical change of ~60 lines and it can land **today, in-process,
with no behaviour change and no new process.** After it, extraction is a
deployment decision rather than a rewrite — which is exactly the point.

Do §2.5 (the market registry) at the same time. `{base, quote, tick, lot,
minValue, status}` with `quote = "gold"` for every current row is a no-op
in-game and is the entire difference between "the Gold market" and "a venue".

### What the standalone process looks like

- **Custody is deposit-first, and the source to copy is `game.lua`, NOT the
  deleted `amm.lua`.** That instruction used to point at the pool and it was
  wrong twice over: `provenSigner` fell back to a tag (`return msg.Address or
  msg.From`), which CLAUDE.md forbids by name, and `Credit-Notice` failed CLOSED
  before crediting -- which is why 14 atoms of TEST-RUNE are stranded at the pool
  address with no way to recover them. Lift `Burn-Notice` from
  `game.lua:3311`-`:3357` instead: a mandatory `Reference`, a `seen`
  short-circuit that returns the existing row unchanged, and QUARANTINE rather
  than refusal for anything uncreditable.
- **Rune is the quote asset, not a base.** `rune.lua` is already a standard
  token with `Credit-Notice` and `X-` forwarding tags (`:400`-`:460`), which is
  the whole interface a book needs. A RUNE-quoted book is the standalone
  product; the in-game Gold book is the same engine with a different adapter.
- **One process, all markets, to start.** Per the repo's process-shape rule: a
  book is derived state over its own orders, so it is never sharded *within* a
  market. Shard **by market** only when one market's published size is the
  constraint. Condense by default.
- **Two hops, and they are the right two.** Deposit in (Credit-Notice),
  withdraw out (outbox). Matching is zero hops because it is one process. That
  satisfies "reserve in, settle out" without argument — which the battle fleet
  does not.
- **The AMM is gone, and nothing replaces it.** This section used to say the
  pool would become the designated market maker quoting into the book. It
  cannot: a process cannot send anything by itself, so a "process that quotes"
  is a process somebody has to push on every tick. It has been deleted. The
  external book opens with an empty ladder and fills when a user rests an order,
  which is what a book is. Always-fills-now is the in-game Shop's job, and the
  Shop is a supply-policy desk inside `game.lua` -- anchored and banded against
  the issuance ledger -- not a market maker and not a curve.

---

## 7. Precision: Rune has no decimals, and that decides the schema

`rune.lua:72` — `Denomination = 0`, deliberately, because "a Rune buys one quest
or one arena session". That stays. It is a design statement, not an oversight,
and the book has to be built around it rather than arguing with it.

An indivisible asset breaks two things, and both are fixable in the schema
rather than in the arithmetic.

### 7.1 Lot size, and why it is now load-bearing

When Rune is the **base** and the quote has decimals, there is no problem:
price is quote-atoms per whole Rune and the quote's decimals supply all the
granularity anybody needs.

When Rune is the **quote**, the smallest possible price increment is one whole
Rune. At the intended ~$0.10 a Rune that is a ten-cent tick, which makes any
cheap asset untradeable — you cannot express "0.3 Rune each".

The fix is **lot size**, and it is the standard one: `price` is quote units per
**lot**, and `lotSize` is how many base units are in a lot. An asset worth 0.3
Rune lists with `lotSize = 10` and trades at 3 Rune a lot. Both numbers stay
integers, and the engine barely changes:

```
quote moved = price * quantity          -- unchanged
base moved  = quantity * market.lotSize -- the one new multiplication
```

With `lotSize = 1` on every current market this is a literal no-op today. It is
in the registry from the first commit precisely so that listing an asset whose
natural price is under one Rune is a config row rather than a migration.

`tick` still exists and is still per-market, but against a 0-decimal quote it
is pinned at 1 and lot size is the real lever.

### 7.2 A percentage fee on an indivisible asset is not a percentage

Today: `fee = (gross * feeBps + BPS - 1) // BPS` (`economy.lua:1081`) — a
**ceiling**. On a Gold market that is a rounding detail. On a Rune-quoted
market at 200 bps, a 3-Rune fill pays `ceil(0.06) = 1 Rune`, which is a **33%
fee**. Small trades in a new market are exactly where a venue cannot afford to
be extortionate, so this is the fee mechanism actively hindering expansion.

**Fee carry.** Accrue the fee in basis-point units and only move whole units
when the accrual crosses one:

```lua
local units   = market.feeCarry + gross * feeBps
local charged = units // BPS
market.feeCarry = units % BPS      -- always < BPS
```

Exact in aggregate — over any sequence of fills the venue collects precisely
`floor(total_gross * feeBps / BPS)` — with no minimum-fee cliff, no ceiling
tax, and no floating point. A 3-Rune fill pays 0 and leaves 600 units of carry;
the shortfall is collected on a later fill. Nobody can extract value from the
gap, only shift it by less than one unit.

This is the one piece of arithmetic in the whole design that has to be right,
and it is six lines.

### 7.3 The fee schedule, chosen so it does not tax expansion

| lever | value | why |
|---|---|---|
| **maker** | **0 bps, every market, permanently** | This is the expansion lever. A new market has no liquidity; charging the only people willing to supply it guarantees it stays empty. Free to quote, always. |
| **taker** | per-market, default **30 bps** | 200 bps is a shop margin, not a venue fee — at 2% no arbitrageur will tighten a spread, so the spread stays wide and the market stays bad. 30 bps is where real books sit. |
| **internal Gold markets** | **0 bps** | Measured, not assumed: the berry desk quotes bid 5 / ask 12, so an NPC round trip destroys 7 Gold against 0.2 Gold for a 2% fee on a ~10 Gold trade -- the desk spread is ~35x the sink the P2P fee ever was. And `routeGoldFee` only *burns* above 110% of target; below it the fee is parked in `gold.locked`, so most of the time it was not a sink at all. Gold is indivisible too, so a percentage fee at game prices is lumpy for no economic gain. |
| **order creation** | **0** | The current 1 Gold (`:1171`) is charged on placement and punishes precisely the behaviour the book needs: tight quotes and frequent amends. It buys no spam protection either — the *message* is the spam vector and a fee does not stop it. `maxPerAccount` and `minValue` do. |
| **listing a market** | **no burn, no fee** | A pay-to-list venue is a venue with one asset on it. Listing is an admin verb now, with `policy.listing = "admin" \| "bond" \| "open"` in the registry so permissionless listing is a flip rather than a rewrite. If gatekeeping is ever needed, a **refundable** Rune bond — never a burn. |

**Fees are taken in the market's quote asset, never converted.** Charging every
market's fee in Rune would privilege Rune, force the venue to swap, and make
listing an asset depend on a Rune market existing for it. Fees accrue to
`state.fees[asset]`; who may withdraw them is a policy field, not a constant.

Note the consequence for the walkthrough: moving to taker-pays changes what
`MARKET_TOUR` says out loud (`src/screens/Marketplace.tsx:49`, "charges the
seller 2%"), and per the repo rule that sentence moves in the same commit.

### 7.4 Divisible outside, indivisible inside — mint Rune with 6 decimals

**Recommendation: yes, do this, and do it before the token is real.**

An indivisible asset is fine as a *base* — plenty of real markets trade whole
units of something. It is bad as a *quote*, because the quote's decimals are
where all price granularity comes from. And Rune will end up a quote: the
moment there is a second game asset, the pair everyone wants is `ITEM/RUNE`.
Lot size (§7.1) patches that, but it does not fix it — it *moves* the
coarseness from price to quantity. You choose your precision at listing time
and pay for it in tradeable size.

So: **the token gets decimals, the game does not.**

| | in-game Rune | TEST-Rune the token |
|---|---|---|
| unit | one whole Rune | atoms, `10^6` to a Rune |
| divisible | no, ever | yes |
| meaning | one quest, one arena session | a tradeable balance |
| the bridge | `Rune.Withdraw` / deposit accepts **whole units only** — a fractional amount is **refused, never truncated** | |

`rune.lua:21` and `:41` justify `Denomination = 0` on the grounds that "a Rune
buys one quest or one arena session". That reasoning is about the **game's**
unit and it survives intact — the game never sees a fraction, because the
bridge will not pass one. Those comments have to be rewritten in the same
commit or they become confidently wrong about a file that no longer says 0.

**Why 6 and not 12.** AO's convention is 12 and the deleted pool's `mulDiv` existed to
survive it, but 12 decimals against a supply in the millions is `10^19` atoms —
past int64, in a Luerl process where every amount is an integer. At 6, ten
million Rune is `10^13` atoms with room left for a `price * quantity` product.
`quote.lua` is already 6. Match it.

**What this costs, honestly:**

- **The reconciliation invariant changes units.** `runeReconciliation`
  (`economy.lua:1291`) compares in-game Rune against `externalRuneSupply`;
  those become different units and every comparison needs the scale factor.
  One constant, but it touches an invariant that currently gates the Rune desk,
  so it needs its own test.
- **Dust exists and must be visible.** A wallet holding 0.4 RUNE can never
  bridge it in. That is correct behaviour, not a bug, and the withdraw screen
  has to say so rather than silently flooring.
- **Two units in one codebase is a bug factory.** Mitigate by naming, not by
  care: `runeUnits` for whole in-game Rune, `runeAtoms` for token amounts, and
  never a bare `amount` crossing the bridge.
- **The deployed TEST-Rune must be redeployed.** Cheap now, impossible later.

**Lot size does not go away.** The two mechanisms solve different problems and
both are needed: decimals make Rune usable as a quote on the real book; lot
size makes any coarse base tradeable against any quote, including in-game Rune
on the internal book, which stays indivisible by construction.

### 7.5 Rune is the first asset, not a privileged one

Rune is row one in the registry and nothing more. No engine path may branch on
it, no fee may be denominated in it, no market may be required to quote against
it. The whole point of listing Rune first is to prove the generic path works
before there is a second asset to break it — so the day the quote token is
replaced by several real tokens, that is a registry edit and a deploy.

---

## 8. Order of work

1. **§1 defects** — they are bugs today, in the deployed process.
2. **Ledger adapter and market registry** (§6, §7.1) — no behaviour change at
   `lotSize = 1`, unlocks everything after it.
3. **Fee carry and the taker/maker split** (§7.2, §7.3) — must land before any
   Rune-quoted market exists, or the first small fill pays 33%.
4. **Publish the ladder and candles instead of orders and fills** (§4) — what
   makes adding book features stop costing every player a slot.
5. **TIF, amend, batch cancel, ticks** (§2.1-2.4) — the book becomes usable.
6. **The desk quotes into the internal book** (§3.1) — that ladder is liquid.
7. **The standalone contract** — token custody modelled on `game.lua`'s
   `Burn-Notice`, Rune
   listed as the first asset, because steps 2-6 already did the work.

---

## 9. Decisions taken (2026-09-05)

Settled with Tyler. Anything above that disagrees with this section is older.

**Two deployments, one engine.** The internal Gold book is the low-friction
on-ramp; the external token book is the real product. Same matching code, same
verbs, same screen — the differences are all registry fields.

**Rune: 6 decimals on the token, whole units across the bridge.** `rune.lua`
mints divisible Rune; deposit and withdraw **refuse** a fractional amount
rather than truncating, so in-game Rune stays indivisible and "a Rune buys one
quest" survives. 6 rather than AO's 12 because 12 decimals against a
million-unit supply exceeds int64 in a Luerl process. Must land before the
token is real — see §7.4 for the full cost.

**Fees.**

- Internal Gold markets: **0 bps, and no order-creation cost.** The desk spread
  is ~35x the sink the P2P fee ever was, Gold is indivisible so the fee was
  lumpy anyway, and trading earns no qualifying day (`economy.lua:670`) so zero
  fees open no farming hole. Verified, not assumed.
- External markets: **taker 30 bps, maker 0 bps**, per-market override.
- **No maker rebate.** A rebate is the single easiest thing to wash-trade with
  two wallets. The registry carries the field set to 0 so it stays an option.
- **Fee carry ships anyway** (§7.2). The game sets 0, but the external path is
  the one that must be exact, and an unexercised fee path is an untested one.

**The desk is a corridor, and the corridor enforces itself.**

- The desk's bid/ask appear in the ladder as house levels and a taker
  automatically gets whichever of desk-or-P2P is better. That is what makes
  "P2P wins unless it leaves the band" a property of the book rather than a
  hope about which tab a player opens.
- `Economy.Shop.Trade` and the Shop tab **stay exactly as they are**, for
  trading at the desk deliberately.
- Both paths draw from the same stock, the same Gold reserve and the same
  20-hour rate limits. A desk fill in the book consumes them identically, or
  the desk gets drained twice for the same inventory.
- **Invariant to assert by name:** while the P2P best bid/ask sit inside the
  desk's band, the desk is never the best price on either side; the moment P2P
  leaves the band, the desk is. This is the point of the desk and nothing
  currently tests it.

**The desk never observes the market.** `anchorBps` stays admin-only and
rate-limited to 5%/week (`economy.lua:1838`); the band curve keeps reacting to
the desk's own stock and nothing else. A desk that chased the P2P median could
be walked with two wallets printing a fake median, and it holds real reserves
behind that price. Inventory is a signal you can only move by actually trading
against the desk at its own prices, which costs you the spread.

**Order lifetime: the trader picks, capped at 30 days**, defaulting to 30. A
maker wants a quote that expires on its own; the cap is what keeps published
state bounded.

---

## 10. Custody: an account inside the book, not escrow per order

**Decided.** You deposit into the book once and hold a credit balance there.
Orders lock against that balance; they never hold value of their own. Withdraw
whatever is not locked.

There are only two models and this is the right one:

| | **account/ledger** (this) | **escrow per order** |
|---|---|---|
| who holds value | the book, per account | the order itself |
| placing an order | a bookkeeping lock, zero hops | a token transfer, one hop |
| an order expiring | `locked` stops counting it. Nothing to do. | value is stranded until someone claims it |
| used by | Serum/OpenBook, dYdX, Vertex, Injective | 0x, Seaport — and RuneRealm's internal book today |

**On AO the choice is not close.** A token transfer is a cross-process hop
(~160 ms) and it is asynchronous, so escrow-per-order means a hop to place an
order and no way to place one atomically — the order would exist before its
funding arrived. Deposit-first costs one hop, once, and every place, cancel,
amend and fill after it is zero hops inside the book process.

**Expiry costs nothing and requires nothing.** Free balance is
`balance - (sum of live, unexpired orders)`, computed on read rather than kept
as a decremented counter. An order that expires stops counting that instant —
no sweep, no message, no "come and collect it". This is only true because
expiry is now a property of the order rather than a race with a bounded sweep
(§1.2); the two changes are the same change.

### On a withdrawal delay: no, and here is the honest reason

A delay is right on an **optimistic** rollup because there is a fraud-proof
window and the state might still be wrong. AO has no such window — a process's
state is deterministic given its message log, so there is nothing to wait out.

The real hazard here is the one this repo already has scars from: **delivery is
not exactly-once.** A delay does not prevent a duplicate delivery. Idempotency
by `reference` does, and it is already the house pattern in `Rune.Minted`,
`Burn-Notice` and the `Withdrawals`/`Deposits` ledgers.

**And a withdrawal is already non-atomic** — it cannot be otherwise. Debit the
internal balance, emit the transfer through `process-outbox@1.0`, mark settled
when the token confirms: `pending -> sent -> settled`, with a refund path if it
never lands. That state machine is forced by the platform, so the separation
being asked for is already there.

What a blanket delay would actually buy is an operator circuit-breaker, and it
buys it by taxing every honest user forever and letting someone freeze your
money. Two cheaper things buy the same protection:

- **Per-account withdrawal rate limit** — a value ceiling per rolling window,
  the same shape as the desk's existing 20-hour limits. Caps the blast radius
  of an exploit; a normal withdrawal never touches it.
- **An emergency withdrawal pause**, explicit and logged, alongside the
  existing `emergency.paused`. Off by default.

**Deposits are never delayed or rate-limited.** The value is already inside the
contract; there is no directional risk to manage.

### The one thing this makes harder

An internal ledger is a **per-account published key**, which is exactly the
`player-<address>` growth problem in `CLAUDE.md` — O(accounts ever seen),
marshalled five times per slot. On the standalone book that is the process's
entire job so it is affordable, but it has to use the addressed-key pattern
(`balance-<address>`) and an eviction policy **from the first commit**, not
a single `balances` map retrofitted later.

---

## 11. What is built (2026-09-05)

Everything in this section is in `economy.lua`, reachable through `game.lua`,
drawn on the Trading Floor, and covered by `economy_test.lua` plus the handler
path in `game_test.lua`. Anything above that reads as future tense and appears
here is out of date, not undecided.

### The verbs

| verb | what it does |
|---|---|
| `Economy.Order.Place` | now takes `Tif`, `Stp` and `ExpiresIn` |
| `Economy.Order.Amend` | move price and/or size in **one** message, no creation cost |
| `Economy.Order.CancelAll` | leave one market, a named list, or the whole account's book |
| `Economy.Order.Cancel` | unchanged |

`Tif` is `GTC` (default) / `IOC` / `FOK` / `PostOnly`. `IOC` is the market
order: the client reads the ask ladder, computes the limit, and sends it —
**the process still never accepts an unpriced order** (§3.2). `FOK` is checked
against real depth *before* any escrow is taken, so a kill is a true no-op
including the creation cost. `PostOnly` is refused rather than allowed to
cross.

`Stp` is `CancelResting` (default, §1.5) / `Reject` / `CancelBoth`. The
`candidate.account ~= taker.account` guard in `bestMatch` is untouched under
all three.

Tag values are normalised through `mode()`, which strips `-` and `_` before
comparing — so `PostOnly`, `post-only` and `post_only` are one value. That is
the rule in `CLAUDE.md`, and the test sends the spelling a browser signs.

### An amend keeps its queue place when it has earned it

Same price, same-or-smaller size: the order keeps its id and its `seq`, and the
difference is released. Anything else re-queues under a new id that names the
one it replaced in `amendedFrom`. Nobody behind you in the queue is worse off
for you asking for less; everybody is worse off for you changing your price and
keeping their place.

### The desk quotes into the ladder (§3.1, and it was the biggest change)

`deskQuote` builds a price-ordered run of units the NPC desk will trade right
now, and `matchOrder` consumes it beside the resting player orders. Best-first
falls out of the band curve rather than a sort: every unit the desk sells makes
the next dearer and every unit it buys makes the next cheaper.

- **At equal price the player wins.** The desk is the price you get when nobody
  better is quoting, and never a queue-jump.
- **One shelf, one reserve, one set of 20-hour limits.** A desk fill reached
  through the ladder moves `desk.stock`, `desk.goldReserve`, the item's
  `shop`/`player`/`escrow` buckets and all three usage counters exactly as
  `Economy.Shop.Trade` does. Both paths drain the same inventory.
- **No book fee on a house fill.** The desk's spread is the charge.
- **The Shop tab is unchanged**, for trading at the desk deliberately.
- `marketStats` publishes `p2pBid`/`p2pAsk` beside `bestBid`/`bestAsk`, and
  every ladder level carries `house`. The §9 invariant — while the P2P best
  sits inside the desk's band the desk is never the best price on either side —
  is now a thing a client or a test can check rather than take on trust, and
  `economy_test.lua` checks it.
- Rune is not special-cased. The desk quotes wherever `market.houseQuotes` is
  set, `lot` is 1 and the quote asset is Gold; the Rune desk falls out on its
  own because `shopPauseReason` refuses without reconciliation data, and a
  caller that supplies none gets no house quote. Absent data means the desk
  stays out of the book.

### The price band (§2.6)

`priceBand` anchors on the desk's own bid and ask, widened by
`market.bandBps` (5,000 — ±50%) each side, falling back to the 7-day median and
then to the book's own resting prices. A market with none of those is not
checked at all: the first order in a market is what establishes the reference.

Because it is anchored on the house's own quote it can never refuse a price the
realm itself is showing, and it refuses 1,000,000. The corridor is published as
`market[item].band` so the order ticket says so before the player pays a
message to find out.

### Candles (§2.8) and a trader's own fills (§2.7)

Open/high/low/close ride on the `marketDaily` row that already carried volume —
four integers a day per market, no new key — and `publicView` publishes 30 days
of them. The chart reads them for the daily interval; the raw fills, which are
a 500-row ring shared by every market, are only used intraday now.

Own fills are `player.recentFills`, derived at publish time by walking
`state.fills` backwards from the tail. That costs nothing for a wallet that has
never traded, which matters more here than durability does — see the per-wallet
growth note in `CLAUDE.md`. **The known gap:** a trader's own fills still fall
off the end once 500 trades have happened across all markets since. The candles
keep the price history permanently; the individual receipts do not.

### The fifty bots trade like fifty traders

`backend/native/swarm/worker.mjs` no longer has one strategy with fifty hands:

- **Fair value** is the average of three independent readings — the 7-day
  median, the desk's mid, and the players' own mid — because any one of them
  alone is walkable and the desk's half deliberately never observes the market.
- **`MAKER_STYLE` per role.** `edgeBps` is how wide a role quotes; `aggression`
  is the probability of stepping *inside* the touch rather than resting at its
  own edge. That is the competitive loop, and it is bounded by fair value on
  both sides — an actor undercuts while there is still edge and stops when
  there is not, so spreads converge somewhere rather than to zero.
- **Two-sided quoting**, skewed by inventory, clamped into the band, never
  crossing, sent `PostOnly`. The old gate was `excess.length`, which meant the
  fleet only ever showed asks and the desk was the only bid in every market.
- **`goods_amend`** is a new weighted action: move a live quote in one message.
  How often a role re-prices is most of what separates a market maker from
  somebody who left an order lying around.
- **Taking is `IOC`**, at a limit swept from the published ladder, with `FOK`
  15% of the time so the all-or-none path is exercised.
- **Leaving is batched**: three or more stale quotes in one market is one
  `CancelAll` rather than three messages and a half-pulled book.
- **The arbitrage is the one that survives.** Shop-versus-floor is closed by the
  engine now. What is left is a genuinely crossed market: the desk does not
  *rest* an order, so a player's bid can sit above the desk's ask indefinitely
  with nothing to close it. That is what the fleet hunts.

### Still not built (as of 2026-09-05; §12 supersedes the first line)

- The ledger adapter exists (`M.playerLedger`) but nothing is deployed against
  it; the standalone book (§6) is unstarted. **Both shipped on 2026-09-06 —
  see §12.**
- `publicView` still publishes `orders` and `fills` in full (§4). The ladder,
  the band and the candles are all published now, so the client no longer needs
  either — removing them is a byte win nobody has taken yet.
- `Economy.Order.Maintain` still pays its keeper nothing (§1.3). Matching no
  longer depends on it, so it is a housekeeping cost rather than a correctness
  one.
- Order-creation cost is still 1 Gold. §7.3 argues for 0; an amend is free,
  which removes the sharpest edge of it.

---

## 11. Status, 2026-09-05

Two sessions are building this in parallel. Roughly: one owns the missing
**mechanics** (§2), the other owns **performance and custody** (§4, §6, §7).

**Landed and verified** (economy 143, game 667, rune 116, hunt 53, tsc clean):

- §1.1-1.4 defects. §1.5 (self-trade cancel-resting) still open.
- §2.4 tick and lot, §2.5 the market registry, §2.9 maker/taker split.
- §6 the ledger seam, proven against a non-player credit ledger.
- §7.2 fee carry, §7.3 the schedule, §7.4 Rune at 6 decimals with a whole-unit
  bridge and quarantined deposits.
- **The book index.** `state.bookIndex` — per-market price levels with a
  sorted price array, per-account open counts, a global live count, a min-heap
  on `expiresAt`, and a per-account fill ring. Derived, never published, never
  exported, rebuilt lazily on absence.
  - Every mutation of `state.orders` goes through `putOrder`/`dropOrder`, which
    own the map, the index and the counters together. There are exactly two
    `state.orders[...] =` sites in the file and both are those functions. That
    is the property that keeps a new handler from silently corrupting the index
    — which is not a slow book but a wrong one.
  - One placement at 1,600 resting orders: ~9,600 order visits plus a
    1,600-key sort, down to about a dozen table lookups. `publicView` goes from
    7 x 1,600 orders + 7 x 500 fills to cached per-market ladders and one fills
    pass.
- Own orders and own fills on `player-<address>`, read through the engine's
  `accountOpenCount` / `accountOrders` / `accountFills`. A wallet that has
  never traded costs one O(1) lookup and publishes neither field.

**Known and not fixed:**

- **`orderView` still publishes the whole book.** It is inherently O(N)
  because it *is* the book; §4's answer is to publish the ladder instead, and
  own-orders moving to the player record is what makes that possible. This is
  the last §4 item.
- **`fill.market` costs ~13.5 KB** (27 B x 500 rows) on the published fills
  array. The obvious offset is that `maker`/`taker` duplicate `buyer`/`seller`
  entirely and could collapse to a `takerSide` flag, worth ~100 B a row.
- **`M.previewPolicy` deep-copies the whole state**, which now includes the
  index. Rare admin path, but it is the one place the index costs something.
- **`Admin.RemoveAccount` still scans `EconomyState.orders`** rather than
  asking `accountOpenCount`. Rare path, correct as written.

---

## 12. Built: the split, and both venues (2026-09-06)

§6 said "both halves ship" and predicted the shape almost exactly. This is what
actually landed, and the three places it differs.

### The book is its own file

`orderbook.lua` — the registry, the index, matching, escrow, fees, TIF, STP,
the price band, candles and the public verbs. `economy.lua` keeps what only the
GAME has: issuance, the NPC desk, monetary policy, and the published view that
mixes the two.

The seam is a **HOST**, not the three-function ledger §6 predicted. Six
functions, because the book turned out to reach for three more things than the
ledger: `ensure`, `ledger`, `pool`, `fee`, `tradable`, `pauseReason` — plus
three optional hooks (`quote`, `settleHouse`, `anchors`) for a house that
quotes into the ladder. A venue leaves all three nil and simply has no house
liquidity.

Every public signature is unchanged, so `game.lua` and both suites were
untouched by the extraction.

**One behaviour change, and it is a fix.** A buy-side refund, an amend release
and a re-queue all named `state.gold` outright, so a market quoted in anything
but Gold would have returned its escrow into the Gold supply and broken
conservation on both sides. Every market in the game is Gold-quoted, so nothing
observable moved — but Rune/Relic is the first pair that would not have been.

### Two venues, one file

`venue.lua`, deployed twice. §6's table was right about what differs and wrong
about it being one process:

| | **internal** | **external** |
|---|---|---|
| talks to | the game process, and nothing else | listed token processes, and nothing else |
| assets | in-game names — no token, ever | TEST-RUNE, TEST-RELIC |
| value in | `Venue.Credit`, a trusted message | `Credit-Notice` |
| value out | `Venue.Return` | `Transfer` |
| pair | everything against Gold | `rune/relic`, and for now only that |

The isolation is the point and it is enforced twice: `Admin.Seal` freezes the
mode, and every custody handler is registered against one mode only, so the
internal venue has no verb a token could reach and the external one has none
the game could. `venue_test.lua` spawns both in one VM and checks each refuses
the other's.

**Custody is deposit-first (§10), and modelled on the Rune bridge with the burn
taken out** — the venue *stores* what it is paid. Both directions are keyed on
a mandatory reference namespaced by the sending process, neither table is ever
trimmed, and anything uncreditable is quarantined rather than refused. Both
tokens now emit a `Reference` from their own `TransferSeq`, so the guard keys
on the token's word rather than on a message id.

### Markets are created closed

§2.5's registry became an admin surface. `Admin.CreateMarket` makes a market
`closed`; `Admin.LaunchMarket` opens one; **`Admin.LaunchAll` is the going-live
switch** and exists so that launching is one message rather than one per
market. `Admin.SuspendMarket` stops new crossing without touching resting
orders — their owners can still cancel out.

A base asset may head only ONE market, because the book's index is keyed by
base. `resolveMarket` now falls back to "the one market this asset is the base
of", which is what lets `Item = "rune"` find `rune/relic` with nothing in the
message naming relic. Both direct lookups still win, so inside the game the
fallback never runs.

**The order-creation cost became a market field.** It had to: 1 is friction
against Gold and nonsense against Relic, where it charges a millionth of a
token and refuses the first sell from anybody who has none. It defaults to the
constant, so §7.3's argument about the in-game 1 Gold is unchanged and still
open; the venues set 0.

### The emergency stop, and no withdrawal window

§10 argued against a delay and the answer stands: AO has no fraud-proof window
to wait out, so a delay taxes every honest user to buy nothing. What ships
instead is an explicit, logged stop with a scope:

- `Scope = "trading"` (the default) stops every order verb and leaves deposits
  and withdrawals open. That is the shape of almost every real emergency — stop
  the book, let everyone take their money home — and **cancelling out keeps
  working while paused**, because cancelling is what frees a balance.
- `Scope = "all"` additionally freezes withdrawals. It has to be asked for by
  name, because a stop that traps people's money is a different and much
  heavier decision.
- **Deposits are never stopped by either.** The value is already inside the
  contract by the time a deposit is seen; refusing only loses it.

### In-flight, and the invariant closes across the boundary

The one thing §6 did not think about. Units at the internal venue are not
consumed and not held by a player, so before this they fell straight out of
`issued - consumed == player + escrow + shop` and conservation went red the
first time anybody used the bridge.

Every supply row gained a `venue` bucket, both invariants count it, and
`/now/supply` publishes three numbers per asset — `total`, `inGame`, `atVenue`
— which is the invariant restated as something a client can check. The venue
publishes its own `supply` for the other half of the same reconciliation.

That surfaced a real defect: `recordPlayerDeltas` infers issuance and
consumption from how player records changed, which is right for every gameplay
verb and wrong for one that already moved the buckets itself. It subtracted the
same ten berries twice and recorded a sink that never happened. `Economy.` was
already exempt; `MANAGED_ACTIONS` names the venue verbs the same way, including
in the Gold branch where `Admin.SettleVenueReturn` would otherwise have been
funded out of the locked reserve on top of its own bucket move.

### Client and soak wiring (2026-09-06)

`src/lib/venue.ts` now speaks the shared order and custody protocol, and the
Market screen renders both venue books with deposits, bids/asks, cancellation,
and withdrawals. The fifty-wallet swarm drives deposits, resting orders,
amends, fills, cancellations, and exits on both venues. Its lived-in receipt
also keeps the original in-game Gold book and finite NPC shop as separate
required paths.

### Still not built

- `publicView` still publishes `orders` and `fills` in full (§4). Neither venue
  does, so the pattern to copy now exists in the repo.
- `Economy.Order.Maintain` still pays its keeper nothing (§1.3).
- The in-game order-creation cost is still 1 Gold (§7.3).
**Verified before the client wiring:** venue 101 on a live `~lua@5.3a` and offline, game 897, economy
164, hunt 25+38, rune 85, marketplace 11, minify 17/17 including the deploy
ceiling.

---

## 13. What the Solidity books do, and what of it is worth taking (2026-09-06)

Read against [OasisDEX/`maker-otc`](https://github.com/daifoundation/maker-otc),
which [hord's DEX](https://github.com/hord/hord-orderbook-dex-contracts) is a
fork of (`SimpleMarket.sol` + `MatchingMarket.sol`), and
[samwitch-orderbook](https://github.com/PaintSwap/samwitch-orderbook), which is
the modern red-black-tree answer to the same problem.

### The short version: they are optimising a different cost

On Ethereum the cost is the **storage write** — ~20,000 gas per 32-byte slot —
so every trick in both codebases is about touching fewer slots. Here a slot
costs the size of the **whole published map, five times over, whatever the
message did** (CLAUDE.md), and compute is 231 us and therefore free.

That inverts almost every conclusion:

| their optimisation | why it exists | here |
|---|---|---|
| red-black tree over price levels (`O(log n)`) | tree ops are storage writes | **no.** Our index is derived, never published, rebuilt on absence. Its shape is pure compute — free. |
| four orders packed into one 256-bit word | 4x fewer SSTOREs | **no.** Lua tables have no slot alignment to exploit. |
| deferred `claimable` settlement, no transfer on fill | a transfer is gas | **no.** In-process settlement is free, and deferring it would break `goldInvariant`. |
| caller-supplied insert hint (`_findpos(id, pos)`) | walking the list is gas | **no.** `priceSlot` is already a binary search. |
| tombstone deletion (`delb = block.number`) | deleting is a write | **no**, and we rejected it on purpose: a tombstoned heap grows with every order the book has EVER held. See the note on `heapBefore`. |

So: **the data structure is not the lever.** Anyone proposing we port a
red-black tree into `orderbook.lua` is optimising the one dimension that is
already free, and the measurement to demand before believing otherwise is the
same one CLAUDE.md demands of a language change.

### Two things ARE worth taking, and one of them is a real bug

**1. The dust rule, and we do not have it.** OasisDEX carries `_dust[token]`
and, after every partial fill:

```solidity
if (isActive(id) && offers[id].pay_amt < _dust[address(offers[id].pay_gem)]) {
    cancel(id);
}
```

We enforce `minValue` at **creation** and never again. So a 400-lot ask at 12
Gold that gets swept down to one lot leaves a 12-Gold order resting for its
full 30-day lifetime — below the 10-Gold minimum the book refused to accept in
the first place. It occupies a price level, a heap slot, an account slot
against the 20-order cap, and published bytes, and it does all of that on the
touch, where it is the first thing every taker has to walk past.

This is the single highest-value idea in either codebase for us, it is about
fifteen lines in `settleFill`, and it costs nothing: the escrow release path
already exists (`cancelOrder` with a reason). Reason it `"dust"` so the owner
can tell it from an expiry.

**2. Do not store what is derivable.** OasisDEX stores **no price at all** —
an offer is `pay_amt`/`buy_amt` and comparison is a cross-multiplication
(`_isPricedLtOrEq`), so there is no price field, no tick, and no rounding. We
should not copy that specific trade (we would lose the price-level index, which
is what makes our ladder cheap), but the principle is exactly what the byte
audit below found, independently, in our own published state.

Worth noting that OasisDEX also has `_span[pay][buy]` — a live count per pair —
which we already have per-account and globally in the index.

### The byte audit, and what each line actually is

Measured on the live process. ~250 KB of published state, and roughly two
thirds of it is one rule being broken.

**`fills` — 96 KB, 199 rows at 482 bytes.** Five of seventeen fields are
43-character addresses: `buyer`, `seller`, `maker`, `taker`, `feePayer`. But
`maker`/`taker` are always a permutation of `buyer`/`seller`, and `feePayer` is
assigned `taker.account` on the line that builds the record — five fields
carrying two facts. Add `gross` (it is `price * quantity`), `feeAsset` (it is
the market's quote), and `item` (it is the market's base), and a fill is about
100 bytes of information wearing 482.

The compaction is `buyer`, `seller`, and a one-character `takerSide`. That is
~200 bytes a row, 41%.

**But the real answer is that `fills` should not be published at all.** §11
already said so and nobody took it; `venue.lua` now ships as the proof that a
book does not need to. The candles keep the price history permanently, and
`player.recentFills` gives a trader their own. The client's `ownFills` selector
already prefers the record and only falls back to the global array for a
process that has not been redeployed — that fallback is exactly the bridge this
change was designed to cross.

**`orders` — 71 KB, and it is the same 130 orders twice**: a list in
`economybook` (`orderView`) and a map in `economystate` (`exportState`).
"Publish a record once" (CLAUDE.md), violated as plainly as it can be.
`economystate` needs them — it is the restore shape. `economybook` does not:
the ladder, the band and the candles are all published, and `ownOrders` prefers
`player.openOrders`. Drop `orders` from `bookView` and the 71 KB halves; the
remaining copy compacts further (`id` is `"O" .. seq`, `market` is derivable
from `item` while a base heads one market, `lot` is 1 on every in-game row).

**`actionReceipts` — 59 KB.** Key is `<43-char address>:<action-id>` at 60
bytes against a 51-byte value. Two separate problems:

- **The bound is wrong, not just the size.** `rememberAction` evicts by COUNT
  (`while #state.actionReceiptOrder > 500`), so a busy hour silently evicts a
  receipt that is still inside a browser's retry window — and an evicted
  receipt re-arms a double-place, which is what the whole mechanism exists to
  prevent. Evict by AGE instead. An hour is longer than any client retry and
  shorter than the current bound in every interesting case, so it is both safer
  and usually smaller.
- Do not drop the address from the key to save 43 bytes. The `ActionId` is
  client-chosen, so an unnamespaced key lets one wallet's id swallow another
  wallet's order. Shorten the VALUE instead — `kind` is a fixed vocabulary and
  can be one character — and stop publishing the map at all. It has to survive
  a redeploy (`exportState`), which is not the same as being in `bookView`.

**`desks.accountUsage` — 15 KB, and this is the one that grows with the
playerbase.** `pruneDeskUsage` is correct and is called from the right place —
but only from `usageRows`, which is only reached when somebody **trades that
desk**. A desk nobody has traded this month keeps every stale row from every
month before it, and every message marshals all of them five times. Eviction is
trade-triggered where it needs to be time-triggered: sweep every desk when the
process notices a new window, not only the desk being traded.

This one is `economy.lua`, not `orderbook.lua` — the desk did not come out in
the split, deliberately.

### The order to do them in

1. **The dust rule.** A correctness gap, ~15 lines, and it is the only item
   here that makes the touch better rather than the bytes smaller.
2. **Stop publishing `fills` and `orders` in `bookView`.** ~167 KB of ~250 KB,
   no new mechanism, and the client fallback for it already shipped. Needs two
   small replacements first: a published open-order COUNT (the index already
   has it) for the market header, and a bounded per-market trade tape — 30 rows,
   compact — for the intraday chart, which is the one thing the candles do not
   cover.
3. **Age-based receipt eviction.** A correctness fix wearing a byte fix.
4. **Sweep every desk's usage on a window roll.** The only line here that gets
   worse as the game succeeds.
5. **Compact the fill and order records** that remain in `exportState`,
   `accountFills` and `player.recentFills`. Worth ~40% of whatever survives
   step 2, and it is the least urgent because it is the smallest.

Steps 2-5 are all the same rule — publish state, never constants; publish a
record once; bound at the point of append — and none of them is a new idea.
They are the ones nobody has taken yet.

## 14. Built: the public tape (2026-09-07)

Step 2 above named "a bounded per-market trade tape — 30 rows, compact" as a
prerequisite. It is built, as `venuetape`, and it differs from that sketch in
one way that is worth writing down: **the bound is venue-wide, not per market.**

The cost of a published key is the key, not the market. A per-market bound
multiplies by however many markets a venue lists — the internal venue lists six
— and it does so silently, because nobody revisits a constant when they add a
market. One ring for the venue is a number that stays the number.

### What it is

`OrderBook.tapeView` walks the tail of `state.fills` and returns the last
`C.ECONOMY.orderbook.tapeLimit` trades, grouped by market id, each one a
positional tuple:

    { "fire_berry/gold": [ [ at, price, quantity, takerBought ], ... ] }

- `at` is **seconds**. `filledAt` is milliseconds and the last three digits are
  three bytes a row that no bar boundary can see.
- `takerBought` is 1 when the buy side took and 0 when the sell side did. It is
  the one fact a printed price does not carry, and it is what colours a tape row
  everywhere else.
- Positional, because the names would be 15 of the 40 bytes. The tuple order is
  the contract with `src/lib/venue.ts` and it is asserted on the **raw**
  published text in `venue_test.lua` — decoding through `json` floats every one
  of those integers, so `math.type` on a decoded value proves nothing.
- No address, no order id, no fee, no fill id. A tape is public; a fill's
  parties are not.

### What it cost, measured

Measured on a live `~lua@5.3a` through `jsonenc.lua`, which is the encoder the
venue actually publishes with. The Luerl half only — `hb_cache:ensure_all_loaded`
and `hb_cache:write` scale with bytes too — so these are floors:

| | KB | bytes/row | ms per encode pass |
|---|---|---|---|
| `state.fills`, 500 rows (published today, inside `venuebookstate`) | **138** | 282 | 367 |
| `venuetape`, 128 rows | **4.8** | 38 | 2.4 |
| `venuetape`, 64 rows | 2.4 | 38 | ~0 |

For scale, a venue's whole published map is **9.4 KB** today (measured on the
internal venue: six markets, empty book).

So the tape at 96 rows is ~3.6 KB and about 4 ms of the marshalling every slot
pays five times over. **It publishes no trade the venue was not already paying
for** — `state.fills` rides in the state export regardless — it publishes the
readable, address-free quarter of one.

### The finding this turned up

`historyLimit = 500` is the largest single line in a busy venue's published
state: 500 rows × 282 bytes = **138 KB**, marshalled on every message, which is
~700 ms of Luerl work a slot before anything else happens. That is 38× the
tape's cost and it buys nothing a reader can see.

It is not a free knob. `state.fills` reseeds the per-account fill rings after a
redeploy (`orderbook.lua`, `ACCOUNT_FILL_RING`), so cutting it shortens how far
back a player's own history survives a deploy, and it anchors the price band's
median on a venue with no desk. Cutting it to ~150 would save ~100 KB and is
worth its own decision — it is not part of this change.
