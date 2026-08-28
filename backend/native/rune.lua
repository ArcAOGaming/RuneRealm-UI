--- rune.lua — the Rune token.
---
--- A process of its own, separate from the game, so Rune is a real transferable
--- asset rather than a number inside somebody's save file. It speaks the
--- ordinary token actions — `Info`, `Balance`, `Balances`, `Transfer` — so any
--- wallet or explorer that knows how to talk to a token can talk to this one.
---
--- Supply is not pre-mined. It starts at ZERO and every Rune in existence got
--- here the same way: a player earned it in the game and asked to withdraw it.
--- The game holds the only mint, and burning is how Rune goes back in:
---
---   earned in game ──► in-game balance ──withdraw──► minted here, circulating
---                            ▲                              │
---                            └──────────deposit──────────────┘
---                                    (burned here)
---
--- That is why `Mint` and `Burn` answer only the game process. The game is the
--- reserve: the in-game balances it holds and the supply circulating here are
--- two halves of one number, and no third party can move either.
---
--- Denomination is 0 — deliberately. A Rune buys one quest or one arena
--- session; a thousandth of a Rune is not a thing the game can express. Whole
--- units also keep every number here an integer, and integers are the one thing
--- to stay careful about on Luerl (see the `int` note below).
---
--- Deployed exactly like the game process: bundled after hyper-aos.lua and
--- jsonenc.lua, with its own `compute()` replacing the one hyper-aos installs.
---
--- What it follows from the token standard
--- ---------------------------------------
--- `Info`, `Balance`, `Balances`, `Total-Supply`, `Transfer`, `Mint`, `Burn`,
--- spelled the standard way including the hyphen. `Recipient` and `Quantity`
--- as the transfer tags. Balances as decimal STRINGS, not numbers. A
--- `Credit-Notice` to the recipient and a `Debit-Notice` to the sender, both
--- forwarding every `X-` tag so a payment can carry its reason. `Cast` to
--- suppress those notices. A refused action answers `<Action>-Error` with an
--- `Error` tag and the `Message-Id`.
---
--- Where it deliberately differs, and why
--- -------------------------------------
---   * `Denomination` is 0, not 12. A Rune buys one quest or one arena session
---     and does not divide. Whole units also keep every number an integer,
---     which on Luerl is worth going out of the way for.
---
---   * `Mint` answers the GAME process, not the owner. The standard mints to
---     whoever deployed it; here every Rune must be backed by one deducted from
---     an in-game balance, so the owner minting freely would break the peg.
---     `Burn` is the same operation in reverse and is gated the same way.
---
---   * `Balance` does not read a `Target` tag, which the standard allows. An
---     ANS-104 data item carries a lowercase `target` holding this process's own
---     id, so a tag by that name is ambiguous by the time a handler sees it —
---     the mistake that made every per-player read path in the game 404.
---     `Account` and `Recipient` both work.
---
---   * Authentication is signature-only, which the standard does not specify.
---     See `provenSigner`: an hmac commitment naming the game once minted a
---     million Rune in a test, and a token cannot afford a lenient resolver.

-- Configuration --------------------------------------------------------------

--- Assigned, not defaulted. hyper-aos presets `Name = "aos"` as it loads, so
--- the usual `Name = Name or "Rune"` inherits "aos" and the token introduces
--- itself under the wrong name forever. There is no case where an inherited
--- identity is the right one: this process IS Rune.
---
--- `TEST-` is a repo rule while the rebuild is unreleased (see CLAUDE.md): a
--- token minted into a real wallet cannot be recalled, and the implementation
--- underneath this is not settled yet. Dropping the prefix is a release step.
Name = "TEST-Rune"
Ticker = "TEST-RUNE"
Denomination = 0
Logo = Logo or ""

--- address -> whole Runes. Absent means zero; a balance is never stored as 0,
--- so `Balances` stays the list of people who actually hold something.
Balances = Balances or {}

--- Everything ever minted, minus everything ever burned. Recomputed from the
--- balances would be equivalent; kept as a counter so `/now/totalsupply` is a
--- read rather than a walk.
TotalSupply = TotalSupply or 0

--- Running totals, so the reserve can be audited from outside without
--- replaying the whole message history.
Minted = Minted or 0
Burned = Burned or 0

