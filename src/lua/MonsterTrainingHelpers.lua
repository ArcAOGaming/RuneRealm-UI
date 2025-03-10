-- Function to handle loot chest roll based on rarity
function RollLootChest(rarity, userId)
    local AllTokenshandedout = {}

    -- Berry tokens (common)
    local fireBerryCount = 0
    local waterBerryCount = 0
    local rockBerryCount = 0
    local airBerryCount = 0
    
    -- Gem tokens (rarer)
    local rubyCount = 0
    local emeraldCount = 0
    local topazCount = 0

    -- Scroll token (very rare)
    local scrollCount = 0

    -- Adjust the rarity logic
    if rarity == 1 then  -- Common loot
        -- Give out more berries
        fireBerryCount = getRandom(5, 15)
        waterBerryCount = getRandom(5, 15)
        rockBerryCount = getRandom(5, 15)
        airBerryCount = getRandom(5, 15)
        
    elseif rarity == 2 then  -- Uncommon loot
        -- Give fewer berries, some gems
        fireBerryCount = getRandom(3, 10)
        waterBerryCount = getRandom(3, 10)
        rockBerryCount = getRandom(3, 10)
        airBerryCount = getRandom(3, 10)
        
        -- Add a chance for gems
        if getRandom(1, 100) <= 40 then
            rubyCount = getRandom(1, 3)
        end
        if getRandom(1, 100) <= 60 then
            emeraldCount = getRandom(1, 3)
        end
        
    elseif rarity == 3 then  -- Rare loot
        -- Very few berries, mostly gems and scrolls
        fireBerryCount = getRandom(1, 5)
        waterBerryCount = getRandom(1, 5)
        rockBerryCount = getRandom(1, 5)
        airBerryCount = getRandom(1, 5)

        -- Rare gems and scrolls
        rubyCount = getRandom(1, 2)
        emeraldCount = getRandom(1, 2)
        topazCount = getRandom(1, 2)

        -- Scroll token very rare
        if getRandom(1, 100) <= 10 then
            scrollCount = getRandom(1, 1)
        end
    end

    -- Add all the tokens to the handout list
    if fireBerryCount > 0 then
        table.insert(AllTokenshandedout, { token = FIRE_BERRY, quantity = fireBerryCount })
    end
    if waterBerryCount > 0 then
        table.insert(AllTokenshandedout, { token = WATER_BERRY, quantity = waterBerryCount })
    end
    if rockBerryCount > 0 then
        table.insert(AllTokenshandedout, { token = ROCK_BERRY, quantity = rockBerryCount })
    end
    if airBerryCount > 0 then
        table.insert(AllTokenshandedout, { token = AIR_BERRY, quantity = airBerryCount })
    end
    if rubyCount > 0 then
        table.insert(AllTokenshandedout, { token = RUBY_TOKEN, quantity = rubyCount })
    end
    if emeraldCount > 0 then
        table.insert(AllTokenshandedout, { token = EMERALD_TOKEN, quantity = emeraldCount })
    end
    if topazCount > 0 then
        table.insert(AllTokenshandedout, { token = TOPOZ_TOKEN, quantity = topazCount })
    end
    if scrollCount > 0 then
        table.insert(AllTokenshandedout, { token = SCROLL_TOKEN, quantity = scrollCount })
    end

    -- Send out the loot to the user
    for _, item in ipairs(AllTokenshandedout) do
        ao.send({
            Target = Token,
            Action = "Grant",
            Quantity = item.quantity,
            Recipient = userId,
        })
    end

    -- Final message to the user
    ao.send({
        Target = userId,
        Data = json.encode({
            result = AllTokenshandedout
        })
    })
end