--- orderbook.lua -- the matching engine, and nothing that knows what a player is.
---
--- This is the venue: a market registry, a price-time limit order book with an
--- index, escrow, fees, time-in-force, self-trade prevention, a price band,
--- candles and the public verbs over all of it. It was carved out of
--- `economy.lua` because it has to run in three places and only one of them is
--- the game:
---
---   1. inside `game.lua`, quoting Gold against items, with the NPC desk
---      quoting into the same ladder;
---   2. the INTERNAL venue process, holding in-game assets credited to it by
---      trusted messages from the game -- those assets are not tokens and will
---      never be tokens, so nothing here may assume an asset has a process
---      behind it;
---   3. the EXTERNAL venue process, holding real tokens deposited by
---      `Credit-Notice` and withdrawable back to the wallet.
---
--- The engine cannot tell which one it is in. Everything it is not allowed to
--- know is reached through a HOST (see below), and the host is the only
--- argument that differs between the three deployments.
---
--- Keep this module Luerl-safe: no goto, no table.move, narrow every external
--- number through `int`, and never treat a json round-trip as proof that a
--- stored amount is integral.

local M = {}

local DAY = 24 * 3600 * 1000
local BPS = 10000

--- Bumped whenever the derived index changes shape, so a process carrying an
--- older one rebuilds instead of trusting it. See `bookIndex`.
local BOOK_INDEX_VERSION = 1

--- Assigned with the rest of the index, far below; declared here because
--- `bookIndex` and the host's `ensure` both reach for it.
local rebuildIndex

--- THE HOST.
---
--- Six questions the book is not allowed to answer for itself. Everything else
--- it does is arithmetic over `state`.
---
---   `ensure(state) -> state`
---       Normalise and return the state. In the game this is
---       `EconomyEngine.ensureState`; in a venue process it is the venue's own.
---
---   `ledger`
---       `{ exists, record, balance, debit, credit }` -- an account, and only
---       an account. `debit` returns false rather than erroring when short.
---       `record` is for the desk's maturity rule alone and may return nil.
---
---   `host.pool(state, asset) -> row`
---       The supply/custody row for an asset: `{ player, escrow, locked }`.
---       In the game these are the issuance buckets `state.gold` and
---       `state.assets[asset]`; in a venue they are what the venue is holding.
---       The book only ever moves value BETWEEN the three buckets, never in or
---       out of them, which is what makes the same code correct for an issued
---       currency and for a custodied deposit.
---
---   `fee(state, asset, amount, timestamp, reason)`
---       Where a taker fee goes. Burned or locked against the Gold target in
---       the game; accrued to the venue's fee account otherwise.
---
---   `tradable(state, asset) -> boolean`
---       Whether this venue recognises the asset at all.
---
---   `pauseReason(state) -> string | nil`
---       Non-nil refuses every order-placing verb. This is the emergency stop,
---       and it is deliberately checked in the book rather than at the handler
---       so that no future verb can forget it.
---
--- And three OPTIONAL hooks for a house that quotes into the ladder. A venue
--- that has no NPC desk -- which is both external deployments -- leaves all
--- three nil and the book simply has no house liquidity.
---
---   `quote(state, ledger, item, side, account, timestamp, opts) -> house|nil`
---   `settleHouse(state, ledger, desk, order, price, units, timestamp) -> fill`
---   `anchors(state, item) -> bid, ask`
local function hostQuote(host, state, ledger, item, side, account, timestamp,
                         withdrawals, deposits)
  if type(host.quote) ~= "function" then return nil end
  return host.quote(state, ledger, item, side, account, timestamp,
                    withdrawals, deposits)
end

local function hostAnchors(host, state, item)
  if type(host.anchors) ~= "function" then return nil, nil end
  return host.anchors(state, item)
end

--- A host for a venue that has no issuance ledger and no NPC desk: custody
--- rows live on `state.pools`, fees accrue to `state.fees`, and an asset is
--- tradable when the venue has a row for it. Both external processes build
--- their host from this and override `ledger` and `ensure`.
function M.custodyHost(opts)
  opts = type(opts) == "table" and opts or {}
  return {
    ensure = opts.ensure or function(state) return state end,
    ledger = opts.ledger,
    pool = opts.pool or function(state, asset)
      state.pools = type(state.pools) == "table" and state.pools or {}
      local row = state.pools[asset]
      if not row then
        row = { player = 0, escrow = 0, locked = 0 }
        state.pools[asset] = row
      end
      return row
    end,
    fee = opts.fee or function(state, asset, amount)
      state.fees = type(state.fees) == "table" and state.fees or {}
      state.fees[asset] = math.max(0, math.tointeger(state.fees[asset] or 0) or 0)
        + math.max(0, math.tointeger(amount) or 0)
    end,
    tradable = opts.tradable or function(state, asset)
      return type(state.pools) == "table" and state.pools[asset] ~= nil
    end,
    pauseReason = opts.pauseReason or function(state)
      local stop = type(state.emergency) == "table" and state.emergency or nil
      if stop and stop.paused then
        return tostring(stop.reason or "emergency pause")
      end
      return nil
    end,
  }
end

--- These four are byte-identical to the ones in `economy.lua` on purpose.
--- Sharing them would mean a require, and a require would mean this module
--- could not be dropped into a venue process that bundles nothing else.
--- If one of them changes, change both: `int` in particular is the narrowing
--- that keeps Luerl's float `tonumber` out of stored state.
local function int(value, fallback)
  local narrowed = math.tointeger(tonumber(value))
  if narrowed == nil then return fallback or 0 end
  return narrowed
end

local function clamp(value, low, high)
  value = int(value, low)
  if value < low then return low end
  if value > high then return high end
  return value
end

