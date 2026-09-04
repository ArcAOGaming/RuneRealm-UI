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

local BUILDS = {
  -- `C.LEVEL_UP_POINTS` points a level with `C.LEVEL_UP_MAX_PER_STAT` as the
  -- per-stat cap. At ten and five that is two stats maxed and two left at their
  -- starting value, so these are the extremes a player can actually reach
  -- rather than hypothetical ones.
  tank    = { defense = 5, health = 5 },
  bruiser = { attack = 5, health = 5 },
  glass   = { attack = 5, speed = 5 },
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
  m.moves = Battle.rollMoves(m.elementType)
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
