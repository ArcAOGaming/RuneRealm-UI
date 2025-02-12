Initialized = Initialized or nil

TARGET_WORLD_PID = "lA4WPP5v9iUowzLJtCjZsSH_m6WV2FUbGlPSlG7KbnM"
TARGET_PREMPASS_PID = "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI"
TARGET_BATTLE_PID = "8hnue8PYCrgOB4OKHB6HS-ujbPOVuikOaTyICQjQJYQ"
BaseSprite = '2wRFNJg9XlCcG6jKNpDAMxX1vnHZoub998KkR0qfDjE'
BaseSpriteAtlas = 'sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g'
BaseSpriteScale = 1.75
BaseSpriteHitbox = {width=38,height=48,offsetX=1,offsetY=22}

-- Available tokens for purchase
PurchaseTokens = {
  {
    token = 'wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ',  -- TRUNK token
    amount = "2500",
    name = "TRUNK",
    icon="hqg-Em9DdYHYmMysyVi8LuTGF8IF_F7ZacgjYiSpj0k",
    denomination = 3  
},
  {
    token = 'xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10',
    amount = "1984000000000",
    name = "wAR",
    icon="L99jaxRKQKJt9CqoJtPaieGPEhJD3wNhR4iGqc8amXs",
    denomination = 12 
  },
  {
    token = 'OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU',
    amount = "15000000000",
    name = "NAB" ,
    icon="LQ4crOHN9qO6JsLNs253AaTch6MgAMbM8PKqBxs4hgI",
    denomination = 8 
  }
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

-- Attack pools for different types
FirePool = {
  ["Firenado"] = {type="fire", count=2, damage=3, attack=0, speed=1, defense=0, health=0},
  ["Campfire"] = {type="fire", count=3, damage=0, attack=1, speed=0, defense=2, health=2},
  ["Inferno"] = {type="fire", count=1, damage=4, attack=2, speed=0, defense=0, health=0},
  ["Flame Shield"] = {type="fire", count=2, damage=1, attack=0, speed=0, defense=3, health=1}
}

WaterPool = {
  ["Tidal Wave"] = {type="water", count=2, damage=2, attack=1, speed=1, defense=1, health=0},
  ["Whirlpool"] = {type="water", count=3, damage=1, attack=0, speed=2, defense=2, health=0},
  ["Ice Spear"] = {type="water", count=1, damage=4, attack=1, speed=1, defense=0, health=0},
  ["Ocean Mist"] = {type="water", count=2, damage=0, attack=0, speed=1, defense=3, health=1}
}

AirPool = {
  ["Tornado"] = {type="air", count=2, damage=2, attack=0, speed=3, defense=0, health=0},
  ["Wind Slash"] = {type="air", count=3, damage=1, attack=1, speed=2, defense=0, health=0},
  ["Storm Cloud"] = {type="air", count=1, damage=3, attack=1, speed=1, defense=0, health=0},
  ["Breeze"] = {type="air", count=2, damage=0, attack=0, speed=3, defense=1, health=1}
}

RockPool = {
  ["Boulder Crush"] = {type="rock", count=2, damage=3, attack=1, speed=0, defense=1, health=0},
  ["Stone Wall"] = {type="rock", count=3, damage=0, attack=0, speed=0, defense=4, health=1},
  ["Rock Slide"] = {type="rock", count=1, damage=4, attack=1, speed=0, defense=0, health=0},
  ["Earth Shield"] = {type="rock", count=2, damage=1, attack=0, speed=0, defense=3, health=1}
}

BoostPool = {
  ["Power Up"] = {type="boost", count=2, damage=0, attack=3, speed=1, defense=0, health=0},
  ["Iron Skin"] = {type="boost", count=2, damage=0, attack=0, speed=0, defense=3, health=1},
  ["Swift Wind"] = {type="boost", count=2, damage=0, attack=1, speed=3, defense=0, health=0},
  ["Battle Cry"] = {type="boost", count=2, damage=0, attack=2, speed=2, defense=0, health=0}
}

HealPool = {
  ["Heal"] = {type="heal", count=2, damage=0, attack=0, speed=0, defense=0, health=3},
  ["Regenerate"] = {type="heal", count=3, damage=0, attack=0, speed=0, defense=1, health=2},
  ["Life Surge"] = {type="heal", count=1, damage=0, attack=1, speed=0, defense=0, health=4},
  ["Recovery"] = {type="heal", count=2, damage=0, attack=0, speed=1, defense=0, health=3}
}

-- Function to randomly distribute 10 points across stats
function RandomizeStartingStats()
  local stats = {attack = 1, defense = 1, speed = 1, health = 1}
  local remainingPoints = 6  -- 10 total - 4 base points
  local statNames = {"attack", "defense", "speed", "health"}
  
  while remainingPoints > 0 do
    local stat = statNames[math.random(1, #statNames)]
    if stats[stat] < 5 then  -- Max 5 points per stat
      stats[stat] = stats[stat] + 1
      remainingPoints = remainingPoints - 1
    end
  end
  
  return stats
end

-- Function to get random moves from a pool
function GetRandomMove(pool)
  local moves = {}
  for name, _ in pairs(pool) do
    table.insert(moves, name)
  end
  local index = math.random(1, #moves)
  return moves[index]
end

monstersMAP = {
  ["Sky Nomads"] = {
      berry = "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",
      element = "air",
      image = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
      sprite = "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0"
  },
  ["Aqua Guardians"] = {
      berry = "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",
      element = "water",
      image = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
      sprite = "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc"
  },
  ["Stone Titans"] = {
      berry = "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",
      element = "rock",
      image = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
      sprite = "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks"
  },
  ["Inferno Blades"] = {
      berry = "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0",
      element = "fire",
      image = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
      sprite = "wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ"
  }
}

-- Monster template structure
function CreateDefaultMonster(factionName, mascotTxId, timestamp)
  -- Map faction names to berry process IDs
  -- local berryMap = {
  --   ["Sky Nomads"] = "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",
  --   ["Aqua Guardians"] = "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",
  --   ["Stone Titans"] = "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",
  --   ["Inferno Blades"] = "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0"
  -- }

  -- local elementTypeMap = {
  --   ["Sky Nomads"] = "air",
  --   ["Aqua Guardians"] = "water",
  --   ["Stone Titans"] = "rock",
  --   ["Inferno Blades"] = "fire"
  -- }

  -- local imageMap = {
  --   ["Sky Nomads"] = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
  --   ["Aqua Guardians"] = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
  --   ["Stone Titans"] = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
  --   ["Inferno Blades"] = "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o"
  -- }

  -- local spriteMap = {
  --   ["Sky Nomads"] = "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0",
  --   ["Aqua Guardians"] = "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc",
  --   ["Stone Titans"] = "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks",
  --   ["Inferno Blades"] = "wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ"
  -- }

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

  -- Get 2 random moves from type pool
  local move1 = GetRandomMove(typePool)
  local move2 = GetRandomMove(typePool)
  while move2 == move1 do
    move2 = GetRandomMove(typePool)
  end

  -- Get 1 move from boost pool and 1 from heal pool
  local boostMove = GetRandomMove(BoostPool)
  local healMove = GetRandomMove(HealPool)

  -- Get random starting stats
  local startingStats = RandomizeStartingStats()

  return {
    name = factionName .. " Monster",
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
    moves = {
      [move1] = typePool[move1],
      [move2] = typePool[move2],
      [boostMove] = BoostPool[boostMove],
      [healMove] = HealPool[healMove]
    },
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
