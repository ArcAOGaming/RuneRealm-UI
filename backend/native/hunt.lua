--- hunt.lua — RuneRealm's roaming, wild-battle and capture process.
---
--- The game process remains the authority for ownership and inventory. It
--- opens a run with a scheduler-attested Hunt.Open message containing a frozen
--- snapshot of the chosen companion. This process owns everything that should
--- not be trusted to the browser: which creature appears, its level, combat,
--- and the single capture roll. A terminal capture/release is sent back to the
--- game process through the outbox.
---
--- Bundle requirements:
---   C             constants.lua
---   Battle        battle.lua
---   encode        jsonenc.lua encoder
---   HuntConfig    { enabled, gameProcess, node }

local json = require(".json")

local PROTOCOL = "runerealm-hunt/1"
local SIGNATURE_ALGS = {
  ["rsa-pss-sha512"] = true,
  ["rsa-pss-sha256"] = true,
}
local CFG = HuntConfig or {}
local ENABLED = CFG.enabled == true
local GAME_PROCESS = type(CFG.gameProcess) == "string" and CFG.gameProcess or ""
local MAX_RETAINED = math.max(10, math.tointeger(tonumber(CFG.maxRetained)) or 250)

Battle.configure(C)

HuntState = HuntState or {
  runs = {}, byPlayer = {}, endedOrder = {}, highWaterTimestamp = 0,
}
local State = HuntState
State.runs = State.runs or {}
State.byPlayer = State.byPlayer or {}
State.endedOrder = State.endedOrder or {}
State.highWaterTimestamp = math.tointeger(tonumber(State.highWaterTimestamp)) or 0

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

local function signer(msg)
  local commitments = msg.commitments or msg.Commitments
  if type(commitments) == "table" then
    local found = nil
    for _, commitment in pairs(commitments) do
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        if found and found ~= commitment.committer then return nil end
        found = commitment.committer
      end
    end
    if found then return found end
    if next(commitments) ~= nil then return nil end
  end
  -- Only the in-process test harness reaches this unsigned fallback.
  return msg.Address or msg.From
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

local function sourceProcess(msg, base)
  local fromProcess = field(msg, "from-process")
  local commitments = msg.commitments or msg.Commitments
  if type(commitments) ~= "table" or next(commitments) == nil then
    return fromProcess -- test harness only
  end
  local scheduler = schedulerAddress(base)
  if fromProcess and scheduler and signer(msg) == scheduler then return fromProcess end
  return nil
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

local function hash(material)
  local seed = 104729
  for i = 1, #material do
    seed = (seed * 131 + string.byte(material, i)) % 2147483647
  end
  return math.tointeger(seed) or 1
end

local function seed(record, phase)
  Battle.seedDeterministic(hash(record.seedMaterial .. "/" .. phase))
end

local function cleanMonster(raw)
  if type(raw) ~= "table" then return nil, "monster must be an object" end
  local element = raw.elementType
  if type(element) ~= "string" or type(C.MOVE_POOLS[element]) ~= "table" then
    return nil, "monster.elementType is invalid"
  end
  local function stat(key, minimum, maximum)
    local value = int(raw[key], nil)
    if value == nil or value < minimum or value > maximum then return nil end
    return value
  end
  local monster = {
    id = type(raw.id) == "string" and raw.id or nil,
    entryNo = int(raw.entryNo, 0) > 0 and int(raw.entryNo, 0) or nil,
    name = type(raw.name) == "string" and string.sub(raw.name, 1, 80) or nil,
    image = type(raw.image) == "string" and raw.image or nil,
    sprite = type(raw.sprite) == "string" and raw.sprite or nil,
    faction = type(raw.faction) == "string" and raw.faction or nil,
    elementType = element,
    level = stat("level", 0, 10000),
    attack = stat("attack", 1, 100000),
    defense = stat("defense", 1, 100000),
    speed = stat("speed", 1, 100000),
    health = stat("health", 1, 100000),
    moves = {},
  }
  if not monster.name or monster.name == "" or not monster.level or not monster.attack
     or not monster.defense or not monster.speed or not monster.health then
    return nil, "monster fields are invalid"
  end
  local count = 0
  for name, stored in pairs(raw.moves or {}) do
    count = count + 1
    local uses = int(type(stored) == "table" and stored.count or nil, nil)
    if count > 8 or type(name) ~= "string" or not Battle.moveDef(name)
       or not uses or uses < 1 or uses > 1000 then
      return nil, "monster moves are invalid"
    end
    monster.moves[name] = { count = uses }
  end
  if count == 0 then return nil, "monster must have moves" end
  return monster
