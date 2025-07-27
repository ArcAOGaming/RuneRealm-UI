Initialized = Initialized or nil

TARGET_WORLD_PID = "4trQXXADjEPc8yVsGhyfmfv5EpY8dh9gBW3BujzMyB8"
TARGET_PREMPASS_PID = "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI"
TARGET_BATTLE_PID = "3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs"
TARGET_ALTER_PID = "GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ"
--TARGET_BATTLE_PID = "3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs"
BaseSprite = '2wRFNJg9XlCcG6jKNpDAMxX1vnHZoub998KkR0qfDjE'
BaseSpriteAtlas = 'sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g'
BaseSpriteScale = 1.75
BaseSpriteHitbox = {width=38,height=48,offsetX=1,offsetY=22}

AR_TOKEN="xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10"
USDA_TOKEN="FBt9A5GA_KXMMSxA2DJ0xZbAq8sLLU2ak-YJe9zDvg8"
AO_TOKEN="0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc"
GAME_TOKEN="s6jcB3ctSbiDNwR-paJgy5iOAhahXahLul8exSLHbGE"
TRUNK_TOKEN="wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ"
NAB_TOKEN="OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU"
FIRE_BERRY="30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0"
WATER_BERRY="twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0"
ROCK_BERRY="2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM"
AIR_BERRY="XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA"
RUNE_TOKEN="4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q"
SCROLL_TOKEN="f1KnnMFYR125aQo0zYKgL0PzgJL__fO8JOtDfuIDdHo"
RUBY_TOKEN="rNVB_bYcNLk6OgcbyG8MEmxjGo76oj3gFzLBCWOhqXI"
EMERALD_TOKEN="C19KuCwx1VRH4WItj9wYUu1DIkdvareU3aMmojVZJf4"
TOPOZ_TOKEN="R5UGOfFboMv-zlaSSDgRqxRILmGgPPe5BlnPf5F4i3A"

-- Available tokens for purchase
PurchaseTokens = {
    {
    token = AO_TOKEN,
    amount = "1000000000000",
    name = "AO" ,
    icon="UkS-mdoiG8hcAClhKK8ch4ZhEzla0mCPDOix9hpdSFE",
    denomination = 12 
  },
      {
    token = GAME_TOKEN,
    amount = "1000000000000000000000000",
    name = "GAME" ,
    icon="-c4VdpgmfuS4YadtLuxVZzTd2DQ3ipodA6cz8pwjn20",
    denomination = 18 
  },
  --   {
  --   token = USDA_TOKEN,
  --   amount = "1000000000000",
  --   name = "AO" ,
  --   icon="seXozJrsP0OgI0gvAnr8zmfxiHHb5iSlI9wMI8SdamE",
  --   denomination = 12 
  -- },
  {
    token = TRUNK_TOKEN,  -- TRUNK token
    amount = "4000",
    name = "TRUNK",
    icon="hqg-Em9DdYHYmMysyVi8LuTGF8IF_F7ZacgjYiSpj0k",
    denomination = 3  
},
  {
    token = AR_TOKEN,
    amount = "1984000000000",
    name = "wAR",
    icon="L99jaxRKQKJt9CqoJtPaieGPEhJD3wNhR4iGqc8amXs",
    denomination = 12 
  },
}

--All avalable factions
AvailableFactions = {
    {
        name = "Sky Nomads",
        description = "Masters of the skies, the Sky Nomads harness the power of wind and air to outmaneuver and outlast their opponents.",
        mascot = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
        perks = {
            "Increased speed stats",
            "Boost to air-type attack power"
        }
    },
    {
        name = "Aqua Guardians",
        description = "Mystical protectors of the deep, the Aqua Guardians command the essence of water to heal and empower their allies.",
        mascot = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
        perks = {
            "Increased health stats",
            "Boost to water-type attack power"
        }
    },
    {
        name = "Inferno Blades",
        description = "Fearsome warriors of flame, the Inferno Blades unleash devastating fire-based attacks to overwhelm their foes.",
        mascot = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
        perks = {
            "Increased attack stats",
            "Boost to fire-type attack power"
        }
    },
    {
        name = "Stone Titans",
        description = "Immovable defenders, the Stone Titans use their unyielding strength to outlast and overpower their adversaries.",
        mascot = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
        perks = {
            "Increased defense stats",
            "Boost to earth-type attack power"
        }
    }
}

-- Admin wallet
ADMIN_WALLET = "dUqCbSIdkxxSuIhq8ohcQMwI-oq-CPX1Ey6qUnam0jc"

