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
  --- How far the speed stat may move the hit chance, as a SHARE of the gap
  --- between the two fighters rather than as a count of stat points.
  ---
  --- The original modifier was `diff * 0.08` upward and `diff * 0.10` down,
  --- clamped at +0.25 and -0.40. Both clamps are reached at a gap of four
  --- points, which means two things and both of them are wrong once a player is
  --- past level one:
  ---
  ---   * speed is a DEAD stat above the fourth point. Speed 5 and speed 100
  ---     are the same number against a speed-1 opponent, so every point after
  ---     the fourth buys nothing but the turn order.
  ---   * and it is a SWITCH. A build that bought no speed sits pinned at the
  ---     0.30 floor while the one that did sits at 0.95 -- a 3.2x swing in
  ---     landed damage, larger than the 2.4x that a 60-point attack lead
  ---     delivers. It is the single biggest reason a defensive build won 3% of
  ---     its level-20 games against a balanced one.
  ---
  --- A share is smooth and has no saturation point, so the fifth point of speed
  --- is worth something at level 20 the way it is at level 1, and the extremes
  --- stop being a coin flip.
  ---
  --- OFF, and this is the one lever here that is arguably a bug rather than a
  --- preference: at zero, every speed point after the fourth buys nothing. The
  --- measured value is 0.3 -- with a per-stat cap of three
  --- (`C.LEVEL_UP_MAX_PER_STAT`) that pair is the only configuration where all
  --- four builds sit at 44-56% in `./run-balance.sh matrix20`. Neither half
  --- works alone; see the note on the constant.
  speedSwing = 0,

  --- damage = move.damage * (attackBase + attacker.attack)
  --- `attackBase` is small on purpose: attack has to MULTIPLY, or a stat point
  --- stops mattering by level 10.
  attackBase = 1,
  --- A FLOOR under the attack stat, so that damage grows with a companion even
  --- when its owner never buys attack.
  ---
  --- Health and defense are multiplied on the way into a fight -- twelve HP and
  --- four shield per point -- and a player is handed ten points at every level.
  --- Damage is multiplied by nothing except the attack stat itself, so a build
  --- that spends all ten on health and defense grows an HP pool by 160 a level
  --- against damage that never grows at all. Two of those meet and neither can
  --- finish the other: measured at a 43-round median and a 100% exhaustion rate
  --- at level 20, which is both rosters spent and the rest of the fight decided
  --- by struggling at two damage a swing. That is the fight players report as
  --- unwinnable, and it is what these two exist to end.
  ---
  --- There are two ways to express the floor and only one of them is safe.
  ---
  --- `attackPerLevel` keys it on the LEVEL. It fixes PvP and destroys the bot
  --- ladder, because a player is handed ten points a level while
  --- `Battle.makeOpponent` builds a bot on `10 + level*2` -- about 210 points
  --- against 50 at level 20. A floor sized for the player's pool one-shots the
  --- bot's: measured at 50% first-round knockouts at level 10. It stays at
  --- zero, and stays at all only because the measurement is worth reproducing.
  ---
  --- `attackPerStatPoint` keys it on the fighter's OWN stat budget, frozen in
  --- `Battle.combatant` before a move's +attack rider can feed back into it. It
  --- is therefore large exactly where the health pools are large, which makes
  --- it correct on both curves at once. At 0.2, together with the shield regen
  --- below, every build matchup lands at a 4-14 round median and the level-10
  --- tank mirror drops from 29 rounds to 14.
  ---
  --- Zero reproduces the pre-2026-08-31 behaviour for either. Re-measure with
  --- `./run-balance.sh players` and `./run-balance.sh balance`.
  attackPerLevel = 0,
  attackPerStatPoint = 0.2,
  --- The budget the floor is measured FROM, not from zero.
  ---
  --- Every companion in the game -- a starter, a capture, a bot at level 0 --
  --- begins on ten points. Sizing the floor against the whole budget therefore
  --- tripled damage at level 1, where the health pools are 33 points deep, and
  --- put 18% of bot fights on the ladder at a first-round knockout. Measured
  --- against how far a companion has GROWN, the floor is nothing at level 1 and
  --- forty at a level-20 player, which is the whole point of it.
  attackBudgetBaseline = 10,
  variance = 0.15,          -- +/- this fraction on every swing

  --- Critical hits.
  ---
  --- The counterpart to a miss, and deliberately rarer than one: a miss is the
  --- floor of a swing and this is its ceiling, so a round has an upside worth
  --- watching as well as a downside. Rolled AFTER the hit check and only on
  --- damaging moves — a heal cannot crit, and a swing that missed never got as
  --- far as a damage number to multiply.
  ---
  --- Kept modest on purpose. At 1.6x a crit is a bad round for whoever takes
  --- it, not a coin flip that decides the fight: the median fight is seven
  --- rounds of roughly twelve swings, so about one swing in a fight lands as
  --- one, and two in a row is rare rather than routine.
  criticalChance = 0.09,
  criticalMultiplier = 1.6,

  --- How much of a swing the defense stat takes off, at most.
  ---
  --- Attack and defense are not symmetrical and never were. Attack MULTIPLIES:
  --- it applies to every swing a fighter gives, so its value grows with the
  --- length of the fight. Health and defense buy a POOL, which is spent once.
  --- Over a twelve-swing fight that makes an attack point worth about four
  --- health points, and the win-rate matrix says so out loud -- a pure
  --- defensive build won 8% of its level-10 games against a balanced one and 3%
  --- at level 20, while being the build most new players reach for.
  ---
  --- Raising `hpPerHealth` does not fix that. It scales both builds' pools by
  --- the same factor and leaves the ratio exactly where it was; all it buys is
  --- longer fights. The only thing that changes the ratio is giving the
  --- defensive stats something that multiplies too, which is this.
  ---
  --- Measured against the SHARE of a fighter's stat budget that sits in
  --- defense rather than against the raw number, so it is level-free by
  --- construction and does not need re-tuning every time the level cap moves.
  --- A build with half its points in defense earns the whole reduction; one
  --- with a fifth earns two fifths of it. Zero disables the mechanic.
  defenseMitigationMax = 0,
  --- The share of its budget a fighter needs in defense to earn the whole
  --- reduction. Half is what an all-in defensive build actually reaches, the
  --- other half having gone to health.
  defenseMitigationFullShare = 0.5,

  hpPerHealth = 12,         -- max HP = health stat * this
  shieldPerDefense = 4,     -- max shield = defense stat * this
  healPerPoint = 0.04,      -- one health point on a move = this share of max HP
  --- What a shield recovers at the end of a round in which its owner was NOT
  --- hit, as a share of its cap. Take a single point of damage and you recover
  --- nothing that round.
  ---
  --- A share of the CAP is a share of a number that grows with the defense
  --- stat, so this is the one recovery in the game that gets stronger the less
  --- it is needed: at 0.20 a level-20 defensive build recovered 82 shield a
  --- round, which is more than most swings against it removed. Lowered to 0.08
  --- alongside the attack floor above -- the pair is what the `players` profile
  --- was measured against, and neither of them alone clears the tank mirror.
  shieldRegenShare = 0.08,

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

