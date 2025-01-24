-- Name: PremiumPass
-- ProcessId: j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI

local json = require("json")

Initialized = Initialized or nil

TARGET_WORLD_PID = "lA4WPP5v9iUowzLJtCjZsSH_m6WV2FUbGlPSlG7KbnM"
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

-- Initialize storage
Unlocked = Unlocked or {}
UserSkins = UserSkins or {}
UserFactions = UserFactions or {}
UserMonsters = UserMonsters or {}

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

-- Function to get random moves from a pool
function GetRandomMove(pool)
  local moves = {}
  for name, _ in pairs(pool) do
    table.insert(moves, name)
  end
  local index = math.random(1, #moves)
  return moves[index]
end

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

-- Monster template structure
function CreateDefaultMonster(factionName, mascotTxId, timestamp)
  -- Map faction names to berry process IDs
  local berryMap = {
    ["Sky Nomads"] = "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",
    ["Aqua Guardians"] = "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",
    ["Stone Titans"] = "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",
    ["Inferno Blades"] = "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0"
  }

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
    image = mascotTxId,
    attack = startingStats.attack,
    defense = startingStats.defense,
    speed = startingStats.speed,
    health = startingStats.health,
    energy = 50,
    happiness = 50,  -- Start with 50 happiness
    level = 0,
    exp = 0,
    berryType = berryMap[factionName],  -- Store process ID directly
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
        duration = 36 * 1000,  -- 1 hour in milliseconds
        energyCost = 25,
        happinessCost = 25
      },
      play = {
        cost = {
          token = berryMap[factionName],  -- Use faction's berry type
          amount = 1
        },
        duration = 9 * 1000,  -- 15 minutes in milliseconds
        energyCost = 10,
        happinessGain = 25
      },
      feed = {
        cost = {
          token = berryMap[factionName],  -- Use faction's berry type
          amount = 1
        },
        energyGain = 10
      }
    }
  }
end


-- Handler for returning from mission
Handlers.add(
  "ReturnFromMission",
  Handlers.utils.hasMatchingTag("Action", "ReturnFromMission"),
  function(msg)
    print("Returning from mission")
    local userId = msg.From
    
    local monster = UserMonsters[userId]
    if not monster then
      print("No monster found for user:", userId)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No monster found"
        })
      })
      return
    end

    if monster.status.type ~= "Mission" then
      print("Monster is not on mission:", monster.status.type)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Monster is not on mission"
        })
      })
      return
    end

    if msg.Timestamp < monster.status.until_time then
      print("Mission not finished yet")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Mission not finished yet"
        })
      })
      return
    end

    -- Return home and grant exp
    monster.status = {
      type = "Home",
      since = msg.Timestamp,
      until_time = msg.Timestamp
    }
    monster.exp = monster.exp + 1  -- Grant 1 exp for completing mission

    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Monster returned from mission",
        monster = monster
      })
    })
  end
)

-- Handler for returning from play
Handlers.add(
  "ReturnFromPlay",
  Handlers.utils.hasMatchingTag("Action", "ReturnFromPlay"),
  function(msg)
    print("Returning from play")
    local userId = msg.From
    
    local monster = UserMonsters[userId]
    if not monster then
      print("No monster found for user:", userId)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No monster found"
        })
      })
      return
    end

    if monster.status.type ~= "Play" then
      print("Monster is not playing:", monster.status.type)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Monster is not playing"
        })
      })
      return
    end

    if msg.Timestamp < monster.status.until_time then
      print("Play time not finished yet")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Play time not finished yet"
        })
      })
      return
    end

    -- Return home and increase happiness
    monster.status = {
      type = "Home",
      since = msg.Timestamp,
      until_time = msg.Timestamp
    }
    monster.happiness = math.min(100, monster.happiness + monster.activities.play.happinessGain)

    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Monster returned from play",
        monster = monster
      })
    })
  end
)

-- Function to check if a value exists in a table
function UnlockedSkin(value)
  for _, v in pairs(Unlocked) do
    if v == value then
      return true
    end
  end
  return false
