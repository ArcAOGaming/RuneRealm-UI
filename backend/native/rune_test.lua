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

  -- Numeric, NOT ipairs. `compute` ends with `collectgarbage("collect")`, and
  -- Luerl kills the VM if a collect runs while an ipairs iterator is open on
  -- the stack -- it was this loop that found it. The account is at the end of
  -- `compute` in game.lua.
  local badQuantities = { "0", "-5", "1.5", "abc", "" }
  for qi = 1, #badQuantities do
    local bad = badQuantities[qi]
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

  -- A mint tells the minter it happened --------------------------------------
  --
  -- The game deducts a player's in-game runes and asks for the mint in the same
  -- message, and then cannot see whether it landed — a Lua process cannot
  -- fetch. Without this notice every withdrawal stayed `pending` for good and
  -- closing one meant an owner doing it by hand.
  do
    local WHO = "NOTIFYnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { sig1 = { committer = GAME, alg = "rsa-pss-sha512" } },
      Action = "Mint", Recipient = WHO, Quantity = "12", Reference = "w42",
    }, timestamp = T }, {})

    local outbox = res.results and res.results.outbox
    local notice = outbox and outbox["mint-notice"]
    ok("a mint notifies the minter", notice ~= nil, outbox and json.encode(outbox))
    ok("aimed back at the game, not the recipient",
       notice and notice.target == GAME, notice and notice.target)
    ok("naming the handler the game declares",
       notice and notice.Action == "Rune.Minted", notice and notice.Action)
    -- The withdrawal's own id, carried back untouched. It is what lets the game
    -- match the confirmation to the row it deducted, and what makes a repeated
    -- delivery recognisable rather than settled twice.
    ok("carrying the withdrawal reference back",
       notice and notice.Reference == "w42", notice and notice.Reference)
    ok("and the amount actually minted",
       notice and notice.Quantity == "12", notice and notice.Quantity)
    -- Mint deliberately emits NO credit-notice, and this asserts the absence
    -- so it cannot be re-added by someone reading the token standard.
    --
    -- Mint always pays a PLAYER WALLET, and a wallet is not a process. Pushing
    -- a wallet-targeted message answers 404, that sub-message lands in the push
    -- result map, and normalising it for the cache dies in hb_cache:write -- so
    -- every push of a SUCCESSFUL withdrawal returned HTTP 500 after both hops
    -- had already landed. The client read the 500 as failure and retried, and a
    -- retry re-runs Mint: a measured 80 Rune deducted in-game became 224 minted.
    -- Credit-Notice is only ever consumed by the AMM, and only from a Transfer
    -- whose target IS a process. Transfer still emits it; Mint must not.
    ok("mint emits no wallet-targeted credit-notice",
       outbox and outbox["credit-notice"] == nil, outbox and json.encode(outbox))
    ok("and the mint-notice is the only outbox entry",
       outbox and next(outbox, next(outbox)) == nil, outbox and json.encode(outbox))
  end

  -- A delivery is signed by the SCHEDULER, not by the sending process ---------
  --
  -- The second half of the same live incident. Once the action name matched,
  -- the token still refused the mint: a pushed message arrives carrying the
  -- SCHEDULER's signature, `provenSigner` returned the scheduler, the scheduler
  -- is not the minter, and the game had already deducted the player's runes.
  -- The scheduler's address even accrued in `balances` as a phantom account.
  --
  -- A signature on a delivery attests transport, not authorship. These pin all
  -- three cases, because getting the middle one wrong destroys value and
  -- getting the last one wrong hands the mint to anybody.
  do
    local SCHED = "SCHEDULERssssssssssssssssssssssssssssssssss"
    local VICTIM = "VICTIMvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv"

    --- Drive compute with a process state that names our scheduler, the way a
    --- live node presents it.
    local function deliver(committer, fromProcess, tags)
      T = T + 1000
      local body = {
        commitments = { sig1 = { committer = committer, alg = "rsa-pss-sha512" } },
        ["from-process"] = fromProcess,
      }
      for k, v in pairs(tags) do body[k] = v end
      local res = compute(
        { process = PROCESS, ["scheduler-location"] = SCHED },
        { body = body, timestamp = T }, {}
      )
      return json.decode(res.results.output.data)
    end

    local before = num(send(GAME, { Action = "Total-Supply" }).TotalSupply)

    -- 1. Our scheduler vouching for the game: this is a real delivery.
    local ok1 = deliver(SCHED, GAME, { Action = "Mint", Recipient = VICTIM, Quantity = "9" })
    ok("a scheduler-signed delivery mints for the game it names",
       errOf(ok1) == nil and ok1.Balance == "9", json.encode(ok1))

    -- 2. Someone else's wallet signature carrying a from-process tag. The tag is
    --    a claim about itself and must be inert, or the mint is public.
    local forged = deliver(ALICE, GAME, { Action = "Mint", Recipient = ALICE, Quantity = "1000000" })
    ok("a wallet cannot forge from-process to mint",
       errOf(forged) ~= nil, json.encode(forged))

    -- 3. The scheduler vouching for a process that is NOT the minter.
    local wrong = deliver(SCHED, ALICE, { Action = "Mint", Recipient = ALICE, Quantity = "50" })
    ok("a scheduler-signed delivery from a non-minter is still refused",
       errOf(wrong) ~= nil, json.encode(wrong))

    -- 4. The scheduler must never become an account in its own right.
    local sched = deliver(SCHED, GAME, { Action = "Balance", Recipient = SCHED })
    ok("the scheduler holds nothing",
       sched and (sched.Balance == "0" or sched.Balance == nil), json.encode(sched))

    local after = num(send(GAME, { Action = "Total-Supply" }).TotalSupply)
    ok("only the legitimate delivery moved supply", after == before + 9,
       string.format("%d -> %d", before, after))
  end

  -- An action's CASE must not decide whether value moves ----------------------
  --
  -- This is a regression, and it cost a real rune on a live process. The game's
  -- `Rune.Withdraw` deducts the player's balance and then asks this token to
  -- mint, through the outbox, with `action = "mint"`. The dispatcher looked up
  -- the exact string, `H` holds `Mint`, and the answer was "unknown action".
  -- The deduction had already happened. The rune was destroyed.
  --
  -- Nothing between two processes preserves the case of a value, so a token
  -- that only answers one capitalisation will eventually eat somebody's
  -- balance. Every spelling of every verb that moves value is checked here.
  do
    local CASE = "CASEcccccccccccccccccccccccccccccccccccccc"
    --- Whole-number balance of `who`, read the way the suite reads any reply.
    local function heldBy(who)
      local reply = send(who, { Action = "Balance" })
      return math.tointeger(tonumber(reply and reply.Balance) or 0) or 0
    end
    local before = heldBy(CASE)

    local r1 = send(GAME, { Action = "mint", Recipient = CASE, Quantity = "7" })
    ok("a lowercase 'mint' from the game is honoured", errOf(r1) == nil, json.encode(r1))
    local afterLower = heldBy(CASE)
    ok("and it actually credited", afterLower == before + 7, afterLower)

    local r2 = send(GAME, { Action = "MINT", Recipient = CASE, Quantity = "3" })
    ok("a shouted 'MINT' is honoured too", errOf(r2) == nil, json.encode(r2))

    -- The exact name must still win, and the case-insensitive fallback must not
    -- have made an unknown verb resolve to something that happens to be close.
    local r3 = send(GAME, { Action = "Mint", Recipient = CASE, Quantity = "1" })
    ok("the declared spelling still works", errOf(r3) == nil, json.encode(r3))
    local r4 = send(GAME, { Action = "minty", Recipient = CASE, Quantity = "1" })
    ok("a verb that does not exist is still refused", errOf(r4) ~= nil, json.encode(r4))

    local total = heldBy(CASE)
    ok("every spelling moved exactly what it said", total == before + 11, total)

    -- And authority is unchanged by any of it: a non-minter is still refused
    -- however they spell it.
    local r5 = send(ALICE, { Action = "mint", Recipient = ALICE, Quantity = "1000" })
    ok("case-insensitivity does not grant anyone authority",
       errOf(r5) ~= nil, json.encode(r5))
  end

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
function runetest(base, req)
  return run(base, req)
end
