
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
    
    --print("Here")
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

  -- Create struggle move for when all moves are depleted
  function createStruggleMove(monster)
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