end

--- The game authority sends the effective catchable slice of the Monster Index
--- once when it opens a run. This Hunt worker owns random selection,
--- but it cannot invent or re-enable an entry the game did not authorize.
local function cleanMonsterIndex(raw)
  if type(raw) ~= "table" then return nil, "Hunt Monster Index is missing" end
  local pool, total, seen = {}, 0, {}
  for index, value in ipairs(raw) do
    local entryNo = type(value) == "table" and int(value.entryNo, 0) or 0
    local affinity = type(value) == "table" and value.affinity or nil
    local weight = type(value) == "table" and int(value.huntWeight, 0) or 0
    if entryNo < 1 or entryNo > 1000000 or seen[entryNo]
       or type(value.entryKey) ~= "string" or #value.entryKey < 1 or #value.entryKey > 96
       or string.find(value.entryKey, "[^%w_%-]", 1)
       or type(value.name) ~= "string" or #value.name < 1 or #value.name > 80
       or type(C.MOVE_POOLS[affinity]) ~= "table"
       or weight < 1 or weight > 100000 then
      return nil, "Hunt Monster Index entry " .. tostring(index) .. " is invalid"
    end
    for _, moveName in ipairs({ value.basicMove, value.advancedMove }) do
      if moveName ~= nil and (type(moveName) ~= "string" or not Battle.moveDef(moveName)) then
        return nil, "Hunt Monster Index move is invalid"
      end
    end
    seen[entryNo] = true
    total = total + weight
    if total > 10000000 then return nil, "Hunt Monster Index weight is too large" end
    pool[#pool + 1] = {
      entryNo = entryNo, entryKey = value.entryKey, name = value.name,
      affinity = affinity,
      starterFaction = type(value.starterFaction) == "string" and value.starterFaction or nil,
      basicMove = value.basicMove, advancedMove = value.advancedMove,
      huntWeight = weight,
    }
  end
  if #pool < 1 or #pool > 1000 then return nil, "Hunt Monster Index must contain 1-1000 entries" end
  return pool, total
end

local function reply(base, value, outbox)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  if outbox then base.results.outbox = outbox end
  return base
end

local function fail(base, message) return reply(base, { error = message }) end

local function monsterView(monster)
  if not monster then return nil end
  local view = Battle.clone(monster)
  view.moves = Battle.hydrateMoves(view.moves or {})
  return view
end

local function runView(record)
  local lastCapture = record.lastCapture and Battle.clone(record.lastCapture) or nil
  if lastCapture and lastCapture.monster then
    lastCapture.monster = monsterView(lastCapture.monster)
  end
  local view = {
    protocol = PROTOCOL,
    runId = record.runId,
    playerId = record.playerId,
    monsterId = record.monsterId,
    status = record.status,
    openedAt = record.openedAt,
    encounterCount = record.encounterCount,
    lastSearchAt = record.lastSearchAt,
    encounter = monsterView(record.encounter),
    battle = record.battle and Battle.view(record.battle) or nil,
    captureAvailable = record.captureAvailable == true,
    lastCapture = lastCapture,
    settlementStatus = record.settlement
      and (record.settlement.acknowledged and "acknowledged" or "pending") or nil,
  }
  return view
end

local function publish(base, record)
  local encoded = encode(runView(record))
  base["hunt-" .. record.playerId] = encoded
  base["hunt-run-" .. record.runId] = encoded
end