-- Supported berry types
SUPPORTED_BERRIES = {
    ["XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA"] = "air",    -- Air berries
    ["twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0"] = "water",  -- Water berries
    ["2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM"] = "rock",   -- Rock berries
    ["j_CKoyoHKgWjDU-sy6Fp86ykks2tNyQbhDVd0tHX_RE"] = "fire"    -- Fire berries
}

-- Faction to berry type mapping
FACTION_BERRY_TYPES = {
    ["Sky Nomads"] = "air",
    ["Aqua Guardians"] = "water",
    ["Stone Titans"] = "rock",
    ["Inferno Blades"] = "fire"
}

EffectivenessChart = {
  Fire = { Fire = 1.0, Water = 0.5, Air = 2.0, Rock = 1.0 },
  Water = { Fire = 2.0, Water = 1.0, Air = 1.0, Rock = 0.5 },
  Air = { Fire = 0.5, Water = 2.0, Air = 1.0, Rock = 1.0 },
  Rock = { Fire = 1.0, Water = 1.0, Air = 0.5, Rock = 2.0 }
}

-- Enhanced Attack Pools with Rarity and Balanced Trade-offs
FirePool = {
  ["Firenado"] = {type="fire", rarity=1, count=2, damage=5, attack=0, speed=2, defense=-1, health=0},  
  ["Campfire"] = {type="fire", rarity=2, count=3, damage=0, attack=2, speed=-1, defense=3, health=3},  
  ["Inferno"] = {type="fire", rarity=2, count=1, damage=6, attack=3, speed=-1, defense=-2, health=0},  
  ["Flame Shield"] = {type="fire", rarity=3, count=2, damage=2, attack=-1, speed=0, defense=4, health=2},  
  ["Scorching Ash"] = {type="fire", rarity=3, count=2, damage=3, attack=1, speed=1, defense=-2, health=1},  
  ["Phoenix Burst"] = {type="fire", rarity=3, count=1, damage=4, attack=0, speed=2, defense=0, health=-2}  
}

WaterPool = {
  ["Tidal Wave"] = {type="water", rarity=1, count=2, damage=4, attack=2, speed=1, defense=-1, health=0},  
  ["Whirlpool"] = {type="water", rarity=2, count=3, damage=2, attack=0, speed=3, defense=2, health=-2},  
  ["Ice Spear"] = {type="water", rarity=2, count=1, damage=6, attack=2, speed=2, defense=-1, health=0},  
  ["Ocean Mist"] = {type="water", rarity=3, count=2, damage=0, attack=0, speed=2, defense=4, health=2},  
  ["Frostbite"] = {type="water", rarity=3, count=2, damage=3, attack=-1, speed=1, defense=2, health=0},  
  ["Deep Current"] = {type="water", rarity=3, count=1, damage=3, attack=1, speed=3, defense=-1, health=-1}  
}

AirPool = {
  ["Tornado"] = {type="air", rarity=1, count=2, damage=4, attack=1, speed=4, defense=-1, health=0},  
  ["Wind Slash"] = {type="air", rarity=2, count=3, damage=2, attack=2, speed=3, defense=-1, health=0},  
  ["Storm Cloud"] = {type="air", rarity=2, count=1, damage=5, attack=2, speed=2, defense=-1, health=0},  
  ["Breeze"] = {type="air", rarity=3, count=2, damage=0, attack=-1, speed=4, defense=2, health=2},  
  ["Lightning Bolt"] = {type="air", rarity=3, count=2, damage=4, attack=2, speed=-1, defense=0, health=-2},  
  ["Gale Force"] = {type="air", rarity=3, count=1, damage=3, attack=0, speed=5, defense=-2, health=0}  
}

RockPool = {
  ["Boulder Crush"] = {type="rock", rarity=1, count=2, damage=5, attack=3, speed=-2, defense=2, health=0},  
  ["Stone Wall"] = {type="rock", rarity=2, count=3, damage=0, attack=-1, speed=-2, defense=6, health=2},  
  ["Rock Slide"] = {type="rock", rarity=2, count=1, damage=7, attack=2, speed=-1, defense=-2, health=0},  
  ["Earth Shield"] = {type="rock", rarity=3, count=2, damage=2, attack=0, speed=-1, defense=5, health=2},  
  ["Seismic Slam"] = {type="rock", rarity=3, count=2, damage=4, attack=3, speed=0, defense=-1, health=-1},  
  ["Granite Barrier"] = {type="rock", rarity=3, count=1, damage=1, attack=0, speed=-2, defense=6, health=3}  
}