end

function IsAdmin(userId)
  return userId == ADMIN_WALLET
end

function UpdateSkin(userId, spriteTxId)
  print('Changing ' .. userId .. "'s Skin to " .. (spriteTxId or BaseSprite))

  ao.send({
    Target = TARGET_WORLD_PID,
    Tags = {
      Action = "Reality.UpdateSpriteTxId",
      EntityID = userId,
      SpriteTxId = spriteTxId or BaseSprite,
      SpriteAtlasTxId = BaseSpriteAtlas,
    --   SpriteScale = BaseSpriteScale,
    --   SpriteHitbox = BaseSpriteHitbox,
    },
    Data = json.encode({
       Scale = BaseSpriteScale,
       Hitbox = BaseSpriteHitbox
      })
  })
  print("Sent UpdateSkin to world")
end

-- Handle GetPurchaseOptions action
Handlers.add(
  "GetPurchaseOptions",
  Handlers.utils.hasMatchingTag("Action", "GetPurchaseOptions"),
  function(msg)
    ao.send({
      Target = msg.From,
      Data = json.encode({
        result = PurchaseTokens
      })
    })
    return "ok"
  end
)
-- Handle GetFactions action
Handlers.add(
  "GetFactions",
  Handlers.utils.hasMatchingTag("Action", "GetFactions"),
  function(msg)
    ao.send({
      Target = msg.From,
      Data = json.encode({
        result = AvailableFactions
      })
    })
    return "ok"
  end
)

-- Handler to get user's current skin
Handlers.add(
  'GetUserSkin',
  Handlers.utils.hasMatchingTag('Action', 'GetUserSkin'),
  function(msg)
    local targetWallet = msg.Tags.Wallet
    if not targetWallet then
      return ao.send({
        Target = msg.From,
        Data = json.encode({ error = "No wallet specified" })
      })
    end
    
    local response = UserSkins[targetWallet] or {}
    ao.send({
      Target = msg.From,
      Data = json.encode(response)
    })
  end
)

-- New handler to get list of authorized users
Handlers.add(
  'GetAuthorizedUsers',
  Handlers.utils.hasMatchingTag('Action', 'GetAuthorizedUsers'),
  function(msg)
    ao.send({
      Target = msg.From,
      Data = json.encode(Unlocked)
    })
  end
)

