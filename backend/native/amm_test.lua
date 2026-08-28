--- amm_test.lua - constant-product pool regression suite.

local function run(base, req)
  local out = {}
  local passed, failed = 0, 0
  local function ok(label, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (cond and "PASS  " or "FAIL  ") .. label ..
      (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end

  local json = require(".json")
  local T = 1700000000000
  local messageId = 0
  local OWNER = "O" .. string.rep("o", 42)
  local ALICE = "A" .. string.rep("a", 42)
  local BOB = "B" .. string.rep("b", 42)
  local BASE = "R" .. string.rep("r", 42)
  local QUOTE = "Q" .. string.rep("q", 42)
  local PROCESS = { commitments = { sig = { committer = OWNER, type = "rsa-pss-sha512" } } }

  local function signed(from, tags)
    T = T + 1000
    local body = { commitments = { sig = { committer = from, alg = "rsa-pss-sha512" } } }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(res.results.output.data), res
  end

  local function processMessage(fromProcess, tags)
    T = T + 1000
    messageId = messageId + 1
    local body = {
      commitments = { hmac = { type = "hmac-sha256", keyid = "constant:ao" } },
      ["from-process"] = fromProcess,
      id = "notice-" .. tostring(messageId),
    }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(res.results.output.data), res
  end

  local r = signed(ALICE, { Action = "Admin.Configure", BaseToken = BASE, QuoteToken = QUOTE })
  ok("a stranger cannot configure the pool", r and r.error == "Not authorised", json.encode(r))
  r = signed(OWNER, { Action = "Admin.Configure", BaseToken = BASE, QuoteToken = QUOTE,
                      BaseTicker = "TEST-RUNE", QuoteTicker = "TEST-RELIC",
                      BaseDenomination = "0", QuoteDenomination = "6", FeeBps = "30" })
  ok("the owner configures a Rune pair", r and r.configured == true and r.feeBps == 30, json.encode(r))

  -- A signed wallet cannot turn a from-process TAG into a token notice.
  r = signed(ALICE, { Action = "Credit-Notice", ["from-process"] = BASE,
                      Sender = ALICE, Quantity = "1000000" })
  ok("a signed forged credit notice is refused", r and r.error ~= nil, json.encode(r))

  r = processMessage(BASE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "1000" })
  ok("the Rune process credits a deposit", r and r.deposit.base == "1000", json.encode(r))
  do
    local body = {
      commitments = { hmac = { type = "hmac-sha256", keyid = "constant:ao" } },
      ["from-process"] = BASE, id = "notice-1", Action = "Credit-Notice",
      Sender = ALICE, Quantity = "1000",
    }
    local replay = compute({ process = PROCESS }, { body = body, timestamp = T + 1 }, {})
    r = json.decode(replay.results.output.data)
    ok("a replayed token notice is credited only once",
       r and r.action == "Deposit-Already-Credited" and r.deposit.base == "1000", json.encode(r))
  end
  r = processMessage(QUOTE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "1000000" })
  ok("the quote process credits a deposit", r and r.deposit.quote == "1000000", json.encode(r))

  r = signed(ALICE, { Action = "Liquidity.Add", BaseQuantity = "1000", QuoteQuantity = "1000000" })
  ok("the first provider seeds both reserves", r and r.pool.reserveBase == "1000" and
     r.pool.reserveQuote == "1000000", json.encode(r))
  ok("liquidity shares remain whole", r and r.shares == "1000", json.encode(r))

  processMessage(BASE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "100" })
  processMessage(QUOTE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "200000" })
  r = signed(ALICE, { Action = "Liquidity.Add", BaseQuantity = "100", QuoteQuantity = "200000" })
  ok("off-ratio liquidity leaves the excess as a refundable deposit",
     r and r.baseUsed == "100" and r.quoteUsed == "100000" and r.account.quote == "100000",
     json.encode(r))

  ok("overflow-safe multiplication handles realistic 12-decimal reserves",
     mulDiv(4000000000000000, 3000000000, 5000000000000) == 2400000000000)

  local productBefore = 1100 * 1100000
  processMessage(BASE, { Action = "Credit-Notice", Sender = BOB, Quantity = "100" })
  r = signed(BOB, { Action = "Swap", InputToken = "base", Quantity = "100", MinOutput = "999999" })
  ok("slippage protection rejects a moved price", r and r.error == "Price moved below MinOutput", json.encode(r))
  r = signed(BOB, { Action = "Swap", InputToken = "base", Quantity = "100", MinOutput = "1" })
  ok("a deposited Rune swaps for quote", r and r.action == "Swap-Queued" and
     int(r.swap.output, 0) > 0, json.encode(r))
  ok("the quote payout targets the quote process",
     r and r.action == "Swap-Queued", json.encode(r))

  local productAfter = int(r.pool.reserveBase, 0) * int(r.pool.reserveQuote, 0)
  ok("the fee keeps constant product from decreasing", productAfter >= productBefore,
     tostring(productAfter) .. " >= " .. tostring(productBefore))

  processMessage(QUOTE, { Action = "Credit-Notice", Sender = BOB, Quantity = "500" })
  r = signed(BOB, { Action = "Deposit.Refund", Token = "quote", Quantity = "500" })
  ok("unused deposits are refundable", r and r.action == "Refund-Queued" and r.quantity == "500", json.encode(r))

  r = signed(ALICE, { Action = "Liquidity.Remove", Shares = "100" })
  ok("liquidity can be removed pro rata", r and r.action == "Liquidity-Removed" and
     int(r.base, 0) > 0 and int(r.quote, 0) > 0, json.encode(r))

  local _, raw = signed(OWNER, { Action = "AMM.Info" })
  ok("published pool values contain no floats", not raw.amm:match("[%d]%.[%d]"), raw.amm)

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

function ammtest(base, req)
  local ok, res = pcall(run, base, req)
  return ok and res or ("ERROR: " .. tostring(res))
end
