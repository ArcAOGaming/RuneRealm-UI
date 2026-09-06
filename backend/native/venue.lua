--- venue.lua -- an order book that holds what it trades.
---
--- ONE file, TWO deployments, and the difference between them is where value
--- comes from and where it goes:
---
---   VenueMode = "internal"
---     Talks to the GAME PROCESS and to nothing else. The assets are in-game
---     assets -- berries, scrolls, Gold, Rune-in-the-game -- and they are NOT
---     tokens and will never be tokens. There is no process behind
---     `fire_berry`; there is a trusted message from the one process allowed
---     to say a player handed some over, and a trusted message back when they
---     take them home. `Assets` here is a list of NAMES.
---
---   VenueMode = "external"
---     Talks to TOKEN PROCESSES and to nothing else. Value arrives as a
---     `Credit-Notice` from a token this venue has listed, and leaves as a
---     `Transfer` back to the depositor's wallet. It never hears from the game
---     and has no verb that could.
---
--- Neither one can be told to behave like the other after it is deployed:
--- `Admin.Seal` freezes the mode, and every custody handler is registered
--- against one mode only. That is the isolation the two-venue design is for --
--- a bug in the token path cannot reach the game's assets, and a compromised
--- game process cannot move somebody's Rune.
---
--- WHAT IS SHARED is `orderbook.lua`, in full: the same registry, the same
--- price-time matching, the same escrow, the same TIF and STP and price band
--- and candles that `game.lua` runs. A trader who learned the book inside the
--- game already knows this one. See ORDERBOOK.md §6.
---
--- CUSTODY IS DEPOSIT-FIRST (ORDERBOOK.md §10). You deposit once, hold a
--- balance here, and orders lock against it. There is no per-order transfer,
--- so placing, amending and cancelling are zero hops; only arriving and
--- leaving cost one.
---
--- THERE IS NO WITHDRAWAL DELAY, deliberately. AO has no fraud-proof window to
--- wait out, so a delay would tax every honest user to buy nothing. What
--- protects the venue instead is an explicit, logged emergency stop that an
--- admin turns on -- and even that leaves ordinary withdrawals open unless the
--- admin names `Scope = "all"`, because the normal emergency is "stop trading
--- and let everyone take their money home".
---
--- Keep this file Luerl-safe: no goto, no table.move, narrow every number
--- through `int`, and never trust a json round-trip to prove an amount is
--- integral.

-- Identity and configuration ---------------------------------------------------

--- "internal" or "external". Nil until configured; every custody verb refuses
--- while it is nil, so a half-deployed venue cannot take anybody's money.
VenueMode = VenueMode or nil

--- Once true, `VenueMode`, `GameProcess` and every listed asset's process id
--- are frozen. Markets may still be created and launched -- that is the point
--- of §5 -- but what backs them cannot change.
VenueSealed = VenueSealed or false

VenueName = VenueName or "TEST-Rune Realm Venue"

--- INTERNAL ONLY: the one process whose word is accepted for a credit, and the
--- only place a withdrawal can go. Empty means "not configured", and every
--- internal custody verb refuses while it is empty.
GameProcess = GameProcess or ""

--- assetId -> row.
---
---   internal  { id, name, kind = "game" }
---   external  { id, name, kind = "token", process, ticker, denomination }
---
--- `id` is what the book calls the asset and what a market names. It is a
--- short slug in both modes, never a process id: a market called
--- `LXgcav_.../yoNoxm_...` is unreadable, and the whole registry exists so a
--- pair can be named once and referred to by name afterwards.
Assets = Assets or {}

--- process id -> assetId, for `Credit-Notice` routing. EXTERNAL ONLY.
--- Derived from `Assets`; kept as its own map because a notice arrives naming
--- the process and a walk of the registry per deposit is a walk per deposit.
AssetByProcess = AssetByProcess or {}

--- account -> asset -> FREE balance. What is locked by a resting order is not
--- here; the book moved it into `Book.pools[asset].escrow` when the order was
--- taken, exactly as it does inside the game.
---
--- An account with nothing is DELETED rather than stored as zero, so this map
--- is the list of people who actually hold something -- the same rule
--- `rune.lua` follows for `Balances`, and for the same reason: a venue that
--- kept a row per wallet it had ever seen would make every future message
--- slower for everyone. See the published-bytes rule in CLAUDE.md.
Ledger = Ledger or {}

--- The order book's own state. `orderbook.lua` owns every field in here.
Book = Book or nil

--- reference -> row. Both directions, both idempotent, and NEITHER is ever
--- trimmed: an aged-out reference is a replayable deposit, which is the one
--- kind of leak that mints value out of nothing. These live in the heap and
--- the snapshot, never in the published map.
Deposits = Deposits or {}
Withdrawals = Withdrawals or {}
WithdrawSeq = WithdrawSeq or 0

--- The emergency stop. `paths` names what is stopped, so the ordinary case --
--- halt trading, let everyone leave -- does not require also freezing the
--- money in order to be used.
Emergency = Emergency or { paused = false, reason = "", scope = "trading", at = 0 }

Owner = Owner or nil

-- Helpers ----------------------------------------------------------------------

--- Luerl's `tonumber` returns a float and every tag arrives as a string, so an
--- unnarrowed conversion turns 25 into 25.0 and stores it that way forever.
--- Every number this process keeps goes through here.
local function int(v, default)
  local narrowed = math.tointeger(tonumber(v))
  if narrowed == nil then return default or 0 end
  return narrowed
end

local function asString(n) return string.format("%d", int(n, 0)) end

