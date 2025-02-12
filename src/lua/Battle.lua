-- Battle Manager
local json = require("json")

-- Attack Logic
-- Type effectiveness table
local typeEffectiveness = {
    fire = { weak = "water", strong = "air" },
    water = { weak = "earth", strong = "fire" },
    earth = { weak = "air", strong = "water" },
    air = { weak = "fire", strong = "earth" }
}

-- Random number generation function
local function getRandom(min, max)
    return math.random(min, max)
end

-- Calculate type effectiveness multiplier
local function getTypeEffectiveness(attackerType, defenderType)
    if not attackerType or not defenderType then return 1 end
    
    local effectiveness = typeEffectiveness[attackerType]
    if not effectiveness then return 1 end
    
    if effectiveness.weak == defenderType then
        return 0.5 -- Not very effective
    elseif effectiveness.strong == defenderType then
        return 2 -- Super effective
    end
    return 1 -- Normal effectiveness
end

-- Determine if attack hits based on speed difference
local function calculateHitChance(attackerSpeed, defenderSpeed)
    local speedDiff = attackerSpeed - defenderSpeed
    local baseHitChance = 0.8 -- 80% base hit chance
    
    -- Adjust hit chance based on speed difference
    local hitChanceModifier = speedDiff * 0.05 -- 5% per point of speed difference
    local finalHitChance = baseHitChance + hitChanceModifier
    
    -- Clamp hit chance between 0.5 (50%) and 0.95 (95%)
    return math.max(0.5, math.min(0.95, finalHitChance))
end

-- Determine if attack hits
local function doesAttackHit(attackerSpeed, defenderSpeed)
    local hitChance = calculateHitChance(attackerSpeed, defenderSpeed)
    return getRandom(1, 100) <= hitChance * 100
end

-- Determine turn order based on speed
local function determineTurnOrder(attacker, defender)
    local attackerRoll = attacker.speed + getRandom(1, 5)
    local defenderRoll = defender.speed + getRandom(1, 5)
    
    if attackerRoll == defenderRoll then
        -- On tie, randomly decide
        return getRandom(1, 2) == 1
    end
    return attackerRoll > defenderRoll
end

-- Calculate damage including random bonus
local function calculateDamage(move, attacker, defender)
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
    
    if move.damage <= 0 then 
        print("Move damage is 0 or less")
        return 0, 1 
    end
    
    -- Base damage from move
    local damage = move.damage
    print("Base damage:", damage)
    
    -- Add random bonus based on attacker's base attack
    local bonus = getRandom(1, attacker.attack)
    damage = damage + bonus
    print("Damage after attack bonus:", damage)
    
    -- Apply type effectiveness
    local effectiveness = getTypeEffectiveness(move.type, defender.elementType)
    damage = damage * effectiveness
    print("Final damage after type effectiveness:", damage)
    print("Type effectiveness:", effectiveness)
    
    return math.floor(damage), effectiveness
end

-- Apply damage considering shields
local function applyDamage(target, damage)
    local shieldDamage = 0
    local healthDamage = 0
    
    -- Damage shield first
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
local function applyStatChanges(target, move)
    local changes = {}
    
    -- Attack modification
    if move.attack ~= 0 then
        target.attack = math.max(1, target.attack + move.attack)
        changes.attack = move.attack
    end
    
    -- Speed modification
    if move.speed ~= 0 then
        target.speed = math.max(1, target.speed + move.speed)
        changes.speed = move.speed
    end
    
    -- Defense/shield modification
    if move.defense ~= 0 then
        target.defense = math.max(1, target.defense + move.defense)
        target.shield = math.min(target.defense, target.shield + move.defense)
        changes.defense = move.defense
    end
    
    -- Health modification (healing)
    if move.health > 0 then
        local maxHealth = target.health * 10
        target.healthPoints = math.min(maxHealth, target.healthPoints + move.health)
        changes.health = move.health
    elseif move.health < 0 then
        target.healthPoints = math.max(0, target.healthPoints + move.health)
        changes.health = move.health
    end
    
    return changes
end

