--- RuneRealm Phase-1 bot-battle worker.
---
--- This process is intentionally NOT a game/account authority. The game
--- reserves the player's cost and sends one scheduler-attested Battle.Open.
--- The participant then signs Battle.Attack messages directly to this worker.
--- A finished fight emits one idempotent settlement back to the game.
---
--- Bundle requirements:
---   C                 constants.lua
---   Battle            battle.lua, configured with C
---   encode/jsonObject jsonenc.lua
---   BattleFleetConfig deployment configuration (optional; disabled by default)

local json = require(".json")

local PROTOCOL = "runerealm-battle-fleet/1"
local SIGNATURE_ALGS = {
  ["rsa-pss-sha512"] = true,
  ["rsa-pss-sha256"] = true,
}

local CFG = BattleFleetConfig or {}
local ENABLED = CFG.enabled == true
local GAME_PROCESS = type(CFG.gameProcess) == "string" and CFG.gameProcess or ""
local WORKER_ID = type(CFG.workerId) == "string" and CFG.workerId or "unconfigured"
local CAPACITY = math.max(1, math.tointeger(tonumber(CFG.capacity)) or 32)
local MAX_RETAINED = math.max(1, math.tointeger(tonumber(CFG.maxRetained)) or 100)
local MAX_PENDING = math.max(1, math.tointeger(tonumber(CFG.maxPending)) or MAX_RETAINED)
local MAX_TICKET_TTL = math.max(60000,
  math.tointeger(tonumber(CFG.maxTicketTtl)) or (60 * 60 * 1000))
local MAX_OUTCOMES = math.max(1,
  math.tointeger(tonumber(CFG.maxOutcomes)) or 10000)
local MAX_CONFIRMATIONS = math.max(1,
  math.tointeger(tonumber(CFG.maxConfirmations)) or MAX_OUTCOMES)

Battle.configure(C)

BattleFleetState = BattleFleetState or {
  battles = {},
  tickets = {},
  reservations = {},
  settlements = {},
  cancellations = {},
  openRejections = {},
  rejectionByAssignment = {},
  rejectedOrder = {},
  assignments = {},
  ackTombstones = {},
  ackOrder = {},
  outcomes = {},
  outcomeCount = 0,
  outcomeTickets = {},
  outcomeReservations = {},
  outcomeBattles = {},
  confirmations = {},
  confirmationById = {},
  confirmationCount = 0,
  highWaterTimestamp = 0,
  endedOrder = {},
  draining = false,
}
local State = BattleFleetState
State.cancellations = State.cancellations or {}
State.openRejections = State.openRejections or {}
State.rejectionByAssignment = State.rejectionByAssignment or {}
State.rejectedOrder = State.rejectedOrder or {}
State.assignments = State.assignments or {}
State.ackTombstones = State.ackTombstones or {}
State.ackOrder = State.ackOrder or {}
State.outcomes = State.outcomes or {}
State.outcomeTickets = State.outcomeTickets or {}
State.outcomeReservations = State.outcomeReservations or {}
State.outcomeBattles = State.outcomeBattles or {}
State.confirmations = State.confirmations or {}
State.confirmationById = State.confirmationById or {}
State.highWaterTimestamp = math.tointeger(tonumber(State.highWaterTimestamp)) or 0
if State.outcomeCount == nil then
  State.outcomeCount = 0
  for _ in pairs(State.outcomes) do State.outcomeCount = State.outcomeCount + 1 end
end
if State.confirmationCount == nil then
  State.confirmationCount = 0
  for _ in pairs(State.confirmations) do
    State.confirmationCount = State.confirmationCount + 1
  end
end

local Owner = nil

local function int(value, fallback)
  local narrowed = math.tointeger(tonumber(value))
  if narrowed == nil then return fallback end
  return narrowed
end

local function field(t, wanted)
  if type(t) ~= "table" then return nil end
  local exact = t[wanted]
  if exact ~= nil then return exact end
  local lower = string.lower(wanted)
  for k, v in pairs(t) do
    if type(k) == "string" and string.lower(k) == lower then return v end
  end
  return nil
end

local function messageOf(req)
  local raw = (req and req.body) or {}
  local msg = {}
  local tags = raw.Tags or raw.tags
  if type(tags) == "table" then
    for k, v in pairs(tags) do msg[k] = v end
  end
  for k, v in pairs(raw) do
    if k ~= "Tags" and k ~= "tags" then msg[k] = v end
  end
  return msg
end

--- Return only a real wallet/scheduler signature. An hmac commitment never
--- identifies anybody, even when its `committer` claims a privileged address.
local function signer(msg)
  local commitments = msg.commitments or msg.Commitments
  if type(commitments) ~= "table" then return nil end
  local found = nil
  for _, commitment in pairs(commitments) do
    if type(commitment) == "table" and commitment.committer
       and SIGNATURE_ALGS[commitment.type or commitment.alg] then
      if found and found ~= commitment.committer then return nil end
      found = commitment.committer
    end
  end
  return found
end

local function schedulerAddress(base)
  if type(base) ~= "table" then return nil end
  local found = base["scheduler-location"] or base.SchedulerLocation
    or base.scheduler_location
  if type(found) == "string" and #found == 43 then return found end
  local process = base.process or base.Process
  if type(process) == "table" then
    found = process["scheduler-location"] or process.SchedulerLocation
      or process.scheduler_location
    if type(found) == "string" and #found == 43 then return found end
  end
  return nil
end

--- Process-origin claims are accepted only when this worker's own scheduler
--- signed the delivered assignment. There is deliberately no unsigned test
--- fallback in this worker: opening a fight spends an account reservation.
local function sourceProcess(msg, base)
  local fromProcess = field(msg, "from-process")
  local scheduler = schedulerAddress(base)
  if fromProcess and scheduler and signer(msg) == scheduler then
    return fromProcess
  end
  return nil
end

local function resolveOwner(base)
  if Owner then return Owner end
  local process = type(base) == "table" and (base.process or base.Process) or nil
  local commitments = type(process) == "table"
    and (process.commitments or process.Commitments) or nil
  if type(commitments) == "table" then
    for _, commitment in pairs(commitments) do
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        Owner = commitment.committer
        return Owner
      end
    end
  end
  return nil
end

local function ownerSigned(base, msg)
  local owner = resolveOwner(base)
  local signed = signer(msg)
  return owner ~= nil and owner ~= "" and signed ~= nil and signed == owner
end

local function validId(value, maxLength)
  return type(value) == "string" and #value > 0 and #value <= maxLength
    and string.find(value, "[^%w_%-]", 1) == nil
end

local function parseData(msg)
  local raw = field(msg, "data") or field(msg, "body")
  if type(raw) ~= "string" or raw == "" then return {} end
  local ok, decoded = pcall(json.decode, raw)
  if not ok or type(decoded) ~= "table" then return nil, "Data must be a JSON object" end
  return decoded
