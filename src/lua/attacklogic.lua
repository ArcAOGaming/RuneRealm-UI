-- Attack Logic Module

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
    if move.damage <= 0 then return 0 end
    
    -- Base damage from move
    local damage = move.damage
    
    -- Add random bonus based on attacker's base attack
    local bonus = getRandom(1, attacker.attack)
    damage = damage + bonus
    
    -- Apply type effectiveness
    local effectiveness = getTypeEffectiveness(move.type, defender.elementType)
    damage = damage * effectiveness
    
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

-- Process a single attack
local function processAttack(attacker, defender, move)
    -- Decrement move count
    if move.count then
        move.count = move.count - 1
    end
    
    -- Check if attack hits
    local hits = doesAttackHit(attacker.speed, defender.speed)
    if not hits then
        return {
            missed = true,
            attacker = attacker.name,
            move = move.name
        }
    end
    
    -- Calculate and apply damage
    local damage, effectiveness = calculateDamage(move, attacker, defender)
    local shieldDamage, healthDamage = applyDamage(defender, damage)
    
    -- Apply stat changes to attacker
    local statChanges = applyStatChanges(attacker, move)
    
    return {
        missed = false,
        attacker = attacker.name,
        move = move.name,
        shieldDamage = shieldDamage,
        healthDamage = healthDamage,
        changes = statChanges,
        superEffective = effectiveness > 1,
        notEffective = effectiveness < 1
    }
end

-- Create struggle move for when all moves are depleted
function createStruggleMove(monster)
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
function processTurn(attacker, defender, attackerMove, defenderMove)
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