BoostPool = {
  ["Power Up"] = {type="boost", rarity=1, count=2, damage=0, attack=5, speed=2, defense=-2, health=0},  
  ["Iron Skin"] = {type="boost", rarity=2, count=2, damage=0, attack=-1, speed=0, defense=5, health=2},  
  ["Swift Wind"] = {type="boost", rarity=2, count=2, damage=0, attack=2, speed=5, defense=-1, health=-1},  
  ["Battle Cry"] = {type="boost", rarity=3, count=2, damage=0, attack=4, speed=3, defense=-2, health=-1},  
  ["Warrior's Resolve"] = {type="boost", rarity=3, count=2, damage=0, attack=3, speed=2, defense=0, health=-2},  
  ["Adrenaline Surge"] = {type="boost", rarity=3, count=1, damage=0, attack=6, speed=-1, defense=0, health=-3}  
}

HealPool = {
  ["Heal"] = {type="heal", rarity=1, count=2, damage=0, attack=-1, speed=0, defense=0, health=6},  
  ["Regenerate"] = {type="heal", rarity=2, count=3, damage=0, attack=-2, speed=0, defense=2, health=5},  
  ["Life Surge"] = {type="heal", rarity=2, count=1, damage=0, attack=1, speed=0, defense=0, health=8},  
  ["Recovery"] = {type="heal", rarity=3, count=2, damage=0, attack=0, speed=2, defense=0, health=5},  
  ["Vital Essence"] = {type="heal", rarity=3, count=2, damage=0, attack=0, speed=-2, defense=4, health=7},  
  ["Healing Winds"] = {type="heal", rarity=3, count=1, damage=0, attack=1, speed=3, defense=0, health=4}  
}

NormalPool = {
  ["Body Slam"] = {type="normal", rarity=1, count=2, damage=5, attack=3, speed=0, defense=1, health=0},  
  ["Quick Jab"] = {type="normal", rarity=2, count=3, damage=3, attack=2, speed=4, defense=-1, health=0},  
  ["Heavy Strike"] = {type="normal", rarity=2, count=1, damage=6, attack=4, speed=-2, defense=2, health=0},  
  ["Guard Break"] = {type="normal", rarity=3, count=2, damage=4, attack=2, speed=-1, defense=-2, health=1},  
  ["Frenzy Blows"] = {type="normal", rarity=3, count=2, damage=2, attack=3, speed=2, defense=-1, health=-1},  
  ["Momentum Shift"] = {type="normal", rarity=3, count=1, damage=0, attack=0, speed=5, defense=-3, health=3}  
}


-- Random number generation function
function getRandom(min, max)
  return math.random(min, max)
end