--- A quantity that is safe to move: positive, whole, and nothing else.
local function quantity(v)
  if v == nil or v == "" then return nil, "Quantity is required" end
  local n = tonumber(v)
  if not n then return nil, "Quantity must be a number" end
  if n ~= math.floor(n) then return nil, "Quantity must be a whole atomic amount" end
  n = math.tointeger(n)
  if not n then return nil, "Quantity is out of range" end
  if n <= 0 then return nil, "Quantity must be positive" end
  return n
end

local ADDRESS = "^[A-Za-z0-9_-]+$"
local function validId(v)
  return type(v) == "string" and #v == 43 and v:match(ADDRESS) ~= nil
end

--- An asset or market id: a slug we chose, not an address. Bounded so a tag
--- cannot name a megabyte, and restricted so an id can never contain the `/`
--- that separates a market's two halves.
local function validSlug(v)
  return type(v) == "string" and #v >= 1 and #v <= 32
    and v:match("^[a-z0-9_]+$") ~= nil
end

--- Separators do not survive the trip: a browser signs `Tif = "post-only"`, a
--- process emits `post_only`, and HTTP lowercases both. Strip them before
--- comparing. Same rule as `orderbook.lua`'s `mode`; see CLAUDE.md.
local function word(value, fallback)
  if type(value) ~= "string" then return fallback end
  local plain = string.gsub(string.lower(value), "[%-%_%s]", "")
  if plain == "" then return fallback end
  return plain
end

--- A tag by any of its spellings. A name's separators are lost in transit, so
--- `RunId`, `run-id` and `run_id` all have to answer to one lookup -- the
--- defect that cost a live deployment every hunt capture (CLAUDE.md).
local function tag(msg, ...)
  for _, name in ipairs({ ... }) do
    local want = word(name)
    for key, value in pairs(msg) do
      if word(tostring(key)) == want and value ~= nil and value ~= "" then
        return value
      end
    end
  end
  return nil
end

-- Identity ---------------------------------------------------------------------

--- Only a real signature names anybody. An hmac commitment names whoever it
--- claims to, and both halves of that have been exploited in this codebase --
--- see the regression tests in `game_test.lua` and `rune_test.lua`.
---
--- The algorithm is spelled `type` on a live node and `alg` in the test
--- harness, and BOTH have to be read: checking one spelling makes the suite
--- pass and the deployed process refuse every signed action.
local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }

local function provenSigner(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) ~= "table" then
    -- No commitments at all: the in-process harness only. A scheduler will not
    -- accept such a message, so this is unreachable in production.
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

--- This process's own scheduler: the only identity allowed to vouch for
--- another process.
local function schedulerAddress(base)
  if type(base) ~= "table" then return nil end
  local found = base["scheduler-location"] or base.SchedulerLocation
    or base["scheduler_location"]
  if validId(found) then return found end
  local p = base.process or base.Process
  if type(p) == "table" then
    local nested = p["scheduler-location"] or p.SchedulerLocation
      or p["scheduler_location"]
    if validId(nested) then return nested end
  end
  return nil
end

--- The PROCESS a message came from, believed only when this process's own
--- scheduler signed the delivery that carried it.
---
--- A process id has no private key, so a message from another process cannot
--- carry that process's signature; what it carries is `from-process`, and the
--- only question is whether to believe it. A wallet cannot make our scheduler
--- sign a lie about where a message came from, so:
---
---   * signed by our scheduler -> it is a delivery, `from-process` is attested
---   * no proven signature     -> an unsigned delivery, harness only
---   * signed by anyone else   -> an ordinary wallet message; `from-process`
---                                is inert and this returns nobody
local function sourceProcess(msg, base)
  local signed = provenSigner(msg)
  local fromProcess = msg["from-process"] or msg.FromProcess
  local commitments = msg.commitments or msg.Commitments
  local hasCommitments = type(commitments) == "table" and next(commitments) ~= nil
  if not signed then
    if hasCommitments then return nil end
    return fromProcess
  end
  local scheduler = schedulerAddress(base)
  if fromProcess and scheduler and signed == scheduler then return fromProcess end
  return nil
end

--- The wallet acting. A delivery from another process is NOT a wallet action,
--- so this deliberately refuses one: every trading verb belongs to a person.
local function actor(msg, base)
  if sourceProcess(msg, base) then return nil end
  return provenSigner(msg)
end

local function isOwner(address)
  return Owner ~= nil and Owner ~= "" and address ~= nil and address == Owner
end

--- The spawner, read off the process definition's own commitment.
---
--- `Owner or ""` is what a runtime presets, and "" is truthy in Lua -- so a
--- naive `if Owner then` resolves nothing and every owner-only verb refuses
--- forever. Copied from `rune.lua`, including that trap.
---
--- There is no fallback to "the first wallet that spoke", deliberately: on a
--- venue that would mean whoever got there first owns the money.
local function resolveOwner(base)
  if Owner and Owner ~= "" then return Owner end
  local p = base and (base.process or base.Process)
  if type(p) ~= "table" then return Owner end
  local c = p.commitments or p.Commitments
  if type(c) ~= "table" then return Owner end
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
  return Owner
end

-- Reply shaping ----------------------------------------------------------------

local function reply(base, value)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  return base
end

local function fail(base, message)
  base.results = { output = { data = encode({ error = message }) } }
  return base
end

local function replyWith(base, value, outbox)
  base.results = {
    output = { data = type(value) == "string" and value or encode(value) },
    outbox = outbox,
  }
  return base
end

-- Custody ----------------------------------------------------------------------