-- Create struggle move for when all moves are depleted
local function createStruggleMove(monster)
    return {
        name = "Struggle",
        type = monster.elementType or "normal", -- Fallback to normal type if none exists
        count = 999,
        damage = 1,
        attack = 0,
        speed = 0,
        defense = 0,
        health = 0,
        healthDamage = 0,  -- Initialize battle-specific fields
        shieldDamage = 0,
        missed = false,
        changes = {}, -- For stat changes
        superEffective = false,
        notEffective = false
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

-- Create a level 1 opponent monster with fresh moves
local function createOpponent()
  -- Randomly select a faction
  local factionIndex = math.random(1, #AvailableFactions)
  local faction = AvailableFactions[factionIndex]
  
  -- Create a level 1 monster
  local opponent = CreateDefaultMonster(faction.name, faction.mascot, os.time() * 1000)
  opponent.level = 1
  
  --Create a deep copy of the moves to avoid reference issues
  local freshMoves = {}
  for name, move in pairs(opponent.moves) do
    freshMoves[name] = {
      name = move.name,
      count = move.count, -- This should be from the default move count
      damage = move.damage,
      attack = move.attack,
      speed = move.speed,
      defense = move.defense,
      health = move.health
    }
  end
  opponent.moves = freshMoves
  
  print("Created opponent:", json.encode(opponent))
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
local function processBattleTurn(battleId, playerMove, npcMove)
  local battle = activeBattles[battleId]
  if not battle then return nil end
  
  -- Initialize turns array if not exists
  battle.turns = battle.turns or {}
  
  -- Initialize struggle tracking if not exists
  battle.hasUsedStruggle = battle.hasUsedStruggle or { player = false, opponent = false }
  
  -- Track struggle usage
  if playerMove.name == "Struggle" then
    battle.hasUsedStruggle.player = true
  end
  if npcMove.name == "Struggle" then
    battle.hasUsedStruggle.opponent = true
  end
  
  -- Ensure both monsters have required fields
  if not battle.player.name then battle.player.name = "Player Monster" end
  if not battle.opponent.name then battle.opponent.name = "Opponent Monster" end
  
  -- Ensure both monsters have speed for turn order
  if not battle.player.speed then battle.player.speed = 1 end
  if not battle.opponent.speed then battle.opponent.speed = 1 end
  
  -- Process the full turn using attack logic
  print("Processing turn with moves:", json.encode({player = playerMove, npc = npcMove}))
  print("Monsters:", json.encode({player = battle.player, opponent = battle.opponent}))
  local turnResult = processTurn(battle.player, battle.opponent, playerMove, npcMove)
  
  -- Regenerate shields if haven't used struggle
  if not battle.hasUsedStruggle.player then
    battle.player.shield = battle.player.defense
    print("Regenerated player shield to:", battle.player.shield)
  end
  if not battle.hasUsedStruggle.opponent then
    battle.opponent.shield = battle.opponent.defense
    print("Regenerated opponent shield to:", battle.opponent.shield)
  end
  
  -- Convert turn result to battle turns format
  for _, action in ipairs(turnResult.actions) do
    local isPlayer = action.attacker == battle.player.name
    local turnInfo = {
      attacker = isPlayer and "player" or "opponent",
      move = action.move,
      missed = action.missed,
      shieldDamage = action.shieldDamage,
      healthDamage = action.healthDamage,
      statsChanged = action.changes,
      superEffective = action.superEffective,
      notEffective = action.notEffective
    }
    table.insert(battle.turns, turnInfo)
  end
  
  -- Update battle logs
  battleLogs[battleId] = battle.turns
  
  -- Check battle outcome
  local playerWon = battle.opponent.healthPoints <= 0
  local opponentWon = battle.player.healthPoints <= 0
  
  if playerWon or opponentWon then
    return {
      battleOver = true,
      playerWon = playerWon
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
    
    -- Refresh player's move counts
    local refreshedMoves = refreshMonsterCounts(userId)
    if not refreshedMoves then
      print("Error: Could not refresh move counts")
      ao.send({
        Target = msg.From,
        Data = json.encode({
          status = "error",
          message = "Could not refresh move counts"
        })
      })
      return
    end
    
-- Initialize battle object with player address and health points
    local battle = {
      id = battleId,
      player = json.decode(json.encode(playerMonster)), -- Deep copy
      opponent = opponent,
      startTime = os.time() * 1000,
      turns = {},
      stats = battles[userId], -- Store battle stats in active battle
      moveCounts = {
        player = {},
        opponent = {}
      },
      hasUsedStruggle = { player = false, opponent = false }, -- Track struggle usage
      status = "battling" -- Add status field
    }
    
    -- Set refreshed move counts (deep copy to avoid modifying original)
    battle.player.moves = json.decode(json.encode(refreshedMoves))

    -- Validate and initialize player moves
    for name, move in pairs(battle.player.moves) do
        if not move.name then move.name = name end
        if not move.damage then move.damage = 0 end
        if not move.attack then move.attack = 0 end
        if not move.speed then move.speed = 0 end
        if not move.defense then move.defense = 0 end
        if not move.health then move.health = 0 end
        if not move.count then move.count = 1 end
    end

    -- Opponent moves should already be initialized with fresh counts from createOpponent
    print("Battle initialized with moves - Player:", json.encode(battle.player.moves))
    print("Battle initialized with moves - Opponent:", json.encode(battle.opponent.moves))
    
    -- No need to initialize move counts as we'll use the count property in each move
    
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
    
    -- Check if all moves are depleted
    local allMovesUsed = true
    for _, move in pairs(battle.player.moves) do
      if (move.count or 0) > 0 then
        allMovesUsed = false
        break
      end
    end

    -- Handle struggle move
    local playerMove
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
      playerMove = createStruggleMove(battle.player)
    else
      -- Validate regular move and move count
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

      -- Get the move and check uses remaining
      playerMove = battle.player.moves[moveName]
      if (playerMove.count or 0) <= 0 then
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
    
    -- Get list of NPC moves that have uses remaining
    local availableNpcMoves = {}
    print("Opponent moves table:", json.encode(battle.opponent.moves))
    
    -- Build array of valid moves with deep copies
    for name, move in pairs(battle.opponent.moves) do
        print("Checking move:", name)
        print("Move details:", json.encode(move))
        if move and type(move) == "table" and (move.count or 0) > 0 then
            -- Create a deep copy of the move
            local moveCopy = {
                name = name,
                count = move.count,
                damage = move.damage or 0,
                attack = move.attack or 0,
                speed = move.speed or 0,
                defense = move.defense or 0,
                health = move.health or 0,
                type = move.type or battle.opponent.elementType
            }
            print("Adding move to available list:", name)
            print("Move copy:", json.encode(moveCopy))
            table.insert(availableNpcMoves, moveCopy)
        end
    end
    
    print("Available NPC moves array:", json.encode(availableNpcMoves))
    
    -- Check if all NPC moves are used up
    local npcMove
    if #availableNpcMoves == 0 then
        print("NPC using struggle - all moves depleted")
        npcMove = createStruggleMove(battle.opponent)
    else
        -- Get random move from available moves array
        local selectedIndex = math.random(#availableNpcMoves)
        npcMove = availableNpcMoves[selectedIndex]
        print("Selected move index:", selectedIndex)
        print("Selected move:", json.encode(npcMove))
        
        if not npcMove then
            print("Error: Selected move is nil, falling back to struggle")
            npcMove = createStruggleMove(battle.opponent)
        end
    end
    
    
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
    
    -- Ensure moves have name field
    if not playerMove.name then
        playerMove.name = "Struggle"
    end
    if not npcMove.name then
        npcMove.name = "Struggle"
    end

    -- Ensure both moves have all required fields
    for _, move in pairs({playerMove, npcMove}) do
        if not move.damage then move.damage = 0 end
        if not move.attack then move.attack = 0 end
        if not move.speed then move.speed = 0 end
        if not move.defense then move.defense = 0 end
        if not move.health then move.health = 0 end
        if not move.count then move.count = 1 end
    end

    -- Process the battle turn
    print("Processing battle turn")
    print("Player move:", json.encode(playerMove))
    print("NPC move:", json.encode(npcMove))
    local result = processBattleTurn(battleId, playerMove, npcMove)
    print("Battle turn result:", json.encode(result))
    
    if result.battleOver then
      local playerWon = result.playerWon
      local session = recordBattle(userId, playerWon)
      battle.stats = session
      battle.status = "ended"
      
      local finalLogs = battleLogs[battleId]
      
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
            battle = battle
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
    
    -- Record battle result if not already recorded
    local playerWon = battle.opponent.healthPoints <= 0
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
          session = currentSession,
          turns = finalLogs
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
    activeBattles[userId] = nil
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
