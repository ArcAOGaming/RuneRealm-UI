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

--- Parked with companion asset export/import for the economy launch. Existing
--- recipes remain readable; no normal route may create or modify one.
C.CHARACTER_CUSTOMISER_ENABLED = false

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
-- `damage` is in units of 5 HP before stats and effectiveness. The stat fields
-- are one-off modifiers applied to the user when the move resolves.

C.MOVE_POOLS = {
  fire = {
    ["Firenado"]      = { type = "fire", rarity = 1, count = 2, damage = 5, attack =  0, speed =  2, defense = -1, health =  0 },
    ["Campfire"]      = { type = "fire", rarity = 2, count = 3, damage = 0, attack =  2, speed = -1, defense =  3, health =  3 },
    ["Inferno"]       = { type = "fire", rarity = 2, count = 1, damage = 6, attack =  3, speed = -1, defense = -2, health =  0 },
    ["Flame Shield"]  = { type = "fire", rarity = 3, count = 2, damage = 2, attack = -1, speed =  0, defense =  4, health =  2 },
    ["Scorching Ash"] = { type = "fire", rarity = 3, count = 2, damage = 3, attack =  1, speed =  1, defense = -2, health =  1 },
    ["Phoenix Burst"] = { type = "fire", rarity = 3, count = 1, damage = 4, attack =  0, speed =  2, defense =  0, health = -2 },
  },
  water = {
    ["Tidal Wave"]    = { type = "water", rarity = 1, count = 2, damage = 4, attack =  2, speed =  1, defense = -1, health =  0 },
    ["Whirlpool"]     = { type = "water", rarity = 2, count = 3, damage = 2, attack =  0, speed =  3, defense =  2, health = -2 },
    ["Ice Spear"]     = { type = "water", rarity = 2, count = 1, damage = 6, attack =  2, speed =  2, defense = -1, health =  0 },
    ["Ocean Mist"]    = { type = "water", rarity = 3, count = 2, damage = 0, attack =  0, speed =  2, defense =  4, health =  2 },
    ["Frostbite"]     = { type = "water", rarity = 3, count = 2, damage = 3, attack = -1, speed =  1, defense =  2, health =  0 },
    ["Deep Current"]  = { type = "water", rarity = 3, count = 1, damage = 3, attack =  1, speed =  3, defense = -1, health = -1 },
  },
  air = {
    ["Tornado"]        = { type = "air", rarity = 1, count = 2, damage = 4, attack =  1, speed =  4, defense = -1, health =  0 },
    ["Wind Slash"]     = { type = "air", rarity = 2, count = 3, damage = 2, attack =  2, speed =  3, defense = -1, health =  0 },
    ["Storm Cloud"]    = { type = "air", rarity = 2, count = 1, damage = 5, attack =  2, speed =  2, defense = -1, health =  0 },
    ["Breeze"]         = { type = "air", rarity = 3, count = 2, damage = 0, attack = -1, speed =  4, defense =  2, health =  2 },
    ["Lightning Bolt"] = { type = "air", rarity = 3, count = 2, damage = 4, attack =  2, speed = -1, defense =  0, health = -2 },
    ["Gale Force"]     = { type = "air", rarity = 3, count = 1, damage = 3, attack =  0, speed =  5, defense = -2, health =  0 },
  },
  rock = {
    ["Boulder Crush"]   = { type = "rock", rarity = 1, count = 2, damage = 5, attack =  3, speed = -2, defense =  2, health =  0 },
    ["Stone Wall"]      = { type = "rock", rarity = 2, count = 3, damage = 0, attack = -1, speed = -2, defense =  6, health =  2 },
    ["Rock Slide"]      = { type = "rock", rarity = 2, count = 1, damage = 7, attack =  2, speed = -1, defense = -2, health =  0 },
    ["Earth Shield"]    = { type = "rock", rarity = 3, count = 2, damage = 2, attack =  0, speed = -1, defense =  5, health =  2 },
    ["Seismic Slam"]    = { type = "rock", rarity = 3, count = 2, damage = 4, attack =  3, speed =  0, defense = -1, health = -1 },
    ["Granite Barrier"] = { type = "rock", rarity = 3, count = 1, damage = 1, attack =  0, speed = -2, defense =  6, health =  3 },
  },
  boost = {
    ["Power Up"]           = { type = "boost", rarity = 1, count = 2, damage = 0, attack =  5, speed =  2, defense = -2, health =  0 },
    ["Iron Skin"]          = { type = "boost", rarity = 2, count = 2, damage = 0, attack = -1, speed =  0, defense =  5, health =  2 },
    ["Swift Wind"]         = { type = "boost", rarity = 2, count = 2, damage = 0, attack =  2, speed =  5, defense = -1, health = -1 },
    ["Battle Cry"]         = { type = "boost", rarity = 3, count = 2, damage = 0, attack =  4, speed =  3, defense = -2, health = -1 },
    ["Warrior's Resolve"]  = { type = "boost", rarity = 3, count = 2, damage = 0, attack =  3, speed =  2, defense =  0, health = -2 },
    ["Adrenaline Surge"]   = { type = "boost", rarity = 3, count = 1, damage = 0, attack =  6, speed = -1, defense =  0, health = -3 },
  },
  heal = {
    ["Heal"]          = { type = "heal", rarity = 1, count = 2, damage = 0, attack = -1, speed =  0, defense =  0, health = 6 },
    ["Regenerate"]    = { type = "heal", rarity = 2, count = 3, damage = 0, attack = -2, speed =  0, defense =  2, health = 5 },
    ["Life Surge"]    = { type = "heal", rarity = 2, count = 1, damage = 0, attack =  1, speed =  0, defense =  0, health = 8 },
    ["Recovery"]      = { type = "heal", rarity = 3, count = 2, damage = 0, attack =  0, speed =  2, defense =  0, health = 5 },
    ["Vital Essence"] = { type = "heal", rarity = 3, count = 2, damage = 0, attack =  0, speed = -2, defense =  4, health = 7 },
    ["Healing Winds"] = { type = "heal", rarity = 3, count = 1, damage = 0, attack =  1, speed =  3, defense =  0, health = 4 },
  },
  normal = {
    ["Body Slam"]      = { type = "normal", rarity = 1, count = 2, damage = 5, attack = 3, speed =  0, defense =  1, health =  0 },
    ["Quick Jab"]      = { type = "normal", rarity = 2, count = 3, damage = 3, attack = 2, speed =  4, defense = -1, health =  0 },
    ["Heavy Strike"]   = { type = "normal", rarity = 2, count = 1, damage = 6, attack = 4, speed = -2, defense =  2, health =  0 },
    ["Guard Break"]    = { type = "normal", rarity = 3, count = 2, damage = 4, attack = 2, speed = -1, defense = -2, health =  1 },
    ["Frenzy Blows"]   = { type = "normal", rarity = 3, count = 2, damage = 2, attack = 3, speed =  2, defense = -1, health = -1 },
    ["Momentum Shift"] = { type = "normal", rarity = 3, count = 1, damage = 0, attack = 0, speed =  5, defense = -3, health =  3 },
  },
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
    lootRarity = 2,
  },
  battle = {
    energyCost = 25,
    happinessCost = 25,
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
  entry = {
    berries = {
      fire_berry = 5,
      water_berry = 5,
      air_berry = 5,
      rock_berry = 5,
    },
  },
  capture = {
    minRuneBid = 1,
    maxRuneBid = 5,
    minChance = 5,
    maxChance = 95,
    baseChance = 15,
    -- Equal-level odds for bids 1..5: 35%, 49%, 60%, 68%, 75%.
    -- Five is likely, never certain; level advantage still moves the result.
    runeScale = 120,
    runeHalf = 5,
    levelStep = 3,
  },
}