--- The venue's holding of one asset, in the shape the book expects: what
--- traders hold free (`player`), what resting orders hold (`escrow`), and what
--- could not be paid to anybody (`locked`).
---
--- `player + escrow + locked` is what this venue owes, and for the external
--- venue it must equal what the token says it holds. `supply` publishes both
--- halves so that is a read rather than a promise.
local function pool(asset)
  Book.pools = type(Book.pools) == "table" and Book.pools or {}
  local row = Book.pools[asset]
  if not row then
    row = { player = 0, escrow = 0, locked = 0 }
    Book.pools[asset] = row
  end
  return row
end

local function balanceOf(account, asset)
  local held = Ledger[account]
  return int(held and held[asset], 0)
end

--- Credit free balance. Never called on its own: value only ever enters this
--- process through a deposit, and `deposit` moves the pool with it.
local function creditFree(account, asset, amount)
  amount = int(amount, 0)
  if amount == 0 then return end
  local held = Ledger[account]
  if not held then held = {}; Ledger[account] = held end
  local next_ = int(held[asset], 0) + amount
  if next_ > 0 then held[asset] = next_ else held[asset] = nil end
  if next(held) == nil then Ledger[account] = nil end
end

local function debitFree(account, asset, amount)
  amount = int(amount, 0)
  if amount <= 0 then return true end
  if balanceOf(account, asset) < amount then return false end
  creditFree(account, asset, -amount)
  return true
end

--- The ledger the book trades against.
---
--- `exists` is TRUE for any well-formed address, not only one with a balance:
--- in the game an account is a player record that has to exist first, and here
--- it is simply an address. Making it conditional on holding something would
--- refuse the first buy an account ever places -- the balance check that
--- matters is `balance`, and the book does that separately.
local function venueLedger()
  return {
    kind = "venue",
    exists = function(account) return validId(account) end,
    record = function() return nil end,
    balance = balanceOf,
    debit = debitFree,
    credit = creditFree,
  }
end

--- What is stopped right now, for the book to refuse against.
---
--- Trading is stopped by any pause. Withdrawals are stopped only by a pause
--- that explicitly said so, because the ordinary emergency is "stop trading
--- and let everyone go home" and a stop that traps people's money is a
--- different, much heavier decision. Deposits are NEVER stopped: the value is
--- already inside the contract by then and refusing only loses it.
local function tradingStopped()
  if not Emergency.paused then return nil end
  return tostring(Emergency.reason ~= "" and Emergency.reason or "emergency pause")
end

local function withdrawalsStopped()
  if not Emergency.paused then return nil end
  if word(Emergency.scope, "trading") ~= "all" then return nil end
  return tostring(Emergency.reason ~= "" and Emergency.reason or "emergency pause")
end

local venueHost
local function host()
  if not venueHost then
    venueHost = OrderBook.custodyHost({
      ensure = function(state) return state end,
      ledger = venueLedger(),
      pool = function(_, asset) return pool(asset) end,
      fee = function(_, asset, amount)
        Book.fees = type(Book.fees) == "table" and Book.fees or {}
        Book.fees[asset] = int(Book.fees[asset], 0) + int(amount, 0)
      end,
      --- Only a LISTED asset is tradable. An unlisted one has no pool, no
      --- custody and nowhere for a fill to send it, so a market naming one
      --- could take an order it could never settle.
      tradable = function(_, asset) return Assets[asset] ~= nil end,
      pauseReason = function() return tradingStopped() end,
      -- No `quote`, `settleHouse` or `anchors`: there is no NPC desk here and
      -- there is not going to be one. A process cannot send anything by
      -- itself, so a "process that quotes" is a process somebody has to push
      -- on every tick. The venue opens with an empty ladder and fills when
      -- somebody rests an order, which is what a book is. ORDERBOOK.md §6.
    })
  end
  return venueHost
end

-- State ------------------------------------------------------------------------

local function newBook()
  return {
    markets = {},
    orders = {}, orderSeq = 0, orderHistory = {},
    fills = {}, fillSeq = 0,
    marketDaily = {},
    actionReceipts = {}, actionReceiptOrder = {},
    rejected = {},
    pools = {},
    fees = {},
  }
end

local function ensureBook()
  Book = type(Book) == "table" and Book or newBook()
  for key, value in pairs(newBook()) do
    if Book[key] == nil then Book[key] = value end
  end
  OrderBook.ensureIndex(Book)
  return Book
end

-- Views ------------------------------------------------------------------------

local function assetView()
  local out = {}
  for id, row in pairs(Assets) do
    out[id] = {
      id = id, name = row.name, kind = row.kind,
      process = row.process, ticker = row.ticker,
      denomination = row.denomination ~= nil and asString(row.denomination) or nil,
    }
  end
  return out
end

local function marketView()
  local out = {}
  for id, market in pairs(Book.markets) do
    out[id] = {
      id = id, base = market.base, quote = market.quote,
      tick = int(market.tick, 1), lot = int(market.lot, 1),
      minValue = int(market.minValue, 0),
      maxPrice = int(market.maxPrice, 0),
      maxQuantity = int(market.maxQuantity, 0),
      takerBps = int(market.takerBps, 0),
      bandBps = int(market.bandBps, 0),
      status = market.status,
    }
  end
  return out
end

