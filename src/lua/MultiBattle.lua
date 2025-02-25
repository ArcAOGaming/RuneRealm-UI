

-- module: "globals"
local function _loaded_mod_globals()
  Initialized = Initialized or nil
  
  TARGET_WORLD_PID = "lA4WPP5v9iUowzLJtCjZsSH_m6WV2FUbGlPSlG7KbnM"
  TARGET_PREMPASS_PID = "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI"
  TARGET_BATTLE_PID = "W111mH0QHpqVMQ6z3ayHEQWC94xqETy2G8qceQUaFRQ"
  --TARGET_BATTLE_PID = "3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs"
  BaseSprite = '2wRFNJg9XlCcG6jKNpDAMxX1vnHZoub998KkR0qfDjE'
  BaseSpriteAtlas = 'sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g'
  BaseSpriteScale = 1.75
  BaseSpriteHitbox = {width=38,height=48,offsetX=1,offsetY=22}
  
  -- Available tokens for purchase
  PurchaseTokens = {
    {
      token = 'wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ',  -- TRUNK token
      amount = "3000",
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
      amount = "50000000000",
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
        berry = "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",
        element = "air",
        image = "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
        sprite = "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0"
    },
    ["Aqua Guardians"] = {
        name = "WaterDoge",
        berry = "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",
        element = "water",
        image = "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
        sprite = "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc"
    },
    ["Stone Titans"] = {
        name ="Rockpup",
        berry = "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",
        element = "rock",
        image = "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
        sprite = "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks"
    },
    ["Inferno Blades"] = {
        name ="FireFox",
        berry = "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0",
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
  end
  
  _G.package.loaded["globals"] = _loaded_mod_globals()
  
  -- module: "attacklogic"
  local function _loaded_mod_attacklogic()
  
  -- Calculate type effectiveness multiplier using EffectivenessChart
  function getTypeEffectiveness(moveType, defenderType)
      if not moveType or not defenderType then return 1 end
      
      local effectivenessRow = EffectivenessChart[moveType]
      if not effectivenessRow then return 1 end
      
      return effectivenessRow[defenderType] or 1
  end
  
  -- Determine if attack hits based on speed difference
  function calculateHitChance(attackerSpeed, defenderSpeed)
      -- Ensure speeds are non-negative
      attackerSpeed = math.max(0, attackerSpeed)
      defenderSpeed = math.max(0, defenderSpeed)
      
      local speedDiff = attackerSpeed - defenderSpeed
      local baseHitChance = 0.7 -- 70% base hit chance
      
      -- Enhanced hit chance calculation based on speed difference
      local hitChanceModifier = 0
      if speedDiff > 0 then
          -- Attacker is faster: bonus increases more significantly
          hitChanceModifier = math.min(0.25, speedDiff * 0.08) -- Up to +25% bonus, 8% per speed point
      else
          -- Attacker is slower: penalty increases more severely
          hitChanceModifier = math.max(-0.4, speedDiff * 0.1) -- Up to -40% penalty, 10% per speed point
      end
      
      local finalHitChance = baseHitChance + hitChanceModifier
      
      -- Clamp hit chance between 0.3 (30%) and 0.95 (95%)
      return math.max(0.3, math.min(0.95, finalHitChance))
  end
  
  -- Determine if attack hits
  function doesAttackHit(attackerSpeed, defenderSpeed)
      local hitChance = calculateHitChance(attackerSpeed, defenderSpeed)
      return getRandom(1, 100) <= hitChance * 100
  end
  
  -- Determine turn order based on speed
  function determineTurnOrder(attacker, defender)
      local attackerRoll = attacker.speed + getRandom(1, 5)
      local defenderRoll = defender.speed + getRandom(1, 5)
      
      if attackerRoll == defenderRoll then
          -- On tie, randomly decide
          return getRandom(1, 2) == 1
      end
      return attackerRoll > defenderRoll
  end
  
  -- Calculate damage including random bonus
  function calculateDamage(move, attacker, defender)
      print("Calculating damage for move:", json.encode(move))
      print("Attacker:", json.encode(attacker))
      print("Defender:", json.encode(defender))
  
      if not move then
          print("Error: move is nil")
          return 0, 1
      end
      if not move.damage then
          print("Error: move.damage is nil")
          return 0, 1
      end
      if not attacker then
          print("Error: attacker is nil")
          return 0, 1
      end
      if not attacker.attack then
          print("Error: attacker.attack is nil")
          attacker.attack = 1
      end
      
      -- Handle negative damage (self-damage)
      if move.damage < 0 then
          print("Self-damage move")
          return math.abs(move.damage), 1
      elseif move.damage == 0 then
          print("Move damage is 0")
          return 0, 1
      end
      
      -- Base damage from move (positive damage targets enemy)
      local damage = (move.damage * 5)
      print("Base damage:", damage)
      
      -- Add random bonus based on attacker's base attack only for enemy-targeting moves
      local bonus = getRandom(0, attacker.attack)
      damage = damage + bonus
      print("Damage after attack bonus:", damage)
      
      -- Apply type effectiveness only for enemy-targeting moves
      local effectiveness = getTypeEffectiveness(move.type, defender.elementType)
      damage = damage * effectiveness
      print("Final damage after type effectiveness:", damage)
      print("Type effectiveness:", effectiveness)
      
      return math.floor(damage), effectiveness
  end
  
  -- Apply damage considering shields
  function applyDamage(target, damage, isSelfDamage)
      local shieldDamage = 0
      local healthDamage = 0
      
      -- For self-damage, bypass shield and directly affect health
      if isSelfDamage then
          healthDamage = damage
          target.healthPoints = math.max(0, target.healthPoints - healthDamage)
          return 0, healthDamage
      end
      
      -- For enemy damage, shield takes damage first
      if target.shield > 0 then
          shieldDamage = math.min(damage, target.shield)
          target.shield = target.shield - shieldDamage
          damage = damage - shieldDamage
      end
      
      -- Remaining damage goes to health
      if damage > 0 then
          healthDamage = damage
          target.healthPoints = math.max(0, target.healthPoints - healthDamage)
      end
      
      return shieldDamage, healthDamage
  end
  
  -- Apply stat changes
  function applyStatChanges(target, move)
      local changes = {}
      
      -- Attack modification
      if move.attack ~= 0 then
          target.attack = math.max(0, target.attack + move.attack)
          changes.attack = move.attack
      end
      
      -- Speed modification
      if move.speed ~= 0 then
          target.speed = math.max(0, target.speed + move.speed)
          changes.speed = move.speed
      end
      
      -- Defense/shield modification
      if move.defense ~= 0 then
          -- Update max shield and current shield
          target.defense = math.max(0, target.defense + move.defense)
          if move.defense > 0 then
              -- For positive defense changes, increase shield by that amount
              target.shield = target.shield + move.defense
          else
              -- For negative defense changes, reduce shield but never below 0
              target.shield = math.max(0, target.shield + move.defense)
          end
          changes.defense = move.defense
      end
      
      -- Health modification
      if move.health ~= 0 then
          local maxHealth = target.health * 10 -- Max health is 10x base health
          if move.health > 0 then
              -- Healing can't exceed max health
              target.healthPoints = math.min(maxHealth, target.healthPoints + (move.health * 10))
          else
              -- Damage can't reduce below 1
              target.healthPoints = math.max(1, target.healthPoints + (move.health *10))
          end
          changes.health = move.health
      end
      
      return changes
  end
  end
  
  _G.package.loaded["attacklogic"] = _loaded_mod_attacklogic()
  
  -- Battle Manager
  -- 8hnue8PYCrgOB4OKHB6HS-ujbPOVuikOaTyICQjQJYQ
  json = require("json")
  -- require("globals")
  -- require("attacklogic")
  
  
  -- Attack Logic
  -- Type effectiveness table
  local typeEffectiveness = {
      fire = { weak = "water", strong = "air" },
      water = { weak = "earth", strong = "fire" },
      earth = { weak = "air", strong = "water" },
      air = { weak = "fire", strong = "earth" }
  }
  local EffectivenessChart = {
      fire = { fire = 1.0, water = 0.5, air = 2.0, rock = 1.0 },
      water = { fire = 2.0, water = 1.0, air = 1.0, rock = 0.5 },
      air = { fire = 0.5, water = 2.0, air = 1.0, rock = 1.0 },
      rock = { fire = 1.0, water = 1.0, air = 0.5, rock = 2.0 }
    }
  
  -- Battle session data
  battles = battles or {}
  activeBattles = activeBattles or {}
  UserMonsters = UserMonsters or {}
  battleLogs = battleLogs or {} -- Store battle logs persistently
  battleIdCounter = battleIdCounter or 0 -- Global counter for generating unique battle IDs
  pendingBattles = pendingBattles or {} -- Store battles waiting for acceptance
  openChallenges = openChallenges or {} -- Store open challenges that anyone can accept
  
  -- Helper function to get all available battles for a user
  local function getAvailableBattles(userId)
    local availableBattles = {}
    
    -- Check pending battles
    for battleId, battle in pairs(pendingBattles) do
      if battle.challengeType == "OPEN" and battle.challenger.address ~= userId then
        battle.id = battleId
        table.insert(availableBattles, battle)
      elseif battle.targetAccepter == userId then
        battle.id = battleId
        table.insert(availableBattles, battle)
      end
    end
    
    return availableBattles
  end
  
  -- Helper function to validate battle acceptance
  local function validateBattleAcceptance(userId, challengerId)
    local battle = nil
    local battleId = nil
    
    -- Search for pending battle with matching challenger
    for id, pendingBattle in pairs(pendingBattles) do
      if pendingBattle.challenger.address == challengerId then
        if pendingBattle.challengeType == "OPEN" or pendingBattle.targetAccepter == userId then
          battle = pendingBattle
          battleId = id
          break
        end
      end
    end
    
    return battle, battleId
  end
  
  
  -- Create struggle move for when all moves are depleted
  local function createStruggleMove(monster)
      return {
          name = "Struggle",
          type = monster.elementType or "normal", -- Fallback to normal type if none exists
          count = 999,
          damage = 1,
      }
  end
  
  local function processAttack(attacker, defender, move)
    -- Ensure moves have a count field
    if move.count then
        move.count = math.max(0, move.count - 1) -- Ensure it doesn't go below 0
    end
    
    -- Check if attack hits (only for enemy-targeting moves)
    local hits = move.damage > 0 and doesAttackHit(attacker.speed, defender.speed) or true
    if not hits then
        return {
            missed = true,
            attacker = attacker.name,
            move = move.name,
            attackerState = json.decode(json.encode(attacker)), -- Deep copy state
            defenderState = json.decode(json.encode(defender))  -- Deep copy state
        }
    end
    
    -- Calculate damage
    local damage, effectiveness = calculateDamage(move, attacker, defender)
    
    -- Apply damage based on whether it's self-damage or enemy damage
    local shieldDamage, healthDamage
    if move.damage < 0 then
        shieldDamage, healthDamage = applyDamage(attacker, damage, true)
    else
        shieldDamage, healthDamage = applyDamage(defender, damage, false)
    end
    
    -- Apply stat changes to attacker
    local statChanges = applyStatChanges(attacker, move)
    
    -- Return detailed battle log including monster states
    return {
        missed = false,
        attacker = attacker.name,
        move = move.name,
        moveRarity = move.rarity,
        shieldDamage = shieldDamage,
        healthDamage = healthDamage,
        changes = statChanges,
        superEffective = effectiveness > 1,
        notEffective = effectiveness < 1,
        attackerState = json.decode(json.encode(attacker)), -- Deep copy state
        defenderState = json.decode(json.encode(defender))  -- Deep copy state
    }
  end
  
  
  
  -- Process a full turn (both monsters attack)
  local function processTurn(attacker, defender, attackerMove, defenderMove)
      local actions = {}
      local attackerFirst = determineTurnOrder(attacker, defender)
      
      if attackerFirst then
          -- Attacker goes first
          table.insert(actions, processAttack(attacker, defender, attackerMove))
          if defender.healthPoints > 0 then
              table.insert(actions, processAttack(defender, attacker, defenderMove))
          end
      else
          -- Defender goes first
          table.insert(actions, processAttack(defender, attacker, defenderMove))
          if attacker.healthPoints > 0 then
              table.insert(actions, processAttack(attacker, defender, attackerMove))
          end
      end
      
      return {
          actions = actions
      }
  end
  
  
  -- Initialize a battle session
  local function initBattleSession(userId)
    battles[userId] = {
      battlesRemaining = 4,
      wins = 0,
      losses = 0,
      startTime = os.time() * 1000 -- Convert to milliseconds
    }
  end
  
  -- Get battle session data
  local function getBattleSession(userId)
    return battles[userId]
  end
  
  -- Refresh monster move counts from stored data
  local function refreshMonsterCounts(userId)
    local storedMonster = UserMonsters[userId]
    if not storedMonster or not storedMonster.moves then
      return nil
    end
    
    -- Create a deep copy of the moves with their original counts
    local refreshedMoves = {}
    for name, move in pairs(storedMonster.moves) do
      refreshedMoves[name] = {
        name = move.name,
        count = move.count,
        damage = move.damage,
        attack = move.attack,
        speed = move.speed,
        defense = move.defense,
        health = move.health
      }
    end
    
    return refreshedMoves
  end
  
  local function createOpponent()
    local factionIndex = getRandom(1, #AvailableFactions)
    local faction = AvailableFactions[factionIndex]
    
    -- Create a level 1 monster
    local opponent = CreateDefaultMonster(faction.name, os.time() * 1000)
    opponent.level = 1
    
    -- Create a deep copy of the moves to ensure they have count values
    local freshMoves = {}
    for name, move in pairs(opponent.moves) do
        freshMoves[name] = {
            name = move.name,
            count = move.count or 1,  -- Ensure moves have at least 1 use
            damage = move.damage or 0,
            attack = move.attack or 0,
            speed = move.speed or 0,
            defense = move.defense or 0,
            health = move.health or 0,
            type = move.type or opponent.elementType  -- Ensure move type is set
        }
    end
    opponent.moves = freshMoves
    
    print("Created opponent with moves:", json.encode(opponent.moves))
    return opponent
  end
  
  
  
  -- Record battle result
  local function recordBattle(wallet, won)
    local session = battles[wallet]
    if session then
      if won then
        session.wins = session.wins + 1
      else
        session.losses = session.losses + 1
      end
      session.battlesRemaining = session.battlesRemaining - 1
      
      return session
    end
    return nil
  end
  
  -- Process battle turn using the new attack logic
  local function processBattleTurn(battleId, userId, moveName)
    local battle = activeBattles[battleId]
    if not battle then return nil end
    
    -- Initialize turns array if not exists
    battle.turns = battle.turns or {}
    battle.currentTurn = battle.currentTurn or {
      challenger = nil,
      accepter = nil
    }
    
    -- Initialize struggle tracking if not exists
    battle.hasUsedStruggle = battle.hasUsedStruggle or { challenger = false, accepter = false }
    
    -- Determine if user is challenger or accepter
    local isChallenger = userId == battle.challenger.address
    local isAccepter = userId == battle.accepter.address
    
    if not isChallenger and not isAccepter then
      return {
        error = "User is not part of this battle"
      }
    end
    
    -- Get the player's monster and moves
    local player = isChallenger and battle.challenger or battle.accepter
    local opponent = isChallenger and battle.accepter or battle.challenger
    
    -- Check if all moves are depleted
    local allMovesUsed = true
    for _, move in pairs(player.moves) do
      if (move.count or 0) > 0 then
        allMovesUsed = false
        break
      end
    end
    
    -- Handle struggle move or validate regular move
    local selectedMove
    if moveName == "struggle" then
      if not allMovesUsed then
        return {
          error = "Cannot use struggle when other moves are available"
        }
      end
      selectedMove = createStruggleMove(player)
    else
      if not player.moves[moveName] then
        return {
          error = "Invalid move"
        }
      end
      selectedMove = player.moves[moveName]
      if (selectedMove.count or 0) <= 0 then
        return {
          error = "Move has no uses remaining"
        }
      end
    end
    
    -- Store the move in currentTurn
    if isChallenger then
      battle.currentTurn.challenger = selectedMove
    else
      battle.currentTurn.accepter = selectedMove
    end
    
    -- If bot battle, generate bot move
    if opponent.address == "Bot" then
      local availableMoves = {}
      for name, move in pairs(opponent.moves) do
        if move and type(move) == "table" and (move.count or 0) > 0 then
          move.name = name
          table.insert(availableMoves, move)
        end
      end
      
      local botMove
      if #availableMoves == 0 then
        botMove = createStruggleMove(opponent)
      else
        local selectedIndex = getRandom(#availableMoves)
        botMove = availableMoves[selectedIndex]
        if not botMove then
          botMove = createStruggleMove(opponent)
        end
      end
      
      if isChallenger then
        battle.currentTurn.accepter = botMove
      else
        battle.currentTurn.challenger = botMove
      end
    end
    
    -- If both moves are set, process the turn
    if battle.currentTurn.challenger and battle.currentTurn.accepter then
      -- Track struggle usage
      if battle.currentTurn.challenger.name == "Struggle" then
        battle.hasUsedStruggle.challenger = true
      end
      if battle.currentTurn.accepter.name == "Struggle" then
        battle.hasUsedStruggle.accepter = true
      end
      
      -- Process the full turn using attack logic
      print("Processing turn with moves:", json.encode(battle.currentTurn))
      print("Monsters:", json.encode({challenger = battle.challenger, accepter = battle.accepter}))
      local turnResult = processTurn(battle.challenger, battle.accepter, battle.currentTurn.challenger, battle.currentTurn.accepter)
    
      -- Convert turn result to battle turns format with enhanced state tracking
      for _, action in ipairs(turnResult.actions) do
        local isChallenger = action.attacker == battle.challenger.name
        local turnInfo = {
          attacker = isChallenger and "challenger" or "accepter",
          move = action.move,
          moveName = action.moveName,
          moveRarity = action.moveRarity,
          missed = action.missed,
          shieldDamage = action.shieldDamage,
          healthDamage = action.healthDamage,
          statsChanged = action.changes,
          superEffective = action.superEffective,
          notEffective = action.notEffective,
          attackerState = action.attackerState,
          defenderState = action.defenderState
        }
        table.insert(battle.turns, turnInfo)
      end
      
      -- Update battle logs
      battleLogs[battleId] = battle.turns
      
      -- Check battle outcome
      local challengerWon = battle.accepter.healthPoints <= 0
      local accepterWon = battle.challenger.healthPoints <= 0
      
      if challengerWon or accepterWon then
        -- Record battle result for both players if not a bot battle
        if battle.accepter.address ~= "Bot" then
          recordBattle(battle.challenger.address, challengerWon)
          recordBattle(battle.accepter.address, accepterWon)
        else
          -- Only record for challenger in bot battles
          recordBattle(battle.challenger.address, challengerWon)
        end
        
        battle.status = "ended"
        return {
          battleOver = true,
          challengerWon = challengerWon,
          accepterWon = accepterWon
        }
      end
  
      -- Regenerate shields at end of turn based on current defense stat
      if not battle.hasUsedStruggle.challenger then
        local shieldRegen = math.ceil(battle.challenger.defense / 4)
        battle.challenger.shield = math.min(battle.challenger.defense, battle.challenger.shield + shieldRegen)
        print("Regenerated challenger shield by", shieldRegen, "to:", battle.challenger.shield)
      end
      if not battle.hasUsedStruggle.accepter then
        local shieldRegen = math.ceil(battle.accepter.defense / 4)
        battle.accepter.shield = math.min(battle.accepter.defense, battle.accepter.shield + shieldRegen)
        print("Regenerated accepter shield by", shieldRegen, "to:", battle.accepter.shield)
      end
      
      -- Reset current turn
      battle.currentTurn = {
        challenger = nil,
        accepter = nil
      }
      
      return {
        battleOver = false,
        waitingForMove = true,
        challengerMoved = battle.currentTurn.challenger ~= nil,
        accepterMoved = battle.currentTurn.accepter ~= nil
      }
    end
    
    -- Return early if still waiting for other player's move
    return {
      waitingForMove = true,
      challengerMoved = battle.currentTurn.challenger ~= nil,
      accepterMoved = battle.currentTurn.accepter ~= nil
    }
  end
  
  -- Handlers
  Handlers.add(
    "BeginBattles",
    Handlers.utils.hasMatchingTag("Action", "BeginBattles"),
    function(msg)
      local userId = msg.Tags.UserId
      local monsterData = json.decode(msg.Data)
      if not monsterData then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Invalid monster data"
          })
        })
        return
      end
      
      -- Store user's monster
      UserMonsters[userId] = monsterData
      
      -- Initialize battle session
      initBattleSession(userId)
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Battle session started",
          data = battles[userId]
        })
      })
    end
  )
  
  Handlers.add(
    "GetBattleManagerInfo",
    Handlers.utils.hasMatchingTag("Action", "GetBattleManagerInfo"),
    function(msg)
      local userId = msg.Tags.UserId
      local session = getBattleSession(userId)
      if not session then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "not_found",
            message = "No active battle session"
          })
        })
        return
      end
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Battle status retrieved",
          data = session
        })
      })
    end
  )
  
  Handlers.add(
    "GetOpenBattle",
    Handlers.utils.hasMatchingTag("Action", "GetOpenBattle"),
    function(msg)
      local userId = msg.Tags.UserId
      local battles = {}
      
      -- Get user's active battles
      for battleId, battle in pairs(activeBattles) do
        if battle.challenger.address == userId or battle.accepter.address == userId then
          -- Restore battle logs if they exist
          if battleLogs[battleId] then
            battle.turns = battleLogs[battleId]
          end
          battle.id = battleId
          table.insert(battles, battle)
        end
      end
      
      -- Get user's pending battles (as challenger or targeted accepter)
      for battleId, battle in pairs(pendingBattles) do
        if battle.challenger.address == userId or 
           (battle.targetAccepter and battle.targetAccepter == userId) then
          battle.id = battleId
          table.insert(battles, battle)
        end
      end
      
      -- Get available open challenges (exclude user's own challenges)
      for battleId, battle in pairs(pendingBattles) do
        if battle.challengeType == "OPEN" and battle.challenger.address ~= userId then
          battle.id = battleId
          table.insert(battles, battle)
        end
      end
      
      if #battles == 0 then
        ao.send({
          Target = userId,
          Data = json.encode({
            status = "not_found",
            message = "No battles found"
          })
        })
        return
      end
      
      ao.send({
        Target = userId,
        Data = json.encode({
          status = "success",
          message = "Battles found",
          data = battles
        })
      })
    end
  )

  Handlers.add(
    "GetUserOpenBattles",
    Handlers.utils.hasMatchingTag("Action", "GetOpenBattle"),
    function(msg)
      local userId = msg.Tags.UserId
      local battles = {}
      
      -- Get user's active battles
      for battleId, battle in pairs(activeBattles) do
        if battle.challenger.address == userId or battle.accepter.address == userId then
          -- Restore battle logs if they exist
          if battleLogs[battleId] then
            battle.turns = battleLogs[battleId]
          end
          battle.id = battleId
          table.insert(battles, battle)
        end
      end
      
      -- Get user's pending battles (as challenger or targeted accepter)
      for battleId, battle in pairs(pendingBattles) do
        if battle.challenger.address == userId or 
           (battle.targetAccepter and battle.targetAccepter == userId) then
          battle.id = battleId
          table.insert(battles, battle)
        end
      end
      
      -- -- Get available open challenges (exclude user's own challenges)
      -- for battleId, battle in pairs(pendingBattles) do
      --   if battle.challengeType == "OPEN" and battle.challenger.address ~= userId then
      --     battle.id = battleId
      --     table.insert(battles, battle)
      --   end
      -- end
      
      if #battles == 0 then
        ao.send({
          Target = userId,
          Data = json.encode({
            status = "not_found",
            message = "No battles found"
          })
        })
        return
      end
      
      ao.send({
        Target = userId,
        Data = json.encode({
          status = "success",
          message = "Battles found",
          data = battles
        })
      })
    end
  )
  
  Handlers.add(
    "Battle",
    Handlers.utils.hasMatchingTag("Action", "Battle"),
    function(msg)
      local userId = msg.From
      local challengeId = msg.Tags.challenge
      local acceptId = msg.Tags.accept
      
      -- Get player's monster
      local playerMonster = UserMonsters[userId]
      if not playerMonster then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "No monster found"
          })
        })
        return
      end
      
      -- Handle battle acceptance
      if acceptId then
        local pendingBattle, battleId = validateBattleAcceptance(userId, acceptId)
        
        if not pendingBattle then
          ao.send({
            Target = msg.From,
            Data = json.encode({
              status = "error",
              message = "No pending battle found for this challenger"
            })
          })
          return
        end
        
        -- Move battle from pending to active
        pendingBattle.accepter = json.decode(json.encode(playerMonster)) -- Deep copy
        pendingBattle.accepter.address = userId
        pendingBattle.accepter.healthPoints = pendingBattle.accepter.health * 10
        pendingBattle.accepter.shield = math.max(0, pendingBattle.accepter.defense)
        pendingBattle.status = "battling"
        
        activeBattles[battleId] = pendingBattle
        pendingBattles[battleId] = nil
        battleLogs[battleId] = {} -- Initialize empty battle logs
        
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "success",
            message = "Battle accepted",
            data = pendingBattle
          })
        })
        return
      end
      
      -- Handle new battle creation
      battleIdCounter = battleIdCounter + 1
      local battleId = tostring(battleIdCounter)
      
      -- Initialize battle object
      local battle = {
        id = battleId,
        challenger = json.decode(json.encode(playerMonster)), -- Deep copy
        startTime = os.time() * 1000,
        turns = {},
        status = "pending"
      }
      
      -- Set challenger info
      battle.challenger.address = userId
      battle.challenger.healthPoints = battle.challenger.health * 10
      battle.challenger.shield = math.max(0, battle.challenger.defense)
      
      -- Handle bot battle (no challenge/accept tags)
      if not challengeId then
        -- Create bot opponent
        local opponent = createOpponent()
        battle.accepter = opponent
        battle.accepter.address = "Bot"
        battle.accepter.healthPoints = opponent.health * 10
        battle.accepter.shield = math.max(0, opponent.defense)
        battle.status = "battling"
        
        activeBattles[battleId] = battle
        battleLogs[battleId] = {} -- Initialize empty battle logs
        
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "success",
            message = "Bot battle started",
            data = battle
          })
        })
        return
      end
      
      -- Handle player challenge
      battle.challengeType = challengeId == "OPEN" and "OPEN" or "TARGETED"
      battle.targetAccepter = challengeId ~= "OPEN" and challengeId or nil
      battle.status = "pending"
      
      -- Store in appropriate collection
      if battle.challengeType == "OPEN" then
        openChallenges[battleId] = battle
      end
      pendingBattles[battleId] = battle
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = challengeId == "OPEN" and "Open challenge created" or "Challenge sent",
          data = battle
        })
      })
      
    end
  )
  
  Handlers.add(
    "Attack",
    Handlers.utils.hasMatchingTag("Action", "Attack"),
    function(msg)
      print("Attack handler called")
      print("Full message:", json.encode(msg))
      
      -- Validate required fields
      if not msg.From then
        print("Error: msg.From is nil")
        ao.send({
          Target = msg.From or "unknown",
          Data = json.encode({
            status = "error",
            message = "Missing user ID"
          })
        })
        return
      end
      
      if not msg.Tags or not msg.Tags.BattleId then
        print("Error: msg.Tags.BattleId is nil")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Missing battle ID"
          })
        })
        return
      end
      
      if not msg.Tags.Move then
        print("Error: msg.Tags.Move is nil")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Missing move name"
          })
        })
        return
      end
      
      local userId = msg.From
      local battleId = msg.Tags.BattleId
      local moveName = msg.Tags.Move
      print("User ID:", userId)
      print("Battle ID:", battleId)
      print("Move Name:", moveName)
      print("Full Tags:", json.encode(msg.Tags))
      
      if not userId or not battleId or not moveName then
          print("Error: Missing required fields")
          print("From:", msg.From)
          print("Tags:", json.encode(msg.Tags))
          ao.send({
              Target = msg.From,
              Data = json.encode({
                  status = "error",
                  message = "Missing required fields for attack"
              })
          })
          return
      end
      
      local battle = activeBattles[battleId]
      if not battle then
        print("Battle not found")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Battle not found"
          })
        })
        return
      end
      
      print("Battle found:", json.encode(battle))
      
      -- Validate battle has required fields
      if not battle.challenger then
        print("Error: battle.challenger is nil")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Invalid battle state: missing challenger"
          })
        })
        return
      end
      
      if not battle.accepter then
        print("Error: battle.accepter is nil")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Invalid battle state: missing accepter"
          })
        })
        return
      end
      
      -- Determine if user is challenger or accepter
      local isChallenger = userId == battle.challenger.address
      local isAccepter = userId == battle.accepter.address
      
      if not isChallenger and not isAccepter then
        print("Error: User is not part of this battle")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "User is not part of this battle"
          })
        })
        return
      end
      
      -- Get the player's monster and moves
      local player = isChallenger and battle.challenger or battle.accepter
      
      if not player.moves then
        print("Error: Player has no moves")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Invalid battle state: player has no moves"
          })
        })
        return
      end
      
      -- Check if all moves are depleted
      local allMovesUsed = true
      for _, move in pairs(player.moves) do
        if (move.count or 0) > 0 then
          allMovesUsed = false
          break
        end
      end
      
      -- Handle struggle move
      local selectedMove
      if moveName == "struggle" then
        if not allMovesUsed then
          print("Cannot use struggle when other moves are available")
          ao.send({
            Target = msg.From,
            Data = json.encode({
              status = "error",
              message = "Cannot use struggle when other moves are available"
            })
          })
          return
        end
        selectedMove = createStruggleMove(player)
      else
        -- Validate regular move and move count
        if not player.moves[moveName] then
          print("Invalid move")
          ao.send({
            Target = msg.From,
            Data = json.encode({
              status = "error",
              message = "Invalid move"
            })
          })
          return
        end
        
        -- Get the move and check uses remaining
        selectedMove = player.moves[moveName]
        if (selectedMove.count or 0) <= 0 then
          print("Move has no uses remaining")
          ao.send({
            Target = msg.From,
            Data = json.encode({
              status = "error",
              message = "Move has no uses remaining"
            })
          })
          return
        end
      end
      
  
      -- Process the battle turn
      print("Processing battle turn")
      local result = processBattleTurn(battleId, userId, moveName)
      print("Battle turn result:", json.encode(result))
      
      if result.error then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = result.error
          })
        })
        return
      end
      
      if result.battleOver then
        local isChallenger = userId == battle.challenger.address
        local playerWon = isChallenger and result.challengerWon or result.accepterWon
        
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "success",
            message = playerWon and "Victory!" or "Defeat",
            data = {
              result = playerWon and "win" or "loss",
              turns = battleLogs[battleId],
              battle = battle
            }
          })
        })
      elseif result.waitingForMove then
        -- Send status update about waiting for other player
        local isChallenger = userId == battle.challenger.address
        local waitingFor = isChallenger and result.accepterMoved and "challenger" or "accepter"
        
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "success",
            message = "Move registered, waiting for " .. waitingFor,
            data = {
              waitingForMove = true,
              challengerMoved = result.challengerMoved,
              accepterMoved = result.accepterMoved,
              battle = battle
            }
          })
        })
      end
    end
  )
  
  Handlers.add(
    "EndBattle",
    Handlers.utils.hasMatchingTag("Action", "EndBattle"),
    function(msg)
      print("EndBattle handler called")
      local userId = msg.From
      local battleId = msg.Tags.BattleId
      
      print("User ID:", userId)
      print("Battle ID:", battleId)
      
      local battle = activeBattles[battleId]
      if not battle then
        print("Error: Battle not found")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Battle not found"
          })
        })
        return
      end
      
      print("Battle found:", json.encode(battle))
      
      if battle.status ~= "ended" then
        print("Error: Battle is not ended")
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "Battle is not ended"
          })
        })
        return
      end
      
      -- Get final battle state
      local isChallenger = userId == battle.challenger.address
      local playerWon = isChallenger and battle.accepter.healthPoints <= 0 or battle.challenger.healthPoints <= 0
      print("Player won:", playerWon)
      
      -- Get current session
      local currentSession = battles[userId]
      print("Current session:", json.encode(currentSession))
      
      -- Remove battle but keep logs
      local finalLogs = battleLogs[battleId]
      activeBattles[battleId] = nil
      
      print("Sending success response")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Battle ended",
          data = {
            result = playerWon and "win" or "loss",
            session = currentSession,
            turns = finalLogs,
            battle = battle
          }
        })
      })
    end
  )
  
  Handlers.add(
    "ReturnFromBattle",
    Handlers.utils.hasMatchingTag("Action", "ReturnFromBattle"),
    function(msg)
      local userId = msg.From
      local session = getBattleSession(userId)
      
      -- End battle session but keep battle logs
      battles[userId] = nil
      UserMonsters[userId] = nil
      
      -- Clear active battles but keep battle logs
      for battleId, battle in pairs(activeBattles) do
        if battle.challenger.address == userId or battle.accepter.address == userId then
          activeBattles[battleId] = nil
        end
      end
      
      -- Clear pending battles and open challenges
      for battleId, battle in pairs(pendingBattles) do
        if battle.challenger.address == userId or 
           (battle.targetAccepter and battle.targetAccepter == userId) then
          pendingBattles[battleId] = nil
          if battle.challengeType == "OPEN" then
            openChallenges[battleId] = nil
          end
        end
      end
  
      -- Also clean up any open challenges targeting this user
      for battleId, battle in pairs(openChallenges) do
        if battle.targetAccepter == userId then
          openChallenges[battleId] = nil
          pendingBattles[battleId] = nil
        end
      end
  
      ao.send({
        Target = TARGET_PREMPASS_PID,
        Tags = {
          Action = "ReturnFromBattle",
          UserId = userId
        },
        Data = json.encode({
          status = "home",
          message = "User return from battle"
        })
      })
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Battle session ended",
          data = session
        })
      })
    end
  )
  
  -- Admin force return
  Handlers.add(
    "AdminReturnFromBattle",
    Handlers.utils.hasMatchingTag("Action", "AdminReturnFromBattle"),
    function(msg)
      if not ensureAdmin(msg) then return end
      
      local userId = msg.Tags.UserId
      if not userId then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            status = "error",
            message = "No wallet specified"
          })
        })
        return
      end
      
      local session = getBattleSession(userId)
      battles[userId] = nil
      
      -- Clear active battles but keep battle logs
      for battleId, battle in pairs(activeBattles) do
        if battle.challenger.address == userId or battle.accepter.address == userId then
          activeBattles[battleId] = nil
        end
      end
      
      -- Clear pending battles and open challenges
      for battleId, battle in pairs(pendingBattles) do
        if battle.challenger.address == userId or 
           (battle.targetAccepter and battle.targetAccepter == userId) then
          pendingBattles[battleId] = nil
          if battle.challengeType == "OPEN" then
            openChallenges[battleId] = nil
          end
        end
      end
  
      -- Also clean up any open challenges targeting this user
      for battleId, battle in pairs(openChallenges) do
        if battle.targetAccepter == userId then
          openChallenges[battleId] = nil
          pendingBattles[battleId] = nil
        end
      end
  
      ao.send({
        Target = TARGET_PREMPASS_PID,
        Tags = {
          Action = "ReturnFromBattle",
          UserId = userId
        },
        Data = json.encode({
          status = "home",
          message = "Admin return from battle"
        })
      })
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Battle session ended by admin",
          data = session
        })
      })
    end
  )
  
  print("Loaded Battle.lua")
  