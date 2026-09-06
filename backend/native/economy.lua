--- economy.lua -- Rune Realm's internal Gold economy.
---
--- This file is compiled directly into the game process. It is a source module,
--- not a process: players, inventory, Gold, orders, escrow, NPC reserves and
--- policy still cross exactly one authority boundary in game.lua.
---
--- Keep this module Luerl-safe. In particular: no goto, no table.move, narrow
--- every external number to an integer, and never use json's float round-trip
--- as proof that a stored amount is integral.

local M = {}

--- The order book, which is its own module now.
---
--- `orderbook.lua` is bundled immediately before this file and carries the
--- market registry, the index, the matching engine, escrow, fees and the
--- public order verbs -- everything that has to run identically in the game
--- and in the two venue processes. What stayed here is what only the GAME
--- has: issuance, the NPC desk, monetary policy and the published view that
--- mixes the two. See ORDERBOOK.md §6.
---
--- These aliases exist so the code below reads as it always did. They are not
--- a compatibility layer; they are the parts of the book this file legitimately
--- still uses -- a shop trade records a fill and a candle exactly the way the
--- book does, and the market panel draws the book's own ladder.
local OB = OrderBook
local marketId, newMarket, mode = OB.marketId, OB.newMarket, OB.mode
local bookIndex, rebuildIndex = OB.bookIndex, OB.rebuildIndex
local dropOrder, touchBook = OB.dropOrder, OB.touchBook
local fillRecorded, fillDigest, EMPTY_DIGEST = OB.fillRecorded, OB.fillDigest, OB.EMPTY_DIGEST
local marketDay, recordCandle = OB.marketDay, OB.recordCandle
local p2pLadder, ladder, candleView, orderView =
  OB.p2pLadder, OB.ladder, OB.candleView, OB.orderView
local bandView = OB.bandView
local appendBounded = OB.appendBounded
local recordRejected = OB.noteRejection
local replayedAction, rememberAction = OB.replayedAction, OB.rememberAction

local pushHistory
local DAY = 24 * 3600 * 1000
local BPS = 10000

--- How many days back a distinct-day qualification count reaches.
---
--- Named because it is now TWO rules that must agree: `qualifyingDays` and
--- `candidateQualified` read this far back, and `recordPlayerDeltas` deletes
--- day keys that have fallen out of it. A retention window that outlives its
--- reader is dead weight; one that is shorter than its reader silently changes
--- who qualifies. Move them together or not at all.
local QUALIFYING_DAY_WINDOW = 30
local ITEM_IDS = {
  "air_berry", "water_berry", "fire_berry", "rock_berry",
  "scroll", "legendary_scroll", "rune",
}
local BERRY = {
  air_berry = true, water_berry = true, fire_berry = true, rock_berry = true,
}
--- Who the NPC desk is, in a fill. Deliberately not 43 characters: no wallet
--- can ever be spelled this, so nothing that filters a book by account can
--- confuse the house with a player.
local HOUSE = "desk"

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

local function countMap(value)
  local total = 0
  for _ in pairs(value or {}) do total = total + 1 end
  return total
end

