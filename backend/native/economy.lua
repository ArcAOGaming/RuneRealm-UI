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
local pushHistory

local DAY = 24 * 3600 * 1000
local BPS = 10000
local ITEM_IDS = {
  "air_berry", "water_berry", "fire_berry", "rock_berry",
  "scroll", "legendary_scroll", "rune",
}
local BERRY = {
  air_berry = true, water_berry = true, fire_berry = true, rock_berry = true,
}

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

local function sortedKeys(value)
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

local function newDesk(item, goldReserve, prices, limits, stockBps, stockMax)
  return {
    item = item,
    goldReserve = goldReserve,
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

local function newDesks()
  local berryPrices = {
    { uptoBps = 2000, bid = 5, ask = 12 },
    { uptoBps = 5000, bid = 4, ask = 9 },
    { uptoBps = 7500, bid = 3, ask = 7 },
    { uptoBps = 10000, bid = 1, ask = 5 },
  }
  local scrollPrices = {
    { uptoBps = 1000, bid = 250, ask = 600 },
    { uptoBps = 4000, bid = 225, ask = 500 },
    { uptoBps = 8000, bid = 175, ask = 400 },
    { uptoBps = 10000, bid = 100, ask = 300 },
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
  --- * SCARCITY. `C.LOOT_TABLE` drops 16 berry-units per box (four berries at
  ---   800/1000 for 5 each). Rune is capped at 20 per account per 30 days and
  ---   2,000 globally per epoch. That abundance ratio prices a Rune near 24
  ---   berries, about 96 Gold.
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
  local berryLimits = { perAction = 100, perAccount = 250, global = 500 }
  local scrollLimits = { perAction = 5, perAccount = 10, global = 25 }
  local runeLimits = { perAction = 5, perAccount = 10, global = 25 }
  return {
    air_berry = newDesk("air_berry", 5000, copy(berryPrices), copy(berryLimits), 500, 400),
    water_berry = newDesk("water_berry", 5000, copy(berryPrices), copy(berryLimits), 500, 400),
    fire_berry = newDesk("fire_berry", 5000, copy(berryPrices), copy(berryLimits), 500, 400),
    rock_berry = newDesk("rock_berry", 5000, copy(berryPrices), copy(berryLimits), 500, 400),
    scroll = newDesk("scroll", 20000, scrollPrices, scrollLimits, 1000, 100),
    rune = newDesk("rune", 200000, runePrices, runeLimits, 600, 250),
  }
end

function M.newState()
  local assets = {}
  for _, item in ipairs(ITEM_IDS) do assets[item] = assetRow() end
  local cfg = C.ECONOMY
  return {
    version = 1,
    normalisedVersion = 1,
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
      shop = 240000,
      locked = 60000,
      feesRouted = 0,
      daily = {},
    },
    orders = {},
    orderSeq = 0,
    fills = {},
    orderHistory = {},
    rejected = {},
    actionReceipts = {},
    actionReceiptOrder = {},
    desks = newDesks(),
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
        accountNet30Cap = 20,
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
      amm = copy(cfg.amm),
      runeAcquisition = { budgetQuote = 0, quoteSpent = 0, runeReceived = 0, executions = {} },
      externalRuneSupply = nil,
      externalRuneObservedAt = 0,
      pending = {},
      changeSeq = 0,
      history = {},
    },
    marketDaily = {},
    activity = {},
  }
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

function M.ensureState(state)
  if type(state) ~= "table" or int(state.version, 0) < 1 then state = M.newState() end
  if int(state.normalisedVersion, 0) >= 1 then return state end
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
  return player, nil
end

