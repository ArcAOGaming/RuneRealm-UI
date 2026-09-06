--- balance.lua — how long does a fight actually last?
---
--- Run with ./run-balance.sh. Free, unsigned, no wallet.
---
--- This exists because fixing the type-effectiveness bug changed the game. The
--- original chart was keyed "Fire" while every move type was "fire", so the
--- multiplier silently never applied, and the damage numbers had been tuned by
--- feel against a flat 1.0. Switch it on and a super-effective hit one-shots a
--- low-level companion.
---
--- So the constants get chosen by measurement. `sweep` walks a grid of tuning
--- values and scores each one against what a fight should feel like:
---
---   * a median of 5 to 9 rounds at every level,
---   * almost no first-round knockouts,
---   * almost no grinds past thirty rounds,
---   * and roughly the same shape at level 0 as at level 20.

local LEVELS = { 0, 1, 3, 5, 10, 20 }
local TRIALS = 50
local ROUND_CAP = 120

--- Play one fight between two generated companions and return its length.
local function fight(level, seed)
  math.randomseed(seed)
  local a = Battle.makeOpponent(level, {})
  local b = Battle.makeOpponent(level, {})
  local f = Battle.new("sim", a, "A", b, "B", { kind = "bot", timestamp = 0 })
  local n = 0
  while f.status ~= "ended" and n < ROUND_CAP do
    n = n + 1
    Battle.resolveRound(f,
      Battle.chooseNpcMove(f.challenger, f.accepter),
      Battle.chooseNpcMove(f.accepter, f.challenger))
  end
  return n, f.challenger.maxHealthPoints
end

