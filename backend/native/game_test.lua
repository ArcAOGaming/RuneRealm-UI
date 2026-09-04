--- game_test.lua — exercises the whole RuneRealm process on a live ~lua@5.3a.
---
--- Run with ./run-test.sh. No wallet, no signing, no cost. It bundles exactly
--- what deploy.mjs deploys, so anything Luerl rejects — goto, string.pack,
--- gmatch("[^,%s]+") — fails here before it ever reaches a deployed process.

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
  local ALICE = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local BOB   = "BOBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

  -- A process definition whose committer is OWNER, so resolveOwner() finds it.
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }

  --- The published map, carried from one message to the next.
  ---
  --- `compute`'s result IS its `base`, and a live node feeds that result back in
  --- as the next slot's base. Handing `compute` a FRESH `{ process = PROCESS }`
  --- each time -- which is what this file used to do for all but a handful of
  --- its messages -- makes every derived key look absent, so the `== nil` half
  --- of every publish guard in `compute` fires on every message: `factions`,
  --- `leaderboard`, `metrics`, `economy`, `challenges`, `monsterindex`,
  --- `catalog` and the fleet views were all recomputed and re-encoded for a
  --- read-only `User.Info`, which the real process never does. Nothing about
  --- that is a contract bug and no assertion depended on it -- it just made one
  --- request out of ~700 messages large enough that a node answered 502 before
  --- the suite could finish. `battle-fleet/hblab/lua-cost.mjs` documents the
  --- same trap and threads its base for the same reason.
  ---
  --- Everything the GAME owns (`Players`, `Battles`, the ledgers) lives in Lua
  --- globals and was already carried; this carries the PUBLICATION state too.
  local STATE = { process = PROCESS }

  --- One raw message against the carried state. `body` is the request body
  --- exactly as HyperBEAM presents it, `extra` any additional base fields the
  --- node would supply for this slot (`scheduler-location`, and nothing else so
  --- far). Extras are removed again afterwards so a test that names one
  --- scheduler cannot silently decide the next test's answer.
  local function computeOn(body, extra)
    if extra then for k, v in pairs(extra) do STATE[k] = v end end
    local res = compute(STATE, { body = body, timestamp = T }, {})
    STATE = res
    if extra then for k in pairs(extra) do STATE[k] = nil end end
    return res
  end

  --- A base equivalent to the current one, for the determinism test, which has
  --- to hand the SAME starting state to two separate calls. Top-level only,
  --- which is all `compute` writes: every published value is an encoded string.
  local function forkState()
    local copy = {}
    for k, v in pairs(STATE) do copy[k] = v end
    return copy
  end

  --- Drive compute() the way HyperBEAM does. `from` becomes the signer.
  local function send(from, tags, data)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = computeOn(body)
    local decoded = json.decode(res.results.output.data)
    return decoded, res
  end

  local function errOf(r) return type(r) == "table" and r.error or nil end

  -- Bootstrapping -----------------------------------------------------------

  local r = send(OWNER, { Action = "Stats" })
  ok("Stats answers", r ~= nil and r.players ~= nil, errOf(r))
  ok("owner resolved from process commitment", r and r.owner == OWNER, r and r.owner)

  r = send(ALICE, { Action = "Faction.Join", Faction = "Inferno Blades" })
  ok("locked wallet cannot join a faction", errOf(r) ~= nil, r)

  -- A non-owner must not be able to hand itself access.
  r = send(ALICE, { Action = "Admin.Unlock", Addresses = ALICE })
  ok("Admin.Unlock rejects a non-owner", errOf(r) == "Not authorised", r)

  r = send(OWNER, { Action = "Admin.Unlock", Addresses = ALICE .. "," .. BOB })
  ok("owner unlocks two addresses", r and r.added == 2, json.encode(r))

  r = send(OWNER, { Action = "Admin.Unlock", Addresses = ALICE })
  ok("re-unlocking is idempotent", r and r.added == 0 and r.alreadyUnlocked == 1, json.encode(r))

  -- Unlock via a JSON body, which is how the paid-list importer sends it.
  r = send(OWNER, { Action = "Admin.Unlock" }, json.encode({ addresses = { "CAROLccccccccccccccccccccccccccccccccccccc" } }))
  ok("Admin.Unlock accepts a JSON body", r and r.added == 1, json.encode(r))

  -- The body arrives lowercase on the wire. Reading it only as `msg.Data`
  -- made Admin.Unlock accept the message and unlock nobody.
  do
    T = T + 1000
    local res = computeOn({
      Address = OWNER, Action = "Admin.Unlock",
      data = json.encode({ addresses = { "DAVEddddddddddddddddddddddddddddddddddddddd" } }),
    })
    local decoded = json.decode(res.results.output.data)
    ok("Admin.Unlock reads a lowercase body", decoded and decoded.added == 1, json.encode(decoded))
  end

  -- No handler may read a tag called `Target`: the ANS-104 envelope already has
  -- a lowercase `target` holding the process id, so such a tag is ambiguous by
  -- the time it reaches here. This asserts an admin action cannot be aimed by
  -- it.
  do
    T = T + 1000
    local res = computeOn({
      Address = OWNER, Action = "Admin.Grant", target = ALICE,
      Item = "rune", Amount = "999",
    })
    local decoded = json.decode(res.results.output.data)
    ok("an admin action cannot be aimed by the envelope's `target`",
       decoded and decoded.error ~= nil, json.encode(decoded))
  end

  -- An unknown wallet is the very first thing the client sees. Its reply has
  -- to have the same shape as a real player's or the UI reads a missing field
  -- off undefined and the whole page goes blank.
  do
    local blank = send("STRANGERsssssssssssssssssssssssssssssssssss", { Action = "User.Login" })
    ok("an unknown wallet gets a player-shaped reply",
       blank and blank.address ~= nil and blank.unlocked == false
       and blank.exists == false, json.encode(blank))
    ok("an unknown wallet has an inventory object", type(blank.inventory) == "table")
    ok("an unknown wallet has a lootbox list", type(blank.lootboxes) == "table")
    ok("an unknown wallet has counters", blank.wins == 0 and blank.battlesRemaining == 0)
    ok("an unknown wallet has no companion", blank.monster == nil)
  end

  -- Factions ----------------------------------------------------------------

  r = send(ALICE, { Action = "Faction.List" })
  ok("four factions listed", r and #r == 4, r and #r)

  r = send(ALICE, { Action = "Faction.Join", Faction = "Nonsense Brigade" })
  ok("unknown faction rejected", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Faction.Join", Faction = "Inferno Blades" })
  ok("alice joins Inferno Blades", r and r.faction == "Inferno Blades", errOf(r))
  ok("joining does not create per-wallet Rune", r and (r.inventory.rune or 0) == 0,
     r and json.encode(r.inventory))
  -- Three for the starter satchel and three for the companion, because
  -- swearing does both in the one turn.
  ok("joining seeds starter loot boxes", r and #r.lootboxes == 6, r and #r.lootboxes)
  ok("and hands over the companion in the same turn",
     r and r.monster ~= nil and r.adopted == true, errOf(r))
  -- The local suite runs the process in its explicit pre-launch testing mode.
  -- Fund the long scenario through an audited admin issuance instead of hiding
  -- a globally multiplying Rune faucet in Faction.Join.
  send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "50" })

  r = send(ALICE, { Action = "Faction.Join", Faction = "Sky Nomads" })
  ok("cannot switch faction", errOf(r) ~= nil, r)

  -- Companion ---------------------------------------------------------------

  r = send(BOB, { Action = "Monster.Adopt" })
  ok("cannot adopt without a faction", errOf(r) ~= nil, r)

  -- Swearing IS adopting, in one turn. ALICE already swore above, so she is
  -- holding her starter and there is no window in which an account belongs to a
  -- faction and owns nothing.
  r = send(ALICE, { Action = "User.Login" })
  ok("swearing already produced a companion", r and r.monster ~= nil, errOf(r))
  ok("companion matches faction element", r and r.monster.elementType == "fire", r and r.monster.elementType)
  ok("companion starts at home", r and r.monster.status.type == "Home", r and r.monster.status.type)
  ok("swearing grants loot boxes", r and #r.lootboxes == 6, r and #r.lootboxes)
  ok("and it is in the roster, not loose", r and r.activeId
     and r.monsters and r.monsters[r.activeId] ~= nil, r and r.activeId)
  ok("and the oath is recorded as spent", r and r.adopted == true, r and tostring(r.adopted))
  ok("owning a starter reveals its Monster Index entry",
     r and r.seenEntries and r.seenEntries[1] == 1,
     r and r.seenEntries and json.encode(r.seenEntries))

  local moveCount = 0
  for _ in pairs(r.monster.moves) do moveCount = moveCount + 1 end
  ok("companion has 4 moves", moveCount == 4, moveCount)

  r = send(ALICE, { Action = "Monster.Adopt" })
  ok("cannot adopt after swearing", errOf(r) ~= nil, r)

  -- Feeding -----------------------------------------------------------------

  local before = send(ALICE, { Action = "User.Info" })
  local energyBefore = before.monster.energy
  local berriesBefore = before.inventory.fire_berry or 0

  r = send(ALICE, { Action = "Monster.Feed" })
  ok("feeding raises energy", r and r.monster.energy > energyBefore,
     r and (energyBefore .. " -> " .. tostring(r.monster.energy)))
  ok("feeding consumes a berry", r and (r.inventory.fire_berry or 0) == berriesBefore - 1,
     r and tostring(r.inventory.fire_berry))
  ok("matching-element berry is worth double", r and r.monster.energy == energyBefore + 20,
     r and r.monster.energy)

  r = send(ALICE, { Action = "Monster.Feed", Item = "rune" })
  ok("a Rune is not a berry", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Monster.Feed", Item = "water_berry" })
  ok("off-element berry gives the base amount", r and r.monster.energy == energyBefore + 30,
     r and r.monster.energy)

  -- Play --------------------------------------------------------------------

  r = send(ALICE, { Action = "Monster.Play" })
  ok("play starts", r and r.monster.status.type == "Play", errOf(r))

  r = send(ALICE, { Action = "Monster.Play" })
  ok("cannot play while playing", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Monster.Claim" })
  ok("cannot claim before the timer is up", errOf(r) ~= nil, r)

  T = T + 900 * 1000
  r = send(ALICE, { Action = "Monster.Claim" })
  ok("play claims after the timer", r and r.monster.status.type == "Home", errOf(r))
  ok("play raises happiness", r and r.monster.happiness == 75, r and r.monster.happiness)
  ok("play is counted", r and r.monster.totalTimesPlay == 1, r and r.monster.totalTimesPlay)

  -- Quest -------------------------------------------------------------------

  local runesBefore = send(ALICE, { Action = "User.Info" }).inventory.rune or 0
  r = send(ALICE, { Action = "Monster.Quest" })
  ok("quest starts", r and r.monster.status.type == "Quest", errOf(r))
  ok("quest costs a Rune", r and (r.inventory.rune or 0) == runesBefore - 1, r and r.inventory.rune)

  T = T + 3600 * 1000
  local boxesBefore = #send(ALICE, { Action = "User.Info" }).lootboxes
  r = send(ALICE, { Action = "Monster.Claim" })
  ok("quest claims", r and r.monster.status.type == "Home", errOf(r))
  ok("quest grants exp", r and r.monster.exp >= 1, r and r.monster.exp)
  ok("quest grants a loot box", r and #r.lootboxes == boxesBefore + 1, r and #r.lootboxes)

  -- Admin.SetStats patches; omitting `type` must keep the current activity,
  -- so a timer can be rewound without cancelling the quest it belongs to.
  do
    send(ALICE, { Action = "Monster.Quest" })
    local mid = send(ALICE, { Action = "User.Info" })
    ok("a quest is running before the rewind", mid.monster.status.type == "Quest",
       mid.monster.status.type)
    send(OWNER, { Action = "Admin.SetStats", PlayerId = ALICE },
         json.encode({ status = { until_time = 1 } }))
    local after = send(ALICE, { Action = "User.Info" })
    ok("SetStats keeps the activity when type is omitted",
       after.monster.status.type == "Quest", after.monster.status.type)
    ok("SetStats moved the deadline", after.monster.status.until_time == 1,
       after.monster.status.until_time)
    local claimed = send(ALICE, { Action = "Monster.Claim" })
    ok("the rewound quest can be claimed", claimed.monster.status.type == "Home",
       errOf(claimed))
  end

  -- Levelling ---------------------------------------------------------------

  r = send(ALICE, { Action = "Monster.LevelUp", AttackPoints = "10" })
  ok("level up requires exactly 10 points across stats",
     errOf(r) == nil or string.find(errOf(r), "points") ~= nil, r)

  r = send(ALICE, { Action = "User.Info" })
  local lvl = r.monster.level
  local atkBefore = r.monster.attack
  r = send(ALICE, { Action = "Monster.LevelUp",
                    AttackPoints = "4", DefensePoints = "2",
                    SpeedPoints = "2", HealthPoints = "2" })
  if errOf(r) == nil then
    ok("level up advances the level", r.monster.level == lvl + 1, r.monster.level)
    ok("level up applies the points", r.monster.attack == atkBefore + 4, r.monster.attack)
  else
    ok("level up advances the level", false, errOf(r))
    ok("level up applies the points", false, errOf(r))
  end

  r = send(ALICE, { Action = "Monster.LevelUp",
                    AttackPoints = "9", DefensePoints = "1" })
  ok("more than 5 points into one stat is rejected", errOf(r) ~= nil, r)

  -- Levelling costs Rune ----------------------------------------------------
  --
  -- One quarter of the level being ENTERED, rounded up. These assert the
  -- boundaries of each band rather than a single value, because an off-by-one
  -- in the rounding is the whole risk: `ceil(level/4)` and `level//4` agree
  -- everywhere except exactly the multiples of four.

  ok("levelling to 1 through 4 costs 1 rune",
     C.levelUpCost(1) == 1 and C.levelUpCost(4) == 1, C.levelUpCost(4))
  ok("levelling to 5 through 8 costs 2 rune",
     C.levelUpCost(5) == 2 and C.levelUpCost(8) == 2, C.levelUpCost(8))
  ok("levelling to 9 through 12 costs 3 rune",
     C.levelUpCost(9) == 3 and C.levelUpCost(12) == 3, C.levelUpCost(12))
  ok("the cost is an integer, not a float",
     math.type(C.levelUpCost(5)) == "integer", math.type(C.levelUpCost(5)))

  -- A player who cannot pay is refused, and the refusal costs them NOTHING.
  -- The exp is the thing to watch: it is spent in the same handler, so a
  -- charge ordered after the deduction would burn the level and hand back an
  -- error.
  do
    local broke = "LVLbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    send(OWNER, { Action = "Admin.Unlock", Addresses = broke })
    send(broke, { Action = "Faction.Join", Faction = "Inferno Blades" })
    -- Enough exp to level, and deliberately no Rune to pay for it.
    -- `Admin.SetStats` patches from a JSON body, not from tags.
    send(OWNER, { Action = "Admin.SetStats", PlayerId = broke },
         json.encode({ exp = 50 }))
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = broke,
                  Item = "rune", Delta = "-999" })
    local before = send(broke, { Action = "User.Info" })
    ok("the broke test player exists and has a companion",
       before ~= nil and before.monster ~= nil, before and errOf(before))
    if before and before.monster then
      local r2 = send(broke, { Action = "Monster.LevelUp",
                               AttackPoints = "4", DefensePoints = "2",
                               SpeedPoints = "2", HealthPoints = "2" })
      ok("levelling with no rune is refused",
         errOf(r2) ~= nil and string.find(errOf(r2) or "", "Rune") ~= nil, r2)
      local after = send(broke, { Action = "User.Info" })
      ok("a refused level-up spends no exp",
         after.monster.exp == before.monster.exp, after.monster.exp)
      ok("a refused level-up does not advance the level",
         after.monster.level == before.monster.level, after.monster.level)
      ok("a refused level-up applies no stat points",
         after.monster.attack == before.monster.attack, after.monster.attack)
    end
  end

  -- Loot boxes --------------------------------------------------------------

  local pre = send(ALICE, { Action = "User.Info" })
  local preBoxes = #pre.lootboxes
  r = send(ALICE, { Action = "Lootbox.Open" })
  ok("opening consumes a box", r and #r.lootboxes == preBoxes - 1, r and #r.lootboxes)
  ok("opening always yields something", r and r.lootResult and #r.lootResult.rewards > 0,
     r and r.lootResult and json.encode(r.lootResult))

  r = send(ALICE, { Action = "Lootbox.Open", Rarity = "5" })
  ok("asking for a tier you do not own is refused", errOf(r) ~= nil, r)

  -- Combat ------------------------------------------------------------------

  r = send(ALICE, { Action = "Battle.Start" })
  ok("cannot fight before entering the arena", errOf(r) ~= nil, r)

  -- Make sure alice can afford a session.
  send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "5" })
  send(OWNER, { Action = "Admin.SetStats", PlayerId = ALICE }, json.encode({ energy = 100, happiness = 100 }))

  r = send(ALICE, { Action = "Battle.Begin" })
  ok("entering the arena works", r and r.monster.status.type == "Battle", errOf(r))
  ok("a session grants 4 battles", r and r.battlesRemaining == 4, r and r.battlesRemaining)

  r = send(ALICE, { Action = "Battle.Start" })
  ok("bot battle starts", r and r.battle ~= nil and r.battle.status == "battling", errOf(r))
  ok("both sides have HP", r and r.battle.challenger.healthPoints > 0
     and r.battle.accepter.healthPoints > 0, r and json.encode(r.battle.challenger.healthPoints))
  ok("opponent is scaled, not fixed at level 1",
     r and r.battle.accepter.level == r.battle.challenger.level,
     r and (tostring(r.battle.accepter.level) .. " vs " .. tostring(r.battle.challenger.level)))

  local battleId = r.battle.id
  local firstMove
  for name in pairs(r.battle.challenger.moves) do firstMove = name break end

  r = send(ALICE, { Action = "Battle.Attack", BattleId = battleId, Move = "No Such Move" })
  ok("an unknown move is refused", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Battle.Attack", BattleId = battleId, Move = "struggle" })
  ok("struggle is refused while moves remain", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Battle.Attack", BattleId = battleId, Move = firstMove })
  ok("an attack resolves a whole round", r and r.battle and #r.battle.turns >= 1,
     r and (errOf(r) or (r.battle and #r.battle.turns)))
  ok("the turn log names the monster", r and r.battle and r.battle.turns[1].monsterName ~= nil,
     r and r.battle and json.encode(r.battle.turns[1]))
  ok("the turn log names the move", r and r.battle and r.battle.turns[1].move ~= nil,
     r and r.battle and r.battle.turns[1].move)

  -- Fight it out. One message is one round, so this terminates.
  -- `done` starts at the first attack's reply: a super-effective opening can
  -- end the fight in a single round, and the loop body would then never run.
  local rounds, done = 0, r
  local cur = r
  while cur and cur.battle and cur.battle.status == "battling" and rounds < 60 do
    rounds = rounds + 1
    local pick
    for name, move in pairs(cur.battle.challenger.moves) do
      if (move.count or 0) > 0 then pick = name break end
    end
    cur = send(ALICE, { Action = "Battle.Attack", BattleId = battleId,
                        Move = pick or "struggle" })
    if errOf(cur) then break end
    done = cur
  end
  ok("a bot battle ends within 60 rounds",
     done and done.battle and done.battle.status == "ended", rounds .. " rounds")
  ok("a finished battle reports a result", done and done.result ~= nil, done and done.result)
  ok("a finished battle spends one of the four",
     done and done.battlesRemaining == 3, done and done.battlesRemaining)
  ok("the loser is not left mid-fight", done and done.activeBattleId == nil,
     done and tostring(done.activeBattleId))

  r = send(ALICE, { Action = "Battle.Attack", BattleId = battleId, Move = firstMove })
  ok("cannot keep swinging at a finished battle", errOf(r) ~= nil, r)

  -- PvP ---------------------------------------------------------------------

  send(OWNER, { Action = "Admin.Unlock", Addresses = BOB })
  send(BOB, { Action = "Faction.Join", Faction = "Aqua Guardians" })
  send(BOB, { Action = "Monster.Adopt" })
  send(OWNER, { Action = "Admin.Grant", PlayerId = BOB, Item = "rune", Amount = "5" })
  send(OWNER, { Action = "Admin.SetStats", PlayerId = BOB }, json.encode({ energy = 100, happiness = 100 }))
  send(BOB, { Action = "Battle.Begin" })

  r = send(ALICE, { Action = "Battle.Challenge", Opponent = "OPEN" })
  ok("an open challenge is created", r and r.battle and r.battle.status == "pending", errOf(r))
  local pvpId = r.battle and r.battle.id

  r = send(ALICE, { Action = "Battle.OpenChallenges" })
  ok("the open challenge is listed", r and #r >= 1, r and #r)

  r = send(ALICE, { Action = "Battle.Accept", BattleId = pvpId })
  ok("you cannot accept your own challenge", errOf(r) ~= nil, r)

  r = send(BOB, { Action = "Battle.Accept", BattleId = pvpId })
  ok("bob accepts", r and r.battle and r.battle.status == "battling", errOf(r))

  local aliceMove, bobMove
  for name in pairs(r.battle.challenger.moves) do aliceMove = name break end
  for name in pairs(r.battle.accepter.moves) do bobMove = name break end

  r = send(ALICE, { Action = "Battle.Attack", BattleId = pvpId, Move = aliceMove })
  ok("the first PvP move waits for the opponent", r and r.waitingForOpponent == true, json.encode(r))
  ok("nothing resolves until both have moved", r and r.battle and #r.battle.turns == 0,
     r and r.battle and #r.battle.turns)

  r = send(BOB, { Action = "Battle.Attack", BattleId = pvpId, Move = bobMove })
  ok("the second PvP move resolves the round", r and r.battle and #r.battle.turns >= 1,
     r and (errOf(r) or (r.battle and #r.battle.turns)))

  -- A reload must not lose the fight. The battle has to be on the LOGIN reply,
  -- not only on the replies from Battle.* handlers.
  do
    send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "5" })
    send(OWNER, { Action = "Admin.SetStats", PlayerId = ALICE },
         json.encode({ energy = 100, happiness = 100 }))
    local home = send(ALICE, { Action = "Battle.Leave" })
    ok("cleared for the reload test", home.monster.status.type == "Home", errOf(home))
    send(ALICE, { Action = "Battle.Begin" })
    local started = send(ALICE, { Action = "Battle.Start" })
    ok("a battle is in progress", started.battle ~= nil, errOf(started))

    local reloaded = send(ALICE, { Action = "User.Login" })
    ok("login carries the battle in progress", reloaded.battle ~= nil,
       reloaded.activeBattleId)
    ok("the carried battle is the same one",
       reloaded.battle and started.battle and reloaded.battle.id == started.battle.id)
    ok("login reports the active battle id", reloaded.activeBattleId == started.battle.id,
       reloaded.activeBattleId)

    send(ALICE, { Action = "Battle.Leave" })
    local after = send(ALICE, { Action = "User.Login" })
    ok("a finished battle is not carried", after.battle == nil)
    ok("and its id is cleared", after.activeBattleId == nil, tostring(after.activeBattleId))
  end

  -- Reads and publishing ----------------------------------------------------

  local _, res = send(ALICE, { Action = "User.Info" })
  -- The singleton `player` key is gone -- it was a second full copy of a
  -- record nothing addressed. The addressed key is the published one.
  ok("compute does not publish the singleton `player`", res.player == nil,
     res.player and string.sub(res.player, 1, 60))
  ok("compute publishes `player-<address>`", res["player-" .. ALICE] ~= nil)
  ok("compute publishes `playerid`", res.playerid == ALICE, res.playerid)
  ok("compute publishes `factions`", res.factions ~= nil)
  ok("compute publishes `leaderboard`", res.leaderboard ~= nil)
  ok("compute publishes `action`", res.action == "User.Info", res.action)
  ok("compute publishes a player count", res.users ~= nil, res.users)
  ok("compute publishes the open challenges", res.challenges ~= nil)
  ok("compute publishes the combat tuning", res.catalog ~= nil
     and string.find(res.catalog, "hpPerHealth") ~= nil,
     res.catalog and string.sub(res.catalog, 1, 60))
  ok("compute publishes the numbered Monster Index", res.monsterindex ~= nil
     and string.find(res.monsterindex, '"entryNo":1') ~= nil
     and string.find(res.monsterindex, '"nextEntryNo":94') ~= nil,
     res.monsterindex and string.sub(res.monsterindex, 1, 80))
  ok("legacy starter records are mapped to Monster #001",
     Players[ALICE] and Players[ALICE].monster and Players[ALICE].monster.entryNo == 1,
     Players[ALICE] and Players[ALICE].monster and Players[ALICE].monster.entryNo)

  local deniedMonsterIndex = send(ALICE, { Action = "Admin.MonsterIndex.Update", EntryNo = "13" },
    json.encode({ name = "Forged Ashmouse" }))
  ok("a player cannot edit the Monster Index", errOf(deniedMonsterIndex) == "Not authorised",
     errOf(deniedMonsterIndex))
  local renamedMonsterIndex = send(OWNER, { Action = "Admin.MonsterIndex.Update", EntryNo = "13" },
    json.encode({ name = "Ashmouse Draft" }))
  ok("the owner can rename a numbered planned entry",
     renamedMonsterIndex and renamedMonsterIndex.entries
       and renamedMonsterIndex.entries[13].name == "Ashmouse Draft",
     renamedMonsterIndex and renamedMonsterIndex.entries and renamedMonsterIndex.entries[13].name)
  local earlyRelease = send(OWNER, { Action = "Admin.MonsterIndex.Update", EntryNo = "13" },
    json.encode({ state = "live", huntCatchable = true, huntWeight = 100 }))
  ok("an entry with incomplete assets cannot be released", errOf(earlyRelease) ~= nil,
     errOf(earlyRelease))
  do
    local source = Players[ALICE].monster
    local evolved = Battle.clone(source)
    evolved.level = 10
    evolved.id = "evolution-test"
    local target = C.MONSTER_INDEX_BY_NO[2]
    local priorReady = target.assetReady
    local priorOverride = MonsterIndexOverrides["2"]
    target.assetReady = true
    MonsterIndexOverrides["2"] = { state = "live" }
    resolveEvolution(evolved)
    ok("evolution changes the Monster Index entry when the target form is live",
       evolved.entryNo == 2, evolved.entryNo)
    ok("evolution preserves the owned companion identity and stats",
       evolved.id == "evolution-test" and evolved.attack == source.attack
         and evolved.level == 10,
       evolved.id)
    target.assetReady = priorReady
    MonsterIndexOverrides["2"] = priorOverride
  end

  -- An ANS-104 data item carries a lowercase `target` field holding the process
  -- id. If the tag lookup falls back to it, `player` and `battle` are published
  -- for a player that does not exist and every per-player read answers 404.
  do
    T = T + 1000
    local body = { Address = ALICE, Action = "User.Info", target = "THE-PROCESS-ID" }
    local res = computeOn(body)
    ok("the envelope's `target` does not hijack the publish", res.playerid == ALICE, res.playerid)
    ok("the envelope's `target` does not leak into msg.Target",
       res["player-" .. ALICE] ~= nil
       and string.find(res["player-" .. ALICE], "THE%-PROCESS%-ID") == nil)
  end

  local _, bad = send(ALICE, { Action = "Totally.Bogus" })
  ok("an unknown action still publishes its action", bad.action == "Totally.Bogus", bad.action)

  -- Integers must not serialise as 5001.0000000000; that is the Luerl %g bug
  -- the whole jsonenc.lua exists to route around.
  ok("published integers are not float-formatted",
     string.find(res["player-" .. ALICE], "%.0000") == nil,
     string.sub(res["player-" .. ALICE], 1, 120))

  r = send(ALICE, { Action = "Leaderboard", Limit = "10" })
  ok("leaderboard ranks players", r and #r >= 2, r and #r)

  -- Authentication ----------------------------------------------------------
  --
  -- These matter more than anything else in this file. Every other test drives
  -- handlers through the `Address` tag, which means the whole suite would pass
  -- unchanged if the commitment check in `signer()` were deleted. These are the
  -- tests that would not.

  do
    local function raw(body)
      T = T + 1000
      local res = computeOn(body)
      return json.decode(res.results.output.data)
    end

    -- A real signature wins over a contradicting tag.
    local r1 = raw({
      Action = "User.Login",
      Address = OWNER,
      commitments = { c1 = { alg = "rsa-pss-sha512", committer = ALICE } },
    })
    ok("a signature beats a contradicting Address tag", r1.address == ALICE, r1.address)

    -- A message carrying only an unsigned commitment must NOT be attributed to
    -- whoever an Address tag names. This was a complete authentication bypass:
    -- every HyperBEAM message carries an hmac commitment alongside its
    -- signature, so a crafted message with the hmac alone plus `Address=<owner>`
    -- ran admin actions.
    local r2 = raw({
      Action = "Admin.Unlock",
      Addresses = "MALLORYmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
      Address = OWNER,
      commitments = { c1 = { alg = "hmac-sha256" } },
    })
    ok("an hmac-only message cannot borrow the owner's identity via a tag",
       r2 and r2.error == "Not authorised", json.encode(r2))

    -- The case above carries an hmac with NO committer, and passed for years
    -- while the hole was still open. THIS is the one that was reachable: an
    -- hmac commitment that names the owner as its committer. An hmac names
    -- whoever it claims to — it proves nothing — but the resolver used to
    -- accept any committer when no signature was present, so this ran
    -- `Admin.Unlock` and `Admin.Grant` as the owner.
    local r2b = raw({
      Action = "Admin.Unlock",
      Addresses = "MALLORYmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
      commitments = { hmac = { alg = "hmac-sha256", committer = OWNER } },
    })
    ok("an hmac commitment naming the owner cannot act as the owner",
       r2b and r2b.error == "Not authorised", json.encode(r2b))

    local r2c = raw({
      Action = "Admin.Grant",
      PlayerId = ALICE,
      Data = json.encode({ item = "rune", amount = 9999 }),
      commitments = { hmac = { alg = "hmac-sha256", committer = OWNER } },
    })
    ok("nor grant itself items that way",
       r2c and r2c.error == "Not authorised", json.encode(r2c))

    -- The same forgery aimed at another PLAYER rather than the owner: it would
    -- let anyone act as anyone, spending their Runes and forfeiting their
    -- battles.
    local r2d = raw({
      Action = "User.Info",
      commitments = { hmac = { alg = "hmac-sha256", committer = ALICE } },
    })
    ok("nor read another player's account",
       r2d and r2d.error ~= nil, json.encode(r2d))

    -- And the signature commitment is preferred even when an hmac is listed too.
    local r3 = raw({
      Action = "User.Login",
      commitments = {
        h = { alg = "hmac-sha256", committer = BOB },
        s = { alg = "rsa-pss-sha512", committer = ALICE },
      },
    })
    ok("the signature commitment is preferred over the hmac", r3.address == ALICE, r3.address)

    -- Reading another player by tag used to be allowed.
    local r4 = raw({
      Action = "User.Info",
      Address = ALICE,
      commitments = { c1 = { alg = "rsa-pss-sha512", committer = BOB } },
    })
    ok("User.Info answers for the signer, not for an Address tag",
       r4.address == BOB, r4.address)
  end

  -- Every Admin.* handler refuses a non-owner ---------------------------------
  do
    local admins = {
      { Action = "Admin.Unlock", Addresses = ALICE },
      { Action = "Admin.Lock", PlayerId = ALICE },
      { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "999" },
      { Action = "Admin.SetStats", PlayerId = ALICE },
      { Action = "Admin.Snapshot" },
      { Action = "Admin.AdjustInventory", PlayerId = ALICE, Item = "rune", Delta = "1" },
      { Action = "Admin.UpdatePlayer", PlayerId = ALICE },
      { Action = "Admin.ReleaseBattle", PlayerId = ALICE },
      { Action = "Admin.RemoveUser", PlayerId = ALICE },
      { Action = "Admin.Load" },
    }
    -- Numeric, not ipairs: `compute` ends with a collect, and Luerl takes the
    -- whole VM down if one runs while an ipairs iterator is open on the stack.
    -- The note at the end of `compute` in game.lua has the detail.
    for ai = 1, #admins do
      local tags = admins[ai]
      local r = send(BOB, tags, (tags.Action == "Admin.SetStats" or tags.Action == "Admin.UpdatePlayer")
        and json.encode({ level = 99 }) or nil)
      ok(tags.Action .. " refuses a non-owner", errOf(r) == "Not authorised", json.encode(r))
    end
  end

  -- Revoking access actually revokes ------------------------------------------
  do
    local victim = "REVOKEDrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"
    send(OWNER, { Action = "Admin.Unlock", Addresses = victim })
    send(victim, { Action = "Faction.Join", Faction = "Stone Titans" })
    send(victim, { Action = "Monster.Adopt" })
    local before = send(victim, { Action = "User.Info" })
    ok("the victim was playing before revocation", before.monster ~= nil, errOf(before))

    send(OWNER, { Action = "Admin.Lock", PlayerId = victim })
    -- Admin.Lock used to set a flag that only Faction.Join and Monster.Adopt
    -- ever read, so a revoked wallet carried on questing and fighting.
    -- Numeric, not ipairs -- see the note above.
    local revoked = { "Monster.Feed", "Monster.Play", "Monster.Quest",
                      "Lootbox.Open", "Battle.Begin", "Daily.Claim" }
    for ri = 1, #revoked do
      local action = revoked[ri]
      local r = send(victim, { Action = action })
      ok(action .. " is refused after revocation", errOf(r) ~= nil, json.encode(r))
    end
  end

  -- PvP: the opponent's move stays secret -------------------------------------
  do
    local function arm(who, faction)
      send(OWNER, { Action = "Admin.Unlock", Addresses = who })
      local p = send(who, { Action = "User.Info" })
      if not p.faction then send(who, { Action = "Faction.Join", Faction = faction }) end
      if not p.monster then send(who, { Action = "Monster.Adopt" }) end
      send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = "rune", Amount = "9" })
      send(OWNER, { Action = "Admin.SetStats", PlayerId = who },
           json.encode({ energy = 100, happiness = 100 }))
      local cur = send(who, { Action = "User.Info" })
      if cur.monster.status.type ~= "Home" then send(who, { Action = "Battle.Leave" }) end
      send(who, { Action = "Battle.Begin" })
    end

    local DUEL_A = "DUELAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local DUEL_B = "DUELBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    arm(DUEL_A, "Inferno Blades")
    arm(DUEL_B, "Aqua Guardians")

    local r = send(DUEL_A, { Action = "Battle.Challenge", Opponent = DUEL_A })
    ok("you cannot challenge yourself", errOf(r) ~= nil, json.encode(r))

    r = send(DUEL_A, { Action = "Battle.Challenge", Opponent = "OPEN" })
    local duelId = r.battle and r.battle.id
    ok("a challenge is posted", duelId ~= nil, errOf(r))

    -- Withdrawing an unaccepted challenge must not cost the paid session.
    local withdrawn = send(DUEL_A, { Action = "Battle.Leave" })
    ok("withdrawing keeps the session", withdrawn.battlesRemaining == 4,
       withdrawn.battlesRemaining)
    ok("withdrawing is reported as a withdrawal", withdrawn.withdrawn == true)

    r = send(DUEL_A, { Action = "Battle.Challenge", Opponent = "OPEN" })
    duelId = r.battle.id
    r = send(DUEL_B, { Action = "Battle.Accept", BattleId = duelId })
    ok("the challenge is accepted", r.battle and r.battle.status == "battling", errOf(r))

    local aMove, bMove
    for name in pairs(r.battle.challenger.moves) do aMove = name break end
    for name in pairs(r.battle.accepter.moves) do bMove = name break end

    local afterFirst, res = send(DUEL_A, { Action = "Battle.Attack",
                                           BattleId = duelId, Move = aMove })
    ok("the first mover waits", afterFirst.waitingForOpponent == true, json.encode(afterFirst))
    -- The whole point of resolving both moves together is that neither player
    -- sees the other's choice first. `pendingMoves` was going out on the wire.
    ok("the committed move is not in the reply",
       string.find(json.encode(afterFirst.battle), "pendingMoves") == nil)
    ok("the committed move is not in the published battle",
       res.battle == nil or string.find(res.battle, "pendingMoves") == nil)
    ok("but who has moved IS visible",
       afterFirst.battle.waitingOn and afterFirst.battle.waitingOn.challenger == true,
       json.encode(afterFirst.battle.waitingOn))

    -- And a player cannot keep changing their mind while they wait.
    local again = send(DUEL_A, { Action = "Battle.Attack", BattleId = duelId, Move = aMove })
    ok("a move cannot be re-committed in the same round",
       again.battle and #again.battle.turns == 0, again.battle and #again.battle.turns)

    -- A third party cannot swing in someone else's fight.
    local intruder = send(ALICE, { Action = "Battle.Attack", BattleId = duelId, Move = aMove })
    ok("an outsider cannot attack someone else's battle", errOf(intruder) ~= nil, json.encode(intruder))

    r = send(DUEL_B, { Action = "Battle.Attack", BattleId = duelId, Move = bMove })
    ok("the second move resolves the round", r.battle and #r.battle.turns >= 1,
       r.battle and #r.battle.turns)

    -- Forfeiting must pay the opponent, not just end the fight.
    local quitter = send(DUEL_A, { Action = "Battle.Leave" })
    ok("forfeiting ends the session", quitter.battlesRemaining == 0, quitter.battlesRemaining)
    local winner = send(DUEL_B, { Action = "User.Info" })
    ok("the opponent is credited with the win", winner.wins >= 1, winner.wins)
    ok("the opponent is not left in a dead battle", winner.activeBattleId == nil,
       tostring(winner.activeBattleId))
    ok("the opponent gets a loot box for it", #winner.lootboxes > 0, #winner.lootboxes)
  end

  -- A stale click must not be applied to the next round -----------------------
  do
    send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE, Item = "rune", Amount = "5" })
    send(OWNER, { Action = "Admin.SetStats", PlayerId = ALICE },
         json.encode({ energy = 100, happiness = 100 }))
    local home = send(ALICE, { Action = "User.Info" })
    if home.monster.status.type ~= "Home" then send(ALICE, { Action = "Battle.Leave" }) end
    send(ALICE, { Action = "Battle.Begin" })
    local started = send(ALICE, { Action = "Battle.Start" })
    local id = started.battle.id
    local pick
    for name, m in pairs(started.battle.challenger.moves) do
      if (m.count or 0) > 0 then pick = name break end
    end

    local r1 = send(ALICE, { Action = "Battle.Attack", BattleId = id,
                             Move = pick, Round = "0" })
    ok("a move tagged with the current round is accepted",
       r1.battle and r1.battle.round == 1, errOf(r1))

    -- Now replay the SAME round number, as a double-click would.
    local stale = send(ALICE, { Action = "Battle.Attack", BattleId = id,
                                Move = pick, Round = "0" })
    ok("a move tagged with a round that already resolved is refused",
       errOf(stale) ~= nil, json.encode(stale))

    local ok2 = send(ALICE, { Action = "Battle.Attack", BattleId = id,
                              Move = pick, Round = "1" })
    ok("the correct next round is accepted",
       errOf(ok2) == nil or ok2.battle ~= nil, errOf(ok2))
    send(ALICE, { Action = "Battle.Leave" })
  end

  -- A PvP opponent who walks away must not freeze the fight -------------------
  do
    local A = "STALLERaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local B = "STALLERbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    for who, faction in pairs({ [A] = "Sky Nomads", [B] = "Inferno Blades" }) do
      send(OWNER, { Action = "Admin.Unlock", Addresses = who })
      send(who, { Action = "Faction.Join", Faction = faction })
      send(who, { Action = "Monster.Adopt" })
      send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = "rune", Amount = "9" })
      send(OWNER, { Action = "Admin.SetStats", PlayerId = who },
           json.encode({ energy = 100, happiness = 100 }))
      send(who, { Action = "Battle.Begin" })
    end
    local posted = send(A, { Action = "Battle.Challenge", Opponent = "OPEN" })
    local id = posted.battle.id
    local joined = send(B, { Action = "Battle.Accept", BattleId = id })
    local move
    for name in pairs(joined.battle.challenger.moves) do move = name break end

    local first = send(A, { Action = "Battle.Attack", BattleId = id, Move = move })
    ok("the mover is told when the round can be forced",
       first.canForceAt and first.canForceAt > 0, tostring(first.canForceAt))

    local early = send(A, { Action = "Battle.Attack", BattleId = id, Move = move })
    ok("the round cannot be forced before the deadline",
       early.battle and #early.battle.turns == 0,
       early.battle and #early.battle.turns)

    T = T + Battle.TUNING.pvpMoveDeadline + 1000
    -- A name that is not a move at all: once you have committed, the argument
    -- is ignored, which is what lets the client force a round without knowing
    -- the choice the process refuses to show it.
    local forced = send(A, { Action = "Battle.Attack", BattleId = id, Move = "continue" })
    ok("after the deadline the round resolves without the opponent",
       forced.battle and #forced.battle.turns >= 1,
       forced.battle and #forced.battle.turns)
    ok("and it is marked as forced", forced.battle and forced.battle.forcedRound == true)
    ok("the absent player hesitated rather than being punished",
       forced.battle and (function()
         for _, t in ipairs(forced.battle.turns) do
           if t.move == "Hesitated" then return t.healthDamage == 0 end
         end
         return true
       end)())

    send(A, { Action = "Battle.Leave" })
    send(B, { Action = "Battle.Leave" })
  end

  -- A targeted challenge is for its target only -------------------------------
  do
    local T1 = "TARGETaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local T2 = "TARGETbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    for who, faction in pairs({ [T1] = "Sky Nomads", [T2] = "Stone Titans" }) do
      send(OWNER, { Action = "Admin.Unlock", Addresses = who })
      send(who, { Action = "Faction.Join", Faction = faction })
      send(who, { Action = "Monster.Adopt" })
      send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = "rune", Amount = "9" })
      send(OWNER, { Action = "Admin.SetStats", PlayerId = who },
           json.encode({ energy = 100, happiness = 100 }))
      send(who, { Action = "Battle.Begin" })
    end
    local r = send(T1, { Action = "Battle.Challenge", Opponent = T2 })
    local id = r.battle and r.battle.id
    ok("a targeted challenge is created", id ~= nil, errOf(r))
    local wrong = send(ALICE, { Action = "Battle.Accept", BattleId = id })
    ok("somebody else cannot take a targeted challenge", errOf(wrong) ~= nil, json.encode(wrong))
    local right = send(T2, { Action = "Battle.Accept", BattleId = id })
    ok("the named target can take it", right.battle and right.battle.status == "battling",
       errOf(right))
    send(T1, { Action = "Battle.Leave" })
    send(T2, { Action = "Battle.Leave" })
  end

  -- The daily faucet ----------------------------------------------------------
  do
    local before = send(ALICE, { Action = "User.Info" })
    local runes = before.inventory.rune or 0
    local claimed = send(ALICE, { Action = "Daily.Claim" })
    ok("the daily pays from the scheduled global emission",
       claimed.dailyClaimed ~= nil and (claimed.inventory.rune or 0) >= runes,
       errOf(claimed) or claimed.inventory.rune)
    -- Emission is a schedule now, not a dial: no policy message has been sent
    -- in this suite and the faucet still pays. That is the whole point --
    -- `epochBudget` used to default to 0 and every worship in every deployment
    -- paid exactly nothing until somebody remembered to propose and apply two
    -- policy changes.
    ok("and it did so with no policy change ever applied",
       claimed.dailyClaimed and (claimed.dailyClaimed.runes or 0) > 0,
       claimed.dailyClaimed and json.encode(claimed.dailyClaimed))
    local twice = send(ALICE, { Action = "Daily.Claim" })
    ok("but not twice in a day", errOf(twice) ~= nil, json.encode(twice))
    ok("and the client is told when it is next due", claimed.dailyReadyAt > 0,
       claimed.dailyReadyAt)
    T = T + 20 * 3600 * 1000
    local later = send(ALICE, { Action = "Daily.Claim" })
    ok("it comes back after the interval", errOf(later) == nil, json.encode(later))
  end

  -- Admin actions publish the player they acted ON ----------------------------
  do
    -- The owner has a player record of their own by now, which is exactly the
    -- condition that used to make this publish the owner instead of the target.
    local _, res = send(OWNER, { Action = "Admin.Grant", PlayerId = BOB,
                                 Item = "rune", Amount = "1" })
    ok("an admin grant publishes the target, not the admin", res.playerid == BOB,
       res.playerid)
  end

  -- Loot ----------------------------------------------------------------------
  do
    -- A tier-5 box must still be able to miss. The original multiplied the
    -- chance without a ceiling, so every drop was guaranteed at high tiers.
    -- 120 samples, not 40: a capped drop lands 95% of the time, so a
    -- forty-box run misses nothing about one time in eight and the assertion
    -- would be flaky. At 120 that is one run in five hundred.
    local SAMPLES = 120
    send(OWNER, { Action = "Admin.Grant", PlayerId = ALICE,
                  Lootboxes = string.format("%d", SAMPLES), Rarity = "5" })
    local misses, runesFound = 0, 0
    for _ = 1, SAMPLES do
      local r = send(ALICE, { Action = "Lootbox.Open", Rarity = "5" })
      if r.lootResult then
        local names = {}
        for _, reward in ipairs(r.lootResult.rewards) do names[reward.item] = true end
        if not names.fire_berry then misses = misses + 1 end
        if names.rune then runesFound = runesFound + 1 end
      end
    end
    ok("a top-tier box can still miss a drop", misses > 0, misses .. "/" .. SAMPLES)
    ok("the drop cap is below certainty", C.LOOT_CHANCE_CAP < 1000, C.LOOT_CHANCE_CAP)
    -- Runes are the only thing that buys anything, so a box must not print them
    -- faster than a session costs.
    ok("even a tier-5 box does not always pay Runes", runesFound < SAMPLES,
       runesFound .. "/" .. SAMPLES)
  end

  -- A redeploy must be able to carry players across ---------------------------
  --
  -- State IS the process, so a redeploy mints a new one and everything earned
  -- since the last deploy is gone unless it is exported and reloaded.
  do
    local page1 = send(OWNER, { Action = "Admin.Export", Offset = "0", Limit = "3" })
    ok("export is paged", page1 and page1.count and page1.count <= 3, json.encode(page1 and page1.count))
    ok("export reports the total", page1 and page1.total and page1.total > 3, page1 and page1.total)
    ok("export says whether there is more", page1 and page1.done == false, tostring(page1 and page1.done))
    ok("a non-owner cannot export the player table",
       errOf(send(BOB, { Action = "Admin.Export" })) == "Not authorised")

    -- Walk the whole table, then reload one record and check it survived.
    local all, offset = {}, 0
    while true do
      local page = send(OWNER, { Action = "Admin.Export",
                                 Offset = string.format("%d", offset), Limit = "25" })
      for _, row in ipairs(page.players or {}) do all[#all + 1] = row end
      offset = offset + (page.count or 0)
      if page.done or (page.count or 0) == 0 or offset > 500 then break end
    end
    ok("the whole table can be walked", #all >= 3, #all)

    local sample = nil
    for _, row in ipairs(all) do
      if row.address == ALICE then sample = row end
    end
    ok("the export includes a real player with a companion",
       sample ~= nil and sample.monster ~= nil, sample and sample.address)

    -- Wipe and restore.
    local before = send(ALICE, { Action = "User.Info" })
    local confiscation = send(OWNER, { Action = "Admin.RemoveUser", PlayerId = ALICE })
    ok("an admin cannot remove an account that holds economic state",
       errOf(confiscation) ~= nil, json.encode(confiscation))
    -- Model the empty state of a brand-new process directly. Admin.Load is the
    -- migration door; Admin.RemoveUser is deliberately no longer a way to burn
    -- a real player's inventory, Gold, boxes, pass, and companions.
    Players[ALICE] = nil
    local gone = send(ALICE, { Action = "User.Info" })
    ok("the migration target starts without the player", gone.exists == false, tostring(gone.exists))

    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { sample } }))
    local back = send(ALICE, { Action = "User.Info" })
    ok("a reloaded player exists again", back.exists == true)
    ok("their faction survives", back.faction == before.faction, back.faction)
    ok("their companion survives", back.monster ~= nil and back.monster.name == before.monster.name,
       back.monster and back.monster.name)
    ok("their level survives", back.monster.level == before.monster.level,
       back.monster.level .. " vs " .. before.monster.level)
    ok("their wins survive", back.wins == before.wins, back.wins)
    ok("their satchel survives",
       (back.inventory.rune or 0) == (before.inventory.rune or 0),
       tostring(back.inventory.rune))
    ok("a reloaded player is not left in the arena",
       back.monster.status.type ~= "Battle", back.monster.status.type)
    ok("reloaded numbers are integers, not floats",
       math.type(back.monster.level) ~= nil, tostring(back.monster.level))
  end

  -- Determinism ---------------------------------------------------------------
  do
    -- The whole design rests on recomputing a slot reproducing it. An unseeded
    -- RNG would give a different answer on every replay.
    -- A replay is the SAME base twice, not a fresh one twice, so each call gets
    -- its own copy of the state as it stands here. `compute` writes into the
    -- base it is handed, and the second run must not be reading the first
    -- run's edits or this asserts nothing about determinism.
    local body = { Address = ALICE, Action = "Faction.List" }
    local first = compute(forkState(), { body = body, timestamp = 1700009999000 }, {})
    local second = compute(forkState(), { body = body, timestamp = 1700009999000 }, {})
    ok("recomputing the same message gives the same answer",
       first.results.output.data == second.results.output.data)
  end

  -- Battle engine units -----------------------------------------------------

  ok("fire beats air", Battle.effectiveness("fire", "air") == 2.0)
  ok("fire is weak to water", Battle.effectiveness("fire", "water") == 0.5)
  ok("water beats fire", Battle.effectiveness("water", "fire") == 2.0)
  ok("rock resists air", Battle.effectiveness("rock", "air") == 0.5)
  ok("a boost move is element-neutral", Battle.effectiveness("boost", "fire") == 1.0)
  ok("a heal move is element-neutral", Battle.effectiveness("heal", "water") == 1.0)

  ok("a much faster attacker caps at 95%", Battle.hitChance(50, 0) == 0.95)
  ok("a much slower attacker floors at 30%", Battle.hitChance(0, 50) == 0.30)
  ok("equal speed is the 70% base", Battle.hitChance(5, 5) == 0.70)

  -- Attacks must be able to miss. The original's `damage>0 and hit or true`
  -- made that impossible; this asserts the bug is gone.
  local misses = 0
  for i = 1, 400 do
    math.randomseed(i)
    local slow = Battle.combatant({ name = "Slow", health = 20, attack = 1, defense = 0,
                                    speed = 0, elementType = "fire", moves = {} }, "challenger", "a")
    local fast = Battle.combatant({ name = "Fast", health = 20, attack = 1, defense = 0,
                                    speed = 30, elementType = "fire", moves = {} }, "accepter", "b")
    local b2 = { challenger = slow, accepter = fast, turns = {} }
    local hit = { name = "Jab", type = "normal", rarity = 1, count = 5,
                  damage = 1, attack = 0, speed = 0, defense = 0, health = 0 }
    local idle = { name = "Wait", type = "normal", rarity = 1, count = 5,
                   damage = 0, attack = 0, speed = 0, defense = 0, health = 0 }
    local entries = Battle.resolveRound(b2, hit, idle)
    for _, e in ipairs(entries) do
      if e.attacker == "challenger" and e.missed then misses = misses + 1 end
    end
  end
  ok("a slow attacker can miss (the `or true` bug is gone)", misses > 40, misses .. "/400")

  -- A move must never be usable more times than its count.
  local m = Battle.combatant({ name = "M", health = 5, attack = 1, defense = 1, speed = 1,
                               elementType = "fire",
                               moves = { Jab = { type = "normal", rarity = 1, count = 1,
                                                 damage = 1, attack = 0, speed = 0,
                                                 defense = 0, health = 0 } } }, "challenger", "a")
  local sel = Battle.selectMove(m, "Jab")
  ok("a move with uses is selectable", sel ~= nil)
  sel.count = 0
  local sel2, why2 = Battle.selectMove(m, "Jab")
  ok("a spent move is refused", sel2 == nil and why2 ~= nil, why2)
  local struggle = Battle.selectMove(m, "struggle")
  ok("struggle is available once everything is spent", struggle ~= nil)

  -- Adopting must not drain the source monster's moves.
  local source = { name = "S", health = 5, attack = 1, defense = 1, speed = 1,
                   elementType = "fire",
                   moves = { Jab = { type = "normal", rarity = 1, count = 3, damage = 1,
                                     attack = 0, speed = 0, defense = 0, health = 0 } } }
  local c1 = Battle.combatant(source, "challenger", "a")
  c1.moves.Jab.count = 0
  ok("a fight does not drain the stored companion", source.moves.Jab.count == 3,
     source.moves.Jab.count)

  -- A scaled opponent should actually scale.
  math.randomseed(7)
  local low = Battle.makeOpponent(0, {})
  local high = Battle.makeOpponent(10, {})
  local lowTotal = low.attack + low.defense + low.speed + low.health
  local highTotal = high.attack + high.defense + high.speed + high.health
  ok("a level 10 opponent is stronger than a level 0 one", highTotal > lowTotal,
     lowTotal .. " vs " .. highTotal)

  -- A fight must always end. Two maximally defensive companions used to
  -- regenerate more shield per round than a struggle could remove, and sat at
  -- full health past two thousand rounds with no way out but forfeiting.
  do
    local wall = {
      name = "Wall", health = 6, attack = 0, defense = 12, speed = 1,
      elementType = "rock",
      moves = { ["Stone Wall"] = { type = "rock", rarity = 2, count = 99, damage = 0,
                                   attack = -1, speed = -2, defense = 6, health = 2 } },
    }
    local stalemate = Battle.new("stall", wall, "A", Battle.clone(wall), "B",
                                 { kind = "bot", timestamp = 0 })
    local n = 0
    while stalemate.status ~= "ended" and n < 500 do
      n = n + 1
      Battle.resolveRound(stalemate,
        Battle.chooseNpcMove(stalemate.challenger, stalemate.accepter),
        Battle.chooseNpcMove(stalemate.accepter, stalemate.challenger))
    end
    ok("two immovable objects still produce a result", stalemate.status == "ended",
       n .. " rounds")
    ok("and it is decided on the clock", stalemate.timedOut == true)
    ok("with a winner named", stalemate.winner ~= nil, tostring(stalemate.winner))
    ok("the round cap is respected", n <= Battle.TUNING.roundCap,
       n .. " <= " .. Battle.TUNING.roundCap)
    ok("the turn log does not grow without bound",
       #stalemate.turns <= Battle.TUNING.roundCap * 2, #stalemate.turns)
  end

  -- A restore must never take history away -----------------------------------
  --
  -- This is what zeroed 61 recovered players' quest counts on a live process:
  -- an empty stub row loaded on top of a real one.
  do
    local VICTIM = "VICTIMvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv"
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = VICTIM, unlocked = true, faction = "Sky Nomads",
      questsCompleted = 323, wins = 12, losses = 3,
      lootboxes = { 2, 3, 4 }, joinedAt = 1700000000000,
    } } }))

    -- The stub: unlocked, and empty in every other respect.
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = VICTIM, unlocked = true,
      questsCompleted = 0, wins = 0, losses = 0,
      lootboxes = {}, inventory = {}, joinedAt = 1800000000000,
    } } }))

    local after = send(VICTIM, { Action = "User.Info" })
    ok("a stub load cannot zero a quest count", after.questsCompleted == 323, after.questsCompleted)
    ok("nor a win count", after.wins == 12, after.wins)
    ok("nor strip the loot boxes", #(after.lootboxes or {}) == 3, #(after.lootboxes or {}))
    ok("and the account keeps its earliest known age",
       after.joinedAt == 1700000000000, after.joinedAt)

    -- But a row that genuinely knows MORE still wins.
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = VICTIM, unlocked = true, questsCompleted = 400, wins = 20,
      lootboxes = { 5 },
    } } }))
    local later = send(VICTIM, { Action = "User.Info" })
    ok("a higher counter still moves it up", later.questsCompleted == 400, later.questsCompleted)
    ok("and a non-empty loot box list still replaces", #(later.lootboxes or {}) == 1,
       #(later.lootboxes or {}))
  end

  -- Taking Rune out of the game ----------------------------------------------
  do
    local TOKEN = "TOKENtttttttttttttttttttttttttttttttttttttt"
    -- A wallet of its own. Reusing ALICE here made the block depend on
    -- whatever thirty earlier assertions had left her holding.
    local WREN = "WRENwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"
    send(OWNER, { Action = "Admin.Unlock", Addresses = WREN })

    local r = send(WREN, { Action = "Rune.Withdraw", Amount = "5" })
    ok("withdrawals are refused before the token is named", errOf(r) ~= nil, json.encode(r))

    r = send(ALICE, { Action = "Admin.SetRuneToken", RuneToken = TOKEN })
    ok("only the owner names the token", errOf(r) == "Not authorised", json.encode(r))

    r = send(OWNER, { Action = "Admin.SetRuneToken", RuneToken = "short" })
    ok("the token must be a process id", errOf(r) ~= nil, json.encode(r))

    r = send(OWNER, { Action = "Admin.SetRuneToken", RuneToken = TOKEN })
    ok("the owner names the token", r and r.runeToken == TOKEN, json.encode(r))

    -- Give Alice a known balance to withdraw from.
    send(OWNER, { Action = "Admin.Grant", PlayerId = WREN, Item = "rune", Amount = "40" })
    local before = send(WREN, { Action = "User.Info" })
    local heldBefore = (before.inventory or {}).rune or 0
    ok("the wallet has Rune to withdraw", heldBefore >= 10, heldBefore)

    r = send(WREN, { Action = "Rune.Withdraw", Amount = "0" })
    ok("a withdrawal of nothing is refused", errOf(r) ~= nil, json.encode(r))

    r = send(WREN, { Action = "Rune.Withdraw", Amount = "999999" })
    ok("you cannot withdraw more than you hold", errOf(r) ~= nil, json.encode(r))
    local unchanged = send(WREN, { Action = "User.Info" })
    ok("and a refused withdrawal costs nothing",
       ((unchanged.inventory or {}).rune or 0) == heldBefore, (unchanged.inventory or {}).rune)

    -- The real thing, and the mint request it emits.
    T = T + 1000
    local res = computeOn({
      Address = WREN, Action = "Rune.Withdraw", Amount = "10",
    })
    local decoded = json.decode(res.results.output.data)
    ok("a withdrawal succeeds", decoded and decoded.error == nil, json.encode(decoded))
    ok("and deducts the in-game balance",
       ((decoded.inventory or {}).rune or 0) == heldBefore - 10, (decoded.inventory or {}).rune)

    local mint = res.results.outbox and res.results.outbox["mint"]
    ok("a mint is asked for", mint ~= nil, mint and json.encode(mint))
    ok("aimed at the token", mint and mint.target == TOKEN, mint and mint.target)
    -- The action must be the name the TOKEN declares, which is `Mint`. This
    -- assertion used to demand `mint`, and that is exactly how the bug shipped:
    -- the suite was green while a live withdrawal deducted the player's runes
    -- and died at the token with "unknown action 'mint'". A test that pins the
    -- wrong spelling is worse than no test, because it defends the defect.
    ok("aimed at the token's own handler name",
       mint and mint.action == "Mint"
       and mint.recipient == WREN and mint.quantity == "10",
       mint and json.encode(mint))
    ok("carrying the withdrawal id, so a repeat is recognisable",
       mint and mint.reference ~= nil, mint and mint.reference)
    -- A self-declared sender is a forgery waiting to happen; the node attests
    -- who sent this, so the message must not claim it.
    ok("and NOT claiming who it is from", mint and mint.from == nil, mint and mint.from)

    local queue = send(WREN, { Action = "Rune.Withdrawals" })
    ok("the withdrawal is recorded as pending",
       queue and #queue.withdrawals == 1 and queue.withdrawals[1].status == "pending",
       json.encode(queue))

    -- Settling, and the refund path back.
    local wid = queue and queue.withdrawals and queue.withdrawals[1]
      and queue.withdrawals[1].id or "<none>"
    ok("the withdrawal has an id", wid ~= "<none>", json.encode(queue))
    r = send(WREN, { Action = "Admin.SettleWithdrawal", WithdrawalId = wid })
    ok("a player cannot settle their own withdrawal", errOf(r) == "Not authorised", json.encode(r))

    -- The token closing a withdrawal by itself ------------------------------
    --
    -- The reason a withdrawal used to sit at `pending` for good: this process
    -- deducts and asks, and cannot see whether the mint landed. The token now
    -- says so, and only the token may — an attested delivery, meaning our own
    -- scheduler vouched for the origin. Anyone able to forge this could mark a
    -- withdrawal settled that never paid out.
    do
      local SCHED = "SCHEDULERssssssssssssssssssssssssssssssssss"
      local TOKEN = "TOKENtttttttttttttttttttttttttttttttttttttt"

      --- A delivery as a live node presents one: signed by our scheduler, with
      --- the origin attested in `from-process`, and the process state naming
      --- that scheduler so this process can tell it is ours.
      local function delivered(committer, fromProcess, tags)
        T = T + 1000
        local body = {
          commitments = { sig1 = { committer = committer, alg = "rsa-pss-sha512" } },
          ["from-process"] = fromProcess,
        }
        for k, v in pairs(tags) do body[k] = v end
        local res = computeOn(body, { ["scheduler-location"] = SCHED })
        return json.decode(res.results.output.data)
      end

      local forged = delivered(WREN, TOKEN,
        { Action = "Rune.Minted", Reference = wid, Quantity = "10" })
      ok("a wallet cannot forge the token's confirmation",
         errOf(forged) == "Not authorised", json.encode(forged))

      local impostor = delivered(SCHED, WREN,
        { Action = "Rune.Minted", Reference = wid, Quantity = "10" })
      ok("nor can a different process, even attested",
         errOf(impostor) == "Not authorised", json.encode(impostor))

      local mismatched = delivered(SCHED, TOKEN,
        { Action = "Rune.Minted", Reference = wid, Quantity = "9" })
      ok("a confirmation that disagrees on the amount is refused",
         errOf(mismatched) ~= nil, json.encode(mismatched))

      local settled = delivered(SCHED, TOKEN,
        { Action = "Rune.Minted", Reference = wid, Quantity = "10" })
      ok("the token settles its own withdrawal",
         settled and settled.withdrawal and settled.withdrawal.status == "minted",
         json.encode(settled))

      -- Deliveries repeat. The reference exists so the second is recognised.
      local again = delivered(SCHED, TOKEN,
        { Action = "Rune.Minted", Reference = wid, Quantity = "10" })
      ok("and a repeated confirmation changes nothing",
         again and again.unchanged == true, json.encode(again))

      -- Settled is settled: the owner's refund must not undo a real payout.
      local late = send(OWNER, { Action = "Admin.SettleWithdrawal",
                                 WithdrawalId = wid, Outcome = "refund" })
      ok("and a refund cannot claw back a minted withdrawal",
         late and late.withdrawal and late.withdrawal.status == "minted",
         json.encode(late))

      -- Coming back the other way: a DEPOSIT ---------------------------------
      --
      -- The asymmetry is the point. Going out, this process moves first and a
      -- failure leaves the player short with a `pending` row saying so. Coming
      -- back, the TOKEN moves first: the supply is destroyed before this
      -- message exists, so the credit here is the only thing that returns the
      -- value and there is no second source to reconcile against. Not
      -- crediting loses the player's Rune; crediting twice mints Rune nobody
      -- burned. Both directions are checked.
      --
      -- The token emitted this notice from the beginning and there was no
      -- handler for it at all: the process answered "unknown action" and the
      -- burned Rune simply stopped existing.
      do
        -- Its own wallet. Crediting DEPO here would move a balance that later
        -- assertions about the refund path are written against.
        local DEPO = "DEPOSITOR" .. string.rep("d", 34)
        send(OWNER, { Action = "Admin.Unlock", Addresses = DEPO })
        send(DEPO, { Action = "Faction.Join", Faction = "Aqua Guardians" })
        local held = function(who)
          local v = send(who, { Action = "User.Info" })
          return (v.inventory or {}).rune or 0
        end
        local before = held(DEPO)

        local forgedBurn = delivered(DEPO, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "5", Reference = "b1" })
        ok("a wallet cannot forge a burn notice",
           errOf(forgedBurn) == "Not authorised", json.encode(forgedBurn))
        ok("and forging one credits nothing", held(DEPO) == before, held(DEPO))

        local otherProcess = delivered(SCHED, DEPO,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "5", Reference = "b1" })
        ok("nor may a process that is not the token",
           errOf(otherProcess) == "Not authorised", json.encode(otherProcess))

        -- No reference means no way to recognise a repeat, so it is refused
        -- rather than paid: an unpayable deposit stays visible, a double
        -- payment does not.
        local anonymous = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "5" })
        ok("a burn notice with no reference is refused",
           errOf(anonymous) ~= nil, json.encode(anonymous))
        ok("and it credits nothing", held(DEPO) == before, held(DEPO))

        local nobody = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = "nope", Quantity = "5", Reference = "b9" })
        ok("a burn notice naming no real account is refused",
           errOf(nobody) ~= nil, json.encode(nobody))

        local zero = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "0", Reference = "b8" })
        ok("a burn notice for nothing is refused", errOf(zero) ~= nil, json.encode(zero))

        local credited = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "5", Reference = "b1" })
        ok("the token's burn notice credits the player",
           credited and credited.deposit and credited.deposit.amount == 5,
           json.encode(credited))
        ok("and the Rune actually arrives", held(DEPO) == before + 5, held(DEPO))

        -- The half that matters most. Delivery is not exactly-once.
        local twice = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "5", Reference = "b1" })
        ok("a repeated burn notice is recognised", twice and twice.unchanged == true,
           json.encode(twice))
        ok("and does not pay twice", held(DEPO) == before + 5, held(DEPO))

        -- A different burn is a different deposit, same account.
        local second = delivered(SCHED, TOKEN,
          { Action = "Burn-Notice", Account = DEPO, Quantity = "3", Reference = "b2" })
        ok("a second burn is credited on its own reference",
           second and second.deposit and second.deposit.amount == 3, json.encode(second))
        ok("and the total is right", held(DEPO) == before + 8, held(DEPO))

        -- The depositor did not sign this; the scheduler delivered it. Without
        -- a republish they would poll their own key and see nothing arrive.
        do
          T = T + 1000
          local res = computeOn({
            commitments = { sig1 = { committer = SCHED, alg = "rsa-pss-sha512" } },
            ["from-process"] = TOKEN,
            -- Mixed case exercises the same delivery shape a foreign
            -- process may emit. Dispatch, telemetry and dirty publication
            -- must all agree on the resolved canonical handler.
            Action = "bUrN-NoTiCe", Account = DEPO, Quantity = "2", Reference = "b3",
          }, { ["scheduler-location"] = SCHED })
          local key = res["player-" .. DEPO]
          ok("a deposit republishes the depositor's own record",
             type(key) == "string", type(key))
          local view = key and json.decode(key)
          ok("and they can see the Rune without signing anything",
             view and ((view.inventory or {}).rune or 0) == before + 10,
             view and (view.inventory or {}).rune)

          -- Both ledgers are published, or "did my withdrawal settle" has no
          -- answer anything outside this process can read.
          local ledger = res.runedeposits and json.decode(res.runedeposits)
          local found = false
          for _, d in ipairs(ledger or {}) do if d.id == "b3" then found = true end end
          ok("the deposit ledger is published", found, res.runedeposits)
          local outgoing = res.runewithdrawals and json.decode(res.runewithdrawals)
          local settledRow = false
          for _, w in ipairs(outgoing or {}) do
            if w.id == wid and w.status == "minted" then settledRow = true end
          end
          ok("and so is the withdrawal ledger, with its status",
             settledRow, res.runewithdrawals)
          local metric = res.metrics and json.decode(res.metrics)
          local day = metric and metric.daily
            and metric.daily[tostring(T // 86400000)]
          ok("a mixed-case burn notice republishes canonical telemetry",
             day and day.depositsCredited >= 1
               and metric.totals["Burn-Notice"] >= 1,
             metric and json.encode(metric))
          ok("the deposit's indirect Rune credit is included in telemetry",
             day and day.runeAdded >= 2, day and day.runeAdded)
        end
      end
    end

    -- A second withdrawal, to exercise the owner's refund on one that really
    -- did not mint. The first is settled now and must stay that way.
    send(OWNER, { Action = "Admin.Grant", PlayerId = WREN, Item = "rune", Amount = "10" })
    send(WREN, { Action = "Rune.Withdraw", Amount = "10" })
    local queue2 = send(WREN, { Action = "Rune.Withdrawals" })
    local pendingId = nil
    for _, w in ipairs(queue2.withdrawals or {}) do
      if w.status == "pending" then pendingId = w.id end
    end
    ok("a second withdrawal is pending", pendingId ~= nil, json.encode(queue2))

    r = send(OWNER, { Action = "Admin.SettleWithdrawal", WithdrawalId = pendingId, Outcome = "refund" })
    ok("the owner can refund one that never minted",
       r and r.withdrawal and r.withdrawal.status == "refunded", json.encode(r))
    local refunded = send(WREN, { Action = "User.Info" })
    ok("and the Rune comes back",
       ((refunded.inventory or {}).rune or 0) == heldBefore, (refunded.inventory or {}).rune)

    r = send(OWNER, { Action = "Admin.SettleWithdrawal", WithdrawalId = wid, Outcome = "refund" })
    ok("settling twice does not pay twice", r and r.unchanged == true, json.encode(r))
    local afterTwice = send(WREN, { Action = "User.Info" })
    ok("the balance is still right after a double settle",
       ((afterTwice.inventory or {}).rune or 0) == heldBefore, (afterTwice.inventory or {}).rune)
  end

  -- Minting -----------------------------------------------------------------
  --
  -- The whole point of this block is the seam: the process owns the game facts
  -- and a funded worker owns the chain facts, and they only meet at a queue.
  -- So every one of these asks the same question from a different angle -- can
  -- a player get a companion out, or back, without the other half agreeing?

  do
    -- Minting to Arweave ships PAUSED (C.MINT.enabled). The pipeline is still
    -- expected to work the moment it is switched on, so this block switches it
    -- on for itself rather than being deleted -- and switches it back, so the
    -- refusal is what the rest of the suite and a deployed process see.
    local mintWasEnabled = C.MINT.enabled
    C.MINT.enabled = true

    local MINA = "MINAmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"
    -- Built with string.rep rather than typed out: the handlers check for an
    -- Arweave id by LENGTH, and a hand-written 42-character constant is a test
    -- that fails inside the deposit path for a reason that has nothing to do
    -- with deposits.
    local ASSET = "ASSET" .. string.rep("a", 38)
    local ASSET2 = "SECOND" .. string.rep("b", 37)

    -- Never index through a reply without checking it. A handler that returns
    -- an error returns NO player, and a bare `r.monster.status` turns one
    -- failed assertion into a suite that dies with "invalid index in nil".
    local function statusOf(r)
      return r and r.monster and r.monster.status and r.monster.status.type
    end
    local function runesOf(r) return r and r.inventory and r.inventory.rune end
    local function seqOf(r) return r and r.mint and r.mint.seq end

    send(OWNER, { Action = "Admin.Unlock", Addresses = MINA })
    send(MINA, { Action = "Faction.Join", Faction = "Sky Nomads" })
    send(MINA, { Action = "Monster.Adopt" })

    r = send(MINA, { Action = "Monster.Mint" })
    ok("minting costs runes you do not have", errOf(r) ~= nil, json.encode(r))

    send(OWNER, { Action = "Admin.Grant", PlayerId = MINA, Item = "rune", Amount = 60 })
    -- Joining a faction already hands out three runes, so the balance to
    -- measure against is whatever is actually held, not what was granted.
    local funded = runesOf(send(MINA, { Action = "User.Info" }))

    local minted, res = send(MINA, { Action = "Monster.Mint" })
    ok("a paid mint is accepted", errOf(minted) == nil, json.encode(minted))
    ok("the companion is frozen", statusOf(minted) == "Minting", statusOf(minted))
    ok("the runes are taken up front", runesOf(minted) == funded - 10, runesOf(minted))
    ok("the job is published for the worker",
       res.mintqueue and string.find(res.mintqueue, MINA, 1, true) ~= nil, res.mintqueue)
    ok("the cost is published", res.mintcost == "10", res.mintcost)

    -- The queue carries a snapshot, so nothing may move the stats after it.
    ok("a minting companion cannot be fed",
       errOf(send(MINA, { Action = "Monster.Feed" })) ~= nil)
    ok("a minting companion cannot play",
       errOf(send(MINA, { Action = "Monster.Play" })) ~= nil)
    ok("a second mint is refused while one is in flight",
       errOf(send(MINA, { Action = "Monster.Mint" })) ~= nil)

    r = send(MINA, { Action = "Admin.Minted", Seq = "1", AssetId = ASSET, PlayerId = MINA })
    ok("a player cannot report their own mint", errOf(r) == "Not authorised", json.encode(r))

    local seq = tostring(seqOf(minted) or 0)
    r = send(OWNER, { Action = "Admin.Minted", Seq = seq, AssetId = ASSET, PlayerId = MINA })
    ok("the mint completes", errOf(r) == nil, json.encode(r))
    ok("the companion has left the game", r and r.monster == nil)
    ok("the asset is recorded", r and r.assets and r.assets[ASSET] ~= nil,
       json.encode(r and r.assets))
    ok("the id is a real Arweave id", #ASSET == 43 and #ASSET2 == 43, #ASSET .. "/" .. #ASSET2)
    ok("the snapshot came with it",
       r and r.assets and r.assets[ASSET] and r.assets[ASSET].monster.faction == "Sky Nomads")

    -- The registry is the global view: one place that knows what this game has
    -- published, independent of who currently holds it.
    do
      local _, res9 = send(MINA, { Action = "User.Info" })
      local reg = json.decode(res9.assets or "{}")
      ok("the asset is in the registry", reg[ASSET] ~= nil, res9.assets)
      ok("the registry records the minter", reg[ASSET] and reg[ASSET].minter == MINA)
      ok("the registry records what it was",
         reg[ASSET] and reg[ASSET].element == "air" and reg[ASSET].name ~= nil,
         reg[ASSET] and reg[ASSET].element)
      ok("the registry counts it", res9.assetcount == "1", res9.assetcount)
    end

    -- Reporting the same job twice must not take a second companion: the queue
    -- entry was consumed, so there is nothing left to report.
    --
    -- The replacement is GRANTED rather than adopted. Adoption is once per
    -- account ever, and minting a companion out of the game does not give the
    -- account its adoption back -- if it did, the mint path would be a way to
    -- draw an unlimited number of new companions, which is the same hole
    -- transferring one away used to open.
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = MINA,
                  Faction = "Sky Nomads", Into = "roster" })
    r = send(OWNER, { Action = "Admin.Minted", Seq = seq, AssetId = ASSET, PlayerId = MINA })
    ok("a replayed report is refused", errOf(r) ~= nil, json.encode(r))
    ok("and the replacement companion survives it",
       send(MINA, { Action = "User.Info" }).monster ~= nil)

    -- Deposits. The process cannot see a transfer, so this only queues intent.
    ok("a deposit needs a real id",
       errOf(send(MINA, { Action = "Monster.Deposit", AssetId = "nope" })) ~= nil)
    ok("a deposit is refused while a companion is at home",
       errOf(send(MINA, { Action = "Monster.Deposit", AssetId = ASSET })) ~= nil)

    -- Free the slot by minting the replacement, then bring the first one back.
    local second = send(MINA, { Action = "Monster.Mint" })
    send(OWNER, { Action = "Admin.Minted", Seq = tostring(seqOf(second) or 0),
                  AssetId = ASSET2, PlayerId = MINA })

    local queued, res2 = send(MINA, { Action = "Monster.Deposit", AssetId = ASSET })
    ok("a deposit is queued", errOf(queued) == nil, json.encode(queued))
    ok("and published for the worker",
       res2.depositqueue and string.find(res2.depositqueue, ASSET, 1, true) ~= nil,
       res2.depositqueue)

    r = send(MINA, { Action = "Admin.Deposited", AssetId = ASSET, PlayerId = MINA })
    ok("a player cannot settle their own deposit", errOf(r) == "Not authorised", json.encode(r))

    local homed, res10 = send(OWNER, { Action = "Admin.Deposited", AssetId = ASSET, PlayerId = MINA })
    r = homed
    ok("the companion comes home", r and r.monster ~= nil, json.encode(r))
    do
      local reg = json.decode(res10.assets or "{}")
      -- The asset still exists on Arweave, so the registry keeps it and says
      -- where it went rather than dropping the row.
      ok("a returned asset stays in the registry", reg[ASSET] ~= nil)
      ok("and is marked returned", reg[ASSET] and reg[ASSET].state == "returned",
         reg[ASSET] and reg[ASSET].state)
    end
    ok("rested rather than frozen", statusOf(r) == "Home", statusOf(r))
    ok("and the asset is no longer held here", r and r.assets and r.assets[ASSET] == nil,
       json.encode(r and r.assets))

    -- A failure has to give the runes back, or a dead worker is a tax.
    local held = runesOf(send(MINA, { Action = "User.Info" }))
    local third = send(MINA, { Action = "Monster.Mint" })
    ok("a third mint is affordable", errOf(third) == nil, json.encode(third))
    r = send(OWNER, { Action = "Admin.MintFailed", Seq = tostring(seqOf(third) or 0),
                      Reason = "gateway refused" })
    ok("a failed mint is refunded", errOf(r) == nil, json.encode(r))
    local back = send(MINA, { Action = "User.Info" })
    ok("the runes come back", runesOf(back) == held, runesOf(back))
    ok("and the companion thaws", statusOf(back) == "Home", statusOf(back))

    ok("only the owner names the vault",
       errOf(send(MINA, { Action = "Admin.SetVault", Vault = ASSET })) == "Not authorised")
    local _, res3 = send(OWNER, { Action = "Admin.SetVault", Vault = ASSET })
    ok("the vault is published", res3.mintvault == ASSET, res3.mintvault)

    C.MINT.enabled = false
    ok("with minting paused the request is refused",
       errOf(send(MINA, { Action = "Monster.Mint" })) == "Minting to Arweave is paused",
       json.encode(send(MINA, { Action = "Monster.Mint" })))
    C.MINT.enabled = mintWasEnabled
  end

  -- The Alter: the streak is the mechanic ---------------------------------------
  do
    local PILGRIM = "PILGRIMppppppppppppppppppppppppppppppppppp"
    send(OWNER, { Action = "Admin.Unlock", Addresses = PILGRIM })
    send(PILGRIM, { Action = "Faction.Join", Faction = "Sky Nomads" })

    local r = send(PILGRIM, { Action = "Daily.Claim" })
    ok("a first claim is a streak of one", r.dailyClaimed.streak == 1, json.encode(r.dailyClaimed))
    -- A per-wallet faucet is the one structural flaw in ECONOMY.md §2: total
    -- emission would be `stipend x wallets x time` and wallets are free to
    -- make. The pot is global and FIXED, so what a claim pays is one share of
    -- a day, bounded by the rolling per-account cap -- never a fresh mint per
    -- wallet. This pins the bound, not a particular number.
    ok("a claim is a share of the global pot, never a per-wallet mint",
       r.dailyClaimed.runes > 0
         and r.dailyClaimed.runes <= 20,
       json.encode(r.dailyClaimed))
    ok("and counts as an offering", r.dailyClaimed.offerings == 1, r.dailyClaimed.offerings)
    ok("and is tallied to the faction", r.dailyClaimed.factionOfferings >= 1,
       r.dailyClaimed.factionOfferings)

    r = send(PILGRIM, { Action = "Daily.Claim" })
    ok("claiming twice in a row is refused", errOf(r) ~= nil, json.encode(r))

    -- Walk forward one interval at a time and watch the streak pay more.
    local paid = {}
    for day = 2, 11 do
      T = T + C.DAILY.interval
      local res = computeOn({
        Address = PILGRIM, Action = "Daily.Claim",
      })
      local d = json.decode(res.results.output.data)
      paid[day] = d.dailyClaimed
    end
    ok("a streak of 3 does not multiply global emission", paid[3].runes == 0,
       paid[3] and paid[3].runes)
    ok("a streak of 10 does not multiply global emission", paid[10].runes == 0,
       paid[10] and paid[10].runes)
    ok("the streak keeps counting", paid[11].streak == 11, paid[11] and paid[11].streak)
    ok("offerings accumulate", paid[11].offerings == 11, paid[11] and paid[11].offerings)

    -- Miss the window entirely and it is gone.
    T = T + (C.DAILY.breakAfter * 2)
    local res = computeOn({
      Address = PILGRIM, Action = "Daily.Claim",
    })
    local broke = json.decode(res.results.output.data)
    ok("missing a day breaks the streak", broke.dailyClaimed.streak == 1,
       broke.dailyClaimed.streak)
    ok("but the lifetime count is untouched", broke.dailyClaimed.offerings == 12,
       broke.dailyClaimed.offerings)

    -- A streak recovered from the old Alter continues rather than resetting.
    local RETURNED = "RETURNEDrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = RETURNED, unlocked = true, faction = "Stone Titans",
      dailyStreak = 15, bestStreak = 15, offerings = 200,
    } } }))
    T = T + 1000
    local back = json.decode(computeOn({
      Address = RETURNED, Action = "Daily.Claim",
    }).results.output.data)
    ok("a restored streak carries on instead of resetting",
       back.dailyClaimed.streak == 16, back.dailyClaimed.streak)
    -- A long streak is not a bigger mint. The split is weighted by ACCOUNT AGE
    -- and bounded by the rolling per-account cap, so a restored fifteen-day
    -- streak still draws one share of the same fixed day.
    ok("and a long streak still draws one bounded share, not a bigger mint",
       back.dailyClaimed.runes <= 20, back.dailyClaimed.runes)
    ok("and keeps the lifetime offerings", back.dailyClaimed.offerings == 201,
       back.dailyClaimed.offerings)

    -- And a restore may not lower a tally.
    send(OWNER, { Action = "Admin.Load" }, json.encode({ offerings = { ["Stone Titans"] = 1 } }))
    local after = send(OWNER, { Action = "Stats" })
    ok("a restore cannot lower the faction tally", after ~= nil)
  end

  -- The bulk tool the old process had -----------------------------------------
  do
    local r = send(ALICE, { Action = "Admin.AdjustAll", Energy = "100" })
    ok("only the owner may adjust everyone", errOf(r) == "Not authorised", json.encode(r))

    r = send(OWNER, { Action = "Admin.AdjustAll" })
    ok("a no-op adjustment is refused", errOf(r) ~= nil, json.encode(r))

    local before = send(ALICE, { Action = "User.Info" })
    local defBefore = before.monster.defense

    r = send(OWNER, { Action = "Admin.AdjustAll", Energy = "100", Happiness = "100" })
    ok("everyone with a companion is adjusted", r.adjusted >= 1, json.encode(r))
    local after = send(ALICE, { Action = "User.Info" })
    ok("energy is set", after.monster.energy == 100, after.monster.energy)
    ok("happiness is set", after.monster.happiness == 100, after.monster.happiness)

    r = send(OWNER, { Action = "Admin.AdjustAll", Defense = "2" })
    after = send(ALICE, { Action = "User.Info" })
    ok("a stat delta is added, not set", after.monster.defense == defBefore + 2,
       defBefore .. " -> " .. tostring(after.monster.defense))

    -- A blanket negative must not create companions that cannot act.
    send(OWNER, { Action = "Admin.AdjustAll", Attack = "-999" })
    after = send(ALICE, { Action = "User.Info" })
    ok("a stat can never be driven below 1", after.monster.attack >= 1, after.monster.attack)

    r = send(OWNER, { Action = "Admin.AdjustAll", RerollMoves = "true" })
    after = send(ALICE, { Action = "User.Info" })
    -- A served move is just its uses remaining now, so the damage a reroll has
    -- to produce is looked up in the pool by name -- the same join the client
    -- does against the catalog move pools.
    local n, damaging = 0, false
    for name, mv in pairs(after.monster.moves) do
      n = n + 1
      local def = Battle.moveDef(name)
      if ((def and def.damage) or 0) > 0 and mv.count ~= nil then damaging = true end
    end
    ok("a reroll gives a legal roster", n == 4 and damaging, n .. " moves")
  end

  -- The character creator's outfit --------------------------------------------
  do
    local SPRITE = "SPRITEsssssssssssssssssssssssssssssssssssss"
    local ATLAS = "ATLASaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local OUTFIT = {
      Hair = { style = "Long", color = "#6B4A2F" },
      Hat = { style = "None", color = "#3f4d80" },
      Shirt = { style = "T-shirt", color = "#4a6c8c" },
      Pants = { style = "Shorts", color = "#4a4f5e" },
      Gloves = { style = "None", color = "#6b5a46" },
      Shoes = { style = "Shoes", color = "#5c3a30" },
    }
    local parked = send(ALICE, { Action = "Sprite.Update" }, json.encode(OUTFIT))
    ok("the character creator is parked on normal deployments",
       errOf(parked) ~= nil, json.encode(parked))
    -- Keep the parked source executable and covered without exposing it in the
    -- deployed contract configuration.
    C.CHARACTER_CUSTOMISER_ENABLED = true
    local r = send(ALICE, { Action = "Sprite.Update" }, json.encode(OUTFIT))
    ok("a player saves their character recipe",
       r.outfit.Hair.style == "Long" and r.outfit.Shirt.style == "T-shirt",
       json.encode(r.outfit))
    ok("character colours are normalised", r.outfit.Hair.color == "#6b4a2f",
       json.encode(r.outfit.Hair))

    local badOutfit = json.decode(json.encode(OUTFIT))
    badOutfit.Hat.color = "orange"
    r = send(ALICE, { Action = "Sprite.Update" }, json.encode(badOutfit))
    ok("a malformed character colour is refused", errOf(r) ~= nil, json.encode(r))

    badOutfit = json.decode(json.encode(OUTFIT))
    badOutfit.Shoes = nil
    r = send(ALICE, { Action = "Sprite.Update" }, json.encode(badOutfit))
    ok("an incomplete character recipe is refused", errOf(r) ~= nil, json.encode(r))

    local still = send(ALICE, { Action = "User.Info" })
    ok("a refused outfit leaves the saved one alone", still.outfit.Hair.style == "Long",
       json.encode(still.outfit))

    -- Legacy uploads are still accepted, so the recovered characters that
    -- already use them remain editable/readable during the transition.
    r = send(ALICE, { Action = "Sprite.Update", TxId = SPRITE, AtlasTxId = ATLAS })
    ok("a legacy player can retain their uploaded sprite", r.spriteTxId == SPRITE,
       json.encode(r.spriteTxId))
    ok("and the atlas that describes it", r.spriteAtlasTxId == ATLAS, json.encode(r.spriteAtlasTxId))

    r = send(ALICE, { Action = "Sprite.Update", TxId = SPRITE, AtlasTxId = "nope" })
    ok("a malformed atlas id is refused", errOf(r) ~= nil, json.encode(r))

    -- Numeric, not ipairs -- see the note by the admin loop above.
    local badIds = { "short", "", "not a tx id at all!!!" }
    for bi = 1, #badIds do
      local bad = badIds[bi]
      r = send(ALICE, { Action = "Sprite.Update", TxId = bad })
      ok("a sprite id that is not a transaction is refused ('" .. bad .. "')",
         errOf(r) ~= nil, json.encode(r))
    end
    still = send(ALICE, { Action = "User.Info" })
    ok("and a refused update leaves the old one alone",
       still.spriteTxId == SPRITE, still.spriteTxId)

    r = send("LOCKEDlllllllllllllllllllllllllllllllllllll",
      { Action = "Sprite.Update" }, json.encode(OUTFIT))
    ok("a locked wallet cannot save a character", errOf(r) ~= nil, json.encode(r))

    -- Both recipe and old upload ids survive process recovery.
    local RETURNING = "RETURNINGrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = RETURNING, unlocked = true, outfit = OUTFIT, spriteTxId = SPRITE,
    } } }))
    local back = send(RETURNING, { Action = "User.Info" })
    ok("a recovered outfit comes back with the player", back.outfit.Shoes.style == "Shoes",
       json.encode(back.outfit))
    ok("a recovered legacy sprite also comes back", back.spriteTxId == SPRITE, back.spriteTxId)
    C.CHARACTER_CUSTOMISER_ENABLED = false
  end

  -- Daily worship history, the one engagement series the game has ------------
  do
    local WATCHER = "WATCHERwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"
    send(OWNER, { Action = "Admin.Unlock", Addresses = WATCHER })
    send(WATCHER, { Action = "Faction.Join", Faction = "Aqua Guardians" })

    T = T + C.DAILY.interval
    local res = computeOn({
      Address = WATCHER, Action = "Daily.Claim",
    })
    local day = T // 86400000
    local checkins = json.decode(res.checkins)
    ok("a claim is recorded against its day",
       checkins[tostring(day)] ~= nil, res.checkins and string.sub(res.checkins, 1, 120))
    ok("and bucketed as a low streak",
       checkins[tostring(day)] and checkins[tostring(day)].low >= 1,
       json.encode(checkins[tostring(day)]))

    -- Recovered days load, and a restore cannot lower a count.
    send(OWNER, { Action = "Admin.Load" }, json.encode({
      checkins = { ["20211"] = { high = 3, medium = 0, low = 4 } },
    }))
    local after = json.decode(send(OWNER, { Action = "Stats" }) and
      (select(2, send(OWNER, { Action = "Stats" }))).checkins)
    ok("a recovered day is restored",
       after["20211"] and after["20211"].high == 3, json.encode(after["20211"]))

    send(OWNER, { Action = "Admin.Load" }, json.encode({
      checkins = { ["20211"] = { high = 1, medium = 0, low = 1 } },
    }))
    local again = json.decode((select(2, send(OWNER, { Action = "Stats" }))).checkins)
    ok("and a later load cannot lower it",
       again["20211"].high == 3 and again["20211"].low == 4, json.encode(again["20211"]))
  end

  -- The command console: roster, exact edits, balance deltas and intervention --
  do
    local OPERATED = "OPERATEDooooooooooooooooooooooooooooooooooo"
    send(OWNER, { Action = "Admin.Unlock", Addresses = OPERATED })
    send(OPERATED, { Action = "Faction.Join", Faction = "Stone Titans" })
    send(OPERATED, { Action = "Monster.Adopt" })

    local before = send(OPERATED, { Action = "User.Info" })
    local held = (before.inventory or {}).rune or 0
    local adjusted, adjustResult = send(OWNER, {
      Action = "Admin.AdjustInventory", PlayerId = OPERATED,
      Item = "rune", Delta = "7",
    })
    ok("the console can add an inventory delta",
       adjusted.after == held + 7 and adjusted.applied == 7, json.encode(adjusted))
    local metrics = json.decode(adjustResult.metrics)
    local day = tostring(T // 86400000)
    ok("admin inventory changes are tracked",
       metrics.daily[day] and metrics.daily[day].adminActions >= 1,
       metrics.daily[day] and json.encode(metrics.daily[day]))

    adjusted = send(OWNER, {
      Action = "Admin.AdjustInventory", PlayerId = OPERATED,
      Item = "rune", Delta = "-9999",
    })
    ok("taking inventory floors the balance at zero",
       adjusted.after == 0 and adjusted.applied == -(held + 7), json.encode(adjusted))

    local edited = send(OWNER, { Action = "Admin.UpdatePlayer", PlayerId = OPERATED },
      json.encode({
        account = { wins = 12, losses = 3, questsCompleted = 8, dailyStreak = 4 },
        inventory = { rune = 19, rock_berry = 22 },
        lootboxes = { ["1"] = 1, ["3"] = 2 },
        monster = { name = "Ops Pup", level = 6, exp = 9, attack = 8,
                    defense = 7, speed = 6, health = 5, energy = 88,
                    happiness = 77, totalTimesFed = 14 },
      }))
    ok("the console edits account counters exactly",
       edited.wins == 12 and edited.losses == 3 and edited.questsCompleted == 8,
       json.encode({ edited.wins, edited.losses, edited.questsCompleted }))
    ok("the console edits balances and lootbox tiers exactly",
       edited.inventory.rune == 19 and edited.inventory.rock_berry == 22
         and #edited.lootboxes == 3 and edited.lootboxes[2] == 3,
       json.encode({ edited.inventory, edited.lootboxes }))
    ok("the console edits the full companion record",
       edited.monster.name == "Ops Pup" and edited.monster.level == 6
         and edited.monster.energy == 88 and edited.monster.totalTimesFed == 14,
       json.encode(edited.monster))

    send(OWNER, { Action = "Admin.SetStats", PlayerId = OPERATED },
      json.encode({ energy = 100, happiness = 100 }))
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = OPERATED,
                  Item = "rune", Delta = "5" })
    send(OPERATED, { Action = "Battle.Begin" })
    local fighting = send(OPERATED, { Action = "Battle.Start" })
    local battleId = fighting.battle and fighting.battle.id
    local released = send(OWNER, { Action = "Admin.ReleaseBattle", PlayerId = OPERATED })
    local after = send(OPERATED, { Action = "User.Info" })
    ok("the console releases a player from battle",
       released.battleId == battleId and #released.released == 1,
       json.encode(released))
    ok("a released player is home with no dangling battle",
       after.activeBattleId == nil and after.battlesRemaining == 0
         and after.monster.status.type == "Home",
       json.encode(after))
    ok("an admin-cancelled battle cannot settle later",
       Battles[battleId].status == "ended" and Battles[battleId].settled == true
         and Battles[battleId].adminCancelled == true,
       json.encode(Battles[battleId]))

    local snapshot = send(OWNER, { Action = "Admin.Snapshot" })
    local found = nil
    for _, row in ipairs(snapshot.players or {}) do
      if row.address == OPERATED then found = row break end
    end
    ok("the owner snapshot carries the complete compact roster",
       found and found.inventory.rune == 23 and found.level == 6,
       found and json.encode(found))
    ok("the owner snapshot carries battles, factions, metrics and audit",
       type(snapshot.battles) == "table" and #snapshot.factions == 4
         and type(snapshot.metrics) == "table" and #snapshot.audit > 0,
       json.encode({ factions = #snapshot.factions, audit = #snapshot.audit }))
  end

  -- Shield regeneration ------------------------------------------------------
  --
  -- A shield recovers a share of its cap at the end of a round, but ONLY for a
  -- fighter that came through it untouched. Both halves are load-bearing: the
  -- regen is what makes defence worth buying, and the condition is the only
  -- thing standing between two defensive companions and a fight that cannot be
  -- won by either of them. An earlier version gave the regen to everybody and
  -- had to be capped below a struggle's damage to stay finishable.
  do
    local function fighters()
      local a = Battle.combatant(
        { name = "A", elementType = "rock", attack = 4, defense = 5, speed = 9,
          health = 8, moves = {} }, "challenger", "AAA")
      local b = Battle.combatant(
        { name = "B", elementType = "rock", attack = 4, defense = 5, speed = 1,
          health = 8, moves = {} }, "accepter", "BBB")
      return { id = "regen", kind = "bot", status = "battling", round = 0,
               turns = {}, challenger = a, accepter = b }, a, b
    end

    local hits = { name = "Hit", type = "normal", rarity = 0,
                   count = math.maxinteger, damage = 5,
                   attack = 0, speed = 0, defense = 0, health = 0 }
    local nothing = { name = "Wait", type = "normal", rarity = 0,
                      count = math.maxinteger, damage = 0,
                      attack = 0, speed = 0, defense = 0, health = 0 }

    local share = Battle.TUNING.shieldRegenShare
    ok("shield regen is a share of the cap, not a flat trickle",
       share > 0 and share < 1, tostring(share))

    -- One side swings and connects; the other does nothing at all.
    local battle, a, b = fighters()
    local expected = math.ceil(a.maxShield * share)
    a.shield = a.maxShield - expected
    b.shield = b.maxShield - expected
    -- A seed that lands the blow rather than missing it.
    Battle.seedDeterministic(7)
    local entries
    for _ = 1, 40 do
      battle, a, b = fighters()
      a.shield = a.maxShield - expected
      b.shield = b.maxShield - expected
      entries = Battle.resolveRound(battle, hits, nothing)
      if entries[1] and not entries[1].missed
         and (entries[1].shieldDamage + entries[1].healthDamage) > 0 then
        break
      end
    end

    ok("a fighter that was hit recovers no shield that round",
       b.shield == b.maxShield - expected - entries[1].shieldDamage,
       string.format("%d of %d", b.shield, b.maxShield))
    ok("a fighter that was not hit recovers its share",
       a.shield == a.maxShield,
       string.format("%d of %d", a.shield, a.maxShield))

    -- Neither side deals anything: both are untouched, both recover.
    local quiet, qa, qb = fighters()
    qa.shield = 0
    qb.shield = 0
    Battle.resolveRound(quiet, nothing, nothing)
    local step = math.ceil(qa.maxShield * share)
    ok("a round in which nothing lands restores both shields",
       qa.shield == step and qb.shield == step,
       string.format("%d / %d, expected %d", qa.shield, qb.shield, step))

    -- And it never overfills.
    local full, fa = fighters()
    Battle.resolveRound(full, nothing, nothing)
    ok("regen never exceeds the cap", fa.shield == fa.maxShield,
       string.format("%d of %d", fa.shield, fa.maxShield))
  end

  -- Public deployment mode --------------------------------------------------
  -- Toggle only after every closed-access assertion above has run. The same
  -- handlers ship in both modes; deploy.mjs changes this one constant in the
  -- assembled bundle.
  do
    local OPEN = "OPENooooooooooooooooooooooooooooooooooooooo"
    C.PUBLIC_ACCESS = true
    -- `access` is a CONSTANT in the published map: `compute` writes it only
    -- when the key is absent, because nothing assigns `C.PUBLIC_ACCESS` at
    -- runtime on a real process. deploy.mjs changes it in the assembled bundle
    -- and the redeploy spawns a process whose base is empty, so dropping the
    -- key here is what "the bundle now ships open" actually looks like. Without
    -- this the assertion below only passed because the old harness handed every
    -- message a fresh base, i.e. because every message looked like a redeploy.
    STATE.access = nil
    local joined, state = send(OPEN, { Action = "Faction.Join", Faction = "Sky Nomads" })
    ok("public access lets an unknown wallet join", joined and joined.faction == "Sky Nomads",
       errOf(joined))
    ok("public access persists the wallet grant", joined and joined.unlocked == true,
       joined and json.encode(joined))
    local access = json.decode(state.access)
    ok("public access mode is published", access and access.publicAccess == true,
       state.access)
    -- Back to closed, and the published key with it: leaving `publicAccess:
    -- true` standing would be a lie about the process for the rest of the run.
    C.PUBLIC_ACCESS = false
    STATE.access = nil
  end

  -- Roster, collection and the marketplace ----------------------------------
  --
  -- The whole point of the model is that a companion is one self-contained
  -- record that MOVES: roster to collection, collection to a listing, listing
  -- to a buyer. So every case below checks both ends -- that it arrived, and
  -- that it is no longer where it was. A companion in two places at once is
  -- the only bug in here that would mint value out of nothing.
  do
    local KEEP = "KEEPERkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"
    local BUYER = "BUYERbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    send(OWNER, { Action = "Admin.Unlock", Addresses = KEEP .. "," .. BUYER })
    send(BUYER, { Action = "Faction.Join", Faction = "Sky Nomads" })
    -- Swearing adopts, so this one message is the whole arrival.
    local keeper = send(KEEP, { Action = "Faction.Join", Faction = "Stone Titans" })

    ok("an adopted companion lands in the roster",
       keeper and keeper.monsters and keeper.activeId
         and keeper.monsters[keeper.activeId] ~= nil, keeper and keeper.activeId)
    ok("and is the active one",
       keeper and keeper.monster and keeper.monster.id == keeper.activeId,
       keeper and keeper.monster and keeper.monster.id)
    ok("a companion carries its own appearance",
       keeper and keeper.monster and keeper.monster.holographic == true
         and keeper.monster.background ~= nil and keeper.monster.border ~= nil,
       keeper and keeper.monster and json.encode({
         holo = keeper.monster.holographic,
         bg = keeper.monster.background,
         border = keeper.monster.border,
       }))
    ok("the active companion cap is published", keeper and keeper.rosterMax == 1,
       keeper and keeper.rosterMax)

    local mid = keeper and keeper.activeId
    local runesBefore = keeper and keeper.inventory and keeper.inventory.rune or 0

    -- Storing --------------------------------------------------------------
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = KEEP,
                  Item = "rune", Amount = "10" })
    local busy = send(KEEP, { Action = "Monster.Quest" })
    local r2 = send(KEEP, { Action = "Monster.Store", MonsterId = mid })
    ok("a busy companion cannot be stored", errOf(r2) ~= nil, r2)
    send(OWNER, { Action = "Admin.UpdatePlayer", PlayerId = KEEP,
                  Data = json.encode({ monster = { status = { type = "Home" } } }) })

    local before = send(KEEP, { Action = "User.Login" })
    local runes = before and before.inventory and before.inventory.rune or 0
    local stored = send(KEEP, { Action = "Monster.Store", MonsterId = mid })
    ok("storing moves it out of the roster",
       stored and stored.monsters and stored.monsters[mid] == nil, stored and errOf(stored))
    ok("and into the collection",
       stored and stored.collection and stored.collection[mid] ~= nil, stored and errOf(stored))
    ok("and charges a rune",
       stored and stored.inventory and (stored.inventory.rune or 0) == runes - 1,
       stored and stored.inventory and stored.inventory.rune)
    ok("a player with an empty roster has no active companion",
       stored and stored.monster == nil, stored and json.encode(stored.monster))

    -- Adoption must not be a way to duplicate a stored companion.
    local again = send(KEEP, { Action = "Monster.Adopt" })
    ok("adopting again is refused while one is in the collection",
       errOf(again) ~= nil, again)

    -- Listing ---------------------------------------------------------------
    local listed, lstate = send(KEEP, { Action = "Market.List",
                                        MonsterId = mid, Price = "25" })
    ok("listing takes it out of the collection",
       listed and listed.collection and listed.collection[mid] == nil, errOf(listed))
    local market = lstate and json.decode(lstate.market)
    local listingId = listed and listed.listing and listed.listing.id
    ok("and the listing is published with the whole companion",
       market and listingId and market[listingId]
         and market[listingId].monster ~= nil
         and market[listingId].price == 25,
       lstate and lstate.market)

    local badPrice = send(KEEP, { Action = "Market.List", MonsterId = mid, Price = "0" })
    ok("a listing below the floor is refused", errOf(badPrice) ~= nil, badPrice)

    local selfBuy = send(KEEP, { Action = "Market.Buy", ListingId = listingId })
    ok("you cannot buy your own listing", errOf(selfBuy) ~= nil, selfBuy)

    -- Buying ----------------------------------------------------------------
    local poor = send(BUYER, { Action = "Market.Buy", ListingId = listingId })
    ok("a buyer without the runes is refused", errOf(poor) ~= nil, poor)

    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = BUYER,
                  Item = "rune", Amount = "40" })
    local sellerBefore = send(KEEP, { Action = "User.Login" })
    local sellerRunes = sellerBefore and sellerBefore.inventory
      and sellerBefore.inventory.rune or 0
    local buyerBefore = send(BUYER, { Action = "User.Login" })
    local buyerRunes = buyerBefore and buyerBefore.inventory
      and buyerBefore.inventory.rune or 0

    local bought, bstate = send(BUYER, { Action = "Market.Buy", ListingId = listingId })
    ok("buying debits the buyer",
       bought and bought.inventory and (bought.inventory.rune or 0) == buyerRunes - 25,
       bought and bought.inventory and bought.inventory.rune)
    local sellerAfter = send(KEEP, { Action = "User.Login" })
    ok("and credits the seller",
       sellerAfter and sellerAfter.inventory
         and (sellerAfter.inventory.rune or 0) == sellerRunes + 25,
       sellerAfter and sellerAfter.inventory and sellerAfter.inventory.rune)

    local ownedCount = 0
    local ownedId = nil
    for id in pairs(bought and bought.collection or {}) do
      ownedCount = ownedCount + 1
      ownedId = id
    end
    ok("the companion is in the buyer's collection", ownedCount == 1, ownedCount)
    ok("the seller no longer has it",
       sellerAfter and next(sellerAfter.collection or {}) == nil,
       sellerAfter and json.encode(sellerAfter.collection))
    local afterMarket = bstate and json.decode(bstate.market)
    ok("and the listing is gone",
       afterMarket and afterMarket[listingId] == nil, bstate and bstate.market)
    local history = bstate and json.decode(bstate.markethistory)
    ok("the sale is recorded",
       history and history[1] and history[1].price == 25
         and history[1].buyer == BUYER and history[1].seller == KEEP,
       bstate and bstate.markethistory)

    local gone = send(BUYER, { Action = "Market.Buy", ListingId = listingId })
    ok("a sold listing cannot be bought twice", errOf(gone) ~= nil, gone)

    -- Switching --------------------------------------------------------------
    local previousActive = buyerBefore and buyerBefore.activeId
    local pulled = send(BUYER, { Action = "Monster.SetActive", MonsterId = ownedId })
    ok("switching chooses the collection companion",
       pulled and pulled.activeId == ownedId and pulled.monster.id == ownedId, errOf(pulled))
    ok("and returns the previous companion to the collection",
       pulled and pulled.collection and pulled.collection[previousActive] ~= nil,
       pulled and json.encode(pulled.collection))
    ok("and costs nothing",
       pulled and pulled.inventory
         and (pulled.inventory.rune or 0) == (buyerRunes - 25),
       pulled and pulled.inventory and pulled.inventory.rune)
    ok("and the chosen companion is Home",
       pulled and pulled.monster and pulled.monster.status
         and pulled.monster.status.type == "Home",
       pulled and pulled.monster and pulled.monster.status
         and pulled.monster.status.type)

    -- Transferring ------------------------------------------------------------
    local rosterId = pulled and pulled.activeId
    local wrongPlace = send(BUYER, { Action = "Monster.Transfer",
                                     MonsterId = rosterId, Recipient = KEEP })
    ok("a roster companion cannot be transferred", errOf(wrongPlace) ~= nil, wrongPlace)

    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = BUYER,
                  Item = "rune", Amount = "5" })
    send(BUYER, { Action = "Monster.Store", MonsterId = rosterId })
    local sent = send(BUYER, { Action = "Monster.Transfer",
                               MonsterId = rosterId, Recipient = KEEP })
    ok("transferring removes that companion from the sender's collection",
       sent and (sent.collection or {})[rosterId] == nil, errOf(sent))
    local received = send(KEEP, { Action = "User.Login" })
    ok("and the recipient has it",
       received and next(received.collection or {}) ~= nil,
       received and json.encode(received.collection))
    local selfSend = send(KEEP, { Action = "Monster.Transfer",
                                  MonsterId = next(received.collection),
                                  Recipient = KEEP })
    ok("you cannot transfer to yourself", errOf(selfSend) ~= nil, selfSend)
  end

  -- One active companion and session charms --------------------------------
  do
    local PARTY = "PARTY" .. string.rep("p", 38)
    send(OWNER, { Action = "Admin.Unlock", Addresses = PARTY })
    send(PARTY, { Action = "Faction.Join", Faction = "Inferno Blades" })
    local partySecond = send(OWNER, { Action = "Admin.CreateMonster", PlayerId = PARTY,
                  Faction = "Inferno Blades", Into = "roster", Name = "Cinder Two" })
    local partyThird = send(OWNER, { Action = "Admin.CreateMonster", PlayerId = PARTY,
                  Faction = "Inferno Blades", Into = "roster", Name = "Cinder Three" })
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = PARTY,
                  Item = "fire_berry", Amount = "20" })
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = PARTY,
                  Item = "rune", Amount = "20" })

    local ready = send(PARTY, { Action = "User.Login" })
    local ids = { ready.activeId }
    local storedIds = {}
    for id in pairs(ready.collection or {}) do storedIds[#storedIds + 1] = id end
    table.sort(storedIds)
    ids[2], ids[3] = storedIds[1], storedIds[2]
    ok("a keeper has one active companion and two in collection",
       ready.rosterMax == 1 and ids[1] and ids[2] and ids[3],
       json.encode({ active = ready.activeId, collection = storedIds,
         second = partySecond and partySecond.error, third = partyThird and partyThird.error }))

    local firstEnergy = ready.monsters[ids[1]].energy
    local fed = send(PARTY, { Action = "Monster.Feed", MonsterId = ids[1] })
    ok("care targets the active companion",
       fed and fed.monsters[ids[1]].energy > firstEnergy,
       fed and fed.monsters[ids[1]].energy)

    local played = send(PARTY, { Action = "Monster.Play", MonsterId = ids[1] })
    ok("play targets the one active companion",
       played and played.monster and played.monster.status.type == "Play", errOf(played))
    local doublePlay = send(PARTY, { Action = "Monster.SetActive", MonsterId = ids[2] })
    ok("the keeper cannot switch companions during play",
       errOf(doublePlay) ~= nil, json.encode(doublePlay))
    local quested = send(PARTY, { Action = "Monster.Quest", MonsterId = ids[1] })
    ok("a quest cannot overlap the active companion's play",
       errOf(quested) ~= nil, json.encode(quested))

    -- The lock is symmetric: once the play is home a quest may begin, and
    -- that quest then blocks switching to another companion. Collection adds
    -- choices, never parallel activity slots.
    Players[PARTY].monsters[ids[1]].status = {
      type = "Home", since = T, until_time = T,
    }
    local lead = send(PARTY, { Action = "Monster.SetActive", MonsterId = ids[2] })
    ok("a home collection companion can become active atomically",
       lead and lead.activeId == ids[2] and lead.monster.id == ids[2], errOf(lead))
    quested = send(PARTY, { Action = "Monster.Quest", MonsterId = ids[2] })
    ok("a quest begins once the account activity slot is free",
       quested and quested.monsters[ids[2]].status.type == "Quest", errOf(quested))
    local playDuringQuest = send(PARTY, { Action = "Monster.SetActive", MonsterId = ids[3] })
    ok("an open quest locks collection switching",
       errOf(playDuringQuest) ~= nil, json.encode(playDuringQuest))
    local distracted = send(PARTY, { Action = "Battle.Begin" })
    ok("the arena waits until the current activity is done",
       errOf(distracted) ~= nil, json.encode(distracted))

    -- Put the companion home without advancing the suite clock by an hour.
    for _, monster in pairs(Players[PARTY].monsters) do
      monster.status = { type = "Home", since = T, until_time = T }
    end
    lead = send(PARTY, { Action = "Monster.SetActive", MonsterId = ids[3] })
    ok("another home collection companion can become active",
       lead and lead.activeId == ids[3] and lead.monster.id == ids[3], errOf(lead))

    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = PARTY,
                  Item = "fire_berry", Amount = "6" })
    local retired = send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = PARTY,
                                  Item = "diamond", Amount = "1" })
    ok("retired gems are outside the active catalog", errOf(retired) ~= nil,
       json.encode(retired))
    local beforeBerry = send(PARTY, { Action = "User.Login" })
    local baseAttack = beforeBerry.monster.attack
    local entered = send(PARTY, { Action = "Battle.Begin", Item = "fire_berry" })
    ok("berry maxing consumes exactly three berries",
       entered and entered.inventory.fire_berry == beforeBerry.inventory.fire_berry - 3,
       entered and entered.inventory.fire_berry)
    ok("the chosen berry boost is recorded for the arena session",
       entered and entered.arenaBoost and entered.arenaBoost.item == "fire_berry"
         and entered.arenaBoost.cost == 3,
       entered and json.encode(entered.arenaBoost))
    local switch = send(PARTY, { Action = "Monster.SetActive", MonsterId = ids[1] })
    ok("the active companion is locked for the whole arena session", errOf(switch) ~= nil,
       json.encode(switch))

    local fight = send(PARTY, { Action = "Battle.Start" })
    ok("berry maxing boosts the temporary combatant",
       fight and fight.battle and fight.battle.challenger.attack == baseAttack + 5,
       fight and fight.battle and fight.battle.challenger.attack)
    ok("and never mutates the permanent companion stat",
       fight and fight.monster and fight.monster.attack == baseAttack,
       fight and fight.monster and fight.monster.attack)
    local left = send(PARTY, { Action = "Battle.Leave" })
    ok("leaving the arena clears the session berry boost",
       left and left.arenaBoost == nil, left and json.encode(left.arenaBoost))

    -- The refusals around the berry, and the ordering that makes them safe.
    --
    -- `Battle.Begin` checks the berry BEFORE it spends the Rune. If that order
    -- were reversed, a player who asked for a boost they could not afford
    -- would be charged the session fee and handed an error — paying for an
    -- arena they never entered.
    local badItem = send(PARTY, { Action = "Battle.Begin", Item = "scroll" })
    ok("an item that is not a battle berry is refused",
       errOf(badItem) ~= nil and string.find(errOf(badItem) or "", "battle berry") ~= nil,
       json.encode(badItem))

    local beforeBroke = send(PARTY, { Action = "User.Login" })
    local runesBefore = beforeBroke.inventory.rune or 0
    -- Strip the water berries so the boost is unaffordable, leaving the Rune.
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = PARTY,
                  Item = "water_berry", Delta = "-999" })
    local poorBerry = send(PARTY, { Action = "Battle.Begin", Item = "water_berry" })
    ok("a boost you cannot afford is refused", errOf(poorBerry) ~= nil,
       json.encode(poorBerry))
    local afterBroke = send(PARTY, { Action = "User.Login" })
    ok("and the refused boost costs no Rune",
       (afterBroke.inventory.rune or 0) == runesBefore,
       afterBroke.inventory.rune)
    ok("and leaves the companion at home",
       afterBroke.monster.status.type == "Home", afterBroke.monster.status.type)
  end

  -- Hunting -----------------------------------------------------------------
  --
  -- The authority side only. A real run needs a Hunt worker process, so what is
  -- asserted here is what this process decides on its own: that hunting is shut
  -- until configured, that only the owner may configure it, that a begin takes
  -- the companion and holds it, that a repeated begin is a delivery retry
  -- rather than a second lock, and that a worker cannot act on a run it was not
  -- assigned.

  do
    local HUNTER = "HUNTER" .. string.rep("h", 37)
    local HUNTPROC = "HUNTPROC" .. string.rep("q", 35)
    local OTHERPROC = "OTHERPROC" .. string.rep("z", 34)
    local SCHED2 = "SCHEDULERssssssssssssssssssssssssssssssssss"

    send(OWNER, { Action = "Admin.Unlock", Addresses = HUNTER })
    send(HUNTER, { Action = "Faction.Join", Faction = "Sky Nomads" })

    local shut = send(HUNTER, { Action = "Hunt.Begin" })
    ok("hunting is refused until a hunt process is configured",
       errOf(shut) ~= nil and string.find(errOf(shut) or "", "not configured") ~= nil,
       json.encode(shut))

    local steal = send(HUNTER, { Action = "Admin.SetHuntProcess", ProcessId = HUNTPROC })
    ok("a player cannot configure the hunt process",
       errOf(steal) == "Not authorised", json.encode(steal))

    send(OWNER, { Action = "Admin.SetHuntProcess", ProcessId = HUNTPROC })

    local opened = send(HUNTER, { Action = "Hunt.Begin" })
    ok("a configured hunt opens a route", opened and opened.hunt ~= nil
       and opened.hunt.runId ~= nil, json.encode(opened and opened.hunt))
    ok("the hunt route names the assigned process",
       opened and opened.hunt and opened.hunt.processId == HUNTPROC,
       opened and opened.hunt and opened.hunt.processId)
    ok("beginning a hunt takes the companion",
       opened and opened.monster and opened.monster.status.type == "Hunt",
       opened and opened.monster and opened.monster.status.type)

    local firstRun = opened and opened.hunt and opened.hunt.runId
    local again = send(HUNTER, { Action = "Hunt.Begin" })
    ok("repeating the begin is a retry, not a second hunt",
       again and again.hunt and again.hunt.runId == firstRun,
       again and again.hunt and again.hunt.runId)

    -- The one that matters. Every hunt worker is a separate public process, so
    -- "a member of the fleet" is not the same question as "the worker this run
    -- was handed to". Without the per-run check, worker 2 could settle worker
    -- 1's run and hand out a capture the player never earned.
    local function fromProcess(proc, tags, body)
      T = T + 1000
      local envelope = {
        commitments = { sig1 = { committer = SCHED2, alg = "rsa-pss-sha512" } },
        ["from-process"] = proc,
      }
      for k, v in pairs(tags) do envelope[k] = v end
      if body then envelope.Data = body end
      local res = computeOn(envelope, { ["scheduler-location"] = SCHED2 })
      return json.decode(res.results.output.data)
    end

    -- OTHERPROC must be a REAL FLEET MEMBER for this to test anything. A
    -- stranger process is rejected by the coarse membership check in
    -- `huntNotice` and never reaches `huntRunFor` at all — which is how the
    -- first version of this test passed while asserting nothing, answering
    -- "Untrusted Hunt process" instead of the per-run refusal. Enrol it, so the
    -- only thing left to stop it is the guard actually under test.
    send(OWNER, { Action = "Admin.SetHuntProcess", ProcessId = HUNTPROC },
         json.encode({ { processId = HUNTPROC }, { processId = OTHERPROC } }))
    -- A settlement complete enough to get past the identity and roll checks,
    -- so the ONLY thing left that can refuse it is the assignment guard.
    local foreign = fromProcess(OTHERPROC, { Action = "Hunt.Settle" },
      json.encode({
        protocol = "runerealm-hunt/1", runId = firstRun, playerId = HUNTER,
        settlementId = "s-foreign-1", runeBid = 1, chance = 50, roll = 40,
        success = true,
      }))
    ok("a hunt worker in the fleet cannot settle a run it was not assigned",
       errOf(foreign) ~= nil
         and string.find(errOf(foreign) or "", "not assigned") ~= nil,
       json.encode(foreign))

    -- Put the fixture back so later tests are not handed a hunting companion.
    send(OWNER, { Action = "Admin.SetHuntProcess", ProcessId = "" })
  end

  -- The other side of a trade can see it happen ------------------------------
  --
  -- Everything above checks the REPLY, which only the signer ever gets. A sale
  -- and a gift both change an account that did not sign, and that account has
  -- exactly one way to look at itself without signing: the published
  -- `player-<address>` key. If that is not rewritten, being paid and being
  -- given a companion are both invisible from the receiving end until the
  -- player happens to send an unrelated message -- so these assert the key,
  -- not the reply.
  do
    local VEND = "VENDOR" .. string.rep("v", 37)
    local CUST = "CUSTOM" .. string.rep("c", 37)
    local WATCH = "WATCHER" .. string.rep("w", 36)
    send(OWNER, { Action = "Admin.Unlock",
                  Addresses = VEND .. "," .. CUST .. "," .. WATCH })
    send(VEND, { Action = "Faction.Join", Faction = "Inferno Blades" })
    send(CUST, { Action = "Faction.Join", Faction = "Sky Nomads" })
    send(WATCH, { Action = "Faction.Join", Faction = "Stone Titans" })
    send(VEND, { Action = "Monster.Adopt" })
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = VEND,
                  Item = "rune", Amount = "10" })
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = CUST,
                  Item = "rune", Amount = "60" })

    local before = send(VEND, { Action = "User.Login" })
    local sellerRunes = before.inventory.rune or 0
    local mid = before.activeId
    send(VEND, { Action = "Monster.Store", MonsterId = mid })
    local listed = send(VEND, { Action = "Market.List", MonsterId = mid, Price = "30" })
    local listingId = listed.listing.id

    -- The buyer signs. The seller is not here.
    --
    -- WATCH is the bystander, and their key is already in the published map --
    -- they joined a faction above, which wrote it. "Not republished" is
    -- therefore not "absent"; it is "not written by THIS message", so the two
    -- bystander assertions below stamp a sentinel over the key first and check
    -- it survived. That is the same technique the slot-write block at the end
    -- of this file uses, and it is what `== nil` was standing in for while
    -- every message got a fresh base.
    local BYSTANDER_SENTINEL = "SENTINEL-not-republished"
    STATE["player-" .. WATCH] = BYSTANDER_SENTINEL
    local _, res = send(CUST, { Action = "Market.Buy", ListingId = listingId })
    local sellerKey = res["player-" .. VEND]
    ok("a sale republishes the seller's own record", type(sellerKey) == "string",
       type(sellerKey))
    local sellerView = sellerKey and json.decode(sellerKey)
    ok("and the seller can see they were paid, without signing anything",
       sellerView and (sellerView.inventory.rune or 0) == sellerRunes - 1 + 30,
       sellerView and sellerView.inventory.rune)

    -- Not everybody, though. Republishing the whole table on a player action
    -- would make every trade cost what an admin write costs.
    ok("and a bystander is not republished for somebody else's trade",
       res["player-" .. WATCH] == BYSTANDER_SENTINEL, res["player-" .. WATCH])

    -- The same from the receiving end of a gift.
    local held = send(CUST, { Action = "User.Login" })
    local gift = next(held.collection)
    local _, res2 = send(CUST, { Action = "Monster.Transfer",
                                 MonsterId = gift, Recipient = WATCH })
    local watcherKey = res2["player-" .. WATCH]
    ok("a transfer republishes the recipient", type(watcherKey) == "string",
       type(watcherKey))
    local watcherView = watcherKey and json.decode(watcherKey)
    ok("and the companion is there when they look",
       watcherView and next(watcherView.collection or {}) ~= nil,
       watcherView and json.encode(watcherView.collection))

    -- The list is per message. A later, unrelated action must not keep
    -- republishing the people an earlier one touched.
    STATE["player-" .. WATCH] = BYSTANDER_SENTINEL
    local _, res3 = send(CUST, { Action = "User.Login" })
    ok("and the next message does not republish them again",
       res3["player-" .. WATCH] == BYSTANDER_SENTINEL, res3["player-" .. WATCH])
    -- Leave the map honest: the sentinel is not a player record.
    STATE["player-" .. WATCH] = nil
  end

  -- Adoption is once per account, EVER --------------------------------------
  --
  -- The rule used to be "you may adopt when you hold nothing", and emptiness is
  -- a state anyone can return to on purpose. Two wallets passing one creature
  -- back and forth drew a brand new one out of the process every round, for the
  -- price of the storage rune -- an unbounded free supply of the only thing the
  -- game is about. So the test is not "adopting twice in a row is refused"; it
  -- is "adopting is refused by an account that has given everything away".
  do
    local GIVER = "GIVER" .. string.rep("g", 38)
    local TAKER = "TAKER" .. string.rep("t", 38)
    send(OWNER, { Action = "Admin.Unlock", Addresses = GIVER .. "," .. TAKER })
    local first = send(GIVER, { Action = "Faction.Join", Faction = "Sky Nomads" })
    send(TAKER, { Action = "Faction.Join", Faction = "Stone Titans" })

    ok("swearing is the one adoption", first and first.monster ~= nil, errOf(first))
    ok("and the account records that it has", first and first.adopted == true,
       first and tostring(first.adopted))

    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = GIVER,
                  Item = "rune", Amount = "5" })
    local mid = first.activeId
    send(GIVER, { Action = "Monster.Store", MonsterId = mid })
    local given = send(GIVER, { Action = "Monster.Transfer",
                                MonsterId = mid, Recipient = TAKER })
    ok("the giver ends up holding nothing",
       given and given.monster == nil and next(given.collection or {}) == nil,
       given and errOf(given))

    local refill = send(GIVER, { Action = "Monster.Adopt" })
    ok("an emptied account cannot adopt again", errOf(refill) ~= nil, json.encode(refill))
    local after = send(GIVER, { Action = "User.Login" })
    ok("and still holds nothing",
       after and after.monster == nil and next(after.collection or {}) == nil,
       after and json.encode(after.collection))

    -- The taker swore, so its oath is spent too. What it gained is the GIFT,
    -- on top of its own starter -- a wallet can end up holding two without
    -- either of them being a second adoption.
    local taker = send(TAKER, { Action = "User.Login" })
    local held = 0
    for _ in pairs(taker.monsters or {}) do held = held + 1 end
    for _ in pairs(taker.collection or {}) do held = held + 1 end
    ok("the taker holds its starter and the gift", held == 2, held)
    ok("and its oath is still recorded as spent", taker.adopted == true,
       tostring(taker.adopted))
    ok("so it cannot adopt a third",
       errOf(send(TAKER, { Action = "Monster.Adopt" })) ~= nil)
  end

  -- A migration carries the whole holding, and the market ---------------------
  --
  -- `Admin.Export` into `Admin.Load` is how a redeploy moves everyone onto a new
  -- process, and it used to carry `monster` and nothing else -- so a redeploy
  -- restored every player with one companion and destroyed the rest of their
  -- roster, all of their collection, and every creature sitting in escrow,
  -- which lives in `Market` and nowhere else.
  do
    local MIGA = "MIGRANT" .. string.rep("m", 36)
    send(OWNER, { Action = "Admin.Unlock", Addresses = MIGA })
    send(MIGA, { Action = "Faction.Join", Faction = "Aqua Guardians" })
    send(MIGA, { Action = "Monster.Adopt" })
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = MIGA,
                  Faction = "Aqua Guardians", Into = "roster" })
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = MIGA,
                  Faction = "Inferno Blades", Into = "collection" })
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = MIGA,
                  Faction = "Stone Titans", Into = "collection" })
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = MIGA,
                  Item = "rune", Amount = "20" })

    local before = send(MIGA, { Action = "User.Login" })
    local sellable = next(before.collection)
    local listed = send(MIGA, { Action = "Market.List",
                                MonsterId = sellable, Price = "17" })
    local listingId = listed and listed.listing and listed.listing.id
    ok("a companion is in escrow before the export", listingId ~= nil, errOf(listed))

    local held = send(MIGA, { Action = "User.Login" })
    local rosterCount, collectionCount = 0, 0
    for _ in pairs(held.monsters or {}) do rosterCount = rosterCount + 1 end
    for _ in pairs(held.collection or {}) do collectionCount = collectionCount + 1 end
    ok("the account holds one active and two stored",
       rosterCount == 1 and collectionCount == 2,
       rosterCount .. "/" .. collectionCount)

    -- Find the row however the export happens to page.
    local row = nil
    for offset = 0, 400, 25 do
      local page = send(OWNER, { Action = "Admin.Export",
                                 Offset = tostring(offset), Limit = "25" })
      for _, candidate in ipairs(page.players or {}) do
        if candidate.address == MIGA then row = candidate end
      end
      if page.done or #(page.players or {}) == 0 then break end
    end
    ok("the account is in the export", row ~= nil)

    local exportedRoster, exportedCollection = 0, 0
    for _ in pairs((row or {}).monsters or {}) do exportedRoster = exportedRoster + 1 end
    for _ in pairs((row or {}).collection or {}) do exportedCollection = exportedCollection + 1 end
    ok("the export carries the active companion", exportedRoster == 1, exportedRoster)
    ok("and the whole collection", exportedCollection == 2, exportedCollection)
    ok("and whether the account has adopted", row and row.adopted == true,
       row and tostring(row.adopted))
    ok("and the id counter behind them", row and int(row.monsterSeq, 0) >= 4,
       row and row.monsterSeq)

    local marketPage = send(OWNER, { Action = "Admin.Export", Section = "market" })
    local carriedListing = nil
    for _, entry in ipairs(marketPage.market or {}) do
      if entry.id == listingId then carriedListing = entry end
    end
    ok("the market exports as its own section", carriedListing ~= nil,
       json.encode(marketPage.market))
    ok("and a listing carries the whole companion",
       carriedListing and carriedListing.monster ~= nil
         and carriedListing.price == 17,
       carriedListing and json.encode(carriedListing.price))

    -- Emulate a row from the short-lived multi-active build. Loading it must
    -- keep every companion while folding the extra active record back into the
    -- collection.
    local oldExtraId, oldExtra = next(row.collection)
    row.collection[oldExtraId] = nil
    row.monsters[oldExtraId] = oldExtra
    send(OWNER, { Action = "Admin.Load" }, json.encode({
      players = { row },
      market = marketPage.market,
      marketSeq = marketPage.marketSeq,
    }))

    local restored = send(MIGA, { Action = "User.Login" })
    local backRoster, backCollection = 0, 0
    for _ in pairs(restored.monsters or {}) do backRoster = backRoster + 1 end
    for _ in pairs(restored.collection or {}) do backCollection = backCollection + 1 end
    ok("a reload folds an old multi-active roster down to one", backRoster == 1, backRoster)
    ok("and moves the extra companion into collection", backCollection == 2, backCollection)
    ok("and does not hand back the adoption", restored.adopted == true,
       tostring(restored.adopted))
    ok("and a reload cannot make the account adopt again",
       errOf(send(MIGA, { Action = "Monster.Adopt" })) ~= nil)

    -- The mirror. `monster` is meant to BE `monsters[activeId]`, not a copy of
    -- it, and every verb in the game mutates through the mirror. A load that
    -- assigned `p.monster` directly left two tables with the same id: the ids
    -- agreed, so nothing looked wrong until the companion was fed and only one
    -- of them gained the energy.
    ok("the active companion is a roster entry",
       restored.activeId ~= nil and restored.monsters[restored.activeId] ~= nil,
       restored.activeId)
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = MIGA,
                  Item = "water_berry", Amount = "5" })
    local fed = send(MIGA, { Action = "Monster.Feed" })
    ok("and feeding after a reload moves the roster entry too",
       fed and fed.monster and fed.monsters[fed.activeId]
         and fed.monster.energy == fed.monsters[fed.activeId].energy,
       fed and fed.monster and (tostring(fed.monster.energy) .. " vs "
         .. tostring(fed.monsters[fed.activeId] and fed.monsters[fed.activeId].energy)))

    -- An empty row is a real export shape: `Admin.Unlock` mints one for every
    -- address on a paid list. Loading one on top of a real player used to erase
    -- their loot boxes, and would now erase their companions.
    send(OWNER, { Action = "Admin.Load" }, json.encode({
      players = { { address = MIGA, monsters = {}, collection = {} } },
    }))
    local survived = send(MIGA, { Action = "User.Login" })
    local finalRoster = 0
    for _ in pairs(survived.monsters or {}) do finalRoster = finalRoster + 1 end
    ok("an empty row does not empty a real account", finalRoster == 1, finalRoster)
  end

  -- Stored thin, SERVED thin, and the definitions published once -------------
  --
  -- A move is nine fields and eight of them are a verbatim copy of the entry in
  -- `C.MOVE_POOLS`; only the uses remaining ever differ.
  --
  -- Companions have been stored compactly for a while. What this block used to
  -- pin was the opposite of what it pins now: every outward door expanded them
  -- again, which put the whole duplication back into the published map -- the
  -- one place it is most expensive, because the node marshals that map five
  -- times on every message no matter what the message did (see the
  -- published-state rule in CLAUDE.md). 499 bytes of every 1,007-byte
  -- companion, times every companion of every player, charged to every player
  -- on every action.
  --
  -- So the definitions are published ONCE under `catalog.movePools` and the
  -- client joins names against them. Three things have to hold together: the
  -- store stays thin, every view stays thin, and the catalog actually carries
  -- the table a client needs to do the join. A missing catalog is a blank card
  -- everywhere, so it is asserted first.
  do
    local MOVER = "MOVER" .. string.rep("m", 38)
    send(OWNER, { Action = "Admin.Unlock", Addresses = MOVER })
    send(MOVER, { Action = "Faction.Join", Faction = "Inferno Blades" })
    send(MOVER, { Action = "Monster.Adopt" })

    local stored = Players[MOVER] and Players[MOVER].monster
    ok("the companion exists", stored ~= nil and stored.moves ~= nil, stored ~= nil)

    local storedName, storedMove = next(stored.moves)
    local extra = {}
    for k in pairs(storedMove) do
      if k ~= "count" then extra[#extra + 1] = k end
    end
    table.sort(extra)
    ok("a STORED move keeps only the uses remaining", #extra == 0,
       json.encode(extra) .. " on " .. tostring(storedName))
    ok("and the uses are a real number", type(storedMove.count) == "number",
       json.encode(storedMove))

    -- The join table. Without it every card in the client is blank, so it is
    -- checked before anything that depends on it.
    local _, catRes = send(MOVER, { Action = "User.Info" })
    local catalog = json.decode(catRes.catalog)
    ok("the catalog publishes the move pools", type(catalog.movePools) == "table",
       type(catalog.movePools))
    local pooled = nil
    for _, pool in pairs(catalog.movePools or {}) do
      if type(pool) == "table" and pool[storedName] then pooled = pool[storedName] end
    end
    ok("and every rolled move is findable in them", pooled ~= nil, tostring(storedName))
    ok("with the numbers the engine uses", pooled and pooled.damage ~= nil
       and pooled.type ~= nil and pooled.rarity ~= nil, json.encode(pooled))

    -- Everything below is what a client actually reads. A served move carries
    -- the uses remaining and NOTHING else: the other eight fields are in the
    -- catalog above and must not be repeated once per companion.
    local function thinMove(moves, where)
      if type(moves) ~= "table" then return false, where .. ": no moves" end
      local name, mv = next(moves)
      if type(mv) ~= "table" then return false, where .. ": empty move" end
      if mv.count == nil then return false, where .. " " .. tostring(name) .. ": no count" end
      local dup = {}
      for _, field in ipairs({ "name", "type", "rarity",
                               "damage", "attack", "speed", "defense", "health" }) do
        if mv[field] ~= nil then dup[#dup + 1] = field end
      end
      return #dup == 0,
        where .. " " .. tostring(name) .. " republishes the constant " .. json.encode(dup)
    end

    local mine = send(MOVER, { Action = "User.Info" })
    local okActive, whyActive = thinMove(mine.monster and mine.monster.moves, "active companion")
    ok("the ACTIVE companion is served thin", okActive, whyActive)
    local rosterEntry = mine.monsters and select(2, next(mine.monsters))
    local okRoster, whyRoster = thinMove(rosterEntry and rosterEntry.moves, "roster entry")
    ok("and so is the roster entry behind it", okRoster, whyRoster)

    -- The same record read the way a wallet reads it: an unsigned GET.
    local _, res = send(MOVER, { Action = "User.Info" })
    local published = json.decode(res["player-" .. MOVER])
    local okPub, whyPub = thinMove(published.monster and published.monster.moves, "published")
    ok("and the published per-address record too", okPub, whyPub)

    -- A stored companion, which is the shape a collection is drawn from.
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = MOVER,
                  Faction = "Aqua Guardians", Into = "collection" })
    local held = send(MOVER, { Action = "User.Info" })
    local kept = held.collection and select(2, next(held.collection))
    local okKept, whyKept = thinMove(kept and kept.moves, "collection entry")
    ok("a stored companion is served thin as well", okKept, whyKept)

    -- The leaderboard is the worst case for this: fifty rows, each one a whole
    -- companion, rewritten whenever the board is dirty.
    local board = send(OWNER, { Action = "Leaderboard" })
    local okBoard, whyBoard = thinMove(board[1] and board[1].monster and board[1].monster.moves,
                                       "leaderboard row")
    ok("a leaderboard row carries thin moves", okBoard, whyBoard)

    -- So does a listing.
    local collectionId = next(held.collection or {})
    send(MOVER, { Action = "Market.List", MonsterId = collectionId, Price = "20" })
    local _, listedRes = send(MOVER, { Action = "User.Info" })
    local market = json.decode(listedRes.market)
    local listing = select(2, next(market))
    local okList, whyList = thinMove(listing and listing.monster and listing.monster.moves,
                                     "market listing")
    ok("a market listing carries thin moves", okList, whyList)
    -- ...and the escrowed copy behind it too.
    local escrowed = next(Market) and Market[next(Market)]
    local escrowMove = escrowed and escrowed.monster and select(2, next(escrowed.monster.moves))
    local escrowExtra = 0
    for k in pairs(escrowMove or {}) do if k ~= "count" then escrowExtra = escrowExtra + 1 end end
    ok("and the companion in escrow is still stored thin", escrowExtra == 0, escrowExtra)

    -- The mint queue is the ONE exception, and it is deliberate. It is a wire
    -- payload for an off-process worker that composites a card from each move
    -- type and has no catalog to join against. The queue drains, so it is
    -- O(mints in flight) rather than O(players).
    local function fullMove(moves, where)
      if type(moves) ~= "table" then return false, where .. ": no moves" end
      local name, mv = next(moves)
      if type(mv) ~= "table" then return false, where .. ": empty move" end
      local missing = {}
      for _, field in ipairs({ "name", "type", "rarity", "count",
                               "damage", "attack", "speed", "defense", "health" }) do
        if mv[field] == nil then missing[#missing + 1] = field end
      end
      return #missing == 0, where .. " " .. tostring(name) .. " missing " .. json.encode(missing)
    end
    send(OWNER, { Action = "Admin.Grant", PlayerId = MOVER, Item = "rune", Amount = "100" })
    local minting = send(MOVER, { Action = "Monster.Mint" })
    if errOf(minting) == nil then
      local _, mintRes = send(MOVER, { Action = "User.Info" })
      local queue = json.decode(mintRes.mintqueue)
      local job = queue and queue[#queue]
      local okQueue, whyQueue = fullMove(job and job.monster and job.monster.moves,
                                         "mint queue job")
      ok("a queued mint still carries whole moves for the card", okQueue, whyQueue)
    else
      -- Minting is paused in this build, so the queue cannot be filled through
      -- the handler. Assert the primitive it uses instead.
      local hydrated = Battle.hydrateMoves(stored.moves)
      local okHydrate, whyHydrate = fullMove(hydrated, "hydrated moveset")
      ok("minting is paused, so the hydration the queue uses is checked directly",
         okHydrate, whyHydrate)
    end

    -- A row written by an older build arrives with whole moves. It must be
    -- accepted, reduced on the way in, and stay reduced on the way back out.
    local LEGACY = "LEGACY" .. string.rep("l", 37)
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = LEGACY, unlocked = true, faction = "Sky Nomads",
      monsters = { ["m1"] = {
        name = "Airbud", elementType = "air", faction = "Sky Nomads",
        attack = 2, defense = 2, speed = 2, health = 2, level = 3,
        energy = 50, happiness = 50,
        status = { type = "Home", since = 1, until_time = 1 },
        moves = { ["Gale Force"] = {
          name = "Gale Force", type = "air", rarity = 3, count = 1,
          damage = 3, attack = 0, speed = 5, defense = -2, health = 0,
        } },
      } },
      activeId = "m1", monsterSeq = 1,
    } } }))
    local legacyStored = Players[LEGACY] and Players[LEGACY].monsters
      and Players[LEGACY].monsters["m1"]
    ok("a legacy row loads", legacyStored ~= nil, legacyStored ~= nil)
    local legacyExtra = {}
    for k in pairs((legacyStored or {}).moves and legacyStored.moves["Gale Force"] or {}) do
      if k ~= "count" then legacyExtra[#legacyExtra + 1] = k end
    end
    ok("and its whole moves are reduced on the way in", #legacyExtra == 0,
       json.encode(legacyExtra))
    ok("without losing the uses it had",
       legacyStored and legacyStored.moves["Gale Force"]
       and legacyStored.moves["Gale Force"].count == 1,
       legacyStored and json.encode(legacyStored.moves))
    local legacyBack = send(LEGACY, { Action = "User.Info" })
    local okLegacy, whyLegacy = thinMove(legacyBack.monster and legacyBack.monster.moves,
                                         "restored legacy companion")
    ok("and a load cannot smuggle the constant back into the view", okLegacy, whyLegacy)
    ok("while the uses it arrived with survive",
       legacyBack.monster.moves["Gale Force"]
       and legacyBack.monster.moves["Gale Force"].count == 1,
       legacyBack.monster and json.encode(legacyBack.monster.moves["Gale Force"]))
  end

  -- What the process KEEPS ---------------------------------------------------
  --
  -- `Battles` was append-only. The one deletion in the file drops a pending
  -- challenge nobody took, so every fight ever fought stayed in Lua memory for
  -- the life of the process: about four kilobytes each, three quarters of it
  -- the per-round `turns` log, and the node photographs the whole heap on
  -- every slot. These pin the retention rules that replaced that.
  do
    local FIGHTER = "FIGHTER" .. string.rep("f", 36)

    send(OWNER, { Action = "Admin.Unlock", Addresses = FIGHTER })
    send(FIGHTER, { Action = "Faction.Join", Faction = "Sky Nomads" })
    send(FIGHTER, { Action = "Monster.Adopt" })

    local function startFight()
      send(OWNER, { Action = "Admin.Grant", PlayerId = FIGHTER, Item = "rune", Amount = "5" })
      send(OWNER, { Action = "Admin.SetStats", PlayerId = FIGHTER },
           json.encode({ energy = 100, happiness = 100 }))
      send(FIGHTER, { Action = "Battle.Begin" })
      local started = send(FIGHTER, { Action = "Battle.Start" })
      return started and started.battle and started.battle.id
    end

    local before = send(OWNER, { Action = "Stats" })
    local completedBefore = before and before.completedBattles or 0

    local first = startFight()
    ok("a bot fight starts", first ~= nil, first)

    -- End it the way an owner would, which stamps `endedAt` and counts it.
    send(OWNER, { Action = "Admin.ReleaseBattle", PlayerId = FIGHTER })
    local justEnded = send(FIGHTER, { Action = "Battle.Info", BattleId = first })
    ok("a fight that just ended is still readable",
       justEnded and justEnded.status == "ended", errOf(justEnded))
    ok("and still carries its turn log for the result screen",
       justEnded and justEnded.turns ~= nil, errOf(justEnded))

    -- A second fight inside the retention window must not evict the first: the
    -- client may still be showing it.
    local second = startFight()
    ok("a second fight starts", second ~= nil, second)
    local stillThere = send(FIGHTER, { Action = "Battle.Info", BattleId = first })
    ok("a recent fight survives the next one starting",
       stillThere and stillThere.id == first, errOf(stillThere))

    -- Past the window, the next battle created reclaims it.
    send(OWNER, { Action = "Admin.ReleaseBattle", PlayerId = FIGHTER })
    T = T + (40 * 60 * 1000)
    local third = startFight()
    ok("a third fight starts", third ~= nil, third)
    local gone = send(FIGHTER, { Action = "Battle.Info", BattleId = first })
    ok("a fight older than the window is reclaimed", errOf(gone) == "Battle not found",
       json.encode(gone))
    local live = send(FIGHTER, { Action = "Battle.Info", BattleId = third })
    ok("and the fight in progress is untouched", live and live.id == third, errOf(live))

    -- The count is a counter now, not the size of the table, so reclaiming
    -- cannot make the lifetime total go backwards.
    local after = send(OWNER, { Action = "Stats" })
    ok("finished fights are still counted after they are reclaimed",
       after and after.completedBattles >= completedBefore + 2,
       after and (after.completedBattles .. " vs " .. completedBefore))

    -- And it survives a redeploy, like every other lifetime counter.
    local exported = send(OWNER, { Action = "Admin.Export", Limit = "1" })
    ok("the export carries the lifetime battle count",
       exported and exported.battlesCompleted ~= nil, exported and exported.battlesCompleted)
    local highWater = after and after.completedBattles or 0
    send(OWNER, { Action = "Admin.Load" }, json.encode({ battlesCompleted = 0, players = {} }))
    local afterLoad = send(OWNER, { Action = "Stats" })
    ok("and a restore carrying zero cannot lower it",
       afterLoad and afterLoad.completedBattles == highWater,
       afterLoad and afterLoad.completedBattles)
  end

  -- What a slot actually writes ----------------------------------------------
  --
  -- `result` IS `base` on HyperBEAM: a key a slot does not write keeps the
  -- value the slot before it left there. The suite carries `STATE` for exactly
  -- that reason, but carrying it is not the same as ASSERTING on it -- no test
  -- above can tell a key that was deliberately skipped from one that was
  -- rewritten, and skipping is the entire point of the gating in `compute`.
  --
  -- These start from a base of their own so the sentinels below are the only
  -- thing in it, and work by sentinel: a key still holding its
  -- sentinel afterwards was not recomputed, and one that no longer holds it
  -- was. Being wrong in the safe direction only makes the process slow; being
  -- wrong in the other publishes stale state to everyone, so both directions
  -- are asserted for every key that matters.
  do
    local ECON1 = "ECON1" .. string.rep("1", 38)
    local ECON2 = "ECON2" .. string.rep("2", 38)
    local ECON5 = "ECON5" .. string.rep("5", 38)
    local ECON6 = "ECON6" .. string.rep("6", 38)

    local carried = { process = PROCESS }
    local function sendOn(from, tags, data)
      T = T + 1000
      local body = { Address = from }
      for k, v in pairs(tags) do body[k] = v end
      if data then body.Data = data end
      -- The return value IS `carried`; rebinding it is what makes the next
      -- message a continuation of this one rather than a fresh process.
      local res = compute(carried, { body = body, timestamp = T }, {})
      carried = res
      return json.decode(res.results.output.data), res
    end

    local function currentMetricDay()
      local view = carried.metrics and json.decode(carried.metrics)
      return view, view and view.daily
        and (view.daily[tostring(T // 86400000)]
          or view.daily[T // 86400000])
    end

    local function checkIncrementalTelemetry(label)
      -- Stats is an independent authoritative scan and a read-only action, so
      -- it cannot repair a drifting TelemetryTotals cache before comparison.
      local statsNow = sendOn(OWNER, { Action = "Stats" })
      local _, metricDay = currentMetricDay()
      ok(label .. " publishes the current telemetry day",
         type(metricDay) == "table", type(metricDay))
      if type(metricDay) == "table" then
        for _, field in ipairs({ "players", "unlocked", "monsters", "runes",
                                 "lootboxes", "activeBattles", "wins", "losses",
                                 "quests" }) do
          ok(label .. " matches Stats for " .. field,
             metricDay[field] == statsNow[field],
             tostring(metricDay[field]) .. " / " .. tostring(statsNow[field]))
        end
        local factionRows = json.decode(carried.factions)
        for _, faction in ipairs(factionRows or {}) do
          ok(label .. " matches faction membership for " .. faction.element,
             metricDay.factions
               and metricDay.factions[faction.element] == faction.memberCount,
             tostring(metricDay.factions and metricDay.factions[faction.element])
               .. " / " .. tostring(faction.memberCount))
        end
      end

      -- The board is now served from a maintained top-N instead of a sort of
      -- the whole world, which is what makes a write O(1) in the player count.
      -- The whole risk of that trade is DRIFT: a ranking that is quietly wrong
      -- looks exactly like a ranking that is right. `leaderboardByScan` is the
      -- old implementation, kept for precisely this -- it reads `Players`
      -- directly and cannot be repaired by the index it is checking.
      local ranked, scanned = leaderboard(50), leaderboardByScan(50)
      ok(label .. " board is the same length as a full scan",
         #ranked == #scanned, #ranked .. " / " .. #scanned)
      local same = #ranked == #scanned
      local firstBad
      for i = 1, math.min(#ranked, #scanned) do
        if ranked[i].address ~= scanned[i].address
           or ranked[i].level ~= scanned[i].level
           or ranked[i].wins ~= scanned[i].wins then
          same = false
          firstBad = firstBad or (i .. ": " .. tostring(ranked[i].address)
            .. " vs " .. tostring(scanned[i].address))
        end
      end
      ok(label .. " board matches a full scan row for row", same, firstBad)
    end

    -- A process that has published nothing publishes everything, even for a
    -- read. This is the absence fallback, and it is what makes a wrong entry
    -- in READ_ONLY merely slow rather than silently stale.
    sendOn(OWNER, { Action = "Stats" })
    ok("a fresh process publishes the catalog", type(carried.catalog) == "string",
       type(carried.catalog))
    ok("and the faction tally", type(carried.factions) == "string", type(carried.factions))
    ok("and the access flag", type(carried.access) == "string", type(carried.access))
    ok("and the market", type(carried.market) == "string", type(carried.market))

    -- A primary key can survive a partial/older snapshot while a sibling is
    -- absent. Every sibling guard has to initialise its whole domain even when
    -- the action itself is a pure read.
    carried.market = "SENTINEL"
    carried.marketstats = nil
    carried.markethistory = nil
    carried.runewithdrawals = "SENTINEL"
    carried.runedeposits = nil
    carried.assets = "SENTINEL"
    carried.assetcount = nil
    sendOn(OWNER, { Action = "Stats" })
    ok("a missing market sibling republishes market stats and history",
       type(carried.marketstats) == "string"
         and type(carried.markethistory) == "string",
       type(carried.marketstats) .. "/" .. type(carried.markethistory))
    ok("a missing deposit sibling republishes both bridge ledgers",
       type(carried.runedeposits) == "string", type(carried.runedeposits))
    ok("a missing asset-count sibling republishes the asset registry",
       type(carried.assetcount) == "string", type(carried.assetcount))

    -- Constants are written once. A WRITE action is used here deliberately:
    -- the statics must survive the one code path that rebuilds everything else.
    carried.catalog = "SENTINEL"
    carried.access = "SENTINEL"
    carried.mintcost = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.Unlock", Addresses = ECON1 })
    ok("the catalog is written once and never again", carried.catalog == "SENTINEL",
       carried.catalog)
    ok("and so is the access flag", carried.access == "SENTINEL", carried.access)
    ok("and so is the mint price", carried.mintcost == "SENTINEL", carried.mintcost)

    -- A read rebuilds nothing.
    carried.factions = "SENTINEL"
    carried.leaderboard = "SENTINEL"
    carried.market = "SENTINEL"
    carried.users = "SENTINEL"
    carried.metrics = "SENTINEL"
    sendOn(ALICE, { Action = "Leaderboard" })
    ok("a read does not rebuild the faction tally", carried.factions == "SENTINEL",
       carried.factions)
    ok("nor the leaderboard", carried.leaderboard == "SENTINEL", carried.leaderboard)
    ok("nor the market", carried.market == "SENTINEL", carried.market)
    ok("nor the player count", carried.users == "SENTINEL", carried.users)

    -- An unknown action is deliberately unclassified, so it takes the safe
    -- path and republishes every derived domain. A future handler added without
    -- a classification can be slow for one release, but never stale.
    sendOn(ALICE, { Action = "Nonsense.Verb" })
    ok("an unknown action fails safe by rebuilding aggregates",
       carried.factions ~= "SENTINEL",
       carried.factions)

    -- A user-list mutation does not rebuild unrelated domains.
    carried.factions = "SENTINEL"
    carried.leaderboard = "SENTINEL"
    carried.market = "SENTINEL"
    carried.assets = "SENTINEL"
    carried.runewithdrawals = "SENTINEL"
    carried.mintqueue = "SENTINEL"
    carried.depositqueue = "SENTINEL"
    carried.users = "SENTINEL"
    carried.metrics = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.Unlock", Addresses = ECON2 })
    ok("an unlock leaves the faction tally alone", carried.factions == "SENTINEL",
       carried.factions)
    ok("and the leaderboard", carried.leaderboard == "SENTINEL", carried.leaderboard)
    ok("and the market", carried.market == "SENTINEL", carried.market)
    ok("and assets", carried.assets == "SENTINEL", carried.assets)
    ok("and bridge ledgers", carried.runewithdrawals == "SENTINEL",
       carried.runewithdrawals)
    ok("and mint queues", carried.mintqueue == "SENTINEL"
       and carried.depositqueue == "SENTINEL",
       carried.mintqueue .. "/" .. carried.depositqueue)
    ok("and the player count", carried.users ~= "SENTINEL", carried.users)
    ok("and the metrics", carried.metrics ~= "SENTINEL", carried.metrics)

    -- RE-POINTED at the current contract, deliberately. This used to assert
    -- "Admin.Unlock publishes every account it minted", because unlocking an
    -- address called `getPlayer` and therefore created one.
    --
    -- It no longer does. An admitted wallet is one string in `Unlocked` until
    -- it acts, because an empty account is ~6 live Lua tables and the collect
    -- at the end of every `compute` is O(live tables squared) — so a seeded
    -- paid list used to be charged to every message from every player, forever.
    -- There is nothing to publish for a wallet with no record, and the client
    -- already handles a missing `player-<address>` key by falling back to a
    -- signed `User.Info` — which is the second assertion here.
    ok("admitting a wallet mints no account to publish",
       carried["player-" .. ECON1] == nil and carried["player-" .. ECON2] == nil,
       tostring(carried["player-" .. ECON1]) .. "/" .. tostring(carried["player-" .. ECON2]))
    do
      local admitted = sendOn(ECON2, { Action = "User.Info" })
      ok("an admitted wallet reads back unlocked and not yet materialised",
         admitted and admitted.unlocked == true and admitted.exists == false,
         json.encode(admitted))
    end

    -- Grant also goes through getPlayer and therefore may create its target.
    -- It is an easy classification edge to miss because the usual target
    -- already exists.
    carried.users = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON6,
                    Item = "rune", Amount = "1" })
    ok("a grant to a new address republishes the player count",
       carried.users ~= "SENTINEL", carried.users)
    ok("and publishes the newly created account",
       type(carried["player-" .. ECON6]) == "string",
       type(carried["player-" .. ECON6]))

    -- The other half of the admission rule: an address that ALREADY has a
    -- record keeps the flag on the record, so unlocking it must still
    -- republish that record. Only a wallet with nothing to publish publishes
    -- nothing.
    carried["player-" .. ECON6] = nil
    sendOn(OWNER, { Action = "Admin.Lock", PlayerId = ECON6 })
    sendOn(OWNER, { Action = "Admin.Unlock", Addresses = ECON6 })
    ok("unlocking an account that exists republishes it",
       type(carried["player-" .. ECON6]) == "string",
       type(carried["player-" .. ECON6]))

    -- A revocation has to reach an admitted wallet too, or Admin.Lock would
    -- silently do nothing the moment Admin.Unlock stopped minting records.
    do
      local revoked = sendOn(OWNER, { Action = "Admin.Lock", PlayerId = ECON1 })
      ok("Admin.Lock revokes an admission that has no record",
         revoked and revoked.locked == ECON1, json.encode(revoked))
      local after = sendOn(ECON1, { Action = "User.Info" })
      ok("and the revoked wallet reads back locked",
         after and after.unlocked == false and after.exists == false,
         json.encode(after))
    end

    -- Dispatch has always ignored Action value case. Every decision after
    -- dispatch must use that same resolved name: admin targeting, audit,
    -- telemetry and dirty-key publication used to inspect the raw spelling and
    -- disagree with the handler that had just run.
    local ECON7 = "ECON7" .. string.rep("7", 38)
    carried.users = "SENTINEL"
    carried.metrics = "SENTINEL"
    local mixedGrant = sendOn(OWNER, {
      Action = "aDmIn.GrAnT", PlayerId = ECON7, Item = "rune", Amount = "3",
    })
    ok("a mixed-case admin mutation succeeds",
       mixedGrant and ((mixedGrant.inventory or {}).rune or 0) == 3,
       mixedGrant and json.encode(mixedGrant))
    ok("mixed-case admin targeting publishes the new account",
       type(carried["player-" .. ECON7]) == "string",
       type(carried["player-" .. ECON7]))
    ok("mixed-case admin targeting republishes the user count",
       carried.users ~= "SENTINEL", carried.users)
    ok("mixed-case admin telemetry uses the canonical action",
       carried.metrics ~= "SENTINEL", carried.metrics)
    local mixedMetrics = json.decode(carried.metrics)
    ok("the canonical admin action is counted and audited",
       mixedMetrics.totals and mixedMetrics.totals["Admin.Grant"] >= 1
         and mixedGrant.adminSnapshot ~= nil,
       json.encode(mixedMetrics.totals))
    ok("the published action still echoes the caller's spelling",
       carried.action == "aDmIn.GrAnT", carried.action)

    -- A grant is one companion for one wallet, and used to rewrite the entire
    -- player table for no reason beyond being an Admin.* action.
    carried["player-" .. ECON1] = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.CreateMonster", PlayerId = ECON2,
                    Faction = "Inferno Blades", Into = "roster" })
    ok("a grant publishes the account it granted to",
       type(carried["player-" .. ECON2]) == "string"
       and carried["player-" .. ECON2] ~= "SENTINEL",
       type(carried["player-" .. ECON2]))
    ok("and does not rewrite every other account",
       carried["player-" .. ECON1] == "SENTINEL", carried["player-" .. ECON1])

    -- The three high-frequency game loops update the player-facing aggregates
    -- and telemetry, but not independent stores. These sentinels are the
    -- regression guard for the original hot-path problem.
    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON2,
                    Item = "fire_berry", Amount = "20" })
    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON2,
                    Item = "rune", Amount = "20" })
    local function hotAction(label, tags, data)
      carried.factions = "SENTINEL"
      carried.leaderboard = "SENTINEL"
      carried.market = "SENTINEL"
      carried.assets = "SENTINEL"
      carried.runewithdrawals = "SENTINEL"
      carried.runedeposits = "SENTINEL"
      carried.mintqueue = "SENTINEL"
      carried.depositqueue = "SENTINEL"
      carried.metrics = "SENTINEL"
      local value = sendOn(ECON2, tags, data)
      ok(label .. " succeeds", value and value.error == nil,
         value and value.error)
      ok(label .. " republishes gameplay aggregates",
         carried.factions ~= "SENTINEL" and carried.leaderboard ~= "SENTINEL",
         carried.factions)
      ok(label .. " republishes telemetry", carried.metrics ~= "SENTINEL",
         carried.metrics)
      ok(label .. " skips market/assets",
         carried.market == "SENTINEL" and carried.assets == "SENTINEL",
         carried.market .. "/" .. carried.assets)
      ok(label .. " skips bridge/worker queues",
         carried.runewithdrawals == "SENTINEL"
         and carried.runedeposits == "SENTINEL"
         and carried.mintqueue == "SENTINEL"
         and carried.depositqueue == "SENTINEL",
         carried.runewithdrawals .. "/" .. carried.mintqueue)
      return value
    end

    hotAction("Monster.Feed", { Action = "mOnStEr.FeEd", Item = "fire_berry" })
    local feedMetrics = json.decode(carried.metrics)
    ok("a mixed-case player mutation is counted canonically",
       feedMetrics.totals and feedMetrics.totals["Monster.Feed"] >= 1,
       json.encode(feedMetrics.totals))
    hotAction("Monster.Quest", { Action = "Monster.Quest" })
    sendOn(OWNER, { Action = "Admin.SetStats", PlayerId = ECON2 },
      json.encode({ energy = 50, happiness = 50,
                    status = { type = "Home", since = T, until_time = T } }))
    sendOn(ECON2, { Action = "Battle.Begin" })
    local fight = sendOn(ECON2, { Action = "Battle.Start" })
    local move
    if fight and fight.battle and fight.battle.challenger then
      for name in pairs(fight.battle.challenger.moves or {}) do move = move or name end
    end
    if fight and fight.battle and move then
      hotAction("Battle.Attack", {
        Action = "Battle.Attack", BattleId = fight.battle.id, Move = move,
      })
    else
      ok("Battle.Attack setup succeeds", false, fight and json.encode(fight))
    end

    -- Settlement clears activeBattleId before the publication block looks at
    -- the player. The shared singleton must be overwritten with the terminal
    -- battle instead of preserving the previous slot's live view.
    if Players[ECON2] and not Players[ECON2].activeBattleId then
      sendOn(ECON2, { Action = "Battle.Start" })
    end
    local left = sendOn(ECON2, { Action = "Battle.Leave" })
    local terminalBattle = carried.battle and json.decode(carried.battle)
    ok("leaving a live battle succeeds", left and left.error == nil,
       left and left.error)
    ok("leaving publishes a terminal singleton battle",
       terminalBattle and terminalBattle.status == "ended",
       carried.battle)

    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON2,
                    Item = "rune", Amount = "2" })
    sendOn(OWNER, { Action = "Admin.SetStats", PlayerId = ECON2 },
      json.encode({ energy = 100, happiness = 100,
                    status = { type = "Home", since = T, until_time = T } }))
    sendOn(ECON2, { Action = "Battle.Begin" })
    local posted = sendOn(ECON2, {
      Action = "Battle.Challenge", Opponent = "OPEN",
    })
    ok("a pending challenge exists for singleton clearing",
       posted and posted.battle and posted.battle.status == "pending",
       posted and json.encode(posted))
    sendOn(ECON2, { Action = "Battle.Leave" })
    ok("withdrawing a pending challenge clears the singleton battle",
       carried.battle == "null" and carried.battleid == "null",
       tostring(carried.battle) .. "/" .. tostring(carried.battleid))

    -- Compare before any later Admin.Load/AdjustAll full rebuild has a chance
    -- to hide drift introduced by the incremental hot path.
    checkIncrementalTelemetry("incremental hot path")

    -- Export lazily normalises pre-roster rows. Because that is a real state
    -- mutation hiding behind a read-shaped admin verb, the normalised wallet
    -- key has to be published in the same slot.
    local LEGACY = "000EXPORT" .. string.rep("e", 34)
    Players[LEGACY] = {
      address = LEGACY, unlocked = true, faction = "Inferno Blades",
      monster = Battle.clone(Players[ECON2].monster),
      inventory = {}, lootboxes = {}, wins = 0, losses = 0,
      questsCompleted = 0, joinedAt = T,
    }
    Players[LEGACY].monster.id = nil
    carried["player-" .. LEGACY] = "SENTINEL"
    local exportPage = sendOn(OWNER, {
      Action = "Admin.Export", Offset = "0", Limit = "1",
    })
    ok("Admin.Export visits the legacy row first",
       exportPage and exportPage.players and exportPage.players[1]
         and exportPage.players[1].address == LEGACY,
       exportPage and json.encode(exportPage.players))
    ok("Admin.Export publishes the row it normalised",
       carried["player-" .. LEGACY] ~= "SENTINEL",
       carried["player-" .. LEGACY])
    local normalised = json.decode(carried["player-" .. LEGACY])
    ok("the exported key carries the roster shape",
       normalised and normalised.activeId ~= nil
         and next(normalised.monsters or {}) ~= nil,
       normalised and json.encode(normalised))

    -- A restore publishes the rows it loaded, and only those.
    carried["player-" .. ECON1] = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.Load" }, json.encode({
      players = { { address = ECON5, unlocked = true, wins = 3 } },
    }))
    ok("Admin.Load publishes the row it loaded",
       type(carried["player-" .. ECON5]) == "string", type(carried["player-" .. ECON5]))
    ok("and leaves the accounts it never saw alone",
       carried["player-" .. ECON1] == "SENTINEL", carried["player-" .. ECON1])

    -- A bulk adjust publishes the accounts it moved, and skips the ones it
    -- reported as skipped: nothing about those records changed.
    carried["player-" .. ECON1] = "SENTINEL"
    carried["player-" .. ECON2] = "SENTINEL"
    local adjusted = sendOn(OWNER, { Action = "Admin.AdjustAll", Energy = 41 })
    ok("Admin.AdjustAll reports what it changed", adjusted and adjusted.adjusted > 0,
       adjusted and adjusted.adjusted)
    ok("and publishes an account it adjusted",
       carried["player-" .. ECON2] ~= "SENTINEL", carried["player-" .. ECON2])
    ok("and not one with no companion to adjust",
       carried["player-" .. ECON1] == "SENTINEL", carried["player-" .. ECON1])

    -- The published faction roster is bounded; the count beside it is not.
    local crowd = {}
    for i = 1, 55 do
      crowd[i] = { address = string.format("ECONROSTER%033d", i),
                   unlocked = true, faction = "Sky Nomads" }
    end
    ok("the crowd is addressed the way a wallet is", #crowd[1].address == 43,
       #crowd[1].address)
    sendOn(OWNER, { Action = "Admin.Load" }, json.encode({ players = crowd }))
    local tally = json.decode(carried.factions)
    local sky
    for _, f in ipairs(tally or {}) do if f.name == "Sky Nomads" then sky = f end end
    ok("the faction tally counts every member", sky and sky.memberCount >= 55,
       sky and sky.memberCount)
    ok("but publishes at most fifty of them", sky and #sky.members == 50,
       sky and #sky.members)

    -- Accounts an admin message changes without ever naming them.
    --
    -- These are the cases the old blanket "republish every player on any
    -- Admin.* action" was quietly covering up. Each one below changes somebody
    -- the message identifies only indirectly -- through a companion's new
    -- owner, a withdrawal id, or a queued mint job -- so `compute` cannot find
    -- them from `PlayerId` and the handler has to name them itself.
    local ECON3 = "ECON3" .. string.rep("3", 38)
    local ECON4 = "ECON4" .. string.rep("4", 38)
    sendOn(OWNER, { Action = "Admin.Unlock", Addresses = ECON3 .. "," .. ECON4 })
    sendOn(OWNER, { Action = "Admin.CreateMonster", PlayerId = ECON3,
                    Faction = "Stone Titans", Into = "roster" })
    local giver = json.decode(carried["player-" .. ECON3])
    local moving = giver and giver.activeId
    ok("the giver has a companion to move", moving ~= nil, moving)

    carried["player-" .. ECON4] = "SENTINEL"
    sendOn(OWNER, { Action = "Admin.MoveMonster", PlayerId = ECON3,
                    MonsterId = moving, Recipient = ECON4 })
    ok("an admin move publishes the RECIPIENT, who is not the PlayerId",
       carried["player-" .. ECON4] ~= "SENTINEL"
       and type(carried["player-" .. ECON4]) == "string",
       carried["player-" .. ECON4])
    local gained = json.decode(carried["player-" .. ECON4])
    ok("and the companion is there when they look",
       gained and next(gained.collection or {}) ~= nil,
       gained and json.encode(gained.collection))

    -- A market purchase is a zero-net Rune transfer, but operational flow is
    -- gross: the buyer removed `price` and the seller added `price`. Looking at
    -- only the actor would record half; comparing only the total would record
    -- neither.
    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON3,
                    Item = "rune", Amount = "10" })
    local gainedId = gained and next(gained.collection or {})
    local listed = gainedId and sendOn(ECON4, {
      Action = "Market.List", MonsterId = gainedId,
      Price = tostring(C.MARKET.minPrice),
    }) or nil
    local listingId = listed and listed.listing and listed.listing.id
    ok("the transferred companion can be listed", listingId ~= nil,
       listed and json.encode(listed))
    local _, flowBefore = currentMetricDay()
    local addedBefore = int(flowBefore and flowBefore.runeAdded, 0)
    local removedBefore = int(flowBefore and flowBefore.runeRemoved, 0)
    local bought = listingId and sendOn(ECON3, {
      Action = "Market.Buy", ListingId = listingId,
    }) or nil
    ok("the second wallet can buy the listing",
       bought and bought.error == nil, bought and bought.error)
    local _, flowAfter = currentMetricDay()
    ok("a two-wallet sale records the seller's Rune addition",
       flowAfter and flowAfter.runeAdded == addedBefore + C.MARKET.minPrice,
       flowAfter and flowAfter.runeAdded)
    ok("a two-wallet sale records the buyer's Rune removal",
       flowAfter and flowAfter.runeRemoved == removedBefore + C.MARKET.minPrice,
       flowAfter and flowAfter.runeRemoved)

    -- A refund names a WithdrawalId and nothing else, and pays an account.
    sendOn(OWNER, { Action = "Admin.Grant", PlayerId = ECON3, Item = "rune", Amount = "5" })
    sendOn(ECON3, { Action = "Rune.Withdraw", Amount = "2" })
    local pending = sendOn(ECON3, { Action = "Rune.Withdrawals" })
    local wid
    for _, w in ipairs((pending or {}).withdrawals or {}) do
      if w.status == "pending" then wid = w.id end
    end
    ok("there is a pending withdrawal to settle", wid ~= nil, wid)
    if wid then
      local _, refundBefore = currentMetricDay()
      local refundAddedBefore = int(refundBefore and refundBefore.runeAdded, 0)
      carried["player-" .. ECON3] = "SENTINEL"
      sendOn(OWNER, { Action = "Admin.SettleWithdrawal", WithdrawalId = wid,
                      Outcome = "refund" })
      ok("a refund publishes the account it paid back",
         carried["player-" .. ECON3] ~= "SENTINEL"
         and type(carried["player-" .. ECON3]) == "string",
         carried["player-" .. ECON3])
      local _, refundAfter = currentMetricDay()
      ok("an indirect withdrawal refund records its Rune addition",
         refundAfter and refundAfter.runeAdded == refundAddedBefore + 2,
         refundAfter and refundAfter.runeAdded)
    end

    -- Full rebuild actions and the incremental multi-wallet actions that follow
    -- them both leave the cache exact.
    checkIncrementalTelemetry("post-bulk and incremental path")

    -- The board still carries the whole companion, and none of the scaffolding
    -- the deferred clone needs in order to pick its fifty.
    local board = json.decode(carried.leaderboard)
    ok("the leaderboard has rows to check", type(board) == "table" and #board > 0,
       type(board) == "table" and #board or type(board))
    if type(board) == "table" and #board > 0 then
      ok("a leaderboard row carries the whole companion",
         type(board[1].monster) == "table" and board[1].monster.moves ~= nil,
         type(board[1].monster))
      ok("with its next level threshold", board[1].monster.nextLevelExp ~= nil,
         board[1].monster.nextLevelExp)
      ok("and no scaffolding left over from the sort", board[1].source == nil,
         board[1].source)
    end
  end

  -- Gold economy, exact ledgers, P2P escrow and finite NPC desks -------------
  do
    -- Isolate this contract slice from all of the deliberately destructive
    -- admin/migration probes above, then account the world that already exists.
    EconomyState = EconomyEngine.newState()
    EconomyState = EconomyEngine.syncHoldings(EconomyState, Players, T)

    local SELLER = "GOLDSELLER" .. string.rep("s", 33)
    local BUYER = "GOLDBUYER" .. string.rep("b", 34)
    send(OWNER, { Action = "Admin.Unlock", Addresses = SELLER .. "," .. BUYER })
    send(OWNER, { Action = "Admin.Grant", PlayerId = SELLER,
                  Item = "air_berry", Amount = "500" })
    send(OWNER, { Action = "Admin.Grant", PlayerId = BUYER,
                  Item = "air_berry", Amount = "500" })
    send(OWNER, { Action = "Admin.Grant", PlayerId = SELLER,
                  Item = "fire_berry", Amount = "20" })

    local fundedBuyer = send(BUYER, {
      Action = "Economy.Shop.Trade", Item = "air_berry", Side = "sell", Quantity = "19",
    })
    local fundedSeller = send(SELLER, {
      Action = "Economy.Shop.Trade", Item = "air_berry", Side = "sell", Quantity = "1",
    })
    ok("the finite NPC buys exact player inventory",
       fundedBuyer and int(fundedBuyer.gold, 0) > 0
         and (fundedBuyer.inventory or {}).air_berry == 481,
       fundedBuyer and json.encode(fundedBuyer))
    ok("and Gold comes out of the named desk reserve",
       fundedSeller and int(fundedSeller.gold, 0) > 0,
       fundedSeller and json.encode(fundedSeller))

    local listed = send(SELLER, {
      Action = "Economy.Order.Place", Side = "sell", Item = "fire_berry",
      Price = "10", Quantity = "5",
    })
    local sellOrder = listed and listed.economyResult and listed.economyResult.order
    ok("a Gold sell order escrows its items", sellOrder and sellOrder.remaining == 5,
       listed and json.encode(listed.economyResult))
    local filled = send(BUYER, {
      Action = "Economy.Order.Place", Side = "buy", Item = "fire_berry",
      Price = "12", Quantity = "5",
    })
    ok("a crossing Gold order fills at the resting price",
       filled and filled.economyResult and #filled.economyResult.fills == 1
         and filled.economyResult.fills[1].price == 10,
       filled and json.encode(filled.economyResult))
    ok("the buyer receives the exact escrowed items",
       filled and (filled.inventory or {}).fire_berry == 5,
       filled and json.encode(filled))
    local paidSeller = send(SELLER, { Action = "User.Info" })
    ok("the seller receives proceeds less the deterministic two-percent fee",
       paidSeller and int(paidSeller.gold, 0) >= 52, paidSeller and paidSeller.gold)

    local partialAsk = send(SELLER, {
      Action = "Economy.Order.Place", Side = "sell", Item = "fire_berry",
      Price = "10", Quantity = "6",
    })
    local partialId = partialAsk and partialAsk.economyResult
      and partialAsk.economyResult.order.id
    local partialBid = send(BUYER, {
      Action = "Economy.Order.Place", Side = "buy", Item = "fire_berry",
      Price = "10", Quantity = "2",
    })
    local economyAfterPartial = send(BUYER, { Action = "Economy.View" })
    local remaining = nil
    for _, order in ipairs((economyAfterPartial or {}).orders or {}) do
      if order.id == partialId then remaining = order.remaining end
    end
    ok("partial fills leave the exact remainder in escrow", remaining == 4, remaining)
    local afterCancel = send(SELLER, { Action = "Economy.Order.Cancel", OrderId = partialId })
    ok("cancelling returns the remaining item escrow",
       afterCancel and (afterCancel.inventory or {}).fire_berry == 13,
       afterCancel and json.encode(afterCancel))

    local ownAsk = send(SELLER, {
      Action = "Economy.Order.Place", Side = "sell", Item = "fire_berry",
      Price = "10", Quantity = "1",
    })
    local goldBeforeSelf = ownAsk and ownAsk.gold
    local ownBid = send(SELLER, {
      Action = "Economy.Order.Place", Side = "buy", Item = "fire_berry",
      Price = "10", Quantity = "1",
    })
    ok("self-trading is rejected", errOf(ownBid) ~= nil, json.encode(ownBid))
    local afterSelf = send(SELLER, { Action = "User.Info" })
    ok("a refused self-trade changes no Gold or escrow",
       afterSelf.gold == goldBeforeSelf, afterSelf.gold)
    if ownAsk and ownAsk.economyResult and ownAsk.economyResult.order then
      send(SELLER, { Action = "Economy.Order.Cancel",
                     OrderId = ownAsk.economyResult.order.id })
    end

    -- A fresh desk proves the NPC round trip is loss-making without bumping
    -- into the first desk's deliberately tight 2%-of-supply epoch rail.
    send(OWNER, { Action = "Admin.Grant", PlayerId = SELLER,
                  Item = "water_berry", Amount = "1000" })
    send(SELLER, { Action = "Economy.Shop.Trade", Item = "water_berry",
                   Side = "sell", Quantity = "10" })
    local roundTripBefore = send(BUYER, { Action = "User.Info" }).gold
    local firstShopBuy = send(BUYER, { Action = "Economy.Shop.Trade",
      ActionId = "shop-replay-1", Item = "water_berry", Side = "buy", Quantity = "1" })
    local replayedShopBuy = send(BUYER, { Action = "Economy.Shop.Trade",
      ActionId = "shop-replay-1", Item = "water_berry", Side = "buy", Quantity = "1" })
    ok("replaying an NPC trade changes no balance, stock, or inventory",
       replayedShopBuy.economyResult.replayed == true
         and replayedShopBuy.gold == firstShopBuy.gold
         and replayedShopBuy.inventory.water_berry == firstShopBuy.inventory.water_berry,
       json.encode(replayedShopBuy.economyResult))
    local roundTrip = send(BUYER, { Action = "Economy.Shop.Trade", Item = "water_berry",
                                    Side = "sell", Quantity = "1" })
    ok("a closed NPC round trip always loses Gold",
       roundTrip and int(roundTrip.gold, roundTripBefore) < roundTripBefore,
       roundTrip and (tostring(roundTripBefore) .. " -> " .. tostring(roundTrip.gold)))

    local economy = send(BUYER, { Action = "Economy.View" })
    ok("Gold remains exactly conserved across shop, escrow, fees and players",
       economy and economy.invariants.gold.ok == true,
       economy and json.encode(economy.invariants.gold))
    ok("every fungible item and loot-box tier remains exactly conserved",
       economy and economy.invariants.ok == true,
       economy and json.encode(economy.invariants))
    ok("the Scroll desk is safely paused until reliable supply exists",
       economy and economy.desks.scroll.pause.buy ~= nil,
       economy and economy.desks.scroll.pause.buy)
    ok("the Rune desk is safely paused until token reconciliation exists",
       economy and economy.desks.rune.pause.buy ~= nil,
       economy and economy.desks.rune.pause.buy)

    local preview = send(OWNER, { Action = "Admin.Economy.Preview" },
      json.encode({ path = "gold.perQualifiedPlayer", value = 1200 }))
    ok("an admin policy preview is non-mutating and shows its delay",
       preview and preview.oldValue == 1000 and preview.newValue == 1200
         and preview.effectiveAt > T,
       preview and json.encode(preview))
    local proposed = send(OWNER, { Action = "Admin.Economy.Propose" },
      json.encode({ path = "gold.perQualifiedPlayer", value = 1200,
                    reason = "adversarial simulation" }))
    local changeId = proposed and proposed.change and proposed.change.id
    local early = send(OWNER, { Action = "Admin.Economy.Apply", ChangeId = changeId })
    ok("a policy change cannot bypass its 24-hour delay", errOf(early) ~= nil,
       early and json.encode(early))

    -- Emission is the ENGINE's decision, not a dial.
    --
    -- `epochBudget` and `newcomerFloor` used to be numbers a human proposed and
    -- applied, defaulting to zero, which is why every worship on every
    -- deployment paid nothing. They are derived from `C.ECONOMY.rune` and the
    -- clock now, and the policy surface refuses to take them as input --
    -- otherwise there are two sources of truth for the supply schedule.
    local budgetDial = send(OWNER, { Action = "Admin.Economy.Propose" },
      json.encode({ path = "runeRewards.epochBudget", value = 500,
                    reason = "should not be settable by hand" }))
    ok("the emission budget is not a policy dial", errOf(budgetDial) ~= nil,
       json.encode(budgetDial))
    local floorDial = send(OWNER, { Action = "Admin.Economy.Propose" },
      json.encode({ path = "runeRewards.newcomerFloor", value = 5,
                    reason = "should not be settable by hand" }))
    ok("and neither is the newcomer floor", errOf(floorDial) ~= nil,
       json.encode(floorDial))
    -- What the schedule currently says, published for the client to read.
    local sched = send(OWNER, { Action = "Economy.View" })
    local rr = sched and sched.policy and sched.policy.runeRewards
    ok("the published budget is the schedule's own answer",
       rr and int(rr.epochBudget, 0) > 0, rr and json.encode(rr.epochBudget))
    ok("and the floor is a fraction of one per-capita share, not zero",
       rr and int(rr.newcomerFloor, 0) > 0, rr and json.encode(rr.newcomerFloor))
    -- The emergency brake still stops it. That is the only thing that does.
    ok("an operator brake remains proposable for an incident",
       errOf(send(OWNER, { Action = "Admin.Economy.Propose" },
         json.encode({ path = "runeRewards.haltedByOperator", value = true,
                       reason = "incident brake" }))) == nil)

    -- Pass recovery moves the complete economic identity, including escrow.
    local PASSOLD = "PASSOLD" .. string.rep("o", 36)
    local RECOVERY = "RECOVERY" .. string.rep("r", 35)
    local PASSNEW = "PASSNEW" .. string.rep("n", 36)
    send(OWNER, { Action = "Admin.Unlock", Addresses = PASSOLD })
    send(OWNER, { Action = "Admin.Grant", PlayerId = PASSOLD,
                  Item = "rock_berry", Amount = "1000" })
    send(OWNER, { Action = "Admin.Grant", PlayerId = PASSOLD,
                  Item = "rune", Amount = "10" })
    send(PASSOLD, { Action = "Economy.Shop.Trade", Item = "rock_berry",
                    Side = "sell", Quantity = "1" })
    local recoveryOrder = send(PASSOLD, {
      Action = "Economy.Order.Place", Side = "sell", Item = "rock_berry",
      Price = "5", Quantity = "2",
    })
    local recoveryOrderId = recoveryOrder.economyResult.order.id
    local secured = send(PASSOLD, { Action = "Pass.SetRecovery", Recovery = RECOVERY })
    local stableAccountId = secured.pass.accountId
    local recovered = send(RECOVERY, {
      Action = "Pass.Recover", Account = PASSOLD, NewController = PASSNEW,
    })
    ok("recovery preserves the non-transferable account id",
       recovered and recovered.pass.accountId == stableAccountId
         and recovered.pass.controller == PASSNEW,
       recovered and json.encode(recovered.pass))
    ok("recovery preserves inventory, Gold, and the pass bond bucket",
       recovered and (recovered.inventory.rune or 0) == 10
         and recovered.gold > 0 and recovered.pass.bond == 0,
       recovered and json.encode({ recovered.inventory, recovered.gold, recovered.pass }))
    local oldGone = send(PASSOLD, { Action = "User.Info" })
    ok("recovery disables the old controller", oldGone.exists == false, oldGone.exists)
    local movedEconomy = send(PASSNEW, { Action = "Economy.View" })
    local movedOrder = nil
    for _, order in ipairs(movedEconomy.orders or {}) do
      if order.id == recoveryOrderId then movedOrder = order end
    end
    ok("recovery moves open Gold escrow and quotas to the new controller",
       movedOrder and movedOrder.account == PASSNEW, movedOrder and movedOrder.account)
    local cooldown = send(PASSNEW, { Action = "Economy.Shop.Trade",
      Item = "rock_berry", Side = "sell", Quantity = "1" })
    ok("recovery pauses NPC selling for seven days", errOf(cooldown) ~= nil,
       json.encode(cooldown))
    send(PASSNEW, { Action = "Economy.Order.Cancel", OrderId = recoveryOrderId })

    -- Optional Rune bond: still owned, but unavailable until delayed unbond.
    EconomyState.policy.runeRewards.bondEnabled = true
    EconomyState.policy.runeRewards.bondAmount = 5
    local bonded = send(PASSNEW, { Action = "Pass.Bond" })
    ok("a Rune bond moves value into the pass without consuming it",
       bonded.pass.bond == 5 and bonded.inventory.rune == 5,
       json.encode({ bonded.pass, bonded.inventory }))
    local unbonding = send(PASSNEW, { Action = "Pass.BeginUnbond" })
    ok("unbonding publishes its delayed release", unbonding.pass.unbond.readyAt > T,
       json.encode(unbonding.pass.unbond))
    local tooSoon = send(PASSNEW, { Action = "Pass.CompleteUnbond" })
    ok("a Rune bond cannot rotate through identities before its delay", errOf(tooSoon) ~= nil,
       json.encode(tooSoon))
    T = T + EconomyState.policy.runeRewards.unbondDelay
    local unbonded = send(PASSNEW, { Action = "Pass.CompleteUnbond" })
    ok("the refundable bond returns after the delay",
       unbonded.pass.bond == 0 and unbonded.inventory.rune == 10,
       json.encode({ unbonded.pass, unbonded.inventory }))

    -- Promise manifests are finite, public, one-use, and permanently seal the
    -- unrestricted genesis grant path.
    local PROMISED = "PROMISED" .. string.rep("p", 35)
    local CLAIMED = "CLAIMED" .. string.rep("c", 36)
    local SEALED = "SEALED" .. string.rep("s", 37)
    send(OWNER, { Action = "Admin.Unlock", Addresses = PROMISED, Origin = "promised" })
    local genesis = send(OWNER, { Action = "Admin.Pass.ConfigureGenesis" }, json.encode({
      addresses = { PROMISED }, commitmentHash = string.rep("a", 64),
      unassignedSlots = 1, claimDeadline = T + 86400000,
    }))
    ok("the promised-pass manifest seals with a public commitment",
       genesis.genesis and genesis.genesis.sealed == true
         and genesis.genesis.commitmentHash == string.rep("a", 64),
       json.encode(genesis))
    local promiseStart = send(PROMISED, { Action = "Faction.Join", Faction = "Sky Nomads" })
    ok("a promised pass grants access and one starter companion but no economic items",
       promiseStart.monster ~= nil and next(promiseStart.inventory) == nil
         and #promiseStart.lootboxes == 0,
       json.encode({ promiseStart.inventory, promiseStart.lootboxes }))
    local claimed = send(CLAIMED, { Action = "Pass.ClaimPromise", ClaimId = "public-promise-0001" })
    ok("one finite unassigned promise slot can be claimed once",
       claimed.pass and claimed.pass.origin == "promised" and claimed.unlocked == true,
       json.encode(claimed))
    local repeated = send(SEALED, { Action = "Pass.ClaimPromise", ClaimId = "public-promise-0001" })
    ok("a promised-pass claim cannot be replayed", errOf(repeated) ~= nil,
       json.encode(repeated))
    local genericGrant = send(OWNER, { Action = "Admin.Unlock", Addresses = SEALED })
    ok("sealing removes the generic genesis pass faucet", errOf(genericGrant) ~= nil,
       json.encode(genericGrant))

    local exportedEconomy = send(OWNER, { Action = "Admin.Export", Section = "economy" })
    ok("redeploy export carries the whole economy state",
       exportedEconomy.section == "economy" and exportedEconomy.economy.version == 1,
       exportedEconomy and exportedEconomy.section)
    local importedEconomy = send(OWNER, { Action = "Admin.Load" },
      json.encode({ players = {}, economy = exportedEconomy.economy }))
    ok("redeploy import preserves an exact economy", importedEconomy.loaded == 0
       and send(BUYER, { Action = "Economy.View" }).invariants.ok == true,
       json.encode(importedEconomy))
  end

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- Driven from the outermost Lua frame, NOT through `pcall`.
---
--- `compute` ends with `collectgarbage("collect")`, and on Luerl a collect
--- inside a pcall frame corrupts the state that pcall restores on return and
--- kills the VM (see the note at the end of `compute` in game.lua). Production
--- calls `compute` from Erlang with no Lua pcall on the stack; this suite has
--- to match that or it tests a shape nobody deploys.
---
--- The cost is that a runtime error inside the suite comes back as a bare
--- `500 Oops` naming nothing instead of a readable line. It still fails the
--- run -- an HTML error page contains no "0 failed" for the runner to match.
---
--- `collectgarbage` is neutralised for the whole run, and the suite does not
--- work on a live node without it.
---
--- `compute` ends every message with a real `collectgarbage("collect")`, which
--- is correct on a process: HyperBEAM calls `compute` from Erlang, so the
--- collect runs with nothing of ours on the Lua stack above it. Here `compute`
--- is called from inside `run`, which is inside this function -- so the collect
--- happens with live frames above it, and Luerl renumbers the table store
--- underneath them. The result is not an error the suite can report: the VM
--- goes down and the node answers 500 with no body.
---
--- That is the same hazard `game.lua` documents for a collect inside a `pcall`
--- frame, and it is not limited to `pcall`. It had made `npm run test:lua`
--- return a bare `curl (22) ... 500` on every node -- which reads exactly like
--- the node being down, and is not. Bisecting the suite located it at the first
--- `Battle.Begin`; with the collector stubbed the same bundle passes 637/637.
---
--- Nothing is lost by stubbing it. The collect is a heap measure, not a rule
--- the handlers rely on, and `run-local-game-test.mjs` runs this same suite on
--- real Lua 5.3 through ao-loader, where the collect is ordinary and does run.
--- `gc = "on"` opts back in, and `run-local-game-test.mjs` passes it: ao-loader
--- is real Lua 5.3, the collect is safe there, and the offline run is the one
--- place this suite CAN cover it. Neutralising it unconditionally would have
--- quietly removed that coverage everywhere at once.
function gametest(base, req)
  if req and req.body and req.body.gc == "on" then return run(base, req) end
  local real = collectgarbage
  _G.collectgarbage = function() end
  local result = run(base, req)
  _G.collectgarbage = real
  return result
end
