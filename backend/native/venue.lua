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

local json = require(".json")

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
--- kind of leak that mints value out of nothing.
---
--- THEY ARE PUBLISHED, as `venuedepositstate` and `venuewithdrawalstate`, on
--- every write message. (They used to be heap-and-snapshot only, and the
--- comment here still said so long after `restoreOperationalState` started
--- reading them back.) So these are the two keys that grow for the life of the
--- process, and CLAUDE.md's cost model charges the whole published map to
--- every message five times over.
---
--- Since they cannot be trimmed, they are COMPACTED instead: `depositExport`
--- and `withdrawalExport` publish a resolved row as its status alone, because
--- the guard only has to answer "have I seen this reference" and a settled row
--- has nothing left for an admin to act on. Rows an admin still owes an answer
--- on -- an unresolved deposit, a pending withdrawal -- are published in full.
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
  local found = nil
  for _, commitment in pairs(c) do
    if type(commitment) == "table" and commitment.committer
       and SIGNATURE_ALGS[commitment.type or commitment.alg] then
      -- TWO DIFFERENT SIGNATURE COMMITTERS IDENTIFY NOBODY, rather than
      -- "whichever `pairs()` happened to visit first". `game.lua`'s `signer`
      -- carries the same guard and for the same reason, and on a VENUE it is
      -- the load-bearing one: `sourceProcess` believes `from-process` only
      -- when the proven signer IS our scheduler, and that gate is what stands
      -- between a stranger and `Credit-Notice`/`Venue.Credit` -- crediting
      -- balance out of nothing. Winning table iteration order by attaching a
      -- second signature must not be a way through it.
      if found and found ~= commitment.committer then return nil end
      found = commitment.committer
    end
  end
  -- Commitments present, none of them a signature: nobody is identified. An
  -- hmac names whoever it claims to, so it is never a fallback.
  return found
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

-- Accounts whose addressed view must be republished by this compute. The
-- signer alone is not enough: a taker can fill a resting maker, and that maker
-- needs their released escrow/fill receipt on the read path without first
-- sending another message of their own.
local TouchedAccounts = {}

-- Set TRUE by a handler that is not in the `readOnly` set but turned out to
-- have changed nothing a restore would want back. Only `Order.Maintain` sets
-- it, and only in the message where it released no escrow at all; `compute`
-- clears it before every dispatch, so a handler that does not set it publishes
-- as it always did. The decision is the WORK, never the action name -- a
-- Maintain that did expire an order moved escrow and must republish.
local StateIdle = false

--- Credit free balance. Never called on its own: value only ever enters this
--- process through a deposit, and `deposit` moves the pool with it.
local function creditFree(account, asset, amount)
  amount = int(amount, 0)
  if amount == 0 then return end
  if validId(account) then TouchedAccounts[account] = true end
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

-- Operational restore -------------------------------------------------------
--
-- The venue holds custody, so losing its Luerl globals while the published map
-- survives is not a tolerable empty-book reset. HyperBEAM can produce exactly
-- that shape under concurrent computes. Keep the authoritative components in
-- separate cached keys: unchanged reads reuse them, while a write refreshes
-- the snapshot. The public UI views stay lean; these records exist solely so a
-- cold slot cannot forget balances, escrow, orders or replay guards.
local function decodedTable(value)
  if type(value) == "table" then return value end
  if type(value) ~= "string" or value == "" or value == "null" then return nil end
  local ok, decoded = pcall(json.decode, value)
  if not ok or type(decoded) ~= "table" then return nil end
  return decoded
end

local function tableCount(value)
  local n = 0
  for _ in pairs(type(value) == "table" and value or {}) do n = n + 1 end
  return n
end

local function narrowNumbers(value)
  if type(value) == "number" then return math.tointeger(value) or value end
  if type(value) ~= "table" then return value end
  for key, child in pairs(value) do value[key] = narrowNumbers(child) end
  return value
end

