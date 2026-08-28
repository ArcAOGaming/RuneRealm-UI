--- battle.lua — RuneRealm combat, as pure functions over a battle table.
---
--- Rewritten from RuneRealm-LUA/Lua/frontend/battle/{attacklogic,MultiBattle}.lua.
--- No handlers and no globals live here so the whole engine can be exercised by
--- battle_test.lua on a public node's ~lua@5.3a for free, with no wallet.
---
--- Bugs in the original that this fixes — all of them were live:
---
---   1. Attacks could not miss.  `local hits = move.damage > 0 and
---      doesAttackHit(a, d) or true` is `(damage>0 and hit) or true`: when the
---      roll said miss, `false or true` evaluated to true. Speed did nothing.
---
---   2. Type effectiveness never applied. See constants.lua — the chart was
---      keyed "Fire" while every move type was "fire".
---
---   3. `getRandom(#availableMoves)` passed one argument to a two-argument
---      wrapper, so picking a bot's move raised "bad argument #2" whenever the
---      bot had any moves left. Bots only ever struggled.
---
---   4. The turn log read `action.name` and `action.moveName`, neither of which
---      processAttack returned, so every entry the client rendered had a nil
---      monster name and a nil move name.
---
---   5. Shield regeneration was skipped for a side that had *ever* struggled,
---      which is not what "struggle" means anywhere else in the game.
---
---   6. A depleted move was decremented before the "no uses remaining" check in
---      one path and after it in another, so counts could go negative.
---
--- Bundled as:  local Battle = (function() ... end)()

local Battle = {}

--- Tuning.
---
--- Damage, health, shields and healing have to scale together or the game has a
--- different shape at every level. The original scaled only health: damage was
--- `move.damage * 5 + random(0, attack)`, flat, while HP grew with the health
--- stat forever. With type effectiveness switched back on that made 13-23% of
--- low-level fights end on the first swing, and 12% of level-20 fights run past
--- thirty rounds.
---
--- These are a table rather than locals so `balance.lua` can sweep them on a
--- live node and pick the numbers by measurement. Change one, then re-run
--- `./run-balance.sh` — it reports median rounds, first-round knockouts and
--- grinds at every level.
Battle.TUNING = {
  baseHitChance = 0.70,
  minHitChance = 0.30,
  maxHitChance = 0.95,

  --- damage = move.damage * (attackBase + attacker.attack)
  --- `attackBase` is small on purpose: attack has to MULTIPLY, or a stat point
  --- stops mattering by level 10.
  attackBase = 1,
  variance = 0.15,          -- +/- this fraction on every swing

  hpPerHealth = 12,         -- max HP = health stat * this
  shieldPerDefense = 4,     -- max shield = defense stat * this
  healPerPoint = 0.04,      -- one health point on a move = this share of max HP
  shieldRegen = 20,         -- shield recovers maxShield/this each round

  --- How many times each move can be used, as a multiple of its printed count.
  --- The printed counts total about eight uses across a four-move set, which a
  --- seven-round fight burns through — and once both sides are out, they
  --- struggle at one damage a swing and the fight stops being a fight. Running
  --- dry should be a late-fight pressure, not the normal case.
  moveUses = 3,
  --- Struggle has to be able to finish somebody, or an exhausted fight never
  --- ends. It is still much worse than any real move.
  struggleDamage = 2,

  --- How long a PvP round waits for the other player before it can be forced.
  ---
  --- Without this a fight stalls forever the moment somebody closes their
  --- laptop: their half of the round never arrives, and the player who did move
  --- can only forfeit — losing the win and the paid session to someone who
  --- simply stopped playing.
  pvpMoveDeadline = 3 * 60 * 1000,

  --- A fight that reaches this many rounds is decided on remaining health.
  ---
  --- Without it a fight can genuinely run forever: two defensive companions
  --- regenerate more shield per round than a struggle can remove, and both
  --- sides sit at full health indefinitely. Measured at over two thousand
  --- rounds with no end in sight. The only escape was forfeiting the whole
  --- paid session.
  roundCap = 50,
}

local T = Battle.TUNING

--- C is injected rather than required so the test harness can supply a stub.
local C

function Battle.configure(constants)
  C = constants
end

-- Helpers -------------------------------------------------------------------

local function clone(t)
  if type(t) ~= "table" then return t end
  local out = {}
  for k, v in pairs(t) do out[k] = clone(v) end
  return out
end
Battle.clone = clone

local function rand(low, high)
  low = math.tointeger(low) or 0
  high = math.tointeger(high) or low
  if high <= low then return low end
  return math.random(low, high)
