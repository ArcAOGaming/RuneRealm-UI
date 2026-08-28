--- amm.lua - a two-token constant-product market for TEST-RUNE.
---
--- Tokens are transferred to this process first. Their Credit-Notice creates a
--- credited deposit for the original sender; a later signed action consumes
--- that deposit for a swap or liquidity. Keeping those two steps separate is
--- intentional: cross-process delivery is asynchronous, while the price and
--- slippage check must happen atomically in this process.
---
--- Payouts leave through the process outbox. The paired token contracts accept
--- an attested `from-process` actor only for that process's OWN balance, so the
--- AMM can never name a user's account as the payer.

AmmName = "TEST-Rune Realm Swap"
BaseToken = BaseToken or ""
QuoteToken = QuoteToken or ""
BaseTicker = BaseTicker or "TEST-RUNE"
QuoteTicker = QuoteTicker or "TEST-RELIC"
BaseDenomination = BaseDenomination or 0
QuoteDenomination = QuoteDenomination or 6
FeeBps = FeeBps or 30
Paused = Paused or false

ReserveBase = ReserveBase or 0
ReserveQuote = ReserveQuote or 0
TotalShares = TotalShares or 0
SwapCount = SwapCount or 0
Deposits = Deposits or {}
Liquidity = Liquidity or {}
RecentSwaps = RecentSwaps or {}
CreditReceipts = CreditReceipts or {}

local ADDRESS = "^[A-Za-z0-9_-]+$"
local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }
local BPS = 10000
local MAX_RECENT = 50

local function int(v, default)
  if v == nil then return default end
  local n = tonumber(v)
  if not n then return default end
  return math.tointeger(n) or default
end

local function validId(v)
  return type(v) == "string" and #v == 43 and v:match(ADDRESS) ~= nil
end

local function quantity(v, label)
  if v == nil or v == "" then return nil, (label or "Quantity") .. " is required" end
  local n = tonumber(v)
  if not n or n ~= math.floor(n) then return nil, (label or "Quantity") .. " must be a whole atomic amount" end
  n = math.tointeger(n)
  if not n or n <= 0 then return nil, (label or "Quantity") .. " must be positive" end
  return n
end

local function asString(n)
  return string.format("%d", int(n, 0))
end

--- floor(a*b/d), without constructing a*b.
---
--- AO uses 12 decimal places. A completely ordinary reserve can therefore
--- overflow int64 if a swap formula multiplies first and divides second. This
--- is binary long division over quotient+remainder pairs; every intermediate
--- stays below either the final quotient or d.
local function mulDiv(a, b, d)
  a, b, d = int(a, 0), int(b, 0), int(d, 0)
  if a < 0 or b < 0 or d <= 0 then return nil end
  if a == 0 or b == 0 then return 0 end

  local whole = a // d
  local remA = a % d
  local result = whole * b

  local bit = 1
  while bit <= b // 2 do bit = bit * 2 end
  local q, rem = 0, 0
  local left = b
  while bit > 0 do
    q = q * 2
    -- rem = (rem * 2) % d, without overflowing on rem * 2.
    if rem >= d - rem then
      rem = rem - (d - rem)
      q = q + 1
    else
      rem = rem + rem
    end
    if left >= bit then
      left = left - bit
      -- rem = (rem + remA) % d, also without overflowing.
      if remA > 0 then
        if rem >= d - remA then
          rem = rem - (d - remA)
          q = q + 1
        else
          rem = rem + remA
        end
      end
    end
    bit = bit // 2
  end
  return result + q
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

--- An outbox delivery cannot sign: a process id has no private key. HyperBEAM
--- attests its origin as `from-process`. A browser can include a tag with that
--- spelling, but its real wallet signature wins above; consequently only a
--- message with NO wallet signer may use the process provenance.
local function sourceProcess(msg)
  if provenSigner(msg) then return nil end
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

local function fail(base, message)
  return reply(base, { error = message })
end

local function configured()
  return validId(BaseToken) and validId(QuoteToken) and BaseToken ~= QuoteToken
end

local function depositOf(address, token)
  local row = Deposits[address]
  return row and int(row[token], 0) or 0
end

local function creditDeposit(address, token, amount)
  local row = Deposits[address]
  if not row then row = {}; Deposits[address] = row end
  local nextAmount = depositOf(address, token) + amount
  row[token] = nextAmount > 0 and nextAmount or nil
  if nextAmount <= 0 and next(row) == nil then Deposits[address] = nil end