end

local function seedFor(material)
  local seed = 104729
  for i = 1, #material do
    seed = (seed * 131 + string.byte(material, i)) % 2147483647
  end
  return math.tointeger(seed) or 1
end

local function seedRandom(record, phase)
  Battle.seedDeterministic(seedFor(record.seedMaterial .. "/" .. phase))
end

local function cleanMonster(raw)
  if type(raw) ~= "table" then return nil, "monster must be an object" end
  local name = raw.name
  local element = raw.elementType
  if type(name) ~= "string" or #name < 1 or #name > 80 then
    return nil, "monster.name is invalid"
  end
  if type(element) ~= "string" or type(C.MOVE_POOLS[element]) ~= "table" then
    return nil, "monster.elementType is invalid"
  end

  local function stat(key, minimum)
    local value = int(raw[key], nil)
    if value == nil or value < minimum or value > 100000 then return nil end
    return value
  end

  local level = stat("level", 0)
  local attack = stat("attack", 0)
  local defense = stat("defense", 0)
  local speed = stat("speed", 0)
  local health = stat("health", 1)
  if level == nil or attack == nil or defense == nil or speed == nil or health == nil then
    return nil, "monster stats must be bounded integers"
  end

  if type(raw.moves) ~= "table" then return nil, "monster.moves is invalid" end
  local moves, moveCount = {}, 0
  for moveName, stored in pairs(raw.moves) do
    moveCount = moveCount + 1
    if moveCount > 8 or type(moveName) ~= "string" or not Battle.moveDef(moveName) then
      return nil, "monster contains an unknown move"
    end
    local count = int(type(stored) == "table" and stored.count or nil, nil)
    if count == nil or count < 1 or count > 1000 then
      return nil, "monster move counts must be bounded integers"
    end
    moves[moveName] = { count = count }
  end
  if moveCount == 0 then return nil, "monster must have at least one move" end

  return {
    name = name,
    image = type(raw.image) == "string" and raw.image or nil,
    sprite = type(raw.sprite) == "string" and raw.sprite or nil,
    faction = type(raw.faction) == "string" and raw.faction or nil,
    elementType = element,
    level = level,
    attack = attack,
    defense = defense,
    speed = speed,
    health = health,
    moves = moves,
  }
end

local function normalizeOpen(payload)
  local issuedAt = int(payload.issuedAt, nil)
  local expiresAt = int(payload.expiresAt, nil)
  if issuedAt == nil or expiresAt == nil or expiresAt < issuedAt then
    return nil, "ticket timestamps are invalid"
  end
  if expiresAt - issuedAt > MAX_TICKET_TTL then
    return nil, "ticket lifetime exceeds worker limit"
  end
  local monster, monsterError = cleanMonster(payload.monster)
  if not monster then return nil, monsterError end
  local difficulty = tonumber(payload.difficulty or 1)
  if not difficulty or difficulty < 0.25 or difficulty > 4 then
    return nil, "difficulty is invalid"
  end
  return {
    issuedAt = issuedAt,
    expiresAt = expiresAt,
    monster = monster,
    difficulty = difficulty,
    fingerprint = encode({
      protocol = payload.protocol,
      battleId = payload.battleId,
      ticket = payload.ticket,
      reservationId = payload.reservationId,
      assignmentId = payload.assignmentId,
      playerId = payload.playerId,
      issuedAt = issuedAt,
      expiresAt = expiresAt,
      monster = monster,
      difficulty = difficulty,
      opponentFaction = payload.opponentFaction,
      rewardPlan = payload.rewardPlan,
    }),
  }
end

local function counts()
  local active, ended, pendingSettlements, pendingCancellations = 0, 0, 0, 0
  for _, record in pairs(State.battles) do
    if record.battle.status == "ended" or record.battle.status == "cancelled" then
      ended = ended + 1
      if record.settlement and not record.settlement.acknowledged then
        pendingSettlements = pendingSettlements + 1
      elseif record.cancellation and not record.cancellation.acknowledged then
        pendingCancellations = pendingCancellations + 1
      end
    else
      active = active + 1
    end
  end
  return active, ended, pendingSettlements, pendingCancellations
end

local function rejectionCounts()
  local retained, pending = 0, 0
  for _, rejection in pairs(State.openRejections) do
    retained = retained + 1
    if not rejection.acknowledged then pending = pending + 1 end
  end
  return retained, pending
end

local function statusView()
  local active, ended, pendingSettlements, pendingCancellations = counts()
  local retainedRejections, pendingOpenRejections = rejectionCounts()
  local pendingFinals = pendingSettlements + pendingCancellations
  local pendingDeliveries = pendingFinals + pendingOpenRejections
  local retainedOutcomes = State.outcomeCount
  local retainedConfirmations = State.confirmationCount
  local pendingConfirmations = 0
  for _, confirmation in pairs(State.confirmations) do
    if confirmation.released ~= true then pendingConfirmations = pendingConfirmations + 1 end
  end
  local available = math.max(0, CAPACITY - active)
  local lifecycle = "ready"
  if not ENABLED then lifecycle = "disabled"
  elseif GAME_PROCESS == "" then lifecycle = "unconfigured"
  elseif State.draining then lifecycle = "draining" end
  local accepting = ENABLED and not State.draining and available > 0
    and GAME_PROCESS ~= "" and pendingDeliveries < MAX_PENDING
    and retainedOutcomes < MAX_OUTCOMES
    and retainedConfirmations < MAX_CONFIRMATIONS
  local blockedReason
  if not ENABLED then blockedReason = "disabled"
  elseif GAME_PROCESS == "" then blockedReason = "unconfigured"
  elseif State.draining then blockedReason = "draining"
  elseif pendingDeliveries >= MAX_PENDING then blockedReason = "pending-delivery-backpressure"
  elseif retainedOutcomes >= MAX_OUTCOMES then blockedReason = "outcome-replay-backpressure"
  elseif retainedConfirmations >= MAX_CONFIRMATIONS then
    blockedReason = "confirmation-replay-backpressure"
  elseif available == 0 then blockedReason = "capacity" end
  return {
    protocol = PROTOCOL,
    runtime = "lua@5.3a",
    workerId = WORKER_ID,
    gameProcess = GAME_PROCESS,
    lifecycle = lifecycle,
    enabled = ENABLED,
    configured = GAME_PROCESS ~= "",
    draining = State.draining == true,
    accepting = accepting,
    active = active,
    retainedEnded = ended,
    retainedFinals = ended,
    pendingSettlements = pendingSettlements,
    pendingCancellations = pendingCancellations,
    pendingFinals = pendingFinals,
    retainedOpenRejections = retainedRejections,
    pendingOpenRejections = pendingOpenRejections,
    pendingDeliveries = pendingDeliveries,
    retainedOutcomes = retainedOutcomes,
    outcomeLimit = MAX_OUTCOMES,
    retainedConfirmations = retainedConfirmations,
    pendingConfirmations = pendingConfirmations,
    confirmationLimit = MAX_CONFIRMATIONS,
    maxTicketTtl = MAX_TICKET_TTL,
    pendingLimit = MAX_PENDING,
    retentionLimit = MAX_RETAINED,
    admissionBlockedReason = blockedReason,
    capacity = CAPACITY,
    availableSlots = available,
    assignmentWeight = accepting and available or 0,
    managerMode = "assign-only",
    managerProxiesRounds = false,
    directAction = "Battle.Attack",
  }