-- Modified update skin handler
Handlers.add(
  'UpdateSprite',
  Handlers.utils.hasMatchingTag('Action', 'UpdateSprite'),
  function(msg)
    print("Updating sprite")
    print("From: " .. msg.From)
    
    -- Check if user has unlock permission
    if not UnlockedSkin(msg.From) then
      print("User " .. msg.From .. " does not have Eternal Pass")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "You do not have Eternal Pass"
        })
      })
      return
    end
    
    local spriteTxId = msg.Tags.SpriteTxId
    assert(spriteTxId, "No sprite transaction ID provided")
    local spriteAtlasTxId = msg.Tags.SpriteAtlasTxId
    assert(spriteAtlasTxId, "No sprite atlas transaction ID provided")
    
    UpdateSkin(msg.From, spriteTxId)
    UserSkins[msg.From] = { txId = spriteTxId }
    print("Updated user skin to: " .. spriteTxId .. " " .. spriteAtlasTxId .. " for user: " .. msg.From) 
    
    -- Send confirmation back to the user
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Sprite updated successfully",
        txId = spriteTxId
      })
    })
  end
)
Handlers.add(
  'SetFaction',
  Handlers.utils.hasMatchingTag('Action', 'SetFaction'),
  function(msg)
    print("Setting faction")
    print("From: " .. msg.From)
    
    -- Check if user has unlock permission
    if not UnlockedSkin(msg.From) then
      print("User " .. msg.From .. " does not have Eternal Pass")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "You do not have Eternal Pass"
        })
      })
      return
    end
    
    local faction = msg.Tags.Faction
    assert(faction, "No faction provided")
    assert(UserFactions[msg.From] == nil, "User already has a faction")
    UserFactions[msg.From] = { faction = faction }
    print("Set user faction to: " .. faction .. " for user: " .. msg.From) 
    
    -- Send confirmation back to the user
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Faction set successfully",
        faction = faction
      })
    })
  end
)
-- Handle Credit-Notice for both purchases and feeding
Handlers.add(
  "CreditNoticeHandler",
  Handlers.utils.hasMatchingTag("Action", "Credit-Notice"),
  function(msg)
    print("credit-notice")
    local userId = msg.Tags.Sender
    local quantity = tonumber(msg.Tags.Quantity)
    local token = msg.From

    -- Check if this is a feeding action
    if msg.Tags["X-Action"] == "FEED" then
      print("Handling berry feeding from:", userId)
      
      local monster = UserMonsters[userId]
      if not monster then
        print("No monster found for user:", userId)
        return
      end

      print("Monster state:", json.encode(monster))
      print("Received berry:", token)

      if monster.berryType ~= token then
        print("Wrong berry process. Expected:", monster.berryType, "Got:", token)
        return
      end

      if monster.energy >= 100 then
        print("Monster energy already at maximum")
        return
      end

      -- Increase energy by configured amount, not exceeding 100
      monster.energy = math.min(100, monster.energy + monster.activities.feed.energyGain)
      print("Updated energy to:", monster.energy)

      -- Send confirmation back to the user
      ao.send({
        Target = userId,
        Data = json.encode({
          status = "success",
          message = "Monster fed successfully",
          monster = monster
        })
      })
      return
    end

        -- Check if this is a feeding action
        if msg.Tags["X-Action"] == "Play" then
          print("Handling playing:", userId)
          
          local monster = UserMonsters[userId]
          if not monster then
            print("No monster found for user:", userId)
            return
          end
    
          print("Monster state:", json.encode(monster))
          print("Received berry:", token)
    
          if monster.berryType ~= token then
            print("Wrong berry process. Expected:", monster.berryType, "Got:", token)
            return
          end

          if monster.status.type ~= "Home" then
            print("Monster is not at home:", monster.status.type)
            return
          end

          if monster.energy < monster.activities.play.energyCost  then
            print("Monster doesn't have enough energy")
            return
          end
          monster.energy = monster.energy - monster.activities.play.energyCost
    

                -- Set monster to playing status
          monster.status = {
            type = "Play",
            since = msg.Timestamp,
            until_time = msg.Timestamp + monster.activities.play.duration
          }
          -- Send confirmation back to the user
          ao.send({
            Target = userId,
            Data = json.encode({
              status = "success",
              message = "Monster sent to play successfully",
              monster = monster
            })
          })
          return
        end

    -- If not feeding or mission, handle as purchase
    if msg.Tags["X-Action"] == "Mission" then
      print("Handling mission fuel from:", userId)
      
      local monster = UserMonsters[userId]
      if not monster then
        print("No monster found for user:", userId)
        return
      end

      print("Monster state:", json.encode(monster))
      print("Received mission fuel:", token)

      if monster.activities.mission.cost.token ~= token then
        print("Wrong mission fuel. Expected:", monster.activities.mission.cost.token, "Got:", token)
        return
      end

      if monster.status.type ~= "Home" then
        print("Monster is not at home:", monster.status.type)
        return
      end

      if monster.energy < monster.activities.mission.energyCost or monster.happiness < monster.activities.mission.happinessCost then
        print("Monster doesn't have enough energy or happiness")
        return
      end

      -- Set monster on mission
      monster.status = {
        type = "Mission",
        since = msg.Timestamp,
        until_time = msg.Timestamp + monster.activities.mission.duration
      }

      -- Consume energy and happiness
      monster.energy = monster.energy - monster.activities.mission.energyCost
      monster.happiness = monster.happiness - monster.activities.mission.happinessCost

      -- Send confirmation back to the user
      ao.send({
        Target = userId,
        Data = json.encode({
          status = "success",
          message = "Monster is now on a mission",
          monster = monster
        })
      })
      return
    end

    -- Handle as purchase
    local validPurchase = false
    for _, option in ipairs(PurchaseTokens) do
      if token == option.token and quantity == tonumber(option.amount) then
        validPurchase = true
        break
      end
    end

    if not validPurchase then
      print("Invalid purchase amount or token")
      return
    end

    local message
    if UnlockedSkin(userId) then
      message = "Thank you for the donation!"
    else
      table.insert(Unlocked, userId)
      message = "Thank you for purchasing skin changing ability!"
    end

    ao.send({
      Target = TARGET_WORLD_PID,
      Tags = {
        Action = "ChatMessage",
        ['Author-Name'] = 'SkinChanger',
        Recipient = userId
      },
      Data = message
    })
  end
)