--- Every move in the game, by name, built on first use.
---
--- Move names are unique across the pools, which is what makes a name a
--- sufficient key for a stored move -- see `Battle.compactMoves`.
local MOVE_BY_NAME = nil

function Battle.configure(constants)
  C = constants
  MOVE_BY_NAME = nil
end

-- Helpers -------------------------------------------------------------------

local function clone(t)
  if type(t) ~= "table" then return t end
  local out = {}
  for k, v in pairs(t) do out[k] = clone(v) end
  return out
end
Battle.clone = clone

-- Stored moves --------------------------------------------------------------
--
-- A move is nine fields, and eight of them -- type, rarity, damage, attack,
-- speed, defense, health, and the name itself -- are a verbatim copy of the
-- entry in `C.MOVE_POOLS`. Only `count`, the uses remaining, ever differs from
-- the definition.
--
-- Companions used to carry the whole thing. Half of every companion record was
-- therefore a duplicate of a constant: 511 bytes of 1025, measured, multiplied
-- by every companion in the process, sitting in the Lua heap that the node
-- photographs on every slot.
--
-- So the store keeps `{ count = n }` keyed by name, and the definition is put
-- back at the two doors where a move is actually needed: `Battle.combatant`,
-- which builds the fighter a round is resolved against, and the view layer,
-- which hands a companion to a client. Nothing between those doors reads a
-- move's numbers.

