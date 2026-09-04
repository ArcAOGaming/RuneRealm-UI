--- A minimal concurrent key/value store for HyperBEAM.
---
--- This exists to answer one question with numbers: how fast can a HyperBEAM
--- process take writes from many people at once, and what makes it slower.
--- It is deliberately not a game. There is one write verb and one read path.
---
--- Three publish policies, chosen at spawn with the `kv-publish` tag, because
--- the published map is the single largest cost per slot and the whole point
--- is to be able to price it:
---
---   none  publish nothing. The reply to your own write is your read.
---   hot   publish a bounded window of recent writes. O(1) per slot.
---   all   publish every record under `r-<key>`. O(records) per slot, which
---         is what a naive "make every row readable" design costs.
---
--- Values are held as STRINGS, never as nested tables. Luerl's collector is
--- O(live tables squared) and blind to bytes (see SLOT_LATENCY_INVESTIGATION),
--- so a store of 100k strings collects in about the time a store of 5k tables
--- does. Any structure a caller wants is its own business, encoded on the way
--- in and decoded in the client.

Store = Store or {}          -- key -> value string
Writes = Writes or 0
Keys = Keys or 0
Hot = Hot or {}              -- bounded FIFO of recent {key, value}
HotAt = HotAt or 0

local HOT_MAX = 32
local POLICY = nil           -- resolved once, from the process definition

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

local function policy(base)
  if POLICY then return POLICY end
  local p = field(base, "kv-publish") or field(base.process or {}, "kv-publish")
  POLICY = tostring(p or "hot"):lower()
  if POLICY ~= "none" and POLICY ~= "hot" and POLICY ~= "all" then POLICY = "hot" end
  return POLICY
end

--- One string, one delimiter. Building a Lua table here and letting the encoder
--- walk it would put the cost back that the string store just removed.
local function hotView()
  local parts = {}
  for i = 1, #Hot do parts[i] = Hot[i] end
  return table.concat(parts, "\n")
end

local function publish(base, key, value)
  local mode = policy(base)
  -- Counters are two short strings and are published under every policy: they
  -- are what a client polls to know the process is alive and how far it is.
  base.writes = tostring(Writes)
  base.keys = tostring(Keys)
  if mode == "none" then return end
  if mode == "all" then
    if key then base["r-" .. key] = value end
    return
  end
  -- hot
  if key then
    Hot[#Hot + 1] = key .. "=" .. (value or "")
    if #Hot > HOT_MAX then table.remove(Hot, 1) end
  end
  base.hot = hotView()
end

local function reply(base, value)
  base.results = { output = { data = value } }
  return base
end

local Handlers = {}

--- Write one record. This is the whole write path.
Handlers["set"] = function(base, msg)
  local key = tostring(field(msg, "key") or "")
  if key == "" then return reply(base, '{"error":"missing key"}') end
  local value = tostring(field(msg, "value") or "")
  if Store[key] == nil then Keys = Keys + 1 end
  Store[key] = value
  Writes = Writes + 1
  publish(base, key, value)
  -- The reply IS the read. It is cached at `compute&slot=N/results/output/data`
  -- forever and costs nothing to fetch again, so a writer never needs the
  -- record published to see what it just wrote.
  return reply(base, value)
end

--- Read back through compute. Present only so the "read by scheduling a
--- message" path can be PRICED against the published read; never use it.
Handlers["get"] = function(base, msg)
  local key = tostring(field(msg, "key") or "")
  publish(base, nil, nil)
  return reply(base, Store[key] or "")
end

--- Bulk load, so a store can be grown to N records without paying N slots.
--- `count` records under `<prefix><n>`, each `size` bytes.
Handlers["seed"] = function(base, msg)
  local count = math.tointeger(tonumber(field(msg, "count"))) or 0
  local size = math.tointeger(tonumber(field(msg, "size"))) or 64
  local prefix = tostring(field(msg, "prefix") or "k")
  local from = math.tointeger(tonumber(field(msg, "from"))) or 0
  local filler = string.rep("x", size)
  for i = from, from + count - 1 do
    local key = prefix .. i
    if Store[key] == nil then Keys = Keys + 1 end
    Store[key] = filler
    if policy(base) == "all" then base["r-" .. key] = filler end
  end
  Writes = Writes + 1
  publish(base, nil, nil)
  return reply(base, tostring(Keys))
end

Handlers["stat"] = function(base)
  publish(base, nil, nil)
  return reply(base, '{"writes":' .. Writes .. ',"keys":' .. Keys .. '}')
end

function compute(base, req)
  base = type(base) == "table" and base or {}
  local msg = messageOf(req)
  local action = tostring(field(msg, "action") or "stat"):lower()
  local handler = Handlers[action]
  local result
  if handler then
    local ok, handled = pcall(handler, base, msg)
    result = ok and handled or reply(base, '{"error":' .. string.format("%q", tostring(handled)) .. '}')
  else
    result = reply(base, '{"error":"unknown action"}')
  end
  -- Safe only at the outermost frame, and only after every pcall has returned.
  -- With a string store there is almost nothing live for it to walk, which is
  -- the entire reason this stays cheap as the store grows.
  collectgarbage("collect")
  return result
end
