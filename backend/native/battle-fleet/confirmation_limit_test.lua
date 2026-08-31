--- Bounded FinalAcked retention and retry/release regression.

function battle_fleet_confirmation_limit_test()
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
    local msg = {
      ["from-process"] = GAME,
      commitments = {
        scheduler = { type = "rsa-pss-sha512", committer = SCHEDULER },
      },
    }
    for key, value in pairs(fields) do msg[key] = value end
    return drive(msg)
  end
  local function owner(fields)
    fields.commitments = {
      owner = { type = "rsa-pss-sha512", committer = OWNER },
    }
    return drive(fields)
  end
  local function payload(n)
    return {
      protocol = "runerealm-battle-fleet/1",
      battleId = "confirmation-battle-" .. n,
      ticket = "confirmation-ticket-" .. n,
      reservationId = "confirmation-reservation-" .. n,
      assignmentId = "confirmation-assignment-" .. n,
      playerId = PLAYER, issuedAt = T, expiresAt = T + 20000,
      monster = {
        name = "Confirmation Tester", elementType = "fire",
        faction = "Inferno Blades", level = 0, attack = 10,
        defense = 5, speed = 10, health = 20,
        moves = { ["Body Slam"] = { count = 3 } },
      },
    }
  end
  local function open(value)
    return delivered({ Action = "Battle.Open", Data = encode(value) })
  end

  local one = payload("one")
  open(one)
  local two = payload("two")
  open(two)
  delivered({
    Action = "Battle.Cancel", BattleId = one.battleId,
    ReservationId = one.reservationId, Ticket = one.ticket,
    CancelId = "confirmation-cancel-one", Reason = "test",
  })
  delivered({
    Action = "Battle.Cancel", BattleId = two.battleId,
    ReservationId = two.reservationId, Ticket = two.ticket,
    CancelId = "confirmation-cancel-two", Reason = "test",
  })
  local ack, ackResults = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "confirmation-cancel-one",
  })
  local confirmation = ackResults.outbox.confirmation
  local confirmationData = json.decode(confirmation.data)
  local duplicateAck, duplicateAckResults = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "confirmation-cancel-one",
  })
  ok("worker emits stable full FinalAcked receipt for duplicate authority ack",
    ack.acknowledged == true and confirmationData.kind == "cancellation"
    and confirmationData.finalId == "confirmation-cancel-one"
    and confirmationData.ticket == one.ticket
    and duplicateAck.duplicate == true
    and duplicateAckResults.outbox.confirmation.reference == confirmation.reference)

  local status = drive({ Action = "Fleet.Status" })
  ok("unreleased confirmation reaches hard bound and stops allocation",
    status.retainedConfirmations == 1 and status.pendingConfirmations == 1
    and status.confirmationLimit == 1 and status.accepting == false
    and status.admissionBlockedReason == "confirmation-replay-backpressure")
  local blockedAck = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "confirmation-cancel-two",
  })
  ok("confirmation bound retains another final as unacknowledged backpressure",
    blockedAck.error == "Worker cannot retain another final acknowledgement confirmation"
    and BattleFleetState.battles[two.battleId].cancellation.acknowledged == false
    and json.decode(base.fleetstatus).pendingCancellations == 1
    and BattleFleetState.confirmationCount == 1)
  local three = payload("three")
  local blocked = open(three)
  ok("confirmation backpressure prevents another battle from opening",
    blocked.error ~= nil and BattleFleetState.battles[three.battleId] == nil)

  local retry, retryResults = owner({
    Action = "Fleet.FinalAcked.Retry", ConfirmationId = confirmation.reference,
  })
  ok("owner confirmation retry is stable while authority receipt is lost",
    retry.retried == true
    and retryResults.outbox.confirmation.reference == confirmation.reference)
  local ownerRelease = owner({
    Action = "Fleet.FinalAcked.Release", ConfirmationId = confirmation.reference,
  })
  ok("owner cannot release before authority receives FinalAcked",
    ownerRelease.error == "Only the configured game process may perform this action"
    and BattleFleetState.confirmations[
      "cancellation:confirmation-cancel-one"].released == false)
  local release = delivered({
    Action = "Fleet.FinalAcked.Release", ConfirmationId = confirmation.reference,
  })
  ok("only scheduler-attested game release succeeds",
    release.released == true and release.duplicate == false)
  T = T + 3700000
  status = drive({ Action = "Fleet.Status" })
  local secondAck, secondAckResults = delivered({
    Action = "Fleet.Cancellation.Ack", CancelId = "confirmation-cancel-two",
  })
  ok("released space lets the retained final complete its handshake",
    status.retainedConfirmations == 0 and secondAck.acknowledged == true
    and secondAckResults.outbox.confirmation ~= nil)
  delivered({
    Action = "Fleet.FinalAcked.Release",
    ConfirmationId = secondAckResults.outbox.confirmation.reference,
  })
  T = T + 3700000
  status = drive({ Action = "Fleet.Status" })
  ok("released confirmations prune after protection and restore admission",
    status.retainedConfirmations == 0 and status.pendingConfirmations == 0
    and status.accepting == true)

  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end