--- Round-length statistics at one level.
local function measure(level)
  local rounds, hp = {}, 0
  for trial = 1, TRIALS do
    local n, maxHp = fight(level, level * 100000 + trial)
    rounds[#rounds + 1] = n
    hp = hp + maxHp
  end
  table.sort(rounds)
  local quick, grind = 0, 0
  for _, n in ipairs(rounds) do
    if n <= 1 then quick = quick + 1 end
    if n >= ROUND_CAP or n > 30 then grind = grind + 1 end
  end
  return {
    level = level,
    median = rounds[math.floor(#rounds * 0.5)],
    p10 = rounds[math.max(1, math.floor(#rounds * 0.1))],
    p90 = rounds[math.floor(#rounds * 0.9)],
    quick = quick / TRIALS,
    grind = grind / TRIALS,
    hp = math.floor(hp / TRIALS),
  }
end

--- Lower is better. A fight should take about seven rounds at every level, and
--- both failure modes — instant and interminable — are weighted hard because
--- both of them are the game not working rather than the game being swingy.
local function score(rows)
  local total = 0
  for _, r in ipairs(rows) do
    total = total + math.abs(r.median - 7) * 2
    total = total + r.quick * 200
    total = total + r.grind * 200
  end
  return total
end

local function profile()
  local rows = {}
  for _, level in ipairs(LEVELS) do rows[#rows + 1] = measure(level) end
  return rows, score(rows)
end

local function render(rows, out)
  out[#out + 1] = string.format("%-6s %-8s %-6s %-6s %-9s %-7s %-6s",
    "level", "median", "p10", "p90", "1-round", ">30", "maxHP")
  for _, r in ipairs(rows) do
    out[#out + 1] = string.format("%-6d %-8d %-6d %-6d %-9s %-7s %-6d",
      r.level, r.median, r.p10, r.p90,
      string.format("%d%%", math.floor(r.quick * 100)),
      string.format("%d%%", math.floor(r.grind * 100)),
      r.hp)
  end
end

--- The grid search, as its own entry point: a query string does not reach
--- `req.body` on the Lua device, so the mode has to be the path.
function sweep(base, req)
  local out = {}
  do
    -- A grid over the numbers that actually move the outcome. Hit chance and
    -- variance are left alone: they change how swingy a fight feels, not how
    -- long it is.
    local best, bestScore, tried = nil, math.huge, 0
    for _, hp in ipairs({ 8, 12, 16, 20 }) do
      for _, sh in ipairs({ 0, 3, 6 }) do
        for _, ab in ipairs({ 1, 2, 3 }) do
          for _, regen in ipairs({ 0.1, 0.2, 0.35 }) do
            for _, uses in ipairs({ 2, 3, 5 }) do
              Battle.TUNING.hpPerHealth = hp
              Battle.TUNING.shieldPerDefense = sh
              Battle.TUNING.attackBase = ab
              Battle.TUNING.shieldRegenShare = regen
              Battle.TUNING.moveUses = uses
              local rows, s = profile()
              tried = tried + 1
              if s < bestScore then
                bestScore = s
                best = { hpPerHealth = hp, shieldPerDefense = sh, attackBase = ab,
                         shieldRegenShare = regen, moveUses = uses, rows = rows }
              end
            end
          end
        end
      end
    end
    out[#out + 1] = string.format("swept %d combinations", tried)
    out[#out + 1] = string.format(
      "best: hpPerHealth=%s shieldPerDefense=%s attackBase=%s shieldRegenShare=%s moveUses=%s  (score %.1f)",
      best.hpPerHealth, best.shieldPerDefense, best.attackBase,
      best.shieldRegenShare, best.moveUses, bestScore)
    out[#out + 1] = ""
    render(best.rows, out)
    return table.concat(out, "\n")
  end
end

function balance(base, req)
  local out = {}
  local rows, s = profile()
  out[#out + 1] = string.format(
    "tuning: hpPerHealth=%s shieldPerDefense=%s attackBase=%s shieldRegenShare=%s healPerPoint=%s",
    Battle.TUNING.hpPerHealth, Battle.TUNING.shieldPerDefense,
    Battle.TUNING.attackBase, Battle.TUNING.shieldRegenShare, Battle.TUNING.healPerPoint)
  out[#out + 1] = string.format("score: %.1f  (lower is better; 0 would be a 7-round median everywhere)", s)
  out[#out + 1] = ""
  render(rows, out)

  -- What one swing does, so the numbers above have something concrete under
  -- them.
  out[#out + 1] = ""
  out[#out + 1] = "one swing, by level:"
  for _, level in ipairs({ 0, 5, 20 }) do
    math.randomseed(level + 7)
    local attacker = Battle.combatant(Battle.makeOpponent(level, {}), "challenger", "A")
    local defender = Battle.combatant(Battle.makeOpponent(level, {}), "accepter", "B")
    local parts = {}
    for name, move in pairs(attacker.moves) do
      if move.damage > 0 then
        local raw = move.damage * (Battle.TUNING.attackBase + attacker.attack)
        parts[#parts + 1] = string.format("%s=%d", name, math.floor(raw))
      end
    end
    out[#out + 1] = string.format(
      "  lvl %-3d attack %-3d  target %d HP + %d shield  |  %s",
      level, attacker.attack, defender.maxHealthPoints, defender.maxShield,
      #parts > 0 and table.concat(parts, " ") or "(no damaging moves rolled)")
  end

  return table.concat(out, "\n")
end

-- Real players, not bots ----------------------------------------------------
--
-- Everything above simulates `Battle.makeOpponent`, whose stat budget is
-- `10 + level*2`. A REAL companion does not grow like that: it starts on the
-- same ten points and then takes `C.LEVEL_UP_POINTS` (ten) more at EVERY level,
-- capped at five per stat. So at level 10 a player is carrying 110 points and
-- the bot it fights is carrying 30, and a PvP fight is 110 against 110.
--
-- That is the fight this measures, because it is the one players report as
-- unwinnable: two defensive builds regenerating more shield per round than
-- either can remove, both rosters exhausted, and the whole thing decided by
-- struggling at two damage a swing.

--- The most committed spend of one level-up that the deployed cap allows, given
--- the two stats a build is ABOUT and the two it is not.
---
--- DERIVED from `C.LEVEL_UP_POINTS` and `C.LEVEL_UP_MAX_PER_STAT` rather than
--- written out, so the matrix follows the constant instead of silently
--- measuring builds nobody can reach. At a cap of 5 that is {5,5,0,0} -- the
--- extreme is free, which is the whole finding on the constant. At 3 it is
--- {3,3,2,2}, because the four points the cap will not let you spend on your
--- own two stats have to go somewhere.
---
--- The leftover is spread EVENLY rather than poured into the third stat. Both
--- were measured and the difference matters: {3,3,3,1} puts glass at 29% at
--- level 20 and {3,3,2,2} puts it at parity, so a build that dumps health to 1
--- is a bad choice rather than the cap being broken. Spreading is what a player
--- forced to spend does; piling is a strawman.
local function extremeBuild(order)
  local build = { attack = 0, defense = 0, speed = 0, health = 0 }
  local cap = C.LEVEL_UP_MAX_PER_STAT
  local left = C.LEVEL_UP_POINTS
  for i = 1, 2 do
    local take = math.min(cap, left)
    build[order[i]] = take
    left = left - take
  end
  local guard = 0
  while left > 0 and guard < 64 do
    guard = guard + 1
    local stat = order[((guard - 1) % 2) + 3]
    if build[stat] < cap then
      build[stat] = build[stat] + 1
      left = left - 1
    end
  end
  return build
end

local BUILDS = {
  tank    = extremeBuild({ "defense", "health", "speed", "attack" }),
  bruiser = extremeBuild({ "attack", "health", "defense", "speed" }),
  glass   = extremeBuild({ "attack", "speed", "defense", "health" }),
  even    = { attack = 3, defense = 3, speed = 2, health = 2 },
}

--- The same four intents under a cap of three instead of five.
---
--- Ten points with a cap of five means an extreme build is FREE: max two stats,
--- spend nothing on the other two, and the two you skipped stay at their
--- level-zero value forever while the two you bought grow ten times. That is
--- the shape the win-rate matrix keeps reporting, and no combination of
--- `speedSwing`, `defenseMitigationMax` or `attackPerStatPoint` removes it --
--- swept, best score 173 against an ideal near zero. They only change WHICH
--- extreme wins.
---
--- A cap of three cannot be spent on fewer than four stats. The identity of a
--- build survives -- a tank is still the one with the most defense -- but the
--- gap between what it bought and what it skipped stops being tenfold. Compare
--- with `matrix20` to see what the cap is worth before changing the constant.
local CAPPED_BUILDS = {
  tank    = { defense = 3, health = 3, speed = 2, attack = 2 },
  bruiser = { attack = 3, health = 3, defense = 2, speed = 2 },
  glass   = { attack = 3, speed = 3, defense = 2, health = 2 },
  even    = { attack = 3, defense = 3, speed = 2, health = 2 },
}

--- One companion as a player would have grown it.
--- Which build table `grow` reads. Swapped by the capped-matrix entry points.
local ACTIVE_BUILDS = BUILDS

local function grow(level, build, element)
  local m = Battle.makeOpponent(0, { faction = element })
  -- Start from the player's own ten-point roll, not the bot budget.
  m.attack, m.defense, m.speed, m.health = 1, 1, 1, 1
  local names = { "attack", "defense", "speed", "health" }
  for _ = 1, 6 do
    local pick = names[Battle.rand(1, 4)]
    if m[pick] < 5 then m[pick] = m[pick] + 1 end
  end
  for _ = 1, level do
    for stat, points in pairs(build) do m[stat] = m[stat] + points end
  end
  m.level = level
  m.moves = Battle.rollMoves(m.elementType, { entryNo = m.entryNo })
  return m
end

local function pvp(level, a, b, seed)
  math.randomseed(seed)
  local f = Battle.new("sim", grow(level, ACTIVE_BUILDS[a]), "A", grow(level, ACTIVE_BUILDS[b]), "B",
    { kind = "pvp", timestamp = 0 })
  local n, struggled = 0, false
  while f.status ~= "ended" and n < ROUND_CAP do
    n = n + 1
    if not Battle.hasMovesLeft(f.challenger) or not Battle.hasMovesLeft(f.accepter) then
      struggled = true
    end
    Battle.resolveRound(f,
      Battle.chooseNpcMove(f.challenger, f.accepter),
      Battle.chooseNpcMove(f.accepter, f.challenger))
  end
  return n, struggled, f
end

local function measurePvp(level, a, b)
  local rounds, dry = {}, 0
  for trial = 1, TRIALS do
    local n, struggled = pvp(level, a, b, level * 7919 + trial)
    rounds[#rounds + 1] = n
    if struggled then dry = dry + 1 end
  end
  table.sort(rounds)
  local grind = 0
  for _, n in ipairs(rounds) do if n > 30 then grind = grind + 1 end end
  return {
    median = rounds[math.floor(#rounds * 0.5)],
    p90 = rounds[math.floor(#rounds * 0.9)],
    grind = grind / TRIALS,
    dry = dry / TRIALS,
  }
end

local MATCHUPS = {
  { "tank", "tank" }, { "tank", "bruiser" }, { "even", "even" },
  { "glass", "tank" }, { "bruiser", "bruiser" },
}
local PVP_LEVELS = { 1, 5, 10, 20 }

function players(base, req)
  local out = {}
  out[#out + 1] = string.format(
    "tuning: hpPerHealth=%s shieldPerDefense=%s attackBase=%s shieldRegenShare=%s moveUses=%s struggleDamage=%s",
    Battle.TUNING.hpPerHealth, Battle.TUNING.shieldPerDefense, Battle.TUNING.attackBase,
    Battle.TUNING.shieldRegenShare, Battle.TUNING.moveUses, Battle.TUNING.struggleDamage)
  out[#out + 1] = ""
  out[#out + 1] = string.format("%-18s %-6s %-8s %-6s %-7s %-7s",
    "matchup", "level", "median", "p90", ">30", "ran dry")
  for _, m in ipairs(MATCHUPS) do
    for _, level in ipairs(PVP_LEVELS) do
      local r = measurePvp(level, m[1], m[2])
      out[#out + 1] = string.format("%-18s %-6d %-8d %-6d %-7s %-7s",
        m[1] .. " v " .. m[2], level, r.median, r.p90,
        string.format("%d%%", math.floor(r.grind * 100)),
        string.format("%d%%", math.floor(r.dry * 100)))
    end
  end

  -- The shield arithmetic, spelled out: a tank's regen against what the other
  -- side can actually land in a round.
  out[#out + 1] = ""
  out[#out + 1] = "the shield wall, by level (tank defending, bruiser attacking):"
  for _, level in ipairs(PVP_LEVELS) do
    math.randomseed(level + 11)
    local d = Battle.combatant(grow(level, ACTIVE_BUILDS.tank), "accepter", "B")
    local a = Battle.combatant(grow(level, ACTIVE_BUILDS.bruiser), "challenger", "A")
    local best = 0
    for _, move in pairs(a.moves) do
      if move.damage > 0 then
        local raw = move.damage * (Battle.TUNING.attackBase + a.attack)
        if raw > best then best = raw end
      end
    end
    out[#out + 1] = string.format(
      "  lvl %-3d tank %d HP + %d shield, regen %d/round  |  attacker %d atk, best swing %d",
      level, d.maxHealthPoints, d.maxShield,
      math.floor(d.maxShield * Battle.TUNING.shieldRegenShare), a.attack, math.floor(best))
  end
  return table.concat(out, "\n")
end

--- What one candidate tuning does to every build matchup, worst case first.
--- Scored on the two failure modes a player actually complains about: a fight
--- that runs past thirty rounds, and a fight decided by struggling because both
--- rosters ran dry.
local function pvpScore()
  local total, worst = 0, 0
  for _, m in ipairs(MATCHUPS) do
    for _, level in ipairs(PVP_LEVELS) do
      local r = measurePvp(level, m[1], m[2])
      total = total + math.abs(r.median - 7) + r.grind * 100 + r.dry * 60
      if r.median > worst then worst = r.median end
    end
  end
  return total, worst
end

function psweep(base, req)
  -- Fewer trials than a single report: this is a grid, and the node has a
  -- request timeout that a full-fidelity sweep of it does not fit inside.
  TRIALS = 20
  local out = {}
  out[#out + 1] = string.format("%-10s %-8s %-14s", "atk/lvl", "score", "worst median")
  local best, bestScore = nil, math.huge
  for _, apl in ipairs({ 0, 0.5, 1, 1.5, 2, 3 }) do
    Battle.TUNING.attackPerLevel = apl
    local s, worst = pvpScore()
    out[#out + 1] = string.format("%-10s %-8.1f %-14d", apl, s, worst)
    if s < bestScore then bestScore = s; best = apl end
  end
  out[#out + 1] = ""
  out[#out + 1] = string.format("best: attackPerLevel=%s  (score %.1f)", best, bestScore)
  return table.concat(out, string.char(10))
end

-- Is a build VIABLE? ---------------------------------------------------------
--
-- Round length says whether a fight is watchable. It does not say whether a
-- build is worth playing, and those are different questions: the tank mirror
-- was 43 rounds AND a coin flip, while a build that loses 90% of its fights in
-- four rounds looks perfectly healthy in the `players` table above.
--
-- So this is the acceptance test, and the one to run when content is added.
-- Every cell is one build's win rate against another at one level. What we want
-- is that no row is green everywhere: a build should beat some things and lose
-- to others, which is what makes choosing between them a decision. A cell far
-- from 50% is a counter, and counters are good. A ROW far from 50% is a
-- dominant or a dead build, and that is the thing to fix.
--
-- Rules of thumb when reading it:
--   * every row averaging 40-60%      -- no build is dominant or dead
--   * individual cells 25-75%         -- counters exist but nothing is unplayable
--   * a row averaging over 65%        -- that build is the only correct choice
--   * a row averaging under 35%       -- that build is a trap, and new players
--                                        pick traps

local BUILD_ORDER = { "tank", "bruiser", "glass", "even" }

--- How often the first build beats the second, played from BOTH sides.
---
--- Both the mutual-knockout and the round-cap tiebreak go to the accepter, so a
--- single orientation measures the tiebreak as much as it measures the build.
--- Each seed is therefore played twice with the sides swapped and both results
--- counted.
local function winRate(level, a, b, trials)
  local wins, played, rounds = 0, 0, {}
  for trial = 1, trials do
    local seed = level * 104729 + trial
    local n, _, f = pvp(level, a, b, seed)
    if f.winner == "challenger" then wins = wins + 1 end
    rounds[#rounds + 1] = n
    local m, _, g = pvp(level, b, a, seed)
    if g.winner == "accepter" then wins = wins + 1 end
    rounds[#rounds + 1] = m
    played = played + 2
  end
  table.sort(rounds)
  return wins / played, rounds[math.max(1, math.floor(#rounds * 0.5))]
end

--- The matrix at one level, plus each build's average across the row.
local function renderMatrix(level, trials, out)
  out[#out + 1] = string.format("level %d  (win %% of the row build, median rounds)", level)
  local header = string.format("%-10s", "")
  for _, b in ipairs(BUILD_ORDER) do header = header .. string.format("%-14s", "v " .. b) end
  out[#out + 1] = header .. "row avg"
  for _, a in ipairs(BUILD_ORDER) do
    local row, total, counted = string.format("%-10s", a), 0, 0
    for _, b in ipairs(BUILD_ORDER) do
      if a == b then
        row = row .. string.format("%-14s", "--")
      else
        local rate, median = winRate(level, a, b, trials)
        row = row .. string.format("%-14s", string.format("%d%% (%d)",
          math.floor(rate * 100 + 0.5), median))
        total = total + rate
        counted = counted + 1
      end
    end
    out[#out + 1] = row .. string.format("%d%%",
      math.floor((counted > 0 and total / counted or 0) * 100 + 0.5))
  end
end

--- One level per entry point: the whole matrix at every level exceeds the
--- node's gateway timeout, and a level is the unit anybody actually asks about.
local function matrixAt(level, trials)
  return function(base, req)
    local out = {}
    out[#out + 1] = string.format(
      "tuning: attackPerStatPoint=%s attackBudgetBaseline=%s shieldRegenShare=%s hpPerHealth=%s shieldPerDefense=%s",
      Battle.TUNING.attackPerStatPoint, Battle.TUNING.attackBudgetBaseline,
      Battle.TUNING.shieldRegenShare, Battle.TUNING.hpPerHealth,
      Battle.TUNING.shieldPerDefense)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

matrix1  = matrixAt(1, 25)
matrix5  = matrixAt(5, 25)
matrix10 = matrixAt(10, 25)
matrix20 = matrixAt(20, 20)

-- New content, before it ships ----------------------------------------------
--
-- Costs nothing and simulates nothing: it is the move catalog with the two
-- numbers that decide whether a move is worth its slot, laid out so a new one
-- can be read against the pool it joins.
--
--   power   damage x uses -- the whole damage a move contributes over a fight
--   riders  the four stat riders summed, which is its non-damage value
--
-- A move whose power is far above its pool is the next balance complaint. A
-- move with no power and no riders is a slot a player wasted. Both are visible
-- here before anything is deployed.

function moves(base, req)
  local out = {}
  out[#out + 1] = string.format("%-9s %-20s %-8s %-4s %-5s %-4s %-6s %-7s %s",
    "pool", "move", "type", "rar", "uses", "dmg", "power", "riders", "atk/spd/def/hp")
  local poolNames = {}
  for name in pairs(C.MOVE_POOLS) do poolNames[#poolNames + 1] = name end
  table.sort(poolNames)
  for _, poolName in ipairs(poolNames) do
    local pool = C.MOVE_POOLS[poolName]
    local names, powers = {}, {}
    for name in pairs(pool) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
      local m = pool[name]
      local power = m.damage * m.count
      local riders = m.attack + m.speed + m.defense + m.health
      powers[#powers + 1] = power
      out[#out + 1] = string.format("%-9s %-20s %-8s %-4d %-5d %-4d %-6d %-7d %d/%d/%d/%d",
        poolName, name, m.type, m.rarity or 0, m.count, m.damage, power, riders,
        m.attack, m.speed, m.defense, m.health)
    end
    table.sort(powers)
    out[#out + 1] = string.format("%-9s %-20s power in this pool: min %d, median %d, max %d",
      "", "", powers[1], powers[math.max(1, math.floor(#powers * 0.5))], powers[#powers])
    out[#out + 1] = ""
  end
  return table.concat(out, string.char(10))
end

--- One number for a whole matrix. Lower is better; zero is unreachable.
---
--- Two penalties, weighted by which failure a player actually notices:
---
---   * a ROW away from 50% is a build that is either the only correct choice or
---     a trap, and that is the expensive kind of imbalance -- it removes a
---     decision from the game. Weighted hardest.
---   * a CELL outside 25-75% is a hard counter. Counters are wanted, so this
---     only penalises the part outside the band, not the distance from 50%.
---   * a median round count away from seven, lightly, so a "balanced" answer
---     that makes every fight forty rounds does not win the sweep.
local function matrixScore(level, trials)
  local penalty = 0
  for _, a in ipairs(BUILD_ORDER) do
    local total, counted = 0, 0
    for _, b in ipairs(BUILD_ORDER) do
      if a ~= b then
        local rate, median = winRate(level, a, b, trials)
        total = total + rate
        counted = counted + 1
        if rate > 0.75 then penalty = penalty + (rate - 0.75) * 100 end
        if rate < 0.25 then penalty = penalty + (0.25 - rate) * 100 end
        penalty = penalty + math.abs(median - 7) * 0.5
      end
    end
    penalty = penalty + math.abs(total / counted - 0.5) * 400
  end
  return penalty
end

--- Search the three knobs that decide whether a BUILD is viable, as opposed to
--- whether a fight is the right length. Run it after adding moves, a faction,
--- an evolution tier, or levels: the numbers that were right for four builds at
--- level 20 are not automatically right for six at level 40.
local function buildSweep(level, trials)
  return function(base, req)
    local out = {}
    out[#out + 1] = string.format("%-8s %-8s %-8s %-8s",
      "speed", "mitig", "atk/pt", "score")
    local best, bestScore = nil, math.huge
    -- Nine combinations is what fits inside the node's gateway timeout at this
    -- trial count; `attackPerStatPoint` is held at whatever is deployed
    -- because the `players` profile already chose it against round length.
    local apt = Battle.TUNING.attackPerStatPoint
    for _, sp in ipairs({ 0, 0.18, 0.3 }) do
      for _, mit in ipairs({ 0, 0.3, 0.5 }) do
        Battle.TUNING.speedSwing = sp
        Battle.TUNING.defenseMitigationMax = mit
        local score = matrixScore(level, trials)
        out[#out + 1] = string.format("%-8s %-8s %-8s %-8.1f", sp, mit, apt, score)
        if score < bestScore then
          bestScore = score
          best = { speedSwing = sp, defenseMitigationMax = mit, attackPerStatPoint = apt }
        end
      end
    end
    out[#out + 1] = ""
    out[#out + 1] = string.format(
      "best at level %d: speedSwing=%s defenseMitigationMax=%s attackPerStatPoint=%s  (score %.1f)",
      level, best.speedSwing, best.defenseMitigationMax, best.attackPerStatPoint, bestScore)
    return table.concat(out, string.char(10))
  end
end

bsweep10 = buildSweep(10, 8)
bsweep20 = buildSweep(20, 8)

--- Try one combination and see the matrix it produces.
local function try(sp, mit, apt, level, trials)
  return function(base, req)
    Battle.TUNING.speedSwing = sp
    Battle.TUNING.defenseMitigationMax = mit
    Battle.TUNING.attackPerStatPoint = apt
    local out = {}
    out[#out + 1] = string.format("speedSwing=%s defenseMitigationMax=%s attackPerStatPoint=%s",
      sp, mit, apt)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

-- Comparisons ---------------------------------------------------------------
--
-- Each of these plays the same matrix under one candidate rule, so a change can
-- be judged on numbers before it is deployed. Nothing here mutates the
-- deployed tuning: `run-balance.sh` builds a fresh bundle per request.

--- The matrix under a per-stat level-up cap of three instead of five.
--- See `CAPPED_BUILDS` and the note on `C.LEVEL_UP_MAX_PER_STAT`.
local function cappedMatrix(level, trials, speedSwing, mitigation)
  return function(base, req)
    ACTIVE_BUILDS = CAPPED_BUILDS
    Battle.TUNING.speedSwing = speedSwing or Battle.TUNING.speedSwing
    Battle.TUNING.defenseMitigationMax = mitigation or Battle.TUNING.defenseMitigationMax
    local out = {}
    out[#out + 1] = string.format(
      "per-stat cap 3 (deployed %d), speedSwing=%s defenseMitigationMax=%s",
      C.LEVEL_UP_MAX_PER_STAT, Battle.TUNING.speedSwing,
      Battle.TUNING.defenseMitigationMax)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

-- The cap alone. Hands the game to whoever bought speed, because the
-- saturating hit chance is untouched -- glass took 86% at level 20.
capmatrix10 = cappedMatrix(10, 25)
capmatrix20 = cappedMatrix(20, 25)

-- The cap AND the speed fix. The only configuration measured so far in which
-- every build sits at 44-56% at levels 1, 10 and 20.
capfixed1  = cappedMatrix(1,  25, 0.3, 0)
capfixed10 = cappedMatrix(10, 25, 0.3, 0)
capfixed20 = cappedMatrix(20, 25, 0.3, 0)

--- The matrix under one tuning combination, extremes kept. Use it to try a
--- candidate against the builds players can actually reach today.
local function tuned(level, trials, speedSwing, mitigation)
  return function(base, req)
    Battle.TUNING.speedSwing = speedSwing
    Battle.TUNING.defenseMitigationMax = mitigation
    local out = {}
    out[#out + 1] = string.format("speedSwing=%s defenseMitigationMax=%s",
      speedSwing, mitigation)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

-- The speed fix without the cap: not enough on its own. Tank 34%, glass 33%,
-- even 69% at level 20 -- the extremes stay where they were.
speedonly10 = tuned(10, 25, 0.3, 0)
speedonly20 = tuned(20, 25, 0.3, 0)
-- Damage mitigation from the defense stat, with and without the speed fix.
mitigation20 = tuned(20, 25, 0, 0.3)
bothon20 = tuned(20, 25, 0.3, 0.3)

-- Is a MOVE viable? ----------------------------------------------------------
--
-- The build matrix above asks whether a stat allocation is worth choosing.
-- This asks the same question of a move, and it is not the same question: a
-- move is not chosen, it is DRAWN. What matters is therefore not whether a
-- player would pick it, but whether the companion that drew it was handed a
-- better or a worse game than the one that did not.
--
-- Method. Two identical companions -- same level, same stats, same even build.
-- One carries the move under test in its third slot; the other carries a second
-- copy of a reference attack there. Every other slot is the same reference
-- pair, so the ONLY difference between the two rosters is the move under test,
-- and the win rate is that move's marginal value on a scale every move in the
-- game shares. 50% means "worth exactly a plain 4-damage attack".
--
-- The reference moves are defined HERE rather than drawn from the pools,
-- because the pools are the thing being rebalanced: a yardstick made out of
-- what is being measured moves whenever the measurement does.
--
-- Seeds are PAIRED across moves -- trial t against opponent element e uses the
-- same seed for every move in the catalog -- so two moves are compared on the
-- same fights rather than on two independent samples of noise.

--- The yardstick is the catalog's own AVERAGE COMMON, not a bare attack.
---
--- It began as damage 4, count 2 and no riders, which is power 8 against a
--- catalog whose moves are 10 to 15, so everything measured 45-80% and the
--- number said nothing about whether a move was good -- only that it beat a
--- deliberately feeble stick. Sized to the middle of the rebuilt catalog
--- instead, 50% means "worth about what a rarity-3 common is worth", which is
--- the question actually being asked.
local REF = {
  ["Ref Strike"]   = { type = "normal", rarity = 2, count = 3, damage = 4, attack = 0, speed = 0, defense = 0, health = 0 },
  ["Ref Strike B"] = { type = "normal", rarity = 2, count = 3, damage = 4, attack = 0, speed = 0, defense = 0, health = 0 },
  ["Ref Strike C"] = { type = "normal", rarity = 2, count = 3, damage = 4, attack = 0, speed = 0, defense = 0, health = 0 },
}

--- A companion with no roll in it: fixed stats, fixed roster, so the only
--- variable in a duel is the move under test.
local function refMonster(level, element, moves)
  local m = {
    entryNo = 1, name = "Ref", image = "ref", sprite = "ref",
    elementType = element, faction = "Ref", level = level,
    attack = 1, defense = 1, speed = 1, health = 1, moves = moves,
  }
  -- Ten points at adoption plus C.LEVEL_UP_POINTS a level, spread evenly. An
  -- even build is the only one that is not itself a balance opinion.
  local points = 10 + level * C.LEVEL_UP_POINTS - 4
  local names = { "attack", "defense", "speed", "health" }
  local i = 1
  while points > 0 do
    m[names[i]] = m[names[i]] + 1
    i = i % 4 + 1
    points = points - 1
  end
  return m
end

--- Two plain attacks and the slot under test.
---
--- The two fixed slots are BOTH attacks, and that took two attempts to get
--- right. The first version made one of them a support move, on the reasoning
--- that a typical roster carries one -- but a support move has no uses that
--- deal damage, so the roster carrying the move under test had one damaging
--- move against the control roster's two, and every support move in the game
--- measured 9-34% no matter what its numbers were. That is the yardstick
--- charging support twice: once for the slot, and again for halving the
--- roster's damage economy.
---
--- With two attacks underneath, replacing the third slot is the question
--- actually being asked, and a boost or a heal is measured against a third
--- attack rather than against a roster that can no longer fight.
local function roster(extraName, extraDef)
  local set = {
    ["Ref Strike"] = REF["Ref Strike"],
    ["Ref Strike B"] = REF["Ref Strike B"],
  }
  set[extraName] = extraDef
  return set
end

local function duel(level, elemA, movesA, elemB, movesB, seed)
  math.randomseed(seed)
  local f = Battle.new("mv",
    refMonster(level, elemA, movesA), "A",
    refMonster(level, elemB, movesB), "B", { kind = "pvp", timestamp = 0 })
  local n = 0
  while f.status ~= "ended" and n < ROUND_CAP do
    n = n + 1
    Battle.resolveRound(f,
      Battle.chooseNpcMove(f.challenger, f.accepter),
      Battle.chooseNpcMove(f.accepter, f.challenger))
  end
  return f
end

--- One move's marginal win rate, played from both sides against all four
--- opponent elements.
---
--- The carrier's own element is the move's element when it has one, because
--- that is the only way it is ever drawn in the real game; for a neutral move
--- the carrier's element cannot matter, since nothing the reference roster
--- throws is elemental either. Averaging over all four opponents is what makes
--- an elemental move comparable to a neutral one: every row of the chart sums
--- to 4.5, so no element is advantaged by the average.
local function moveWinRate(level, name, def, trials)
  local carrier = C.EFFECTIVENESS[def.type] and def.type or "fire"
  local test = roster(name, def)
  local control = roster("Ref Strike C", REF["Ref Strike C"])
  local wins, played, rounds = 0, 0, {}
  for e, opp in ipairs(C.ELEMENTS) do
    for t = 1, trials do
      local seed = level * 7717 + t * 31 + e
      local f = duel(level, carrier, test, opp, control, seed)
      if f.winner == "challenger" then wins = wins + 1 end
      rounds[#rounds + 1] = f.round
      local g = duel(level, opp, control, carrier, test, seed)
      if g.winner == "accepter" then wins = wins + 1 end
      rounds[#rounds + 1] = g.round
      played = played + 2
    end
  end
  table.sort(rounds)
  return wins / played, rounds[math.max(1, math.floor(#rounds * 0.5))]
end

--- Every move in the catalog, ranked. Read it two ways:
---
---   * the SPREAD says whether the pools are balanced against each other. A
---     move far above the field is the next complaint; one far below is a slot
---     a player wasted.
---   * the RARITY COLUMN says whether the tiers mean anything. Rarity 1 is the
---     rare tier, so rarity 1 should sit at the top of its pool and rarity 3 at
---     the bottom. Where it does not, the tier is decoration.
local function rankAt(level, trials, onlyPool, onlyType)
  return function(base, req)
    local out = {}
    out[#out + 1] = string.format(
      "move viability at level %d -- win %% against an identical roster carrying a plain 4-damage attack instead",
      level)
    out[#out + 1] = string.format("%d trials x 4 opponent elements x 2 orientations = %d fights per move",
      trials, trials * 8)
    out[#out + 1] = ""
    local rows = {}
    local poolNames = {}
    for name in pairs(C.MOVE_POOLS) do
      if not onlyPool or name == onlyPool then poolNames[#poolNames + 1] = name end
    end
    table.sort(poolNames)
    for _, poolName in ipairs(poolNames) do
      local names = {}
      for name in pairs(C.MOVE_POOLS[poolName]) do names[#names + 1] = name end
      table.sort(names)
      for _, name in ipairs(names) do
        local def = C.MOVE_POOLS[poolName][name]
        if not onlyType or def.type == onlyType then
        local rate, median = moveWinRate(level, name, def, trials)
        rows[#rows + 1] = {
          pool = poolName, name = name, rarity = def.rarity or 0,
          rate = rate, median = median,
          power = def.damage * def.count,
          riders = def.attack + def.speed + def.defense + def.health,
        }
        end
      end
    end
    -- Insertion sort rather than `table.sort` with a comparator: Luerl's
    -- sort does not take one, and the whole catalog is 42 rows.
    for i = 2, #rows do
      local held = rows[i]
      local j = i - 1
      while j >= 1 and rows[j].rate < held.rate do
        rows[j + 1] = rows[j]
        j = j - 1
      end
      rows[j + 1] = held
    end
    out[#out + 1] = string.format("%-9s %-20s %-4s %-7s %-8s %-7s %-7s",
      "pool", "move", "rar", "win%", "rounds", "power", "riders")
    for _, r in ipairs(rows) do
      out[#out + 1] = string.format("%-9s %-20s %-4d %-7s %-8d %-7d %-7d",
        r.pool, r.name, r.rarity,
        string.format("%.1f%%", r.rate * 100), r.median, r.power, r.riders)
    end
    -- Per pool: does rarity order match power order?
    out[#out + 1] = ""
    out[#out + 1] = "by pool, best first -- rarity should read 1,2,2,3,3,3 down each block:"
    for _, poolName in ipairs(poolNames) do
      local block = {}
      for _, r in ipairs(rows) do
        if r.pool == poolName then block[#block + 1] = r end
      end
      local parts = {}
      for _, r in ipairs(block) do
        -- `%.0f` is not implemented by Luerl's string.format; floor and print an integer.
        parts[#parts + 1] = string.format("%s r%d %d%%", r.name, r.rarity, math.floor(r.rate * 100 + 0.5))
      end
      out[#out + 1] = string.format("  %-9s %s", poolName, table.concat(parts, "  |  "))
    end
    return table.concat(out, string.char(10))
  end
end

--- One pool per entry point. The whole catalog in one request is about four
--- thousand fights and the node's gateway gives up at twenty-five seconds, so
--- the unit is a pool -- `rankfire5`, `rankrock20`.
---
--- No underscores in these names. A mode is a PATH segment on the Lua device
--- and separators do not survive the trip; see the note in CLAUDE.md. A mode
--- called `rank_fire5` is simply not found, and an absent key is answered with
--- the node's own HTML landing page rather than an error.
---
--- The eighteen-move neutral pool does not fit one request, so it is split by
--- move type instead: `rankstrike5`, `rankboost5`, `rankheal5`.
local function rankPool(poolName, level, trials, onlyType)
  return function(base, req)
    return rankAt(level, trials, poolName, onlyType)(base, req)
  end
end

rankfire1 = rankPool("fire", 1, 18)
rankfire5 = rankPool("fire", 5, 18)
rankfire20 = rankPool("fire", 20, 18)
rankwater1 = rankPool("water", 1, 18)
rankwater5 = rankPool("water", 5, 18)
rankwater20 = rankPool("water", 20, 18)
rankair1 = rankPool("air", 1, 18)
rankair5 = rankPool("air", 5, 18)
rankair20 = rankPool("air", 20, 18)
rankrock1 = rankPool("rock", 1, 18)
rankrock5 = rankPool("rock", 5, 18)
rankrock20 = rankPool("rock", 20, 18)

--- The two numbers that size the HEALTH and SHIELD pools, swept together.
---
--- Damage and pools have to move together or the game has a different shape at
--- every level, and the rebuilt move catalog moved damage: every element move
--- deals some now, where four of them dealt none, and a three-slot roster
--- therefore carries one to three damaging moves where the old four-slot one
--- typically carried one. Measured effect at the old `hpPerHealth = 12`: a
--- median of 2-4 rounds and up to 32% of fights decided on the first swing.
---
--- Swept rather than reasoned about, because `attackPerStatPoint` puts a
--- fighter's whole stat budget into its damage and the interaction with the
--- pools is not linear.
local function hpSweepOver(hps)
 return function(base, req)
  TRIALS = 8
  local out = {}
  out[#out + 1] = string.format("%-6s %-6s %-8s %-8s %-8s", "hp", "shield", "score", "worst 1rd", "worst med")
  local best, bestScore = nil, math.huge
  for _, hp in ipairs(hps) do
    for _, sh in ipairs({ 4, 6, 8, 10 }) do
      Battle.TUNING.hpPerHealth = hp
      Battle.TUNING.shieldPerDefense = sh
      local rows, score = profile()
      local worstQuick, worstMedian = 0, 0
      for _, r in ipairs(rows) do
        if r.quick > worstQuick then worstQuick = r.quick end
        if math.abs(r.median - 7) > math.abs(worstMedian - 7) then worstMedian = r.median end
      end
      out[#out + 1] = string.format("%-6d %-6d %-8.1f %-8s %-8d", hp, sh, score,
        string.format("%d%%", math.floor(worstQuick * 100)), worstMedian)
      if score < bestScore then bestScore = score; best = { hp = hp, sh = sh } end
    end
  end
  out[#out + 1] = ""
  out[#out + 1] = string.format("best: hpPerHealth=%d shieldPerDefense=%d  (score %.1f)",
    best.hp, best.sh, bestScore)
  return table.concat(out, string.char(10))
 end
end

hpsweepa = hpSweepOver({ 12, 16 })
hpsweepb = hpSweepOver({ 20, 24 })
hpsweepc = hpSweepOver({ 28, 32 })

--- One candidate pair of pool constants, at full trial count. The sweep above
--- is 8 trials a cell and its score is dominated by the 200x first-round
--- penalty, so a single unlucky fight moves a cell by 25 points; use it to find
--- the neighbourhood and one of these to choose inside it.
local function poolsAt(hp, sh)
  return function(base, req)
    Battle.TUNING.hpPerHealth = hp
    Battle.TUNING.shieldPerDefense = sh
    local out = {}
    local rows, score = profile()
    out[#out + 1] = string.format("hpPerHealth=%d shieldPerDefense=%d  score %.1f", hp, sh, score)
    out[#out + 1] = ""
    render(rows, out)
    return table.concat(out, string.char(10))
  end
end

pools124 = poolsAt(12, 4)
pools206 = poolsAt(20, 6)
pools208 = poolsAt(20, 8)
pools246 = poolsAt(24, 6)
pools248 = poolsAt(24, 8)
pools326 = poolsAt(32, 6)
pools288 = poolsAt(28, 8)
pools2410 = poolsAt(24, 10)
pools244 = poolsAt(24, 4)
pools204 = poolsAt(20, 4)
pools284 = poolsAt(28, 4)
pools245 = poolsAt(24, 5)
pools286 = poolsAt(28, 6)
pools366 = poolsAt(36, 6)

--- `players`, one level per entry point.
---
--- The whole table used to fit inside the node's gateway timeout. It does not
--- any more: the rebuilt catalog and the bigger pools put the median fight at
--- 7-9 rounds instead of 4-5, and a thousand longer fights is more than
--- twenty-five seconds of Luerl. A level is the unit anybody asks about
--- anyway -- `playersat1`, `playersat20`.
local function playersAt(level, trials)
  return function(base, req)
    TRIALS = trials
    local out = {}
    out[#out + 1] = string.format(
      "level %d -- hpPerHealth=%s shieldPerDefense=%s speedSwing=%s moveUses=%s riderPerPoint=%s riderCap=%s",
      level, Battle.TUNING.hpPerHealth, Battle.TUNING.shieldPerDefense,
      Battle.TUNING.speedSwing, Battle.TUNING.moveUses,
      Battle.TUNING.riderPerPoint, Battle.TUNING.riderCapShare)
    out[#out + 1] = ""
    out[#out + 1] = string.format("%-18s %-8s %-6s %-7s %-7s", "matchup", "median", "p90", ">30", "ran dry")
    for _, m in ipairs(MATCHUPS) do
      local r = measurePvp(level, m[1], m[2])
      out[#out + 1] = string.format("%-18s %-8d %-6d %-7s %-7s",
        m[1] .. " v " .. m[2], r.median, r.p90,
        string.format("%d%%", math.floor(r.grind * 100)),
        string.format("%d%%", math.floor(r.dry * 100)))
    end
    return table.concat(out, string.char(10))
  end
end

playersat1  = playersAt(1, 30)
playersat5  = playersAt(5, 30)
playersat10 = playersAt(10, 30)
playersat20 = playersAt(20, 25)

--- The shield wall, swept.
---
--- Shield regeneration is a share of a CAP that grows with the defense stat, so
--- it is the one recovery in the game that gets stronger the less it is needed:
--- two defensive builds can regenerate more per round than either removes, and
--- the fight never ends. Raising `shieldPerDefense` from 4 to 6 for the new
--- damage numbers made that worse by half again -- the tank mirror measured 50
--- rounds, 100% grind and 100% exhausted at every level from 5 up.
---
--- The tank mirror is the binding constraint on both numbers, so it is what
--- they get swept against, alongside `even v even` so that a setting which
--- fixes the stall by making every fight short does not win.
function tanksweep(base, req)
  TRIALS = 12
  local out = {}
  out[#out + 1] = string.format("%-7s %-7s %-6s %-14s %-14s",
    "shield", "regen", "level", "tank v tank", "even v even")
  for _, sh in ipairs({ 4, 5, 6 }) do
    for _, regen in ipairs({ 0, 0.04, 0.08 }) do
      Battle.TUNING.shieldPerDefense = sh
      Battle.TUNING.shieldRegenShare = regen
      for _, level in ipairs({ 5, 20 }) do
        local t = measurePvp(level, "tank", "tank")
        local e = measurePvp(level, "even", "even")
        out[#out + 1] = string.format("%-7d %-7s %-6d %-14s %-14s",
          sh, regen, level,
          string.format("%d rd %d%%>30", t.median, math.floor(t.grind * 100)),
          string.format("%d rd %d%%>30", e.median, math.floor(e.grind * 100)))
      end
    end
  end
  return table.concat(out, string.char(10))
end

--- The pools and the attack floor, swept against REAL growth.
---
--- `hpsweep` and `pools*` above measure `makeOpponent` against `makeOpponent`,
--- and that is the least relevant of the three fights in the game: a bot is
--- built on `10 + level*2` stat points and a player on `10 + level*10`, so
--- bot-versus-bot at level 20 is fifty points against fifty when the fight
--- players actually have is two hundred and ten against fifty, or against each
--- other. A pool size chosen to keep paper monsters alive makes the tank mirror
--- unfinishable, which is exactly what raising `hpPerHealth` to 32 did: 50
--- rounds and 100% exhausted at every level from five up.
---
--- So the pools get chosen here instead. `attackPerStatPoint` is swept with
--- them because it is the only term that gives a defensive build damage -- it
--- is a floor measured from the fighter's own budget, so it is worth most
--- exactly where attack is worth least, which is the tank mirror.
HP_GRID = { 12, 16, 20 }
APT_GRID = { 0.2, 0.35, 0.5 }
function growsweep(base, req)
  TRIALS = 10
  local out = {}
  out[#out + 1] = string.format("%-5s %-7s %-6s %-13s %-13s %-13s",
    "hp", "atk/pt", "level", "tank v tank", "even v even", "tank v bruiser")
  for _, hp in ipairs(HP_GRID) do
    for _, apt in ipairs(APT_GRID) do
      Battle.TUNING.hpPerHealth = hp
      Battle.TUNING.attackPerStatPoint = apt
      for _, level in ipairs({ 5, 20 }) do
        local t = measurePvp(level, "tank", "tank")
        local e = measurePvp(level, "even", "even")
        local b = measurePvp(level, "tank", "bruiser")
        out[#out + 1] = string.format("%-5d %-7s %-6d %-13s %-13s %-13s",
          hp, apt, level,
          string.format("%d rd %d%%", t.median, math.floor(t.grind * 100)),
          string.format("%d rd %d%%", e.median, math.floor(e.grind * 100)),
          string.format("%d rd %d%%", b.median, math.floor(b.grind * 100)))
      end
    end
  end
  return table.concat(out, string.char(10))
end

--- The same sweep in the pool range the `even` mirror actually wants. Small
--- pools finish the tank mirror and reduce every other matchup to two rounds;
--- these are the sizes where a balanced fight is still a fight.
function growsweepb(base, req)
  HP_GRID = { 28, 32, 36 }
  APT_GRID = { 0.2, 0.35, 0.5 }
  return growsweep(base, req)
end

function growsweepc(base, req)
  HP_GRID = { 32, 40, 48 }
  APT_GRID = { 0.15, 0.2, 0.25 }
  return growsweep(base, req)
end

function growsweepd(base, req)
  HP_GRID = { 32, 48, 64 }
  APT_GRID = { 0, 0.05, 0.1 }
  return growsweep(base, req)
end

--- The same grid played by builds a per-stat cap of THREE can reach.
---
--- `growsweep` and its variants say the same thing the 2026-08 sweep said, with
--- a completely rebuilt move catalog and a rebuilt rider system under it: at a
--- per-stat cap of five there is no pair of (`hpPerHealth`,
--- `attackPerStatPoint`) that makes both mirrors work. Low floor and the tank
--- mirror runs to the round cap; high floor and the even mirror is over in two
--- rounds. The tank's identity is a stat left at 1, and nothing downstream of
--- that can bridge it.
local function cappedGrow(hps, apts)
  return function(base, req)
    ACTIVE_BUILDS = CAPPED_BUILDS
    HP_GRID = hps
    APT_GRID = apts
    return growsweep(base, req)
  end
end

capgrowa = cappedGrow({ 28, 32, 36 }, { 0.1, 0.2, 0.35 })
capgrowb = cappedGrow({ 40, 48, 56 }, { 0, 0.05, 0.1 })

--- The acceptance matrix at one candidate pool size, so round length can be
--- chosen without giving up build viability.
local function matrixPool(level, hp, trials)
  return function(base, req)
    Battle.TUNING.hpPerHealth = hp
    local out = {}
    out[#out + 1] = string.format("hpPerHealth=%d shieldPerDefense=%s attackPerStatPoint=%s",
      hp, Battle.TUNING.shieldPerDefense, Battle.TUNING.attackPerStatPoint)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

mx20h24 = matrixPool(20, 24, 20)
mx20h28 = matrixPool(20, 28, 20)
mx5h24 = matrixPool(5, 24, 20)
mx5h28 = matrixPool(5, 28, 20)
mx5h32 = matrixPool(5, 32, 20)
mx20h32 = matrixPool(20, 32, 20)
mx5h36 = matrixPool(5, 36, 20)
mx20h36 = matrixPool(20, 36, 20)

--- The merged neutral pool is eighteen moves, which is three requests' worth.
--- Split by `type` rather than arbitrarily, because the three kinds are priced
--- against different things: a strike against the element pools, a boost and a
--- heal against Rally and Mend.
rankstrike5  = rankPool("neutral", 5, 20, "normal")
rankboost5   = rankPool("neutral", 5, 12, "boost")
rankheal5    = rankPool("neutral", 5, 12, "heal")
rankstrike20 = rankPool("neutral", 20, 15, "normal")
rankboost20  = rankPool("neutral", 20, 15, "boost")
rankheal20   = rankPool("neutral", 20, 15, "heal")


--- The acceptance matrix at one pool size AND one speed swing.
---
--- Those are the two knobs left once the catalog is priced: `hpPerHealth` sets
--- how long a fight is, and `speedSwing` sets what a point of speed is worth
--- against a point of health. They have to be chosen together, because a bigger
--- pool makes health worth more and pushes the speed build under.
local function matrixSpeed(level, hp, swing, trials)
  return function(base, req)
    Battle.TUNING.hpPerHealth = hp
    Battle.TUNING.speedSwing = swing
    local out = {}
    out[#out + 1] = string.format("hpPerHealth=%d speedSwing=%s shieldPerDefense=%s",
      hp, swing, Battle.TUNING.shieldPerDefense)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

sp5a = matrixSpeed(5, 32, 0.45, 20)
sp5b = matrixSpeed(5, 32, 0.6, 20)
sp20a = matrixSpeed(20, 32, 0.45, 20)
sp20b = matrixSpeed(20, 32, 0.6, 20)


--- The matrix with damage mitigation from the defense stat switched on.
---
--- `defenseMitigationMax` has been zero since it was written, and the note on
--- the constant says why it exists: attack MULTIPLIES, applying to every swing
--- a fighter makes, while health and defense buy a POOL that is spent once. So
--- over a twelve-swing fight an attack point is worth about four health points,
--- and no amount of `hpPerHealth` changes the ratio -- it scales both sides.
--- The only thing that changes it is giving the defensive stats something that
--- multiplies too, which is this.
---
--- Measured as the thing that decides whether `even` and `tank` are worth
--- playing at level 20 once the move catalog stopped hiding the problem.
local function matrixFull(level, hp, swing, mit, trials)
  return function(base, req)
    Battle.TUNING.hpPerHealth = hp
    Battle.TUNING.speedSwing = swing
    Battle.TUNING.defenseMitigationMax = mit
    local out = {}
    out[#out + 1] = string.format(
      "hpPerHealth=%d speedSwing=%s defenseMitigationMax=%s shieldPerDefense=%s",
      hp, swing, mit, Battle.TUNING.shieldPerDefense)
    out[#out + 1] = ""
    renderMatrix(level, trials, out)
    return table.concat(out, string.char(10))
  end
end

mit5a = matrixFull(5, 32, 0.45, 0.3, 20)
mit20a = matrixFull(20, 32, 0.45, 0.3, 20)
mit5b = matrixFull(5, 32, 0.45, 0.5, 20)
mit20b = matrixFull(20, 32, 0.45, 0.5, 20)
mit5c = matrixFull(5, 24, 0.45, 0.5, 20)
mit20c = matrixFull(20, 24, 0.45, 0.5, 20)
mit5d = matrixFull(5, 28, 0.45, 0.5, 20)
mit20d = matrixFull(20, 28, 0.45, 0.5, 20)
mit1d = matrixFull(1, 28, 0.45, 0.5, 20)
mit1b = matrixFull(1, 32, 0.45, 0.5, 25)
mit10b = matrixFull(10, 32, 0.45, 0.5, 25)


-- The fight the game actually has --------------------------------------------
--
-- `balance` plays `makeOpponent` against `makeOpponent` and the matrix plays a
-- grown player against a grown player. Neither of them is the ARENA, which is a
-- grown player against `makeOpponent` and is the single most common fight in
-- the game -- and until this existed nothing measured it.
--
-- The gap mattered: a bot carries `10 + level*2` stat points against a player's
-- `10 + level*10`, so at level 20 the two profiles above are fifty against
-- fifty and two hundred and ten against two hundred and ten, and the fight
-- players spend most of their Rune on is two hundred and ten against fifty.
--
-- What we want from it: the player wins most of the time but not all of it, the
-- fight is worth watching rather than a one-swing formality, and it does not
-- grind.

function arenaFight(level, build, seed, difficulty)
  math.randomseed(seed)
  local player = grow(level, ACTIVE_BUILDS[build])
  local bot = Battle.makeOpponent(level, { difficulty = difficulty or 1.0 })
  local f = Battle.new("arena", player, "P", bot, "B", { kind = "bot", timestamp = 0 })
  local n = 0
  while f.status ~= "ended" and n < ROUND_CAP do
    n = n + 1
    Battle.resolveRound(f,
      Battle.chooseNpcMove(f.challenger, f.accepter),
      Battle.chooseNpcMove(f.accepter, f.challenger))
  end
  return f, n
end

local function arenaAt(level, trials, difficulty)
  return function(base, req)
    local out = {}
    out[#out + 1] = string.format(
      "arena at level %d, difficulty %s -- a grown player against Battle.makeOpponent",
      level, difficulty or 1.0)
    out[#out + 1] = ""
    out[#out + 1] = string.format("%-10s %-8s %-8s %-8s %-8s",
      "build", "win%", "median", "p90", ">30")
    for _, build in ipairs(BUILD_ORDER) do
      local wins, rounds, grind = 0, {}, 0
      for trial = 1, trials do
        local f, n = arenaFight(level, build, level * 31337 + trial, difficulty)
        if f.winner == "challenger" then wins = wins + 1 end
        rounds[#rounds + 1] = n
        if n > 30 then grind = grind + 1 end
      end
      table.sort(rounds)
      out[#out + 1] = string.format("%-10s %-8s %-8d %-8d %-8s",
        build,
        string.format("%d%%", math.floor(wins / trials * 100 + 0.5)),
        rounds[math.max(1, math.floor(#rounds * 0.5))],
        rounds[math.max(1, math.floor(#rounds * 0.9))],
        string.format("%d%%", math.floor(grind / trials * 100)))
    end
    return table.concat(out, string.char(10))
  end
end

arena1  = arenaAt(1, 30)
arena5  = arenaAt(5, 30)
arena10 = arenaAt(10, 25)
arena20 = arenaAt(20, 20)


--- What share of a player's stat budget a trainer bot should carry.
---
--- The arena has to be winnable and not free. Too low and it is the walkover
--- the old `10 + level*2` produced -- 100% at every level, in three rounds.
--- Too high and a session costing 25 energy and 25 happiness is a coin flip.
function botsweep(base, req)
  local out = {}
  out[#out + 1] = string.format("%-8s %-7s %-24s %-8s", "share", "level", "win% by build", "median")
  for _, share in ipairs({ 0.7, 0.8, 0.9 }) do
    Battle.TUNING.botBudgetShare = share
    for _, level in ipairs({ 1, 5, 20 }) do
      local parts, medians = {}, {}
      for _, build in ipairs(BUILD_ORDER) do
        local wins, rounds = 0, {}
        for trial = 1, 20 do
          local f, n = arenaFight(level, build, level * 31337 + trial)
          if f.winner == "challenger" then wins = wins + 1 end
          rounds[#rounds + 1] = n
        end
        table.sort(rounds)
        parts[#parts + 1] = string.format("%d", math.floor(wins / 20 * 100 + 0.5))
        medians[#medians + 1] = rounds[10]
      end
      out[#out + 1] = string.format("%-8s %-7d %-24s %-8s",
        share, level, table.concat(parts, "/"), table.concat(medians, "/"))
    end
  end
  return table.concat(out, string.char(10))
end