--- What this venue is holding, per asset, and what it owes.
---
--- `held` is the sum it owes its traders; for the external venue that number
--- has to equal the token's own `balance-<venue>`, and publishing it is what
--- makes that a check anybody can run rather than a claim.
local function supplyView()
  local out = {}
  for id in pairs(Assets) do
    local row = pool(id)
    local player, escrow, locked = int(row.player, 0), int(row.escrow, 0), int(row.locked, 0)
    out[id] = {
      free = asString(player),
      escrow = asString(escrow),
      locked = asString(locked),
      held = asString(player + escrow + locked),
      fees = asString(int(Book.fees[id], 0)),
    }
  end
  return out
end

local function bookView(timestamp)
  local markets = {}
  for id, market in pairs(Book.markets) do
    local levels = OrderBook.p2pLadder(Book, timestamp, market.base)
    local band = OrderBook.bandView(host(), Book, market.base, timestamp)
    markets[id] = {
      id = id, base = market.base, quote = market.quote, status = market.status,
      tick = int(market.tick, 1), lot = int(market.lot, 1),
      bestBid = levels.bestBid, bestAsk = levels.bestAsk,
      depth = { bids = levels.bids, asks = levels.asks },
      band = band,
      candles = OrderBook.candleView(Book, timestamp, market.base),
    }
  end
  return markets
end

local function infoView()
  return {
    Name = VenueName,
    Mode = VenueMode or "",
    Sealed = VenueSealed,
    Owner = Owner or "",
    GameProcess = GameProcess,
    Assets = assetView(),
    Markets = marketView(),
    Paused = Emergency.paused,
    PauseReason = Emergency.reason,
    PauseScope = word(Emergency.scope, "trading"),
    WithdrawalsOpen = withdrawalsStopped() == nil,
  }
end

--- One account's whole position: free per asset, plus its live orders.
local function accountView(account, timestamp)
  local free = {}
  for asset, amount in pairs(Ledger[account] or {}) do
    free[asset] = asString(amount)
  end
  return {
    account = account,
    free = free,
    orders = OrderBook.accountOrders(host(), Book, account, timestamp),
    fills = OrderBook.accountFills(host(), Book, account, 20),
  }
end

-- Handlers ---------------------------------------------------------------------

local H = {}

local function requireMode(base, want)
  if VenueMode == nil then return fail(base, "This venue has no mode yet") end
  if VenueMode ~= want then
    return fail(base, "This is the " .. VenueMode .. " venue")
  end
  return nil
end

H["Info"] = function(base) return reply(base, infoView()) end

H["Balance"] = function(base, msg, timestamp)
  local account = tag(msg, "Account", "Recipient") or provenSigner(msg)
  if not validId(account) then return fail(base, "No address") end
  return reply(base, accountView(account, timestamp))
end

H["Book"] = function(base, _, timestamp) return reply(base, bookView(timestamp)) end

H["Supply"] = function(base) return reply(base, supplyView()) end

-- Trading ----------------------------------------------------------------------

--- Every order verb resolves the trader from a real signature and refuses a
--- process delivery outright. Nothing else may place an order: a venue that
--- let one process trade on behalf of a wallet would be a venue where the game
--- could spend your Rune.
local function trader(base, msg, b)
  local who = actor(msg, b)
  if not validId(who) then
    return nil, fail(base, "Unsigned messages cannot trade")
  end
  return who, nil
end

H["Order.Place"] = function(base, msg, timestamp, b)
  local who, refusal = trader(base, msg, b)
  if not who then return refusal end
  local price = int(tag(msg, "Price"), 0)
  local qty = int(tag(msg, "Quantity"), 0)
  local placed, problem = OrderBook.placeOrder(host(), Book, who,
    tostring(tag(msg, "Side") or ""), tostring(tag(msg, "Item", "Base", "Market") or ""),
    price, qty, timestamp, tag(msg, "ActionId"), {
      tif = tag(msg, "Tif", "TimeInForce"),
      stp = tag(msg, "Stp", "SelfTrade"),
      expiresIn = tag(msg, "ExpiresIn"),
    })
  if not placed then return fail(base, problem) end
  return reply(base, { order = placed, account = accountView(who, timestamp) })
end

H["Order.Amend"] = function(base, msg, timestamp, b)
  local who, refusal = trader(base, msg, b)
  if not who then return refusal end
  local amended, problem = OrderBook.amendOrder(host(), Book, who,
    tostring(tag(msg, "OrderId", "Order") or ""),
    int(tag(msg, "Price"), 0), int(tag(msg, "Quantity"), 0),
    timestamp, tag(msg, "ActionId"), {
      tif = tag(msg, "Tif", "TimeInForce"),
      stp = tag(msg, "Stp", "SelfTrade"),
    })
  if not amended then return fail(base, problem) end
  return reply(base, { order = amended, account = accountView(who, timestamp) })
end

H["Order.Cancel"] = function(base, msg, timestamp, b)
  local who, refusal = trader(base, msg, b)
  if not who then return refusal end
  local cancelled, problem = OrderBook.cancelOrder(host(), Book, who,
    tostring(tag(msg, "OrderId", "Order") or ""), timestamp, tag(msg, "ActionId"))
  if not cancelled then return fail(base, problem) end
  return reply(base, { cancelled = cancelled, account = accountView(who, timestamp) })
end

H["Order.CancelAll"] = function(base, msg, timestamp, b)
  local who, refusal = trader(base, msg, b)
  if not who then return refusal end
  local cancelled, problem = OrderBook.cancelOrders(host(), Book, who,
    { item = tag(msg, "Item", "Base", "Market") }, timestamp, tag(msg, "ActionId"))
  if not cancelled then return fail(base, problem) end
  return reply(base, { cancelled = cancelled, account = accountView(who, timestamp) })
end

