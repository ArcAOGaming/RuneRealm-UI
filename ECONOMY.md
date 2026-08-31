# Rune Realm — economy notes

> **Planning status (2026-08-30):** These are earlier economic observations and
> candidate mechanisms. The canonical plan for the Gold economy, P2P market,
> game shop, Rune value loop, on-chain paid participation, and companion/export
> boundaries is [ECONOMY_MARKETPLACE_PLAN.md](ECONOMY_MARKETPLACE_PLAN.md).
> Where this file conflicts with that decision record, the decision record is
> the planned direction.

Speculative. Nothing here is implemented. This is written against what the
2026-08-30 load and soak testing actually measured, so the constraints below are
observations rather than assumptions, and the proposals are things the existing
architecture could carry without a rewrite.

The brief it is answering: an economy that is not bot-to-win, not pay-to-win but
*kinda* pay-to-win, cheap enough not to gate people out, where value accrues to
Rune, where holders are inclined to put money in rather than take it out, and
where one person with a million bots cannot ruin it.

---

## 1. What the testing actually established

These matter because three of them quietly decide the design.

**Fifty bots playing flat out go broke in hours.** A quest costs 1 Rune, an
arena session of four battles costs 1, storing a companion costs 1. The only
faucet that is not itself paid for in Runes is the daily stipend: 1 Rune at
base, 2 at a 3-day streak, 3 at 10 days, on a 20-hour interval. Across the soak
the wallets sat at 0-3 Runes and spent every one. The economy is already tight.

**The tightness is deliberate and was a fix.** HANDOFF §5.18: a tier-1 box —
what every arena win awarded — was worth about 1.09 Runes against a session
costing 1, so winning half your fights roughly doubled your money, and two
players trading PvP wins could farm indefinitely. Runes became a tier-2+ drop at
a lower rate and the stipend became the only real faucet. Do not undo this
without re-running `run-balance.sh` and the fuzzer.

**Wall-clock, not compute, limits a single wallet.** Play and quest are real
timers. A bot cannot compress them. Per-wallet yield per hour is already capped
by design, which means the bot problem is a *wallet count* problem and not a
*bot speed* problem. That is the single most useful thing the testing showed,
because it says where to aim.

**The process is the throughput ceiling, and it is low.** Measured: ~1.0-1.24
actions/second sustained regardless of concurrency, and throughput *falls* as
concurrency rises (351 actions at 10 concurrent, 149 at 50) because one AO
process serializes. A million bots cannot act. They can, however, each send one
cheap `Daily.Claim` per day, and that is the attack that actually scales.

**The bridge is one function.** `Rune.Withdraw` is the only way in-game Rune
becomes token Rune — the game deducts, then asks the token to mint, so supply
can never exceed what was earned. Everything below leans on this being a single
chokepoint, which it is.

---

## 2. The one structural flaw

Every per-wallet faucet is a sybil magnet, and the daily stipend is per wallet.

`C.DAILY` is keyed to the wallet and the clock so that *playing more* cannot
farm it. That correctly stops one wallet farming faster. It does nothing about
ten thousand wallets each claiming once. Total emission is
`stipend x wallets x time`, and `wallets` is free to create.

So the current design is not bot-to-win in skill terms, but it is
**bot-to-win in supply terms**, and that is the thing that ruins an economy: not
that bots play, but that bots mint.

---

## 3. The proposal, in order of how much it matters

### 3.1 Fix global emission and share it. (the important one)

Instead of "every wallet gets 1-3 Rune per 20 hours", mint a **fixed number of
Rune per day globally** and divide it among that day's claimants.

One person with a million bots then does not increase supply by one Rune. They
dilute their own share, and everybody else's, in exactly the proportion they
added. Botting stops being profitable *without banning anyone*, which is the
only kind of anti-bot rule that does not turn into an arms race.

It also makes the supply schedule knowable in advance, which is what anyone
speculating on the token actually needs. "Emission is 10,000 Rune/day, halving
yearly" is a thing a holder can price. "1-3 per wallet per 20 hours, wallets
unbounded" is not.

Two details that make or break it:
- **Weight the split by something bots cannot cheaply buy** — companion level,
  streak length, battles actually fought that day. A wallet that only claims
  gets the floor share; a wallet that plays gets a multiple. This is where the
  "not bot-to-win" property really comes from, because it makes the *quality* of
  a wallet matter rather than the count.
