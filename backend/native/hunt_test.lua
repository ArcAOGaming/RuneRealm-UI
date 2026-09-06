--- Focused state-machine tests for hunt.lua.

function hunttest(base)
  local out, passed, failed = {}, 0, 0
  local function ok(label, condition, extra)
    if condition then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (condition and "PASS  " or "FAIL  ") .. label
      .. (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end
  local json = require(".json")
  local T = 1700000000000
  local GAME = "GAMEggggggggggggggggggggggggggggggggggggggg"
  local ALICE = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  local function send(fields, data)
    T = T + 4000
    local body = {}
    for k, v in pairs(fields) do body[k] = v end
    if data then body.Data = json.encode(data) end
    base = compute(base, { body = body, timestamp = T }, {})
    return json.decode(base.results.output.data), base
  end

  local starter = Battle.makeOpponent(5, { faction = "Inferno Blades" })
  starter.id = "m1"
  starter.attack, starter.defense, starter.speed, starter.health = 100, 30, 30, 100
  local catchable = {}
  for _, entry in ipairs(C.MONSTER_INDEX or {}) do
    if entry.state == "live" and entry.huntCatchable and entry.huntWeight > 0 then
      catchable[#catchable + 1] = {
        entryNo = entry.entryNo, entryKey = entry.entryKey,
        name = entry.name, affinity = entry.affinity,
        starterFaction = entry.starterFaction,
        basicMove = entry.basicMove, advancedMove = entry.advancedMove,
        huntWeight = entry.huntWeight,
      }
    end
  end
  local open = {
    protocol = "runerealm-hunt/1", runId = "h1", ticket = "ticket_h1",
    playerId = ALICE, monsterId = "m1", monster = starter, monsterIndex = catchable,
  }

  local r = send({ Action = "Hunt.Open", ["from-process"] = "EVILxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }, open)
  ok("untrusted process cannot open a hunt", r and r.error ~= nil, r and r.error)

  r = send({ Action = "Hunt.Open", ["from-process"] = GAME }, open)
  ok("game opens a roaming hunt", r and r.status == "roaming", r and r.status)
  ok("opening acknowledges the game", base.results.outbox and base.results.outbox.opened ~= nil)

  r = send({
    Action = "Hunt.Search", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
    ActionId = "search_1",
  })
  ok("search creates a wild battle", r and r.status == "battle" and r.battle ~= nil, r and r.status)
  ok("wild level is within plus or minus five",
    r and r.encounter and r.encounter.level >= 0 and r.encounter.level <= 10,
    r and r.encounter and r.encounter.level)
  ok("one of four released creatures appeared",
    r and r.encounter and C.FACTION_BY_NAME[r.encounter.faction] ~= nil,
    r and r.encounter and r.encounter.faction)
  ok("encounter carries a stable Monster Index number",
    r and r.encounter and C.MONSTER_INDEX_BY_NO[r.encounter.entryNo] ~= nil,
    r and r.encounter and r.encounter.entryNo)
  ok("encounter carries card progression metadata",
    r and r.encounter and r.encounter.nextLevelExp == C.requiredExp(r.encounter.level),
    r and r.encounter and r.encounter.nextLevelExp)
  local hydratedMove
  for _, move in pairs((r and r.encounter and r.encounter.moves) or {}) do
    hydratedMove = move
    break
  end
  ok("encounter carries full move definitions for its card",
    hydratedMove and hydratedMove.type ~= nil and hydratedMove.count ~= nil,
    hydratedMove and hydratedMove.type)

  local earlyCapture = send({
    Action = "Hunt.Capture", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
    ActionId = "capture_too_early", Runes = "5",
  })
  ok("capture is unavailable until the wild creature is defeated",
    earlyCapture and earlyCapture.error ~= nil, earlyCapture and earlyCapture.error)

  local guard = 0
  while r and r.battle and r.battle.status ~= "ended" and guard < 60 do
    guard = guard + 1
    local moveName
    for name, move in pairs(r.battle.challenger.moves or {}) do
      if (move.count or 0) > 0 then moveName = name break end
    end
    moveName = moveName or "struggle"
    r = send({
      Action = "Hunt.Attack", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
      ActionId = "attack_" .. tostring(guard), Round = tostring(r.battle.round), Move = moveName,
    })
  end
  ok("wild battle terminates", r and r.battle and r.battle.status == "ended", guard)
  ok("victory exposes one capture attempt", r and r.status == "defeated" and r.captureAvailable == true,
    r and r.status)

  local overbid = send({
    Action = "Hunt.Capture", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
    ActionId = "capture_overbid",
    Runes = string.format("%d", (C.HUNT.capture.maxRuneBid or 3) + 1),
  })
  ok("capture bid is capped at the configured maximum", overbid and overbid.error ~= nil,
    overbid and overbid.error)

  -- Pin the levels together so the published five-Rune example is exact and
  -- cannot drift from the contract curve while still looking plausible.
  HuntState.runs.h1.encounter.level = HuntState.runs.h1.monster.level

  r = send({
    Action = "Hunt.Capture", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
    ActionId = "capture_1",
    Runes = string.format("%d", C.HUNT.capture.maxRuneBid or 3),
  })
  ok("capture enters settlement", r and r.status == "settling" and r.settlementStatus == "pending",
    r and r.status)
  ok("capture emits one authoritative settlement",
    base.results.outbox and base.results.outbox.settlement ~= nil)
  local settlementPayload = base.results.outbox and base.results.outbox.settlement
    and json.decode(base.results.outbox.settlement.data)
  -- The top bid is LIKELY, never certain, and the exact number is published
  -- so the slider on screen is the curve the worker rolls. Recomputed from the
  -- constants rather than typed: `baseChance`, `runeScale` and `runeHalf` move
  -- together, and a literal here is how a walkthrough starts lying.
  local capture = C.HUNT.capture
  local topBid = capture.maxRuneBid or 3
  local expected = math.max(capture.minChance or 5, math.min(capture.maxChance or 95,
    (capture.baseChance or 8)
      + math.floor(((capture.runeScale or 220) * topBid) / (topBid + (capture.runeHalf or 7)))))
  ok("the top bid is a likely capture at equal level, and never a certain one",
    settlementPayload and settlementPayload.chance == expected
      and expected >= 70 and expected < (capture.maxChance or 95),
    settlementPayload and (tostring(settlementPayload.chance) .. " vs " .. tostring(expected)))
  local settlementId = base.results.outbox and base.results.outbox.settlement
    and base.results.outbox.settlement["settlement-id"]

  local secondTry = send({
    Action = "Hunt.Capture", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
    ActionId = "capture_2", Runes = "3",
  })
  ok("a second capture action is rejected", secondTry and secondTry.error ~= nil,
    secondTry and secondTry.error)

  local retry = send({
    Action = "Hunt.RetrySettlement", Address = ALICE,
    RunId = "h1", Ticket = "ticket_h1",
  })
  local retriedId = base.results.outbox and base.results.outbox.settlement
    and base.results.outbox.settlement["settlement-id"]
  ok("settlement delivery can be retried without rerolling",
    retry and retry.status == "settling" and retriedId == settlementId,
    retriedId)

  -- THE SPELLING IS THE TEST. game.lua builds this acknowledgement with
  -- `run-id` and `settlement-id`, and tag names are lowercased HTTP headers by
  -- the time a handler reads them. This test used to send `RunId` /
  -- `SettlementId`, which the old case-only lookup matched -- so the suite
  -- passed while every capture on the live process stuck in `settling`
  -- forever, its Rune already spent and its companion already granted.
  r = send({
    Action = "Hunt.Settled", ["from-process"] = GAME,
    ["run-id"] = "h1", ["settlement-id"] = settlementId,
  })
  ok("game acknowledgement returns the run to roaming", r and r.status == "roaming", r and r.status)
  ok("settled roll remains visible", r and r.lastCapture and r.lastCapture.chance ~= nil)

  r = send({
    Action = "Hunt.End", Address = ALICE, RunId = "h1", Ticket = "ticket_h1",
  })
  ok("player can end the hunt", r and r.status == "ended", r and r.status)
  ok("ending releases the game lock", base.results.outbox and base.results.outbox.released ~= nil)
  local releasePayload = base.results.outbox and base.results.outbox.released
    and json.decode(base.results.outbox.released.data or "{}")
  ok("one terminal Hunt boundary carries every discovered entry",
    releasePayload and releasePayload.seenEntries and #releasePayload.seenEntries >= 1,
    releasePayload and releasePayload.seenEntries and #releasePayload.seenEntries)

  -- A loss is terminal too, but retains the distinct status so the client can
  -- show its defeat screen. It must not keep the wallet locked out forever.
  HuntState.runs.h1.status = "lost"
  local nextOpen = {
    protocol = "runerealm-hunt/1", runId = "h2", ticket = "ticket_h2",
    playerId = ALICE, monsterId = "m1", monster = starter, monsterIndex = catchable,
  }
  r = send({ Action = "Hunt.Open", ["from-process"] = GAME }, nextOpen)
  ok("a player can start a later hunt after a loss", r and r.status == "roaming",
    r and r.status)

  -- The same acknowledgement carrying its id ONLY as `reference` — the second
  -- spelling game.lua now sends, and the one the battle fleet has always used.
  r = send({
    Action = "Hunt.Search", Address = ALICE, RunId = "h2", Ticket = "ticket_h2",
    ActionId = "search_ref",
  })
  local guard2 = 0
  while r and r.battle and r.battle.status ~= "ended" and guard2 < 60 do
    guard2 = guard2 + 1
    local moveName
    for name, move in pairs(r.battle.challenger.moves or {}) do
      if (move.count or 0) > 0 then moveName = name break end
    end
    r = send({
      Action = "Hunt.Attack", Address = ALICE, RunId = "h2", Ticket = "ticket_h2",
      ActionId = "attack_ref_" .. tostring(guard2),
      Round = tostring(r.battle.round), Move = moveName or "struggle",
    })
  end
  if r and r.status == "defeated" then
    send({
      Action = "Hunt.Capture", Address = ALICE, RunId = "h2", Ticket = "ticket_h2",
      ActionId = "capture_ref", Runes = "3",
    })
    local refId = base.results.outbox and base.results.outbox.settlement
      and base.results.outbox.settlement["settlement-id"]
    r = send({
      Action = "Hunt.Settled", ["from-process"] = GAME, reference = refId,
    })
    ok("a reference-only acknowledgement still settles the run",
      r and r.status == "roaming", r and (r.error or r.status))
  else
    ok("a reference-only acknowledgement still settles the run", false,
      "the second run did not reach a capture")
  end

  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end
