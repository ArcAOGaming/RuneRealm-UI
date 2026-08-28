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
          for _, regen in ipairs({ 10, 20 }) do
            for _, uses in ipairs({ 2, 3, 5 }) do
              Battle.TUNING.hpPerHealth = hp
              Battle.TUNING.shieldPerDefense = sh
              Battle.TUNING.attackBase = ab
              Battle.TUNING.shieldRegen = regen
              Battle.TUNING.moveUses = uses
              local rows, s = profile()
              tried = tried + 1
              if s < bestScore then
                bestScore = s
                best = { hpPerHealth = hp, shieldPerDefense = sh, attackBase = ab,
                         shieldRegen = regen, moveUses = uses, rows = rows }
              end
            end
          end
        end
      end
    end
    out[#out + 1] = string.format("swept %d combinations", tried)
    out[#out + 1] = string.format(
      "best: hpPerHealth=%s shieldPerDefense=%s attackBase=%s shieldRegen=%s moveUses=%s  (score %.1f)",
      best.hpPerHealth, best.shieldPerDefense, best.attackBase,
      best.shieldRegen, best.moveUses, bestScore)
    out[#out + 1] = ""
    render(best.rows, out)
    return table.concat(out, "\n")
  end
end

function balance(base, req)
  local out = {}
  local rows, s = profile()
  out[#out + 1] = string.format(
    "tuning: hpPerHealth=%s shieldPerDefense=%s attackBase=%s shieldRegen=%s healPerPoint=%s",
    Battle.TUNING.hpPerHealth, Battle.TUNING.shieldPerDefense,
    Battle.TUNING.attackBase, Battle.TUNING.shieldRegen, Battle.TUNING.healPerPoint)
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