--- What `venuebookstate` carries, and it is deliberately not the whole book.
---
--- This key is rewritten on EVERY write message and CLAUDE.md charges the
--- whole published map to every message five times over, so the question per
--- key is only ever "would a cold restore be missing something that matters".
--- `economy.lua`'s `M.exportState(..., { forRestore = true })` asks the same
--- question and reaches a DIFFERENT answer on one key -- see `fills` below --
--- so this list is reasoned per field rather than copied from it.
---
--- DROPPED:
---   bookIndex          derived from `orders`; the largest hot index, and
---                      restoring it would risk stale level membership.
---                      `ensureBook` -> `ensureIndex` rebuilds it.
---   orderHistory       500 rows of CLOSED orders. Nothing reconstructs state
---                      from it, no invariant reads it, and no view publishes
---                      it; it is a log. `orderSeq` is stored top-level and
---                      monotonic, so identity does not depend on it.
---   rejected           a refusal histogram. Telemetry, keyed by a fixed enum
---                      of reasons, rebuilt by the next refusal.
---   actionReceiptOrder pure derived FIFO order over `actionReceipts` -- every
---                      key in it is already a key of the map it orders, and
---                      `economy.importState` rebuilds it the same way
---                      `restoreOperationalState` does below. It MUST be
---                      rebuilt and not merely defaulted to `{}`: an empty
---                      order against a full receipt map makes
---                      `rememberAction`'s sweep break on its first iteration
---                      forever, and the receipts then grow without bound.
---
--- KEPT, and each for a reason:
---   fills              THE ONE THAT DIFFERS FROM THE GAME. `economy.lua` can
---                      drop it because `bookView` publishes the ring
---                      elsewhere and `M.restoreHistory` puts it back. This
---                      venue's `bookView` publishes candles, depth and the
---                      band -- NOT the raw fills -- so there is nowhere to
---                      restore them from. And they are not decoration: the
---                      venue has no NPC desk, so `hostAnchors` answers
---                      nothing and `priceBand` falls through to the 7-day
---                      median of `state.fills`. Dropping them would silently
---                      move the corridor every order is priced against.
---                      `accountFills` reads the index rebuilt from the same
---                      list, so a trader's own history rides on it too.
---   orderSeq, fillSeq  the identity of every future id.
---   orders, pools, fees, markets, marketDaily
---                      custody, escrow and the candle history. Verbatim.
---   actionReceipts     the replay guard. Dropping it re-arms the double-place
---                      it exists to prevent, on exactly the message a restore
---                      makes most likely.
local function bookExport()
  local dropped = {
    bookIndex = true, orderHistory = true, rejected = true,
    actionReceiptOrder = true,
  }
  local out = {}
  for key, value in pairs(ensureBook()) do
    if not dropped[key] then out[key] = value end
  end
  return out
end