-- Function to randomly distribute 10 points across stats
function RandomizeStartingStats()
  local stats = {attack = 1, defense = 1, speed = 1, health = 1}
  local remainingPoints = 6  -- 10 total - 4 base points
  local statNames = {"attack", "defense", "speed", "health"}
  
  while remainingPoints > 0 do
    local stat = statNames[getRandom(1, #statNames)]
    if stats[stat] < 5 then  -- Max 5 points per stat
      stats[stat] = stats[stat] + 1
      remainingPoints = remainingPoints - 1
    end
  end
  
  return stats
end

-- Function to get random moves based on element type
function GetRandomMoves(elementType)
  -- Get the appropriate element pool
  local elementPool
  if elementType == "air" then
    elementPool = AirPool
  elseif elementType == "water" then
    elementPool = WaterPool
  elseif elementType == "rock" then
    elementPool = RockPool
  elseif elementType == "fire" then
    elementPool = FirePool
  end

  -- Get available moves from each pool
  local elementMoves = {}
  local boostMoves = {}
  local healMoves = {}
  local normalMoves = {}

  for name, _ in pairs(elementPool) do
    table.insert(elementMoves, name)
  end
  for name, _ in pairs(BoostPool) do
    table.insert(boostMoves, name)
  end
  for name, _ in pairs(HealPool) do
    table.insert(healMoves, name)
  end
  for name, _ in pairs(NormalPool) do
    table.insert(normalMoves, name)
  end

  -- Always get one element move
  local selectedMoves = {}
  local moveData = {}
  local index = getRandom(1, #elementMoves)
  local elementMove1 = elementMoves[index]
  selectedMoves[elementMove1] = elementPool[elementMove1]
  
  -- 25% chance for second element move
  local remainingPools = {}
  if getRandom(1, 100) <= 25 then
    -- Get second element move
    table.remove(elementMoves, index)
    if #elementMoves > 0 then
      local index2 = getRandom(1, #elementMoves)
      local elementMove2 = elementMoves[index2]
      selectedMoves[elementMove2] = elementPool[elementMove2]
    end
    -- Add two random moves from remaining pools
    table.insert(remainingPools, {moves = boostMoves, pool = BoostPool})
    table.insert(remainingPools, {moves = healMoves, pool = HealPool})
    table.insert(remainingPools, {moves = normalMoves, pool = NormalPool})
    -- Randomly select 2 different pools
    for i = 1, 2 do
      local poolIndex = getRandom(1, #remainingPools)
      local movePool = remainingPools[poolIndex]
      local moveIndex = getRandom(1, #movePool.moves)
      local moveName = movePool.moves[moveIndex]
      selectedMoves[moveName] = movePool.pool[moveName]
      table.remove(remainingPools, poolIndex)
    end
  else
    -- Get one move each from boost, heal, and normal pools
    local boostMove = boostMoves[getRandom(1, #boostMoves)]
    local healMove = healMoves[getRandom(1, #healMoves)]
    local normalMove = normalMoves[getRandom(1, #normalMoves)]
    selectedMoves[boostMove] = BoostPool[boostMove]
    selectedMoves[healMove] = HealPool[healMove]
    selectedMoves[normalMove] = NormalPool[normalMove]
  end

  return selectedMoves
end

monstersMAP = {
  ["Sky Nomads"] = {
      name = "Airbud",
      berry = AIR_BERRY,
      element = "air",
      image = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
      sprite = "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0"
  },
  ["Aqua Guardians"] = {
      name = "WaterDoge",
      berry = WATER_BERRY,
      element = "water",
      image = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
      sprite = "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc"
  },
  ["Stone Titans"] = {
      name ="Rockpup",
      berry = ROCK_BERRY,
      element = "rock",
      image = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
      sprite = "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks"
  },
  ["Inferno Blades"] = {
      name ="FireFox",
      berry = FIRE_BERRY,
      element = "fire",
      image = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
      sprite = "wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ"
  }
}

-- Monster template structure
function CreateDefaultMonster(factionName, timestamp)
  -- Get type-specific pool based on faction
  local typePool
  if factionName == "Sky Nomads" then
    typePool = AirPool
  elseif factionName == "Aqua Guardians" then
    typePool = WaterPool
  elseif factionName == "Stone Titans" then
    typePool = RockPool
  elseif factionName == "Inferno Blades" then
    typePool = FirePool
  end

  -- Get random moves based on element type
  local moves = GetRandomMoves(monstersMAP[factionName].element)

  -- Get random starting stats
  local startingStats = RandomizeStartingStats()

  return {
    name = monstersMAP[factionName].name,
    image = monstersMAP[factionName].image,
    sprite = monstersMAP[factionName].sprite,
    attack = startingStats.attack,
    defense = startingStats.defense,
    speed = startingStats.speed,
    health = startingStats.health,
    energy = 50,
    happiness = 50,  -- Start with 50 happiness
    level = 0,
    exp = 0,
    berryType = monstersMAP[factionName].berry,  -- Store process ID directly
    elementType = monstersMAP[factionName].element,
    totalTimesFed = 0,
    totalTimesPlay = 0,
    totalTimesMission = 0,
    moves = moves,
    status = {
      type = "Home",
      since = timestamp,
      until_time = timestamp  -- using until_time since 'until' is a Lua keyword
    },
    -- Configuration for activities
    activities = {
      mission = {
        cost = {
          token = "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ",
          amount = 1
        },
        duration = 3600 * 1000,  -- 1 hour in milliseconds
        energyCost = 25,
        happinessCost = 25
      },
      battle = {
        cost = {
          token = "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ",
          amount = 1
        },
        energyCost = 25,
        happinessCost = 25
      },
      play = {
        cost = {
          token = monstersMAP[factionName].berry,  -- Use faction's berry type
          amount = 1
        },
        duration = 900 * 1000,  -- 15 minutes in milliseconds
        energyCost = 10,
        happinessGain = 25
      },
      feed = {
        cost = {
          token = monstersMAP[factionName].berry,  -- Use faction's berry type
          amount = 1
        },
        energyGain = 10
      }
    }
  }
end


function ensureAdmin(msg)
  if not IsAdmin(msg.From) then
    ao.send({
      Target = msg.From,
      Data = json.encode({ type = "error", error = "Unauthorized access" })
    })
    return false
  end
  return true
end

function IsAdmin(userId)
  return userId == ADMIN_WALLET or userId == TARGET_BATTLE_PID or userId == "9U_MDLfzf-sdww7d7ydaApDiQz3nyHJ4kTS2-9K4AGA"
end