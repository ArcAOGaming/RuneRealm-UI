--- game.lua — the RuneRealm game process, running natively on ~lua@5.3a.
---
--- Replaces the three legacynet processes (PremPass j7Ncra..., MultiBattle
--- 3ZN5im..., Alter GhNl98...) with one HyperBEAM process. There is no
--- legacynet anywhere in this file: no ao.send to a token, no Credit-Notice,
--- no genesis-wasm.
---
--- Two shape changes forced by the platform:
---
---   * The incoming message is at `req.body`; `req` itself is the Assignment.
---   * There is no `dryrun`. A read is a plain unsigned GET of state this
---     process publishes, so anything the client polls must be written into the
---     result table at the bottom of compute().
---
--- And one forced by the shutdown: every item cost used to be an AO token
--- transfer answered by a Credit-Notice. Those token processes are legacynet
--- and gone, so items live in the player's record here. An activity is now one
--- signed message instead of a transfer plus a notice plus a reply.
---
--- Expected globals, supplied by the bundle that loads this file:
---   C        constants.lua
---   Battle   battle.lua
---   encode   jsonenc.lua's encoder (NOT json.encode: Luerl's %.14g writes
---            every integer as "5001.0000000000")

local json = require(".json")

-- State ---------------------------------------------------------------------
-- Process globals are the database. They survive every message and are lost
-- only on redeploy, which is why deploy-game.mjs re-seeds the paid list.

Players = Players or {}          -- address -> player record
--- Lifetime offerings per faction — the Alter's faction-vs-faction tally.
--- Recovered from the old process: it was 709/1381/620/786 when it stopped.
Offerings = Offerings or {}

--- Who worshipped each day, bucketed by how long their streak was.
---
---   day -> { high = n, medium = n, low = n }
---
--- The old Alter kept this and it is the only engagement history the game has:
--- 131 days survived, 2025-05-03 to 2025-09-13, and the three buckets line up
--- exactly with the three reward tiers. That makes it a retention series rather
--- than a hit counter - how many showed up AND how committed they were.
---
--- Keyed by epoch-day (`timestamp // 86400000`), which is what the old process
--- used, so the recovered days and the new ones are one continuous series.
Checkins = Checkins or {}
Battles = Battles or {}          -- battle id -> battle
BattleSeq = BattleSeq or 0
Owner = Owner or nil

--- Durable operational telemetry. This intentionally stores aggregates rather
--- than a message-by-message history: a public process should expose useful
--- trends without turning every player's activity into a surveillance feed.
--- `daily` is keyed by epoch-day, matching Checkins, and is published through
--- `/now/metrics`. AdminAudit is owner-only and capped below.
Metrics = Metrics or { since = 0, daily = {}, totals = {} }
AdminAudit = AdminAudit or {}
AdminAuditSeq = AdminAuditSeq or 0

-- Minting. A companion leaves the game as a one-unit Arweave asset and comes
-- back the same way. This process cannot do either itself: an asset is a
-- base-layer transaction that costs AR, and a process has no private key and so
-- cannot hold or spend any. What it CAN do is charge for the work, freeze the
-- companion, and publish a queue that a funded off-process worker drains --
-- which is what these four globals are.
MintQueue = MintQueue or {}      -- jobs the worker has not finished
DepositQueue = DepositQueue or {}-- assets a player says they have handed back
MintSeq = MintSeq or 0
MintVault = MintVault or nil     -- the address deposits are sent to

--- Every asset this game has ever minted, by asset id.
---
--- The player record already carries the ones a wallet currently holds, but
--- that is scattered across 168 records and says nothing about a companion
--- somebody has sold. This is the registry: one place that knows what exists,
--- what it was when it was minted, and where it went. It is what a marketplace
--- reads, and it is the only record that survives a companion changing hands.
---
--- Entries are never deleted. An asset is permanent on Arweave; a registry that
--- forgot one would be lying about what this game has published.
Assets = Assets or {}

Battle.configure(C)

-- Small helpers -------------------------------------------------------------

--- Luerl's tonumber returns a float and every tag arrives as a string, so an
--- unnarrowed conversion turns 25 into 25.0 and then serialises it as
--- "25.00000000000". Narrow everything.
local function num(v, default)
  if v == nil then return default end
  local n = tonumber(v)
  if not n then return default end
  return math.tointeger(n) or n
end

local function int(v, default)
  local n = num(v, default)
  return math.tointeger(n) or default
end