-- Handle CheckUnlocked action
Handlers.add(
  "CheckUnlocked",
  Handlers.utils.hasMatchingTag("Action", "CheckUnlocked"),
  function(msg)
    local address = ao.id
    if msg.Tags.Address then
      address = msg.Tags.Address
    end
    
    local result = {
      result = UnlockedSkin(address)
    }
    
    ao.send({
      Target = msg.From,
      Data = json.encode(result)
    })
  end
)

-- Handle CheckUnlocked action
Handlers.add(
  "CheckSkin",
  Handlers.utils.hasMatchingTag("Action", "CheckSkin"),
  function(msg)
    local address = ao.id
    if msg.Tags.Address then
      address = msg.Tags.Address
    end
    
    local result = UserSkins[address].txId or "None"
    
    ao.send({
      Target = msg.From,
      Data = result
    })
  end
)
Handlers.add(
  "CheckFaction",
  Handlers.utils.hasMatchingTag("Action", "CheckFaction"),
  function(msg)
    local address = ao.id
    if msg.Tags.Address then
      address = msg.Tags.Address
    end
    
    local result = UserFactions[address].faction or "None"
    
    ao.send({
      Target = msg.From,
      Data = result
    })
  end
)

-- Handler for bulk address import
Handlers.add(
  'BulkImportAddresses',
  Handlers.utils.hasMatchingTag('Action', 'BulkImportAddresses'),
  function(msg)
    -- Check if sender is admin
    if not IsAdmin(msg.From) then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          type = "error",
          error = "Unauthorized access"
        })
      })
      return
    end

    local data = json.decode(msg.Data)
    if not data or not data.addresses or type(data.addresses) ~= "table" then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          type = "error",
          error = "Invalid input format"
        })
      })
      return
    end

    local successful = 0
    local failed = 0

    for _, address in ipairs(data.addresses) do
      -- Validate address format (assuming Arweave address format)
      if type(address) == "string" and #address > 0 then
        if not UnlockedSkin(address) then
          table.insert(Unlocked, address)
          successful = successful + 1
        else
          failed = failed + 1  -- Address already unlocked
        end
      else
        failed = failed + 1  -- Invalid address format
      end
    end

    ao.send({
      Target = msg.From,
      Data = json.encode({
        type = "ok",
        data = json.encode({
          successful = successful,
          failed = failed
        })
      })
    })
  end
)