end

local function tickerFor(token)
  if token == BaseToken then return BaseTicker end
  if token == QuoteToken then return QuoteTicker end
  return "?"
end

local function denominationFor(token)
  if token == BaseToken then return BaseDenomination end
  if token == QuoteToken then return QuoteDenomination end
  return 0
end

local function resolveToken(value)
  if value == BaseToken or value == BaseTicker or value == "base" then return BaseToken end
  if value == QuoteToken or value == QuoteTicker or value == "quote" then return QuoteToken end
  return nil
end

local function poolView()
  return {
    name = AmmName,
    baseToken = BaseToken,
    quoteToken = QuoteToken,
    baseTicker = BaseTicker,
    quoteTicker = QuoteTicker,
    baseDenomination = BaseDenomination,
    quoteDenomination = QuoteDenomination,
    feeBps = FeeBps,
    reserveBase = asString(ReserveBase),
    reserveQuote = asString(ReserveQuote),
    totalShares = asString(TotalShares),
    swaps = SwapCount,
    paused = Paused,
    configured = configured(),
    owner = Owner or "",
  }
end

local function depositView(address)
  return {
    address = address,
    base = asString(depositOf(address, BaseToken)),
    quote = asString(depositOf(address, QuoteToken)),
    shares = asString(int(Liquidity[address], 0)),
  }
end

local function depositsView()
  local out = jsonObject({})
  for address in pairs(Deposits) do out[address] = depositView(address) end
  return out
end

local function liquidityView()
  local out = jsonObject({})
  for address, shares in pairs(Liquidity) do
    if int(shares, 0) > 0 then out[address] = asString(shares) end
  end
  return out
end

local function quoteSwap(inputToken, amount)
  if ReserveBase <= 0 or ReserveQuote <= 0 then return nil, "Pool has no liquidity" end
  local reserveIn, reserveOut
  if inputToken == BaseToken then
    reserveIn, reserveOut = ReserveBase, ReserveQuote
  elseif inputToken == QuoteToken then
    reserveIn, reserveOut = ReserveQuote, ReserveBase
  else
    return nil, "Input token is not in this pool"
  end
  local effective = mulDiv(amount, BPS - FeeBps, BPS)
  if not effective or effective <= 0 then return nil, "Input is too small after the fee" end
  local output = mulDiv(effective, reserveOut, reserveIn + effective)
  if not output or output <= 0 then return nil, "Input is too small for this pool" end
  if output >= reserveOut then return nil, "Pool cannot pay that output" end
  return output
end

local function transferMessage(token, recipient, amount, reason, reference)
  return {
    target = token,
    Action = "Transfer",
    Recipient = recipient,
    Quantity = asString(amount),
    ["X-Action"] = reason,
    ["X-Reference"] = reference or "",
  }
end

local H = {}

H["AMM.Info"] = function(base) return reply(base, poolView()) end

H["AMM.Quote"] = function(base, msg)
  local token = resolveToken(msg.InputToken)
  local amount, why = quantity(msg.Quantity)
  if not token then return fail(base, "Input token is not in this pool") end
  if not amount then return fail(base, why) end
  local output, error = quoteSwap(token, amount)
  if not output then return fail(base, error) end
  local outputToken = token == BaseToken and QuoteToken or BaseToken
  return reply(base, {
    inputToken = token, outputToken = outputToken,
    inputTicker = tickerFor(token), outputTicker = tickerFor(outputToken),
    input = asString(amount), output = asString(output), feeBps = FeeBps,
  })
end

H["Admin.Configure"] = function(base, msg)
  if not isOwner(provenSigner(msg)) then return fail(base, "Not authorised") end
  if ReserveBase > 0 or ReserveQuote > 0 or TotalShares > 0 then
    return fail(base, "A funded pool cannot be reconfigured")
  end
  if not validId(msg.BaseToken) or not validId(msg.QuoteToken) or msg.BaseToken == msg.QuoteToken then
    return fail(base, "BaseToken and QuoteToken must be distinct 43-character ids")
  end
  local fee = int(msg.FeeBps, 30)
  local baseDenom = int(msg.BaseDenomination, 0)
  local quoteDenom = int(msg.QuoteDenomination, 0)
  if fee < 0 or fee > 1000 then return fail(base, "FeeBps must be between 0 and 1000") end
  if baseDenom < 0 or baseDenom > 18 or quoteDenom < 0 or quoteDenom > 18 then
    return fail(base, "Denominations must be between 0 and 18")
  end
  BaseToken, QuoteToken = msg.BaseToken, msg.QuoteToken
  BaseTicker = (msg.BaseTicker or "TEST-RUNE"):sub(1, 24)
  QuoteTicker = (msg.QuoteTicker or "TEST-RELIC"):sub(1, 24)
  BaseDenomination, QuoteDenomination = baseDenom, quoteDenom
  FeeBps = fee
  return reply(base, poolView())
