--- Focused retention=1 regression: pending finals are never pruned.

function battle_fleet_retention_test()
  local out, passed, failed = {}, 0, 0
  local function ok(label, condition, extra)
    if condition then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (condition and "PASS  " or "FAIL  ") .. label
      .. (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end

  local OWNER = "O" .. string.rep("w", 42)
  local SCHEDULER = "S" .. string.rep("c", 42)
  local GAME = "G" .. string.rep("a", 42)
  local PLAYER = "A" .. string.rep("l", 42)
  local T = 1700000000000
  local base = {
    ["scheduler-location"] = SCHEDULER,
    process = { commitments = {
      owner = { type = "rsa-pss-sha512", committer = OWNER },
    } },
  }

  local function drive(msg)
    T = T + 1000
    base = compute(base, { body = msg, timestamp = T }, {})
    return json.decode(base.results.output.data), base.results
  end
  local function delivered(fields)
    local msg = { ["from-process"] = GAME, commitments = {
      scheduler = { type = "rsa-pss-sha512", committer = SCHEDULER },
    } }
    for k, v in pairs(fields) do msg[k] = v end
    return drive(msg)
  end
  local function owner(fields)
    fields.commitments = {
      signature = { type = "rsa-pss-sha512", committer = OWNER },
    }
    return drive(fields)
  end
  local function attack(fields)
    fields.Action = "Battle.Attack"
    fields.commitments = {
      signature = { type = "rsa-pss-sha512", committer = PLAYER },
    }
    return drive(fields)
  end
  local function payload(n)
    return {
      protocol = "runerealm-battle-fleet/1",
      battleId = "retention-battle-" .. n,
      ticket = "retention-ticket-" .. n,
      reservationId = "retention-reservation-" .. n,
      assignmentId = "retention-assignment-" .. n,
      playerId = PLAYER,
      issuedAt = T,
      expiresAt = T + 600000,
      monster = {
        name = "Retention Tester", elementType = "fire", faction = "Inferno Blades",
        level = 0, attack = 100, defense = 5, speed = 100, health = 20,
        moves = { ["Body Slam"] = { count = 3 }, ["Firenado"] = { count = 2 } },
      },
      rewardPlan = { lootbox = 1 },
    }
  end
  local function open(p)
    return delivered({ Action = "Battle.Open", Data = encode(p) })
  end
  local function finish(p)
    local result, results
    while BattleFleetState.battles[p.battleId].battle.status ~= "ended" do
      local record = BattleFleetState.battles[p.battleId]
      local names = {}
      for name, move in pairs(record.battle.challenger.moves) do
        if (math.tointeger(move.count) or 0) > 0 then names[#names + 1] = name end
      end
      table.sort(names)
      local round = record.battle.round
      result, results = attack({
        BattleId = p.battleId, Ticket = p.ticket,
        ActionId = p.battleId .. "-" .. tostring(round),
        Round = tostring(round), Move = names[1] or "Struggle",
      })
      if result.error then error(result.error) end
    end
    return result, results
  end

  local one = payload("one")
  open(one)
  local _, firstFinal = finish(one)
  local settlementOne = firstFinal.outbox.settlement.reference
  local status = drive({ Action = "Fleet.Status" })
  ok("retention=1 keeps unacknowledged settlement", status.pendingSettlements == 1
    and BattleFleetState.battles[one.battleId] ~= nil)
  ok("pending limit backpressures admission", status.accepting == false
    and status.admissionBlockedReason == "pending-delivery-backpressure")

  local mixed = payload("mixed-pending")
  local mixedRejected, mixedResults = open(mixed)
  status = drive({ Action = "Fleet.Status" })
  ok("settlement plus rejection admission uses one total pending bound",
    mixedRejected.error == "Worker cannot retain another unacknowledged rejection"
    and mixedResults.outbox == nil and status.pendingDeliveries == 1
    and status.pendingOpenRejections == 0)

  local ackOne = delivered({ Action = "Fleet.Settlement.Ack", SettlementId = settlementOne })
  status = drive({ Action = "Fleet.Status" })
  ok("ack releases admission backpressure", ackOne.acknowledged == true
    and status.pendingFinals == 0 and status.accepting == true)

  local two = payload("two")
  open(two)
  local _, secondFinal = finish(two)
  local settlementTwo = secondFinal.outbox.settlement.reference
  ok("new pending final displaces only acknowledged record",
    BattleFleetState.battles[one.battleId] == nil
    and BattleFleetState.battles[two.battleId] ~= nil)
  local replayOne, replayOneResults = open(one)
  local compactOne = BattleFleetState.outcomes[one.assignmentId]
  ok("compact opened outcome blocks replay after full record retention churn",
    replayOne.duplicate == true and replayOne.error ~= nil
    and BattleFleetState.battles[one.battleId] == nil
    and replayOneResults.outbox.opened.reference
      == "test-worker-opened-" .. one.assignmentId)
  ok("opened outcome excludes bulky fingerprints and battle payloads",
    compactOne.compact == true and compactOne.fingerprint == nil
    and compactOne.payload == nil and compactOne.monster == nil)
  local duplicateOldAck = delivered({ Action = "Fleet.Settlement.Ack", SettlementId = settlementOne })
  ok("pruned final retains bounded ack tombstone", duplicateOldAck.duplicate == true)
  local retryTwo, retryTwoResults = owner({
    Action = "Fleet.Settlement.Retry", SettlementId = settlementTwo,
  })
  ok("pending final remains owner-retryable", retryTwo.retried == true
    and retryTwoResults.outbox.settlement.reference == settlementTwo)
  delivered({ Action = "Fleet.Settlement.Ack", SettlementId = settlementTwo })

  local three = payload("three")
  open(three)
  local cancelled, cancelledResults = delivered({
    Action = "Battle.Cancel", BattleId = three.battleId,
    ReservationId = three.reservationId, Ticket = three.ticket,
    CancelId = "retention-cancel-three", Reason = "abandoned",
  })
  status = drive({ Action = "Fleet.Status" })
  ok("retention=1 keeps unacknowledged cancellation", cancelled.cancelled == true
    and cancelledResults.outbox.cancellation ~= nil
    and status.pendingCancellations == 1
    and BattleFleetState.battles[three.battleId] ~= nil)
  local cancelRetry, cancelRetryResults = owner({
    Action = "Fleet.Cancellation.Retry", CancelId = "retention-cancel-three",
  })
  ok("pending cancellation remains owner-retryable", cancelRetry.retried == true
    and cancelRetryResults.outbox.cancellation.reference == "retention-cancel-three")
  local cancelAck = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "retention-cancel-three",
  })
  local cancelAckAgain = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "retention-cancel-three",
  })
  ok("cancellation ack remains idempotent at retention=1",
    cancelAck.duplicate == false and cancelAckAgain.duplicate == true)

  local collisionOne = payload("ticket-collision-one")
  collisionOne.ticket = one.ticket
  collisionOne.expiresAt = one.expiresAt + 10000
  local collisionOneResult, collisionOneResults = open(collisionOne)
  delivered({
    Action = "Fleet.OpenRejected.Ack",
    RejectionId = collisionOneResults.outbox.rejection.reference,
  })
  T = one.expiresAt + 1000
  status = drive({ Action = "Fleet.Status" })
  local collisionTwo = payload("ticket-collision-two")
  collisionTwo.ticket = one.ticket
  local collisionTwoResult, collisionTwoResults = open(collisionTwo)
  ok("colliding outcome index survives the oldest ticket outcome expiry",
    collisionOneResult.error ~= nil and collisionTwoResult.error ~= nil
    and BattleFleetState.outcomes[one.assignmentId] == nil
    and BattleFleetState.outcomeTickets[one.ticket] ~= nil
    and BattleFleetState.battles[collisionTwo.battleId] == nil)
  delivered({
    Action = "Fleet.OpenRejected.Ack",
    RejectionId = collisionTwoResults.outbox.rejection.reference,
  })

  owner({ Action = "Fleet.Drain", Drain = "true" })
  local rejectedOne = payload("rejected-one")
  local rejectedOneResult, rejectedOneResults = open(rejectedOne)
  local rejectedOneId = rejectedOneResults.outbox.rejection.reference
  delivered({ Action = "Fleet.OpenRejected.Ack", RejectionId = rejectedOneId })
  local rejectedTwo = payload("rejected-two")
  local _, rejectedTwoResults = open(rejectedTwo)
  delivered({
    Action = "Fleet.OpenRejected.Ack",
    RejectionId = rejectedTwoResults.outbox.rejection.reference,
  })
  ok("full rejected-open view is pruned under retention churn",
    rejectedOneResult.error == "Worker is draining"
    and BattleFleetState.openRejections[rejectedOneId] == nil)
  owner({ Action = "Fleet.Drain", Drain = "false" })
  local rejectedReplay, rejectedReplayResults = open(rejectedOne)
  ok("compact rejected outcome prevents later acceptance through expiry",
    rejectedReplay.duplicate == true and rejectedReplay.error == "Worker is draining"
    and rejectedReplayResults.outbox.rejection.reference == rejectedOneId
    and BattleFleetState.battles[rejectedOne.battleId] == nil)
  status = drive({ Action = "Fleet.Status" })
  ok("outcome ledger exposes retained compact replay protection",
    status.retainedOutcomes >= 4 and status.maxTicketTtl == 3600000)

  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end
