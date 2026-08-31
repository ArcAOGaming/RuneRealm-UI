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

  -- One measured loop. `make(i)` produces the tags for the i-th message.
  local function measure(label, count, first, make, withGc)
    gc(withGc)
    send(OWNER, { Action = "Admin.Unlock", Addresses = addr(first, 0) })
    local before = slot()
    for i = 1, count do
      local who = make(i)
      send(who.from, who.tags)
    end
    local after = slot()
    gc(true)
    line(string.format("%-34s %6d msgs   slot %8d -> %8d   %8.1f tables/msg",
      label, count, before, after, (after - before) / count))
    return (after - before) / count
  end

  -- Small on purpose: nginx in front of the node gives up around 25s and a
  -- gc-OFF loop is deliberately the slowest thing this bundle can do. A slope
  -- is a slope; six messages measure it as well as sixty.
  local N = tonumber(req and req.body and req.body.N) or 6

  -- A pure read. It writes nothing, so every table it leaves is garbage.
  local loginOff = measure("User.Login          gc OFF", N, "RA", function()
    return { from = addr("RA", 0), tags = { Action = "User.Login" } }
  end, false)
  local loginOn = measure("User.Login          gc ON ", N, "RB", function()
    return { from = addr("RB", 0), tags = { Action = "User.Login" } }
  end, true)

  -- A real write: each message unlocks an account, joins it to a faction and
  -- adopts a companion, which is the ~1 KB record the brief measures against.
  local function adoptSeq(prefix)
    return function(i)
      local who = addr(prefix, i)
      send(OWNER, { Action = "Admin.Unlock", Addresses = who })
      send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
      return { from = who, tags = { Action = "Monster.Adopt" } }
    end
  end
  local adoptOff = measure("Unlock+Join+Adopt   gc OFF", N, "WA", adoptSeq("WA"), false)
  local adoptOn = measure("Unlock+Join+Adopt   gc ON ", N, "WB", adoptSeq("WB"), true)

  line("")
  line(string.format("read  message: %.1f allocated, %.1f kept  -> %.1f%% garbage",
    loginOff, loginOn, loginOff > 0 and (100 * (loginOff - loginOn) / loginOff) or 0))
  line(string.format("write message: %.1f allocated, %.1f kept  -> %.1f%% garbage",
    adoptOff, adoptOn, adoptOff > 0 and (100 * (adoptOff - adoptOn) / adoptOff) or 0))
  line("")
  line("Slope is tables per message left in the Luerl store, which is what the")
  line("node term_to_binary's into the snapshot. gc OFF is the code as deployed")
  line("before this change (collectgarbage(\"step\") is a no-op on Luerl).")
  return table.concat(out, "\n")
end

function heapprobe(base, req)
  return run(base, req)
end
