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
---   * Costs are item ids, not token process ids. Berries, gems, scrolls and
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
  ruby             = { id = "ruby",             name = "Ruby",             section = "gem"   },
  emerald          = { id = "emerald",          name = "Emerald",          section = "gem"   },
  topaz            = { id = "topaz",            name = "Topaz",            section = "gem"   },
  diamond          = { id = "diamond",          name = "Diamond",          section = "gem"   },
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
  quest = {
    cost = { item = "rune", amount = 1 },
    duration = 3600 * 1000,  -- 1 hour
    energyCost = 25,
    happinessCost = 25,
    expGain = 1,
    lootRarity = 2,
  },
  battle = {
    cost = { item = "rune", amount = 1 },
    energyCost = 25,
    happinessCost = 25,
  },
}

C.MAX_ENERGY = 100
C.MAX_HAPPINESS = 100

--- Battles granted per paid session. Spending them is what a Rune buys.
C.BATTLES_PER_SESSION = 4

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
C.LOOT_TABLE = {
  { item = "fire_berry",       chance = 800, minBox = 1, amount = 5 },
  { item = "water_berry",      chance = 800, minBox = 1, amount = 5 },
  { item = "rock_berry",       chance = 800, minBox = 1, amount = 5 },
  { item = "air_berry",        chance = 800, minBox = 1, amount = 5 },
  { item = "rune",             chance = 250, minBox = 2, amount = 1 },
  { item = "emerald",          chance = 500, minBox = 2, amount = 3 },
  { item = "ruby",             chance = 400, minBox = 2, amount = 3 },
  { item = "topaz",            chance = 300, minBox = 3, amount = 2 },
  { item = "scroll",           chance = 200, minBox = 3, amount = 1 },
  { item = "diamond",          chance = 100, minBox = 4, amount = 1 },
  { item = "legendary_scroll", chance =  50, minBox = 5, amount = 1 },
}

C.LOOT_CHANCE_CAP = 950
C.MAX_LOOT_RARITY = 5

--- What a brand new player is handed so they can actually do something.
C.STARTER_INVENTORY = {
  air_berry = 5, water_berry = 5, fire_berry = 5, rock_berry = 5, rune = 3,
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
  runes = 1,
  streakTiers = {
    { streak = 10, runes = 3 },
    { streak = 3,  runes = 2 },
  },
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
C.LEVEL_UP_MAX_PER_STAT = 5

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
  cost = { item = "rune", amount = 10 },
  --- How long a queued job may sit before the worker is presumed dead and the
  --- player gets their runes back. Milliseconds.
  timeout = 6 * 3600 * 1000,
}

return C
