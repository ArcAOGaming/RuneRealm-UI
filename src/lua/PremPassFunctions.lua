-- Function to add loot boxes to a user's mapping
function addLootBoxes(userId, numLootBoxes, rarity)
    -- Ensure the user has a table to store loot boxes
    if not UserLootBoxes[userId] then
        UserLootBoxes[userId] = {}
    end
  
    -- Add the loot boxes for the user
    for i = 1, numLootBoxes do
        table.insert(UserLootBoxes[userId], rarity)
    end
  end
  
  
  -- Constants to define base probabilities and unlock requirements
  local BASE_PROBABILITIES = {
    fireBerry = { chance = 800, minBox = 1, baseAmount = 5 },
    waterBerry = { chance = 800, minBox = 1, baseAmount = 5 },
    rockBerry = { chance = 800, minBox = 1, baseAmount = 5 },
    airBerry = { chance = 800, minBox = 1, baseAmount = 5 },
    ruby = { chance = 400, minBox = 2, baseAmount = 3 },
    emerald = { chance = 500, minBox = 2, baseAmount = 3 },
    topaz = { chance = 300, minBox = 3, baseAmount = 2 },
    scroll = { chance = 200, minBox = 3, baseAmount = 1 },
    diamond = { chance = 100, minBox = 4, baseAmount = 1 },
    legendaryScroll = { chance = 50, minBox = 5, baseAmount = 1 }
  }
  
  -- Function to roll a loot chest
  function RollLootChest(rarity, userId)
    local lootRewards = {}
    local baseMultiplier = 1.5 ^ (rarity - 1)  -- Increases reward chances for higher tiers
    local roll = getRandom(1, 1000)  -- Single roll to determine loot
  
    for item, data in pairs(BASE_PROBABILITIES) do
        if rarity >= data.minBox and getRandom(1, 1000) <= (data.chance * baseMultiplier) then
            local unluckyRoll = getRandom(1, 100)  -- Chance to get more or less
            local amount = data.baseAmount
            if unluckyRoll <= 20 then
                amount = math.max(1, math.floor(amount * 0.5))  -- 20% chance to get half
            elseif unluckyRoll >= 80 then
                amount = math.ceil(amount * 1.5)  -- 20% chance to get 1.5x
            end
            lootRewards[item] = amount
        end
    end
  
    -- Prepare the reward list for sending
    local AllTokenshandedout = {}
    local tokenMapping = {
        fireBerry = FIRE_BERRY,
        waterBerry = WATER_BERRY,
        rockBerry = ROCK_BERRY,
        airBerry = AIR_BERRY,
        ruby = RUBY_TOKEN,
        emerald = EMERALD_TOKEN,
        topaz = TOPOZ_TOKEN,
        scroll = SCROLL_TOKEN,
        diamond = DIAMOND_TOKEN,
        legendaryScroll = LEGENDARY_SCROLL_TOKEN
    }
  
    for reward, count in pairs(lootRewards) do
        table.insert(AllTokenshandedout, { token = tokenMapping[reward], quantity = count })
    end
  
    -- Grant rewards to the user
    for _, item in ipairs(AllTokenshandedout) do
        ao.send({
            Target = item.token,
            Action = "Grant",
            Quantity = tostring(item.quantity),
            Recipient = userId
        })
    end
  
    -- Send final loot message to the user
    ao.send({
        Target = userId,
        Data = json.encode({
            result = AllTokenshandedout,
            rarity = rarity
        })
    })
  end


  -- Function to adjust activities for all monsters
function adjustAllMonsters()
    -- Map faction names to berry process IDs
    
    for userId, monster in pairs(UserMonsters) do
      --addLootBoxes(userId,1,1)
      local factionName = UserFactions[userId].faction
      local moves = GetRandomMoves(monstersMAP[factionName].element)
      monster.moves = moves
      monster.name = monstersMAP[factionName].name
      monster.image = monstersMAP[factionName].image
      monster.sprite = monstersMAP[factionName].sprite
      monster.elementType = monstersMAP[factionName].element
      monster.activities = {
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
    end
  end

  function AdminSendToBattle(userId)
    local monster = UserMonsters[userId]
        -- Send monster to battle
        ao.send({
          Target = "3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs",
          Tags = {
            Action = "BeginBattles",
            UserId = userId
          },
          Data = json.encode(monster)
        })
  end

  -- Helper function to check if an activity is complete
function isActivityComplete(status, currentTime)
    if not status or not status.until_time then
      return false
    end
    return currentTime >= status.until_time
  end

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
    
      -- Function to remove a user's faction
      function RemoveUserFaction(userId)
        if UserFactions[userId] then
          UserFactions[userId] = nil
          print("Removed user's faction: " .. userId)
          return true
        end
        print("User faction not found: " .. userId)
        return false
      end
    
      -- Function to remove a user's monster
      function RemoveUserMonster(userId)
        if UserMonsters[userId] then
          UserMonsters[userId] = nil
          print("Removed user's monster: " .. userId)
          return true
        end
        print("User monster not found: " .. userId)
        return false
      end

      -- Function to count members and monsters in a faction
function GetFactionStats(factionName)
    local memberCount = 0
    local monsterCount = 0
    local members = {}
    local totalLevel = 0
    local totalTimesFed = 0
    local totalTimesPlay = 0
    local totalTimesMission = 0
    
    for userId, userFaction in pairs(UserFactions) do
      if userFaction.faction == factionName then
        memberCount = memberCount + 1
        local memberInfo = {
          id = userId,
          level = 0,
          timesFed = 0,
          timesPlay = 0,
          timesMission = 0
        }
        
        if UserMonsters[userId] then
          local monster = UserMonsters[userId]
          monsterCount = monsterCount + 1
          memberInfo.level = monster.level
          memberInfo.timesFed = monster.totalTimesFed or 0
          memberInfo.timesPlay = monster.totalTimesPlay or 0
          memberInfo.timesMission = monster.totalTimesMission or 0
          
          totalLevel = totalLevel + monster.level
          totalTimesFed = totalTimesFed + (monster.totalTimesFed or 0)
          totalTimesPlay = totalTimesPlay + (monster.totalTimesPlay or 0)
          totalTimesMission = totalTimesMission + (monster.totalTimesMission or 0)
        end
        
        table.insert(members, memberInfo)
      end
    end
    
    return memberCount, monsterCount, members, totalLevel / (monsterCount > 0 and monsterCount or 1),
           totalTimesFed, totalTimesPlay, totalTimesMission
  end

  -- Function to check if a value exists in a table
function UnlockedSkin(value)
  for _, v in pairs(Unlocked) do
    if v == value then
      return true
    end
  end
  return false
end

function UpdateSkin(userId, spriteTxId)
    print('Changing ' .. userId .. "'s Skin to " .. (spriteTxId or BaseSprite))

    ao.send({
        Target = TARGET_WORLD_PID,
        Tags = {
            Action = "Reality.UpdateSpriteTxId",
            EntityID = userId,
            SpriteTxId = spriteTxId or BaseSprite,
            SpriteAtlasTxId = BaseSpriteAtlas
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