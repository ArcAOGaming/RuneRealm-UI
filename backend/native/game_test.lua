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

  --- Drive compute() the way HyperBEAM does. `from` becomes the signer.
  local function send(from, tags, data)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
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
    local res = compute({ process = PROCESS }, { body = {
      Address = OWNER, Action = "Admin.Unlock",
      data = json.encode({ addresses = { "DAVEddddddddddddddddddddddddddddddddddddddd" } }),
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("Admin.Unlock reads a lowercase body", decoded and decoded.added == 1, json.encode(decoded))
  end

  -- No handler may read a tag called `Target`: the ANS-104 envelope already has
  -- a lowercase `target` holding the process id, so such a tag is ambiguous by
  -- the time it reaches here. This asserts an admin action cannot be aimed by
  -- it.
  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      Address = OWNER, Action = "Admin.Grant", target = ALICE,
      Item = "rune", Amount = "999",
    }, timestamp = T }, {})
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
  ok("joining seeds a starter inventory", r and (r.inventory.rune or 0) >= 3, r and json.encode(r.inventory))
  ok("joining seeds starter loot boxes", r and #r.lootboxes == 3, r and #r.lootboxes)

  r = send(ALICE, { Action = "Faction.Join", Faction = "Sky Nomads" })
  ok("cannot switch faction", errOf(r) ~= nil, r)

  -- Companion ---------------------------------------------------------------

  r = send(BOB, { Action = "Monster.Adopt" })
  ok("cannot adopt without a faction", errOf(r) ~= nil, r)

  r = send(ALICE, { Action = "Monster.Adopt" })
  ok("alice adopts", r and r.monster ~= nil, errOf(r))
  ok("companion matches faction element", r and r.monster.elementType == "fire", r and r.monster.elementType)
  ok("companion starts at home", r and r.monster.status.type == "Home", r and r.monster.status.type)
  ok("adoption grants loot boxes", r and #r.lootboxes == 6, r and #r.lootboxes)

  local moveCount = 0
  for _ in pairs(r.monster.moves) do moveCount = moveCount + 1 end
  ok("companion has 4 moves", moveCount == 4, moveCount)

  r = send(ALICE, { Action = "Monster.Adopt" })
  ok("cannot adopt twice", errOf(r) ~= nil, r)

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
  ok("compute publishes `player`", res.player ~= nil)
  ok("compute publishes `playerid`", res.playerid == ALICE, res.playerid)
  ok("compute publishes `factions`", res.factions ~= nil)
  ok("compute publishes `leaderboard`", res.leaderboard ~= nil)
  ok("compute publishes `action`", res.action == "User.Info", res.action)
  ok("compute publishes a player count", res.users ~= nil, res.users)
  ok("compute publishes the open challenges", res.challenges ~= nil)
  ok("compute publishes the combat tuning", res.catalog ~= nil
     and string.find(res.catalog, "hpPerHealth") ~= nil,
     res.catalog and string.sub(res.catalog, 1, 60))

  -- An ANS-104 data item carries a lowercase `target` field holding the process
  -- id. If the tag lookup falls back to it, `player` and `battle` are published
  -- for a player that does not exist and every per-player read answers 404.
  do
    T = T + 1000
    local body = { Address = ALICE, Action = "User.Info", target = "THE-PROCESS-ID" }
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    ok("the envelope's `target` does not hijack the publish", res.playerid == ALICE, res.playerid)
    ok("the envelope's `target` does not leak into msg.Target",
       res.player ~= nil and string.find(res.player, "THE%-PROCESS%-ID") == nil)
  end

  local _, bad = send(ALICE, { Action = "Totally.Bogus" })
  ok("an unknown action still publishes its action", bad.action == "Totally.Bogus", bad.action)

  -- Integers must not serialise as 5001.0000000000; that is the Luerl %g bug
  -- the whole jsonenc.lua exists to route around.
  ok("published integers are not float-formatted",
     string.find(res.player, "%.0000") == nil, string.sub(res.player, 1, 120))

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
      local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
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
    for _, tags in ipairs(admins) do
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
    for _, action in ipairs({ "Monster.Feed", "Monster.Play", "Monster.Quest",
                             "Lootbox.Open", "Battle.Begin", "Daily.Claim" }) do
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
    ok("the daily can be claimed", (claimed.inventory.rune or 0) > runes,
       errOf(claimed) or claimed.inventory.rune)
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
    send(OWNER, { Action = "Admin.RemoveUser", PlayerId = ALICE })
    local gone = send(ALICE, { Action = "User.Info" })
    ok("the player can be removed", gone.exists == false, tostring(gone.exists))

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
    local body = { Address = ALICE, Action = "Faction.List" }
    local first = compute({ process = PROCESS }, { body = body, timestamp = 1700009999000 }, {})
    local second = compute({ process = PROCESS }, { body = body, timestamp = 1700009999000 }, {})
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
    local res = compute({ process = PROCESS }, { body = {
      Address = WREN, Action = "Rune.Withdraw", Amount = "10",
    }, timestamp = T }, {})
    local decoded = json.decode(res.results.output.data)
    ok("a withdrawal succeeds", decoded and decoded.error == nil, json.encode(decoded))
    ok("and deducts the in-game balance",
       ((decoded.inventory or {}).rune or 0) == heldBefore - 10, (decoded.inventory or {}).rune)

    local mint = res.results.outbox and res.results.outbox["mint"]
    ok("a mint is asked for", mint ~= nil, mint and json.encode(mint))
    ok("aimed at the token", mint and mint.target == TOKEN, mint and mint.target)
    ok("in the shape token@1.0 reads", mint and mint.action == "mint"
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

    r = send(OWNER, { Action = "Admin.SettleWithdrawal", WithdrawalId = wid, Outcome = "refund" })
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
    send(MINA, { Action = "Monster.Adopt" })
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
  end

  -- The Alter: the streak is the mechanic ---------------------------------------
  do
    local PILGRIM = "PILGRIMppppppppppppppppppppppppppppppppppp"
    send(OWNER, { Action = "Admin.Unlock", Addresses = PILGRIM })
    send(PILGRIM, { Action = "Faction.Join", Faction = "Sky Nomads" })

    local r = send(PILGRIM, { Action = "Daily.Claim" })
    ok("a first claim is a streak of one", r.dailyClaimed.streak == 1, json.encode(r.dailyClaimed))
    ok("and pays the base rate", r.dailyClaimed.runes == 1, r.dailyClaimed.runes)
    ok("and counts as an offering", r.dailyClaimed.offerings == 1, r.dailyClaimed.offerings)
    ok("and is tallied to the faction", r.dailyClaimed.factionOfferings >= 1,
       r.dailyClaimed.factionOfferings)

    r = send(PILGRIM, { Action = "Daily.Claim" })
    ok("claiming twice in a row is refused", errOf(r) ~= nil, json.encode(r))

    -- Walk forward one interval at a time and watch the streak pay more.
    local paid = {}
    for day = 2, 11 do
      T = T + C.DAILY.interval
      local res = compute({ process = PROCESS }, { body = {
        Address = PILGRIM, Action = "Daily.Claim",
      }, timestamp = T }, {})
      local d = json.decode(res.results.output.data)
      paid[day] = d.dailyClaimed
    end
    ok("a streak of 3 pays double", paid[3].runes == 2, paid[3] and paid[3].runes)
    ok("a streak of 10 pays triple", paid[10].runes == 3, paid[10] and paid[10].runes)
    ok("the streak keeps counting", paid[11].streak == 11, paid[11] and paid[11].streak)
    ok("offerings accumulate", paid[11].offerings == 11, paid[11] and paid[11].offerings)

    -- Miss the window entirely and it is gone.
    T = T + (C.DAILY.breakAfter * 2)
    local res = compute({ process = PROCESS }, { body = {
      Address = PILGRIM, Action = "Daily.Claim",
    }, timestamp = T }, {})
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
    local back = json.decode(compute({ process = PROCESS }, { body = {
      Address = RETURNED, Action = "Daily.Claim",
    }, timestamp = T }, {}).results.output.data)
    ok("a restored streak carries on instead of resetting",
       back.dailyClaimed.streak == 16, back.dailyClaimed.streak)
    ok("and pays at its tier", back.dailyClaimed.runes == 3, back.dailyClaimed.runes)
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
    local n, damaging = 0, false
    for _, mv in pairs(after.monster.moves) do
      n = n + 1
      if (mv.damage or 0) > 0 then damaging = true end
    end
    ok("a reroll gives a legal roster", n == 4 and damaging, n .. " moves")
  end

  -- The character creator's sprite --------------------------------------------
  do
    local SPRITE = "SPRITEsssssssssssssssssssssssssssssssssssss"
    local ATLAS = "ATLASaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local r = send(ALICE, { Action = "Sprite.Update", TxId = SPRITE, AtlasTxId = ATLAS })
    ok("a player sets their own sprite", r.spriteTxId == SPRITE, json.encode(r.spriteTxId))
    ok("and the atlas that describes it", r.spriteAtlasTxId == ATLAS, json.encode(r.spriteAtlasTxId))

    r = send(ALICE, { Action = "Sprite.Update", TxId = SPRITE, AtlasTxId = "nope" })
    ok("a malformed atlas id is refused", errOf(r) ~= nil, json.encode(r))

    for _, bad in ipairs({ "short", "", "not a tx id at all!!!" }) do
      r = send(ALICE, { Action = "Sprite.Update", TxId = bad })
      ok("a sprite id that is not a transaction is refused ('" .. bad .. "')",
         errOf(r) ~= nil, json.encode(r))
    end
    local still = send(ALICE, { Action = "User.Info" })
    ok("and a refused update leaves the old one alone",
       still.spriteTxId == SPRITE, still.spriteTxId)

    r = send("LOCKEDlllllllllllllllllllllllllllllllllllll", { Action = "Sprite.Update", TxId = SPRITE })
    ok("a locked wallet cannot set one", errOf(r) ~= nil, json.encode(r))

    -- Recovered from the old process and restored with everything else.
    local RETURNING = "RETURNINGrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"
    send(OWNER, { Action = "Admin.Load" }, json.encode({ players = { {
      address = RETURNING, unlocked = true, spriteTxId = SPRITE,
    } } }))
    local back = send(RETURNING, { Action = "User.Info" })
    ok("a recovered sprite comes back with the player", back.spriteTxId == SPRITE,
       back.spriteTxId)
  end

  -- Daily worship history, the one engagement series the game has ------------
  do
    local WATCHER = "WATCHERwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"
    send(OWNER, { Action = "Admin.Unlock", Addresses = WATCHER })
    send(WATCHER, { Action = "Faction.Join", Faction = "Aqua Guardians" })

    T = T + C.DAILY.interval
    local res = compute({ process = PROCESS }, { body = {
      Address = WATCHER, Action = "Daily.Claim",
    }, timestamp = T }, {})
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

  -- Shield regeneration must never outrun the damage floor, or the above is
  -- unreachable rather than merely slow.
  ok("shield regen cannot exceed a bare struggle",
     math.max(0, Battle.TUNING.struggleDamage * (Battle.TUNING.attackBase + 1) - 1) >= 1)

  -- Public deployment mode --------------------------------------------------
  -- Toggle only after every closed-access assertion above has run. The same
  -- handlers ship in both modes; deploy.mjs changes this one constant in the
  -- assembled bundle.
  do
    local OPEN = "OPENooooooooooooooooooooooooooooooooooooooo"
    C.PUBLIC_ACCESS = true
    local joined, state = send(OPEN, { Action = "Faction.Join", Faction = "Sky Nomads" })
    ok("public access lets an unknown wallet join", joined and joined.faction == "Sky Nomads",
       errOf(joined))
    ok("public access persists the wallet grant", joined and joined.unlocked == true,
       joined and json.encode(joined))
    local access = json.decode(state.access)
    ok("public access mode is published", access and access.publicAccess == true,
       state.access)
    C.PUBLIC_ACCESS = false
  end

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- A runtime error inside the suite comes back from the node as a bare
--- `500 Oops` naming nothing, so catch it here and report it as a line of
--- output like any other failure.
function gametest(base, req)
  local ok, res = pcall(run, base, req)
  if ok then return res end
  return "ERROR: " .. tostring(res)
end
