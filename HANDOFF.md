# Rune Realm → HyperBEAM: handoff

You are picking up a rebuild of Rune Realm: off AO legacynet, onto HyperBEAM,
with the frontend rewritten and the game logic corrected. Most of it works. This
file is what you need to be useful in the first ten minutes.

Read in this order: this file, then [HYPERBEAM.md](HYPERBEAM.md) (verified
platform facts), then [README.md](README.md). If you are touching the interface,
[DESIGN.md](DESIGN.md) is the design system: the mark, the colour rule, the
shape language, the hand-built icons, and what the four graphics renderers are
each for. If you are writing story, quests, regions, enemies or public lore,
[LORE.md](LORE.md) is the canon source. If you are adding, evolving, naming,
illustrating, releasing or making a wild creature catchable,
[MONSTER_INDEX.md](MONSTER_INDEX.md) is the catalog and asset map.

If you are touching Gold, item trading, the game shop, Rune economic policy,
paid packs, or the marketplace process shape, read
[ECONOMY_MARKETPLACE_PLAN.md](ECONOMY_MARKETPLACE_PLAN.md). It is the canonical
next-build product plan and is deliberately separate from descriptions of what
the current deployment already does.

The landing page reveals only three core truths and puts the real companion
cards first. The longer public telling is staged at `/lore`, but that route is
deliberately absent from every navigation surface until the canon is ready.
The landing page also runs the real altar and vault renderers in exhibition
mode: altar selection only changes the light, and chest rewards are examples
that never call a game action.

---

## 1. Why this rebuild exists

The old Rune Realm ran on three AO legacynet processes:

| | |
|---|---|
| `j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI` | PremPass — access, factions, companions |
| `3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs` | MultiBattle — combat |
| `GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ` | Alter — offerings |

Legacynet is not a viable target any more, and everything the economy depended
on — the berry, gem, scroll and TRUNK token processes — lived there too. The
last message reached the game process in **February 2026**.

Nothing was portable as-is. The frontend went through `@permaweb/aoconnect` to a
MU and a CU; the backend spent tokens by sending `Transfer` and waiting for a
`Credit-Notice`. Both of those are gone, so both were replaced.

## 2. Live process

Node `https://schedule.forward.computer`. The id is also the default in
`src/lib/hyperbeam.ts` and is env-overridable.

| | |
|---|---|
| game | `4J_Pc2jHxf3T0ja0oX0lNo129j8JTFYKuEtKXJgDBPk` |
| owner | `DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8` |

Read anything with no wallet:

```bash
# live-process.txt is written by deploy.mjs: id, node, owner.
PID=$(head -1 live-process.txt); NODE=$(sed -n 2p live-process.txt)
curl "$NODE/$PID~process@1.0/now/factions"
curl "$NODE/$PID~process@1.0/now/leaderboard"
curl "$NODE/$PID~process@1.0/now/challenges"
curl "$NODE/$PID~process@1.0/now/users"
curl "$NODE/$PID~process@1.0/now/player-<address>"   # one whole player record
```

`player-<address>` is what makes connecting a wallet free. Each player's record
is republished under their own address whenever a message touches them, and the
whole table is rewritten on any `Admin.*` message — which is how a fresh deploy
gets a key for all 168 seeded wallets before anyone has played. A removed player
publishes `null`; a wallet the process never heard of 404s, and the client reads
that as "no Eternal Pass".

The client no longer signs `User.Login` on connect. That handler is still there
and still signer-only, but the read path is a GET now.

Redeploying mints a NEW process and resets its state, so the id above goes stale
the moment anyone runs `deploy.mjs`. `live-process.txt` is the source of truth;
this table is a convenience.

A deploy now points the app at itself: it writes the new id into
`src/lib/hyperbeam.ts` (the baked-in default, which is what a CI build with no
env set actually ships), `.env.example` and `.env.local`. `--no-env` skips that,
for standing up a throwaway process to test against. The site itself only moves
on its next build and deploy.

**Node health is not uniform.** `schedule.forward.computer` and
`jonny-ringo.xyz` serve the full spawn/write/read loop; `jonny-ringo` returned
502 for a stretch during this work, so the client falls back. `alpha.neo` serves
the free `~lua@5.3a` device fine (the test suites use it) but is not a process
host here.

## 3. The 168 paid wallets are recovered and live

The old process was allowlisted out of legacynet, but its **public Arweave
checkpoints are still downloadable from any gateway** — they are ordinary
transactions. The latest is nonce 42005, 2026-02-12.

`backend/native/recover-unlocked.mjs` pulls the `Unlocked` list out of one.
It does not grep for base64: the heap holds ~18,000 43-character strings, nearly
all message and transaction ids. It walks the Lua data structures instead —
finds every long-string object holding an address, scans the image for 32-bit
pointers to them, and looks for a stride-4 run of `TValue`s, which is what a Lua
array of strings looks like. Exactly one such run exists: **168 addresses, no
process ids mixed in.**

Those 168 are unlocked on the live process now.

If the owner's own record of who paid ever turns up, reconcile it:

```bash
node backend/native/merge-paid.mjs <their-list>   # writes paid.json
HB_WALLET=key.json node backend/native/deploy.mjs # redeploys and seeds it
```

`merge-paid.mjs` takes JSON, CSV, or a pasted chat message, keeps both origins,
and reports what only one source knew about.

### And so is everything else they owned

Carving one array out of a memory image by hand was the expensive way to read a
checkpoint. There is a better one: **boot it.** The module a checkpoint was
taken against (`Do_Uc2Sju_...`, aos-lg-2.0.1) is an ordinary Arweave
transaction, so handing both to `@permaweb/ao-loader` brings the dead process
back to life inside Node — real Lua VM, real globals, real tables — and an
`Eval` signed as the owner reads anything out. No CU, no SU, no MU: legacynet
being allowlisted-out never mattered, because gateways still serve transactions.