-- Loot ----------------------------------------------------------------------
-- `chance` is out of 1000 at rarity 1 and scales with the box tier. The
-- original multiplied by 1.5^(rarity-1) with no ceiling, so a tier-5 box rolled
-- 800 * 5.06 = 4050/1000 on four separate berries — every drop guaranteed, every
-- time. Chances are clamped to 950 now so even the best box can miss.

--- Runes are the only thing here that buys anything, so they are the only line
--- that has to be counted rather than eyeballed.
---
--- The first version paid `chance 550, minBox 1, amount 2`, which made a
--- tier-1 box worth about 1.09 Runes — and a tier-1 box is what every arena win
--- awards. A session costs one Rune and grants four battles, so winning half of
--- them roughly doubled your Runes, and two players trading PvP wins could farm
--- indefinitely. That is not an economy, it is a faucet.
---
--- Now: no Runes below tier 2, and a modest chance above it. Every activity is
--- a net Rune sink, and the faucet is the daily claim in game.lua — once per
--- wallet per day, which cannot be farmed by playing more.
--- v2: the item faucet moved from PER BATTLE to PER DAY, and that is the
--- change that stops a bot out-earning a person.
---
--- Loot used to be proportional to playtime, which is exactly the shape a
--- machine beats: one arena entry paid ~45 berries against the ~2.75 an action
--- consumes, a 20:1 surplus, so 96 actions a day beat 8 by 96 to 8. Now a
--- battle win pays roughly what one action costs, and the DAILY WORSHIP BOX is
--- where the day's supply actually comes from. A wallet sitting on the game for
--- twenty-four hours and a person checking in twice collect the same box.
---
--- Tier 1 is what a battle win pays: ~2.84 berries a session against the 2.75
--- an action spends (one berry for the Play, plus 35 energy at 20 per
--- own-element berry). Break-even, deliberately -- NOT a surplus. Battle loot
--- may only go item-positive once the timers are long; at a fifteen-minute
--- Play a per-battle surplus is a bot subsidy, and that is a v3 change that
--- lands with the timers or not at all (ECONOMY_V2.md §7).
---
--- Tier 2+ is the worship box: 4 x 0.95 x 5 from the rows below plus the tier-1
--- rows firing too, so ~20 berries, which funds ~7 actions.
---
--- Runes remain absent from this table at every tier, which is the fix from
--- HANDOFF §5.18 and must stay: a tier-1 box that paid Rune made winning half
--- your fights roughly double your money, and two players trading PvP wins
--- could farm it indefinitely.
C.LOOT_TABLE = {
  { item = "fire_berry",       chance = 250, minBox = 1, amount = 1 },
  { item = "water_berry",      chance = 250, minBox = 1, amount = 1 },
  { item = "rock_berry",       chance = 250, minBox = 1, amount = 1 },
  { item = "air_berry",        chance = 250, minBox = 1, amount = 1 },
  { item = "fire_berry",       chance = 800, minBox = 2, amount = 5 },
  { item = "water_berry",      chance = 800, minBox = 2, amount = 5 },
  { item = "rock_berry",       chance = 800, minBox = 2, amount = 5 },
  { item = "air_berry",        chance = 800, minBox = 2, amount = 5 },
  { item = "scroll",           chance = 200, minBox = 3, amount = 1 },
}