end

local function publishStatus(base)
  base.fleetstatus = encode(statusView())
end

local function reply(base, value, outbox)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  if outbox then base.results.outbox = outbox end
  publishStatus(base)
  return base
end

local function fail(base, message)
  return reply(base, { error = message })
end

local function recordView(record)
  local view = Battle.view(record.battle)
  view.protocol = PROTOCOL
  view.workerId = WORKER_ID
  view.settlementStatus = record.settlement
    and (record.settlement.acknowledged and "acknowledged" or "pending") or nil
  view.cancellationStatus = record.cancellation
    and (record.cancellation.acknowledged and "acknowledged" or "pending") or nil
  return view
end

local function publishBattle(base, record)
  base["battle-" .. record.battle.id] = encode(recordView(record))
end

local function rememberAck(id, kind)
  if State.ackTombstones[id] then return end
  State.ackTombstones[id] = { id = id, kind = kind }
  State.ackOrder[#State.ackOrder + 1] = id
  while #State.ackOrder > MAX_RETAINED do
    local old = table.remove(State.ackOrder, 1)
    State.ackTombstones[old] = nil
  end
end

local function removeRecord(base, battleId)
  local record = State.battles[battleId]
  if not record then return end
  State.tickets[record.ticket] = nil
  State.reservations[record.reservationId] = nil
  State.assignments[record.assignmentId] = nil
  if record.settlement then
    if record.settlement.acknowledged then rememberAck(record.settlement.id, "settlement") end
    State.settlements[record.settlement.id] = nil
  end
  if record.cancellation then
    if record.cancellation.acknowledged then rememberAck(record.cancellation.id, "cancellation") end
    State.cancellations[record.cancellation.id] = nil
  end
  State.battles[battleId] = nil
  base["battle-" .. battleId] = nil
end

local function pruneEnded(base)
  while #State.endedOrder > MAX_RETAINED do
    local removableIndex = nil
    for i, battleId in ipairs(State.endedOrder) do
      local record = State.battles[battleId]
      local acknowledged = record and (
        (record.settlement and record.settlement.acknowledged)
        or (record.cancellation and record.cancellation.acknowledged)
      )
      if acknowledged then removableIndex = i break end
    end
    -- Never discard undelivered final state. Pending-final backpressure bounds
    -- it while acknowledgements are unavailable.
    if not removableIndex then break end
    local battleId = table.remove(State.endedOrder, removableIndex)
    removeRecord(base, battleId)
  end
end

local function settlementMessage(record)
  local settlement = record.settlement
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.Settle",
    protocol = PROTOCOL,
    reference = settlement.id,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = record.battle.id,
    ["reservation-id"] = record.reservationId,
    ["assignment-id"] = record.assignmentId,
    ["player-id"] = record.playerId,
    result = settlement.result,
    rounds = string.format("%d", record.battle.round),
    data = encode(settlement.payload),
  }
end

local function cancellationMessage(record)
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.Cancelled",
    protocol = PROTOCOL,
    reference = record.cancellation.id,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = record.battle.id,
    ["reservation-id"] = record.reservationId,
    ["assignment-id"] = record.assignmentId,
    ["player-id"] = record.playerId,
    reason = record.cancellation.reason,
    data = encode(record.cancellation.payload),
  }
end

local function cancellationOutcomeMessage(outcome)
  local payload = {
    protocol = PROTOCOL,
    cancelId = outcome.cancelId or outcome.id,
    workerId = WORKER_ID,
    battleId = outcome.battleId,
    assignmentId = outcome.assignmentId,
    reservationId = outcome.reservationId,
    ticket = outcome.ticket,
    playerId = outcome.playerId,
    reason = outcome.reason,
  }
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.Cancelled",
    protocol = PROTOCOL,
    reference = payload.cancelId,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = outcome.battleId,
    ["reservation-id"] = outcome.reservationId,
    ["assignment-id"] = outcome.assignmentId,
    ["player-id"] = outcome.playerId,
    reason = outcome.reason,
    data = encode(payload),
  }
end

local function openedMessage(record)
  local payload = {
    protocol = PROTOCOL,
    openedId = WORKER_ID .. "-opened-" .. record.assignmentId,
    workerId = WORKER_ID,
    battleId = record.battle.id,
    assignmentId = record.assignmentId,
    reservationId = record.reservationId,
    ticket = record.ticket,
    playerId = record.playerId,
  }
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.Opened",
    protocol = PROTOCOL,
    reference = payload.openedId,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = record.battle.id,
    ["reservation-id"] = record.reservationId,
    ["assignment-id"] = record.assignmentId,
    ["player-id"] = record.playerId,
    data = encode(payload),
  }
end

local function rejectionMessage(rejection)
  local payload = rejection.payload or {
    protocol = PROTOCOL,
    rejectionId = rejection.id,
    workerId = WORKER_ID,
    battleId = rejection.battleId,
    assignmentId = rejection.assignmentId,
    reservationId = rejection.reservationId,
    ticket = rejection.ticket,
    playerId = rejection.playerId,
    reason = rejection.reason,
  }
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.OpenRejected",
    protocol = PROTOCOL,
    reference = rejection.id,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = payload.battleId,
    ["reservation-id"] = payload.reservationId,
    ["player-id"] = payload.playerId,
    reason = rejection.reason,
    data = encode(payload),
  }
end

local function confirmationKey(kind, finalId)
  return kind .. ":" .. finalId
end

local function confirmationMessage(confirmation)
  local payload = confirmation.payload
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.FinalAcked",
    protocol = PROTOCOL,
    reference = confirmation.id,
    kind = confirmation.kind,
    ["final-id"] = confirmation.finalId,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = payload.battleId,
    ["reservation-id"] = payload.reservationId,
    ["assignment-id"] = payload.assignmentId,
    ["player-id"] = payload.playerId,
    data = encode(payload),
  }
end