local function median(values)
  if #values == 0 then return nil end
  table.sort(values)
  local middle = (#values + 1) // 2
  if (#values % 2) == 1 then return values[middle] end
  return (values[middle] + values[middle + 1]) // 2
end

local function copy(value)
  if type(value) ~= "table" then return value end
  local result = {}
  for key, child in pairs(value) do result[key] = copy(child) end
  return result
end

--- The market registry.
---
--- Today "the market" is an item name and the quote asset is Gold, implicitly.
--- This is the table that makes it explicit, and it is the difference between
--- a game feature and a venue: a market is a `(base, quote)` pair with its own
--- tick, lot, limits and fee. Every current row is `<item>/gold` with a lot of
--- one, so nothing about the game changes -- and listing an asset against
--- something other than Gold becomes a row rather than a rewrite.
---
--- `lot` is the one that earns its place immediately. Price is quote units per
--- LOT of base, so an asset worth a third of a Rune lists with `lot = 10` and
--- trades at 3. Without it, an indivisible quote asset (Rune has no decimals
--- in the game, and Gold has none anywhere) forces a minimum price increment
--- of one whole unit and anything cheap is untradeable. See ORDERBOOK.md §7.1.
---
--- `takerBps` is 0 on every in-game market deliberately -- the NPC desk spread
--- is the Gold sink, not the book. The external deployment sets 30. `feeCarry`
--- is the fractional remainder that makes a percentage fee exact against an
--- indivisible asset; see §7.2.
local function marketId(base, quote) return base .. "/" .. quote end

local function newMarket(base, quote, overrides)
  local cfg = C.ECONOMY.orderbook
  local market = {
    id = marketId(base, quote), base = base, quote = quote,
    tick = 1, lot = 1,
    minValue = cfg.minValue,
    maxPrice = cfg.maxUnitPrice,
    maxQuantity = cfg.maxQuantity,
    takerBps = 0, makerBps = 0, rebateBps = 0,
    feeCarry = 0,
    --- What it costs to put an order on the book, in the QUOTE asset.
    ---
    --- A market field rather than a constant, because "1" is a sane friction
    --- against Gold and nonsense against anything else: on a Rune/Relic market
    --- it charges one millionth of a Relic, which is not friction, it is a
    --- balance every trader has to be told to go and get before their first
    --- sell will be accepted. A venue sets it to 0 and lets the taker fee do
    --- the work; ORDERBOOK.md §7.3 argues the game should too.
    creationCost = cfg.creationCost,
    --- How far from the reference price an order may be priced, either side.
    --- Zero switches the guard off for this market; see `priceBand`.
    bandBps = cfg.bandBps,
    --- Whether the NPC desk for this base asset quotes into the ladder.
    --- Only true where the quote asset is Gold and a lot is one unit: the desk
    --- holds Gold and whole items, not lots of something else.
    houseQuotes = quote == "gold",
    status = "open",
  }
  for key, value in pairs(overrides or {}) do market[key] = value end
  return market
end

--- item. Every existing message says `Item = "fire_berry"` and means
--- `fire_berry/gold`; a client that names a full market id gets that instead.
--- Three spellings, one market, and the third one is what a venue needs.
---
--- A caller that knows the full id gets that. A caller that names only the
--- base gets `<base>/gold`, which is every market inside the game and the
--- reason every existing message can say `Item = "fire_berry"` and mean it.
---
--- A venue quotes against something else, so `rune` has to find `rune/relic`
--- with nothing in the message saying `relic`. That is the last fallback: the
--- ONE market this asset is the base of. It is unambiguous because it has to
--- be -- the index is keyed by base asset, so two markets sharing a base would
--- share a ladder, and `Admin.CreateMarket` refuses to create the second one.
--- The scan is over the registry, which is seven rows in the game and one in
--- the external venue, and it only runs when both direct lookups miss -- which
--- inside the game is never.
function M.resolveMarket(state, name)
  if type(name) ~= "string" or name == "" then return nil end
  local markets = state.markets or {}
  local direct = markets[name] or markets[marketId(name, "gold")]
  if direct then return direct end
  for _, market in pairs(markets) do
    if market.base == name then return market end
  end
  return nil
end

--- Separators do not survive the trip. A browser signs `Tif = "post-only"`,
--- a process emits `post_only`, HTTP lowercases both, and a handler comparing
--- against `postonly` misses all three. Strip the separators before comparing
--- and every spelling of the same word means the same thing. See the tag rule
--- in CLAUDE.md; this is the same defect that cost a live deployment every
--- hunt capture.
local function mode(value, fallback)
  if type(value) ~= "string" then return fallback end
  local plain = string.gsub(string.lower(value), "[%-%_%s]", "")
  if plain == "" then return fallback end
  return plain
end

--- The book, held the way the engine asks for it.
---
--- Every question the matching path asks is about ONE market, ONE side and the
--- best price on it -- and every one of them used to be answered by walking
--- all of `state.orders`. Placing an order did five of those walks and two
--- sorts before it matched anything, then one more per fill; publishing did
--- one per market, seven markets over. At the configured cap of 2,000 resting
--- orders that is tens of thousands of table lookups for a single placement,
--- and none of it is work anybody would have chosen to do.
---
--- So the same orders are ALSO held as item -> side -> price -> ids, with each
--- side's prices kept sorted, a live count per account, and a min-heap on
--- expiry. Nothing here is a source of truth: `state.orders` is, every entry
--- is an id rather than a reference, and `rebuildIndex` reconstructs the whole
--- thing in one pass. That is what makes it safe to leave out of every export
--- and every published view -- a process restored from an `Admin.Load`, or
--- from an export taken before this existed, builds it on first use and gets
--- the same answers.
---
--- EXPIRY IS RECONCILED, not filtered. An order leaves the levels and the
--- counts the instant the clock passes its `expiresAt`, so every reader is
--- already looking at live liquidity and no reader re-checks a timestamp.
--- Releasing its escrow stays a separate, bounded job: `expireOrders` drains
--- the queue the reconciliation fills. That is the same split the scanning
--- code drew -- `bestMatch` ignored what the bounded sweep had not reached --
--- only now the sweep costs what it releases instead of what the book holds.
local function marketBook(index, item)
  local book = index.books[item]
  if not book then
    book = { rev = 0,
      buy = { levels = {}, prices = {} }, sell = { levels = {}, prices = {} } }
    index.books[item] = book
  end
  return book
end

--- Where `price` belongs in an ascending array: the first slot not below it.
local function priceSlot(prices, price)
  local low, high = 1, #prices
  while low <= high do
    local middle = (low + high) // 2
    if prices[middle] < price then low = middle + 1 else high = middle - 1 end
  end
  return low
end

--- A min-heap on `expiresAt`, with the position of every id, so an order that
--- is cancelled or filled leaves it in log time rather than being tombstoned.
--- A tombstone would be cheaper to write and would make the heap grow with
--- every order the book has EVER held, which is the one shape this file is
--- not allowed to have.
---
--- The expiry is copied onto the heap at insert rather than read back off the
--- order, so nothing an amend does to a record can silently break the ordering
--- of a structure that is only ever compared, never re-sorted.
local function heapBefore(index, left, right)
  local a, b = int(index.due[left], 0), int(index.due[right], 0)
  if a ~= b then return a < b end
  return left < right
end

local function heapSwap(index, at, with)
  local moved, other = index.heap[at], index.heap[with]
  index.heap[at], index.heap[with] = other, moved
  index.slot[moved], index.slot[other] = with, at
end

local function siftUp(index, at)
  while at > 1 do
    local parent = at // 2
    if not heapBefore(index, index.heap[at], index.heap[parent]) then return end
    heapSwap(index, at, parent)
    at = parent
  end
end

local function siftDown(index, at)
  local size = #index.heap
  while true do
    local left, best = at * 2, at
    if left <= size and heapBefore(index, index.heap[left], index.heap[best]) then
      best = left
    end
    if left + 1 <= size and heapBefore(index, index.heap[left + 1], index.heap[best]) then
      best = left + 1
    end
    if best == at then return end
    heapSwap(index, at, best)
    at = best
  end
end

local function heapPush(index, id, due)
  index.due[id] = due
  local at = #index.heap + 1
  index.heap[at] = id
  index.slot[id] = at
  siftUp(index, at)
end

local function heapDrop(index, id)
  local at = index.slot[id]
  if not at then return false end
  local last = #index.heap
  heapSwap(index, at, last)
  index.heap[last] = nil
  index.slot[id] = nil
  index.due[id] = nil
  if at <= last - 1 then siftDown(index, at); siftUp(index, at) end
  return true
end

--- Ids inside a price level are kept in `seq` order, because that IS the
--- tie-break the engine promises: at one price the order that rested first
--- trades first. Placement always appends, which is already in order; only a
--- revived order ever lands anywhere but the end.
local function levelAdd(state, rows, price, order)
  local level = rows.levels[price]
  if not level then
    level = {}
    rows.levels[price] = level
    table.insert(rows.prices, priceSlot(rows.prices, price), price)
  end
  local at = #level + 1
  while at > 1 do
    local prior = state.orders[level[at - 1]]
    if prior and int(prior.seq, 0) > int(order.seq, 0) then at = at - 1 else break end
  end
  table.insert(level, at, order.id)
end

local function levelRemove(rows, price, id)
  local level = rows.levels[price]
  if not level then return false end
  for at = 1, #level do
    if level[at] == id then
      table.remove(level, at)
      if #level == 0 then
        rows.levels[price] = nil
        local slot = priceSlot(rows.prices, price)
        if rows.prices[slot] == price then table.remove(rows.prices, slot) end
      end
      return true
    end
  end
  return false
end

--- An order is IN the index exactly while it has a heap slot. An expired one
--- that the sweep has not reached yet has none: it is out of the levels, out
--- of the counts, and waiting in `dead` for its escrow to be released.
---
--- An account's row is DELETED when its last order leaves, rather than left
--- at zero. A map keyed by every wallet that has ever placed an order is the
--- `player-<address>` growth shape all over again, and this one would be paid
--- for by every reader rather than only the wallet it belongs to.
local function indexAdd(state, index, order)
  local id = order.id
  if type(id) ~= "string" or index.slot[id] ~= nil then return end
  local book = marketBook(index, order.item)
  local rows = order.side == "buy" and book.buy or book.sell
  levelAdd(state, rows, int(order.price, 0), order)
  book.rev = book.rev + 1
  heapPush(index, id, int(order.expiresAt, 0))
  index.open = index.open + 1
  local held = index.accounts[order.account]
  if not held then held = { open = 0, ids = {} }; index.accounts[order.account] = held end
  if not held.ids[id] then
    held.ids[id] = true
    held.open = held.open + 1
  end
end

local function indexDrop(index, order)
  local id = order.id
  if index.slot[id] == nil then return false end
  local book = marketBook(index, order.item)
  local rows = order.side == "buy" and book.buy or book.sell
  levelRemove(rows, int(order.price, 0), id)
  book.rev = book.rev + 1
  heapDrop(index, id)
  index.open = math.max(0, index.open - 1)
  local held = index.accounts[order.account]
  if held and held.ids[id] then
    held.ids[id] = nil
    held.open = held.open - 1
    if held.open <= 0 then index.accounts[order.account] = nil end
  end
  return true
end

--- A trader's own recent fills, where they can find them again.
---
--- `state.fills` is a 500-row ring shared by every market, so a busy day
--- pushes a player's own trades off the end. This keeps the last few per
--- account, and it is a DERIVED ring like everything else in the index: never
--- exported, never published, rebuilt from `state.fills` when it is missing --
--- which is the honest cost of not carrying it, and the reason it is allowed
--- to hold rows the global list has already dropped.
---
--- Bounded at the point of append, per the rule in CLAUDE.md, and comfortably
--- above the twenty a caller asks for.
local ACCOUNT_FILL_RING = 24

--- How long a trader's personal fill ring outlives their last trade.
local ACCOUNT_FILL_DAYS = 30

--- Forget the rings of traders who have not traded in a month.
---
--- The ring was bounded in the wrong dimension. Each one is capped at 24 fills
--- -- and then kept forever, because unlike `index.accounts` (dropped in
--- `indexDrop` the moment an account's last order leaves) nothing ever removed
--- a ring. That is one table per address that has EVER traded, plus up to 24
--- fill tables each, and those fill tables are the ones `appendBounded` has
--- already evicted from `state.fills` -- so the 500-row cap on the global list
--- was not actually capping anything. A bound that something else keeps alive
--- is not a bound.
---
--- Age is the axis rather than "has live orders", which sounds right and is
--- exactly wrong: a fill is what REMOVES an order, so an account's ring is at
--- its most interesting in the moment it has nothing resting. Thirty days is
--- far longer than the 500-fill global ring survives on a busy market, so a
--- trader keeps their own history well past the point the shared list forgets
--- it -- which is what this ring is for.
local function pruneTradeRings(index, day)
  for account, ring in pairs(index.trades) do
    local newest = ring[#ring]
    if type(newest) ~= "table"
       or (day - (int(newest.filledAt, 0) // DAY)) >= ACCOUNT_FILL_DAYS then
      index.trades[account] = nil
    end
  end
end

local function indexFill(index, fill)
  -- Once a day, on the day's first fill. The sweep is O(traders held) and the
  -- only thing that can change its answer is the date.
  local day = int(fill.filledAt, 0) // DAY
  if day > 0 and int(index.tradesSweep, -1) < day then
    index.tradesSweep = day
    pruneTradeRings(index, day)
  end
  for _, account in ipairs({ fill.buyer, fill.seller }) do
    if type(account) == "string" and account ~= "" then
      local ring = index.trades[account]
      if not ring then ring = {}; index.trades[account] = ring end
      ring[#ring + 1] = fill
      while #ring > ACCOUNT_FILL_RING do table.remove(ring, 1) end
    end
  end
end

rebuildIndex = function(state)
  local index = {
    version = BOOK_INDEX_VERSION, at = 0, open = 0,
    accounts = {}, books = {}, ladders = {}, trades = {},
    heap = {}, slot = {}, due = {},
    dead = {}, deadHead = 1, deadTail = 0,
    fillsRev = 0, fillDigest = nil,
  }
  state.bookIndex = index
  for _, order in pairs(state.orders or {}) do
    if type(order) == "table" then indexAdd(state, index, order) end
  end
  -- Oldest first, so the per-account rings end up in the same order appending
  -- would have produced.
  for _, fill in ipairs(state.fills or {}) do
    if type(fill) == "table" then indexFill(index, fill) end
  end
  return index
end

--- Move the index's idea of "now", in whichever direction it is asked to.
---
--- Forward is the real case and the cheap one: pop everything the clock has
--- passed off the heap and queue it for the sweep. Backwards happens only when
--- something reads the book at an earlier instant than the last write, and it
--- is answered rather than ignored because the alternative is an index that
--- disagrees with `state.orders` about what was resting at a given moment --
--- which is precisely the class of bug an index exists to not introduce.
local function reconcile(state, index, timestamp)
  local now = int(timestamp, 0)
  if now >= int(index.at, 0) then
    while #index.heap > 0 do
      local id = index.heap[1]
      if int(index.due[id], 0) > now then break end
      local order = state.orders[id]
      if order then
        indexDrop(index, order)
        index.deadTail = index.deadTail + 1
        index.dead[index.deadTail] = id
      else
        heapDrop(index, id)
      end
    end
  else
    while index.deadTail >= index.deadHead do
      local id = index.dead[index.deadTail]
      local order = state.orders[id]
      if order and int(order.expiresAt, 0) <= now then break end
      if order then indexAdd(state, index, order) end
      index.dead[index.deadTail] = nil
      index.deadTail = index.deadTail - 1
    end
  end
  if index.deadHead > index.deadTail then index.deadHead = 1; index.deadTail = 0 end
  index.at = now
  return index
end

local function bookIndex(state, timestamp)
  local index = state.bookIndex
  if type(index) ~= "table" or int(index.version, 0) ~= BOOK_INDEX_VERSION then
    index = rebuildIndex(state)
  end
  return reconcile(state, index, timestamp)
end

--- THE ONLY TWO WAYS AN ORDER ENTERS OR LEAVES THE BOOK.
---
--- `state.orders` is the truth and the index is derived from it, so the two
--- have to move together or the index is not slow, it is WRONG: an order left
--- in it after a bulk cancel is matchable after its owner's escrow has already
--- been returned, which is a double spend rather than a stale reading. Making
--- that impossible is not a matter of remembering to call a hook at five call
--- sites -- new call sites get added -- so the map itself is only ever written
--- through here. There is no direct `state.orders[id] = ...` anywhere else in
--- this file, and there must not be.
---
--- Both are no-ops against a state whose index has not been built yet, because
--- whatever is written before the rebuild is read out of `state.orders` by the
--- rebuild itself.
local function putOrder(state, order)
  state.orders[order.id] = order
  local index = state.bookIndex
  if type(index) == "table" then indexAdd(state, index, order) end
end

local function dropOrder(state, order)
  state.orders[order.id] = nil
  local index = state.bookIndex
  if type(index) == "table" then indexDrop(index, order) end
end

--- An order stayed where it is but is no longer for what it was.
---
--- A partial fill and an in-place amend both change what a resting order still
--- offers without moving it, so the market's revision has to move even though
--- its levels did not -- otherwise a cached ladder keeps publishing the
--- quantity that order had before it traded.
local function touchBook(state, item)
  local index = state.bookIndex
  if type(index) ~= "table" then return end
  local book = index.books[item]
  if book then book.rev = book.rev + 1 end
end

--- A fill was written, so everything derived from `state.fills` has moved.
local function fillRecorded(state, fill)
  local index = state.bookIndex
  if type(index) ~= "table" then return end
  index.fillsRev = int(index.fillsRev, 0) + 1
  indexFill(index, fill)
end

--- Everything the published view wants out of `state.fills`, per market, in
--- ONE pass over the list instead of one pass per market.
---
--- `publicView` asked seven markets for their medians, their volumes and
--- their unique participants, and each of those questions walked all five
--- hundred fills -- so a read cost 3,500 iterations to answer a question that
--- is 500 iterations wide. It is keyed on the timestamp because every one of
--- these is an age window, and on the fill revision because a fill is the only
--- thing that can change the answer.
---
--- `band7` is separate from `prices7` and the difference is deliberate: the
--- price corridor never checked the SIGN of the age, so a fill stamped in the
--- future anchors the band while it is excluded from the published median.
--- Both spellings are preserved exactly as they were.
local function fillDigest(state, timestamp)
  local index = bookIndex(state, timestamp)
  local now = int(timestamp, 0)
  local cached = index.fillDigest
  if cached and cached.rev == int(index.fillsRev, 0) and cached.at == now then
    return cached.rows
  end
  local rows = {}
  local rowFor = function(item)
    local row = rows[item]
    if not row then
      row = { prices7 = {}, prices30 = {}, band7 = {}, volume24 = 0, volume7 = 0,
        makers = {}, takers = {} }
      rows[item] = row
    end
    return row
  end
  for _, fill in ipairs(state.fills or {}) do
    local row = rowFor(fill.item)
    local age = now - int(fill.filledAt, 0)
    local price = int(fill.price, 0)
    if age < 7 * DAY then row.band7[#row.band7 + 1] = price end
    if age >= 0 and age < 30 * DAY then row.prices30[#row.prices30 + 1] = price end
    if age >= 0 and age < DAY then row.volume24 = row.volume24 + int(fill.quantity, 0) end
    if age >= 0 and age < 7 * DAY then
      row.prices7[#row.prices7 + 1] = price
      row.volume7 = row.volume7 + int(fill.quantity, 0)
      -- Derived rather than stored; see the note on the fill record.
      local buyerTook = fill.takerSide == "buy"
      row.takers[buyerTook and fill.buyer or fill.seller] = true
      row.makers[buyerTook and fill.seller or fill.buyer] = true
    end
  end
  index.fillDigest = { rev = int(index.fillsRev, 0), at = now, rows = rows }
  return rows
end

local EMPTY_DIGEST = { prices7 = {}, prices30 = {}, band7 = {}, volume24 = 0,
  volume7 = 0, makers = {}, takers = {} }

--- One side of one market, collapsed to the ten price levels anybody draws.
---
--- Cached against that market's own revision, which moves when an order of
--- ITS is placed, cancelled, filled or reconciled away and never when another
--- market trades. A market nobody touched is not recomputed, which is the
--- whole reason `publicView` can afford to publish seven of these.
---
--- Only the levels that can survive the truncation are summed. A level outside
--- the best ten is worse than ten prices that are already in, so nothing the
--- house adds later can promote it -- and the summing is what costs, because
--- an order's remaining quantity is read from the order rather than mirrored
--- into the level. A mirror would be one more number to keep true on every
--- partial fill, for a saving nobody would measure.
local function p2pLadder(state, timestamp, item)
  local index = bookIndex(state, timestamp)
  local book = index.books[item]
  local rev = book and book.rev or -1
  local cached = index.ladders[item]
  if cached and cached.rev == rev then return cached.value end
  local value = { bestBid = nil, bestAsk = nil, bids = {}, asks = {} }
  if book then
    local sides = { { rows = book.buy, out = value.bids, best = true },
                    { rows = book.sell, out = value.asks, best = false } }
    for _, side in ipairs(sides) do
      local prices = side.rows.prices
      local at, step = #prices, -1               -- bids: highest first
      if not side.best then at, step = 1, 1 end  -- asks: lowest first
      local taken = 0
      while prices[at] ~= nil and taken < 10 do
        local price = prices[at]
        local quantity, orders = 0, 0
        for _, id in ipairs(side.rows.levels[price]) do
          local order = state.orders[id]
          if order then
            quantity = quantity + int(order.remaining, 0)
            orders = orders + 1
          end
        end
        if orders > 0 then
          taken = taken + 1
          side.out[taken] = { price = price, quantity = quantity, orders = orders }
          if side.best then
            if not value.bestBid or price > value.bestBid then value.bestBid = price end
          elseif not value.bestAsk or price < value.bestAsk then value.bestAsk = price end
        end
        at = at + step
      end
    end
  end
  index.ladders[item] = { rev = rev, value = value }
  return value
end

local function openOrdersFor(state, address, timestamp)
  local held = bookIndex(state, timestamp).accounts[address]
  return held and int(held.open, 0) or 0
end

--- The counter key for a refusal, with everything that varies taken out.
---
--- `state.rejected` is a permanent histogram: nothing removes a key, and the
--- whole map is deep-copied into the published view on every message. That is
--- only affordable while the key space is a fixed set of reasons -- and it was
--- not. Four of the refusals interpolate a live number:
---
---   "Price is below the 18 Gold price band"
---   "Price must be a multiple of 5"
---
--- The band is derived from market data and moves as the market moves, so a
--- player spamming out-of-band limit prices mints a new permanent key every
--- time the reference price shifts, for free, from an action that is REFUSED.
--- A refusal costs the sender nothing, which is exactly the wrong shape for
--- something that writes a key nothing can ever remove.
---
--- Digits are the only thing these messages interpolate, so collapsing every
--- run of them to `#` turns the key space back into the enum it was supposed to
--- be -- `"Price is below the # Gold price band"` counts them all -- without
--- touching a single call site or changing one character of what the player is
--- told, which is the separate `problem` string the caller returns.
---
--- The length cap is the backstop for any future reason built from something
--- that is not a number: a key is at most 96 bytes, whatever it was.
local function rejectionCode(reason)
  local code = (string.gsub(tostring(reason or "unknown"), "%d+", "#"))
  if #code > 96 then code = string.sub(code, 1, 96) end
  return code
end

local function recordRejected(state, reason)
  local code = rejectionCode(reason)
  state.rejected[code] = int(state.rejected[code], 0) + 1
end

function M.recordRejected(host, state, reason)
  state = host.ensure(state)
  recordRejected(state, reason)
end

local function appendBounded(list, row, limit)
  list[#list + 1] = row
  while #list > limit do table.remove(list, 1) end
end

local function replayedAction(state, account, actionId, kind)
  if actionId == nil or actionId == "" then return false, nil, nil end
  if type(actionId) ~= "string" or #actionId > 128 then
    return nil, nil, "ActionId must be at most 128 characters"
  end
  local key = tostring(account) .. ":" .. actionId
  local receipt = state.actionReceipts[key]
  if receipt and receipt.kind ~= kind then
    return nil, nil, "ActionId was already used for a different economy action"
  end
  return receipt ~= nil, key, nil
end

--- How long a replay guard is worth keeping, and the hard ceiling behind it.
---
--- THE BOUND USED TO BE A COUNT, AND THAT WAS A SAFETY BUG WEARING A SIZE FIX.
--- Evicting the oldest whenever the map passed 500 meant a busy hour dropped
--- receipts that were still inside a browser's retry window -- and an evicted
--- receipt does not fail safe, it RE-ARMS the double-place the whole mechanism
--- exists to prevent. The pressure that evicts it is other people's traffic,
--- so the failure gets likelier exactly when the book is busiest.
---
--- An hour is longer than any retry a client makes and shorter than the count
--- bound was in every quiet case, so this is both safer and usually smaller.
--- The ceiling stays as a backstop against a single burst, and it is set high
--- enough that reaching it is itself the anomaly.
local RECEIPT_TTL = 3600 * 1000
local RECEIPT_CEILING = 5000

--- Evictions per message, bounded the way `expireOrders` is bounded: the work
--- costs what it releases rather than what the map holds, so one message after
--- a quiet week does not pay for the whole week.
local RECEIPT_SWEEP = 50

local function rememberAction(state, key, kind, timestamp)
  if not key then return end
  state.actionReceipts[key] = { kind = kind, timestamp = timestamp }
  state.actionReceiptOrder[#state.actionReceiptOrder + 1] = key
  local swept = 0
  while swept < RECEIPT_SWEEP and #state.actionReceiptOrder > 0 do
    local oldest = state.actionReceiptOrder[1]
    local receipt = state.actionReceipts[oldest]
    local expired = receipt == nil
      or (int(timestamp, 0) - int(receipt.timestamp, 0)) >= RECEIPT_TTL
    if not expired and #state.actionReceiptOrder <= RECEIPT_CEILING then break end
    table.remove(state.actionReceiptOrder, 1)
    state.actionReceipts[oldest] = nil
    swept = swept + 1
  end
end

--- What an order is priced IN.
---
--- An order carries the market it was placed on, so this survives a market
--- being relisted with a different quote asset after the order was taken --
--- which is the one case where reaching for the registry's current row would
--- pay the wrong person in the wrong asset.
local function quoteAsset(state, order)
  local market = M.resolveMarket(state, order.market or order.item)
  return market and market.quote or "gold"
end

local function cancelOrder(host, state, ledger, order, timestamp, reason)
  if not order or not state.orders[order.id] then return end
  local present = ledger.exists(order.account)
  local remaining = math.max(0, int(order.remaining, 0))
  if order.side == "sell" then
    local baseUnits = remaining * math.max(1, int(order.lot, 1))
    if present then ledger.credit(order.account, order.item, baseUnits) end
    local row = host.pool(state, order.item)
    row.escrow = math.max(0, int(row.escrow, 0) - baseUnits)
    row.player = int(row.player, 0) + baseUnits
  else
    -- The QUOTE asset, not Gold. Every market that exists in the game is
    -- Gold-quoted so this is the same arithmetic it always was, but the
    -- refund used to name `state.gold` outright: a Rune-quoted market would
    -- have returned Rune escrow into the Gold supply and broken conservation
    -- on both. The order records the market it was placed on; use it.
    local quote = quoteAsset(state, order)
    local refund = int(order.price, 0) * remaining
    local row = host.pool(state, quote)
    row.escrow = math.max(0, int(row.escrow, 0) - refund)
    if present then
      ledger.credit(order.account, quote, refund)
      row.player = int(row.player, 0) + refund
    else
      -- Nobody to pay. Park it rather than lose it: the Gold invariant counts
      -- `locked`, so dropping it here would fail conservation on the next read.
      row.locked = int(row.locked, 0) + refund
    end
  end
  dropOrder(state, order)
  appendBounded(state.orderHistory, {
    id = order.id, account = order.account, item = order.item, side = order.side,
    market = order.market or marketId(order.item, "gold"),
    price = order.price, quantity = order.quantity, remaining = remaining,
    status = reason or "cancelled", closedAt = timestamp,
  }, C.ECONOMY.orderbook.historyLimit)
end

--- Release the escrow of orders the clock has already retired, up to `limit`.
---
--- The reconciliation in `bookIndex` has already taken them out of the book,
--- so this is only ever about giving the money and the goods back -- and it
--- costs what it releases rather than what the book holds. It used to sort
--- every id in `state.orders` to find at most twenty-five of them, on every
--- placement, which is the single most expensive thing a placement did before
--- it had even validated its price.
---
--- Sweep order is by expiry now rather than by the lexicographic accident of
--- sorting `"O1", "O10", "O2"` as strings: the order that died first is the
--- one whose owner has been waiting longest.
local function expireOrders(host, state, ledger, timestamp, limit)
  local index = bookIndex(state, timestamp)
  local expired = 0
  while expired < limit and index.deadTail >= index.deadHead do
    local id = index.dead[index.deadHead]
    index.dead[index.deadHead] = nil
    index.deadHead = index.deadHead + 1
    -- An expired order the owner cancelled themselves is already gone; it
    -- leaves the queue without being counted, exactly as the scan skipped it.
    local order = state.orders[id]
    if order then
      cancelOrder(host, state, ledger, order, timestamp, "expired")
      expired = expired + 1
    end
  end
  if index.deadHead > index.deadTail then index.deadHead = 1; index.deadTail = 0 end
  return expired
end

--- The best resting order a taker can hit, or nil.
---
--- `timestamp` is not optional and the expiry check is not decoration. Expiry
--- used to be enforced only by the sweep in `placeOrder`, which is bounded at
--- 25 against a global cap of 2,000 -- so the twenty-sixth expired order was
--- still live liquidity and would fill at a price its owner walked away from a
--- month earlier. Expiry is a property of the order, checked here, and the
--- sweep now only releases escrow.
--- Walk one side of one market, best price first, and stop at the first price
--- that does not cross. Price priority is the order of `rows.prices` and time
--- priority is the order inside a level, so the first eligible candidate IS
--- the answer -- where the scan this replaces compared every resting order in
--- the process against the taker, once per fill.
local function bestMatch(state, taker, timestamp)
  local index = bookIndex(state, timestamp)
  local book = index.books[taker.item]
  if not book then return nil end
  local rows = taker.side == "buy" and book.sell or book.buy
  local prices = rows.prices
  local at, step = 1, 1
  if taker.side == "sell" then at, step = #prices, -1 end
  local limit = int(taker.price, 0)
  while prices[at] ~= nil do
    local price = prices[at]
    local crosses = taker.side == "buy" and price <= limit
      or taker.side == "sell" and price >= limit
    if not crosses then return nil end
    local level = rows.levels[price]
    for slot = 1, #level do
      local candidate = state.orders[level[slot]]
      if candidate and candidate.id ~= taker.id
         and candidate.account ~= taker.account
         and int(candidate.remaining, 0) > 0 then
        return candidate
      end
    end
    at = at + step
  end
  return nil
end

local function marketDay(state, timestamp, item)
  local day = timestamp // DAY
  local row = state.marketDaily[day]
  if not row then row = {}; state.marketDaily[day] = row end
  local asset = row[item]
  if not asset then
    asset = { volume = 0, gold = 0, fills = 0, makers = {}, takers = {} }
    row[item] = asset
  end
  for key in pairs(state.marketDaily) do
    if int(key, day) < day - 35 then state.marketDaily[key] = nil end
  end
  return asset
end

--- Fold one fill into the day's candle and its volume.
---
--- Open/high/low/close live on the row that already carries volume, so a
--- candle costs four integers a day per market and no new key. The chart used
--- to reconstruct a line from `state.fills` client-side, which is capped at
--- 500 rows -- so a busy market went blank the moment its own history rolled
--- off the end. A candle is permanent, and 30 days of them is smaller than
--- the fills they replace. ORDERBOOK.md §2.8.
local function recordCandle(day, price, quantity, gross, maker, taker)
  day.volume = int(day.volume, 0) + quantity
  day.gold = int(day.gold, 0) + gross
  day.fills = int(day.fills, 0) + 1
  if day.o == nil then day.o = price end
  day.h = math.max(int(day.h, price), price)
  day.l = day.l ~= nil and math.min(int(day.l, price), price) or price
  day.c = price
  -- The house is not a participant. `uniqueMakers7d` is a reading of how many
  -- PLAYERS are willing to quote; counting the desk in it would report one
  -- extra maker in every market forever, including the empty ones.
  if maker then day.makers[maker] = true end
  if taker then day.takers[taker] = true end
end

--- A percentage fee against an asset that does not divide.
---
--- `ceil(gross * bps / BPS)` is what this used to be, and on a Gold market it
--- is a rounding detail. Against an indivisible quote it is not: at 200 bps a
--- three-unit fill pays `ceil(0.06) = 1`, a 33% fee, and small fills in a new
--- market are exactly where a venue cannot afford to be extortionate.
---
--- So the fee accrues in basis-point units and only whole units are ever
--- moved. Over any sequence of fills the venue collects precisely
--- `floor(total_gross * bps / BPS)` -- exact in aggregate, no minimum-fee
--- cliff, no floating point. The carry is always below `BPS`, so the most
--- anybody can gain or lose from where they land in the sequence is less than
--- one unit, and there is no way to extract that: skipping a fill only leaves
--- the shortfall for the next one. See ORDERBOOK.md §7.2.
local function accrueFee(market, gross, bps)
  bps = math.max(0, int(bps, 0))
  if bps == 0 or gross <= 0 then return 0 end
  local units = int(market.feeCarry, 0) + gross * bps
  local fee = units // BPS
  market.feeCarry = units % BPS
  if fee > gross then fee = gross end
  return fee
end

--- Route a collected fee to wherever that asset's fees go.
---
--- The book does not know. In the game a Gold fee is burned or locked against
--- the monetary target; in a venue it accrues to the venue's fee account. Both
--- are the host's business, and the whole of the book's business is that the
--- fee leaves the fill.
local function routeFee(host, state, asset, amount, timestamp, reason)
  if amount <= 0 then return end
  host.fee(state, asset, amount, timestamp, reason)
end

--- Cancel a remainder the book would never have accepted as an order.
---
--- A 400-lot ask at 12 Gold that gets swept down to one lot leaves a 12-Gold
--- order resting for its full lifetime -- below the `minValue` the book refused
--- to accept when it was placed. It is not liquidity anybody wants: it sits on
--- the TOUCH, so it is the first thing every taker has to walk past, and it
--- holds a price level, a heap slot, one of its owner's twenty account slots
--- and its share of every published byte until it expires.
---
--- OasisDEX has carried this since 2017 as a per-token `_dust` and cancels an
--- offer the moment a buy drops it below the limit. We had the check on the way
--- in and nowhere else. See ORDERBOOK.md §13.
---
--- The threshold is `minValue` itself rather than a second field, and that is
--- the point: the book will not leave resting an order it would not accept.
--- A market with `minValue = 0` -- which is every venue market that wants none
--- -- switches the rule off, exactly as it switches off the entry check.
---
--- The escrow goes back the way any cancel returns it, and the reason is its
--- own word so an owner can tell dust from an expiry.
local function retireDust(host, state, ledger, order, timestamp)
  if not order or not state.orders[order.id] then return false end
  local remaining = int(order.remaining, 0)
  if remaining <= 0 then return false end
  local market = M.resolveMarket(state, order.market or order.item)
  local floor = market and math.max(0, int(market.minValue, 0)) or 0
  if floor <= 0 or int(order.price, 0) * remaining >= floor then return false end
  cancelOrder(host, state, ledger, order, timestamp, "dust")
  return true
end

local function settleFill(host, state, ledger, taker, maker, timestamp)
  local buy = taker.side == "buy" and taker or maker
  local sell = taker.side == "sell" and taker or maker
  local quantity = math.min(int(buy.remaining, 0), int(sell.remaining, 0))
  local price = int(maker.price, 0) -- price-time: the resting order sets price
  local committed = int(buy.price, 0) * quantity
  local gross = price * quantity
  -- THE TAKER PAYS. The maker is never charged.
  --
  -- This used to charge the SELLER whatever side had rested, which is
  -- backwards: it penalised the person supplying liquidity and rewarded the
  -- person removing it. A maker quoting a new market is the one participant a
  -- venue cannot afford to tax, so the maker rate is zero on every market and
  -- there is no rebate -- a rebate is the single easiest thing to farm with a
  -- second wallet. See ORDERBOOK.md §7.3.
  local market = M.resolveMarket(state, maker.market or maker.item) or {}
  local quote = market.quote or "gold"
  local fee = accrueFee(market, gross, market.takerBps)
  local buyerHere = ledger.exists(buy.account)
  local sellerHere = ledger.exists(sell.account)
  local takerIsBuyer = taker.side == "buy"

  local quotePool = host.pool(state, quote)
  quotePool.escrow = math.max(0, int(quotePool.escrow, 0) - committed)
  local refund = committed - gross
  if buyerHere and refund > 0 then
    ledger.credit(buy.account, quote, refund)
    quotePool.player = int(quotePool.player, 0) + refund
  end
  -- A taking BUYER pays the fee out of free balance rather than escrow. That
  -- is safe because every fill a taker causes happens inside the same
  -- `placeOrder` call that checked their balance -- nothing else runs in
  -- between -- and `placeOrder` requires the fee on top of the escrow before
  -- it will take the order at all.
  if takerIsBuyer and fee > 0 and buyerHere then
    if ledger.debit(buy.account, quote, fee) then
      quotePool.player = math.max(0, int(quotePool.player, 0) - fee)
    end
  end
  -- A taking SELLER pays out of proceeds; there is always something to take it
  -- from, because they are receiving the quote asset.
  local sellerGets = takerIsBuyer and gross or (gross - fee)
  if sellerHere then
    ledger.credit(sell.account, quote, sellerGets)
    quotePool.player = int(quotePool.player, 0) + sellerGets
  end
  routeFee(host, state, quote, fee, timestamp, "P2P taker fee")

  -- `quantity` is lots; the base asset moves `quantity * lot` units. Both
  -- orders in a fill are on the same market, so either side's `lot` will do.
  local lot = math.max(1, int(maker.lot, int(taker.lot, 1)))
  local baseUnits = quantity * lot
  local asset = host.pool(state, buy.item)
  asset.escrow = math.max(0, int(asset.escrow, 0) - baseUnits)
  asset.player = int(asset.player, 0) + baseUnits
  if buyerHere then ledger.credit(buy.account, buy.item, baseUnits) end

  buy.remaining = int(buy.remaining, 0) - quantity
  sell.remaining = int(sell.remaining, 0) - quantity
  touchBook(state, buy.item)
  -- Monotonic, NOT `#state.fills + 1`: `appendBounded` pins that length at the
  -- history cap, so the old expression named every fill past the cap `F501`.
  state.fillSeq = int(state.fillSeq, 0) + 1
  -- FIVE FIELDS CARRYING TWO FACTS, until this was measured.
  --
  -- `maker` and `taker` are always a permutation of `buyer` and `seller`, and
  -- `feePayer` was assigned `taker.account` on the line below itself -- so
  -- three 43-character addresses said what one word says. `takerSide` is that
  -- word: whichever of the two accounts is on it took, and the other made and
  -- was not charged.
  --
  -- `gross` is `price * quantity` and `feeAsset` is the market's quote, both
  -- of which the record already carries. A fill was 482 bytes of which about
  -- a hundred were information, in a 500-row ring that every message pays for
  -- five times over. See ORDERBOOK.md §13.
  local fill = {
    id = "F" .. string.format("%d", state.fillSeq), item = buy.item,
    -- The pair this happened on, said rather than inferred. A consumer that
    -- rebuilt it as `item .. "/gold"` is right until the day an item lists
    -- against a quote that is not Gold, and then it is confidently wrong
    -- about a permanent record.
    market = market.id or maker.market or marketId(buy.item, "gold"),
    buyOrder = buy.id, sellOrder = sell.id,
    buyer = buy.account, seller = sell.account,
    takerSide = taker.side,
    price = price, quantity = quantity, fee = fee,
    filledAt = timestamp,
  }
  appendBounded(state.fills, fill, C.ECONOMY.orderbook.historyLimit)
  fillRecorded(state, fill)
  recordCandle(marketDay(state, timestamp, buy.item), price, quantity, gross,
    maker.account, taker.account)

  for _, order in ipairs({ buy, sell }) do
    if int(order.remaining, 0) <= 0 and state.orders[order.id] then
      dropOrder(state, order)
      appendBounded(state.orderHistory, {
        id = order.id, account = order.account, item = order.item,
        side = order.side, market = order.market or marketId(order.item, "gold"),
        price = order.price, quantity = order.quantity,
        remaining = 0, status = "filled", closedAt = timestamp,
      }, C.ECONOMY.orderbook.historyLimit)
    end
  end
  -- The MAKER only. The taker is still sweeping -- its remainder may fill on
  -- the very next turn of `matchOrder`'s loop -- so it is checked once, after
  -- matching finishes, beside `retireRemainder`.
  retireDust(host, state, ledger, maker, timestamp)
  return fill
end

--- Time in force. Four values on one tag, and everything else is a special
--- case of them.
---
--- `gtc` rests whatever it could not fill, which is the only behaviour this
--- book used to have. `ioc` is the market order -- take what is there at this
--- limit or better and cancel the rest -- so a client offering "spend N Gold"
--- reads the ask ladder, computes a limit and sends an IOC. `fok` refuses
--- unless the whole quantity can be taken at once. `postonly` refuses to
--- cross, which is what a maker needs in order to never pay a taker fee by
--- accident.
---
--- The process NEVER accepts an unpriced order. A market order with no limit
--- is a promise to pay whatever the worst resting order asks, and against a
--- 1,000,000 price ceiling that is a loaded gun pointed at the person sending
--- it. The limit is the client's job. ORDERBOOK.md §3.2.
local TIF = { gtc = true, ioc = true, fok = true, postonly = true }

--- Self-trade prevention: three modes, cancelling the resting side by default.
---
--- Refusing the whole order is correct on safety and hostile in use. A market
--- maker adjusting a quote got an error instead of a trade and the only remedy
--- was cancel-then-place, paying the creation cost twice and losing queue
--- position -- so the book punished exactly the participant it needs.
--- `cancelresting` cancels the account's own crossing orders and carries on
--- matching, which is what every real venue does. `reject` is the old
--- behaviour, kept because an automated maker may prefer to be told rather
--- than to have an order quietly pulled. `cancelboth` walks away from both
--- sides and places nothing.
---
--- The `candidate.account ~= taker.account` guard in `bestMatch` stays in
--- place under all three. This is the belt; that is the braces.
local STP = { cancelresting = true, reject = true, cancelboth = true }

--- Every resting order an incoming one would trade with, best price first.
---
--- Both of the callers below used to walk the whole book to ask this, one of
--- them once per placement and the other once per placement AND once per
--- amend. It is one walk of one side of one market now, and it stops at the
--- first price that does not cross -- an order that crosses nothing looks at
--- exactly one price level, which is the common case.
local function crossingOrders(state, item, side, price, timestamp, visit)
  local book = bookIndex(state, timestamp).books[item]
  if not book then return end
  local rows = side == "buy" and book.sell or book.buy
  local prices = rows.prices
  local at, step = 1, 1
  if side == "sell" then at, step = #prices, -1 end
  while prices[at] ~= nil do
    local level = prices[at]
    local crosses = side == "buy" and level <= price or side == "sell" and level >= price
    if not crosses then return end
    local ids = rows.levels[level]
    for slot = 1, #ids do
      local resting = state.orders[ids[slot]]
      -- Expiry is not re-checked: the index has already taken every order the
      -- clock passed out of the levels, which is the whole point of it.
      if resting and int(resting.remaining, 0) > 0 then visit(resting) end
    end
    at = at + step
  end
end

--- The account's own resting orders that an incoming order would trade with.
local function selfCrossing(state, account, item, side, price, timestamp)
  local rows = {}
  crossingOrders(state, item, side, price, timestamp, function(own)
    if own.account == account then rows[#rows + 1] = own end
  end)
  return rows
end

--- How many lots of `order` could be filled right now, book and house.
---
--- Read-only, and that is the point: `fok` has to know before any escrow is
--- taken, because a fill-or-kill that is going to be killed must leave the
--- book exactly as it found it, and `postonly` has to refuse before it has
--- charged anybody anything.
local function crossingDepth(state, order, timestamp, house)
  local total = 0
  for _, level in ipairs(house and house.levels or {}) do
    local crosses = order.side == "buy" and level.price <= int(order.price, 0)
      or order.side == "sell" and level.price >= int(order.price, 0)
    if crosses then total = total + int(level.units, 0) end
  end
  crossingOrders(state, order.item, order.side, int(order.price, 0), timestamp,
    function(candidate)
      if candidate.id ~= order.id and candidate.account ~= order.account then
        total = total + int(candidate.remaining, 0)
      end
    end)
  return total
end

--- The corridor an order may be priced in.
---
--- Without one, `maxPrice` is the only limit: a single crossing order can
--- print 1,000,000 and that print becomes the 7-day median every other system
--- reads as the truth. The guard is anchored on the NPC desk's own bid and ask
--- wherever there is a desk -- so it can never refuse a price the house itself
--- is quoting -- widened by `bandBps` on each side, and falls back to the
--- recent median and then to the book's own resting prices.
---
--- A market with no desk, no fills and no orders has NO reference and is not
--- checked at all. That is deliberate: the first order in a market is what
--- establishes the reference, and there is nothing to compare it against.
local function priceBand(host, state, market, item, timestamp)
  local bps = math.max(0, int(market and market.bandBps, 0))
  if bps == 0 then return nil, nil end
  local low, high = nil, nil
  local anchor = function(value)
    value = int(value, 0)
    if value <= 0 then return end
    if not low or value < low then low = value end
    if not high or value > high then high = value end
  end
  local bid, ask = hostAnchors(host, state, item)
  anchor(bid); anchor(ask)
  if not low then
    anchor(median(copy((fillDigest(state, timestamp)[item] or EMPTY_DIGEST).band7)))
  end
  if not low then
    -- The book's own extremes. Each side's prices are already sorted, so the
    -- widest pair of resting prices is four lookups rather than a walk of
    -- every order in the process.
    local book = bookIndex(state, timestamp).books[item]
    if book then
      for _, rows in ipairs({ book.buy, book.sell }) do
        anchor(rows.prices[1]); anchor(rows.prices[#rows.prices])
      end
    end
  end
  if not low then return nil, nil end
  return math.max(1, (low * (BPS - math.min(bps, BPS - 1))) // BPS),
    (high * (BPS + bps) + BPS - 1) // BPS
end

--- Match an order against the book and the house, best price first.
---
--- The house is the NPC desk quoting into the same ladder, and at any given
--- price it is deliberately the LAST choice: a resting player order at the
--- same price wins because it was there first, and because the whole point of
--- the desk is to be the price you get when nobody better is quoting. That is
--- the invariant ORDERBOOK.md §9 asks for by name -- while the P2P best sits
--- inside the desk's band the desk is never the best price on either side, and
--- the moment P2P leaves the band it is.
local function matchOrder(host, state, ledger, order, timestamp, house)
  local fills = {}
  local levels = house and house.levels or {}
  while int(order.remaining, 0) > 0 do
    local maker = bestMatch(state, order, timestamp)
    local level = levels[1]
    while level and int(level.units, 0) <= 0 do
      table.remove(levels, 1); level = levels[1]
    end
    local houseCrosses = level ~= nil and (order.side == "buy"
      and level.price <= int(order.price, 0)
      or order.side == "sell" and level.price >= int(order.price, 0))
    local takeMaker = maker ~= nil
    if takeMaker and houseCrosses then
      takeMaker = order.side == "buy" and int(maker.price, 0) <= level.price
        or order.side == "sell" and int(maker.price, 0) >= level.price
    end
    if takeMaker then
      fills[#fills + 1] = settleFill(host, state, ledger, order, maker, timestamp)
    elseif houseCrosses then
      local units = math.min(int(order.remaining, 0), int(level.units, 0))
      local fill = host.settleHouse(state, ledger, house.desk, order, level.price, units, timestamp)
      if not fill then break end
      level.units = int(level.units, 0) - units
      fills[#fills + 1] = fill
    else
      break
    end
  end
  return fills
end

--- Retire whatever an `ioc` or `fok` order did not fill.
local function retireRemainder(host, state, ledger, order, timestamp, tif)
  if int(order.remaining, 0) <= 0 or not state.orders[order.id] then return false end
  if tif ~= "ioc" and tif ~= "fok" then return false end
  cancelOrder(host, state, ledger, order, timestamp,
    tif == "fok" and "killed" or "expired-immediately")
  return true
end

function M.placeOrder(host, state, account, side, item, price, quantity, timestamp, actionId, opts)
  state = host.ensure(state)
  local ledger = host.ledger
  opts = type(opts) == "table" and opts or {}
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "order.place")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId, fills = {} }, nil end
  local cfg = C.ECONOMY.orderbook
  side = tostring(side or ""):lower()
  price = int(price, 0)
  quantity = int(quantity, 0)
  local tif = mode(opts.tif, "gtc")
  local stp = mode(opts.stp, "cancelresting")
  -- The trader picks the lifetime, capped at the configured maximum and
  -- floored so nothing can be placed already dead. ORDERBOOK.md §9.
  local lifetime = clamp(int(opts.expiresIn, cfg.expiry), cfg.minExpiry, cfg.expiry)
  -- Before validating, not after: a sweep returns escrow to its owner, and an
  -- account whose own stale orders are holding its Gold should be able to fund
  -- the order it is placing right now out of that release.
  expireOrders(host, state, ledger, timestamp, 25)
  local held = function(asset) return ledger.balance(account, asset) end
  local market = M.resolveMarket(state, item)
  -- `quantity` is in LOTS; the base asset moves `quantity * lot` units. Both
  -- are 1:1 on every market that exists today, so this is arithmetic waiting
  -- for a market that needs it rather than a change in behaviour.
  local lot = market and math.max(1, int(market.lot, 1)) or 1
  local baseUnits = quantity * lot
  local quote = market and market.quote or "gold"
  local creationCost = math.max(0, int(market and market.creationCost, cfg.creationCost))
  -- The most a taking buy could owe in fees, checked up front.
  --
  -- A taking buyer pays the fee from free balance at fill time (see
  -- `settleFill`), so the balance has to be known good BEFORE the order is
  -- taken -- otherwise a sweep could reach a maker it cannot pay, and the
  -- maker is already entitled by then. `gross` never exceeds `committed`, so
  -- the ceiling on the limit price is a true upper bound.
  local takerFeeCeiling = 0
  if market and side == "buy" then
    local bps = math.max(0, int(market.takerBps, 0))
    if bps > 0 then
      takerFeeCeiling = (price * quantity * bps + BPS - 1) // BPS
    end
  end
  local bandLow, bandHigh = nil, nil
  if market then bandLow, bandHigh = priceBand(host, state, market, item, timestamp) end
  local problem = nil
  local stopped = host.pauseReason(state)
  if stopped then
    problem = "Economy is paused: " .. stopped
  elseif not ledger.exists(account) then problem = "No such player"
  elseif side ~= "buy" and side ~= "sell" then problem = "Side must be buy or sell"
  elseif not TIF[tif] then problem = "Time in force must be GTC, IOC, FOK or PostOnly"
  elseif not STP[stp] then problem = "Self-trade mode must be CancelResting, Reject or CancelBoth"
  elseif not market or not host.tradable(state, item) then
    problem = "That item is not traded for Gold"
  elseif market.status ~= "open" then
    problem = "That market is " .. tostring(market.status)
  elseif price <= 0 or price > int(market.maxPrice, cfg.maxUnitPrice) then
    problem = "Invalid unit price"
  elseif price % math.max(1, int(market.tick, 1)) ~= 0 then
    problem = "Price must be a multiple of " .. string.format("%d", int(market.tick, 1))
  elseif bandLow and price < bandLow then
    problem = "Price is below the " .. string.format("%d", bandLow) .. " Gold price band"
  elseif bandHigh and price > bandHigh then
    problem = "Price is above the " .. string.format("%d", bandHigh) .. " Gold price band"
  elseif quantity <= 0 or quantity > int(market.maxQuantity, cfg.maxQuantity) then
    problem = "Invalid quantity"
  elseif price * quantity < int(market.minValue, cfg.minValue) then
    problem = "Order value is below 10 Gold"
  elseif openOrdersFor(state, account, timestamp) >= cfg.maxPerAccount then
    problem = "Open-order account limit reached"
  elseif bookIndex(state, timestamp).open >= cfg.maxGlobal then
    problem = "Global open-order limit reached"
  elseif side == "sell" and held(item) < baseUnits then
    problem = "Not enough " .. tostring(item)
  elseif side == "sell" and held(quote) < creationCost then
    problem = "The order-creation cost is "
      .. string.format("%d", creationCost) .. " " .. quote
  elseif side == "buy"
     and held(quote) < price * quantity + creationCost + takerFeeCeiling then
    problem = "Not enough " .. quote .. " for order escrow and creation cost"
  end

  -- The house quote, and every check that depends on knowing what is
  -- available. Nothing below this line may mutate until every refusal has been
  -- taken: a killed `fok` and a crossing `postonly` must leave the book
  -- exactly as they found it, including the orders STP would have cancelled.
  local house, mine = nil, {}
  if not problem then
    house = hostQuote(host, state, ledger, item, side, account, timestamp,
      opts.withdrawals, opts.deposits)
    mine = selfCrossing(state, account, item, side, price, timestamp)
    local probe = { id = "", item = item, side = side, price = price,
      account = account, remaining = quantity }
    local depth = crossingDepth(state, probe, timestamp, house)
    if tif == "postonly" and (depth > 0 or #mine > 0) then
      problem = "A post-only order may not cross the book"
    elseif tif == "fok" and depth < quantity then
      problem = "Fill-or-kill could not be filled in full"
    elseif stp == "reject" and #mine > 0 then
      problem = "Self-trading is not allowed"
    end
  end
  if problem then recordRejected(state, problem); return nil, problem end

  rememberAction(state, receiptKey, "order.place", timestamp)
  -- Self-trade prevention, applied. `cancelboth` leaves the account flat and
  -- places nothing, which is a result rather than an error.
  for _, own in ipairs(mine) do
    cancelOrder(host, state, ledger, own, timestamp, "self-trade")
  end
  if stp == "cancelboth" and #mine > 0 then
    return { order = nil, fills = {}, open = false,
      selfCancelled = #mine, tif = tif, stp = stp }, nil
  end

  -- The creation cost is charged in the market's QUOTE asset, and routed the
  -- same way a taker fee is. Naming Gold here was only ever right because
  -- every market is Gold-quoted.
  if creationCost > 0 and ledger.debit(account, quote, creationCost) then
    local row = host.pool(state, quote)
    row.player = math.max(0, int(row.player, 0) - creationCost)
    routeFee(host, state, quote, creationCost, timestamp, "Order creation")
  end

  state.orderSeq = int(state.orderSeq, 0) + 1
  local order = {
    id = "O" .. string.format("%d", state.orderSeq), seq = state.orderSeq,
    account = account, side = side, item = item, price = price,
    market = market.id, lot = lot,
    quantity = quantity, remaining = quantity,
    createdAt = timestamp, expiresAt = timestamp + lifetime,
  }
  -- Lock, in one shape for both sides: take it off the account, move the same
  -- amount from the asset's `player` bucket into its `escrow` bucket. The only
  -- difference between a bid and an ask is which asset moves.
  if side == "sell" then
    ledger.debit(account, item, baseUnits)
    local row = host.pool(state, item)
    row.player = math.max(0, int(row.player, 0) - baseUnits)
    row.escrow = int(row.escrow, 0) + baseUnits
  else
    local commitment = price * quantity
    ledger.debit(account, quote, commitment)
    local row = host.pool(state, quote)
    row.player = math.max(0, int(row.player, 0) - commitment)
    row.escrow = int(row.escrow, 0) + commitment
  end
  putOrder(state, order)

  local fills = matchOrder(host, state, ledger, order, timestamp, house)
  local killed = retireRemainder(host, state, ledger, order, timestamp, tif)
  -- Now that the sweep is over, whatever is left of the taker is a resting
  -- order like any other and has to clear the same floor. See `retireDust`.
  local dusted = not killed and retireDust(host, state, ledger, order, timestamp)
  return {
    order = copy(order), fills = fills, open = state.orders[order.id] ~= nil,
    tif = tif, stp = stp, selfCancelled = #mine, killed = killed,
    dusted = dusted or nil,
    bandLow = bandLow, bandHigh = bandHigh,
  }, nil
end

--- Move a quote without leaving the book.
---
--- Cancel-and-replace is two messages (~200 ms), two creation costs and a lost
--- place in the queue, and a maker adjusting a quote is the single most common
--- thing anybody does on a book. So: an amend that only LOWERS quantity at the
--- same price keeps its `seq` and its id, because nobody behind it in the
--- queue is disadvantaged by it asking for less. Anything else -- a new price,
--- or more quantity -- goes to the back with a new id, because it is a new
--- order in every sense that matters to the person it queue-jumped.
---
--- No creation cost either way. The whole reason to have an amend is that
--- charging for a re-quote taxes precisely the behaviour a book needs.
function M.amendOrder(host, state, account, orderId, price, quantity, timestamp, actionId, opts)
  state = host.ensure(state)
  local ledger = host.ledger
  opts = type(opts) == "table" and opts or {}
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "order.amend")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId, fills = {} }, nil end
  local cfg = C.ECONOMY.orderbook
  local order = state.orders[orderId or ""]
  local problem = nil
  local stopped = host.pauseReason(state)
  if stopped then
    problem = "Economy is paused: " .. stopped
  elseif not order then problem = "No such order"
  elseif order.account ~= account then problem = "That is not your order"
  elseif int(order.expiresAt, 0) <= timestamp then problem = "That order has expired"
  end
  if problem then recordRejected(state, problem); return nil, problem end

  local market = M.resolveMarket(state, order.market or order.item)
  price = int(price, int(order.price, 0))
  quantity = int(quantity, int(order.remaining, 0))
  local tif = mode(opts.tif, "gtc")
  local stp = mode(opts.stp, "cancelresting")
  local inPlace = price == int(order.price, 0) and quantity <= int(order.remaining, 0)
  local bandLow, bandHigh = priceBand(host, state, market, order.item, timestamp)
  if not market then problem = "That item is not traded for Gold"
  elseif market.status ~= "open" then problem = "That market is " .. tostring(market.status)
  elseif tif == "fok" or tif == "ioc" then
    -- An amend is a resting instruction. A trader who wants to take liquidity
    -- sends an order; there is nothing for an immediate-or-cancel amend to
    -- leave behind, so asking for one is a mistake worth naming.
    problem = "An amend may only be GTC or PostOnly"
  elseif price <= 0 or price > int(market.maxPrice, cfg.maxUnitPrice) then
    problem = "Invalid unit price"
  elseif price % math.max(1, int(market.tick, 1)) ~= 0 then
    problem = "Price must be a multiple of " .. string.format("%d", int(market.tick, 1))
  elseif bandLow and price < bandLow then
    problem = "Price is below the " .. string.format("%d", bandLow) .. " Gold price band"
  elseif bandHigh and price > bandHigh then
    problem = "Price is above the " .. string.format("%d", bandHigh) .. " Gold price band"
  elseif quantity <= 0 or quantity > int(market.maxQuantity, cfg.maxQuantity) then
    problem = "Invalid quantity"
  elseif price * quantity < int(market.minValue, cfg.minValue) then
    problem = "Order value is below 10 Gold"
  end
  if problem then recordRejected(state, problem); return nil, problem end

  local lot = math.max(1, int(order.lot, 1))
  local quote = market.quote or "gold"
  -- What the amended order needs held, against what this one already holds.
  local wanted = order.side == "sell" and quantity * lot or price * quantity
  local locked = order.side == "sell" and int(order.remaining, 0) * lot
    or int(order.price, 0) * int(order.remaining, 0)
  local asset = order.side == "sell" and order.item or quote
  if wanted > locked and ledger.balance(account, asset) < wanted - locked then
    problem = order.side == "sell"
      and ("Not enough " .. tostring(order.item))
      or "Not enough Gold to increase the order"
    recordRejected(state, problem); return nil, problem
  end

  local house, mine = nil, {}
  if not inPlace then
    house = hostQuote(host, state, ledger, order.item, order.side, account, timestamp,
      opts.withdrawals, opts.deposits)
    -- The order being amended is not competing with itself: it is about to
    -- stop existing at its old price.
    mine = {}
    for _, own in ipairs(selfCrossing(state, account, order.item, order.side, price, timestamp)) do
      if own.id ~= order.id then mine[#mine + 1] = own end
    end
    local probe = { id = order.id, item = order.item, side = order.side,
      price = price, account = account, remaining = quantity }
    local depth = crossingDepth(state, probe, timestamp, house)
    if tif == "postonly" and (depth > 0 or #mine > 0) then
      problem = "A post-only order may not cross the book"
    elseif stp == "reject" and #mine > 0 then
      problem = "Self-trading is not allowed"
    end
    if problem then recordRejected(state, problem); return nil, problem end
  end

  rememberAction(state, receiptKey, "order.amend", timestamp)

  if inPlace then
    -- Same price, same or smaller size: keep the id, keep the queue position,
    -- and release the difference. Nothing else in the book moves.
    local release = locked - wanted
    -- `quantity` is the order's original size and `remaining` what is left of
    -- it, so shrinking one shrinks the other: the amount already filled does
    -- not change, and `remaining/quantity` has to keep meaning what it says.
    local filled = int(order.quantity, 0) - int(order.remaining, 0)
    order.remaining = quantity
    order.quantity = filled + quantity
    touchBook(state, order.item)
    if release > 0 then
      if order.side == "sell" then
        local row = host.pool(state, order.item)
        row.escrow = math.max(0, int(row.escrow, 0) - release)
        row.player = int(row.player, 0) + release
        ledger.credit(account, order.item, release)
      else
        local row = host.pool(state, asset)
        row.escrow = math.max(0, int(row.escrow, 0) - release)
        row.player = int(row.player, 0) + release
        ledger.credit(account, quote, release)
      end
    end
    return { order = copy(order), fills = {}, open = true, requeued = false,
      orderId = order.id, released = math.max(0, release) }, nil
  end

  -- A re-queue. Return everything the old order held, then take exactly what
  -- the new one needs: two moves in the same message, so nothing is ever
  -- unfunded in between and the conservation invariants hold throughout.
  for _, own in ipairs(mine) do
    cancelOrder(host, state, ledger, own, timestamp, "self-trade")
  end
  if stp == "cancelboth" and #mine > 0 then
    cancelOrder(host, state, ledger, order, timestamp, "self-trade")
    return { order = nil, fills = {}, open = false, requeued = false,
      selfCancelled = #mine + 1 }, nil
  end
  local previous = order.id
  cancelOrder(host, state, ledger, order, timestamp, "amended")
  state.orderSeq = int(state.orderSeq, 0) + 1
  local replacement = {
    id = "O" .. string.format("%d", state.orderSeq), seq = state.orderSeq,
    account = account, side = order.side, item = order.item, price = price,
    market = market.id, lot = lot,
    quantity = quantity, remaining = quantity,
    createdAt = timestamp, expiresAt = int(order.expiresAt, timestamp),
    amendedFrom = previous,
  }
  if replacement.side == "sell" then
    ledger.debit(account, order.item, quantity * lot)
    local row = host.pool(state, order.item)
    row.player = math.max(0, int(row.player, 0) - quantity * lot)
    row.escrow = int(row.escrow, 0) + quantity * lot
  else
    ledger.debit(account, quote, price * quantity)
    local row = host.pool(state, asset)
    row.player = math.max(0, int(row.player, 0) - price * quantity)
    row.escrow = int(row.escrow, 0) + price * quantity
  end
  putOrder(state, replacement)
  local fills = matchOrder(host, state, ledger, replacement, timestamp, house)
  retireDust(host, state, ledger, replacement, timestamp)
  return {
    order = copy(replacement), fills = fills,
    open = state.orders[replacement.id] ~= nil,
    requeued = true, orderId = replacement.id, amendedFrom = previous,
    selfCancelled = #mine,
  }, nil
end

function M.cancelOrder(host, state, account, orderId, timestamp, actionId)
  state = host.ensure(state)
  local ledger = host.ledger
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "order.cancel")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId }, nil end
  local order = state.orders[orderId or ""]
  if not order then recordRejected(state, "No such order"); return nil, "No such order" end
  if order.account ~= account then
    recordRejected(state, "That is not your order")
    return nil, "That is not your order"
  end
  rememberAction(state, receiptKey, "order.cancel", timestamp)
  cancelOrder(host, state, ledger, order, timestamp, "cancelled")
  return { cancelled = orderId, cancelledIds = { orderId } }, nil
end

--- Leave the book in one message.
---
--- A maker with twenty quotes paid twenty messages to step away, which is
--- ~2 seconds of being unable to withdraw a price that has gone wrong. This is
--- the one place batching is legitimate under the repo's "do not batch
--- interactive actions" rule: it is a single user intent -- *get me out* --
--- over many state transitions, and there is no decision between them for the
--- player to make. ORDERBOOK.md §2.3.
---
--- It is bounded by construction: `maxPerAccount` is the most orders an
--- account can have, so a cancel-all is at most that many releases.
---
--- `ids` cancels exactly those, `item` everything in one market, and neither
--- cancels the whole account's book. Ownership is checked on every single id,
--- because the ids are guessable (`O` + sequence) and a verb that acts on an
--- order id without an ownership check is the one way this book leaks.
function M.cancelOrders(host, state, account, filter, timestamp, actionId)
  state = host.ensure(state)
  local ledger = host.ledger
  filter = type(filter) == "table" and filter or {}
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "order.cancelAll")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId, cancelledIds = {} }, nil end
  local wanted = nil
  if type(filter.ids) == "table" and #filter.ids > 0 then
    wanted = {}
    for _, id in ipairs(filter.ids) do wanted[tostring(id)] = true end
  end
  local item = type(filter.item) == "string" and filter.item ~= "" and filter.item or nil
  -- The account's own ids, not everybody's. This walked and sorted the whole
  -- book to find at most twenty orders belonging to one wallet.
  --
  -- Both halves are needed and the second one is the easy half to forget: an
  -- expired order is out of the index but its escrow has not been released
  -- yet, and cancel-all always could -- and still must -- take it with the
  -- rest rather than leave the trader holding an order they were told was
  -- cancelled. The ids are sorted so the receipt lists them in the same order
  -- it always did.
  local index = bookIndex(state, timestamp)
  local held = index.accounts[account]
  local ids = {}
  if held then for id in pairs(held.ids) do ids[#ids + 1] = id end end
  for at = index.deadHead, index.deadTail do
    local waiting = state.orders[index.dead[at] or ""]
    if waiting and waiting.account == account then ids[#ids + 1] = waiting.id end
  end
  table.sort(ids)
  local doomed = {}
  for _, id in ipairs(ids) do
    local order = state.orders[id]
    if order and (not wanted or wanted[id])
       and (not item or order.item == item) then
      doomed[#doomed + 1] = order
    end
  end
  if #doomed == 0 then
    local problem = "No open orders matched"
    recordRejected(state, problem); return nil, problem
  end
  rememberAction(state, receiptKey, "order.cancelAll", timestamp)
  local cancelled = {}
  for _, order in ipairs(doomed) do
    cancelled[#cancelled + 1] = order.id
    cancelOrder(host, state, ledger, order, timestamp, "cancelled")
  end
  return { cancelled = #cancelled, cancelledIds = cancelled, item = item }, nil
end


function M.maintain(host, state, timestamp, limit)
  state = host.ensure(state)
  return expireOrders(host, state, host.ledger, timestamp, clamp(limit, 1, 100))
end

--- What a caller needs to render one player's own book, without reading it.
---
--- `playerView` runs twice a message for the acting wallet on EVERY verb, and
--- it was walking two thousand orders and five hundred fills to fill in two
--- fields that come back nil for a player who has never traded. These three
--- answer the same questions off the index.
---
--- `accountOpenCount` is the one that matters: it is a counter lookup, so the
--- overwhelmingly common answer -- zero -- costs nothing and the caller can
--- stop there. The other two return NIL rather than an empty table when there
--- is nothing, because an empty Lua table encodes as `[]` and these go into
--- `player-<address>`, which is written once per wallet ever seen and paid for
--- by every message afterwards.
---
--- `timestamp` is optional on all three: without one they answer as of the
--- last instant the book was reconciled to, which is the last thing that
--- happened. Rows are copies; nothing hands a caller a live order.
function M.accountOpenCount(host, state, account, timestamp)
  state = host.ensure(state)
  local index = bookIndex(state, timestamp or state.bookIndex.at)
  local held = index.accounts[account or ""]
  return held and int(held.open, 0) or 0
end

function M.accountOrders(host, state, account, timestamp)
  state = host.ensure(state)
  local index = bookIndex(state, timestamp or state.bookIndex.at)
  local held = index.accounts[account or ""]
  if not held then return nil end
  local rows = {}
  local now = int(timestamp, int(index.at, 0))
  for id in pairs(held.ids) do
    local order = state.orders[id]
    -- Belt to the reconciliation's braces. A caller that hands over no
    -- timestamp is answered as of the last instant something happened, and on
    -- a process that has not acted since it was restored that is instant zero.
    if order and int(order.expiresAt, 0) > now then rows[#rows + 1] = copy(order) end
  end
  if #rows == 0 then return nil end
  -- Newest first: the quote a trader just placed is the one they are looking
  -- for, and `seq` is the only total order the book guarantees.
  table.sort(rows, function(a, b) return int(a.seq, 0) > int(b.seq, 0) end)
  return rows
end

function M.accountFills(host, state, account, limit)
  state = host.ensure(state)
  local ring = state.bookIndex.trades[account or ""]
  if not ring or #ring == 0 then return nil end
  local wanted = limit == nil and ACCOUNT_FILL_RING or clamp(limit, 1, ACCOUNT_FILL_RING)
  local rows = {}
  for at = #ring, 1, -1 do
    if #rows >= wanted then break end
    rows[#rows + 1] = copy(ring[at])
  end
  return rows
end

--- Collapse a side of the book into a price ladder.
---
--- One row per PRICE, not one row per order. Ten orders resting at the same
--- price are one level with the quantity summed and `orders` counting them --
--- which is both what a trader reads and, at the cap, strictly fewer bytes to
--- publish than ten identical lines that hid the next nine price levels.
local function ladder(levels, descending, limit)
  local rows = {}
  for price, level in pairs(levels) do
    rows[#rows + 1] = { price = price, quantity = level.quantity,
      orders = level.orders, house = level.house > 0 and level.house or nil }
  end
  table.sort(rows, function(a, b)
    if descending then return a.price > b.price end
    return a.price < b.price
  end)
  while #rows > limit do table.remove(rows) end
  return rows
end

--- The reference price the corridor is measured against, for the client.
--- Published so the order ticket can say WHY a price will be refused before
--- the player pays a message to find out.
local function bandView(host, state, item, timestamp)
  local market = M.resolveMarket(state, item)
  if not market then return nil end
  local low, high = priceBand(host, state, market, item, timestamp)
  if not low then return nil end
  return { low = low, high = high, bps = int(market.bandBps, 0) }
end

--- Daily OHLCV, newest last, for as many days as the config keeps.
---
--- The whole reason candles exist here is that `state.fills` is a 500-row
--- ring: a chart drawn from it goes blank as soon as the window it is drawing
--- is older than the last five hundred trades. A candle is permanent, four
--- integers wide, and already sitting on the row that carries the day's
--- volume -- so publishing it costs a handful of bytes per market per day and
--- removes the only reason the client needed the raw fills at all.
local function candleView(state, timestamp, item)
  local today = timestamp // DAY
  local keep = math.max(1, int(C.ECONOMY.orderbook.candleDays, 30))
  local days = {}
  for day, row in pairs(state.marketDaily or {}) do
    local age = today - int(day, today)
    local candle = type(row) == "table" and row[item] or nil
    if age >= 0 and age < keep and candle and candle.o ~= nil then
      days[#days + 1] = { d = int(day, 0), o = int(candle.o, 0), h = int(candle.h, 0),
        l = int(candle.l, 0), c = int(candle.c, 0),
        v = int(candle.volume, 0), g = int(candle.gold, 0), n = int(candle.fills, 0) }
    end
  end
  table.sort(days, function(a, b) return a.d < b.d end)
  return days
end

local function orderView(state)
  local rows = {}
  for _, order in pairs(state.orders) do rows[#rows + 1] = copy(order) end
  table.sort(rows, function(a, b)
    if a.item ~= b.item then return a.item < b.item end
    if a.side ~= b.side then return a.side < b.side end
    if a.price ~= b.price then
      if a.side == "buy" then return a.price > b.price end
      return a.price < b.price
    end
    return a.seq < b.seq
  end)
  return rows
end
--- The seam back to a host that also publishes its own views.
---
--- `economy.lua` draws the game's market panel, and that panel mixes book
--- state (the ladder, the band, the candles) with desk state (stock, reserve,
--- pause reasons) which the book knows nothing about. Rather than move a view
--- that is half somebody else's, the book exports the halves it owns.
M.DAY = DAY
M.BPS = BPS
M.EMPTY_DIGEST = EMPTY_DIGEST
M.appendBounded = appendBounded
M.bandView = bandView
M.bookIndex = bookIndex
M.candleView = candleView
M.dropOrder = dropOrder
M.fillDigest = fillDigest
M.fillRecorded = fillRecorded
M.ladder = ladder
M.marketDay = marketDay
M.marketId = marketId
M.mode = mode
M.newMarket = newMarket
M.orderView = orderView
M.p2pLadder = p2pLadder
M.priceBand = priceBand
M.rebuildIndex = function(state) return rebuildIndex(state) end

--- Rebuild the index when it is missing or built to an older shape.
---
--- The version is the book's business, not its host's: a host that had to know
--- the number would have to be redeployed to bump it, which is exactly the
--- coupling the extraction removed.
M.ensureIndex = function(state)
  if type(state.bookIndex) ~= "table"
     or int(state.bookIndex.version, 0) ~= BOOK_INDEX_VERSION then
    rebuildIndex(state)
  end
  return state
end
M.recordCandle = recordCandle
M.noteRejection = recordRejected
M.rememberAction = rememberAction
M.replayedAction = replayedAction
M.touchBook = touchBook

return M