local function qualifyingDays(state, address, timestamp)
  local currentDay = timestamp // DAY
  local total = 0
  for day in pairs((state.activity[address] or {}).days or {}) do
    local age = currentDay - int(day, currentDay)
    if age >= 0 and age < 30 then total = total + 1 end
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
         and currentDay - int(day, currentDay) < 30 then days = days + 1 end
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
function M.emissionBudget(state, timestamp)
  local policy = state.policy.runeRewards
  local cfg = C.ECONOMY.rune or {}
  local now = int(timestamp, 0)
  if int(policy.genesisAt, 0) <= 0 then policy.genesisAt = now end
  local elapsed = math.max(0, now - int(policy.genesisAt, 0))
  local period = math.max(1, int(cfg.halvingPeriod, 365 * DAY))
  local halvings = math.min(int(cfg.maxHalvings, 8), elapsed // period)
  local budget = int(cfg.emissionPerEpoch, 2000)
  for _ = 1, halvings do budget = budget // 2 end
  budget = math.max(int(cfg.minEmissionPerEpoch, 0), budget)
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
local function emissionPopulation(state)
  local gold = state.policy.gold
  local adopted = int(gold.qualifiedActive, 0)
  if adopted > 0 then return adopted end
  return math.max(1, int(gold.candidateQualifiedActive, 0))
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
  if policy.currentEpoch.claims[address] then return 0, "Reward already claimed this epoch" end

  local activity = state.activity[address] or { days = {}, sinkActions = 0, runeFlow = {} }
  local firstDay, distinct = nil, 0
  for day in pairs(activity.days or {}) do
    distinct = distinct + 1
    if firstDay == nil or int(day, 0) < firstDay then firstDay = int(day, 0) end
  end
  local ageDays = firstDay and (timestamp // DAY - firstDay) or 0
  local weightBps = ageDays >= 30 and BPS or (ageDays >= 7 and 5000 or 0)
  local population = emissionPopulation(state)
  local perCapita = budget // population
  -- The newcomer floor is DERIVED from the same pot, not configured. An account
  -- too young to be weighted still gets a slice of one per-capita share, and
  -- because it comes out of `remainingEpoch` like every other claim, any number
  -- of newcomers dilutes the day rather than inflating it.
  local floorShare = (perCapita * int((C.ECONOMY.rune or {}).newcomerFloorBps, 2500)) // BPS
  policy.newcomerFloor = floorShare
  local share = (budget * weightBps) // (population * BPS)
  if share <= 0 then share = floorShare end
  -- A pot that cannot pay one whole Rune to a matured account is not a
  -- rounding problem to paper over; say so rather than silently paying zero.
  if share <= 0 then
    return 0, "The day's emission is fully shared out"
  end
  local remainingEpoch = budget - int(policy.currentEpoch.spent, 0)

  local issued30, consumed30 = 0, 0
  for _, flow in ipairs(activity.runeFlow or {}) do
    if timestamp - int(flow.timestamp, 0) < 30 * DAY then
      if int(flow.delta, 0) > 0 and flow.action == "Daily.Claim" then
        issued30 = issued30 + int(flow.delta, 0)
      elseif int(flow.delta, 0) < 0 then consumed30 = consumed30 - int(flow.delta, 0) end
    end
  end
  local accountRemaining = int(policy.accountNet30Cap, 20) + consumed30 - issued30
  local amount = math.max(0, math.min(share, remainingEpoch, accountRemaining))
  -- Record the claim only when it actually paid. `claims[address]` is the
  -- once-per-epoch gate and `0` is TRUTHY in Lua, so writing a zero here
  -- locked the wallet out of the faucet for the whole 30-day epoch on the
  -- first claim that happened to be capped to nothing.
  if amount <= 0 then return 0, "Rune reward caps leave no available amount" end
  policy.currentEpoch.claims[address] = amount
  policy.currentEpoch.spent = int(policy.currentEpoch.spent, 0) + amount
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

local function playerGold(player)
  return math.max(0, int(player and player.gold, 0))
end

local function debitGold(state, player, amount)
  amount = math.max(0, int(amount, 0))
  if playerGold(player) < amount then return false end
  player.gold = playerGold(player) - amount
  state.gold.player = math.max(0, int(state.gold.player, 0) - amount)
  return true
end

local function creditGold(state, player, amount)
  amount = math.max(0, int(amount, 0))
  if amount == 0 then return end
  player.gold = playerGold(player) + amount
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

local function openOrdersFor(state, address)
  local total = 0
  for _, order in pairs(state.orders) do
    if order.account == address then total = total + 1 end
  end
  return total
end

local function recordRejected(state, reason)
  reason = tostring(reason or "unknown")
  state.rejected[reason] = int(state.rejected[reason], 0) + 1
end

function M.recordRejected(state, reason)
  state = M.ensureState(state)
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

local function rememberAction(state, key, kind, timestamp)
  if not key then return end
  state.actionReceipts[key] = { kind = kind, timestamp = timestamp }
  state.actionReceiptOrder[#state.actionReceiptOrder + 1] = key
  while #state.actionReceiptOrder > 500 do
    local oldest = table.remove(state.actionReceiptOrder, 1)
    state.actionReceipts[oldest] = nil
  end
end

local function cancelOrder(state, players, order, timestamp, reason)
  if not order or not state.orders[order.id] then return end
  local player = players[order.account]
  local remaining = math.max(0, int(order.remaining, 0))
  if order.side == "sell" then
    if player then giveItem(player, order.item, remaining) end
    state.assets[order.item].escrow = math.max(0,
      int(state.assets[order.item].escrow, 0) - remaining)
    state.assets[order.item].player = int(state.assets[order.item].player, 0) + remaining
  else
    local refund = int(order.price, 0) * remaining
    state.gold.escrow = math.max(0, int(state.gold.escrow, 0) - refund)
    if player then creditGold(state, player, refund)
    else state.gold.locked = int(state.gold.locked, 0) + refund end
  end
  state.orders[order.id] = nil
  appendBounded(state.orderHistory, {
    id = order.id, account = order.account, item = order.item, side = order.side,
    price = order.price, quantity = order.quantity, remaining = remaining,
    status = reason or "cancelled", closedAt = timestamp,
  }, C.ECONOMY.orderbook.historyLimit)
end

local function expiredCount(state, timestamp)
  local total = 0
  for _, order in pairs(state.orders) do
    if int(order.expiresAt, 0) <= timestamp then total = total + 1 end
  end
  return total
end

local function expireOrders(state, players, timestamp, limit)
  local ids = sortedKeys(state.orders)
  local expired = 0
  for _, id in ipairs(ids) do
    local order = state.orders[id]
    if order and int(order.expiresAt, 0) <= timestamp and expired < limit then
      cancelOrder(state, players, order, timestamp, "expired")
      expired = expired + 1
    end
  end
  return expired
end

local function bestMatch(state, taker)
  local best = nil
  for _, candidate in pairs(state.orders) do
    if candidate.id ~= taker.id and candidate.item == taker.item
       and candidate.side ~= taker.side and candidate.account ~= taker.account
       and int(candidate.remaining, 0) > 0 then
      local crosses = taker.side == "buy"
        and int(candidate.price, 0) <= int(taker.price, 0)
        or taker.side == "sell" and int(candidate.price, 0) >= int(taker.price, 0)
      if crosses then
        if not best then
          best = candidate
        elseif taker.side == "buy" then
          if candidate.price < best.price
             or (candidate.price == best.price and candidate.seq < best.seq) then
            best = candidate
          end
        elseif candidate.price > best.price
           or (candidate.price == best.price and candidate.seq < best.seq) then
          best = candidate
        end
      end
    end
  end
  return best
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

local function settleFill(state, players, taker, maker, timestamp)
  local buy = taker.side == "buy" and taker or maker
  local sell = taker.side == "sell" and taker or maker
  local quantity = math.min(int(buy.remaining, 0), int(sell.remaining, 0))
  local price = int(maker.price, 0) -- price-time: the resting order sets price
  local committed = int(buy.price, 0) * quantity
  local gross = price * quantity
  local fee = (gross * C.ECONOMY.orderbook.feeBps + BPS - 1) // BPS
  if fee > gross then fee = gross end
  local buyer = players[buy.account]
  local seller = players[sell.account]

  state.gold.escrow = math.max(0, int(state.gold.escrow, 0) - committed)
  local refund = committed - gross
  if buyer and refund > 0 then creditGold(state, buyer, refund) end
  if seller then creditGold(state, seller, gross - fee) end
  routeGoldFee(state, fee, timestamp, "P2P fee")

  local asset = state.assets[buy.item]
  asset.escrow = math.max(0, int(asset.escrow, 0) - quantity)
  asset.player = int(asset.player, 0) + quantity
  if buyer then giveItem(buyer, buy.item, quantity) end

  buy.remaining = int(buy.remaining, 0) - quantity
  sell.remaining = int(sell.remaining, 0) - quantity
  local fill = {
    id = "F" .. tostring(#state.fills + 1), item = buy.item,
    buyOrder = buy.id, sellOrder = sell.id,
    buyer = buy.account, seller = sell.account,
    maker = maker.account, taker = taker.account,
    price = price, quantity = quantity, gross = gross, fee = fee,
    filledAt = timestamp,
  }
  appendBounded(state.fills, fill, C.ECONOMY.orderbook.historyLimit)
  local day = marketDay(state, timestamp, buy.item)
  day.volume = int(day.volume, 0) + quantity
  day.gold = int(day.gold, 0) + gross
  day.fills = int(day.fills, 0) + 1
  day.makers[maker.account] = true
  day.takers[taker.account] = true

  for _, order in ipairs({ buy, sell }) do
    if int(order.remaining, 0) <= 0 and state.orders[order.id] then
      state.orders[order.id] = nil
      appendBounded(state.orderHistory, {
        id = order.id, account = order.account, item = order.item,
        side = order.side, price = order.price, quantity = order.quantity,
        remaining = 0, status = "filled", closedAt = timestamp,
      }, C.ECONOMY.orderbook.historyLimit)
    end
  end
  return fill
end

function M.placeOrder(state, players, account, side, item, price, quantity, timestamp, actionId)
  state = M.ensureState(state)
  local wasReplay, receiptKey, replayProblem = replayedAction(
    state, account, actionId, "order.place")
  if replayProblem then return nil, replayProblem end
  if wasReplay then return { replayed = true, actionId = actionId, fills = {} }, nil end
  local cfg = C.ECONOMY.orderbook
  side = tostring(side or ""):lower()
  price = int(price, 0)
  quantity = int(quantity, 0)
  local player = players[account]
  local problem = nil
  if state.policy.emergency and state.policy.emergency.paused then
    problem = "Economy is paused: " .. tostring(state.policy.emergency.reason or "emergency pause")
  elseif not player then problem = "No such player"
  elseif side ~= "buy" and side ~= "sell" then problem = "Side must be buy or sell"
  elseif not state.assets[item] then problem = "That item is not traded for Gold"
  elseif price <= 0 or price > cfg.maxUnitPrice then problem = "Invalid unit price"
  elseif quantity <= 0 or quantity > cfg.maxQuantity then problem = "Invalid quantity"
  elseif price * quantity < cfg.minValue then problem = "Order value is below 10 Gold"
  elseif openOrdersFor(state, account) >= cfg.maxPerAccount then problem = "Open-order account limit reached"
  elseif countMap(state.orders) - expiredCount(state, timestamp) >= cfg.maxGlobal then
    problem = "Global open-order limit reached"
  elseif side == "sell" and inventory(player, item) < quantity then
    problem = "Not enough " .. tostring(item)
  elseif side == "sell" and playerGold(player) < cfg.creationCost then
    problem = "The order-creation cost is 1 Gold"
  elseif side == "buy" and playerGold(player) < price * quantity + cfg.creationCost then
    problem = "Not enough Gold for order escrow and creation cost"
  end
  if not problem then
    for _, own in pairs(state.orders) do
      if own.account == account and own.item == item and own.side ~= side then
        local crosses = side == "buy" and int(own.price, 0) <= price
          or side == "sell" and int(own.price, 0) >= price
        if crosses then problem = "Self-trading is not allowed" break end
      end
    end
  end
  if problem then recordRejected(state, problem); return nil, problem end

  rememberAction(state, receiptKey, "order.place", timestamp)
  expireOrders(state, players, timestamp, 25)
  debitGold(state, player, cfg.creationCost)
  routeGoldFee(state, cfg.creationCost, timestamp, "Order creation")

  state.orderSeq = int(state.orderSeq, 0) + 1
  local order = {
    id = "O" .. string.format("%d", state.orderSeq), seq = state.orderSeq,
    account = account, side = side, item = item, price = price,
    quantity = quantity, remaining = quantity,
    createdAt = timestamp, expiresAt = timestamp + cfg.expiry,
  }
  if side == "sell" then
    takeItem(player, item, quantity)
    state.assets[item].player = math.max(0, int(state.assets[item].player, 0) - quantity)
    state.assets[item].escrow = int(state.assets[item].escrow, 0) + quantity
  else
    local commitment = price * quantity
    debitGold(state, player, commitment)
    state.gold.escrow = int(state.gold.escrow, 0) + commitment
  end
  state.orders[order.id] = order

  local fills = {}
  local maker = bestMatch(state, order)
  while maker and int(order.remaining, 0) > 0 do
    fills[#fills + 1] = settleFill(state, players, order, maker, timestamp)
    maker = bestMatch(state, order)
  end
  return { order = copy(order), fills = fills, open = state.orders[order.id] ~= nil }, nil
end

function M.cancelOrder(state, players, account, orderId, timestamp, actionId)
  state = M.ensureState(state)
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
  cancelOrder(state, players, order, timestamp, "cancelled")
  return { cancelled = orderId }, nil
end

function M.maintain(state, players, timestamp, limit)
  state = M.ensureState(state)
  return expireOrders(state, players, timestamp, clamp(limit, 1, 100))
end

local function assetSupply(state, item)
  local row = state.assets[item]
  return math.max(0, int(row and row.issued, 0) - int(row and row.consumed, 0))
end

local function deskCap(state, desk)
  local supply = assetSupply(state, desk.item)
  if supply <= 0 then return 0 end
  local relative = (supply * int(desk.stockBps, 0)) // BPS
  if relative < 1 then relative = 1 end
  return math.min(int(desk.stockMax, 0), relative)
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

local function usageRows(desk, account, timestamp)
  local window = timestamp // C.ECONOMY.shop.accountWindow
  local accountRow = desk.accountUsage[account]
  if not accountRow or int(accountRow.window, -1) ~= window then
    accountRow = { window = window, buy = 0, sell = 0 }
    desk.accountUsage[account] = accountRow
  end
  if int(desk.globalUsage.window, -1) ~= window then
    desk.globalUsage = { window = window, buy = 0, sell = 0 }
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
  local epochLimit = math.max(1,
    (assetSupply(state, desk.item) * C.ECONOMY.shop.flowSupplyBps) // BPS)
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
  local supply = assetSupply(state, item)
  local epochLimit = math.max(1, (supply * C.ECONOMY.shop.flowSupplyBps) // BPS)
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

local function median(values)
  if #values == 0 then return nil end
  table.sort(values)
  local middle = (#values + 1) // 2
  if (#values % 2) == 1 then return values[middle] end
  return (values[middle] + values[middle + 1]) // 2
end

local function marketStats(state, timestamp, item)
  local bestBid, bestAsk = nil, nil
  local bids, asks = {}, {}
  for _, order in pairs(state.orders) do
    if order.item == item then
      local row = { price = int(order.price, 0), quantity = int(order.remaining, 0) }
      if order.side == "buy" then
        bids[#bids + 1] = row
        if not bestBid or row.price > bestBid then bestBid = row.price end
      else
        asks[#asks + 1] = row
        if not bestAsk or row.price < bestAsk then bestAsk = row.price end
      end
    end
  end
  table.sort(bids, function(a, b) return a.price > b.price end)
  table.sort(asks, function(a, b) return a.price < b.price end)
  while #bids > 10 do table.remove(bids) end
  while #asks > 10 do table.remove(asks) end
  local prices7, prices30 = {}, {}
  local volume24, volume7 = 0, 0
  local makers, takers = {}, {}
  for _, fill in ipairs(state.fills) do
    if fill.item == item then
      local age = timestamp - int(fill.filledAt, 0)
      if age >= 0 and age < 30 * DAY then prices30[#prices30 + 1] = int(fill.price, 0) end
      if age >= 0 and age < 7 * DAY then prices7[#prices7 + 1] = int(fill.price, 0) end
      if age >= 0 and age < DAY then volume24 = volume24 + int(fill.quantity, 0) end
      if age >= 0 and age < 7 * DAY then
        volume7 = volume7 + int(fill.quantity, 0)
        makers[fill.maker] = true; takers[fill.taker] = true
      end
    end
  end
  return {
    bestBid = bestBid, bestAsk = bestAsk,
    depth = { bids = bids, asks = asks },
    volume24h = volume24, volume7d = volume7,
    median7d = median(prices7), median30d = median(prices30),
    medianSamples7d = #prices7, medianSamples30d = #prices30,
    uniqueMakers7d = countMap(makers), uniqueTakers7d = countMap(takers),
  }
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

function M.publicView(state, withdrawals, deposits, timestamp)
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
    local population = emissionPopulation(state)
    policy.newcomerFloor =
      ((budget // population) * int((C.ECONOMY.rune or {}).newcomerFloorBps, 2500)) // BPS
  end
  local assets = {}
  local markets = {}
  for _, item in ipairs(ITEM_IDS) do
    local row = state.assets[item]
    assets[item] = {
      issued = row.issued, consumed = row.consumed, player = row.player,
      escrow = row.escrow, shop = row.shop,
      rolling7d = rollingAsset(row, timestamp, 7),
      rolling30d = rollingAsset(row, timestamp, 30),
      sources = copy(row.sources), sinks = copy(row.sinks),
    }
    markets[item] = marketStats(state, timestamp, item)
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
    assets = assets, lootboxes = boxes, orders = orderView(state),
    fills = copy(state.fills), market = markets, desks = desks,
    rejected = copy(state.rejected),
    policy = copy(state.policy), passQuote = M.passQuote(state),
  }
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
  supply = int(supply, -1)
  if supply < 0 then return nil, "Rune token supply must be a non-negative integer" end
  state.policy.externalRuneSupply = supply
  state.policy.externalRuneObservedAt = timestamp
  pushHistory(state, { action = "rune-supply-observed", actor = actor,
    value = supply, reason = reason or "token reconciliation", timestamp = timestamp })
  return supply, nil
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
  ["amm.maxSlippageBps"] = { delay = true, min = 1, max = 1000 },
  ["amm.maxWeeklyPoolBps"] = { delay = true, min = 1, max = 2000 },
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

function M.exportState(state)
  return copy(M.ensureState(state))
end

function M.importState(current, incoming)
  if type(incoming) ~= "table" or int(incoming.version, 0) < 1 then
    return current, "Economy export is missing or invalid"
  end
  return M.ensureState(copy(incoming)), nil
end

M.ITEM_IDS = ITEM_IDS
M.playerGold = playerGold
M.goldTarget = goldTarget

return M
