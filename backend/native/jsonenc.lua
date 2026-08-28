--- jsonenc.lua — a JSON encoder that does not go through Luerl's broken `%g`.
---
--- hyper-aos's json.encode formats every number with `string.format("%.14g")`.
--- Under Luerl that is broken: `%.14g` of 100 gives "100.00000000000", so an
--- integer id goes onto the wire as `"id":5001.0000000000`. It parses back to
--- the right number, but it bloats every payload, makes published state and
--- logs unreadable, and turns a player id into something no string comparison
--- will match.
---
--- So integers are written with `%d`, which Luerl gets right, and only genuine
--- floats fall back to tostring. Decoding still uses hyper-aos's json.decode —
--- that one works, it just floats every number, which `deflate` undoes.
---
--- Bundled as:
---   local jsonx = (function() ... end)()
---   local encode, jsonObject = jsonx.encode, jsonx.object

local escapes = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
  ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function escapeChar(c)
  return escapes[c] or string.format("\\u%04x", string.byte(c))
end

local function encodeString(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', escapeChar) .. '"'
end

local function encodeNumber(n)
  if n ~= n or n == math.huge or n == -math.huge then return "null" end
  local i = math.tointeger(n)
  if i then return string.format("%d", i) end
  -- A real fraction. tostring is honest here where %.14g is not.
  return tostring(n)
end

--- An EMPTY table is ambiguous in Lua and not in JSON, and getting it wrong is
--- not cosmetic: `npcs_alive` encoded as `{}` instead of `[]` made
--- `npcs_alive.includes(...)` throw the moment the last enemy died, taking the
--- whole combat screen white on the winning blow.
---
--- So empty means array, which is what every list on the battle view wants,
--- and the few genuine maps say so with `jsonObject`.
local OBJECT = {}

--- Mark a table as a JSON object, so it encodes as `{}` when empty.
local function object(t)
  return setmetatable(t, OBJECT)
end

--- A table is an array if its keys are exactly 1..#t. Empty counts.
local function isArray(t)
  if getmetatable(t) == OBJECT then return false end
  local n = 0
  for k in pairs(t) do
    if type(k) ~= "number" or k % 1 ~= 0 or k < 1 then return false end
    n = n + 1
  end
  return n == #t
end

local encode

local function encodeTable(t, depth)
  if depth > 32 then error("json: nesting too deep") end
  local out = {}
  if isArray(t) then
    for i = 1, #t do out[#out + 1] = encode(t[i], depth + 1) end
    return "[" .. table.concat(out, ",") .. "]"
  end
  -- Sorted keys, so the same state always encodes to the same bytes and a
  -- diff of two published snapshots is readable.
  local keys = {}
  for k in pairs(t) do
    if type(k) == "string" or type(k) == "number" then keys[#keys + 1] = tostring(k) end
  end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local v = t[k]
    if v == nil then v = t[tonumber(k)] end
    out[#out + 1] = encodeString(k) .. ":" .. encode(v, depth + 1)
  end
  return "{" .. table.concat(out, ",") .. "}"
end

encode = function(v, depth)
  depth = depth or 0
  local kind = type(v)
  if v == nil then return "null" end
  if kind == "boolean" then return tostring(v) end
  if kind == "number" then return encodeNumber(v) end
  if kind == "string" then return encodeString(v) end
  if kind == "table" then return encodeTable(v, depth) end
  -- Functions and userdata cannot be sent; dropping them silently would hide
  -- a real mistake in a handler.
  error("json: cannot encode a " .. kind)
end

return { encode = encode, object = object }
