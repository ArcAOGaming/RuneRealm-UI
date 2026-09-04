--- TEST-HyperDB: a deliberately small, database-shaped HyperBEAM process.
---
--- The point of this contract is not Lua. It is the process shape:
---   * one ordered writer per shard;
---   * many independent shards for parallelism;
---   * hundreds of row mutations per scheduled message;
---   * rows stored as strings, not a forest of little Lua tables;
---   * constant-size published state and bounded idempotency memory.
---
--- Batch wire format (one operation per line, fields separated by TAB):
---   P<TAB>key<TAB>value                       unconditional put
---   I<TAB>key<TAB>signed-integer              atomic increment
---   C<TAB>key<TAB>expected-version<TAB>value  compare-and-set
---   D<TAB>key<TAB>expected-version-or-*       compare-and-delete
---
--- Values are opaque strings without TAB, CR, or LF. A client that needs
--- arbitrary bytes should encode them before building the batch.

local SEP = string.char(9)
local MAX_BATCH_BYTES = 1024 * 1024
local MAX_OPS = 5000
local MAX_KEY_BYTES = 128
local MAX_VALUE_BYTES = 4096
local MAX_SEEN = 4096
local MAX_SAFE_INTEGER = 9007199254740991

HyperDBState = HyperDBState or {
  rows = {},
  rowCount = 0,
  revision = 0,
  batches = 0,
  writes = 0,
  conflicts = 0,
  seen = {},
  seenOrder = {},
  seenCursor = 0,
}
local State = HyperDBState

-- Restore older snapshots defensively without creating per-row metadata.
State.rows = State.rows or {}
State.rowCount = math.tointeger(tonumber(State.rowCount)) or 0
State.revision = math.tointeger(tonumber(State.revision)) or 0
State.batches = math.tointeger(tonumber(State.batches)) or 0
State.writes = math.tointeger(tonumber(State.writes)) or 0
State.conflicts = math.tointeger(tonumber(State.conflicts)) or 0
State.seen = State.seen or {}
State.seenOrder = State.seenOrder or {}
State.seenCursor = math.tointeger(tonumber(State.seenCursor)) or 0

local SIGNATURE_ALGS = {
  ["rsa-pss-sha512"] = true,
  ["rsa-pss-sha256"] = true,
}

local function field(t, wanted)
  if type(t) ~= "table" then return nil end
  local exact = t[wanted]
  if exact ~= nil then return exact end
  local lower = string.lower(wanted)
  for key, value in pairs(t) do
    if type(key) == "string" and string.lower(key) == lower then return value end
  end
  return nil
end

local function messageOf(req)
  local raw = req and req.body or {}
  if type(raw) ~= "table" then return {} end
  local msg = {}
  local tags = raw.Tags or raw.tags
  if type(tags) == "table" then
    for key, value in pairs(tags) do msg[key] = value end
  end
  for key, value in pairs(raw) do
    if key ~= "Tags" and key ~= "tags" then msg[key] = value end
  end
  return msg
end

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

