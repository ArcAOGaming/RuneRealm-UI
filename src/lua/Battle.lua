-- Battle Manager
local json = require("json")

-- Battle session data
battles = battles or {}
activeBattles = activeBattles or {}
UserMonsters = UserMonsters or {}
battleLogs = battleLogs or {} -- Store battle logs persistently

-- Initialize a battle session
local function initBattleSession(wallet)
  battles[wallet] = {
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

-- Create a level 1 opponent monster
local function createOpponent()
  -- Randomly select a faction
  local factionIndex = math.random(1, #AvailableFactions)
  local faction = AvailableFactions[factionIndex]
  
  -- Create a level 1 monster
  local opponent = CreateDefaultMonster(faction.name, faction.mascot, os.time() * 1000)
  opponent.level = 1
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
    
    -- Return session if battles are done
    if session.battlesRemaining <= 0 then
      local finalSession = battles[wallet]
      battles[wallet] = nil
      return finalSession
    end
    return session
  end
  return nil
end

-- Calculate miss chance based on speed difference
local function calculateMissChance(attackerSpeed, defenderSpeed)
  if attackerSpeed >= defenderSpeed then return 0 end
  local speedDiff = defenderSpeed - attackerSpeed
  return math.min(0.5, speedDiff * 0.05) -- 5% per speed point, max 50%
end

-- Calculate damage with randomness
local function calculateDamage(attacker, defender, move)
  print("Calculating damage for move:", json.encode(move))
  local baseDamage = move.damage or 0
  local attackMultiplier = 0.8 + (math.random() * 0.4) -- Random 0.8-1.2 multiplier
  local attackBonus = (attacker.attack + (move.attack or 0)) * attackMultiplier
  local finalDamage = baseDamage + attackBonus
  return math.floor(finalDamage)
end

-- Process attack and return turn info
local function processAttack(attacker, defender, move, isPlayer, battle)
  print("Processing attack:")
  print("Attacker:", json.encode(attacker))
  print("Defender:", json.encode(defender))
  print("Move:", json.encode(move))
  print("Is Player:", isPlayer)
  
  -- Initialize moveCounts if it doesn't exist
  if not battle.moveCounts then
    print("Initializing moveCounts")
    battle.moveCounts = {
      player = {},
      opponent = {}
    }
  end

  -- Validate move object has required properties
  if not move then
    print("Error: move is nil")
    return nil
  end
  
  if not move.name then
    print("Error: move.name is nil")
    move.name = "Unknown Move"
  end

  local turnInfo = {
    attacker = isPlayer and "player" or "opponent",
    move = move.name,
    missed = false,
    shieldDamage = 0,
    healthDamage = 0,
    remainingShield = defender.shield or 0,
    remainingHealth = defender.healthPoints or 0,
    statsChanged = {}
  }

  -- Validate attacker stats
  if not attacker.speed then attacker.speed = 0 end
  if not attacker.shield then attacker.shield = 0 end
  if not attacker.health then attacker.health = 1 end
  if not attacker.healthPoints then attacker.healthPoints = attacker.health * 10 end
  if not attacker.attack then attacker.attack = 0 end

  -- Validate defender stats
  if not defender.speed then defender.speed = 0 end
  if not defender.shield then defender.shield = 0 end
  if not defender.health then defender.health = 1 end
  if not defender.healthPoints then defender.healthPoints = defender.health * 10 end
  if not defender.attack then defender.attack = 0 end

  -- Check for miss
  local missChance = calculateMissChance(attacker.speed, defender.speed)
  if math.random() < missChance then
    turnInfo.missed = true
    return turnInfo
  end

  -- Apply speed boost if move has speed
  if move.speed and move.speed > 0 then
    attacker.speed = attacker.speed + move.speed
    turnInfo.statsChanged.speed = move.speed
  end

  -- Apply defense if move has defense (adds to shield without refilling)
  if move.defense and move.defense > 0 then
    attacker.shield = math.min(attacker.shield + move.defense, attacker.defense)
    turnInfo.statsChanged.defense = move.defense
  end

  -- Apply health restoration if move has health and attacker is alive
  if move.health and move.health > 0 and attacker.healthPoints > 0 then
    local healAmount = move.health * 10
    local maxHealth = attacker.health * 10
    local missingHealth = maxHealth - attacker.healthPoints
    
    if missingHealth >= healAmount then
      -- Use all healing for health
      attacker.healthPoints = attacker.healthPoints + healAmount
    else
      -- Heal health and put excess into shield
      attacker.healthPoints = attacker.healthPoints + missingHealth
      local excessHeal = healAmount - missingHealth
      attacker.shield = math.min(attacker.shield + excessHeal, attacker.defense)
    end
    turnInfo.statsChanged.health = healAmount
  end

  -- Calculate and apply damage
  local damage = calculateDamage(attacker, defender, move)

  -- Apply damage to shield first
  if defender.shield > 0 then
    if damage > defender.shield then
      turnInfo.shieldDamage = defender.shield
      turnInfo.healthDamage = damage - defender.shield
      defender.healthPoints = math.max(0, defender.healthPoints - turnInfo.healthDamage)
      defender.shield = 0
    else
      turnInfo.shieldDamage = damage
      defender.shield = defender.shield - damage
    end
  else
    turnInfo.healthDamage = damage
    defender.healthPoints = math.max(0, defender.healthPoints - damage)
  end

  -- Ensure shield never exceeds max
  defender.shield = math.min(defender.shield, defender.defense)

  -- Update move count
  local moveCountKey = isPlayer and "player" or "opponent"
  if not battle.moveCounts[moveCountKey] then
    battle.moveCounts[moveCountKey] = {}
  end
  battle.moveCounts[moveCountKey][move.name] = (battle.moveCounts[moveCountKey][move.name] or 0) + 1

  -- If defender died, remove battle and return
  if defender.healthPoints <= 0 then
    turnInfo.remainingShield = defender.shield
    turnInfo.remainingHealth = 0
    
    -- Remove battle from active battles using player's address
    local userId = battle.player.address
    print("Removing battle for user", userId, "from active battles")
    activeBattles[userId] = nil
    
    return turnInfo
  end

  turnInfo.remainingShield = defender.shield
  turnInfo.remainingHealth = defender.healthPoints
  return turnInfo
end

-- Process battle turn
local function processBattleTurn(battleId, playerMove, npcMove, playerFirst)
  print("Processing battle turn:")
  print("Player Move:", json.encode(playerMove))
  print("NPC Move:", json.encode(npcMove))
  print("Player First:", playerFirst)
  
  local battle = activeBattles[battleId]
  if not battle then 
    print("Error: Battle not found in processBattleTurn")
    return nil 
  end
  
  -- Validate battle object has required fields
  if not battle.player or not battle.opponent then
    print("Error: Battle missing player or opponent")
    return nil
  end
  
  if not battle.player.healthPoints or not battle.opponent.healthPoints then
    print("Error: Battle missing health points")
    return nil
  end
  
  -- Initialize turns array if not exists
  battle.turns = battle.turns or {}
  
  -- Validate move objects
  if not playerMove or not npcMove then
    print("Error: Missing move objects")
    print("Player move:", json.encode(playerMove))
    print("NPC move:", json.encode(npcMove))
    return nil
  end

  -- Validate move properties
  if not playerMove.name then
    print("Error: Player move missing name property")
    print("Player move:", json.encode(playerMove))
    playerMove.name = "Unknown Move"
  end
  if not npcMove.name then
    print("Error: NPC move missing name property")
    print("NPC move:", json.encode(npcMove))
    npcMove.name = "Unknown Move"
  end

  -- Initialize other move properties if missing
  if not playerMove.damage then playerMove.damage = 0 end
  if not playerMove.attack then playerMove.attack = 0 end
  if not playerMove.speed then playerMove.speed = 0 end
  if not playerMove.defense then playerMove.defense = 0 end
  if not playerMove.health then playerMove.health = 0 end

  if not npcMove.damage then npcMove.damage = 0 end
  if not npcMove.attack then npcMove.attack = 0 end
  if not npcMove.speed then npcMove.speed = 0 end
  if not npcMove.defense then npcMove.defense = 0 end
  if not npcMove.health then npcMove.health = 0 end

  local firstAttacker = playerFirst and battle.player or battle.opponent
  local secondAttacker = playerFirst and battle.opponent or battle.player
  local firstMove = playerFirst and playerMove or npcMove
  local secondMove = playerFirst and npcMove or playerMove
  
  -- First attack
  local turnInfo = processAttack(firstAttacker, secondAttacker, firstMove, playerFirst, battle)
  if not turnInfo then
    print("Error: First attack returned nil turnInfo")
    return nil
  end
  table.insert(battle.turns, turnInfo)
  -- Update battle logs immediately
  battleLogs[battleId] = battle.turns
  
  -- Check if defender died during first attack
  if turnInfo.remainingHealth <= 0 then
    print("Battle ended during first attack - defender died")
    print("Player health:", battle.player.healthPoints)
    print("Opponent health:", battle.opponent.healthPoints)
    return {
      battleOver = true,
      playerWon = playerFirst -- If player went first, they won since defender died
    }
  end
  
  -- Second attack only happens if first attack didn't end battle
  turnInfo = processAttack(secondAttacker, firstAttacker, secondMove, not playerFirst, battle)
  if not turnInfo then
    print("Error: Second attack returned nil turnInfo")
    return nil
  end
  table.insert(battle.turns, turnInfo)
  -- Update battle logs immediately
  battleLogs[battleId] = battle.turns
  
  -- Check if defender died during second attack
  if turnInfo.remainingHealth <= 0 then
    print("Battle ended during second attack - defender died")
    print("Player health:", battle.player.healthPoints)
    print("Opponent health:", battle.opponent.healthPoints)
    return {
      battleOver = true,
      playerWon = not playerFirst -- If opponent went first, player won if opponent's target died
    }
  end
  
  return {
    battleOver = false
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
    local battle = nil
    local battleId = nil
    
    -- Search through active battles for this user
    for bid, activeBattle in pairs(activeBattles) do
        if activeBattle.player.address == userId then
            battle = activeBattle
            battleId = bid
            break
        end
    end
    
    if not battle then
      ao.send({
        Target = userId,
        Data = json.encode({
          status = "not_found",
          message = "No active battle"
        })
      })
      return
    end
    
    -- Restore battle logs if they exist
    if battleLogs[battleId] then
        battle.turns = battleLogs[battleId]
    end
    
    ao.send({
      Target = userId,
      Data = json.encode({
        status = "success",
        message = "Battle found",
        data = battle
      })
    })
  end
)

Handlers.add(
  "Battle",
  Handlers.utils.hasMatchingTag("Action", "Battle"),
  function(msg)
    local userId = msg.From
    local session = getBattleSession(userId)
    if not session then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No active battle session"
        })
      })
      return
    end
    
    if session.battlesRemaining <= 0 then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No battles remaining"
        })
      })
      return
    end
    
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
    
    -- Create opponent and initialize battle
    local opponent = createOpponent()
    local battleId = userId
    
    -- Validate player monster has moves
    if not playerMonster.moves or type(playerMonster.moves) ~= "table" then
        print("Error: Player monster has no moves")
        print("Player monster:", json.encode(playerMonster))
        ao.send({
            Target = msg.From,
            Data = json.encode({
                status = "error",
                message = "Invalid monster: missing moves"
            })
        })
        return
    end

    -- Validate opponent has moves
    if not opponent.moves or type(opponent.moves) ~= "table" then
        print("Error: Opponent has no moves")
        print("Opponent:", json.encode(opponent))
        ao.send({
            Target = msg.From,
            Data = json.encode({
                status = "error",
                message = "Invalid opponent: missing moves"
            })
        })
        return
    end
    
    -- Initialize battle object with player address and health points
    local battle = {
      id = battleId,
      player = playerMonster,
      opponent = opponent,
      startTime = os.time() * 1000,
      turns = {},
      stats = battles[userId], -- Store battle stats in active battle
      moveCounts = {
        player = {},
        opponent = {}
      }
    }

    -- Validate and initialize moves
    for name, move in pairs(battle.player.moves) do
        if not move.name then move.name = name end
        if not move.damage then move.damage = 0 end
        if not move.attack then move.attack = 0 end
        if not move.speed then move.speed = 0 end
        if not move.defense then move.defense = 0 end
        if not move.health then move.health = 0 end
        if not move.count then move.count = 1 end
    end

    for name, move in pairs(battle.opponent.moves) do
        if not move.name then move.name = name end
        if not move.damage then move.damage = 0 end
        if not move.attack then move.attack = 0 end
        if not move.speed then move.speed = 0 end
        if not move.defense then move.defense = 0 end
        if not move.health then move.health = 0 end
        if not move.count then move.count = 1 end
    end
    
    -- Initialize move counts
    for name, _ in pairs(battle.player.moves) do
      battle.moveCounts.player[name] = 0
    end
    for name, _ in pairs(battle.opponent.moves) do
      battle.moveCounts.opponent[name] = 0
    end
    
    battle.player.address = userId
    battle.player.healthPoints = battle.player.health * 10
    battle.player.shield = battle.player.defense
    battle.opponent.healthPoints = battle.opponent.health * 10
    battle.opponent.shield = battle.opponent.defense
    
    activeBattles[battleId] = battle
    battleLogs[battleId] = {} -- Initialize empty battle logs
    
    ao.send({
      Target = msg.From,
      Data = json.encode({
        status = "success",
        message = "Battle started",
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
    if not battle.player then
      print("Error: battle.player is nil")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid battle state: missing player"
        })
      })
      return
    end
    
    if not battle.opponent then
      print("Error: battle.opponent is nil")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid battle state: missing opponent"
        })
      })
      return
    end
    
    if not battle.player.moves then
      print("Error: battle.player.moves is nil")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid battle state: player has no moves"
        })
      })
      return
    end
    
    if not battle.opponent.moves then
      print("Error: battle.opponent.moves is nil")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid battle state: opponent has no moves"
        })
      })
      return
    end
    
    -- Initialize moveCounts if it doesn't exist
    if not battle.moveCounts then
      print("Initializing moveCounts")
      battle.moveCounts = {
        player = {},
        opponent = {}
      }
    end
    
    -- Validate move and move count
    if not battle.player.moves[moveName] then
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

    -- Check if move has exceeded its count limit
    if not battle.moveCounts.player[moveName] then
      battle.moveCounts.player[moveName] = 0
    end
    local moveCount = battle.moveCounts.player[moveName]
    if moveCount >= (battle.player.moves[moveName].count or 1) then
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
    
    -- Select random NPC move that has uses remaining
    local availableNpcMoves = {}
    print("Opponent moves:", json.encode(battle.opponent.moves))
    for name, move in pairs(battle.opponent.moves) do
      if not battle.moveCounts.opponent[name] then
        battle.moveCounts.opponent[name] = 0
      end
      local npcMoveCount = battle.moveCounts.opponent[name]
      if npcMoveCount < (move.count or 1) then
        table.insert(availableNpcMoves, name)
      end
    end
    print("Available NPC moves:", json.encode(availableNpcMoves))
    
    if #availableNpcMoves == 0 then
      print("NPC has no moves left")
      -- If NPC has no moves left, they lose
      local session = recordBattle(userId, true)
      battle.stats = session
      local finalLogs = battleLogs[battleId]
      
      if session.battlesRemaining <= 0 then
        activeBattles[battleId] = nil

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
      else
        activeBattles[battleId] = battle
      end
      
      battleLogs[battleId] = finalLogs
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Victory! (Opponent has no moves left)",
          data = {
            result = "win",
            session = session,
            turns = finalLogs,
            battle = activeBattles[battleId]
          }
        })
      })
      return
    end
    
    -- Get random NPC move name and move object
    local npcMoveName = availableNpcMoves[math.random(#availableNpcMoves)]
    print("Selected NPC move name:", npcMoveName)
    local npcMove = battle.opponent.moves[npcMoveName]
    if not npcMove then
        print("Error: NPC move not found:", npcMoveName)
        print("Available moves:", json.encode(battle.opponent.moves))
        ao.send({
            Target = msg.From,
            Data = json.encode({
                status = "error",
                message = "Invalid NPC move"
            })
        })
        return
    end
    print("NPC move object:", json.encode(npcMove))
    
    -- Get player move object
    local playerMove = battle.player.moves[moveName]
    if not playerMove then
        print("Error: Player move not found:", moveName)
        print("Available moves:", json.encode(battle.player.moves))
        ao.send({
            Target = msg.From,
            Data = json.encode({
                status = "error",
                message = "Invalid player move"
            })
        })
        return
    end
    print("Player move object:", json.encode(playerMove))
    if not playerMove or not playerMove.name then
      print("Error: Invalid player move")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid player move"
        })
      })
      return
    end
    
    if not npcMove or not npcMove.name then
      print("Error: Invalid NPC move")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Invalid NPC move"
        })
      })
      return
    end
    
    -- Determine who goes first based on speed
    local playerFirst = battle.player.speed >= battle.opponent.speed
    print("Player goes first:", playerFirst)
    print("Player move object:", json.encode(playerMove))
    local result = processBattleTurn(battleId, playerMove, npcMove, playerFirst)
    
    if result.battleOver then
      local playerWon = result.playerWon
      local session = recordBattle(userId, playerWon)
      battle.stats = session
      
      local finalLogs = battleLogs[battleId]
      
      -- Always remove battle when it's over
      activeBattles[battleId] = nil
      
      -- Send return message if no battles remaining
      if session.battlesRemaining <= 0 then
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
      end
      
      battleLogs[battleId] = finalLogs
      
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = playerWon and "Victory!" or "Defeat",
          data = {
            result = playerWon and "win" or "loss",
            session = session,
            turns = finalLogs,
            battle = activeBattles[battleId]
          }
        })
      })
    else
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "success",
          message = "Turn completed",
          data = battle
        })
      })
    end
  end
)

Handlers.add(
  "ReturnFromBattle",
  Handlers.utils.hasMatchingTag("Action", "ReturnFromBattle"),
  function(msg)
    local userId = msg.From
    local session = getBattleSession(userId)
    
    if not session then
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "No active battle session"
        })
      })
      return
    end
    
    -- End battle session but keep battle logs
    battles[userId] = nil
    UserMonsters[userId] = nil

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
      if battle.player.address == userId then
        activeBattles[battleId] = nil
      end
    end

    ao.send({
      Target = TARGET_PREMPASS_PID,
      Tags = {
        Action = "ReturnFromBattle",
        UserId = userId
      },
      Data = json.encode({
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