Nine processes came back that way, whole:

| | | |
|---|---|---|
| PremPass | nonce 42005, 2026-02-12 | 168 unlocked, 108 factions, 93 companions, 85 skins, 47 loot box holders |
| MultiBattle | nonce 2006, 2025-08-05 | 389 battle logs, open challenges |
| Alter | nonce 13626, 2025-09-13 | 91 offering totals, 80 streaks, 131 days of check-ins |
| 4 berry tokens | to 2026-02-22 | every player balance |
| TRUNK | nonce 574899, 2026-02-24 | 2,479 balances |

```bash
npm run recover:state    # revive all nine, write backend/native/snapshot/
npm run recover:build    # map the snapshot into Admin.Load rows
npm run recover:verify   # load all 168 on a public ~lua@5.3a node, free
```

**They are restored once, by the final build.** `legacy-players.json` is
committed, and the restore is opt-in: `npm run deploy:contracts:final`
(`--seed`), or `deploy.mjs --seed-legacy` on its own. Every other deployment is
blank — no legacy restore, no paid allow-list, no migration — because these 168
accounts are real, and re-loading them onto each throwaway test process is both
a lie about that process's numbers and one more half-finished migration for the
next one to chain from.

The two deployment defaults, together: **zero accounts, free sign-up.** A new
process holds nothing and anyone may join it. `--seed` is the flag that fills
it, and `--paid-access` is the flag that gates it — one for the launch build,
one for the day registration closes, and neither of them something you get by
forgetting.

`--migrate-from` skips accounts that exist but were never played. `Admin.Unlock`
calls `getPlayer`, so seeding a paid list mints an empty record for every
address on it, and an exported empty record is not inert: `Admin.Load` guards
`faction` and `monster` and merges `inventory`, but it RESETS `lootboxes` and
takes `wins`, `losses`, `questsCompleted` and `joinedAt` unconditionally. Carried
onto a restored legacynet player, an empty stub strips their loot boxes and
zeroes their quest count — for all 168, since the paid list had stubbed every
one. A row with nothing in it asserts only `unlocked`, which two other things
already assert, so it is not carried.

The one thing not to reverse: **the legacy restore runs BEFORE
`--migrate-from`.** Both write through `Admin.Load`, which writes by address, so
whichever runs last wins for a wallet in both lists. Legacy rows are a February
2026 checkpoint and can only be the older truth; a live deployment is always the
newer one. In this order a returning player is seeded and then immediately
overwritten by what they have actually done since, while a player who never came
back still gets their companion. In the other order every active player would be
quietly reset to their legacynet self on the next redeploy.

`snapshot/` is the archive and is committed; the 170 MB memory images it was
read from are cached under `.checkpoint-cache/` and are not. Re-running is
idempotent, and `build-legacy.mjs` reads `constants.lua` through a real Lua
interpreter rather than a regex, so a mapping can never be built against a stale
copy of the faction names or move numbers.

**What carries and what does not.** Faction, companion, level, exp, stats,
energy, happiness, the feed/play/quest counters, loot boxes and berry balances
all carry — the old and new progressions turn out to be the same shape, a base
stat total of 10 and ten points a level, so stats need no rescaling. Move
rosters are rebuilt from the names each player actually had, using the CURRENT
numbers, because the old ones were tuned against a type chart that never fired
(§5.1). **Wins and losses do not exist to carry**: the old game never persisted
them, MultiBattle only ever held per-fight records, and its last checkpoint is
six months before the game stopped. Everyone lands on 0/0.

Berries carry in full by default — the top holder has 6,282 of them, which is a
lot against an economy where feeding costs one. `--berry-cap N` caps them; the
archive keeps the true number either way.

`verify-legacy.mjs` is the receipt: it bundles what `deploy.mjs` deploys, pushes
all 168 rows through `Admin.Load` on a live `~lua@5.3a` node, and reads every
one back **as themselves** — faction, level, exp, stats, berries, loot boxes, a
legal move roster, integers still integers, a stranger still locked out, and a
restored player able to feed a restored companion with a restored berry. 9
assertions, 168 players, 0 failed. Free and unsigned; nothing is deployed.

## 3b. Rune is becoming a token of its own

Rune is earned in the game and lives in the player's record. It becomes
transferable on a SEPARATE token process, joined to the game by one rule:
**every Rune in circulation was deducted from an in-game balance first.** The
game holds the mint, so supply can never exceed what players actually earned,
and it starts at zero — nothing is pre-mined.

The 168 restored players each start with **25 Rune held in game**. The old
per-wallet stipend is gone; new rewards come only from the configured fixed
global epoch budget. This is an in-game balance, not minted supply.

`Rune.Withdraw` deducts and then asks the token to mint. The order is chosen for
which failure is survivable: if the mint never lands, the player is short until
`Admin.SettleWithdrawal` pays or refunds them, and the record says exactly who
and how much. Mint-first would let the same Rune be withdrawn twice while the
first mint is in flight — unbacked supply, which is the one thing this design
exists to prevent. A recoverable shortfall beats an unrecoverable overissue.

Every withdrawal carries an id to the token as the mint's `reference`, so a
re-delivered mint is recognisable rather than a second helping. And the mint
message deliberately carries **no `from` field**: who sent it is for the node to
attest, not for the message to claim — a self-declared sender is the same
forgery `signer()` exists to refuse.