- **Settle it the day after.** You cannot divide a pot among claimants you have
  not finished counting. Claim day N, mint day N+1. The process already keeps
  `Checkins` keyed by epoch day, so the bookkeeping exists.

### 3.2 Defend the faucet, never the exit.

An earlier draft of this file proposed withdrawal caps. That was wrong, and the
objection that killed it is the right principle: **once it is yours it is yours;
what needs stopping is the unfair GETTING of it.** A withdrawal gate taxes the
honest player cashing out and merely delays the farm, which has nothing but
time. Every defence below therefore sits at emission.

**Bond, do not charge.** To be eligible for the daily share, hold a refundable
stake — Rune, or AO once it is the pair. Not a fee: a deposit, returned when you
stop. A farm needs N bonds locked at once, so its capital cost scales linearly
with wallet count while no player is charged anything. It also composes with
§3.4 rather than competing with it: the bond IS the stake.

**Weight the share convexly.** Make a wallet's slice superlinear in its own
progression — share proportional to activity squared, or to streak times level.
Split one account into ten shallow ones and the ten collect `10 x (1/10)^2`, a
tenth of what the single account would have. Sybil splitting becomes
arithmetically self-defeating, with no identity provider anywhere in it. The
honest cost: convex curves concentrate rewards on the dedicated, so it wants a
floor underneath it or newcomers earn dust and leave.

**Weight by what cannot be parallelised.** Streak length is the best signal
available and it is already tracked: a 10-day streak costs ten days of wall
clock per wallet, and a farm cannot compress it (§1). Level, battles actually
fought and quests completed are all in the same family.

**On linking a social account.** It is the weakest option here. Aged X accounts
are sold in bulk for a few dollars, so it lifts cost-per-wallet from nothing to
very little; it makes you a permanent customer of somebody else's API pricing
and terms; and it plants a centralised identity dependency in the middle of a
permaweb game. If some external signal is wanted, an aggregated
proof-of-personhood score is strictly better than running the check yourself,
because it is somebody else's arms race. But under fixed emission (§3.1) none of
this is load-bearing, which is the point of doing §3.1 first.

### 3.3 Make sinks burn, so play is deflationary.

Today a quest fee leaves the player's inventory and stops existing, which is
fine in-process but does nothing for the token. Once Rune is a real token, route
sinks so that activity *reduces* circulating supply:

- Fees paid in **token** Rune get burned rather than recycled.
- Or better, fees buy Rune from the AMM and burn it, so activity becomes buy
  pressure on the pool rather than a bookkeeping entry.

That converts "people playing" into "supply shrinking", which is the mechanism
that makes an economy rise together instead of bleeding out.

### 3.4 Staking should pay fees, not emissions.

This is the part to be careful about, because the obvious version is a trap.

**Staking that pays newly minted Rune is a faucet with extra steps.** It pays
holders in dilution of themselves. It looks like yield and is a transfer from
whoever sells last.

**Stake for a share of sinks instead.** Everything in §3.3 — withdrawal fees,
burned quest and arena fees, marketplace commission, card-mint fees — flows to a
pot that staked Rune claims pro rata. That is real yield, denominated in actual
game activity, and it is non-inflationary by construction.

The effect on behaviour is what you asked for: holding Rune becomes a claim on
the game's economic activity, so the rational move for someone who believes in
the game is to buy and stake rather than extract. Money comes in and stays in
because leaving costs you the yield.

### 3.5 The pass is the "kinda pay to win", and it is already built.

The Eternal Pass is the right sybil gate and it exists — 168 wallets hold one.
Access costs something once, and that once is what a bot farm has to pay per
wallet.

- Pay-for-**entry** rather than pay-for-**power** is the version of pay-to-win
  that does not rot a game. A pass buys a seat, not a bigger sword.
- Under fixed global emission (§3.1), buying ten passes buys ten slices of a pie
  that does not grow. Whales fund the treasury and cannot inflate the supply.
  That is "kinda pay to win" with a hard ceiling on how much.
