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
          attack = 0,
          defense = 0,
          speed = 0,
          health =0
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
      selectedMove.name = moveName
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
      -- Track struggle usage TODO SEE IF THIS IS RIGHT
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
  