**A process is not a signing wallet.** A process id looks like an address but is
the id of its spawn transaction; there is no key behind it, so a process cannot
produce a signature commitment and cannot sign a voucher from inside
`compute()`. `secret@1.0` does not change that — it is the NODE holding a wallet
and signing on request, gated by access control. So the token can only learn
that the game approved something from an attested `from-process` message, which
is why the bridge needs `process-outbox@1.0`.

**Deployment state.** `hyperbeam.tylerw.ai` now serves `token@1.0`,
`process-outbox@1.0`, `security@1.0`, `trie@1.0` and `secret@1.0`. Still missing
is `mint-authority@1.0`, the device `token@1.0` delegates minting to — until it
is published, or `mint-device` is pointed somewhere else, nothing can mint.

Everything carries a `TEST-` prefix while unreleased — see CLAUDE.md.

## 4. What changed, and why

### The economy is in-process

Every activity used to cost an AO token: a `Transfer` to the game process, a
`Credit-Notice` pushed back, and a handler that read `X-Action` off it. Berries,
gems, scrolls and TRUNK were all separate legacynet processes. They are gone and
TRUNK is owned by someone else besides.

Items now live in the player's record. Feeding a companion is **one signed
message** instead of a transfer plus a notice plus a reply. `Rune` replaces
TRUNK as the fuel for quests and arena sessions.

### Combat is turn-based

One signed message is one full round: the player's swing and the opponent's
answer resolve together and come back with the whole new battle.

This is not a style choice. A ticking fight that the client polls **cannot work
here**: a poll is an unsigned READ, a read schedules nothing, and a process that
is never scheduled never advances. The Dumverse port proved that the expensive
way — their countdown ran to zero and the enemy never swung.

The one place a poll is correct is a PvP round waiting on the other player,
because *their message* is what advances it. That read is free and unsigned.

### A redeploy carries players across

State IS the process: a redeploy mints a new one, and everything earned since
the last deploy would be gone. `Admin.Export` walks the player table out a page
at a time and `Admin.Load` reads it back, and `deploy.mjs` does both:

```bash
HB_WALLET=key.json node backend/native/deploy.mjs --migrate-from <old-pid>
```

Verified end to end: 178 players carried between two live processes with
faction, companion, level, experience, wins, satchel, loot boxes and move
rosters intact — and integers still integers rather than `1.0000000000`, which
is the thing to check first if a migration ever looks wrong.

Only the OWNER can export, so this needs the same keyfile that spawned the old
process. A process spawned before `Admin.Export` existed cannot be migrated
from; the deploy says so plainly and carries on with the paid list.

### Replies are read by slot

`/now/results/output/data` holds whatever the process computed **last**. Polling
it is fine alone at a keyboard and wrong the moment two people play at once —
you get their answer and parse it as your own. The POST returns the slot the
message landed in, and `compute&slot=<n>/results/output/data` addresses it
exactly. That is what `src/lib/hyperbeam.ts` does.

## 5. Bugs found in the original game logic

All of these were live in production. Every one has a test.

1. **Type effectiveness never applied.** There were two charts: `constants.lua`
   keyed `Fire`/`Water`/`Air`/`Rock`, `MultiBattle.lua` keyed lowercase. Move
   types and `elementType` were both lowercase, so every lookup in the
   authoritative chart fell through to `or 1`. The whole elemental system — the
   thing the four factions exist for — did nothing.

2. **Attacks could not miss.**
   `local hits = move.damage > 0 and doesAttackHit(a, d) or true`
   parses as `(damage>0 and hit) or true`. When the roll said miss, `false or
   true` is `true`. Speed did nothing to accuracy.

3. **Bots could never use a move.** `getRandom(#availableMoves)` passed one
   argument to a two-argument wrapper, so the call raised whenever the bot had
   any move left. Bots only ever struggled.

4. **The turn log was blank.** It read `action.name` and `action.moveName`,
   neither of which `processAttack` returned, so every rendered entry had a nil
   monster name and a nil move name.

5. **A fight permanently drained the pet.** The live monster record was passed
   into battle by reference, so move counts never came back.

6. **A companion could roll a moveset with no damaging move at all** — Campfire,
   Power Up, Heal, Momentum Shift are all zero damage. Two such companions
   cannot hurt each other until every move is spent and both struggle for a
   point a swing.

7. **`CheckSkin` / `CheckFaction` crashed** on any address without a record:
   `UserSkins[address].txId` with no nil guard.

8. **Loot was guaranteed at high tiers.** `chance * 1.5^(rarity-1)` with no
   ceiling: a tier-5 box rolled 4050/1000 on four separate berries.

9. **Seven auth asserts were commented out**, and `Combat.PlayerWon` was
   callable by anyone — infinite rewards on a public node. None of that is
   carried over; every `Admin.*` handler checks the signer against the process
   owner.

### A second round, found by review

The list above came from reading the original. These came from reviewing the
*rewrite*, and most were reproduced live before being fixed. They are worth
knowing about because several are the kind of bug that looks like a working
game right up until two people play it at once.

10. **PvP leaked the opponent's committed move.** `Battle.view` was
    `clone(battle)` with nothing removed, so `pendingMoves` went out in the
    reply, in `/now/battle` and in the player record. Whoever moved second could
    read the first player's choice and counter it — and could re-commit their
    own move freely, because the slot was overwritten unconditionally.
    Simultaneous turns did not exist. `Battle.view` now strips it and publishes
    only *who* has moved, and a second commitment in the same round is refused.

11. **A fight could run forever.** Shield regeneration outpaced the damage floor:
    two defensive companions reached 220/220 shield with attack 0 and were still
    fighting at full health after **two thousand rounds**. The only escape was
    forfeiting the paid session. There is now a 50-round cap decided on
    remaining health, and regen is clamped below what a bare struggle removes,
    so the stalemate is unreachable rather than merely rare.

