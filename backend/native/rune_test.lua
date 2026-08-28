--- rune_test.lua — exercises the Rune token on a live ~lua@5.3a.
---
--- Run with ./run-rune-test.sh. No wallet, no signing, no cost. It bundles
--- exactly what deploy-rune.mjs deploys, so anything Luerl rejects fails here
--- before it reaches a deployed process.

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
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local GAME  = "GAMEggggggggggggggggggggggggggggggggggggggg"
  local AMM   = "AMMMmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"
  local ALICE = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local BOB   = "BOBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }

  --- Drive compute() the way HyperBEAM does. `from` becomes the signer, and it
  --- is signed: a real signature algorithm, so this exercises the same path a
  --- scheduled message takes rather than the unsigned test fallback.
  local function send(from, tags, data)
    T = T + 1000
    local body = {
      commitments = { sig1 = { committer = from, alg = "rsa-pss-sha512" } },
    }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(res.results.output.data), res
  end

  local function errOf(r) return type(r) == "table" and r.error or nil end
  local function num(s) return math.tointeger(tonumber(s or "0")) end

  -- Identity ------------------------------------------------------------------

  local r = send(OWNER, { Action = "Info" })
  ok("Info answers", r ~= nil and r.Ticker == "TEST-RUNE", json.encode(r))
  ok("Rune does not divide", r and r.Denomination == "0", r and r.Denomination)
  ok("supply starts at zero", r and r.TotalSupply == "0", r and r.TotalSupply)
  ok("owner resolved from the process commitment", r and r.Owner == OWNER, r and r.Owner)
  ok("no minter yet", r and r.Minter == "", r and r.Minter)

  -- Nothing can be printed before the game is named ---------------------------

  r = send(OWNER, { Action = "Mint", Recipient = ALICE, Quantity = "100" })
  ok("the owner cannot mint before a minter is set", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Admin.SetMinter", Minter = ALICE })
  ok("a stranger cannot claim the mint", errOf(r) == "Not authorised", json.encode(r))

  r = send(OWNER, { Action = "Admin.SetMinter", Minter = "nope" })
  ok("the minter must be a process id", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.SetMinter", Minter = GAME })
  ok("the owner names the game as minter", r and r.Minter == GAME, json.encode(r))

  -- Minting is the withdraw half of the bridge --------------------------------

  r = send(OWNER, { Action = "Mint", Recipient = ALICE, Quantity = "100" })
  ok("even the owner cannot mint", errOf(r) == "Not authorised", json.encode(r))

  r = send(ALICE, { Action = "Mint", Recipient = ALICE, Quantity = "100" })
  ok("a player cannot mint themselves Rune", errOf(r) == "Not authorised", json.encode(r))

  r = send(GAME, { Action = "Mint", Recipient = ALICE, Quantity = "100" })
  ok("the game mints on withdraw", r and r.Balance == "100", json.encode(r))
  ok("supply follows the mint", r and r.TotalSupply == "100", r and r.TotalSupply)

  r = send(GAME, { Action = "Mint", Recipient = BOB, Quantity = "40" })
  ok("a second withdraw adds to supply", r and r.TotalSupply == "140", r and r.TotalSupply)

  for _, bad in ipairs({ "0", "-5", "1.5", "abc", "" }) do
    r = send(GAME, { Action = "Mint", Recipient = ALICE, Quantity = bad })
    ok("mint refuses a quantity of '" .. bad .. "'", errOf(r) ~= nil, json.encode(r))
  end

  -- Transfer ------------------------------------------------------------------

  r = send(ALICE, { Action = "Transfer", Recipient = BOB, Quantity = "30" })
  ok("a holder transfers", r and r.Balance == "70", json.encode(r))

  local _, raw = send(BOB, { Action = "Balance" })
  local b = json.decode(raw.results.output.data)
  ok("the recipient received it", b and b.Balance == "70", json.encode(b))

  r = send(ALICE, { Action = "Transfer", Recipient = BOB, Quantity = "1000" })
  ok("an overdraft is refused", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Transfer", Recipient = ALICE, Quantity = "1" })
  ok("a transfer to yourself is refused", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Transfer", Quantity = "1" })
  ok("a transfer needs a recipient", errOf(r) ~= nil, json.encode(r))

  -- A process has no private key. process-outbox attests it in `from-process`,
  -- which lets an AMM spend only the balance held under its own process id.
  send(ALICE, { Action = "Transfer", Recipient = AMM, Quantity = "2" })
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { hmac = { type = "hmac-sha256", keyid = "constant:ao" } },
      ["from-process"] = AMM,
      Action = "Transfer", Recipient = BOB, Quantity = "1",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("an attested process can spend its own Rune balance",
       decoded and decoded.From == AMM and decoded.Quantity == "1", json.encode(decoded))
  end

  do
    -- A signed wallet carrying a forged from-process tag remains the payer.
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      ["from-process"] = AMM,
      Action = "Transfer", Recipient = BOB, Quantity = "1",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("a from-process tag cannot replace a wallet signer",
       decoded and decoded.From == ALICE, json.encode(decoded))
  end

  -- A tag must never be able to name the payer.
  -- The signer pays, whatever the tags claim. Sent by BOB while naming ALICE
  -- in every tag a lazy handler might read: BOB's balance must be the one that
  -- moves.
  do
    local before = send(BOB, { Action = "Balance" })
    r = send(BOB, { Action = "Transfer", Recipient = ALICE, Quantity = "5",
                    From = ALICE, Address = ALICE, Sender = ALICE })
    ok("the signer pays, not the address named in a tag",
       r and r.error == nil and num(r.Balance) == num(before.Balance) - 5,
       json.encode(r))
  end

  -- `Target` is the poisoned tag name: an ANS-104 item carries a lowercase
  -- `target` holding this process's own id, so a handler reading it is reading
  -- the process, not the caller's intent.
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      Action = "Balance", target = BOB,
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("a `target` tag cannot aim a balance read",
       decoded and decoded.Account == ALICE, json.encode(decoded))
  end

  -- The forged signer ---------------------------------------------------------

  -- Every message carries an unsigned hmac commitment alongside its signature.
  -- One with the hmac ALONE plus an Address tag must not be read as the game.
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { hmac = { committer = GAME, alg = "hmac-sha256" } },
      Action = "Mint", Recipient = ALICE, Quantity = "1000000",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    -- This once minted a million Rune. An hmac names whoever it claims to;
    -- only a signature proves it, so the mint must refuse this outright.
    ok("an hmac-only commitment cannot mint",
       decoded and decoded.error ~= nil, json.encode(decoded))
    local after = send(OWNER, { Action = "Info" })
    ok("and the supply is untouched by the attempt",
       num(after.TotalSupply) == 140, after.TotalSupply)
  end

  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      Action = "Mint", Recipient = ALICE, Quantity = "1000000", Address = GAME, From = GAME,
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("an Address tag cannot impersonate the minter",
       decoded and decoded.error == "Not authorised", json.encode(decoded))
  end

  -- An hmac-only commitment must not be able to spend a balance either.
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { hmac = { committer = ALICE, alg = "hmac-sha256" } },
      Action = "Transfer", Recipient = BOB, Quantity = "10",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("an hmac-only commitment cannot spend somebody's balance",
       decoded and decoded.error ~= nil, json.encode(decoded))
  end

  -- Burning is the deposit half -----------------------------------------------

  -- Expectations are computed from the balance immediately before, not written
  -- in as literals: an earlier assertion changing by five should not look like
  -- a burn bug.
  do
    local before = send(BOB, { Action = "Balance" })
    local supplyBefore = send(OWNER, { Action = "Info" })
    r = send(BOB, { Action = "Burn", Quantity = "10" })
    ok("a holder burns their own on deposit",
       r and num(r.Balance) == num(before.Balance) - 10, json.encode(r))
    ok("supply falls with the burn",
       r and num(r.TotalSupply) == num(supplyBefore.TotalSupply) - 10, r and r.TotalSupply)
  end

  r = send(ALICE, { Action = "Burn", Account = BOB, Quantity = "5" })
  ok("a stranger cannot burn somebody else's", errOf(r) == "Not authorised", json.encode(r))

  do
    local before = send(BOB, { Action = "Balance" })
    r = send(GAME, { Action = "Burn", Account = BOB, Quantity = "10" })
    ok("the game can burn from an account",
       r and num(r.Balance) == num(before.Balance) - 10, json.encode(r))
  end

  r = send(BOB, { Action = "Burn", Quantity = "9999" })
  ok("burning more than you hold is refused", errOf(r) ~= nil, json.encode(r))

  -- The books balance ---------------------------------------------------------

  local info = send(OWNER, { Action = "Info" })
  local balances = send(OWNER, { Action = "Balances" })
  local sum = 0
  for _, v in pairs(balances) do sum = sum + num(v) end
  ok("every Rune is held by somebody",
     sum == num(info.TotalSupply), sum .. " vs " .. info.TotalSupply)
  ok("supply is exactly what was minted less what was burned",
     num(info.TotalSupply) == num(info.Minted) - num(info.Burned),
     info.Minted .. " - " .. info.Burned .. " = " .. info.TotalSupply)

  -- A zeroed balance leaves the book rather than sitting at "0". Spend exactly
  -- what is there, whatever the preceding assertions left behind.
  local held = send(ALICE, { Action = "Balance" })
  r = send(ALICE, { Action = "Transfer", Recipient = BOB, Quantity = held.Balance })
  balances = send(OWNER, { Action = "Balances" })
  ok("a spent-out account is dropped, not left at zero",
     balances[ALICE] == nil, json.encode(balances))

  -- A commitment as a LIVE NODE actually spells it -----------------------------
  --
  -- The harness writes `alg`; a real node writes `type` and no `alg` at all.
  -- Reading only one of them means the token works perfectly in this suite and
  -- refuses every transfer in production, which is precisely what happened to
  -- the game process.
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = {
        sig = { committer = GAME, type = "rsa-pss-sha512", keyid = "publickey:xyz" },
        hmac = { type = "hmac-sha256", keyid = "constant:ao" },
      },
      Action = "Mint", Recipient = BOB, Quantity = "7",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("a commitment spelled `type` (as a live node sends it) is accepted",
       decoded and decoded.error == nil, json.encode(decoded))
  end

  do
    -- And the forgery is still refused when spelled that way too.
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { hmac = { committer = GAME, type = "hmac-sha256" } },
      Action = "Mint", Recipient = BOB, Quantity = "1000000",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("an hmac spelled `type` still cannot mint",
       decoded and decoded.error ~= nil, json.encode(decoded))
  end

  -- The standard surface ------------------------------------------------------

  r = send(OWNER, { Action = "Total-Supply" })
  ok("Total-Supply answers under its standard name",
     r and r.Data == r.TotalSupply and r.Ticker == "TEST-RUNE", json.encode(r))

  do
    -- A Credit-Notice carries the X- tags that say why the payment was made.
    -- That is the mechanism the whole ecosystem uses for transfer-with-intent.
    send(GAME, { Action = "Mint", Recipient = ALICE, Quantity = "20" })
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      Action = "Transfer", Recipient = BOB, Quantity = "1",
      ["X-Reason"] = "tribute", ["X-Order"] = "42",
    }, timestamp = T }, {})
    local notice = res.results.outbox and res.results.outbox["credit-notice"]
    ok("a credit notice is emitted to the recipient",
       notice ~= nil and notice.target == BOB and notice.Action == "Credit-Notice",
       notice and json.encode(notice))
    ok("and it forwards the X- tags",
       notice and notice["X-Reason"] == "tribute" and notice["X-Order"] == "42",
       notice and json.encode(notice))
    local debit = res.results.outbox and res.results.outbox["debit-notice"]
    ok("and the sender gets a debit notice",
       debit ~= nil and debit.target == ALICE and debit.Action == "Debit-Notice",
       debit and json.encode(debit))
  end

  do
    -- `Cast` means "move it, but do not notify anyone".
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      Action = "Transfer", Recipient = BOB, Quantity = "1", Cast = "true",
    }, timestamp = T }, {})
    local box = res.results.outbox or {}
    local n = 0
    for _ in pairs(box) do n = n + 1 end
    ok("Cast suppresses the notices", n == 0, n)
    ok("but the Rune still moves",
       json.decode(res.results.output.data).Action == "Transfer-Success",
       res.results.output.data)
  end

  do
    -- A refused transfer answers with a standard <Action>-Error too, so a
    -- caller that speaks only token can tell what went wrong.
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = ALICE, alg = "rsa-pss-sha512" } },
      Action = "Transfer", Recipient = BOB, Quantity = "999999",
    }, timestamp = T }, {})
    local err = res.results.outbox and res.results.outbox["error-notice"]
    ok("a refused transfer emits Transfer-Error",
       err ~= nil and err.Action == "Transfer-Error" and err.Error ~= nil,
       err and json.encode(err))
  end

  -- Integers stay integers ----------------------------------------------------

  do
    local _, res = send(GAME, { Action = "Mint", Recipient = ALICE, Quantity = "3" })
    local text = res.results.output.data
    ok("no float leaks into a reply", text:match("[%d]%.[%d]") == nil, text:sub(1, 120))
    ok("the published supply is an integer",
       tostring(res.totalsupply):match("%.") == nil, res.totalsupply)
    ok("the per-holder key is published",
       res["balance-" .. ALICE] ~= nil, res["balance-" .. ALICE])
    -- `info` is a name every HyperBEAM device already owns, so publishing
    -- under it is publishing into a void: the device answers first and the
    -- caller gets an HTML page at status 200. Measured on a live node.
    ok("identity is published as `tokeninfo`, not the reserved `info`",
       res.tokeninfo ~= nil and res.info == nil,
       "tokeninfo=" .. tostring(res.tokeninfo ~= nil) .. " info=" .. tostring(res.info))
  end

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- A runtime error inside the suite comes back from the node as a bare
--- `500 Oops` naming nothing, so catch it here and report it as a line of
--- output like any other failure.
function runetest(base, req)
  local ok, res = pcall(run, base, req)
  if ok then return res end
  return "ERROR: " .. tostring(res)
end