local function retainConfirmation(kind, finalId, identity, timestamp)
  local key = confirmationKey(kind, finalId)
  local existing = State.confirmations[key]
  if existing then return existing, true end
  if State.confirmationCount >= MAX_CONFIRMATIONS then
    return nil, "Worker cannot retain another final acknowledgement confirmation"
  end
  local confirmationId = WORKER_ID .. "-final-acked-" .. kind .. "-" .. finalId
  local payload = {
    protocol = PROTOCOL,
    confirmationId = confirmationId,
    kind = kind,
    finalId = finalId,
    workerId = WORKER_ID,
    battleId = identity.battleId,
    assignmentId = identity.assignmentId,
    reservationId = identity.reservationId,
    ticket = identity.ticket,
    playerId = identity.playerId,
  }
  local confirmation = {
    id = confirmationId,
    kind = kind,
    finalId = finalId,
    payload = payload,
    released = false,
    protectUntil = math.max(int(identity.expiresAt, 0), timestamp + MAX_TICKET_TTL),
  }
  State.confirmations[key] = confirmation
  State.confirmationById[confirmationId] = key
  State.confirmationCount = State.confirmationCount + 1
  return confirmation, false
end

local function pruneConfirmations(timestamp)
  for key, confirmation in pairs(State.confirmations) do
    if confirmation.released == true and timestamp > confirmation.protectUntil then
      State.confirmations[key] = nil
      if State.confirmationById[confirmation.id] == key then
        State.confirmationById[confirmation.id] = nil
      end
      State.confirmationCount = math.max(0, State.confirmationCount - 1)
    end
  end
end

local function openedOutcomeMessage(outcome)
  return {
    target = GAME_PROCESS,
    action = "Battle.Fleet.Opened",
    protocol = PROTOCOL,
    reference = outcome.openedId,
    ["worker-id"] = WORKER_ID,
    ["battle-id"] = outcome.battleId,
    ["reservation-id"] = outcome.reservationId,
    ["assignment-id"] = outcome.assignmentId,
    ["player-id"] = outcome.playerId,
    data = encode({
      protocol = PROTOCOL,
      openedId = outcome.openedId,
      workerId = WORKER_ID,
      battleId = outcome.battleId,
      assignmentId = outcome.assignmentId,
      reservationId = outcome.reservationId,
      ticket = outcome.ticket,
      playerId = outcome.playerId,
    }),
  }
end

local function rememberOutcome(outcome)
  -- This is deliberately not the battle/rejection object. It contains only
  -- the fixed identity and stable outcome needed to fail closed after the
  -- full view is pruned; monster, reward, combat and attack data stay out.
  local compact = {
    compact = true,
    kind = outcome.kind,
    id = outcome.id,
    cancelId = outcome.cancelId,
    openedId = outcome.openedId,
    assignmentId = outcome.assignmentId,
    ticket = outcome.ticket,
    reservationId = outcome.reservationId,
    battleId = outcome.battleId,
    playerId = outcome.playerId,
    reason = outcome.reason,
    expiresAt = outcome.expiresAt,
  }
  if State.outcomes[compact.assignmentId] ~= nil then return false end
  State.outcomeCount = State.outcomeCount + 1
  State.outcomes[compact.assignmentId] = compact
  local function protect(index, key)
    local prior = index[key]
    local priorExpiry = 0
    if type(prior) == "table" then
      priorExpiry = int(prior.protectUntil, 0)
    elseif type(prior) == "string" and State.outcomes[prior] then
      priorExpiry = int(State.outcomes[prior].expiresAt, 0)
    end
    index[key] = {
      assignmentId = type(prior) == "table" and prior.assignmentId
        or type(prior) == "string" and prior or compact.assignmentId,
      protectUntil = math.max(priorExpiry, int(compact.expiresAt, 0)),
    }
  end
  protect(State.outcomeTickets, compact.ticket)
  protect(State.outcomeReservations, compact.reservationId)
  protect(State.outcomeBattles, compact.battleId)
  return true
end

local function outcomeMatches(outcome, payload)
  return outcome.assignmentId == payload.assignmentId
    and outcome.ticket == payload.ticket
    and outcome.reservationId == payload.reservationId
    and outcome.battleId == payload.battleId
    and outcome.playerId == payload.playerId
end

local function pruneOutcomes(timestamp)
  for assignmentId, outcome in pairs(State.outcomes) do
    -- At/through expiresAt the compact outcome is mandatory. After it, a full
    -- retained battle/rejection has its own indexes and an unseen open is also
    -- expired, so the bounded admission ledger can release the slot safely.
    if timestamp > outcome.expiresAt then
      State.outcomes[assignmentId] = nil
      State.outcomeCount = math.max(0, State.outcomeCount - 1)
    end
  end
  local function pruneIndex(index)
    for key, retained in pairs(index) do
      local protectUntil
      if type(retained) == "table" then
        protectUntil = int(retained.protectUntil, 0)
      elseif type(retained) == "string" and State.outcomes[retained] then
        protectUntil = int(State.outcomes[retained].expiresAt, 0)
      else
        protectUntil = 0
      end
      if timestamp > protectUntil then index[key] = nil end
    end
  end
  pruneIndex(State.outcomeTickets)
  pruneIndex(State.outcomeReservations)
  pruneIndex(State.outcomeBattles)
end

local function pruneRejections()
  while #State.rejectedOrder > MAX_RETAINED do
    local index = nil
    for i, rejectionId in ipairs(State.rejectedOrder) do
      local rejection = State.openRejections[rejectionId]
      if rejection and rejection.acknowledged then index = i break end
    end
    if not index then break end
    local rejectionId = table.remove(State.rejectedOrder, index)
    local rejection = State.openRejections[rejectionId]
    if rejection and rejection.acknowledged then rememberAck(rejectionId, "open-rejection") end
    if rejection then State.rejectionByAssignment[rejection.assignmentId] = nil end
    State.openRejections[rejectionId] = nil
  end
end