12. **`Admin.Lock` did nothing.** Only `Faction.Join` and `Monster.Adopt` ever
    read `unlocked`, so a revoked wallet carried on questing, fighting and
    opening loot boxes. Every player action now goes through `requireAccess`.

13. **Forfeiting beat losing.** `Battle.Leave` marked the battle ended and named
    a winner but never paid them: no win, no experience, no loot box, and the
    opponent was left pointing at a battle that no longer existed. Settlement is
    now shared between a knockout and a forfeit, and is idempotent.

14. **Withdrawing a challenge cost the session.** Posting a challenge nobody
    took, then withdrawing, zeroed `battlesRemaining` — you paid a Rune for
    nothing. And a challenge to *yourself* was allowed, which left no legal move
    at all except that. Self-challenge is refused, and withdrawing an unaccepted
    challenge is now free.

15. **The signer could be forged.** `signer()` fell back to an `Address` tag
    when no commitment carried a committer — and every HyperBEAM message carries
    an unsigned hmac commitment alongside its signature. A crafted message with
    the hmac alone plus `Address=<owner>` was treated as owner-signed. It now
    prefers a real signature commitment, and once *any* commitment is present it
    never falls back to a tag. The tag path survives only for a message with no
    commitments at all, which a scheduler will not accept.

16. **`User.Info` read anyone.** It preferred an `Address` tag over the signer,
    so a stranger could read any player's inventory, access flag and battle
    state. Signer only now.

17. **An admin action published the wrong player.** The per-player publish
    preferred the signer, which broke the moment the owner had a record of their
    own — every `Admin.Grant` then silently published the owner instead of the
    target.

18. **The economy was a money printer.** A tier-1 box — what every arena win
    awarded — was worth about 1.09 Runes, against a session costing one Rune for
    four battles. Winning half your fights roughly doubled your Runes, and two
    players trading PvP wins (which paid tier-3 boxes) could farm indefinitely.
    Rune was removed from loot boxes entirely, both win types pay tier 1, and
    issuance now comes only from a fixed global epoch budget with per-account
    maturity/activity caps. Wallet count cannot enlarge it.

19. **The published battle grew without bound** — about a kilobyte a round,
    carried on every message. The turn log is now trimmed to a window.

### And the same again on the client

20. **A reload mid-fight lost the fight.** The battle only ever arrived on
    replies from `Battle.*` handlers, never on `User.Login` — so a refresh
    dropped it, the router fell through to the lobby, "Begin" then answered
    *"You are already in a battle"*, and the only exit forfeited the paid
    session. The battle now rides on every player reply. Verified by reloading
    the page mid-fight and resuming at round 11.

21. **A posted PvP challenge span forever.** `AwaitingChallenger` had no poll and
    no timer at all, so the challenger never learned that somebody had accepted.
    PvP was not completable from the challenger's side.

22. **The level-up and loot dialogs rendered clipped inside their own card.**
    `.panel` sets `backdrop-filter`, which establishes a containing block for
    `position: fixed` descendants — so a `fixed inset-0` overlay written inside
    a panel resolves to the panel, not the viewport, and the companion card is
    `overflow-hidden` besides. The level-up dialog lost its own Confirm button.
    There is a `Dialog` primitive now: portalled to `<body>`, focus-trapped,
    Escape to close, labelled, scroll-locked, and refusing to close over a
    write in flight.

23. **Two numbers on screen were simply wrong.** HP was drawn as `health * 10`
    against an engine using 12, and a move's damage as `damage * 5` against an
    engine that multiplies by the attack stat — so the number never moved when a
    player spent points into Attack, making the stat look inert. Both now come
    from `tuning`, which the process publishes.

24. **One component throwing took the whole page to black.** An unknown wallet's
    login reply was a three-field object rather than a player, the header read
    `inventory.rune` off it, and the first thing anyone would have seen was an
    empty screen. The process now answers with a player-shaped record either
    way, and there is an error boundary behind that.

### And the balance had to be redone

Fixing (1) changed the game. The damage numbers had been tuned by feel against a
multiplier that was silently always 1.0. Switch it on and a super-effective hit
one-shots a low-level companion: measured at **13–23% of low-level fights ending
on the first swing**, and 12% of level-20 fights grinding past thirty rounds.

`backend/native/balance.lua` measures fight length across levels, and
`Battle.TUNING` holds the numbers it tunes. Current state, n=50 per level:

| level | median rounds | 1-round KOs | >30 rounds |
|---|---|---|---|
| 0 | 5 | 0% | 2% |
| 1 | 8 | 0% | 2% |
| 3 | 5 | 0% | 0% |
| 5 | 11 | 0% | 4% |
| 10 | 9 | 0% | 6% |
| 20 | 10 | 0% | 4% |

```bash
./backend/native/run-balance.sh          # report on the current tuning
./backend/native/run-balance.sh sweep    # grid search (may exceed a node's
                                         # gateway timeout; narrow the grid)
```

**Re-run it after touching any number in `Battle.TUNING`.**

## 6. The look, and why it is built the way it is

The visual direction has a thesis, and it is worth knowing before changing
anything: **every action here is a signature written where it cannot be taken
back**, so the interface is carved stone and bone — and **the magic is the only
colour**.

That is a rule, not a mood. The chrome (`--rune`, a pale bone-gold) is used for
hairlines and the wordmark and *never* for state. All chroma on screen belongs
to one of the four elements, which means colour always means something: a fire
companion's screen is orange because it is a fire companion, not because orange
was picked as a brand colour. Anything belonging to a faction, a companion, a
move or a fight sets `data-element` once and everything inside it agrees.

