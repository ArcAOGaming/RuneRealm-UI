--- scale_guard.lua -- does one player's action read every OTHER player?
---
--- This is the invariant the process needs and does not currently have:
---
---     one gameplay message must not walk the player table.
---
--- It is worth a guard rather than a code review because breaking it is
--- invisible until it is fatal. `factionStats()` and `leaderboard()` each
--- iterate every account and build a table per account, and both are reachable
--- from any action whose `ACTION_DIRTY` entry sets `aggregates` -- which is most
--- of the game. At fifty players that is a hundred tables nobody can measure.
--- At ten thousand it is twenty thousand tables and a ten-thousand-element sort
--- per action, and then a `collectgarbage("collect")` whose cost is quadratic in
--- the live heap. The failure does not arrive gradually; it arrives all at once,
--- at a population no test uses.
---
--- The same mistake was made and fixed once already in this file:
--- `rebuildTelemetryTotals` used to run on the action path and now does not
--- ("the normal action path below never walks `Players`"). Faction stats and the
--- leaderboard never got the same treatment.
---
--- HOW IT MEASURES
---
--- By counting the walks, with a metatable. `Players` is swapped for a proxy
--- whose `__pairs` records every scan and how many accounts it visited; reads
--- and writes pass through untouched. Luerl implements `__pairs` (verified), and
--- `game.lua` never uses `rawget`, `rawset` or `next` on `Players`, so nothing
--- can reach the real table behind the proxy.
---
--- This replaces an earlier attempt that counted Luerl's table-store index the
--- way `heap_probe.lua` does. That method cannot be trusted here: Luerl collects
--- on its own once the heap is large, which renumbers the store and sends the
--- reading NEGATIVE -- as it did, at exactly the populations the guard exists to
--- test. Counting scans is immune to all of it: no clock, no heap, no collector,
--- the same answer every run.
---
---   bash backend/native/run-scale-guard.sh [node-url]

--- How many accounts a single gameplay message may visit.
---
--- Zero is the real answer and the one to aim at. The budget is a named constant
--- so that a deliberate bounded scan can be allowed on purpose rather than by
--- accident, and so the failure reports a number instead of a boolean.
local BUDGET = 0
local SMALL, LARGE = 20, 100

local function addr(prefix, n)
  local s = prefix .. tostring(n)
  return s .. string.rep("z", 43 - #s)
end

local function run(base, req)
  local out = {}
  local function line(s) out[#out + 1] = s end

  local json = require(".json")
  local T = 1700000000000
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }

  -- `result` IS `base` on the node, and the node feeds it back in as the next
  -- slot's base. Threading it here is not a nicety: handing `compute` a fresh
  -- table each message makes every derived key look absent, and the `== nil`
  -- guards then rebuild `factions` and `leaderboard` on EVERY message including
  -- reads -- so the guard would fail for a reason the real process never has.
  local state = { process = PROCESS }
  local function send(from, tags)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    state = compute(state, { body = body, timestamp = T }, {})
    return state
  end

  local scans, visited = 0, 0

  --- Swap `Players` for a counting proxy.
  ---
  --- The real table is captured once and the proxy holds nothing itself, so
  --- `__index` and `__newindex` fire for every access and forward verbatim --
  --- including `Players[address] = nil`, which is how an account is removed.
  local function installProxy()
    local real = Players
    -- Idempotent: wrapping a proxy in a proxy would double-count every scan.
    if getmetatable(real) then return end
    Players = setmetatable({}, {
      __index = real,
      __newindex = function(_, k, v) real[k] = v end,
      __len = function() return #real end,
      __pairs = function()
        scans = scans + 1
        for _ in next, real do visited = visited + 1 end
        return next, real, nil
      end,
    })
  end

  local function populate(prefix, count)
    for i = 1, count do
      local who = addr(prefix, i)
      send(OWNER, { Action = "Admin.Unlock", Addresses = who })
      send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
    end
    local subject = addr(prefix, 1)
    send(OWNER, { Action = "Admin.Grant", PlayerId = subject, Item = "fire_berry", Amount = 500 })
    return subject
  end

  --- Accounts visited by ONE message. `prepare` runs before the counters are
  --- zeroed, so its own walks are never charged to the action under test.
  local function walkCost(subject, action, prepare)
    if prepare then prepare(subject) end
    installProxy()
    scans, visited = 0, 0
    send(subject, action)
    return scans, visited
  end

  -- Feeding stops at full energy and then answers an error, which walks nothing
  -- and would make an O(N) handler look O(1).
  local function drain(subject)
    send(OWNER, { Action = "Admin.SetStats", PlayerId = subject,
      Data = json.encode({ energy = 0 }) })
  end

  local CASES = {
    { name = "User.Info (read)", action = { Action = "User.Info" } },
    { name = "Monster.Feed (write)", action = { Action = "Monster.Feed", Item = "fire_berry" },
      prepare = drain },
    { name = "Monster.Play (write)", action = { Action = "Monster.Play" }, prepare = drain },
    { name = "Daily.Claim (write)", action = { Action = "Daily.Claim" } },
  }

  local smallSubject = populate("S", SMALL)
  local small = {}
  for index, case in ipairs(CASES) do
    local scanCount, seen = walkCost(smallSubject, case.action, case.prepare)
    small[index] = { scans = scanCount, visited = seen }
  end

  -- Both populations live in the same process, so the second reading is taken
  -- with SMALL + LARGE accounts present. An O(1) handler visits the same number
  -- either way -- zero -- and an O(N) one visits every account both times.
  local largeSubject = populate("L", LARGE)
  local failures = 0

  line(string.format("%-24s %-20s %-20s %8s", "action",
    SMALL .. " players", (SMALL + LARGE) .. " players", "verdict"))
  line(string.rep("-", 76))
  for index, case in ipairs(CASES) do
    local scanCount, seen = walkCost(largeSubject, case.action, case.prepare)
    local ok = seen <= BUDGET
    if not ok then failures = failures + 1 end
    line(string.format("%-24s %-20s %-20s %8s", case.name,
      string.format("%d walks, %d seen", small[index].scans, small[index].visited),
      string.format("%d walks, %d seen", scanCount, seen),
      ok and "ok" or "FAIL"))
  end

  line("")
  line("`seen` is how many accounts one message visited. It must not grow with")
  line(string.format("the population, and the budget is %d.", BUDGET))
  line("")
  if failures > 0 then
    line(string.format("SCALE GUARD FAILED: %d of %d actions read the whole player table.",
      failures, #CASES))
    line("Derived state has to be kept incrementally, the way")
    line("`rebuildTelemetryTotals` already is: update the running totals in the")
    line("handler that changes them, and rebuild in full only on `Admin.Load`,")
    line("`Admin.AdjustAll` and a redeploy.")
  else
    line(string.format("SCALE GUARD PASSED: all %d actions are O(1) in the player count.", #CASES))
  end
  return table.concat(out, "\n")
end

function scaleguard(base, req)
  return run(base, req)
end