--- Release the escrow of orders the clock has already retired.
---
--- Anyone may call it and nobody is paid to: matching does not depend on it,
--- because expiry is reconciled in the index rather than swept. This is
--- housekeeping, and it is here so that housekeeping is possible at all.
H["Order.Maintain"] = function(base, msg, timestamp)
  local expired = OrderBook.maintain(host(), Book, timestamp, int(tag(msg, "Limit"), 25))
  return reply(base, { expired = expired })
end

-- Deposits ---------------------------------------------------------------------

--- Credit a deposit exactly once.
---
--- `reference` is the idempotency key and it is MANDATORY. Delivery on this
--- network is not exactly-once, and a deposit credited twice is value created
--- out of nothing -- the failure `rune.lua`'s mint guard exists for, arriving
--- from the other direction.
---
--- Anything that cannot be credited is QUARANTINED, never refused. By the time
--- this message exists the value has already moved; answering an error would
--- leave no record of it at all and the depositor would be out their tokens
--- with nothing to point at. A quarantined row is keyed on the same reference,
--- so a repeat delivery still cannot pay.
local function settleDeposit(base, reference, account, asset, amount, timestamp)
  local seen = Deposits[reference]
  if seen then return reply(base, { deposit = seen, unchanged = true }) end

  local function quarantine(why)
    Deposits[reference] = {
      id = reference, account = account, asset = asset,
      amount = asString(amount), status = "unresolved", reason = why,
      noticedAt = timestamp,
    }
    return reply(base, { deposit = Deposits[reference] })
  end

  if not validId(account) then return quarantine("The notice names no account") end
  if not Assets[asset] then return quarantine("This venue does not list that asset") end
  if int(amount, 0) <= 0 then return quarantine("A deposit must be a positive whole amount") end

  creditFree(account, asset, amount)
  local row = pool(asset)
  row.player = int(row.player, 0) + int(amount, 0)
  Deposits[reference] = {
    id = reference, account = account, asset = asset,
    amount = asString(amount), status = "credited", creditedAt = timestamp,
  }
  return reply(base, {
    deposit = Deposits[reference], account = accountView(account, timestamp),
  })
end

--- EXTERNAL: a token telling us somebody paid us.
---
--- The sender must be a LISTED token, established by `sourceProcess` -- an
--- attested delivery, not a `from-process` field a message merely claims. The
--- depositor is named in the notice's `Sender`, not by the signer: the signer
--- of a delivered message is the scheduler.
H["Credit-Notice"] = function(base, msg, timestamp, b)
  local refusal = requireMode(base, "external")
  if refusal then return refusal end
  local from = sourceProcess(msg, b)
  local asset = from and AssetByProcess[from] or nil
  if not asset then return fail(base, "Not authorised") end

  -- The token's own transfer id, which is what makes a repeat delivery
  -- recognisable. `X-Reference` lets a depositor supply their own; the
  -- message id is the last resort, and a notice with none of the three is
  -- quarantined rather than credited -- there would be nothing to recognise a
  -- second copy of it by.
  local reference = tag(msg, "Reference", "X-Reference", "XReference")
  if type(reference) ~= "string" or reference == "" then
    reference = tostring(msg.Id or msg.id or "")
  end
  if reference == "" then
    return fail(base, "A credit notice must carry a Reference")
  end
  reference = from .. ":" .. reference

  return settleDeposit(base, reference, tag(msg, "Sender", "From"), asset,
    int(tag(msg, "Quantity"), 0), timestamp)
end

--- INTERNAL: the game telling us a player handed assets over.
---
--- There is no token here and there is not going to be one. `fire_berry` is a
--- name; what makes this credit real is that exactly one process is allowed to
--- say it, and that process debited the player before it did.
H["Venue.Credit"] = function(base, msg, timestamp, b)
  local refusal = requireMode(base, "internal")
  if refusal then return refusal end
  local from = sourceProcess(msg, b)
  if not from or GameProcess == "" or from ~= GameProcess then
    return fail(base, "Not authorised")
  end
  local reference = tag(msg, "Reference", "DepositId")
  if type(reference) ~= "string" or reference == "" then
    return fail(base, "A venue credit must carry a Reference")
  end
  return settleDeposit(base, from .. ":" .. reference,
    tag(msg, "Account", "PlayerId"), tostring(tag(msg, "Asset", "Item") or ""),
    int(tag(msg, "Quantity"), 0), timestamp)
end

-- Withdrawals ------------------------------------------------------------------

--- Take free balance out.
---
--- Free means free: what a resting order is holding is not withdrawable, and
--- the way to free it is to cancel the order, which costs nothing and takes
--- effect in the same message. There is no delay and no window -- see the note
--- at the top of this file.
---
--- The debit happens HERE, before the transfer is asked for, and the row is
--- `pending` until the far side confirms. That ordering is not negotiable: the
--- other way round, a transfer that landed while the reply was lost would pay
--- twice.
H["Withdraw"] = function(base, msg, timestamp, b)
  local who, refusal = trader(base, msg, b)
  if not who then return refusal end
  local stopped = withdrawalsStopped()
  if stopped then return fail(base, "Withdrawals are paused: " .. stopped) end

  local asset = tostring(tag(msg, "Asset", "Item") or "")
  local row = Assets[asset]
  if not row then return fail(base, "This venue does not list that asset") end

  local amount, why = quantity(tag(msg, "Quantity"))
  if not amount then return fail(base, why) end
  local free = balanceOf(who, asset)
  if free < amount then
    return fail(base, "You hold " .. asString(free) .. " free; cancel an order to free more")
  end

  if not debitFree(who, asset, amount) then return fail(base, "Insufficient free balance") end
  local held = pool(asset)
  held.player = math.max(0, int(held.player, 0) - amount)

  WithdrawSeq = WithdrawSeq + 1
  local id = "w" .. asString(WithdrawSeq)
  Withdrawals[id] = {
    id = id, account = who, asset = asset, amount = asString(amount),
    status = "pending", requestedAt = timestamp, settledAt = 0,
  }

  -- Where it goes is the ONE thing the two venues do not share.
  local out
  if VenueMode == "external" then
    out = { ["withdraw"] = {
      target = row.process, Action = "Transfer",
      Recipient = who, Quantity = asString(amount),
      ["X-Reference"] = id, ["X-Venue-Withdrawal"] = id,
    } }
  else
    out = { ["withdraw"] = {
      target = GameProcess, Action = "Venue.Return",
      Account = who, PlayerId = who,
      Asset = asset, Item = asset, Quantity = asString(amount),
      Reference = id, ["Withdrawal-Id"] = id,
    } }
  end

  return replyWith(base, {
    withdrawal = Withdrawals[id], account = accountView(who, timestamp),
  }, out)