Three pieces carry it:

- **`src/gfx/aether.ts`** — the background. One fullscreen WebGL2 shader (a
  domain-warped flow field with rune-like filaments) plus 2,000 motes whose
  positions are a closed-form function of seed and time, computed in the vertex
  shader, so nothing is simulated on the CPU and no buffer is ever re-uploaded.
  It crossfades to the player's element and ripples when a blow lands. Raw
  WebGL rather than three.js: this is two programs and one draw call each, and a
  library for that would cost more than the rest of the app. Measured at a
  steady 60fps; it stops entirely when the tab is hidden, and degrades to a
  plain dark background with no WebGL2, under reduced motion, or on a lost
  context. `window.__aether` is a dev-only handle for driving it by hand.

- **`src/gfx/sigil.ts`** — the signature element. A rune drawn deterministically
  from a wallet address: a stave, branches struck off it at angles from a fixed
  vocabulary, and a few bind marks. On this chain your address IS your identity,
  so the interface makes it a mark instead of showing 43 characters of base64.

- **`.panel`** — a tablet, not a card. One notched corner, always top-right, and
  a hairline inlay drawn as a clipped overlay because a `clip-path` cannot take
  a border. That notch is the one liberty the layout takes; everything else is
  deliberately quiet so the elemental colour and the pixel art carry the screen.

Type is Bricolage Grotesque for display, Instrument Sans for body, JetBrains
Mono for every address and number — which is most of this interface.

**Watch out for one thing:** `.panel` sets `backdrop-filter`, and a non-`none`
backdrop-filter establishes a containing block for `position: fixed`
descendants. Any overlay written inside a panel resolves `inset-0` to the panel
rather than the viewport. That is why `src/ui/Dialog.tsx` portals to `<body>`,
and why every modal must go through it.

## 7. Luerl gotchas — read before writing Lua

`~lua@5.3a` is Luerl (Lua in Erlang). No C modules, so no `lsqlite3`. Also:

| | |
|---|---|
| `goto` | Not supported at all — compiler error |
| `string.format("%g")` | Broken: `%.14g` of `100` gives `100.00000000000`. hyper-aos's `json.encode` uses it, so **encode via `jsonenc.lua`** |
| `tonumber("30")` | Returns a **float**. Every tag is a string, so wrap: `math.tointeger(tonumber(x))` |
| `json.decode` | Every number comes back a float |
| `gmatch("[^,%s]+")` | Raises `bad argument` — `game.lua` has a `splitList` that avoids it |
| Missing | `coroutine`, `table.move`, `string.pack`, `crypto` |

Integers themselves are fine (`math.type`, int64, `//`, `%`, `%d`).

## 8. Two traps that cost real time here

**`Target` is not a usable tag name.** An ANS-104 data item carries a lowercase
`target` field holding the process id. Tag names become HTTP headers, which are
lowercased, so a tag called `Target` is ambiguous by the time a handler reads
it — `msg.Target` silently resolved to *this process*. It made every per-player
read path 404 while `factions` and `leaderboard` looked perfectly fine. Admin
handlers take `PlayerId` and challenges take `Opponent` for exactly this reason.
`game.lua` has an `ENVELOPE` set that excludes those fields from the
case-insensitive tag lookup. **`data` and `body` are deliberately NOT in it** —
the message body arrives lowercase, and excluding it made `Admin.Unlock` accept
its message and unlock nobody.

**hyper-aos presets `Owner = Owner or ""`.** `""` is truthy in Lua, so
`if Owner then return Owner end` never resolved anything and every admin action
was refused. `game.lua` defines its own `compute()`, which replaces the one that
would have set `Owner` properly, so it resolves the owner from the process
definition's own commitment itself.

## 9. What works

Login and access gating, factions and joining, adoption, feeding (own-element
berries are worth double), play, quests, claiming, levelling with stat
allocation, loot boxes, the satchel, arena sessions, bot battles, PvP challenge
and accept, the leaderboard, and the owner tools.

Plus the integrated Gold goods market, finite NPC desks, exact supply ledgers,
Eternal Pass identity/recovery, and a globally bounded Rune reward policy. The
open reward parameters remain visibly paused until approved.

Verified four ways:

- `npm run test:lua` — **168 assertions**, whole process, on a public node, free.
  Including the ones that matter most: that a forged signer is refused, that a
  revoked wallet is actually stopped, that a committed PvP move stays secret,
  that a fight always terminates, and that recomputing a slot reproduces it.
- `node backend/native/e2e.mjs <burner>` — **61 assertions** through the app's
  own client code against the live process, with real ANS-104 signatures.
- `node backend/native/e2e.mjs --pvp <a> <b>` — **10 assertions**, two players.
- By hand in Chrome, with a burner wallet injected via `tools/burner-wallet.js`:
  connect → join → adopt → feed → claim the daily → enter the arena → fight a
  bot battle to victory.

An adversarial pass against the live process — identity spoofing through every
`From`/`Address`/`UserId`/`PlayerId` tag, timestamp forgery against the activity
timers, admin gating, move overuse, attacking a battle you are not in — found no
working exploit.

## 9b. Minting: companions as Arweave assets

Companions can be pulled out of the game as one-unit assets and put back. The
standard is Bazar's, and there is **no specification document for it** — the
`token@1.0`, `carrier@1.0`, `arweave-scheduler@1.0` and `arweave-swap@1.0`
devices do not appear in HyperBEAM's published device docs at all, which are
older than these devices. The only authority is `permaweb/bazar`'s client source
(`src/api/asset-mint.ts`, `asset-uploader.ts`, `asset-transactions.ts`).

