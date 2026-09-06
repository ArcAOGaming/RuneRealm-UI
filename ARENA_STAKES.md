# Arena stakes — a conservative arena

Status: **design, not built.** Written against the constants and code as they
stand on 2026-09-06. Nothing here is deployed.

The arena pays. Every version of "the arena pays" so far has been a faucet with
a cap bolted on, and the cap is what stops it printing rather than anything
structural. This is the structural version: **the arena issues Gold only to
replace value it destroyed, and everything on top of that is redistribution
between players.**

---

## 1. The three layers

**Base — value-neutral.** A battle consumes energy and happiness. Energy comes
from berries (`C.ACTIVITIES.feed.energyGain = 10`, so a 25-energy entry is 2.5
berries); happiness comes from a fifteen-minute Play. The arena pays Gold worth
what it burned. Nothing is created: item supply is converted into Gold supply at
the prevailing rate.

**Competitive — zero sum.** Entry Gold goes into a pot. Winners draw from it,
losers forgo theirs. Across all players the pot pays out exactly what was paid
in, so no Gold is created or destroyed by competition — only moved.

**Skill — emergent.** A player who wins more than the population takes more than
they stake. A player who wins less takes less. Nobody is paid for showing up.

The only faucet in the whole design is the base layer, and it is bounded by a
real sink: you cannot mint Gold without first destroying berries.

---

## 2. The two pots

**PvP — one pot per battle, drained completely.**

The challenger names a stake. The accepter agrees to it, and agreeing is what
starts the fight. Both stakes are escrowed at accept. The winner takes the whole
pot. Zero rake.

This is perfectly conservative per battle, and collusion is a non-issue: two
accounts trading wins at any stake are only moving Gold between themselves, which
is what a wager is.

**Bot — one shared pot per difficulty tier, drained partially.**

Entry Gold goes into the tier's pot. A win pays a fixed FRACTION of the pot, not
the whole thing. Losers' stakes stay in and fund later winners.

### Why the fraction removes the need to track a win ratio

The original idea was to track each tier's rolling win ratio and multiply the
payout by it. A shared pot with a fixed drain does the same thing, exactly, with
no bookkeeping — and cannot be driven.

With stake `S` per entry, drain fraction `d`, and population win rate `w`:

```
  inflow per battle   = S
  outflow per battle  = w × pot × d
  equilibrium         = pot* = S / (w × d)
  payout per win      = pot* × d = S / w
  EV per battle       = w × S/w = S
```

The payout per win settles at `S / w` on its own. That is the win-ratio
multiplier — a tier nobody wins pays a lot, a tier everybody wins pays a little
— arrived at by arithmetic rather than by a statistic somebody has to maintain,
bound, window and defend.

Three properties follow:

- **EV is the stake.** Average players get their stake back. The base layer is
  what makes playing worthwhile; the pot is what makes winning worthwhile.
- **It cannot be farmed above what is in it.** A ratio can be pushed by a player
  who owns the sample. A pot cannot pay out Gold that was never staked, so
  deliberately losing to inflate the multiplier means funding it yourself.
- **It self-corrects at whatever speed the tier is played at**, with no window to
  choose. A short window swings and is drivable; a long one never moves. The pot
  has neither problem because it is not an average.

State cost: **two integers per tier.** O(tiers), never O(wallets) — the one shape
CLAUDE.md permits a derived key to have.

---

## 3. Pricing the base layer — the one thing that will be exploited

"Pay Gold equal to the berries consumed" must mean **valued at the desk's live
bid**, never at a constant.

Berries trade on the internal order book. A fixed conversion rate beside a free
market is an arbitrage the moment the two diverge: when berries are cheaper than
the constant, battling buys Gold below cost, and the loop accelerates as the
price falls. It is the standard way a game economy with a pegged rate dies.

`economy.lua` already has the floating number:

- `deskAnchors(state, item)` (`economy.lua:3430`) — the desk's live bid/ask,
  derived from stock and band.
- `median7d` / `median30d` (`economy.lua:3838`) — the traded price.

Use the desk **bid** (what the realm will actually pay for a berry). Then a
falling berry price lowers the Gold payout in step and there is nothing to farm.

---

## 4. What this changes

| | today | proposed |
|---|---|---|
| bot win | `gold = winGold` (5), capped per 20h window | base (berry value at desk bid) + share of tier pot |
| bot entry | free | Gold stake into the tier pot |
| PvP win | `grantGold(winGold)` | whole battle pot |
| PvP entry | free | challenger's stake, matched by accepter |
| ratio tracking | none | none — the pot replaces it |

Code sites: `fleetSettle` and the fleet `rewardPlan` (`game.lua`, bot path),
`payout` inside `settleBattle` (`game.lua:4020-4043`, PvP), `grantGold`
(`game.lua:795`), and the entry checks at `game.lua:4198-4199`.

---

## 5. What this needs that does not exist yet

**Escrow on PvP stakes.** Both stakes locked at accept, not at settle, or a
losing player closes the tab and never pays. The order book's `escrow` on asset
rows is the same problem already solved; reuse it rather than re-deriving it.
Needs refund on expiry and on cancel.

**Exactly-once settlement.** HUNT.md records a run stuck in `settling` forever
because an acknowledgement was lost. A stake settle must be idempotent on a
`Reference`, not on "have we run this already".

**A live pot in the UI.** The payout is whatever is in the pot, so the screen
must show the pot, not a promised rate. A tier everyone is currently winning
pays little, and a player who picked it expecting a headline number was misled.