--- The game process, and the ONLY address that may mint or burn. Empty until
--- the owner sets it, and mint/burn refuse while it is empty rather than
--- falling back to the owner — an unset minter is a deploy that is not
--- finished, not a licence for the deployer to print.
Minter = Minter or ""

-- Helpers --------------------------------------------------------------------

--- Luerl's `tonumber` returns a float and every tag arrives as a string, so an
--- unnarrowed conversion turns 25 into 25.0 and serialises it "25.00000000000".
--- Every number this process stores goes through here.
local function int(v, default)
  if v == nil then return default end
  local n = tonumber(v)
  if not n then return default end
  return math.tointeger(n) or default
end

--- A quantity that is safe to move: a positive whole number and nothing else.
--- Returns nil with a reason, because "0" and "-5" and "abc" and "1.5" all need
--- to be refused and the caller deserves to know which.
local function quantity(v)
  if v == nil or v == "" then return nil, "Quantity is required" end
  local n = tonumber(v)
  if not n then return nil, "Quantity must be a number" end
  if n ~= math.floor(n) then return nil, "Rune does not divide: use a whole number" end
  n = math.tointeger(n)
  if not n then return nil, "Quantity is out of range" end
  if n <= 0 then return nil, "Quantity must be positive" end
  return n
end

local function balanceOf(address)
  return int(Balances[address], 0)
end

local function credit(address, amount)
  local next = balanceOf(address) + amount
  Balances[address] = next > 0 and next or nil
end

--- The signer, resolved the same way the game resolves it, and for the same
--- reason: every message carries an unsigned hmac commitment alongside its
--- signature, so preferring a real signature is what stops a crafted message
--- with the hmac alone plus an `Address` tag being treated as somebody else.
--- Once ANY commitment is present a tag is never consulted.
local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }

local function signer(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) == "table" then
    local fallbackCommitter, sawAny = nil, false
    for _, commitment in pairs(c) do
      sawAny = true
      if type(commitment) == "table" and commitment.committer then
        if SIGNATURE_ALGS[commitment.type or commitment.alg] then return commitment.committer end
        fallbackCommitter = fallbackCommitter or commitment.committer
      end
    end
    if sawAny then return fallbackCommitter end
  end
  -- No commitments at all: only reachable from the test harness, which a
  -- scheduler will not accept.
  return msg.Address or msg.From
end

--- The signer, and ONLY from a real signature.
---
--- `signer` above prefers a signature but settles for any commitment that names
--- somebody, which is right for the game: it keeps a read working against
--- whatever a node actually attaches. It is NOT right here, and a test caught
--- why. Every message carries an unsigned hmac commitment alongside its
--- signature, and a crafted message carrying the hmac ALONE, with the game
--- process named as its committer, was accepted as the game — and minted a
--- million Rune. An hmac names whoever it claims to; only a signature proves it.
---
--- So everything that moves value or grants authority resolves the caller
--- through here, and an unsigned message resolves to nobody and is refused.
--- Reads may stay lenient; there is nothing to steal in a balance lookup.
---
--- The algorithm is spelled `type` on the wire and `alg` in the test harness,
--- and BOTH have to be read. A real commitment from a live node carries
---
---   type=rsa-pss-sha512  committer=<address>  keyid=publickey:...
---   type=hmac-sha256     keyid=constant:ao
---
--- and no `alg` field at all. Checking only `alg` identifies nobody on a live
--- node, which for this file would mean every transfer, mint and burn refused
--- — while the whole suite passed, because the harness writes `alg`. The game
--- process had exactly that defect and it made the game unplayable.
---
--- This fails CLOSED either way. If a node ever attaches a signature under an
--- algorithm not listed above, transfers and mints stop working — visibly, on
--- the first attempt — rather than quietly accepting forgeries. That is the
--- correct way around for a token: verify against a real signed message after
--- any node change, and add the algorithm here if one is missing.
local function provenSigner(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) ~= "table" then
    -- No commitments at all: the test harness only. A scheduler will not
    -- accept such a message, so this cannot be reached in production.
    return msg.Address or msg.From
  end
  for _, commitment in pairs(c) do
    if type(commitment) == "table" and commitment.committer
       and SIGNATURE_ALGS[commitment.type or commitment.alg] then
      return commitment.committer
    end
  end
  return nil
end