Everything below was read from that source and then **checked against a live
asset**, `mJ3BtBG9jHLEBpym5ufKeoPS4cMnsw-av9NbXYhnmuM` (a Dumdumz piece).

### What an asset actually is `[V]`

**An Arweave L1 transaction.** Not a bundled data item, not a scheduler POST.
Its DATA is the image and its TAGS declare a process:

```
device: process@1.0            execution-device: token@1.0
swap-device: arweave-swap@1.0  scheduler-device: arweave-scheduler@1.0
scheduler-mode: all            total-supply: 1    denomination: 0
ticker: ASSET                  initial-holder: <wallet>   creator: <minter>
implements: ANS-110            hint-ui-style: non-fungible
content-type: image/png        title / name / description / base-collection
```

- The asset id, the process id and the image id are **the same 43 characters**.
  `bundledIn` on the live asset is null — it went straight to the chain.
- **Nothing mints the supply.** `initial-holder` + `total-supply: 1` *is* the
  mint. The live asset is still at slot 0 and its balances already read
  `{ <holder>: 1 }`. No message is ever sent to it.
- Tag names are lowercased and must not repeat — same class of silent poison as
  the duplicate `action` tag in §19 of HYPERBEAM.md.
- **There is no burn.** The whole write API is `transfer`, `make-offer`,
  `cancel-order`, `register-interest`. Returning a companion is a transfer to a
  vault address.
- A transfer is another L1 transaction: target the asset's own process, move
  **zero AR**, and carry `action=transfer, recipient, quantity` as tags. The zero
  matters — it is what makes the swap device read the quantity TAG as a token
  amount instead of treating the transaction as a payment.

### Read state on the right node `[V]`

`schedule.forward.computer` — where the game process lives — answers **500 for
every one of these assets**, which reads like a broken asset rather than the
wrong node. `hb.arweave.net` serves them:

```
GET https://hb.arweave.net/<id>~process@1.0/now/balances   -> {"<holder>":1}
GET https://hb.arweave.net/<id>~process@1.0/now/total-supply -> 1
```

Free, unsigned, and the **only** ownership truth. GraphQL finds candidates; it
cannot tell you the process applied a transfer.

### Collections

Two published things, not a list a marketplace keeps for you: an immutable JSON
manifest (`{version:2, name, description, kind:"arweave-native-token-assets",
assetCount, assets:[ids]}`) and a `carrier@1.0` process holding one pointer at
it. Adding assets means publishing a NEW manifest and sending the carrier a
signed `action=set`. Dumdumz's manifest is 1,984 ids in 91 KB, so an append is
about a cent — cheap per append, quadratic over a collection's life, which is
why `mint-worker.mjs` appends in batches rather than per mint.

### Why the wallet is in a worker and not in the page

**A process cannot pay for a transaction.** A process id is a transaction id;
nobody holds its private key, so AR sent to one is unspendable forever. The
alternative — every player funding their own wallet with AR — makes the feature
unusable for the audience it is for.

So the process owns the game facts and a funded worker owns the chain facts, and
they meet at a published queue. `Monster.Mint` charges runes, freezes the
companion and enqueues a **snapshot**; the worker composites the card, signs one
transaction, and reports through the owner-only `Admin.Minted`. The worker holds
no authority the process owner does not already have — it *is* the owner.

Measured cost: a 109 KB card is **0.0029 AR**, about 1.8 cents. A transfer is
0.0000356 AR. Ten runes covers it with a wide margin.

### Traps found while building this

- **`Address` is not a safe tag name.** `signer()` falls back to `msg.Address`
  for a message with no commitments, so an `Address` TAG replaces the sender's
  identity on the test path: `Admin.SetVault` authenticated as the vault it was
  trying to set and refused itself. The tag is `Vault`. Every other admin
  handler already names its subject `PlayerId`.
- **The card art's own lettering is wrong for this game.** The nameplate PNGs
  bake ZEPHOUND / AQUANINE / IGNISFANG / TERRABARK; the process names its
  monsters Airbud, WaterDoge, FireFox and Rockpup. Eight of the twenty-four move
  plates are labelled for moves that do not exist here. So the plates are used
  for their ICONS only and every word on a card is drawn from a 5x7 bitmap font
  in `src/lib/card/font.mjs`.
- **Only `doge` is a released monster.** `src/ui/art.ts` picks a portrait by
  level from three families, and two of them — Super and Dragon — have not
  shipped. Harmless on a screen; permanent and public on a card. The card
  ignores tiers entirely.
- **Empty Lua tables.** `assets` is keyed by asset id, so it is marked with
  `jsonObject`; without that it encodes as `[]` when empty and flips to `{}` on
  the first mint.
- **The mint queue carries a snapshot, not a reference.** `Monster.Feed` and
  `Monster.LevelUp` are blocked while minting for that reason: a stat that moves
  after the snapshot is a card that permanently disagrees with its creature.

### Proven on chain `[V]`

Both halves have now run for real.

| | |
|---|---|
| Collection | `FLpgYCuzLQt-wevwCvuTh9oJ89r_geDO3JWjNaXdQKc` |
| First asset | `BbKbzXwM_Im7V3TIzj2QSEjaWe9YUwS71JCsH9-Cllg` (TEST-Rockpup, lvl 10) |

The asset resolves as a `token@1.0` process — `balances {<minter>: 1}`,
`ticker ASSET`, `total-supply 1`, `base-collection TEST-Rune Realm Companions` —
and the gateway serves the card at the same id. The game process ran a real
worker pass and claimed the vault.

### The traps that cost the most here

