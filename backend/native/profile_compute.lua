--- profile_compute.lua -- where does a message's time actually go?
---
--- The question this answers is "an attack takes forever, what is it doing",
--- and the answer is not necessarily the attack. The profiler keeps a real
--- carried process state so it measures the steady-state dirty-domain path:
--- player actions still rebuild player-derived aggregates when necessary, but
--- unrelated market, asset and worker-queue surfaces stay cached.
---
--- Remote samples use `os.clock`, require it to advance on every repeat, and
--- report a three-repeat median plus range. The offline WASM module freezes that
--- clock, so run-local-profile.mjs uses a host monotonic clock around forked
--- checkpoints instead. The state is seeded from the recovered players, so the
--- numbers are against a realistic table rather than an empty one.
---
---   bash backend/native/run-profile.sh [node-url] [players]
---
--- Sections are compared by DIFFERENCE: run-profile.sh builds variants of the
--- bundle with one publish block stubbed out. A difference is meaningful only
--- when it exceeds the reported repeat ranges. A near-zero market/assets
--- difference on Feed or Attack is expected and confirms that the domain gate
--- skipped that work. These are Lua CPU measurements, not end-to-end scheduler,
--- network, snapshot or browser latency.
---
--- Driven from the outermost Lua frame with no `pcall` and no `ipairs` around a
--- message, for the reason at the end of `compute` in game.lua.