end
Battle.rand = rand

local function effectiveness(moveType, defenderElement)
  if not moveType or not defenderElement then return 1.0 end
  local row = C.EFFECTIVENESS[moveType]
  if not row then return 1.0 end          -- boost / heal / normal are neutral
  return row[defenderElement] or 1.0
end
Battle.effectiveness = effectiveness

--- Faster attackers land more; slower ones are punished harder than they are
--- rewarded, which is what makes the speed stat worth buying.
local function hitChance(attackerSpeed, defenderSpeed)
  local diff = math.max(0, attackerSpeed or 0) - math.max(0, defenderSpeed or 0)
  local modifier
  if diff > 0 then
    modifier = math.min(0.25, diff * 0.08)
  else
    modifier = math.max(-0.40, diff * 0.10)
  end
  local chance = T.baseHitChance + modifier
  return math.max(T.minHitChance, math.min(T.maxHitChance, chance))
end
Battle.hitChance = hitChance

-- Combatants ----------------------------------------------------------------

--- Turn a monster record into a combatant: a working copy with battle-only
--- fields. The source monster is never mutated — the original passed the live
--- record straight in, so a fight permanently drained the pet's move counts.
function Battle.combatant(monster, side, address)
  local m = clone(monster)
  m.side = side
  m.address = address
  m.maxHealthPoints = math.max(1, (m.health or 1) * T.hpPerHealth)
  m.healthPoints = m.maxHealthPoints
  m.maxShield = math.max(0, (m.defense or 0) * T.shieldPerDefense)
  m.shield = m.maxShield
  -- Base stats are kept so the client can show how far a buff has drifted.
  m.baseAttack, m.baseDefense, m.baseSpeed = m.attack, m.defense, m.speed
  m.moves = m.moves or {}
  for name, move in pairs(m.moves) do
    move.name = name
    move.count = math.max(1, (math.tointeger(move.count) or 1) * T.moveUses)
  end
  return m
end

--- What an absent player does. No damage, no riders, no cost — it is a pass,
--- not a punishment, so forcing a round is fair to whoever wandered off.
function Battle.hesitate()
  return {
    name = "Hesitated",
    type = "normal",
    rarity = 0,
    count = math.maxinteger,
    damage = 0, attack = 0, speed = 0, defense = 0, health = 0,
  }
end

function Battle.struggle(monster)
  return {
    name = "Struggle",
    type = "normal",
    rarity = 0,
    count = math.maxinteger,
    damage = T.struggleDamage, attack = 0, speed = 0, defense = 0, health = 0,
  }
end

function Battle.hasMovesLeft(monster)
  for _, move in pairs(monster.moves or {}) do
    if (math.tointeger(move.count) or 0) > 0 then return true end
  end
  return false
end

