--- quote.lua - faucet-backed quote token for the TEST-RUNE AMM.
---
--- This is intentionally not named TEST-AO. AO has its own process, scheduler,
--- denomination and operational requirements; a local test asset must not look
--- like it is the real token in a wallet or explorer. Deploy the AMM against
--- AO later by configuring AO's process id and denomination after the full
--- Credit-Notice/outbox path has been verified on the target node.

Name = "TEST-Relic"
Ticker = "TEST-RELIC"
Denomination = 6
Logo = Logo or ""
-- Public test liquidity: every signed request mints exactly 5 TEST-RELIC.
-- This token is deliberately TEST-prefixed and has no scarcity promise.
FaucetAmount = FaucetAmount or 5000000 -- 5.000000 TEST-RELIC

Balances = Balances or {}
TotalSupply = TotalSupply or 0
Minted = Minted or 0

local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }

local function int(v, default)
  if v == nil then return default end
  local n = tonumber(v)
  if not n then return default end
  return math.tointeger(n) or default
end

local function quantity(v)
  if v == nil or v == "" then return nil, "Quantity is required" end
  local n = tonumber(v)
  if not n or n ~= math.floor(n) then return nil, "Quantity must be a whole atomic amount" end
  n = math.tointeger(n)
  if not n or n <= 0 then return nil, "Quantity must be positive" end
  return n
end

local function asString(n) return string.format("%d", int(n, 0)) end
local function balanceOf(address) return int(Balances[address], 0) end

local function credit(address, amount)
  local nextBalance = balanceOf(address) + amount
  Balances[address] = nextBalance > 0 and nextBalance or nil
end

local function provenSigner(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) ~= "table" then return msg.Address or msg.From end
  for _, commitment in pairs(c) do
    if type(commitment) == "table" and commitment.committer
       and SIGNATURE_ALGS[commitment.type or commitment.alg] then
      return commitment.committer
    end
  end
  return nil
end

--- A process can spend only its own account. A real wallet signature always
--- wins, so a user cannot attach a forged `from-process` tag and name a payer.
local function actor(msg)
  local signed = provenSigner(msg)
  if signed then return signed end
  return msg["from-process"] or msg.FromProcess
end

local function isOwner(address)
  return Owner ~= nil and Owner ~= "" and address ~= nil and address == Owner
end

local function reply(base, value, outbox)
  base.results = {
    output = { data = type(value) == "string" and value or encode(value) },
    outbox = outbox or {},
  }
  return base
end

local function fail(base, message) return reply(base, { error = message }) end

local function forwarded(msg)
  local out = {}
  for k, v in pairs(msg) do
    local key = tostring(k)
    if key:sub(1, 2):lower() == "x-" then out[key] = v end
  end
  return out
end

local function isCast(msg)
  local c = msg.Cast
  return c ~= nil and c ~= "" and c ~= "false"
end

local function balancesView()
  local out = jsonObject({})
  for address, amount in pairs(Balances) do
    if int(amount, 0) > 0 then out[address] = asString(amount) end
  end
  return out
end

local function infoView()
  return {
    Name = Name, Ticker = Ticker, Denomination = asString(Denomination), Logo = Logo,
    TotalSupply = asString(TotalSupply), Minted = asString(Minted),
    FaucetAmount = asString(FaucetAmount), Owner = Owner or "",
  }
end

local H = {}

H["Info"] = function(base) return reply(base, infoView()) end

H["Balance"] = function(base, msg)
  local address = msg.Account or msg.Recipient or actor(msg)
  if not address then return fail(base, "No address") end
  return reply(base, { Account = address, Balance = asString(balanceOf(address)), Ticker = Ticker })
end

H["Balances"] = function(base) return reply(base, balancesView()) end

H["Total-Supply"] = function(base)
  return reply(base, { Action = "Total-Supply", Data = asString(TotalSupply),
                       TotalSupply = asString(TotalSupply), Ticker = Ticker })
end