-- Function to remove a user from the unlocked list
function RemoveUserFromUnlocked(userId)
    for index, value in ipairs(Unlocked) do
      if value == userId then
        table.remove(Unlocked, index)
        print("Removed user from Unlocked list: " .. userId)
        return true
      end
    end
    print("User not found in Unlocked list: " .. userId)
    return false
  end
  
  -- Function to remove a user from the UserSkins list
  function RemoveUserSkin(userId)
    if UserSkins[userId] then
      UserSkins[userId] = nil
      print("Removed user's skin: " .. userId)
      return true
    end
    print("User skin not found: " .. userId)
    return false
  end
  
  -- Handler for removing a user
  Handlers.add(
    'RemoveUser',
    Handlers.utils.hasMatchingTag('Action', 'RemoveUser'),
    function(msg)
      -- Check if sender is admin
      if not IsAdmin(msg.From) then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            type = "error",
            error = "Unauthorized access"
          })
        })
        return
      end
  
      local userId = msg.Tags.UserId
      if not userId then
        ao.send({
          Target = msg.From,
          Data = json.encode({
            type = "error",
            error = "No user ID specified"
          })
        })
        return
      end
  
      local unlockedRemoved = RemoveUserFromUnlocked(userId)
      local skinRemoved = RemoveUserSkin(userId)
  
      local result = {
        type = "ok",
        message = "User removal complete",
        unlockedRemoved = unlockedRemoved,
        skinRemoved = skinRemoved
      }
  
      ao.send({
        Target = msg.From,
        Data = json.encode(result)
      })
    end
  )
  

-- Handler for adopting a monster
Handlers.add(
  'AdoptMonster',
  Handlers.utils.hasMatchingTag('Action', 'AdoptMonster'),
  function(msg)
    print("Adopting monster")
    print("From: " .. msg.From)
    
    -- Check if user has unlock permission
    if not UnlockedSkin(msg.From) then
      print("User " .. msg.From .. " does not have Eternal Pass")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "You do not have Eternal Pass"
        })
      })
      return
    end

    -- Check if user has a faction
    local userFaction = UserFactions[msg.From]
    if not userFaction then
      print("User " .. msg.From .. " does not have a faction")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "You must join a faction first"
        })
      })
      return
    end

    -- Find faction details
    local factionDetails = nil
    for _, faction in ipairs(AvailableFactions) do
      if faction.name == userFaction.faction then
        factionDetails = faction
        break
      end
    end

    if not factionDetails then
      print("Faction details not found for: " .. userFaction.faction)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Faction details not found"
        })
      })
      return
    end

    -- Create and assign monster with current timestamp
    UserMonsters[msg.From] = CreateDefaultMonster(factionDetails.name, factionDetails.mascot, msg.Timestamp)
    
    -- Send confirmation back to the user
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Monster adopted successfully",
        monster = UserMonsters[msg.From]
      })
    })
  end
)

-- Handler to get user's monster
Handlers.add(
  'GetUserMonster',
  Handlers.utils.hasMatchingTag('Action', 'GetUserMonster'),
  function(msg)
    local targetWallet = msg.Tags.Wallet or msg.From
    
    local monster = UserMonsters[targetWallet]
    if not monster then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No monster found for this user"
        })
      })
      return
    end
    
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        monster = monster
      })
    })
  end
)

-- Function to calculate required exp for next level using Fibonacci sequence starting at 5
function GetRequiredExp(level)
  if level == 0 then return 1 end
  if level == 1 then return 2 end
  
  local a, b = 1, 2
  for i = 2, level do
    local next = a + b
    a = b
    b = next
  end
  return b
end

-- Handler for leveling up monster
Handlers.add(
  "LevelUpMonster",
  Handlers.utils.hasMatchingTag("Action", "LevelUp"),
  function(msg)
    local userId = msg.From
    
    local monster = UserMonsters[userId]
    if not monster then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No monster found"
        })
      })
      return
    end

    local requiredExp = GetRequiredExp(monster.level)
    if monster.exp < requiredExp then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Not enough exp to level up"
        })
      })
      return
    end

    -- Get stat points from message tags
    local attackPoints = tonumber(msg.Tags.AttackPoints) or 0
    local defensePoints = tonumber(msg.Tags.DefensePoints) or 0
    local speedPoints = tonumber(msg.Tags.SpeedPoints) or 0
    local healthPoints = tonumber(msg.Tags.HealthPoints) or 0

    -- Validate total points and max per stat
    local totalPoints = attackPoints + defensePoints + speedPoints + healthPoints
    if totalPoints ~= 10 or 
       attackPoints > 5 or defensePoints > 5 or 
       speedPoints > 5 or healthPoints > 5 then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid stat point allocation"
        })
      })
      return
    end

    -- Level up the monster and apply stat points
    monster.level = monster.level + 1
    monster.exp = monster.exp - requiredExp
    monster.attack = monster.attack + attackPoints
    monster.defense = monster.defense + defensePoints
    monster.speed = monster.speed + speedPoints
    monster.health = monster.health + healthPoints

    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Monster leveled up!",
        monster = monster,
        nextLevelExp = GetRequiredExp(monster.level)
      })
    })
  end
)


