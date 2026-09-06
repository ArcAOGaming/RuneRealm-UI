--- constants.lua — RuneRealm game data: factions, monsters, moves, items, loot.
---
--- Rewritten from RuneRealm-LUA/Lua/frontend/constants.lua. Same game, but the
--- data is corrected and the economy no longer points at legacynet.
---
--- What changed and why:
---
---   * The effectiveness chart is lowercase. The original had TWO charts with
---     different key cases — `EffectivenessChart.Fire` in constants.lua and
---     `EffectivenessChart.fire` in MultiBattle.lua — while move types and
---     `elementType` were both lowercase. Every lookup fell through to the
---     `or 1` fallback, so type effectiveness never once applied in the live
---     game. One chart now, lowercase, matching the data.
---
---   * "rock" is the element everywhere. The original also used "earth" in one
---     table and "Earth" in asset filenames; only "rock" was ever stored on a
---     monster.
---
---   * Costs are item ids, not token process ids. Berries, scrolls and
---     TRUNK were all legacynet processes and are gone. Items now live in the
---     player's record inside this process, so an activity is one signed
---     message instead of a token transfer plus a Credit-Notice round trip.
---
--- Bundled as:  local C = (function() ... end)()

local C = {}

--- Deployment policy. `deploy.mjs --public-access` overrides this in the
--- assembled Lua bundle; keeping the source default closed makes tests and an
--- ordinary release fail safe.
C.PUBLIC_ACCESS = false

-- Elements ------------------------------------------------------------------

C.ELEMENTS = { "fire", "water", "air", "rock" }

--- attacker element -> defender element -> damage multiplier.
--- Lowercase throughout; see the note above.
C.EFFECTIVENESS = {
  fire  = { fire = 1.0, water = 0.5, air = 2.0, rock = 1.0 },
  water = { fire = 2.0, water = 1.0, air = 1.0, rock = 0.5 },
  air   = { fire = 0.5, water = 2.0, air = 1.0, rock = 1.0 },
  rock  = { fire = 1.0, water = 1.0, air = 0.5, rock = 2.0 },
}

-- Items ---------------------------------------------------------------------
-- Held in the player's record. `section` drives how the inventory groups them.

C.ITEMS = {
  air_berry        = { id = "air_berry",        name = "Air Berry",        section = "berry", element = "air"   },
  water_berry      = { id = "water_berry",      name = "Water Berry",      section = "berry", element = "water" },
  fire_berry       = { id = "fire_berry",       name = "Fire Berry",       section = "berry", element = "fire"  },
  rock_berry       = { id = "rock_berry",       name = "Rock Berry",       section = "berry", element = "rock"  },
  rune             = { id = "rune",             name = "Rune",             section = "fuel"  },
  scroll           = { id = "scroll",           name = "Scroll",           section = "utility" },
  legendary_scroll = { id = "legendary_scroll", name = "Legendary Scroll", section = "utility" },
}

--- Gem and charm keys may still exist in an old player snapshot. They are left
--- untouched so a future reintroduction can migrate them, but they are absent
--- from the active catalog, admin controls, card satchel, and loot table.
---
--- Three berries may be eaten when an arena session begins. The deliberately
--- strong first-pass bonus is folded into battle copies for all four fights.
--- TODO(balance): try +3 or a shorter duration after real session data exists.
C.BATTLE_BERRIES = {
  fire_berry  = { item = "fire_berry",  stat = "attack",  amount = 5, cost = 3 },
  rock_berry  = { item = "rock_berry",  stat = "defense", amount = 5, cost = 3 },
  air_berry   = { item = "air_berry",   stat = "speed",   amount = 5, cost = 3 },
  water_berry = { item = "water_berry", stat = "health",  amount = 5, cost = 3 },
}

