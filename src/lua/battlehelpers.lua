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


    -- Helper function to validate battle acceptance
 function validateBattleAcceptance(userId, challengerId)
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

    -- Helper function to get all available battles for a user
 function getAvailableBattles(userId)
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