local function openedMessage(record)
  return {
    target = GAME_PROCESS,
    action = "Hunt.Opened",
    protocol = PROTOCOL,
    reference = record.runId .. "-opened",
    ["run-id"] = record.runId,
    ["player-id"] = record.playerId,
  }
end

local function seenEntryList(record)
  local entries = {}
  for rawEntryNo in pairs(record.seenEntries or {}) do
    local entryNo = int(rawEntryNo, 0)
    if entryNo > 0 then entries[#entries + 1] = entryNo end
  end
  table.sort(entries)
  return entries
end

local function releaseMessage(record, reason)
  return {
    target = GAME_PROCESS,
    action = "Hunt.Released",
    protocol = PROTOCOL,
    reference = record.runId .. "-released",
    ["run-id"] = record.runId,
    ["player-id"] = record.playerId,
    reason = reason or "left",
    data = encode({
      protocol = PROTOCOL, runId = record.runId, playerId = record.playerId,
      seenEntries = seenEntryList(record), reason = reason or "left",
    }),
  }
end

local function settlementMessage(record)
  local settlement = record.settlement
  return {
    target = GAME_PROCESS,
    action = "Hunt.Settle",
    protocol = PROTOCOL,
    reference = settlement.id,
    ["run-id"] = record.runId,
    ["player-id"] = record.playerId,
    ["settlement-id"] = settlement.id,
    data = encode(settlement.payload),
  }
end

local function requireGame(base, msg)
  if not ENABLED or GAME_PROCESS == "" then return nil, "Hunt process is not configured" end
  if sourceProcess(msg, base) ~= GAME_PROCESS then return nil, "Untrusted game process" end
  return true
end

local function playerRun(msg)
  local actor = signer(msg)
  if not actor then return nil, nil, "A player signature is required" end
  local runId = field(msg, "runid")
  local record = runId and State.runs[runId]
  if not record then return nil, actor, "Hunt not found" end
  if record.playerId ~= actor then return nil, actor, "This is not your hunt" end
  if field(msg, "ticket") ~= record.ticket then return nil, actor, "Hunt ticket does not match" end
  return record, actor
end

local function factionForElement(element)
  for _, faction in ipairs(C.FACTIONS) do
    if faction.element == element then return faction end
  end
  return nil
end

local function capturedMonster(wild, timestamp)
  local faction = factionForElement(wild.elementType)
  local art = ({ fire = "Fire", water = "Water", air = "Air", rock = "Earth" })[wild.elementType]
    or "Normal"
  return {
    entryNo = wild.entryNo,
    name = wild.name, image = wild.image, sprite = wild.sprite,
    holographic = true, background = art, border = art,
    faction = faction and faction.name or wild.faction,
    elementType = wild.elementType,
    berryItem = faction and faction.berry or nil,
    careMode = wild.elementType == "normal" and "any-berry" or "element-berry",
    attack = wild.attack, defense = wild.defense, speed = wild.speed, health = wild.health,
    energy = 50, happiness = 50, level = wild.level, exp = 0,
    nextLevelExp = C.requiredExp(wild.level),
    totalTimesFed = 0, totalTimesPlay = 0, totalTimesQuest = 0,
    moves = Battle.compactMoves(wild.moves),
    status = { type = "Home", since = timestamp, until_time = timestamp },
    bornAt = timestamp,
  }
end


local function chooseMonsterIndexEntry(record)
  local roll = Battle.rand(1, record.monsterIndexWeight)
  local cursor = 0
  for _, entry in ipairs(record.monsterIndex) do
    cursor = cursor + entry.huntWeight
    if roll <= cursor then return entry end
  end
  return record.monsterIndex[#record.monsterIndex]
end

local function makeWild(entry, level)
  local fallbackFaction = entry.starterFaction
  if not fallbackFaction then
    local faction = factionForElement(entry.affinity)
    fallbackFaction = faction and faction.name or C.FACTIONS[1].name
  end
  local wild = Battle.makeOpponent(level, { faction = fallbackFaction, difficulty = 1 })
  wild.entryNo = entry.entryNo
  wild.name = entry.name
  wild.elementType = entry.affinity
  wild.faction = entry.starterFaction or "Wild"
  wild.image = entry.entryKey
  wild.sprite = entry.entryKey
  wild.moves = Battle.rollMoves(entry.affinity)
  return wild
end

local function catchChance(hunterLevel, wildLevel, runes)
  -- Diminishing returns reward a serious bid without making a gigantic bid
  -- certainty. Equal-level examples: 1 rune 30%, 5 runes 60%, 10 runes 75%.
  local cfg = (C.HUNT and C.HUNT.capture) or {}
  local chance = (cfg.baseChance or 15)
    + math.floor(((cfg.runeScale or 120) * runes) / (runes + (cfg.runeHalf or 5)))
    + (hunterLevel - wildLevel) * (cfg.levelStep or 3)
  return math.max(cfg.minChance or 5, math.min(cfg.maxChance or 95, chance))
end

local Handlers = {}

Handlers["hunt.open"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local payload, parseError = parseData(msg)
  if not payload then return fail(base, parseError) end
  if payload.protocol ~= PROTOCOL then return fail(base, "Unsupported hunt protocol") end
  if not validId(payload.runId, 128) or not validId(payload.ticket, 192)
     or type(payload.playerId) ~= "string" or #payload.playerId ~= 43 then
    return fail(base, "Hunt identity is invalid")
  end
  local monster, monsterError = cleanMonster(payload.monster)
  if not monster then return fail(base, monsterError) end
  local monsterIndex, monsterIndexWeightOrError = cleanMonsterIndex(payload.monsterIndex)
  if not monsterIndex then return fail(base, monsterIndexWeightOrError) end
  local existing = State.runs[payload.runId]
  if existing then
    if existing.playerId ~= payload.playerId or existing.ticket ~= payload.ticket then
      return fail(base, "Run id already belongs to another hunt")
    end
    publish(base, existing)
    return reply(base, runView(existing), { opened = openedMessage(existing) })
  end
  local prior = State.byPlayer[payload.playerId]
  if prior and State.runs[prior]
     and State.runs[prior].status ~= "ended"
     and State.runs[prior].status ~= "lost" then
    return fail(base, "Player already has an open hunt")
  end
  local record = {
    runId = payload.runId, ticket = payload.ticket, playerId = payload.playerId,
    monsterId = payload.monsterId, monster = monster, status = "roaming",
    openedAt = timestamp, encounterCount = 0, lastSearchAt = 0,
    seedMaterial = payload.runId .. "/" .. payload.ticket,
    monsterIndex = monsterIndex, monsterIndexWeight = monsterIndexWeightOrError,
    seenEntries = {},
    actionReceipts = {},
  }
  State.runs[record.runId] = record
  State.byPlayer[record.playerId] = record.runId
  publish(base, record)
  return reply(base, runView(record), { opened = openedMessage(record) })
end

Handlers["hunt.search"] = function(base, msg, timestamp)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status ~= "roaming" then return fail(base, "Finish the current encounter first") end
  local actionId = field(msg, "actionid")
  if not validId(actionId, 192) then return fail(base, "ActionId is required") end
  local prior = record.actionReceipts[actionId]
  if prior then
    publish(base, record)
    local view = runView(record); view.duplicate = true
    return reply(base, view)
  end
  local cooldown = (C.HUNT and C.HUNT.searchCooldown) or 3000
  if timestamp - record.lastSearchAt < cooldown then return fail(base, "The trail is still quiet") end

  record.encounterCount = record.encounterCount + 1
  record.lastSearchAt = timestamp
  seed(record, "encounter:" .. string.format("%d", record.encounterCount))
  local levelRange = (C.HUNT and C.HUNT.levelRange) or 5
  local low = math.max(0, record.monster.level - levelRange)
  local high = record.monster.level + levelRange
  local wildLevel = Battle.rand(low, high)
  local wildEntry = chooseMonsterIndexEntry(record)
  local wild = makeWild(wildEntry, wildLevel)
  record.seenEntries[tostring(wildEntry.entryNo)] = true
  local encounterId = record.runId .. "-e" .. string.format("%d", record.encounterCount)
  record.encounter = capturedMonster(wild, timestamp)
  record.encounter.id = encounterId
  record.battle = Battle.new(
    encounterId, record.monster, record.playerId, wild, "wild",
    { kind = "hunt", timestamp = timestamp }
  )
  record.status = "battle"
  record.captureAvailable = false
  record.actionReceipts[actionId] = { kind = "search", encounterId = encounterId }
  publish(base, record)
  return reply(base, runView(record))
end

Handlers["hunt.attack"] = function(base, msg, timestamp)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status ~= "battle" or not record.battle then return fail(base, "No wild battle is active") end
  local actionId = field(msg, "actionid")
  if not validId(actionId, 192) then return fail(base, "ActionId is required") end
  local prior = record.actionReceipts[actionId]
  if prior then
    publish(base, record)
    local view = runView(record); view.duplicate = true
    return reply(base, view)
  end
  local claimedRound = int(field(msg, "round"), nil)
  if claimedRound == nil or claimedRound ~= record.battle.round then
    return fail(base, "That round already resolved")
  end
  local move, moveError = Battle.selectMove(record.battle.challenger, field(msg, "move"))
  if not move then return fail(base, moveError) end
  seed(record, "battle:" .. record.encounter.id .. ":round:" .. string.format("%d", claimedRound))
  local npcMove = Battle.chooseNpcMove(record.battle.accepter, record.battle.challenger)
  Battle.resolveRound(record.battle, move, npcMove)
  record.actionReceipts[actionId] = { kind = "attack", round = record.battle.round }

  local outbox
  if record.battle.status == "ended" then
    if record.battle.winner == "challenger" then
      record.status = "defeated"
      record.captureAvailable = true
    else
      record.status = "lost"
      record.captureAvailable = false
      State.endedOrder[#State.endedOrder + 1] = record.runId
      outbox = { released = releaseMessage(record, "defeated") }
    end
  end
  publish(base, record)
  return reply(base, runView(record), outbox)
end

Handlers["hunt.decline"] = function(base, msg)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status ~= "defeated" or not record.captureAvailable then
    return fail(base, "There is no defeated creature to leave")
  end
  record.status = "roaming"
  record.captureAvailable = false
  record.encounter = nil
  record.battle = nil
  publish(base, record)
  return reply(base, runView(record))
end

Handlers["hunt.capture"] = function(base, msg, timestamp)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status ~= "defeated" or not record.captureAvailable or not record.encounter then
    return fail(base, "Win the wild battle before attempting capture")
  end
  local actionId = field(msg, "actionid")
  local runes = int(field(msg, "runes"), nil)
  local capture = (C.HUNT and C.HUNT.capture) or {}
  local minBid, maxBid = capture.minRuneBid or 1, capture.maxRuneBid or 5
  if not validId(actionId, 192) or not runes or runes < minBid or runes > maxBid then
    return fail(base, "Capture needs an ActionId and a valid Rune bid")
  end
  if record.settlement then
    if record.settlement.actionId ~= actionId then return fail(base, "This encounter already had its one capture try") end
    publish(base, record)
    return reply(base, runView(record), record.settlement.acknowledged and nil
      or { settlement = settlementMessage(record) })
  end
  local chance = catchChance(record.monster.level, record.encounter.level, runes)
  -- The wallet supplies ActionId for idempotency, not entropy. Including it in
  -- the roll would let a modified client grind candidate ids offline and pick
  -- one that wins. Every action id and Rune bid for this encounter therefore
  -- resolves against the same single roll.
  seed(record, "capture:" .. record.encounter.id)
  local roll = Battle.rand(1, 100)
  local success = roll <= chance
  local settlementId = record.runId .. "-capture-" .. string.format("%d", record.encounterCount)
  local payload = {
    protocol = PROTOCOL, settlementId = settlementId,
    runId = record.runId, playerId = record.playerId,
    encounterId = record.encounter.id, actionId = actionId,
    success = success, chance = chance, roll = roll, runeBid = runes,
    seenEntries = seenEntryList(record),
    monster = success and record.encounter or nil,
  }
  record.settlement = {
    id = settlementId, actionId = actionId, payload = payload,
    acknowledged = false, createdAt = timestamp,
  }
  record.status = "settling"
  record.captureAvailable = false
  publish(base, record)
  return reply(base, runView(record), { settlement = settlementMessage(record) })
end

-- Re-deliver an already-fixed capture settlement after a failed recursive
-- push. This never calls the RNG and cannot alter the bid or the result.
Handlers["hunt.retrysettlement"] = function(base, msg)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status ~= "settling" or not record.settlement then
    return fail(base, "There is no capture settlement to retry")
  end
  publish(base, record)
  return reply(base, runView(record), { settlement = settlementMessage(record) })
end

Handlers["hunt.settled"] = function(base, msg, timestamp)
  local allowed, why = requireGame(base, msg)
  if not allowed then return fail(base, why) end
  local runId = field(msg, "runid")
  local settlementId = field(msg, "settlementid")
  local record = runId and State.runs[runId]
  if not record or not record.settlement or record.settlement.id ~= settlementId then
    return fail(base, "Capture settlement not found")
  end
  record.settlement.acknowledged = true
  local payload = record.settlement.payload
  record.lastCapture = {
    success = payload.success, chance = payload.chance, roll = payload.roll,
    runesSpent = payload.runeBid, encounterId = payload.encounterId,
    monster = payload.success and record.encounter or nil,
    settledAt = timestamp,
  }
  record.status = "roaming"
  record.encounter = nil
  record.battle = nil
  record.settlement = nil
  publish(base, record)
  return reply(base, runView(record))
end

Handlers["hunt.end"] = function(base, msg, timestamp)
  local record, _, why = playerRun(msg)
  if not record then return fail(base, why) end
  if record.status == "settling" then return fail(base, "Wait for the capture to settle") end
  if record.status == "ended" then
    publish(base, record)
    return reply(base, runView(record), { released = releaseMessage(record, "left") })
  end
  record.status = "ended"
  record.endedAt = timestamp
  record.captureAvailable = false
  State.endedOrder[#State.endedOrder + 1] = record.runId
  publish(base, record)
  return reply(base, runView(record), { released = releaseMessage(record, "left") })
end

local function prune(base)
  while #State.endedOrder > MAX_RETAINED do
    local runId = table.remove(State.endedOrder, 1)
    local record = State.runs[runId]
    if record and (record.status == "ended" or record.status == "lost") then
      State.runs[runId] = nil
      if State.byPlayer[record.playerId] == runId then State.byPlayer[record.playerId] = nil end
      base["hunt-run-" .. runId] = "null"
    end
  end
end

function compute(base, req, opts)
  local msg = messageOf(req)
  local action = string.lower(tostring(field(msg, "action") or "none"))
  local timestamp = int((req and (req.timestamp or req.Timestamp)) or field(msg, "timestamp"), 0)
  State.highWaterTimestamp = math.max(State.highWaterTimestamp, timestamp)
  local handler = Handlers[action]
  local result
  if not handler then
    result = fail(base, "unknown action '" .. action .. "'")
  else
    local ok, value = pcall(function() return handler(base, msg, timestamp) end)
    result = ok and value or fail(base, tostring(value))
  end
  prune(result)
  result.huntstatus = encode({
    protocol = PROTOCOL, enabled = ENABLED, gameProcess = GAME_PROCESS,
    active = (function()
      local n = 0
      for _, record in pairs(State.runs) do
        if record.status ~= "ended" and record.status ~= "lost" then n = n + 1 end
      end
      return n
    end)(),
  })
  result.action = field(msg, "action") or "none"
  collectgarbage("collect")
  return result
end