H["Faucet"] = function(base, msg)
  local to = provenSigner(msg)
  if not to then return fail(base, "A signed wallet is required") end
  credit(to, FaucetAmount)
  TotalSupply = TotalSupply + FaucetAmount
  Minted = Minted + FaucetAmount
  return reply(base, { Action = "Faucet-Success", Recipient = to,
                       Quantity = asString(FaucetAmount), Balance = asString(balanceOf(to)) })
end

H["Admin.Mint"] = function(base, msg)
  if not isOwner(provenSigner(msg)) then return fail(base, "Not authorised") end
  local to = msg.Recipient
  if type(to) ~= "string" or #to ~= 43 then return fail(base, "Recipient is required") end
  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end
  credit(to, amount)
  TotalSupply = TotalSupply + amount
  Minted = Minted + amount
  return reply(base, { Action = "Mint-Success", Recipient = to,
                       Quantity = asString(amount), Balance = asString(balanceOf(to)),
                       TotalSupply = asString(TotalSupply) })
end

H["Transfer"] = function(base, msg)
  local from = actor(msg)
  if not from then return fail(base, "Unsigned messages cannot transfer") end
  local to = msg.Recipient
  if type(to) ~= "string" or to == "" then return fail(base, "Recipient is required") end
  if to == from then return fail(base, "Cannot transfer to yourself") end
  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end
  if balanceOf(from) < amount then return fail(base, "Insufficient balance") end

  credit(from, -amount)
  credit(to, amount)
  local outbox = {}
  if not isCast(msg) then
    local debit = { target = from, Action = "Debit-Notice", Recipient = to, Quantity = asString(amount) }
    local notice = { target = to, Action = "Credit-Notice", Sender = from, Quantity = asString(amount) }
    for k, v in pairs(forwarded(msg)) do debit[k] = v; notice[k] = v end
    outbox["debit-notice"] = debit
    outbox["credit-notice"] = notice
  end
  return reply(base, { Action = "Transfer-Success", From = from, Recipient = to,
                       Quantity = asString(amount), Balance = asString(balanceOf(from)) }, outbox)
end

local ENVELOPE = {
  target = true, id = true, owner = true, signature = true, anchor = true,
  commitments = true, from = true, type = true, variant = true,
  path = true, method = true, slot = true, device = true, nonce = true,
  epoch = true, accept = true, scheduler = true, subject = true,
  ["from-process"] = true, ["data-protocol"] = true, ["content-type"] = true,
  ["accept-bundle"] = true, ["random-seed"] = true, ["hashpath"] = true,
}

local function caseInsensitive(t)
  local lower = {}
  for k, v in pairs(t) do
    local key = tostring(k):lower()
    if not ENVELOPE[key] then lower[key] = v end
  end
  return setmetatable({}, {
    __index = function(_, key) return t[key] or lower[tostring(key):lower()] end,
    __pairs = function() return pairs(t) end,
  })
end

local function resolveOwner(base)
  if Owner and Owner ~= "" then return Owner end
  local p = base and (base.process or base.Process)
  local c = type(p) == "table" and (p.commitments or p.Commitments) or nil
  if type(c) == "table" then
    for _, commitment in pairs(c) do
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        Owner = commitment.committer
        return Owner
      end
    end
  end
  return Owner
end

function compute(base, req, opts)
  resolveOwner(base)
  local raw = (req and req.body) or {}
  local msg = caseInsensitive(raw.Tags or raw)
  local action = msg.Action or msg.action or "none"
  local handler = H[action]
  local result
  if not handler then
    result = fail(base, "unknown action '" .. tostring(action) .. "'")
  else
    local ok, out = pcall(function() return handler(base, msg) end)
    result = ok and out or fail(base, tostring(out))
  end
  result.tokeninfo = encode(infoView())
  result.balances = encode(balancesView())
  result.totalsupply = asString(TotalSupply)
  result.ticker = Ticker
  local who = actor(msg) or msg.Recipient or msg.Account
  if type(who) == "string" and who ~= "" then result["balance-" .. who] = asString(balanceOf(who)) end
  return result
end