--- The actor allowed to move value.
---
--- A process id has no private key, so a message emitted through
--- process-outbox@1.0 cannot carry an RSA signature from that process. The
--- scheduler instead attests its origin in `from-process`. Prefer a real wallet
--- signature whenever one exists; that makes a user-supplied `from-process`
--- tag inert, because the signer remains the payer. Only an unsigned outbox
--- delivery falls through to the process identity, and it can still spend only
--- that process's own balance.
local function actor(msg)
  local signed = provenSigner(msg)
  if signed then return signed end
  return msg["from-process"] or msg.FromProcess
end

local function isOwner(address)
  return Owner ~= nil and Owner ~= "" and address ~= nil and address == Owner
end

local function isMinter(address)
  return Minter ~= nil and Minter ~= "" and address ~= nil and address == Minter
end

-- Reply shaping ---------------------------------------------------------------

local function reply(base, value)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  return base
end

local function fail(base, message)
  base.results = { output = { data = encode({ error = message }) } }
  return base
end

--- The standard answers a refused action with an `<Action>-Error` message
--- carrying an `Error` tag, so a caller that speaks token and nothing else can
--- tell what happened. This keeps the JSON body too, which is what this
--- project's own client reads.
local function failStandard(base, action, message, msg)
  base.results = {
    output = { data = encode({ error = message }) },
    outbox = {
      ["error-notice"] = {
        target = msg and (msg.From or msg.Address) or nil,
        Action = action .. "-Error",
        Error = message,
        ["Message-Id"] = msg and (msg.Id or msg.id) or nil,
      },
    },
  }
  return base
end

--- `X-` tags ride along on a Credit-Notice: that is how a recipient process is
--- told WHY it was paid, and it is the mechanism the whole token ecosystem uses
--- for "transfer with intent". Copy every one of them onto the notice.
local function forwarded(msg)
  local out = {}
  for k, v in pairs(msg) do
    local key = tostring(k)
    if key:sub(1, 2) == "X-" or key:sub(1, 2) == "x-" then out[key] = v end
  end
  return out
end

--- The standard lets a sender set `Cast` to say "move it, but do not bother
--- notifying anyone". Honour it.
local function isCast(msg)
  local c = msg.Cast
  return c ~= nil and c ~= "" and c ~= "false"
end

--- Balances are published as strings, which is what every other token on this
--- network does and what a client parsing them will expect. Internally they are
--- integers; only the wire representation is a string.
local function asString(n)
  return string.format("%d", int(n, 0))
end

local function balancesView()
  local out = {}
  for address, amount in pairs(Balances) do
    local n = int(amount, 0)
    if n > 0 then out[address] = asString(n) end
  end
  return out
end

local function infoView()
  return {
    Name = Name,
    Ticker = Ticker,
    Denomination = asString(Denomination),
    Logo = Logo,
    TotalSupply = asString(TotalSupply),
    Minted = asString(Minted),
    Burned = asString(Burned),
    Minter = Minter,
    Owner = Owner or "",
  }
end

-- Handlers ---------------------------------------------------------------------

local H = {}

H["Info"] = function(base)
  return reply(base, infoView())
end

--- A balance. Defaults to the caller's own, which is what a wallet wants;
--- `Account` names somebody else's, which is public information anyway — every
--- balance is already readable at `/now/balances`.
---
--- `Target` is NOT read here and must never be: an ANS-104 data item carries a
--- lowercase `target` field holding this process's own id, and a tag by that
--- name is ambiguous by the time a handler sees it. That mistake made every
--- per-player read path in the game 404 while the aggregate ones looked fine.
H["Balance"] = function(base, msg)
  local address = msg.Account or msg.Recipient or signer(msg)
  if not address then return fail(base, "No address") end
  return reply(base, {
    Account = address,
    Balance = asString(balanceOf(address)),
    Ticker = Ticker,
  })
end

H["Balances"] = function(base)
  return reply(base, balancesView())
end

--- The standard spells this `Total-Supply`, hyphen and all. It is also in
--- `Info`; both exist because a caller written against the standard will ask
--- for this one by name.
H["Total-Supply"] = function(base)
  return reply(base, {
    Action = "Total-Supply",
    Data = asString(TotalSupply),
    TotalSupply = asString(TotalSupply),
    Ticker = Ticker,
  })
end