end

H["Admin.Pause"] = function(base, msg)
  if not isOwner(provenSigner(msg)) then return fail(base, "Not authorised") end
  Paused = msg.Paused == "true" or msg.Paused == "1"
  return reply(base, poolView())
end

--- The only way a deposit enters the book: an outbox notice from one of the
--- two configured token processes. Sender is the account whose tokens moved.
H["Credit-Notice"] = function(base, msg)
  if not configured() then return fail(base, "Pool is not configured") end
  local token = sourceProcess(msg)
  if token ~= BaseToken and token ~= QuoteToken then return fail(base, "Credit notice is not from a pool token") end
  local sender = msg.Sender
  if not validId(sender) then return fail(base, "Credit notice has no valid sender") end
  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end
  local receipt = msg.id or msg.Id or msg["message-id"] or msg.MessageId
  if type(receipt) == "string" and receipt ~= "" and CreditReceipts[receipt] then
    return reply(base, { action = "Deposit-Already-Credited", token = token,
                         account = sender, amount = asString(amount), deposit = depositView(sender) })
  end
  creditDeposit(sender, token, amount)
  if type(receipt) == "string" and receipt ~= "" then CreditReceipts[receipt] = true end
  return reply(base, { action = "Deposit-Credited", token = token, ticker = tickerFor(token),
                       account = sender, amount = asString(amount), deposit = depositView(sender) })
end

H["Deposit.Refund"] = function(base, msg)
  local from = provenSigner(msg)
  if not from then return fail(base, "A signed wallet is required") end
  local token = resolveToken(msg.Token)
  if not token then return fail(base, "Token is not in this pool") end
  local requested = msg.Quantity and int(msg.Quantity, nil) or depositOf(from, token)
  local amount, why = quantity(requested)
  if not amount then return fail(base, why) end
  if depositOf(from, token) < amount then return fail(base, "Insufficient credited deposit") end
  creditDeposit(from, token, -amount)
  return reply(base, { action = "Refund-Queued", token = token, quantity = asString(amount),
                       deposit = depositView(from) }, {
    refund = transferMessage(token, from, amount, "AMM-Refund", msg.Reference),
  })
end

H["Liquidity.Add"] = function(base, msg)
  if Paused then return fail(base, "Pool is paused") end
  local from = provenSigner(msg)
  if not from then return fail(base, "A signed wallet is required") end
  local baseAmount, whyBase = quantity(msg.BaseQuantity, "BaseQuantity")
  local quoteAmount, whyQuote = quantity(msg.QuoteQuantity, "QuoteQuantity")
  if not baseAmount then return fail(base, whyBase) end
  if not quoteAmount then return fail(base, whyQuote) end
  if depositOf(from, BaseToken) < baseAmount or depositOf(from, QuoteToken) < quoteAmount then
    return fail(base, "Deposit both token amounts before adding liquidity")
  end

  local shares, usedBase, usedQuote
  if TotalShares == 0 then
    -- The initial scale is arbitrary; ownership percentages are not. Choosing
    -- the smaller raw side avoids sqrt(base*quote), which can overflow int64
    -- for a 12-decimal quote token before the pool has made its first trade.
    shares = math.min(baseAmount, quoteAmount)
    usedBase, usedQuote = baseAmount, quoteAmount
  else
    local byBase = mulDiv(baseAmount, TotalShares, ReserveBase)
    local byQuote = mulDiv(quoteAmount, TotalShares, ReserveQuote)
    shares = math.min(byBase, byQuote)
    -- Consume only the pool-ratio portion. Any excess stays in the provider's
    -- credited deposit instead of becoming an accidental donation.
    usedBase = mulDiv(shares, ReserveBase, TotalShares)
    usedQuote = mulDiv(shares, ReserveQuote, TotalShares)
  end
  if not shares or shares <= 0 or not usedBase or usedBase <= 0 or not usedQuote or usedQuote <= 0 then
    return fail(base, "Amounts are too small to mint a share")
  end

  creditDeposit(from, BaseToken, -usedBase)
  creditDeposit(from, QuoteToken, -usedQuote)
  ReserveBase = ReserveBase + usedBase
  ReserveQuote = ReserveQuote + usedQuote
  TotalShares = TotalShares + shares
  Liquidity[from] = int(Liquidity[from], 0) + shares
  return reply(base, { action = "Liquidity-Added", shares = asString(shares),
                       baseUsed = asString(usedBase), quoteUsed = asString(usedQuote), pool = poolView(),
                       account = depositView(from) })
