--- economy_test.lua -- the order book engine, driven directly.
---
--- `game_test.lua` exercises the book the way a player reaches it: signed
--- messages, one slot each. That is the right test for the handlers and the
--- wrong one for the matching engine, because the interesting boundaries are
--- hundreds of fills deep. Proving that fill ids survive the history cap needs
--- more fills than the cap, and at one message per fill that is a suite nobody
--- will run.
---
--- So this file calls `EconomyEngine` directly, with the caps turned down to
--- single digits. Same Luerl rules as everything else: no goto, no table.move,
--- narrow every number through `int()`.
---
--- Run with ./run-economy-test.sh (live node) or
--- `npm run test:economy:local` (offline, checked-in WASM).

local function run()
  local out = {}
  local passed, failed = 0, 0
  local function ok(label, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (cond and "PASS  " or "FAIL  ") .. label ..
      (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end

  local T = 1700000000000
  local ALICE = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local BOB   = "BOBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  local CAROL = "CAROLcccccccccccccccccccccccccccccccccccccc"

  --- A fresh two-trader world with deep inventories, so no test is measuring
  --- an accidental shortage.
  local function world()
    local state = EconomyEngine.newState()
    local players = {}
    for _, address in ipairs({ ALICE, BOB, CAROL }) do
      players[address] = {
        address = address, gold = 1000000,
        inventory = { fire_berry = 100000, water_berry = 100000 },
      }
    end
    -- The book's own supply accounting has to start consistent with those
    -- inventories or `player` counts go negative on the first escrow.
    for _, item in ipairs({ "fire_berry", "water_berry" }) do
      state.assets[item].issued = 300000
      state.assets[item].player = 300000
    end
    state.gold.issued = state.gold.issued + 3000000
    state.gold.authorized = state.gold.issued
    state.gold.player = 3000000
    -- A bare P2P book, on purpose.
    --
    -- Two of the engine's rules are about the world OUTSIDE the matching
    -- loop: the NPC desk quotes into the same ladder, and a price band keeps
    -- a fat finger from printing 1,000,000. Both are on by default and both
    -- are exercised by their own tests below -- but leaving them on here would
    -- mean every test of price-time priority was really a test of whether the
    -- house happened to be quoting inside it. A test of the matching engine
    -- has to be able to name its own prices.
    for _, market in pairs(state.markets) do
      market.bandBps = 0
      market.houseQuotes = false
    end
    return state, players
  end

  --- Put the house and the corridor back on one market.
  local function withHouse(state, item)
    local market = EconomyEngine.resolveMarket(state, item)
    market.houseQuotes = true
    market.bandBps = C.ECONOMY.orderbook.bandBps
    return market
  end

  local function place(state, players, account, side, item, price, quantity, timestamp)
    return EconomyEngine.placeOrder(state, players, account, side, item,
      price, quantity, timestamp or T, nil)
  end

  local cfg = C.ECONOMY.orderbook
  local originalHistory = cfg.historyLimit
  local originalExpiry = cfg.expiry
  local originalPerAccount = cfg.maxPerAccount
  local originalMinExpiry = cfg.minExpiry

  -- 1. Fill ids survive the history cap ---------------------------------------
  --
  -- The id used to be `"F" .. #state.fills + 1`, and `appendBounded` pins
  -- `#state.fills` at the cap -- so every fill after the cap was called `F501`
  -- on the live process. Anything keyed on a fill id was wrong from that point
  -- on and would stay wrong forever. Drive four times the cap and demand every
  -- id ever issued be distinct.
  do
    cfg.historyLimit = 4
    local state, players = world()
    local seen, collisions, total = {}, 0, 0
    for round = 1, 16 do
      place(state, players, ALICE, "sell", "fire_berry", 10, 1, T + round)
      local taken = place(state, players, BOB, "buy", "fire_berry", 10, 1, T + round)
      for _, fill in ipairs((taken or {}).fills or {}) do
        total = total + 1
        if seen[fill.id] then collisions = collisions + 1 end
        seen[fill.id] = true
      end
    end
    ok("sixteen fills are produced past a cap of four", total == 16, total)
    ok("no fill id is ever reissued once the history cap is reached",
       collisions == 0, collisions .. " repeats across " .. total .. " fills")
    ok("the history itself stays bounded at the cap", #state.fills == 4, #state.fills)
    ok("and the sequence keeps counting past the cap",
       EconomyEngine.exportState(state).fillSeq == 16,
       EconomyEngine.exportState(state).fillSeq)
    cfg.historyLimit = originalHistory
  end

  -- 2. An expired order is not liquidity --------------------------------------
  --
  -- Expiry used to be enforced only by a sweep bounded at 25 orders, so past
  -- that bound a month-old order still filled at a price its owner had walked
  -- away from. This is the regression: one resting order, one crossing order,
  -- a year apart.
  do
    local state, players = world()
    local ask = place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    ok("the resting ask is on the book", ask and ask.order and ask.order.remaining == 5,
       ask and ask.order and ask.order.remaining)
    local late = T + originalExpiry + 1
    local bid = place(state, players, BOB, "buy", "fire_berry", 50, 5, late)
    ok("a crossing order does not fill against an expired resting order",
       bid and #bid.fills == 0, bid and #bid.fills)
    ok("and the crossing order rests instead", bid and bid.open == true,
       bid and tostring(bid.open))

    local berriesBack = (players[ALICE].inventory or {}).fire_berry
    ok("sweeping the expired ask returns its item escrow to its owner",
       berriesBack == 100000, berriesBack)
  end

  -- 3. Stale orders do not lock a player out of their own book ----------------
  do
    cfg.maxPerAccount = 3
    local state, players = world()
    for index = 1, 3 do
      place(state, players, ALICE, "sell", "fire_berry", 10 + index, 1, T)
    end
    local blocked = place(state, players, ALICE, "sell", "fire_berry", 99, 1, T)
    ok("the per-account cap is enforced while orders are live", blocked == nil, blocked)
    local later = T + originalExpiry + 1
    local allowed = place(state, players, ALICE, "sell", "fire_berry", 99, 1, later)
    ok("expired orders do not count against the per-account cap",
       allowed ~= nil and allowed.order ~= nil,
       allowed and allowed.order and allowed.order.id)
    cfg.maxPerAccount = originalPerAccount
  end

  -- 4. Depth is a price ladder, not a list of orders ---------------------------
  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 2, T)
    place(state, players, BOB, "sell", "fire_berry", 10, 3, T)
    place(state, players, CAROL, "sell", "fire_berry", 11, 4, T)
    place(state, players, ALICE, "buy", "fire_berry", 5, 6, T)
    local view = EconomyEngine.publicView(state, {}, {}, T)
    local asks = view.market.fire_berry.depth.asks
    ok("orders resting at one price collapse into one level", #asks == 2, #asks)
    ok("the level sums their quantity",
       asks[1] and asks[1].price == 10 and asks[1].quantity == 5, asks[1] and asks[1].quantity)
    ok("and counts how many orders are behind it",
       asks[1] and asks[1].orders == 2, asks[1] and asks[1].orders)
    ok("levels are ordered best-first",
       asks[2] and asks[2].price == 11, asks[2] and asks[2].price)
    local bids = view.market.fire_berry.depth.bids
    ok("the bid side ladders the other way",
       #bids == 1 and bids[1].price == 5 and bids[1].quantity == 6,
       bids[1] and bids[1].price)
    ok("best bid and best ask agree with the ladder",
       view.market.fire_berry.bestBid == 5 and view.market.fire_berry.bestAsk == 10,
       tostring(view.market.fire_berry.bestBid) .. "/" ..
       tostring(view.market.fire_berry.bestAsk))
  end

  -- 5. The ladder never advertises a price nobody can trade at ----------------
  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 2, T)
    local late = T + originalExpiry + 1
    local view = EconomyEngine.publicView(state, {}, {}, late)
    ok("an expired order is not drawn as depth",
       #view.market.fire_berry.depth.asks == 0,
       #view.market.fire_berry.depth.asks)
    ok("and does not set a best ask", view.market.fire_berry.bestAsk == nil,
       tostring(view.market.fire_berry.bestAsk))
  end

  -- 6. Price-time priority, which the expiry change must not have moved -------
  do
    -- ALICE does the sweeping and rests nothing, so self-trade prevention is
    -- not what this measures.
    local state, players = world()
    place(state, players, CAROL, "sell", "fire_berry", 12, 1, T)
    place(state, players, BOB, "sell", "fire_berry", 10, 1, T + 1)
    place(state, players, CAROL, "sell", "fire_berry", 10, 1, T + 2)
    local swept = place(state, players, ALICE, "buy", "fire_berry", 12, 3, T + 3)
    local fills = (swept or {}).fills or {}
    ok("a sweeping order takes the best price first",
       fills[1] and fills[1].price == 10, fills[1] and fills[1].price)
    ok("then the older order at that price",
       fills[1] and fills[1].seller == BOB, fills[1] and fills[1].seller)
    ok("then the newer one",
       fills[2] and fills[2].seller == CAROL and fills[2].price == 10,
       fills[2] and fills[2].seller)
    ok("and only then the worse price",
       fills[3] and fills[3].price == 12, fills[3] and fills[3].price)
    ok("a taker that crosses is refunded the difference",
       fills[1] and fills[1].gross == 10, fills[1] and fills[1].gross)
  end

  -- 7. Gold is conserved across a sweep, a fill and a cancel ------------------
  do
    local state, players = world()
    local before = players[ALICE].gold + players[BOB].gold
    local ask = place(state, players, ALICE, "sell", "fire_berry", 10, 4, T)
    place(state, players, BOB, "buy", "fire_berry", 10, 1, T + 1)
    EconomyEngine.cancelOrder(state, players, ALICE, ask.order.id, T + 2, nil)
    local after = players[ALICE].gold + players[BOB].gold
    local fees = EconomyEngine.exportState(state).gold.escrow
    ok("no Gold escrow is stranded after a partial fill and a cancel",
       fees == 0, fees)
    ok("and no Gold is created by the round trip", after <= before, before .. " -> " .. after)
    ok("the seller keeps the unsold remainder",
       (players[ALICE].inventory or {}).fire_berry == 99999,
       (players[ALICE].inventory or {}).fire_berry)
  end

  -- 8. The book does not know what an account is -----------------------------
  --
  -- THE point of the ledger seam, and the only test that actually exercises
  -- it: no player records, no `inventory` table, no `gold` field -- just
  -- balances, which is the shape a standalone deployment has when a token's
  -- `Credit-Notice` is what funds an account. Every other test in this file
  -- goes through `M.playerLedger`; if the engine has reached around the seam
  -- anywhere, this is where it shows.
  do
    local balances = {
      [ALICE] = { gold = 100000, fire_berry = 500 },
      [BOB] = { gold = 100000, fire_berry = 0 },
    }
    local ledger = {
      kind = "credit",
      exists = function(account) return balances[account] ~= nil end,
      balance = function(account, asset)
        return math.max(0, (balances[account] or {})[asset] or 0)
      end,
      debit = function(account, asset, amount)
        local row = balances[account]
        if not row or (row[asset] or 0) < amount then return false end
        row[asset] = row[asset] - amount
        return true
      end,
      credit = function(account, asset, amount)
        local row = balances[account]
        if row then row[asset] = (row[asset] or 0) + amount end
      end,
    }
    local state = EconomyEngine.newState()
    state.assets.fire_berry.issued = 500
    state.assets.fire_berry.player = 500
    state.gold.issued = state.gold.issued + 200000
    state.gold.authorized = state.gold.issued
    state.gold.player = 200000

    local ask = EconomyEngine.placeOrder(state, ledger, ALICE, "sell",
      "fire_berry", 10, 5, T, nil)
    ok("a credit ledger can rest an order", ask and ask.order ~= nil, ask)
    ok("and the item leaves the seller's credit balance",
       balances[ALICE].fire_berry == 495, balances[ALICE].fire_berry)

    local bid = EconomyEngine.placeOrder(state, ledger, BOB, "buy",
      "fire_berry", 12, 5, T + 1, nil)
    ok("a credit ledger can take one", bid and #bid.fills == 1, bid and #bid.fills)
    ok("the buyer is credited the goods",
       balances[BOB].fire_berry == 5, balances[BOB].fire_berry)
    ok("the resting price is what settles, not the crossing one",
       bid.fills[1].price == 10, bid.fills[1].price)
    ok("and the taker is refunded the difference",
       balances[BOB].gold == 100000 - 1 - 50, balances[BOB].gold)

    -- Cancelling has to return escrow to a ledger too, not to a player record.
    local rest = EconomyEngine.placeOrder(state, ledger, ALICE, "buy",
      "fire_berry", 3, 10, T + 2, nil)
    local goldAfterBid = balances[ALICE].gold
    EconomyEngine.cancelOrder(state, ledger, ALICE, rest.order.id, T + 3, nil)
    ok("cancelling returns escrow to the credit balance",
       balances[ALICE].gold == goldAfterBid + 30, balances[ALICE].gold)
    ok("and no escrow is stranded in the book",
       state.gold.escrow == 0 and state.assets.fire_berry.escrow == 0,
       state.gold.escrow .. "/" .. state.assets.fire_berry.escrow)
  end

  -- 9. The market registry ---------------------------------------------------
  --
  -- Tick, lot and status are the three that turn "an item traded for Gold"
  -- into a market. Lot is the one that matters most and is hardest to add
  -- later: price is quote units per LOT, so an asset worth a fraction of an
  -- indivisible quote is listable at all. Every real market is lot 1 today,
  -- which is exactly why it needs a test that is not.
  do
    local state, players = world()
    local market = EconomyEngine.resolveMarket(state, "fire_berry")
    ok("an item resolves to its Gold market",
       market and market.id == "fire_berry/gold" and market.quote == "gold",
       market and market.id)
    ok("and so does the full market id",
       EconomyEngine.resolveMarket(state, "fire_berry/gold") == market, nil)
    ok("markets default to lot one, so nothing in the game changes",
       market.lot == 1 and market.tick == 1, market.lot .. "/" .. market.tick)
    ok("and to no fee, because the desk spread is the Gold sink",
       market.takerBps == 0 and market.makerBps == 0, market.takerBps)

    market.tick = 5
    local offTick = place(state, players, ALICE, "sell", "fire_berry", 12, 5, T)
    ok("a price off the tick is refused", offTick == nil, offTick)
    local onTick = place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    ok("and a price on it is taken", onTick and onTick.order ~= nil, onTick)
    market.tick = 1

    market.status = "halted"
    local halted = place(state, players, BOB, "buy", "fire_berry", 10, 1, T)
    ok("a halted market takes no orders", halted == nil, halted)
    market.status = "open"
  end

  -- Lot size, end to end: escrow, fill and cancel all have to agree.
  do
    local state, players = world()
    local market = EconomyEngine.resolveMarket(state, "fire_berry")
    market.lot = 10

    local before = (players[ALICE].inventory or {}).fire_berry
    local ask = place(state, players, ALICE, "sell", "fire_berry", 10, 3, T)
    ok("selling three lots of ten escrows thirty units",
       (players[ALICE].inventory or {}).fire_berry == before - 30,
       (players[ALICE].inventory or {}).fire_berry)
    ok("and the book holds thirty in escrow",
       state.assets.fire_berry.escrow == 30, state.assets.fire_berry.escrow)

    local bid = place(state, players, BOB, "buy", "fire_berry", 10, 2, T + 1)
    ok("buying two lots fills two lots", bid and #bid.fills == 1
       and bid.fills[1].quantity == 2, bid and bid.fills[1] and bid.fills[1].quantity)
    ok("and delivers twenty units of the base asset",
       (players[BOB].inventory or {}).fire_berry == 100000 + 20,
       (players[BOB].inventory or {}).fire_berry)
    ok("while the quote is priced per lot, not per unit",
       players[BOB].gold == 1000000 - 1 - 20, players[BOB].gold)

    EconomyEngine.cancelOrder(state, players, ALICE, ask.order.id, T + 2, nil)
    ok("cancelling the rest returns the remaining lot in whole units",
       (players[ALICE].inventory or {}).fire_berry == before - 20,
       (players[ALICE].inventory or {}).fire_berry)
    ok("and leaves no base escrow behind",
       state.assets.fire_berry.escrow == 0, state.assets.fire_berry.escrow)
    market.lot = 1
  end

  -- 10. Fees: the taker pays, and a percentage stays a percentage -----------
  do
    local state, players = world()
    local market = EconomyEngine.resolveMarket(state, "fire_berry")

    -- Default is free, on every in-game market, deliberately.
    place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    local goldBefore = players[ALICE].gold
    place(state, players, BOB, "buy", "fire_berry", 10, 5, T + 1)
    ok("an in-game market charges no fee at all",
       players[ALICE].gold == goldBefore + 50, players[ALICE].gold - goldBefore)
  end

  -- A taking BUYER pays out of free balance; a taking SELLER out of proceeds.
  do
    local state, players = world()
    local market = EconomyEngine.resolveMarket(state, "fire_berry")
    market.takerBps = 200

    place(state, players, ALICE, "sell", "fire_berry", 100, 5, T)
    local makerGold = players[ALICE].gold
    local takerGold = players[BOB].gold
    place(state, players, BOB, "buy", "fire_berry", 100, 5, T + 1)
    ok("the maker is paid in full and charged nothing",
       players[ALICE].gold == makerGold + 500, players[ALICE].gold - makerGold)
    -- 500 notional, 1 Gold creation cost, 10 Gold fee at 200 bps.
    ok("and the taking buyer pays the fee on top",
       players[BOB].gold == takerGold - 500 - 1 - 10, takerGold - players[BOB].gold)

    local bidder, seller = CAROL, ALICE
    place(state, players, bidder, "buy", "fire_berry", 100, 5, T + 2)
    local sellerGold = players[seller].gold
    place(state, players, seller, "sell", "fire_berry", 100, 5, T + 3)
    ok("a taking seller pays it out of proceeds instead",
       players[seller].gold == sellerGold - 1 + 500 - 10,
       players[seller].gold - sellerGold)
    market.takerBps = 0
  end

  -- The carry. This is the whole reason a fee works against something that
  -- does not divide: seventeen three-Gold fills owe 1.02 Gold in total, and a
  -- ceiling would have charged 1 on EVERY one of them -- seventeen times the
  -- real rate, all of it on the smallest trades in the book.
  do
    local state, players = world()
    local market = EconomyEngine.resolveMarket(state, "fire_berry")
    market.takerBps = 200
    market.minValue = 1

    local collectedBefore = state.gold.locked + state.gold.burned
    local fills = 0
    for round = 1, 17 do
      place(state, players, ALICE, "sell", "fire_berry", 3, 1, T + round * 2)
      local taken = place(state, players, BOB, "buy", "fire_berry", 3, 1, T + round * 2 + 1)
      for _, fill in ipairs((taken or {}).fills or {}) do
        fills = fills + 1
        if round == 1 then
          ok("a fill too small to owe a whole unit pays nothing",
             fill.fee == 0, fill.fee)
        end
      end
    end
    ok("seventeen small fills happened", fills == 17, fills)
    -- Creation cost is 1 Gold per order and 34 orders were placed; the rest of
    -- the movement is fee.
    local collected = state.gold.locked + state.gold.burned - collectedBefore - 34
    ok("and the venue collects exactly floor(total * bps), not a ceiling each time",
       collected == (17 * 3 * 200) // 10000, collected)
    ok("the carry is kept, and stays below one whole unit",
       market.feeCarry > 0 and market.feeCarry < 10000, market.feeCarry)
    market.takerBps = 0
    market.minValue = 10
  end

  -- 11. The NPC desk's epoch flow cap counts players, not leftovers ----------
  --
  -- The cap used to be 2% of OUTSTANDING supply, and outstanding supply falls
  -- as the game is played: eating a berry both removes it from the count and
  -- creates the demand to replace it. So the desk shut tighter the busier it
  -- got -- 9-11 units a week on the live process, next to a 20-hour global of
  -- 500 that could therefore never fire -- and nothing caught it, because
  -- every fixture in this file is far richer than the real process.
  --
  -- These assertions are the SHAPE, not the number. A number can be retuned;
  -- the direction is the defect. Consumption must not tighten the desk, and
  -- population must widen it.
  do
    local state = EconomyEngine.newState()
    local players = { [ALICE] = { address = ALICE, gold = 100000,
      inventory = { fire_berry = 1000 } } }
    state.gold.issued = state.gold.issued + 100000
    state.gold.authorized = state.gold.issued
    state.gold.player = 100000
    -- Live-process scale, not fixture scale: ~500 berries outstanding is what
    -- the old rule read as an allowance of ten.
    state.assets.fire_berry.issued = 500
    state.assets.fire_berry.player = 500

    local desk = state.desks.fire_berry
    local epoch = T // C.ECONOMY.shop.policyEpoch
    local FLOW = "Policy-epoch supply-flow limit reached"
    local probe = 0
    --- Would the desk take one more unit with `used` already gone this epoch?
    --- The limit is not published -- it is not state, so it must not grow the
    --- published map -- so asking the desk is the only way to read it, and
    --- reading it is the whole test. Every other limit is reset each probe so
    --- that a refusal can only have come from the epoch cap.
    local function tradeWith(used)
      probe = probe + 1
      desk.epochUsage = { epoch = epoch, quantity = used }
      desk.accountUsage = {}
      desk.stock = 0
      local _, problem = EconomyEngine.shopTrade(state, players, {}, {},
        ALICE, "fire_berry", "sell", 1, T, "flow-probe-" .. probe)
      return problem
    end

    -- DERIVED, never typed. `epochFlowLimit` is
    -- `(limits.global // flowFloorAccounts) * max(flowFloorAccounts, passes)`,
    -- and writing the answer out as a literal is what let the berry desk's
    -- limits drift to ten times the plan's while this test went on passing
    -- against the old number.
    local floorAccounts = C.ECONOMY.shop.flowFloorAccounts
    local perAccount = desk.limits.global // floorAccounts
    local flowLimit = function(passes)
      return perAccount * math.max(floorAccounts, passes)
    end

    local base = flowLimit(0)
    local under, at = tradeWith(base - 1), tradeWith(base)
    ok("a desk that has sold no passes still allows one 20-hour window's flow",
       under == nil and at == FLOW, tostring(under) .. " / " .. tostring(at))

    -- Now play the game: four fifths of the berries are eaten. Outstanding
    -- supply is 100, which the old rule would have priced at an allowance of
    -- two -- a desk that shuts because the item it trades is being used.
    state.assets.fire_berry.consumed = 400
    state.assets.fire_berry.player = 100
    local stillUnder, stillAt = tradeWith(base - 1), tradeWith(base)
    ok("and consuming four fifths of the supply does not tighten it",
       stillUnder == nil and stillAt == FLOW,
       tostring(stillUnder) .. " / " .. tostring(stillAt))

    -- Two hundred passholders are two hundred berry flows, so the desk widens
    -- by exactly that: `global // flowFloorAccounts` a kind per account, which
    -- is the derivation `epochFlowLimit` carries and the reason neither number
    -- appears here as a literal.
    state.policy.passes.lifetimePassCount = 200
    local wide = flowLimit(200)
    ok("two hundred passes widen the desk by exactly two hundred flows",
       wide == perAccount * 200, wide)
    local wideUnder, wideAt = tradeWith(wide - 1), tradeWith(wide)
    ok("while passes widen it, because the players are what the flow is made of",
       wideUnder == nil and wideAt == FLOW,
       tostring(wideUnder) .. " / " .. tostring(wideAt))
  end

  -- 12. Time in force -------------------------------------------------------
  --
  -- Everything else is a special case of these four. IOC is the market order
  -- the book did not have; FOK is the one that must leave no trace when it
  -- fails; PostOnly is the only way a maker can be sure it never pays a taker
  -- fee. Each one is checked for what it does AND for what it leaves behind,
  -- because a time-in-force that half-executes is worse than none.
  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 3, T)

    local ioc = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      10, 10, T + 1, nil, { tif = "ioc" })
    ok("an IOC takes what is there", ioc and #ioc.fills == 1 and ioc.fills[1].quantity == 3,
       ioc and ioc.fills[1] and ioc.fills[1].quantity)
    ok("and rests nothing", ioc and ioc.open == false and ioc.killed == true,
       ioc and tostring(ioc.open))
    ok("so the unfilled escrow comes straight back",
       state.gold.escrow == 0, state.gold.escrow)
  end

  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 3, T)
    local goldBefore = players[BOB].gold
    local orders = 0
    for _ in pairs(state.orders) do orders = orders + 1 end
    local fok = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      10, 10, T + 1, nil, { tif = "fok" })
    ok("a FOK that cannot be filled in full is refused", fok == nil, fok)
    local after = 0
    for _ in pairs(state.orders) do after = after + 1 end
    -- The point of the pre-check: a killed FOK must leave the book EXACTLY as
    -- it found it. Not "cancelled afterwards" -- untouched, including the
    -- creation cost, which is charged on placement and would otherwise be a
    -- fee for being told no.
    ok("and it costs the sender nothing at all", players[BOB].gold == goldBefore,
       goldBefore - players[BOB].gold)
    ok("and leaves the book untouched", after == orders, after .. "/" .. orders)

    local filled = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      10, 3, T + 2, nil, { tif = "fok" })
    ok("a FOK that can be filled in full is", filled and #filled.fills == 1,
       filled and #filled.fills)
  end

  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 3, T)
    local crossed = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      10, 3, T + 1, nil, { tif = "postonly" })
    ok("a post-only order that would cross is refused", crossed == nil, crossed)
    local rested = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      9, 3, T + 2, nil, { tif = "post-only" })
    -- Spelled with the separator the browser actually signs. Tag names and
    -- values both lose their separators on the way through HTTP, so a handler
    -- that only knows `postonly` refuses every real message.
    ok("and one that rests is taken, however the tag spelled it",
       rested and rested.open == true and #rested.fills == 0, rested and tostring(rested.open))
  end

  -- 13. Self-trade prevention -------------------------------------------------
  --
  -- Refusing the whole order is safe and hostile: a maker moving a quote got
  -- an error and had to cancel and re-place, paying twice. The default now
  -- pulls the maker's own resting side and carries on.
  do
    local state, players = world()
    local resting = place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    local crossed = place(state, players, ALICE, "buy", "fire_berry", 12, 5, T + 1)
    ok("crossing your own quote cancels it rather than refusing you",
       crossed ~= nil and crossed.selfCancelled == 1, crossed and crossed.selfCancelled)
    ok("the resting side is gone", state.orders[resting.order.id] == nil,
       resting.order.id)
    ok("and the new order is on the book", crossed and crossed.open == true,
       crossed and tostring(crossed.open))
    ok("with nothing traded against yourself", crossed and #crossed.fills == 0,
       crossed and #crossed.fills)

    local strict = EconomyEngine.placeOrder(state, players, ALICE, "sell", "fire_berry",
      10, 5, T + 2, nil, { stp = "reject" })
    ok("`reject` is still available for a maker that wants to be told",
       strict == nil, strict)
    local both = EconomyEngine.placeOrder(state, players, ALICE, "sell", "fire_berry",
      10, 5, T + 3, nil, { stp = "CancelBoth" })
    ok("and `CancelBoth` leaves the account flat",
       both ~= nil and both.open == false and both.selfCancelled == 1,
       both and tostring(both.open))
    local left = 0
    for _, order in pairs(state.orders) do
      if order.account == ALICE then left = left + 1 end
    end
    ok("with nothing of theirs left resting", left == 0, left)
  end

  -- 14. Amend -----------------------------------------------------------------
  do
    local state, players = world()
    local first = place(state, players, ALICE, "sell", "fire_berry", 10, 10, T)
    local behind = place(state, players, BOB, "sell", "fire_berry", 10, 10, T + 1)
    local held = players[ALICE].inventory.fire_berry

    local shrunk = EconomyEngine.amendOrder(state, players, ALICE, first.order.id,
      10, 4, T + 2, nil)
    ok("shrinking at the same price keeps the order id",
       shrunk and shrunk.orderId == first.order.id, shrunk and shrunk.orderId)
    ok("and keeps its place in the queue",
       shrunk and shrunk.requeued == false
         and state.orders[first.order.id].seq < state.orders[behind.order.id].seq,
       shrunk and tostring(shrunk.requeued))
    ok("releasing the difference back to the owner",
       players[ALICE].inventory.fire_berry == held + 6,
       players[ALICE].inventory.fire_berry - held)
    ok("and out of escrow with it",
       state.assets.fire_berry.escrow == 14, state.assets.fire_berry.escrow)

    local goldBefore = players[ALICE].gold
    local moved = EconomyEngine.amendOrder(state, players, ALICE, first.order.id,
      12, 4, T + 3, nil)
    ok("a new price is a new order at the back of the queue",
       moved and moved.requeued == true and moved.orderId ~= first.order.id,
       moved and moved.orderId)
    ok("that says what it replaced", moved and moved.amendedFrom == first.order.id,
       moved and moved.amendedFrom)
    -- The whole reason amend exists: cancel-and-replace costs two messages and
    -- two creation costs, which taxes the one behaviour a book cannot do
    -- without.
    ok("and costs nothing to move", players[ALICE].gold == goldBefore,
       goldBefore - players[ALICE].gold)
    ok("with the escrow still exactly the open size",
       state.assets.fire_berry.escrow == 14, state.assets.fire_berry.escrow)
  end

  do
    -- An amend that crosses trades, like any other order would.
    local state, players = world()
    place(state, players, BOB, "buy", "fire_berry", 12, 5, T)
    local ask = place(state, players, ALICE, "sell", "fire_berry", 20, 5, T + 1)
    local crossed = EconomyEngine.amendOrder(state, players, ALICE, ask.order.id,
      11, 5, T + 2, nil)
    ok("an amend that crosses fills", crossed and #crossed.fills == 1,
       crossed and #crossed.fills)
    ok("at the resting maker's price, not the amended one",
       crossed and crossed.fills[1].price == 12, crossed and crossed.fills[1].price)
  end

  -- 15. Batch cancel ----------------------------------------------------------
  do
    local state, players = world()
    for index = 1, 4 do
      place(state, players, ALICE, "sell", "fire_berry", 10 + index, 1, T)
    end
    place(state, players, ALICE, "sell", "water_berry", 10, 1, T)
    place(state, players, BOB, "sell", "fire_berry", 10, 1, T)

    local one = EconomyEngine.cancelOrders(state, players, ALICE,
      { item = "fire_berry" }, T + 1, nil)
    ok("cancel-all in one market leaves the others alone",
       one and one.cancelled == 4, one and one.cancelled)
    local mine, theirs = 0, 0
    for _, order in pairs(state.orders) do
      if order.account == ALICE then mine = mine + 1 else theirs = theirs + 1 end
    end
    ok("one of the account's own orders survives, in the other market", mine == 1, mine)
    ok("and nobody else's book was touched", theirs == 1, theirs)
    ok("with no item escrow stranded",
       state.assets.fire_berry.escrow == 1, state.assets.fire_berry.escrow)

    local none = EconomyEngine.cancelOrders(state, players, BOB,
      { ids = { "O9999" } }, T + 2, nil)
    ok("cancelling an id you do not own matches nothing", none == nil, none)
  end

  -- 16. The price band --------------------------------------------------------
  --
  -- Without one, `maxUnitPrice` is the only limit, so a single crossing order
  -- can print 1,000,000 -- and that print becomes the seven-day median that
  -- the chart, the desk view and the swarm all read as the truth.
  do
    local state, players = world()
    withHouse(state, "fire_berry")
    local wild = place(state, players, ALICE, "sell", "fire_berry", 1000000, 1, T)
    ok("a fat-fingered price is refused", wild == nil, wild)
    local low = place(state, players, ALICE, "sell", "fire_berry", 1, 20, T)
    ok("and so is one far below the corridor", low == nil, low)
    -- The corridor is anchored on the desk's OWN bid and ask, so it can never
    -- refuse a price the house itself is quoting.
    local sane = place(state, players, ALICE, "sell", "fire_berry", 14, 2, T)
    ok("a price beside the desk's own quote is taken",
       sane ~= nil and sane.order ~= nil, sane)
    local view = EconomyEngine.publicView(state, {}, {}, T)
    local band = view.market.fire_berry.band
    ok("and the corridor is published, so the ticket can say so first",
       band ~= nil and band.low > 0 and band.high > band.low,
       band and (band.low .. ".." .. band.high))
  end

  -- 17. The desk quotes into the book -----------------------------------------
  --
  -- Two tabs and two prices is a venue that asks the player to arbitrage it.
  -- One ladder with the house in it is a market, and the corridor then
  -- enforces itself: a taker gets whichever of desk-or-P2P is better without
  -- having to know there was a choice.
  do
    local state, players = world()
    withHouse(state, "fire_berry")
    local desk = state.desks.fire_berry
    -- Give the desk a shelf so it can quote an ask as well as a bid.
    state.assets.fire_berry.issued = state.assets.fire_berry.issued + 200
    state.assets.fire_berry.shop = 200
    desk.stock = 200

    local view = EconomyEngine.publicView(state, {}, {}, T)
    local stats = view.market.fire_berry
    ok("an empty book still has a two-sided quote",
       stats.bestBid ~= nil and stats.bestAsk ~= nil,
       tostring(stats.bestBid) .. "/" .. tostring(stats.bestAsk))
    ok("and the ladder says which of it is the house",
       stats.depth.bids[1] and stats.depth.bids[1].house ~= nil,
       stats.depth.bids[1] and stats.depth.bids[1].house)

    -- THE INVARIANT ORDERBOOK.md ASKS FOR BY NAME. While a player's quote sits
    -- inside the desk's band the desk is never the best price on either side;
    -- the moment it leaves the band, the desk is.
    local inside = (stats.houseBid + stats.houseAsk) // 2
    place(state, players, ALICE, "buy", "fire_berry", inside, 2, T + 1)
    local tight = EconomyEngine.publicView(state, {}, {}, T + 1).market.fire_berry
    ok("a player quoting inside the corridor is the best bid, not the desk",
       tight.bestBid == tight.p2pBid and tight.p2pBid > tight.houseBid,
       tostring(tight.p2pBid) .. " vs house " .. tostring(tight.houseBid))
    ok("and the desk is still there underneath it",
       tight.houseBid ~= nil and tight.houseAskUnits > 0, tight.houseAskUnits)
  end

  do
    -- A taker takes the better of the two without choosing a venue.
    local state, players = world()
    withHouse(state, "fire_berry")
    local desk = state.desks.fire_berry
    -- A shelf parked in the middle of a band, not on its edge. The desk
    -- reprices against its own stock after every single unit, so a fill that
    -- starts on a boundary sweeps into the next band and stops -- which is
    -- correct, and is a different test from this one.
    state.assets.fire_berry.issued = state.assets.fire_berry.issued + 100
    state.assets.fire_berry.shop = 100
    desk.stock = 100
    local stock, reserve = desk.stock, desk.goldReserve
    local askBefore = EconomyEngine.publicView(state, {}, {}, T).market.fire_berry.houseAsk

    -- Nobody else is quoting, so the only liquidity is the house.
    -- Priced AT the desk's ask: the corridor is anchored on the desk's own
    -- quote, so there is no room above it to offer more, which is the guard
    -- working rather than getting in the way.
    local bought = place(state, players, BOB, "buy", "fire_berry", askBefore, 3, T)
    ok("a taker fills against the house when the book is empty",
       bought and #bought.fills == 1 and bought.fills[1].maker == "desk",
       bought and bought.fills[1] and bought.fills[1].maker)
    ok("at the desk's price, not the price they offered",
       bought.fills[1].price == askBefore, bought.fills[1].price)
    ok("and the desk's shelf is what paid for it",
       desk.stock == stock - 3, stock - desk.stock)
    ok("with the Gold landing in the desk's reserve",
       desk.goldReserve > reserve, desk.goldReserve - reserve)
    -- Both routes to the desk consume the same 20-hour allowance, or one shelf
    -- gets drained twice for the same inventory.
    local window = T // C.ECONOMY.shop.accountWindow
    ok("and the same 20-hour allowance the Shop tab spends",
       desk.accountUsage[BOB] and desk.accountUsage[BOB].window == window
         and desk.accountUsage[BOB].buy == 3,
       desk.accountUsage[BOB] and desk.accountUsage[BOB].buy)
    ok("nothing is left in escrow after a house fill",
       state.gold.escrow == 0, state.gold.escrow)
    local invariants = EconomyEngine.invariants(state, {}, {})
    ok("and the conservation invariants still hold",
       invariants.gold.ok and invariants.assets.fire_berry.ok,
       invariants.gold.difference .. "/" .. invariants.assets.fire_berry.difference)
  end

  do
    -- A resting player order at the same price beats the house, always. It was
    -- there first, and the desk's job is to be the price you get when nobody
    -- better is quoting.
    local state, players = world()
    withHouse(state, "fire_berry")
    local desk = state.desks.fire_berry
    state.assets.fire_berry.issued = state.assets.fire_berry.issued + 100
    state.assets.fire_berry.shop = 100
    desk.stock = 100
    local ask = EconomyEngine.publicView(state, {}, {}, T).market.fire_berry.houseAsk
    place(state, players, ALICE, "sell", "fire_berry", ask, 4, T)
    local taken = place(state, players, BOB, "buy", "fire_berry", ask, 4, T + 1)
    ok("the player at the same price is filled, not the desk",
       taken and #taken.fills == 1 and taken.fills[1].maker == ALICE,
       taken and taken.fills[1] and taken.fills[1].maker)
    ok("and the desk's stock is untouched", desk.stock == 100, desk.stock)
  end

  -- 18. Candles and a trader's own fills ---------------------------------------
  do
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 2, T)
    place(state, players, BOB, "buy", "fire_berry", 10, 2, T + 1)
    place(state, players, ALICE, "sell", "fire_berry", 14, 5, T + 2)
    place(state, players, BOB, "buy", "fire_berry", 14, 1, T + 3)
    local bars = EconomyEngine.publicView(state, {}, {}, T + 4).candles.fire_berry
    ok("the day has a candle", bars ~= nil and #bars == 1, bars and #bars)
    ok("that opens on the first print and closes on the last",
       bars[1].o == 10 and bars[1].c == 14, bars[1].o .. "/" .. bars[1].c)
    ok("with the high, the low and the volume",
       bars[1].h == 14 and bars[1].l == 10 and bars[1].v == 3,
       bars[1].h .. "/" .. bars[1].l .. "/" .. bars[1].v)

  end

  -- 19. The book index -------------------------------------------------------
  --
  -- The index is a second arrangement of `state.orders`: market, side, price,
  -- and a live count per account. It exists because every question the
  -- matching path asks used to be answered by walking every resting order in
  -- the process -- five walks and two sorts to place one order, one more per
  -- fill, and one per market on every read.
  --
  -- Everything below is about the two ways a derived structure goes wrong. It
  -- can be MISSING, which is the normal state of a process restored from an
  -- export or an `Admin.Load`, and it can be WRONG, which is worse than slow:
  -- an order left in the index after its escrow was returned is matchable
  -- against money that is no longer there.
  do
    local json = require(".json")

    -- It is derived, so it is not exported. Exporting it would double what a
    -- migration carries, for something the import rebuilds from the same rows.
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    place(state, players, ALICE, "sell", "fire_berry", 12, 5, T + 1)
    local exported = EconomyEngine.exportState(state)
    ok("an export carries no index", exported.bookIndex == nil,
       exported.bookIndex ~= nil and "present" or "absent")
    ok("but it does carry the orders the index is built from",
       exported.orders.O1 ~= nil and exported.orders.O2 ~= nil)

    -- The import rebuilds it, and the proof is that the book still matches.
    local restored = EconomyEngine.importState(nil, exported)
    ok("an import builds one", type(restored.bookIndex) == "table",
       type(restored.bookIndex))
    local result = EconomyEngine.placeOrder(restored, players, BOB, "buy",
      "fire_berry", 12, 5, T + 2, nil)
    ok("and the restored book matches at the resting price",
       result ~= nil and #result.fills == 1 and result.fills[1].price == 10,
       result and result.fills[1] and result.fills[1].price)

    -- The same again, but with the index deleted from under a live state --
    -- which is what a process loaded from an older export looks like the
    -- instant before it does anything.
    local cold, coldPlayers = world()
    place(cold, coldPlayers, ALICE, "sell", "fire_berry", 9, 4, T)
    cold.bookIndex = nil
    cold = EconomyEngine.ensureState(cold)
    ok("ensureState rebuilds an index that is not there",
       type(cold.bookIndex) == "table" and cold.bookIndex.open == 1,
       cold.bookIndex and cold.bookIndex.open)
    local coldFill = EconomyEngine.placeOrder(cold, coldPlayers, BOB, "buy",
      "fire_berry", 9, 4, T + 1, nil)
    ok("and an order placed against the rebuilt index fills",
       coldFill ~= nil and #coldFill.fills == 1 and coldFill.fills[1].quantity == 4,
       coldFill and coldFill.fills[1] and coldFill.fills[1].quantity)
  end

  do
    -- A warm index and a cold one must not disagree about anything. The same
    -- sequence twice: once against a book that built its index as it went,
    -- once against a book whose index is thrown away before every action.
    local warm, warmPlayers = world()
    local cold, coldPlayers = world()
    local script = {
      { ALICE, "sell", 12, 5 }, { ALICE, "sell", 10, 5 }, { CAROL, "sell", 10, 3 },
      { BOB, "buy", 11, 6 }, { BOB, "buy", 13, 4 }, { ALICE, "sell", 11, 2 },
    }
    local warmFills, coldFills = {}, {}
    local record = function(into, outcome)
      for _, fill in ipairs(outcome and outcome.fills or {}) do
        into[#into + 1] = fill.price .. "x" .. fill.quantity .. ":" ..
          tostring(fill.maker) .. "/" .. tostring(fill.taker)
      end
    end
    for index, step in ipairs(script) do
      record(warmFills, place(warm, warmPlayers, step[1], step[2], "fire_berry",
        step[3], step[4], T + index))
      cold.bookIndex = nil
      record(coldFills, place(cold, coldPlayers, step[1], step[2], "fire_berry",
        step[3], step[4], T + index))
    end
    ok("a cold index fills as often as a warm one",
       #warmFills == #coldFills and #warmFills > 0, #warmFills .. "/" .. #coldFills)
    ok("and every fill is the same trade at the same price",
       table.concat(warmFills, ",") == table.concat(coldFills, ","),
       table.concat(warmFills, ","))
  end

  do
    -- The index must not be published. It is the book again in a different
    -- arrangement, and every published byte is marshalled five times on every
    -- slot for everybody -- so a fast book that published its index would have
    -- made every battle round slower to make the market screen quicker.
    local json = require(".json")
    local state, players = world()
    -- One account holding the whole book, so the count below is a statement
    -- about the index rather than about the per-account cap.
    cfg.maxPerAccount = 1000
    for index = 1, 400 do
      place(state, players, ALICE, "sell", "fire_berry", 10 + (index % 20), 1,
        T + index)
    end
    cfg.maxPerAccount = originalPerAccount
    ok("four hundred orders are resting",
       EconomyEngine.accountOpenCount(state, ALICE) == 400,
       EconomyEngine.accountOpenCount(state, ALICE))
    local withIndex = #json.encode(EconomyEngine.publicView(state, {}, {}, T + 500))
    state.bookIndex = nil
    local without = #json.encode(EconomyEngine.publicView(state, {}, {}, T + 500))
    ok("the published view is the same size with the index and without it",
       withIndex == without, withIndex .. " vs " .. without)
    -- Printed rather than asserted against a literal: the number moves
    -- whenever a published FIELD changes, which is a different review from
    -- this one. What must never move is the comparison above.
    out[#out + 1] = "      (400 resting orders publish " .. withIndex .. " bytes)"
  end

  do
    -- Per-market invalidation. The ladder is cached against the market's own
    -- revision, so a trade somewhere else must neither change what this market
    -- says nor leave it publishing what it said before.
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    place(state, players, ALICE, "sell", "water_berry", 20, 5, T + 1)
    local before = EconomyEngine.publicView(state, {}, {}, T + 2).market.fire_berry
    place(state, players, BOB, "buy", "water_berry", 20, 5, T + 3)
    local after = EconomyEngine.publicView(state, {}, {}, T + 2).market.fire_berry
    ok("a trade in another market leaves this one's best ask alone",
       before.bestAsk == after.bestAsk and after.bestAsk == 10, after.bestAsk)
    ok("and its depth alone",
       #before.depth.asks == #after.depth.asks
       and before.depth.asks[1].quantity == after.depth.asks[1].quantity,
       after.depth.asks[1] and after.depth.asks[1].quantity)
    local water = EconomyEngine.publicView(state, {}, {}, T + 4).market.water_berry
    ok("while the market that traded is empty again", water.bestAsk == nil,
       tostring(water.bestAsk))
  end

  do
    -- An amend moves an order. If the index keeps the old price the book will
    -- happily trade at a price its owner withdrew, which is the whole reason
    -- every write to `state.orders` goes through one pair of functions.
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 20, 5, T)
    local amended = EconomyEngine.amendOrder(state, players, ALICE, "O1", 12, 5,
      T + 1, nil, {})
    ok("the amend is taken", amended ~= nil and amended.orderId ~= nil,
       amended and amended.orderId)
    local low = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      11, 5, T + 2, nil)
    ok("a bid below the new price does not trade",
       low ~= nil and #low.fills == 0, low and #low.fills)
    EconomyEngine.cancelOrder(state, players, BOB, low.order.id, T + 3, nil)
    local high = EconomyEngine.placeOrder(state, players, BOB, "buy", "fire_berry",
      12, 5, T + 4, nil)
    ok("and a bid at it does", high ~= nil and #high.fills == 1
       and high.fills[1].price == 12, high and high.fills[1] and high.fills[1].price)
  end

  do
    -- Cancel-all returns escrow. An order the index still held afterwards
    -- would be matchable against money that has already gone back.
    local state, players = world()
    place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    place(state, players, ALICE, "sell", "fire_berry", 11, 5, T + 1)
    place(state, players, CAROL, "sell", "fire_berry", 12, 5, T + 2)
    local cleared = EconomyEngine.cancelOrders(state, players, ALICE, {}, T + 3, nil)
    ok("both of the account's orders are cancelled",
       cleared ~= nil and cleared.cancelled == 2, cleared and cleared.cancelled)
    ok("and the index has forgotten them",
       EconomyEngine.accountOpenCount(state, ALICE) == 0,
       EconomyEngine.accountOpenCount(state, ALICE))
    local sweep = EconomyEngine.placeOrder(state, players, BOB, "buy",
      "fire_berry", 12, 15, T + 4, nil)
    ok("a taker sweeping the book only reaches what is left",
       sweep ~= nil and #sweep.fills == 1 and sweep.fills[1].price == 12,
       sweep and sweep.fills[1] and sweep.fills[1].price)
    ok("and nothing of the cancelled account's is left in item escrow",
       state.assets.fire_berry.escrow == 0, state.assets.fire_berry.escrow)
  end

  do
    -- The three accessors a player view reads instead of walking the book.
    -- Nil rather than an empty table, because these go into `player-<address>`
    -- and an empty array is bytes every wallet pays for on every slot.
    local state, players = world()
    ok("a wallet that has never traded counts zero",
       EconomyEngine.accountOpenCount(state, BOB) == 0)
    ok("and is given nothing rather than an empty list",
       EconomyEngine.accountOrders(state, BOB, T) == nil
       and EconomyEngine.accountFills(state, BOB, 20) == nil)
    place(state, players, ALICE, "sell", "fire_berry", 10, 5, T)
    place(state, players, ALICE, "sell", "fire_berry", 12, 5, T + 1)
    ok("an open order is counted",
       EconomyEngine.accountOpenCount(state, ALICE) == 2,
       EconomyEngine.accountOpenCount(state, ALICE))
    local mine = EconomyEngine.accountOrders(state, ALICE, T + 2)
    ok("and returned newest first", mine ~= nil and #mine == 2
       and mine[1].id == "O2", mine and mine[1] and mine[1].id)
    place(state, players, BOB, "buy", "fire_berry", 10, 5, T + 3)
    local traded = EconomyEngine.accountFills(state, BOB, 20)
    ok("a taker's own fill is on their ring", traded ~= nil and #traded == 1
       and traded[1].price == 10, traded and traded[1] and traded[1].price)
    ok("and so is the maker's",
       (EconomyEngine.accountFills(state, ALICE, 20) or {})[1] ~= nil)
    ok("the fill names the market it happened on rather than leaving it to be guessed",
       traded[1].market == "fire_berry/gold", traded[1].market)
    for index = 1, 40 do
      place(state, players, ALICE, "sell", "fire_berry", 10, 1, T + 10 + index * 2)
      place(state, players, BOB, "buy", "fire_berry", 10, 1, T + 11 + index * 2)
    end
    local many = EconomyEngine.accountFills(state, BOB, 20)
    ok("and a caller never gets more rows than it asked for", #many == 20, #many)
  end

  do
    -- The sweep. It is bounded, it returns what it released, and it no longer
    -- sorts every id in the process to find twenty-five of them.
    local state, players = world()
    cfg.expiry = 1000
    cfg.minExpiry = 1
    cfg.maxPerAccount = 1000
    for index = 1, 30 do
      place(state, players, ALICE, "sell", "fire_berry", 10, 1, T + index)
    end
    cfg.expiry = originalExpiry
    cfg.minExpiry = originalMinExpiry
    cfg.maxPerAccount = originalPerAccount
    local late = T + 100000
    ok("nothing expired is still countable",
       EconomyEngine.accountOpenCount(state, ALICE, late) == 0,
       EconomyEngine.accountOpenCount(state, ALICE, late))
    local released = EconomyEngine.maintain(state, players, late, 25)
    ok("a bounded sweep releases at most its limit", released == 25, released)
    local rest = EconomyEngine.maintain(state, players, late, 25)
    ok("and the next one takes the remainder", rest == 5, rest)
    ok("with nothing left to sweep",
       EconomyEngine.maintain(state, players, late, 25) == 0)
    ok("and every unit of item escrow returned",
       state.assets.fire_berry.escrow == 0, state.assets.fire_berry.escrow)
  end

  cfg.historyLimit = originalHistory
  cfg.expiry = originalExpiry
  cfg.minExpiry = originalMinExpiry
  cfg.maxPerAccount = originalPerAccount

  -- 12. The emission schedule ------------------------------------------------
  --
  -- The supply guarantee, and nothing else pinned it. Total Rune ever minted is
  -- `lifetime per account x passes ever sold`, and that is only true if the
  -- per-account rate really does halve to nothing on the clock.
  --
  -- The halving lives on the PER-ACCOUNT rate, not on the global ceiling.
  -- Putting it on the ceiling alone -- which is what the first version did --
  -- leaves the rate flat forever AND strangles the game, because a 2,000
  -- ceiling pays 48 to 41 accounts and 20 after one halving. Both halves of
  -- that are asserted below.
  do
    local YEAR = 365 * 24 * 3600 * 1000
    local state = EconomyEngine.ensureState(nil)
    local genesis = T
    -- Stamp the schedule's start; it is set on first read.
    EconomyEngine.emissionPerAccount(state, genesis)

    local expected = { [0] = 48, [1] = 24, [2] = 12, [3] = 6, [4] = 3, [5] = 1, [6] = 0 }
    local walked = true
    for years = 0, 6 do
      local rate = EconomyEngine.emissionPerAccount(state, genesis + years * YEAR)
      if rate ~= expected[years] then walked = false end
    end
    ok("the per-account rate halves 48, 24, 12, 6, 3, 1, 0 by year", walked,
       EconomyEngine.emissionPerAccount(state, genesis + 5 * YEAR) .. " at year 5")
    ok("and stays at zero once the schedule has completed",
       EconomyEngine.emissionPerAccount(state, genesis + 40 * YEAR) == 0,
       EconomyEngine.emissionPerAccount(state, genesis + 40 * YEAR))
    -- Integer division, never `/`. A float rate would be stored as 24.0 and
    -- every downstream number would carry the decimal forever.
    ok("the rate is an integer at every step",
       math.type(EconomyEngine.emissionPerAccount(state, genesis + 3 * YEAR)) == "integer",
       math.type(EconomyEngine.emissionPerAccount(state, genesis + 3 * YEAR)))

    -- The ceiling must never be the thing that decides what an account is paid.
    -- It is a circuit breaker: it has to sit above what the schedule could
    -- legitimately owe every passholder, so it scales with the population the
    -- per-account rate does NOT divide by.
    state.policy.passes.lifetimePassCount = 5000
    local budget = EconomyEngine.emissionBudget(state, genesis)
    local rate = EconomyEngine.emissionPerAccount(state, genesis)
    ok("the epoch ceiling covers every passholder at the current rate",
       budget >= rate * 5000, budget .. " vs " .. (rate * 5000))
    ok("so the ceiling never rations a claim in normal operation",
       budget > rate, budget .. " vs " .. rate)
  end

  -- Nothing here may grow without a bound the reader agrees with -------------
  --
  -- Every message pays for the whole of `EconomyState`, five times over, and
  -- Luerl's collector is quadratic in the number of live tables on top of that.
  -- Three maps in here grew forever, each for a different reason, and each of
  -- them is cheap enough per entry that nothing noticed until the entries were
  -- counted.
  do
    -- A refusal must not be able to mint a permanent key ---------------------
    --
    -- `state.rejected` is a histogram nothing removes from and everything
    -- publishes. Four of the refusals interpolate a live, market-derived price
    -- into the message, so out-of-band order spam wrote a new permanent key
    -- every time the band moved -- from an action that is REFUSED, and so costs
    -- the sender nothing at all.
    local state, players = world()
    local market = withHouse(state, "fire_berry")
    market.bandBps = 100

    -- Three refusals at three different prices, which under the old key were
    -- three different bands and therefore three permanent keys.
    for _, price in ipairs({ 90000, 91000, 92000 }) do
      EconomyEngine.placeOrder(state, players, ALICE, "buy", "fire_berry",
        price, 1, T, nil)
    end
    local bandKeys, bandCount = 0, 0
    for reason, count in pairs(state.rejected) do
      if string.find(reason, "Gold price band", 1, true) then
        bandKeys = bandKeys + 1
        bandCount = bandCount + count
      end
    end
    ok("three refusals at three prices are ONE rejection key", bandKeys == 1, bandKeys)
    ok("and all three are still counted under it", bandCount == 3, bandCount)
    local hasDigits = false
    for reason in pairs(state.rejected) do
      if string.find(reason, "%d") then hasDigits = true end
    end
    ok("no rejection key carries an interpolated number at all",
       not hasDigits, tostring(hasDigits))
    -- Counts are integers. `math.type` is meaningful here because this reads
    -- the Lua value directly rather than anything that has been through JSON.
    local anyCount
    for _, count in pairs(state.rejected) do anyCount = count end
    ok("a rejection count is an integer", math.type(anyCount) == "integer",
       math.type(anyCount))

    -- The player is still told the real number -------------------------------
    --
    -- The key is a bucket; the message is not. Collapsing one must not blunt
    -- the other, or a trader is told their price is outside "the # Gold band".
    local _, problem = EconomyEngine.placeOrder(state, players, ALICE, "buy",
      "fire_berry", 93000, 1, T, nil)
    ok("but the refusal shown to the trader still names the real band",
       type(problem) == "string" and string.find(problem, "%d") ~= nil, problem)

    -- Desk usage rows are dropped when their window rolls --------------------
    --
    -- `accountUsage` only ever had a REPLACEMENT rule, so an account that
    -- traded a desk once and never came back kept a row for the life of the
    -- process, six desks over. Every reader already checks `window` before
    -- believing a row, which is what makes deleting a stale one a no-op for
    -- every answer and a saving on every message.
    do
      local usageState, usagePlayers = world()
      local desk = usageState.desks.fire_berry
      local window = C.ECONOMY.shop.accountWindow
      -- Three traders in one window. Selling INTO the desk, which is the
      -- direction that does not depend on the desk holding stock.
      for _, who in ipairs({ ALICE, BOB, CAROL }) do
        local _, why = EconomyEngine.shopTrade(usageState, usagePlayers, {}, {},
          who, "fire_berry", "sell", 1, T, "usage-" .. who)
        ok("a desk sale is accepted", why == nil, tostring(why))
      end
      local held = 0
      for _ in pairs(desk.accountUsage) do held = held + 1 end
      ok("a desk holds a usage row per account that traded it", held == 3, held)

      -- One trader comes back a window later. The other two do not.
      local later = T + window + 1
      EconomyEngine.shopTrade(usageState, usagePlayers, {}, {},
        ALICE, "fire_berry", "sell", 1, later, "usage-later")
      local kept, names = 0, {}
      for account, row in pairs(desk.accountUsage) do
        kept = kept + 1
        names[#names + 1] = account
        ok("every surviving usage row belongs to the current window",
           math.type(row.window) == "integer" and row.window == later // window,
           tostring(row.window))
      end
      ok("rows from a closed window are gone", kept == 1 and names[1] == ALICE,
         kept .. " " .. tostring(names[1]))
    end

    -- A trader's fill ring does not outlive them forever ---------------------
    --
    -- `index.trades` was capped at 24 fills per account and then kept for the
    -- life of the process -- and those 24 fill tables are ones `appendBounded`
    -- had already evicted from `state.fills`, so the 500-row cap on the shared
    -- list was not capping anything. A bound something else keeps alive is not
    -- a bound.
    do
      local ringState, ringPlayers = world()
      place(ringState, ringPlayers, ALICE, "sell", "fire_berry", 10, 1, T)
      place(ringState, ringPlayers, BOB, "buy", "fire_berry", 10, 1, T)
      local index = ringState.bookIndex
      ok("a fill gives both sides a ring",
         index and index.trades[ALICE] ~= nil and index.trades[BOB] ~= nil,
         index and index.trades[ALICE] and #index.trades[ALICE])
      ok("and a trader can read their own fills back",
         EconomyEngine.accountFills(ringState, ALICE) ~= nil,
         tostring(EconomyEngine.accountFills(ringState, ALICE) ~= nil))

      -- Two months later, two other traders cross. Neither has anything to do
      -- with the first pair, and the first pair's rings go with the sweep.
      local muchLater = T + 60 * 24 * 3600 * 1000
      place(ringState, ringPlayers, CAROL, "sell", "fire_berry", 10, 1, muchLater)
      place(ringState, ringPlayers, BOB, "buy", "fire_berry", 10, 1, muchLater)
      ok("a ring nobody has added to in a month is dropped",
         ringState.bookIndex.trades[ALICE] == nil,
         tostring(ringState.bookIndex.trades[ALICE] ~= nil))
      ok("a trader who came back keeps theirs",
         ringState.bookIndex.trades[BOB] ~= nil
         and ringState.bookIndex.trades[CAROL] ~= nil,
         ringState.bookIndex.trades[CAROL] and #ringState.bookIndex.trades[CAROL])
    end
  end

  out[#out + 1] = ""
  out[#out + 1] = passed .. " passed, " .. failed .. " failed"
  return table.concat(out, "\n")
end

return run