--- Move Rune between two holders.
---
--- The sender is the SIGNER, never a tag: a token that let a tag name the payer
--- would let anyone spend anyone's balance.
H["Transfer"] = function(base, msg)
  local from = actor(msg)
  if not from then return failStandard(base, "Transfer", "Unsigned messages cannot move Rune", msg) end

  local to = msg.Recipient
  if type(to) ~= "string" or to == "" then return failStandard(base, "Transfer", "Recipient is required", msg) end
  if to == from then return failStandard(base, "Transfer", "Cannot transfer to yourself", msg) end

  local amount, why = quantity(msg.Quantity)
  if not amount then return failStandard(base, "Transfer", why, msg) end

  local held = balanceOf(from)
  if held < amount then
    return failStandard(base, "Transfer",
      "Insufficient balance: you hold " .. asString(held), msg)
  end

  credit(from, -amount)
  credit(to, amount)

  -- Both sides of the move, so a recipient process can act on being paid and a
  -- sender's wallet can confirm what left. Delivery of these is the scheduler's
  -- business, not this handler's; the balances above are already final.
  local outbox = {}
  if not isCast(msg) then
    -- Both sides of the move: a recipient process can act on being paid and a
    -- sender's wallet can confirm what left. The `X-` tags ride on the credit
    -- notice, which is how a payment carries its reason.
    local debit = {
      target = from, Action = "Debit-Notice",
      Recipient = to, Quantity = asString(amount),
    }
    local credit_ = {
      target = to, Action = "Credit-Notice",
      Sender = from, Quantity = asString(amount),
    }
    for k, v in pairs(forwarded(msg)) do
      debit[k] = v
      credit_[k] = v
    end
    outbox["debit-notice"] = debit
    outbox["credit-notice"] = credit_
  end

  base.results = {
    output = { data = encode({
      Action = "Transfer-Success",
      From = from, Recipient = to,
      Quantity = asString(amount),
      Balance = asString(balanceOf(from)),
    }) },
    outbox = outbox,
  }
  return base
end

--- Bring Rune into circulation. The game only.
---
--- This is the withdraw half of the bridge: a player asked the game for their
--- earned Rune, the game deducted it from their in-game balance, and this is
--- the same Rune arriving here. Nothing else may call it, because every Rune
--- minted without a matching in-game deduction is a Rune backed by nothing.
H["Mint"] = function(base, msg)
  local from = actor(msg)
  if not isMinter(from) then
    return fail(base, Minter == "" and "No minter is configured" or "Not authorised")
  end

  local to = msg.Recipient
  if type(to) ~= "string" or to == "" then return fail(base, "Recipient is required") end

  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end

  credit(to, amount)
  TotalSupply = TotalSupply + amount
  Minted = Minted + amount

  base.results = {
    output = { data = encode({
      Action = "Mint-Success",
      Recipient = to,
      Quantity = asString(amount),
      Balance = asString(balanceOf(to)),
      TotalSupply = asString(TotalSupply),
    }) },
    outbox = {
      ["credit-notice"] = {
        target = to, Action = "Credit-Notice",
        Sender = from, Quantity = asString(amount), ["X-Reason"] = "withdraw",
      },
    },
  }
  return base
end

--- Take Rune out of circulation.
---
--- Two callers, one meaning. A HOLDER burning their own is the deposit half of
--- the bridge — they are handing it back to the game, which credits their
--- in-game balance. The GAME may also burn from a named account, which is the
--- same operation initiated from the other side.
---
--- A holder burning their own Rune with no game listening would destroy it for
--- nothing, so this refuses unless a minter is configured: there is no
--- legitimate burn while the other half of the bridge does not exist.
H["Burn"] = function(base, msg)
  local from = actor(msg)
  if not from then return fail(base, "Unsigned messages cannot burn Rune") end
  if Minter == "" then return fail(base, "No minter is configured") end

  local account = from
  if msg.Account and msg.Account ~= from then
    if not isMinter(from) then return fail(base, "Not authorised") end
    account = msg.Account
  end

  local amount, why = quantity(msg.Quantity)
  if not amount then return fail(base, why) end

  local held = balanceOf(account)
  if held < amount then
    return fail(base, "Insufficient balance: " .. account .. " holds " .. asString(held))
  end

  credit(account, -amount)
  TotalSupply = TotalSupply - amount
  Burned = Burned + amount

  base.results = {
    output = { data = encode({
      Action = "Burn-Success",
      Account = account,
      Quantity = asString(amount),
      Balance = asString(balanceOf(account)),
      TotalSupply = asString(TotalSupply),
    }) },
    -- The game needs to hear about a burn it did not initiate: that is a
    -- player depositing, and it is what tells the game to credit them.
    outbox = {
      ["burn-notice"] = {
        target = Minter, Action = "Burn-Notice",
        Account = account, Quantity = asString(amount),
      },
    },
  }
  return base