local function moveIndex()
  if MOVE_BY_NAME then return MOVE_BY_NAME end
  MOVE_BY_NAME = {}
  for _, pool in pairs((C or {}).MOVE_POOLS or {}) do
    for name, def in pairs(pool) do MOVE_BY_NAME[name] = def end
  end
  return MOVE_BY_NAME
end

--- The definition behind a move name, or nil if the pools do not know it.
function Battle.moveDef(name) return moveIndex()[name] end

--- One stored move, expanded into the shape everything else expects.
function Battle.hydrateMove(name, stored)
  local def = moveIndex()[name]
  local out = def and clone(def) or {}
  -- An unrecognised name keeps whatever was stored under it rather than
  -- becoming an empty move: a pool renamed in a later build must not silently
  -- disarm every companion that rolled from it.
  if not def and type(stored) == "table" then out = clone(stored) end
  out.name = name
  local count = type(stored) == "table" and stored.count or nil
  out.count = math.tointeger(tonumber(count)) or math.tointeger(tonumber(out.count)) or 0
  return out
end

--- A whole moveset, expanded. Always a NEW table: callers mutate what they get.
function Battle.hydrateMoves(moves)
  local out = {}
  for name, stored in pairs(moves or {}) do
    out[name] = Battle.hydrateMove(name, stored)
  end
  return out
end

--- A whole moveset, reduced to what actually varies.
---
--- Accepts either shape, so it doubles as the migration: a record written by an
--- older build arrives carrying full moves and is compacted on the way in.
function Battle.compactMoves(moves)
  local out = {}
  for name, stored in pairs(moves or {}) do
    if moveIndex()[name] then
      local count = type(stored) == "table" and stored.count or nil
      out[name] = { count = math.tointeger(tonumber(count)) or 0 }
    else
      out[name] = clone(stored)
    end
  end
  return out
end

-- The isolated fleet uses this explicit 32-bit stream so Lua and Rust execute
-- byte-for-byte reproducible combat without depending on Luerl/Erlang's host
-- PRNG implementation. The monolith keeps its existing math.random stream
-- unless a caller opts in with seedDeterministic.
local RNG_STATE = nil
function Battle.seedDeterministic(value)
  local seed = math.tointeger(tonumber(value)) or 1
  seed = seed & 0xffffffff
  if seed == 0 then seed = 0x6d2b79f5 end
  RNG_STATE = seed
end

local function nextDeterministic()
  local x = RNG_STATE
  x = (x ~ ((x << 13) & 0xffffffff)) & 0xffffffff
  x = (x ~ (x >> 17)) & 0xffffffff
  x = (x ~ ((x << 5) & 0xffffffff)) & 0xffffffff
  RNG_STATE = x
  return x
end