-- Factions ------------------------------------------------------------------
--
-- A faction decides two things and no more: which companion you start with, and
-- who you are grouped with. There are no passives and no buffs, and there never
-- were — the four `perks` strings that used to live here ("Increased speed
-- stats", "Boost to air-type attack power") were read by nothing in the engine.
-- They were published to the client and printed on the join screen, which made
-- them a promise the game does not keep. Nothing else changed when they went.

C.FACTIONS = {
  {
    name = "Sky Nomads",
    element = "air",
    description = "Masters of the skies, the Sky Nomads harness wind and air to outmaneuver and outlast their opponents.",
    mascot = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
    monster = {
      entryNo = 7,
      name = "Airbud",
      image = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
      sprite = "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0",
    },
    berry = "air_berry",
  },
  {
    name = "Aqua Guardians",
    element = "water",
    description = "Mystical protectors of the deep, the Aqua Guardians command the essence of water to heal and empower their allies.",
    mascot = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
    monster = {
      entryNo = 4,
      name = "WaterDoge",
      image = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
      sprite = "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc",
    },
    berry = "water_berry",
  },
  {
    name = "Inferno Blades",
    element = "fire",
    description = "Fearsome warriors of flame, the Inferno Blades unleash devastating fire-based attacks to overwhelm their foes.",
    mascot = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
    monster = {
      entryNo = 1,
      name = "FireFox",
      image = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
      sprite = "wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ",
    },
    berry = "fire_berry",
  },
  {
    name = "Stone Titans",
    element = "rock",
    description = "Immovable defenders, the Stone Titans use their unyielding strength to outlast and overpower their adversaries.",
    mascot = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
    monster = {
      entryNo = 10,
      name = "Rockpup",
      image = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
      sprite = "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks",
    },
    berry = "rock_berry",
  },
}

--- faction name -> the faction record above.
C.FACTION_BY_NAME = {}
for _, f in ipairs(C.FACTIONS) do C.FACTION_BY_NAME[f.name] = f end

-- Moves ---------------------------------------------------------------------
--
-- `damage` is in units of 5 HP before stats and effectiveness. `count` is uses,
-- and it is now the WHOLE number of them -- `Battle.TUNING.moveUses` was a x3
-- multiplier on top and is 1. The stat fields are riders applied to whoever
-- used the move, as a SHARE of that fighter's own stat rather than as flat
-- points; see `TUNING.riderPerPoint`.
--
-- FIVE POOLS, NOT SEVEN. The four elements, and one merged `neutral` pool
-- holding what used to be `normal`, `boost` and `heal` as three separate ones.
--
-- The split was the problem it looked like a solution to. The old roll drew one
-- move from each support pool by name, so the pool WAS the slot: every
-- companion in the game had exactly one boost and exactly one heal, and the
-- only thing a roll could say about a creature was which of six it got in each
-- fixed category. Merging them means the two drawn slots are drawn from one
-- eighteen-move pool with no quota, so a roster can come out three attacks, or
-- an attack and two heals, and those are genuinely different companions.
--
-- Each move keeps its own `type`, which is what the effectiveness chart and the
-- move-grid icons read. Only the GROUPING changed.
--
-- WHAT THE TIERS MEAN. `rarity` 1 is the rare tier, 2 uncommon, 3 common, and
-- `C.MOVE_RARITY_WEIGHT` is what makes that true of the draw. It was decoration
-- before: the pick inside a pool was uniform, so a rarity-1 move was exactly as
-- likely as a rarity-3 one and the tier printed on the card meant nothing.
--
-- Worse, it did not track POWER either. Measured with `./run-balance.sh
-- rank<pool>5` -- which plays a roster carrying one move against an identical
-- roster carrying a plain 4-damage attack instead -- the old catalog ranked:
--
--   water   Ice Spear r2 75%  |  Deep Current r3 66%  |  Tidal Wave r1 61%
--   heal    Healing Winds r3 63%  |  Recovery r3 49%  |  ... |  Heal r1 24%
--   normal  Quick Jab r2 72%  |  Momentum Shift r3 60%  |  Body Slam r1 60%
--
-- so in three of the seven pools the rarest move was not even in the top two,
-- and the whole catalog spanned 12% to 75% -- a drawn move decided more of a
-- fight than the build did.
--
-- EVERY ELEMENT POOL IS THE SAME SIX MOVES. One skeleton, four flavours:
--
--   rarity 1  damage 7, 3 uses   the species signature: big and repeatable
--   rarity 2  damage 8, 2 uses   burst: the hardest single hit, and it runs out
--   rarity 2  damage 4, 5 uses   sustain: the move that is always available
--   rarity 3  damage 5, 3 uses   a solid common
--   rarity 3  damage 3, 4 uses   a cheap common with a rider
--   rarity 3  damage 2, 5 uses   the rider IS the move
--
-- Elements differ only in where the riders point -- fire buys attack, air buys
-- speed, rock buys defense and pays speed, water spreads. That is deliberate:
-- an element should be an identity, not an advantage, and four pools that are
-- equal by construction cannot drift apart the way four hand-tuned ones did.
--
-- EVERY ELEMENT MOVE DEALS DAMAGE. Four of them used to deal none at all
-- (Campfire, Ocean Mist, Breeze, Stone Wall) and they measured 0-18%, because a
-- zero-damage move in a three-slot roster is a third of a companion spent on
-- something that cannot win. Support belongs in the neutral pool, where it
-- competes against other support; the element pool is the offensive identity.
--
-- SUPPORT IS PRICED AGAINST FREE. Every companion can Rally and Mend once a
-- battle without spending a slot (see `C.FREE_ACTIONS`), so a drawn boost or
-- heal no longer has to be the thing that stops you dying -- it has to be
-- BETTER than the free one, which is a far easier thing to price and a far more
-- interesting thing to draw.

C.MOVE_POOLS = {
  fire = {
    ["Firenado"]           = { type = "fire", rarity = 1, count = 3, damage = 7, attack = 2, speed = 2, defense = -1, health = 0 },
    ["Inferno"]            = { type = "fire", rarity = 2, count = 2, damage = 8, attack = 2, speed = -1, defense = -2, health = 0 },
    ["Scorching Ash"]      = { type = "fire", rarity = 2, count = 4, damage = 4, attack = 2, speed = 1, defense = -1, health = 0 },
    ["Phoenix Burst"]      = { type = "fire", rarity = 3, count = 2, damage = 5, attack = 2, speed = 1, defense = 0, health = -2 },
    ["Flame Shield"]       = { type = "fire", rarity = 3, count = 3, damage = 4, attack = -1, speed = 0, defense = 3, health = 0 },
    ["Campfire"]           = { type = "fire", rarity = 3, count = 3, damage = 3, attack = 2, speed = -1, defense = 1, health = 1 },
  },
  water = {
    ["Tidal Wave"]         = { type = "water", rarity = 1, count = 3, damage = 7, attack = 2, speed = 1, defense = 0, health = 0 },
    ["Ice Spear"]          = { type = "water", rarity = 2, count = 2, damage = 8, attack = 2, speed = -1, defense = -2, health = 0 },
    ["Whirlpool"]          = { type = "water", rarity = 2, count = 4, damage = 4, attack = 0, speed = 2, defense = 0, health = 0 },
    ["Frostbite"]          = { type = "water", rarity = 3, count = 2, damage = 5, attack = 0, speed = 1, defense = 0, health = 0 },
    ["Deep Current"]       = { type = "water", rarity = 3, count = 3, damage = 4, attack = 1, speed = 2, defense = -1, health = 0 },
    ["Ocean Mist"]         = { type = "water", rarity = 3, count = 3, damage = 3, attack = 0, speed = 1, defense = 2, health = 0 },
  },
  air = {
    ["Tornado"]            = { type = "air", rarity = 1, count = 3, damage = 7, attack = 1, speed = 2, defense = 0, health = 0 },
    ["Storm Cloud"]        = { type = "air", rarity = 2, count = 2, damage = 8, attack = 2, speed = 0, defense = -3, health = 0 },
    ["Wind Slash"]         = { type = "air", rarity = 2, count = 4, damage = 4, attack = 1, speed = 2, defense = -1, health = 0 },
    ["Lightning Bolt"]     = { type = "air", rarity = 3, count = 2, damage = 5, attack = 2, speed = 1, defense = -2, health = 0 },
    ["Gale Force"]         = { type = "air", rarity = 3, count = 3, damage = 4, attack = 0, speed = 3, defense = -1, health = 0 },
    ["Breeze"]             = { type = "air", rarity = 3, count = 3, damage = 3, attack = 0, speed = 3, defense = 0, health = 0 },
  },
  rock = {
    ["Boulder Crush"]      = { type = "rock", rarity = 1, count = 3, damage = 7, attack = 3, speed = 0, defense = 0, health = 0 },
    ["Rock Slide"]         = { type = "rock", rarity = 2, count = 2, damage = 8, attack = 2, speed = -1, defense = -2, health = 0 },
    ["Seismic Slam"]       = { type = "rock", rarity = 2, count = 4, damage = 4, attack = 3, speed = 0, defense = 0, health = 0 },
    ["Granite Barrier"]    = { type = "rock", rarity = 3, count = 2, damage = 5, attack = 1, speed = -1, defense = 0, health = 0 },
    ["Earth Shield"]       = { type = "rock", rarity = 3, count = 3, damage = 4, attack = 0, speed = -1, defense = 3, health = 0 },
    ["Stone Wall"]         = { type = "rock", rarity = 3, count = 3, damage = 3, attack = 0, speed = 0, defense = 4, health = 1 },
  },
  neutral = {
    ["Body Slam"]          = { type = "normal", rarity = 1, count = 3, damage = 7, attack = 3, speed = 0, defense = 0, health = 0 },
    ["Heavy Strike"]       = { type = "normal", rarity = 2, count = 2, damage = 8, attack = 2, speed = -1, defense = -2, health = 0 },
    ["Quick Jab"]          = { type = "normal", rarity = 2, count = 4, damage = 4, attack = 1, speed = 1, defense = 0, health = 0 },
    ["Guard Break"]        = { type = "normal", rarity = 3, count = 2, damage = 5, attack = 2, speed = 0, defense = -1, health = 0 },
    ["Frenzy Blows"]       = { type = "normal", rarity = 3, count = 3, damage = 4, attack = 2, speed = 0, defense = 0, health = 0 },
    ["Momentum Shift"]     = { type = "normal", rarity = 3, count = 3, damage = 3, attack = 0, speed = 2, defense = 0, health = 1 },
    ["Power Up"]           = { type = "boost", rarity = 1, count = 3, damage = 2, attack = 4, speed = 2, defense = 2, health = 0 },
    ["Battle Cry"]         = { type = "boost", rarity = 2, count = 3, damage = 2, attack = 3, speed = 3, defense = 0, health = 0 },
    ["Iron Skin"]          = { type = "boost", rarity = 2, count = 3, damage = 2, attack = 0, speed = 1, defense = 6, health = 2 },
    ["Swift Wind"]         = { type = "boost", rarity = 3, count = 3, damage = 2, attack = 1, speed = 4, defense = 0, health = 0 },
    ["Warrior's Resolve"]  = { type = "boost", rarity = 3, count = 3, damage = 2, attack = 2, speed = 2, defense = 1, health = 0 },
    ["Adrenaline Surge"]   = { type = "boost", rarity = 3, count = 3, damage = 2, attack = 3, speed = 1, defense = 0, health = 0 },
    ["Life Surge"]         = { type = "heal", rarity = 1, count = 3, damage = 0, attack = 1, speed = 1, defense = 0, health = 7 },
    ["Regenerate"]         = { type = "heal", rarity = 2, count = 3, damage = 0, attack = 0, speed = 1, defense = 1, health = 6 },
    ["Recovery"]           = { type = "heal", rarity = 2, count = 3, damage = 0, attack = 0, speed = 1, defense = 0, health = 6 },
    ["Heal"]               = { type = "heal", rarity = 3, count = 3, damage = 0, attack = 0, speed = 0, defense = 0, health = 6 },
    ["Vital Essence"]      = { type = "heal", rarity = 3, count = 3, damage = 0, attack = 0, speed = -1, defense = 1, health = 6 },
    ["Healing Winds"]      = { type = "heal", rarity = 3, count = 3, damage = 0, attack = 1, speed = 2, defense = 0, health = 5 },
  },
}

--- How many moves a companion carries.
---
--- Three, and the third of them is the card's bottom row. It was four, drawn as
--- one element move plus one from each of three support pools.
---
--- Three is the number the printed card can actually hold: the moves panel is
--- 549 pixels wide inside its frame, and the longest names in these pools
--- ("ADRENALINE", "REGENERATE") do not fit a two-column grid at a size worth
--- drawing. Three full-width rows fit every name in the game on one line at
--- more than twice the height. See `SLOTS` in `src/lib/card/layout.mjs`.
---
--- It is also what makes a roster a DECISION. At four slots with one drawn from
--- each support pool there was nothing to decide -- everybody had an attack, a
--- boost, a heal and a neutral. At three, drawn freely, what you got is a
--- character.
C.MOVE_SLOTS = 3

--- The draw weight of each rarity tier. Bigger is more common.
---
--- Rarity 1 is the RARE tier, so the weights run the other way from the number.
--- A pool of six is one rarity 1, two rarity 2 and three rarity 3, which at
--- these weights is a 1-in-39 chance of the rare move per drawn slot -- about
--- one companion in twenty shows one, and a companion that shows two is worth
--- stopping to look at.
---
--- The neutral pool is eighteen moves in the same 1:2:3 shape, so its rare
--- share works out identical: the tier means the same thing in both pools,
--- which is the property that lets `MOVE_ELEMENT_BIAS` be a flavour dial rather
--- than a power dial.
C.MOVE_RARITY_WEIGHT = { [1] = 1, [2] = 4, [3] = 10 }

--- How often a drawn slot comes from the companion's own element pool, as a
--- percentage, with the neutral pool taking the rest.
---
--- Not 50: the signature slot is ALREADY elemental and guaranteed, so a
--- companion reads as its element before this is consulted at all. At 40 the
--- expected roster is the signature plus about 0.8 more element moves and about
--- 1.2 neutral, which lands roughly a third of companions on three attacks, a
--- half on two attacks and a support, and a sixth on one attack and two
--- support. Those are the three archetypes; move this and you move how common
--- each one is.
C.MOVE_ELEMENT_BIAS = 40

--- How much likelier a species is to draw its own `advancedMove`.
---
--- The index gives every entry a `basicMove` and an `advancedMove`.
--- `basicMove` is guaranteed -- it is the signature slot. Guaranteeing the
--- second one too would spend two of three slots on the index and leave a
--- single roll, so `advancedMove` is weighted up instead: common for the
--- species, rare in the world, and a companion holding both of its signature
--- moves is a roll worth keeping.
C.MOVE_SIGNATURE_BOOST = 6

--- The two actions every companion has and no companion carries.
---
--- Rally and Mend cost no slot, are identical for everybody, and are usable
--- once each per battle. They exist because three slots is not enough room to
--- carry a whole game: a rolled roster used to have to contain its own answer
--- to being low on health, and on the old four-slot roll about one companion in
--- twelve did not have one. At three slots that hole would have been much
--- bigger, and "guarantee a heal in the roll" would have spent a third of every
--- roster in the game on the same move.
---
--- They are opposed on purpose and neither is strictly good:
---
---   Rally   attack and speed up, health down    -- pay life for tempo
---   Mend    health and defense up, speed down   -- pay tempo for life
---
--- The real price of both is the ROUND. A turn spent on Rally is a turn not
--- spent on damage, and that is the whole cost; it needs no other.
---
--- Both are deliberately beaten by a good drawn move: Mend restores what a
--- rarity-3 `Heal` does, and `Heal` can be used four times. The free pair is a
--- floor, not a replacement, which is what keeps the support half of the
--- neutral pool worth drawing.
---
--- Written with identifier keys rather than `["Rally"]` so the two tools that
--- parse this file for move names -- `tools/sync-monster-index.mjs` and
--- `tools/studio-plugin.ts` -- do not read them as pool moves. They are not in
--- `C.MOVE_POOLS`, and that is also what stops one being smuggled into a stored
--- roster: `Battle.moveDef` does not know them, so the battle-fleet worker's
--- roster validation rejects the name.
C.FREE_ACTIONS = {
  Rally = { type = "boost", rarity = 0, count = 1, damage = 0, attack = 5, speed = 4, defense = 0, health = -2 },
  Mend  = { type = "heal",  rarity = 0, count = 1, damage = 0, attack = 0, speed = -3, defense = 4, health = 6 },
}

-- Activities ----------------------------------------------------------------
-- Durations are milliseconds, matching the assignment timestamp.

C.ACTIVITIES = {
  feed = {
    -- cost item is the faction berry, resolved per-monster
    energyGain = 10,
  },
  play = {
    duration = 900 * 1000,   -- 15 minutes
    energyCost = 10,
    happinessGain = 25,
  },
  --- v2: the core loop is FREE. `cost` is absent on both, and its absence is
  --- the feature -- `Monster.Quest` and `Battle.Begin` skip the charge when
  --- there is no `cost` table, so restoring one line here restores the fee.
  ---
  --- Rune stopped doing the clock's job. Happiness already caps a companion at
  --- four actions an hour; charging a Rune on top meant zero Rune was zero
  --- gameplay, and a player with nothing had no route back. Rune now buys
  --- ADVANCEMENT -- levels, captures, storage, the pass -- never the right to
  --- play. Demand for it is elastic on purpose: people who buy to get further
  --- lift the price steadily, where people forced to buy to act at all gap it
  --- and lock out the newcomer (ECONOMY_V2.md §6).
  quest = {
    duration = 3600 * 1000,  -- 1 hour
    energyCost = 25,
    happinessCost = 25,
    --- Was 1, against an arena session's measured 6.84 in about two minutes.
    --- Identical price on every other axis -- 25 energy, 25 happiness -- so the
    --- quest was strictly dominated, and it is the verb the tutorial teaches.
    --- Seven makes the slow, fire-and-forget option worth choosing.
    expGain = 7,
    --- GOLD, not a box. This line is the single biggest correction in the
    --- economy and the reason is arithmetic, not taste.
    ---
    --- A quest paid `lootRarity = 2` -- a crate worth ~21 berries -- against
    --- the ~2.75 berries a quest cycle spends. A 7.6x surplus, on a one-hour
    --- timer, is ~19 crates a day for a wallet that never sleeps and ~2 for a
    --- person who plays for two hours. That is loot proportional to playtime,
    --- which is precisely the shape ECONOMY_V2.md §7 says was removed; only
    --- the arena half of it ever was.
    ---
    --- The rule now is one sentence: **items come from the calendar, Gold
    --- comes from the verbs.** An item reward per action funds more actions,
    --- so it compounds for whoever acts most. Gold does not -- to turn Gold
    --- back into playtime you have to find a player willing to sell you
    --- berries, which is the market this economy is for.
    ---
    --- 15 Gold against a cycle costing ~2.75 berries (~9 Gold at the desk bid)
    --- is a real reward without beating the desk. What actually bounds it is
    --- `C.ECONOMY.gold.rewardWindowCap`, not this number: both verbs draw on
    --- one 20-hour allowance, so a bot and a person collect the same Gold.
    goldReward = 15,
  },
  battle = {
    energyCost = 25,
    happinessCost = 25,
    --- Per WIN, and Gold for the same reason the quest pays Gold.
    ---
    --- A win used to pay a tier-1 box. Under the old table that was 1.53
    --- berries and deliberately break-even; under the new one a tier-1 box is
    --- ~6.5 berries against a session costing ~2.75, which would have made the
    --- arena item-positive by 4.7x overnight. Rather than shrink tier 1 back
    --- into an apology, the arena moved to the same Gold allowance as the
    --- quest.
    ---
    --- Four battles a session, so a clean sweep is 20 Gold. A two-hour player
    --- fighting steadily reaches `rewardWindowCap` and stops, which is the
    --- intent: the ceiling is the day's, not the session's.
    winGold = 5,
  },
}

C.MAX_ENERGY = 100
C.MAX_HAPPINESS = 100

--- Battles granted per arena session. The session is free in v2; what bounds it
--- is the 25 happiness it costs to enter, and happiness comes only from a
--- fifteen-minute Play. Four actions an hour is the ceiling, for everyone.
C.BATTLES_PER_SESSION = 4

-- Hunt ----------------------------------------------------------------------
--
-- The catch curve is shown to the player before they commit. Keep every term
-- published in the catalog so the percentage on screen is the percentage the
-- Hunt process rolls, not a frontend approximation that can drift.
C.HUNT = {
  protocol = "runerealm-hunt/1",
  levelRange = 5,
  searchCooldown = 3000,
  --- What ROAMING costs. Two of each, not five.
  ---
  --- Twenty berries was a whole day's crate for one run, which put hunting and
  --- playing in direct competition for the same daily allowance -- a player
  --- could hunt OR play two hours, never both. The capture now carries a
  --- Scroll (below), so the entry no longer has to be the price of the mode;
  --- it is the toll that keeps a run from being free to open and abandon.
  entry = {
    berries = {
      fire_berry = 2,
      water_berry = 2,
      air_berry = 2,
      rock_berry = 2,
    },
  },
  capture = {
    --- ONE SCROLL PER ATTEMPT, spent whether or not the binding holds.
    ---
    --- Scroll was in `C.ITEMS`, in the asset ledger, on a market and behind a
    --- 20,000-Gold NPC desk, and NOTHING in the game consumed it -- there was
    --- no handler anywhere that spent one. This is its job, and giving it one
    --- closes the loop the economy was missing:
    ---
    ---   play -> Gold -> buy a Scroll -> attempt a capture -> burn Rune.
    ---
    --- That is what makes Gold worth earning, gives the Scroll desk a reason
    --- to exist, and puts a second consumable in front of the Rune sink so
    --- capturing is a decision with a price rather than a Rune tap.
    scrollCost = 1,
    --- ONE TO THREE, not one to five.
    ---
    --- The fourth and fifth Rune bought 8 and 7 points of chance on a curve
    --- flattening towards its cap -- the two most expensive and least
    --- interesting choices on the slider. Three bids that mean something beat
    --- five where two are filler.
    minRuneBid = 1,
    maxRuneBid = 3,
    minChance = 5,
    maxChance = 95,
    --- Retuned for the 1-3 range. Equal-level odds are 35%, 56%, 74% -- the
    --- same floor as before and very nearly the same ceiling, across three
    --- choices instead of five. `hunt.lua` computes
    --- `baseChance + floor(runeScale * runes / (runes + runeHalf))
    ---  + (hunterLevel - wildLevel) * levelStep`, so these three move together
    --- and re-deriving one alone will not hold the curve.
    baseChance = 8,
    runeScale = 220,
    runeHalf = 7,
    levelStep = 3,
  },
}

-- Loot ----------------------------------------------------------------------

--- A box is a HAUL, and the tier decides how big.
---
--- The old table was nine independent rows, each with its own `chance` out of
--- 1000 scaled by the tier and clamped at 950. Three things were wrong with it
--- and all three were visible on screen:
---
---   * **A common box paid 1.53 berries**, and 31.6% of the time it paid the
---     pity floor of exactly one. "Rock Berry +1" is not a reward, it is an
---     apology.
---   * **The tiers were indistinguishable above 2.** Because `chance` was
---     capped and `amount` never scaled, tier 2 paid 20.93 berries, tier 3
---     paid 21.53, tier 4 paid 22.14 and tier 5 paid 22.74. A legendary box
---     was 1.8 berries better than an uncommon, and the words on it were the
---     only difference.
---   * **The same berry arrived twice**, once from the tier-1 row and once
---     from the tier-2 row, because independent rows do not know about each
---     other.
---
--- So a box now draws `picks` DISTINCT elements and pays `min`..`max` of each,
--- and the tiers separate properly: ~6, ~22, ~48, ~88, ~132 berries.
---
--- **The first pick is always the opener's own faction berry.** Its own element
--- is worth double when fed (20 energy against 10), so a run of boxes that
--- never contained it would be a run of days unable to act -- and the whole
--- point of the daily crate is that a player can always play. The REMAINING
--- picks are deliberately other elements: those are the surplus, and a surplus
--- somebody else needs is what makes a market. Do not "fix" that by paying all
--- four evenly; the asymmetry is the trade.
---
--- Tier 2 is the load-bearing number, because it is the daily crate. ~22
--- berries -- about 11 own-element and 11 other -- funds ~7.3 actions, which
--- is the ~2 hours a day the design promises a player who wants it. Moving it
--- moves that promise; see ECONOMY_V2.md §7.
C.LOOT_TIERS = {
  --- Common. One element, a real handful. Streak-3 crates and nothing else.
  { picks = 1, min = 5,  max = 8,  scrolls = 0, scrollChance = 0   },
  --- Uncommon. THE DAILY CRATE. ~22 berries = ~7.3 actions = ~2 hours.
  --- Also the only routine Scroll trickle, at 12%.
  { picks = 2, min = 9,  max = 13, scrolls = 0, scrollChance = 120 },
  --- Rare. The ten-day streak. Used to be a DOWNGRADE -- a lone tier-3 box
  --- paid 21.53 berries against the streak-3 pair's 22.46, so ten days of
  --- perfect attendance bought fewer berries than three did.
  { picks = 3, min = 13, max = 19, scrolls = 1, scrollChance = 0   },
  --- Epic. No routine source; kept live for events and admin grants.
  { picks = 4, min = 18, max = 26, scrolls = 1, scrollChance = 500 },
  --- Legendary. What a new player is handed once, and the only box that is
  --- worth being excited about on sight.
  { picks = 4, min = 26, max = 40, scrolls = 2, scrollChance = 500 },
}

C.MAX_LOOT_RARITY = 5

--- Names, so the client and the process agree on what a tier is called.
C.LOOT_TIER_NAMES = { "Common", "Uncommon", "Rare", "Epic", "Legendary" }

--- What a brand new player is handed so they can actually do something.
---
--- The berries are the immediate grant -- enough to act before opening
--- anything -- and the box is the kick-start.
C.STARTER_INVENTORY = {
  air_berry = 5, water_berry = 5, fire_berry = 5, rock_berry = 5,
}

--- ONE LEGENDARY BOX, once, ever.
---
--- It was three tier-1 boxes, which under the old table was 4.6 berries: under
--- two actions, delivered as three separate disappointments. A legendary is
--- ~132 berries and 2-3 Scrolls -- about five days of play and two or three
--- hunt captures -- handed over at the moment somebody is deciding whether
--- this game is worth their time.
---
--- It is not a faucet and cannot be farmed into one: `p.seeded` grants it once
--- per account, entry is a paid pass, and a promised pass is explicitly
--- excluded (see `Faction.Join`).
C.STARTER_LOOTBOXES = { [5] = 1 }

--- The daily claim, and the ONLY routine source of boxes.
---
--- Every per-action loot reward is gone -- the quest and the arena pay Gold
--- now (see `C.ACTIVITIES`), because an ITEM reward per action is the one
--- shape a machine beats. A quest paid a tier-2 box, cost ~2.75 berries of
--- upkeep and returned ~21: a 7.6x surplus, repeatable ~19 times a day, so a
--- wallet running all night made ~400 berries against a two-hour person's ~42.
--- ECONOMY_V2.md §7 says that faucet moved off playtime; only the ARENA half
--- of it ever did.
---
--- So: items come from the calendar, Gold comes from the verbs. A bot and a
--- person collect the same crate, and the crate is what decides how much
--- anyone can play.
C.DAILY = {
  interval = 20 * 3600 * 1000,   -- 20 hours, so a daily habit does not drift
  -- Miss this much and the streak is gone. Two intervals: one to claim in, one
  -- of grace.
  breakAfter = 40 * 3600 * 1000,
  -- Rune is allocated by EconomyState.policy.runeRewards. The old 1/2/3 per
  -- wallet stipend multiplied global emission by wallet count and is disabled.
  runes = 0,
  --- What the streak is FOR, and it now actually climbs:
  ---
  ---   1-2 days   ~22 berries        (tier 2)
  ---   3-9 days   ~28 berries        (tier 2 + tier 1)
  ---   10+ days   ~48 berries + Scroll (tier 3)
  ---
  --- Boxes rather than Rune, deliberately, and the two are on different clocks
  --- for different reasons:
  ---
  ---   * RUNE is the faucet, so it is flat and daily. Nothing about coming back
  ---     more often may increase total emission -- that is the property the
  ---     whole schedule rests on.
  ---   * BOXES are berries, which are consumed rather than banked, so scaling
  ---     them with a streak rewards the habit without touching supply. A streak
  ---     is also wall-clock-bound and resets on a miss, which is the one thing
  ---     a bot cannot compress.
  ---
  --- Ordered by `minStreak` DESCENDING; the first match wins. Emptying this
  --- table falls back to `lootboxes`/`lootboxRarity` below.
  streakTiers = {
    { minStreak = 10, boxes = { { rarity = 3, count = 1 } } },
    { minStreak = 3,  boxes = { { rarity = 2, count = 1 }, { rarity = 1, count = 1 } } },
    { minStreak = 1,  boxes = { { rarity = 2, count = 1 } } },
  },
  --- The fallback when `streakTiers` matches nothing, and what every claim paid
  --- before the tiers existed.
  lootboxRarity = 2,
  lootboxes = 1,
}

-- Progression ---------------------------------------------------------------

--- Fibonacci-ish curve, kept from the original so existing levels stay honest.
--- Level 0 -> 1 costs 1, then 2, 3, 5, 8, 13, ...
function C.requiredExp(level)
  if level <= 0 then return 1 end
  if level == 1 then return 2 end
  local a, b = 1, 2
  for _ = 2, level do
    a, b = b, a + b
  end
  return b
end

--- Points awarded per level-up, all of which must be spent.
C.LEVEL_UP_POINTS = 10
--- At most this many of the ten into any one stat.
---
--- It was five, which is ten points across exactly two stats and nothing into
--- the other two. That made an all-in build FREE: the two stats you skipped
--- stayed at their level-zero value forever while the two you bought grew
--- tenfold, and by level 20 the gap between them was the whole character.
---
--- Measured with `./run-balance.sh matrix20`, which plays every build against
--- every other and reports win rates. At a cap of five the rows were 35% to
--- 62% -- a pure defensive build won 3% of its games against a balanced one
--- while being the build most new players reach for, and no combination of
--- `speedSwing`, `defenseMitigationMax` or `attackPerStatPoint` moved it
--- (swept; the best score was 173 against an ideal near zero). All those knobs
--- can do is change WHICH extreme wins.
---
--- Three cannot be spent on fewer than four stats. A build keeps its identity
--- -- the tank is still the one with the most defense -- but the stat it
--- skipped is no longer a hole ten levels deep. Together with
--- `Battle.TUNING.speedSwing = 0.3` the same matrix reports 44-56% for every
--- build at levels 1, 10 and 20, which is the only configuration measured so
--- far where all four are worth playing. Neither half works alone: the cap on
--- its own hands the game to whoever bought speed (86% at level 20), and the
--- speed fix on its own leaves the extremes where they were.
---
--- APPLIED, at three. It was left at five with the measurement recorded but
--- not acted on, on the grounds that balancing is a playtest decision. The move
--- rebuild forced the issue, because it re-derived the same conclusion from
--- scratch and could not get past it.
---
--- The rebuilt catalog, the budget-scaled riders and the free actions are all
--- downstream of the stat spread, so the pools and the attack floor were swept
--- against real player growth with all of them in place
--- (`./run-balance.sh growsweepb|growsweepc|growsweepd`). At a cap of five
--- there is NO pair of `hpPerHealth` and `attackPerStatPoint` that makes both
--- mirrors work at once:
---
---   attack floor low   tank v tank runs to the 50-round cap, 70-100% of fights
---   attack floor high  even v even is over in two rounds
---
--- Eighteen combinations, every one of them failing one mirror or the other.
--- Run the same grid with builds a cap of three can reach
--- (`./run-balance.sh capgrowa`) and every cell is four to ten rounds with no
--- grinds anywhere. That is not a tuning result, it is the shape of the
--- problem: the tank's identity is a stat left at 1, and nothing downstream of
--- a dump stat can bridge it.
---
--- What it costs is real and worth stating: an all-in build is no longer free.
--- Ten points cannot be spent on fewer than four stats, so the stat you skip is
--- no longer a hole ten levels deep. A tank is still the build with the most
--- defense; it is no longer the build with no attack.
C.LEVEL_UP_MAX_PER_STAT = 3

--- What a level-up costs, in Rune, for the level being ENTERED.
---
--- One quarter of the target level, rounded up: levels 1-4 cost 1, 5-8 cost 2,
--- 9-12 cost 3, and so on. A sink that scales with progression rather than a
--- flat fee, so it stays out of a new player's way — the first four levels cost
--- what a single quest does — and only starts to bite once a player is deep
--- enough to be earning steadily.
---
--- Integer division, not `math.ceil(level / 4)`: Luerl's `/` is float division
--- and the result would be stored as 1.0 rather than 1, which is the defect
--- CLAUDE.md warns about. `(level + 3) // 4` is exactly ceil for positive
--- integers and never leaves the integer domain.
--- v2: quadratic, not linear-in-quarters.
---
--- `(L + 3) // 4` totalled SIXTY Rune to carry a companion from 0 to 20 --
--- about five weeks of emission for what the exp curve makes a multi-year
--- artifact. With the core loop now free (see C.ACTIVITIES), levelling is one
--- of the few things Rune still buys, and it is the one the market actually
--- competes over, so the cost has to bite where the competition is.
---
--- `(L*L + 15) // 16` is ceil(L^2/16): levels 1-3 cost 1, level 8 costs 4,
--- level 12 costs 9, level 16 costs 16, level 20 costs 25 -- ~190 Rune for the
--- full climb. Cheap enough to stay out of a new player's way for the first
--- fortnight, steep exactly in the 14-20 band where a high-level companion
--- becomes worth owning.
---
--- Integer division throughout, never `/`: Luerl's `/` is float division and
--- the result would be stored as 9.0 rather than 9, which is the defect
--- CLAUDE.md warns about.
function C.levelUpCost(level)
  local target = math.tointeger(level) or 0
  if target < 1 then target = 1 end
  return (target * target + 15) // 16
end

-- One active companion and a collection --------------------------------------
--
-- A player raises exactly ONE active companion. Every other companion they own
-- waits in the COLLECTION until it is chosen. The split keeps every game verb
-- singular -- feed, play, quest, hunt, level and battle all mean "my
-- companion" -- while captures and trades can still grow a real collection.
--
-- `monsters` remains the one-entry map used by older deployments and clients;
-- changing its storage shape would make migrations needlessly destructive.
-- The cap is therefore one, and `Monster.SetActive` atomically exchanges that
-- entry with a collection entry.
--
-- Storing costs a rune and retrieving is free, deliberately. The charge is not
-- revenue, it is a brake: a free round trip would let a player park a companion
-- the instant a quest went badly and pull it back out with its timers reset.
-- Making the outbound leg cost something and the inbound leg cost nothing means
-- the collection is a place to keep things, not a mechanic to game.
C.ROSTER = {
  --- Exactly one companion is active. Everything else is collection.
  max = 1,
  --- Sending a companion to the collection. Free to bring one back.
  storeCost = { item = "rune", amount = 1 },
}

-- The marketplace, in this process --------------------------------------------
--
-- Companion sales settle HERE rather than through a second contract, and that
-- is not a preference: escrow has to live in the same process as the thing
-- being escrowed. A separate index cannot take custody of a companion this
-- process owns, so a listing moves the record into `Market` and a sale moves it
-- out -- one process, one atomic step, no cross-process delivery to fail.
--
-- Prices are in IN-GAME runes, the inventory item, not the withdrawn token.
-- A token-priced sale would need a credit notice from the token process, and
-- that delivery path is not working on the current node (the game deducts and
-- the token never mints; see Rune.Withdraw). In-game runes make a purchase a
-- single deduction and credit inside one message, which cannot half-happen.
C.MARKET = {
  --- Both bounds are on the asking price, in runes.
  minPrice = 1,
  maxPrice = 1000000,
  --- A listing is only ever created from the collection, never the roster.
  --- Selling something that is mid-quest is not a state worth having.
  fromCollectionOnly = true,
}

-- Gold economy --------------------------------------------------------------
--
-- These are contract defaults from ECONOMY_MARKETPLACE_PLAN.md. Open launch
-- decisions remain disabled in the durable policy state created by
-- economy.lua; putting the locked/default rails here keeps the deployed bundle,
-- live-Luerl tests and browser catalog on one source of truth.
C.ECONOMY = {
  gold = {
    launchSupply = 300000,
    protocolCeiling = 20000000,
    targetFloor = 300000,
    stabilizationReserve = 180000,
    perQualifiedPlayer = 1000,
    normalWeeklyReleaseBps = 500,
    contractWeeklyReleaseBps = 1000,
    shopBurnBps = 2500,
    burnAboveTargetBps = 11000,
    --- THE GOLD FAUCET, and the only one that is not a desk.
    ---
    --- Before this there was no way to earn Gold by playing at all. The only
    --- source was selling an item into an NPC desk -- and a desk's stock cap
    --- is a share of outstanding supply, so on a young process the cap is a
    --- dozen units and the desk saturates almost immediately. A new player had
    --- no Gold, no way to get Gold, and therefore no way to buy anything from
    --- anyone. Measured: of the 300,000 Gold issued at launch, only ~35,070
    --- could ever reach a player, because every desk's STOCK cap binds long
    --- before its Gold reserve does.
    ---
    --- So the verbs pay Gold now (`C.ACTIVITIES`), and this is the ceiling on
    --- it. One allowance per account per 20-hour window, shared by every verb
    --- that pays -- which is what makes it bot-proof: a wallet playing around
    --- the clock and a person playing for two hours collect exactly the same
    --- 60 Gold, the same way they collect exactly the same daily crate.
    ---
    --- 60 a window is ~4 quests or ~12 arena wins, and it is reached by a
    --- two-hour session, which is the intended shape. Seventeen days of
    --- collecting it in full lands on `perQualifiedPlayer` -- the 1,000 Gold
    --- this policy already assumes a real player holds -- so the flow and the
    --- stock agree without a second number being invented.
    rewardWindowCap = 60,
    --- Rewards are paid OUT OF the locked launch allocation, never minted, so
    --- `issued - burned = player + escrow + shop + locked` still holds after
    --- every payment. When the pool cannot cover a reward the verb pays
    --- nothing and says so, exactly the way a desk pauses rather than going
    --- negative.
    ---
    --- This is finite ON PURPOSE and it is the honest statement of the trade:
    --- a fixed Gold supply plus a gameplay faucet drains, and what refills it
    --- is `policy.gold.expansionEnabled` and the weekly target recomputation
    --- in ECONOMY_MARKETPLACE_PLAN.md §6.3. That machinery exists and is off.
    --- Turning it on is the launch decision this faucet depends on.
    rewardReserveFloor = 0,
  },
  --- Atoms in one whole Rune on the TOKEN process (10^Denomination).
  ---
  --- In-game Rune is indivisible and always counted in whole units; the token
  --- outside is divisible so it can be quoted against on an order book. The
  --- bridge is the only place the two units meet, and it refuses anything that
  --- is not a whole multiple of this -- see the header of `rune.lua`, which
  --- carries the same number because it is a separate process and cannot read
  --- this file. `deploy-rune.mjs` checks the two agree.
  runeUnits = 1000000,

  orderbook = {
    maxPerAccount = 20,
    maxGlobal = 2000,
    minValue = 10,
    maxUnitPrice = 1000000,
    maxQuantity = 1000000,
    creationCost = 1,
    feeBps = 200,
    expiry = 30 * 24 * 3600 * 1000,
    historyLimit = 500,
    --- The trader picks how long a quote lives; this is the ceiling and the
    --- default. A maker wants an order that retires itself; the cap is what
    --- keeps published state bounded. See ORDERBOOK.md §9.
    minExpiry = 5 * 60 * 1000,
    --- The fat-finger guard, in basis points either side of a reference price.
    ---
    --- Without it `maxUnitPrice` is the only limit, so one crossing order can
    --- print 1,000,000 and that print becomes the 7-day median that the desk
    --- charts, the swarm and every other reader take as the truth. 5,000 is
    --- +-50%, measured from a corridor that already spans the NPC desk's own
    --- bid and ask -- so it never refuses a price the house itself would
    --- quote, and it refuses five orders of magnitude above it.
    ---
    --- A market with no desk, no fills and no book has NO reference, and an
    --- unpriced market is not band-checked at all. That is deliberate: the
    --- first order in a new market is what establishes the reference, and
    --- there is nothing to compare it against.
    bandBps = 5000,
    --- How many units of a per-unit-repriced NPC desk one order may sweep.
    --- The desk quotes into the ladder (ORDERBOOK.md §3.1) and reprices after
    --- every unit, so the fill loop is bounded here as well as by the desk's
    --- own 20-hour limits.
    deskSweepMax = 100,
    --- Days of OHLCV kept and published per market. Candles are what the
    --- chart reads past the end of the fills list; ~40 bytes a day each.
    candleDays = 30,
  },
  shop = {
    accountWindow = 20 * 3600 * 1000,
    policyEpoch = 7 * 24 * 3600 * 1000,
    --- How many accounts a desk is sized for before anyone has bought a pass.
    ---
    --- The epoch flow cap used to be `flowSupplyBps = 200` -- 2% of OUTSTANDING
    --- item supply, issued minus consumed -- and that scaled the wrong way
    --- twice. It bounded a FLOW with a STOCK, and the two are inversely
    --- correlated here: eating a berry removes it from outstanding supply AND
    --- creates the demand to replace it, so the desk tightened exactly as the
    --- game got busier, and tightened again with every extra player eating
    --- alongside. Live it resolved to 9-11 units a week per berry against a
    --- 20-hour `limits.global` of 500 sitting beside it -- 50x apart, so the
    --- 20-hour limits were unreachable and every desk read
    --- "Policy-epoch supply-flow limit reached" on both sides.
    ---
    --- It is now an allowance per PASS EVER SOLD, which is the one number that
    --- grows with the game, in the same shape `emissionBudget` uses: a
    --- per-account rate times the lifetime pass count, with a floor of accounts
    --- underneath so a process that has sold no passes yet -- a fresh deploy,
    --- a test fixture, the recovery set before it is loaded -- still has a
    --- working desk. `epochFlowLimit` in economy.lua derives the per-account
    --- rate from this number and the desk's own 20-hour cap, and carries the
    --- arithmetic for why it is 20.
    flowFloorAccounts = 20,
    policyDelay = 24 * 3600 * 1000,
    anchorWeeklyBps = 500,
  },
  proceeds = { teamBps = 5000, runeBps = 3000, treasuryBps = 2000 },
  --- Rune emission: a SCHEDULE, not a number somebody types.
  ---
  --- ECONOMY.md §2 names the one structural flaw in the old design: a per-wallet
  --- faucet makes total emission `stipend x wallets x time`, and wallets are
  --- free to create. §3.1 is the fix, and it is the reason every number here is
  --- a global rather than a per-player rate:
  ---
  ---   mint a FIXED number of Rune per day globally and divide it among that
  ---   day's claimants.
  ---
  --- A million bots then add not one Rune to supply; they dilute their own
  --- share and everyone else's in exactly the proportion they added. That
  --- property is destroyed the moment the pot is derived from the population,
  --- so it never is. Growth changes each player's slice, never the total.
  ---
  --- Halving yearly because a supply schedule has to be knowable in advance --
  --- "N per epoch, halving yearly" is something a holder can price, and
  --- "1-3 per wallet per 20 hours, wallets unbounded" is not.
  ---
  --- THE NUMBER IS THE CALIBRATION, and it is not free to choose. 2000 per
  --- 30 days is the figure `economy-sim.mjs` calibrates the anti-farm case
  --- against: at $0.10 a Rune it puts a thousand hostile accounts at 4.9% of
  --- their pass cost recovered over a full year. Ten times this number is ten
  --- times that recovery and the farm becomes worth running, so moving it means
  --- re-running `node backend/native/economy-sim.mjs` and looking at the recoup
  --- column -- not just picking a rounder figure.
  ---
  --- The epoch is 30 DAYS rather than one, for two reasons that agree. It is
  --- the window the simulation and `accountNet30Cap` both already use, and a
  --- fixed pot divided among claimants has to stay integral: a daily pot of 67
  --- Rune split across 200 players is zero each after integer division, which
  --- is the same "the faucet pays nothing" bug in a new costume.
  rune = {
    --- v2: emission is PER ACCOUNT, not a pot divided among claimants.
    ---
    --- The fixed pot existed because a per-wallet faucet makes total emission
    --- `rate x wallets x time` and wallets were free. They are not free any
    --- more: entry is a paid pass, so multiplying wallets multiplies COST as
    --- well as yield, and that is what now bounds the faucet.
    ---
    --- This is a real trade and ECONOMY_MARKETPLACE_PLAN.md §8.7 names what it
    --- gives up -- its pass-pricing test assumes "adding attacker passes
    --- divides fixed reward pools rather than multiplying them", which is no
    --- longer true. The pass price now carries the sybil defence alone, which
    --- is exactly why it is denominated in Rune (ECONOMY_V2.md §5): a
    --- dollar-priced pass paying a Rune-denominated yield has a fixed strike
    --- above which farming is free money, and the whole design exists to push
    --- the price through that strike.
    ---
    --- 48 a month is the number, and it is an ENGAGEMENT ASSUMPTION wearing a
    --- rate's clothing. A full-intensity player burns ~240 Rune a month, so
    --- the economy deflates whenever more than 48/240 = 20% of passholders play
    --- properly. Move this and you are moving that assumption; see
    --- ECONOMY_V2.md §3 before you do.
    ---
    --- It also leaves ~24 minutes a day of play funded by emission alone, so a
    --- new or broke account is never locked out -- the deficit above that is
    --- what they buy from someone who would rather sell.
    emissionPerAccount = 48,
    --- ZERO: the schedule TERMINATES. Emission stops completely in year six.
    ---
    --- 48 integer-halves 24, 12, 6, 3, 1, 0, so the sixth halving is the last
    --- one and there is no floor under it. Lifetime emission per account is
    --- 12.17 epochs x (48+24+12+6+3+1) = ~1,144 Rune, and TOTAL SUPPLY IS HARD
    --- CAPPED at that times the number of passes ever sold. Nothing about time
    --- passing can add to it -- which is the strongest form of the guarantee
    --- the halving schedule exists to make.
    ---
    --- Known and accepted: an account created after year six earns nothing from
    --- the faucet, ever. It buys Rune from someone who has it, which is the
    --- end state the whole design points at anyway -- but it does mean the
    --- secondary market has to exist by then, not merely be planned.
    ---
    --- Set this to 1 to floor the schedule instead of ending it (~1% of the
    --- genesis rate, 12 Rune a year forever). That trades the hard cap for a
    --- newcomer who always has somewhere to start. REVISIT BEFORE YEAR SIX.
    minEmissionPerAccount = 0,
    --- A CIRCUIT BREAKER, not a divisor. Nothing is divided by the population
    --- any more; this only stops a runaway if something upstream goes wrong, so
    --- it must sit well above `emissionPerAccount x passes` and must never bind
    --- in normal operation.
    emissionPerEpoch = 2000,
    epochLength = 30 * 24 * 3600 * 1000,
    halvingPeriod = 365 * 24 * 3600 * 1000,
    -- After eight halvings the pot is 7 Rune an epoch; the floor takes over so
    -- emission goes flat rather than asymptotically to zero.
    maxHalvings = 8,
    --- GLOBAL ONLY. Never apply this per account.
    ---
    --- This is the one line that decides bounded versus infinite. Per account it
    --- is 100 Rune an epoch forever -- 1,217 a year, per wallet, with no end --
    --- and total supply has no upper bound at all. As a global floor it does
    --- what it says: emission goes flat rather than asymptotically to zero.
    minEmissionPerEpoch = 100,
    --- What an account too young to be weighted still receives, as a share of
    --- one per-capita slice.
    ---
    --- Not charity: without it a new wallet earns nothing for its first seven
    --- days, which is a dead first week for every honest player and no obstacle
    --- at all to a farm that simply waits. It is paid out of the SAME fixed pot
    --- as every other claim, so any number of newcomers dilutes the day rather
    --- than inflating it.
    newcomerFloorBps = 2500,
  },
}

-- Minting -------------------------------------------------------------------

--- Pulling a companion out of the game as a tradable Arweave asset.
---
--- The cost is in runes because the mint costs real AR and this process cannot
--- pay it: a process id is a transaction id and nobody holds its private key,
--- so AR sent here would be unspendable. A funded wallet signs the transaction
--- off-process (see backend/native/mint-worker.mjs) and the rune charge is what
--- reimburses it.
---
--- Ten runes against a measured mint cost of roughly 0.0007 AR — a 57 KB card
--- at 0.0117 AR per megabyte — is a wide margin, deliberately. The daily grants
--- three runes, so a mint is a few days of play rather than an afterthought,
--- and the margin absorbs both a rise in the AR price and the occasional
--- refunded failure.
C.MINT = {
  --- Pulling companions onto Arweave is OFF.
  ---
  --- Not removed: the queue, the worker, the deposit path and their tests all
  --- still work, and this is the one line that turns them back on.
  ---
  --- It is off because the economics only make sense for a companion somebody
  --- genuinely wants to own outside the game. A card costs about $0.006 to
  --- mint, which is fine, but the FIRST time it moves -- a sale, a gift, or
  --- coming home -- Arweave charges a new-account fee on the card's own
  --- process address, currently about $0.47, once per card forever. That is
  --- protocol (`ar_tx:get_tx_fee2`), it is not avoidable, and every asset on
  --- the network pays it. Across a test run that mints and trades thousands of
  --- companions it is the whole budget, for cards nobody keeps.
  ---
  --- So companions live in this process instead, where creating, trading,
  --- giving and destroying one are all free and instant. Minting becomes an
  --- export somebody chooses, not the way the game works.
  enabled = false,
  cost = { item = "rune", amount = 10 },
  --- How long a queued job may sit before the worker is presumed dead and the
  --- player gets their runes back. Milliseconds.
  timeout = 6 * 3600 * 1000,
}

return C