end

--- The far side confirming a withdrawal landed.
---
--- It settles a row and never moves value -- the debit already happened -- so
--- a forged confirmation could at worst mark something settled that was not.
--- That is why this is allowed to be lenient about who sends it while
--- `Withdraw` is not.
local function settleWithdrawal(base, from, id, timestamp)
  local w = Withdrawals[type(id) == "string" and id or ""]
  if not w then return fail(base, "No such withdrawal") end
  if w.status ~= "pending" then
    return reply(base, { withdrawal = w, unchanged = true })
  end
  local expected = VenueMode == "external"
    and (Assets[w.asset] or {}).process or GameProcess
  if not from or expected == nil or expected == "" or from ~= expected then
    return fail(base, "Not authorised")
  end
  w.status = "settled"
  w.settledAt = timestamp
  return reply(base, { withdrawal = w })
end

--- EXTERNAL: our own `Transfer` came back to us as a debit notice. That is the
--- token saying the tokens left, which is the only confirmation there is.
H["Debit-Notice"] = function(base, msg, timestamp, b)
  local refusal = requireMode(base, "external")
  if refusal then return refusal end
  return settleWithdrawal(base, sourceProcess(msg, b),
    tag(msg, "X-Reference", "XReference", "Reference", "X-Venue-Withdrawal"), timestamp)
end

--- INTERNAL: the game confirming it put the assets back in the player's bags.
H["Venue.Returned"] = function(base, msg, timestamp, b)
  local refusal = requireMode(base, "internal")
  if refusal then return refusal end
  return settleWithdrawal(base, sourceProcess(msg, b),
    tag(msg, "Reference", "Withdrawal-Id", "WithdrawalId"), timestamp)
end

-- Admin ------------------------------------------------------------------------

local function requireOwner(base, msg, b)
  local who = provenSigner(msg)
  if not isOwner(who) then return fail(base, "Not authorised") end
  if sourceProcess(msg, b) then return fail(base, "Not authorised") end
  return nil
end

