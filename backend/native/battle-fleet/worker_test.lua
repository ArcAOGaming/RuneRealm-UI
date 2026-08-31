--- Standalone protocol/security suite for battle-fleet/worker.lua.

function battle_fleet_test()
  local out, passed, failed = {}, 0, 0
  local function ok(label, condition, extra)
    if condition then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (condition and "PASS  " or "FAIL  ") .. label
      .. (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end

  local OWNER = "O" .. string.rep("w", 42)
  local SCHEDULER = "S" .. string.rep("c", 42)
  local OTHER_SCHEDULER = "X" .. string.rep("s", 42)
  local GAME = "G" .. string.rep("a", 42)
  local OTHER_PROCESS = "P" .. string.rep("x", 42)
  local WORKER_PROCESS = "W" .. string.rep("p", 42)
  local PLAYER = "A" .. string.rep("l", 42)
  local ATTACKER = "M" .. string.rep("l", 42)
  local T = 1700000000000

  local base = {
    ["scheduler-location"] = SCHEDULER,
    process = {
      commitments = {
        owner = { type = "rsa-pss-sha512", committer = OWNER },
      },
    },
  }

  local function drive(msg)
    T = T + 1000
    base = compute(base, { body = msg, timestamp = T }, {})
    local raw = base.results.output.data
    return json.decode(raw), base.results, raw
  end

  local function signed(address, fields, algKey)
    local msg = {}
    for k, v in pairs(fields or {}) do msg[k] = v end
    msg.commitments = {
      signature = {
        [algKey or "alg"] = "rsa-pss-sha512",
        committer = address,
      },
      noise = { alg = "hmac-sha256", committer = OWNER },
    }
    return drive(msg)
  end

  local function hmac(address, fields)
    local msg = {}
    for k, v in pairs(fields or {}) do msg[k] = v end
    msg.commitments = { fake = { alg = "hmac-sha256", committer = address } }
    return drive(msg)
  end

  local function delivered(fromProcess, fields, scheduler)
    local msg = { ["from-process"] = fromProcess }
    for k, v in pairs(fields or {}) do msg[k] = v end
    msg.commitments = {
      scheduler = {
        type = "rsa-pss-sha512",
        committer = scheduler or SCHEDULER,
      },
      noise = { type = "hmac-sha256", committer = GAME },
    }
    return drive(msg)
  end

  local function monster()
    return {
      name = "Fleet Tester",
      elementType = "fire",
      faction = "Inferno Blades",
      level = 0,
      attack = 100,
      defense = 2,
      speed = 100,
      health = 12,
      moves = {
        ["Body Slam"] = { count = 3 },
        ["Firenado"] = { count = 2 },
      },
    }
  end

  local function clone(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, child in pairs(value) do result[key] = clone(child) end
    return result
  end

  local function opening(n)
    return {
      protocol = "runerealm-battle-fleet/1",
      battleId = "battle-" .. n,
      ticket = "ticket-" .. n,
      reservationId = "reservation-" .. n,
      assignmentId = "assignment-" .. n,
      playerId = PLAYER,
      issuedAt = T,
      expiresAt = T + 600000,
      difficulty = 1,
      monster = monster(),
      rewardPlan = { lootbox = 1, winExperience = 1 },
    }
  end

  local function open(payload)
    return delivered(GAME, {
      Action = "Battle.Open",
      Data = encode(payload),
    })
  end

  Battle.seedDeterministic(seedFor("ticket/assignment/open"))
  local stream = {}
  for index = 1, 5 do stream[index] = Battle.rand(0, 0xffffffff) end
  ok("fleet PRNG vector is shared with Rust", table.concat(stream, ",") ==
    "2552783038,331529857,3326422408,494375474,151326954")

  local function chooseMove(battleId)
    local record = BattleFleetState.battles[battleId]
    local names = {}
    for name, move in pairs(record.battle.challenger.moves or {}) do
      if (math.tointeger(move.count) or 0) > 0 then names[#names + 1] = name end
    end
    table.sort(names)
    return names[1] or "Struggle"
  end

  local function attack(battleId, actionId, round, move, address, algKey)
    return signed(address or PLAYER, {
      Action = "Battle.Attack",
      BattleId = battleId,
      Ticket = BattleFleetState.battles[battleId]
        and BattleFleetState.battles[battleId].ticket or "missing-ticket",
      ActionId = actionId,
      Round = tostring(round),
      Move = move,
    }, algKey)
  end

  local function finish(battleId, trace)
    local last, lastResults
    if not BattleFleetState.battles[battleId] then error("missing battle before finish: " .. battleId) end
    while BattleFleetState.battles[battleId].battle.status ~= "ended" do
      local round = BattleFleetState.battles[battleId].battle.round
      local move = chooseMove(battleId)
      last, lastResults, raw = attack(
        battleId, battleId .. "-round-" .. tostring(round), round, move)
      if type(last) ~= "table" then
        error("nil/non-table attack reply for " .. tostring(battleId)
          .. " round " .. tostring(round) .. ": " .. tostring(raw))
      end
      ok(battleId .. " round " .. tostring(round) .. " succeeds", last.error == nil, last.error)
      if trace then trace[#trace + 1] = raw end
      if round > Battle.TUNING.roundCap then error("battle exceeded round cap") end
    end
    return last, lastResults
  end

  -- Status and feature shape ------------------------------------------------

  local response = drive({ Action = "Fleet.Status" })
  ok("enabled worker reports accepting", response.enabled == true and response.accepting == true)
  ok("status publishes immutable game binding and ready lifecycle",
    response.gameProcess == GAME and response.configured == true
    and response.lifecycle == "ready")
  ok("manager is assignment-only", response.managerMode == "assign-only"
    and response.managerProxiesRounds == false)

  -- Unauthorized opens -----------------------------------------------------

  local p1 = opening("1")
  response = signed(PLAYER, {
    Action = "Battle.Open", ["from-process"] = GAME, Data = encode(p1),
  })
  ok("wallet cannot forge a process open", response.error ~= nil, response.error)

  response = hmac(SCHEDULER, {
    Action = "Battle.Open", ["from-process"] = GAME, Data = encode(p1),
  })
  ok("hmac cannot attest a process open", response.error ~= nil, response.error)

  response = delivered(GAME, { Action = "Battle.Open", Data = encode(p1) }, OTHER_SCHEDULER)
  ok("foreign scheduler cannot attest a process open", response.error ~= nil, response.error)

  response = delivered(OTHER_PROCESS, { Action = "Battle.Open", Data = encode(p1) })
  ok("configured scheduler cannot vouch for a different game", response.error ~= nil, response.error)

  response = drive({
    ["from-process"] = GAME, Action = "Battle.Open", Data = encode(p1),
    commitments = {
      scheduler = { type = "rsa-pss-sha512", committer = SCHEDULER },
      attacker = { type = "rsa-pss-sha512", committer = ATTACKER },
    },
  })
  ok("multiple distinct RSA committers fail closed for process delivery",
    response.error ~= nil, response.error)

  local trace = {}
  local opened, openedResults, openRaw = drive({
    ["from-process"] = GAME,
    Tags = { Action = "Battle.Open" },
    Data = encode(p1),
    commitments = {
      scheduler = { type = "rsa-pss-sha512", committer = SCHEDULER },
    },
  })
  trace[#trace + 1] = openRaw
  ok("live-shaped from-process/Action/Data/commitment opens a reserved battle",
    opened.id == "battle-1" and opened.status == "battling", opened.error)
  local openedNotice = openedResults.outbox and openedResults.outbox.opened
  ok("accepted open emits stable authority notice", openedNotice
    and openedNotice.target == GAME and openedNotice.action == "Battle.Fleet.Opened")
  ok("battle is published by id", type(base["battle-battle-1"]) == "string")

  local duplicateOpen, duplicateOpenResults = open(p1)
  response = duplicateOpen
  ok("identical open is idempotent", response.duplicate == true
    and BattleFleetState.battles["battle-1"].battle.round == 0
    and duplicateOpenResults.outbox.opened.reference == openedNotice.reference)

  local lostOpenedAuthority = Authority.newState()
  local lostReservation = Authority.reserve(lostOpenedAuthority, {
    sequence = 1,
    reservationId = p1.reservationId, ticket = p1.ticket,
    battleId = p1.battleId, assignmentId = p1.assignmentId,
    workerId = "test-worker", workerProcessId = WORKER_PROCESS,
    playerId = p1.playerId, monster = p1.monster,
    rewardPlan = p1.rewardPlan, reservedCost = { rune = 1 },
    issuedAt = p1.issuedAt, expiresAt = p1.expiresAt,
  })
  local recoveredOpened = json.decode(duplicateOpenResults.outbox.opened.data)
  local recoveredReservation, recoveredDuplicate = Authority.markOpened(
    lostOpenedAuthority, recoveredOpened, WORKER_PROCESS, T)
  ok("lost Opened notice is recovered by exact Open replay",
    lostReservation ~= nil and recoveredReservation.status == "open"
    and recoveredDuplicate == false)

  local openedOutcome = BattleFleetState.outcomes[p1.assignmentId]
  local invalidTimestamp = clone(p1)
  invalidTimestamp.expiresAt = "invalid"
  local invalidTimestampResult, invalidTimestampResults = open(invalidTimestamp)
  ok("invalid-timestamp duplicate cannot overwrite opened outcome",
    invalidTimestampResult.error ~= nil and invalidTimestampResults.outbox == nil
    and BattleFleetState.outcomes[p1.assignmentId] == openedOutcome
    and BattleFleetState.outcomes[p1.assignmentId].kind == "opened"
    and BattleFleetState.rejectionByAssignment[p1.assignmentId] == nil)
  local invalidMonster = clone(p1)
  invalidMonster.monster.health = 0
  local invalidMonsterResult, invalidMonsterResults = open(invalidMonster)
  ok("invalid-monster duplicate cannot overwrite opened outcome",
    invalidMonsterResult.error ~= nil and invalidMonsterResults.outbox == nil
    and BattleFleetState.outcomes[p1.assignmentId] == openedOutcome)
  local invalidDifficulty = clone(p1)
  invalidDifficulty.difficulty = 99
  local invalidDifficultyResult, invalidDifficultyResults = open(invalidDifficulty)
  ok("invalid-difficulty duplicate cannot overwrite opened outcome",
    invalidDifficultyResult.error ~= nil and invalidDifficultyResults.outbox == nil
    and BattleFleetState.outcomes[p1.assignmentId] == openedOutcome)
  local conflictingOpen = clone(p1)
  conflictingOpen.monster.attack = conflictingOpen.monster.attack + 1
  local conflictingOpenResult, conflictingOpenResults = open(conflictingOpen)
  ok("valid but conflicting duplicate fails without rejection mutation",
    conflictingOpenResult.error ~= nil and conflictingOpenResults.outbox == nil
    and BattleFleetState.outcomes[p1.assignmentId] == openedOutcome
    and BattleFleetState.openRejections[
      "test-worker-rejected-" .. p1.assignmentId] == nil)
  local recoveredAgain, recoveredAgainResults = open(p1)
  ok("exact Open remains recoverable after malformed duplicate attempts",
    recoveredAgain.duplicate == true
    and recoveredAgainResults.outbox.opened.reference == openedNotice.reference)

  local conflict = opening("1")
  conflict.playerId = ATTACKER
  response = open(conflict)
  ok("conflicting duplicate open is rejected", response.error ~= nil, response.error)

  local reusedTicket = opening("ticket-reuse")
  reusedTicket.ticket = p1.ticket
  local reusedResponse, reusedResults = open(reusedTicket)
  response = reusedResponse
  ok("ticket replay under a new battle is rejected", response.error ~= nil, response.error)
  local reusedRejection = reusedResults.outbox and reusedResults.outbox.rejection
  if reusedRejection then
    local reusedData = json.decode(reusedRejection.data)
    delivered(GAME, {
      Action = "Fleet.OpenRejected.Ack",
      RejectionId = reusedData.rejectionId,
    })
  end

  -- Unauthorized and duplicate attacks ------------------------------------

  local initialRound = BattleFleetState.battles["battle-1"].battle.round
  response = attack("battle-1", "bad-wallet", initialRound, chooseMove("battle-1"), ATTACKER)
  ok("non-participant attack is rejected", response.error ~= nil)
  response = hmac(PLAYER, {
    Action = "Battle.Attack", BattleId = "battle-1", Ticket = p1.ticket,
    ActionId = "hmac-attack", Round = tostring(initialRound), Move = chooseMove("battle-1"),
  })
  ok("hmac participant claim is rejected", response.error ~= nil)
  response = drive({
    Action = "Battle.Attack", BattleId = "battle-1", Ticket = p1.ticket,
    ActionId = "ambiguous-attack", Round = tostring(initialRound),
    Move = chooseMove("battle-1"),
    commitments = {
      player = { type = "rsa-pss-sha512", committer = PLAYER },
      attacker = { type = "rsa-pss-sha512", committer = ATTACKER },
    },
  })
  ok("multiple distinct RSA committers cannot authorize an attack", response.error ~= nil)
  ok("unauthorized attacks do not advance", BattleFleetState.battles["battle-1"].battle.round == initialRound)

  local firstMove = chooseMove("battle-1")
  local first, firstResults, firstRaw = attack("battle-1", "attack-once", initialRound, firstMove, PLAYER, "type")
  trace[#trace + 1] = firstRaw
  ok("wire-style type signature attacks directly", first.error == nil, first.error)
  local afterFirst = BattleFleetState.battles["battle-1"].battle.round
  local duplicate, duplicateResults = attack("battle-1", "attack-once", initialRound, firstMove)
  ok("duplicate attack returns cached success", duplicate.error == nil and duplicate.id == "battle-1")
  ok("duplicate attack does not advance a round", BattleFleetState.battles["battle-1"].battle.round == afterFirst)
  ok("attack replay stores only compact receipt",
    BattleFleetState.battles["battle-1"].attacks["attack-once"].output == nil
    and BattleFleetState.battles["battle-1"].attacks["attack-once"].resultingRound == afterFirst)
  ok("duplicate final/round attack never re-emits settlement",
    duplicateResults.outbox == nil or duplicateResults.outbox.settlement == nil)

  response = attack("battle-1", "attack-once", initialRound,
    firstMove == "Body Slam" and "Firenado" or "Body Slam")
  ok("actionId cannot be reused with another move", response.error ~= nil, response.error)

  -- Drain keeps active fights alive and refuses new assignments ------------

  local drainPayload = opening("drain")
  drainPayload.monster.attack = 0
  drainPayload.monster.defense = 100
  drainPayload.monster.health = 100
  local drainOpened = open(drainPayload)
  ok("long-running battle opens before drain", drainOpened.error == nil, drainOpened.error)
  response = hmac(OWNER, { Action = "Fleet.Drain", Drain = "true" })
  ok("hmac cannot drain worker", response.error ~= nil)
  response = drive({
    Action = "Fleet.Drain", Drain = "true",
    commitments = {
      owner = { type = "rsa-pss-sha512", committer = OWNER },
      attacker = { type = "rsa-pss-sha512", committer = ATTACKER },
    },
  })
  ok("multiple distinct RSA committers cannot authorize owner actions", response.error ~= nil)
  response = signed(OWNER, { Action = "Fleet.Drain", Drain = "true" })
  ok("owner drains worker", response.draining == true and response.accepting == false)
  local rejectedOpen = opening("drain-rejected")
  local rejectedResponse, rejectedResults = open(rejectedOpen)
  response = rejectedResponse
  ok("draining worker rejects a new battle", response.error == "Worker is draining", response.error)
  local rejectionNotice = rejectedResults.outbox and rejectedResults.outbox.rejection
  ok("rejected open emits a stable authenticated notice",
    rejectionNotice and rejectionNotice.target == GAME
    and rejectionNotice.action == "Battle.Fleet.OpenRejected")
  local rejectionData = rejectionNotice and json.decode(rejectionNotice.data)
  local rejectedAgain, rejectedAgainResults = open(rejectedOpen)
  ok("rejected-open tombstone prevents later acceptance",
    rejectedAgain.duplicate == true and rejectedAgain.error == "Worker is draining"
    and rejectedAgainResults.outbox.rejection.reference == rejectionNotice.reference)
  local malformedRejected = clone(rejectedOpen)
  malformedRejected.expiresAt = "invalid"
  malformedRejected.monster = nil
  local malformedRejectedAgain, malformedRejectedResults = open(malformedRejected)
  ok("malformed retry cannot replace an existing rejected outcome",
    malformedRejectedAgain.duplicate == true
    and malformedRejectedAgain.error == "Worker is draining"
    and malformedRejectedResults.outbox.rejection.reference == rejectionNotice.reference
    and BattleFleetState.outcomes[rejectedOpen.assignmentId].kind == "rejected")
  local rejectedRetry, rejectedRetryResults = signed(OWNER, {
    Action = "Fleet.OpenRejected.Retry", RejectionId = rejectionData.rejectionId,
  })
  ok("owner can retry exact rejected-open delivery", rejectedRetry.retried == true
    and rejectedRetryResults.outbox.rejection.reference == rejectionNotice.reference)
  local rejectedAck, rejectedAckResults = delivered(GAME, {
    Action = "Fleet.OpenRejected.Ack",
    RejectionId = rejectionData.rejectionId,
  })
  local rejectionConfirmation = rejectedAckResults.outbox
    and rejectedAckResults.outbox.confirmation
  local rejectionConfirmationData = rejectionConfirmation
    and json.decode(rejectionConfirmation.data)
  ok("game acknowledges rejection and worker confirms full final tuple",
    rejectedAck.acknowledged == true
    and rejectionConfirmation.action == "Battle.Fleet.FinalAcked"
    and rejectionConfirmationData.kind == "rejection"
    and rejectionConfirmationData.finalId == rejectionData.rejectionId
    and rejectionConfirmationData.assignmentId == rejectedOpen.assignmentId)
  local drainRound = BattleFleetState.battles["battle-drain"].battle.round
  response = attack("battle-drain", "during-drain", drainRound, chooseMove("battle-drain"))
  ok("drain lets an active battle continue", response.error == nil
    and BattleFleetState.battles["battle-drain"].battle.round == drainRound + 1, response.error)
  response = signed(OWNER, { Action = "Fleet.Drain", Drain = "false" })
  ok("owner returns worker to service", response.draining == false and response.accepting == true)

  response = signed(PLAYER, {
    Action = "Battle.Cancel",
    BattleId = "battle-drain",
    ReservationId = drainPayload.reservationId,
    Ticket = drainPayload.ticket,
    CancelId = "cancel-drain",
  })
  ok("wallet cannot cancel an authority reservation", response.error ~= nil, response.error)
  local activeBeforeCancel = json.decode(base.fleetstatus).active
  local cancelled, cancelResults = delivered(GAME, {
    Action = "Battle.Cancel",
    BattleId = "battle-drain",
    ReservationId = drainPayload.reservationId,
    Ticket = drainPayload.ticket,
    CancelId = "cancel-drain",
    Reason = "client-abandoned",
  })
  ok("authority cancel releases active capacity", cancelled.cancelled == true
    and json.decode(base.fleetstatus).active == activeBeforeCancel - 1)
  ok("cancel emits stable authority acknowledgement",
    cancelResults.outbox.cancellation.target == GAME
    and cancelResults.outbox.cancellation.action == "Battle.Fleet.Cancelled"
    and cancelResults.outbox.cancellation.reference == "cancel-drain")
  local cancellationData = json.decode(cancelResults.outbox.cancellation.data)
  ok("cancellation proves the worker opened the assigned battle",
    cancellationData.openedId == "test-worker-opened-" .. drainPayload.assignmentId)
  local repeatedCancel, repeatedCancelResults = delivered(GAME, {
    Action = "Battle.Cancel",
    BattleId = "battle-drain",
    ReservationId = drainPayload.reservationId,
    Ticket = drainPayload.ticket,
    CancelId = "cancel-drain",
    Reason = "client-abandoned",
  })
  ok("duplicate cancellation is idempotent", repeatedCancel.duplicate == true
    and repeatedCancelResults.outbox.cancellation.reference == "cancel-drain")
  local cancelRetry, cancelRetryResults = signed(OWNER, {
    Action = "Fleet.Cancellation.Retry", CancelId = "cancel-drain",
  })
  ok("owner can retry exact cancellation delivery", cancelRetry.retried == true
    and cancelRetryResults.outbox.cancellation.reference == "cancel-drain")
  local cancelAck, cancelAckResults = delivered(GAME, {
    Action = "Fleet.Cancellation.Ack", CancelId = "cancel-drain",
  })
  local cancelAckAgain, cancelAckAgainResults = delivered(GAME, {
    Action = "Fleet.Cancellation.Ack", CancelId = "cancel-drain",
  })
  ok("cancellation acknowledgement is idempotent", cancelAck.duplicate == false
    and cancelAckAgain.duplicate == true
    and cancelAckResults.outbox.confirmation.action == "Battle.Fleet.FinalAcked"
    and cancelAckAgainResults.outbox.confirmation.reference
      == cancelAckResults.outbox.confirmation.reference)
  local cancelledAfterAck, cancelledAfterAckResults = delivered(GAME, {
    Action = "Battle.Cancel", BattleId = "battle-drain",
    ReservationId = drainPayload.reservationId, Ticket = drainPayload.ticket,
    CancelId = "cancel-drain", Reason = "client-abandoned",
  })
  ok("duplicate cancellation stops emitting after acknowledgement",
    cancelledAfterAck.duplicate == true and cancelledAfterAckResults.outbox == nil)
  response = attack("battle-drain", "after-cancel", 1, chooseMove("battle-drain"))
  ok("cancelled battle rejects further attacks", response.error ~= nil, response.error)

  local expiryPayload = opening("expiry")
  expiryPayload.expiresAt = T + 3000
  local expiryOpened = open(expiryPayload)
  ok("short-lived reservation opens", expiryOpened.error == nil, expiryOpened.error)
  response = delivered(GAME, {
    Action = "Battle.Expire",
    BattleId = "battle-expiry",
    ReservationId = expiryPayload.reservationId,
    Ticket = expiryPayload.ticket,
    CancelId = "expire-expiry",
  })
  ok("expiry before deadline fails closed", response.error == "Battle reservation has not expired", response.error)
  local expired, expiryResults = delivered(GAME, {
    Action = "Battle.Expire",
    BattleId = "battle-expiry",
    ReservationId = expiryPayload.reservationId,
    Ticket = expiryPayload.ticket,
    CancelId = "expire-expiry",
  })
  ok("authority-driven expiry releases capacity", expired.cancelled == true
    and expiryResults.outbox.cancellation.reference == "expire-expiry")
  delivered(GAME, { Action = "Fleet.Cancellation.Ack", CancelId = "expire-expiry" })

  local final1, finalResults = finish("battle-1", trace)
  if firstResults.outbox and firstResults.outbox.settlement then finalResults = firstResults end
  local settlement = finalResults and finalResults.outbox and finalResults.outbox.settlement
  ok("final action emits a settlement", type(settlement) == "table")
  if settlement then
    local settlementData = json.decode(settlement.data)
    ok("settlement routes directly to game authority", settlement.target == GAME
      and settlement.action == "Battle.Fleet.Settle")
    ok("settlement has a stable idempotency reference",
      settlement.reference == "test-worker-battle-1"
      and settlementData.settlementId == settlement.reference)
    ok("settlement contains reservation identity", settlementData.battleId == "battle-1"
      and settlementData.reservationId == "reservation-1"
      and settlementData.playerId == PLAYER)
    ok("settlement does not misuse Target as a tag", settlement.Target == nil)

    local settlementAck, settlementAckResults = delivered(GAME, {
      Action = "Fleet.Settlement.Ack", SettlementId = settlement.reference,
    })
    response = settlementAck
    local settlementConfirmation = settlementAckResults.outbox
      and settlementAckResults.outbox.confirmation
    ok("game acknowledges settlement and worker confirms receipt",
      response.acknowledged == true and response.duplicate == false
      and settlementConfirmation.action == "Battle.Fleet.FinalAcked")
    local duplicateSettlementAck, duplicateSettlementAckResults = delivered(GAME, {
      Action = "Fleet.Settlement.Ack", SettlementId = settlement.reference,
    })
    response = duplicateSettlementAck
    ok("lost confirmation self-heals through duplicate authority ack",
      response.acknowledged == true and response.duplicate == true
      and duplicateSettlementAckResults.outbox.confirmation.reference
        == settlementConfirmation.reference)

    local confirmationRetry, confirmationRetryResults = signed(OWNER, {
      Action = "Fleet.FinalAcked.Retry",
      ConfirmationId = settlementConfirmation.reference,
    })
    ok("owner retries the exact worker confirmation receipt",
      confirmationRetry.retried == true
      and confirmationRetryResults.outbox.confirmation.reference
        == settlementConfirmation.reference)
    local releasedConfirmation = delivered(GAME, {
      Action = "Fleet.FinalAcked.Release",
      ConfirmationId = settlementConfirmation.reference,
    })
    ok("authority releases confirmation retention after receipt",
      releasedConfirmation.released == true and releasedConfirmation.duplicate == false)

    local retry1, retryResults1 = signed(OWNER, {
      Action = "Fleet.Settlement.Retry", SettlementId = settlement.reference,
    })
    local retry2, retryResults2 = signed(OWNER, {
      Action = "Fleet.Settlement.Retry", SettlementId = settlement.reference,
    })
    ok("operator retry preserves settlement id",
      retry1.retried == true and retry2.retried == true
      and retryResults1.outbox.settlement.reference == settlement.reference
      and retryResults2.outbox.settlement.reference == settlement.reference)
  end

  -- Authority-side duplicate protection -----------------------------------

  local function testAuthorityTransitions()
  local authority = Authority.newState()
  local authorityRequest = {
    reservationId = "authority-reservation",
    sequence = 1,
    ticket = "authority-ticket",
    battleId = "authority-battle",
    assignmentId = "authority-assignment",
    workerId = "test-worker",
    workerProcessId = WORKER_PROCESS,
    playerId = PLAYER,
    monster = monster(),
    rewardPlan = { lootbox = 1 },
    reservedCost = { rune = 1, energy = 25 },
    issuedAt = T,
    expiresAt = T + 600000,
  }
  local reservation, duplicateReservation = Authority.reserve(authority, authorityRequest)
  ok("authority records reservation once", reservation ~= nil and duplicateReservation == false)
  local reservationAgain, reservationIsDuplicate = Authority.reserve(authority, authorityRequest)
  ok("authority exact reservation retry remains idempotent",
    reservationAgain.reservationId == reservation.reservationId
    and reservationIsDuplicate == true)
  local conflictingReservation = {}
  for k, v in pairs(authorityRequest) do conflictingReservation[k] = v end
  conflictingReservation.rewardPlan = { lootbox = 999 }
  local conflictingReservationResult, conflictingReservationWhy = Authority.reserve(
    authority, conflictingReservation)
  ok("authority rejects changed data on a live sequence retry",
    conflictingReservationResult == nil
    and conflictingReservationWhy == "conflicting retry for existing reservation",
    conflictingReservationWhy)
  local gapRequest = {}
  for k, v in pairs(authorityRequest) do gapRequest[k] = v end
  gapRequest.sequence = 3
  gapRequest.reservationId = "gap-reservation"
  gapRequest.ticket = "gap-ticket"
  gapRequest.battleId = "gap-battle"
  gapRequest.assignmentId = "gap-assignment"
  local gapReservation, gapWhy = Authority.reserve(authority, gapRequest)
  local maximumRequest = {}
  for k, v in pairs(gapRequest) do maximumRequest[k] = v end
  maximumRequest.sequence = math.maxinteger
  maximumRequest.reservationId = "maximum-reservation"
  maximumRequest.ticket = "maximum-ticket"
  maximumRequest.battleId = "maximum-battle"
  maximumRequest.assignmentId = "maximum-assignment"
  local maximumReservation, maximumWhy = Authority.reserve(authority, maximumRequest)
  ok("authority rejects sequence gaps without consuming the next value",
    gapReservation == nil and gapWhy == "sequence must be exactly the next value", gapWhy)
  ok("authority rejects maxinteger sequence before overflow",
    maximumReservation == nil and maximumWhy == "reservation sequence space is exhausted",
    maximumWhy)
  local openedAuthority, openedAuthorityDuplicate = Authority.markOpened(authority, {
    protocol = Authority.PROTOCOL,
    openedId = "authority-opened",
    workerId = "test-worker",
    battleId = reservation.battleId,
    assignmentId = reservation.assignmentId,
    reservationId = reservation.reservationId,
    ticket = reservation.ticket,
    playerId = PLAYER,
  }, WORKER_PROCESS, T)
  ok("authority authenticates Opened with process identity",
    openedAuthority.status == "open" and openedAuthorityDuplicate == false)
  local effectPayload = {
    protocol = Authority.PROTOCOL,
    settlementId = "test-worker-authority-battle",
    workerId = "test-worker",
    battleId = "authority-battle",
    assignmentId = "authority-assignment",
    reservationId = "authority-reservation",
    ticket = "authority-ticket",
    playerId = PLAYER,
    result = "win",
    rewardPlan = { lootbox = 999 },
  }
  local effect, duplicateEffect = Authority.settle(authority, effectPayload, WORKER_PROCESS, T)
  ok("authority accepts matching settlement once", effect ~= nil and duplicateEffect == false)
  ok("authority uses its reserved reward plan", effect and effect.rewardPlan.lootbox == 1)
  local repeatedEffect, isDuplicate = Authority.settle(authority, effectPayload, WORKER_PROCESS, T + 1)
  ok("authority deduplicates settlement before rewards", isDuplicate == true
    and repeatedEffect.settlementId == effect.settlementId)
  local forgedDuplicate = {}
  for k, v in pairs(effectPayload) do forgedDuplicate[k] = v end
  forgedDuplicate.playerId = ATTACKER
  local forgedEffect, forgedWhy = Authority.settle(
    authority, forgedDuplicate, WORKER_PROCESS, T + 2)
  ok("duplicate settlement revalidates full identity",
    forgedEffect == nil and forgedWhy == "worker notice does not match reservation", forgedWhy)
  local wrongProcessEffect, wrongProcessWhy = Authority.settle(
    authority, effectPayload, OTHER_PROCESS, T + 2)
  ok("logical worker label cannot replace process authentication",
    wrongProcessEffect == nil and wrongProcessWhy == "wrong worker process", wrongProcessWhy)
  local conflictingOutcome = {}
  for k, v in pairs(effectPayload) do conflictingOutcome[k] = v end
  conflictingOutcome.result = effectPayload.result == "win" and "loss" or "win"
  local conflictingEffect, conflictingWhy = Authority.settle(
    authority, conflictingOutcome, WORKER_PROCESS, T + 2)
  ok("duplicate settlement id cannot change outcome",
    conflictingEffect == nil and conflictingWhy == "conflicting duplicate settlement",
    conflictingWhy)

  local cancelReservation = Authority.reserve(authority, {
    sequence = 2,
    reservationId = "cancel-reservation",
    ticket = "cancel-ticket",
    battleId = "cancel-battle",
    assignmentId = "cancel-assignment",
    workerId = "test-worker",
    workerProcessId = WORKER_PROCESS,
    playerId = PLAYER,
    monster = monster(),
    rewardPlan = {},
    reservedCost = { rune = 1 },
    issuedAt = T,
    expiresAt = T + 600000,
  })
  local collidingSettlement = {
    protocol = Authority.PROTOCOL,
    settlementId = effectPayload.settlementId,
    workerId = cancelReservation.workerId,
    battleId = cancelReservation.battleId,
    assignmentId = cancelReservation.assignmentId,
    reservationId = cancelReservation.reservationId,
    ticket = cancelReservation.ticket,
    playerId = cancelReservation.playerId,
    result = "win",
  }
  local collidedEffect, collidedWhy = Authority.settle(
    authority, collidingSettlement, WORKER_PROCESS, T)
  ok("authority final id cannot move to another reservation",
    collidedEffect == nil and collidedWhy == "settlementId belongs to another reservation",
    collidedWhy)
  local cancelPending = Authority.requestCancel(
    authority, cancelReservation.reservationId, "authority-cancel", "expired", T)
  ok("authority marks cancellation pending before refund", cancelPending.status == "cancel-pending")
  local cancelPayload = {
    protocol = Authority.PROTOCOL,
    cancelId = "authority-cancel",
    workerId = "test-worker",
    battleId = "cancel-battle",
    assignmentId = "cancel-assignment",
    reservationId = "cancel-reservation",
    ticket = "cancel-ticket",
    playerId = PLAYER,
    reason = "expired",
  }
  local refund, duplicateRefund = Authority.finalizeCancel(
    authority, cancelPayload, WORKER_PROCESS, T + 1)
  ok("trusted cancellation acknowledgement refunds once",
    refund.refund.rune == 1 and duplicateRefund == false)
  local refundAgain, refundIsDuplicate = Authority.finalizeCancel(
    authority, cancelPayload, WORKER_PROCESS, T + 2)
  ok("duplicate cancellation acknowledgement cannot refund twice",
    refundIsDuplicate == true and refundAgain.cancelId == refund.cancelId)
  local forgedCancel = {}
  for k, v in pairs(cancelPayload) do forgedCancel[k] = v end
  forgedCancel.ticket = "another-ticket"
  local forgedRefund, forgedCancelWhy = Authority.finalizeCancel(
    authority, forgedCancel, WORKER_PROCESS, T + 3)
  ok("duplicate cancellation revalidates full identity",
    forgedRefund == nil and forgedCancelWhy == "worker notice does not match reservation",
    forgedCancelWhy)

  local function testAuthorityForfeitTransitions()
    local state = Authority.newState()
    local function reserveForfeit(sequence, suffix)
      return Authority.reserve(state, {
        sequence = sequence,
        reservationId = "forfeit-reservation-" .. suffix,
        ticket = "forfeit-ticket-" .. suffix,
        battleId = "forfeit-battle-" .. suffix,
        assignmentId = "forfeit-assignment-" .. suffix,
        workerId = "test-worker", workerProcessId = WORKER_PROCESS,
        playerId = PLAYER, monster = monster(),
        rewardPlan = {
          win = { wins = 1 },
          loss = { losses = 1, experience = 1 },
        },
        reservedCost = { battles = 1 },
        issuedAt = T, expiresAt = T + 600000,
      })
    end
    local opened = reserveForfeit(1, "opened")
    local openedId = "test-worker-opened-" .. opened.assignmentId
    Authority.markOpened(state, {
      protocol = Authority.PROTOCOL, openedId = openedId,
      workerId = opened.workerId, battleId = opened.battleId,
      assignmentId = opened.assignmentId, reservationId = opened.reservationId,
      ticket = opened.ticket, playerId = opened.playerId,
    }, WORKER_PROCESS, T + 1)
    Authority.requestCancel(state, opened.reservationId,
      "forfeit-cancel-opened", "player-left", T + 2)
    local payload = {
      protocol = Authority.PROTOCOL, cancelId = "forfeit-cancel-opened",
      openedId = openedId, workerId = opened.workerId, battleId = opened.battleId,
      assignmentId = opened.assignmentId, reservationId = opened.reservationId,
      ticket = opened.ticket, playerId = opened.playerId, reason = "player-left",
    }
    local effect, duplicate = Authority.finalizeCancel(
      state, payload, WORKER_PROCESS, T + 3)
    ok("opened player-left cancellation is an authoritative loss without refund",
      duplicate == false and effect.disposition == "forfeit"
      and effect.forfeit == true and effect.result == "loss"
      and effect.openedId == openedId and effect.refund == nil
      and effect.rewardPlan.loss.losses == 1)
    local effectAgain, duplicateAgain = Authority.finalizeCancel(
      state, payload, WORKER_PROCESS, T + 4)
    ok("duplicate player forfeit is compact and cannot mutate rewards twice",
      duplicateAgain == true and effectAgain.disposition == "forfeit"
      and effectAgain.forfeit == true and effectAgain.result == "loss"
      and effectAgain.refund == nil and effectAgain.rewardPlan == nil)

    -- A lost Battle.Fleet.Opened notice must not turn quit/retry into a refund.
    -- The authenticated worker's deterministic openedId proves it accepted the
    -- assignment before serially processing the cancellation.
    local lostOpened = reserveForfeit(2, "lost-opened")
    local lostOpenedId = "test-worker-opened-" .. lostOpened.assignmentId
    Authority.requestCancel(state, lostOpened.reservationId,
      "forfeit-cancel-lost-opened", "player-left", T + 5)
    local lostPayload = {
      protocol = Authority.PROTOCOL, cancelId = "forfeit-cancel-lost-opened",
      openedId = lostOpenedId,
      workerId = lostOpened.workerId, battleId = lostOpened.battleId,
      assignmentId = lostOpened.assignmentId,
      reservationId = lostOpened.reservationId, ticket = lostOpened.ticket,
      playerId = lostOpened.playerId, reason = "player-left",
    }
    local recoveredForfeit = Authority.finalizeCancel(
      state, lostPayload, WORKER_PROCESS, T + 6)
    ok("trusted worker opened proof preserves forfeit after lost Opened notice",
      recoveredForfeit.disposition == "forfeit"
      and recoveredForfeit.result == "loss" and recoveredForfeit.refund == nil)

    -- A scheduler-authenticated worker cancellation with no openedId proves
    -- the assignment never became attackable. Even player-left is refundable
    -- in that pre-open state; reason text never chooses the disposition.
    local neverOpened = reserveForfeit(3, "never-opened")
    Authority.requestCancel(state, neverOpened.reservationId,
      "never-opened-cancel", "player-left", T + 7)
    local neverOpenedPayload = {
      protocol = Authority.PROTOCOL, cancelId = "never-opened-cancel",
      workerId = neverOpened.workerId, battleId = neverOpened.battleId,
      assignmentId = neverOpened.assignmentId,
      reservationId = neverOpened.reservationId, ticket = neverOpened.ticket,
      playerId = neverOpened.playerId, reason = "player-left",
    }
    local neverOpenedRefund = Authority.finalizeCancel(
      state, neverOpenedPayload, WORKER_PROCESS, T + 8)
    ok("authenticated never-opened player cancellation refunds reserved credit",
      neverOpenedRefund.disposition == "refund"
      and neverOpenedRefund.refund.battles == 1
      and neverOpenedRefund.rewardPlan == nil)

    local operational = reserveForfeit(4, "operational")
    Authority.requestCancel(state, operational.reservationId,
      "operational-cancel", "expired", T + 9)
    local operationalPayload = {
      protocol = Authority.PROTOCOL, cancelId = "operational-cancel",
      workerId = operational.workerId, battleId = operational.battleId,
      assignmentId = operational.assignmentId,
      reservationId = operational.reservationId, ticket = operational.ticket,
      playerId = operational.playerId, reason = "player-left",
    }
    local changedReason, changedReasonWhy = Authority.finalizeCancel(
      state, operationalPayload, WORKER_PROCESS, T + 10)
    ok("worker cannot change authority-owned cancellation disposition",
      changedReason == nil
      and changedReasonWhy == "cancellation reason does not match reservation",
      changedReasonWhy)
    operationalPayload.reason = "expired"
    local refundEffect = Authority.finalizeCancel(
      state, operationalPayload, WORKER_PROCESS, T + 11)
    ok("pre-open operational cancellation still refunds reserved credit",
      refundEffect.disposition == "refund" and refundEffect.forfeit == false
      and refundEffect.refund.battles == 1 and refundEffect.rewardPlan == nil)

    local expiredOpened = reserveForfeit(5, "expired-opened")
    local expiredOpenedId = "test-worker-opened-" .. expiredOpened.assignmentId
    Authority.markOpened(state, {
      protocol = Authority.PROTOCOL, openedId = expiredOpenedId,
      workerId = expiredOpened.workerId, battleId = expiredOpened.battleId,
      assignmentId = expiredOpened.assignmentId,
      reservationId = expiredOpened.reservationId,
      ticket = expiredOpened.ticket, playerId = expiredOpened.playerId,
    }, WORKER_PROCESS, T + 12)
    Authority.requestCancel(state, expiredOpened.reservationId,
      "expired-opened-cancel", "expired", T + 13)
    local expiredForfeit = Authority.finalizeCancel(state, {
      protocol = Authority.PROTOCOL, cancelId = "expired-opened-cancel",
      openedId = expiredOpenedId, workerId = expiredOpened.workerId,
      battleId = expiredOpened.battleId,
      assignmentId = expiredOpened.assignmentId,
      reservationId = expiredOpened.reservationId,
      ticket = expiredOpened.ticket, playerId = expiredOpened.playerId,
      reason = "expired",
    }, WORKER_PROCESS, T + 14)
    ok("opened operational expiry consumes the reserved attempt as a forfeit",
      expiredForfeit.disposition == "forfeit"
      and expiredForfeit.result == "loss"
      and expiredForfeit.refund == nil)
  end
  testAuthorityForfeitTransitions()

  local lateReservation = Authority.reserve(authority, {
    sequence = 3,
    reservationId = "late-open-reservation", ticket = "late-open-ticket",
    battleId = "late-open-battle", assignmentId = "late-open-assignment",
    workerId = "test-worker", workerProcessId = WORKER_PROCESS,
    playerId = PLAYER, monster = monster(), rewardPlan = {}, reservedCost = { rune = 1 },
    issuedAt = T, expiresAt = T + 600000,
  })
  Authority.requestCancel(authority, lateReservation.reservationId,
    "late-open-cancel", "abandoned", T)
  local lateOpened, lateOpenedWhy = Authority.markOpened(authority, {
    protocol = Authority.PROTOCOL, openedId = "opened-late",
    workerId = "test-worker", battleId = lateReservation.battleId,
    assignmentId = lateReservation.assignmentId,
    reservationId = lateReservation.reservationId, ticket = lateReservation.ticket,
    playerId = PLAYER,
  }, WORKER_PROCESS, T + 1)
  ok("late Opened notice cannot revive cancel-pending reservation",
    lateOpened == nil and lateOpenedWhy == "reservation cancellation is pending", lateOpenedWhy)

  local rejectedReservation = Authority.reserve(authority, {
    sequence = 4,
    reservationId = "rejected-reservation", ticket = "rejected-ticket",
    battleId = "rejected-battle", assignmentId = "rejected-assignment",
    workerId = "test-worker", workerProcessId = WORKER_PROCESS,
    playerId = PLAYER, monster = monster(), rewardPlan = {}, reservedCost = { rune = 2 },
    issuedAt = T, expiresAt = T + 600000,
  })
  local rejectionPayload = {
    protocol = Authority.PROTOCOL, rejectionId = "rejected-notice",
    workerId = "test-worker", battleId = rejectedReservation.battleId,
    assignmentId = rejectedReservation.assignmentId,
    reservationId = rejectedReservation.reservationId, ticket = rejectedReservation.ticket,
    playerId = PLAYER, reason = "Worker is draining",
  }
  local rejectedEffect, rejectedDuplicate = Authority.rejectOpen(
    authority, rejectionPayload, WORKER_PROCESS, T + 1)
  local rejectedEffectAgain, rejectedIsDuplicate = Authority.rejectOpen(
    authority, rejectionPayload, WORKER_PROCESS, T + 2)
  ok("trusted OpenRejected safely refunds reservation once",
    rejectedEffect.refund.rune == 2 and rejectedDuplicate == false
    and rejectedIsDuplicate == true and rejectedEffectAgain.rejectionId == rejectedEffect.rejectionId)

  local deadReservation = Authority.reserve(authority, {
    sequence = 5,
    reservationId = "dead-reservation", ticket = "dead-ticket",
    battleId = "dead-battle", assignmentId = "dead-assignment",
    workerId = "test-worker", workerProcessId = WORKER_PROCESS,
    playerId = PLAYER, monster = monster(), rewardPlan = {}, reservedCost = { rune = 3 },
    issuedAt = T, expiresAt = T + 600000,
  })
  local forceRequest = {
    resolutionId = "force-dead-1", reservationId = deadReservation.reservationId,
    workerId = "test-worker", workerProcessId = WORKER_PROCESS,
    battleId = deadReservation.battleId, playerId = PLAYER,
    reason = "worker permanently unavailable", evidence = "operator incident TEST-42",
  }
  local deniedForce = Authority.forceResolve(authority, forceRequest, ATTACKER, OWNER, T)
  local forced, forceDuplicate = Authority.forceResolve(authority, forceRequest, OWNER, OWNER, T)
  local forcedAgain, forceIsDuplicate = Authority.forceResolve(
    authority, forceRequest, OWNER, OWNER, T + 1)
  local forgedForce = {}
  for k, v in pairs(forceRequest) do forgedForce[k] = v end
  forgedForce.workerProcessId = OTHER_PROCESS
  local forgedForceResult, forgedForceWhy = Authority.forceResolve(
    authority, forgedForce, OWNER, OWNER, T + 2)
  ok("only owner can force-resolve dead worker", deniedForce == nil)
  ok("dead-worker force resolution is audited and idempotent",
    forced.refund.rune == 3 and forceDuplicate == false and forceIsDuplicate == true
    and forcedAgain.resolutionId == forced.resolutionId and #authority.audit == 1
    and authority.finalized[deadReservation.reservationId].deliveryConfirmed == true
    and authority.finalized[deadReservation.reservationId].deliveryConfirmationMode
      == "owner-force-resolution")
  ok("duplicate force resolution revalidates full worker identity",
    forgedForceResult == nil and forgedForceWhy == "force resolution does not match reservation",
    forgedForceWhy)

  local function tableSize(value)
    local count = 0
    for _ in pairs(value) do count = count + 1 end
    return count
  end
  local compactAuthority = Authority.newState({
    maxEntries = 2, replayWindow = 50, auditLimit = 2,
  })
  local function compactRequest(sequence)
    return {
      sequence = sequence,
      reservationId = "compact-reservation-" .. sequence,
      ticket = "compact-ticket-" .. sequence,
      battleId = "compact-battle-" .. sequence,
      assignmentId = "compact-assignment-" .. sequence,
      workerId = "test-worker", workerProcessId = WORKER_PROCESS,
      playerId = PLAYER, monster = monster(),
      rewardPlan = { deliberately = { bulky = string.rep("x", 1000) } },
      reservedCost = { rune = 1 },
      issuedAt = T + sequence, expiresAt = T + sequence + 40,
    }
  end
  local compactOneRequest = compactRequest(1)
  local compactOne = Authority.reserve(compactAuthority, compactOneRequest)
  local compactSettlement = {
    protocol = Authority.PROTOCOL, settlementId = "compact-settlement-1",
    workerId = compactOne.workerId, battleId = compactOne.battleId,
    assignmentId = compactOne.assignmentId,
    reservationId = compactOne.reservationId, ticket = compactOne.ticket,
    playerId = compactOne.playerId, result = "win", rounds = 2,
  }
  Authority.settle(compactAuthority, compactSettlement, WORKER_PROCESS, T + 2)
  local compactTomb = compactAuthority.finalized[compactOne.reservationId]
  ok("authority finalization drops bulky live reservation state",
    compactAuthority.reservations[compactOne.reservationId] == nil
    and compactTomb.compact == true and compactTomb.monster == nil
    and compactTomb.rewardPlan == nil and compactTomb.effect.rewardPlan == nil)

  local compactTwo = Authority.reserve(compactAuthority, compactRequest(2))
  local compactRejection = {
    protocol = Authority.PROTOCOL, rejectionId = "compact-rejection-2",
    workerId = compactTwo.workerId, battleId = compactTwo.battleId,
    assignmentId = compactTwo.assignmentId,
    reservationId = compactTwo.reservationId, ticket = compactTwo.ticket,
    playerId = compactTwo.playerId, reason = "capacity",
  }
  Authority.rejectOpen(compactAuthority, compactRejection, WORKER_PROCESS, T + 3)
  local atBound = Authority.stats(compactAuthority, T + 3)
  local blockedAtBound, blockedAtBoundWhy = Authority.reserve(
    compactAuthority, compactRequest(3))
  ok("authority bounds live plus compact replay entries",
    atBound.total == 2 and blockedAtBound == nil
    and blockedAtBoundWhy == "authority replay ledger is at capacity")
  ok("authority secondary indexes stay proportional to bounded entries",
    tableSize(compactAuthority.tickets) == 2
    and tableSize(compactAuthority.battles) == 2
    and tableSize(compactAuthority.assignments) == 2
    and tableSize(compactAuthority.settlements) == 1
    and tableSize(compactAuthority.rejections) == 1)

  local unconfirmedAfterTime = Authority.prune(compactAuthority, T + 100)
  ok("time advance never prunes unconfirmed authority finals",
    unconfirmedAfterTime.total == 2
    and unconfirmedAfterTime.pendingDeliveryConfirmations == 2)
  local compactAck = Authority.deliveryAck(compactAuthority, compactOne.reservationId)
  ok("authority retains an exact retryable final acknowledgement",
    compactAck.target == WORKER_PROCESS
    and compactAck.action == "Fleet.Settlement.Ack"
    and compactAck.SettlementId == compactSettlement.settlementId)
  local function confirmationFor(final)
    return {
      protocol = Authority.PROTOCOL,
      confirmationId = final.workerId .. "-final-acked-" .. final.kind .. "-" .. final.finalId,
      kind = final.kind, finalId = final.finalId,
      workerId = final.workerId, battleId = final.battleId,
      assignmentId = final.assignmentId, reservationId = final.reservationId,
      ticket = final.ticket, playerId = final.playerId,
    }
  end
  local compactOneConfirmation = confirmationFor(compactTomb)
  local deniedConfirmation, deniedConfirmationWhy = Authority.confirmDelivery(
    compactAuthority, compactOneConfirmation, OTHER_PROCESS, T + 101)
  local forgedConfirmation = {}
  for key, value in pairs(compactOneConfirmation) do forgedConfirmation[key] = value end
  forgedConfirmation.ticket = "forged-confirmation-ticket"
  local forgedConfirmationResult, forgedConfirmationWhy = Authority.confirmDelivery(
    compactAuthority, forgedConfirmation, WORKER_PROCESS, T + 101)
  local confirmedOne, confirmedOneDuplicate = Authority.confirmDelivery(
    compactAuthority, compactOneConfirmation, WORKER_PROCESS, T + 101)
  local confirmedOneAgain, confirmedOneIsDuplicate = Authority.confirmAck(
    compactAuthority, compactOneConfirmation, WORKER_PROCESS, T + 102)
  local compactTwoTomb = compactAuthority.finalized[compactTwo.reservationId]
  local confirmedTwo = Authority.confirmDelivery(
    compactAuthority, confirmationFor(compactTwoTomb), WORKER_PROCESS, T + 102)
  ok("authority confirms full worker identity and final tuple idempotently",
    deniedConfirmation == nil and deniedConfirmationWhy == "wrong worker process"
    and forgedConfirmationResult == nil
    and forgedConfirmationWhy == "worker notice does not match reservation"
    and confirmedOne.confirmationId == compactOneConfirmation.confirmationId
    and confirmedOneDuplicate == false and confirmedOneIsDuplicate == true
    and confirmedOneAgain.releaseAction == "Fleet.FinalAcked.Release"
    and confirmedTwo ~= nil)
  Authority.prune(compactAuthority, T + 200)
  local replayedOld, replayedOldWhy = Authority.reserve(compactAuthority, compactOneRequest)
  ok("durable sequence high-water rejects replay after compact tombstone expiry",
    replayedOld == nil and replayedOldWhy == "sequence has already been consumed")
  local churnBounded = true
  for sequence = 3, 20 do
    local request = compactRequest(sequence)
    request.issuedAt = T + sequence * 100
    request.expiresAt = request.issuedAt + 40
    Authority.prune(compactAuthority, request.issuedAt)
    local reserved, reserveWhy = Authority.reserve(compactAuthority, request)
    if not reserved then churnBounded = false; error(reserveWhy) end
    local resolution = {
      resolutionId = "compact-force-" .. sequence,
      reservationId = reserved.reservationId,
      workerId = reserved.workerId, workerProcessId = reserved.workerProcessId,
      battleId = reserved.battleId, playerId = reserved.playerId,
      reason = "test cleanup", evidence = "bounded-churn-test",
    }
    local resolved = Authority.forceResolve(
      compactAuthority, resolution, OWNER, OWNER, request.issuedAt + 1)
    local stats = Authority.stats(compactAuthority, request.issuedAt + 1)
    if not resolved or stats.total > 2
       or tableSize(compactAuthority.tickets) > 2
       or tableSize(compactAuthority.battles) > 2
       or tableSize(compactAuthority.assignments) > 2 then
      churnBounded = false
    end
  end
  ok("authority maps remain bounded through sustained finalization churn", churnBounded)
  end
  testAuthorityTransitions()

  -- Bounded retained state -------------------------------------------------

  local p2 = opening("2")
  local opened2 = open(p2)
  ok("worker accepts assignments after drain", opened2.error == nil, opened2.error)
  if opened2.error then error("battle-2 open failed: " .. tostring(opened2.error)) end
  finish("battle-2", trace)
  local p3 = opening("3")
  local opened3 = open(p3)
  ok("third battle opens", opened3.error == nil, opened3.error)
  finish("battle-3", trace)

  response = drive({ Action = "Fleet.Status" })
  ok("ended/cancelled retention is bounded", response.retainedEnded == 4, response.retainedEnded)
  ok("oldest ended battle is removed from VM", BattleFleetState.battles["battle-1"] == nil)
  ok("oldest published battle key is removed", base["battle-battle-1"] == nil)
  ok("newer ended battles remain readable", BattleFleetState.battles["battle-2"] ~= nil
    and BattleFleetState.battles["battle-3"] ~= nil)

  out[#out + 1] = "TRACE " .. table.concat(trace, "|")
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end