local function run(base, req)
  local out = {}
  local json = require(".json")
  local options = rawget(_G, "PROFILE_OPTIONS") or {}
  local function optionCount(name, fallback)
    local n = int(options[name], fallback)
    if not n or n < 0 or n > 10000 then
      error(name .. " must be an integer from 0 to 10000")
    end
    return n
  end
  local readSamples = optionCount("readSamples", 50)
  local feedSamples = optionCount("feedSamples", 50)
  local attackSamples = optionCount("attackSamples", 50)
  local repeatCount = optionCount("repeatCount", 3)
  if repeatCount < 1 then error("repeatCount must be at least 1") end
  PROFILE_T = 1700000000000
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }
  PROFILE_STATE = { process = PROCESS }

  function PROFILE_SEND(from, tags, data)
    PROFILE_T = PROFILE_T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    -- HyperBEAM carries the returned state into the next slot. A fresh table
    -- here forced every message through the missing-key fallback and measured
    -- first-spawn publication rather than the steady-state dirty-domain path.
    local res = compute(PROFILE_STATE, { body = body, timestamp = PROFILE_T }, {})
    PROFILE_STATE = res
    return json.decode(res.results.output.data), res
  end
  local send = PROFILE_SEND

  -- Seed a realistic table from the recovered players, in Admin.Load batches.
  local A = "PROFAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local payload = json.decode([==[__PAYLOAD__]==])
  local rows = payload.players
  if type(rows) ~= "table" then error("profile fixture has no players array") end
  local fixturePlayers = #rows
  local fixtureAddresses = {}
  for i = 1, fixturePlayers do
    local address = type(rows[i]) == "table" and (rows[i].address or rows[i].Address) or nil
    if type(address) ~= "string" or address == "" then
      error(string.format("profile fixture row %d has no address", i))
    end
    if address == A then error("profile fixture collides with dedicated profile player") end
    if fixtureAddresses[address] then
      error(string.format("profile fixture repeats address %s", address))
    end
    fixtureAddresses[address] = true
  end
  local seeded = 0
  for i = 1, #rows, 10 do
    local chunk = {}
    for j = i, math.min(i + 9, #rows) do chunk[#chunk + 1] = rows[j] end
    local r = send(OWNER, { Action = "Admin.Load" }, json.encode({ players = chunk }))
    seeded = seeded + ((r and r.loaded) or 0)
  end
  if seeded ~= fixturePlayers then
    error(string.format("Admin.Load seeded %d of %d fixture players", seeded, fixturePlayers))
  end

  PROFILE_A = A
  send(OWNER, { Action = "Admin.Unlock", Addresses = A })
  send(A, { Action = "Faction.Join", Faction = "Inferno Blades" })
  send(A, { Action = "Monster.Adopt" })
  send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = A, Item = "rune", Amount = "500" })
  send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = A,
                Item = "fire_berry",
                Amount = tostring(math.max(100, feedSamples * repeatCount + 5)) })

  local effectivePlayers = 0
  for _ in pairs(Players) do effectivePlayers = effectivePlayers + 1 end
  if effectivePlayers ~= fixturePlayers + 1 then
    error(string.format("effective Players count %d; expected fixture + profile player = %d",
      effectivePlayers, fixturePlayers + 1))
  end

  -- Time one action type, `count` times. Per-message microseconds retain useful
  -- precision for the offline WASM runner, while total elapsed makes timer
  -- resolution and sample size visible instead of hiding both behind 0.00 ms.
  local measurements = 0
  local function reportTiming(label, count, elapsedByRepeat, suffix)
    local ordered = {}
    for repeatIndex = 1, repeatCount do
      local elapsed = elapsedByRepeat[repeatIndex]
      if type(elapsed) ~= "number" or elapsed ~= elapsed or elapsed <= 0 then
        error(string.format(
          "%s repeat %d/%d: os.clock did not advance; remote timing is unavailable",
          label, repeatIndex, repeatCount))
      end
      ordered[#ordered + 1] = elapsed
    end
    table.sort(ordered)
    local medianElapsed = ordered[math.floor((#ordered + 1) / 2)]
    local medianUs = (medianElapsed / count) * 1000000
    local minUs = (ordered[1] / count) * 1000000
    local maxUs = (ordered[#ordered] / count) * 1000000
    measurements = measurements + 1
    out[#out + 1] = string.format(
      "%-28s %10.3f us/msg  x%d x%d repeats  median total %9.3f ms  range %.3f..%.3f us/msg%s",
      label, medianUs, count, repeatCount, medianElapsed * 1000, minUs, maxUs,
      suffix and ("  " .. suffix) or "")
    return medianUs
  end

  local function timed(label, count, fn)
    if count <= 0 then error(label .. " has no samples") end
    local elapsedByRepeat = {}
    for repeatIndex = 1, repeatCount do
      local t0 = os.clock()
      for i = 1, count do fn(i, repeatIndex) end
      elapsedByRepeat[repeatIndex] = os.clock() - t0
    end
    return reportTiming(label, count, elapsedByRepeat)
  end

  -- A read. It changes nothing, so it skips the republish block entirely and
  -- measures the floor: parse, dispatch, reply, collect.
  if readSamples > 0 then
    timed("User.Info (read-only)", readSamples, function()
      local r = send(A, { Action = "User.Info" })
      if not r or r.error then error("User.Info sample failed: " .. tostring(r and r.error)) end
    end)
  end

  -- A write that touches one player and republishes player-derived aggregates.
  if feedSamples > 0 then
    timed("Monster.Feed (write)", feedSamples, function()
      -- Keep each sample successful. The benchmark is the handler + publication
      -- path, not repeated fast "already full" failures after the first feed.
      if Players[A] and Players[A].monster then Players[A].monster.energy = 0 end
      local r = send(A, { Action = "Monster.Feed" })
      if not r or r.error then error("Monster.Feed sample failed: " .. tostring(r and r.error)) end
    end)
  end

  -- The arena. `Battle.Begin` opens a session, `Battle.Start` picks a bot, and
  -- then every attack is a write like any other.
  if Players[A] and Players[A].monster then
    Players[A].monster.energy = C.MAX_ENERGY
    Players[A].monster.happiness = C.MAX_HAPPINESS
  end
  local function availableMove(battle)
    for name, move in pairs((battle and battle.challenger or {}).moves or {}) do
      if int(move.count, 0) > 0 then return name end
    end
    -- Exhausted combatants may only use Struggle. Selecting this from the
    -- current battle view keeps every timed attack successful without charging
    -- battle setup to the sample.
    return "Struggle"
  end

  local function startBattle()
    local p = Players[A]
    if not p or not p.monster then error("profile player has no companion") end
    if p.monster.status.type ~= "Battle" or int(p.battlesRemaining, 0) <= 0 then
      p.monster.energy = C.MAX_ENERGY
      p.monster.happiness = C.MAX_HAPPINESS
      local entered = send(A, { Action = "Battle.Begin" })
      if not entered or entered.error then
        error("Battle.Begin setup failed: " .. tostring(entered and entered.error))
      end
    end
    local started = send(A, { Action = "Battle.Start" })
    if not started or started.error or not started.battle then
      error("Battle.Start setup failed: " .. tostring(started and started.error))
    end
    local move = availableMove(started.battle)
    if move == "Struggle" and Battle.hasMovesLeft(started.battle.challenger) then
      error("Battle.Start returned no usable move")
    end
    return started.battle.id, started.battle, move
  end

  local battleId, battle, move
  if attackSamples > 0 or options.prepareBattle then
    battleId, battle, move = startBattle()
    out[#out + 1] = string.format("battle=%s move=%s", tostring(battleId), tostring(move))
  end

  -- Only the attacks are on the clock.
  --
  -- A bot fight ends in a handful of rounds, so the loop has to open a new one
  -- to keep attacking. Timing the whole iteration charged those `Battle.Begin`
  -- and `Battle.Start` messages to `Battle.Attack` and inflated it; the clock
  -- now starts and stops around the attack alone, and the restarts are counted
  -- and reported separately so the reader can see how many there were.
  if battleId and move and attackSamples > 0 then
    local attacks, restarts = attackSamples, 0
    local elapsedByRepeat = {}
    for repeatIndex = 1, repeatCount do
      local total = 0
      for i = 1, attacks do
        -- A move's count is consumed by the preceding round. Re-select from the
        -- latest view so a long fight never benchmarks a fast rejected action.
        move = availableMove(battle)
        local t0 = os.clock()
        local r = send(A, { Action = "Battle.Attack", BattleId = battleId, Move = move })
        total = total + (os.clock() - t0)
        if not r or r.error or not r.battle then
          error(string.format("Battle.Attack repeat %d/%d sample failed: %s",
            repeatIndex, repeatCount, tostring(r and r.error)))
        end
        -- The engine's live status is `battling`; only `ended` requires setup.
        -- Comparing against the nonexistent `active` status restarted after
        -- every successful sample and made the reported attack number suspect.
        if r.battle.status == "ended" then
          restarts = restarts + 1
          battleId, battle, move = startBattle()
        elseif r.battle.status ~= "battling" then
          error("Battle.Attack returned unexpected status " .. tostring(r.battle.status))
        else
          battle = r.battle
        end
      end
      elapsedByRepeat[repeatIndex] = total
    end
    reportTiming("Battle.Attack", attacks, elapsedByRepeat,
      string.format("%d session restarts, not counted", restarts))
  end

  -- The offline harness measures the enclosing WASM evaluation with the host's
  -- monotonic high-resolution clock because this module's `os.clock()` is
  -- intentionally frozen. Avoid a trailing read/publication so its cost does
  -- not leak into the differential action measurement.
  if options.hostTiming then
    out[#out + 1] = string.format("measurements: %d", measurements)
    out[#out + 1] = string.format("repeats: %d", repeatCount)
    out[#out + 1] = string.format("fixture players: %d", fixturePlayers)
    out[#out + 1] = string.format("effective players: %d", effectivePlayers)
    return table.concat(out, "\n")
  end

  local _, res = send(A, { Action = "User.Info" })
  out[#out + 1] = ""
  out[#out + 1] = string.format("measurements: %d", measurements)
  out[#out + 1] = string.format("repeats: %d", repeatCount)
  out[#out + 1] = string.format("fixture players: %d", fixturePlayers)
  out[#out + 1] = string.format("effective players: %d", effectivePlayers)
  out[#out + 1] = "published bytes on the last reply:"
  local keys = { "leaderboard", "factions", "challenges", "market", "markethistory",
                 "economy", "assets", "catalog", "mintqueue", "runewithdrawals", "battle" }
  local total = 0
  for ki = 1, #keys do
    local v = res[keys[ki]]
    local n = type(v) == "string" and #v or 0
    total = total + n
    out[#out + 1] = string.format("  %-18s %8d B", keys[ki], n)
  end
  out[#out + 1] = string.format("  %-18s %8d B", "TOTAL", total)
  return table.concat(out, "\n")
end

local function localAvailableMove(battle)
  for name, move in pairs((battle and battle.challenger or {}).moves or {}) do
    if int(move.count, 0) > 0 then return name end
  end
  return "Struggle"
end

--- Untimed battle preparation for the host-clock offline harness.
---
--- Both combatants get a deliberately unreachable health/round ceiling so one
--- battle's capped-but-growing recent turn log is stressed for the whole batch.
--- This is intentionally a long-battle stress result, not a typical-fight
--- average. Settlement and starting the next session are different actions and
--- stay outside the timer instead of leaking into a random subset of samples.
function profilePrepareBattle()
  local A = PROFILE_A
  local p = A and Players[A]
  if not p or not p.monster or not PROFILE_SEND then
    error("local profile state has not been prepared")
  end
  if p.monster.status.type ~= "Battle" or int(p.battlesRemaining, 0) <= 0 then
    p.monster.energy = C.MAX_ENERGY
    p.monster.happiness = C.MAX_HAPPINESS
    local entered = PROFILE_SEND(A, { Action = "Battle.Begin" })
    if not entered or entered.error then
      error("Battle.Begin setup failed: " .. tostring(entered and entered.error))
    end
  end
  local started = PROFILE_SEND(A, { Action = "Battle.Start" })
  if not started or started.error or not started.battle then
    error("Battle.Start setup failed: " .. tostring(started and started.error))
  end
  local id = started.battle.id
  local battle = id and Battles[id]
  if not battle or not battle.challenger or not battle.accepter then
    error("Battle.Start did not create a complete battle")
  end
  for _, fighter in ipairs({ battle.challenger, battle.accepter }) do
    fighter.maxHealthPoints = 1000000000
    fighter.healthPoints = 1000000000
    fighter.maxShield = 1000000000
    fighter.shield = 1000000000
  end
  battle.round = -1000000
  PROFILE_BATTLE_ID = id
  PROFILE_BATTLE = Battle.view(battle)
  return "battle prepared"
end

--- Execute exactly one already-prepared action batch. JavaScript measures the
--- enclosing WASM call with a monotonic host clock; Lua's clock is frozen at
--- zero in the offline module. `noop` calibrates VM restore/Eval/checkpoint
--- overhead against the same prepared memory.
function profileLocalBatch(kind, count)
  count = int(count, nil)
  if not count or count < 1 or count > 10000 then
    error("local profile sample count must be an integer from 1 to 10000")
  end
  local A = PROFILE_A
  if not A or not PROFILE_SEND then error("local profile state has not been prepared") end

  if kind == "noop" then
    for _ = 1, count do end
  elseif kind == "read" then
    for _ = 1, count do
      local r = PROFILE_SEND(A, { Action = "User.Info" })
      if not r or r.error then error("User.Info sample failed: " .. tostring(r and r.error)) end
    end
  elseif kind == "feed" then
    for _ = 1, count do
      if Players[A] and Players[A].monster then Players[A].monster.energy = 0 end
      local r = PROFILE_SEND(A, { Action = "Monster.Feed" })
      if not r or r.error then error("Monster.Feed sample failed: " .. tostring(r and r.error)) end
    end
  elseif kind == "attack" then
    if not PROFILE_BATTLE_ID or not PROFILE_BATTLE then
      error("profile battle has not been prepared")
    end
    for _ = 1, count do
      local move = localAvailableMove(PROFILE_BATTLE)
      local r = PROFILE_SEND(A, {
        Action = "Battle.Attack", BattleId = PROFILE_BATTLE_ID, Move = move,
      })
      if not r or r.error or not r.battle then
        error("Battle.Attack sample failed: " .. tostring(r and r.error))
      end
      if r.battle.status ~= "battling" then
        error("Battle.Attack unexpectedly required a restart")
      end
      PROFILE_BATTLE = r.battle
    end
  else
    error("unknown local profile batch " .. tostring(kind))
  end
  return "measurements: 1"
end

function profile(base, req)
  return run(base, req)
end