end

--- Name the game process. Owner only, and once it is set changing it moves the
--- mint — so it says plainly what it replaced.
H["Admin.SetMinter"] = function(base, msg)
  local from = provenSigner(msg)
  if not isOwner(from) then return fail(base, "Not authorised") end
  local next = msg.Minter or msg.PlayerId
  if type(next) ~= "string" or #next ~= 43 then
    return fail(base, "Minter must be a 43-character process id")
  end
  local previous = Minter
  Minter = next
  return reply(base, { Minter = Minter, previous = previous })
end

-- The process ------------------------------------------------------------------

--- Tag names become HTTP headers and headers are lowercased, so a handler
--- reading `msg.Recipient` has to find `recipient` too. These envelope fields
--- are excluded because they would shadow a tag a handler actually reads —
--- `target` above all, which every data item carries.
local ENVELOPE = {
  target = true, id = true, owner = true, signature = true, anchor = true,
  commitments = true, from = true, type = true, variant = true,
  path = true, method = true, slot = true, device = true, nonce = true,
  epoch = true, accept = true, scheduler = true,
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

--- The spawner, read off the process definition's own commitment.
---
--- hyper-aos presets `Owner = Owner or ""` when it loads, and "" is truthy in
--- Lua, so `if Owner then return Owner end` would resolve nothing and every
--- owner-only action would be refused. This file replaces `compute()` wholesale
--- besides, so hyper-aos's own owner resolution never runs at all.
local function resolveOwner(base)
  if Owner and Owner ~= "" then return Owner end
  local p = base and (base.process or base.Process)
  if type(p) == "table" then
    local c = p.commitments or p.Commitments
    if type(c) == "table" then
      local fallback = nil
      for _, commitment in pairs(c) do
        if type(commitment) == "table" and commitment.committer then
          if SIGNATURE_ALGS[commitment.type or commitment.alg] then
            Owner = commitment.committer
            return Owner
          end
          fallback = fallback or commitment.committer
        end
      end
      if fallback then Owner = fallback end
    end
  end
  return Owner
end

function compute(base, req, opts)
  resolveOwner(base)

  local msg = (req and req.body) or {}
  local tags = caseInsensitive(msg.Tags or msg)
  local action = tags.Action or tags.action or "none"

  local handler = H[action]
  local result
  if not handler then
    local names = {}
    for k in pairs(H) do names[#names + 1] = k end
    table.sort(names)
    result = fail(base, "unknown action '" .. tostring(action) ..
      "'. known: " .. table.concat(names, ", "))
  else
    local ok, out = pcall(function() return handler(base, tags) end)
    result = ok and out or fail(base, tostring(out))
  end

  -- Published state: the read path.
  --
  -- There is no dryrun here, so anything a client wants without signing has to
  -- be written as a flat key and fetched with an unsigned GET of
  --   /<pid>~process@1.0/now/<key>
  -- NOT `info`: that name is taken. Every HyperBEAM device exposes its own
  -- `info`, so `/<pid>~process@1.0/now/info` is answered by the device and this
  -- value is never reached — the node serves its landing page at status 200 and
  -- a caller parses HTML. `ticker`, `minter`, `totalsupply` and `balances` all
  -- resolve fine; it is specifically `info` that collides. Same family as the
  -- `Target` tag: a name the platform already owns.
  result.tokeninfo = encode(infoView())
  result.balances = encode(balancesView())
  result.totalsupply = asString(TotalSupply)
  result.ticker = Ticker
  result.minter = Minter

  -- One holder's balance, addressable without pulling the whole book:
  -- `/now/balance-<address>`. Only the accounts this message touched are
  -- rewritten — the full table would be republished on every transfer for the
  -- benefit of almost nobody.
  local function publish(address)
    if type(address) ~= "string" or address == "" then return end
    result["balance-" .. address] = asString(balanceOf(address))
  end
  publish(signer(msg))
  publish(tags.Recipient)
  publish(tags.Account)

  return result
end