--- Put back the FIFO eviction order `bookExport` deliberately omits.
---
--- Timestamp order is the order `rememberAction` appended in, so the rebuilt
--- list evicts the same receipt the original would have; ties keep a stable
--- key order so two nodes restoring the same export agree. This is the same
--- rebuild `economy.importState` performs, and it is not optional: without it
--- `rememberAction` walks a list of length zero, breaks immediately, and the
--- receipt map never sheds anything again.
local function rebuildReceiptOrder(book)
  local receipts = type(book.actionReceipts) == "table" and book.actionReceipts or {}
  if type(book.actionReceiptOrder) == "table" and #book.actionReceiptOrder > 0 then return end
  local keys = {}
  for key in pairs(receipts) do keys[#keys + 1] = key end
  table.sort(keys, function(a, b)
    local ta = int((receipts[a] or {}).timestamp, 0)
    local tb = int((receipts[b] or {}).timestamp, 0)
    if ta ~= tb then return ta < tb end
    return a < b
  end)
  book.actionReceiptOrder = keys
end

--- Put an id back on a row whose id is its own key.
---
--- `depositExport`/`withdrawalExport` compact a RESOLVED row to its status
--- alone, because the map is keyed by the reference and re-publishing a
--- 43-character id inside the value it is already the key of is the same bytes
--- twice on every message. The heap wants the field back.
local function rekey(rows)
  for key, row in pairs(type(rows) == "table" and rows or {}) do
    if type(row) == "table" and row.id == nil then row.id = key end
  end
  return rows
end

--- The replay guards, with the rows nobody can still act on collapsed.
---
--- Neither map may be TRIMMED -- an aged-out reference is a replayable deposit
--- -- but a row that is already resolved does not need its body to keep doing
--- its job. Everything that reads these back asks one of two questions:
---
---   `settleDeposit` / `settleWithdrawal`: is there a row for this reference?
---   `Admin.SettleDeposit` / `Admin.SettleWithdrawal`: is it still open, and
---   if so, who and what and how much?
---
--- Only the second needs the body, and only on an OPEN row -- an unresolved
--- deposit or a pending withdrawal, which is exactly what an admin has left to
--- do. Everything else is published as its status and nothing more; the map is
--- keyed by the reference, so even the id is a byte the key already paid for
--- (`rekey` puts it back on the way in).
---
--- `status` is the one field that is never dropped, and that is a safety
--- property rather than a nicety: `Admin.SettleWithdrawal` refunds a row it
--- reads as `pending`, so a compacted row that lost its status would be
--- refundable a second time. A missing status reads as not-pending, so this
--- fails closed in both directions.
local function compactRows(rows, openStatus)
  local out = {}
  for key, row in pairs(type(rows) == "table" and rows or {}) do
    if type(row) ~= "table" then
      out[key] = row
    elseif row.status == openStatus then
      out[key] = row
    else
      out[key] = { status = row.status or "resolved" }
    end
  end
  return out
end

local function depositExport() return compactRows(Deposits, "unresolved") end
local function withdrawalExport() return compactRows(Withdrawals, "pending") end

local function rebuildAssetIndex()
  AssetByProcess = {}
  for id, asset in pairs(Assets) do
    if type(asset) == "table" and type(asset.process) == "string"
       and asset.process ~= "" then AssetByProcess[asset.process] = id end
  end
end

local function restoreOperationalState(base)
  local meta = decodedTable(base and base.venuecommit)
  if not meta then return end

  if VenueMode == nil or tableCount(Assets) < int(meta.assets, 0) then
    local config = decodedTable(base.venueconfigstate)
    if config then
      VenueMode = config.mode
      VenueSealed = config.sealed == true
      VenueName = type(config.name) == "string" and config.name or VenueName
      GameProcess = type(config.gameProcess) == "string" and config.gameProcess or ""
      Assets = narrowNumbers(type(config.assets) == "table" and config.assets or {})
      Emergency = narrowNumbers(type(config.emergency) == "table" and config.emergency
        or { paused = false, reason = "", scope = "trading", at = 0 })
      rebuildAssetIndex()
    end
  end
  if tableCount(Ledger) < int(meta.accounts, 0) then
    local restored = decodedTable(base.venueledgerstate)
    if restored then Ledger = narrowNumbers(restored) end
  end
  if type(Book) ~= "table" or int(Book.orderSeq, 0) < int(meta.orderSeq, 0)
     or int(Book.fillSeq, 0) < int(meta.fillSeq, 0) then
    local restored = decodedTable(base.venuebookstate)
    if restored then
      Book = narrowNumbers(restored)
      OrderBook.normaliseMarketDaily(Book)
      ensureBook()
      rebuildReceiptOrder(Book)
    end
  end
  if tableCount(Deposits) < int(meta.deposits, 0) then
    local restored = decodedTable(base.venuedepositstate)
    if restored then Deposits = rekey(narrowNumbers(restored)) end
  end
  if tableCount(Withdrawals) < int(meta.withdrawals, 0) then
    local restored = decodedTable(base.venuewithdrawalstate)
    if restored then Withdrawals = rekey(narrowNumbers(restored)) end
  end
  WithdrawSeq = math.max(int(WithdrawSeq, 0), int(meta.withdrawSeq, 0))
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
      -- Every other field the order ticket needs was here and this one was
      -- not, so the client showed a creation cost of zero whatever the market
      -- charged. Both venues deploy at 0 today (`deploy-venue.mjs`), which is
      -- what made the omission invisible rather than harmless: `placeOrder`
      -- requires it on top of the escrow on a buy and on its own on a sell, so
      -- an unread non-zero cost is an order refused for a reason the ticket
      -- never showed. Published, not assumed.
      creationCost = int(market.creationCost, 0),
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
    -- An omitted field means "keep the resting value".  Passing zero for a
    -- missing Price made every quantity-only amend fail as Invalid unit price;
    -- the in-game book already preserves nil in exactly this way.
    tag(msg, "Price") ~= nil and int(tag(msg, "Price"), 0) or nil,
    tag(msg, "Quantity") ~= nil and int(tag(msg, "Quantity"), 0) or nil,
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
--- Anyone may call it and nobody is paid to, which is fine for the work and
--- expensive for the publication: a Maintain that released nothing would still
--- rewrite the config, the ledger, the book, the deposits and the withdrawals,
--- and every message pays for the whole published map five times over. So a
--- call that expired zero orders declares itself idle and skips the state
--- rewrite. One that expired ANY must not: escrow moved back to its owners and
--- a restore that missed it would hand the money out twice.
---
--- Note the gate is the count, not the verb. `Order.Maintain` is never
--- unconditionally read-only.
H["Order.Maintain"] = function(base, msg, timestamp)
  local expired = OrderBook.maintain(host(), Book, timestamp, int(tag(msg, "Limit"), 25))
  StateIdle = int(expired, 0) == 0
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
  --- `high` is optional and only two fields have one, because only two of these
  --- are a RATE rather than a size. Owner-only, so this is a sanity bound and
  --- not a live exploit -- but an unbounded `TakerBps` accepts 1000000, which
  --- is a 100x fee, and `accrueFee` clamps `fee > gross` only AFTER it has
  --- already banked the carry, so an absurd bps is not merely a big number.
  --- 1000 is 10%, far above anything this venue would ever charge.
  ---
  --- `BandBps` is capped at BPS because above it the value is already
  --- meaningless: `orderbook.priceBand` does `math.min(bps, BPS - 1)` on the
  --- low side, so 10000 and 10000000 name the same corridor floor.
  local function number(name, field, low, high)
    local given = tag(msg, name)
    if given == nil then return nil end
    local n = int(given, -1)
    if n < low then return name .. " must be at least " .. asString(low) end
    if high and n > high then return name .. " must be at most " .. asString(high) end
    overrides[field] = n
    return nil
  end
  local problem = number("Tick", "tick", 1) or number("Lot", "lot", 1)
    or number("MinValue", "minValue", 0) or number("MaxPrice", "maxPrice", 1)
    or number("MaxQuantity", "maxQuantity", 1)
    or number("TakerBps", "takerBps", 0, 1000)
    or number("BandBps", "bandBps", 0, 10000)
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
---
--- PROVEN IDENTITY AND MOVED BALANCE ONLY -- NEVER A RAW TAG. This used to add
--- `Account`, `Recipient` and `Sender` straight off the message, and a
--- published key, once created, stays in the process map forever. Any wallet
--- could therefore mint one per message -- with the read-only `Info`, at that
--- -- by naming a 43-character id it had made up, and CLAUDE.md's cost model
--- charges the WHOLE published map to every subsequent message, five times
--- over. That is the `player-<address>` growth shape with the cost moved onto
--- everybody else and the trigger handed to a stranger.
---
--- Nothing legitimate needs them: `creditFree`/`debitFree` record every
--- address whose balance actually MOVED in `TouchedAccounts`, which covers the
--- `Credit-Notice` depositor named in `Sender`, the `Venue.Credit` account,
--- `Withdraw`, and both of the admin settlement paths including the refund. A
--- quarantined deposit credits nobody and correctly mints no key. `H["Balance"]`
--- still ANSWERS for any account it is asked about; only the published key for
--- a stranger goes away.
local function touched(msg, extra)
  local out = {}
  local function add(value)
    if validId(value) then out[value] = true end
  end
  add(provenSigner(msg))
  for value in pairs(TouchedAccounts) do add(value) end
  for _, value in ipairs(extra or {}) do add(value) end
  return out
end

function compute(base, req)
  base = type(base) == "table" and base or {}
  restoreOperationalState(base)
  local msg = (req and req.body) or {}
  -- THE ASSIGNMENT FIRST, THE BODY ONLY AS A LAST RESORT, AND THE ORDER IS THE
  -- WHOLE POINT. `msg` is `req.body` -- the user's own signed data item -- so
  -- reading `msg.Timestamp` first lets any wallet set this venue's clock, and
  -- the clock is not decoration here: a far-future stamp retires every resting
  -- order into the index's dead queue and `Order.Maintain` (which anybody may
  -- call) then cancels them, a fill stamped far ahead makes `marketDay` prune
  -- every real candle as `< day - 35`, and `rememberAction`'s TTL sweep evicts
  -- replay guards that are still inside a client's retry window. `req.timestamp`
  -- is the scheduler's assignment and no wallet can forge it. This is the order
  -- game.lua, hunt.lua, marketplace.lua and the battle worker all read in.
  local timestamp = int((req and (req.timestamp or req.Timestamp))
    or msg.Timestamp or msg.timestamp, 0)

  TouchedAccounts = {}
  StateIdle = false
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

  local readOnly = { info = true, balance = true, book = true, supply = true }
  if result.venuecommit == nil
     or (handler and not readOnly[word(action)] and not StateIdle) then
    result.venueconfigstate = encode({
      mode = VenueMode, sealed = VenueSealed == true, name = VenueName,
      gameProcess = GameProcess, assets = Assets, emergency = Emergency,
    })
    result.venueledgerstate = encode(Ledger)
    result.venuebookstate = encode(bookExport())
    result.venuedepositstate = encode(depositExport())
    result.venuewithdrawalstate = encode(withdrawalExport())
  end
  result.venuecommit = encode({
    assets = tableCount(Assets), accounts = tableCount(Ledger),
    deposits = tableCount(Deposits), withdrawals = tableCount(Withdrawals),
    withdrawSeq = int(WithdrawSeq, 0),
    orderSeq = int(Book and Book.orderSeq, 0), fillSeq = int(Book and Book.fillSeq, 0),
  })

  -- One trader's complete bounded position, addressable without pulling the
  -- whole ledger: `/now/balance-<address>`. It includes free balances plus the
  -- caller's own orders and fills; publishing only `free` made a reload forget
  -- every order id and left no unsigned way to cancel it. An emptied account
  -- remains a small object rather than disappearing because a published key,
  -- once created, stays in the process map.
  for address in pairs(touched(msg, {})) do
    result["balance-" .. address] = encode(accountView(address, timestamp))
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