- **Fixed emission is what lets the pass be CHEAP.** This is the part worth
  getting right, because the two changes are only strong together. Under a
  per-wallet faucet a farm earns `stipend x wallets`, so deterring it needs an
  expensive pass — exactly the thing that gates real players out. Under a fixed
  global pot the farm earns a *share*: add ten thousand wallets alongside ten
  thousand players and you have bought half a pie that did not grow, for ten
  thousand pass prices, and each wallet returns a ten-thousandth of a fixed pot.
  The pass only has to exceed that per-wallet share, which is tiny. A cheap pass
  and a fixed pot defend each other; either alone is weak.

Sell passes for the **quote** token, not Rune. That is real value entering the
system from outside rather than recycled Rune, and it gives the treasury
something to pair against Rune in the pool.

---

### 3.6 Sinks worth adding, and one to be careful with.

Per-attempt, optional sinks are the good kind: they price a choice the player
makes, they scale with engagement, and nobody is stuck behind them.

- **Starting a hunt**, and **catching** in the hunt (see `HUNT.md`, in progress).
  Both are per-attempt and both are the moment a player most wants to spend.
- **Booster packs**, below.

**Level-up is the one to be careful with.** Charging Rune to level gates
*progression* behind currency, which inverts who the economy is hard on: a
Rune-rich farm levels freely while a player who spent theirs stalls at a wall
they cannot pay through. If it charges at all, keep it nominal, or take the fee
in something earned rather than traded.

### 3.7 Sell booster packs, not power.

The right shape for paid content here, and it is a different lever from the
pass:

- Pack contents are **cosmetic and collectible only**, and pack-exclusive
  content stays exclusive. Buying packs never buys a bigger number in a fight.
  That is what keeps "kinda pay to win" from becoming pay to win.
- Sell them for **AO**, once it is the pair. That is outside value entering the
  treasury, which is what the pool needs to be paired against Rune.
- Because packs cost real money and grant no power, they are uninteresting to
  farm: botting a pack purchase is just buying one.

### 3.8 Trading belongs INSIDE the authority process.

The instinct to keep player-to-player trading in-process rather than in the
marketplace process is right, and `CLAUDE.md` now carries the measurement that
settles it: adding a domain to the authority costs ~231 microseconds against a
~100 ms message, while taking one out costs ~160 ms per cross-process hop —
about 320 ms per interaction, for nothing.

A trade is one intent and a handful of state transitions on state the authority
already owns: two inventories, two rosters, one ledger entry. It is the textbook
case for condensing. The separate marketplace process earns its keep only for
things that must settle against an external token or an L1 asset.

## 4. What to test before believing any of it

The harness already covers most of this; the gaps are named.

| Property | How to test | Status |
| --- | --- | --- |
| Sinks exceed faucets over a long run | 6h soak, track total Rune held across all 50 | `swarm` + a supply reader — **the reader does not exist yet** |
| No infinite-money loop | `fuzz.mjs` already asserts a refusal changes nothing and that population is conserved | covered |
| PvP win-trading cannot farm | two wallets trading wins over a long soak | duelist pairs exist; the assertion does not |
| Emission is bounded globally | mint N wallets, confirm total emission is flat | **needs the fixed-emission change first** |
| Withdrawal gating holds | `amm-load.mjs`, extended to hammer `Rune.Withdraw` from many wallets | partially — the tool exists |
| Pool cannot be drained by rounding | swap 1 unit repeatedly against a thin pool | **not tested; the "Input is too small" refusal is the guard and it fired** |

The one measurement missing that everything else depends on: **total Rune
supply over time, across all wallets, in-game and on-token.** Without it there is
no way to tell whether the economy is inflating. It is a small reader over
`player-<address>` plus the token's `totalsupply`, and it should run on every
soak.

---

## 5. The shortest version

1. Fixed global daily emission, split among claimants and weighted by real play.
   This alone defeats the million-bot attack, because bots dilute each other.
2. Gate `Rune.Withdraw`, not gameplay. Free to put in, gated to take out.
3. Burn sinks, ideally by buying Rune from the pool, so playing shrinks supply.
4. Stake for a share of fees, never for new emissions.
5. Sell the pass for the quote token. It is the sybil gate, the "kinda pay to
   win", and the treasury's source of outside value, all at once.

The property that ties them together: **supply is capped and known, demand comes
from activity, and the only way to get more of the pie is to make the pie worth
more.** That is what makes holders speculate rather than extract.
