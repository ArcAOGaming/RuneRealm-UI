--- Focused game-side bridge tests for Hunt.Begin and Hunt.Settle.

function gamehunttest(base)
  local out, passed, failed = {}, 0, 0
  local function ok(label, condition, extra)
    if condition then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (condition and "PASS  " or "FAIL  ") .. label
      .. (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end
  local json = require(".json")
  local T = 1700000000000
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local ALICE = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local HUNT = "HUNThhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }

  local function send(from, fields, data)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(fields) do body[k] = v end
    if data then body.Data = json.encode(data) end
    base = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(base.results.output.data), base
  end

  local function grantHuntBerries(address, amount)
    for _, item in ipairs({ "fire_berry", "water_berry", "air_berry", "rock_berry" }) do
      send(OWNER, { Action = "Admin.Grant", PlayerId = address, Item = item, Amount = tostring(amount) })
    end
  end

  send(OWNER, { Action = "Admin.Unlock", Addresses = ALICE })
  local r = send(ALICE, { Action = "Faction.Join", Faction = "Inferno Blades" })
  send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "20" })
  r = send(OWNER, { Action = "Admin.SetHuntProcess", ProcessId = HUNT, Node = "https://hunt.test" })
  ok("owner configures the Hunt process", r and r.processId == HUNT, r and r.processId)

  r = send(ALICE, { Action = "Monster.Quest", MonsterId = "m1" })
  ok("a quest occupies the account activity slot",
    r and r.monster and r.monster.status.type == "Quest",
    r and (r.error or (r.monster and r.monster.status.type)))
  local blocked = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  ok("Hunt cannot overlap another realm activity",
    blocked and blocked.error ~= nil, blocked and blocked.error)
  Players[ALICE].monster.status = { type = "Home", since = T, until_time = T }

  send(OWNER, {
    Action = "Admin.AdjustInventory", PlayerId = ALICE, Item = "fire_berry", Delta = "-1",
  })
  local beforeRefusal = send(ALICE, { Action = "User.Login" })
  local shortEntry = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  ok("Hunt requires five of every berry", shortEntry and shortEntry.error ~= nil,
    shortEntry and shortEntry.error)
  local afterRefusal = send(ALICE, { Action = "User.Login" })
  ok("a short offering spends no berries",
    afterRefusal and beforeRefusal
      and afterRefusal.inventory.fire_berry == beforeRefusal.inventory.fire_berry
      and afterRefusal.inventory.water_berry == beforeRefusal.inventory.water_berry
      and afterRefusal.inventory.air_berry == beforeRefusal.inventory.air_berry
      and afterRefusal.inventory.rock_berry == beforeRefusal.inventory.rock_berry)
  send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "fire_berry", Amount = "1" })

  local beforeEntry = send(ALICE, { Action = "User.Login" })

  r = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  ok("begin locks the chosen companion", r and r.monster.status.type == "Hunt", r and r.monster.status.type)
  ok("begin publishes a Hunt route", r and r.hunt and r.hunt.processId == HUNT)
  ok("begin emits Hunt.Open", base.results.outbox and base.results.outbox.hunt ~= nil)
  ok("begin spends five of every berry",
    r and beforeEntry
      and (r.inventory.fire_berry or 0) == beforeEntry.inventory.fire_berry - 5
      and (r.inventory.water_berry or 0) == beforeEntry.inventory.water_berry - 5
      and (r.inventory.air_berry or 0) == beforeEntry.inventory.air_berry - 5
      and (r.inventory.rock_berry or 0) == beforeEntry.inventory.rock_berry - 5)
  local runId = r.hunt.runId

  r = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  ok("an opening delivery can be retried idempotently",
    r and r.hunt and r.hunt.runId == runId
      and base.results.outbox and base.results.outbox.hunt ~= nil)
  ok("retrying Hunt.Begin does not charge twice",
    r and itemCount(Players[ALICE], "fire_berry") == 0
      and itemCount(Players[ALICE], "water_berry") == 0
      and itemCount(Players[ALICE], "air_berry") == 0
      and itemCount(Players[ALICE], "rock_berry") == 0)

  r = send(nil, {
    Action = "Hunt.Opened", ["from-process"] = HUNT,
    ["player-id"] = ALICE, ["run-id"] = runId,
  })
  ok("opened notice advances the route", r and r.hunt and r.hunt.status == "roaming")

  local beforeRunes = r.inventory.rune
  local encounter = Battle.makeOpponent(2, { faction = "Aqua Guardians" })
  encounter.entryNo = 4
  encounter.faction = "Aqua Guardians"
  local payload = {
    protocol = "runerealm-hunt/1", settlementId = runId .. "-capture-1",
    runId = runId, playerId = ALICE, encounterId = runId .. "-e1",
    actionId = "capture_1", success = true, chance = 60, roll = 12,
    runeBid = 5, monster = encounter,
  }
  local overbid = {
    protocol = payload.protocol, settlementId = runId .. "-capture-overbid",
    runId = runId, playerId = ALICE, encounterId = payload.encounterId,
    actionId = "capture_overbid", success = true, chance = 80, roll = 12,
    runeBid = 6, monster = encounter,
  }
  local invalidBid = send(nil, {
    Action = "Hunt.Settle", ["from-process"] = HUNT,
    ["player-id"] = ALICE, ["run-id"] = runId,
    ["settlement-id"] = overbid.settlementId,
  }, overbid)
  ok("game rejects a capture bid above five Rune",
    invalidBid and invalidBid.error ~= nil, invalidBid and invalidBid.error)
  r = send(nil, {
    Action = "Hunt.Settle", ["from-process"] = HUNT,
    ["player-id"] = ALICE, ["run-id"] = runId,
    ["settlement-id"] = payload.settlementId,
  }, payload)
  ok("capture spends the Rune bid", r and r.inventory.rune == beforeRunes - 5,
    r and r.inventory.rune)
  local collectionCount = 0
  for _ in pairs(r.collection or {}) do collectionCount = collectionCount + 1 end
  ok("successful capture mints into collection", collectionCount == 1, collectionCount)
  local sawWater = false
  for _, entryNo in ipairs(r.seenEntries or {}) do
    if entryNo == 4 then sawWater = true end
  end
  ok("a Hunt encounter remains seen in the player Monster Index", sawWater,
    r.seenEntries and json.encode(r.seenEntries))
  ok("settlement acknowledges Hunt", base.results.outbox and base.results.outbox.acknowledgement ~= nil)

  r = send(nil, {
    Action = "Hunt.Released", ["from-process"] = HUNT,
    ["player-id"] = ALICE, ["run-id"] = runId,
  })
  ok("release returns the companion home", r and r.monster.status.type == "Home")
  ok("release clears the route", r and r.hunt == nil)

  grantHuntBerries(ALICE, 5)
  r = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  ok("a later hunt can begin", r and r.hunt ~= nil)
  r = send(OWNER, { Action = "Admin.Load" }, { players = { r } })
  ok("state migration clears process-specific Hunt routes", r and r.loaded == 1)
  r = send(ALICE, { Action = "User.Login" })
  ok("state migration thaws a hunted companion",
    r and r.hunt == nil and r.monster and r.monster.status.type == "Home")

  -- Hunt fleet -------------------------------------------------------------
  --
  -- Three workers, assigned round-robin at Hunt.Begin. The property that
  -- matters is not the spread, it is that a worker can only act on the runs it
  -- was given: every worker is a separate public process, so without the
  -- binding, worker 2 could claim worker 1's capture.
  -- Built rather than typed: a process id is 43 characters and a hand-counted
  -- literal that is 42 fails validation with a message about the id, not about
  -- the test.
  local HUNT2 = "HUNT2" .. string.rep("h", 38)
  local HUNT3 = "HUNT3" .. string.rep("h", 38)
  local BOB = "BOB" .. string.rep("b", 40)
  local CAROL = "CAROL" .. string.rep("c", 38)

  r = send(OWNER, { Action = "Admin.SetHuntProcess", ProcessId = HUNT, Node = "https://hunt.test" },
    { { processId = HUNT2, node = "https://hunt2.test" }, { processId = HUNT3 } })
  ok("owner configures a three-worker hunt fleet", r and r.size == 3,
    r and (r.size or r.error or "no size"))

  send(OWNER, { Action = "Admin.Unlock", Addresses = BOB })
  send(BOB, { Action = "Faction.Join", Faction = "Inferno Blades" })
  send(OWNER, { Action = "Admin.Unlock", Addresses = CAROL })
  send(CAROL, { Action = "Faction.Join", Faction = "Inferno Blades" })

  local assignments = {}
  grantHuntBerries(ALICE, 5)
  r = send(ALICE, { Action = "Hunt.Begin", MonsterId = "m1" })
  assignments[#assignments + 1] = r and r.hunt and r.hunt.processId
  local aliceRun = r and r.hunt and r.hunt.runId
  r = send(BOB, { Action = "Hunt.Begin", MonsterId = "m1" })
  assignments[#assignments + 1] = r and r.hunt and r.hunt.processId
  r = send(CAROL, { Action = "Hunt.Begin", MonsterId = "m1" })
  assignments[#assignments + 1] = r and r.hunt and r.hunt.processId

  local distinct = {}
  for _, id in ipairs(assignments) do distinct[id] = true end
  local count = 0
  for _ in pairs(distinct) do count = count + 1 end
  ok("three consecutive runs spread across all three workers", count == 3, count)

  -- Every message for a run must target the worker that run was assigned to,
  -- or a fleet is just three copies of worker one.
  ok("Hunt.Open targets the assigned worker",
    base.results.outbox and base.results.outbox.hunt
      and base.results.outbox.hunt.target == assignments[3],
    base.results.outbox and base.results.outbox.hunt and base.results.outbox.hunt.target)

  local notMine
  for _, id in ipairs({ HUNT, HUNT2, HUNT3 }) do
    if id ~= assignments[1] then notMine = id end
  end
  r = send(nil, {
    Action = "Hunt.Opened", ["from-process"] = notMine,
    ["player-id"] = ALICE, ["run-id"] = aliceRun,
  })
  ok("a fleet peer cannot advance a run it was not assigned",
    r and r.error ~= nil, r and (r.error or "accepted"))

  local stolen = {
    protocol = "runerealm-hunt/1", settlementId = aliceRun .. "-stolen",
    runId = aliceRun, playerId = ALICE, encounterId = aliceRun .. "-e1",
    actionId = "capture_stolen", success = true, chance = 99, roll = 1,
    runeBid = 0, monster = Battle.makeOpponent(2, { faction = "Aqua Guardians" }),
  }
  r = send(nil, {
    Action = "Hunt.Settle", ["from-process"] = notMine,
    ["player-id"] = ALICE, ["run-id"] = aliceRun,
  }, stolen)
  ok("a fleet peer cannot settle a capture it was not assigned",
    r and r.error ~= nil, r and (r.error or "accepted"))

  r = send(nil, {
    Action = "Hunt.Opened", ["from-process"] = assignments[1],
    ["player-id"] = ALICE, ["run-id"] = aliceRun,
  })
  ok("the assigned worker still advances its own run",
    r and r.hunt and r.hunt.status == "roaming", r and r.hunt and r.hunt.status)

  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)

  return table.concat(out, "\n")
end
