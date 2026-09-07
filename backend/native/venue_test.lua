--- venue_test.lua -- both venues, driven through `compute` the way a node does.
---
--- This file spawns the venue TWICE in one run: once as the internal venue
--- talking to a fake game process, once as the external venue talking to two
--- fake token processes. It has to, because the whole design claim is that the
--- two are one file whose custody halves cannot reach each other -- and the
--- only way to test that claim is to have both alive at once and check that
--- each refuses the other's verbs.
---
--- Run with ./run-venue-test.sh (live node) or
--- `npm run test:venue:local` (offline, checked-in WASM).
---
--- Same Luerl rules as everything else: no goto, no table.move, narrow every
--- number through `int()`, and assert on the RAW reply text wherever a number
--- has to be proven integral -- json turns every number into a float on the
--- way back, so `math.type` on a decoded value proves nothing.

local function run()
  local out = {}
  local passed, failed = 0, 0
  local function ok(label, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    out[#out + 1] = (cond and "PASS  " or "FAIL  ") .. label ..
      (extra ~= nil and ("  <- " .. tostring(extra)) or "")
  end

  local json = require(".json")
  local T = 1700000000000

  local OWNER  = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local GAME   = "GAMEggggggggggggggggggggggggggggggggggggggg"
  local RUNE   = "RUNEtokennnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"
  local RELIC  = "RELICtokennnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"
  local SCHED  = "SCHEDulerrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"
  local ALICE  = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local BOB    = "BOBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  local MALLORY = "MALLORYmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"

  --- The process definition the venue reads its owner off, plus the scheduler
  --- that is allowed to vouch for a delivery. Both are what a live node
  --- attaches; the suite has to attach them too or `sourceProcess` believes
  --- nobody and every cross-process test passes for the wrong reason.
  local PROCESS = {
    commitments = { sig1 = { committer = OWNER, alg = "rsa-pss-sha512" } },
    ["scheduler-location"] = SCHED,
  }
  local function baseOf()
    return { process = PROCESS, ["scheduler-location"] = SCHED }
  end

  --- A wallet message: signed by a real algorithm, which is the only thing
  --- `provenSigner` accepts.
  local function send(from, tags)
    T = T + 1000
    local body = { commitments = { sig1 = { committer = from, alg = "rsa-pss-sha512" } } }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute(baseOf(), { body = body, timestamp = T })
    return json.decode(res.results.output.data), res
  end

  --- A DELIVERY from another process: signed by our own scheduler, carrying
  --- `from-process`. That is exactly the shape a real outbox push arrives in,
  --- and the only shape `sourceProcess` will believe.
  local function deliver(fromProcess, tags)
    T = T + 1000
    local body = {
      commitments = { sig1 = { committer = SCHED, alg = "rsa-pss-sha512" } },
      ["from-process"] = fromProcess,
    }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute(baseOf(), { body = body, timestamp = T })
    return json.decode(res.results.output.data), res
  end

  --- A FORGED delivery: an ordinary wallet message that merely claims to come
  --- from a process. Our scheduler did not sign it, so `from-process` is inert.
  local function forge(from, fromProcess, tags)
    T = T + 1000
    local body = {
      commitments = { sig1 = { committer = from, alg = "rsa-pss-sha512" } },
      ["from-process"] = fromProcess,
    }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute(baseOf(), { body = body, timestamp = T })
    return json.decode(res.results.output.data), res
  end

  local function errOf(r) return type(r) == "table" and r.error or nil end
  local function num(s) return math.tointeger(tonumber(s or "0")) end

  --- A reply's free balance in one asset, nil-safely.
  ---
  --- Reaching straight into `r.account.free.rune` is how a suite turns one
  --- refused order into a runtime error that hides every assertion after it.
  --- This reports zero instead, so the FAIL names the reply that caused it.
  local function freeOf(r, asset)
    local account = type(r) == "table" and r.account or nil
    local free = type(account) == "table" and account.free or nil
    return num(type(free) == "table" and free[asset] or "0")
  end

  --- The first fill on a reply, nil-safely.
  local function fillOf(r, at)
    local order = type(r) == "table" and r.order or nil
    local fills = type(order) == "table" and order.fills or nil
    return type(fills) == "table" and fills[at or 1] or nil
  end

  local function fillCount(r)
    local order = type(r) == "table" and r.order or nil
    local fills = type(order) == "table" and order.fills or nil
    return type(fills) == "table" and #fills or 0
  end

  --- An outbox entry off the RAW result, nil-safely. A refused verb answers
  --- with no outbox at all, and reaching into one that is not there hides
  --- every assertion after it behind a runtime error.
  local function sent(res, key)
    local results = type(res) == "table" and res.results or nil
    local outbox = type(results) == "table" and results.outbox or nil
    return type(outbox) == "table" and outbox[key] or {}
  end

  --- Wipe the process back to a fresh spawn. This suite deploys the venue
  --- twice in one Lua VM, which is the only way to prove the two modes cannot
  --- reach each other's verbs.
  local function respawn()
    VenueMode = nil
    VenueSealed = false
    VenueName = "TEST-Rune Realm Venue"
    GameProcess = ""
    Assets = {}
    AssetByProcess = {}
    Ledger = {}
    Book = nil
    Deposits = {}
    Withdrawals = {}
    WithdrawSeq = 0
    Emergency = { paused = false, reason = "", scope = "trading", at = 0 }
    Owner = nil
  end

  -- =========================================================================
  -- THE INTERNAL VENUE: in-game assets, moved by trusted message, never tokens
  -- =========================================================================

  respawn()

  local r = send(OWNER, { Action = "Info" })
  ok("a fresh venue has no mode", r and r.Mode == "", r and r.Mode)
  ok("and the owner came off the process commitment", r and r.Owner == OWNER, r and r.Owner)

  r = send(ALICE, { Action = "Admin.Configure", Mode = "internal", GameProcess = GAME })
  ok("a stranger cannot configure the venue", errOf(r) == "Not authorised", json.encode(r))

  r = send(OWNER, { Action = "Admin.Configure", Mode = "internal",
    Name = "TEST-Rune Realm Internal Venue", GameProcess = GAME })
  ok("the owner sets the mode", r and r.info and r.info.Mode == "internal",
     r and r.info and r.info.Mode)
  ok("and names the one process it will listen to",
     r and r.info and r.info.GameProcess == GAME, r and r.info and r.info.GameProcess)

  -- An in-game asset is a NAME. There is no process behind it and there is
  -- never going to be one; §5.
  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "gold", Name = "Gold" })
  ok("an in-game asset lists with no process at all",
     r and r.asset and r.asset.kind == "game", json.encode(r))
  ok("and carries no process id to be confused for a token",
     r and r.asset and r.asset.process == nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "fire_berry", Name = "Fire Berry" })
  ok("a second in-game asset lists", r and r.asset and r.asset.id == "fire_berry", json.encode(r))

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "Fire Berry" })
  ok("an asset id may not carry spaces or capitals", errOf(r) ~= nil, json.encode(r))

  -- Markets are created closed and launched deliberately -----------------------

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "fire_berry", Quote = "gold",
    Tick = "1", Lot = "1", MinValue = "1" })
  ok("a market is created", r and r.market and r.market.id == "fire_berry/gold", json.encode(r))
  ok("and it is CLOSED until somebody launches it",
     r and r.market and r.market.status == "closed", r and r.market and r.market.status)

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "fire_berry", Quote = "gold" })
  ok("the same market cannot be created twice", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "scroll", Quote = "gold" })
  ok("a market cannot name an unlisted asset", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "gold", Quote = "gold" })
  ok("a market cannot trade an asset against itself", errOf(r) ~= nil, json.encode(r))

  -- Deposits: only the game, only once ---------------------------------------

  r = send(ALICE, { Action = "Venue.Credit", Account = ALICE, Asset = "gold",
    Quantity = "1000", Reference = "d1" })
  ok("a wallet cannot credit itself", errOf(r) == "Not authorised", json.encode(r))

  r = forge(MALLORY, GAME, { Action = "Venue.Credit", Account = MALLORY, Asset = "gold",
    Quantity = "1000000", Reference = "d2" })
  ok("nor can a wallet that merely CLAIMS to be the game",
     errOf(r) == "Not authorised", json.encode(r))

  r = deliver(RUNE, { Action = "Venue.Credit", Account = ALICE, Asset = "gold",
    Quantity = "1000", Reference = "d3" })
  ok("nor can a different process, even an attested one",
     errOf(r) == "Not authorised", json.encode(r))

  r = deliver(GAME, { Action = "Venue.Credit", Account = ALICE, Asset = "gold",
    Quantity = "1000" })
  ok("a credit with no reference is refused outright", errOf(r) ~= nil, json.encode(r))

  r = deliver(GAME, { Action = "Venue.Credit", Account = ALICE, Asset = "gold",
    Quantity = "1000", Reference = "d4" })
  ok("the game credits a player", r and r.deposit and r.deposit.status == "credited",
     json.encode(r and r.deposit))
  ok("and the balance is there", r and r.account and r.account.free
     and num(r.account.free.gold) == 1000, json.encode(r and r.account))

  local _, raw = send(ALICE, { Action = "Balance" })
  ok("a balance is published as an integer string, not a float",
     string.find(raw["balance-" .. ALICE] or "", '"1000"', 1, true) ~= nil,
     raw["balance-" .. ALICE])

  r = deliver(GAME, { Action = "Venue.Credit", Account = ALICE, Asset = "gold",
    Quantity = "1000", Reference = "d4" })
  ok("the same reference delivered twice pays once",
     r and r.unchanged == true, json.encode(r))
  r = send(ALICE, { Action = "Balance" })
  ok("and the balance did not move", r and num(r.free.gold) == 1000, json.encode(r and r.free))

  r = deliver(GAME, { Action = "Venue.Credit", Account = ALICE, Asset = "scroll",
    Quantity = "5", Reference = "d5" })
  ok("a credit in an unlisted asset is QUARANTINED, never refused",
     r and r.deposit and r.deposit.status == "unresolved", json.encode(r and r.deposit))
  ok("and it names why", r and r.deposit and r.deposit.reason ~= nil, json.encode(r and r.deposit))

  r = deliver(GAME, { Action = "Venue.Credit", Account = "nope", Asset = "gold",
    Quantity = "5", Reference = "d6" })
  ok("so is a credit that names no account",
     r and r.deposit and r.deposit.status == "unresolved", json.encode(r and r.deposit))

  -- Fund both sides, then trade ----------------------------------------------

  deliver(GAME, { Action = "Venue.Credit", Account = ALICE, Asset = "fire_berry",
    Quantity = "500", Reference = "d7" })
  deliver(GAME, { Action = "Venue.Credit", Account = BOB, Asset = "gold",
    Quantity = "5000", Reference = "d8" })

  r = send(ALICE, { Action = "Order.Place", Side = "sell", Item = "fire_berry",
    Price = "10", Quantity = "20" })
  ok("nothing trades on a market that has not launched", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Admin.LaunchAll" })
  ok("a stranger cannot launch the venue", errOf(r) == "Not authorised", json.encode(r))

  r = send(OWNER, { Action = "Admin.LaunchAll" })
  ok("the owner launches every market at once",
     r and r.opened and #r.opened == 1 and r.opened[1] == "fire_berry/gold",
     json.encode(r and r.opened))

  r = send(ALICE, { Action = "Order.Place", Side = "sell", Item = "fire_berry",
    Price = "10", Quantity = "20" })
  ok("an ask rests", r and r.order and r.order.open == true, json.encode(r and r.order))
  ok("and the escrow left the free balance", freeOf(r, "fire_berry") == 480,
     json.encode(r))

  local fillRes
  r, fillRes = send(BOB, { Action = "Order.Place", Side = "buy", Item = "fire_berry",
    Price = "10", Quantity = "20", Tif = "ioc" })
  ok("a taker fills against it", fillCount(r) == 1, json.encode(r))
  ok("and pays the resting price", num((fillOf(r) or {}).price) == 10, json.encode(r))
  ok("the buyer has the berries", freeOf(r, "fire_berry") == 20, json.encode(r))
  local makerPosition = json.decode(fillRes["balance-" .. ALICE] or "{}")
  ok("a taker fill republishes the resting maker's complete position",
     makerPosition and makerPosition.free and num(makerPosition.free.gold) == 1199
       and makerPosition.fills and #makerPosition.fills == 1,
     json.encode(makerPosition))

  r = send(ALICE, { Action = "Balance" })
  ok("and the seller has the Gold", r and num(r.free.gold) == 1199,
     json.encode(r and r.free))

  -- 1,199 rather than 1,200: the order-creation cost is 1 Gold and Alice paid
  -- it when she rested the ask. Naming the number here is deliberate -- it is
  -- the one place the venue charges anything at all.

  -- Withdrawing: free means free ---------------------------------------------

  r = send(ALICE, { Action = "Order.Place", Side = "sell", Item = "fire_berry",
    Price = "12", Quantity = "400" })
  ok("a big ask rests", r and r.order and r.order.open == true, json.encode(r and r.order))

  local amendedState
  r, amendedState = send(ALICE, {
    Action = "Order.Amend", OrderId = "O3", Quantity = "399",
  })
  ok("a quantity-only amend keeps the resting unit price",
     errOf(r) == nil and r and r.order ~= nil, json.encode(r))

  -- Re-enter with the returned map and none of the Luerl globals that normally
  -- ride in `priv`. Custody, the resting order and replay ledgers must all be
  -- reconstructed before the next write.
  VenueMode, VenueSealed, VenueName, GameProcess = nil, false, "TEST-Rune Realm Venue", ""
  Assets, AssetByProcess, Ledger, Book = {}, {}, {}, nil
  Deposits, Withdrawals, WithdrawSeq = {}, {}, 0
  Emergency = { paused = false, reason = "", scope = "trading", at = 0 }
  restoreOperationalState(amendedState)
  ok("a cold venue restores custody, configuration and its resting book",
     VenueMode == "internal" and GameProcess == GAME
       and Ledger[ALICE] and num(Ledger[ALICE].fire_berry) == 81
       and Book and Book.orders and Book.orders.O3
       and num(Book.orders.O3.remaining) == 399 and num(Book.orders.O3.price) == 12
       and Deposits[GAME .. ":d7"] ~= nil,
     tostring(VenueMode) .. " / " .. tostring(Book and Book.orderSeq))

  r = send(ALICE, { Action = "Withdraw", Asset = "fire_berry", Quantity = "200" })
  ok("what a resting order holds cannot be withdrawn", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Withdraw", Asset = "fire_berry", Quantity = "50" })
  ok("what is free can", r and r.withdrawal and r.withdrawal.status == "pending",
     json.encode(r and r.withdrawal))

  local withdrawal, wraw = send(ALICE, { Action = "Withdraw", Asset = "gold", Quantity = "100" })
  -- 1,098: she came in with 1,200 from the fill, paid 1 Gold to rest the first
  -- ask and 1 more to rest the second, and this withdrawal takes 100.
  ok("a withdrawal debits before it asks", freeOf(withdrawal, "gold") == 1098,
     json.encode(withdrawal))
  ok("and the internal venue sends it BACK TO THE GAME, not to a token",
     sent(wraw, "withdraw").target == GAME, json.encode(sent(wraw, "withdraw")))
  local wid = withdrawal and withdrawal.withdrawal and withdrawal.withdrawal.id or ""
  ok("as a Venue.Return carrying its own reference",
     sent(wraw, "withdraw").Action == "Venue.Return"
     and sent(wraw, "withdraw").Reference == wid,
     json.encode(sent(wraw, "withdraw")))
  r = deliver(RUNE, { Action = "Venue.Returned", Reference = wid })
  ok("only the game may confirm the return", errOf(r) == "Not authorised", json.encode(r))

  r = deliver(GAME, { Action = "Venue.Returned", Reference = wid })
  ok("the game confirms and the row settles",
     r and r.withdrawal and r.withdrawal.status == "settled", json.encode(r and r.withdrawal))

  r = deliver(GAME, { Action = "Venue.Returned", Reference = wid })
  ok("a repeated confirmation changes nothing", r and r.unchanged == true, json.encode(r))

  -- The internal venue has NO token verbs ------------------------------------

  r = deliver(RUNE, { Action = "Credit-Notice", Sender = MALLORY,
    Quantity = "1000000", Reference = "t1" })
  ok("the internal venue cannot be paid in tokens at all",
     errOf(r) == "This is the internal venue", json.encode(r))

  -- The emergency stop --------------------------------------------------------

  r = send(ALICE, { Action = "Admin.Pause", Reason = "testing" })
  ok("a stranger cannot pause the venue", errOf(r) == "Not authorised", json.encode(r))

  r = send(OWNER, { Action = "Admin.Pause", Reason = "book looks wrong" })
  ok("the owner pauses it", r and r.emergency and r.emergency.paused == true, json.encode(r))
  ok("and the default scope is trading only",
     r and r.emergency and r.emergency.scope == "trading", json.encode(r and r.emergency))

  r = send(BOB, { Action = "Order.Place", Side = "buy", Item = "fire_berry",
    Price = "10", Quantity = "1" })
  ok("no order may be placed while paused", errOf(r) ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Withdraw", Asset = "gold", Quantity = "10" })
  ok("but a trading pause still lets everybody go home",
     r and r.withdrawal and r.withdrawal.status == "pending", json.encode(r))

  r = deliver(GAME, { Action = "Venue.Credit", Account = BOB, Asset = "gold",
    Quantity = "10", Reference = "d9" })
  ok("and a deposit is never refused -- the value is already here",
     r and r.deposit and r.deposit.status == "credited", json.encode(r and r.deposit))

  -- O3 is Alice's resting ask; O2 was Bob's immediate-or-cancel and is long
  -- gone. Cancelling is what frees a balance, so it has to keep working while
  -- trading is stopped -- otherwise a trading pause traps money after all.
  r = send(ALICE, { Action = "Order.Cancel", OrderId = "O3" })
  ok("cancelling out is allowed while paused", r and r.cancelled ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.Pause", Reason = "draining", Scope = "all" })
  ok("a full stop has to be asked for by name",
     r and r.emergency and r.emergency.scope == "all", json.encode(r and r.emergency))

  r = send(ALICE, { Action = "Withdraw", Asset = "gold", Quantity = "10" })
  ok("and only THAT freezes withdrawals", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.Resume" })
  ok("resume clears it", r and r.emergency and r.emergency.paused == false, json.encode(r))

  r = send(ALICE, { Action = "Withdraw", Asset = "gold", Quantity = "10" })
  ok("and everything moves again", r and r.withdrawal ~= nil, json.encode(r))

  -- Sealing -------------------------------------------------------------------

  r = send(OWNER, { Action = "Admin.Seal" })
  ok("the owner seals what backs the venue", r and r.info and r.info.Sealed == true,
     json.encode(r and r.info))

  r = send(OWNER, { Action = "Admin.Configure", Mode = "external" })
  ok("a sealed venue cannot change mode", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "scroll" })
  ok("nor list a new asset", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "gold", Quote = "fire_berry" })
  ok("but markets are still creatable after sealing -- that is the point",
     r and r.market ~= nil, json.encode(r))

  -- =========================================================================
  -- THE EXTERNAL VENUE: real tokens, TEST-RUNE against TEST-RELIC
  -- =========================================================================

  respawn()

  send(OWNER, { Action = "Admin.Configure", Mode = "external",
    Name = "TEST-Rune Realm External Venue" })

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "rune", Name = "TEST-Rune" })
  ok("an external asset needs a token process", errOf(r) ~= nil, json.encode(r))

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "rune", Name = "TEST-Rune",
    Process = RUNE, Ticker = "TEST-RUNE", Denomination = "6" })
  ok("with one, it lists", r and r.asset and r.asset.process == RUNE, json.encode(r))
  ok("and the denomination is an integer string",
     r and r.asset and r.asset.denomination == "6", r and r.asset and r.asset.denomination)

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "rune2", Name = "TEST-Rune again",
    Process = RUNE, Denomination = "6" })
  ok("one token cannot be listed under two names", errOf(r) ~= nil, json.encode(r))

  send(OWNER, { Action = "Admin.ListAsset", Asset = "relic", Name = "TEST-Relic",
    Process = RELIC, Ticker = "TEST-RELIC", Denomination = "6" })

  -- Rune has six decimals and Relic has six, so the pair trades in LOTS of one
  -- whole Rune priced in Relic atoms. That is what `lot` is for; without it a
  -- market between two six-decimal tokens has a minimum price increment of one
  -- millionth and every quote is unreadable. ORDERBOOK.md §7.1.
  --- `MaxPrice` has to be raised, and that is the point of it being a market
  --- field rather than a constant. The default ceiling is 1,000,000 because
  --- that is a sane cap on a price in GOLD; here a price is Relic atoms per
  --- whole Rune, so two Relic is 2,000,000 and the default would refuse every
  --- order on the pair.
  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "rune", Quote = "relic",
    Lot = "1000000", Tick = "1000", MinValue = "1000", TakerBps = "30",
    MaxPrice = "1000000000000", CreationCost = "0" })
  ok("the rune/relic pair is created", r and r.market and r.market.id == "rune/relic",
     json.encode(r and r.market))
  ok("with a lot of one whole Rune", r and r.market and num(r.market.lot) == 1000000,
     r and r.market and r.market.lot)
  ok("and a real taker fee, unlike the in-game book",
     r and r.market and num(r.market.takerBps) == 30, r and r.market and r.market.takerBps)

  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "rune", Quote = "relic" })
  ok("a base asset may only head one market", errOf(r) ~= nil, json.encode(r))

  send(OWNER, { Action = "Admin.LaunchAll" })

  -- Deposits arrive as Credit-Notice -----------------------------------------

  r = forge(MALLORY, RUNE, { Action = "Credit-Notice", Sender = MALLORY,
    Quantity = "100000000", Reference = "t9" })
  ok("a forged credit notice pays nobody", errOf(r) == "Not authorised", json.encode(r))

  r = deliver(GAME, { Action = "Credit-Notice", Sender = ALICE,
    Quantity = "100000000", Reference = "t10" })
  ok("nor does one from a process this venue does not list",
     errOf(r) == "Not authorised", json.encode(r))

  r = deliver(RUNE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "50000000",
    Reference = "t11" })
  ok("the listed token credits its sender",
     r and r.deposit and r.deposit.status == "credited", json.encode(r and r.deposit))
  ok("in the asset that token IS", r and r.deposit and r.deposit.asset == "rune",
     json.encode(r and r.deposit))

  r = deliver(RUNE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "50000000",
    Reference = "t11" })
  ok("and a redelivered notice pays once", r and r.unchanged == true, json.encode(r))

  -- The reference is namespaced by the SENDING PROCESS, so two tokens using
  -- the same counter value cannot collide with each other.
  r = deliver(RELIC, { Action = "Credit-Notice", Sender = BOB, Quantity = "80000000",
    Reference = "t11" })
  ok("the same reference from a different token is a different deposit",
     r and r.deposit and r.deposit.status == "credited", json.encode(r and r.deposit))
  ok("and it credited the other asset", r and r.deposit and r.deposit.asset == "relic",
     json.encode(r and r.deposit))

  r = deliver(RUNE, { Action = "Credit-Notice", Sender = ALICE, Quantity = "1000000" })
  ok("a notice with no reference at all is refused, not credited",
     errOf(r) ~= nil, json.encode(r))

  -- Trading the pair ----------------------------------------------------------

  r = send(ALICE, { Action = "Order.Place", Side = "sell", Item = "rune",
    Price = "2000000", Quantity = "40" })
  ok("Alice offers 40 Rune at 2 Relic each",
     r and r.order and r.order.open == true, json.encode(r and r.order))
  ok("and 40 whole Rune left her free balance", freeOf(r, "rune") == 10000000,
     json.encode(r))

  r = send(BOB, { Action = "Order.Place", Side = "buy", Item = "rune",
    Price = "2000000", Quantity = "10", Tif = "ioc" })
  ok("Bob takes ten of them",
     fillCount(r) == 1 and num((fillOf(r) or {}).quantity) == 10, json.encode(r))
  ok("and pays the taker fee, because this venue charges one",
     num((fillOf(r) or {}).fee) > 0, json.encode(fillOf(r)))
  ok("Bob holds ten whole Rune", freeOf(r, "rune") == 10000000, json.encode(r))

  -- Withdrawing goes to the TOKEN, not to any game ---------------------------

  local w, wr = send(BOB, { Action = "Withdraw", Asset = "rune", Quantity = "10000000" })
  ok("a withdrawal is accepted", w and w.withdrawal
     and w.withdrawal.status == "pending", json.encode(w and w.withdrawal))
  local bobWithdrawal = w and w.withdrawal and w.withdrawal.id or ""
  ok("and it is a Transfer on the token process",
     sent(wr, "withdraw").target == RUNE and sent(wr, "withdraw").Action == "Transfer",
     json.encode(sent(wr, "withdraw")))
  ok("addressed to the withdrawer's own wallet",
     sent(wr, "withdraw").Recipient == BOB, json.encode(sent(wr, "withdraw")))
  ok("carrying its reference as an X- tag, which is what rides a notice",
     sent(wr, "withdraw")["X-Reference"] == bobWithdrawal,
     json.encode(sent(wr, "withdraw")))

  r = deliver(RELIC, { Action = "Debit-Notice", ["X-Reference"] = bobWithdrawal })
  ok("the wrong token cannot settle it", errOf(r) == "Not authorised", json.encode(r))

  r = deliver(RUNE, { Action = "Debit-Notice", ["X-Reference"] = bobWithdrawal })
  ok("the right one does", r and r.withdrawal and r.withdrawal.status == "settled",
     json.encode(r and r.withdrawal))

  -- The external venue has NO game verbs -------------------------------------

  r = deliver(GAME, { Action = "Venue.Credit", Account = MALLORY, Asset = "rune",
    Quantity = "1000000000", Reference = "d99" })
  ok("the external venue has no verb the game could use",
     errOf(r) == "This is the external venue", json.encode(r))

  -- What the venue owes, published -------------------------------------------

  local supply, sraw = send(OWNER, { Action = "Supply" })
  local runeHeld = supply and supply.rune and num(supply.rune.held) or -1
  ok("the venue publishes what it is holding per asset", runeHeld >= 0,
     json.encode(supply and supply.rune))
  ok("free plus escrow plus locked is what it owes",
     supply and supply.rune
     and num(supply.rune.free) + num(supply.rune.escrow) + num(supply.rune.locked) == runeHeld,
     json.encode(supply and supply.rune))
  ok("and every one of those is an integer string, not a float",
     string.find(sraw.supply or "", "%.") == nil, sraw.supply)

  -- Quarantine, resolved by hand ---------------------------------------------

  r = deliver(RUNE, { Action = "Credit-Notice", Sender = "nope", Quantity = "5000000",
    Reference = "t50" })
  ok("a notice naming no wallet is quarantined",
     r and r.deposit and r.deposit.status == "unresolved", json.encode(r and r.deposit))

  r = send(ALICE, { Action = "Admin.SettleDeposit", Reference = RUNE .. ":t50",
    Account = ALICE })
  ok("a stranger cannot resolve a quarantined deposit",
     errOf(r) == "Not authorised", json.encode(r))

  r = send(OWNER, { Action = "Admin.SettleDeposit", Reference = RUNE .. ":t50",
    Account = ALICE })
  ok("the owner can", r and r.deposit and r.deposit.status == "credited",
     json.encode(r and r.deposit))

  r = send(OWNER, { Action = "Admin.SettleDeposit", Reference = RUNE .. ":t50",
    Account = BOB })
  ok("and cannot do it twice", r and r.unchanged == true, json.encode(r))

  -- A withdrawal that never lands --------------------------------------------

  local lost = send(ALICE, { Action = "Withdraw", Asset = "relic", Quantity = "1" })
  if lost and lost.error then
    -- Alice may hold no Relic; give her some and try again.
    deliver(RELIC, { Action = "Credit-Notice", Sender = ALICE, Quantity = "1000000",
      Reference = "t60" })
    lost = send(ALICE, { Action = "Withdraw", Asset = "relic", Quantity = "1000000" })
  end
  local lostId = lost and lost.withdrawal and lost.withdrawal.id
  r = send(OWNER, { Action = "Admin.SettleWithdrawal", Reference = lostId,
    Resolution = "refund" })
  ok("an owner can refund a withdrawal that never landed",
     r and r.withdrawal and r.withdrawal.status == "refunded", json.encode(r and r.withdrawal))

  r = send(OWNER, { Action = "Admin.SettleWithdrawal", Reference = lostId,
    Resolution = "refund" })
  ok("and cannot refund it twice", r and r.unchanged == true, json.encode(r))

  -- Published state is bounded -------------------------------------------------

  local _, published = send(OWNER, { Action = "Info" })
  ok("the venue does not publish `info` -- the device owns that name",
     published.info == nil, published.info)
  ok("it publishes `venueinfo` instead", published.venueinfo ~= nil, nil)
  ok("and never the raw order list", published.orders == nil, published.orders)
  ok("nor the raw fill list", published.fills == nil, published.fills)

  -- The state export drops only what a restore can rebuild --------------------

  local exported = json.decode(published.venuebookstate or "{}")
  ok("the restore export carries no closed-order log",
     exported.orderHistory == nil, published.venuebookstate)
  ok("nor the refusal histogram", exported.rejected == nil, nil)
  ok("nor the derived receipt order", exported.actionReceiptOrder == nil, nil)
  ok("nor the hot index", exported.bookIndex == nil, nil)
  ok("but it KEEPS the fills -- this venue has no desk, so the price band is "
     .. "anchored on their median and nothing else republishes them",
     type(exported.fills) == "table", nil)
  ok("and the replay guard, whose loss would re-arm a double-place",
     type(exported.actionReceipts) == "table", nil)
  ok("and every id sequence, pool, fee and market",
     exported.orderSeq ~= nil and exported.fillSeq ~= nil
       and type(exported.pools) == "table" and type(exported.fees) == "table"
       and type(exported.markets) == "table" and type(exported.orders) == "table"
       and type(exported.marketDaily) == "table",
     published.venuebookstate)

  -- A resolved replay guard is published as its status and nothing more, and
  -- `status` is the field that may never go: a compacted withdrawal that lost
  -- it would read as `pending` and be refundable twice.
  local depositState = json.decode(published.venuedepositstate or "{}")
  local settled = depositState[RUNE .. ":t11"]
  ok("a settled deposit is published compacted, not in full",
     type(settled) == "table" and settled.status == "credited"
       and settled.account == nil and settled.amount == nil,
     published.venuedepositstate)
  local withdrawalState = json.decode(published.venuewithdrawalstate or "{}")
  ok("and so is a settled withdrawal, status intact",
     type(withdrawalState.w1) == "table" and withdrawalState.w1.status == "settled"
       and withdrawalState.w1.account == nil,
     published.venuewithdrawalstate)

  -- The clock is the ASSIGNMENT's, never the sender's -------------------------
  --
  -- `msg` is the caller's own signed data item, so a `Timestamp` TAG on it is
  -- whatever they felt like -- and a browser signs exactly that spelling. It
  -- used to win over `req.timestamp`. The venue's clock is not decoration: a
  -- far-future stamp retires every resting order into the index's dead queue,
  -- and `Order.Maintain` is unauthenticated housekeeping anybody may then call
  -- to cancel them out from under their owners.

  local before = send(ALICE, { Action = "Balance" })
  local restingBefore = before and before.orders and #before.orders or 0
  ok("Alice still has a resting order to lose", restingBefore > 0,
     json.encode(before and before.orders))

  local swept = send(MALLORY, { Action = "Order.Maintain",
    Timestamp = "1900000000000" })
  ok("a body Timestamp six years on expires nothing",
     swept and num(swept.expired) == 0, json.encode(swept))

  local after = send(ALICE, { Action = "Balance" })
  ok("and the order is still resting",
     after and after.orders and #after.orders == restingBefore,
     json.encode(after and after.orders))
  ok("with its expiry still measured from the assignment clock",
     after and after.orders and after.orders[1]
       and tonumber(after.orders[1].expiresAt) < 1900000000000,
     after and after.orders and after.orders[1] and after.orders[1].expiresAt)

  local futureSupply = send(MALLORY, { Action = "Supply" })
  ok("and its escrow was never released",
     futureSupply and futureSupply.rune and num(futureSupply.rune.escrow) > 0,
     json.encode(futureSupply and futureSupply.rune))

  -- Two signatures identify NOBODY -------------------------------------------
  --
  -- Not "whichever `pairs()` visited first". On a venue this is the gate in
  -- front of `Credit-Notice`: `sourceProcess` believes `from-process` only
  -- when the proven signer IS our scheduler, so winning table iteration order
  -- by attaching a second signature would credit balance out of nothing.

  local function sendTwice(a, b, tags)
    T = T + 1000
    local body = { commitments = {
      sig1 = { committer = a, alg = "rsa-pss-sha512" },
      sig2 = { committer = b, alg = "rsa-pss-sha512" },
    } }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute(baseOf(), { body = body, timestamp = T })
    return json.decode(res.results.output.data), res
  end

  r = sendTwice(ALICE, MALLORY, { Action = "Order.Place", Side = "sell",
    Item = "rune", Price = "2000000", Quantity = "1" })
  ok("two signatures cannot trade", errOf(r) == "Unsigned messages cannot trade",
     json.encode(r))

  r = sendTwice(OWNER, MALLORY, { Action = "Admin.Pause", Reason = "mine now" })
  ok("nor pass as the owner", errOf(r) == "Not authorised", json.encode(r))

  -- The attack that matters: the scheduler's real signature, plus one more.
  T = T + 1000
  local forgedBody = {
    commitments = {
      sig1 = { committer = SCHED, alg = "rsa-pss-sha512" },
      sig2 = { committer = MALLORY, alg = "rsa-pss-sha512" },
    },
    ["from-process"] = RUNE,
    Action = "Credit-Notice", Sender = MALLORY, Quantity = "999000000",
    Reference = "twosig",
  }
  local forgedRes = compute(baseOf(), { body = forgedBody, timestamp = T })
  r = json.decode(forgedRes.results.output.data)
  ok("a second signature beside the scheduler's credits nobody",
     errOf(r) == "Not authorised", json.encode(r))
  ok("and left no deposit row behind", Deposits[RUNE .. ":twosig"] == nil,
     json.encode(Deposits[RUNE .. ":twosig"]))
  ok("and paid Mallory nothing", Ledger[MALLORY] == nil
     or num((Ledger[MALLORY] or {}).rune) ~= 999000000,
     json.encode(Ledger[MALLORY]))

  -- A stranger's address is not a published key ------------------------------
  --
  -- A published key, once created, stays in the process map forever, and every
  -- message afterwards pays for the whole map five times over. `touched` used
  -- to add `Account`, `Recipient` and `Sender` straight off the message, so
  -- any wallet could mint one per message -- on the read-only `Info`, at that.

  local STRANGER = "STRANGERsssssssssssssssssssssssssssssssssss"
  local _, infoRaw = send(MALLORY, { Action = "Info", Account = STRANGER })
  ok("an Info carrying a stranger's Account mints no key for them",
     infoRaw["balance-" .. STRANGER] == nil, infoRaw["balance-" .. STRANGER])
  ok("and Recipient and Sender are no route in either",
     (select(2, send(MALLORY, { Action = "Info", Recipient = STRANGER,
        Sender = STRANGER })))["balance-" .. STRANGER] == nil, nil)

  -- BOB, not Mallory: Mallory's address is deliberately 42 characters, so
  -- `validId` refuses it and it would prove nothing about the signer's key.
  local answered, balRaw = send(BOB, { Action = "Balance", Account = STRANGER })
  ok("Balance still ANSWERS for the account it was asked about",
     answered and answered.account == STRANGER, json.encode(answered))
  ok("but publishes no key for it", balRaw["balance-" .. STRANGER] == nil,
     balRaw["balance-" .. STRANGER])
  ok("while the signer's own key is still published",
     balRaw["balance-" .. BOB] ~= nil, nil)

  -- Housekeeping that released nothing costs nothing --------------------------
  --
  -- `Order.Maintain` is unauthenticated by design and is not read-only, so a
  -- call that expired nothing used to rewrite the config, the ledger, the
  -- book, the deposits and the withdrawals. A live node hands `compute` a base
  -- that already carries `venuecommit`; the ordinary `send` starts from a bare
  -- table, and a bare base publishes unconditionally, so a warm base is the
  -- only way to see the publication decision at all.
  local function warmSend(commit, from, tags)
    T = T + 1000
    local warm = baseOf()
    warm.venuecommit = commit
    local body = { commitments = { sig1 = { committer = from, alg = "rsa-pss-sha512" } } }
    for k, v in pairs(tags) do body[k] = v end
    local res = compute(warm, { body = body, timestamp = T })
    return json.decode(res.results.output.data), res
  end

  local _, commitRes = send(OWNER, { Action = "Info" })
  local quiet, quietRaw = warmSend(commitRes.venuecommit, MALLORY,
    { Action = "Order.Maintain" })
  ok("a Maintain with nothing to release expires nothing",
     quiet and num(quiet.expired) == 0, json.encode(quiet))
  ok("and does not rewrite one state key",
     quietRaw.venueconfigstate == nil and quietRaw.venueledgerstate == nil
       and quietRaw.venuebookstate == nil and quietRaw.venuedepositstate == nil
       and quietRaw.venuewithdrawalstate == nil,
     tostring(quietRaw.venuebookstate))
  ok("while the read path is published as always",
     quietRaw.venuebook ~= nil and quietRaw.supply ~= nil
       and quietRaw.venuecommit ~= nil, nil)

  -- But one that DID release escrow must republish: the money moved.
  local shortLived = send(ALICE, { Action = "Order.Place", Side = "sell",
    Item = "rune", Price = "2000000", Quantity = "1", ExpiresIn = "300000" })
  ok("a short-lived order rests",
     shortLived and shortLived.order and shortLived.order.open == true,
     json.encode(shortLived))

  local _, freshCommit = send(OWNER, { Action = "Info" })
  T = T + 400000
  local reaped, reapedRaw = warmSend(freshCommit.venuecommit, MALLORY,
    { Action = "Order.Maintain" })
  ok("past its expiry the sweep releases it", reaped and num(reaped.expired) == 1,
     json.encode(reaped))
  ok("and THAT one republishes every state key, because escrow moved",
     reapedRaw.venueconfigstate ~= nil and reapedRaw.venueledgerstate ~= nil
       and reapedRaw.venuebookstate ~= nil and reapedRaw.venuedepositstate ~= nil
       and reapedRaw.venuewithdrawalstate ~= nil,
     tostring(reapedRaw.venuebookstate))

  -- A market fee is bounded on BOTH sides --------------------------------------

  r = send(OWNER, { Action = "Admin.ListAsset", Asset = "shard", Name = "TEST-Shard",
    Process = "SHARDtokennnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn", Denomination = "0" })
  ok("a third asset lists", r and r.asset and r.asset.id == "shard", json.encode(r))
  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "shard", Quote = "relic",
    TakerBps = "1000000" })
  ok("a hundredfold taker fee is refused",
     errOf(r) == "TakerBps must be at most 1000", json.encode(r))
  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "shard", Quote = "relic",
    BandBps = "10000000" })
  ok("and a band wider than the whole scale is refused",
     errOf(r) == "BandBps must be at most 10000", json.encode(r))
  r = send(OWNER, { Action = "Admin.CreateMarket", Base = "shard", Quote = "relic",
    TakerBps = "1000", BandBps = "10000" })
  ok("the bounds themselves are allowed",
     r and r.market and num(r.market.takerBps) == 1000, json.encode(r))

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- Two entry points, because there are two runners and they invoke differently.
---
--- The live node POSTs to `/~lua@5.3a/venuetest`, and the device calls the
--- GLOBAL function that path segment names. The offline runner wraps this file
--- in a closure and calls whatever it returned. Both have to work, or one of
--- them silently stops being run and nobody notices until a deploy.
function venuetest()
  return run()
end

return run
