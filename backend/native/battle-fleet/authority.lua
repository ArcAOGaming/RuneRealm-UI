--- Compact game/account-authority transitions for battle-fleet protocol v1.
--- `workerId` is a logical label; `workerProcessId` is authenticated AO identity.

local Authority = {}
local PROTOCOL = "runerealm-battle-fleet/1"

local function copy(value)
  if type(value) ~= "table" then return value end
  local out = {}
  for k, v in pairs(value) do out[k] = copy(v) end
  return out
end

local function int(value, fallback)
  local narrowed = math.tointeger(tonumber(value))
  if narrowed == nil then return fallback end
  return narrowed
end

function Authority.newState(options)
  options = options or {}
  return {
    reservations = {}, finalized = {},
    tickets = {}, battles = {}, assignments = {},
    settlements = {}, cancellations = {}, openings = {}, rejections = {},
    resolutions = {},
    audit = {}, auditLimit = math.max(1, int(options.auditLimit, 1000)),
    maxEntries = math.max(1, int(options.maxEntries, 1000)),
    replayWindow = math.max(1, int(options.replayWindow, 60 * 60 * 1000)),
    maxTicketTtl = math.max(60000, int(options.maxTicketTtl, 60 * 60 * 1000)),
    highWaterTimestamp = 0,
    lastSequence = 0,
  }
end