--- Set the mode, the game process and the venue's name. Refused once sealed.
H["Admin.Configure"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  if VenueSealed then return fail(base, "This venue is sealed") end

  local mode = word(tag(msg, "Mode", "VenueMode"))
  if mode == "internal" or mode == "external" then VenueMode = mode end
  local name = tag(msg, "Name", "VenueName")
  if type(name) == "string" and name ~= "" then VenueName = name end
  local game = tag(msg, "GameProcess", "Game")
  if validId(game) then GameProcess = game end

  if VenueMode == "internal" and GameProcess == "" then
    return reply(base, { info = infoView(),
      warning = "The internal venue has no game process yet" })
  end
  return reply(base, { info = infoView() })
end

--- List an asset. External assets name a token process and its denomination;
--- internal ones name nothing, because there is nothing to name.
H["Admin.ListAsset"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  if VenueSealed then return fail(base, "This venue is sealed") end
  if VenueMode == nil then return fail(base, "Set the venue's mode first") end

  local id = tostring(tag(msg, "Asset", "Id", "Item") or "")
  if not validSlug(id) then
    return fail(base, "An asset id is 1-32 characters of a-z, 0-9 and _")
  end
  local name = tostring(tag(msg, "Name") or id)

  if VenueMode == "external" then
    local processId = tag(msg, "Process", "Token", "TokenProcess")
    if not validId(processId) then return fail(base, "An external asset needs a token process") end
    -- One process, one asset id. Listing the same token twice under two names
    -- would give it two pools and two balances of the same real holding.
    local already = AssetByProcess[processId]
    if already and already ~= id then
      return fail(base, "That token is already listed as " .. already)
    end
    Assets[id] = {
      id = id, name = name, kind = "token", process = processId,
      ticker = tostring(tag(msg, "Ticker") or ""),
      denomination = int(tag(msg, "Denomination"), 0),
    }
    AssetByProcess[processId] = id
  else
    Assets[id] = { id = id, name = name, kind = "game" }
  end
  pool(id)
  return reply(base, { asset = assetView()[id] })
end

--- Create a market. It opens CLOSED.
---
--- A market is a `(base, quote)` pair with its own tick, lot, limits and fee,
--- and creating one is deliberately separate from launching it: the pair has
--- to be configured, checked and -- for a venue holding real value -- looked
--- at by somebody before anybody can rest an order on it. `Admin.LaunchAll` is
--- the "we are live" switch, and it exists so that going live is one message
--- rather than one per market.
H["Admin.CreateMarket"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end

  local baseAsset = tostring(tag(msg, "Base", "Item", "Asset") or "")
  local quoteAsset = tostring(tag(msg, "Quote") or "")
  if not Assets[baseAsset] then return fail(base, "List the base asset first") end
  if not Assets[quoteAsset] then return fail(base, "List the quote asset first") end
  if baseAsset == quoteAsset then return fail(base, "A market needs two different assets") end

  local id = OrderBook.marketId(baseAsset, quoteAsset)
  if Book.markets[id] then return fail(base, "That market already exists") end
  -- One market per BASE asset, because the book's index is keyed by it: two
  -- markets sharing a base would share a ladder and cross against each other
  -- at prices denominated in different things. Listing the same pair the other
  -- way round is fine -- that is a different base.
  for existing, market in pairs(Book.markets) do
    if market.base == baseAsset then
      return fail(base, baseAsset .. " is already the base of " .. existing)
    end
  end

  local overrides = { status = "closed" }
  local function number(name, field, low)
    local given = tag(msg, name)
    if given == nil then return nil end
    local n = int(given, -1)
    if n < low then return name .. " must be at least " .. asString(low) end
    overrides[field] = n
    return nil
  end
  local problem = number("Tick", "tick", 1) or number("Lot", "lot", 1)
    or number("MinValue", "minValue", 0) or number("MaxPrice", "maxPrice", 1)
    or number("MaxQuantity", "maxQuantity", 1)
    or number("TakerBps", "takerBps", 0) or number("BandBps", "bandBps", 0)
    or number("CreationCost", "creationCost", 0)
  if problem then return fail(base, problem) end

  Book.markets[id] = OrderBook.newMarket(baseAsset, quoteAsset, overrides)
  -- `houseQuotes` is set by `newMarket` for any Gold-quoted market, and this
  -- venue has no desk to quote with. Clear it rather than leave a flag on that
  -- means "ask a house that does not exist".
  Book.markets[id].houseQuotes = false
  return reply(base, { market = marketView()[id] })
end

local function setMarketStatus(base, id, status)
  local market = Book.markets[id]
  if not market then return fail(base, "No such market") end
  market.status = status
  return reply(base, { market = marketView()[id] })
end

H["Admin.LaunchMarket"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local id = tostring(tag(msg, "Market", "Id") or "")
  if not Book.markets[id] then
    -- A caller that knows the pair but not the id spelling.
    id = OrderBook.marketId(tostring(tag(msg, "Base") or ""), tostring(tag(msg, "Quote") or ""))
  end
  return setMarketStatus(base, id, "open")
end

H["Admin.SuspendMarket"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local id = tostring(tag(msg, "Market", "Id") or "")
  -- Suspended, not cancelled. Resting orders stay where they are and their
  -- owners can still cancel out of them; nothing new may cross.
  return setMarketStatus(base, id, "suspended")
end

--- Open every market that is not open. THE LAUNCH SWITCH.
H["Admin.LaunchAll"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local opened = {}
  for id, market in pairs(Book.markets) do
    if market.status ~= "open" then
      market.status = "open"
      opened[#opened + 1] = id
    end
  end
  table.sort(opened)
  return reply(base, { opened = opened, markets = marketView() })
end

--- Freeze what backs the venue. Markets stay creatable and launchable.
H["Admin.Seal"] = function(base, msg, _, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  if VenueMode == nil then return fail(base, "Set the venue's mode first") end
  if VenueMode == "internal" and GameProcess == "" then
    return fail(base, "The internal venue has no game process")
  end
  VenueSealed = true
  return reply(base, { info = infoView() })
end

--- THE EMERGENCY STOP.
---
--- `Scope = "trading"` (the default) stops every order verb and leaves
--- deposits and withdrawals open, which is the shape of almost every real
--- emergency: something is wrong with the book, so stop the book and let
--- people take their money home. `Scope = "all"` additionally freezes
--- withdrawals, which is the heavier decision and has to be asked for by name.
---
--- Deposits are never stopped by either. The value is already inside the
--- contract by the time a deposit is seen; refusing it only loses it.
H["Admin.Pause"] = function(base, msg, timestamp, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local scope = word(tag(msg, "Scope"), "trading")
  if scope ~= "trading" and scope ~= "all" then
    return fail(base, "Scope is trading or all")
  end
  Emergency = {
    paused = true,
    reason = tostring(tag(msg, "Reason") or "emergency pause"),
    scope = scope,
    at = timestamp,
  }
  return reply(base, { emergency = Emergency })
end

H["Admin.Resume"] = function(base, msg, timestamp, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  Emergency = { paused = false, reason = "", scope = "trading", at = timestamp }
  return reply(base, { emergency = Emergency })
end

--- Resolve a quarantined deposit by hand: credit it, or write it off.
---
--- Nothing else can. A quarantined row exists precisely because the automatic
--- path could not decide, and the money is already here.
H["Admin.SettleDeposit"] = function(base, msg, timestamp, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local reference = tostring(tag(msg, "Reference", "DepositId") or "")
  local row = Deposits[reference]
  if not row then return fail(base, "No such deposit") end
  if row.status ~= "unresolved" then
    return reply(base, { deposit = row, unchanged = true })
  end

  if word(tag(msg, "Resolution"), "credit") == "writeoff" then
    row.status = "written-off"
    row.reason = tostring(tag(msg, "Reason") or row.reason)
    row.creditedAt = timestamp
    return reply(base, { deposit = row })
  end

  local account = tag(msg, "Account") or row.account
  local asset = tostring(tag(msg, "Asset") or row.asset or "")
  local amount = int(tag(msg, "Quantity"), int(row.amount, 0))
  if not validId(account) then return fail(base, "Name the account to credit") end
  if not Assets[asset] then return fail(base, "This venue does not list that asset") end
  if amount <= 0 then return fail(base, "Name a positive quantity") end

  creditFree(account, asset, amount)
  local held = pool(asset)
  held.player = int(held.player, 0) + amount
  row.status = "credited"
  row.account = account
  row.asset = asset
  row.amount = asString(amount)
  row.creditedAt = timestamp
  return reply(base, { deposit = row, account = accountView(account, timestamp) })
end

--- A withdrawal whose confirmation never came. Either mark it settled because
--- the far side is known to have paid, or REFUND the balance here.
---
--- A refund is safe only when the transfer definitely did not land, which no
--- process can determine for itself -- so this is an owner action with the
--- evidence gathered off-chain, exactly like `Admin.SettleWithdrawal` in the
--- game.
H["Admin.SettleWithdrawal"] = function(base, msg, timestamp, b)
  local refusal = requireOwner(base, msg, b)
  if refusal then return refusal end
  local id = tostring(tag(msg, "Reference", "WithdrawalId", "Withdrawal-Id") or "")
  local w = Withdrawals[id]
  if not w then return fail(base, "No such withdrawal") end
  if w.status ~= "pending" then
    return reply(base, { withdrawal = w, unchanged = true })
  end

  if word(tag(msg, "Resolution"), "settle") == "refund" then
    creditFree(w.account, w.asset, int(w.amount, 0))
    local held = pool(w.asset)
    held.player = int(held.player, 0) + int(w.amount, 0)
    w.status = "refunded"
  else
    w.status = "settled"
  end
  w.settledAt = timestamp
  return reply(base, { withdrawal = w })
end

-- Dispatch ---------------------------------------------------------------------

--- Tag names arrive as HTTP headers, so their case and their separators are
--- both unreliable. Resolve a handler by the normalised name.
local RESOLVED = nil
local function resolveHandler(action)
  if not RESOLVED then
    RESOLVED = {}
    for name, handler in pairs(H) do RESOLVED[word(name)] = handler end
  end
  return RESOLVED[word(tostring(action or ""))]
end

--- Every address this message should republish a balance for. Only the
--- accounts it touched: the whole ledger would be rewritten on every trade for
--- the benefit of almost nobody, and the venue's ledger is the one key here
--- that grows with the number of wallets that have ever traded.
local function touched(msg, extra)
  local out = {}
  local function add(value)
    if validId(value) then out[value] = true end
  end
  add(provenSigner(msg))
  add(tag(msg, "Account"))
  add(tag(msg, "Recipient"))
  add(tag(msg, "Sender"))
  for _, value in ipairs(extra or {}) do add(value) end
  return out
end

function compute(base, req)
  local msg = (req and req.body) or {}
  local timestamp = int(msg.Timestamp or msg.timestamp
    or (req and (req.Timestamp or req.timestamp)), 0)

  ensureBook()
  Emergency = type(Emergency) == "table" and Emergency
    or { paused = false, reason = "", scope = "trading", at = 0 }
  resolveOwner(base)

  local action = tag(msg, "Action") or "none"
  local handler = resolveHandler(action)
  local result
  if not handler then
    local names = {}
    for name in pairs(H) do names[#names + 1] = name end
    table.sort(names)
    result = fail(base, "unknown action '" .. tostring(action) ..
      "'. known: " .. table.concat(names, ", "))
  else
    local ok, out = pcall(function() return handler(base, msg, timestamp, base) end)
    result = ok and out or fail(base, tostring(out))
  end

  -- Published state: the read path.
  --
  -- NOT `info`. Every HyperBEAM device exposes its own `info`, so
  -- `/<pid>~process@1.0/now/info` is answered by the device and this value is
  -- never reached -- the node serves its landing page at status 200 and the
  -- caller hands a screenful of HTML to `JSON.parse`. See CLAUDE.md.
  --
  -- And NOT the orders and fills in full. The ladder, the band and the candles
  -- are all here, so a client has no reason to read either, and a book that
  -- publishes every resting order pays for all of them on every message --
  -- five times over, whatever the message was.
  result.venueinfo = encode(infoView())
  result.assets = encode(assetView())
  result.markets = encode(marketView())
  result.venuebook = encode(bookView(timestamp))
  result.supply = encode(supplyView())
  result.paused = Emergency.paused and "1" or "0"

  -- One trader's position, addressable without pulling the whole ledger:
  -- `/now/balance-<address>`. An emptied account publishes "{}" rather than
  -- disappearing -- a key already in the map stays in it -- which caps what a
  -- departed trader costs at a few dozen bytes instead of their whole
  -- position.
  for address in pairs(touched(msg, {})) do
    local free = {}
    for asset, amount in pairs(Ledger[address] or {}) do free[asset] = asString(amount) end
    result["balance-" .. address] = encode(free)
  end

  -- Compact the heap before the node photographs it. HyperBEAM snapshots this
  -- process by term_to_binary-ing the WHOLE Luerl table store, Luerl never
  -- collects on its own, and `collectgarbage("step")` is a no-op here -- so
  -- without this every transient table since spawn is still in the heap when
  -- the checkpoint is written.
  --
  -- A full collect, as a bare statement. NOT inside a pcall frame: a collect
  -- renumbers the table store and Luerl's pcall restores stale indices into
  -- it, which kills the VM.
  collectgarbage("collect")

  return result
end