--- Unused since the book grew an index: kept because it is the obvious helper
--- to reach for and re-deriving it is worse than leaving four lines here.
local function sortedKeys(value) -- luacheck: ignore
  local keys = {}
  for key in pairs(value or {}) do keys[#keys + 1] = key end
  table.sort(keys)
  return keys
end

local function assetRow()
  return {
    issued = 0, consumed = 0, player = 0, escrow = 0, shop = 0,
    daily = {}, sources = {}, sinks = {},
  }
end

local function boxRows()
  local rows = {}
  for rarity = 1, C.MAX_LOOT_RARITY do rows[rarity] = assetRow() end
  return rows
end

--- `stockFloor` and `seedStock` are the two fields that make a desk work on a
--- young process.
---
--- `deskCap` is a share of OUTSTANDING SUPPLY, which is the right shape for an
--- inventory and a disaster at launch: with a handful of players the cap is a
--- dozen units, so the ladder walks its whole band range inside one trade
--- (five berries sold for 23 Gold, not 25, because the third unit crossed a
--- band edge) and the desk pauses at its stock cap almost immediately. The
--- floor says: below this size the desk still behaves like a desk.
---
--- `seedStock` is the opening inventory. Without it `stock` is zero, the BUY
--- side is paused on "Desk is out of stock", and selling is the only thing a
--- player can do on a fresh contract -- a shop with empty shelves, which is
--- both bad economics and bad furniture. Seeded at ~a third of the floor the
--- desk opens two-sided in its second band, bid 4 / ask 9 on a berry, with
--- room to move either way.
local function newDesk(item, goldReserve, prices, limits, stockBps, stockMax, stockFloor, seedStock)
  return {
    item = item,
    goldReserve = goldReserve,
    stockFloor = stockFloor or 0,
    --- The opening inventory this desk WANTS, not inventory it has. `stock`
    --- stays zero here deliberately: putting items on a shelf is an issuance,
    --- and a desk that quietly started with stock the asset ledger never
    --- issued would break `issued - consumed = player + escrow + shop` before
    --- the first message. `seedDeskStock` moves both halves, once.
    seedStock = seedStock or 0,
    stock = 0,
    reliableSupply = item ~= "scroll",
    launchAnchorBps = BPS,
    anchorBps = BPS,
    bidBps = BPS,
    askBps = BPS,
    stockBps = stockBps,
    stockMax = stockMax,
    prices = prices,
    limits = limits,
    enabled = { buy = true, sell = true },
    manualPause = { buy = nil, sell = nil },
    accountUsage = {},
    globalUsage = { window = -1, buy = 0, sell = 0 },
    epochUsage = { epoch = -1, quantity = 0 },
    traded = { bought = 0, sold = 0, goldIn = 0, goldOut = 0 },
  }
end


local function newMarkets()
  local markets = {}
  for _, item in ipairs(ITEM_IDS) do
    local market = newMarket(item, "gold")
    markets[market.id] = market
  end
  return markets
end

--- Find a market by id, or by base asset for a caller that only knows the

local function newDesks()
  local berryPrices = {
    { uptoBps = 2000, bid = 5, ask = 12 },
    { uptoBps = 5000, bid = 4, ask = 9 },
    { uptoBps = 7500, bid = 3, ask = 7 },
    { uptoBps = 10000, bid = 1, ask = 5 },
  }
  --- Repriced because the Scroll now DOES something.
  ---
  --- 250/600 was set for an item with no use whatsoever -- nothing in the game
  --- consumed a Scroll -- so the number was pure guesswork and it made the
  --- Scroll desk the single largest reachable Gold source in the economy
  --- (18,250 of its 20,000 reserve) for an item nobody could spend.
  ---
  --- A Scroll is the hunt capture ticket now (`C.HUNT.capture.scrollCost`), so
  --- it has an anchor: it replaces the sixteen berries the entry offering shed,
  --- which are worth ~50 Gold at the desk bid. 40/90 puts a capture attempt at
  --- roughly what a hunt used to cost in berries, keeps the ~2x spread every
  --- other desk uses, and makes one Scroll about a day and a half of the
  --- gameplay Gold allowance.
  local scrollPrices = {
    { uptoBps = 2000, bid = 40, ask = 90 },
    { uptoBps = 5000, bid = 32, ask = 70 },
    { uptoBps = 7500, bid = 24, ask = 55 },
    { uptoBps = 10000, bid = 12, ask = 40 },
  }
  --- Rune priced in Gold. Repriced 2026-08-31 from 1000/2000; see below.
  ---
  --- The old top band said one Rune was 250 berries, and nothing in the design
  --- supported that number. Three independent checks all put it an order of
  --- magnitude lower:
  ---
  --- * THE DESK'S OWN RESERVE. It was given 200,000 Gold. At a bid of 1000 that
  ---   buys 200 Rune -- a tenth of ONE epoch's global emission (2,000). A
  ---   reserve that cannot absorb a tenth of a month is not a reserve, and
  ---   whoever sized it was not imagining 1000.
  --- * THE DESIGN'S OWN CONSTANTS. `gold.perQualifiedPlayer` is 1000, so a
  ---   qualified player is meant to hold ~1000 Gold; `runeRewards.accountNet30Cap`
  ---   is 20, so they earn ~20 Rune a month. If a month's earnings are roughly a
  ---   steady-state balance, 1000 Gold = 20 Rune, and one Rune is 50 Gold. At
  ---   1000 a player's ENTIRE intended Gold holding was worth a single Rune, and
  ---   their monthly Rune was worth twenty times all the Gold they should have
  ---   had -- so Gold stopped mattering and everything would have been priced in
  ---   Rune.
  --- * SCARCITY. The daily crate is ~22 berries (`C.LOOT_TIERS` tier 2, two
  ---   elements at 9-13 each) and it is the whole item faucet. Rune is capped
  ---   at 48 per account per 30 days. That abundance ratio prices a Rune near
  ---   14 berries, about 45 Gold -- the same order the other two derivations
  ---   land on, which is the point of doing three of them.
  ---
  ---   Re-derived when the loot ladder was rebuilt: the old figure read "16
  ---   berry-units per box (four berries at 800/1000 for 5 each)" off a table
  ---   that no longer exists, and it was measuring a per-BATTLE box in an
  ---   economy where boxes now come only from the calendar.
  ---
  --- 60/120 sits between the two derivations and keeps the ~2x spread the other
  --- desks use. It also makes the 200,000 reserve cover ~3,300 Rune, which is
  --- over an epoch of emission -- a reserve that can actually do its job.
  ---
  --- Anchored to real money at the intended $0.10 a Rune, this puts Gold at
  --- about $0.0017 and a berry at just under a cent.
  local runePrices = {
    { uptoBps = 1000, bid = 60, ask = 120 },
    { uptoBps = 3000, bid = 54, ask = 102 },
    { uptoBps = 6000, bid = 48, ask = 90 },
    { uptoBps = 10000, bid = 39, ask = 75 },
  }
  --- Back to the plan's numbers. ECONOMY_MARKETPLACE_PLAN.md §5.3 says 100 per
  --- action, 250 per account per 20 hours, 500 global per side -- these had
  --- drifted to exactly ten times that, and `epochFlowLimit` below still does
  --- its arithmetic against 500 ("25 on a berry desk"), so the constant and
  --- the comment explaining it disagreed by an order of magnitude.
  local berryLimits = { perAction = 100, perAccount = 250, global = 500 }
  --- Above the plan's 5/10/25, because the plan wrote those for a Scroll that
  --- was a collectible. It is a consumable now -- one per capture attempt --
  --- and a desk that will not sell a player ten of them in a day is a desk
  --- that stops them hunting.
  local scrollLimits = { perAction = 10, perAccount = 25, global = 100 }
  local runeLimits = { perAction = 5, perAccount = 10, global = 25 }
  --- Gold reserves rebalanced, and the Rune desk is where it came from.
  ---
  --- The Rune desk held 200,000 Gold and could pay out 11,700 of it: its stock
  --- cap is 250 Rune and the bid ladder tops out at 60, so 188,300 Gold sat
  --- behind a shelf it could never reach past. The Scroll desk was the same
  --- shape at 20,000 for an item nobody could spend. Meanwhile the berry
  --- desks -- where every actual trade happens -- had 5,000 each.
  ---
  --- Reserves are sized against what the desk can ACTUALLY pay now: a berry
  --- desk clears 1,280 Gold filling its whole cap, a Scroll desk ~8,000 at the
  --- new prices, the Rune desk 11,700. Everything freed goes to `gold.locked`,
  --- which is what funds the gameplay Gold allowance (`M.grantGoldReward`).
  --- Total issued Gold does not move: 300,000 before, 300,000 after.
  return {
    --- Seeded to just UNDER the first band edge, which is not an arbitrary
    --- number: a berry desk's top band runs to 20% of its cap, so 50 against a
    --- 300 floor is 16.7% and the desk opens on the exact quote
    --- ECONOMY_MARKETPLACE_PLAN.md §5.2 specifies -- buys at 5, sells at 12.
    --- Seeding deeper (100, tried first) opens it in the second band at 4/9
    --- instead, which is a launch REPRICING wearing the costume of a shelf
    --- restock. Stock and price are separate decisions and this only makes the
    --- stock one.
    air_berry = newDesk("air_berry", 8000, copy(berryPrices), copy(berryLimits), 500, 400, 300, 50),
    water_berry = newDesk("water_berry", 8000, copy(berryPrices), copy(berryLimits), 500, 400, 300, 50),
    fire_berry = newDesk("fire_berry", 8000, copy(berryPrices), copy(berryLimits), 500, 400, 300, 50),
    rock_berry = newDesk("rock_berry", 8000, copy(berryPrices), copy(berryLimits), 500, 400, 300, 50),
    scroll = newDesk("scroll", 8000, scrollPrices, scrollLimits, 1000, 300, 150, 25),
    --- No seed and no floor on Rune. Seeding a desk ISSUES the item, and Rune
    --- is the one asset whose supply is a promise: every Rune in existence was
    --- emitted by the schedule or crossed the bridge, and a shelf full of Rune
    --- nobody earned would break that in the one place it matters. The desk
    --- stays empty until a player sells into it, exactly as
    --- ECONOMY_MARKETPLACE_PLAN.md §7.5 requires.
    rune = newDesk("rune", 50000, runePrices, runeLimits, 600, 250),
  }
end

--- Put the opening inventory on the shelves, and account for it.
---
--- Seeding is an ISSUANCE -- the items did not exist a moment ago -- so
--- `issued` and `shop` move together or `issued - consumed = player + escrow +
--- shop` stops holding on the very first message. `M.invariants` and the test
--- suite both check that identity, so getting this wrong fails loudly.
---
--- The arithmetic is inline rather than through `recordAsset`, for two
--- reasons: `recordAsset` credits `player` (every other issuance in this file
--- goes to somebody), and it is defined several hundred lines below the state
--- constructor that has to call this.
---
--- Skipped for any desk that has already traded or already holds stock. On a
--- fresh ledger this is the launch allocation; on a live one it is a migration,
--- and a migration may not inject inventory into a market that is running --
--- an opening balance is only ever an opening balance once.
local function seedDeskStock(state)
  for _, desk in pairs(state.desks or {}) do
    local seed = math.max(0, int(desk.seedStock, 0))
    local traded = desk.traded or {}
    local untouched = int(desk.stock, 0) == 0
      and int(traded.bought, 0) == 0 and int(traded.sold, 0) == 0
    local row = state.assets[desk.item]
    if seed > 0 and untouched and type(row) == "table" then
      desk.stock = seed
      row.issued = int(row.issued, 0) + seed
      row.shop = int(row.shop, 0) + seed
      row.sources = type(row.sources) == "table" and row.sources or {}
      row.sources["Launch shop inventory"] =
        int(row.sources["Launch shop inventory"], 0) + seed
    end
  end
  return state
end

function M.newState()
  local assets = {}
  for _, item in ipairs(ITEM_IDS) do assets[item] = assetRow() end
  local cfg = C.ECONOMY
  -- Built, then stocked. A brand new ledger opens with its shelves full: the
  -- shop was previously born empty, which paused the BUY side of every desk on
  -- "Desk is out of stock" and left selling as the only thing a player could
  -- do on a fresh contract.
  return seedDeskStock({
    version = 1,
    normalisedVersion = 6,
    mode = "testing",
    assets = assets,
    lootboxes = boxRows(),
    gold = {
      issued = cfg.gold.launchSupply,
      burned = 0,
      authorized = cfg.gold.launchSupply,
      ceiling = cfg.gold.protocolCeiling,
      player = 0,
      escrow = 0,
      --- The desks hold what they can actually pay out; everything else is
      --- locked, and locked is what funds the gameplay Gold allowance. Was
      --- 240,000 / 60,000, when the Rune desk alone carried 200,000 it could
      --- never spend. These two must equal the sum of `newDesks()` reserves
      --- and the remainder of `launchSupply`; `goldInvariant` proves it.
      shop = 90000,
      locked = 210000,
      feesRouted = 0,
      daily = {},
    },
    orders = {},
    orderSeq = 0,
    fills = {},
    fillSeq = 0,
    orderHistory = {},
    rejected = {},
    actionReceipts = {},
    actionReceiptOrder = {},
    desks = newDesks(),
    markets = newMarkets(),
    --- Fees collected, per asset, for markets whose quote is not Gold.
    ---
    --- Gold fees keep going through `routeGoldFee`, which decides burn or
    --- treasury against the supply target -- a decision that only makes sense
    --- for an asset this process issues. Somebody else's token cannot be
    --- burned to hit our target, so it accrues here and who may withdraw it is
    --- a policy question rather than a constant.
    fees = {},
    policy = {
      emergency = { paused = false, reason = nil, at = 0 },
      gold = {
        targetFloor = cfg.gold.targetFloor,
        stabilizationReserve = cfg.gold.stabilizationReserve,
        perQualifiedPlayer = cfg.gold.perQualifiedPlayer,
        normalWeeklyReleaseBps = cfg.gold.normalWeeklyReleaseBps,
        contractWeeklyReleaseBps = cfg.gold.contractWeeklyReleaseBps,
        shopBurnBps = cfg.gold.shopBurnBps,
        burnBelowTargetBps = 9000,
        burnAboveTargetBps = cfg.gold.burnAboveTargetBps,
        expansionEnabled = false,
        qualifiedActive = 0,
        candidateQualifiedActive = 0,
        lastObservationAt = 0,
        persistentHigherObservations = 0,
        releasedInWindow = 0,
        releaseWindow = -1,
      },
      qualification = {
        enabled = false,
        requiredDistinctDays = 3,
        requiredSinkActions = 1,
        reason = "Exact qualified-active definition is an open launch decision",
      },
      runeRewards = {
        -- Emission is decided by `C.ECONOMY.rune` and the clock. `enabled` is
        -- an operator brake, not the default state, and `epochBudget` and
        -- `newcomerFloor` are DERIVED -- recomputed on every claim by
        -- `M.emissionBudget`. They are stored only so the published view can
        -- show what the schedule currently says.
        enabled = true,
        haltedByOperator = false,
        genesisAt = 0,
        epochBudget = 0,
        epochLength = (C.ECONOMY.rune or {}).epochLength or (30 * DAY),
        --- v2: what one account is paid per epoch, flat. See the note on
        --- `emissionPerAccount` in constants.lua -- this is an engagement
        --- assumption (48/240 = the 20% of passholders expected to play
        --- properly), not a free parameter.
        emissionPerAccount = (C.ECONOMY.rune or {}).emissionPerAccount or 48,
        --- Matches `emissionPerAccount`: an account that spends nothing is paid
        --- once and then capped, and spending buys headroom back. Raising one
        --- without the other silently re-tunes the faucet.
        accountNet30Cap = (C.ECONOMY.rune or {}).emissionPerAccount or 48,
        newcomerFloor = 0,
        reserveBalance = 0,
        bondedRune = 0,
        bondEnabled = false,
        bondAmount = 5,
        unbondDelay = 30 * DAY,
        reason = "Emission follows the published schedule in C.ECONOMY.rune",
      },
      passes = {
        genesisSealed = false,
        genesisPassCount = 0,
        lifetimePassCount = 0,
        legacyCount = 0,
        promisedCount = 0,
        promisedManifestHash = nil,
        unassignedPromiseSlots = 0,
        promiseClaimDeadline = 0,
        promiseClaims = {},
        purchaseEnabled = false,
        paymentAsset = nil,
        launchPriceReference = 2500,
        previousPriceReference = 2500,
        monthlySubsidyReference = 200,
        foregoneRuneAcquisitionReference = 0,
      },
      proceeds = copy(cfg.proceeds),
      runeAcquisition = { budgetQuote = 0, quoteSpent = 0, runeReceived = 0, executions = {} },
      externalRuneSupply = nil,
      externalRuneObservedAt = 0,
      pending = {},
      changeSeq = 0,
      history = {},
    },
    marketDaily = {},
    activity = {},
  })
end

local function normaliseAsset(row)
  row = type(row) == "table" and row or assetRow()
  for _, field in ipairs({ "issued", "consumed", "player", "escrow", "shop" }) do
    row[field] = math.max(0, int(row[field], 0))
  end
  row.daily = type(row.daily) == "table" and row.daily or {}
  row.sources = type(row.sources) == "table" and row.sources or {}
  row.sinks = type(row.sinks) == "table" and row.sinks or {}
  return row
end

--- The highest numeric suffix behind a one-letter id prefix, over a list.
---
--- Used to restart a sequence after a migration without ever reissuing an id
--- that something already refers to.
local function highestId(list, prefix)
  local highest = 0
  for _, row in ipairs(list or {}) do
    local digits = type(row) == "table" and type(row.id) == "string"
      and string.match(row.id, "^" .. prefix .. "(%d+)$") or nil
    local value = int(digits, 0)
    if value > highest then highest = value end
  end
  return highest
end

function M.ensureState(state)
  if type(state) ~= "table" or int(state.version, 0) < 1 then state = M.newState() end
  if int(state.normalisedVersion, 0) < 1 then state = M.normaliseV1(state) end
  if int(state.normalisedVersion, 0) < 2 then
    -- Fill ids used to be `"F" .. #state.fills + 1`, and `#state.fills` is
    -- pinned at the history cap by `appendBounded` -- so every fill after the
    -- five-hundredth was called `F501`. A monotonic sequence fixes it going
    -- forward; seeding past the highest id still visible stops the repair
    -- itself from minting a third `F501`.
    state.fillSeq = math.max(int(state.fillSeq, 0), highestId(state.fills, "F"))
    state.normalisedVersion = 2
  end
  if int(state.normalisedVersion, 0) < 3 then
    -- The registry. A process that has been trading since before it existed
    -- gets the default rows, which describe exactly what it was already doing.
    state.markets = type(state.markets) == "table" and state.markets or {}
    for id, market in pairs(newMarkets()) do
      if type(state.markets[id]) ~= "table" then
        state.markets[id] = market
      else
        for field, value in pairs(market) do
          if state.markets[id][field] == nil then state.markets[id][field] = value end
        end
      end
    end
    state.normalisedVersion = 3
  end
  if int(state.normalisedVersion, 0) < 4 then
    state.fees = type(state.fees) == "table" and state.fees or {}
    state.normalisedVersion = 4
  end
  if int(state.normalisedVersion, 0) < 5 then
    -- The price band, the house quote flag and the trader-chosen lifetime.
    -- A process that has been trading without any of them gets the defaults,
    -- and every order already resting keeps the lifetime it was given.
    for id, defaults in pairs(newMarkets()) do
      local market = state.markets[id]
      if type(market) == "table" then
        for _, field in ipairs({ "bandBps", "houseQuotes" }) do
          if market[field] == nil then market[field] = defaults[field] end
        end
      end
    end
    state.normalisedVersion = 5
  end
  if int(state.normalisedVersion, 0) < 6 then
    -- The desk rework: a stock floor so a young desk is usable, an opening
    -- inventory so the buy side is not dead, and reserves rebalanced off the
    -- Rune desk (which held 200,000 Gold against an 11,700 maximum payout).
    --
    -- Prices, limits and reserves are OVERWRITTEN here rather than filled in
    -- when absent, because every one of them exists already and is wrong --
    -- that is the migration. A desk an operator has deliberately retuned is
    -- not a case this build has: `Admin.Economy.Apply` cannot reach any of
    -- these fields (see POLICY_PATHS), so the stored value is always the old
    -- default.
    local defaults = newDesks()
    for item, desk in pairs(defaults) do
      local current = state.desks[item]
      if type(current) == "table" then
        current.stockFloor = desk.stockFloor
        current.seedStock = desk.seedStock
        current.stockMax = desk.stockMax
        current.limits = copy(desk.limits)
        if item == "scroll" then current.prices = copy(desk.prices) end
        -- Gold moves between buckets and is never minted: whatever the desk
        -- gives up or gains comes out of, or goes back into, `locked`.
        local target = int(desk.goldReserve, 0)
        local delta = target - int(current.goldReserve, 0)
        if delta <= int(state.gold.locked, 0) then
          current.goldReserve = target
          state.gold.locked = int(state.gold.locked, 0) - delta
          state.gold.shop = int(state.gold.shop, 0) + delta
        end
      end
    end
    seedDeskStock(state)
    state.normalisedVersion = 6
  end
  -- The book index is DERIVED, so it is not a migration and does not get a
  -- `normalisedVersion`: it is absent from every export and every published
  -- view on purpose, and a process restored from either simply builds it here.
  -- The same check catches a version bump to the index's own shape without a
  -- migration having to know anything about it.
  OB.ensureIndex(state)
  return state
end

function M.normaliseV1(state)
  local fresh = M.newState()
  state.assets = type(state.assets) == "table" and state.assets or {}
  for _, item in ipairs(ITEM_IDS) do state.assets[item] = normaliseAsset(state.assets[item]) end
  state.lootboxes = type(state.lootboxes) == "table" and state.lootboxes or {}
  for rarity = 1, C.MAX_LOOT_RARITY do
    state.lootboxes[rarity] = normaliseAsset(state.lootboxes[rarity])
  end
  state.gold = type(state.gold) == "table" and state.gold or M.newState().gold
  for _, field in ipairs({ "issued", "burned", "authorized", "ceiling", "player",
                           "escrow", "shop", "locked", "feesRouted" }) do
    state.gold[field] = math.max(0, int(state.gold[field], 0))
  end
  state.gold.daily = type(state.gold.daily) == "table" and state.gold.daily or {}
  state.orders = type(state.orders) == "table" and state.orders or {}
  state.fills = type(state.fills) == "table" and state.fills or {}
  state.orderHistory = type(state.orderHistory) == "table" and state.orderHistory or {}
  state.rejected = type(state.rejected) == "table" and state.rejected or {}
  state.actionReceipts = type(state.actionReceipts) == "table" and state.actionReceipts or {}
  state.actionReceiptOrder = type(state.actionReceiptOrder) == "table" and state.actionReceiptOrder or {}
  state.desks = type(state.desks) == "table" and state.desks or newDesks()
  local defaults = newDesks()
  for item, desk in pairs(defaults) do
    if type(state.desks[item]) ~= "table" then
      state.desks[item] = desk
    else
      local current = state.desks[item]
      for field, value in pairs(desk) do
        if current[field] == nil then current[field] = copy(value) end
      end
      current.enabled = type(current.enabled) == "table" and current.enabled or copy(desk.enabled)
      current.manualPause = type(current.manualPause) == "table" and current.manualPause or {}
      current.limits = type(current.limits) == "table" and current.limits or copy(desk.limits)
    end
  end
  state.policy = type(state.policy) == "table" and state.policy or fresh.policy
  for group, value in pairs(fresh.policy) do
    if state.policy[group] == nil then
      state.policy[group] = copy(value)
    elseif type(value) == "table" and type(state.policy[group]) == "table" then
      for field, default in pairs(value) do
        if state.policy[group][field] == nil then state.policy[group][field] = copy(default) end
      end
    end
  end
  state.policy.pending = type(state.policy.pending) == "table" and state.policy.pending or {}
  state.policy.history = type(state.policy.history) == "table" and state.policy.history or {}
  state.marketDaily = type(state.marketDaily) == "table" and state.marketDaily or {}
  state.activity = type(state.activity) == "table" and state.activity or {}
  state.version = 1
  state.normalisedVersion = 1
  -- `state.orders` may have just been replaced wholesale; anything the index
  -- remembered about it is now a claim about a book that no longer exists.
  state.bookIndex = nil
  return state
end

local function validAddress(value)
  return type(value) == "string" and #value == 43
    and string.match(value, "^[%w_%-]+$") ~= nil
end

--- Give an unlocked account its Eternal Pass, and count it once.
---
--- `counted` says the grant has ALREADY been tallied and this call is only
--- building the account's copy of it. That is the game process's allow-list:
--- `Admin.Unlock` admits a wallet as a string and tallies the pass there, and
--- the record is minted later, on the wallet's first real action. Without this
--- the same pass would be counted twice -- once when it was granted and again
--- whenever its owner got round to playing -- and `passQuote` prices the next
--- pass off that number.
function M.ensurePass(state, player, address, timestamp, origin, counted)
  state = M.ensureState(state)
  if not player then return nil end
  if type(player.pass) ~= "table" and player.unlocked then
    player.pass = {
      accountId = address,
      controller = address,
      origin = origin or (C.PUBLIC_ACCESS and "test" or "legacy"),
      grantedAt = int(player.joinedAt, timestamp),
      recoveryController = nil,
      recoveredAt = 0,
      recoveryCooldownUntil = 0,
      bond = 0,
      unbond = nil,
    }
    if not counted then
      local passes = state.policy.passes
      passes.lifetimePassCount = int(passes.lifetimePassCount, 0) + 1
      if player.pass.origin == "legacy" then passes.legacyCount = int(passes.legacyCount, 0) + 1 end
      if player.pass.origin == "promised" then passes.promisedCount = int(passes.promisedCount, 0) + 1 end
    end
  elseif type(player.pass) == "table" then
    player.pass.accountId = player.pass.accountId or address
    player.pass.controller = player.pass.controller or address
    player.pass.origin = player.pass.origin or origin or "legacy"
    player.pass.grantedAt = int(player.pass.grantedAt, int(player.joinedAt, timestamp))
    player.pass.recoveredAt = int(player.pass.recoveredAt, 0)
    player.pass.recoveryCooldownUntil = int(player.pass.recoveryCooldownUntil, 0)
    player.pass.bond = math.max(0, int(player.pass.bond, 0))
  end
  return player.pass
end

local function integerSqrt(value)
  value = math.max(0, int(value, 0))
  local low, high, answer = 0, math.min(value, 3037000499), 0
  while low <= high do
    local middle = (low + high) // 2
    if middle == 0 or middle <= value // middle then
      answer = middle; low = middle + 1
    else
      high = middle - 1
    end
  end
  return answer
end

function M.passQuote(state)
  state = M.ensureState(state)
  local passes = state.policy.passes
  local genesis = math.max(1, int(passes.genesisPassCount, 0))
  local lifetime = math.max(genesis, int(passes.lifetimePassCount, 0))
  local scaledRoot = integerSqrt((lifetime * 1000000) // genesis)
  local growth = (int(passes.launchPriceReference, 2500) * scaledRoot + 999) // 1000
  local security = 12 * int(passes.monthlySubsidyReference, 200)
  return {
    referenceUnit = "USD cents until an on-chain payment asset is selected",
    launch = int(passes.launchPriceReference, 2500), growth = growth,
    security = security,
    next = math.max(int(passes.previousPriceReference, 2500), growth, security),
    genesisPassCount = int(passes.genesisPassCount, 0),
    lifetimePassCount = int(passes.lifetimePassCount, 0),
    purchaseEnabled = passes.purchaseEnabled == true,
    paymentAsset = passes.paymentAsset,
  }
end

function M.configureGenesis(state, players, actor, config, timestamp)
  state = M.ensureState(state)
  local passes = state.policy.passes
  if passes.genesisSealed then return nil, "The genesis pass manifest is permanently sealed" end
  if type(config) ~= "table" then return nil, "Genesis configuration must be an object" end
  local promised = config.addresses or {}
  if type(promised) ~= "table" then return nil, "Promised addresses must be an array" end
  local unique = {}
  for _, address in ipairs(promised) do
    if not validAddress(address) then return nil, "Every promised pass needs a 43-character address" end
    unique[address] = true
  end
  local hash = config.commitmentHash
  if type(hash) ~= "string" or #hash < 32 or #hash > 128 then
    return nil, "A published promised-pass commitment hash is required"
  end
  local unassigned = clamp(config.unassignedSlots, 0, 100000)
  local deadline = int(config.claimDeadline, 0)
  if unassigned > 0 and deadline <= timestamp then
    return nil, "Unassigned promise slots require a future claim deadline"
  end
  local promisedCount = 0
  for address in pairs(unique) do
    local player = players[address]
    if not player then return nil, "Promised pass account must be materialised before sealing" end
    if not player.pass then M.ensurePass(state, player, address, timestamp, "promised") end
    if player.pass.origin ~= "legacy" then player.pass.origin = "promised" end
    promisedCount = promisedCount + 1
  end
  local legacy = 0
  for address, player in pairs(players) do
    local pass = M.ensurePass(state, player, address, timestamp)
    if pass and pass.origin == "legacy" then legacy = legacy + 1 end
  end
  passes.legacyCount = legacy
  passes.promisedCount = promisedCount
  passes.promisedManifestHash = hash
  passes.unassignedPromiseSlots = unassigned
  passes.promiseClaimDeadline = deadline
  passes.genesisPassCount = legacy + promisedCount + unassigned
  passes.lifetimePassCount = math.max(int(passes.lifetimePassCount, 0), legacy + promisedCount)
  passes.foregoneRuneAcquisitionReference = promisedCount * 750
  passes.genesisSealed = true
  pushHistory(state, { action = "genesis-pass-sealed", actor = actor,
    timestamp = timestamp, legacy = legacy, promised = promisedCount,
    unassigned = unassigned, commitmentHash = hash })
  return {
    sealed = true, legacy = legacy, promised = promisedCount,
    unassigned = unassigned, genesisPassCount = passes.genesisPassCount,
    commitmentHash = hash,
  }, nil
end

function M.rotateAccount(state, players, oldAddress, newAddress, timestamp)
  state = M.ensureState(state)
  local player = players[oldAddress]
  if not player then return nil, "No such economic account" end
  if players[newAddress] then return nil, "The new controller already has an account" end
  players[oldAddress] = nil
  players[newAddress] = player
  player.address = newAddress
  local pass = M.ensurePass(state, player, newAddress, timestamp)
  pass.controller = newAddress
  pass.recoveredAt = timestamp
  pass.recoveryCooldownUntil = timestamp + 7 * DAY
  for _, order in pairs(state.orders) do
    if order.account == oldAddress then order.account = newAddress end
  end
  for _, fill in ipairs(state.fills or {}) do
    for _, field in ipairs({ "buyer", "seller", "maker", "taker" }) do
      if fill[field] == oldAddress then fill[field] = newAddress end
    end
  end
  for _, order in ipairs(state.orderHistory or {}) do
    if order.account == oldAddress then order.account = newAddress end
  end
  for _, day in pairs(state.marketDaily or {}) do
    for _, asset in pairs(day) do
      for _, field in ipairs({ "makers", "takers" }) do
        if asset[field] and asset[field][oldAddress] then
          asset[field][newAddress] = true
          asset[field][oldAddress] = nil
        end
      end
    end
  end
  if state.activity[oldAddress] then
    state.activity[newAddress] = state.activity[oldAddress]
    state.activity[oldAddress] = nil
  end
  for _, desk in pairs(state.desks) do
    if desk.accountUsage[oldAddress] then
      desk.accountUsage[newAddress] = desk.accountUsage[oldAddress]
      desk.accountUsage[oldAddress] = nil
    end
  end
  -- Every counter and ring in the book index is keyed by address, and this
  -- has just walked the whole book and the whole fills list to move one.
  -- Rebuilding from what they now say is cheaper to reason about than
  -- rewriting six structures in place, and impossible to get subtly wrong.
  rebuildIndex(state)
  return player, nil
end

local function qualifyingDays(state, address, timestamp)
  local currentDay = timestamp // DAY
  local total = 0
  for day in pairs((state.activity[address] or {}).days or {}) do
    local age = currentDay - int(day, currentDay)
    if age >= 0 and age < QUALIFYING_DAY_WINDOW then total = total + 1 end
  end
  return total
end

local function maturityBps(state, player, timestamp)
  local pass = player and player.pass
  if not pass then return 1000 end
  local age = math.max(0, timestamp - int(pass.grantedAt, timestamp)) // DAY
  local days = qualifyingDays(state, player.address, timestamp)
  if age < 7 or days < 2 then return 1000 end
  if age < 30 or days < 3 then return 5000 end
  local rewards = state.policy.runeRewards
  if rewards.bondEnabled and (pass.unbond ~= nil
     or int(pass.bond, 0) < int(rewards.bondAmount, 0)) then return 5000 end
  return BPS
end

local function dailyRow(map, timestamp)
  local day = int(timestamp, 0) // DAY
  local row = map[day]
  if not row then
    row = { issued = 0, consumed = 0 }
    map[day] = row
  end
  -- Rolling reporting only needs thirty days. Keep five days of slack for a
  -- delayed message/replay and discard older aggregate buckets.
  for key in pairs(map) do
    if int(key, day) < day - 35 then map[key] = nil end
  end
  return row
end

local function recordAsset(row, delta, kind, timestamp, reason)
  delta = int(delta, 0)
  if delta == 0 then return end
  row.player = math.max(0, int(row.player, 0) + delta)
  local today = dailyRow(row.daily, timestamp)
  if kind == "issue" and delta > 0 then
    row.issued = int(row.issued, 0) + delta
    row.sources[reason] = int(row.sources[reason], 0) + delta
    today.issued = int(today.issued, 0) + delta
  elseif kind == "consume" and delta < 0 then
    local amount = -delta
    row.consumed = int(row.consumed, 0) + amount
    row.sinks[reason] = int(row.sinks[reason], 0) + amount
    today.consumed = int(today.consumed, 0) + amount
  end
end

local TRANSFER_ACTIONS = {
  ["Market.Buy"] = true,
  ["Monster.Transfer"] = true,
  ["Rune.Withdraw"] = true,
  ["Rune.Minted"] = true,
  ["Burn-Notice"] = true,
  ["Admin.SettleWithdrawal"] = true,
  ["Pass.Bond"] = true,
  ["Pass.CompleteUnbond"] = true,
}

function M.capturePlayers(players, addresses)
  local before = {}
  for address in pairs(addresses or {}) do
    local p = players[address]
    local row = { inventory = {}, lootboxes = {}, gold = 0 }
    if p then
      for _, item in ipairs(ITEM_IDS) do row.inventory[item] = int((p.inventory or {})[item], 0) end
      for rarity = 1, C.MAX_LOOT_RARITY do row.lootboxes[rarity] = 0 end
      for _, rarity in ipairs(p.lootboxes or {}) do
        rarity = clamp(rarity, 1, C.MAX_LOOT_RARITY)
        row.lootboxes[rarity] = row.lootboxes[rarity] + 1
      end
      row.gold = math.max(0, int(p.gold, 0))
    end
    before[address] = row
  end
  return before
end

local function afterPlayer(p)
  local row = { inventory = {}, lootboxes = {}, gold = 0 }
  if p then
    for _, item in ipairs(ITEM_IDS) do row.inventory[item] = int((p.inventory or {})[item], 0) end
    for rarity = 1, C.MAX_LOOT_RARITY do row.lootboxes[rarity] = 0 end
    for _, rarity in ipairs(p.lootboxes or {}) do
      rarity = clamp(rarity, 1, C.MAX_LOOT_RARITY)
      row.lootboxes[rarity] = row.lootboxes[rarity] + 1
    end
    row.gold = math.max(0, int(p.gold, 0))
  end
  return row
end

local function actionKind(action, delta)
  if action == "Pass.Recover" then return "managed" end
  if TRANSFER_ACTIONS[action] then return "transfer" end
  if string.sub(action or "", 1, 8) == "Economy." then return "managed" end
  if delta > 0 then return "issue" end
  if delta < 0 then return "consume" end
  return "transfer"
end

--- Account for every inventory and box change made by the existing game verbs.
--- Economy.* handlers use the explicit bucket-moving functions below and are
--- excluded, so an order fill is not mistaken for issuance or counted twice.
function M.recordPlayerDeltas(state, before, players, action, timestamp)
  state = M.ensureState(state)
  local totals = {}
  local boxTotals = {}
  for _, item in ipairs(ITEM_IDS) do totals[item] = 0 end
  for rarity = 1, C.MAX_LOOT_RARITY do boxTotals[rarity] = 0 end
  local goldDelta = 0
  for address, old in pairs(before or {}) do
    local current = afterPlayer(players[address])
    local runeDelta = int(current.inventory.rune, 0) - int(old.inventory.rune, 0)
    for _, item in ipairs(ITEM_IDS) do
      totals[item] = totals[item] + int(current.inventory[item], 0) - int(old.inventory[item], 0)
    end
    for rarity = 1, C.MAX_LOOT_RARITY do
      boxTotals[rarity] = boxTotals[rarity]
        + int(current.lootboxes[rarity], 0) - int(old.lootboxes[rarity], 0)
    end
    goldDelta = goldDelta + current.gold - int(old.gold, 0)

    -- Candidate economic qualification is deliberately observable while the
    -- launch definition is disabled. Only real non-market game actions count;
    -- transfers, listings, cancellations, claims and admin work never mature an
    -- identity merely by being repeated.
    local qualifying = {
      ["Monster.Feed"] = true, ["Monster.Play"] = true,
      ["Monster.Quest"] = true, ["Monster.Claim"] = true,
      ["Monster.LevelUp"] = true, ["Battle.Begin"] = true,
      ["Battle.Start"] = true, ["Battle.Attack"] = true,
      ["Hunt.Begin"] = true, ["Hunt.Settle"] = true,
    }
    if (qualifying[action] or runeDelta ~= 0) and players[address] then
      local activity = state.activity[address]
      if not activity then
        activity = { days = {}, sinkActions = 0, runeFlow = {} }
        state.activity[address] = activity
      end
      if qualifying[action] then
        local day = timestamp // DAY
        if not activity.days[day] then
          -- A day this account has not been seen on before, which is the only
          -- moment an older one can have aged out.
          --
          -- `candidateQualified` counts distinct days inside a THIRTY-day
          -- window and ignores everything before it, so a day older than that
          -- has already stopped being read -- it was simply never deleted. One
          -- boolean key per address per day, forever, across every account that
          -- ever played, is a map that only grows and that every message pays
          -- to marshal. The window is the retention.
          for held in pairs(activity.days) do
            if (day - int(held, day)) >= QUALIFYING_DAY_WINDOW then
              activity.days[held] = nil
            end
          end
        end
        activity.days[day] = true
        if runeDelta < 0 then activity.sinkActions = int(activity.sinkActions, 0) + 1 end
      end
      if runeDelta ~= 0 then
        activity.runeFlow[#activity.runeFlow + 1] = {
          timestamp = timestamp, delta = runeDelta, action = action,
        }
      end
      while #activity.runeFlow > 200 do table.remove(activity.runeFlow, 1) end
    end
  end
  for _, item in ipairs(ITEM_IDS) do
    local delta = totals[item]
    local kind = actionKind(action, delta)
    if kind ~= "managed" then recordAsset(state.assets[item], delta, kind, timestamp, action) end
  end
  for rarity = 1, C.MAX_LOOT_RARITY do
    local delta = boxTotals[rarity]
    local kind = actionKind(action, delta)
    if kind ~= "managed" then
      recordAsset(state.lootboxes[rarity], delta, kind, timestamp, action)
    end
  end
  -- No existing non-economy verb may create Gold. A legacy/admin load can carry
  -- a balance, but it is funded from the locked launch allocation, never minted.
  if goldDelta ~= 0 and string.sub(action or "", 1, 6) == "Admin." then
    state.gold.player = math.max(0, int(state.gold.player, 0) + goldDelta)
    state.gold.locked = math.max(0, int(state.gold.locked, 0) - goldDelta)
  end
  return state
end

local function candidateQualified(state, timestamp)
  local policy = state.policy.qualification
  local currentDay = timestamp // DAY
  local total = 0
  for _, activity in pairs(state.activity or {}) do
    local days = 0
    for day in pairs(activity.days or {}) do
      if currentDay - int(day, currentDay) >= 0
         and currentDay - int(day, currentDay) < QUALIFYING_DAY_WINDOW then
        days = days + 1
      end
    end
    if days >= int(policy.requiredDistinctDays, 3)
       and int(activity.sinkActions, 0) >= int(policy.requiredSinkActions, 1) then
      total = total + 1
    end
  end
  state.policy.gold.candidateQualifiedActive = total
  if policy.enabled then state.policy.gold.qualifiedActive = total end
  return total
end

--- The global daily emission, decided by the schedule and nothing else.
---
--- This used to be `policy.epochBudget`: a flat number, defaulting to 0, that a
--- human had to propose and apply before the faucet paid anybody anything. It
--- was not a warm-up and it was not an economic result -- it was an unmade
--- decision sitting in the config, and every worship in every deployment paid
--- exactly zero because of it.
---
--- The engine owns it now. `C.ECONOMY.rune` carries a genesis rate and a
--- halving period, this reads the clock, and nothing about emission requires a
--- policy message ever again.
---
--- The pot is FIXED per day and deliberately does not scale with the player
--- count -- see the note in `constants.lua` and ECONOMY.md §3.1. Deriving it
--- per-player the way Gold derives its target would reintroduce precisely the
--- sybil flaw the whole design exists to close.
---
--- `genesisAt` is stamped on first use rather than at spawn so that a migrated
--- process starts its schedule when it starts paying, not at some epoch it
--- inherited from a predecessor's export.
--- The fractional-Rune roll for one account on one day, in basis points.
---
--- >>> PLACEHOLDER ENTROPY. INTENDED TO BE REPLACED. <<<
---
--- This is FNV-1a over `address#day`. It is deterministic, uniform enough for
--- a coin flip, and NOT cryptographically secure -- anybody can compute it.
--- Swap the body for real entropy when it is available; the signature and the
--- call site do not change.
---
--- What it already gets right, and what a replacement must keep:
---
---   * Keyed to (address, DAY), never to the claiming message. Day N's outcome
---     is fixed the moment day N happens, so it pays the same whether it is
---     collected that evening or three weeks later. This is what stops the two
---     attacks that matter, and it does so WITHOUT needing to be secret:
---       - waiting: there is no better day to claim on, because the days you
---         are claiming for have already happened;
---       - grinding: the player signs the claim, so anything derived from the
---         signed message could be re-signed until it came up good. Nothing
---         here reads the message.
---
--- So predictability is a cosmetic weakness here rather than an economic one:
--- a player can see tomorrow's roll and can do precisely nothing with it. That
--- is the property to preserve if this is swapped -- a "more secure" source
--- that keys on the message id would be strictly worse.
function M.dayRollBps(address, day)
  local h = 2166136261
  local s = tostring(address) .. "#" .. string.format("%d", int(day, 0))
  for i = 1, #s do
    h = (h ~ string.byte(s, i)) & 0xFFFFFFFF
    h = (h * 16777619) & 0xFFFFFFFF
  end
  return h % BPS
end

--- How many halvings the schedule has reached. One clock, read in two places.
local function emissionHalvings(state, timestamp)
  local policy = state.policy.runeRewards
  local cfg = C.ECONOMY.rune or {}
  local now = int(timestamp, 0)
  if int(policy.genesisAt, 0) <= 0 then policy.genesisAt = now end
  local elapsed = math.max(0, now - int(policy.genesisAt, 0))
  local period = math.max(1, int(cfg.halvingPeriod, 365 * DAY))
  return math.min(int(cfg.maxHalvings, 8), elapsed // period)
end

--- What ONE account is paid this epoch. The supply schedule, per player.
---
--- The halving has to live here, on the rate an account actually receives.
--- Applying it only to the global pot -- which is what happened when emission
--- first became per-account -- left the per-account rate flat forever while the
--- ceiling above it halved, so the schedule both failed to decay AND started
--- strangling the game: a 2,000 ceiling pays 48 to 41 accounts, and 20 after
--- one halving.
---
--- 48 integer-halves to 24, 12, 6, 3, 1, then 0 -- reaching the floor in the
--- SIXTH year, not the eighth `maxHalvings` allows. Lifetime emission per
--- account is therefore 12.17 epochs x (48+24+12+6+3+1) = ~1,144 Rune, and
--- total supply is that times the number of passes ever sold. Bounded,
--- knowable in advance, and publishable -- which is the whole point of a
--- schedule a holder can price.
---
--- The floor is one Rune an epoch, NOT zero. Zero means an account created in
--- year seven earns nothing ever, which is a dead first week that never ends;
--- one an epoch is ~1% of the genesis rate, small enough to be a rounding error
--- against total supply and large enough that arriving late is not pointless.
function M.emissionPerAccount(state, timestamp)
  local cfg = C.ECONOMY.rune or {}
  local halvings = emissionHalvings(state, timestamp)
  local rate = int(cfg.emissionPerAccount, 48)
  for _ = 1, halvings do rate = rate // 2 end
  return math.max(int(cfg.minEmissionPerAccount, 0), rate), halvings
end

--- The global epoch CEILING. A circuit breaker, not a divisor.
---
--- Nothing is divided by this any more, and it must never bind in normal
--- operation -- if it does, accounts that claim late in an epoch are paid less
--- than accounts that claimed early, which is a race, not a policy. So it is
--- derived from what the schedule could legitimately owe: every pass ever sold,
--- plus headroom, at this epoch's per-account rate. `emissionPerEpoch` is the
--- floor under that, so a tiny deployment still has a sane backstop.
function M.emissionBudget(state, timestamp)
  local policy = state.policy.runeRewards
  local perAccount, halvings = M.emissionPerAccount(state, timestamp)
  local passes = int((state.policy.passes or {}).lifetimePassCount, 0)
  local owed = perAccount * (passes + 100)
  local budget = math.max(int((C.ECONOMY.rune or {}).emissionPerEpoch, 2000), owed)
  budget = math.max(int((C.ECONOMY.rune or {}).minEmissionPerEpoch, 0), budget)
  policy.epochBudget = budget
  return budget, halvings
end

--- How many accounts the day's pot is divided between.
---
--- `qualifiedActive` is only adopted while the qualification rule is switched
--- on, and that rule is itself an open launch decision -- so reading it alone
--- left the divisor at zero, `math.max(1, 0)` made it one, and the first
--- claimant of the day would have taken the ENTIRE global pot. The candidate
--- count is computed either way; fall back to it so the split is always against
--- the real population.
--- UNUSED in v2 and kept deliberately.
---
--- Emission is per account now, so nothing divides by a population. This is
--- retained because reinstating a fixed pot means reinstating exactly this
--- function, and because its fall-through to 1 is the bug worth remembering:
--- `candidateQualified` needs three distinct active days, so the divisor is
--- structurally zero for the first three days of any deployment. Restore it and
--- floor the result at `emissionPerEpoch // accountNet30Cap`, never at 1.
local function emissionPopulation(state) -- luacheck: ignore
  local gold = state.policy.gold
  local adopted = int(gold.qualifiedActive, 0)
  if adopted > 0 then return adopted end
  return math.max(1, int(gold.candidateQualifiedActive, 0))
end

--- The gameplay Gold faucet: what a quest or an arena win pays.
---
--- Two properties, and they are the whole design:
---
--- **It is capped per ACCOUNT per WINDOW, not per action.** Every verb that
--- pays Gold draws on one 20-hour allowance, so a wallet questing around the
--- clock and a person playing for two hours collect exactly the same amount.
--- That is the same shape as the daily crate and for the same reason: a reward
--- proportional to playtime is the one thing a machine beats a person at.
---
--- **It is paid out of the locked launch allocation, never minted.** Gold's
--- conservation identity is `issued - burned = player + escrow + shop +
--- locked`, and this moves a balance from the fourth bucket to the first.
--- `recordPlayerDeltas` deliberately ignores a positive Gold delta from any
--- non-admin verb, so the ledger side has to happen HERE, before the handler
--- credits the player -- and the handler must credit exactly what this returns
--- rather than what it asked for.
---
--- When the pool cannot cover the reward the answer is zero and a reason, the
--- way a desk pauses rather than going negative. That is not a bug to route
--- around later: a fixed Gold supply with a gameplay faucet drains, and what
--- refills it is `policy.gold.expansionEnabled` and the weekly target
--- recomputation. This function is where that becomes visible.
function M.grantGoldReward(state, address, amount, timestamp, reason)
  state = M.ensureState(state)
  amount = math.max(0, int(amount, 0))
  if amount == 0 then return 0, nil end
  if type(address) ~= "string" or address == "" then return 0, "No signer address" end
  if state.policy.emergency and state.policy.emergency.paused == true then
    return 0, state.policy.emergency.reason or "The economy is paused"
  end
  local cap = math.max(0, int((C.ECONOMY.gold or {}).rewardWindowCap, 0))
  if cap <= 0 then return 0, "Gameplay Gold rewards are disabled" end
  local window = int(timestamp, 0) // math.max(1, int(C.ECONOMY.shop.accountWindow, DAY))
  local activity = state.activity[address]
  if not activity then
    activity = { days = {}, sinkActions = 0, runeFlow = {} }
    state.activity[address] = activity
  end
  local row = activity.goldReward
  if type(row) ~= "table" or int(row.window, -1) ~= window then
    row = { window = window, paid = 0 }
    activity.goldReward = row
  end
  local headroom = cap - int(row.paid, 0)
  if headroom <= 0 then return 0, "Today's Gold reward allowance is spent" end
  local floor = math.max(0, int((C.ECONOMY.gold or {}).rewardReserveFloor, 0))
  local available = int(state.gold.locked, 0) - floor
  if available <= 0 then return 0, "The gameplay reward reserve is empty" end
  local paid = math.min(amount, headroom, available)
  if paid <= 0 then return 0, "The gameplay reward reserve is empty" end
  state.gold.locked = int(state.gold.locked, 0) - paid
  state.gold.player = int(state.gold.player, 0) + paid
  row.paid = int(row.paid, 0) + paid
  local today = dailyRow(state.gold.daily, timestamp)
  today.issued = int(today.issued, 0) + paid
  state.policy.gold.rewardsPaid = int(state.policy.gold.rewardsPaid, 0) + paid
  return paid, reason
end

function M.claimRuneReward(state, player, address, timestamp)
  state = M.ensureState(state)
  candidateQualified(state, timestamp)
  local policy = state.policy.runeRewards
  if player.pass and int(player.pass.recoveryCooldownUntil, 0) > timestamp then
    return 0, "Account recovery cooldown is active"
  end
  if policy.bondEnabled
     and int(player.pass and player.pass.bond, 0) < int(policy.bondAmount, 0) then
    return 0, "Full Rune reward eligibility requires the configured Rune bond"
  end
  -- The only remaining stop is the emergency brake. `enabled` is kept as an
  -- explicit override for an operator who has to halt the faucet in an
  -- incident, but it no longer DEFAULTS the faucet off: the schedule decides.
  if state.policy.emergency and state.policy.emergency.paused == true then
    return 0, state.policy.emergency.reason or "The economy is paused"
  end
  if policy.enabled == false and policy.haltedByOperator == true then
    return 0, policy.reason or "Rune rewards are halted"
  end
  local budget = M.emissionBudget(state, timestamp)
  -- Published so the view and the client can read the schedule's current
  -- answer. Derived every claim; never an input.
  policy.epochBudget = budget
  if budget <= 0 then return 0, "The emission schedule has run to zero" end
  local epochId = timestamp // math.max(1, int((C.ECONOMY.rune or {}).epochLength, 30 * DAY))
  if not policy.currentEpoch or int(policy.currentEpoch.id, -1) ~= epochId then
    policy.currentEpoch = { id = epochId, spent = 0, claims = {} }
  end
  -- NOT once per epoch any more. The allowance accrues DAILY and is collected
  -- whenever the player next worships; `claims[address]` is now a running
  -- per-epoch total rather than a gate. A single 48-Rune payday every thirty
  -- days left a new account dry for a month, which is a strange thing to do to
  -- the person most likely to leave.
  --
  -- Accrual is keyed to the DAY, deliberately, and not to the worship claim.
  -- Worship runs on a 20-hour interval, so paying per claim would hand 36
  -- payments per 30-day epoch instead of 30 -- a silent 20% bonus for setting
  -- an alarm. Claiming more often now collects the same Rune, sooner.

  local activity = state.activity[address] or { days = {}, sinkActions = 0, runeFlow = {} }
  local firstDay, distinct = nil, 0
  for day in pairs(activity.days or {}) do
    distinct = distinct + 1
    if firstDay == nil or int(day, 0) < firstDay then firstDay = int(day, 0) end
  end
  local ageDays = firstDay and (timestamp // DAY - firstDay) or 0
  -- NO MATURITY RAMP. A fresh account earns the full rate from its first day.
  --
  -- This used to be `ageDays >= 30 and BPS or (ageDays >= 7 and 5000 or 0)`,
  -- the ramp ECONOMY_MARKETPLACE_PLAN.md §8.6 lists as a locked default:
  -- 25% for the first week, 50% to day 30, full afterwards. It was there to
  -- make a freshly-minted farm wallet earn a quarter rate while it was cheap
  -- to make one.
  --
  -- Wallets are not cheap to make any more -- entry is a paid pass, and §8.7's
  -- payback model is what prices the farm now. What the ramp actually cost was
  -- the honest newcomer: a dead first week, at the exact moment somebody is
  -- deciding whether this game is worth their time. Removed deliberately, and
  -- the trade is recorded in ECONOMY_V2.md §2 -- the pass carries the whole
  -- sybil defence, so if the pass price ever stops tracking the Rune price this
  -- is one of the things that was holding the line and no longer is.
  --
  -- `maturityBps` still ramps NPC DESK quotas (economy.lua, 10%/50%/100%).
  -- That is a separate mechanism on a separate surface and is untouched here.
  -- v2: a flat PER-ACCOUNT rate, not a pot divided by a population.
  --
  -- The divisor is gone, and with it the launch-window hole it opened:
  -- `emissionPopulation` fell through to 1 whenever nothing had qualified yet
  -- -- which is structurally the case for the first three days of ANY
  -- deployment, and was the case on the live process -- so `perCapita` was the
  -- entire epoch budget and the newcomer floor was a quarter of it, 500 Rune,
  -- reachable in a single claim.
  --
  -- Entry is a paid pass, so wallet count is no longer free and no longer needs
  -- to be divided by. See the note on `emissionPerAccount` in constants.lua for
  -- what that trade gives up.
  local perCapita = M.emissionPerAccount(state, timestamp)
  policy.newcomerFloor = perCapita
  -- The schedule has run out, which is a different thing from a busy epoch and
  -- is permanent. Say so plainly rather than reporting a sharing-out that will
  -- never come round again.
  if perCapita <= 0 then
    return 0, "The emission schedule has completed; Rune is no longer minted"
  end
  local epochDays = math.max(1,
    int((C.ECONOMY.rune or {}).epochLength, 30 * DAY) // DAY)
  local perDayBps = (perCapita * BPS) // epochDays

  -- How many whole days are owed. First claim ever pays one day, not the age
  -- of the universe: `runeAccruedThrough` is stamped on the account the first
  -- time it is read, so a wallet that sat dormant for a year cannot come back
  -- and collect the year.
  local today = timestamp // DAY
  local through = int(activity.runeAccruedThrough, 0)
  if through <= 0 then through = today - 1 end
  local owedDays = math.max(0, today - through)
  if owedDays <= 0 then return 0, "Today's Rune has already been claimed" end
  -- One epoch of accrual is the ceiling, so time away banks a month at most.
  if owedDays > epochDays then owedDays = epochDays end

  -- Pay the whole part of every owed day, then roll ONLY the fraction.
  --
  -- Rolling the whole amount would let a new account come up empty for a week
  -- at 1.6/day -- `0.6^7` is about a 2.8% chance of nothing at all, landing on
  -- the people likeliest to leave. Rolling the remainder alone keeps the swing
  -- to a single Rune a day: you get 1 or 2, never nothing.
  --
  -- The roll is keyed to (address, day) and NOT to the claiming message. That
  -- is the whole anti-grind property: day N's outcome is fixed the moment day N
  -- happens, so collecting it on day 30 pays exactly what collecting it on day
  -- 3 would have. Nobody can look at a roll and decline it, and nobody can
  -- re-sign a claim until it comes up good -- which is the shape of the hunt
  -- capture defect, where every input to the roll was client-derivable before
  -- the player had to commit.
  local wholePerDay = perDayBps // BPS
  local fracPerDay = perDayBps % BPS
  local share = wholePerDay * owedDays
  for day = through + 1, through + owedDays do
    if fracPerDay > 0 and M.dayRollBps(address, day) < fracPerDay then
      share = share + 1
    end
  end
  if share <= 0 then
    return 0, "The day's emission is fully shared out"
  end
  local remainingEpoch = budget - int(policy.currentEpoch.spent, 0)

  -- `consumed30` must mean what the asset ledger means by consumed: BURNED.
  --
  -- It used to count every negative delta, so the net-30 cap was self-raisable
  -- at zero cost. Market.Buy has no fee and no price ceiling, and Rune.Withdraw,
  -- Pass.Bond and every refund path (Admin.MintFailed, a withdrawal refund,
  -- Pass.CompleteUnbond, Burn-Notice) turn a matched debit into permanent faucet
  -- headroom. On the live process 256 of one epoch's 1,056 Rune -- 24% -- was
  -- credit bought that way, and ECONOMY_MARKETPLACE_PLAN.md §8.6's "the bond
  -- cannot be counted as consumed Rune" was violated verbatim.
  --
  -- `actionKind` already draws exactly this line: TRANSFER_ACTIONS are moves,
  -- not burns. Gate on it rather than on the sign of the delta.
  --
  -- Deliberately NOT the mirror fix on `issued30`. Counting every positive
  -- delta as issuance would charge a player for their own refunded withdrawal
  -- and for getting their bond back, permanently shrinking an honest account's
  -- allowance. The cap is a NET cap by design: spending legitimately buys
  -- headroom, and that is the intent.
  local issued30, consumed30 = 0, 0
  for _, flow in ipairs(activity.runeFlow or {}) do
    if timestamp - int(flow.timestamp, 0) < 30 * DAY then
      local delta = int(flow.delta, 0)
      if delta > 0 and flow.action == "Daily.Claim" then
        issued30 = issued30 + delta
      elseif delta < 0 and actionKind(flow.action, delta) == "consume" then
        consumed30 = consumed30 - delta
      end
    end
  end
  local accountRemaining = int(policy.accountNet30Cap, 20) + consumed30 - issued30
  local amount = math.max(0, math.min(share, remainingEpoch, accountRemaining))
  -- Record nothing when nothing was paid, and in particular do NOT advance
  -- `runeAccruedThrough`: a day the caps refused is a day still owed, not a day
  -- spent. Advancing it here would quietly burn the accrual every time an
  -- account was at its net-30 cap.
  if amount <= 0 then return 0, "Rune reward caps leave no available amount" end
  -- A RUNNING TOTAL now, not a once-per-epoch gate. `claims[address]` is read
  -- by the published view as "what this account has drawn this epoch", and with
  -- a daily drip that is a sum over many claims rather than a single payment.
  policy.currentEpoch.claims[address] =
    int(policy.currentEpoch.claims[address], 0) + amount
  policy.currentEpoch.spent = int(policy.currentEpoch.spent, 0) + amount
  -- Advance the accrual only for days actually paid for. `amount` can be less
  -- than `share` when a cap bit, so credit the whole-Rune days that were paid
  -- and leave the rest owed.
  do
    local paidDays = owedDays
    if amount < share and wholePerDay > 0 then
      paidDays = math.min(owedDays, amount // wholePerDay)
    end
    if paidDays > 0 then
      -- `state.activity[address]` may not exist yet: the local `activity` above
      -- falls back to a fresh table that is not in the store, so writing to it
      -- alone would forget the stamp and pay the same day forever.
      local row = state.activity[address]
      if not row then
        row = { days = {}, sinkActions = 0, runeFlow = {} }
        state.activity[address] = row
      end
      row.runeAccruedThrough = through + paidDays
    end
  end
  return amount, nil
end

function M.syncHoldings(state, players, timestamp, reason)
  state = M.ensureState(state)
  local itemTotals, boxes, gold = {}, {}, 0
  for _, item in ipairs(ITEM_IDS) do itemTotals[item] = 0 end
  for rarity = 1, C.MAX_LOOT_RARITY do boxes[rarity] = 0 end
  for _, p in pairs(players or {}) do
    p.gold = math.max(0, int(p.gold, 0))
    gold = gold + p.gold
    for _, item in ipairs(ITEM_IDS) do
      itemTotals[item] = itemTotals[item] + int((p.inventory or {})[item], 0)
    end
    for _, rarity in ipairs(p.lootboxes or {}) do
      rarity = clamp(rarity, 1, C.MAX_LOOT_RARITY)
      boxes[rarity] = boxes[rarity] + 1
    end
  end
  for _, item in ipairs(ITEM_IDS) do
    local row = state.assets[item]
    local delta = itemTotals[item] - int(row.player, 0)
    if delta > 0 then
      recordAsset(row, delta, "issue", timestamp, reason or "Admin.Load restoration")
    elseif delta < 0 then
      recordAsset(row, delta, "consume", timestamp, reason or "Admin.Load reconciliation")
    end
  end
  for rarity = 1, C.MAX_LOOT_RARITY do
    local row = state.lootboxes[rarity]
    local delta = boxes[rarity] - int(row.player, 0)
    if delta > 0 then
      recordAsset(row, delta, "issue", timestamp, reason or "Admin.Load restoration")
    elseif delta < 0 then
      recordAsset(row, delta, "consume", timestamp, reason or "Admin.Load reconciliation")
    end
  end
  local goldDelta = gold - int(state.gold.player, 0)
  if goldDelta > 0 and state.gold.locked >= goldDelta then
    state.gold.locked = state.gold.locked - goldDelta
    state.gold.player = gold
  elseif goldDelta <= 0 then
    state.gold.locked = state.gold.locked - goldDelta
    state.gold.player = gold
  end
  return state
end

--- A monotonic fingerprint of how much this ledger has EVER issued: the sum of
--- every asset's, Gold's and loot box's lifetime `issued`.
---
--- It only ever grows under the guarded verbs -- issuance is one-way, and a
--- consume grows `consumed` rather than shrinking `issued` -- so it is the
--- economy's answer to `playercommit`. `game.lua` commits it every slot and,
--- on a corrupt restore, reads it back: `EconomyState` rides the same `priv`
--- as `Players`, so if the roster was lost the ledger may have been too. A live
--- ledger whose issuance is BELOW what the last good slot committed was reset
--- with the priv -- and it is NOT recoverable from the published state
--- (`now/economy` is a lossy `flowView`, never the export shape with orders,
--- escrow and reserves) -- so the heal refuses rather than run a handler over,
--- and republish, a broken ledger.
---
--- Why issuance and not the `player` pools: `assets[item].player` carries a
--- small standing offset from the live inventory sum (a removed account's
--- berries stay pooled, escrow moves in and out), so an exact holdings equality
--- false-positives. Lifetime issuance has no such offset and cannot fall except
--- by a reset.
function M.issuedWitness(state)
  state = M.ensureState(state)
  local total = int(state.gold.issued, 0)
  for _, item in ipairs(ITEM_IDS) do
    total = total + int(state.assets[item].issued, 0)
  end
  for rarity = 1, C.MAX_LOOT_RARITY do
    total = total + int(state.lootboxes[rarity].issued, 0)
  end
  return total
end

local function playerGold(player)
  return math.max(0, int(player and player.gold, 0))
end

--- The ACCOUNT half of a Gold move, with no supply accounting.
---
--- Items already worked this way -- `takeItem`/`giveItem` touch the player and
--- the caller moves `assets[item].player`/`.escrow` itself -- and Gold did
--- both at once. Splitting them is what lets an account live somewhere other
--- than a player record: the ledger moves the account, the engine moves the
--- pool, and neither needs to know how the other is implemented.
local function takeGold(player, amount)
  amount = math.max(0, int(amount, 0))
  if playerGold(player) < amount then return false end
  player.gold = playerGold(player) - amount
  return true
end

local function giveGold(player, amount)
  amount = math.max(0, int(amount, 0))
  if amount > 0 then player.gold = playerGold(player) + amount end
end

local function debitGold(state, player, amount)
  if not takeGold(player, amount) then return false end
  state.gold.player = math.max(0, int(state.gold.player, 0) - math.max(0, int(amount, 0)))
  return true
end

local function creditGold(state, player, amount)
  amount = math.max(0, int(amount, 0))
  if amount == 0 then return end
  giveGold(player, amount)
  state.gold.player = int(state.gold.player, 0) + amount
end

local function outstandingGold(state)
  return int(state.gold.issued, 0) - int(state.gold.burned, 0)
end

local function goldTarget(state)
  local policy = state.policy.gold
  return math.max(int(policy.targetFloor, 300000),
    int(policy.stabilizationReserve, 180000)
      + int(policy.perQualifiedPlayer, 1000) * int(policy.qualifiedActive, 0))
end

local function routeGoldFee(state, amount, timestamp, reason)
  amount = math.max(0, int(amount, 0))
  if amount == 0 then return { burned = 0, locked = 0 } end
  local target = goldTarget(state)
  local burn = outstandingGold(state) * BPS
    > target * int(state.policy.gold.burnAboveTargetBps, 11000)
  local today = dailyRow(state.gold.daily, timestamp)
  if burn then
    state.gold.burned = int(state.gold.burned, 0) + amount
    today.consumed = int(today.consumed, 0) + amount
    return { burned = amount, locked = 0, reason = reason }
  end
  state.gold.locked = int(state.gold.locked, 0) + amount
  state.gold.feesRouted = int(state.gold.feesRouted, 0) + amount
  return { burned = 0, locked = amount, reason = reason }
end

local function inventory(player, item)
  return math.max(0, int(player and player.inventory and player.inventory[item], 0))
end

local function takeItem(player, item, amount)
  amount = math.max(0, int(amount, 0))
  if inventory(player, item) < amount then return false end
  local nextAmount = inventory(player, item) - amount
  player.inventory[item] = nextAmount > 0 and nextAmount or nil
  return true
end

local function giveItem(player, item, amount)
  amount = math.max(0, int(amount, 0))
  if amount > 0 then player.inventory[item] = inventory(player, item) + amount end
end

--- How many orders this account has that can still trade.
---
--- Expired-but-unswept orders are deliberately NOT counted. They cannot match
--- (see `bestMatch`), so counting them against the per-account cap would let a
--- month of stale orders lock a player out of their own book while the sweep,
--- which is bounded, got around to them.
--- The supply row for an asset. Gold keeps its own because it is issued
--- rather than dropped, but it has the same `player`/`escrow` shape, so the
--- book can treat the quote asset as just another asset -- which is what makes
--- a market against something other than Gold a registry row rather than a
--- rewrite.
local function pool(state, asset)
  if asset == "gold" then return state.gold end
  return state.assets[asset]
end

--- The ledger: the ONLY thing the matching engine knows about an account.
---
--- Everything else in the book works on `state`. Two implementations, one
--- book: in the game an account is a player record, with Gold on `player.gold`
--- and the rest in `player.inventory`; standalone it is a credit balance fed
--- by a token's `Credit-Notice` and drained by a signed withdrawal. The engine
--- cannot tell which it has, and that is the entire point -- see ORDERBOOK.md
--- §6 and §10.
---
--- `debit` returns false rather than erroring when the balance is short, the
--- same contract `takeItem` already had.
function M.playerLedger(players)
  players = type(players) == "table" and players or {}
  return {
    kind = "player",
    exists = function(account) return players[account] ~= nil end,
    -- The account's game record, or nil. The ONLY caller is the NPC desk's
    -- maturity limit, which is a game rule rather than a book rule; a
    -- standalone ledger returns nil and the desk treats that as unmatured.
    record = function(account) return players[account] end,
    balance = function(account, asset)
      local p = players[account]
      if not p then return 0 end
      if asset == "gold" then return playerGold(p) end
      return inventory(p, asset)
    end,
    debit = function(account, asset, amount)
      local p = players[account]
      if not p then return false end
      if asset == "gold" then return takeGold(p, amount) end
      return takeItem(p, asset, amount)
    end,
    credit = function(account, asset, amount)
      local p = players[account]
      if not p then return end
      if asset == "gold" then giveGold(p, amount) else giveItem(p, asset, amount) end
    end,
  }
end

--- Accept either a ledger or a plain players table.
---
--- Every caller in the game still passes `Players`, and every existing test
--- does too. Rather than churn all of them for a seam they do not use, the
--- book wraps what it is given. A real ledger is recognised by having the
--- functions; anything else is a player table.
local function asLedger(value)
  if type(value) == "table" and type(value.balance) == "function" then return value end
  return M.playerLedger(value)
end

--- Normalise a tag value that names a mode.
---

--- The NPC desk, as seen from inside the matching engine.
---
--- These three are defined further down, with the rest of the desk, because
--- they are priced off stock, reserves and rate limits that the book does not
--- otherwise touch. They are declared here because the book calls them: the
--- desk quotes into the ladder, so a taker automatically gets whichever of
--- desk-or-P2P is better instead of having to compare two tabs. That is what
--- makes "P2P wins unless it leaves the corridor" a property of the book
--- rather than a hope about which screen the player opened. ORDERBOOK.md §3.1.
local deskQuote, deskSettle, deskAnchors

--- THE GAME'S HOST, and the book's public verbs behind it.
---
--- `orderbook.lua` is a venue that knows nothing about players, issuance or an
--- NPC desk. This is the adapter that makes it the game's book: Gold and items
--- come from the issuance buckets, a fee is burned or locked against the Gold
--- target, and the desk quotes into the same ladder the players rest on.
---
--- Every verb below keeps the signature it had when the book lived in this
--- file -- `(state, players, ...)` -- so `game.lua`, `economy_test.lua` and
--- `game_test.lua` are unchanged by the extraction. `players` may be a plain
--- player table or a ledger; `asLedger` still decides which.
local function economyHost(state, players)
  return {
    ensure = M.ensureState,
    ledger = asLedger(players),
    pool = pool,
    fee = function(_, asset, amount, timestamp, reason)
      if asset == "gold" then
        routeGoldFee(state, amount, timestamp, reason)
        return
      end
      state.fees = type(state.fees) == "table" and state.fees or {}
      state.fees[asset] = int(state.fees[asset], 0) + int(amount, 0)
    end,
    --- An asset is tradable here when the game issues it. The book asks
    --- before it will take an order, which is why an unknown item is a
    --- refusal rather than a supply row conjured out of a tag.
    tradable = function(_, asset) return state.assets[asset] ~= nil end,
    pauseReason = function(_)
      local stop = state.policy and state.policy.emergency
      if stop and stop.paused then
        return tostring(stop.reason or "emergency pause")
      end
      return nil
    end,
    quote = function(_, ledger, item, side, account, timestamp, withdrawals, deposits)
      return deskQuote(state, ledger, item, side, account, timestamp,
        withdrawals, deposits)
    end,
    settleHouse = function(_, ledger, desk, order, price, units, timestamp)
      return deskSettle(state, ledger, desk, order, price, units, timestamp)
    end,
    anchors = function(_, item) return deskAnchors(state, item) end,
  }
end

M.economyHost = economyHost
M.resolveMarket = OB.resolveMarket

function M.placeOrder(state, players, account, side, item, price, quantity,
                      timestamp, actionId, opts)
  state = M.ensureState(state)
  return OB.placeOrder(economyHost(state, players), state, account, side, item,
    price, quantity, timestamp, actionId, opts)
end

function M.amendOrder(state, players, account, orderId, price, quantity,
                      timestamp, actionId, opts)
  state = M.ensureState(state)
  return OB.amendOrder(economyHost(state, players), state, account, orderId,
    price, quantity, timestamp, actionId, opts)
end

function M.cancelOrder(state, players, account, orderId, timestamp, actionId)
  state = M.ensureState(state)
  return OB.cancelOrder(economyHost(state, players), state, account, orderId,
    timestamp, actionId)
end

function M.cancelOrders(state, players, account, filter, timestamp, actionId)
  state = M.ensureState(state)
  return OB.cancelOrders(economyHost(state, players), state, account, filter,
    timestamp, actionId)
end

function M.maintain(state, players, timestamp, limit)
  state = M.ensureState(state)
  return OB.maintain(economyHost(state, players), state, timestamp, limit)
end

function M.accountOpenCount(state, account, timestamp)
  state = M.ensureState(state)
  return OB.accountOpenCount(economyHost(state, nil), state, account, timestamp)
end

function M.accountOrders(state, account, timestamp)
  state = M.ensureState(state)
  return OB.accountOrders(economyHost(state, nil), state, account, timestamp)
end

function M.accountFills(state, account, limit)
  state = M.ensureState(state)
  return OB.accountFills(economyHost(state, nil), state, account, limit)
end

function M.recordRejected(state, reason)
  state = M.ensureState(state)
  recordRejected(state, reason)
end




local function assetSupply(state, item)
  local row = state.assets[item]
  return math.max(0, int(row and row.issued, 0) - int(row and row.consumed, 0))
end

--- How much stock the desk may HOLD. A share of outstanding supply, and that
--- is the right shape for an inventory even though it is the wrong shape for a
--- flow (see `epochFlowLimit`). A stock measured against a stock does not
--- invert: outstanding berries grow with the playerbase, because every player
--- carries a working balance of them, so the desk's position grows with the
--- game and is still bounded at a share of it. `stockMax` is the hard ceiling
--- for the day the ratio stops being the binding one.
--- ... with a FLOOR under it, which is the difference between a desk and a
--- decoration on a young process.
---
--- A share of supply inverts at small scale. With a few players holding a few
--- hundred berries the cap was a dozen units: the band ladder spans the whole
--- cap, so the quote fell from 5 to 1 inside a single five-berry trade, and
--- the desk hit "Shop stock cap reached" and stopped buying almost at once.
--- The relative rule is right for a grown economy and wrong for a new one, so
--- the floor holds the desk at a workable size until 5% of real supply
--- overtakes it -- 6,000 berries of a kind, which is about where the recovered
--- set already sits.
local function deskCap(state, desk)
  local supply = assetSupply(state, desk.item)
  local floor = math.max(0, int(desk.stockFloor, 0))
  if supply <= 0 and floor <= 0 then return 0 end
  local relative = (supply * int(desk.stockBps, 0)) // BPS
  if relative < floor then relative = floor end
  if relative < 1 then relative = 1 end
  return math.min(int(desk.stockMax, 0), relative)
end

--- How many units a desk will move in a policy epoch, and it counts PLAYERS.
---
--- The rate per account is DERIVED from the desk's own 20-hour cap rather than
--- typed beside it, because the two limits have to stay coherent and a second
--- constant is a second thing to forget. `limits.global // flowFloorAccounts`
--- is 25 on a berry desk and 1 on scroll and Rune, and 25 is the number the
--- rest of this comment is about:
---
--- * The daily worship box pays 5 berries of each kind (0.95 x 5 from the
---   tier-2 row plus 0.25 x 1 from the tier-1 row), so 35 of each kind an
---   epoch. That is the whole item faucet now -- ECONOMY_V2.md §7 moved it off
---   the battle.
--- * Eight actions a day burn ~22 berries, but not evenly: ~1.75 OWN-ELEMENT
---   berries for the 35 energy plus one of anything for the Play. So a player
---   runs a surplus in three kinds and a deficit of ~9 a day in the fourth,
---   and a hunt entry takes another 5 of each on top (`C.HUNT.entry.berries`).
--- * 25 a kind an epoch is ~70% of what one kind pays out, and it CLOSES: at
---   the desk's opening band (bid 5, ask 12) selling 25 of each of three
---   off-element kinds pays 375 Gold and buying 25 of the fourth costs 300.
---   That is the desk doing the job it exists for -- convert the surplus into
---   the shortage -- without being the whole market, which is what the player
---   exchange is for.
---
--- The floor of 20 accounts makes the cap exactly `limits.global` on a fresh
--- berry desk, so the desk is never throttled below one 20-hour window's
--- allowance. Above the floor the two caps hand over instead of shadowing each
--- other: an epoch holds 8.4 twenty-hour windows, so 500 a window is 4,200 a
--- week, the epoch cap binds up to 4,200/25 = 168 accounts, and the 20-hour
--- rate limiter binds above it. Both are live, which is the entire point --
--- under the old rule one of them could never fire.
---
--- 168 is also, exactly, the recovery set. `legacy-players.json` is 168
--- accounts holding ~7,400 berries of each kind, so loading it in step 4 moves
--- outstanding supply ~15x, moves this cap NOT AT ALL, and lands the two caps
--- on the same number -- which is the coherence being bought, checked against
--- the one population this game is certain to have. What the load does move is
--- `deskCap` above, and that is correct: a bigger world supports a bigger
--- inventory.
local function epochFlowLimit(state, desk)
  local floor = math.max(1, int(C.ECONOMY.shop.flowFloorAccounts, 20))
  local perAccount = math.max(1, int(desk.limits and desk.limits.global, 0) // floor)
  local accounts = math.max(floor,
    int((state.policy.passes or {}).lifetimePassCount, 0))
  return perAccount * accounts
end

local function deskBand(desk, cap, stock)
  if cap <= 0 then return nil end
  local ratio = (math.max(0, stock) * BPS) // cap
  for index, band in ipairs(desk.prices or {}) do
    if ratio < int(band.uptoBps, BPS) or index == #desk.prices then return band, index end
  end
  return desk.prices[#desk.prices], #desk.prices
end

local function anchoredPrice(desk, base, side)
  local sideBps = side == "bid" and int(desk.bidBps, BPS) or int(desk.askBps, BPS)
  local anchored = (int(base, 1) * int(desk.anchorBps, BPS) + (BPS // 2)) // BPS
  return math.max(1, (anchored * sideBps + (BPS // 2)) // BPS)
end

--- Forget per-account desk usage from a window that has closed.
---
--- `accountUsage` holds one row per address per desk, and it only ever had a
--- REPLACEMENT rule: a row whose window had rolled was overwritten the next
--- time that same account traded that same desk. An account that traded once
--- and never came back therefore kept its row for the life of the process, six
--- desks over, and nothing read it -- `deskHeadroom` deliberately reads the map
--- raw so that quoting does not create rows, and every reader that matters
--- checks `window` before believing a row anyway.
---
--- So the row is not merely stale, it is inert: the code already treats a row
--- from a closed window as absent. Deleting it changes no answer and removes an
--- O(accounts x desks) map from every message's marshalling.
---
--- Swept only when a NEW window is entered for this desk, which is at most once
--- per account-window rather than once per trade.
local function pruneDeskUsage(desk, window)
  for account, row in pairs(desk.accountUsage) do
    if type(row) ~= "table" or int(row.window, -1) ~= window then
      desk.accountUsage[account] = nil
    end
  end
end

local function usageRows(desk, account, timestamp)
  local window = timestamp // C.ECONOMY.shop.accountWindow
  -- The desk's own window rolls exactly once per window, whoever trips it, so
  -- it is already the high-water mark the sweep needs -- no new field, and
  -- nothing extra in the published desk. Sweeping per STALE ACCOUNT instead
  -- would walk the whole map on every account's first trade of the window,
  -- which is O(accounts squared) across it: one leak traded for a worse one.
  --
  -- Hoisted above the per-account row deliberately. The sweep drops every row
  -- that is not from `window`, and the row written below is, so doing it in
  -- this order means the sweep needs no exception for the caller.
  if int(desk.globalUsage.window, -1) ~= window then
    pruneDeskUsage(desk, window)
    desk.globalUsage = { window = window, buy = 0, sell = 0 }
  end
  local accountRow = desk.accountUsage[account]
  if not accountRow or int(accountRow.window, -1) ~= window then
    accountRow = { window = window, buy = 0, sell = 0 }
    desk.accountUsage[account] = accountRow
  end
  local epoch = timestamp // C.ECONOMY.shop.policyEpoch
  if int(desk.epochUsage.epoch, -1) ~= epoch then
    desk.epochUsage = { epoch = epoch, quantity = 0 }
  end
  return accountRow, desk.globalUsage, desk.epochUsage
end

local function goldInvariant(state)
  local gold = state.gold
  local accounted = int(gold.player, 0) + int(gold.escrow, 0)
    + int(gold.shop, 0) + int(gold.locked, 0)
  return int(gold.issued, 0) - int(gold.burned, 0) == accounted,
    int(gold.issued, 0) - int(gold.burned, 0), accounted
end

local function itemInvariant(state, item)
  local row = state.assets[item]
  local accounted = int(row.player, 0) + int(row.escrow, 0) + int(row.shop, 0)
  return int(row.issued, 0) - int(row.consumed, 0) == accounted,
    int(row.issued, 0) - int(row.consumed, 0), accounted
end

local function pendingRune(withdrawals)
  local total = 0
  for _, row in pairs(withdrawals or {}) do
    if row.status == "pending" then total = total + int(row.amount, 0) end
  end
  return total
end

local function runeReconciliation(state, withdrawals, deposits)
  local external = state.policy.externalRuneSupply
  local inside = int(state.assets.rune.player, 0) + int(state.assets.rune.escrow, 0)
    + int(state.assets.rune.shop, 0) + int(state.policy.runeRewards.reserveBalance, 0)
    + int(state.policy.runeRewards.bondedRune, 0)
  local pendingOut = pendingRune(withdrawals)
  local economic = int(state.assets.rune.issued, 0) - int(state.assets.rune.consumed, 0)
  local accounted = inside + (external ~= nil and int(external, 0) or 0) + pendingOut
  return {
    inGame = inside,
    outsideTokenSupply = external,
    pendingWithdrawals = pendingOut,
    pendingDeposits = 0,
    economic = economic,
    accounted = accounted,
    difference = external ~= nil and (economic - accounted) or nil,
    observedAt = int(state.policy.externalRuneObservedAt, 0),
    depositsCredited = countMap(deposits),
  }
end

local function shopPauseReason(state, desk, side, withdrawals, deposits, timestamp)
  local good = goldInvariant(state)
  if not good then return "Gold invariant failed" end
  if state.policy.emergency and state.policy.emergency.paused then
    return state.policy.emergency.reason or "Emergency pause"
  end
  local manual = desk.manualPause and desk.manualPause[side]
  if manual then return manual end
  if not (desk.enabled and desk.enabled[side]) then return "Side disabled by policy" end
  if desk.item == "scroll" and not desk.reliableSupply then return "Reliable Scroll supply unavailable" end
  if desk.item == "rune" then
    local rec = runeReconciliation(state, withdrawals, deposits)
    if rec.outsideTokenSupply == nil then return "Rune token supply has not been reconciled" end
    if rec.difference ~= 0 then return "Rune reconciliation mismatch" end
  end
  local cap = deskCap(state, desk)
  if cap <= 0 then return "Tracked item supply unavailable" end
  local window = int(timestamp, 0) // C.ECONOMY.shop.accountWindow
  if int(desk.globalUsage.window, -1) == window
     and int(desk.globalUsage[side], 0) >= int(desk.limits.global, 0) then
    return "Global 20-hour quantity limit reached"
  end
  local epoch = int(timestamp, 0) // C.ECONOMY.shop.policyEpoch
  local epochLimit = epochFlowLimit(state, desk)
  if int(desk.epochUsage.epoch, -1) == epoch
     and int(desk.epochUsage.quantity, 0) >= epochLimit then
    return "Policy-epoch supply-flow limit reached"
  end
  -- `side` is the player's action: sell means the NPC is buying, buy means the
  -- NPC is selling. The public desk view uses the same player-facing spelling.
  if side == "sell" then
    if int(desk.stock, 0) >= cap then return "Shop stock cap reached" end
    local band = deskBand(desk, cap, desk.stock)
    if not band or int(desk.goldReserve, 0) < anchoredPrice(desk, band.bid, "bid") then
      return "Desk Gold reserve exhausted"
    end
  elseif int(desk.stock, 0) <= 0 then return "Desk is out of stock" end
  return nil
end

-- The desk, quoting into the book -------------------------------------------
--
-- Everything below fills in the three functions declared at the head of the
-- order book. The Shop tab and `Economy.Shop.Trade` are untouched and stay
-- exactly as they are, for trading at the desk deliberately; this is the same
-- desk, the same stock, the same Gold reserve and the same 20-hour limits,
-- reached through the ladder instead. A fill here consumes them identically,
-- or the desk gets drained twice for one shelf. ORDERBOOK.md §9.

--- What the desk would charge, or pay, for the NEXT single unit.
--- `side` is player-facing: `buy` means the player is buying and the desk is
--- selling at its ask; `sell` means the desk is buying at its bid.
local function deskUnitPrice(desk, cap, stock, side)
  if cap <= 0 then return nil end
  if side == "sell" and stock >= cap then return nil end
  if side == "buy" and stock <= 0 then return nil end
  local band = deskBand(desk, cap, stock)
  if not band then return nil end
  if side == "sell" then return anchoredPrice(desk, band.bid, "bid") end
  return anchoredPrice(desk, band.ask, "ask")
end

--- The desk's current two-sided quote, ignoring every reason it might refuse.
---
--- This is the price band's anchor and nothing else. It is deliberately blind
--- to pauses and rate limits: a fat-finger guard should describe where a price
--- IS, and a desk that has hit its 20-hour limit has not changed its opinion
--- of what a berry is worth.
deskAnchors = function(state, item)
  local desk = state.desks[item or ""]
  if not desk then return nil, nil end
  local cap = deskCap(state, desk)
  local band = deskBand(desk, cap, int(desk.stock, 0))
  if not band then return nil, nil end
  return anchoredPrice(desk, band.bid, "bid"), anchoredPrice(desk, band.ask, "ask")
end

--- How many units the desk may still trade with this account, this window.
---
--- Read-only on purpose. `usageRows` creates a per-account row on the desk,
--- and the published view calls this for every market on every read -- so a
--- version of this that used `usageRows` would mint a usage row for every
--- address that ever looked at the screen, and every slot afterwards would
--- pay for all of them. Quoting is not usage.
local function deskHeadroom(state, desk, ledger, account, side, timestamp)
  local shop = C.ECONOMY.shop
  local window = int(timestamp, 0) // shop.accountWindow
  local perAccount = int(desk.limits.perAction, 0)
  if account then
    local player = type(ledger.record) == "function" and ledger.record(account) or nil
    local mature = math.max(1,
      (int(desk.limits.perAccount, 0) * maturityBps(state, player, timestamp)) // BPS)
    local row = desk.accountUsage[account]
    local used = (row and int(row.window, -1) == window) and int(row[side], 0) or 0
    perAccount = math.min(perAccount, math.max(0, mature - used))
  end
  local globalUsed = int(desk.globalUsage.window, -1) == window
    and int(desk.globalUsage[side], 0) or 0
  local epoch = int(timestamp, 0) // shop.policyEpoch
  local epochLimit = epochFlowLimit(state, desk)
  local epochUsed = int(desk.epochUsage.epoch, -1) == epoch
    and int(desk.epochUsage.quantity, 0) or 0
  return math.max(0, math.min(
    perAccount,
    int(desk.limits.global, 0) - globalUsed,
    epochLimit - epochUsed,
    C.ECONOMY.orderbook.deskSweepMax))
end

--- The house side of the ladder: a price-ordered run of units the desk will
--- trade right now, best first.
---
--- Best-first is a property of the band curve rather than a sort. The desk
--- reprices against its own stock, so every unit it sells makes the next one
--- dearer and every unit it buys makes the next one cheaper -- which is what
--- makes a precomputed ladder exact. Nothing else moves the desk's stock
--- inside one message, so this list can be consumed as it stands.
---
--- `account` may be nil, for the published view, which asks what the desk
--- would do for anybody rather than for someone in particular.
deskQuote = function(state, ledger, item, takerSide, account, timestamp, withdrawals, deposits)
  local market = M.resolveMarket(state, item)
  -- Only a Gold market with a one-unit lot. The desk holds Gold and whole
  -- items; it has no opinion about lots of something else, and pretending
  -- otherwise is how a registry field becomes a rounding bug.
  if not market or market.houseQuotes ~= true then return nil end
  if int(market.lot, 1) ~= 1 or (market.quote or "gold") ~= "gold" then return nil end
  if takerSide ~= "buy" and takerSide ~= "sell" then return nil end
  local desk = state.desks[item or ""]
  if not desk then return nil end
  -- The desk's side of the trade is the player's side of the trade: the
  -- pause reasons, the limits and the public view all use the same
  -- player-facing spelling.
  if shopPauseReason(state, desk, takerSide, withdrawals, deposits, timestamp) then return nil end
  local room = deskHeadroom(state, desk, ledger, account, takerSide, timestamp)
  if room <= 0 then return nil end
  local cap = deskCap(state, desk)
  local stock = int(desk.stock, 0)
  local reserve = int(desk.goldReserve, 0)
  local levels, spend, units = {}, 0, 0
  while units < room do
    local price = deskUnitPrice(desk, cap, stock, takerSide)
    if not price then break end
    -- The desk cannot pay out more Gold than it holds, and it must refuse
    -- before the fill rather than go negative during it.
    if takerSide == "sell" then
      if spend + price > reserve then break end
      spend = spend + price
    end
    local top = levels[#levels]
    if top and top.price == price then top.units = int(top.units, 0) + 1
    else levels[#levels + 1] = { price = price, units = 1 } end
    stock = stock + (takerSide == "sell" and 1 or -1)
    units = units + 1
  end
  if units == 0 then return nil end
  return { desk = desk, item = item, side = takerSide, levels = levels, units = units }
end

--- Settle one run of units against the desk, at one price.
---
--- This is `shopTrade`'s accounting with the taker's side already escrowed by
--- the book, and it moves the same five things: the desk's stock, the desk's
--- Gold reserve, the item's `shop`/`player`/`escrow` buckets, the Gold
--- buckets, and the three rate-limit counters. No book fee is charged on a
--- house fill -- the desk's spread IS the charge, and taking a percentage on
--- top would bill the player twice for the same trade.
deskSettle = function(state, ledger, desk, order, price, units, timestamp)
  units = math.max(0, int(units, 0))
  if units <= 0 then return nil end
  local account = order.account
  local item = order.item
  local side = order.side
  local gross = price * units
  local asset = pool(state, item)
  local present = ledger.exists(account)
  if side == "buy" then
    if int(desk.stock, 0) < units then return nil end
    -- Gold: the taker committed `order.price` a unit into escrow, and the
    -- desk is charging `price`. The difference is price improvement and goes
    -- straight back, exactly as it does against a resting player order.
    local committed = int(order.price, 0) * units
    state.gold.escrow = math.max(0, int(state.gold.escrow, 0) - committed)
    local refund = committed - gross
    if refund > 0 and present then
      ledger.credit(account, "gold", refund)
      state.gold.player = int(state.gold.player, 0) + refund
    end
    local policyShare = (gross * int(state.policy.gold.shopBurnBps, 2500) + BPS - 1) // BPS
    if policyShare > gross then policyShare = gross end
    local reserveShare = gross - policyShare
    desk.goldReserve = int(desk.goldReserve, 0) + reserveShare
    state.gold.shop = int(state.gold.shop, 0) + reserveShare
    routeGoldFee(state, policyShare, timestamp, "NPC desk sale")
    -- Item: off the shelf and into the buyer's hands.
    asset.shop = math.max(0, int(asset.shop, 0) - units)
    asset.player = int(asset.player, 0) + units
    if present then ledger.credit(account, item, units) end
    desk.stock = math.max(0, int(desk.stock, 0) - units)
    desk.traded.sold = int(desk.traded.sold, 0) + units
    desk.traded.goldIn = int(desk.traded.goldIn, 0) + gross
  else
    if int(desk.goldReserve, 0) < gross then return nil end
    -- Item: out of the seller's escrow and onto the shelf.
    asset.escrow = math.max(0, int(asset.escrow, 0) - units)
    asset.shop = int(asset.shop, 0) + units
    desk.stock = int(desk.stock, 0) + units
    -- Gold: out of the desk's reserve and into the seller's balance.
    desk.goldReserve = int(desk.goldReserve, 0) - gross
    state.gold.shop = math.max(0, int(state.gold.shop, 0) - gross)
    if present then
      ledger.credit(account, "gold", gross)
      state.gold.player = int(state.gold.player, 0) + gross
    else
      state.gold.locked = int(state.gold.locked, 0) + gross
    end
    desk.traded.bought = int(desk.traded.bought, 0) + units
    desk.traded.goldOut = int(desk.traded.goldOut, 0) + gross
  end

  -- The same three counters `Economy.Shop.Trade` moves. A desk fill reached
  -- through the ladder has to consume them identically or the two paths drain
  -- one shelf twice.
  local accountUsage, globalUsage, epochUsage = usageRows(desk, account, timestamp)
  accountUsage[side] = int(accountUsage[side], 0) + units
  globalUsage[side] = int(globalUsage[side], 0) + units
  epochUsage.quantity = int(epochUsage.quantity, 0) + units

  order.remaining = int(order.remaining, 0) - units
  touchBook(state, item)
  state.fillSeq = int(state.fillSeq, 0) + 1
  local fill = {
    id = "F" .. string.format("%d", state.fillSeq), item = item,
    market = order.market or marketId(item, "gold"),
    buyOrder = side == "buy" and order.id or HOUSE,
    sellOrder = side == "sell" and order.id or HOUSE,
    buyer = side == "buy" and account or HOUSE,
    seller = side == "sell" and account or HOUSE,
    maker = HOUSE, taker = account,
    price = price, quantity = units, gross = gross, fee = 0,
    feePayer = HOUSE, feeAsset = "gold", house = true,
    filledAt = timestamp,
  }
  appendBounded(state.fills, fill, C.ECONOMY.orderbook.historyLimit)
  fillRecorded(state, fill)
  recordCandle(marketDay(state, timestamp, item), price, units, gross, nil, account)
  if int(order.remaining, 0) <= 0 and state.orders[order.id] then
    dropOrder(state, order)
    appendBounded(state.orderHistory, {
      id = order.id, account = account, item = item, side = side,
      market = order.market or marketId(item, "gold"),
      price = order.price, quantity = order.quantity, remaining = 0,
      status = "filled", closedAt = timestamp,
    }, C.ECONOMY.orderbook.historyLimit)
  end
  return fill
end

function M.shopTrade(state, players, withdrawals, deposits, account, item, side, quantity, timestamp, actionId)
  state = M.ensureState(state)
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "shop.trade")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId }, nil end
  side = tostring(side or ""):lower()
  quantity = int(quantity, 0)
  local desk = state.desks[item or ""]
  local player = players[account]
  local problem = nil
  if not desk then problem = "There is no NPC desk for that item"
  elseif not player then problem = "No such player"
  elseif side ~= "buy" and side ~= "sell" then problem = "Side must be buy or sell"
  elseif quantity <= 0 then problem = "Quantity must be positive"
  elseif quantity > int(desk.limits.perAction, 0) then problem = "Per-action quantity limit reached" end
  if not problem and side == "sell" and player.pass
     and int(player.pass.recoveryCooldownUntil, 0) > timestamp then
    problem = "Account recovery cooldown pauses NPC selling"
  end
  if not problem then problem = shopPauseReason(state, desk, side, withdrawals, deposits, timestamp) end
  if problem then recordRejected(state, problem); return nil, problem end

  local accountUsage, globalUsage, epochUsage = usageRows(desk, account, timestamp)
  local matureLimit = math.max(1,
    (int(desk.limits.perAccount, 0) * maturityBps(state, player, timestamp)) // BPS)
  if int(accountUsage[side], 0) + quantity > matureLimit then
    problem = "Per-account 20-hour quantity limit reached"
  elseif int(globalUsage[side], 0) + quantity > int(desk.limits.global, 0) then
    problem = "Global 20-hour quantity limit reached"
  end
  local epochLimit = epochFlowLimit(state, desk)
  if not problem and int(epochUsage.quantity, 0) + quantity > epochLimit then
    problem = "Policy-epoch supply-flow limit reached"
  end
  if not problem and side == "sell" and inventory(player, item) < quantity then
    problem = "Not enough " .. item
  end

  -- Price every unit against the stock that will exist immediately before it.
  -- This simulation performs no writes; a refused batch is therefore a true
  -- no-op, and splitting it into separate messages produces the same path.
  local cap = deskCap(state, desk)
  local stock = int(desk.stock, 0)
  local gross, units = 0, {}
  if not problem then
    for index = 1, quantity do
      if side == "sell" and stock >= cap then problem = "Shop stock cap reached" break end
      if side == "buy" and stock <= 0 then problem = "Desk is out of stock" break end
      local band, bandIndex = deskBand(desk, cap, stock)
      if not band then problem = "No price band is available" break end
      local price = anchoredPrice(desk, side == "sell" and band.bid or band.ask,
        side == "sell" and "bid" or "ask")
      if side == "sell" and gross + price > int(desk.goldReserve, 0) then
        problem = "Desk Gold reserve exhausted" break
      end
      gross = gross + price
      units[#units + 1] = { price = price, band = bandIndex, stock = stock }
      stock = stock + (side == "sell" and 1 or -1)
    end
  end
  if not problem and side == "buy" and playerGold(player) < gross then
    problem = "Not enough Gold"
  end
  if problem then recordRejected(state, problem); return nil, problem end

  rememberAction(state, receiptKey, "shop.trade", timestamp)
  local asset = state.assets[item]
  if side == "sell" then
    takeItem(player, item, quantity)
    asset.player = math.max(0, int(asset.player, 0) - quantity)
    asset.shop = int(asset.shop, 0) + quantity
    desk.stock = int(desk.stock, 0) + quantity
    state.gold.shop = math.max(0, int(state.gold.shop, 0) - gross)
    desk.goldReserve = int(desk.goldReserve, 0) - gross
    creditGold(state, player, gross)
    desk.traded.bought = int(desk.traded.bought, 0) + quantity
    desk.traded.goldOut = int(desk.traded.goldOut, 0) + gross
  else
    debitGold(state, player, gross)
    asset.shop = math.max(0, int(asset.shop, 0) - quantity)
    asset.player = int(asset.player, 0) + quantity
    giveItem(player, item, quantity)
    desk.stock = math.max(0, int(desk.stock, 0) - quantity)
    local policyShare = (gross * int(state.policy.gold.shopBurnBps, 2500) + BPS - 1) // BPS
    if policyShare > gross then policyShare = gross end
    local reserveShare = gross - policyShare
    desk.goldReserve = int(desk.goldReserve, 0) + reserveShare
    state.gold.shop = int(state.gold.shop, 0) + reserveShare
    routeGoldFee(state, policyShare, timestamp, "NPC shop sale")
    desk.traded.sold = int(desk.traded.sold, 0) + quantity
    desk.traded.goldIn = int(desk.traded.goldIn, 0) + gross
  end
  accountUsage[side] = int(accountUsage[side], 0) + quantity
  globalUsage[side] = int(globalUsage[side], 0) + quantity
  epochUsage.quantity = int(epochUsage.quantity, 0) + quantity
  return {
    item = item, side = side, quantity = quantity, total = gross,
    average = gross // quantity, units = units,
    stock = desk.stock, goldReserve = desk.goldReserve,
  }, nil
end

local function rollingAsset(row, timestamp, days)
  local current = timestamp // DAY
  local issued, consumed = 0, 0
  for day, values in pairs(row.daily or {}) do
    local age = current - int(day, current)
    if age >= 0 and age < days then
      issued = issued + int(values.issued, 0)
      consumed = consumed + int(values.consumed, 0)
    end
  end
  return { issued = issued, consumed = consumed }
end


local function marketStats(state, timestamp, item, withdrawals, deposits)
  local bidLevels, askLevels = {}, {}
  local level = function(levels, price)
    local row = levels[price]
    if not row then row = { quantity = 0, orders = 0, house = 0 }; levels[price] = row end
    return row
  end
  -- The player side of the ladder, cached against this market's revision.
  -- Expired orders are not liquidity and are not in it: the index took them
  -- out when the clock passed them, so a ladder can no longer advertise a
  -- price nobody is allowed to trade at.
  local top = p2pLadder(state, timestamp, item)
  local bestBid, bestAsk = top.bestBid, top.bestAsk
  for _, row in ipairs(top.bids) do
    local target = level(bidLevels, row.price)
    target.quantity = row.quantity; target.orders = row.orders
  end
  for _, row in ipairs(top.asks) do
    local target = level(askLevels, row.price)
    target.quantity = row.quantity; target.orders = row.orders
  end
  -- The house, in the same ladder. Two tabs and two prices is a venue that
  -- asks the player to arbitrage it; one ladder with the desk in it is a
  -- market. The corridor then enforces itself, because a taker gets whichever
  -- of desk-or-P2P is better without having to know there is a choice.
  local houseP2P = { bid = bestBid, ask = bestAsk }
  local stub = {}
  local houseBid = deskQuote(state, stub, item, "sell", nil, timestamp, withdrawals, deposits)
  local houseAsk = deskQuote(state, stub, item, "buy", nil, timestamp, withdrawals, deposits)
  for _, quote in ipairs({ houseBid, houseAsk }) do
    if quote then
      local levels = quote.side == "sell" and bidLevels or askLevels
      for _, row in ipairs(quote.levels) do
        local target = level(levels, row.price)
        target.quantity = target.quantity + int(row.units, 0)
        target.house = target.house + int(row.units, 0)
      end
      if quote.side == "sell" then
        for _, row in ipairs(quote.levels) do
          if not bestBid or row.price > bestBid then bestBid = row.price end
        end
      else
        for _, row in ipairs(quote.levels) do
          if not bestAsk or row.price < bestAsk then bestAsk = row.price end
        end
      end
    end
  end
  local bids = ladder(bidLevels, true, 10)
  local asks = ladder(askLevels, false, 10)
  -- `median` sorts what it is given, so the digest's own lists are handed over
  -- as copies. They are shared with every other market's view of this call.
  local digest = fillDigest(state, timestamp)[item] or EMPTY_DIGEST
  local prices7, prices30 = copy(digest.prices7), copy(digest.prices30)
  local volume24, volume7 = digest.volume24, digest.volume7
  local makers, takers = digest.makers, digest.takers
  return {
    bestBid = bestBid, bestAsk = bestAsk,
    -- What the players alone are quoting. The invariant in ORDERBOOK.md §9 is
    -- stated over these two: while the P2P best sits inside the desk's band
    -- the desk is never the best price on either side, and the moment P2P
    -- leaves the band it is. Publishing both halves is what lets a client --
    -- or a test -- check that rather than take it on trust.
    p2pBid = houseP2P.bid, p2pAsk = houseP2P.ask,
    houseBid = houseBid and houseBid.levels[1] and houseBid.levels[1].price or nil,
    houseAsk = houseAsk and houseAsk.levels[1] and houseAsk.levels[1].price or nil,
    houseBidUnits = houseBid and houseBid.units or 0,
    houseAskUnits = houseAsk and houseAsk.units or 0,
    band = bandView(economyHost(state, nil), state, item, timestamp),
    depth = { bids = bids, asks = asks },
    volume24h = volume24, volume7d = volume7,
    median7d = median(prices7), median30d = median(prices30),
    medianSamples7d = #prices7, medianSamples30d = #prices30,
    uniqueMakers7d = countMap(makers), uniqueTakers7d = countMap(takers),
  }
end


function M.invariants(state, withdrawals, deposits)
  state = M.ensureState(state)
  local goldOk, goldExpected, goldAccounted = goldInvariant(state)
  local assets, okay = {}, goldOk
  for _, item in ipairs(ITEM_IDS) do
    local valid, expected, accounted = itemInvariant(state, item)
    -- Rune's external/pending buckets are reconciled separately below.
    if item == "rune" then valid = true end
    assets[item] = { ok = valid, expected = expected, accounted = accounted,
      difference = expected - accounted }
    if not valid then okay = false end
  end
  local boxes = {}
  for rarity = 1, C.MAX_LOOT_RARITY do
    local row = state.lootboxes[rarity]
    local expected = int(row.issued, 0) - int(row.consumed, 0)
    local accounted = int(row.player, 0)
    boxes[rarity] = { ok = expected == accounted, expected = expected,
      accounted = accounted, difference = expected - accounted }
    if expected ~= accounted then okay = false end
  end
  local rune = runeReconciliation(state, withdrawals, deposits)
  if rune.difference ~= nil and rune.difference ~= 0 then okay = false end
  return {
    ok = okay,
    gold = { ok = goldOk, expected = goldExpected, accounted = goldAccounted,
      difference = goldExpected - goldAccounted },
    assets = assets, lootboxes = boxes, rune = rune,
  }
end

--- THE ECONOMY IS PUBLISHED AS TWO KEYS, AND THE SPLIT IS A COST DECISION.
---
--- `flowView` is the FLOW half: the ledgers, the loot boxes, the Gold totals,
--- the emission figures, the policy record and the invariants. Every gameplay
--- verb moves one of those -- eating a berry consumes one berry, and the item
--- invariant is stated over exactly that -- so it is republished on every one
--- of the twenty-six verbs in `ECONOMY_DIRTY`.
---
--- `bookView` is the ORDERBOOK half: the ladders, the candles, the NPC desks,
--- the resting orders, the fill ring, the market registry and the rejection
--- tally. None of it can move unless an order was placed, amended, cancelled,
--- filled or expired, or a desk was traded against or reconfigured -- and none
--- of the twenty-six gameplay verbs can do any of that.
---
--- `policy` and `invariants` are on the FLOW side even though a trader reads
--- them, and that is the conservative half of this split rather than an
--- oversight. Both are moved by ordinary play: a daily claim pays out of
--- `policy.runeRewards` and re-counts `policy.gold.candidateQualifiedActive`,
--- and every item that is issued or consumed changes `invariants.assets`.
--- Putting them on the book side would have meant enumerating every verb that
--- can reach `state.policy`, and being wrong about one of those publishes a
--- stale reserve balance rather than costing an encode.
---
--- They were published as one 12 kB key, so feeding a companion rebuilt seven
--- price ladders, seven candle series, every desk quote and a copy of the whole
--- policy record in order to say that one berry had been eaten. Measured on a
--- live `~lua@5.3a` at fifty players: 94 ms of a 277 ms `Monster.Feed`, of
--- which 75.8 ms was this half.
---
--- Splitting the KEY rather than caching the TABLE is deliberate. Roughly half
--- that cost is `encode`, and a cached Lua table still has to be encoded into
--- the key beside the flow figures; only a key that is not written at all skips
--- both. Note what this does NOT buy: the published map is the same size, so
--- the node still loads, encodes, decodes and writes the same bytes five times
--- per slot (see CLAUDE.md). This is a Luerl CPU saving and nothing else.
---
--- `publicView` is still the WHOLE object and is what a signed `Economy.View`,
--- the admin snapshot and every test read. Only the published keys are split,
--- and `readEconomy` in `lib/game.ts` fetches both and merges them, so nothing
--- downstream of it knows the split happened either.
function M.flowView(state, withdrawals, deposits, timestamp)
  state = M.ensureState(state)
  -- Refresh the derived emission figures before publishing them.
  --
  -- They are recomputed on every claim, but a process nobody has claimed on yet
  -- would publish the zeros it was initialised with -- which is exactly the
  -- "the faucet is broken" reading this whole change exists to remove. The
  -- schedule has an answer at every instant; publish that answer.
  do
    local budget = M.emissionBudget(state, timestamp)
    local policy = state.policy.runeRewards
    policy.epochBudget = budget
    -- v2: derived from the per-account rate, matching what `claimRuneReward`
    -- actually pays. Dividing the budget by a population here published a
    -- floor of 500 while the claim path paid something else entirely.
    local perCapita = M.emissionPerAccount(state, timestamp)
    policy.emissionPerAccount = perCapita
    policy.newcomerFloor =
      (perCapita * int((C.ECONOMY.rune or {}).newcomerFloorBps, 2500)) // BPS
  end
  local assets = {}
  for _, item in ipairs(ITEM_IDS) do
    local row = state.assets[item]
    assets[item] = {
      issued = row.issued, consumed = row.consumed, player = row.player,
      escrow = row.escrow, shop = row.shop,
      rolling7d = rollingAsset(row, timestamp, 7),
      rolling30d = rollingAsset(row, timestamp, 30),
      sources = copy(row.sources), sinks = copy(row.sinks),
    }
  end
  local boxes = {}
  for rarity = 1, C.MAX_LOOT_RARITY do
    local row = state.lootboxes[rarity]
    boxes[rarity] = {
      issued = row.issued, opened = row.consumed, held = row.player,
      rolling7d = rollingAsset(row, timestamp, 7),
      rolling30d = rollingAsset(row, timestamp, 30),
      sources = copy(row.sources),
    }
  end
  local gold = state.gold
  return {
    version = state.version, mode = state.mode, generatedAt = timestamp,
    invariants = M.invariants(state, withdrawals, deposits),
    gold = {
      issued = gold.issued, burned = gold.burned,
      outstanding = outstandingGold(state), authorized = gold.authorized,
      ceiling = gold.ceiling, player = gold.player, escrow = gold.escrow,
      shop = gold.shop, locked = gold.locked, target = goldTarget(state),
      perQualifiedPlayer = state.policy.gold.perQualifiedPlayer,
      qualifiedActive = state.policy.gold.qualifiedActive,
      candidateQualifiedActive = state.policy.gold.candidateQualifiedActive,
      rolling7d = rollingAsset({ daily = gold.daily }, timestamp, 7),
      rolling30d = rollingAsset({ daily = gold.daily }, timestamp, 30),
    },
    assets = assets, lootboxes = boxes,
    policy = copy(state.policy), passQuote = M.passQuote(state),
  }
end

--- The orderbook half. See the note on `publicView` for why it is a key of its
--- own; everything here moves only when an order or a desk does.
---
--- `version`, `mode` and `generatedAt` are repeated on purpose. The two keys
--- are fetched independently and can be one slot apart, and a reader that
--- merges them needs to be able to see that rather than infer it.
function M.bookView(state, withdrawals, deposits, timestamp)
  state = M.ensureState(state)
  local markets = {}
  local candles = {}
  for _, item in ipairs(ITEM_IDS) do
    markets[item] = marketStats(state, timestamp, item, withdrawals, deposits)
    local bars = candleView(state, timestamp, item)
    if #bars > 0 then candles[item] = bars end
  end
  local desks = {}
  for item, desk in pairs(state.desks) do
    local cap = deskCap(state, desk)
    local band, bandIndex = deskBand(desk, cap, desk.stock)
    local bid = band and anchoredPrice(desk, band.bid, "bid") or nil
    local ask = band and anchoredPrice(desk, band.ask, "ask") or nil
    desks[item] = {
      item = item, stock = desk.stock, stockCap = cap,
      goldReserve = desk.goldReserve, anchorBps = desk.anchorBps,
      bidBps = desk.bidBps, askBps = desk.askBps, stockBps = desk.stockBps,
      band = bandIndex, bid = bid, ask = ask, limits = copy(desk.limits),
      enabled = copy(desk.enabled),
      pause = {
        buy = shopPauseReason(state, desk, "buy", withdrawals, deposits, timestamp),
        sell = shopPauseReason(state, desk, "sell", withdrawals, deposits, timestamp),
      },
      projectedExhaustion = bid and bid > 0 and (desk.goldReserve // bid) or 0,
      traded = copy(desk.traded),
    }
  end
  return {
    version = state.version, mode = state.mode, generatedAt = timestamp,
    markets = copy(state.markets), orders = orderView(state),
    fills = copy(state.fills), market = markets, candles = candles, desks = desks,
    rejected = copy(state.rejected),
  }
end

--- A cheap statement of "has anything in `bookView` moved".
---
--- Every book carries a revision that `indexAdd`/`indexDrop` bump, and the
--- index carries one for the fill ring -- so seven integers and a counter say
--- whether a ladder, a resting order, a candle or a trade has changed since the
--- last time the key was written. Expiries are in it as well, because
--- `reconcile` drops an expired order through `indexDrop` like any other.
---
--- The publisher gates on this OR on `market` being dirty. The revision alone
--- would miss a desk that was traded against or reconfigured (a desk has no
--- revision of its own) and the market registry; `dirty.market` alone would
--- miss an order that expired on the clock during an unrelated message. Either
--- one firing costs one encode, and only both being wrong could publish a stale
--- book.
function M.bookRevision(state, timestamp)
  state = M.ensureState(state)
  local index = bookIndex(state, timestamp)
  local parts = { int(index.fillsRev, 0), int(index.open, 0) }
  for _, item in ipairs(ITEM_IDS) do
    local book = index.books[item]
    parts[#parts + 1] = book and int(book.rev, 0) or -1
  end
  return table.concat(parts, ".")
end

--- Both halves as one object, which is what every reader outside the published
--- keys wants. `bookView` last so the shared `version`/`mode`/`generatedAt`
--- come from the same call that produced the book -- they are equal either way,
--- and saying which one won is better than leaving it to table iteration.
function M.publicView(state, withdrawals, deposits, timestamp)
  state = M.ensureState(state)
  local view = M.flowView(state, withdrawals, deposits, timestamp)
  for field, value in pairs(M.bookView(state, withdrawals, deposits, timestamp)) do
    view[field] = value
  end
  return view
end

pushHistory = function(state, entry)
  appendBounded(state.policy.history, entry, 200)
end

function M.emergencyPause(state, actor, reason, timestamp)
  state = M.ensureState(state)
  if type(reason) ~= "string" or reason == "" then return nil, "A pause reason is required" end
  state.policy.emergency = { paused = true, reason = reason, at = timestamp, actor = actor }
  pushHistory(state, { action = "emergency-pause", actor = actor, reason = reason,
    timestamp = timestamp })
  return copy(state.policy.emergency), nil
end

function M.observeRuneSupply(state, actor, supply, timestamp, reason)
  state = M.ensureState(state)
  -- The token reports ATOMS; everything in this engine counts whole Rune.
  -- Normalise at the boundary rather than at every comparison, so there is
  -- exactly one unit inside.
  --
  -- Refusing a non-whole supply is safe rather than strict: total supply only
  -- moves through `Mint` and `Burn`, both of which the token refuses unless
  -- the amount is a whole multiple of a Rune. Transfers move balances between
  -- holders and never change the total. So a fractional total supply is not a
  -- number the token can legitimately produce, and reading one back means the
  -- two processes disagree about the denomination -- which is exactly the
  -- condition reconciliation exists to catch, and must not be rounded away.
  local atoms = int(supply, -1)
  if atoms < 0 then return nil, "Rune token supply must be a non-negative integer" end
  local units = C.ECONOMY.runeUnits
  if atoms % units ~= 0 then
    return nil, "Rune token supply is not a whole number of Rune: "
      .. string.format("%d", atoms) .. " atoms against " .. string.format("%d", units)
      .. " to a Rune. Check the token's Denomination."
  end
  local supplyUnits = atoms // units
  state.policy.externalRuneSupply = supplyUnits
  state.policy.externalRuneObservedAt = timestamp
  pushHistory(state, { action = "rune-supply-observed", actor = actor,
    value = supplyUnits, atoms = atoms,
    reason = reason or "token reconciliation", timestamp = timestamp })
  return supplyUnits, nil
end

local ALLOWED_CHANGES = {
  ["gold.perQualifiedPlayer"] = { delay = true, min = 0, max = 1000000 },
  ["gold.normalWeeklyReleaseBps"] = { delay = true, min = 0,
    max = C.ECONOMY.gold.contractWeeklyReleaseBps },
  ["gold.shopBurnBps"] = { delay = true, min = 0, max = 9000 },
  ["gold.burnBelowTargetBps"] = { delay = true, min = 5000, max = 10000 },
  ["gold.burnAboveTargetBps"] = { delay = true, min = 10000, max = 20000 },
  ["gold.expansionEnabled"] = { delay = true, boolean = true },
  ["emergency.paused"] = { delay = true, boolean = true },
  ["qualification.enabled"] = { delay = true, boolean = true },
  -- An operator brake for an incident, not the emission setting. Halting also
  -- requires `runeRewards.haltedByOperator`, so a stale `enabled = false`
  -- inherited from a pre-schedule export cannot silently keep the faucet shut.
  ["runeRewards.enabled"] = { delay = true, boolean = true },
  ["runeRewards.haltedByOperator"] = { delay = true, boolean = true },
  ["runeRewards.bondEnabled"] = { delay = true, boolean = true },
  ["runeRewards.bondAmount"] = { delay = true, min = 0, max = 1000000 },
  ["runeRewards.unbondDelay"] = { delay = true, min = DAY, max = 365 * DAY },
  ["passes.launchPriceReference"] = { delay = true, min = 1, max = 1000000000 },
  ["passes.monthlySubsidyReference"] = { delay = true, min = 0, max = 1000000000 },
}

local function policyParent(state, path)
  local group, field = string.match(path or "", "^([%w]+)%.([%w]+)$")
  if not group or not state.policy[group] then return nil, nil end
  return state.policy[group], field
end

local function validateChange(state, path, value)
  if path == "proceeds.split" then
    if type(value) ~= "table" then return nil, nil, "Proceeds split must be an object" end
    local parsed = {
      teamBps = int(value.teamBps, -1),
      runeBps = int(value.runeBps, -1),
      treasuryBps = int(value.treasuryBps, -1),
    }
    if parsed.teamBps < 0 or parsed.runeBps < 0 or parsed.treasuryBps < 0
       or parsed.teamBps + parsed.runeBps + parsed.treasuryBps ~= BPS then
      return nil, nil, "Proceeds allocations must be non-negative and total 10000 basis points"
    end
    return state.policy, "proceeds", nil, parsed
  end
  local rule = ALLOWED_CHANGES[path]
  local parent, field = policyParent(state, path)
  if not rule then
    local item, deskField = string.match(path or "", "^desks%.([%w_]+)%.([%w_]+)$")
    local desk = item and state.desks[item] or nil
    if desk then
      local rules = {
        anchorBps = { min = 1000, max = 100000, rateLimited = true },
        bidBps = { min = 1000, max = 100000, rateLimited = true },
        askBps = { min = 1000, max = 100000, rateLimited = true },
        stockBps = { min = 1, max = 5000 },
        stockMax = { min = 1, max = 1000000 },
        goldReserve = { min = 0, max = int(state.gold.issued, 0) },
        reliableSupply = { boolean = true },
      }
      rule = rules[deskField]
      parent, field = desk, deskField
    end
  end
  if not rule then
    local item, limit = string.match(path or "", "^desks%.([%w_]+)%.limits%.([%w_]+)$")
    local desk = item and state.desks[item] or nil
    local rules = {
      perAction = { min = 1, max = 1000000 },
      perAccount = { min = 1, max = 10000000 },
      global = { min = 1, max = 100000000 },
    }
    if desk and rules[limit] then rule = rules[limit]; parent, field = desk.limits, limit end
  end
  if not rule then
    local item, side = string.match(path or "", "^desks%.([%w_]+)%.enabled%.([%w_]+)$")
    local desk = item and state.desks[item] or nil
    if desk and (side == "buy" or side == "sell") then
      rule = { boolean = true }; parent, field = desk.enabled, side
    end
  end
  if not rule or not parent then return nil, nil, "That policy dial is not editable" end
  if rule.boolean then
    if value ~= true and value ~= false then return nil, nil, "Policy value must be boolean" end
  else
    value = int(value, rule.min)
    if value < rule.min or value > rule.max then return nil, nil, "Policy value is outside its hard rail" end
    if rule.rateLimited then
      local old = int(parent[field], BPS)
      local maxMove = math.max(1, (old * C.ECONOMY.shop.anchorWeeklyBps) // BPS)
      if math.abs(value - old) > maxMove then
        return nil, nil, "Normal quote movement is capped at 5% per seven days"
      end
    end
  end
  if string.find(path or "", "%.bidBps$") or string.find(path or "", "%.askBps$") then
    local item = string.match(path, "^desks%.([%w_]+)%.")
    local candidate = copy(state.desks[item])
    candidate[field] = value
    for _, band in ipairs(candidate.prices or {}) do
      if anchoredPrice(candidate, band.bid, "bid") >= anchoredPrice(candidate, band.ask, "ask") then
        return nil, nil, "Every NPC bid must remain below its ask"
      end
    end
  end
  return parent, field, nil, value
end

function M.previewPolicy(state, path, value, timestamp)
  state = M.ensureState(state)
  local parent, field, problem, parsed = validateChange(state, path, value)
  if problem then return nil, problem end
  local simulated = copy(state)
  local simulatedParent, simulatedField, simulatedProblem = validateChange(simulated, path, parsed)
  if simulatedProblem then return nil, simulatedProblem end
  if path == "gold.burnBelowTargetBps"
     and parsed >= int(state.policy.gold.burnAboveTargetBps, 11000) then
    return nil, "The lower target corridor must remain below the upper corridor"
  end
  if path == "gold.burnAboveTargetBps"
     and parsed <= int(state.policy.gold.burnBelowTargetBps, 9000) then
    return nil, "The upper target corridor must remain above the lower corridor"
  end
  simulatedParent[simulatedField] = parsed
  if string.find(path, "%.goldReserve$") then
    local delta = parsed - int(parent[field], 0)
    if delta > int(state.gold.locked, 0) then
      return nil, "Locked policy reserve cannot fund that desk allocation"
    end
    simulated.gold.locked = int(simulated.gold.locked, 0) - delta
    simulated.gold.shop = int(simulated.gold.shop, 0) + delta
  end
  local deskItem = string.match(path, "^desks%.([%w_]+)%.")
  local deskBefore = deskItem and state.desks[deskItem] or nil
  local deskAfter = deskItem and simulated.desks[deskItem] or nil
  return {
    path = path, oldValue = parent[field], newValue = parsed,
    effectiveAt = timestamp + C.ECONOMY.shop.policyDelay,
    effect = {
      goldTargetBefore = goldTarget(state),
      goldTargetAfter = goldTarget(simulated),
      outstandingGold = outstandingGold(state),
      qualificationEnabledBefore = state.policy.qualification.enabled,
      qualificationEnabledAfter = simulated.policy.qualification.enabled,
      runeEpochBudgetBefore = state.policy.runeRewards.epochBudget,
      runeEpochBudgetAfter = simulated.policy.runeRewards.epochBudget,
      proceedsBefore = copy(state.policy.proceeds),
      proceedsAfter = copy(simulated.policy.proceeds),
      deskStock = deskBefore and deskBefore.stock or nil,
      deskGoldBefore = deskBefore and deskBefore.goldReserve or nil,
      deskGoldAfter = deskAfter and deskAfter.goldReserve or nil,
      deskCapBefore = deskBefore and deskCap(state, deskBefore) or nil,
      deskCapAfter = deskAfter and deskCap(simulated, deskAfter) or nil,
    },
  }, nil
end

function M.proposePolicy(state, actor, path, value, reason, timestamp)
  state = M.ensureState(state)
  if type(reason) ~= "string" or reason == "" then return nil, "A stated reason is required" end
  local parent, field, problem, parsed = validateChange(state, path, value)
  if problem then return nil, problem end
  state.policy.changeSeq = int(state.policy.changeSeq, 0) + 1
  local row = {
    id = "P" .. string.format("%d", state.policy.changeSeq), path = path,
    oldValue = parent[field], newValue = parsed, actor = actor, reason = reason,
    proposedAt = timestamp, effectiveAt = timestamp + C.ECONOMY.shop.policyDelay,
    status = "pending",
  }
  state.policy.pending[row.id] = row
  pushHistory(state, copy(row))
  return copy(row), nil
end

function M.applyPolicy(state, actor, changeId, timestamp)
  state = M.ensureState(state)
  local row = state.policy.pending[changeId or ""]
  if not row then return nil, "No such pending policy change" end
  if timestamp < int(row.effectiveAt, 0) then return nil, "Policy delay has not elapsed" end
  local parent, field, problem, parsed = validateChange(state, row.path, row.newValue)
  if problem then return nil, problem end
  if row.path == "gold.burnBelowTargetBps"
     and parsed >= int(state.policy.gold.burnAboveTargetBps, 11000) then
    return nil, "The lower target corridor must remain below the upper corridor"
  end
  if row.path == "gold.burnAboveTargetBps"
     and parsed <= int(state.policy.gold.burnBelowTargetBps, 9000) then
    return nil, "The upper target corridor must remain above the lower corridor"
  end
  if string.find(row.path, "%.goldReserve$") then
    local delta = parsed - int(parent[field], 0)
    if delta > int(state.gold.locked, 0) then return nil, "Locked policy reserve cannot fund that desk allocation" end
    state.gold.locked = int(state.gold.locked, 0) - delta
    state.gold.shop = int(state.gold.shop, 0) + delta
  end
  parent[field] = parsed
  local item, side = string.match(row.path, "^desks%.([%w_]+)%.enabled%.([%w_]+)$")
  if item and side and parsed == true then state.desks[item].manualPause[side] = nil end
  if row.path == "emergency.paused" and parsed == false then
    state.policy.emergency.reason = nil
    state.policy.emergency.at = timestamp
  end
  row.status = "applied"; row.appliedAt = timestamp; row.appliedBy = actor
  state.policy.pending[row.id] = nil
  pushHistory(state, copy(row))
  return copy(row), nil
end

function M.setDeskPause(state, actor, item, side, paused, reason, timestamp)
  state = M.ensureState(state)
  local desk = state.desks[item or ""]
  if not desk then return nil, "No such shop desk" end
  if side ~= "buy" and side ~= "sell" then return nil, "Side must be buy or sell" end
  if paused ~= true then return nil, "Resuming a desk must use a delayed policy change" end
  if type(reason) ~= "string" or reason == "" then return nil, "A pause reason is required" end
  desk.manualPause[side] = reason
  pushHistory(state, { action = "desk-pause", item = item, side = side,
    actor = actor, reason = reason, timestamp = timestamp })
  return { item = item, side = side, paused = true, reason = reason }, nil
end

function M.observeGoldPolicy(state, actor, reason, timestamp)
  state = M.ensureState(state)
  if not state.policy.qualification.enabled then
    return nil, "Qualified-player policy is disabled"
  end
  candidateQualified(state, timestamp)
  local policy = state.policy.gold
  local last = int(policy.lastObservationAt, 0)
  if last > 0 and timestamp < last + 7 * DAY then
    return nil, "Gold target may be observed only once per seven days"
  end
  local target = goldTarget(state)
  if target > int(state.gold.authorized, 0) then
    policy.persistentHigherObservations = int(policy.persistentHigherObservations, 0) + 1
  else
    policy.persistentHigherObservations = 0
  end
  policy.lastObservationAt = timestamp
  local authorizedBefore = int(state.gold.authorized, 0)
  if policy.expansionEnabled and int(policy.persistentHigherObservations, 0) >= 2 then
    state.gold.authorized = math.min(int(state.gold.ceiling, 0),
      math.max(int(state.gold.authorized, 0), target))
  end
  local row = {
    action = "gold-target-observation", actor = actor, reason = reason,
    timestamp = timestamp, target = target,
    qualifiedActive = policy.qualifiedActive,
    observations = policy.persistentHigherObservations,
    authorizedBefore = authorizedBefore, authorizedAfter = state.gold.authorized,
  }
  pushHistory(state, row)
  return copy(row), nil
end

function M.releaseGold(state, actor, item, amount, reason, timestamp)
  state = M.ensureState(state)
  local desk = state.desks[item or ""]
  amount = int(amount, 0)
  if not state.policy.gold.expansionEnabled then return nil, "Gold expansion policy is disabled" end
  if not desk then return nil, "No such shop desk" end
  if amount <= 0 then return nil, "Release amount must be positive" end
  if type(reason) ~= "string" or reason == "" then return nil, "A stated reason is required" end
  local gold = state.gold
  local window = timestamp // (7 * DAY)
  if int(state.policy.gold.releaseWindow, -1) ~= window then
    state.policy.gold.releaseWindow = window
    state.policy.gold.releasedInWindow = 0
  end
  local normalLimit = (outstandingGold(state) * int(state.policy.gold.normalWeeklyReleaseBps, 0)) // BPS
  local contractLimit = (outstandingGold(state) * C.ECONOMY.gold.contractWeeklyReleaseBps) // BPS
  local limit = math.min(normalLimit, contractLimit)
  if int(state.policy.gold.releasedInWindow, 0) + amount > limit then
    return nil, "Weekly Gold release limit exceeded"
  end
  if int(gold.issued, 0) + amount > int(gold.authorized, 0) then
    return nil, "Gold has not been authorized"
  end
  if int(gold.issued, 0) + amount > int(gold.ceiling, 0) then
    return nil, "Gold protocol ceiling exceeded"
  end
  gold.issued = int(gold.issued, 0) + amount
  gold.shop = int(gold.shop, 0) + amount
  desk.goldReserve = int(desk.goldReserve, 0) + amount
  state.policy.gold.releasedInWindow = int(state.policy.gold.releasedInWindow, 0) + amount
  local today = dailyRow(gold.daily, timestamp)
  today.issued = int(today.issued, 0) + amount
  pushHistory(state, { action = "gold-release", item = item, amount = amount,
    actor = actor, reason = reason, timestamp = timestamp })
  return { item = item, amount = amount, issued = gold.issued,
    reserve = desk.goldReserve }, nil
end

--- The index is DERIVED and is never exported.
---
--- It is a second copy of the book in a different arrangement: exporting it
--- would double what an `Admin.Load` carries and what a migration writes, for
--- something `rebuildIndex` reconstructs from the orders in the same export.
--- The rule is the same one `publicView` follows, and it is what allows the
--- index to exist at all -- see the note on `dev_lua` in CLAUDE.md.
function M.exportState(state, opts)
  local out = copy(M.ensureState(state))
  out.bookIndex = nil
  -- The self-heal RESTORE export (published every slot the ledger moves) drops
  -- per-account qualification telemetry. `activity` is O(WALLETS) -- a 200-entry
  -- `runeFlow` plus a day set per account that ever traded Rune -- and a key
  -- that grows with the player count makes every action slower for everyone
  -- (the published-map rule in CLAUDE.md). It is also for a feature that is
  -- DISABLED, it carries no custody and no invariant, and it rebuilds itself
  -- from subsequent actions -- so restoring it is worth nothing and publishing
  -- it every slot is the exact per-wallet tax to avoid. `ensureState` defaults
  -- it back to `{}` on the way in. `Admin.Export`/`Admin.Load` (no opts) keep
  -- it, because a migration is a bulk one-off, not a per-slot publication.
  -- Emptied, not removed: `ensureState` only re-defaults `activity` during the
  -- one-time V1 migration, so an already-migrated state that came back WITHOUT
  -- the field would keep it nil and the qualification code would index nil. An
  -- empty table is O(1), survives the round-trip, and rebuilds from actions.
  if opts and opts.forRestore then
    out.activity = {}
    -- HISTORY IS NOT CUSTODY, AND IT IS ALREADY PUBLISHED ELSEWHERE.
    --
    -- `fills` and `rejected` are copied verbatim into `bookView` -- the
    -- `economybook` key the trading floor reads -- so carrying them here too
    -- publishes the same 87 KB twice, and CLAUDE.md's cost model charges the
    -- WHOLE published map to every message five times over. `orderHistory` is
    -- closed-order history that nothing reconstructs state from.
    --
    -- Dropping them is safe for identity: `fillSeq`/`orderSeq` are stored
    -- top-level and incremented monotonically, and the one place a sequence is
    -- re-derived from a list (`highestId(state.fills, "F")`) runs only in the
    -- `normalisedVersion < 2` migration, which an export at version 5 skips.
    --
    -- And it does not take anything away, because the heal restores the ring
    -- from `economybook` -- see `M.restoreHistory` and the guard in `game.lua`.
    -- Beyond that ring the node holds every slot, so a computed slot IS the
    -- history: `compute&slot=N` for a slot the head has reached is a cache hit.
    out.fills = {}
    out.orderHistory = {}
    out.rejected = {}
    -- A DERIVED INDEX, never exported -- the same rule `bookIndex` follows one
    -- function above. `actionReceiptOrder` is FIFO eviction order over
    -- `actionReceipts`, 485 keys of it measured at 30,531 bytes, and every one
    -- of those keys is already in the map it orders. `importState` rebuilds it.
    out.actionReceiptOrder = {}
  end
  return out
end

--- Put the trade ring back after a heal, from the view that still has it.
---
--- The restore export drops `fills`/`rejected` because `bookView` publishes
--- them; this is the other half of that trade. Called with the decoded
--- `economybook` when one is available, it is a no-op if the ring is already
--- populated -- a restore may never take something away, and it may not
--- overwrite something intact either.
function M.restoreHistory(state, book)
  if type(state) ~= "table" or type(book) ~= "table" then return state end
  if type(book.fills) == "table" and #(state.fills or {}) == 0 then
    state.fills = copy(book.fills)
  end
  -- `next`, NOT `#`. `rejected` is a histogram keyed by rejection code
  -- (`state.rejected[code] = count`), and `#` on a string-keyed table is 0
  -- however full it is -- so the "only if empty" guard never fired and this
  -- overwrote a populated tally with the book's every single time. A restore
  -- may never take something away; the list above is a real sequence and keeps
  -- `#`.
  if type(book.rejected) == "table" and next(state.rejected or {}) == nil then
    state.rejected = copy(book.rejected)
  end
  return state
end

function M.importState(current, incoming)
  if type(incoming) ~= "table" or int(incoming.version, 0) < 1 then
    return current, "Economy export is missing or invalid"
  end
  local next_ = M.ensureState(copy(incoming))
  -- Rebuild the eviction order the export deliberately omits. Timestamp order
  -- is the order `rememberAction` appended in, so the rebuilt index evicts the
  -- same receipt the original would have. Ties keep a stable key order so two
  -- nodes restoring the same export agree.
  if #(next_.actionReceiptOrder or {}) == 0 then
    local keys = {}
    for key in pairs(next_.actionReceipts or {}) do keys[#keys + 1] = key end
    table.sort(keys, function(a, b)
      local ta = int((next_.actionReceipts[a] or {}).timestamp, 0)
      local tb = int((next_.actionReceipts[b] or {}).timestamp, 0)
      if ta ~= tb then return ta < tb end
      return a < b
    end)
    next_.actionReceiptOrder = keys
  end
  return next_, nil
end

M.ITEM_IDS = ITEM_IDS
M.playerGold = playerGold
M.goldTarget = goldTarget

return M