end

H["Liquidity.Remove"] = function(base, msg)
  local from = provenSigner(msg)
  if not from then return fail(base, "A signed wallet is required") end
  local shares, why = quantity(msg.Shares, "Shares")
  if not shares then return fail(base, why) end
  local held = int(Liquidity[from], 0)
  if held < shares then return fail(base, "Insufficient liquidity shares") end
  local baseOut = mulDiv(shares, ReserveBase, TotalShares)
  local quoteOut = mulDiv(shares, ReserveQuote, TotalShares)
  if baseOut <= 0 or quoteOut <= 0 then return fail(base, "Shares are too small to redeem") end

  Liquidity[from] = held == shares and nil or held - shares
  TotalShares = TotalShares - shares
  ReserveBase = ReserveBase - baseOut
  ReserveQuote = ReserveQuote - quoteOut
  return reply(base, { action = "Liquidity-Removed", shares = asString(shares),
                       base = asString(baseOut), quote = asString(quoteOut), pool = poolView() }, {
    base = transferMessage(BaseToken, from, baseOut, "AMM-Liquidity-Remove", msg.Reference),
    quote = transferMessage(QuoteToken, from, quoteOut, "AMM-Liquidity-Remove", msg.Reference),
  })
end

H["Swap"] = function(base, msg, timestamp)
  if Paused then return fail(base, "Pool is paused") end
  local from = provenSigner(msg)
  if not from then return fail(base, "A signed wallet is required") end
  local token = resolveToken(msg.InputToken)
  if not token then return fail(base, "Input token is not in this pool") end
  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end
  if depositOf(from, token) < amount then return fail(base, "Deposit the input token before swapping") end
  local deadline = int(msg.Deadline, 0)
  if deadline > 0 and timestamp > deadline then return fail(base, "Quote expired") end

  local output, quoteError = quoteSwap(token, amount)
  if not output then return fail(base, quoteError) end
  local minimum = int(msg.MinOutput, 0)
  if output < minimum then return fail(base, "Price moved below MinOutput") end
  local outputToken = token == BaseToken and QuoteToken or BaseToken

  creditDeposit(from, token, -amount)
  if token == BaseToken then
    ReserveBase = ReserveBase + amount
    ReserveQuote = ReserveQuote - output
  else
    ReserveQuote = ReserveQuote + amount
    ReserveBase = ReserveBase - output
  end
  SwapCount = SwapCount + 1
  local record = {
    id = SwapCount, trader = from, inputToken = token, outputToken = outputToken,
    input = asString(amount), output = asString(output), timestamp = timestamp,
  }
  RecentSwaps[#RecentSwaps + 1] = record
  if #RecentSwaps > MAX_RECENT then table.remove(RecentSwaps, 1) end

  return reply(base, { action = "Swap-Queued", swap = record, pool = poolView(),
                       deposit = depositView(from) }, {
    payout = transferMessage(outputToken, from, output, "AMM-Swap", tostring(SwapCount)),
  })
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
  local timestamp = int((req and (req.timestamp or req.Timestamp)) or msg.Timestamp, 0)
  local handler = H[action]
  local result
  if not handler then
    result = fail(base, "unknown action '" .. tostring(action) .. "'")
  else
    local ok, out = pcall(function() return handler(base, msg, timestamp) end)
    result = ok and out or fail(base, tostring(out))
  end

  result.amm = encode(poolView())
  result.deposits = encode(depositsView())
  result.liquidity = encode(liquidityView())
  result.swaps = encode(RecentSwaps)
  local who = provenSigner(msg) or msg.Sender
  if validId(who) then result["deposit-" .. who] = encode(depositView(who)) end
  return result
end