**Walkthrough changes, same commit.** `ENTRANCE_TOUR` in `screens/Arena.tsx`
states the entry cost and what a win pays. Both move. CLAUDE.md is explicit that
a tour describing rules the game no longer has is worse than no tour.

**Tests.** `winGold` and `grantGoldReward` have no assertions today, which is how
the fleet path kept paying a loot box for so long after the in-process path
stopped. Anything here needs: a stake escrowed on accept, refunded on cancel,
paid once on settle, and a pot that never pays out more than went in.

---

## 6. Decided

- Gold goes **into the pot**, not burned.
- **Zero rake** on PvP.
- PvP: **one pot per battle**, drained fully.
- Bot: **shared pot per tier**, drained partially.
- Losers **forgo** their stake.

## 7. Still open

- **The drain fraction `d`.** It sets how fast the pot responds and how lumpy a
  win feels. Low `d` is a big slow-moving pot and rare large payouts; high `d`
  is a small responsive pot and steady small ones. It does not change EV.
- **Stake size, and whether the player picks it.** A fixed stake per tier is
  simplest. A player-chosen stake makes bot battles a wager too, which is more
  interesting and more work.
- **How many tiers, and who sets difficulty.** The multiplier is only meaningful
  if tiers have genuinely different win rates.
- **Onboarding order.** A new wallet has no Gold, so if every battle costs Gold
  they must quest first (`goldReward = 15`). That is a defensible order but it
  is a change to the first ten minutes and should be chosen, not discovered.
- **What happens to the time gate.** `C.BATTLES_PER_SESSION = 4` exists because
  "the session is free in v2; what bounds it is the 25 happiness it costs to
  enter, and happiness comes only from a fifteen-minute Play. Four actions an
  hour is the ceiling, for everyone." A Gold stake replaces a ceiling that binds
  everyone equally with one that binds the poor player harder. Keep both, or
  accept that trade deliberately.

---

## 8. Showing a player whether a tier is worth it

The payout is whatever is in the pot, so a headline rate would be a promise the
design does not make. What a player needs instead is enough to judge for
themselves, and the number that does that is the **break-even win rate**:

```
  payout now      P = pot × d
  break even      w_be = S / P
```

It is a fact about the tier, not a prediction about the player. And it has a
useful property: at equilibrium `P = S/w`, so `w_be = w` — break-even converges
on the tier's own observed win rate. **The gap between the two is the value
signal.**

- pot above equilibrium, after a run of losses fed it -> `w_be` drops BELOW the
  observed rate -> the tier is good value right now
- pot below equilibrium -> `w_be` rises above it -> poor value right now

So four live numbers per tier, and the player decides:

| Tier | Stake | A win pays | Break even above | Players win |
|---|---|---|---|---|
| Hard | 10 | 34 | 29% | 22% |

Read as: the average player loses here, but above 29% you are ahead. When a
losing streak fattens the pot, "a win pays" climbs and break-even falls, and the
tier visibly becomes worth attacking. Timing becomes a decision a player can see
rather than one they cannot.

### The win rate is for DISPLAY only

§2 shows the payout needs no win-rate tracking, and that stays true. This
section adds the statistic back for the screen, and the separation is the point:

- a **display** statistic that is skewed costs a misinformed player
- a **payout** statistic that is skewed is farmable

So a player can push the displayed rate by dumping games and gain nothing,
because the payout still comes only from what is in the pot. Keep it that way:
if the win rate ever feeds the payout, the exploit surface from §2 reopens.

Two integers per tier (`wins`, `attempts`), O(tiers), a few hundred published
bytes for the whole table. Windowed rather than lifetime, so it still moves after
a few thousand battles — and unlike §2's rejected design, the window length is
now a cosmetic choice rather than a security parameter.

### Honesty constraints

- Publish the pot and the counts; let the client derive `P`, `w_be` and `w`.
  Publishing derived values means a stale read shows a number that was never
  true, and CLAUDE.md already puts derived state last in line for bytes.
- Never show a single "expected value". EV depends on the player's own win rate,
  which is exactly what the design refuses to assume.
- The numbers move between reading the screen and the battle settling. Show the
  pot at settle in the result, so a player can see what actually happened rather
  than what was advertised.

### The split: the contract publishes state, the UI does the rest

All of §8 is client work. The contract publishes four integers per tier and
nothing else:

```
  arenatiers = { ["3"] = { stake = 10, pot = 340, wins = 22, attempts = 100 }, ... }
```

The drain fraction `d` is a CONSTANT, so it belongs in `catalog` and is
published once for every tier rather than repeated on each — the published-state
rule in CLAUDE.md, and the same reason `monsterindex` now carries an overlay
instead of the catalog.

Everything a player reads is then derived in the browser:

```
  payout       P    = pot × d
  break even   w_be = stake / P
  win rate     w    = wins / attempts
  value now         = sign(w − w_be)
```

Three reasons this is not just tidiness:

- **A derived key inherits the size of what it embeds**, and it is rewritten
  whenever any of its inputs move. A published `payout` would be re-encoded on
  every settle in every tier, on a map every message pays for five times.
- **A stale derived value is a number that was never true.** A published payout
  read a slot late shows a figure nobody could have been paid. A published pot
  read a slot late is simply the pot, one slot ago.
- **Presentation changes should not need a redeploy.** Whether the screen shows
  break-even, a ratio, a colour or a sparkline is a UI decision, and a process
  is a permanent public thing to be changing for a label.

The one thing the contract must publish that is NOT derivable: the pot **at
settle**, on the battle result. A player needs to see what they were actually
paid, not what the screen was advertising when they clicked.
