--- quote_test.lua - faucet quote token regression suite.

local function run(base, req)
  local out = {}
  local passed, failed = 0, 0
  local function ok(label, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (cond and "PASS  " or "FAIL  ") .. label ..
      (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end
  local json = require(".json")
  local OWNER = "O" .. string.rep("o", 42)
  local ALICE = "A" .. string.rep("a", 42)
  local BOB = "B" .. string.rep("b", 42)
  local AMM = "M" .. string.rep("m", 42)
  local PROCESS = { commitments = { sig = { committer = OWNER, type = "rsa-pss-sha512" } } }

  local function signed(from, tags)
    local body = { commitments = { sig = { committer = from, alg = "rsa-pss-sha512" } } }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute({ process = PROCESS }, { body = body, timestamp = 1700000000000 }, {})
    return json.decode(res.results.output.data), res
  end
  local function fromProcess(pid, tags)
    local body = { commitments = { hmac = { type = "hmac-sha256" } }, ["from-process"] = pid }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute({ process = PROCESS }, { body = body, timestamp = 1700000000000 }, {})
    return json.decode(res.results.output.data), res
  end

  local r = signed(ALICE, { Action = "Info" })
  ok("test quote does not impersonate AO", r and r.Ticker == "TEST-RELIC", json.encode(r))
  ok("the quote uses six decimals", r and r.Denomination == "6", json.encode(r))
  ok("the public faucet is exactly five tokens", r and r.FaucetAmount == "5000000", json.encode(r))
  r = signed(ALICE, { Action = "Faucet" })
  ok("a wallet can mint five test tokens", r and r.Quantity == "5000000" and r.Balance == "5000000", json.encode(r))
  r = signed(ALICE, { Action = "Faucet", Quantity = "999999999999" })
  ok("the faucet can be used repeatedly but never changes its batch", r and r.Quantity == "5000000" and r.Balance == "10000000", json.encode(r))
  r = signed(ALICE, { Action = "Transfer", Recipient = AMM, Quantity = "1000000",
                      ["X-Action"] = "AMM-Deposit" })
  ok("a holder can fund the AMM", r and r.Balance == "9000000", json.encode(r))

  r = fromProcess(AMM, { Action = "Transfer", Recipient = BOB, Quantity = "100" })
  ok("an attested process spends its own balance", r and r.From == AMM and r.Quantity == "100", json.encode(r))

  r = signed(BOB, { Action = "Transfer", Recipient = ALICE, Quantity = "101", ["from-process"] = AMM })
  ok("a wallet cannot spend a process balance with a tag", r and r.error ~= nil, json.encode(r))

  r = signed(ALICE, { Action = "Admin.Mint", Recipient = BOB, Quantity = "5" })
  ok("a stranger cannot admin mint", r and r.error == "Not authorised", json.encode(r))
  r = signed(OWNER, { Action = "Admin.Mint", Recipient = BOB, Quantity = "5" })
  ok("the owner can mint test inventory", r and r.Quantity == "5", json.encode(r))

  local _, raw = signed(OWNER, { Action = "Info" })
  ok("token state contains no floats", not raw.tokeninfo:match("[%d]%.[%d]"), raw.tokeninfo)

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- Driven from the outermost Lua frame, NOT through `pcall`.
---
--- `compute` ends with `collectgarbage("collect")`, and on Luerl a collect
--- inside a pcall frame corrupts the state pcall restores on return and kills
--- the VM (full account at the end of `compute` in game.lua). Production calls
--- `compute` from Erlang with no Lua pcall on the stack, so the suite has to
--- match that or it tests a shape nobody deploys.
---
--- The cost is that a runtime error comes back as a bare `500 Oops` naming
--- nothing. It still fails the run: an HTML error page carries no "0 failed".
function quotetest(base, req)
  return run(base, req)
end