--- Pick a move for an NPC. Prefers damage when the opponent is nearly dead and
--- healing when it is itself hurt, so bot fights are not pure coin flips.
function Battle.chooseNpcMove(npc, opponent)
  local available = {}
  for name, move in pairs(npc.moves or {}) do
    if (math.tointeger(move.count) or 0) > 0 then
      move.name = name
      available[#available + 1] = move
    end
  end
  if #available == 0 then return Battle.struggle(npc) end

  local hurt = npc.healthPoints <= npc.maxHealthPoints * 0.35
  local finishing = opponent.healthPoints <= opponent.maxHealthPoints * 0.25

  local preferred = {}
  for _, move in ipairs(available) do
    if finishing and move.damage > 0 then
      preferred[#preferred + 1] = move
    elseif hurt and not finishing and move.health > 0 then
      preferred[#preferred + 1] = move
    end
  end
  local pool = #preferred > 0 and preferred or available
  return pool[rand(1, #pool)]
end

-- Resolution ----------------------------------------------------------------

local function applyDamage(target, amount)
  local shieldDamage = 0
  if target.shield > 0 then
    shieldDamage = math.min(amount, target.shield)
    target.shield = target.shield - shieldDamage
    amount = amount - shieldDamage
  end
  local healthDamage = 0
  if amount > 0 then
    healthDamage = amount
    target.healthPoints = math.max(0, target.healthPoints - healthDamage)
  end
  return shieldDamage, healthDamage
end

--- Stat riders apply to whoever used the move. Defense also moves the shield,
--- and health is a heal or a cost in HP, never a change to the base stat.
local function applyStatChanges(user, move)
  local changed = {}
  if move.attack ~= 0 then
    user.attack = math.max(0, user.attack + move.attack)
    changed.attack = move.attack
  end
  if move.speed ~= 0 then
    user.speed = math.max(0, user.speed + move.speed)
    changed.speed = move.speed
  end
  if move.defense ~= 0 then
    user.defense = math.max(0, user.defense + move.defense)
    user.maxShield = math.max(user.maxShield, user.defense * T.shieldPerDefense)
    user.shield = math.max(0, user.shield + move.defense * T.shieldPerDefense)
    changed.defense = move.defense
  end
  if move.health ~= 0 then
    -- Healing is a fraction of the user's own pool, not a flat number. A flat
    -- heal is a full reset at level 0 and a rounding error at level 20.
    local delta = math.floor(move.health * T.healPerPoint * user.maxHealthPoints)
    if delta > 0 then
      user.healthPoints = math.min(user.maxHealthPoints, user.healthPoints + delta)
    else
      -- A self-cost can bring you low but never kills you outright.
      user.healthPoints = math.max(1, user.healthPoints + delta)
    end
    changed.health = move.health
  end
  return changed
end

--- One monster acts. Returns the log entry the client renders.
local function act(attacker, defender, move)
  if move.count ~= math.maxinteger then
    move.count = math.max(0, (math.tointeger(move.count) or 0) - 1)
  end

  local entry = {
    attacker = attacker.side,
    attackerAddress = attacker.address,
    monsterName = attacker.name,
    move = move.name,
    moveType = move.type,
    moveRarity = move.rarity or 0,
    missed = false,
    shieldDamage = 0,
    healthDamage = 0,
    statsChanged = {},
    superEffective = false,
    notEffective = false,
  }

  -- Only offensive moves can whiff. A heal or a buff always lands.
  if move.damage > 0 and rand(1, 100) > hitChance(attacker.speed, defender.speed) * 100 then
    entry.missed = true
    entry.attackerState = Battle.snapshot(attacker)
    entry.defenderState = Battle.snapshot(defender)
    return entry
  end

  if move.damage > 0 then
    local mult = effectiveness(move.type, defender.elementType)
    -- Attack multiplies rather than adds, so a stat point stays worth something
    -- at level 20. Variance is a flat percentage band for the same reason.
    local raw = move.damage * (T.attackBase + (attacker.attack or 0))
    local swing = 1.0 + (rand(0, 200) - 100) / 100 * T.variance
    local damage = math.max(1, math.floor(raw * mult * swing))
    entry.shieldDamage, entry.healthDamage = applyDamage(defender, damage)
    entry.superEffective = mult > 1.0
    entry.notEffective = mult < 1.0
  end

  entry.statsChanged = applyStatChanges(attacker, move)
  entry.attackerState = Battle.snapshot(attacker)
  entry.defenderState = Battle.snapshot(defender)
  return entry
end

function Battle.snapshot(m)
  return {
    side = m.side,
    name = m.name,
    healthPoints = m.healthPoints,
    maxHealthPoints = m.maxHealthPoints,
    shield = m.shield,
    maxShield = m.maxShield,
    attack = m.attack,
    defense = m.defense,
    speed = m.speed,
    elementType = m.elementType,
  }
end

--- Who swings first: speed plus a d5, coin flip on a tie.
local function challengerFirst(a, b)
  local ra = (a.speed or 0) + rand(1, 5)
  local rb = (b.speed or 0) + rand(1, 5)
  if ra == rb then return rand(1, 2) == 1 end
  return ra > rb
end

--- Resolve a move name against a combatant, or return nil plus a reason.
function Battle.selectMove(monster, moveName)
  if moveName == "struggle" or moveName == "Struggle" then
    if Battle.hasMovesLeft(monster) then
      return nil, "Cannot struggle while other moves remain"
    end
    return Battle.struggle(monster)
  end
  local move = monster.moves[moveName]
  if not move then return nil, "Unknown move '" .. tostring(moveName) .. "'" end
  if (math.tointeger(move.count) or 0) <= 0 then
    return nil, "'" .. moveName .. "' has no uses remaining"
  end
  move.name = moveName
  return move
end

--- Play one full round. Both moves resolve; a monster reduced to 0 HP does not
--- get to answer. Returns the log entries for the round.
function Battle.resolveRound(battle, challengerMove, accepterMove)
  local a, b = battle.challenger, battle.accepter
  local entries = {}

  local first, second, firstMove, secondMove
  if challengerFirst(a, b) then
    first, second, firstMove, secondMove = a, b, challengerMove, accepterMove
  else
    first, second, firstMove, secondMove = b, a, accepterMove, challengerMove
  end

  entries[#entries + 1] = act(first, second, firstMove)
  if second.healthPoints > 0 then
    entries[#entries + 1] = act(second, first, secondMove)
  end

  battle.round = (battle.round or 0) + 1
  battle.turns = battle.turns or {}
  for _, e in ipairs(entries) do
    e.round = battle.round
    battle.turns[#battle.turns + 1] = e
  end

  -- Shields recover a fraction of their cap each round. Everyone gets this;
  -- the original withheld it from anyone who had ever struggled.
  --
  -- The regen is capped BELOW what a bare struggle removes. Otherwise two
  -- defensive companions regenerate faster than either can chip, and the fight
  -- is arithmetically unwinnable — which is exactly what happened.
  local struggleFloor = T.struggleDamage * (T.attackBase + 1)
  for _, m in ipairs({ a, b }) do
    if m.healthPoints > 0 then
      local regen = math.min(math.ceil(m.maxShield / T.shieldRegen),
                             math.max(0, struggleFloor - 1))
      m.shield = math.min(m.maxShield, m.shield + regen)
    end
  end

  if a.healthPoints <= 0 or b.healthPoints <= 0 then
    battle.status = "ended"
    -- Both down in the same round is a loss for the challenger; the defender
    -- survives a mutual knockout.
    battle.winner = (b.healthPoints <= 0 and a.healthPoints > 0) and "challenger" or "accepter"
  elseif battle.round >= T.roundCap then
    -- Time. Whoever is in better shape takes it; a dead-level draw goes to the
    -- defender, same as a mutual knockout.
    battle.status = "ended"
    battle.timedOut = true
    local aShare = a.healthPoints / math.max(1, a.maxHealthPoints)
    local bShare = b.healthPoints / math.max(1, b.maxHealthPoints)
    battle.winner = aShare > bShare and "challenger" or "accepter"
  end

  -- The log is published on every message and grows about a kilobyte a round,
  -- so only the recent history is kept. The full fight is still visible round
  -- by round as it happens; what is dropped is the far past of a long one.
  local keep = T.roundCap * 2
  if #battle.turns > keep then
    local trimmed = {}
    for i = #battle.turns - keep + 1, #battle.turns do
      trimmed[#trimmed + 1] = battle.turns[i]
    end
    battle.turns = trimmed
    battle.turnsTrimmed = true
  end

  return entries
end

-- Construction --------------------------------------------------------------

--- Build an NPC scaled to the player, so a level 12 pet is not handed a level 1
--- punching bag and a level 0 pet is not executed. The original always spawned
--- a level 1 monster with randomly rolled stats regardless of who it faced.
function Battle.makeOpponent(playerLevel, opts)
  opts = opts or {}
  local factions = C.FACTIONS
  local faction = opts.faction and C.FACTION_BY_NAME[opts.faction]
    or factions[rand(1, #factions)]

  local level = math.max(0, math.tointeger(playerLevel) or 0)
  local difficulty = opts.difficulty or 1.0
  -- Stats track the player's own budget: 10 at level 0, +2 per level, spread
  -- over four stats with a floor of 1 each.
  local budget = math.max(4, math.floor((10 + level * 2) * difficulty))
  local stats = { attack = 1, defense = 1, speed = 1, health = 1 }
  local names = { "attack", "defense", "speed", "health" }
  local remaining = budget - 4
  while remaining > 0 do
    local pick = names[rand(1, 4)]
    stats[pick] = stats[pick] + 1
    remaining = remaining - 1
  end

  local monster = {
    name = faction.monster.name,
    image = faction.monster.image,
    sprite = faction.monster.sprite,
    elementType = faction.element,
    faction = faction.name,
    level = level,
    attack = stats.attack,
    defense = stats.defense,
    speed = stats.speed,
    health = stats.health,
    moves = Battle.rollMoves(faction.element),
  }
  return monster
end

--- Four moves: one or two of the monster's own element, then one each from the
--- pools it did not draw from. Guarantees a heal is available unless the second
--- element roll displaced it.
function Battle.rollMoves(element)
  -- An element with no pool would raise here. It can only arrive via an admin
  -- write, but a bad admin write should be an error message, not a dead
  -- process.
  local pool = C.MOVE_POOLS[element] or C.MOVE_POOLS.normal
  element = C.MOVE_POOLS[element] and element or "normal"
  local names = {}
  for name in pairs(pool) do names[#names + 1] = name end
  table.sort(names)  -- pairs() order varies; sort so a seed reproduces a roll

  local chosen = {}
  local idx = rand(1, #names)
  chosen[names[idx]] = clone(pool[names[idx]])

  if rand(1, 100) <= 25 and #names > 1 then
    table.remove(names, idx)
    local second = names[rand(1, #names)]
    chosen[second] = clone(pool[second])
    -- Two element moves means two support moves, drawn from different pools.
    local support = { "boost", "heal", "normal" }
    for _ = 1, 2 do
      local pickIndex = rand(1, #support)
      local kind = table.remove(support, pickIndex)
      local kindNames = {}
      for n in pairs(C.MOVE_POOLS[kind]) do kindNames[#kindNames + 1] = n end
      table.sort(kindNames)
      local n = kindNames[rand(1, #kindNames)]
      chosen[n] = clone(C.MOVE_POOLS[kind][n])
    end
  else
    for _, kind in ipairs({ "boost", "heal", "normal" }) do
      local kindNames = {}
      for n in pairs(C.MOVE_POOLS[kind]) do kindNames[#kindNames + 1] = n end
      table.sort(kindNames)
      local n = kindNames[rand(1, #kindNames)]
      chosen[n] = clone(C.MOVE_POOLS[kind][n])
    end
  end

  for name, move in pairs(chosen) do move.name = name end

  -- A moveset with nothing that deals damage is a dead end, and the original
  -- could roll one: Campfire, Power Up, Heal and Momentum Shift are all zero
  -- damage. Two such companions cannot hurt each other until every move is
  -- spent and both are reduced to struggling for a point a swing, which is what
  -- was producing fights of fifty-plus rounds. Guarantee a weapon.
  local armed = false
  for _, move in pairs(chosen) do
    if move.damage > 0 then armed = true break end
  end
  if not armed then
    local hitters = {}
    for name, move in pairs(C.MOVE_POOLS[element]) do
      if move.damage > 0 then hitters[#hitters + 1] = name end
    end
    for name, move in pairs(C.MOVE_POOLS.normal) do
      if move.damage > 0 then hitters[#hitters + 1] = name end
    end
    table.sort(hitters)
    local pick = hitters[rand(1, #hitters)]
    -- Displace whichever move is cheapest to lose: the highest rarity number is
    -- the most common one.
    local worst, worstRarity = nil, -1
    for name, move in pairs(chosen) do
      if (move.rarity or 0) > worstRarity then worst, worstRarity = name, move.rarity or 0 end
    end
    chosen[worst] = nil
    local source = C.MOVE_POOLS[element][pick] or C.MOVE_POOLS.normal[pick]
    chosen[pick] = clone(source)
    chosen[pick].name = pick
  end

  return chosen
end

--- A battle the client can render. `id` is supplied by the caller so it can be
--- derived from the message rather than a clock.
function Battle.new(id, challengerMonster, challengerAddress, accepterMonster, accepterAddress, opts)
  opts = opts or {}
  local battle = {
    id = tostring(id),
    kind = opts.kind or "bot",
    status = "battling",
    round = 0,
    turns = {},
    startedAt = opts.timestamp or 0,
    challenger = Battle.combatant(challengerMonster, "challenger", challengerAddress),
    accepter = Battle.combatant(accepterMonster, "accepter", accepterAddress),
  }
  return battle
end

--- What the client is shown. Everything is passed through whole — dumverse's
--- port learned this the hard way: a `publicView` that dropped fields caused
--- three separate crashes in screens that read them.
--- What a client is allowed to see.
---
--- A pending PvP challenge has a challenger and no accepter yet, so neither
--- side can be assumed to exist here — publishing one is what surfaces the
--- challenge in the lobby before anybody has taken it.
---
--- `pendingMoves` is REMOVED, and that is the whole point of this function
--- existing rather than the battle going out raw. PvP resolves both moves
--- together, which is only meaningful if neither player can see the other's
--- choice first. It was going out on the wire — in the reply, in `/now/battle`
--- and in the player record — so whoever moved second could read the first
--- player's committed move and counter it. That is not simultaneous turns; it
--- is a game decided by who clicks later.
function Battle.view(battle)
  local v = clone(battle)
  v.pendingMoves = nil
  -- Who has moved is fine to know; what they picked is not.
  v.waitingOn = {}
  if battle.pendingMoves then
    v.waitingOn.challenger = battle.pendingMoves.challenger ~= nil
    v.waitingOn.accepter = battle.pendingMoves.accepter ~= nil
  end
  v.challengerAddress = battle.challenger and battle.challenger.address or nil
  v.accepterAddress = battle.accepter and battle.accepter.address or nil
  return v
end

return Battle