C.LOOT_CHANCE_CAP = 950
C.MAX_LOOT_RARITY = 5

--- What a brand new player is handed so they can actually do something.
C.STARTER_INVENTORY = {
  air_berry = 5, water_berry = 5, fire_berry = 5, rock_berry = 5,
}

C.STARTER_LOOTBOXES = { [1] = 3 }

--- The daily claim: the one Rune faucet that is not a reward for playing.
---
--- Everything else in the economy is a sink, so without this a player who runs
--- out simply stops. It is per wallet per day rather than per action, so
--- playing more cannot farm it.
--- The daily worship, at the Alter.
---
--- The original was `StreakAlter.lua` and the STREAK was the whole point: one
--- Rune for showing up, two at a three-day streak, three at ten. The rewrite
--- kept the reward and dropped the streak, which handed everyone the top tier
--- on day one and removed every reason to come back tomorrow rather than
--- whenever. These are the original numbers.
---
--- The original counted calendar days (`GetDay(timestamp)`) and broke a streak
--- if you missed one. This keeps the 20-hour interval — a calendar day drifts
--- against whatever time you happen to play — and breaks the streak only when
--- a whole extra interval has elapsed, which is the same promise ("don't skip
--- a day") without punishing someone for playing at breakfast instead of
--- midnight.
C.DAILY = {
  interval = 20 * 3600 * 1000,   -- 20 hours, so a daily habit does not drift
  -- Miss this much and the streak is gone. Two intervals: one to claim in, one
  -- of grace.
  breakAfter = 40 * 3600 * 1000,
  -- Rune is allocated by EconomyState.policy.runeRewards. The old 1/2/3 per
  -- wallet stipend multiplied global emission by wallet count and is disabled.
  runes = 0,
  --- What the streak is FOR. It was tracked and paid nothing.
  ---
  --- `dailyStreak` and `bestStreak` are counted, break after `breakAfter`,
  --- survive an Admin.Load by taking the max, get bucketed into high/medium/low
  --- for the `Checkins` census and are published in the claim receipt -- and
  --- until now the reward was `lootboxes = 1` at `lootboxRarity = 2` no matter
  --- what the streak said. Fully wired retention machinery with the reward torn
  --- out.
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
  --- The tier-3 box at ten days is doing a second job. NOTHING in the game has
  --- ever issued a box above tier 2 -- every `addLootboxes` site pays 1 or 2 --
  --- so `scroll`, whose loot-table row is gated at `minBox 3`, has had no
  --- organic supply at all and tiers 3-5 were dead config. This is the emitter,
  --- and it is metered by the calendar rather than by playtime.
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
--- LEFT AT FIVE. The measurement is recorded, not applied -- balancing is a
--- decision for playtesting, and this is the change testers would feel most.
--- Compare the two with `./run-balance.sh matrix20` against
--- `./run-balance.sh capmatrix20`.
---
--- If the extremes are worth keeping, the thing to move is where build
--- identity comes from: evolutions, move pools and factions are content and
--- can be balanced one at a time with the same matrix. A build whose identity
--- is a stat left at zero cannot be.
C.LEVEL_UP_MAX_PER_STAT = 5

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
  amm = { maxSlippageBps = 100, maxWeeklyPoolBps = 500 },
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