local function appendAudit(state, row)
  state.audit[#state.audit + 1] = row
  local limit = math.max(1, int(state.auditLimit, 1000))
  while #state.audit > limit do table.remove(state.audit, 1) end
end

local function sameIdentity(a, b)
  return a.reservationId == b.reservationId
    and a.ticket == b.ticket and a.battleId == b.battleId
    and a.assignmentId == b.assignmentId and a.workerId == b.workerId
    and a.workerProcessId == b.workerProcessId and a.playerId == b.playerId
end

local function deepEqual(a, b, seen)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  seen = seen or {}
  if seen[a] == b then return true end
  seen[a] = b
  for k, v in pairs(a) do
    if not deepEqual(v, b[k], seen) then return false end
  end
  for k in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

local function sameLiveRequest(existing, request)
  return existing.issuedAt == int(request.issuedAt, nil)
    and existing.expiresAt == int(request.expiresAt, nil)
    and deepEqual(existing.monster, request.monster)
    and deepEqual(existing.rewardPlan or {}, request.rewardPlan or {})
    and deepEqual(existing.reservedCost or {}, request.reservedCost or {})
end

local function removeFinal(state, reservationId, final)
  state.finalized[reservationId] = nil
  if state.tickets[final.ticket] == reservationId then state.tickets[final.ticket] = nil end
  if state.battles[final.battleId] == reservationId then state.battles[final.battleId] = nil end
  if state.assignments[final.assignmentId] == reservationId then
    state.assignments[final.assignmentId] = nil
  end
  if final.kind == "settlement" and state.settlements[final.finalId] == reservationId then
    state.settlements[final.finalId] = nil
  elseif final.kind == "cancellation" and state.cancellations[final.finalId] == reservationId then
    state.cancellations[final.finalId] = nil
  elseif final.kind == "rejection" and state.rejections[final.finalId] == reservationId then
    state.rejections[final.finalId] = nil
  elseif final.kind == "force" and state.resolutions[final.finalId] == reservationId then
    state.resolutions[final.finalId] = nil
  end
end

local function advance(state, timestamp)
  state.highWaterTimestamp = math.max(int(state.highWaterTimestamp, 0), int(timestamp, 0))
  for reservationId, final in pairs(state.finalized) do
    if final.deliveryConfirmed == true
       and state.highWaterTimestamp > final.protectUntil then
      removeFinal(state, reservationId, final)
    end
  end
end

local function entryCount(state)
  local count = 0
  for _ in pairs(state.reservations) do count = count + 1 end
  for _ in pairs(state.finalized) do count = count + 1 end
  return count
end

function Authority.stats(state, timestamp)
  advance(state, timestamp)
  local live, finalized, pendingConfirmations = 0, 0, 0
  for _ in pairs(state.reservations) do live = live + 1 end
  for _, final in pairs(state.finalized) do
    finalized = finalized + 1
    if final.kind ~= "force" and final.deliveryConfirmed ~= true then
      pendingConfirmations = pendingConfirmations + 1
    end
  end
  return {
    live = live, finalized = finalized, total = live + finalized,
    maxEntries = state.maxEntries, lastSequence = state.lastSequence,
    pendingDeliveryConfirmations = pendingConfirmations,
  }
end

function Authority.prune(state, timestamp)
  advance(state, timestamp)
  return Authority.stats(state, timestamp)
end

local function compactFinal(state, reservation, kind, finalId, effect, timestamp, outcome)
  local reservationId = reservation.reservationId
  local tomb = {
    compact = true,
    protocol = PROTOCOL,
    status = kind == "settlement" and "settled"
      or kind == "cancellation" and "cancelled"
      or kind == "rejection" and "rejected" or "force-resolved",
    kind = kind,
    finalId = finalId,
    reservationId = reservationId,
    ticket = reservation.ticket,
    battleId = reservation.battleId,
    assignmentId = reservation.assignmentId,
    sequence = reservation.sequence,
    workerId = reservation.workerId,
    workerProcessId = reservation.workerProcessId,
    playerId = reservation.playerId,
    -- Duplicate notices need a stable acknowledgement, not another copy of
    -- the potentially bulky reserved reward/refund plan.
    effect = {
      settlementId = effect.settlementId,
      cancellationId = effect.cancellationId,
      cancelId = effect.cancelId,
      rejectionId = effect.rejectionId,
      resolutionId = effect.resolutionId,
      reservationId = effect.reservationId,
      battleId = effect.battleId,
      playerId = effect.playerId,
      result = effect.result,
      rounds = effect.rounds,
      timedOut = effect.timedOut,
      reason = effect.reason,
      resolution = effect.resolution,
      disposition = effect.disposition,
      forfeit = effect.forfeit,
      openedId = effect.openedId,
    },
    outcome = copy(outcome or {}),
    finalizedAt = timestamp,
    protectUntil = math.max(int(reservation.expiresAt, 0),
      int(timestamp, 0) + math.max(1, int(state.replayWindow, 60 * 60 * 1000))),
    deliveryConfirmed = kind == "force",
    deliveryConfirmationMode = kind == "force" and "owner-force-resolution" or nil,
  }
  state.reservations[reservationId] = nil
  if reservation.openedId then state.openings[reservation.openedId] = nil end
  state.finalized[reservationId] = tomb
  if kind == "settlement" then state.settlements[finalId] = reservationId
  elseif kind == "cancellation" then state.cancellations[finalId] = reservationId
  elseif kind == "rejection" then state.rejections[finalId] = reservationId
  elseif kind == "force" then state.resolutions[finalId] = reservationId end
  return tomb
end

local reservationForNotice
local ACK_ACTIONS = {
  settlement = { action = "Fleet.Settlement.Ack", field = "SettlementId" },
  cancellation = { action = "Fleet.Cancellation.Ack", field = "CancelId" },
  rejection = { action = "Fleet.OpenRejected.Ack", field = "RejectionId" },
}

function Authority.deliveryAck(state, reservationId)
  if type(state) ~= "table" then return nil, "state is required" end
  local final = state.finalized[reservationId]
  if not final then return nil, "finalized reservation not found" end
  local route = ACK_ACTIONS[final.kind]
  if not route then return nil, "final does not use worker delivery acknowledgement" end
  local ack = {
    target = final.workerProcessId,
    action = route.action,
    protocol = PROTOCOL,
    reference = final.finalId,
    workerId = final.workerId,
    battleId = final.battleId,
    assignmentId = final.assignmentId,
    reservationId = final.reservationId,
    ticket = final.ticket,
    playerId = final.playerId,
  }
  ack[route.field] = final.finalId
  return ack
end

function Authority.confirmDelivery(state, payload, sourceWorkerProcessId, timestamp)
  local final, why = reservationForNotice(state, payload, sourceWorkerProcessId, timestamp)
  if not final then return nil, why end
  if not final.compact or final.kind == "force" then
    return nil, "reservation is not awaiting worker delivery confirmation"
  end
  if payload.kind ~= final.kind or payload.finalId ~= final.finalId then
    return nil, "delivery confirmation does not match final outcome"
  end
  local expectedId = final.workerId .. "-final-acked-" .. final.kind .. "-" .. final.finalId
  if payload.confirmationId ~= expectedId then
    return nil, "delivery confirmation id is invalid"
  end
  if final.deliveryConfirmed == true then
    if final.confirmationId ~= payload.confirmationId then
      return nil, "conflicting delivery confirmation"
    end
    return {
      confirmationId = final.confirmationId,
      reservationId = final.reservationId,
      kind = final.kind,
      finalId = final.finalId,
      releaseAction = "Fleet.FinalAcked.Release",
      target = final.workerProcessId,
      release = {
        target = final.workerProcessId,
        action = "Fleet.FinalAcked.Release",
        protocol = PROTOCOL,
        reference = final.confirmationId,
        ConfirmationId = final.confirmationId,
      },
    }, true
  end
  final.deliveryConfirmed = true
  final.confirmationId = payload.confirmationId
  final.deliveryConfirmedAt = timestamp
  final.protectUntil = math.max(final.protectUntil,
    int(timestamp, 0) + math.max(1, int(state.replayWindow, 60 * 60 * 1000)))
  return {
    confirmationId = final.confirmationId,
    reservationId = final.reservationId,
    kind = final.kind,
    finalId = final.finalId,
    releaseAction = "Fleet.FinalAcked.Release",
    target = final.workerProcessId,
    release = {
      target = final.workerProcessId,
      action = "Fleet.FinalAcked.Release",
      protocol = PROTOCOL,
      reference = final.confirmationId,
      ConfirmationId = final.confirmationId,
    },
  }, false
end

Authority.confirmAck = Authority.confirmDelivery

function Authority.reserve(state, request)
  if type(state) ~= "table" or type(request) ~= "table" then
    return nil, "state and request are required"
  end
  local required = {
    "reservationId", "ticket", "battleId", "assignmentId", "sequence",
    "workerId", "workerProcessId", "playerId", "monster", "issuedAt", "expiresAt",
  }
  for _, name in ipairs(required) do
    if request[name] == nil or request[name] == "" then return nil, name .. " is required" end
  end
  if type(request.workerProcessId) ~= "string" or #request.workerProcessId ~= 43 then
    return nil, "workerProcessId must be a 43-character process id"
  end
  local sequence = int(request.sequence, nil)
  if not sequence or sequence < 1 then return nil, "sequence must be a positive integer" end
  local issuedAt, expiresAt = int(request.issuedAt, nil), int(request.expiresAt, nil)
  if not issuedAt or not expiresAt or expiresAt < issuedAt then
    return nil, "reservation timestamps are invalid"
  end
  if expiresAt - issuedAt > math.max(60000, int(state.maxTicketTtl, 60 * 60 * 1000)) then
    return nil, "reservation lifetime exceeds authority limit"
  end
  advance(state, issuedAt)

  local existing = state.reservations[request.reservationId]
    or state.finalized[request.reservationId]
  if existing then
    if sameIdentity(existing, request) and existing.sequence == sequence then
      if not existing.compact and not sameLiveRequest(existing, request) then
        return nil, "conflicting retry for existing reservation"
      end
      return copy(existing), true
    end
    return nil, "reservationId already exists"
  end
  -- Exact existing-record retry is handled above. Every new reservation must
  -- consume exactly the next authority-owned integer: gaps cannot be used to
  -- skip an unknown/lost action and maxinteger is rejected before `+ 1` could
  -- overflow. The high-water survives compact tombstone expiry.
  local lastSequence = int(state.lastSequence, 0)
  if sequence == math.maxinteger or lastSequence >= math.maxinteger - 1 then
    return nil, "reservation sequence space is exhausted"
  end
  if sequence <= lastSequence then return nil, "sequence has already been consumed" end
  if sequence ~= lastSequence + 1 then return nil, "sequence must be exactly the next value" end
  if state.tickets[request.ticket] then return nil, "ticket already exists" end
  if state.battles[request.battleId] then return nil, "battleId already exists" end
  if state.assignments[request.assignmentId] then return nil, "assignmentId already exists" end
  if entryCount(state) >= math.max(1, int(state.maxEntries, 1000)) then
    return nil, "authority replay ledger is at capacity"
  end

  local reservation = copy(request)
  reservation.sequence = sequence
  reservation.issuedAt = issuedAt
  reservation.expiresAt = expiresAt
  reservation.protocol = PROTOCOL
  reservation.status = "reserved"
  state.lastSequence = sequence
  state.reservations[reservation.reservationId] = reservation
  state.tickets[reservation.ticket] = reservation.reservationId
  state.battles[reservation.battleId] = reservation.reservationId
  state.assignments[reservation.assignmentId] = reservation.reservationId
  return copy(reservation), false
end

reservationForNotice = function(state, payload, sourceWorkerProcessId, timestamp)
  advance(state, timestamp)
  if type(payload) ~= "table" or payload.protocol ~= PROTOCOL then
    return nil, "unsupported protocol"
  end
  local reservation = state.reservations[payload.reservationId]
    or state.finalized[payload.reservationId]
  if not reservation then return nil, "reservation not found" end
  if sourceWorkerProcessId ~= reservation.workerProcessId then return nil, "wrong worker process" end
  if payload.workerId ~= reservation.workerId
     or payload.battleId ~= reservation.battleId
     or payload.assignmentId ~= reservation.assignmentId
     or payload.ticket ~= reservation.ticket
     or payload.playerId ~= reservation.playerId then
    return nil, "worker notice does not match reservation"
  end
  return reservation
end

function Authority.markOpened(state, payload, sourceWorkerProcessId, timestamp)
  local reservation, why = reservationForNotice(state, payload, sourceWorkerProcessId, timestamp)
  if not reservation then return nil, why end
  if reservation.compact then return nil, "reservation is already final" end
  local openedId = payload.openedId
  if type(openedId) ~= "string" or openedId == "" then return nil, "openedId is required" end
  local already = state.openings[openedId]
  if already then
    if already ~= reservation.reservationId then return nil, "openedId belongs to another reservation" end
    return copy(reservation), true
  end
  if reservation.status == "cancel-pending" then return nil, "reservation cancellation is pending" end
  if reservation.status ~= "reserved" and reservation.status ~= "open" then
    return nil, "reservation cannot be opened from status " .. tostring(reservation.status)
  end
  local duplicate = reservation.status == "open"
  reservation.status = "open"
  reservation.openedId = openedId
  reservation.openedAt = timestamp
  state.openings[openedId] = reservation.reservationId
  return copy(reservation), duplicate
end

function Authority.rejectOpen(state, payload, sourceWorkerProcessId, timestamp)
  local reservation, why = reservationForNotice(state, payload, sourceWorkerProcessId, timestamp)
  if not reservation then return nil, why end
  local rejectionId = payload.rejectionId
  if type(rejectionId) ~= "string" or rejectionId == "" then return nil, "rejectionId is required" end
  local priorFinal = state.rejections[rejectionId]
  if priorFinal and priorFinal ~= reservation.reservationId then
    return nil, "rejectionId belongs to another reservation"
  end
  local reason = tostring(payload.reason or "worker-rejected")
  if reservation.compact then
    if reservation.kind ~= "rejection" or reservation.finalId ~= rejectionId then
      return nil, "reservation is already final"
    end
    if reservation.outcome.reason ~= reason then return nil, "conflicting duplicate rejection" end
    return copy(reservation.effect), true
  end
  if reservation.status == "open" or reservation.status == "settled" then
    return nil, "opened reservation cannot be rejected"
  end
  local effect = {
    rejectionId = rejectionId, reservationId = reservation.reservationId,
    battleId = reservation.battleId, playerId = reservation.playerId,
    reason = reason, refund = copy(reservation.reservedCost or {}),
  }
  compactFinal(state, reservation, "rejection", rejectionId, effect, timestamp, { reason = reason })
  return effect, false
end

function Authority.settle(state, payload, sourceWorkerProcessId, timestamp)
  local reservation, why = reservationForNotice(state, payload, sourceWorkerProcessId, timestamp)
  if not reservation then return nil, why end
  local settlementId = payload.settlementId
  if type(settlementId) ~= "string" or settlementId == "" then return nil, "settlementId is required" end
  local priorFinal = state.settlements[settlementId]
  if priorFinal and priorFinal ~= reservation.reservationId then
    return nil, "settlementId belongs to another reservation"
  end
  if payload.result ~= "win" and payload.result ~= "loss" then return nil, "invalid battle result" end
  local outcome = {
    result = payload.result, rounds = payload.rounds, timedOut = payload.timedOut == true,
    opponentEntryNo = math.tointeger(tonumber(payload.opponentEntryNo)),
  }
  if reservation.compact then
    if reservation.kind ~= "settlement" or reservation.finalId ~= settlementId then
      return nil, "reservation is already final"
    end
    if reservation.outcome.result ~= outcome.result
       or reservation.outcome.rounds ~= outcome.rounds
       or reservation.outcome.timedOut ~= outcome.timedOut
       or reservation.outcome.opponentEntryNo ~= outcome.opponentEntryNo then
      return nil, "conflicting duplicate settlement"
    end
    return copy(reservation.effect), true
  end
  local effect = {
    settlementId = settlementId, reservationId = reservation.reservationId,
    battleId = reservation.battleId, playerId = reservation.playerId,
    result = payload.result, rounds = payload.rounds, timedOut = payload.timedOut == true,
    opponentEntryNo = outcome.opponentEntryNo,
    rewardPlan = copy(reservation.rewardPlan or {}),
  }
  compactFinal(state, reservation, "settlement", settlementId, effect, timestamp, outcome)
  return effect, false
end

function Authority.requestCancel(state, reservationId, cancelId, reason, timestamp)
  advance(state, timestamp)
  local reservation = state.reservations[reservationId] or state.finalized[reservationId]
  if not reservation then return nil, "reservation not found" end
  if reservation.compact then return nil, "reservation is already final" end
  if type(cancelId) ~= "string" or cancelId == "" then return nil, "cancelId is required" end
  local priorFinal = state.cancellations[cancelId]
  if priorFinal and priorFinal ~= reservationId then
    return nil, "cancelId belongs to another reservation"
  end
  if reservation.status == "cancel-pending" then
    if reservation.cancelId ~= cancelId then return nil, "another cancellation is pending" end
    return copy(reservation), true
  end
  reservation.cancelWasOpened = reservation.status == "open"
    and type(reservation.openedId) == "string" and reservation.openedId ~= ""
  reservation.status = "cancel-pending"
  reservation.cancelId = cancelId
  reservation.cancelReason = tostring(reason or "operator")
  reservation.cancelRequestedAt = timestamp
  return copy(reservation), false
end

function Authority.finalizeCancel(state, payload, sourceWorkerProcessId, timestamp)
  local reservation, why = reservationForNotice(state, payload, sourceWorkerProcessId, timestamp)
  if not reservation then return nil, why end
  local cancelId = payload.cancelId
  local reason = tostring(payload.reason or "")
  if type(cancelId) ~= "string" or cancelId == "" then return nil, "cancelId is required" end
  local priorFinal = state.cancellations[cancelId]
  if priorFinal and priorFinal ~= reservation.reservationId then
    return nil, "cancelId belongs to another reservation"
  end
  if reservation.compact then
    if reservation.kind ~= "cancellation" or reservation.finalId ~= cancelId then
      return nil, "reservation is already final"
    end
    if reservation.outcome.reason ~= reason
       or reservation.outcome.openedId ~= payload.openedId then
      return nil, "conflicting duplicate cancellation"
    end
    return copy(reservation.effect), true
  end
  if cancelId ~= reservation.cancelId then return nil, "cancellation does not match reservation" end
  if reservation.status ~= "cancel-pending" then return nil, "cancellation was not requested" end
  if reason ~= reservation.cancelReason then
    return nil, "cancellation reason does not match reservation"
  end
  local expectedOpenedId = reservation.workerId .. "-opened-" .. reservation.assignmentId
  if payload.openedId ~= nil and payload.openedId ~= expectedOpenedId then
    return nil, "cancellation openedId does not match reservation"
  end
  local openedId = reservation.openedId or payload.openedId
  -- Opened proof, not the label attached to the cancellation, decides whether
  -- the reserved attempt was consumed. An operator expiry of an active fight
  -- is still a loss; otherwise a player could wait for the operator path to
  -- turn a live losing battle back into a refundable pre-open reservation.
  local forfeited = openedId == expectedOpenedId
  local effect = {
    cancelId = cancelId, reservationId = reservation.reservationId,
    battleId = reservation.battleId, playerId = reservation.playerId,
    reason = reason,
    disposition = forfeited and "forfeit" or "refund",
    forfeit = forfeited,
  }
  if forfeited then
    effect.openedId = openedId
    effect.result = "loss"
    effect.rewardPlan = copy(reservation.rewardPlan or {})
  else
    effect.refund = copy(reservation.reservedCost or {})
  end
  compactFinal(state, reservation, "cancellation", cancelId, effect, timestamp,
    { reason = reason, openedId = payload.openedId,
      disposition = effect.disposition, result = effect.result })
  return effect, false
end

function Authority.forceResolve(state, request, actor, configuredOwner, timestamp)
  if type(state) ~= "table" or type(request) ~= "table" then return nil, "state and request are required" end
  advance(state, timestamp)
  if not actor or not configuredOwner or actor ~= configuredOwner then return nil, "Not authorised" end
  local reservation = state.reservations[request.reservationId]
    or state.finalized[request.reservationId]
  if not reservation then return nil, "reservation not found" end
  if request.workerId ~= reservation.workerId
     or request.workerProcessId ~= reservation.workerProcessId
     or request.battleId ~= reservation.battleId
     or request.playerId ~= reservation.playerId then
    return nil, "force resolution does not match reservation"
  end
  if type(request.resolutionId) ~= "string" or request.resolutionId == ""
     or type(request.reason) ~= "string" or request.reason == ""
     or type(request.evidence) ~= "string" or request.evidence == "" then
    return nil, "resolutionId, reason and evidence are required"
  end
  local priorFinal = state.resolutions[request.resolutionId]
  if priorFinal and priorFinal ~= reservation.reservationId then
    return nil, "resolutionId belongs to another reservation"
  end
  if reservation.compact then
    if reservation.kind ~= "force" or reservation.finalId ~= request.resolutionId then
      return nil, "reservation is already final"
    end
    local prior = reservation.outcome
    if prior.actor ~= actor or prior.reason ~= request.reason or prior.evidence ~= request.evidence then
      return nil, "conflicting force resolution"
    end
    return copy(reservation.effect), true
  end
  local effect = {
    resolutionId = request.resolutionId, reservationId = reservation.reservationId,
    battleId = reservation.battleId, playerId = reservation.playerId,
    resolution = "refund", refund = copy(reservation.reservedCost or {}),
  }
  compactFinal(state, reservation, "force", request.resolutionId, effect, timestamp, {
    actor = actor, reason = request.reason, evidence = request.evidence,
  })
  appendAudit(state, {
    action = "Battle.Fleet.ForceResolve", resolutionId = request.resolutionId,
    reservationId = reservation.reservationId, workerId = reservation.workerId,
    workerProcessId = reservation.workerProcessId, actor = actor,
    reason = request.reason, evidence = request.evidence, timestamp = timestamp,
  })
  return effect, false
end

Authority.PROTOCOL = PROTOCOL
return Authority