**A targeted transaction needs `quantity: '1'`.** `[V]` This is the one that
cost hours. A transaction with a `target`, no data and `quantity: '0'` is a
no-op, and every Arweave node rejects it with a bare
`400 Transaction verification failed` naming nothing. Bazar's uploader:

```js
request.target ? { data, target: request.target, quantity: '1' } : { data }
```

One winston is what makes it a real transfer. Ruled out first, each tested
against two nodes: the reward (dust, 1.2x, 1.5x, 2x and the full quote), the
presence of data, and all three anchor forms (block hash, the wallet's own
`last_tx`, empty). The signed transaction was field-for-field identical to a
working Bazar transfer apart from reward and target.

**The wallet-generation fee is real, and it is per ADDRESS, once ever.** `[V]`
`/price/0` is 0.000036 AR; `/price/0/<never-funded address>` is **0.2216 AR**.
It is protocol, not a gateway policy — four independent nodes reject a
dust-fee transaction to a fresh address, 99% of the quote is still rejected, and
plain untagged sends are rejected at any quantity. Arweave documents it ("An
extra fee is taken for the first transaction sent to a new wallet address") and
defines it in `ar_pricing.hrl` as `WALLET_GEN_FEE_USD {1, 10}` — **ten cents**,
converted through Arweave's own lagging AR price estimate, so today it bills as
if AR were $0.45 rather than the market $2.20.

Independent confirmation, off the chain rather than from a probe: of seven
recent L1 transfers, six paid dust to recipients that already existed — one
sending 909 AR, another 2002 AR — and the single one that paid **0.221437** was
someone sending 392 AR to a wallet that did not exist yet. Funding wallets
"cheaply" is the normal case precisely because the recipient usually exists.

The practical shape: a MINT has no target and pays no premium (0.00294 AR,
under a cent). A token TRANSFER targets the asset's own process address, which
is new for every freshly minted asset, so the first transfer of each asset pays
0.2216 AR and every later one is dust. That is why the first collection update
cost 0.2304 AR and the Dumdumz collection quotes dust today.

**Resolved: seeded assets.** The rule is simply whether the target address has
ever received AR — `/wallet/<addr>/balance` of zero quotes the premium, anything
above zero quotes dust. Bazar's assets carry one winston, put there on purpose.
The full history of the Dumdumz asset `6eUuk…` is two transactions:

```
block 1984705   fee 0.228287 AR   quantity 1   (no action tag)   <- the seed
block 1984750   fee 0.000037 AR   quantity 0   action=transfer   <- a listing
```

That is why a collector moves NFTs freely and never sees a fee: it was paid by
whoever issued the asset. The transfers that looked like counter-evidence were
all aimed at seeded addresses; the ones that failed were aimed at addresses
holding nothing, which is a position only an issuer is ever in.

`seedAsset` in the worker now sends each new asset one winston at mint time, so
the minter pays it and no player can be ambushed by it. One asset costs the
minter ~0.23 AR all in: under a cent for the card, the rest for the seed.

**Bazar's asset route takes two segments.** `#/asset/<collection>/<asset>`. A
one-segment link silently redirects to the front page, which reads as an invalid
asset rather than a bad link. `created-assets` is Bazar's pass-through segment
for anything not in a listed collection, and it resolves any asset by id.

**A CLI guard built from `argv[1]` never fires on Windows.**
`import.meta.url` is `file:///C:/...` and `` `file://${argv[1]}` `` loses a
slash, so `collection.mjs create` exited 0 having done nothing and looked like
it had succeeded. `pathToFileURL` is the comparison that holds.

### The registry

`Assets` in the process is the global record: asset id -> minter, holder, state,
and what the creature was at mint time. Published whole at `/now/assets` with a
count at `/now/assetcount`. The player record still carries the snapshot a
deposit restores from; the registry carries what a listing needs to draw a row
without reading 168 player records. Entries are never deleted — an asset is
permanent, and a registry that forgot one would be lying about what this game
has published.

## 10. Not done

- **The open world** (`Reality` submodule) and the **sprite customiser** are
  parked, as asked. The customiser's source is in `src/_hidden/` with a note on
  bringing it back; the open world is the untouched submodule. Both need their
  own port — they talk to legacynet processes.
- **Selling access.** The Eternal Pass was sold for legacynet tokens. There is
  no purchase flow any more; access comes from the paid list. A wallet not on it
  gets a screen that says so and offers its address to copy, rather than
  dead-ending on a checkout that cannot complete.
- **The owner's own paid list** — see §3. No longer blocking: the old process's
  own `Unlocked` list has been read directly out of its checkpoint, so the
  owner's list is now a cross-check rather than the only source.
- **The recovered players are built but not yet on the live process.**
  `legacy-players.json` holds all 168 and is verified end to end (§3), and every
  deploy from here on seeds it by default — but the process running right now
  predates that, so it still has only their access, not their companions. It
  takes a redeploy.
- **Our own marketplace.** Bazar renders these assets and its client is the only
  specification for them, but it is somebody else's product: it curates which
  collections it discovers, its asset route needs a collection segment, and
  nothing there knows a companion's stats. The registry (`/now/assets`) is the
  groundwork for the alternative — a listing of our own assets only, sorted and
  filtered on element, level and stats, mimicking the same contract
  interactions Bazar uses (`transfer`, `make-offer`, `cancel-order`,
  `register-interest`). Not started; the registry and the card renderer are the
  two pieces it would need and both exist.
- **Skins are recovered but have nowhere to go.** 85 of them, in
  `backend/native/legacy-skins.json`, waiting on the sprite customiser.
- **The Alter's offerings and streaks are archived, unused.** 91 players'
  offering totals and 80 streaks are in `snapshot/alter.json`; the new game has
  no shrine to spend them at.
- **The mobile bottom bar is visually unverified.** The classes are there and
  the desktop layout is confirmed, but the display this was built on could not
  be narrowed below 931 CSS px, so nobody has actually looked at it on a phone.
- **PvP matchmaking is first-come.** A challenge is open to anyone in the arena.
  There is no rating, so a level 20 can take a level 1's challenge.
- **PvP has no level bracket** and no rematch. The move deadline exists (three
  minutes, then the waiting player can play the round without the absent one),
  but a fight abandoned before anyone has moved still needs a manual forfeit.
- **The global Rune reward numbers remain open.** The per-wallet 1/2/3 stipend
  is disabled. The admin page exposes the fixed epoch budget, maturity,
  qualification, optional bond, per-account net cap, and Reward Reserve; none
  activates until the launch values are approved.
- **A fight in progress does not survive a redeploy.** Players do — see §4 —
  but `Battles` are process globals with no export, and restoring somebody into
  a battle that no longer exists would strand them, so anyone mid-fight comes
  back standing at home with their session spent.
- **Payout trust.** Combat resolves inside the game process, so a crafted client
  cannot claim a win it did not earn — but the process is public and anyone can
  message it. The auth that matters (access, admin) is signature-checked.

## 11. One thing to deal with that is not this repo's code

**Three complete RSA private keys are committed in the submodules**, tracked by
their own repositories:

| | |
|---|---|
| `Reality/fixtures/deploy_jwk.json` | `liMSXyfXrTxtByireZRx9cJ_UfzB41154-ICfbb0mPY` |
| `Reality/fixtures/test_jwk.json` | `HHz5nNVEzkALjmZq8cdIdubMBJCpIFOvzO5uHfU5nQI` |
| `RuneRealm-LUA/fred.json` | `Ofotw4BoN9Fp-wiPBaxESGO7IUlhzHSMYukP03zuITw` |

All three carry the full private exponent, not just a public key, and all three
are in `ArcAOGaming` repositories rather than this one — so nothing here can fix
them. All three currently hold **0 AR**, which is why this is a note rather than
an alarm, but a key that is public is public forever: anyone who has ever cloned
those repos can sign as those wallets. If any of them owns an AO process, holds
a token balance, or controls an ANT name, it needs rotating and the history
needs purging.

This repository is clean: `.gitignore` covers `*wallet*.json`, `*.jwk`,
`.burners/` and `.e2e/`, and that was verified rather than assumed.

`backend/native/paid.json` IS committed and does contain 168 wallet addresses.
That is deliberate — a deploy has to be reproducible — and those addresses were
already public in the old process's state and in its Arweave checkpoints. They
are public keys, not private ones.

## 12. Measured performance

Measured, not estimated — an earlier version of this table said 600–800 ms for
a round trip and that was wrong by a factor of five.

| concurrent players | write p50/p90 | reply read p50/p90 | round trip p50/p90 |
|---|---|---|---|
| 1 | 179 / 316 ms | 3366 / 3610 ms | 3457 / 3816 ms |
| 2 | 318 / 521 ms | 3111 / 4259 ms | 3610 / 4636 ms |
| 4 | 506 / 930 ms | 4148 / 5406 ms | 4787 / 6020 ms |
| 12 | 6417 / 10184 ms | 28051 / 46676 ms | 29% of writes failed |

A published read (`/now/<key>`) is **87 ms p50 when the node is idle** and
**18–46 SECONDS** under twelve concurrent writers: `/now/` has to compute to the
scheduler head, so it inherits the whole write backlog. The cliff is between 4
and 12 concurrent players. That is why every poll in the client has an in-flight
guard, and why the reply-read budget is thirty seconds.

**Reply correlation was verified, not assumed**: 213 correlated round trips at up
to 12 messages in flight, zero wrong-player replies. The naive alternative —
polling `/now/results/output/data` — returned another player's reply in **36 of
48 samples at only four concurrent players**.

## 13. Testing

```bash
npm run test:lua                                  # process suite, free
./backend/native/run-balance.sh                   # fight-length profile, free
node backend/native/burners.mjs make 4            # throwaway wallets + access
node backend/native/e2e.mjs burner-01             # one player, whole journey
node backend/native/e2e.mjs --pvp burner-01 burner-02
npm run recover:verify                            # the 168 recovered players,
                                                  # loaded and read back, free
npm run probe:heap                                # Luerl tables left per
                                                  # message, free
```

`probe:heap` is the snapshot-size check. HyperBEAM checkpoints this process by
`term_to_binary`-ing Luerl's whole table store, Luerl runs no collector of its
own, and `collectgarbage("step")` is a no-op on that runtime — so a process that
does not explicitly collect ships every transient table it has ever built to
disk on every checkpoint. That is what a 282 MB snapshot of 320 KB of state was.
`compute` now ends with a bare `collectgarbage("collect")`; the probe prints
tables-allocated against tables-kept per message so the two can be told apart.

The collect has to stay a bare statement at the end of `compute`. Inside a
`pcall` frame, or inside an `ipairs` loop, it kills the Luerl VM outright —
`HYPERBEAM.md` §4 has the reproduction. That is also why the Luerl suites are
driven without `pcall` and index their message loops numerically.

**Never point a test at a real player's wallet.** Burners live in `.burners/`,
which is gitignored, and hold nothing.

For the browser, paste `tools/burner-wallet.js` into the console and call
`installBurner(<jwk>)`. It builds and signs real ANS-104 data items with
WebCrypto, so it exercises the real write path rather than a mock of it. Its
Node twin is `backend/native/ans104.mjs`; the two must agree.

**Do not trust the HyperBEAM docs site** — it documents devices that have been
deleted. Reproduce against a live node instead.