local function rand(low, high)
  low = math.tointeger(low) or 0
  high = math.tointeger(high) or low
  if high <= low then return low end
  if RNG_STATE ~= nil then
    return low + (nextDeterministic() % (high - low + 1))
  end
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
  local a = math.max(0, attackerSpeed or 0)
  local d = math.max(0, defenderSpeed or 0)
  local modifier
  if T.speedSwing > 0 then
    -- The gap as a share of the two speeds together: -1 when the attacker has
    -- none of the speed in the fight, +1 when it has all of it, and every
    -- point in between actually moves it.
    local total = a + d
    modifier = total > 0 and ((a - d) / total) * T.speedSwing or 0
  else
    local diff = a - d
    if diff > 0 then
      modifier = math.min(0.25, diff * 0.08)
    else
      modifier = math.max(-0.40, diff * 0.10)
    end
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
  -- Everything the companion has been given, frozen before the fight moves it.
  m.statBudget = (m.attack or 0) + (m.defense or 0) + (m.speed or 0) + (m.health or 0)
  -- The fighter gets the FULL moves, rebuilt from the pools. This is the door
  -- combat comes through -- `act` reads damage, type and rarity off what is
  -- here -- and it is a copy, which is what keeps a fight from draining the
  -- pet's own counts.
  m.moves = Battle.hydrateMoves(monster.moves)
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
  local availableNames = {}
  for name, move in pairs(npc.moves or {}) do
    if (math.tointeger(move.count) or 0) > 0 then
      availableNames[#availableNames + 1] = name
    end
  end
  table.sort(availableNames)
  for _, name in ipairs(availableNames) do
    local move = npc.moves[name]
    move.name = name
    available[#available + 1] = move
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

--- The constant a move's power is multiplied against, before the attack stat.
--- See `TUNING.attackPerLevel` for why it is not simply `attackBase`.
local function attackFloor(attacker)
  local level = math.max(0, math.tointeger(attacker.level) or 0)
  -- The budget is read from the stats the fighter ENTERED with, so a move's own
  -- +attack rider cannot feed back into the floor and compound itself.
  local budget = math.max(0,
    (math.tointeger(attacker.statBudget) or 0) - T.attackBudgetBaseline)
  return T.attackBase + T.attackPerLevel * level + T.attackPerStatPoint * budget
end

--- What fraction of a swing survives the defender's defense stat.
--- One when the mechanic is off, so the multiplication is a no-op.
local function mitigation(defender)
  if T.defenseMitigationMax <= 0 then return 1.0 end
  local budget = math.max(1, math.tointeger(defender.statBudget) or 1)
  local full = math.max(0.01, T.defenseMitigationFullShare)
  local share = math.min(1.0, ((defender.defense or 0) / budget) / full)
  return 1.0 - T.defenseMitigationMax * share
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
    critical = false,
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
    local raw = move.damage * (attackFloor(attacker) + (attacker.attack or 0))
    local swing = 1.0 + (rand(0, 200) - 100) / 100 * T.variance
    -- The crit roll is its own roll, taken after the swing is known to land.
    -- Folding it into `variance` would have made every swing slightly bigger
    -- instead of one swing in eleven much bigger, which is the whole point.
    entry.critical = rand(1, 100) <= math.floor(T.criticalChance * 100)
    local crit = entry.critical and T.criticalMultiplier or 1.0
    local damage = math.max(1, math.floor(raw * mult * swing * crit * mitigation(defender)))
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

  -- Shields recover only for a fighter that came through the round untouched.
  --
  -- "Untouched" means no blow LANDED on them: a miss is not a hit, and neither
  -- is a move that dealt nothing. Whoever took so much as a point recovers
  -- nothing that round, which is what stops this from healing the fighter being
  -- beaten on, and what keeps two defensive companions from regenerating past
  -- each other into a fight that cannot end.
  --
  -- That stalemate is why the old unconditional trickle had to be capped below
  -- a struggle's damage. Making the regen conditional removes the stalemate at
  -- the source, so the number itself no longer has to be tiny to be safe.
  local wasHit = { challenger = false, accepter = false }
  for _, e in ipairs(entries) do
    if not e.missed and (e.shieldDamage + e.healthDamage) > 0 then
      wasHit[e.attacker == "challenger" and "accepter" or "challenger"] = true
    end
  end

  for _, m in ipairs({ a, b }) do
    if m.healthPoints > 0 and not wasHit[m.side] then
      local regen = math.ceil(m.maxShield * T.shieldRegenShare)
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
  --
  -- `roundCap * 2` is not a guess and must not be "optimised" down: a round
  -- appends one entry PER COMBATANT, so a fight that runs to the cap produces
  -- exactly this many. The bound therefore never fires in a legal fight -- it
  -- is a safety net, and the log grows monotonically for the whole battle.
  --
  -- That monotonicity is load-bearing. Clients (and e2e) detect "a new round
  -- resolved" by the log getting longer; a smaller keep makes it stop growing
  -- mid-fight and the round reads as never having happened. Tried at 10 and it
  -- broke the battle at round six, exactly when 6*2 crossed it.
  --
  -- The size this is blamed for is also worst-case only. A profiler run drives
  -- one battle to fifty rounds and lands at ~62 KB; the median fight is seven
  -- rounds, about fourteen entries and ~8.7 KB, which is what players actually
  -- pay. Shrink the PER-ENTRY cost if this needs to be cheaper, not the count.
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
    entryNo = faction.monster.entryNo,
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

  -- Rolled whole, because the roll itself weighs rarity and damage, and stored
  -- compact: from here on only the uses remaining are worth keeping.
  return Battle.compactMoves(chosen)
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