local function jsonString(value)
  local source = tostring(value or "")
  local out = {}
  for i = 1, #source do
    local byte = string.byte(source, i)
    if byte == 34 then out[#out + 1] = string.char(92) .. '"'
    elseif byte == 92 then out[#out + 1] = string.char(92) .. string.char(92)
    elseif byte == 8 then out[#out + 1] = string.char(92) .. "b"
    elseif byte == 9 then out[#out + 1] = string.char(92) .. "t"
    elseif byte == 10 then out[#out + 1] = string.char(92) .. "n"
    elseif byte == 12 then out[#out + 1] = string.char(92) .. "f"
    elseif byte == 13 then out[#out + 1] = string.char(92) .. "r"
    elseif byte < 32 or byte == 127 then
      out[#out + 1] = string.format("%s%su%04X", string.char(92), "", byte)
    else out[#out + 1] = string.char(byte) end
  end
  return '"' .. table.concat(out) .. '"'
end

local function statsJSON()
  return string.format(
    '{"name":"TEST-HyperDB","rows":%d,"revision":%d,"batches":%d,'
      .. '"writes":%d,"conflicts":%d}',
    State.rowCount, State.revision, State.batches, State.writes, State.conflicts
  )
end

local function reply(base, data)
  base.results = { output = { data = data } }
  -- This is the entire public read model. It stays constant-size as rows grow.
  base.hyperdb = statsJSON()
  return base
end

local function fail(base, message)
  return reply(base, '{"ok":false,"error":' .. jsonString(message) .. '}')
end

local function validToken(value, maxBytes)
  return type(value) == "string" and #value > 0 and #value <= maxBytes
    and string.find(value, "[^%w%._:/%-]", 1) == nil
end

local function integer(value)
  if type(value) ~= "string" and type(value) ~= "number" then return nil end
  local narrowed = math.tointeger(tonumber(value))
  if narrowed == nil or narrowed > MAX_SAFE_INTEGER or narrowed < -MAX_SAFE_INTEGER then
    return nil
  end
  return narrowed
end

local function parseLine(line)
  local first = string.find(line, SEP, 1, true)
  if not first then return nil, nil, nil, nil, "operation has no key" end
  local op = string.sub(line, 1, first - 1)
  local second = string.find(line, SEP, first + 1, true)
  if not second then return nil, nil, nil, nil, "operation has no value" end
  local key = string.sub(line, first + 1, second - 1)
  if op == "C" then
    local third = string.find(line, SEP, second + 1, true)
    if not third then return nil, nil, nil, nil, "compare-and-set has no value" end
    return op, key, string.sub(line, second + 1, third - 1),
      string.sub(line, third + 1), nil
  end
  return op, key, string.sub(line, second + 1), nil, nil
end

local function eachLine(data, visitor)
  local position = 1
  local count = 0
  while position <= #data do
    local newline = string.find(data, "\n", position, true)
    local last = newline and (newline - 1) or #data
    if last >= position and string.byte(data, last) == 13 then last = last - 1 end
    if last >= position then
      count = count + 1
      if count > MAX_OPS then return nil, "batch exceeds operation limit" end
      local ok, problem = visitor(string.sub(data, position, last), count)
      if not ok then return nil, problem end
    end
    position = newline and (newline + 1) or (#data + 1)
  end
  if count == 0 then return nil, "batch is empty" end
  return count, nil
end

local function validateLine(line, index)
  local op, key, arg, value, problem = parseLine(line)
  if problem then return nil, "line " .. index .. ": " .. problem end
  if not validToken(key, MAX_KEY_BYTES) then
    return nil, "line " .. index .. ": invalid key"
  end
  if op == "P" then
    if #arg > MAX_VALUE_BYTES or string.find(arg, "[\t\r\n]") then
      return nil, "line " .. index .. ": invalid value"
    end
  elseif op == "I" then
    if integer(arg) == nil then return nil, "line " .. index .. ": invalid increment" end
  elseif op == "C" then
    local expected = integer(arg)
    if expected == nil or expected < 0 then
      return nil, "line " .. index .. ": invalid expected version"
    end
    if #value > MAX_VALUE_BYTES or string.find(value, "[\t\r\n]") then
      return nil, "line " .. index .. ": invalid value"
    end
  elseif op == "D" then
    local expected = arg == "*" and 0 or integer(arg)
    if expected == nil or expected < 0 then
      return nil, "line " .. index .. ": invalid expected version"
    end
  else
    return nil, "line " .. index .. ": unknown operation"
  end
  return true, nil
end

-- A row is exactly one Lua string: version<TAB>last-writer<TAB>value.
-- This avoids three or four live Luerl tables per row, which is the dominant
-- garbage-collection cost in large process heaps.
local function unpackRow(packed)
  if type(packed) ~= "string" then return 0, nil, nil end
  local first = string.find(packed, SEP, 1, true)
  local second = first and string.find(packed, SEP, first + 1, true)
  if not second then return 0, nil, nil end
  return integer(string.sub(packed, 1, first - 1)) or 0,
    string.sub(packed, first + 1, second - 1), string.sub(packed, second + 1)
end

local function put(key, value, writer)
  local existed = State.rows[key] ~= nil
  State.revision = State.revision + 1
  State.rows[key] = string.format("%d", State.revision) .. SEP .. writer .. SEP .. value
  if not existed then State.rowCount = State.rowCount + 1 end
  State.writes = State.writes + 1
end

local ActiveWriter = nil

local function applyLine(line, _index)
  local op, key, arg, value = parseLine(line)
  local currentVersion, _, currentValue = unpackRow(State.rows[key])

  if op == "P" then
    put(key, arg, ActiveWriter)
    return true, nil
  elseif op == "I" then
    local current = currentValue == nil and 0 or integer(currentValue)
    local delta = integer(arg)
    if current == nil or delta == nil then return true, "conflict" end
    local nextValue = current + delta
    if nextValue > MAX_SAFE_INTEGER or nextValue < -MAX_SAFE_INTEGER then
      return true, "conflict"
    end
    put(key, string.format("%d", nextValue), ActiveWriter)
    return true, nil
  elseif op == "C" then
    if currentVersion ~= integer(arg) then return true, "conflict" end
    put(key, value, ActiveWriter)
    return true, nil
  elseif op == "D" then
    if State.rows[key] == nil then return true, "conflict" end
    if arg ~= "*" and currentVersion ~= integer(arg) then return true, "conflict" end
    State.rows[key] = nil
    State.rowCount = State.rowCount - 1
    State.revision = State.revision + 1
    State.writes = State.writes + 1
    return true, nil
  end
  return nil, "validated operation became invalid"
end

local function remember(txid, receipt)
  State.seenCursor = (State.seenCursor % MAX_SEEN) + 1
  local old = State.seenOrder[State.seenCursor]
  if old then State.seen[old] = nil end
  State.seenOrder[State.seenCursor] = txid
  State.seen[txid] = receipt
end

local function batchReceipt(applied, conflicts, operations, duplicate, txid)
  return string.format(
    '{"ok":true,"action":"db.batch","txid":%s,"duplicate":%s,"applied":%d,'
      .. '"conflicts":%d,"operations":%d,"revision":%d,"rows":%d,"writer":%s}',
    jsonString(txid), duplicate and "true" or "false", applied, conflicts, operations,
    State.revision, State.rowCount, jsonString(ActiveWriter)
  )
end

local function handleBatch(base, msg)
  ActiveWriter = signer(msg)
  if not ActiveWriter then return fail(base, "a real signature is required") end
  local txid = field(msg, "txid")
  if not validToken(txid, 128) then return fail(base, "txid is required") end
  local prior = State.seen[txid]
  if prior then
    -- Receipts are kept as strings too. Change the one stable field without
    -- parsing a retained response into another permanent table.
    return reply(base, string.gsub(prior, '"duplicate":false', '"duplicate":true', 1))
  end

  local data = field(msg, "data") or ""
  if type(data) ~= "string" then return fail(base, "batch data must be a string") end
  if #data > MAX_BATCH_BYTES then return fail(base, "batch exceeds byte limit") end

  -- Validate the whole wire payload before mutating anything. The second pass
  -- applies it. This preserves message-level atomicity for malformed input
  -- without retaining an operation table proportional to the batch size.
  local operations, problem = eachLine(data, validateLine)
  if not operations then return fail(base, problem) end

  local conflicts = 0
  local applied = 0
  local applyOK, applyProblem = eachLine(data, function(line, index)
    local ok, outcome = applyLine(line, index)
    if not ok then return nil, outcome end
    if outcome == "conflict" then conflicts = conflicts + 1
    else applied = applied + 1 end
    return true, nil
  end)
  if not applyOK then return fail(base, applyProblem) end

  State.batches = State.batches + 1
  State.conflicts = State.conflicts + conflicts
  local receipt = batchReceipt(applied, conflicts, operations, false, txid)
  remember(txid, receipt)
  return reply(base, receipt)
end

local function handleGet(base, msg)
  local key = field(msg, "key")
  if not validToken(key, MAX_KEY_BYTES) then return fail(base, "key is required") end
  local version, writer, value = unpackRow(State.rows[key])
  if value == nil then
    return reply(base, '{"ok":true,"action":"db.get","found":false,"key":'
      .. jsonString(key) .. ',"revision":' .. string.format("%d", State.revision) .. '}')
  end
  return reply(base, '{"ok":true,"action":"db.get","found":true,"key":'
    .. jsonString(key) .. ',"version":' .. string.format("%d", version)
    .. ',"writer":' .. jsonString(writer) .. ',"value":' .. jsonString(value)
    .. ',"revision":' .. string.format("%d", State.revision) .. '}')
end

function compute(base, req, _opts)
  base = type(base) == "table" and base or {}
  local msg = messageOf(req)
  local action = string.lower(tostring(field(msg, "action") or "db.stats"))
  local result
  if action == "db.batch" then result = handleBatch(base, msg)
  elseif action == "db.get" then result = handleGet(base, msg)
  elseif action == "db.stats" then
    result = reply(base, '{"ok":true,"action":"db.stats","state":' .. statsJSON() .. '}')
  else result = fail(base, "unknown action " .. action) end

  -- Luerl does not collect by itself. This must remain a bare statement in the
  -- outermost compute frame; moving it inside pcall/ipairs can kill the VM.
  collectgarbage("collect")
  return result
end
