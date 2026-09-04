--- heap_probe.lua -- how many Luerl tables does one message leave behind?
---
--- This exists because the snapshot question ("is the 900x bloat live data or
--- uncollected garbage?") cannot be answered from Lua by asking for a size:
--- Luerl's `collectgarbage("count")` is a stub and returns nil, as does every
--- argument except `"collect"`.
---
--- It CAN be answered by counting tables. Luerl allocates each table a slot in
--- one global store and `tostring` prints the index:
---
---     tostring({})  -->  "table: 5020"
---
--- so the index of a freshly made table is a direct read of the store's high
--- water mark, and its growth across a message is the number of tables that
--- message left in the heap. The snapshot is `term_to_binary` of that store, so
--- tables-per-message IS bytes-per-message up to a constant.
---
--- Two loops, same actions, one variable:
---
---   * gc off -- `collectgarbage` is stubbed out, so nothing is collected and
---     the slope is everything the message ALLOCATED.
---   * gc on  -- the real collector runs at the end of `compute`, so the slope
---     is only what the message allocated and KEPT.
---
--- The difference between the two slopes is garbage. `User.Login` changes no
--- state at all, so its gc-on slope should be ~0; `Monster.Adopt` writes a real
--- ~1 KB record, so its gc-on slope is the honest cost of the data.
---
---   bash backend/native/run-heap-probe.sh [node-url]
---
--- Driven from the outermost Lua frame with no `pcall` anywhere, for the reason
--- given at the end of `compute` in game.lua: a collect inside a pcall frame
--- takes the VM down.

local function slot()
  -- The index of a table allocated right now. `tostring` itself allocates
  -- nothing else, so consecutive readings differ by exactly the tables made in
  -- between (plus the one probe table, which cancels in a slope).
  return tonumber(string.match(tostring({}), "%d+"))
end

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

  local function send(from, tags)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    return compute({ process = PROCESS }, { body = body, timestamp = T }, {})
  end

  local realgc = collectgarbage
  local function gc(on)
    _G.collectgarbage = on and realgc or function() end
  end

  -- Owner-side helpers, so a scenario's SETUP is not charged to the verb it is
  -- measuring. Everything here runs before the reading is taken.
  local function unlock(who) send(OWNER, { Action = "Admin.Unlock", Addresses = who }) end
  local function grant(who, item, amount)
    send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = item, Amount = amount })
  end
  local function restock(who)
    -- Energy and happiness are 25 apiece per arena entry, so a scenario that
    -- fights more than three times silently starts measuring "Not enough
    -- energy" instead of a battle.
    send(OWNER, { Action = "Admin.SetStats", PlayerId = who,
      Data = json.encode({ energy = 100, happiness = 100,
        status = { type = "Home", since = 0, until_time = 0 } }) })
  end
  --- A wallet with a companion and a full satchel.
  --- Joining a faction ALSO adopts, so `Monster.Adopt` afterwards answers "You
  --- have already adopted" -- an error path costs almost nothing and would have
  --- been reported here as a cheap write.
  local function ready(who)
    unlock(who)
    send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
    grant(who, "fire_berry", 500)
    grant(who, "rune", 500)
    restock(who)
    return who
  end

  --- One measured loop.
  ---
  --- `prepare(prefix, count)` returns whatever `step` needs and runs OUTSIDE the
  --- reading; `step(ctx, i)` sends exactly the message under test.
  local function measure(label, count, prefix, prepare, step, withGc)
    local ctx = prepare(prefix, count)
    gc(withGc)
    local before = slot()
    for i = 1, count do step(ctx, i) end
    local after = slot()
    gc(true)
    line(string.format("%-30s %5d  slot %8d -> %8d   %9.1f tables/msg",
      label, count, before, after, (after - before) / count))
    return (after - before) / count
  end

  -- Small on purpose: nginx in front of the node gives up around 25s and a
  -- gc-OFF loop is deliberately the slowest thing this bundle can do. A slope
  -- is a slope; six messages measure it as well as sixty.
  local N = tonumber(req and req.body and req.body.N) or 6

  --- The handlers the brief names, plus the two the original probe carried.
  ---
  --- `perMessage` is false where one step is a whole session rather than one
  --- message, so the number is not silently compared against a per-message one.
  local SCENARIOS = {
    {
      name = "User.Login (read)",
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who) send(who, { Action = "User.Login" }) end,
    },
    {
      name = "User.Info (read)",
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who) send(who, { Action = "User.Info" }) end,
    },
    {
      name = "Monster.Feed",
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who, i)
        -- Feeding caps at MAX_ENERGY and then refuses, so drain it back down
        -- between feeds. `Admin.SetStats` is owner-signed and counted.
        if i % 2 == 0 then
          send(OWNER, { Action = "Admin.SetStats", PlayerId = who,
            Data = json.encode({ energy = 0 }) })
        end
        send(who, { Action = "Monster.Feed", Item = "fire_berry" })
      end,
    },
    {
      name = "Monster.Play",
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who) send(who, { Action = "Monster.Play" }) end,
    },
    {
      name = "Daily.Claim",
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who) send(who, { Action = "Daily.Claim" }) end,
    },
    {
      name = "Admin.Unlock (1 account)",
      prepare = function(p) return p end,
      step = function(p, i) unlock(addr(p, i)) end,
    },
    {
      name = "Unlock+Join (new player)",
      prepare = function(p) return p end,
      step = function(p, i)
        local who = addr(p, i)
        unlock(who)
        send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
      end,
    },
    {
      name = "bot battle (whole fight)",
      perMessage = false,
      prepare = function(p) return ready(addr(p, 0)) end,
      step = function(who)
        restock(who)
        send(who, { Action = "Battle.Begin" })
        send(who, { Action = "Battle.Start" })
        for round = 1, 12 do
          local res = send(who, { Action = "Battle.Attack", Move = tostring(round % 4) })
          local body = type(res) == "table" and (res.body or res.Data) or nil
          if type(body) == "string" and string.find(body, '"ended"', 1, true) then break end
        end
        send(who, { Action = "Battle.Leave" })
      end,
    },
  }

  line(string.format("%-30s %5s  %-30s %9s", "scenario", "n", "", "slope"))
  line("")
  local results = {}
  for index, scenario in ipairs(SCENARIOS) do
    -- Distinct address prefixes per arm: an account carries state, so reusing
    -- one across the gc-OFF and gc-ON loops would measure two different players.
    local off = measure(scenario.name .. "  gc OFF", N,
      string.format("A%d", index), scenario.prepare, scenario.step, false)
    local on = measure(scenario.name .. "  gc ON ", N,
      string.format("B%d", index), scenario.prepare, scenario.step, true)
    results[#results + 1] = { name = scenario.name, off = off, on = on,
      perMessage = scenario.perMessage ~= false }
    line("")
  end

  line("")
  line(string.format("%-30s %12s %12s %10s", "scenario", "allocated", "kept", "garbage"))
  table.sort(results, function(a, b) return a.on > b.on end)
  for _, r in ipairs(results) do
    line(string.format("%-30s %12.1f %12.1f %9.1f%%%s",
      r.name, r.off, r.on,
      r.off > 0 and (100 * (r.off - r.on) / r.off) or 0,
      r.perMessage and "" or "   (per SESSION, not per message)"))
  end
  line("")
  line("Slope is tables per step left in the Luerl store. dev_lua keeps that")
  line("store live in the process message's `priv` between slots and serializes")
  line("it with term_to_binary every `process_snapshot_slots`, so tables kept IS")
  line("bytes carried, up to a constant. `kept` is the honest cost of the data;")
  line("`garbage` is what a collectgarbage placement could have saved.")
  return table.concat(out, "\n")
end

function heapprobe(base, req)
  return run(base, req)
end
