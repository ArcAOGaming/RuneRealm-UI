--- Focused maxOutcomes regression: never evict live replay protection, stop
--- admission at the bound, and recover only after monotonic expiry pruning.

function battle_fleet_outcome_limit_test()
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
  local function payload(n)
    return {
      protocol = "runerealm-battle-fleet/1",
      battleId = "bounded-battle-" .. n,
      ticket = "bounded-ticket-" .. n,
      reservationId = "bounded-reservation-" .. n,
      assignmentId = "bounded-assignment-" .. n,
      playerId = PLAYER,
      issuedAt = T,
      expiresAt = T + 20000,
      monster = {
        name = "Bounded Tester", elementType = "fire", faction = "Inferno Blades",
        level = 0, attack = 10, defense = 5, speed = 10, health = 20,
        moves = { ["Body Slam"] = { count = 3 } },
      },
    }
  end
  local function open(value)
    return delivered({ Action = "Battle.Open", Data = encode(value) })
  end
  local function cancel(value, n)
    local cancelId = "bounded-cancel-" .. n
    delivered({
      Action = "Battle.Cancel", BattleId = value.battleId,
      ReservationId = value.reservationId, Ticket = value.ticket,
      CancelId = cancelId, Reason = "bounded-test",
    })
    delivered({ Action = "Fleet.Cancellation.Ack", CancelId = cancelId })
  end

  local one = payload("one")
  local openedOne = open(one)
  cancel(one, "one")
  local two = payload("two")
  local openedTwo = open(two)
  cancel(two, "two")
  local status = drive({ Action = "Fleet.Status" })
  ok("outcome ledger reaches its exact configured bound",
    openedOne.error == nil and openedTwo.error == nil
    and status.retainedOutcomes == 2 and status.outcomeLimit == 2)
  ok("outcome watermark disables allocation without evicting protection",
    status.accepting == false
    and status.admissionBlockedReason == "outcome-replay-backpressure"
    and BattleFleetState.outcomes[one.assignmentId] ~= nil
    and BattleFleetState.outcomes[two.assignmentId] ~= nil)

  local three = payload("three")
  local blocked, blockedResults = open(three)
  status = drive({ Action = "Fleet.Status" })
  ok("new assignments fail without growing state at outcome capacity",
    blocked.error == "Worker cannot retain another replay outcome"
    and blockedResults.outbox == nil and status.retainedOutcomes == 2
    and BattleFleetState.outcomes[three.assignmentId] == nil)

  T = math.max(one.expiresAt, two.expiresAt) + 1
  status = drive({ Action = "Fleet.Status" })
  ok("monotonic expiry pruning restores outcome admission",
    status.retainedOutcomes == 0 and status.accepting == true
    and BattleFleetState.outcomes[one.assignmentId] == nil
    and BattleFleetState.outcomes[two.assignmentId] == nil)
  local threeAfterExpiry = payload("three")
  local openedAfterExpiry = open(threeAfterExpiry)
  ok("worker admits new assignment after replay horizon releases space",
    openedAfterExpiry.error == nil and openedAfterExpiry.id == threeAfterExpiry.battleId)

  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end