-- Helper function to check if an activity is complete
function isActivityComplete(status, currentTime)
  if not status or not status.until_time then
    return false
  end
  return currentTime >= status.until_time
end

-- Handler to get all user information
Handlers.add(
  'GetUserInfo',
  Handlers.utils.hasMatchingTag('Action', 'GetUserInfo'),
  function(msg)
    local targetWallet = msg.Tags.Wallet or msg.From
    local currentTime = msg.Timestamp
    
    -- Get monster info and check activity status
    local monster = UserMonsters[targetWallet]
    local activityStatus = {
      isPlayComplete = false,
      isMissionComplete = false
    }
    
    if monster then
      if monster.status.type == "Play" then
        activityStatus.isPlayComplete = isActivityComplete(monster.status, currentTime)
      elseif monster.status.type == "Mission" then
        activityStatus.isMissionComplete = isActivityComplete(monster.status, currentTime)
      end
    end
    
    -- Collect all user information
    local userInfo = {
      isUnlocked = UnlockedSkin(targetWallet),
      skin = UserSkins[targetWallet] and UserSkins[targetWallet].txId or nil,
      faction = UserFactions[targetWallet] and UserFactions[targetWallet].faction or nil,
      monster = monster,
      activityStatus = activityStatus
    }
    
    ao.send({
      Target = msg.From,
      Action = 'GetUserInfo-Response',
      Tags = {
        UserId = targetWallet
      },
      Data = json.encode(userInfo)
    })
  end
)

-- Handler for admin to set user stats
Handlers.add(
  'SetUserStats',
  Handlers.utils.hasMatchingTag('Action', 'SetUserStats'),
  function(msg)
    -- Check if sender is admin
    if not IsAdmin(msg.From) then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Unauthorized access - Admin only"
        })
      })
      return
    end

    local targetWallet = msg.Tags.Wallet
    if not targetWallet then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No target wallet specified"
        })
      })
      return
    end

    local monster = UserMonsters[targetWallet]
    if not monster then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No monster found for this user"
        })
      })
      return
    end

    -- Parse the new stats from the message data
    local newStats = json.decode(msg.Data)
    if not newStats then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid stats data format"
        })
      })
      return
    end

    -- Update monster stats
    if newStats.level ~= nil then monster.level = newStats.level end
    if newStats.exp ~= nil then monster.exp = newStats.exp end
    if newStats.attack ~= nil then monster.attack = newStats.attack end
    if newStats.defense ~= nil then monster.defense = newStats.defense end
    if newStats.speed ~= nil then monster.speed = newStats.speed end
    if newStats.health ~= nil then monster.health = newStats.health end
    if newStats.energy ~= nil then monster.energy = math.min(100, newStats.energy) end
    if newStats.happiness ~= nil then monster.happiness = math.min(100, newStats.happiness) end
    
    -- Update identity and status
    if newStats.faction ~= nil then 
      UserFactions[targetWallet] = { faction = newStats.faction }
    end
    if newStats.image ~= nil then monster.image = newStats.image end
    if newStats.name ~= nil then monster.name = newStats.name end
    if newStats.status ~= nil then
      monster.status = {
        type = newStats.status.type,
        since = newStats.status.since,
        until_time = newStats.status.until_time
      }
    end

    -- Send confirmation back to the admin
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Monster stats updated successfully",
        monster = monster
      })
    })
  end
)

print("Loaded NEW PremPass.lua")