local function rejectOpen(base, payload, fingerprint, reason)
  local assignmentId = payload.assignmentId
  if State.outcomes[assignmentId] then
    return fail(base, "assignmentId already has a retained outcome")
  end
  local priorId = State.rejectionByAssignment[assignmentId]
  local prior = priorId and State.openRejections[priorId]
  if prior then
    if prior.fingerprint ~= fingerprint then
      return fail(base, "assignmentId already has a different rejection")
    end
    return reply(base, { error = prior.reason, rejectionId = prior.id, duplicate = true }, {
      rejection = rejectionMessage(prior),
    })
  end
  local status = statusView()
  if status.pendingDeliveries >= MAX_PENDING then
    return fail(base, "Worker cannot retain another unacknowledged rejection")
  end
  if status.retainedOutcomes >= MAX_OUTCOMES then
    return fail(base, "Worker cannot retain another replay outcome")
  end
  if status.retainedConfirmations >= MAX_CONFIRMATIONS then
    return fail(base, "Worker cannot retain another final confirmation")
  end
  local rejectionId = WORKER_ID .. "-rejected-" .. assignmentId
  local rejection = {
    kind = "rejected",
    id = rejectionId,
    assignmentId = assignmentId,
    ticket = payload.ticket,
    reservationId = payload.reservationId,
    battleId = payload.battleId,
    playerId = payload.playerId,
    fingerprint = fingerprint,
    reason = reason,
    acknowledged = false,
    expiresAt = math.min(
      int(payload.expiresAt, State.highWaterTimestamp + MAX_TICKET_TTL),
      State.highWaterTimestamp + MAX_TICKET_TTL),
    payload = {
      protocol = PROTOCOL,
      rejectionId = rejectionId,
      workerId = WORKER_ID,
      battleId = payload.battleId,
      assignmentId = payload.assignmentId,
      reservationId = payload.reservationId,
      ticket = payload.ticket,
      playerId = payload.playerId,
      reason = reason,
    },
  }
  State.openRejections[rejectionId] = rejection
  State.rejectionByAssignment[assignmentId] = rejectionId
  State.rejectedOrder[#State.rejectedOrder + 1] = rejectionId
  rememberOutcome(rejection)
  pruneRejections()
  return reply(base, { error = reason, rejectionId = rejectionId, duplicate = false }, {
    rejection = rejectionMessage(rejection),
  })
end

local function finalize(record, timestamp)
  if record.settlement then return record.settlement end
  local won = record.battle.winner == "challenger"
  local settlementId = WORKER_ID .. "-" .. record.battle.id
  local payload = {
    protocol = PROTOCOL,
    settlementId = settlementId,
    workerId = WORKER_ID,
    battleId = record.battle.id,
    assignmentId = record.assignmentId,
    reservationId = record.reservationId,
    ticket = record.ticket,
    playerId = record.playerId,
    result = won and "win" or "loss",
    winner = record.battle.winner,
    rounds = record.battle.round,
    timedOut = record.battle.timedOut == true,
    startedAt = record.battle.startedAt,
    endedAt = timestamp,
    opponentEntryNo = record.battle.accepter and record.battle.accepter.entryNo or nil,
    rewardPlan = record.rewardPlan,
  }
  record.battle.endedAt = timestamp
  record.settlement = {
    id = settlementId,
    result = payload.result,
    payload = payload,
    emitted = true,
    acknowledged = false,
  }
  State.settlements[settlementId] = record.battle.id
  State.endedOrder[#State.endedOrder + 1] = record.battle.id
  return record.settlement
end

local function requireGame(base, msg)
  if sourceProcess(msg, base) ~= GAME_PROCESS then
    return nil, "Only the configured game process may perform this action"
  end
  return true
end

local Handlers = {}

Handlers["fleet.status"] = function(base)
  return reply(base, statusView())
end

Handlers["fleet.drain"] = function(base, msg)
  if not ownerSigned(base, msg) then return fail(base, "Not authorised") end
  local value = field(msg, "drain")
  if value == nil then value = true end
  State.draining = value == true or tostring(value):lower() == "true"
  return reply(base, statusView())
end

Handlers["battle.open"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local payload, parseError = parseData(msg)
  if not payload then return fail(base, parseError) end
  if payload.protocol ~= PROTOCOL then return fail(base, "Unsupported battle-fleet protocol") end

  local battleId = payload.battleId
  local ticket = payload.ticket
  local reservationId = payload.reservationId
  local assignmentId = payload.assignmentId
  local playerId = payload.playerId
  local recoveryCancelId = field(msg, "cancel-id") or field(msg, "cancelid")
  local recoveryCancelReason = field(msg, "cancel-reason") or field(msg, "cancelreason")
  if recoveryCancelId ~= nil or recoveryCancelReason ~= nil then
    if not validId(recoveryCancelId, 192)
       or type(recoveryCancelReason) ~= "string" or recoveryCancelReason == "" then
      return fail(base, "cancel-id and cancel-reason must form a valid recovery intent")
    end
  end
  if not validId(assignmentId, 192) then return fail(base, "assignmentId is invalid") end

  -- Assignment lookup is deliberately before every validation path capable of
  -- creating a rejection. A malformed retry can fail, but can never replace a
  -- successful/rejected outcome while the authority may still be recovering
  -- its lost Opened/OpenRejected notice.
  local outcome = State.outcomes[assignmentId]
  if outcome then
    if not outcomeMatches(outcome, payload) then
      return fail(base, "assignmentId already has a different retained outcome")
    end
    if outcome.kind == "opened" then
      local retained = State.battles[outcome.battleId]
      if retained then
        local normalized, normalizeError = normalizeOpen(payload)
        if not normalized then
          return fail(base, "Conflicting duplicate Battle.Open: " .. normalizeError)
        end
        if retained.openFingerprint ~= normalized.fingerprint then
          return fail(base, "assignmentId already belongs to a different open battle")
        end
        publishBattle(base, retained)
        local view = recordView(retained)
        view.duplicate = true
        return reply(base, view, { opened = openedMessage(retained) })
      end
      return reply(base, {
        error = "Battle was already opened and its full state has been pruned",
        openedId = outcome.openedId,
        duplicate = true,
      }, { opened = openedOutcomeMessage(outcome) })
    elseif outcome.kind == "cancelled" then
      local retained = State.battles[outcome.battleId]
      local notice = retained and retained.cancellation
        and cancellationMessage(retained) or cancellationOutcomeMessage(outcome)
      return reply(base, {
        battleId = outcome.battleId,
        cancelId = outcome.cancelId or outcome.id,
        cancelled = true,
        duplicate = true,
      }, { cancellation = notice })
    end
    local retainedRejectionId = State.rejectionByAssignment[assignmentId]
    local retainedRejection = retainedRejectionId
      and State.openRejections[retainedRejectionId] or outcome
    return reply(base, {
      error = retainedRejection.reason,
      rejectionId = retainedRejection.id,
      duplicate = true,
    }, { rejection = rejectionMessage(retainedRejection) })
  end

  local rejectedId = State.rejectionByAssignment[assignmentId]
  local rejected = rejectedId and State.openRejections[rejectedId]
  if rejected then
    if not outcomeMatches(rejected, payload) then
      return fail(base, "assignmentId already has a different rejection")
    end
    return reply(base, { error = rejected.reason, rejectionId = rejected.id, duplicate = true }, {
      rejection = rejectionMessage(rejected),
    })
  end

  local assignedBattleId = State.assignments[assignmentId]
  local assigned = assignedBattleId and State.battles[assignedBattleId]
  if assigned then
    if assigned.battle.id ~= battleId or assigned.ticket ~= ticket
       or assigned.reservationId ~= reservationId or assigned.playerId ~= playerId then
      return fail(base, "assignmentId already belongs to a different open battle")
    end
    if assigned.preOpenCancelled and assigned.cancellation then
      publishBattle(base, assigned)
      return reply(base, {
        battleId = assigned.battle.id,
        cancelId = assigned.cancellation.id,
        cancelled = true,
        duplicate = true,
      }, { cancellation = cancellationMessage(assigned) })
    end
    local normalized, normalizeError = normalizeOpen(payload)
    if not normalized then
      return fail(base, "Conflicting duplicate Battle.Open: " .. normalizeError)
    end
    if assigned.openFingerprint ~= normalized.fingerprint then
      return fail(base, "assignmentId already belongs to a different open battle")
    end
    publishBattle(base, assigned)
    local view = recordView(assigned)
    view.duplicate = true
    return reply(base, view, { opened = openedMessage(assigned) })
  end

  if not validId(battleId, 96) then return fail(base, "battleId is invalid") end
  if not validId(ticket, 192) then return fail(base, "ticket is invalid") end
  if not validId(reservationId, 192) then return fail(base, "reservationId is invalid") end
  if type(playerId) ~= "string" or #playerId ~= 43 then return fail(base, "playerId is invalid") end
  local rawFingerprint = encode(payload)
  local normalized, normalizeError = normalizeOpen(payload)
  if not normalized then return rejectOpen(base, payload, rawFingerprint, normalizeError) end
  local issuedAt = normalized.issuedAt
  local expiresAt = normalized.expiresAt
  local monster = normalized.monster
  local difficulty = normalized.difficulty
  local fingerprint = normalized.fingerprint

  local existing = State.battles[battleId]
  if existing then
    if existing.openFingerprint ~= fingerprint then
      -- This id is already a successful open. Do not create a rejection
      -- tombstone for an assignment that the authority may already mark open.
      return fail(base, "battleId already belongs to a different reservation")
    end
    if existing.preOpenCancelled and existing.cancellation then
      publishBattle(base, existing)
      return reply(base, {
        battleId = existing.battle.id,
        cancelId = existing.cancellation.id,
        cancelled = true,
        duplicate = true,
      }, { cancellation = cancellationMessage(existing) })
    end
    publishBattle(base, existing)
    local view = recordView(existing)
    view.duplicate = true
    return reply(base, view, { opened = openedMessage(existing) })
  end
  -- An exact retained open remains idempotent after its original deadline;
  -- expiry only prevents a previously unseen reservation from starting late.
  if expiresAt < timestamp then return rejectOpen(base, payload, fingerprint, "ticket has expired") end
  if State.tickets[ticket] then
    return rejectOpen(base, payload, fingerprint, "ticket has already been used")
  end
  if State.outcomeTickets[ticket] then
    return rejectOpen(base, payload, fingerprint, "ticket has a retained outcome")
  end
  if State.reservations[reservationId] then
    return rejectOpen(base, payload, fingerprint, "reservation has already been assigned")
  end
  if State.outcomeReservations[reservationId] then
    return rejectOpen(base, payload, fingerprint, "reservation has a retained outcome")
  end
  if State.outcomeBattles[battleId] then
    return rejectOpen(base, payload, fingerprint, "battleId has a retained outcome")
  end
  if recoveryCancelId and State.cancellations[recoveryCancelId] then
    return fail(base, "cancel-id already belongs to another battle")
  end
  if not ENABLED then return rejectOpen(base, payload, fingerprint, "Battle fleet is disabled") end
  local status = statusView()
  if State.draining then return rejectOpen(base, payload, fingerprint, "Worker is draining") end
  if status.active >= CAPACITY then
    return rejectOpen(base, payload, fingerprint, "Worker is at capacity")
  end
  if status.pendingDeliveries >= MAX_PENDING then
    return rejectOpen(base, payload, fingerprint, "Worker is waiting for delivery acknowledgements")
  end
  if status.retainedOutcomes >= MAX_OUTCOMES then
    return rejectOpen(base, payload, fingerprint, "Worker replay ledger is at capacity")
  end
  if status.retainedConfirmations >= MAX_CONFIRMATIONS then
    return rejectOpen(base, payload, fingerprint, "Worker confirmation ledger is at capacity")
  end

  local record = {
    ticket = ticket,
    reservationId = reservationId,
    assignmentId = assignmentId,
    playerId = playerId,
    rewardPlan = type(payload.rewardPlan) == "table" and payload.rewardPlan or {},
    expiresAt = expiresAt,
    seedMaterial = ticket .. "/" .. assignmentId,
    openFingerprint = fingerprint,
    attacks = {},
  }
  seedRandom(record, "open")
  local opponent = Battle.makeOpponent(monster.level, {
    difficulty = difficulty,
    faction = type(payload.opponentFaction) == "string" and payload.opponentFaction or nil,
  })
  record.battle = Battle.new(battleId, monster, playerId, opponent, "npc", {
    kind = "bot",
    timestamp = timestamp,
  })
  State.battles[battleId] = record
  State.tickets[ticket] = battleId
  State.reservations[reservationId] = battleId
  State.assignments[assignmentId] = battleId
  if recoveryCancelId then
    -- The authority was already cancel-pending before this worker ever saw the
    -- immutable Open. Materialize a terminal record for the ordinary ACK /
    -- confirmation retention machinery, but never emit Opened and never expose
    -- an attackable battle. With no openedId the authority can prove this is a
    -- refundable pre-open cancellation. Replays return this same outcome.
    local cancellationPayload = {
      protocol = PROTOCOL,
      cancelId = recoveryCancelId,
      workerId = WORKER_ID,
      battleId = battleId,
      assignmentId = assignmentId,
      reservationId = reservationId,
      ticket = ticket,
      playerId = playerId,
      reason = recoveryCancelReason,
      cancelledAt = timestamp,
    }
    record.battle.status = "cancelled"
    record.battle.cancelledAt = timestamp
    record.preOpenCancelled = true
    record.cancellation = {
      id = recoveryCancelId,
      reason = recoveryCancelReason,
      fingerprint = encode({
        battleId = battleId, reservationId = reservationId, ticket = ticket,
        cancelId = recoveryCancelId, reason = recoveryCancelReason,
        preOpen = true,
      }),
      payload = cancellationPayload,
      acknowledged = false,
    }
    State.cancellations[recoveryCancelId] = battleId
    State.endedOrder[#State.endedOrder + 1] = battleId
    rememberOutcome({
      kind = "cancelled",
      id = recoveryCancelId,
      cancelId = recoveryCancelId,
      reason = recoveryCancelReason,
      assignmentId = assignmentId,
      ticket = ticket,
      reservationId = reservationId,
      battleId = battleId,
      playerId = playerId,
      fingerprint = fingerprint,
      expiresAt = expiresAt,
    })
    publishBattle(base, record)
    pruneEnded(base)
    return reply(base, {
      battleId = battleId,
      cancelId = recoveryCancelId,
      cancelled = true,
      duplicate = false,
      preOpen = true,
    }, { cancellation = cancellationMessage(record) })
  end
  rememberOutcome({
    kind = "opened",
    openedId = WORKER_ID .. "-opened-" .. assignmentId,
    assignmentId = assignmentId,
    ticket = ticket,
    reservationId = reservationId,
    battleId = battleId,
    playerId = playerId,
    fingerprint = fingerprint,
    expiresAt = expiresAt,
  })
  publishBattle(base, record)
  return reply(base, recordView(record), { opened = openedMessage(record) })
end

Handlers["battle.attack"] = function(base, msg, timestamp)
  local actor = signer(msg)
  if not actor then return fail(base, "A participant signature is required") end
  local battleId = field(msg, "battleid")
  local ticket = field(msg, "ticket")
  local actionId = field(msg, "actionid")
  local moveName = field(msg, "move")
  local claimedRound = int(field(msg, "round"), nil)
  if not validId(battleId, 96) then return fail(base, "battleId is invalid") end
  if not validId(actionId, 192) then return fail(base, "actionId is invalid") end
  local record = State.battles[battleId]
  if not record then return fail(base, "Battle not found") end
  if actor ~= record.playerId then return fail(base, "You are not in this battle") end
  if ticket ~= record.ticket then return fail(base, "Ticket does not match this battle") end

  local attackFingerprint = encode({
    actor = actor, battleId = battleId, ticket = ticket,
    actionId = actionId, round = claimedRound, move = moveName,
  })
  local prior = record.attacks[actionId]
  if prior then
    if prior.fingerprint ~= attackFingerprint then
      return fail(base, "actionId already belongs to a different attack")
    end
    publishBattle(base, record)
    local replay = recordView(record)
    replay.duplicate = true
    replay.actionId = actionId
    replay.acceptedRound = prior.acceptedRound
    replay.resultingRound = prior.resultingRound
    return reply(base, replay)
  end

  if record.battle.status == "ended" then return fail(base, "That battle is over") end
  if record.battle.status ~= "battling" then return fail(base, "That battle is not active") end
  if claimedRound == nil then return fail(base, "Round is required") end
  if claimedRound ~= record.battle.round then
    return fail(base, "That round has already resolved; current round is "
      .. string.format("%d", record.battle.round))
  end

  local playerMove, moveError = Battle.selectMove(record.battle.challenger, moveName)
  if not playerMove then return fail(base, moveError) end
  seedRandom(record, "round:" .. string.format("%d", claimedRound))
  local npcMove = Battle.chooseNpcMove(record.battle.accepter, record.battle.challenger)
  Battle.resolveRound(record.battle, playerMove, npcMove)

  local outbox
  if record.battle.status == "ended" then
    finalize(record, timestamp)
    outbox = { settlement = settlementMessage(record) }
  end
  local output = recordView(record)
  -- Constant-size receipt: storing the full growing battle view once per round
  -- made persistent replay state quadratic in the battle length.
  record.attacks[actionId] = {
    fingerprint = attackFingerprint,
    acceptedRound = claimedRound,
    resultingRound = record.battle.round,
    terminal = record.battle.status == "ended",
    settlementId = record.settlement and record.settlement.id or nil,
  }
  publishBattle(base, record)
  pruneEnded(base)
  return reply(base, output, outbox)
end

--- Cancellation is a two-process terminal decision. The game authority first
--- marks its reservation cancel-pending and sends this attested action. The
--- worker serially chooses either completion or cancellation, then emits a
--- stable acknowledgement which lets the authority refund exactly once.
local function cancelBattle(base, msg, timestamp, expiryOnly)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local battleId = field(msg, "battleid")
  local reservationId = field(msg, "reservationid")
  local ticket = field(msg, "ticket")
  local cancelId = field(msg, "cancelid")
  local reason = tostring(field(msg, "reason") or (expiryOnly and "expired" or "authority"))
  if not validId(battleId, 96) or not validId(cancelId, 192) then
    return fail(base, "battleId and cancelId are required")
  end
  local record = State.battles[battleId]
  if not record then return fail(base, "Battle not found") end
  if reservationId ~= record.reservationId or ticket ~= record.ticket then
    return fail(base, "Cancellation does not match reservation")
  end

  local fingerprint = encode({
    battleId = battleId,
    reservationId = reservationId,
    ticket = ticket,
    cancelId = cancelId,
    reason = reason,
    expiryOnly = expiryOnly == true,
  })
  if record.cancellation then
    if record.cancellation.fingerprint ~= fingerprint then
      return fail(base, "Battle already has a different cancellation")
    end
    publishBattle(base, record)
    local outbox = not record.cancellation.acknowledged
      and { cancellation = cancellationMessage(record) } or nil
    return reply(base, {
      battleId = battleId,
      cancelId = cancelId,
      cancelled = true,
      duplicate = true,
    }, outbox)
  end
  if record.battle.status == "ended" then return fail(base, "Battle already settled") end
  if record.battle.status ~= "battling" then return fail(base, "Battle is not active") end
  if expiryOnly and timestamp < record.expiresAt then
    return fail(base, "Battle reservation has not expired")
  end

  local payload = {
    protocol = PROTOCOL,
    cancelId = cancelId,
    openedId = WORKER_ID .. "-opened-" .. record.assignmentId,
    workerId = WORKER_ID,
    battleId = battleId,
    assignmentId = record.assignmentId,
    reservationId = record.reservationId,
    ticket = record.ticket,
    playerId = record.playerId,
    reason = reason,
    cancelledAt = timestamp,
  }
  record.battle.status = "cancelled"
  record.battle.cancelledAt = timestamp
  record.cancellation = {
    id = cancelId,
    reason = reason,
    fingerprint = fingerprint,
    payload = payload,
    acknowledged = false,
  }
  State.cancellations[cancelId] = battleId
  State.endedOrder[#State.endedOrder + 1] = battleId
  publishBattle(base, record)
  pruneEnded(base)
  return reply(base, {
    battleId = battleId,
    cancelId = cancelId,
    cancelled = true,
    duplicate = false,
  }, { cancellation = cancellationMessage(record) })
end

Handlers["battle.cancel"] = function(base, msg, timestamp)
  return cancelBattle(base, msg, timestamp, false)
end

Handlers["battle.expire"] = function(base, msg, timestamp)
  return cancelBattle(base, msg, timestamp, true)
end

Handlers["battle.info"] = function(base, msg)
  local battleId = field(msg, "battleid")
  local record = battleId and State.battles[battleId]
  if not record then return fail(base, "Battle not found") end
  publishBattle(base, record)
  return reply(base, recordView(record))
end

Handlers["fleet.settlement.ack"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local settlementId = field(msg, "settlementid") or field(msg, "reference")
  local prior = settlementId
    and State.confirmations[confirmationKey("settlement", settlementId)]
  if prior then
    return reply(base, {
      settlementId = settlementId, acknowledged = true, duplicate = true,
      confirmationId = prior.id,
    }, { confirmation = confirmationMessage(prior) })
  end
  local battleId = settlementId and State.settlements[settlementId]
  local record = battleId and State.battles[battleId]
  if not record or not record.settlement then
    return fail(base, "Settlement not found")
  end
  local confirmation, confirmationError = retainConfirmation("settlement", settlementId, {
    battleId = record.battle.id, assignmentId = record.assignmentId,
    reservationId = record.reservationId, ticket = record.ticket,
    playerId = record.playerId, expiresAt = record.expiresAt,
  }, timestamp)
  if not confirmation then return fail(base, confirmationError) end
  record.settlement.acknowledged = true
  publishBattle(base, record)
  pruneEnded(base)
  return reply(base, {
    settlementId = settlementId,
    acknowledged = true,
    duplicate = false,
    confirmationId = confirmation.id,
  }, { confirmation = confirmationMessage(confirmation) })
end

Handlers["fleet.cancellation.ack"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local cancelId = field(msg, "cancelid") or field(msg, "reference")
  local prior = cancelId
    and State.confirmations[confirmationKey("cancellation", cancelId)]
  if prior then
    return reply(base, {
      cancelId = cancelId, acknowledged = true, duplicate = true,
      confirmationId = prior.id,
    }, { confirmation = confirmationMessage(prior) })
  end
  local battleId = cancelId and State.cancellations[cancelId]
  local record = battleId and State.battles[battleId]
  if not record or not record.cancellation then
    return fail(base, "Cancellation not found")
  end
  local confirmation, confirmationError = retainConfirmation("cancellation", cancelId, {
    battleId = record.battle.id, assignmentId = record.assignmentId,
    reservationId = record.reservationId, ticket = record.ticket,
    playerId = record.playerId, expiresAt = record.expiresAt,
  }, timestamp)
  if not confirmation then return fail(base, confirmationError) end
  record.cancellation.acknowledged = true
  publishBattle(base, record)
  pruneEnded(base)
  return reply(base, {
    cancelId = cancelId,
    acknowledged = true,
    duplicate = false,
    confirmationId = confirmation.id,
  }, { confirmation = confirmationMessage(confirmation) })
end

Handlers["fleet.openrejected.ack"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local rejectionId = field(msg, "rejectionid") or field(msg, "reference")
  local prior = rejectionId
    and State.confirmations[confirmationKey("rejection", rejectionId)]
  if prior then
    return reply(base, {
      rejectionId = rejectionId, acknowledged = true, duplicate = true,
      confirmationId = prior.id,
    }, { confirmation = confirmationMessage(prior) })
  end
  local rejection = rejectionId and State.openRejections[rejectionId]
  if not rejection then
    return fail(base, "Open rejection not found")
  end
  local confirmation, confirmationError = retainConfirmation("rejection", rejectionId, {
    battleId = rejection.battleId, assignmentId = rejection.assignmentId,
    reservationId = rejection.reservationId, ticket = rejection.ticket,
    playerId = rejection.playerId, expiresAt = rejection.expiresAt,
  }, timestamp)
  if not confirmation then return fail(base, confirmationError) end
  rejection.acknowledged = true
  pruneRejections()
  return reply(base, {
    rejectionId = rejectionId,
    acknowledged = true,
    duplicate = false,
    confirmationId = confirmation.id,
  }, { confirmation = confirmationMessage(confirmation) })
end

Handlers["fleet.finalacked.retry"] = function(base, msg)
  if not ownerSigned(base, msg) then return fail(base, "Not authorised") end
  local confirmationId = field(msg, "confirmationid") or field(msg, "reference")
  local key = confirmationId and State.confirmationById[confirmationId]
  local confirmation = key and State.confirmations[key]
  if not confirmation then return fail(base, "Final acknowledgement confirmation not found") end
  return reply(base, {
    confirmationId = confirmationId, retried = true,
  }, { confirmation = confirmationMessage(confirmation) })
end

Handlers["fleet.finalacked.release"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local confirmationId = field(msg, "confirmationid") or field(msg, "reference")
  local key = confirmationId and State.confirmationById[confirmationId]
  local confirmation = key and State.confirmations[key]
  if not confirmation then return fail(base, "Final acknowledgement confirmation not found") end
  local duplicate = confirmation.released == true
  confirmation.released = true
  confirmation.releasedAt = timestamp
  pruneConfirmations(timestamp)
  return reply(base, {
    confirmationId = confirmationId, released = true, duplicate = duplicate,
  })
end

--- Operator recovery for the unlikely case where a delivery needs to be
--- replayed. It emits the exact same reference and payload; the game authority
--- must deduplicate by settlementId before applying rewards.
Handlers["fleet.settlement.retry"] = function(base, msg)
  if not ownerSigned(base, msg) then return fail(base, "Not authorised") end
  local settlementId = field(msg, "settlementid") or field(msg, "reference")
  local battleId = settlementId and State.settlements[settlementId]
  local record = battleId and State.battles[battleId]
  if not record or not record.settlement then return fail(base, "Settlement not found") end
  return reply(base, {
    settlementId = settlementId,
    retried = true,
  }, { settlement = settlementMessage(record) })
end

Handlers["fleet.cancellation.retry"] = function(base, msg)
  if not ownerSigned(base, msg) then return fail(base, "Not authorised") end
  local cancelId = field(msg, "cancelid") or field(msg, "reference")
  local battleId = cancelId and State.cancellations[cancelId]
  local record = battleId and State.battles[battleId]
  if not record or not record.cancellation then return fail(base, "Cancellation not found") end
  return reply(base, {
    cancelId = cancelId,
    retried = true,
  }, { cancellation = cancellationMessage(record) })
end

Handlers["fleet.openrejected.retry"] = function(base, msg)
  if not ownerSigned(base, msg) then return fail(base, "Not authorised") end
  local rejectionId = field(msg, "rejectionid") or field(msg, "reference")
  local rejection = rejectionId and State.openRejections[rejectionId]
  if not rejection then return fail(base, "Open rejection not found") end
  return reply(base, {
    rejectionId = rejectionId,
    retried = true,
  }, { rejection = rejectionMessage(rejection) })
end

function compute(base, req, opts)
  base = type(base) == "table" and base or {}
  resolveOwner(base)
  local msg = messageOf(req)
  local action = tostring(field(msg, "action") or "Fleet.Status"):lower()
  local timestamp = int(req and (req.timestamp or req.Timestamp), 0)
  State.highWaterTimestamp = math.max(State.highWaterTimestamp, timestamp)
  timestamp = State.highWaterTimestamp
  pruneConfirmations(timestamp)
  pruneOutcomes(timestamp)
  local handler = Handlers[action]
  local result
  if not handler then
    result = fail(base, "Unknown action '" .. action .. "'")
  else
    local ok, handled = pcall(handler, base, msg, timestamp)
    result = ok and handled or fail(base, tostring(handled))
  end
  -- This process replaces aos compute, so collect transient battle views and
  -- encoder buffers before HyperBEAM snapshots the Luerl VM for this slot.
  collectgarbage("collect")
  return result
end