--- Split on commas without gmatch("[^,%s]+"), which raises "bad argument" on
--- Luerl. Used for the bulk address import.
local function splitList(s)
  local out = {}
  if type(s) ~= "string" then return out end
  local start = 1
  while true do
    local a, b = string.find(s, ",", start, true)
    local piece = string.sub(s, start, a and (a - 1) or #s)
    piece = string.gsub(piece, "^%s*(.-)%s*$", "%1")
    if piece ~= "" then out[#out + 1] = piece end
    if not a then break end
    start = b + 1
  end
  return out
end

--- The address that signed this message, taken from its commitments.
---
--- This is legacynet's `msg.From` and it is the ONLY unforgeable identity in
--- the system: everything that changes a player's state, and every admin check,
--- rests on it.
---
--- Three things here are load-bearing:
---
---   * A signature commitment is preferred over any other. A HyperBEAM message
---     carries an hmac commitment alongside the real signature, and hmac says
---     nothing about who sent it. hyper-aos filters on `rsa-pss-sha512` for the
---     same reason.
---
---   * ONLY a signature commitment identifies anybody. This used to fall back
---     to any commitment that named a committer, on the reasoning that a
---     committer with no known algorithm beats a tag. It does not. An hmac
---     commitment names whoever it CLAIMS to name, so a message carrying the
---     hmac alone with the owner as its committer was accepted as the owner —
---     `Admin.Unlock` and `Admin.Grant` both, reproduced against this exact
---     file. An earlier fix closed the `Address`-tag half of this and left the
---     commitment half open; the comment here described the closed behaviour
---     while the code below still had the hole.
---
---   * The tag fallback survives only for a message with NO commitments at all,
---     which a scheduler will not accept. It exists so the test suite can drive
---     handlers without signing.
---
--- This fails CLOSED. If a node ever attaches its signature under an algorithm
--- not listed here, every signed action stops working — visibly, on the first
--- message — rather than quietly accepting forgeries. That is the right way
--- around, but it does mean `e2e.mjs` (which signs real ANS-104 items) is the
--- thing to run after any node or scheduler change.
--- The algorithm is spelled `type` on the wire and `alg` in the test harness,
--- and BOTH have to be read. A real commitment from
--- `schedule.forward.computer` carries
---
---   type=rsa-pss-sha512  committer=<address>  keyid=publickey:...
---   type=hmac-sha256     keyid=constant:ao
---
--- and no `alg` field at all. Checking only `alg` therefore identified nobody
--- on a live node: every signed action answered "No signer address", the game
--- was unplayable, and `deploy.mjs` could not even seed the paid list — while
--- the whole suite passed, because game_test.lua writes `alg`. Fails closed
--- either way; it just now fails closed on the right field.
local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }

local function signer(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) == "table" then
    local sawAny = false
    for _, commitment in pairs(c) do
      sawAny = true
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        return commitment.committer
      end
    end
    -- Commitments present, none of them a signature: nobody is identified.
    if sawAny then return nil end
  end
  -- No commitments at all: only reachable from the test harness.
  return msg.Address or msg.From
end

--- The message body. It arrives as `data` on the wire; `Data` is what the test
--- harness and the original handlers spell it.
local function bodyOf(msg)
  local raw = msg.Data or msg.data or msg.body
  if type(raw) ~= "string" then return "" end
  return raw
end

local function isOwner(address)
  return Owner ~= nil and Owner ~= "" and address ~= nil and address == Owner
end

-- Player records ------------------------------------------------------------

local function newPlayer(address, timestamp)
  return {
    address = address,
    -- An open deployment grants access when an account is first materialised.
    -- Closed deployments retain the Eternal Pass allow-list exactly as before.
    unlocked = C.PUBLIC_ACCESS == true,
    faction = nil,
    monster = nil,
    inventory = {},
    lootboxes = {},
    battlesRemaining = 0,
    wins = 0,
    losses = 0,
    questsCompleted = 0,
    -- The Alter's counters: consecutive claims, the best run ever, and the
    -- lifetime number of offerings.
    dailyStreak = 0,
    bestStreak = 0,
    offerings = 0,
    spriteTxId = nil,
    spriteAtlasTxId = nil,
    joinedAt = timestamp or 0,
    lastActiveAt = 0,
    lastAction = nil,
    lastActiveDay = nil,
    activeBattleId = nil,
  }
end

local function getPlayer(address, timestamp)
  if not address then return nil end
  local p = Players[address]
  if not p then
    p = newPlayer(address, timestamp)
    Players[address] = p
  end
  return p
end

local function itemCount(player, item)
  return int(player.inventory[item], 0)
end

local function grant(player, item, amount)
  amount = int(amount, 0)
  if amount == 0 then return end
  local now = itemCount(player, item) + amount
  if now <= 0 then
    player.inventory[item] = nil
  else
    player.inventory[item] = now
  end
end

local function spend(player, item, amount)
  amount = int(amount, 1)
  if itemCount(player, item) < amount then return false end
  grant(player, item, -amount)
  return true
end

local function addLootboxes(player, count, rarity)
  rarity = math.max(1, math.min(C.MAX_LOOT_RARITY, int(rarity, 1)))
  for _ = 1, math.max(0, int(count, 0)) do
    player.lootboxes[#player.lootboxes + 1] = rarity
  end
end

--- Everything the client needs about a player, in one object.
---
--- The active battle rides along on EVERY reply, not just the ones from the
--- Battle.* handlers. It has to: the client keeps the fight in the login reply,
--- so if `User.Login` omits it, a reload — or any refresh — loses the battle,
--- drops the player back to the lobby, and the only way out is a forfeit.
local function playerView(player)
  local v = Battle.clone(player)
  if C.PUBLIC_ACCESS == true then v.unlocked = true end
  if v.monster then
    v.monster.nextLevelExp = C.requiredExp(v.monster.level or 0)
  end
  -- An empty Lua table is ambiguous; the client expects a list here.
  v.lootboxes = v.lootboxes or {}
  v.inventory = v.inventory or {}
  -- Minted companions, keyed by asset id. `jsonObject` because an empty Lua
  -- table encodes as `[]` by default -- the right answer for every list on the
  -- battle view and the wrong one here, where the client indexes by asset id.
  -- A shape that flips from array to object the moment the first mint lands is
  -- the kind of thing that works in every test and breaks on the first player.
  v.assets = jsonObject(v.assets or {})
  -- When the next daily is available, so the client can show a countdown
  -- rather than a button that fails.
  v.dailyReadyAt = int(v.lastDaily, 0) > 0
    and (int(v.lastDaily, 0) + C.DAILY.interval) or 0
  if v.activeBattleId then
    local b = Battles[v.activeBattleId]
    if b and b.status ~= "ended" then
      v.battle = Battle.view(b)
    else
      -- The battle is gone. Say so rather than leaving a dangling id that the
      -- client would use to build a resume screen for nothing.
      v.activeBattleId = nil
    end
  end
  return v
end

-- Monsters ------------------------------------------------------------------

--- Ten points across four stats, floor of one each, cap of five. Same budget
--- as the original but it no longer loops forever when every stat is capped.
local function rollStartingStats()
  local stats = { attack = 1, defense = 1, speed = 1, health = 1 }
  local names = { "attack", "defense", "speed", "health" }
  local remaining = 6
  local guard = 0
  while remaining > 0 and guard < 200 do
    guard = guard + 1
    local pick = names[Battle.rand(1, 4)]
    if stats[pick] < 5 then
      stats[pick] = stats[pick] + 1
      remaining = remaining - 1
    end
  end
  return stats
end

local function createMonster(factionName, timestamp)
  local faction = C.FACTION_BY_NAME[factionName]
  if not faction then return nil end
  local stats = rollStartingStats()
  return {
    name = faction.monster.name,
    image = faction.monster.image,
    sprite = faction.monster.sprite,
    faction = faction.name,
    elementType = faction.element,
    berryItem = faction.berry,
    attack = stats.attack,
    defense = stats.defense,
    speed = stats.speed,
    health = stats.health,
    energy = 50,
    happiness = 50,
    level = 0,
    exp = 0,
    totalTimesFed = 0,
    totalTimesPlay = 0,
    totalTimesQuest = 0,
    moves = Battle.rollMoves(faction.element),
    status = { type = "Home", since = timestamp or 0, until_time = timestamp or 0 },
    bornAt = timestamp or 0,
  }
end

local function isHome(monster) return monster.status.type == "Home" end

-- Reply shaping -------------------------------------------------------------

local function reply(base, value)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  return base
end

local function fail(base, message)
  base.results = { output = { data = encode({ error = message }) } }
  return base
end

--- Every action a player takes on their own account goes through this.
---
--- Only Faction.Join and Monster.Adopt used to check it, which meant
--- `Admin.Lock` did nothing at all: a revoked wallet carried on questing,
--- fighting and opening loot boxes. Revocation has to actually revoke.
local function requireAccess(base, player)
  if not player then return fail(base, "No signer address") end
  -- Persist the grant on the player's first action. If a later deployment
  -- closes registration, people who joined while the gates were open remain
  -- ordinary unlocked players rather than losing their progress.
  if C.PUBLIC_ACCESS == true then player.unlocked = true end
  if not player.unlocked then
    return fail(base, "This wallet does not have an Eternal Pass")
  end
  return nil
end

-- Handlers ------------------------------------------------------------------

local H = {}

--- Read a player. Also the login call: the client sends it first and an empty
--- answer is what routes a wallet to the "no access" screen, so an address on
--- the paid list must resolve here.
--- Read the CALLER's own player. Signer only, deliberately: it used to prefer
--- an `Address` tag, which let anyone read any player's inventory, access flag
--- and battle state by asking for it.
H["User.Info"] = function(base, msg, timestamp)
  local address = signer(msg)
  if not address then return fail(base, "No signer address") end
  local p = Players[address]
  if not p then
    -- Answer with the SAME SHAPE as a real player, just empty. A wallet with no
    -- account is the first thing the client sees, and handing it a three-field
    -- object instead of a player made the header crash on `inventory.rune`
    -- before anything rendered. An unknown player is a player with nothing.
    local blank = playerView(newPlayer(address, timestamp))
    blank.exists = false
    return reply(base, blank)
  end
  local v = playerView(p)
  v.exists = true
  return reply(base, v)
end

H["User.Login"] = H["User.Info"]

--- The four factions with live membership stats. Also published whole, so the
--- faction screen normally costs no signature at all.
local function factionStats()
  local out = {}
  for _, faction in ipairs(C.FACTIONS) do
    local members, monsters, totalLevel = {}, 0, 0
    local fed, played, quested = 0, 0, 0
    for address, p in pairs(Players) do
      if p.faction == faction.name then
        local entry = { id = address, level = 0, timesFed = 0, timesPlay = 0, timesQuest = 0 }
        if p.monster then
          monsters = monsters + 1
          entry.level = p.monster.level or 0
          entry.timesFed = p.monster.totalTimesFed or 0
          entry.timesPlay = p.monster.totalTimesPlay or 0
          entry.timesQuest = p.monster.totalTimesQuest or 0
          totalLevel = totalLevel + entry.level
          fed = fed + entry.timesFed
          played = played + entry.timesPlay
          quested = quested + entry.timesQuest
        end
        entry.wins = p.wins or 0
        members[#members + 1] = entry
      end
    end
    table.sort(members, function(x, y) return x.level > y.level end)
    out[#out + 1] = {
      name = faction.name,
      element = faction.element,
      description = faction.description,
      mascot = faction.mascot,
      berry = faction.berry,
      monsterName = faction.monster.name,
      monsterImage = faction.monster.image,
      memberCount = #members,
      monsterCount = monsters,
      members = members,
      averageLevel = monsters > 0 and (totalLevel / monsters) or 0,
      totalTimesFed = fed,
      totalTimesPlay = played,
      totalTimesQuest = quested,
    }
  end
  return out
end

local function lootboxCounts(player)
  local counts = { 0, 0, 0, 0, 0 }
  for _, rarity in ipairs(player.lootboxes or {}) do
    local r = math.max(1, math.min(C.MAX_LOOT_RARITY, int(rarity, 1)))
    counts[r] = counts[r] + 1
  end
  return counts
end

--- A compact row for the owner console. The full companion stays in the
--- per-address published record; returning it for every player would make one
--- admin reply hundreds of kilobytes larger for no operational benefit.
local function adminPlayerSummary(address, p)
  local m = p.monster
  local assetCount = 0
  for _ in pairs(p.assets or {}) do assetCount = assetCount + 1 end
  return {
    address = address,
    unlocked = p.unlocked == true,
    faction = p.faction,
    name = m and m.name or nil,
    element = m and m.elementType or nil,
    level = m and int(m.level, 0) or 0,
    exp = m and int(m.exp, 0) or 0,
    energy = m and int(m.energy, 0) or 0,
    happiness = m and int(m.happiness, 0) or 0,
    status = m and m.status and m.status.type or "No companion",
    inventory = jsonObject(Battle.clone(p.inventory or {})),
    lootboxes = lootboxCounts(p),
    wins = int(p.wins, 0),
    losses = int(p.losses, 0),
    questsCompleted = int(p.questsCompleted, 0),
    battlesRemaining = int(p.battlesRemaining, 0),
    activeBattleId = p.activeBattleId,
    dailyStreak = int(p.dailyStreak, 0),
    bestStreak = int(p.bestStreak, 0),
    offerings = int(p.offerings, 0),
    lastDaily = int(p.lastDaily, 0),
    joinedAt = int(p.joinedAt, 0),
    lastActiveAt = int(p.lastActiveAt, 0),
    lastAction = p.lastAction,
    assets = assetCount,
  }
end

local function adminFactionStats(timestamp)
  local day = timestamp // 86400000
  local out = {}
  for _, faction in ipairs(C.FACTIONS) do
    local row = {
      name = faction.name,
      element = faction.element,
      members = 0,
      companions = 0,
      totalLevel = 0,
      wins = 0,
      losses = 0,
      quests = 0,
      runes = 0,
      offerings = int(Offerings[faction.name], 0),
      worshipersToday = 0,
      feeds = 0,
      plays = 0,
    }
    for _, p in pairs(Players) do
      if p.faction == faction.name then
        row.members = row.members + 1
        row.wins = row.wins + int(p.wins, 0)
        row.losses = row.losses + int(p.losses, 0)
        row.quests = row.quests + int(p.questsCompleted, 0)
        row.runes = row.runes + itemCount(p, "rune")
        if int(p.lastDaily, 0) // 86400000 == day and int(p.lastDaily, 0) > 0 then
          row.worshipersToday = row.worshipersToday + 1
        end
        if p.monster then
          row.companions = row.companions + 1
          row.totalLevel = row.totalLevel + int(p.monster.level, 0)
          row.feeds = row.feeds + int(p.monster.totalTimesFed, 0)
          row.plays = row.plays + int(p.monster.totalTimesPlay, 0)
        end
      end
    end
    row.averageLevel = row.companions > 0 and row.totalLevel / row.companions or 0
    row.totalLevel = nil
    out[#out + 1] = row
  end
  return out
end

local function activeBattleSummaries()
  local out = {}
  for id, b in pairs(Battles) do
    if b.status ~= "ended" then
      out[#out + 1] = {
        id = id,
        kind = b.kind,
        status = b.status,
        round = int(b.round, 0),
        startedAt = int(b.startedAt, 0),
        challenger = b.challenger and b.challenger.address,
        challengerName = b.challenger and b.challenger.name,
        accepter = b.accepter and b.accepter.address,
        accepterName = b.accepter and b.accepter.name,
        challengeType = b.challengeType,
      }
    end
  end
  table.sort(out, function(a, b)
    if a.startedAt ~= b.startedAt then return a.startedAt > b.startedAt end
    return a.id < b.id
  end)
  return out
end

local function operationalStats(timestamp)
  local stats = {
    players = 0, unlocked = 0, monsters = 0, activeBattles = 0,
    completedBattles = 0, wins = 0, losses = 0, quests = 0,
    runes = 0, lootboxes = 0, offerings = 0, activeToday = 0,
    items = jsonObject({}), mintedAssets = 0,
  }
  for item in pairs(C.ITEMS) do stats.items[item] = 0 end
  for _, p in pairs(Players) do
    stats.players = stats.players + 1
    if p.unlocked then stats.unlocked = stats.unlocked + 1 end
    if p.monster then stats.monsters = stats.monsters + 1 end
    stats.wins = stats.wins + int(p.wins, 0)
    stats.losses = stats.losses + int(p.losses, 0)
    stats.quests = stats.quests + int(p.questsCompleted, 0)
    stats.offerings = stats.offerings + int(p.offerings, 0)
    stats.lootboxes = stats.lootboxes + #(p.lootboxes or {})
    if int(p.lastActiveAt, 0) // 86400000 == timestamp // 86400000
       and int(p.lastActiveAt, 0) > 0 then stats.activeToday = stats.activeToday + 1 end
    for item in pairs(C.ITEMS) do
      local held = itemCount(p, item)
      stats.items[item] = stats.items[item] + held
      if item == "rune" then stats.runes = stats.runes + held end
    end
  end
  for _, b in pairs(Battles) do
    if b.status == "ended" then stats.completedBattles = stats.completedBattles + 1
    else stats.activeBattles = stats.activeBattles + 1 end
  end
  for _ in pairs(Assets) do stats.mintedAssets = stats.mintedAssets + 1 end
  return stats
end

local function metricsView()
  local daily = jsonObject({})
  for day, row in pairs(Metrics.daily or {}) do
    local copy = Battle.clone(row)
    copy.actions = jsonObject(copy.actions or {})
    copy.factions = jsonObject(copy.factions or {})
    daily[tostring(day)] = copy
  end
  return {
    since = int(Metrics.since, 0),
    totals = jsonObject(Battle.clone(Metrics.totals or {})),
    daily = daily,
  }
end

H["Faction.List"] = function(base, msg)
  return reply(base, factionStats())
end

H["Faction.Join"] = function(base, msg, timestamp)
  local address = signer(msg)
  if not address then return fail(base, "No signer address") end
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if p.faction then return fail(base, "You have already sworn to " .. p.faction) end

  local name = msg.Faction
  if not name or not C.FACTION_BY_NAME[name] then
    return fail(base, "Unknown faction '" .. tostring(name) .. "'")
  end
  p.faction = name

  -- A first-time player is handed enough to actually play. Without this a new
  -- member joins, adopts, and immediately cannot feed, quest or fight, which is
  -- exactly how the old build stranded people once the token faucets went away.
  if not p.seeded then
    for item, amount in pairs(C.STARTER_INVENTORY) do grant(p, item, amount) end
    for rarity, count in pairs(C.STARTER_LOOTBOXES) do addLootboxes(p, count, rarity) end
    p.seeded = true
  end

  return reply(base, playerView(p))
end

H["Monster.Adopt"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if not p.faction then return fail(base, "Join a faction before adopting") end
  if p.monster then return fail(base, "You already have a companion") end

  p.monster = createMonster(p.faction, timestamp)
  if not p.monster then return fail(base, "Faction has no companion configured") end
  addLootboxes(p, 3, 1)
  return reply(base, playerView(p))
end

H["Monster.Feed"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion to feed") end
  -- Feeding does not check isHome -- a companion can eat on a quest -- but it
  -- must not eat while it is being minted: the card is composited from the
  -- snapshot taken at request time, and a stat that moves after that is a card
  -- that disagrees with the creature it depicts, permanently.
  if m.status.type == "Minting" then return fail(base, "Your companion is being minted") end
  if m.energy >= C.MAX_ENERGY then return fail(base, "Already at full energy") end

  local item = msg.Item or m.berryItem
  local info = C.ITEMS[item]
  if not info or info.section ~= "berry" then
    return fail(base, "'" .. tostring(item) .. "' is not a berry")
  end
  if not spend(p, item, 1) then return fail(base, "You have no " .. info.name) end

  -- Its own element's berry is worth more, which is the only reason to hold
  -- four kinds rather than eat whatever is nearest.
  local gain = C.ACTIVITIES.feed.energyGain
  if info.element == m.elementType then gain = gain * 2 end
  m.energy = math.min(C.MAX_ENERGY, m.energy + gain)
  m.totalTimesFed = (m.totalTimesFed or 0) + 1
  return reply(base, playerView(p))
end

H["Monster.Play"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end

  local cfg = C.ACTIVITIES.play
  if m.energy < cfg.energyCost then return fail(base, "Not enough energy") end
  -- A companion loaded from a snapshot may have no berry recorded; fall back to
  -- its element's rather than indexing a nil item name.
  local item = m.berryItem
  if not item or not C.ITEMS[item] then
    local faction = C.FACTION_BY_NAME[m.faction or ""]
    item = faction and faction.berry or nil
  end
  if not item then return fail(base, "Your companion has no berry to play with") end
  if not spend(p, item, 1) then return fail(base, "You have no " .. C.ITEMS[item].name) end

  m.energy = m.energy - cfg.energyCost
  m.status = { type = "Play", since = timestamp, until_time = timestamp + cfg.duration }
  return reply(base, playerView(p))
end

H["Monster.Quest"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end

  local cfg = C.ACTIVITIES.quest
  if m.energy < cfg.energyCost then return fail(base, "Not enough energy") end
  if m.happiness < cfg.happinessCost then return fail(base, "Not happy enough") end
  if not spend(p, cfg.cost.item, cfg.cost.amount) then
    return fail(base, "A quest costs " .. cfg.cost.amount .. " " .. C.ITEMS[cfg.cost.item].name)
  end

  m.energy = m.energy - cfg.energyCost
  m.happiness = m.happiness - cfg.happinessCost
  m.status = { type = "Quest", since = timestamp, until_time = timestamp + cfg.duration }
  return reply(base, playerView(p))
end

--- Claim a finished Play or Quest. One handler for both: the original had two
--- near-identical ones and they disagreed about whether to check the clock.
H["Monster.Claim"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end

  local kind = m.status.type
  if kind ~= "Play" and kind ~= "Quest" then
    return fail(base, "Nothing to claim")
  end
  if timestamp < (m.status.until_time or 0) then
    local left = math.ceil(((m.status.until_time or 0) - timestamp) / 1000)
    return fail(base, kind .. " finishes in " .. string.format("%d", left) .. "s")
  end

  local rewards = {}
  if kind == "Play" then
    local gained = C.ACTIVITIES.play.happinessGain
    m.happiness = math.min(C.MAX_HAPPINESS, m.happiness + gained)
    m.totalTimesPlay = (m.totalTimesPlay or 0) + 1
    rewards.happiness = gained
  else
    local cfg = C.ACTIVITIES.quest
    m.exp = (m.exp or 0) + cfg.expGain
    m.totalTimesQuest = (m.totalTimesQuest or 0) + 1
    p.questsCompleted = (p.questsCompleted or 0) + 1
    addLootboxes(p, 1, cfg.lootRarity)
    rewards.exp = cfg.expGain
    rewards.lootbox = cfg.lootRarity
  end

  m.status = { type = "Home", since = timestamp, until_time = timestamp }
  local v = playerView(p)
  v.rewards = rewards
  return reply(base, v)
end

H["Monster.LevelUp"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end
  -- Same reason as Monster.Feed: the snapshot is already queued.
  if m.status.type == "Minting" then return fail(base, "Your companion is being minted") end

  local required = C.requiredExp(m.level or 0)
  if (m.exp or 0) < required then
    return fail(base, "Needs " .. string.format("%d", required) .. " exp to level up")
  end

  local a = int(msg.AttackPoints, 0)
  local d = int(msg.DefensePoints, 0)
  local s = int(msg.SpeedPoints, 0)
  local h = int(msg.HealthPoints, 0)
  local total = a + d + s + h
  local cap = C.LEVEL_UP_MAX_PER_STAT
  if total ~= C.LEVEL_UP_POINTS then
    return fail(base, "Allocate exactly " .. string.format("%d", C.LEVEL_UP_POINTS) .. " points")
  end
  if a < 0 or d < 0 or s < 0 or h < 0 or a > cap or d > cap or s > cap or h > cap then
    return fail(base, "At most " .. string.format("%d", cap) .. " points per stat, none negative")
  end

  m.level = (m.level or 0) + 1
  m.exp = m.exp - required
  m.attack = m.attack + a
  m.defense = m.defense + d
  m.speed = m.speed + s
  m.health = m.health + h
  -- A level-up refreshes the move roster, so a build is not locked to whatever
  -- four moves it happened to roll at adoption.
  if (m.level % 3) == 0 then
    m.moves = Battle.rollMoves(m.elementType)
  end
  return reply(base, playerView(p))
end

--- The daily worship.
---
--- Every other source of Runes is a reward for spending Runes, so the economy
--- is a net sink by design and a player who runs dry would otherwise be stuck
--- with nothing to do and no way back. This is the faucet, and it is keyed on
--- the wallet and the clock rather than on activity, so it cannot be farmed.
--- The player's custom sprite.
---
--- The character creator writes the finished sheet to Arweave and stores the
--- transaction id here. That is the whole of it now: the old `UpdateSprite`
--- forwarded a `Reality.UpdateSpriteTxId` on to the open-world process, and
--- there is nothing left to forward to.
---
--- 85 of these were recovered from the old process's checkpoint and are seeded
--- by the migration, so a returning player keeps the avatar they made.
H["Sprite.Update"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local function transactionId(v)
    return type(v) == "string" and #v == 43 and string.match(v, "^[A-Za-z0-9_-]+$") ~= nil
  end

  local txId = msg.TxId or msg.SpriteTxId
  -- An Arweave transaction id and nothing else. A sprite id that is not one is
  -- an avatar that will never load, and it would be stored forever.
  if not transactionId(txId) then
    return fail(base, "TxId must be a 43-character Arweave transaction id")
  end

  -- The atlas that describes the sheet. Optional, because a sheet with no
  -- atlas still renders as a static image — but they are uploaded together and
  -- a client that sends one should send both.
  local atlasTxId = msg.AtlasTxId or msg.SpriteAtlasTxId
  if atlasTxId ~= nil and not transactionId(atlasTxId) then
    return fail(base, "AtlasTxId must be a 43-character Arweave transaction id")
  end

  p.spriteTxId = txId
  if atlasTxId then p.spriteAtlasTxId = atlasTxId end
  return reply(base, playerView(p))
end

H["Daily.Claim"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local last = int(p.lastDaily, 0)
  local ready = last + C.DAILY.interval
  if last > 0 and timestamp < ready then
    local left = math.ceil((ready - timestamp) / 1000)
    return fail(base, "Next claim in " .. string.format("%d", left) .. "s")
  end

  -- The streak. Continued if this claim lands before the grace window closes,
  -- reset to 1 otherwise — including the very first claim, which is a streak of
  -- one, not zero. The original reset to 1 the same way.
  local previous = int(p.dailyStreak, 0)
  if last > 0 and timestamp < last + C.DAILY.breakAfter then
    p.dailyStreak = previous + 1
  elseif last == 0 and previous > 0 then
    -- A streak loaded from somewhere with no `lastDaily` to measure against.
    -- The legacynet migration deliberately does not carry streaks — those ran
    -- to February and would be broken long before anyone could claim against
    -- them — so this is only reachable via an explicit `Admin.Load`. Honour it
    -- there: if an owner sets a streak by hand, they meant to.
    p.dailyStreak = previous + 1
  else
    p.dailyStreak = 1
  end
  if p.dailyStreak > int(p.bestStreak, 0) then p.bestStreak = p.dailyStreak end

  -- More for turning up repeatedly. Tiers are ordered highest-first so the
  -- first match wins.
  local runes = C.DAILY.runes
  for _, tier in ipairs(C.DAILY.streakTiers or {}) do
    if p.dailyStreak >= tier.streak then runes = tier.runes break end
  end

  p.lastDaily = timestamp
  p.offerings = int(p.offerings, 0) + 1

  -- Bucket this claim by streak, on the day it happened.
  local day = timestamp // 86400000
  local today = Checkins[day]
  if not today then
    today = { high = 0, medium = 0, low = 0 }
    Checkins[day] = today
  end
  local bucket = "low"
  if p.dailyStreak >= 10 then bucket = "high"
  elseif p.dailyStreak >= 3 then bucket = "medium" end
  today[bucket] = int(today[bucket], 0) + 1
  if p.faction then
    Offerings[p.faction] = int(Offerings[p.faction], 0) + 1
  end
  grant(p, "rune", runes)
  addLootboxes(p, C.DAILY.lootboxes, C.DAILY.lootboxRarity)

  local v = playerView(p)
  v.dailyClaimed = {
    runes = runes,
    lootboxRarity = C.DAILY.lootboxRarity,
    streak = p.dailyStreak,
    offerings = p.offerings,
    factionOfferings = p.faction and int(Offerings[p.faction], 0) or 0,
  }
  return reply(base, v)
end

--- Taking Rune out of the game ------------------------------------------------
---
--- Rune is earned here and lives here, as a number in the player's record. The
--- token process is where it becomes transferable, and the two are joined by
--- exactly one rule: **every Rune in circulation was deducted from an in-game
--- balance first.** The game holds the mint, so supply can never exceed what
--- players actually earned.
---
--- A withdrawal is therefore two things that must not come apart: a deduction
--- here, and a mint over there. They cannot be atomic — separate processes,
--- separate slots — so the order is chosen for which failure is survivable:
---
---   deduct first, then ask for the mint.
---
--- If the mint never lands, the player is short until an admin settles it, and
--- the record below says exactly who and how much. The other order — mint
--- first, deduct on confirmation — lets the same Rune be withdrawn twice while
--- the first mint is still in flight, and that is unbacked supply, which is the
--- one thing this design exists to prevent. A recoverable shortfall beats an
--- unrecoverable overissue.
---
--- Every withdrawal gets an id, and it is carried to the token as the mint's
--- reference. That is what makes a re-delivered mint detectable rather than a
--- second helping.

--- The Rune token process. Empty until the owner names it, and withdrawals are
--- refused while it is empty — an unset token is a deploy that is not finished,
--- not a reason to deduct somebody's balance into nowhere.
RuneToken = RuneToken or ""
Withdrawals = Withdrawals or {}
WithdrawSeq = WithdrawSeq or 0

--- The lower bound on a withdrawal.
---
--- Rune does not divide, and a withdrawal costs a scheduler slot on two
--- processes, so a stream of 1-Rune withdrawals is a cheap way to make the
--- queue useless for everyone else. One is still allowed; this is here to be
--- raised if that turns out to matter.
local MIN_WITHDRAW = 1

H["Rune.Withdraw"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  if RuneToken == "" then
    return fail(base, "Withdrawals are not open yet")
  end

  local amount = int(msg.Amount, 0)
  if amount < MIN_WITHDRAW then
    return fail(base, "Withdraw at least " .. string.format("%d", MIN_WITHDRAW) .. " Rune")
  end

  local held = itemCount(p, "rune")
  if held < amount then
    return fail(base, "You hold " .. string.format("%d", held) .. " Rune")
  end

  -- Deduct BEFORE asking for the mint. See the note above: this is the half
  -- that must not be racealbe.
  if not spend(p, "rune", amount) then
    return fail(base, "You hold " .. string.format("%d", held) .. " Rune")
  end

  WithdrawSeq = WithdrawSeq + 1
  local id = "w" .. string.format("%d", WithdrawSeq)
  Withdrawals[id] = {
    id = id,
    address = address,
    amount = amount,
    status = "pending",
    requestedAt = timestamp,
    settledAt = 0,
  }

  local v = playerView(p)
  v.withdrawal = { id = id, amount = amount, status = "pending" }
  base.results = {
    output = { data = encode(v) },
    -- The mint request, in the shape token@1.0 reads it: lowercase action,
    -- `from`/`recipient`/`quantity` in the body. `reference` is this
    -- withdrawal's id, so a mint that arrives twice can be recognised as the
    -- same one rather than paid out again.
    outbox = {
      ["mint"] = {
        target = RuneToken,
        action = "mint",
        -- No `from` field. The token must decide who asked on the basis of
        -- what the node attests about the sender, not a field the message
        -- carries — a self-declared sender is exactly the forgery that
        -- `signer()` above exists to refuse.
        recipient = address,
        quantity = string.format("%d", amount),
        reference = id,
      },
    },
  }
  return base
end

--- What is owed and what has been paid, readable without signing.
H["Rune.Withdrawals"] = function(base, msg)
  local address = signer(msg)
  local mine = {}
  for _, w in pairs(Withdrawals) do
    if w.address == address then mine[#mine + 1] = w end
  end
  table.sort(mine, function(a, b) return a.id < b.id end)
  return reply(base, { withdrawals = mine, token = RuneToken })
end

H["Lootbox.Open"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if #p.lootboxes == 0 then return fail(base, "No loot boxes to open") end

  local wanted = msg.Rarity and int(msg.Rarity, nil) or nil
  local index = nil
  if wanted then
    for i, r in ipairs(p.lootboxes) do
      if r == wanted then index = i break end
    end
    if not index then
      return fail(base, "No tier " .. string.format("%d", wanted) .. " box")
    end
  else
    -- Open the best box on hand rather than whichever happened to be first.
    index = 1
    for i, r in ipairs(p.lootboxes) do
      if r > p.lootboxes[index] then index = i end
    end
  end

  local rarity = table.remove(p.lootboxes, index)
  local multiplier = 1.0 + 0.5 * (rarity - 1)
  local rewards = {}
  for _, entry in ipairs(C.LOOT_TABLE) do
    if rarity >= entry.minBox then
      local chance = math.min(C.LOOT_CHANCE_CAP, math.floor(entry.chance * multiplier))
      if Battle.rand(1, 1000) <= chance then
        local amount = entry.amount
        local swing = Battle.rand(1, 100)
        if swing <= 20 then
          amount = math.max(1, math.floor(amount * 0.5))
        elseif swing >= 80 then
          amount = math.ceil(amount * 1.5)
        end
        grant(p, entry.item, amount)
        rewards[#rewards + 1] = { item = entry.item, name = C.ITEMS[entry.item].name, amount = amount }
      end
    end
  end
  -- A box that rolls nothing feels broken, so the floor is one Rune.
  if #rewards == 0 then
    grant(p, "rune", 1)
    rewards[#rewards + 1] = { item = "rune", name = C.ITEMS.rune.name, amount = 1 }
  end

  local v = playerView(p)
  v.lootResult = { rarity = rarity, rewards = rewards }
  return reply(base, v)
end

-- Combat --------------------------------------------------------------------

local function nextBattleId()
  BattleSeq = BattleSeq + 1
  return string.format("b%d", BattleSeq)
end

--- Pay out a finished battle to both sides.
---
--- Shared by the attack that ends a fight and by a forfeit, because a forfeit
--- has to pay the opponent exactly the same way. It did not, which made
--- quitting strictly better than losing: the winner got no win, no experience,
--- no loot box, and was left pointing at a battle that no longer existed.
---
--- Idempotent: `settled` guards it, so ending the same battle twice cannot
--- award two wins.
function settleBattle(b, timestamp)
  if not b or b.settled then return end
  b.settled = true
  local winnerSide = b.winner

  local function payout(addr, won)
    local other = addr and Players[addr]
    if not other then return end
    other.activeBattleId = nil
    if won then
      other.wins = (other.wins or 0) + 1
      other.sessionWins = (other.sessionWins or 0) + 1
      if other.monster then other.monster.exp = (other.monster.exp or 0) + 2 end
      -- Both kinds award a tier-1 box. A PvP win used to pay tier 3, which two
      -- players trading wins could farm into unlimited Runes — see the loot
      -- table in constants.lua.
      addLootboxes(other, 1, 1)
    else
      other.losses = (other.losses or 0) + 1
      other.sessionLosses = (other.sessionLosses or 0) + 1
      if other.monster then other.monster.exp = (other.monster.exp or 0) + 1 end
    end
    other.battlesRemaining = math.max(0, (other.battlesRemaining or 0) - 1)
    if (other.battlesRemaining or 0) <= 0 and other.monster
       and other.monster.status.type == "Battle" then
      other.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
  end

  if b.challenger then payout(b.challenger.address, winnerSide == "challenger") end
  if b.accepter and b.accepter.address ~= "bot" then
    payout(b.accepter.address, winnerSide == "accepter")
  end
end

--- Buy a run of battles. This is what a Rune is spent on; individual fights
--- inside the session are free, which is what makes a session worth entering.
H["Battle.Begin"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end

  local cfg = C.ACTIVITIES.battle
  if m.energy < cfg.energyCost then return fail(base, "Not enough energy") end
  if m.happiness < cfg.happinessCost then return fail(base, "Not happy enough") end
  if not spend(p, cfg.cost.item, cfg.cost.amount) then
    return fail(base, "Entering the arena costs " .. cfg.cost.amount .. " " .. C.ITEMS[cfg.cost.item].name)
  end

  m.energy = m.energy - cfg.energyCost
  m.happiness = m.happiness - cfg.happinessCost
  m.status = { type = "Battle", since = timestamp, until_time = 0 }
  p.battlesRemaining = C.BATTLES_PER_SESSION
  p.sessionWins = 0
  p.sessionLosses = 0
  return reply(base, playerView(p))
end

--- Leave the arena and go home, whatever is left of the session.
--- Leave the arena.
---
--- Two different things wear this name, and they used to be the same thing to
--- everyone's cost:
---
---   * WITHDRAWING an unaccepted challenge. Nobody has fought, so nothing is
---     forfeit and the session is not spent. Previously this zeroed
---     `battlesRemaining`, which meant posting a challenge nobody took cost you
---     the Rune you had paid — and challenging yourself, which was allowed,
---     left you with no legal move at all except that.
---
---   * FORFEITING a live fight. The opponent has to actually be paid: their
---     win, their experience, their loot box, and their record cleared.
---     Previously the battle was marked ended and the winner named, but
---     `settle` was never called, so the opponent got nothing and was left
---     pointing at a dead battle. Rage-quitting beat losing.
H["Battle.Leave"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m = p.monster
  if not m then return fail(base, "No companion") end

  local withdrawnOnly = false
  if p.activeBattleId then
    local b = Battles[p.activeBattleId]
    if b and b.status == "pending" then
      -- Nobody took it. Nothing to forfeit.
      Battles[p.activeBattleId] = nil
      withdrawnOnly = true
    elseif b and b.status ~= "ended" then
      b.status = "ended"
      local iAmChallenger = b.challenger and b.challenger.address == address
      b.winner = iAmChallenger and "accepter" or "challenger"
      b.forfeited = true
      settleBattle(b, timestamp)
    end
    p.activeBattleId = nil
  end

  if withdrawnOnly then
    local v = playerView(p)
    v.withdrawn = true
    return reply(base, v)
  end

  p.battlesRemaining = 0
  m.status = { type = "Home", since = timestamp, until_time = timestamp }
  return reply(base, playerView(p))
end

local function startable(p)
  if not p.monster then return "No companion" end
  if p.monster.status.type ~= "Battle" then return "Enter the arena first" end
  if (p.battlesRemaining or 0) <= 0 then return "No battles remaining in this session" end
  if p.activeBattleId and Battles[p.activeBattleId]
     and Battles[p.activeBattleId].status ~= "ended" then
    return "You are already in a battle"
  end
  return nil
end

--- Start a fight against the house. Resolves entirely inside this process.
H["Battle.Start"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local blocked = startable(p)
  if blocked then return fail(base, blocked) end

  local difficulty = num(msg.Difficulty, 1.0)
  if difficulty < 0.5 then difficulty = 0.5 end
  if difficulty > 2.0 then difficulty = 2.0 end

  local opponent = Battle.makeOpponent(p.monster.level or 0,
    { difficulty = difficulty, faction = msg.OpponentFaction })
  local id = nextBattleId()
  local b = Battle.new(id, p.monster, address, opponent, "bot",
    { kind = "bot", timestamp = timestamp })
  Battles[id] = b
  p.activeBattleId = id

  local v = playerView(p)
  v.battle = Battle.view(b)
  return reply(base, v)
end

--- Open or targeted challenge against another player.
H["Battle.Challenge"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local blocked = startable(p)
  if blocked then return fail(base, blocked) end

  -- `Opponent`, not `Target`: an ANS-104 data item already carries a
  -- lowercase `target` field holding the process id, and a tag of the same
  -- name is ambiguous once tags become HTTP headers.
  local target = msg.Opponent
  if target and target ~= "OPEN" and target == address then
    return fail(base, "You cannot challenge yourself")
  end
  local id = nextBattleId()
  local b = {
    id = id,
    kind = "pvp",
    status = "pending",
    round = 0,
    turns = {},
    startedAt = timestamp,
    challengeType = (target and target ~= "OPEN") and "TARGETED" or "OPEN",
    targetAccepter = (target and target ~= "OPEN") and target or nil,
    challenger = Battle.combatant(p.monster, "challenger", address),
    challengerAddress = address,
  }
  Battles[id] = b
  p.activeBattleId = id
  local v = playerView(p)
  v.battle = Battle.clone(b)
  return reply(base, v)
end

H["Battle.Accept"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local blocked = startable(p)
  if blocked then return fail(base, blocked) end

  local id = msg.BattleId
  local b = id and Battles[id]
  if not b then
    -- Accepting by challenger address is what the lobby list offers.
    local by = msg.Challenger
    for bid, candidate in pairs(Battles) do
      if candidate.status == "pending" and candidate.challengerAddress == by then
        b, id = candidate, bid
        break
      end
    end
  end
  if not b then return fail(base, "No such open challenge") end
  if b.status ~= "pending" then return fail(base, "That challenge is no longer open") end
  if b.challengerAddress == address then return fail(base, "You cannot accept your own challenge") end
  if b.targetAccepter and b.targetAccepter ~= address then
    return fail(base, "That challenge is for someone else")
  end

  b.accepter = Battle.combatant(p.monster, "accepter", address)
  b.accepterAddress = address
  b.status = "battling"
  b.pendingMoves = {}
  p.activeBattleId = id

  local v = playerView(p)
  v.battle = Battle.view(b)
  return reply(base, v)
end

--- One signed message is one full round.
---
--- Against the house the reply carries the player's swing AND the opponent's
--- answer AND the whole new battle, so there is nothing to poll and no clock to
--- run down. Dumverse's port learned this the hard way: a lazy-tick design
--- polled with an unsigned read, a read schedules nothing, and the fight simply
--- never advanced.
---
--- In PvP the round resolves the moment the second player's move lands, and the
--- waiting player sees it through the published `battle` state for free.
H["Battle.Attack"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local id = msg.BattleId or p.activeBattleId
  local b = id and Battles[id]
  if not b then return fail(base, "Battle not found") end
  if b.status == "ended" then return fail(base, "That battle is over") end
  if b.status ~= "battling" then return fail(base, "That battle has not started") end

  local isChallenger = b.challenger and b.challenger.address == address
  local isAccepter = b.accepter and b.accepter.address == address
  if not isChallenger and not isAccepter then
    return fail(base, "You are not in this battle")
  end

  local me = isChallenger and b.challenger or b.accepter

  -- The round this action was chosen in.
  --
  -- Without it, a message sent for round N that arrives after round N has
  -- already resolved is silently applied to round N+1 — so a double-click picks
  -- your next move for you, and which of the two choices survives is scheduler
  -- order rather than click order. The tag is optional so an older client still
  -- works; when it is present it is enforced.
  local claimedRound = msg.Round and int(msg.Round, nil) or nil
  if claimedRound and claimedRound ~= b.round then
    return fail(base, "That round has already resolved — this is round "
      .. string.format("%d", b.round))
  end

  if b.kind == "bot" then
    local move, why = Battle.selectMove(me, msg.Move)
    if not move then return fail(base, why) end
    local npcMove = Battle.chooseNpcMove(b.accepter, b.challenger)
    Battle.resolveRound(b, move, npcMove)
  else
    b.pendingMoves = b.pendingMoves or {}
    local mine = b.pendingMoves[me.side]

    if mine then
      -- Already committed this round. The move argument is not read at all —
      -- deliberately, so the client does not have to remember and resend a
      -- choice the process refuses to publish back to it.
      --
      -- One commitment per round: overwriting used to be allowed, so a player
      -- who could see the opponent's committed move (which `Battle.view` was
      -- publishing) could keep changing their own until it countered.
      --
      -- Sending again after the deadline is how a stalled fight is forced. An
      -- opponent who closes their laptop used to freeze it outright, and the
      -- player who did move could only forfeit — handing the win and the paid
      -- session to somebody who stopped playing.
      local since = int(b.pendingSince, timestamp)
      if timestamp - since < Battle.TUNING.pvpMoveDeadline then
        local v = playerView(p)
        v.battle = Battle.view(b)
        v.waitingForOpponent = true
        v.canForceAt = since + Battle.TUNING.pvpMoveDeadline
        return reply(base, v)
      end
      local otherSide = me.side == "challenger" and "accepter" or "challenger"
      b.pendingMoves[otherSide] = Battle.hesitate()
      b.forcedRound = true
    else
      local move, why = Battle.selectMove(me, msg.Move)
      if not move then return fail(base, why) end
      b.pendingMoves[me.side] = move
    end

    if not (b.pendingMoves.challenger and b.pendingMoves.accepter) then
      if not b.pendingSince or b.pendingSince == 0 then b.pendingSince = timestamp end
      local v = playerView(p)
      v.battle = Battle.view(b)
      v.waitingForOpponent = true
      v.canForceAt = b.pendingSince + Battle.TUNING.pvpMoveDeadline
      return reply(base, v)
    end
    local cm, am = b.pendingMoves.challenger, b.pendingMoves.accepter
    b.pendingMoves = {}
    b.pendingSince = nil
    Battle.resolveRound(b, cm, am)
  end

  if b.status == "ended" then
    local winnerSide = b.winner
    local iWon = (isChallenger and winnerSide == "challenger")
      or (isAccepter and winnerSide == "accepter")

    settleBattle(b, timestamp)

    local v = playerView(p)
    v.battle = Battle.view(b)
    v.result = iWon and "win" or "loss"
    return reply(base, v)
  end

  local v = playerView(p)
  v.battle = Battle.view(b)
  return reply(base, v)
end

--- Read a battle without signing anything. Also published; this exists so a
--- client can fetch a specific id.
H["Battle.Info"] = function(base, msg)
  local id = msg.BattleId
  local b = id and Battles[id]
  if not b then return fail(base, "Battle not found") end
  return reply(base, Battle.view(b))
end

local function openChallenges()
  local out = {}
  for id, b in pairs(Battles) do
    if b.status == "pending" and b.challengeType == "OPEN" then
      out[#out + 1] = {
        id = id,
        challenger = b.challengerAddress,
        monsterName = b.challenger and b.challenger.name,
        level = b.challenger and b.challenger.level,
        element = b.challenger and b.challenger.elementType,
        startedAt = b.startedAt,
      }
    end
  end
  return out
end

H["Battle.OpenChallenges"] = function(base, msg)
  return reply(base, openChallenges())
end

-- Leaderboard ---------------------------------------------------------------

local function leaderboard(limit)
  local rows = {}
  for address, p in pairs(Players) do
    if p.monster then
      -- The whole companion rides along, moves included.
      --
      -- The board used to carry a name, an element and three numbers, and the
      -- client filled the rest in by reading `player-<address>` once per row —
      -- fifty requests to draw one screen, each one able to sit behind a write
      -- backlog for tens of seconds. This is one blob the client already polls.
      -- It costs about a kilobyte per player in published state; a leaderboard
      -- that renders the instant it arrives is worth it.
      local m = Battle.clone(p.monster)
      m.nextLevelExp = C.requiredExp(m.level or 0)
      rows[#rows + 1] = {
        address = address,
        faction = p.faction,
        name = p.monster.name,
        element = p.monster.elementType,
        level = p.monster.level or 0,
        exp = p.monster.exp or 0,
        wins = p.wins or 0,
        losses = p.losses or 0,
        quests = p.questsCompleted or 0,
        monster = m,
      }
    end
  end
  table.sort(rows, function(x, y)
    if x.level ~= y.level then return x.level > y.level end
    if x.wins ~= y.wins then return x.wins > y.wins end
    return x.address < y.address
  end)
  local out = {}
  for i = 1, math.min(limit or 50, #rows) do out[i] = rows[i] end
  return out
end

H["Leaderboard"] = function(base, msg)
  return reply(base, leaderboard(int(msg.Limit, 50)))
end

H["Stats"] = function(base, msg, timestamp)
  local stats = operationalStats(timestamp)
  -- Keep the original lifetime `battles` field for older clients.
  stats.battles = stats.activeBattles + stats.completedBattles
  stats.owner = Owner
  return reply(base, stats)
end

-- Minting -------------------------------------------------------------------
--
-- The split of trust here is the whole design, so it is worth stating plainly.
--
-- The process owns the GAME facts: whether you have a companion, what its stats
-- are, whether it is busy, and whether you paid. It cannot own the CHAIN facts,
-- because an asset is an Arweave transaction and this process has no wallet.
-- So the two halves meet at a queue: a player signs `Monster.Mint`, which
-- charges runes and freezes the companion; a worker holding a funded key reads
-- the queue with an unsigned GET, composites the card, signs one transaction,
-- and reports back through the owner-only `Admin.Minted`.
--
-- Nothing here trusts the worker with anything it could not already do. It is
-- the process owner, which already means total authority over this state. What
-- the design DOES buy is that a player never needs AR, never signs a
-- transaction, and cannot mint a companion the process does not agree they own.
--
-- Coming back is the mirror, and it is a transfer rather than a burn because
-- the standard has no burn: the write API on these assets is transfer,
-- make-offer, cancel-order and register-interest, nothing else. So a deposit
-- means handing custody to `MintVault` and letting the worker confirm it.

local function removeBySeq(queue, seq)
  for i, job in ipairs(queue) do
    if job.seq == seq then
      table.remove(queue, i)
      return job
    end
  end
  return nil
end

--- Pull the companion out of the game.
---
--- The runes are taken here, before anything is signed, and refunded by
--- `Admin.MintFailed` if the transaction never lands. Charging on success
--- instead would mean the queue could be filled for free, and the worker pays
--- real AR for every job it picks up.
H["Monster.Mint"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end

  local m = p.monster
  if not m then return fail(base, "No companion to mint") end
  if p.mint then return fail(base, "A mint is already in flight") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end

  local cost = C.MINT.cost
  if not spend(p, cost.item, cost.amount) then
    return fail(base, "Minting costs " .. cost.amount .. " runes")
  end

  MintSeq = MintSeq + 1
  -- The queue carries a SNAPSHOT, not a reference. The card is composited from
  -- exactly the record the player paid to mint, so a level-up between the
  -- request and the signature cannot change the picture after the fact.
  MintQueue[#MintQueue + 1] = {
    seq = MintSeq,
    address = address,
    requestedAt = timestamp,
    monster = Battle.clone(m),
  }
  -- Freezing it is what stops the same companion being minted twice, and stops
  -- a quest finishing into a record that no longer exists.
  m.status = { type = "Minting", since = timestamp, until_time = 0 }
  p.mint = { seq = MintSeq, state = "queued", requestedAt = timestamp }
  return reply(base, playerView(p))
end

--- Say that an asset has been handed back to the vault.
---
--- This claims nothing and grants nothing: the process cannot see a transfer,
--- so all it does is put the id somewhere the worker will look. Ownership is
--- settled by the worker reading the asset's own balances, and the companion
--- only returns through `Admin.Deposited`.
H["Monster.Deposit"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end

  local assetId = msg.AssetId
  if type(assetId) ~= "string" or #assetId ~= 43 then
    return fail(base, "AssetId must be an Arweave id")
  end
  p.assets = p.assets or {}
  if not p.assets[assetId] then
    return fail(base, "That asset did not leave this account")
  end
  if p.monster then return fail(base, "Release or mint your companion first") end
  for _, job in ipairs(DepositQueue) do
    if job.assetId == assetId then return fail(base, "Already waiting on that asset") end
  end

  MintSeq = MintSeq + 1
  DepositQueue[#DepositQueue + 1] = {
    seq = MintSeq,
    address = address,
    assetId = assetId,
    requestedAt = timestamp,
  }
  return reply(base, playerView(p))
end

-- Admin ---------------------------------------------------------------------
-- Every one of these asserts the signer is the process owner. The original
-- shipped seven commented-out auth checks and a `Combat.PlayerWon` anyone could
-- call; none of that is carried over.

local function requireOwner(base, msg)
  local address = signer(msg)
  if not isOwner(address) then
    return fail(base, "Not authorised")
  end
  return nil
end

local function forceReleasePlayer(address, timestamp)
  local p = Players[address]
  if not p then return nil, nil, "No such player" end

  local battleId = p.activeBattleId
  local battle = battleId and Battles[battleId] or nil
  local released, seen = {}, {}
  local function release(who)
    if not who or who == "bot" or seen[who] then return end
    seen[who] = true
    local other = Players[who]
    if not other then return end
    other.activeBattleId = nil
    other.battlesRemaining = 0
    if other.monster and other.monster.status
       and other.monster.status.type == "Battle" then
      other.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
    released[#released + 1] = who
  end

  if battle then
    battle.status = "ended"
    battle.adminCancelled = true
    battle.settled = true -- cancellation has no winner and must never pay out
    battle.endedAt = timestamp
    release(battle.challenger and battle.challenger.address)
    release(battle.accepter and battle.accepter.address)
  end
  release(address) -- also repairs a dangling Battle status or battle id
  return released, battleId, nil
end

--- Build the owner console's complete operating picture in one place. Besides
--- answering Admin.Snapshot, successful admin mutations attach this view to
--- their existing reply so the browser can update without a second signature.
local function adminSnapshotView(timestamp)
  local players = {}
  for address, p in pairs(Players) do
    players[#players + 1] = adminPlayerSummary(address, p)
  end
  table.sort(players, function(a, b)
    if a.lastActiveAt ~= b.lastActiveAt then return a.lastActiveAt > b.lastActiveAt end
    return a.address < b.address
  end)

  local audit = {}
  local first = math.max(1, #AdminAudit - 99)
  for i = #AdminAudit, first, -1 do audit[#audit + 1] = Battle.clone(AdminAudit[i]) end

  return {
    generatedAt = timestamp,
    players = players,
    battles = activeBattleSummaries(),
    factions = adminFactionStats(timestamp),
    stats = operationalStats(timestamp),
    metrics = metricsView(),
    audit = audit,
  }
end

--- One signed read for the complete operating picture. Rows are compact and
--- full player records remain addressable through `/now/player-<address>`.
H["Admin.Snapshot"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  return reply(base, adminSnapshotView(timestamp))
end

--- Add or remove an exact amount from one inventory balance. `Admin.Grant`
--- remains for deploy compatibility; this verb is explicit about supporting a
--- negative delta and reports the amount actually applied after the zero floor.
H["Admin.AdjustInventory"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  local item = msg.Item
  if not item or not C.ITEMS[item] then return fail(base, "Unknown item") end
  local delta = int(msg.Delta or msg.Amount, 0)
  if delta == 0 then return fail(base, "Delta must be a non-zero integer") end
  local before = itemCount(p, item)
  grant(p, item, delta)
  local after = itemCount(p, item)
  return reply(base, {
    player = playerView(p), item = item, before = before, after = after,
    requested = delta, applied = after - before,
  })
end

--- Structured full-record edit for the owner console. Every collection is
--- partial except lootboxes: when supplied, its tier counts replace the list.
H["Admin.UpdatePlayer"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end

  local ok, patch = pcall(json.decode, bodyOf(msg) ~= "" and bodyOf(msg) or "{}")
  if not ok or type(patch) ~= "table" then return fail(base, "Body must be a JSON object") end

  if patch.clearBattle then forceReleasePlayer(p.address, timestamp) end

  local account = type(patch.account) == "table" and patch.account or {}
  if account.unlocked ~= nil then p.unlocked = account.unlocked == true end
  for _, field in ipairs({ "wins", "losses", "questsCompleted", "battlesRemaining",
                           "dailyStreak", "bestStreak", "offerings", "lastDaily",
                           "joinedAt" }) do
    if account[field] ~= nil then p[field] = math.max(0, int(account[field], p[field] or 0)) end
  end

  if account.faction ~= nil then
    local nextFaction = tostring(account.faction)
    if nextFaction == "" or nextFaction == "none" then
      if p.monster then return fail(base, "Remove the companion before clearing its faction") end
      p.faction = nil
    elseif not C.FACTION_BY_NAME[nextFaction] then
      return fail(base, "Unknown faction '" .. nextFaction .. "'")
    elseif nextFaction ~= p.faction then
      p.faction = nextFaction
      if p.monster then
        local faction = C.FACTION_BY_NAME[nextFaction]
        p.monster.faction = faction.name
        p.monster.elementType = faction.element
        p.monster.berryItem = faction.berry
        p.monster.name = faction.monster.name
        p.monster.image = faction.monster.image
        p.monster.sprite = faction.monster.sprite
        p.monster.moves = Battle.rollMoves(faction.element)
      end
    end
  end

  if type(patch.inventory) == "table" then
    for item, value in pairs(patch.inventory) do
      if C.ITEMS[item] then
        local amount = math.max(0, int(value, itemCount(p, item)))
        p.inventory[item] = amount > 0 and amount or nil
      end
    end
  end

  if type(patch.lootboxes) == "table" then
    p.lootboxes = {}
    for rarity = 1, C.MAX_LOOT_RARITY do
      local count = math.max(0, int(patch.lootboxes[tostring(rarity)] or patch.lootboxes[rarity], 0))
      addLootboxes(p, count, rarity)
    end
  end

  if patch.createMonster and not p.monster then
    if not p.faction then return fail(base, "Choose a faction before creating a companion") end
    p.monster = createMonster(p.faction, timestamp)
  end

  if type(patch.monster) == "table" then
    local m = p.monster
    if not m then return fail(base, "This player has no companion") end
    local mp = patch.monster
    if mp.name ~= nil then m.name = tostring(mp.name) end
    for _, field in ipairs({ "level", "exp", "totalTimesFed", "totalTimesPlay", "totalTimesQuest" }) do
      if mp[field] ~= nil then m[field] = math.max(0, int(mp[field], m[field] or 0)) end
    end
    for _, field in ipairs({ "attack", "defense", "speed", "health" }) do
      if mp[field] ~= nil then m[field] = math.max(1, int(mp[field], m[field] or 1)) end
    end
    if mp.energy ~= nil then m.energy = math.max(0, math.min(C.MAX_ENERGY, int(mp.energy, m.energy))) end
    if mp.happiness ~= nil then
      m.happiness = math.max(0, math.min(C.MAX_HAPPINESS, int(mp.happiness, m.happiness)))
    end
    if type(mp.status) == "table" then
      local nextType = tostring(mp.status.type or m.status.type or "Home")
      local valid = { Home = true, Play = true, Quest = true, Battle = true, Minting = true }
      if not valid[nextType] then return fail(base, "Unknown companion status") end
      m.status = {
        type = nextType,
        since = int(mp.status.since, m.status.since or timestamp),
        until_time = int(mp.status.until_time, m.status.until_time or timestamp),
      }
    end
    if mp.rerollMoves then m.moves = Battle.rollMoves(m.elementType) end
  end

  return reply(base, playerView(p))
end

H["Admin.ReleaseBattle"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local released, battleId, problem = forceReleasePlayer(msg.PlayerId, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, {
    released = released,
    battleId = battleId,
    player = playerView(Players[msg.PlayerId]),
  })
end

--- Seed the paid list. Addresses come in as a comma-separated tag or as a JSON
--- array in the body, whichever the importer finds easier.
--- Name the token process. Owner only.
--- Adjust every companion at once. Owner only.
---
--- The old process had `AdjustAllMonsters` and it is the tool you want after
--- changing a number in `Battle.TUNING` or `constants.lua`: without it, putting
--- 173 companions back to full energy is 173 signed messages, and a write costs
--- seconds. This is one.
---
--- Every field is optional and they compose. `Energy` and `Happiness` SET a
--- value; `Attack`, `Defense`, `Speed`, `Health` ADD a delta, because that is
--- what a rebalance actually needs — "everyone gets +1 defence", not "everyone
--- is now defence 1". `RerollMoves` gives every companion a fresh roster from
--- the current pools, which is the point of the tool after a move change.
---
--- Refuses to do nothing: a message that names no change is a mistake, and
--- silently reporting success on 173 players would hide it.
H["Admin.AdjustAll"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local setEnergy = msg.Energy ~= nil and int(msg.Energy, 0) or nil
  local setHappiness = msg.Happiness ~= nil and int(msg.Happiness, 0) or nil
  local deltas = {
    attack = int(msg.Attack, 0),
    defense = int(msg.Defense, 0),
    speed = int(msg.Speed, 0),
    health = int(msg.Health, 0),
  }
  local reroll = msg.RerollMoves == "true" or msg.RerollMoves == true
  local anyDelta = deltas.attack ~= 0 or deltas.defense ~= 0
    or deltas.speed ~= 0 or deltas.health ~= 0

  if setEnergy == nil and setHappiness == nil and not anyDelta and not reroll then
    return fail(base, "Nothing to adjust: give Energy, Happiness, " ..
      "Attack/Defense/Speed/Health or RerollMoves")
  end

  local touched, skipped = 0, 0
  for _, p in pairs(Players) do
    local m = p.monster
    if not m then
      skipped = skipped + 1
    else
      if setEnergy then m.energy = math.max(0, math.min(C.MAX_ENERGY, setEnergy)) end
      if setHappiness then
        m.happiness = math.max(0, math.min(C.MAX_HAPPINESS, setHappiness))
      end
      -- A stat may never fall below 1: a companion with 0 attack cannot act,
      -- and a blanket -2 would create a roomful of them.
      for _, stat in ipairs({ "attack", "defense", "speed", "health" }) do
        if deltas[stat] ~= 0 then
          m[stat] = math.max(1, int(m[stat], 1) + deltas[stat])
        end
      end
      if reroll then m.moves = Battle.rollMoves(m.elementType) end
      touched = touched + 1
    end
  end

  return reply(base, {
    adjusted = touched,
    skipped = skipped,
    applied = {
      energy = setEnergy, happiness = setHappiness,
      attack = deltas.attack, defense = deltas.defense,
      speed = deltas.speed, health = deltas.health,
      rerollMoves = reroll,
    },
  })
end

H["Admin.SetRuneToken"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local next = msg.RuneToken or msg.PlayerId
  if type(next) ~= "string" or #next ~= 43 then
    return fail(base, "RuneToken must be a 43-character process id")
  end
  local previous = RuneToken
  RuneToken = next
  return reply(base, { runeToken = RuneToken, previous = previous })
end

--- Close a withdrawal out by hand.
---
--- The mint lands on another process and this one cannot see whether it did.
--- Until the return path exists, settling is an owner action: `done` records
--- that the Rune was minted, `refund` puts it back because it was not. Both are
--- idempotent, because the one thing worse than an unsettled withdrawal is a
--- refund paid twice.
H["Admin.SettleWithdrawal"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local w = Withdrawals[msg.WithdrawalId or ""]
  if not w then return fail(base, "No such withdrawal") end
  if w.status ~= "pending" then
    return reply(base, { withdrawal = w, unchanged = true })
  end

  local outcome = msg.Outcome or "done"
  if outcome == "refund" then
    local p = getPlayer(w.address, timestamp)
    grant(p, "rune", w.amount)
    w.status = "refunded"
  elseif outcome == "done" then
    w.status = "minted"
  else
    return fail(base, "Outcome must be 'done' or 'refund'")
  end
  w.settledAt = timestamp
  return reply(base, { withdrawal = w })
end

H["Admin.Unlock"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local addresses = {}
  if msg.Addresses then addresses = splitList(msg.Addresses) end
  local body = bodyOf(msg)
  if body ~= "" then
    local ok, decoded = pcall(json.decode, body)
    if ok and type(decoded) == "table" then
      local list = decoded.addresses or decoded
      if type(list) == "table" then
        for _, a in ipairs(list) do
          if type(a) == "string" and a ~= "" then addresses[#addresses + 1] = a end
        end
      end
    end
  end

  local added, already = 0, 0
  for _, address in ipairs(addresses) do
    local p = getPlayer(address, timestamp)
    if p.unlocked then
      already = already + 1
    else
      p.unlocked = true
      added = added + 1
    end
  end
  return reply(base, { added = added, alreadyUnlocked = already, total = added + already })
end

H["Admin.Lock"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  p.unlocked = false
  return reply(base, { locked = msg.PlayerId })
end

H["Admin.Grant"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local p = getPlayer(msg.PlayerId, timestamp)
  if not p then return fail(base, "No PlayerId given") end
  local item = msg.Item
  if item and C.ITEMS[item] then
    grant(p, item, int(msg.Amount, 1))
  end
  local boxes = int(msg.Lootboxes, 0)
  if boxes > 0 then addLootboxes(p, boxes, int(msg.Rarity, 1)) end
  return reply(base, playerView(p))
end

H["Admin.SetStats"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local p = Players[msg.PlayerId]
  if not p or not p.monster then return fail(base, "No such player, or no companion") end

  local ok, patch = pcall(json.decode, bodyOf(msg) ~= "" and bodyOf(msg) or "{}")
  if not ok or type(patch) ~= "table" then return fail(base, "Body must be a JSON object") end

  local m = p.monster
  for _, field in ipairs({ "level", "exp", "attack", "defense", "speed", "health" }) do
    if patch[field] ~= nil then m[field] = int(patch[field], m[field]) end
  end
  if patch.energy ~= nil then m.energy = math.min(C.MAX_ENERGY, int(patch.energy, m.energy)) end
  if patch.happiness ~= nil then m.happiness = math.min(C.MAX_HAPPINESS, int(patch.happiness, m.happiness)) end
  if patch.name ~= nil then m.name = tostring(patch.name) end
  -- Partial, like every other field here: omitting `type` keeps the activity
  -- the companion is already on, so a timer can be rewound without also
  -- cancelling the quest attached to it.
  if patch.status ~= nil and type(patch.status) == "table" then
    m.status = {
      type = tostring(patch.status.type or m.status.type or "Home"),
      since = int(patch.status.since, m.status.since),
      until_time = int(patch.status.until_time, m.status.until_time),
    }
  end
  if patch.rerollMoves then m.moves = Battle.rollMoves(m.elementType) end
  return reply(base, playerView(p))
end

H["Admin.RemoveUser"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local target = msg.PlayerId
  if not target or not Players[target] then return fail(base, "No such player") end
  forceReleasePlayer(target, timestamp)
  Players[target] = nil
  return reply(base, { removed = target })
end

--- Read the player table out, a page at a time.
---
--- A redeploy mints a NEW process: state is the process, so everything a player
--- has earned since the last deploy is gone unless it is carried across. This
--- plus `Admin.Load` is that bridge — see `deploy.mjs --migrate-from`.
---
--- Paged because the whole table does not fit in one reply: a player with a
--- companion is a couple of kilobytes, and there are hundreds of them.
--- Addresses are sorted so paging is stable while the process keeps running.
H["Admin.Export"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local addresses = {}
  for address in pairs(Players) do addresses[#addresses + 1] = address end
  table.sort(addresses)

  local offset = math.max(0, int(msg.Offset, 0))
  local limit = math.max(1, math.min(50, int(msg.Limit, 25)))

  local page = {}
  for i = offset + 1, math.min(offset + limit, #addresses) do
    local p = Players[addresses[i]]
    -- The battle is deliberately not carried: a fight in progress cannot
    -- survive a redeploy and pretending otherwise would restore a player into
    -- a battle that does not exist.
    page[#page + 1] = {
      address = p.address,
      unlocked = p.unlocked,
      faction = p.faction,
      dailyStreak = p.dailyStreak,
      bestStreak = p.bestStreak,
      offerings = p.offerings,
      spriteTxId = p.spriteTxId,
      spriteAtlasTxId = p.spriteAtlasTxId,
      monster = p.monster,
      inventory = p.inventory,
      lootboxes = p.lootboxes,
      wins = p.wins,
      losses = p.losses,
      questsCompleted = p.questsCompleted,
      joinedAt = p.joinedAt,
      lastDaily = p.lastDaily,
      lastActiveAt = p.lastActiveAt,
      lastAction = p.lastAction,
      lastActiveDay = p.lastActiveDay,
      seeded = p.seeded,
    }
  end

  local exported = {
    total = #addresses,
    offset = offset,
    count = #page,
    done = (offset + #page) >= #addresses,
    players = page,
  }
  -- Process-wide history rides once, on the first page. A redeploy that carries
  -- players but drops trends is not a state migration.
  if offset == 0 then
    exported.offerings = jsonObject(Battle.clone(Offerings))
    exported.checkins = jsonObject(Battle.clone(Checkins))
    exported.metrics = metricsView()
    exported.audit = Battle.clone(AdminAudit)
  end
  return reply(base, exported)
end

--- Bulk load of whole player records, used by the deploy script to restore a
--- recovered snapshot or to carry a previous deployment across.
H["Admin.Load"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local ok, payload = pcall(json.decode, bodyOf(msg) ~= "" and bodyOf(msg) or "{}")
  if not ok or type(payload) ~= "table" then return fail(base, "Body must be JSON") end
  -- The Alter's faction tally is process-global, not per player, so it rides
  -- alongside the rows rather than inside one. Highest wins, like every other
  -- counter here: a restore must not lower a total.
  -- The recovered daily history. Same rule as everything else: a restore may
  -- not lower a count.
  if type(payload.checkins) == "table" then
    for day, buckets in pairs(payload.checkins) do
      local key = math.tointeger(tonumber(day))
      if key and type(buckets) == "table" then
        local have = Checkins[key] or { high = 0, medium = 0, low = 0 }
        for _, b in ipairs({ "high", "medium", "low" }) do
          have[b] = math.max(int(buckets[b], 0), int(have[b], 0))
        end
        Checkins[key] = have
      end
    end
  end

  if type(payload.offerings) == "table" then
    for faction, count in pairs(payload.offerings) do
      if C.FACTION_BY_NAME[faction] then
        Offerings[faction] = math.max(int(count, 0), int(Offerings[faction], 0))
      end
    end
  end

  if type(payload.metrics) == "table" then
    local incoming = payload.metrics
    local incomingSince = int(incoming.since, 0)
    local knownSince = int(Metrics.since, 0)
    if incomingSince > 0 then
      Metrics.since = knownSince > 0 and math.min(knownSince, incomingSince) or incomingSince
    end
    if type(incoming.totals) == "table" then
      Metrics.totals = Metrics.totals or {}
      for key, value in pairs(incoming.totals) do
        Metrics.totals[key] = math.max(int(Metrics.totals[key], 0), int(value, 0))
      end
    end
    if type(incoming.daily) == "table" then
      Metrics.daily = Metrics.daily or {}
      for rawDay, row in pairs(incoming.daily) do
        local day = math.tointeger(tonumber(rawDay))
        if day and type(row) == "table" then
          local have = Metrics.daily[day] or { actions = {}, factions = {} }
          for key, value in pairs(row) do
            if key == "actions" or key == "factions" then
              have[key] = have[key] or {}
              if type(value) == "table" then
                for nested, count in pairs(value) do
                  have[key][nested] = math.max(int(have[key][nested], 0), int(count, 0))
                end
              end
            elseif type(value) == "number" then
              have[key] = math.max(int(have[key], 0), int(value, 0))
            end
          end
          Metrics.daily[day] = have
        end
      end
    end
  end

  if type(payload.audit) == "table" and #AdminAudit == 0 then
    local first = math.max(1, #payload.audit - 199)
    for i = first, #payload.audit do
      if type(payload.audit[i]) == "table" then
        AdminAudit[#AdminAudit + 1] = payload.audit[i]
        AdminAuditSeq = math.max(AdminAuditSeq, int(payload.audit[i].seq, 0))
      end
    end
  end

  local rows = payload.players or payload
  local loaded = 0
  for _, row in pairs(rows) do
    if type(row) == "table" and type(row.address) == "string" then
      local p = getPlayer(row.address, timestamp)
      p.unlocked = row.unlocked ~= false
      if row.faction and C.FACTION_BY_NAME[row.faction] then p.faction = row.faction end
      if type(row.inventory) == "table" then
        for item, count in pairs(row.inventory) do
          if C.ITEMS[item] then p.inventory[item] = int(count, 0) end
        end
      end
      if type(row.monster) == "table" then
        p.monster = row.monster
        -- Every number arrives from json.decode as a float. Narrow the ones
        -- that are conceptually integers, or a restored companion serialises
        -- as "level":3.0000000000 forever after.
        for _, field in ipairs({ "attack", "defense", "speed", "health", "energy",
                                 "happiness", "level", "exp", "totalTimesFed",
                                 "totalTimesPlay", "totalTimesQuest" }) do
          if p.monster[field] ~= nil then p.monster[field] = int(p.monster[field], 0) end
        end
        if type(p.monster.status) == "table" then
          p.monster.status.since = int(p.monster.status.since, 0)
          p.monster.status.until_time = int(p.monster.status.until_time, 0)
        end
        for _, move in pairs(p.monster.moves or {}) do
          for _, field in ipairs({ "count", "damage", "attack", "speed",
                                   "defense", "health", "rarity" }) do
            if move[field] ~= nil then move[field] = int(move[field], 0) end
          end
        end
        -- A restored companion is never mid-fight: the battle it was in did not
        -- come across, so leaving it "in the arena" would strand it.
        if p.monster.status and p.monster.status.type == "Battle" then
          p.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
        end
      end
      -- Only a row that actually CARRIES loot boxes replaces what is there.
      --
      -- This used to reset unconditionally, and an empty list is exactly what
      -- an account that was minted by `Admin.Unlock` and never played exports.
      -- Loading one of those on top of a restored legacynet player destroyed
      -- their boxes. A restore is not the place to take things away: if the
      -- intent is genuinely to empty somebody, that is `Admin.SetStats`.
      if type(row.lootboxes) == "table" and #row.lootboxes > 0 then
        p.lootboxes = {}
        for _, rarity in ipairs(row.lootboxes) do
          p.lootboxes[#p.lootboxes + 1] =
            math.max(1, math.min(C.MAX_LOOT_RARITY, int(rarity, 1)))
        end
      end

      -- Counters only ever go UP.
      --
      -- Wins, losses and quests are monotonic: they count things that happened,
      -- and nothing that happened can un-happen. Taking the incoming value
      -- unconditionally meant a stub row carrying zeroes erased real history —
      -- 61 recovered players lost quest counts of up to 323 that way, and the
      -- damage compounded because the next redeploy then migrated the zeroes
      -- forward as if they were the truth. Whichever source knows about more
      -- of them is the one telling the truth.
      if type(row.spriteTxId) == "string" and #row.spriteTxId == 43 then
        p.spriteTxId = row.spriteTxId
      end
      if type(row.spriteAtlasTxId) == "string" and #row.spriteAtlasTxId == 43 then
        p.spriteAtlasTxId = row.spriteAtlasTxId
      end
      -- A streak and an offering count are history too: same rule as the rest.
      p.dailyStreak = math.max(int(row.dailyStreak, 0), int(p.dailyStreak, 0))
      p.bestStreak = math.max(int(row.bestStreak, 0), int(p.bestStreak, 0))
      p.offerings = math.max(int(row.offerings, 0), int(p.offerings, 0))
      p.wins = math.max(int(row.wins, 0), int(p.wins, 0))
      p.losses = math.max(int(row.losses, 0), int(p.losses, 0))
      p.questsCompleted = math.max(int(row.questsCompleted, 0), int(p.questsCompleted, 0))

      -- An account is as old as the oldest evidence of it.
      local incomingJoined = int(row.joinedAt, 0)
      local knownJoined = int(p.joinedAt, 0)
      if incomingJoined > 0 and knownJoined > 0 then
        p.joinedAt = math.min(incomingJoined, knownJoined)
      else
        p.joinedAt = math.max(incomingJoined, knownJoined)
        if p.joinedAt == 0 then p.joinedAt = timestamp end
      end
      if row.lastDaily then p.lastDaily = int(row.lastDaily, 0) end
      if row.lastActiveAt then
        local previousActive = int(p.lastActiveAt, 0)
        local incomingActive = int(row.lastActiveAt, 0)
        if incomingActive >= previousActive then
          p.lastActiveAt = incomingActive
          p.lastAction = row.lastAction or p.lastAction
          p.lastActiveDay = int(row.lastActiveDay, incomingActive // 86400000)
        end
      end
      if row.seeded then p.seeded = true end
      p.battlesRemaining = 0
      p.activeBattleId = nil
      loaded = loaded + 1
    end
  end
  return reply(base, { loaded = loaded, players = (function()
    local n = 0
    for _ in pairs(Players) do n = n + 1 end
    return n
  end)() })
end

--- The mint worker reporting a signed transaction.
---
--- Owner-only, like every Admin.*, and that is exactly the trust boundary
--- described above the Mint handler: the worker is the owner. What this asserts
--- instead is CONSISTENCY -- the job has to still be queued, and it has to name
--- the player it was queued for. A replayed or misaddressed report cannot take
--- a second companion.
H["Admin.Minted"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local seq = int(msg.Seq, 0)
  local assetId = msg.AssetId
  if type(assetId) ~= "string" or #assetId ~= 43 then
    return fail(base, "AssetId must be an Arweave id")
  end

  local job = removeBySeq(MintQueue, seq)
  if not job then return fail(base, "No queued mint " .. tostring(seq)) end
  local p = Players[job.address]
  if not p then return fail(base, "No such player") end

  -- The companion leaves the game. The snapshot stays, because it is what a
  -- deposit brings back -- the asset carries a picture, not a stat block, and
  -- re-rolling one from the card would be a different creature.
  p.assets = p.assets or {}
  p.assets[assetId] = {
    assetId = assetId,
    mintedAt = timestamp,
    seq = job.seq,
    monster = job.monster,
  }
  p.monster = nil
  p.mint = nil

  -- The registry entry carries what a listing needs to draw a row without
  -- reading 168 player records: who minted it, what it was, and where it is.
  -- Not the whole monster -- the card image already carries the full creature,
  -- and the player record keeps the snapshot a deposit restores from.
  local m = job.monster
  Assets[assetId] = {
    assetId = assetId,
    minter = job.address,
    holder = job.address,
    state = "minted",
    mintedAt = timestamp,
    seq = job.seq,
    name = m.name,
    element = m.elementType,
    faction = m.faction,
    level = m.level,
    attack = m.attack,
    defense = m.defense,
    speed = m.speed,
    health = m.health,
  }
  return reply(base, playerView(p))
end

--- The mint did not land. Give the runes back and thaw the companion.
H["Admin.MintFailed"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local job = removeBySeq(MintQueue, int(msg.Seq, 0))
  if not job then return fail(base, "No queued mint " .. tostring(msg.Seq)) end
  local p = Players[job.address]
  if not p then return fail(base, "No such player") end

  grant(p, C.MINT.cost.item, C.MINT.cost.amount)
  if p.monster and p.monster.status and p.monster.status.type == "Minting" then
    p.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
  end
  p.mint = nil
  return reply(base, { refunded = job.address, seq = job.seq, reason = msg.Reason or "unknown" })
end

--- The worker confirmed the vault holds the asset. Put the companion back.
H["Admin.Deposited"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local assetId = msg.AssetId
  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  p.assets = p.assets or {}
  local record = p.assets[assetId]
  if not record then return fail(base, "That asset did not leave this account") end
  if p.monster then return fail(base, "Companion slot is occupied") end

  local m = Battle.clone(record.monster)
  -- However long it spent on a marketplace, it comes home rested rather than
  -- frozen mid-quest: the stored status is whatever it held at mint time.
  m.status = { type = "Home", since = timestamp, until_time = timestamp }
  p.monster = m
  p.assets[assetId] = nil
  -- The asset still exists -- the vault holds it now. The registry says so
  -- rather than forgetting it, because a deposited companion can be minted
  -- again and the history of a card matters more than its current row.
  if Assets[assetId] then
    Assets[assetId].state = "returned"
    Assets[assetId].holder = MintVault
    Assets[assetId].returnedAt = timestamp
  end
  removeBySeq(DepositQueue, int(msg.Seq, 0))
  for i = #DepositQueue, 1, -1 do
    if DepositQueue[i].assetId == assetId then table.remove(DepositQueue, i) end
  end
  return reply(base, playerView(p))
end

--- Where deposits are sent. Published so the client never hardcodes a wallet.
---
--- The tag is `Vault`, NOT `Address`, and that is load-bearing: `signer()`
--- falls back to `msg.Address` for a message carrying no commitments, so a
--- handler reading an `Address` TAG is reading the same name the identity path
--- uses. Under the test harness, which identifies the sender exactly that way,
--- an `Address` tag silently REPLACES the signer -- so the owner's own call
--- authenticated as the vault address it was trying to set, and was refused.
--- Every other admin handler here already names its subject `PlayerId`.
H["Admin.SetVault"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local vault = msg.Vault
  if type(vault) ~= "string" or #vault ~= 43 then
    return fail(base, "Vault must be an Arweave address")
  end
  MintVault = vault
  return reply(base, { vault = MintVault })
end

-- Entry point ---------------------------------------------------------------

--- Tag names travel as HTTP headers and headers are lowercased on the wire, so
--- a handler asking for msg.UserId would get nil. Wrap so the capitalised names
--- the handlers use still resolve.
---
--- The envelope's own fields are excluded from that fallback, and this is not a
--- nicety. An ANS-104 data item carries `target` — the process id — so a plain
--- lowercase fallback made `msg.Target` resolve to this process whenever the
--- caller had not sent a Target tag. That silently pointed the per-player
--- publish at a player that does not exist, and every read path that mattered
--- (`player`, `playerid`, `battle`) answered 404 while `factions` and
--- `leaderboard` looked fine.
--- Only fields that would SHADOW a tag a handler actually reads. `data` and
--- `body` are deliberately NOT here: the message body arrives lowercase, and a
--- handler asking for `msg.Data` means exactly that body. Excluding them made
--- Admin.Unlock silently unlock nobody.
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

--- The spawner's address, read off the process definition's own commitment.
--- hyper-aos sets a global Owner inside its compute(), but this file replaces
--- compute() wholesale, so that never runs and the global stays empty.
local function resolveOwner(base)
  -- hyper-aos presets `Owner = Owner or ""` when it loads, and "" is truthy in
  -- Lua, so a bare `if Owner then` here never resolves anything.
  if Owner and Owner ~= "" then return Owner end
  local p = base and (base.process or base.Process)
  if type(p) == "table" then
    local c = p.commitments or p.Commitments
    if type(c) == "table" then
      -- Prefer a real signature, for the same reason `signer` does: `pairs`
      -- order is arbitrary and an hmac commitment names nobody.
      local fallback = nil
      for _, commitment in pairs(c) do
        if type(commitment) == "table" and commitment.committer then
          if SIGNATURE_ALGS[commitment.alg] then
            Owner = commitment.committer
            return Owner
          end
          fallback = fallback or commitment.committer
        end
      end
      if fallback then
        Owner = fallback
        return Owner
      end
    end
  end
  return Owner
end

local TRACKED_MUTATIONS = {
  ["Faction.Join"] = "factionJoins",
  ["Monster.Adopt"] = "adoptions",
  ["Monster.Feed"] = "feeds",
  ["Monster.Play"] = "playsStarted",
  ["Monster.Quest"] = "questsStarted",
  ["Monster.Claim"] = "claims",
  ["Monster.LevelUp"] = "levelUps",
  ["Monster.Mint"] = "mintsRequested",
  ["Monster.Deposit"] = "depositsRequested",
  ["Sprite.Update"] = "spritesUpdated",
  ["Daily.Claim"] = "worshipClaims",
  ["Lootbox.Open"] = "lootboxesOpened",
  ["Rune.Withdraw"] = "withdrawals",
  ["Battle.Begin"] = "arenaEntries",
  ["Battle.Leave"] = "arenaLeaves",
  ["Battle.Start"] = "battlesStarted",
  ["Battle.Challenge"] = "challengesPosted",
  ["Battle.Accept"] = "battlesStarted",
  ["Battle.Attack"] = "roundsPlayed",
  ["Admin.AdjustAll"] = "adminActions",
  ["Admin.SetRuneToken"] = "adminActions",
  ["Admin.SettleWithdrawal"] = "adminActions",
  ["Admin.Unlock"] = "adminActions",
  ["Admin.Lock"] = "adminActions",
  ["Admin.Grant"] = "adminActions",
  ["Admin.SetStats"] = "adminActions",
  ["Admin.AdjustInventory"] = "adminActions",
  ["Admin.UpdatePlayer"] = "adminActions",
  ["Admin.ReleaseBattle"] = "adminActions",
  ["Admin.RemoveUser"] = "adminActions",
  ["Admin.Load"] = "adminActions",
  ["Admin.Minted"] = "adminActions",
  ["Admin.MintFailed"] = "adminActions",
  ["Admin.Deposited"] = "adminActions",
  ["Admin.SetVault"] = "adminActions",
}

local function capturePlayerState(address)
  local p = address and Players[address]
  if not p then return { exists = false, runes = 0, wins = 0, losses = 0, quests = 0 } end
  local battleId = p.activeBattleId
  return {
    exists = true,
    runes = itemCount(p, "rune"),
    wins = int(p.wins, 0),
    losses = int(p.losses, 0),
    quests = int(p.questsCompleted, 0),
    faction = p.faction,
    status = p.monster and p.monster.status and p.monster.status.type or nil,
    battleId = battleId,
    battleStatus = battleId and Battles[battleId] and Battles[battleId].status or nil,
  }
end

local function actionSucceeded(result)
  local output = result and result.results and result.results.output
    and result.results.output.data
  if type(output) ~= "string" then return true end
  local ok, value = pcall(json.decode, output)
  return not (ok and type(value) == "table" and value.error ~= nil)
end

local function auditSummary(action, tags)
  if action == "Admin.AdjustInventory" or action == "Admin.Grant" then
    local amount = tags.Delta or tags.Amount or "0"
    return tostring(tags.Item or "inventory") .. " " .. tostring(amount)
  elseif action == "Admin.ReleaseBattle" then return "Released player from battle"
  elseif action == "Admin.UpdatePlayer" or action == "Admin.SetStats" then return "Player record updated"
  elseif action == "Admin.Lock" then return "Access revoked"
  elseif action == "Admin.Unlock" then return "Access granted"
  elseif action == "Admin.RemoveUser" then return "Player removed"
  elseif action == "Admin.AdjustAll" then return "All companions adjusted"
  elseif action == "Admin.Load" then return "State loaded"
  end
  return action
end

local function recordTelemetry(action, actor, target, before, timestamp, tags)
  local counter = TRACKED_MUTATIONS[action]
  if not counter then return end

  Metrics.since = int(Metrics.since, 0) > 0 and Metrics.since or timestamp
  Metrics.daily = Metrics.daily or {}
  Metrics.totals = Metrics.totals or {}
  local day = timestamp // 86400000
  local today = Metrics.daily[day]
  if not today then
    today = { actions = {}, factions = {} }
    Metrics.daily[day] = today
  end
  today.actions = today.actions or {}
  today.actions[action] = int(today.actions[action], 0) + 1
  today[counter] = int(today[counter], 0) + 1
  Metrics.totals[action] = int(Metrics.totals[action], 0) + 1

  local isAdminAction = string.sub(action, 1, 6) == "Admin."
  local p = target and Players[target]
  if not isAdminAction and p then
    if int(p.lastActiveDay, -1) ~= day then
      today.activePlayers = int(today.activePlayers, 0) + 1
      p.lastActiveDay = day
    end
    p.lastActiveAt = timestamp
    p.lastAction = action
  end

  if action == "Monster.Claim" then
    if before.status == "Quest" then today.questsCompleted = int(today.questsCompleted, 0) + 1
    elseif before.status == "Play" then today.playsCompleted = int(today.playsCompleted, 0) + 1 end
  end

  if before.battleId and before.battleStatus ~= "ended" then
    local battle = Battles[before.battleId]
    if battle and battle.status == "ended" then
      today.battlesCompleted = int(today.battlesCompleted, 0) + 1
    end
  end

  local afterRunes = p and itemCount(p, "rune") or 0
  local runeDelta = afterRunes - int(before.runes, 0)
  if runeDelta > 0 then today.runeAdded = int(today.runeAdded, 0) + runeDelta
  elseif runeDelta < 0 then today.runeRemoved = int(today.runeRemoved, 0) - runeDelta end

  local stats = operationalStats(timestamp)
  today.players = stats.players
  today.unlocked = stats.unlocked
  today.monsters = stats.monsters
  today.runes = stats.runes
  today.lootboxes = stats.lootboxes
  today.activeBattles = stats.activeBattles
  today.wins = stats.wins
  today.losses = stats.losses
  today.quests = stats.quests
  local checkin = Checkins[day] or {}
  today.worshipClaims = int(checkin.high, 0) + int(checkin.medium, 0) + int(checkin.low, 0)
  today.factions = today.factions or {}
  for _, faction in ipairs(adminFactionStats(timestamp)) do
    today.factions[faction.element] = faction.members
  end

  local auditedAdminAction = isAdminAction
    and action ~= "Admin.Snapshot" and action ~= "Admin.Export"
  if auditedAdminAction then
    AdminAuditSeq = AdminAuditSeq + 1
    AdminAudit[#AdminAudit + 1] = {
      seq = AdminAuditSeq,
      timestamp = timestamp,
      actor = actor,
      action = action,
      target = target,
      summary = auditSummary(action, tags),
    }
    if #AdminAudit > 200 then table.remove(AdminAudit, 1) end
  end
end

function compute(base, req, opts)
  resolveOwner(base)

  local msg = (req and req.body) or {}
  local tags = caseInsensitive(msg.Tags or msg)
  local action = tags.Action or tags.action or "none"
  local timestamp = int((req and (req.timestamp or req.Timestamp)) or tags.Timestamp, 0)
  local actor = signer(msg)
  local actionIsAdmin = type(action) == "string" and string.sub(action, 1, 6) == "Admin."
  local target = actionIsAdmin and tags.PlayerId or actor
  local before = capturePlayerState(target)

  -- Seed the RNG from the assignment so recomputing a slot reproduces the same
  -- fight. math.random with an implicit seed would give a different answer every
  -- time the node replays a message, which is not something a game can survive.
  local seed = timestamp
  local id = msg.id or msg.Id or ""
  for i = 1, math.min(#tostring(id), 16) do
    seed = (seed * 31 + string.byte(tostring(id), i)) % 2147483647
  end
  math.randomseed(math.tointeger(seed) or 1)

  local handler = H[action]
  local result
  if not handler then
    local names = {}
    for k in pairs(H) do names[#names + 1] = k end
    table.sort(names)
    result = fail(base, "unknown action '" .. tostring(action) ..
      "'. known: " .. table.concat(names, ", "))
  else
    local ok, out = pcall(function() return handler(base, tags, timestamp) end)
    result = ok and out or fail(base, tostring(out))
  end

  if actionSucceeded(result) then
    recordTelemetry(action, actor, target, before, timestamp, tags)
  end

  -- A successful admin write already proved ownership and already consumed
  -- the one signature that should be necessary for that operation. Include a
  -- fresh console view in the same reply so the page can repaint its roster,
  -- aggregates, battles and audit trail without signing Admin.Snapshot next.
  -- The snapshot and paged export handlers are reads, so embedding another
  -- snapshot there would either recurse or needlessly bloat an export page.
  if actionSucceeded(result) and actionIsAdmin and isOwner(actor)
     and action ~= "Admin.Snapshot" and action ~= "Admin.Export" then
    local output = result and result.results and result.results.output
    local raw = output and output.data
    if type(raw) == "string" then
      local ok, value = pcall(json.decode, raw)
      if ok and type(value) == "table" then
        value.adminSnapshot = adminSnapshotView(timestamp)
        output.data = encode(value)
      end
    end
  end

  -- Published state: the read path.
  --
  -- There is no dryrun on HyperBEAM, so anything the client polls has to be
  -- written here and fetched with an unsigned GET of
  --   /<pid>~process@1.0/now/<key>
  -- Keys are flat strings, because a numerically-keyed submessage does not
  -- survive as an HTTP path.

  -- Whoever this message touched, so the client can read back its own player
  -- without a second round trip. The signer comes first: it is the only value
  -- here that cannot be spoofed by a tag.
  -- An admin action publishes the player it acted ON. Preferring the signer
  -- broke the moment the owner had a player record of their own — which they do
  -- as soon as they join a faction — after which every Admin.Grant silently
  -- published the owner instead of the target.
  local touched = actor
  local isAdminAction = type(action) == "string" and string.sub(action, 1, 6) == "Admin."
  if isAdminAction and isOwner(touched) then
    local target = tags.PlayerId
    if target and Players[target] then touched = target end
  end
  if touched and Players[touched] then
    result.player = encode(playerView(Players[touched]))
    result.playerid = touched
  end

  -- The SAME record, addressed by wallet: `/now/player-<address>`.
  --
  -- `player` alone is the last player the process computed, which is whoever
  -- happened to message it most recently — so the only way for a returning
  -- wallet to read its own account was `User.Login`, a signed write. That put a
  -- wallet prompt in front of merely looking at the game. Keyed by address it
  -- is a plain unsigned GET, and signing is back to meaning "I am doing
  -- something".
  --
  -- `result` IS `base`: keys written here survive into the next slot, so each
  -- wallet's key only has to be rewritten when that wallet changes. The whole
  -- table is 173 records and about 150 KB; writing all of it on every message
  -- would be the wrong trade for a value almost nobody read.
  --
  -- The exposure is the same data the signed handler already returned, now
  -- readable by anyone holding the address. `factions` and `leaderboard`
  -- already publish per-address rows; this adds the inventory and the
  -- companion's stats to what is public. That is the price of viewing without
  -- signing and it is deliberate.
  local function publishPlayer(address)
    local p = address and Players[address]
    -- A removed player publishes the four bytes "null", not nil and not "".
    -- Dropping the key from the returned state is not guaranteed to clear what
    -- the previous slot wrote, and an EMPTY value is worse than either: the
    -- node answers that request with its own HTML landing page, at status 200.
    -- The client survives it — the JSON parse fails and it reads as absent —
    -- but only by accident, and "null" says the thing outright.
    result["player-" .. tostring(address)] = p and encode(playerView(p)) or "null"
  end

  if touched and Players[touched] then publishPlayer(touched) end

  -- The battle the caller is in, so a PvP opponent sees the round land without
  -- signing anything.
  if touched and Players[touched] and Players[touched].activeBattleId then
    local b = Battles[Players[touched].activeBattleId]
    if b then
      result.battle = encode(Battle.view(b))
      result.battleid = b.id
      -- Republish the OPPONENT too. A round changes both records but only the
      -- attacker signed, so without this the waiting player polls their own key
      -- and watches a fight they are losing stay frozen.
      local other = (b.challenger and b.challenger.address == touched)
        and (b.accepter and b.accepter.address)
        or (b.challenger and b.challenger.address)
      if other and other ~= touched then publishPlayer(other) end
    end
  end

  -- A bulk admin action changes players this message never touched: a deploy
  -- seeds the paid list through `Admin.Unlock` and carries the previous
  -- deployment across through `Admin.Load`, and every one of those wallets
  -- needs a key before its owner can see anything. Rewriting the whole table is
  -- affordable here precisely because it only happens on an admin message.
  local adminMutatesPlayers = isAdminAction
    and action ~= "Admin.Snapshot" and action ~= "Admin.Export"
  if adminMutatesPlayers then
    local removed = tags.PlayerId
    if removed and not Players[removed] then publishPlayer(removed) end
    for addr in pairs(Players) do publishPlayer(addr) end
  end

  -- Small, always-current, and read by screens that should cost nothing.
  -- The Alter's faction tally, readable by anyone. This was a standing
  -- competition between the four factions in the old game and there is no
  -- reason it should need a wallet to look at.
  result.offerings = encode(Offerings)
  result.checkins = encode(Checkins)
  result.metrics = encode(metricsView())
  result.factions = encode(factionStats())
  result.leaderboard = encode(leaderboard(50))
  -- `tuning` is here so the client never has to hardcode a combat constant.
  -- It was doing exactly that, and the numbers on screen had drifted from the
  -- numbers the engine used.
  result.catalog = encode({
    items = C.ITEMS,
    activities = C.ACTIVITIES,
    elements = C.ELEMENTS,
    tuning = Battle.TUNING,
    effectiveness = C.EFFECTIVENESS,
  })
  result.challenges = encode(openChallenges())
  -- Published independently so the client never has to trust a frontend-only
  -- flag. A build can say the gates are open, but only this process decides
  -- whether a signed action is admitted.
  result.access = encode({ publicAccess = C.PUBLIC_ACCESS == true })

  -- The token this game mints into, as a key of its own.
  --
  -- A deploy used to confirm `Admin.SetRuneToken` by reading
  -- `now/results/output/data`, which is whoever computed LAST — so a concurrent
  -- Admin.Load answered for it and the wiring looked done when it was not.
  -- A dedicated key belongs to this value alone and cannot be another
  -- message's reply.
  result.runetoken = RuneToken

  -- The mint pipeline's read path.
  --
  -- The worker holds a funded key and no other privilege it needs at read time:
  -- it drains these two queues with plain unsigned GETs of
  --   /<pid>~process@1.0/now/mintqueue
  --   /<pid>~process@1.0/now/depositqueue
  -- and only signs when it reports back. `mintvault` is published for the same
  -- reason the catalog is: a client that hardcodes the address it sends an
  -- asset to will send one to the wrong wallet the first time the key rotates,
  -- and that asset is not coming back.
  result.mintqueue = encode(MintQueue)
  result.depositqueue = encode(DepositQueue)
  result.mintvault = MintVault or "null"
  result.mintcost = string.format("%d", C.MINT.cost.amount)

  -- The registry, whole, as one unsigned GET. Keyed by asset id, so it is a
  -- jsonObject: empty encodes as `[]` otherwise and a client indexing by id
  -- would break on the day before the first mint and work ever after.
  --
  -- It is published in full on every message, which is affordable while this
  -- is hundreds of entries and will not be at tens of thousands -- the same
  -- trade `player-<address>` already makes, and the same fix applies when it
  -- stops being affordable: publish per-asset keys and a count.
  local assetCount = 0
  for _ in pairs(Assets) do assetCount = assetCount + 1 end
  result.assets = encode(jsonObject(Assets))
  result.assetcount = string.format("%d", assetCount)

  local playerCount = 0
  for _ in pairs(Players) do playerCount = playerCount + 1 end
  result.users = string.format("%d", playerCount)

  -- Always publish the action, even on failure. Without it the client waits out
  -- its whole timeout on a typo instead of seeing the error in about a second.
  result.action = action
  return result
end
