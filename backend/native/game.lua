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
--- How many fights have FINISHED, ever.
---
--- `Battles` used to be the answer to this, because nothing was ever removed
--- from it. It is now pruned (see `pruneBattles`), so the count has to be kept
--- rather than derived -- and it is monotonic, so a restore takes the max like
--- every other lifetime counter here.
BattlesCompleted = BattlesCompleted or 0
Owner = Owner or nil

--- Optional Phase-1 bot battle fleet. The deployment bundle supplies both
--- globals from one validated, immutable manifest. Missing/disabled config is
--- deliberately the old monolith: no reservation state is created and every
--- existing Battle.* handler behaves exactly as it did before the fleet code
--- existed.
local FLEET_PROTOCOL = "runerealm-battle-fleet/1"
local FLEET_AUTHORITY = BattleFleetAuthority
local FLEET_CAPABLE = type(FLEET_AUTHORITY) == "table"
  and FLEET_AUTHORITY.PROTOCOL == FLEET_PROTOCOL
  and ((type(BattleFleetBootstrapConfig) == "table"
      and BattleFleetBootstrapConfig.enabled == true)
    or type(BattleFleetConfig) == "table"
    or type(BattleFleetSealedConfig) == "table")

local function normalizeFleetConfig(raw)
  if not FLEET_CAPABLE or type(raw) ~= "table" or raw.enabled ~= true
     or raw.protocol ~= FLEET_PROTOCOL or raw.managerMode ~= "assign-only"
     or type(raw.node) ~= "string" or not string.match(raw.node, "^https?://")
     or type(raw.workers) ~= "table" or #raw.workers < 1 or #raw.workers > 64 then
    return nil, "Malformed battle fleet manifest"
  end
  local workerIds, processIds, workers = {}, {}, {}
  for index, worker in ipairs(raw.workers) do
    if type(worker) ~= "table" or type(worker.workerId) ~= "string"
       or #worker.workerId < 1 or #worker.workerId > 96
       or string.find(worker.workerId, "[^%w_%-]", 1)
       or (worker.runtime ~= "lua@5.3a" and worker.runtime ~= "rust-wasm@1")
       or (worker.runtime == "rust-wasm@1" and (
         type(worker.imageId) ~= "string" or #worker.imageId ~= 43
         or string.find(worker.imageId, "[^%w_%-]", 1)
         or worker.abi ~= "hyperbeam-json-iface-cstr/1"
         or worker.clockMode ~= "trusted-game-clock-v1"))
       or type(worker.workerProcessId) ~= "string" or #worker.workerProcessId ~= 43
       or string.find(worker.workerProcessId, "[^%w_%-]", 1)
       or worker.lifecycle ~= "ready"
       or workerIds[worker.workerId] or processIds[worker.workerProcessId] then
      return nil, "Malformed battle fleet worker at index " .. tostring(index)
    end
    workerIds[worker.workerId], processIds[worker.workerProcessId] = true, true
    workers[#workers + 1] = {
      workerId = worker.workerId, workerProcessId = worker.workerProcessId,
      runtime = worker.runtime,
      imageId = worker.imageId,
      abi = worker.abi,
      clockMode = worker.clockMode,
      lifecycle = "ready",
    }
  end
  local function bounded(value, fallback, maximum)
    local number = math.tointeger(tonumber(value)) or fallback
    if number < 1 or number > maximum then return nil end
    return number
  end
  local cfg = {
    enabled = true, protocol = FLEET_PROTOCOL, managerMode = "assign-only",
    node = string.gsub(raw.node, "/$", ""), workers = workers,
    ticketTtl = bounded(raw.ticketTtl, 10 * 60 * 1000, 60 * 60 * 1000),
    replayWindow = bounded(raw.replayWindow, 60 * 60 * 1000, 7 * 86400000),
    maxEntries = bounded(raw.maxEntries, 2000, 100000),
    auditLimit = bounded(raw.auditLimit, 1000, 100000),
  }
  if not cfg.ticketTtl or not cfg.replayWindow or not cfg.maxEntries or not cfg.auditLimit then
    return nil, "Malformed battle fleet limits"
  end
  return cfg
end

local initialFleetConfig = BattleFleetSealedConfig or BattleFleetConfig
local FLEET_CFG = normalizeFleetConfig(initialFleetConfig) or {}
local FLEET_WORKERS = FLEET_CFG.workers or {}
local FLEET_ENABLED = FLEET_CFG.enabled == true
BattleFleetSealedConfig = FLEET_ENABLED and FLEET_CFG or nil
BattleFleetConfigFingerprint = BattleFleetConfigFingerprint
  or (FLEET_ENABLED and encode(FLEET_CFG) or nil)

BattleFleetSeq = BattleFleetSeq or 0
BattleFleetStarts = BattleFleetStarts or {}
BattleFleetAuthorityState = BattleFleetAuthorityState or (
  FLEET_ENABLED and FLEET_AUTHORITY.newState({
    maxEntries = FLEET_CFG.maxEntries or 2000,
    replayWindow = FLEET_CFG.replayWindow or (60 * 60 * 1000),
    auditLimit = FLEET_CFG.auditLimit or 1000,
  }) or nil)

--- Durable operational telemetry. This intentionally stores aggregates rather
--- than a message-by-message history: a public process should expose useful
--- trends without turning every player's activity into a surveillance feed.
--- `daily` is keyed by epoch-day, matching Checkins, and is published through
--- `/now/metrics`. AdminAudit is owner-only and capped below.
Metrics = Metrics or { since = 0, daily = {}, totals = {} }
--- Disposable derived gauges behind the telemetry writer. Restored processes
--- that do not carry this cache rebuild it once; normal actions update it from
--- only the records they touched.
TelemetryTotals = TelemetryTotals or nil
TelemetryFullRebuilds = TelemetryFullRebuilds or 0
AdminAudit = AdminAudit or {}
AdminAuditSeq = AdminAuditSeq or 0

--- Gold, fungible-item, loot-box, order-book, shop and policy state.
--- EconomyEngine is compiled into this process by every deploy/test bundler;
--- it is not a fourth economy process and never adds a cross-process hop.
EconomyState = EconomyEngine.ensureState(EconomyState or EconomyEngine.newState())

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

-- Hunting lives on its own process, but ownership and inventory do not. The
-- game freezes the chosen companion, retains the route, and accepts only
-- scheduler-attested settlements from this configured process.
HuntProcess = HuntProcess or ""
--- The hunt fleet, in a fixed order. `HuntProcess`/`HuntNode` remain the first
--- entry so a single-process deployment and every existing export keep working.
--- A run is assigned ONE of these at Hunt.Begin and carries it in
--- `p.hunt.processId` for its whole life: workers are peers, and a peer must
--- never be able to settle a run it was not given.
HuntProcesses = HuntProcesses or {}
HuntNode = HuntNode or ""
HuntSeq = HuntSeq or 0
HuntSettlements = HuntSettlements or {}

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

--- Companions listed for sale, and the escrow holding them.
---
--- A listing is CUSTODY, not an advertisement. The companion leaves the
--- seller's collection and lives here until it is bought or the listing is
--- cancelled, so at every instant exactly one place owns it and a sale is one
--- table move rather than a promise two parties have to honour.
---
--- That is also why this is in the game process rather than the marketplace
--- one: escrow has to live where the thing being escrowed lives. A separate
--- index can advertise a companion it cannot hold, but it cannot make the sale
--- atomic, and a two-process sale can half-happen.
Market = Market or {}            -- listing id -> listing
MarketSeq = MarketSeq or 0
--- Completed sales, newest first, capped. Enough for a market screen to show
--- what things actually go for without keeping every sale forever.
MarketHistory = MarketHistory or {}

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
    local found = nil
    for _, commitment in pairs(c) do
      sawAny = true
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        -- More than one RSA identity is ambiguous, not "whichever pairs()
        -- happened to visit first". This is especially important for
        -- scheduler-attested fleet notices: an attacker must not be able to
        -- add a second signature and win table iteration order.
        if found and found ~= commitment.committer then return nil end
        found = commitment.committer
      end
    end
    if found then return found end
    -- Commitments present, none of them a signature: nobody is identified.
    if sawAny then return nil end
  end
  -- No commitments at all: only reachable from the test harness.
  return msg.Address or msg.From
end

--- This process's own scheduler — the only identity allowed to vouch for
--- another process. The same helper the token processes carry; see rune.lua for
--- the incident that made it necessary.
local function schedulerAddress(base)
  if type(base) ~= "table" then return nil end
  local found = base["scheduler-location"] or base.SchedulerLocation
    or base["scheduler_location"]
  if type(found) == "string" and #found == 43 then return found end
  local p = base.process or base.Process
  if type(p) == "table" then
    local nested = p["scheduler-location"] or p.SchedulerLocation
    if type(nested) == "string" and #nested == 43 then return nested end
  end
  return nil
end

--- Which PROCESS sent this message, and only when that is attested.
---
--- A process has no private key, so a message from one carries `from-process`
--- rather than its signature. The delivery itself is signed by the SCHEDULER,
--- and that is the whole basis for believing the claim: our own scheduler
--- vouching for an origin is an attestation, while any other signature means an
--- ordinary wallet message whose `from-process` tag is a claim about itself and
--- is ignored. That distinction is what stops anybody signing a message that
--- says it came from the Rune token.
local function sourceProcess(msg, base)
  local signed = signer(msg)
  local fromProcess = msg["from-process"] or msg.FromProcess
  local commitments = msg.commitments or msg.Commitments
  local hasCommitments = type(commitments) == "table" and next(commitments) ~= nil
  -- The unsigned origin fallback exists only for the in-process Lua harness.
  -- Once any commitment is present, an absent/ambiguous RSA signer fails
  -- closed and can never turn a self-declared from-process into authority.
  if not signed then
    if hasCommitments then return nil end
    return fromProcess
  end
  local scheduler = schedulerAddress(base)
  if fromProcess and scheduler and signed == scheduler then return fromProcess end
  return nil
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

-- Who else this message changed ---------------------------------------------
--
-- A message republishes the record of whoever it TOUCHED, and that is normally
-- just the signer. It was enough while every action only ever changed the
-- account that signed it, and it stopped being enough the moment companions
-- could change hands: a sale credits the seller and a gift hands somebody a
-- creature, but only the buyer or the giver signed, so the person on the other
-- side keeps polling last slot's key.
--
-- From over there that looks like the runes never arrived, or the companion
-- never came. Nothing is actually wrong -- the process has it right -- but the
-- only way to see it is to send a message of your own, and "do something,
-- anything, to find out whether you were paid" is not a thing a player should
-- have to work out.
--
-- So a handler that changes somebody else's record says so here, and `compute`
-- publishes them next to the signer. The cost is one encode per account
-- actually affected -- a sale touches exactly one other person -- which is a
-- different thing entirely from the admin path, where rewriting the whole
-- table is affordable only because it happens on an admin message.
--
-- The PvP opponent has been republished this way all along, from inside
-- `compute` where the live battle can be seen. This is the same idea reached
-- from the handlers, for the changes a battle lookup cannot find.
local alsoTouched = {}

local function touchAlso(address)
  if type(address) == "string" and address ~= "" then
    alsoTouched[address] = true
  end
end

-- Player records ------------------------------------------------------------

-- Forward declaration. `getPlayer` normalises every account it hands out into
-- the roster shape, but the helper that does it needs `createMonster` and the
-- roster constants, which are defined further down. Declaring it here keeps the
-- normalisation at the single door every handler comes through.
local ensureRoster

local function newPlayer(address, timestamp)
  return {
    address = address,
    -- An open deployment grants access when an account is first materialised.
    -- Closed deployments retain the Eternal Pass allow-list exactly as before.
    unlocked = C.PUBLIC_ACCESS == true,
    faction = nil,
    -- The active companion, and a mirror of `monsters[activeId]`. See the
    -- roster section: these are the same table, never a copy.
    monster = nil,
    --- The active companion as a one-entry map, keyed by monster id.
    monsters = {},
    --- Owned but not active. Unbounded, and the only place a listing may be
    --- created from.
    collection = {},
    activeId = nil,
    --- Per-player counter behind every monster id this account has issued.
    monsterSeq = 0,
    --- Whether this account has ever used its one adoption.
    ---
    --- Not derived from what the account currently holds, and that is the whole
    --- point. Emptiness is a state a player can return to at will -- sell the
    --- companion, give it away -- so a rule phrased as "you may adopt when you
    --- hold nothing" is a rule anyone can satisfy again on demand. This is a
    --- fact about the account's history, and history does not un-happen.
    adopted = false,
    inventory = {},
    -- Gold is monetary plumbing, not an inventory item and never leaves this
    -- process. Keeping it separate prevents a generic item transfer from
    -- accidentally becoming a Gold-withdrawal path.
    gold = 0,
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
    -- Six style/colour pairs. The browser derives the character sheet from
    -- bundled art; this recipe replaces new Arweave sprite uploads.
    outfit = nil,
    -- Legacy uploads remain readable for returning accounts.
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
  -- Every account leaves this function in the roster shape, including one
  -- restored from a pre-roster snapshot or the legacynet export.
  p = ensureRoster(p)
  EconomyEngine.ensurePass(EconomyState, p, address, timestamp)
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
--- Put the full move definitions back on a companion, in place.
---
--- Companions are STORED with only the uses remaining per move (see
--- `Battle.compactMoves`). Every path that hands one to a client goes through
--- here, because the client draws the card and the move list from these
--- fields. Only ever called on a copy -- hydrating a stored record would put
--- the duplication straight back.
local function withMoves(m)
  if type(m) == "table" and type(m.moves) == "table" then
    m.moves = Battle.hydrateMoves(m.moves)
  end
  return m
end

local function playerView(player)
  local v = Battle.clone(player)
  if C.PUBLIC_ACCESS == true then v.unlocked = true end
  if v.monster then
    v.monster.nextLevelExp = C.requiredExp(v.monster.level or 0)
  end
  -- An empty Lua table is ambiguous; the client expects a list here.
  v.lootboxes = v.lootboxes or {}
  v.inventory = v.inventory or {}
  v.gold = math.max(0, int(v.gold, 0))
  -- Minted companions, keyed by asset id. `jsonObject` because an empty Lua
  -- table encodes as `[]` by default -- the right answer for every list on the
  -- battle view and the wrong one here, where the client indexes by asset id.
  -- A shape that flips from array to object the moment the first mint lands is
  -- the kind of thing that works in every test and breaks on the first player.
  v.assets = jsonObject(v.assets or {})
  -- The active slot and the collection, both keyed by monster id, both objects for
  -- the same reason `assets` is. `monster` above stays the active one, so a
  -- client that only knows about a single companion keeps working.
  v.monsters = jsonObject(v.monsters or {})
  v.collection = jsonObject(v.collection or {})
  -- `v` is a deep clone, so the roster entry and the `monster` mirror are two
  -- separate tables here and both have to be filled in.
  withMoves(v.monster)
  for _, m in pairs(v.monsters) do
    m.nextLevelExp = C.requiredExp(m.level or 0)
    withMoves(m)
  end
  for _, m in pairs(v.collection) do withMoves(m) end
  -- Narrowed, not passed through. Luerl's numbers are floats, so publishing the
  -- constant directly writes `1.00000000000` into every player record forever.
  v.rosterMax = int(C.ROSTER.max, 1)
  -- When the next daily is available, so the client can show a countdown
  -- rather than a button that fails.
  v.dailyReadyAt = int(v.lastDaily, 0) > 0
    and (int(v.lastDaily, 0) + C.DAILY.interval) or 0
  if v.activeBattleId then
    local b = Battles[v.activeBattleId]
    if b and b.status ~= "ended" then
      v.battle = Battle.view(b)
    elseif v.battleFleet and v.battleFleet.battleId == v.activeBattleId then
      -- Fleet combat state lives under `battle-<id>` on its assigned worker.
      -- Keep the authority route on every published player view so a browser
      -- reload can hydrate that worker without asking the monolith to proxy a
      -- round or a read.
      v.battleFleet.status = v.battleFleet.status or "opening"
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

--- The card art a companion is drawn on, by element.
---
--- Stored ON the monster rather than derived from its element at render time,
--- because a companion carries its own appearance: the whole point of the
--- record is that it is self-contained, so a transfer moves the creature and
--- the way it looks together. Derivation would mean a companion silently
--- restyled by a faction change it did not consent to, and would make an
--- alternate background impossible to grant.
local ART_BY_ELEMENT = {
  fire = "Fire", water = "Water", air = "Air", rock = "Earth",
}

local function createMonster(factionName, timestamp)
  local faction = C.FACTION_BY_NAME[factionName]
  if not faction then return nil end
  local stats = rollStartingStats()
  local art = ART_BY_ELEMENT[faction.element] or "Fire"
  return {
    name = faction.monster.name,
    image = faction.monster.image,
    sprite = faction.monster.sprite,
    -- Appearance. Every companion is holographic for now; the field exists so
    -- that stops being true without a migration.
    holographic = true,
    background = art,
    border = art,
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

--- Rebuild the exact wild creature authorised by the Hunt process as a normal
--- owned companion. The process is trusted for the roll, but its payload is
--- still bounded and checked against the canonical faction/move catalog so a
--- bad deployment cannot write an unusable record into a player's collection.
local function createCapturedMonster(raw, timestamp)
  if type(raw) ~= "table" then return nil, "Captured monster is missing" end
  local faction = C.FACTION_BY_NAME[raw.faction or ""]
  if not faction or faction.element ~= raw.elementType then
    return nil, "Captured monster has an invalid faction"
  end
  local function stat(name, minimum, maximum)
    local value = int(raw[name], nil)
    if not value or value < minimum or value > maximum then return nil end
    return value
  end
  local level = stat("level", 0, 10000)
  local attack = stat("attack", 1, 100000)
  local defense = stat("defense", 1, 100000)
  local speed = stat("speed", 1, 100000)
  local health = stat("health", 1, 100000)
  if not level or not attack or not defense or not speed or not health then
    return nil, "Captured monster has invalid stats"
  end
  local moves, moveCount = {}, 0
  for name, stored in pairs(raw.moves or {}) do
    moveCount = moveCount + 1
    local count = int(type(stored) == "table" and stored.count or nil, nil)
    if moveCount > 8 or type(name) ~= "string" or not Battle.moveDef(name)
       or not count or count < 1 or count > 1000 then
      return nil, "Captured monster has invalid moves"
    end
    moves[name] = { count = count }
  end
  if moveCount == 0 then return nil, "Captured monster has no moves" end

  local monster = createMonster(faction.name, timestamp)
  monster.level = level
  monster.attack, monster.defense = attack, defense
  monster.speed, monster.health = speed, health
  monster.moves = moves
  monster.name = faction.monster.name
  monster.image = faction.monster.image
  monster.sprite = faction.monster.sprite
  return monster
end

local function isHome(monster) return monster.status.type == "Home" end

-- Active companion and collection --------------------------------------------
--
-- A player holds companions in two places. The one-entry ACTIVE map is what the
-- game acts on; the COLLECTION holds every other owned companion. Both
-- are maps of monster id to the whole self-contained record, so moving a
-- companion anywhere -- between the two, to another player, into a listing --
-- is moving one table and never copying fields out of it.
--
-- `p.monster` is kept as a MIRROR of the active roster entry, and it is the
-- same Lua table, not a copy. Every handler that reads or mutates `p.monster`
-- therefore keeps working untouched, and a mutation through it is visible in
-- the roster immediately because they are one object. Only code that REPLACES
-- a companion has to go through the helpers below; code that changes one does
-- not have to care that the roster exists.

local function rosterCount(p)
  local n = 0
  for _ in pairs(p.monsters or {}) do n = n + 1 end
  return n
end

local function collectionCount(p)
  local n = 0
  for _ in pairs(p.collection or {}) do n = n + 1 end
  return n
end

--- Give a companion an id that is unique within this player.
---
--- Per-player rather than global on purpose: an id only ever has to distinguish
--- one player's companions from each other, and a global counter would leak how
--- many exist and grow the state for nothing.
local function nextMonsterId(p)
  p.monsterSeq = int(p.monsterSeq, 0) + 1
  return "m" .. string.format("%d", p.monsterSeq)
end

--- Point `p.monster` at a roster entry, or at nothing.
---
--- The single place the mirror is written. Anything that changes which
--- companion is active goes through here so the two can never disagree.
local function setActive(p, id)
  p.monsters = p.monsters or {}
  if id and p.monsters[id] then
    p.activeId = id
    p.monster = p.monsters[id]
  else
    -- Fall back to any remaining roster entry rather than leaving the player
    -- with companions but no active one, which every existing handler would
    -- read as "no companion at all".
    local firstId, firstMonster = next(p.monsters)
    p.activeId = firstId
    p.monster = firstMonster
  end
  return p.monster
end

--- Put a companion in the active slot. Returns nil when it is occupied.
local function addToRoster(p, monster)
  p.monsters = p.monsters or {}
  if rosterCount(p) >= C.ROSTER.max then
    return nil, "You already have an active companion"
  end
  monster.id = monster.id or nextMonsterId(p)
  p.monsters[monster.id] = monster
  if not p.activeId then setActive(p, monster.id) end
  return monster
end

local function removeFromRoster(p, id)
  p.monsters = p.monsters or {}
  local monster = p.monsters[id]
  if not monster then return nil end
  p.monsters[id] = nil
  if p.activeId == id then setActive(p, nil) end
  return monster
end

local function addToCollection(p, monster)
  p.collection = p.collection or {}
  monster.id = monster.id or nextMonsterId(p)
  p.collection[monster.id] = monster
  return monster
end

--- A companion by id, wherever the player is keeping it.
local function findMonster(p, id)
  if type(id) ~= "string" or id == "" then return nil end
  return (p.monsters or {})[id] or (p.collection or {})[id]
end

--- Which active companion an action is about.
---
--- Older clients may still name it with `MonsterId`; with no name it is the
--- active one. A collection companion is never accepted here.
local function resolveRosterMonster(p, msg)
  local id = msg and msg.MonsterId
  if type(id) == "string" and id ~= "" then
    local monster = (p.monsters or {})[id]
    if not monster then return nil, "No such companion in your roster" end
    return monster
  end
  if not p.monster then return nil, "No companion" end
  return p.monster
end

--- A player may have exactly one realm activity open.
---
--- The scan remains defensive for records imported from the former multi-active
--- build. `Minting` is a freeze rather than an activity and feeding is
--- immediate, so neither belongs in this check.
local function activityConflict(p, exceptId)
  if p.hunt then
    return "You are already out hunting"
  end
  if int(p.battlesRemaining, 0) > 0 or p.activeBattleId then
    return "You are already occupied by an arena session"
  end
  for id, monster in pairs(p.monsters or {}) do
    if id ~= exceptId and monster.status then
      if monster.status.type == "Play" then
        return "You are already playing with " .. tostring(monster.name or "another companion")
      end
      if monster.status.type == "Quest" then
        return tostring(monster.name or "Another companion") .. " is already on a quest"
      end
      if monster.status.type == "Hunt" then
        return "You are already out hunting"
      end
      if monster.status.type == "Battle" then
        return "You are already occupied by an arena session"
      end
    end
  end
  return nil
end

--- Give a companion the appearance fields it predates.
---
--- Everything written before companions carried their own look has `image` and
--- `sprite` and nothing else — that is all 168 recovered legacynet players and
--- every account migrated from an earlier deployment. Folding such a record in
--- without this leaves `background` and `border` nil and `holographic` unset,
--- so the card renders with no art while a freshly adopted one beside it
--- renders correctly. That is exactly what the seeded deployer account showed:
--- `m1 plain bg=undefined` next to `m2 holo bg=Fire`.
---
--- Derived from the element, the same rule `createMonster` uses, so a
--- backfilled companion is indistinguishable from a new one. Only ever fills a
--- MISSING field, so a companion granted a non-default background keeps it.
local function withAppearance(monster)
  if type(monster) ~= "table" then return monster end
  local art = ART_BY_ELEMENT[monster.elementType] or "Fire"
  if monster.background == nil then monster.background = art end
  if monster.border == nil then monster.border = art end
  if monster.holographic == nil then monster.holographic = true end
  return monster
end

--- Fold a pre-roster record into the roster shape.
---
--- Every account written before companions could be collected has `monster` and
--- no `monsters`, and both the live snapshot and the recovered legacynet export
--- are that shape. Rather than migrate once at load and hope nothing was
--- missed, this runs wherever a player is read: an account is in the new shape
--- the first time it is touched, and an account that is already there costs a
--- single table lookup.
function ensureRoster(p)
  if not p then return nil end
  -- The short-lived charm prototype was replaced by berry maxing before it
  -- became an active item system. Drop any in-flight prototype receipt while
  -- preserving retired inventory keys for a possible future migration.
  p.arenaCharm = nil
  p.monsters = p.monsters or {}
  p.collection = p.collection or {}
  p.monsterSeq = int(p.monsterSeq, 0)
  -- Appearance is backfilled across BOTH halves, not just the folded record.
  -- An account can arrive already in the roster shape and still predate the
  -- look — a migration from a deployment that had the roster but not the art —
  -- and a collection is exactly where an unlooked-at companion hides.
  for _, m in pairs(p.monsters) do withAppearance(m) end
  for _, m in pairs(p.collection) do withAppearance(m) end
  if p.monster then withAppearance(p.monster) end
  -- `adopted` did not exist before adoption became once-per-account-ever, so
  -- `nil` here means "written by an older build" and `false` means "this
  -- account was created since and genuinely has not adopted". Only the first
  -- is backfilled, and it is backfilled from the counter rather than from what
  -- the account holds now: `monsterSeq` counts every id ever issued, so it
  -- stays true for somebody who has since sold or given everything away.
  if p.adopted == nil then
    p.adopted = p.monsterSeq > 0 or p.monster ~= nil
  end
  if p.monster and not p.monster.id then
    p.monster.id = nextMonsterId(p)
  end
  if p.monster and not p.monsters[p.monster.id] then
    p.monsters[p.monster.id] = p.monster
    p.activeId = p.monster.id
  end
  -- An active id naming something that is gone is worse than none: it makes
  -- `p.monster` a stale table nothing else can reach.
  if p.activeId and not p.monsters[p.activeId] then setActive(p, nil) end
  if not p.activeId and next(p.monsters) then setActive(p, nil) end

  -- Deployments briefly allowed three active companions. Collapse those rows
  -- without losing a creature: keep the companion that is actually away on an
  -- activity (or the Hunt route's named companion), otherwise keep the chosen
  -- active one, and move every other record into the collection.
  if rosterCount(p) > C.ROSTER.max then
    local keepId = p.activeId
    if p.hunt and p.hunt.monsterId and p.monsters[p.hunt.monsterId] then
      keepId = p.hunt.monsterId
    else
      for id, monster in pairs(p.monsters) do
        local status = monster.status and monster.status.type or "Home"
        if status ~= "Home" then
          keepId = id
          break
        end
      end
    end
    if not keepId or not p.monsters[keepId] then keepId = next(p.monsters) end

    local overflow = {}
    for id in pairs(p.monsters) do
      if id ~= keepId then overflow[#overflow + 1] = id end
    end
    table.sort(overflow)
    for _, id in ipairs(overflow) do
      local monster = p.monsters[id]
      p.monsters[id] = nil
      p.collection[id] = monster
    end
    setActive(p, keepId)
  end
  return p
end

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

--- How many members of a faction ride along in the published tally. Matches
--- the leaderboard's cut for the same reason: a public key that grows with the
--- player count is a key that eventually cannot be published at all.
local FACTION_ROSTER_PUBLISHED = 50

--- The four factions with live membership stats. Also published whole, so the
--- faction screen normally costs no signature at all.
local function factionStats()
  local rows, byName = {}, {}
  for _, faction in ipairs(C.FACTIONS) do
    local row = {
      faction = faction, members = {}, monsters = 0, totalLevel = 0,
      fed = 0, played = 0, quested = 0,
    }
    rows[#rows + 1] = row
    byName[faction.name] = row
  end

  -- One world pass, rather than one pass per faction. This is a hot derived
  -- key and adding a faction must not add another complete player-table scan.
  for address, p in pairs(Players) do
    local row = byName[p.faction]
    if row then
      local entry = { id = address, level = 0, timesFed = 0, timesPlay = 0, timesQuest = 0 }
      if p.monster then
        row.monsters = row.monsters + 1
        entry.level = p.monster.level or 0
        entry.timesFed = p.monster.totalTimesFed or 0
        entry.timesPlay = p.monster.totalTimesPlay or 0
        entry.timesQuest = p.monster.totalTimesQuest or 0
        row.totalLevel = row.totalLevel + entry.level
        row.fed = row.fed + entry.timesFed
        row.played = row.played + entry.timesPlay
        row.quested = row.quested + entry.timesQuest
      end
      entry.wins = p.wins or 0
      row.members[#row.members + 1] = entry
    end
  end

  local out = {}
  for _, row in ipairs(rows) do
    local faction, members = row.faction, row.members
    table.sort(members, function(x, y) return x.level > y.level end)
    -- The published roster is the top of the faction, not all of it.
    --
    -- `factions` is read with no wallet and republished whenever anything
    -- changes, and it carried a row for EVERY member: at a few hundred players
    -- that was already twenty-two kilobytes, and it grows with the game
    -- without limit. `memberCount` below is taken before the cut and stays
    -- exact, so the numbers on the faction screen are unaffected -- only the
    -- length of the scrolling roster under them is.
    local memberTotal = #members
    if memberTotal > FACTION_ROSTER_PUBLISHED then
      local top = {}
      for i = 1, FACTION_ROSTER_PUBLISHED do top[i] = members[i] end
      members = top
    end
    out[#out + 1] = {
      name = faction.name,
      element = faction.element,
      description = faction.description,
      mascot = faction.mascot,
      berry = faction.berry,
      monsterName = faction.monster.name,
      monsterImage = faction.monster.image,
      memberCount = memberTotal,
      monsterCount = row.monsters,
      members = members,
      averageLevel = row.monsters > 0 and (row.totalLevel / row.monsters) or 0,
      totalTimesFed = row.fed,
      totalTimesPlay = row.played,
      totalTimesQuest = row.quested,
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
    passOrigin = p.pass and p.pass.origin or nil,
    accountId = p.pass and p.pass.accountId or nil,
    recoveryCooldownUntil = p.pass and int(p.pass.recoveryCooldownUntil, 0) or 0,
    runeBond = p.pass and int(p.pass.bond, 0) or 0,
    faction = p.faction,
    name = m and m.name or nil,
    element = m and m.elementType or nil,
    level = m and int(m.level, 0) or 0,
    exp = m and int(m.exp, 0) or 0,
    energy = m and int(m.energy, 0) or 0,
    happiness = m and int(m.happiness, 0) or 0,
    status = m and m.status and m.status.type or "No companion",
    inventory = jsonObject(Battle.clone(p.inventory or {})),
    gold = math.max(0, int(p.gold, 0)),
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
  local out, byName = {}, {}
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
    out[#out + 1] = row
    byName[faction.name] = row
  end
  for _, p in pairs(Players) do
    local row = byName[p.faction]
    if row then
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
  for _, row in ipairs(out) do
    row.averageLevel = row.companions > 0 and row.totalLevel / row.companions or 0
    row.totalLevel = nil
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
    -- Walk what this player HOLDS, not the whole catalogue. `stats.items` is
    -- seeded with a zero for every catalogue item above, so the totals come out
    -- identical; this only stops asking eleven questions per account when the
    -- answer to most of them is "none". The guard keeps a stray inventory key
    -- from inventing a column.
    for item, count in pairs(p.inventory or {}) do
      if stats.items[item] ~= nil then
        local held = int(count, 0)
        stats.items[item] = stats.items[item] + held
        if item == "rune" then stats.runes = stats.runes + held end
      end
    end
  end
  -- Active comes from the table, which holds every live fight. Completed comes
  -- from the counter, because the table no longer keeps finished ones.
  for _, b in pairs(Battles) do
    if b.status ~= "ended" then stats.activeBattles = stats.activeBattles + 1 end
  end
  stats.completedBattles = int(BattlesCompleted, 0)
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
    if not (p.pass and p.pass.origin == "promised") then
      for item, amount in pairs(C.STARTER_INVENTORY) do grant(p, item, amount) end
      for rarity, count in pairs(C.STARTER_LOOTBOXES) do addLootboxes(p, count, rarity) end
    end
    p.seeded = true
  end

  -- Swearing IS how you get your companion.
  --
  -- These were two messages, and the gap between them was a real state nobody
  -- wanted: an account sworn to a faction, holding nothing, able to do none of
  -- the things the game is about until it sent a second message it had no way
  -- of knowing was required. Every path into the game had to handle it, the
  -- swarm had to sequence it, and a player who stopped in between looked
  -- exactly like a player who had given their companion away.
  --
  -- So the oath and the companion are one turn. Swearing is the first thing an
  -- account can do and the only thing it needs to do, and what comes back is a
  -- player who can immediately play.
  --
  -- `Monster.Adopt` stays, and stays reachable: an account that swore under an
  -- older build has a faction, no companion, and `adopted` false, and it is the
  -- only door left for them.
  if not p.adopted then
    local monster = createMonster(p.faction, timestamp)
    if not monster then return fail(base, "Faction has no companion configured") end
    addToRoster(p, monster)
    if not (p.pass and p.pass.origin == "promised") then addLootboxes(p, 3, 1) end
    -- Once per account, ever. The oath is spent even if the companion is later
    -- sold or given away, which is what stops two wallets trading one creature
    -- back and forth to draw an endless free supply out of the process.
    p.adopted = true
  end

  return reply(base, playerView(p))
end

H["Monster.Adopt"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if not p.faction then return fail(base, "Join a faction before adopting") end

  -- ONCE PER ACCOUNT, EVER.
  --
  -- This used to ask whether the account currently held anything, and that is a
  -- different question with a different answer. Give the companion away, or
  -- sell it, and the roster and the collection are both empty again -- so two
  -- wallets passing one creature back and forth drew a brand new one out of the
  -- process every round, for the price of the storage rune. An unbounded free
  -- supply of the only thing the game is about.
  --
  -- The fix is that adoption is now a fact recorded about the account rather
  -- than an inference from its contents. Somebody who parts with their starter
  -- has to buy, be given, or be granted their next one, which is the entire
  -- reason the marketplace exists.
  if p.adopted then
    return fail(base, "You have already adopted; companions now come from the market")
  end

  -- And that flag is the ONLY gate. It used to also refuse anyone currently
  -- holding a companion, which quietly took the adoption away from somebody who
  -- had simply been given one before they got round to using it -- a gift is
  -- not the same thing as having spent your one. What you hold says nothing
  -- about whether you have adopted; only `adopted` does.
  local monster = createMonster(p.faction, timestamp)
  if not monster then return fail(base, "Faction has no companion configured") end
  -- Into the active slot when it is empty, otherwise into the collection.
  -- Either way it is theirs; receiving a gift before adopting must not take the
  -- account's one adoption away.
  if rosterCount(p) < C.ROSTER.max then
    addToRoster(p, monster)
  else
    addToCollection(p, monster)
  end
  p.adopted = true
  if not (p.pass and p.pass.origin == "promised") then addLootboxes(p, 3, 1) end
  return reply(base, playerView(p))
end

--- Send a companion from the roster to the collection.
---
--- Home only, and it costs a rune. A companion mid-quest or mid-battle cannot
--- be parked: that would be a way to cancel a bad outcome, and the timers are
--- the game. The rune is the brake described in C.ROSTER -- storing costs,
--- retrieving does not, so the round trip is never free.
H["Monster.Store"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local monster, why = resolveRosterMonster(p, msg)
  if not monster then return fail(base, why) end
  if not isHome(monster) then
    return fail(base, "Your companion is busy: " .. monster.status.type)
  end
  if p.activeBattleId then return fail(base, "Finish your battle first") end

  local cost = C.ROSTER.storeCost
  if not spend(p, cost.item, cost.amount) then
    return fail(base, "Storing a companion costs "
      .. string.format("%d", cost.amount) .. " " .. cost.item)
  end

  removeFromRoster(p, monster.id)
  addToCollection(p, monster)
  return reply(base, playerView(p))
end

--- Bring a companion out of the collection when there is no active companion.
H["Monster.Retrieve"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local id = msg.MonsterId
  local monster = (p.collection or {})[id]
  if not monster then return fail(base, "No such companion in your collection") end
  if rosterCount(p) >= C.ROSTER.max then
    return fail(base, "Switch companions instead; you already have an active companion")
  end

  p.collection[id] = nil
  -- A companion coming out of storage is Home and idle whatever it was doing
  -- when it went in. Nothing in the collection has a running timer, because
  -- storing required Home in the first place.
  monster.status = { type = "Home", since = timestamp, until_time = timestamp }
  addToRoster(p, monster)
  return reply(base, playerView(p))
end

--- Choose one collection companion as the active companion.
---
--- This is one atomic exchange: the current companion moves into collection as
--- the selected one moves out. It is free because it cannot reset or escape an
--- activity -- every refusal is resolved first and both companions must be
--- Home. `Monster.Store` remains the explicit paid path for making the active
--- slot empty so that companion can be listed or transferred.
H["Monster.SetActive"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local id = msg.MonsterId
  if (p.monsters or {})[id] then return reply(base, playerView(p)) end
  local selected = (p.collection or {})[id]
  if not selected then return fail(base, "No such companion in your collection") end
  if p.activeBattleId or int(p.battlesRemaining, 0) > 0 then
    return fail(base, "Finish your arena session first")
  end
  if p.hunt then return fail(base, "Finish your hunt first") end
  local current = p.monster
  if current and not isHome(current) then
    return fail(base, "Your companion is busy: " .. tostring(current.status.type))
  end
  if selected.status and selected.status.type ~= "Home" then
    return fail(base, "That companion is not ready to become active")
  end
  if not selected.status then
    selected.status = { type = "Home", since = timestamp, until_time = timestamp }
  end

  p.collection[id] = nil
  if current then
    p.monsters[current.id] = nil
    p.collection[current.id] = current
  end
  p.monsters[id] = selected
  setActive(p, id)
  return reply(base, playerView(p))
end

--- Hand a companion to another account.
---
--- From the collection only, same as a listing: the roster is what the game is
--- acting on, and a companion cannot change hands mid-quest. The whole record
--- moves, so the receiver gets the creature exactly as it was -- stats, art,
--- holographic, history -- with a fresh id in their own numbering.
H["Monster.Transfer"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local toAddress = msg.Recipient
  if type(toAddress) ~= "string" or #toAddress ~= 43 then
    return fail(base, "Recipient must be an Arweave address")
  end
  if toAddress == address then return fail(base, "That is already your companion") end

  local id = msg.MonsterId
  local monster = (p.collection or {})[id]
  if not monster then
    return fail(base, "Only a companion in your collection can be transferred")
  end

  local other = getPlayer(toAddress, timestamp)
  if not other then return fail(base, "No such account") end

  p.collection[id] = nil
  monster.id = nil
  addToCollection(other, monster)
  -- The receiver did not sign this, so their record has to be republished or
  -- the companion does not appear for them until they act on their own.
  touchAlso(toAddress)
  return reply(base, playerView(p))
end

-- The marketplace -------------------------------------------------------------
--
-- Three verbs and one invariant: a listed companion is in `Market` and nowhere
-- else. It is not in the seller's collection, so it cannot be transferred or
-- retrieved while it is for sale, and it cannot be sold twice.
--
-- Prices are in in-game runes. See C.MARKET for why that rather than the
-- withdrawn token.

local function listingView(listing)
  return {
    id = listing.id,
    seller = listing.seller,
    price = int(listing.price, 0),
    listedAt = int(listing.listedAt, 0),
    -- Cloned before hydrating: the listing itself stays compact in escrow.
    monster = withMoves(Battle.clone(listing.monster)),
  }
end

local function marketView()
  local out = {}
  for id, listing in pairs(Market) do out[id] = listingView(listing) end
  return jsonObject(out)
end

local function marketCount()
  local n = 0
  for _ in pairs(Market) do n = n + 1 end
  return n
end

--- Put a companion up for sale.
H["Market.List"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local price = int(msg.Price, 0)
  if price < C.MARKET.minPrice or price > C.MARKET.maxPrice then
    return fail(base, "Price must be between "
      .. string.format("%d", C.MARKET.minPrice) .. " and "
      .. string.format("%d", C.MARKET.maxPrice) .. " runes")
  end

  local id = msg.MonsterId
  local monster = (p.collection or {})[id]
  if not monster then
    return fail(base, "Only a companion in your collection can be listed")
  end

  MarketSeq = MarketSeq + 1
  local listingId = "L" .. string.format("%d", MarketSeq)
  p.collection[id] = nil
  -- The record moves whole. The listing IS the custody: nothing else holds a
  -- reference to this companion until it is bought or cancelled.
  Market[listingId] = {
    id = listingId,
    seller = address,
    price = price,
    listedAt = timestamp,
    monster = monster,
  }
  local v = playerView(p)
  v.listing = listingView(Market[listingId])
  return reply(base, v)
end

--- Take your own listing down. The companion returns to your collection.
H["Market.Cancel"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local listing = Market[msg.ListingId]
  if not listing then return fail(base, "No such listing") end
  if listing.seller ~= address then return fail(base, "That is not your listing") end

  Market[listing.id] = nil
  local monster = listing.monster
  monster.id = nil
  addToCollection(p, monster)
  return reply(base, playerView(p))
end

--- Buy a listed companion with in-game runes.
---
--- One message does all of it: the buyer is debited, the seller is credited,
--- and the companion moves into the buyer's collection. There is no window in
--- which the runes have moved and the companion has not, because there is no
--- second message and nothing here can fail partway -- `spend` is checked
--- before anything else is touched.
H["Market.Buy"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end

  local listing = Market[msg.ListingId]
  if not listing then return fail(base, "No such listing") end
  if listing.seller == address then
    return fail(base, "You cannot buy your own listing")
  end

  local price = int(listing.price, 0)
  if not spend(p, "rune", price) then
    return fail(base, "That costs " .. string.format("%d", price)
      .. " runes and you hold " .. string.format("%d", itemCount(p, "rune")))
  end

  local seller = getPlayer(listing.seller, timestamp)
  grant(seller, "rune", price)
  -- The seller is not here. Being paid is the entire point of having listed
  -- something, and without this they cannot see it until they message the
  -- process for some unrelated reason.
  touchAlso(listing.seller)

  Market[listing.id] = nil
  local monster = listing.monster
  monster.id = nil
  addToCollection(p, monster)

  table.insert(MarketHistory, 1, {
    id = listing.id,
    seller = listing.seller,
    buyer = address,
    price = price,
    soldAt = timestamp,
    name = monster.name,
    element = monster.elementType,
    level = int(monster.level, 0),
  })
  -- Keep the tail bounded: this is published on every message, and an
  -- unbounded history would make every read of this process grow forever.
  while #MarketHistory > 100 do table.remove(MarketHistory) end

  return reply(base, playerView(p))
end

-- Gold goods market and finite game shop ------------------------------------
--
-- The companion market above deliberately remains Rune-priced. These verbs
-- are the two-sided Gold order book for berries, Scrolls and in-game Rune, and
-- the finite NPC counterparty. EconomyEngine is a source module compiled into
-- this same process, so matching, escrow and settlement are atomic with player
-- inventory.

H["Economy.View"] = function(base, msg, timestamp)
  return reply(base, EconomyEngine.publicView(EconomyState, Withdrawals, Deposits, timestamp))
end

H["Economy.Order.Place"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local placed, problem = EconomyEngine.placeOrder(
    EconomyState, Players, address, msg.Side, msg.Item,
    int(msg.Price, 0), int(msg.Quantity, 0), timestamp, msg.ActionId)
  if problem then return fail(base, problem) end
  for _, fill in ipairs(placed.fills or {}) do
    if fill.buyer ~= address then touchAlso(fill.buyer) end
    if fill.seller ~= address then touchAlso(fill.seller) end
  end
  local view = playerView(p)
  view.economyResult = placed
  return reply(base, view)
end

H["Economy.Order.Cancel"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local cancelled, problem = EconomyEngine.cancelOrder(
    EconomyState, Players, address, msg.OrderId, timestamp, msg.ActionId)
  if problem then return fail(base, problem) end
  local view = playerView(p)
  view.economyResult = cancelled
  return reply(base, view)
end

H["Economy.Order.Maintain"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local expired = EconomyEngine.maintain(EconomyState, Players, timestamp, int(msg.Limit, 25))
  local view = playerView(p)
  view.economyResult = { expired = expired }
  return reply(base, view)
end

H["Economy.Shop.Trade"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local traded, problem = EconomyEngine.shopTrade(
    EconomyState, Players, Withdrawals, Deposits, address,
    msg.Item, msg.Side, int(msg.Quantity, 0), timestamp, msg.ActionId)
  if problem then return fail(base, problem) end
  local view = playerView(p)
  view.economyResult = traded
  return reply(base, view)
end

-- Eternal Pass identity -----------------------------------------------------

H["Pass.Info"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  return reply(base, {
    pass = p and EconomyEngine.ensurePass(EconomyState, p, address, timestamp) or nil,
    quote = EconomyEngine.passQuote(EconomyState),
    policy = EconomyState.policy.passes,
  })
end

H["Pass.ClaimPromise"] = function(base, msg, timestamp)
  local address = signer(msg)
  if not address then return fail(base, "No signer address") end
  local policy = EconomyState.policy.passes
  if not policy.genesisSealed then return fail(base, "The promised-pass manifest is not sealed") end
  if int(policy.unassignedPromiseSlots, 0) <= 0 then return fail(base, "No promised pass slots remain") end
  if int(policy.promiseClaimDeadline, 0) <= timestamp then return fail(base, "The promised-pass claim window has closed") end
  if Players[address] and Players[address].pass then return fail(base, "This account already has a pass") end
  local claimId = msg.ClaimId
  if type(claimId) ~= "string" or #claimId < 16 or #claimId > 128 then
    return fail(base, "ClaimId must be a public one-use promise reference")
  end
  policy.promiseClaims = policy.promiseClaims or {}
  if policy.promiseClaims[claimId] then return fail(base, "That promised-pass claim was already used") end
  local p = getPlayer(address, timestamp)
  p.unlocked = true
  EconomyEngine.ensurePass(EconomyState, p, address, timestamp, "promised")
  p.pass.origin = "promised"
  policy.promiseClaims[claimId] = { address = address, claimedAt = timestamp }
  policy.unassignedPromiseSlots = int(policy.unassignedPromiseSlots, 0) - 1
  return reply(base, playerView(p))
end

H["Pass.SetRecovery"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end
  local recovery = msg.Recovery
  if type(recovery) ~= "string" or #recovery ~= 43 or recovery == address then
    return fail(base, "Recovery must be a different 43-character address")
  end
  local pass = EconomyEngine.ensurePass(EconomyState, p, address, timestamp)
  pass.recoveryController = recovery
  pass.recoverySetAt = timestamp
  return reply(base, playerView(p))
end

H["Pass.Recover"] = function(base, msg, timestamp)
  local recoverySigner = signer(msg)
  local oldAddress = msg.Account
  local newAddress = msg.NewController
  local p = type(oldAddress) == "string" and Players[oldAddress] or nil
  if not p or not p.pass then return fail(base, "No such recoverable account") end
  if p.pass.recoveryController ~= recoverySigner then return fail(base, "Not authorised") end
  if type(newAddress) ~= "string" or #newAddress ~= 43 then
    return fail(base, "NewController must be a 43-character address")
  end
  if Players[newAddress] then return fail(base, "The new controller already has an account") end

  local moved, problem = EconomyEngine.rotateAccount(
    EconomyState, Players, oldAddress, newAddress, timestamp)
  if problem then return fail(base, problem) end
  for _, listing in pairs(Market) do
    if listing.seller == oldAddress then listing.seller = newAddress end
  end
  for _, sale in ipairs(MarketHistory) do
    if sale.seller == oldAddress then sale.seller = newAddress end
    if sale.buyer == oldAddress then sale.buyer = newAddress end
  end
  for _, row in pairs(Withdrawals) do
    if row.address == oldAddress then row.address = newAddress end
  end
  for _, row in pairs(Deposits) do
    if row.address == oldAddress then row.address = newAddress end
  end
  -- The old public account key must be actively cleared; result/base otherwise
  -- retains the previous slot's value forever.
  base["player-" .. oldAddress] = "null"
  touchAlso(newAddress)
  local view = playerView(moved)
  view.recovery = { from = oldAddress, to = newAddress,
    cooldownUntil = moved.pass.recoveryCooldownUntil }
  return reply(base, view)
end

H["Pass.Bond"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end
  local policy = EconomyState.policy.runeRewards
  if not policy.bondEnabled then return fail(base, "Rune bonding is not enabled") end
  local pass = EconomyEngine.ensurePass(EconomyState, p, address, timestamp)
  if pass.unbond then return fail(base, "Finish or cancel the existing unbond first") end
  local required = math.max(0, int(policy.bondAmount, 0))
  local amount = required - int(pass.bond, 0)
  if amount <= 0 then return fail(base, "The pass already holds the required Rune bond") end
  if not spend(p, "rune", amount) then return fail(base, "Not enough Rune for the configured bond") end
  pass.bond = int(pass.bond, 0) + amount
  policy.bondedRune = int(policy.bondedRune, 0) + amount
  return reply(base, playerView(p))
end

H["Pass.BeginUnbond"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end
  local pass = EconomyEngine.ensurePass(EconomyState, p, address, timestamp)
  if int(pass.bond, 0) <= 0 then return fail(base, "This pass has no Rune bond") end
  if pass.unbond then return fail(base, "Unbonding is already in progress") end
  pass.unbond = {
    amount = int(pass.bond, 0), requestedAt = timestamp,
    readyAt = timestamp + int(EconomyState.policy.runeRewards.unbondDelay, 30 * 86400000),
  }
  return reply(base, playerView(p))
end

H["Pass.CompleteUnbond"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = address and Players[address]
  local denied = requireAccess(base, p)
  if denied then return denied end
  local pass = EconomyEngine.ensurePass(EconomyState, p, address, timestamp)
  if not pass.unbond then return fail(base, "No Rune unbond is in progress") end
  if timestamp < int(pass.unbond.readyAt, 0) then return fail(base, "The Rune bond is still locked") end
  local amount = math.min(int(pass.bond, 0), int(pass.unbond.amount, 0))
  pass.bond = int(pass.bond, 0) - amount
  pass.unbond = nil
  EconomyState.policy.runeRewards.bondedRune = math.max(0,
    int(EconomyState.policy.runeRewards.bondedRune, 0) - amount)
  grant(p, "rune", amount)
  return reply(base, playerView(p))
end

H["Monster.Feed"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  local m, why = resolveRosterMonster(p, msg)
  if not m then return fail(base, why or "No companion to feed") end
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
  local m, why = resolveRosterMonster(p, msg)
  if not m then return fail(base, why or "No companion") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end
  local occupied = activityConflict(p, m.id)
  if occupied then return fail(base, occupied) end

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
  local m, why = resolveRosterMonster(p, msg)
  if not m then return fail(base, why or "No companion") end
  if not isHome(m) then return fail(base, "Your companion is busy: " .. m.status.type) end
  local occupied = activityConflict(p, m.id)
  if occupied then return fail(base, occupied) end

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
  local m, why = resolveRosterMonster(p, msg)
  if not m then return fail(base, why or "No companion") end

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

  -- The Rune cost of the level being ENTERED, checked before anything is spent
  -- and before the allocation is validated, so a refusal here leaves the
  -- account exactly as it was.
  local nextLevel = (m.level or 0) + 1
  local levelCost = C.levelUpCost(nextLevel)
  if itemCount(p, "rune") < levelCost then
    return fail(base, "Levelling to " .. string.format("%d", nextLevel) .. " costs "
      .. string.format("%d", levelCost) .. " Rune")
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

  -- Charged only once every refusal above is behind us: exp, cost, and a legal
  -- allocation. `spend` is the same door every other sink uses.
  if not spend(p, "rune", levelCost) then
    return fail(base, "Levelling to " .. string.format("%d", nextLevel) .. " costs "
      .. string.format("%d", levelCost) .. " Rune")
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
--- The player's custom character.
---
--- New characters store their source recipe: six bounded style/colour pairs.
--- The browser owns the layer art and derives the walk sheet locally, so there
--- is no bitmap upload, atlas upload or gateway dependency. The old transaction
--- form remains accepted because recovered players already own those sheets.
local CHARACTER_CATEGORIES = { "Hair", "Hat", "Shirt", "Pants", "Gloves", "Shoes" }

local function normaliseOutfit(value)
  if type(value) ~= "table" then return nil, "Body must be a character outfit object" end
  local result = {}
  for _, category in ipairs(CHARACTER_CATEGORIES) do
    local piece = value[category]
    if type(piece) ~= "table" then
      return nil, "Missing character layer " .. category
    end
    local style = piece.style
    local color = piece.color
    if type(style) ~= "string" or #style < 1 or #style > 48
       or string.match(style, "^[%w _%-]+$") == nil then
      return nil, category .. " style must be 1-48 letters, numbers, spaces, underscores or dashes"
    end
    if type(color) ~= "string" or string.match(color, "^#%x%x%x%x%x%x$") == nil then
      return nil, category .. " color must be #rrggbb"
    end
    result[category] = { style = style, color = string.lower(color) }
  end
  return result, nil
end

H["Sprite.Update"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if not C.CHARACTER_CUSTOMISER_ENABLED then
    return fail(base, "The character creator is parked for the economy launch")
  end

  local body = bodyOf(msg)
  if body ~= "" then
    local decoded, value = pcall(json.decode, body)
    if not decoded then return fail(base, "Body must be valid JSON") end
    local outfit, problem = normaliseOutfit(value)
    if problem then return fail(base, problem) end
    p.outfit = outfit
    return reply(base, playerView(p))
  end

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

  -- Rune no longer scales per wallet. EconomyEngine allocates from one fixed
  -- global epoch budget and applies maturity plus the rolling net-account cap.
  -- The policy defaults paused until the open emission/weighting decision is
  -- approved; the worship and its loot box still resolve normally.
  local runes, runeRewardReason = EconomyEngine.claimRuneReward(
    EconomyState, p, address, timestamp)

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
  if runes > 0 then grant(p, "rune", runes) end
  addLootboxes(p, C.DAILY.lootboxes, C.DAILY.lootboxRarity)

  local v = playerView(p)
  v.dailyClaimed = {
    runes = runes,
    runeRewardReason = runeRewardReason,
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

--- Rune coming back IN, keyed by the token's burn reference.
---
--- The mirror of `Withdrawals`, and it is a ledger for the same reason: the
--- token has already destroyed the supply by the time this process hears about
--- it, so the credit here is the only thing that gives it back. A notice
--- delivered twice would pay for a burn that happened once, and there is no
--- second source to reconcile against — so the reference is remembered and a
--- repeat is recognised rather than acted on.
Deposits = Deposits or {}

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
        -- The token's handler is named `Mint`, so this says `Mint`. It used to
        -- say `mint`, the token's dispatcher matched on the exact string, and
        -- the result was the worst shape a bug can take: the deduction here
        -- succeeded and the mint there answered "unknown action", so the rune
        -- left the player and never arrived. The token now also matches
        -- case-insensitively, which is the real fix; this is the name being
        -- right as well as tolerated.
        action = "Mint",
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
--- The token confirming a mint landed. This closes the withdrawal.
---
--- The other half of `Rune.Withdraw`. This process deducts and asks; the token
--- mints and says so; this marks the row settled. Until it existed a withdrawal
--- stayed `pending` for good, because a Lua process cannot fetch and nothing
--- was telling it.
---
--- Only the configured Rune token may call it, and only through an attested
--- delivery — a wallet signing a message that merely SAYS `from-process` is the
--- token gets nothing, because `sourceProcess` believes an origin only when
--- this process's own scheduler vouched for it.
---
--- It settles a row; it never moves value. Even a forged confirmation could at
--- worst mark something settled that was not, which is why the refund half
--- stays an owner action.
H["Rune.Minted"] = function(base, msg, timestamp)
  local from = sourceProcess(msg, base)
  if not from or RuneToken == "" or from ~= RuneToken then
    return fail(base, "Not authorised")
  end

  local id = msg.Reference or msg.reference
  local w = Withdrawals[type(id) == "string" and id or ""]
  if not w then return fail(base, "No such withdrawal") end
  -- Idempotent: a delivery that arrives twice is the same one. The `reference`
  -- exists precisely so the second is recognisable rather than acted on.
  if w.status ~= "pending" then
    return reply(base, { withdrawal = w, unchanged = true })
  end

  -- The token is the authority on the amount it minted. A confirmation that
  -- disagrees with what was deducted is not a settlement, it is a bug worth
  -- seeing rather than papering over.
  local minted = int(msg.Quantity, -1)
  if minted >= 0 and minted ~= int(w.amount, 0) then
    return fail(base, "Confirmed " .. string.format("%d", minted)
      .. " against a withdrawal of " .. string.format("%d", int(w.amount, 0)))
  end

  w.status = "minted"
  w.settledAt = timestamp
  return reply(base, { withdrawal = w })
end

--- The token telling us somebody burned their Rune. This is a DEPOSIT.
---
--- Withdrawing and depositing are not symmetrical, and the asymmetry is the
--- whole reason this handler is delicate.
---
--- Going out, this process moves first: it deducts, then asks the token to
--- mint. If the mint never lands the player is short, which is bad, but nothing
--- was created out of nothing and the row sits there as `pending` saying so.
---
--- Coming back, the TOKEN moves first. The supply is already destroyed by the
--- time this message exists, so the credit here is not a bookkeeping update —
--- it is the only thing that gives the value back, and there is no second
--- source to reconcile against afterwards. Which means both failure directions
--- are real: not crediting loses the player's Rune, and crediting twice mints
--- Rune that nobody burned.
---
--- So three things guard it, and none of them is optional:
---
---   * the sender must be the configured token, established by `sourceProcess`
---     — an attested delivery, not a `from-process` field the message merely
---     claims. A wallet that could forge this could print Rune at will.
---   * the notice must carry a `Reference`, and each one is credited once. The
---     token issues it from its own burn counter.
---   * the account is taken from the NOTICE, not from the signer. The signer of
---     a delivered message is the scheduler; the person who burned is named in
---     the body, and the token is the authority on who that was.
H["Burn-Notice"] = function(base, msg, timestamp)
  local from = sourceProcess(msg, base)
  if not from or RuneToken == "" or from ~= RuneToken then
    return fail(base, "Not authorised")
  end

  local reference = msg.Reference or msg.reference
  if type(reference) ~= "string" or reference == "" then
    -- Refuse rather than credit. A notice with no reference cannot be made
    -- idempotent, and paying out something that might arrive again is the one
    -- outcome worse than refusing a legitimate deposit -- which stays visible
    -- and can be settled by the owner.
    return fail(base, "A burn notice must carry a Reference")
  end
  local seen = Deposits[reference]
  if seen then
    -- Already paid. Say so plainly rather than erroring: a repeat delivery is
    -- expected behaviour from a network that does not promise exactly-once.
    return reply(base, { deposit = seen, unchanged = true })
  end

  local account = msg.Account or msg.account
  if type(account) ~= "string" or #account ~= 43 then
    return fail(base, "Burn notice names no account")
  end
  local amount = int(msg.Quantity, 0)
  if amount <= 0 then
    return fail(base, "A deposit must be a positive whole number of Rune")
  end

  local p = getPlayer(account, timestamp)
  grant(p, "rune", amount)
  Deposits[reference] = {
    id = reference,
    address = account,
    amount = amount,
    status = "credited",
    creditedAt = timestamp,
  }
  -- The depositor did not sign this -- the scheduler delivered it -- so their
  -- record has to be republished or the Rune does not appear until they act.
  touchAlso(account)
  return reply(base, { deposit = Deposits[reference], player = playerView(p) })
end

--- Every deposit this wallet has been credited, readable without signing.
H["Rune.Deposits"] = function(base, msg)
  local address = signer(msg)
  local mine = {}
  for _, d in pairs(Deposits) do
    if d.address == address then mine[#mine + 1] = d end
  end
  return reply(base, { deposits = mine, token = RuneToken })
end

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
  -- A box that rolls nothing feels broken, but Rune issuance is globally
  -- bounded and may never hide in per-box RNG. The floor is one faction berry.
  if #rewards == 0 then
    local faction = C.FACTION_BY_NAME[p.faction or ""]
    local floorItem = faction and faction.berry or "air_berry"
    grant(p, floorItem, 1)
    rewards[#rewards + 1] = {
      item = floorItem, name = C.ITEMS[floorItem].name, amount = 1,
    }
  end

  local v = playerView(p)
  v.lootResult = { rarity = rarity, rewards = rewards }
  return reply(base, v)
end

-- Hunt authority -------------------------------------------------------------

local HUNT_PROTOCOL = "runerealm-hunt/1"
local HUNT_BERRIES = { "fire_berry", "water_berry", "air_berry", "rock_berry" }

local function huntEntryCosts()
  local configured = C.HUNT and C.HUNT.entry and C.HUNT.entry.berries or {}
  local costs = {}
  for _, item in ipairs(HUNT_BERRIES) do
    costs[item] = math.max(0, int(configured[item], 5))
  end
  return costs
end

local function huntEntryProblem(player, costs)
  local missing = {}
  for _, item in ipairs(HUNT_BERRIES) do
    local short = costs[item] - itemCount(player, item)
    if short > 0 then
      local name = C.ITEMS[item] and C.ITEMS[item].name or item
      missing[#missing + 1] = string.format("%d %s", short, name)
    end
  end
  if #missing == 0 then return nil end
  return "Hunting costs 5 of each berry; missing " .. table.concat(missing, ", ")
end

local function huntReply(base, value, outbox)
  reply(base, value)
  if outbox then base.results.outbox = outbox end
  return base
end

--- Every configured hunt process, first-to-last, with the legacy single
--- process first so an unconfigured fleet still routes.
local function huntFleet()
  local fleet = {}
  if HuntProcess ~= "" then
    fleet[#fleet + 1] = { processId = HuntProcess, node = HuntNode ~= "" and HuntNode or nil }
  end
  for _, entry in ipairs(HuntProcesses) do
    if type(entry) == "table" and type(entry.processId) == "string" and entry.processId ~= ""
       and entry.processId ~= HuntProcess then
      fleet[#fleet + 1] = { processId = entry.processId, node = entry.node }
    end
  end
  return fleet
end

local function isHuntProcess(id)
  if type(id) ~= "string" or id == "" then return false end
  for _, entry in ipairs(huntFleet()) do
    if entry.processId == id then return true end
  end
  return false
end

--- Pick the worker for a new run. Deterministic in the run sequence rather than
--- random, so a replayed Hunt.Begin lands on the same worker instead of opening
--- a second run somewhere else, and so the spread does not depend on a clock.
local function assignHuntProcess(sequence)
  local fleet = huntFleet()
  if #fleet == 0 then return nil end
  return fleet[(sequence % #fleet) + 1]
end

local function huntNotice(base, msg)
  if HuntProcess == "" then return nil, "Hunting is not configured" end
  -- Membership only. WHICH worker may act on a given run is a stricter question
  -- and is answered per run by `huntRunFor` below, because any fleet member
  -- passes this check.
  if not isHuntProcess(sourceProcess(msg, base)) then
    return nil, "Untrusted Hunt process"
  end
  local raw = bodyOf(msg)
  local payload = {}
  if raw ~= "" then
    local ok, decoded = pcall(json.decode, raw)
    if not ok or type(decoded) ~= "table" then return nil, "Hunt data must be a JSON object" end
    payload = decoded
  end
  if payload.protocol and payload.protocol ~= HUNT_PROTOCOL then
    return nil, "Unsupported hunt protocol"
  end
  return payload
end

local function huntMessage(action, route, data)
  local message = {
    -- The run's OWN worker, never the global. With more than one process in the
    -- fleet, targeting `HuntProcess` would send every player's actions to the
    -- first worker and quietly undo the split.
    target = route.processId ~= nil and route.processId ~= "" and route.processId or HuntProcess,
    action = action,
    protocol = HUNT_PROTOCOL,
    reference = route.runId .. "-" .. string.lower(string.gsub(action, "Hunt%.", "")),
    ["run-id"] = route.runId,
    ["player-id"] = route.playerId,
  }
  if data then message.data = encode(data) end
  return message
end

--- Freeze one roster companion and open its authoritative roaming session.
--- Naming MonsterId is what makes Hunt an action available to every owned
--- roster monster rather than only whichever one happened to be active.
local function openHuntReply(base, p, route, monster)
  local v = playerView(p)
  return huntReply(base, v, { hunt = huntMessage("Hunt.Open", route, {
    protocol = HUNT_PROTOCOL, runId = route.runId, ticket = route.ticket,
    playerId = route.playerId, monsterId = route.monsterId,
    monster = withMoves(Battle.clone(monster)),
  }) })
end

H["Hunt.Begin"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if HuntProcess == "" then return fail(base, "Hunting is not configured yet") end
  if p.hunt then
    -- A failed recursive push can leave the authoritative lock in "opening"
    -- even though the browser never reached the Hunt worker. Re-submitting the
    -- same begin is a delivery retry: same route, same ticket, no second lock.
    if p.hunt.status == "opening"
       and (msg.MonsterId == nil or msg.MonsterId == p.hunt.monsterId) then
      local openingMonster = findMonster(p, p.hunt.monsterId)
      if openingMonster and openingMonster.status
         and openingMonster.status.type == "Hunt" then
        return openHuntReply(base, p, p.hunt, openingMonster)
      end
    end
    return fail(base, "You already have an open hunt")
  end
  if p.activeBattleId then return fail(base, "Finish your battle first") end

  local monster, why = resolveRosterMonster(p, msg)
  if not monster then return fail(base, why) end
  if not isHome(monster) then return fail(base, "Your companion is busy: " .. monster.status.type) end
  local occupied = activityConflict(p, monster.id)
  if occupied then return fail(base, occupied) end

  -- Resolve every refusal before spending anything. The four-berry offering is
  -- one price and must be atomic: a wallet that is short one Rock Berry keeps
  -- all fifteen of the others. Retrying an already-open route returns above
  -- and therefore never charges the entry offering twice.
  local entryCosts = huntEntryCosts()
  local entryProblem = huntEntryProblem(p, entryCosts)
  if entryProblem then return fail(base, entryProblem) end

  local nextSequence = HuntSeq + 1
  local assigned = assignHuntProcess(nextSequence)
  if not assigned then return fail(base, "Hunting is not configured yet") end
  for _, item in ipairs(HUNT_BERRIES) do spend(p, item, entryCosts[item]) end
  setActive(p, monster.id)

  HuntSeq = nextSequence
  local runId = "h" .. string.format("%d", HuntSeq)
  local ticket = runId .. "_" .. address
  local route = {
    protocol = HUNT_PROTOCOL, status = "opening", runId = runId,
    ticket = ticket, playerId = address, monsterId = monster.id,
    processId = assigned.processId, node = assigned.node,
    openedAt = timestamp,
  }
  p.hunt = route
  monster.status = { type = "Hunt", since = timestamp, until_time = 0 }
  return openHuntReply(base, p, route, monster)
end

--- Resolve the player whose run this notice is about, and prove the sender is
--- the worker that run was assigned to.
---
--- Membership in the fleet is not enough. Without this, hunt worker 2 could
--- settle a run that worker 1 owns -- claiming a capture the player never
--- earned, or releasing a companion mid-roll -- and every worker is a separate
--- public process, so that is a real reachable path rather than a theoretical
--- one. Runs opened before the fleet existed carry no processId and fall back
--- to fleet membership, which is what they were written under.
local function huntRunFor(base, msg, payload)
  local address = payload.playerId or msg.PlayerId or msg["player-id"]
  local runId = payload.runId or msg.RunId or msg["run-id"]
  local p = address and Players[address]
  if not p then return nil, nil, nil, "Hunt player not found" end
  local route = p.hunt
  if route and route.runId == runId and type(route.processId) == "string"
     and route.processId ~= "" and sourceProcess(msg, base) ~= route.processId then
    return nil, nil, nil, "Hunt process is not assigned to this run"
  end
  return p, address, runId, nil
end

H["Hunt.Opened"] = function(base, msg)
  local payload, why = huntNotice(base, msg)
  if not payload then return fail(base, why) end
  local p, address, runId, denied = huntRunFor(base, msg, payload)
  if denied then return fail(base, denied) end
  if not p.hunt or p.hunt.runId ~= runId then
    return fail(base, "Hunt route not found")
  end
  p.hunt.status = "roaming"
  touchAlso(address)
  return reply(base, playerView(p))
end

--- The Hunt process has serially closed the run. Only that process can thaw
--- the companion, which prevents a player from escaping a pending capture roll.
H["Hunt.Released"] = function(base, msg, timestamp)
  local payload, why = huntNotice(base, msg)
  if not payload then return fail(base, why) end
  local p, address, runId, denied = huntRunFor(base, msg, payload)
  if denied then return fail(base, denied) end
  if p.hunt and p.hunt.runId == runId then
    local monster = findMonster(p, p.hunt.monsterId)
    if monster and monster.status and monster.status.type == "Hunt" then
      monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
    p.hunt = nil
  end
  touchAlso(address)
  return reply(base, playerView(p))
end

--- Charge the player's Rune bid, then materialise the already-rolled wild
--- creature in collection on success. The bid is paid on failure too: those
--- Runes were committed to the one binding attempt.
H["Hunt.Settle"] = function(base, msg, timestamp)
  local payload, why = huntNotice(base, msg)
  if not payload then return fail(base, why) end
  local settlementId = payload.settlementId or msg.SettlementId or msg["settlement-id"]
  local address = payload.playerId or msg.PlayerId or msg["player-id"]
  local runId = payload.runId or msg.RunId or msg["run-id"]
  if type(settlementId) ~= "string" or settlementId == ""
     or type(address) ~= "string" or type(runId) ~= "string" then
    return fail(base, "Capture settlement identity is invalid")
  end
  local p = Players[address]
  if not p or not p.hunt or p.hunt.runId ~= runId then
    return fail(base, "Capture does not match an open hunt")
  end
  -- The settlement grants a companion, so this is the binding that matters most:
  -- only the worker this run was assigned to may claim its capture.
  if type(p.hunt.processId) == "string" and p.hunt.processId ~= ""
     and sourceProcess(msg, base) ~= p.hunt.processId then
    return fail(base, "Hunt process is not assigned to this run")
  end
  local prior = HuntSettlements[settlementId]
  if prior then
    if prior.playerId ~= address or prior.runId ~= runId then
      return fail(base, "Settlement id belongs to another capture")
    end
    local ack = huntMessage("Hunt.Settled", p.hunt)
    ack["settlement-id"] = settlementId
    return huntReply(base, playerView(p), { acknowledgement = ack })
  end

  local runeBid = int(payload.runeBid, 0)
  local chance = int(payload.chance, 0)
  local roll = int(payload.roll, 0)
  local success = payload.success == true
  local capture = (C.HUNT and C.HUNT.capture) or {}
  if runeBid < (capture.minRuneBid or 1) or runeBid > (capture.maxRuneBid or 5)
     or chance < (capture.minChance or 5) or chance > (capture.maxChance or 95)
     or roll < 1 or roll > 100 or success ~= (roll <= chance) then
    return fail(base, "Capture roll is invalid")
  end
  if itemCount(p, "rune") < runeBid then
    return fail(base, "You do not hold enough Runes for that capture bid")
  end

  local captured
  if success then
    captured, why = createCapturedMonster(payload.monster, timestamp)
    if not captured then return fail(base, why) end
  end
  spend(p, "rune", runeBid)
  if captured then addToCollection(p, captured) end

  local receipt = {
    settlementId = settlementId, runId = runId, playerId = address,
    success = success, chance = chance, roll = roll, runesSpent = runeBid,
    monster = captured and withMoves(Battle.clone(captured)) or nil,
    settledAt = timestamp,
  }
  HuntSettlements[settlementId] = receipt
  p.hunt.status = "roaming"
  p.hunt.lastCapture = receipt
  touchAlso(address)
  local v = playerView(p)
  v.huntCapture = Battle.clone(receipt)
  local ack = huntMessage("Hunt.Settled", p.hunt)
  ack["settlement-id"] = settlementId
  return huntReply(base, v, { acknowledgement = ack })
end

-- Combat --------------------------------------------------------------------

local function nextBattleId()
  BattleSeq = BattleSeq + 1
  return string.format("b%d", BattleSeq)
end

--- The arena never mutates a companion's permanent build. A session berry is
--- folded into the self-contained copy handed to Battle, PvP, or a fleet
--- worker, and the copy carries a receipt so the client can explain the boost.
local function battleMonster(p)
  if not p or not p.monster then return nil end
  local monster = Battle.clone(p.monster)
  local active = p.arenaBoost
  local berry = active and C.BATTLE_BERRIES[active.item or ""]
  if berry then
    local stat = berry.stat
    monster[stat] = int(monster[stat], 0) + int(berry.amount, 0)
    monster.battleBoost = {
      item = berry.item,
      stat = stat,
      amount = int(berry.amount, 0),
      cost = int(berry.cost, 0),
    }
  end
  return monster
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
  -- When it finished, which is what `pruneBattles` sorts on. `Battle.resolve`
  -- sets the status but has no clock; this is the one place every real fight
  -- passes through on its way to being over.
  b.endedAt = b.endedAt or timestamp
  BattlesCompleted = BattlesCompleted + 1
  local winnerSide = b.winner

  local function payout(addr, won)
    local other = addr and Players[addr]
    if not other then return end
    -- Both sides are paid, and at most one of them signed the message that
    -- settled the fight. This clears `activeBattleId`, which is also what
    -- `compute` looks at to decide whether to republish an opponent — so by
    -- the time it looks, a forfeited fight has no live battle to find the
    -- winner through, and the winner's key would keep the fight in it.
    touchAlso(addr)
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
    if (other.battlesRemaining or 0) <= 0 then
      if other.monster and other.monster.status.type == "Battle" then
        other.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
      end
      other.arenaBoost = nil
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
  local occupied = activityConflict(p, m.id)
  if occupied then return fail(base, occupied) end

  local cfg = C.ACTIVITIES.battle
  local berryId = msg.Item
  local berry = berryId and C.BATTLE_BERRIES[berryId] or nil
  if berryId and not berry then return fail(base, "That is not a battle berry") end
  if m.energy < cfg.energyCost then return fail(base, "Not enough energy") end
  if m.happiness < cfg.happinessCost then return fail(base, "Not happy enough") end
  if berry and itemCount(p, berryId) < int(berry.cost, 0) then
    return fail(base, "You need " .. berry.cost .. " " .. C.ITEMS[berryId].name)
  end
  if not spend(p, cfg.cost.item, cfg.cost.amount) then
    return fail(base, "Entering the arena costs " .. cfg.cost.amount .. " " .. C.ITEMS[cfg.cost.item].name)
  end
  if berry then spend(p, berryId, int(berry.cost, 0)) end

  m.energy = m.energy - cfg.energyCost
  m.happiness = m.happiness - cfg.happinessCost
  m.status = { type = "Battle", since = timestamp, until_time = 0 }
  p.arenaBoost = berry and {
    item = berry.item, stat = berry.stat, amount = int(berry.amount, 0),
    cost = int(berry.cost, 0),
  } or nil
  p.battlesRemaining = C.BATTLES_PER_SESSION
  p.sessionWins = 0
  p.sessionLosses = 0
  return reply(base, playerView(p))
end

local requestFleetCancellation

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

  -- A fleet fight is owned by another sequential actor. Leaving requests a
  -- two-process cancellation; it never clears/refunds locally. Only the
  -- scheduler-attested Battle.Fleet.Cancelled notice may return the reserved
  -- session credit.
  if FLEET_ENABLED and p.battleFleet then
    return requestFleetCancellation(base, p, "player-left", timestamp, false)
  end

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
  p.arenaBoost = nil
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

--- Forget fights nobody is looking at any more.
---
--- `Battles` was append-only: the single deletion in the file removes a PENDING
--- challenge nobody took, so every fight ever fought stayed in memory for the
--- life of the process. A finished battle measures about four kilobytes and the
--- worst of them nine, three quarters of which is `turns` -- a per-round log
--- carrying a ten-field snapshot of BOTH combatants for every swing, up to the
--- thirty-round cap. Ten thousand fights is forty megabytes of Lua heap that
--- nothing reads, and the node photographs the whole heap on every slot.
---
--- What is kept, and why it is kept at all rather than dropped on settle:
---
---   * every battle that has not ended -- obviously.
---   * every ended battle younger than `RETAIN_ENDED_MS`. The client animates
---     the closing round out of `turns` and then shows a result screen built
---     from the same log, so a fight has to survive its own ending. Dropping
---     `turns` in `settleBattle` would blank the last swing of every fight.
---   * failing that, the `RETAIN_ENDED_MAX` most recently ended. This is the
---     backstop that makes the bound hold regardless of how many fights land
---     inside the window.
---
--- Called when a battle is CREATED, so the message that ends a fight never
--- prunes the fight it just ended.
local RETAIN_ENDED_MS = 30 * 60 * 1000
local RETAIN_ENDED_MAX = 100

local function pruneBattles(timestamp)
  local ended = {}
  for id, b in pairs(Battles) do
    if b.status == "ended" then
      ended[#ended + 1] = { id = id, at = int(b.endedAt, 0) }
    end
  end
  if #ended <= RETAIN_ENDED_MAX then
    -- Still under the cap: only age can evict, and only from a clock we have.
    if int(timestamp, 0) <= 0 then return end
    for _, row in ipairs(ended) do
      -- An ended battle with no `endedAt` predates the stamp above and is by
      -- definition older than anything we would keep.
      if row.at == 0 or (timestamp - row.at) > RETAIN_ENDED_MS then
        Battles[row.id] = nil
      end
    end
    return
  end
  -- Over the cap. Newest first, and everything past the cap goes regardless of
  -- age -- the bound is the point.
  table.sort(ended, function(x, y)
    if x.at ~= y.at then return x.at > y.at end
    return x.id > y.id
  end)
  for i = 1, #ended do
    local row = ended[i]
    if i > RETAIN_ENDED_MAX
       or row.at == 0
       or (int(timestamp, 0) > 0 and (timestamp - row.at) > RETAIN_ENDED_MS) then
      Battles[row.id] = nil
    end
  end
end

-- Battle fleet authority ----------------------------------------------------

--- Seal the worker allowlist exactly once after a clean game spawn. This
--- breaks the otherwise circular bootstrap (workers need the game pid; the
--- game needs worker pids) without making routes mutable. An exact replay is
--- idempotent; any different second manifest is refused forever.
H["Admin.ConfigureBattleFleet"] = function(base, msg)
  if not FLEET_CAPABLE then return fail(base, "Battle fleet capability is disabled") end
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  local raw = bodyOf(msg)
  local ok, decoded = pcall(json.decode, raw)
  if not ok then return fail(base, "Battle fleet manifest Data must be JSON") end
  local config, why = normalizeFleetConfig(decoded)
  if not config then return fail(base, why) end
  local fingerprint = encode(config)
  if BattleFleetSealedConfig then
    if fingerprint ~= BattleFleetConfigFingerprint then
      return fail(base, "Battle fleet manifest is already sealed")
    end
    return reply(base, {
      configured = true, duplicate = true, protocol = FLEET_PROTOCOL,
      workers = #FLEET_WORKERS,
    })
  end

  BattleFleetSealedConfig = config
  BattleFleetConfigFingerprint = fingerprint
  FLEET_CFG, FLEET_WORKERS, FLEET_ENABLED = config, config.workers, true
  BattleFleetAuthorityState = FLEET_AUTHORITY.newState({
    maxEntries = config.maxEntries,
    replayWindow = config.replayWindow,
    auditLimit = config.auditLimit,
  })
  return reply(base, {
    configured = true, duplicate = false, protocol = FLEET_PROTOCOL,
    workers = #FLEET_WORKERS,
  })
end

local function fleetValidId(value, maxLength)
  return type(value) == "string" and #value > 0 and #value <= maxLength
    and string.find(value, "[^%w_%-]", 1) == nil
end

local function fleetWorkerByProcess(processId)
  for _, worker in ipairs(FLEET_WORKERS) do
    if type(worker) == "table" and worker.workerProcessId == processId
       and type(worker.workerId) == "string" and worker.workerId ~= "" then
      return worker
    end
  end
  return nil
end

local function fleetWorkerFor(sequence)
  if not FLEET_ENABLED then return nil end
  local worker = FLEET_WORKERS[((sequence - 1) % #FLEET_WORKERS) + 1]
  if type(worker) ~= "table"
     or type(worker.workerId) ~= "string" or worker.workerId == ""
     or type(worker.workerProcessId) ~= "string" or #worker.workerProcessId ~= 43 then
    return nil
  end
  return worker
end

local function fleetRoute(reservation, status)
  return {
    protocol = FLEET_PROTOCOL,
    status = status or reservation.status,
    battleId = reservation.battleId,
    reservationId = reservation.reservationId,
    assignmentId = reservation.assignmentId,
    ticket = reservation.ticket,
    workerId = reservation.workerId,
    workerProcessId = reservation.workerProcessId,
    node = FLEET_CFG.node,
  }
end

local function fleetOpenMessage(reservation, authorityTimestamp)
  local message = {
    target = reservation.workerProcessId,
    action = "Battle.Open",
    protocol = FLEET_PROTOCOL,
    reference = reservation.assignmentId,
    ["worker-id"] = reservation.workerId,
    ["battle-id"] = reservation.battleId,
    ["reservation-id"] = reservation.reservationId,
    ["assignment-id"] = reservation.assignmentId,
    ["player-id"] = reservation.playerId,
    ["authority-timestamp"] = authorityTimestamp or reservation.issuedAt,
    data = encode({
      protocol = FLEET_PROTOCOL,
      battleId = reservation.battleId,
      reservationId = reservation.reservationId,
      assignmentId = reservation.assignmentId,
      ticket = reservation.ticket,
      playerId = reservation.playerId,
      issuedAt = reservation.issuedAt,
      expiresAt = reservation.expiresAt,
      difficulty = reservation.difficulty,
      opponentFaction = reservation.opponentFaction,
      monster = reservation.monster,
    }),
  }
  -- Recovery of a cancellation whose original Open may have been lost keeps
  -- the Open Data byte-for-byte identical and adds the authority's stable
  -- cancel intent as authenticated scalar routing fields. An unseen worker can
  -- finalize it as a never-opened refund; a worker with a retained outcome
  -- re-emits that outcome and the reconciler follows the matching path.
  if reservation.status == "cancel-pending" then
    message["cancel-id"] = reservation.cancelId
    message["cancel-reason"] = reservation.cancelReason
  end
  return message
end

local function fleetReply(base, value, outbox)
  reply(base, value)
  if outbox then base.results.outbox = outbox end
  return base
end

local function fleetNotice(msg, base)
  local source = sourceProcess(msg, base)
  if not source or not fleetWorkerByProcess(source) then
    return nil, nil, "Untrusted battle worker process"
  end
  local raw = bodyOf(msg)
  local ok, payload = pcall(json.decode, raw)
  if not ok or type(payload) ~= "table" then
    return nil, nil, "Battle worker notice Data must be JSON"
  end
  return payload, source, nil
end

local fleetRefund

requestFleetCancellation = function(base, player, reason, timestamp, expiryOnly)
  local route = player and player.battleFleet
  if not route then return fail(base, "No active fleet battle") end
  local reservation = BattleFleetAuthorityState.reservations[route.reservationId]
  if not reservation then return fail(base, "Fleet reservation is not active") end
  if expiryOnly and timestamp < int(reservation.expiresAt, 0) then
    return fail(base, "Fleet reservation has not expired")
  end
  local cancelId = reservation.cancelId or ("fc" .. string.format("%d", reservation.sequence))
  local pending, duplicate = FLEET_AUTHORITY.requestCancel(
    BattleFleetAuthorityState, reservation.reservationId, cancelId, reason, timestamp)
  if not pending then return fail(base, duplicate) end
  player.battleFleet = fleetRoute(pending, "cancel-pending")
  local action = expiryOnly and "Battle.Expire" or "Battle.Cancel"
  return fleetReply(base, playerView(player), { cancellation = {
    target = pending.workerProcessId,
    action = action,
    protocol = FLEET_PROTOCOL,
    reference = cancelId,
    battleid = pending.battleId,
    reservationid = pending.reservationId,
    ticket = pending.ticket,
    cancelid = cancelId,
    reason = pending.cancelReason,
    ["authority-timestamp"] = timestamp,
  } })
end

H["Admin.ExpireFleetBattle"] = function(base, msg, timestamp)
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  local reservation = msg.ReservationId
    and BattleFleetAuthorityState and BattleFleetAuthorityState.reservations[msg.ReservationId]
  local p = reservation and Players[reservation.playerId]
  if not p then return fail(base, "Active fleet reservation not found") end
  touchAlso(reservation.playerId)
  return requestFleetCancellation(base, p, msg.Reason or "expired", timestamp, true)
end

H["Admin.RetryFleetCancel"] = function(base, msg, timestamp)
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  local reservation = msg.ReservationId
    and BattleFleetAuthorityState and BattleFleetAuthorityState.reservations[msg.ReservationId]
  local p = reservation and Players[reservation.playerId]
  if not p or reservation.status ~= "cancel-pending" then
    return fail(base, "Cancel-pending fleet reservation not found")
  end
  touchAlso(reservation.playerId)
  return requestFleetCancellation(base, p, reservation.cancelReason or "operator-retry",
    timestamp, false)
end

--- Replay the exact immutable Open for a reservation whose worker notice was
--- lost. The authority, not the operator, supplies every assignment field;
--- the worker's idempotency ledger then re-emits the same Opened/OpenRejected
--- outcome. A cancellation in progress must never be moved backwards.
H["Admin.RetryFleetOpen"] = function(base, msg, timestamp)
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  local reservation = msg.ReservationId
    and BattleFleetAuthorityState and BattleFleetAuthorityState.reservations[msg.ReservationId]
  if not reservation then return fail(base, "Active fleet reservation not found") end
  if reservation.status ~= "reserved" and reservation.status ~= "open"
     and reservation.status ~= "cancel-pending" then
    return fail(base, "Fleet reservation cannot retry Open from status "
      .. tostring(reservation.status))
  end
  return fleetReply(base, {
    reservationId = reservation.reservationId,
    battleId = reservation.battleId,
    assignmentId = reservation.assignmentId,
    retried = true,
    status = reservation.status,
  }, { open = fleetOpenMessage(reservation, timestamp) })
end

H["Admin.ForceResolveFleetBattle"] = function(base, msg, timestamp)
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  local raw = bodyOf(msg)
  local ok, request = pcall(json.decode, raw)
  if not ok or type(request) ~= "table" then
    return fail(base, "Force resolution Data must be JSON")
  end
  local reservation = request.reservationId and BattleFleetAuthorityState
    and (BattleFleetAuthorityState.reservations[request.reservationId]
      or BattleFleetAuthorityState.finalized[request.reservationId])
  local p = reservation and Players[reservation.playerId]
  if not p then return fail(base, "Fleet reservation player not found") end
  local effect, duplicate = FLEET_AUTHORITY.forceResolve(
    BattleFleetAuthorityState, request, signer(msg), Owner, timestamp)
  if not effect then return fail(base, duplicate) end
  if duplicate ~= true then fleetRefund(p, effect, timestamp) end
  touchAlso(effect.playerId)
  local v = playerView(p)
  v.fleetForceResolutionId = effect.resolutionId
  v.fleetDuplicate = duplicate == true
  return reply(base, v)
end

H["Admin.RetryFleetAck"] = function(base, msg, timestamp)
  if not isOwner(signer(msg)) then return fail(base, "Not authorised") end
  if type(FLEET_AUTHORITY.deliveryAck) ~= "function" then
    return fail(base, "Battle fleet authority does not support ACK recovery")
  end
  local ack, why = FLEET_AUTHORITY.deliveryAck(
    BattleFleetAuthorityState, msg.ReservationId)
  if not ack then return fail(base, why) end
  ack["authority-timestamp"] = timestamp
  return fleetReply(base, {
    reservationId = msg.ReservationId, retried = true, action = ack.action,
  }, { acknowledgement = ack })
end

fleetRefund = function(player, effect, timestamp)
  local refund = effect and effect.refund or {}
  player.battlesRemaining = (player.battlesRemaining or 0) + int(refund.battles, 0)
  if player.activeBattleId == effect.battleId then player.activeBattleId = nil end
  if player.battleFleet and player.battleFleet.reservationId == effect.reservationId then
    player.battleFleet = nil
  end
  if (player.battlesRemaining or 0) <= 0 then
    if player.monster then
      player.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
    player.arenaBoost = nil
  end
end

local function fleetSettle(player, effect, timestamp)
  local plan = effect.rewardPlan or {}
  local award = effect.result == "win" and (plan.win or {}) or (plan.loss or {})
  if effect.result == "win" then
    player.wins = (player.wins or 0) + int(award.wins, 1)
    player.sessionWins = (player.sessionWins or 0) + int(award.sessionWins, 1)
  else
    player.losses = (player.losses or 0) + int(award.losses, 1)
    player.sessionLosses = (player.sessionLosses or 0) + int(award.sessionLosses, 1)
  end
  if player.monster then
    player.monster.exp = (player.monster.exp or 0) + int(award.experience, 0)
  end
  local loot = award.lootbox
  if type(loot) == "table" and int(loot.count, 0) > 0 then
    addLootboxes(player, int(loot.count, 0), int(loot.rarity, 1))
  end
  if player.activeBattleId == effect.battleId then player.activeBattleId = nil end
  if player.battleFleet and player.battleFleet.reservationId == effect.reservationId then
    player.battleFleet = nil
  end
  if (player.battlesRemaining or 0) <= 0 then
    if player.monster then
      player.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
    player.arenaBoost = nil
  end
  BattlesCompleted = BattlesCompleted + 1
end

local function startFleetBattle(base, msg, timestamp, address, p)
  local startId = msg.StartId
  if not fleetValidId(startId, 192) then
    return fail(base, "StartId is required for a fleet battle")
  end

  -- Bound the client-id replay map to the same window as the authority's
  -- compact finals. Within that window the exact signed retry re-emits the
  -- original Open; it never spends a second session battle.
  for id, prior in pairs(BattleFleetStarts) do
    if int(prior.protectUntil, 0) < timestamp then BattleFleetStarts[id] = nil end
  end
  local prior = BattleFleetStarts[startId]
  if prior then
    if prior.playerId ~= address then return fail(base, "StartId belongs to another player") end
    local reservation = BattleFleetAuthorityState.reservations[prior.reservationId]
      or BattleFleetAuthorityState.finalized[prior.reservationId]
    local v = playerView(p)
    if reservation and not reservation.compact then
      p.battleFleet = fleetRoute(reservation, reservation.status == "open" and "battling" or "opening")
      p.activeBattleId = reservation.battleId
      v = playerView(p)
      return fleetReply(base, v, { open = fleetOpenMessage(reservation, timestamp) })
    end
    return reply(base, v)
  end

  -- A distinct client id is a new request, not a retry. Fleet battles have no
  -- row in the monolithic `Battles` table, so `startable()` cannot see them;
  -- the authority route is the durable one-battle-at-a-time lock. Keep it
  -- through opening, combat, and cancellation. Only a trusted final notice (or
  -- audited force resolution) clears it and permits another reservation.
  if p.battleFleet then return fail(base, "You are already in a battle") end

  local blocked = startable(p)
  if blocked then return fail(base, blocked) end
  -- The authority's durable high-water mark owns allocation. It accepts only
  -- the exact next sequence, so a client can neither choose nor skip ids and a
  -- restored auxiliary counter cannot drift the replay ledger.
  local sequence = int(BattleFleetAuthorityState.lastSequence, 0) + 1
  local worker = fleetWorkerFor(sequence)
  if not worker then return fail(base, "Battle fleet manifest has no valid worker") end

  local difficulty = num(msg.Difficulty, 1.0)
  if difficulty < 0.5 then difficulty = 0.5 end
  if difficulty > 2.0 then difficulty = 2.0 end
  local suffix = string.format("%d", sequence)
  local battleId = "fb" .. suffix
  local reservation = {
    sequence = sequence,
    reservationId = "fr" .. suffix,
    ticket = "ft" .. suffix .. "_" .. string.format("%d", timestamp),
    battleId = battleId,
    assignmentId = "fa" .. suffix,
    workerId = worker.workerId,
    workerProcessId = worker.workerProcessId,
    playerId = address,
    monster = battleMonster(p),
    difficulty = difficulty,
    opponentFaction = msg.OpponentFaction,
    issuedAt = timestamp,
    expiresAt = timestamp + int(FLEET_CFG.ticketTtl, 10 * 60 * 1000),
    reservedCost = { battles = 1 },
    rewardPlan = {
      win = { wins = 1, sessionWins = 1, experience = 2,
        lootbox = { count = 1, rarity = 1 } },
      loss = { losses = 1, sessionLosses = 1, experience = 1 },
    },
  }
  local stored, why = FLEET_AUTHORITY.reserve(BattleFleetAuthorityState, reservation)
  if not stored then
    return fail(base, "Battle fleet reservation failed: " .. tostring(why))
  end
  BattleFleetSeq = sequence

  -- Reserve the one session battle before Open exists. A rejected/cancelled
  -- open returns exactly this credit; a settlement never decrements it again.
  p.battlesRemaining = math.max(0, (p.battlesRemaining or 0) - 1)
  p.activeBattleId = battleId
  p.battleFleet = fleetRoute(stored, "opening")
  BattleFleetStarts[startId] = {
    reservationId = stored.reservationId,
    playerId = address,
    protectUntil = stored.expiresAt + int(FLEET_CFG.replayWindow, 60 * 60 * 1000),
  }
  return fleetReply(base, playerView(p), { open = fleetOpenMessage(stored, timestamp) })
end

--- Start a fight against the house. Resolves entirely inside this process.
H["Battle.Start"] = function(base, msg, timestamp)
  local address = signer(msg)
  local p = getPlayer(address, timestamp)
  local denied = requireAccess(base, p)
  if denied then return denied end
  if FLEET_ENABLED then return startFleetBattle(base, msg, timestamp, address, p) end
  local blocked = startable(p)
  if blocked then return fail(base, blocked) end

  local difficulty = num(msg.Difficulty, 1.0)
  if difficulty < 0.5 then difficulty = 0.5 end
  if difficulty > 2.0 then difficulty = 2.0 end

  local opponent = Battle.makeOpponent(p.monster.level or 0,
    { difficulty = difficulty, faction = msg.OpponentFaction })
  local id = nextBattleId()
  local b = Battle.new(id, battleMonster(p), address, opponent, "bot",
    { kind = "bot", timestamp = timestamp })
  Battles[id] = b
  -- Reclaim finished fights now, not when this one ends: the reply to the
  -- message that ends a battle still has to carry its own turn log.
  pruneBattles(timestamp)
  p.activeBattleId = id

  local v = playerView(p)
  v.battle = Battle.view(b)
  return reply(base, v)
end

--- Worker-originated lifecycle notices. All four authenticate the scheduler-
--- attested source process against the immutable manifest before the pure
--- authority transition sees the payload. The worker reports combat facts;
--- only this account authority owns the reward/refund plan and mutates Player.
H["Battle.Fleet.Opened"] = function(base, msg, timestamp)
  if not FLEET_ENABLED then return fail(base, "Battle fleet is disabled") end
  local payload, source, why = fleetNotice(msg, base)
  if not payload then return fail(base, why) end
  local reservation, transition = FLEET_AUTHORITY.markOpened(
    BattleFleetAuthorityState, payload, source, timestamp)
  if not reservation then return fail(base, transition) end
  local p = Players[reservation.playerId]
  if not p then return fail(base, "Reserved player no longer exists") end
  p.activeBattleId = reservation.battleId
  p.battleFleet = fleetRoute(reservation, "battling")
  touchAlso(reservation.playerId)
  local v = playerView(p)
  v.fleetDuplicate = transition == true
  return reply(base, v)
end

H["Battle.Fleet.OpenRejected"] = function(base, msg, timestamp)
  if not FLEET_ENABLED then return fail(base, "Battle fleet is disabled") end
  local payload, source, why = fleetNotice(msg, base)
  if not payload then return fail(base, why) end
  local reserved = payload.reservationId
    and BattleFleetAuthorityState.reservations[payload.reservationId]
  local playerId = reserved and reserved.playerId or payload.playerId
  local p = playerId and Players[playerId]
  if not p then return fail(base, "Reserved player no longer exists") end
  local effect, duplicate = FLEET_AUTHORITY.rejectOpen(
    BattleFleetAuthorityState, payload, source, timestamp)
  if not effect then return fail(base, duplicate) end
  if duplicate ~= true then fleetRefund(p, effect, timestamp) end
  touchAlso(effect.playerId)
  local v = playerView(p)
  v.fleetRejected = { reason = effect.reason, rejectionId = effect.rejectionId }
  v.fleetDuplicate = duplicate == true
  local ack, ackWhy = FLEET_AUTHORITY.deliveryAck(
    BattleFleetAuthorityState, effect.reservationId)
  if not ack then return fail(base, ackWhy) end
  ack["authority-timestamp"] = timestamp
  return fleetReply(base, v, { acknowledgement = ack })
end

H["Battle.Fleet.Settle"] = function(base, msg, timestamp)
  if not FLEET_ENABLED then return fail(base, "Battle fleet is disabled") end
  local payload, source, why = fleetNotice(msg, base)
  if not payload then return fail(base, why) end
  local reserved = payload.reservationId
    and BattleFleetAuthorityState.reservations[payload.reservationId]
  local playerId = reserved and reserved.playerId or payload.playerId
  local p = playerId and Players[playerId]
  if not p then return fail(base, "Reserved player no longer exists") end
  local effect, duplicate = FLEET_AUTHORITY.settle(
    BattleFleetAuthorityState, payload, source, timestamp)
  if not effect then return fail(base, duplicate) end
  if duplicate ~= true then fleetSettle(p, effect, timestamp) end
  touchAlso(effect.playerId)
  local v = playerView(p)
  v.result = effect.result
  v.fleetSettlementId = effect.settlementId
  v.fleetDuplicate = duplicate == true
  local ack, ackWhy = FLEET_AUTHORITY.deliveryAck(
    BattleFleetAuthorityState, effect.reservationId)
  if not ack then return fail(base, ackWhy) end
  ack["authority-timestamp"] = timestamp
  return fleetReply(base, v, { acknowledgement = ack })
end

H["Battle.Fleet.Cancelled"] = function(base, msg, timestamp)
  if not FLEET_ENABLED then return fail(base, "Battle fleet is disabled") end
  local payload, source, why = fleetNotice(msg, base)
  if not payload then return fail(base, why) end
  local reserved = payload.reservationId
    and BattleFleetAuthorityState.reservations[payload.reservationId]
  local playerId = reserved and reserved.playerId or payload.playerId
  local p = playerId and Players[playerId]
  if not p then return fail(base, "Reserved player no longer exists") end
  local effect, duplicate = FLEET_AUTHORITY.finalizeCancel(
    BattleFleetAuthorityState, payload, source, timestamp)
  if not effect then return fail(base, duplicate) end
  if duplicate ~= true then
    if effect.disposition == "forfeit" and effect.result == "loss" then
      fleetSettle(p, effect, timestamp)
    elseif effect.disposition == "refund" then
      fleetRefund(p, effect, timestamp)
    else
      return fail(base, "Battle fleet cancellation has no authoritative disposition")
    end
  end
  touchAlso(effect.playerId)
  local v = playerView(p)
  v.fleetCancelled = {
    reason = effect.reason, cancelId = effect.cancelId,
    disposition = effect.disposition, forfeit = effect.forfeit == true,
  }
  v.fleetDuplicate = duplicate == true
  local ack, ackWhy = FLEET_AUTHORITY.deliveryAck(
    BattleFleetAuthorityState, effect.reservationId)
  if not ack then return fail(base, ackWhy) end
  ack["authority-timestamp"] = timestamp
  return fleetReply(base, v, { acknowledgement = ack })
end

H["Battle.Fleet.FinalAcked"] = function(base, msg, timestamp)
  if not FLEET_ENABLED then return fail(base, "Battle fleet is disabled") end
  local payload, source, why = fleetNotice(msg, base)
  if not payload then return fail(base, why) end
  if type(FLEET_AUTHORITY.confirmDelivery) ~= "function" then
    return fail(base, "Battle fleet authority does not support delivery confirmation")
  end
  local effect, duplicate = FLEET_AUTHORITY.confirmDelivery(
    BattleFleetAuthorityState, payload, source, timestamp)
  if not effect then return fail(base, duplicate) end
  effect.release["authority-timestamp"] = timestamp
  return fleetReply(base, {
    confirmationId = effect.confirmationId,
    finalId = effect.finalId,
    kind = effect.kind,
    confirmed = true,
    duplicate = duplicate == true,
  }, { release = effect.release })
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
    challenger = Battle.combatant(battleMonster(p), "challenger", address),
    challengerAddress = address,
  }
  Battles[id] = b
  -- Reclaim finished fights now, not when this one ends: the reply to the
  -- message that ends a battle still has to carry its own turn log.
  pruneBattles(timestamp)
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

  b.accepter = Battle.combatant(battleMonster(p), "accepter", address)
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
        -- A REFERENCE to the live companion, not a copy, and it does not
        -- survive this function: the deep clone happens after the sort, for the
        -- rows that actually made the board. Cloning here meant every account
        -- in the process paid for a full companion copy so that fifty of them
        -- could be published -- ten thousand clones to publish fifty.
        source = p.monster,
      }
    end
  end
  table.sort(rows, function(x, y)
    if x.level ~= y.level then return x.level > y.level end
    if x.wins ~= y.wins then return x.wins > y.wins end
    return x.address < y.address
  end)
  local out = {}
  for i = 1, math.min(limit or 50, #rows) do
    local row = rows[i]
    local m = withMoves(Battle.clone(row.source))
    m.nextLevelExp = C.requiredExp(m.level or 0)
    -- `source` is scaffolding and must not reach the client; `monster` is the
    -- field the board has always published and its shape is unchanged.
    row.source = nil
    row.monster = m
    out[i] = row
  end
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

  if not C.MINT.enabled then
    return fail(base, "Minting to Arweave is paused")
  end

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
    -- The worker renders a card off this and needs each move's type, so the
    -- queue carries the full shape. It is a wire payload, not stored state.
    monster = withMoves(Battle.clone(m)),
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
  if not C.MINT.enabled then
    return fail(base, "Companion asset import is parked for the economy launch")
  end

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
  if p.battleFleet then
    return nil, p.activeBattleId,
      "Active fleet battle must use Admin.ExpireFleetBattle, Admin.RetryFleetCancel, or Admin.ForceResolveFleetBattle"
  end

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
    other.arenaBoost = nil
    if other.monster and other.monster.status
       and other.monster.status.type == "Battle" then
      other.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    end
    -- Cancelling a fight frees the OPPONENT too, and only one of the two is
    -- ever named in the message. Naming both here covers every caller.
    touchAlso(who)
    released[#released + 1] = who
  end

  if battle then
    -- Counted before `settled` is set, and only once: this is the one finish
    -- that never reaches `settleBattle`, and double-counting it would make the
    -- lifetime total drift upward on every repeated release.
    if not battle.settled then BattlesCompleted = BattlesCompleted + 1 end
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
local function adminSnapshotView(timestamp, includeEconomy)
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

  local snapshot = {
    generatedAt = timestamp,
    players = players,
    battles = activeBattleSummaries(),
    factions = adminFactionStats(timestamp),
    stats = operationalStats(timestamp),
    metrics = metricsView(),
    audit = audit,
  }
  if includeEconomy then
    snapshot.economy = EconomyEngine.publicView(EconomyState, Withdrawals, Deposits, timestamp)
  end
  return snapshot
end

--- One signed read for the complete operating picture. Rows are compact and
--- full player records remain addressable through `/now/player-<address>`.
H["Admin.Snapshot"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  return reply(base, adminSnapshotView(timestamp, true))
end

local function economyAdminBody(base, msg)
  local raw = bodyOf(msg)
  if raw == "" then return {} end
  local ok, value = pcall(json.decode, raw)
  if not ok or type(value) ~= "table" then return nil, fail(base, "Body must be a JSON object") end
  return value, nil
end

H["Admin.Economy.Preview"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local body, invalid = economyAdminBody(base, msg)
  if invalid then return invalid end
  local preview, problem = EconomyEngine.previewPolicy(
    EconomyState, body.path or msg.Path, body.value ~= nil and body.value or msg.Value, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, preview)
end

H["Admin.Economy.Propose"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local body, invalid = economyAdminBody(base, msg)
  if invalid then return invalid end
  local change, problem = EconomyEngine.proposePolicy(
    EconomyState, signer(msg), body.path or msg.Path,
    body.value ~= nil and body.value or msg.Value,
    body.reason or msg.Reason, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { change = change })
end

H["Admin.Economy.Apply"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local change, problem = EconomyEngine.applyPolicy(
    EconomyState, signer(msg), msg.ChangeId, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { change = change })
end

H["Admin.Economy.EmergencyPause"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local paused, problem = EconomyEngine.emergencyPause(
    EconomyState, signer(msg), msg.Reason, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { emergency = paused })
end

H["Admin.Economy.PauseDesk"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local paused, problem = EconomyEngine.setDeskPause(
    EconomyState, signer(msg), msg.Item, tostring(msg.Side or ""):lower(),
    true, msg.Reason, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { desk = paused })
end

H["Admin.Economy.ObserveRuneSupply"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local value, problem = EconomyEngine.observeRuneSupply(
    EconomyState, signer(msg), msg.TotalSupply, timestamp, msg.Reason)
  if problem then return fail(base, problem) end
  return reply(base, { totalSupply = value })
end

H["Admin.Economy.ReleaseGold"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local released, problem = EconomyEngine.releaseGold(
    EconomyState, signer(msg), msg.Item, int(msg.Amount, 0), msg.Reason, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { release = released })
end

H["Admin.Economy.ObserveGold"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local observation, problem = EconomyEngine.observeGoldPolicy(
    EconomyState, signer(msg), msg.Reason, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { observation = observation })
end

H["Admin.Economy.FundTestBots"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  if EconomyState.mode ~= "testing" then
    return fail(base, "Test-bot funding is permanently unavailable after economy activation")
  end
  local body, invalid = economyAdminBody(base, msg)
  if invalid then return invalid end
  local addresses = body.addresses
  if type(addresses) ~= "table" or #addresses < 1 or #addresses > 50 then
    return fail(base, "Test funding requires 1-50 wallet addresses")
  end
  local targets = {
    rune = math.max(0, math.min(100, int(body.rune, 25))),
    scroll = math.max(0, math.min(20, int(body.scroll, 5))),
  }
  local funded = 0
  for _, address in ipairs(addresses) do
    if type(address) ~= "string" or #address ~= 43 then
      return fail(base, "Every test wallet must be a 43-character address")
    end
  end
  for _, address in ipairs(addresses) do
    local p = getPlayer(address, timestamp)
    p.unlocked = true
    local pass = EconomyEngine.ensurePass(EconomyState, p, address, timestamp, "test")
    if pass and pass.origin ~= "test" then
      if pass.origin == "legacy" then
        EconomyState.policy.passes.legacyCount = math.max(0,
          int(EconomyState.policy.passes.legacyCount, 0) - 1)
      elseif pass.origin == "promised" then
        EconomyState.policy.passes.promisedCount = math.max(0,
          int(EconomyState.policy.passes.promisedCount, 0) - 1)
      end
      pass.origin = "test"
    end
    for item, minimum in pairs(targets) do
      local held = itemCount(p, item)
      if held < minimum then grant(p, item, minimum - held) end
    end
    touchAlso(address)
    funded = funded + 1
  end
  EconomyState = EconomyEngine.syncHoldings(
    EconomyState, Players, timestamp, "Admin.Economy.FundTestBots")
  return reply(base, { funded = funded, minimums = targets, testing = true })
end

H["Admin.Pass.ConfigureGenesis"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local body, invalid = economyAdminBody(base, msg)
  if invalid then return invalid end
  if type(body.addresses) ~= "table" then return fail(base, "Promised addresses must be an array") end
  for _, address in ipairs(body.addresses) do
    if type(address) ~= "string" or #address ~= 43 then
      return fail(base, "Every promised pass needs a 43-character address")
    end
  end
  for _, address in ipairs(body.addresses) do
    local p = getPlayer(address, timestamp)
    p.unlocked = true
    EconomyEngine.ensurePass(EconomyState, p, address, timestamp, "promised")
    if p.pass.origin ~= "legacy" then p.pass.origin = "promised" end
    touchAlso(address)
  end
  local sealed, problem = EconomyEngine.configureGenesis(
    EconomyState, Players, signer(msg), body, timestamp)
  if problem then return fail(base, problem) end
  return reply(base, { genesis = sealed, quote = EconomyEngine.passQuote(EconomyState) })
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
  if EconomyState.mode == "active" and delta > 0 then
    return fail(base, "Active economy corrections require an explicit reconciliation path")
  end
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

  if EconomyState.mode == "active" then
    for item, value in pairs(type(patch.inventory) == "table" and patch.inventory or {}) do
      if C.ITEMS[item] and int(value, 0) > itemCount(p, item) then
        return fail(base, "Active economy corrections cannot mint inventory")
      end
    end
    if type(patch.lootboxes) == "table" then
      local requested = 0
      for rarity = 1, C.MAX_LOOT_RARITY do
        requested = requested + math.max(0,
          int(patch.lootboxes[tostring(rarity)] or patch.lootboxes[rarity], 0))
      end
      if requested > #(p.lootboxes or {}) then
        return fail(base, "Active economy corrections cannot mint loot boxes")
      end
    end
  end

  if patch.clearBattle then
    local _, _, releaseProblem = forceReleasePlayer(p.address, timestamp)
    if releaseProblem then return fail(base, releaseProblem) end
  end

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
      local valid = {
        Home = true, Play = true, Quest = true, Battle = true,
        Hunt = true, Minting = true,
      }
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
  for address, p in pairs(Players) do
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
      -- Name every account this changed, so `compute` republishes exactly these
      -- and not the whole table. A player with no companion is skipped above and
      -- is deliberately not named: nothing about their record moved.
      touchAlso(address)
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

H["Admin.SetHuntProcess"] = function(base, msg)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local nextProcess = msg.ProcessId or msg.HuntProcess or msg.PlayerId
  if nextProcess ~= "" and (type(nextProcess) ~= "string" or #nextProcess ~= 43) then
    return fail(base, "Hunt process must be a 43-character process id")
  end
  local nextNode = msg.Node
  if nextNode ~= nil and nextNode ~= ""
     and (type(nextNode) ~= "string" or not string.match(nextNode, "^https?://")) then
    return fail(base, "Hunt node must be an http(s) URL")
  end
  local previous = HuntProcess
  HuntProcess = nextProcess or ""
  HuntNode = nextNode or HuntNode or ""

  -- Additional workers arrive as a JSON array in the body:
  --   [{"processId":"<43>","node":"https://..."}, ...]
  -- Absent body leaves the fleet alone, so the single-process admin call keeps
  -- its old meaning; an explicit empty array is how a fleet is torn back down.
  local raw = bodyOf(msg)
  if raw ~= "" then
    local ok, decoded = pcall(json.decode, raw)
    if not ok or type(decoded) ~= "table" then
      return fail(base, "Hunt fleet must be a JSON array of workers")
    end
    local fleet = {}
    for _, entry in ipairs(decoded) do
      local id = type(entry) == "table" and entry.processId or entry
      if type(id) ~= "string" or #id ~= 43 then
        return fail(base, "Each hunt worker needs a 43-character processId")
      end
      local workerNode = type(entry) == "table" and entry.node or nil
      if workerNode ~= nil and workerNode ~= ""
         and (type(workerNode) ~= "string" or not string.match(workerNode, "^https?://")) then
        return fail(base, "Each hunt worker node must be an http(s) URL")
      end
      fleet[#fleet + 1] = {
        processId = id,
        node = (workerNode ~= nil and workerNode ~= "") and workerNode or nil,
      }
    end
    HuntProcesses = fleet
  end

  local routes = huntFleet()
  return reply(base, {
    protocol = HUNT_PROTOCOL, processId = HuntProcess,
    node = HuntNode ~= "" and HuntNode or nil, previous = previous,
    workers = routes, size = #routes,
  })
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
    -- The message names a WithdrawalId, not a wallet, so the account being
    -- paid back has to name itself.
    touchAlso(w.address)
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
  local origin = msg.Origin or "legacy"
  if msg.Addresses then addresses = splitList(msg.Addresses) end
  local body = bodyOf(msg)
  if body ~= "" then
    local ok, decoded = pcall(json.decode, body)
    if ok and type(decoded) == "table" then
      if type(decoded.origin) == "string" then origin = decoded.origin end
      local list = decoded.addresses or decoded
      if type(list) == "table" then
        for _, a in ipairs(list) do
          if type(a) == "string" and a ~= "" then addresses[#addresses + 1] = a end
        end
      end
    end
  end

  local passPolicy = EconomyState.policy.passes or {}
  if passPolicy.genesisSealed and not (EconomyState.mode == "testing" and origin == "test") then
    return fail(base, "The unrestricted genesis pass grant path is permanently sealed")
  end
  if origin ~= "legacy" and origin ~= "promised" and origin ~= "test" then
    return fail(base, "Pass origin must be legacy, promised, or test")
  end

  local added, already = 0, 0
  for _, address in ipairs(addresses) do
    local p = getPlayer(address, timestamp)
    -- Named whether or not the flag moved: `getPlayer` MINTS a record for an
    -- address that had none, and that record has to be published before its
    -- owner can see anything at all.
    touchAlso(address)
    if p.unlocked then
      already = already + 1
    else
      p.unlocked = true
      added = added + 1
    end
    EconomyEngine.ensurePass(EconomyState, p, address, timestamp, origin)
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
  if EconomyState.mode == "active"
     and ((item and C.ITEMS[item] and int(msg.Amount, 1) > 0)
       or int(msg.Lootboxes, 0) > 0) then
    return fail(base, "Generic grants are sealed after economy activation")
  end
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
  local held = Players[target]
  if held.battleFleet then
    return fail(base,
      "Active fleet battle must use Admin.ExpireFleetBattle, Admin.RetryFleetCancel, or Admin.ForceResolveFleetBattle")
  end
  if math.max(0, int(held.gold, 0)) > 0 or #(held.lootboxes or {}) > 0
     or next(held.inventory or {}) ~= nil or next(held.monsters or {}) ~= nil
     or next(held.collection or {}) ~= nil or int(held.pass and held.pass.bond, 0) > 0 then
    return fail(base, "Cannot remove an account that holds economic state")
  end
  for _, order in pairs(EconomyState.orders or {}) do
    if order.account == target then return fail(base, "Cancel the account's Gold orders first") end
  end
  for _, listing in pairs(Market) do
    if listing.seller == target then return fail(base, "Cancel the account's companion listings first") end
  end
  local _, _, releaseProblem = forceReleasePlayer(target, timestamp)
  if releaseProblem then return fail(base, releaseProblem) end
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

  local offset = math.max(0, int(msg.Offset, 0))
  local limit = math.max(1, math.min(50, int(msg.Limit, 25)))

  if tostring(msg.Section or ""):lower() == "economy" then
    return reply(base, {
      section = "economy",
      economy = EconomyEngine.exportState(EconomyState),
    })
  end

  -- The market is exported through this same door, under its own section.
  --
  -- It has to be carried: a listed companion lives in `Market` and in NOBODY's
  -- collection, so a migration that only walks players does not merely forget
  -- the listings, it destroys the creatures inside them. And it has to be
  -- PAGED separately rather than riding along on page zero, because each entry
  -- holds a whole companion and there is no bound on how many people are
  -- selling at once.
  if tostring(msg.Section or ""):lower() == "market" then
    local ids = {}
    for id in pairs(Market) do ids[#ids + 1] = id end
    table.sort(ids)
    local listings = {}
    for i = offset + 1, math.min(offset + limit, #ids) do
      listings[#listings + 1] = Battle.clone(Market[ids[i]])
    end
    return reply(base, {
      section = "market",
      total = #ids,
      offset = offset,
      count = #listings,
      done = (offset + #listings) >= #ids,
      marketSeq = MarketSeq,
      market = listings,
      -- Sales are a bounded tail, so they ride once rather than paging.
      marketHistory = offset == 0 and Battle.clone(MarketHistory) or nil,
    })
  end

  local addresses = {}
  for address in pairs(Players) do addresses[#addresses + 1] = address end
  table.sort(addresses)

  local page = {}
  for i = offset + 1, math.min(offset + limit, #addresses) do
    local address = addresses[i]
    local p = Players[address]
    ensureRoster(p)
    -- Export is normally a read, but `ensureRoster` deliberately doubles as
    -- the lazy migration door for an old player record. Publish every row the
    -- page passed through so a wallet never keeps polling the pre-normalised
    -- version after an owner happens to export it.
    touchAlso(address)
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
      outfit = p.outfit,
      spriteTxId = p.spriteTxId,
      spriteAtlasTxId = p.spriteAtlasTxId,
      -- The whole holding, not just the active companion.
      --
      -- `monster` alone was the entire export, which meant a redeploy restored
      -- every player with one creature and silently destroyed the rest of their
      -- roster and all of their collection. It still rides along because a row
      -- written by an older build carries only that and `Admin.Load` still has
      -- to understand one.
      monster = p.monster,
      monsters = jsonObject(p.monsters or {}),
      collection = jsonObject(p.collection or {}),
      activeId = p.activeId,
      -- Ids are issued from this counter and are referenced by nothing outside
      -- the account, but restarting it at zero would reissue ids that the
      -- restored records already use.
      monsterSeq = p.monsterSeq,
      -- Once per account, EVER — so it has to survive the account moving to a
      -- new process, or every redeploy would hand out a free companion.
      adopted = p.adopted == true,
      pass = p.pass,
      inventory = p.inventory,
      gold = math.max(0, int(p.gold, 0)),
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
    -- Lifetime, and no longer derivable from the battle table it used to live
    -- in. A redeploy that dropped it would restart the count at zero.
    exported.battlesCompleted = int(BattlesCompleted, 0)

    -- The bridge ledgers. These are not history, they are OUTSTANDING WORK.
    --
    -- A withdrawal that is still `pending` is Rune this process has already
    -- taken from a player and is waiting on the token to confirm. Drop it in a
    -- redeploy and the confirmation, when it arrives, names a withdrawal the
    -- new process has never heard of — so it can never settle, and the player
    -- is short with nothing on either side saying why.
    --
    -- The deposit ledger has to come across for a sharper reason still: it is
    -- the only thing that makes a burn notice idempotent. A new process with an
    -- empty one treats every re-delivery as a first delivery and credits Rune
    -- that nobody burned.
    exported.withdrawals = Battle.clone(Withdrawals)
    exported.withdrawSeq = int(WithdrawSeq, 0)
    exported.deposits = Battle.clone(Deposits)
    exported.runeToken = RuneToken
  end
  return reply(base, exported)
end

--- Put one decoded companion back into a shape the game can act on.
---
--- Every number arrives from `json.decode` as a float, so an unnarrowed restore
--- stores `"level": 3.0000000000` and serialises it that way forever after. The
--- narrowing list is the same one the old single-companion restore used; it now
--- runs for every companion in the roster, the collection and the market
--- instead of only the active one.
local function restoreMonster(m, timestamp)
  if type(m) ~= "table" then return nil end
  for _, field in ipairs({ "attack", "defense", "speed", "health", "energy",
                           "happiness", "level", "exp", "totalTimesFed",
                           "totalTimesPlay", "totalTimesQuest", "bornAt" }) do
    if m[field] ~= nil then m[field] = int(m[field], 0) end
  end
  if type(m.status) == "table" then
    m.status.since = int(m.status.since, 0)
    m.status.until_time = int(m.status.until_time, 0)
  end
  for _, move in pairs(m.moves or {}) do
    for _, field in ipairs({ "count", "damage", "attack", "speed",
                             "defense", "health", "rarity" }) do
      if move[field] ~= nil then move[field] = int(move[field], 0) end
    end
  end
  -- The migration. A row written by an older build -- a legacynet export, a
  -- snapshot, the previous deployment -- carries whole moves; they are reduced
  -- here, once, on the way in.
  m.moves = Battle.compactMoves(m.moves)
  -- A restored companion is never mid-fight: the battle it was in did not come
  -- across, so leaving it "in the arena" would strand it.
  if type(m.status) ~= "table" or m.status.type == "Battle" or m.status.type == "Hunt" then
    m.status = { type = "Home", since = timestamp, until_time = timestamp }
  end
  -- Backfilled HERE as well as in `ensureRoster`, because a load replaces both
  -- halves wholesale after that has already run — so a companion arriving from
  -- a legacynet export or an older deployment would otherwise land with no card
  -- art and never be normalised again.
  return withAppearance(m)
end

--- The largest number already used by an id of the form `<prefix><n>`.
---
--- A counter that restarts below the ids already in the restored data would
--- reissue one of them, and two companions in the same account answering to the
--- same id is one companion as far as every lookup here is concerned.
local function highestSeq(keys, prefix)
  local highest = 0
  for key in pairs(keys or {}) do
    local digits = type(key) == "string" and string.match(key, "^" .. prefix .. "(%d+)$")
    local value = digits and math.tointeger(tonumber(digits))
    if value and value > highest then highest = value end
  end
  return highest
end

--- Bulk load of whole player records, used by the deploy script to restore a
--- recovered snapshot or to carry a previous deployment across.
H["Admin.Load"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end
  local ok, payload = pcall(json.decode, bodyOf(msg) ~= "" and bodyOf(msg) or "{}")
  if not ok or type(payload) ~= "table" then return fail(base, "Body must be JSON") end
  if type(payload.economy) == "table" then
    local imported, economyProblem = EconomyEngine.importState(EconomyState, payload.economy)
    if economyProblem then return fail(base, economyProblem) end
    EconomyState = imported
  end
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

  -- Monotonic, like wins and quests: a restore may never lower it.
  BattlesCompleted = math.max(int(payload.battlesCompleted, 0), int(BattlesCompleted, 0))

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

  -- The bridge ledgers.
  --
  -- Both are keyed by a reference that another process issued, so a restore
  -- adds rows and never overwrites one: whatever this process already holds for
  -- a reference happened after the export was taken, and replacing a settled
  -- withdrawal with the pending copy in an older snapshot would invite it to be
  -- settled a second time.
  if type(payload.withdrawals) == "table" then
    for id, row in pairs(payload.withdrawals) do
      if type(row) == "table" and not Withdrawals[tostring(id)] then
        row.amount = int(row.amount, 0)
        row.requestedAt = int(row.requestedAt, 0)
        row.settledAt = int(row.settledAt, 0)
        Withdrawals[tostring(id)] = row
      end
    end
  end
  WithdrawSeq = math.max(int(payload.withdrawSeq, 0), int(WithdrawSeq, 0),
                         highestSeq(Withdrawals, "w"))

  if type(payload.deposits) == "table" then
    for id, row in pairs(payload.deposits) do
      if type(row) == "table" and not Deposits[tostring(id)] then
        row.amount = int(row.amount, 0)
        row.creditedAt = int(row.creditedAt, 0)
        Deposits[tostring(id)] = row
      end
    end
  end

  -- The token the bridge points at. Without it a restored process refuses every
  -- withdrawal and rejects every burn notice as coming from a stranger.
  if type(payload.runeToken) == "string" and #payload.runeToken == 43
     and RuneToken == "" then
    RuneToken = payload.runeToken
  end

  -- The market, which is custody rather than an index.
  --
  -- A listed companion is in `Market` and in nobody's collection, so a
  -- migration that walks only the player table does not forget the listings --
  -- it destroys the creatures inside them. There is nowhere else to look them
  -- up from.
  --
  -- An existing listing is never overwritten. Whatever this process is holding
  -- now happened after the export was taken, so the export is the older story;
  -- and a listing id names custody of a specific creature, so replacing one
  -- would swap a companion out from under a sale that is already in progress.
  if type(payload.market) == "table" then
    for _, listing in pairs(payload.market) do
      if type(listing) == "table" and type(listing.id) == "string"
         and type(listing.seller) == "string" and type(listing.monster) == "table"
         and not Market[listing.id] then
        Market[listing.id] = {
          id = listing.id,
          seller = listing.seller,
          price = int(listing.price, 0),
          listedAt = int(listing.listedAt, 0),
          monster = restoreMonster(listing.monster, timestamp),
        }
      end
    end
  end
  -- Same reason as `monsterSeq`: a counter that restarts below the ids already
  -- in `Market` would issue a listing id that is already taken, and the new
  -- listing would take custody of the old one's companion.
  MarketSeq = math.max(int(payload.marketSeq, 0), int(MarketSeq, 0),
                       highestSeq(Market, "L"))

  if type(payload.marketHistory) == "table" and #MarketHistory == 0 then
    for _, sale in ipairs(payload.marketHistory) do
      if type(sale) == "table" then
        sale.price = int(sale.price, 0)
        sale.soldAt = int(sale.soldAt, 0)
        sale.level = int(sale.level, 0)
        MarketHistory[#MarketHistory + 1] = sale
      end
    end
    while #MarketHistory > 100 do table.remove(MarketHistory) end
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
      if type(row.pass) == "table" then
        p.pass = Battle.clone(row.pass)
        EconomyEngine.ensurePass(EconomyState, p, row.address, timestamp,
          row.pass.origin or "legacy")
      elseif p.unlocked then
        EconomyEngine.ensurePass(EconomyState, p, row.address, timestamp, "legacy")
      end
      if row.faction and C.FACTION_BY_NAME[row.faction] then p.faction = row.faction end
      if type(row.inventory) == "table" then
        for item, count in pairs(row.inventory) do
          if C.ITEMS[item] then p.inventory[item] = int(count, 0) end
        end
      end
      if row.gold ~= nil then p.gold = math.max(0, int(row.gold, 0)) end
      -- The whole holding, restored together.
      --
      -- This used to assign `p.monster` and stop, which was wrong twice over.
      -- It carried one companion and silently dropped the rest of the roster
      -- and the entire collection; and because `p.monster` is meant to BE
      -- `p.monsters[activeId]` rather than a copy of it, replacing only the
      -- mirror left two separate tables with the same id. Nothing looked wrong
      -- -- the ids still agreed -- until the companion was fed, and then the
      -- record the client shows gained the energy and the one the roster holds
      -- did not.
      --
      -- So both halves are rebuilt from the row and the mirror is re-pointed at
      -- the roster entry afterwards, never assigned directly.
      local incomingRoster, incomingCollection = {}, {}
      if type(row.monsters) == "table" then
        for id, m in pairs(row.monsters) do
          local restored = restoreMonster(m, timestamp)
          if restored then
            restored.id = tostring(id)
            incomingRoster[tostring(id)] = restored
          end
        end
      end
      if type(row.collection) == "table" then
        for id, m in pairs(row.collection) do
          local restored = restoreMonster(m, timestamp)
          if restored then
            restored.id = tostring(id)
            incomingCollection[tostring(id)] = restored
          end
        end
      end

      local carriesHolding = next(incomingRoster) ~= nil or next(incomingCollection) ~= nil
      if carriesHolding then
        p.monsters = incomingRoster
        p.collection = incomingCollection
      elseif type(row.monster) == "table" then
        -- A row written before the roster existed, or by the legacynet build:
        -- one companion and nothing else. Fold it into the shape rather than
        -- assigning the mirror, which is what detached the two.
        local restored = restoreMonster(row.monster, timestamp)
        restored.id = restored.id or ("m" .. string.format("%d", int(p.monsterSeq, 0) + 1))
        p.monsters = { [restored.id] = restored }
        p.collection = p.collection or {}
      end
      -- An EMPTY holding is not a holding. `Admin.Unlock` mints a record for
      -- every address on a paid list, and exporting one of those produces a row
      -- with no companions anywhere -- the same shape as a player who genuinely
      -- has none. Letting that replace a real roster is how the loot boxes were
      -- destroyed before; see the note above `lootboxes`.

      p.monsterSeq = math.max(
        int(row.monsterSeq, 0), int(p.monsterSeq, 0),
        highestSeq(p.monsters, "m"), highestSeq(p.collection, "m"))
      -- Adoption is once per account ever, so the fact has to cross with the
      -- account. It is sticky: a row that does not mention it cannot un-adopt
      -- somebody, or a redeploy would hand every player a free companion.
      if row.adopted then p.adopted = true end

      -- Re-point the mirror. `setActive` is the only place `p.monster` is
      -- written, precisely so the two can never be different objects.
      p.monster = nil
      p.activeId = nil
      -- A Hunt route is authority into a specific Hunt process run. It cannot
      -- survive a process migration: restored companions have already been
      -- thawed above, so carrying the old route would strand the player on a
      -- worker that the new game no longer controls.
      p.hunt = nil
      if type(row.activeId) == "string" and p.monsters[row.activeId] then
        setActive(p, row.activeId)
      else
        setActive(p, nil)
      end
      -- Rows exported by the short-lived three-active build are folded into
      -- today's one-active model during the load itself, so the very first
      -- published record is already truthful and no companion is discarded.
      ensureRoster(p)
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
      if row.outfit ~= nil then
        local restored = normaliseOutfit(row.outfit)
        if restored then p.outfit = restored end
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
      -- Republish this account and no others. A restore arrives in pages, so
      -- the cost of a load is the size of the page rather than the size of the
      -- table it is landing in.
      touchAlso(row.address)
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
--- Make a companion and give it to somebody.
---
--- The supply side of the game, owner-only. `Monster.Adopt` deliberately
--- refuses a second companion, so this is how a player ends up with more than
--- one until there is a way to earn them. It is also how the seed data puts a
--- collection in front of the test wallets.
---
--- `Faction` picks the creature. `Into` is "roster" or "collection", and it
--- defaults to the collection because a grant should not silently displace
--- whatever the player is actually raising.
H["Admin.CreateMonster"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local address = msg.PlayerId
  if type(address) ~= "string" or #address ~= 43 then
    return fail(base, "PlayerId must be an Arweave address")
  end
  local p = getPlayer(address, timestamp)
  if not p then return fail(base, "No such player") end

  local factionName = msg.Faction or p.faction
  local monster = createMonster(factionName, timestamp)
  if not monster then
    return fail(base, "'" .. tostring(factionName) .. "' is not a faction")
  end

  -- Cosmetics may be dictated, so the seed can put a non-default background or
  -- a non-holographic card in front of the client without a second verb.
  if msg.Name then monster.name = tostring(msg.Name) end
  if msg.Background then monster.background = tostring(msg.Background) end
  if msg.Border then monster.border = tostring(msg.Border) end
  if msg.Holographic ~= nil then
    monster.holographic = not (msg.Holographic == false or msg.Holographic == "false")
  end
  if msg.Level then
    local level = int(msg.Level, 0)
    if level > 0 then monster.level = level end
  end

  local into = tostring(msg.Into or "collection"):lower()
  if into == "roster" and rosterCount(p) < C.ROSTER.max then
    addToRoster(p, monster)
  else
    addToCollection(p, monster)
  end
  return reply(base, playerView(p))
end

--- Destroy a companion, wherever the player keeps it.
H["Admin.DeleteMonster"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  ensureRoster(p)
  local id = msg.MonsterId
  if (p.monsters or {})[id] then
    removeFromRoster(p, id)
  elseif (p.collection or {})[id] then
    p.collection[id] = nil
  else
    return fail(base, "No such companion")
  end
  return reply(base, playerView(p))
end

--- Move a companion between accounts, or between a player's own two places.
---
--- `Recipient` moves it to another account; without one it moves between the
--- roster and the collection, which is `Monster.Store` and `Monster.Retrieve`
--- without the rune or the Home requirement -- an owner fixing something, not a
--- player playing.
H["Admin.MoveMonster"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  ensureRoster(p)

  local id = msg.MonsterId
  local monster = (p.monsters or {})[id] or (p.collection or {})[id]
  if not monster then return fail(base, "No such companion") end
  local fromRoster = (p.monsters or {})[id] ~= nil

  local toAddress = msg.Recipient
  if type(toAddress) == "string" and #toAddress == 43 and toAddress ~= msg.PlayerId then
    local other = getPlayer(toAddress, timestamp)
    if not other then return fail(base, "No such recipient") end
    -- `PlayerId` is the sender; the recipient is the one gaining a companion
    -- and would otherwise never see it appear.
    touchAlso(toAddress)
    if fromRoster then removeFromRoster(p, id) else p.collection[id] = nil end
    monster.id = nil
    local into = tostring(msg.Into or "collection"):lower()
    if into == "roster" and rosterCount(other) < C.ROSTER.max then
      addToRoster(other, monster)
    else
      addToCollection(other, monster)
    end
    return reply(base, playerView(p))
  end

  if fromRoster then
    removeFromRoster(p, id)
    addToCollection(p, monster)
  else
    if rosterCount(p) >= C.ROSTER.max then
      return fail(base, "Their roster is full")
    end
    p.collection[id] = nil
    monster.status = { type = "Home", since = timestamp, until_time = timestamp }
    addToRoster(p, monster)
  end
  return reply(base, playerView(p))
end

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
  -- The worker signs this, and the wallet it is FOR is on the job.
  touchAlso(job.address)

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
  -- The companion leaves the ROSTER, not just the `monster` mirror. Clearing
  -- the mirror alone would leave the creature in `p.monsters`, so the player
  -- would still own the thing they just minted out of the game.
  removeFromRoster(p, job.monster.id or (p.monster and p.monster.id))
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
  -- Same as Admin.Minted: the refund is owed to the job's wallet.
  touchAlso(job.address)

  grant(p, C.MINT.cost.item, C.MINT.cost.amount)
  if p.monster and p.monster.status and p.monster.status.type == "Minting" then
    p.monster.status = { type = "Home", since = timestamp, until_time = timestamp }
  end
  p.mint = nil
  return reply(base, { refunded = job.address, seq = job.seq, reason = msg.Reason or "unknown" })
end

--- The worker confirmed the vault holds the asset. Put the companion back.
--- The active slot is never displaced: a returning card joins the collection
--- when another companion is already active.
H["Admin.Deposited"] = function(base, msg, timestamp)
  local denied = requireOwner(base, msg)
  if denied then return denied end

  local assetId = msg.AssetId
  local p = Players[msg.PlayerId]
  if not p then return fail(base, "No such player") end
  p.assets = p.assets or {}
  local record = p.assets[assetId]
  if not record then return fail(base, "That asset did not leave this account") end
  local m = Battle.clone(record.monster)
  -- However long it spent on a marketplace, it comes home rested rather than
  -- frozen mid-quest: the stored status is whatever it held at mint time.
  m.status = { type = "Home", since = timestamp, until_time = timestamp }
  -- A returning companion gets a fresh id in this account's numbering: the one
  -- it carried belonged to whoever held it before it was minted out.
  m.id = nil
  if rosterCount(p) < C.ROSTER.max then
    addToRoster(p, m)
  else
    addToCollection(p, m)
  end
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
  ["Monster.Store"] = "monstersStored",
  ["Monster.Retrieve"] = "monstersRetrieved",
  ["Monster.SetActive"] = "activeChanges",
  ["Monster.Transfer"] = "monstersTransferred",
  ["Admin.CreateMonster"] = "adminActions",
  ["Admin.DeleteMonster"] = "adminActions",
  ["Admin.MoveMonster"] = "adminActions",
  ["Market.List"] = "listingsCreated",
  ["Market.Cancel"] = "listingsCancelled",
  ["Market.Buy"] = "sales",
  ["Sprite.Update"] = "spritesUpdated",
  ["Daily.Claim"] = "worshipClaims",
  ["Lootbox.Open"] = "lootboxesOpened",
  ["Rune.Withdraw"] = "withdrawals",
  ["Rune.Minted"] = "withdrawalsSettled",
  ["Burn-Notice"] = "depositsCredited",
  ["Battle.Begin"] = "arenaEntries",
  ["Battle.Leave"] = "arenaLeaves",
  ["Battle.Start"] = "battlesStarted",
  ["Battle.Challenge"] = "challengesPosted",
  ["Battle.Accept"] = "battlesStarted",
  ["Battle.Attack"] = "roundsPlayed",
  ["Hunt.Begin"] = "huntsStarted",
  ["Hunt.Opened"] = "huntLifecycle",
  ["Hunt.Settle"] = "capturesAttempted",
  ["Hunt.Released"] = "huntLifecycle",
  ["Admin.AdjustAll"] = "adminActions",
  ["Admin.SetRuneToken"] = "adminActions",
  ["Admin.SetHuntProcess"] = "adminActions",
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
  ["Admin.ConfigureBattleFleet"] = "adminActions",
  ["Admin.ExpireFleetBattle"] = "adminActions",
  ["Admin.ForceResolveFleetBattle"] = "adminActions",
  ["Admin.RetryFleetAck"] = "adminActions",
  ["Admin.RetryFleetCancel"] = "adminActions",
  ["Admin.RetryFleetOpen"] = "adminActions",
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

--- Decode the handler reply once. `compute` needs the same answer for
--- telemetry, dirty-key selection and the embedded admin snapshot; decoding
--- the JSON independently at each call site was pure repeated work.
local function actionOutcome(result)
  local output = result and result.results and result.results.output
    and result.results.output.data
  if type(output) ~= "string" then return true, nil end
  local ok, value = pcall(json.decode, output)
  if not ok then return true, nil end
  return not (type(value) == "table" and value.error ~= nil), value
end

local TELEMETRY_GAUGES = {
  "players", "unlocked", "monsters", "runes", "lootboxes",
  "wins", "losses", "quests",
}

local function telemetryPlayer(p)
  if not p then
    return {
      players = 0, unlocked = 0, monsters = 0, runes = 0,
      lootboxes = 0, wins = 0, losses = 0, quests = 0,
    }
  end
  return {
    players = 1,
    unlocked = p.unlocked and 1 or 0,
    monsters = p.monster and 1 or 0,
    runes = itemCount(p, "rune"),
    lootboxes = #(p.lootboxes or {}),
    wins = int(p.wins, 0),
    losses = int(p.losses, 0),
    quests = int(p.questsCompleted, 0),
    faction = p.faction,
  }
end

--- Rebuild the disposable aggregate cache. This is paid once after an old
--- snapshot/redeploy and after explicitly bulk operations; the normal action
--- path below never walks `Players`.
local function rebuildTelemetryTotals()
  TelemetryFullRebuilds = int(TelemetryFullRebuilds, 0) + 1
  local totals = {
    players = 0, unlocked = 0, monsters = 0, runes = 0,
    lootboxes = 0, wins = 0, losses = 0, quests = 0,
    activeBattles = 0, factions = {},
  }
  for _, faction in ipairs(C.FACTIONS) do totals.factions[faction.name] = 0 end
  for _, p in pairs(Players) do
    local row = telemetryPlayer(p)
    for _, field in ipairs(TELEMETRY_GAUGES) do
      totals[field] = totals[field] + row[field]
    end
    if row.faction and totals.factions[row.faction] ~= nil then
      totals.factions[row.faction] = totals.factions[row.faction] + 1
    end
  end
  for _, b in pairs(Battles) do
    if b.status ~= "ended" then totals.activeBattles = totals.activeBattles + 1 end
  end
  totals.completedBattles = int(BattlesCompleted, 0)
  TelemetryTotals = totals
  return totals
end

local function ensureTelemetryTotals()
  if type(TelemetryTotals) ~= "table" or type(TelemetryTotals.factions) ~= "table" then
    return rebuildTelemetryTotals()
  end
  return TelemetryTotals
end

local FULL_TELEMETRY_REFRESH = {
  ["admin.adjustall"] = true,
  ["admin.load"] = true,
  ["admin.unlock"] = true,
}

local function queueAddress(queue, seq)
  for _, job in ipairs(queue or {}) do
    if int(job.seq, 0) == int(seq, -1) then return job.address end
  end
  return nil
end

--- Snapshot only the records this action can change. Handlers also report
--- indirect writes through `touchAlso`; if one was not predictable here the
--- post-action sync falls back to a full rebuild rather than risk drift.
local function captureTelemetryDelta(action, actor, target, tags)
  ensureTelemetryTotals()
  local lower = tostring(action):lower()
  if FULL_TELEMETRY_REFRESH[lower] then
    -- Bulk actions already walk the whole player table. Retain the old rows so
    -- their Rune flow can still be accounted exactly; a net total would hide a
    -- transfer where one wallet lost five and another gained five.
    local players = {}
    for address, p in pairs(Players) do players[address] = telemetryPlayer(p) end
    return { full = true, players = players, addresses = {} }
  end

  local addresses, battleIds = {}, {}
  local function addAddress(address)
    if type(address) == "string" and address ~= "" then addresses[address] = true end
  end
  local function addBattle(id)
    if type(id) ~= "string" or id == "" or battleIds[id] then return end
    battleIds[id] = true
    local b = Battles[id]
    if b then
      addAddress(b.challenger and b.challenger.address)
      addAddress(b.accepter and b.accepter.address)
    end
  end

  addAddress(actor)
  addAddress(target)
  addAddress(tags.Recipient)
  addAddress(tags.Account)

  -- Fleet lifecycle messages are signed by the scheduler, so their actor is
  -- the scheduler rather than the player the authority will mutate. Resolve
  -- that player from the retained authoritative reservation before the
  -- handler runs. Never trust a free-standing player-id tag for telemetry.
  if string.sub(lower, 1, 13) == "battle.fleet."
     or string.sub(lower, 1, 16) == "admin.retryfleet"
     or lower == "admin.expirefleetbattle"
     or lower == "admin.forceresolvefleetbattle" then
    local reservationId = tags.ReservationId or tags["reservation-id"]
    if not reservationId then
      local raw = tags.Data or tags.data
      if type(raw) == "string" and raw ~= "" then
        local decoded, payload = pcall(json.decode, raw)
        if decoded and type(payload) == "table" then
          reservationId = payload.reservationId
        end
      end
    end
    local authority = BattleFleetAuthorityState
    local reservation = reservationId and authority
      and ((authority.reservations or {})[reservationId]
        or (authority.finalized or {})[reservationId])
    addAddress(reservation and reservation.playerId)
  end

  if lower == "market.buy" then
    local listing = Market[tags.ListingId or ""]
    addAddress(listing and listing.seller)
  elseif lower == "admin.settlewithdrawal" then
    local withdrawal = Withdrawals[tags.WithdrawalId or ""]
    addAddress(withdrawal and withdrawal.address)
  elseif lower == "admin.minted" or lower == "admin.mintfailed" then
    addAddress(queueAddress(MintQueue, tags.Seq))
  end

  addBattle(tags.BattleId)
  local actorPlayer = actor and Players[actor]
  local targetPlayer = target and Players[target]
  addBattle(actorPlayer and actorPlayer.activeBattleId)
  addBattle(targetPlayer and targetPlayer.activeBattleId)

  local before = {
    addresses = addresses,
    players = {},
    battles = {},
    battleSeq = int(BattleSeq, 0),
  }
  for address in pairs(addresses) do
    before.players[address] = telemetryPlayer(Players[address])
  end
  for id in pairs(battleIds) do
    local b = Battles[id]
    before.battles[id] = b and b.status or false
  end
  return before
end

local function syncTelemetryTotals(before)
  if not before then return ensureTelemetryTotals() end
  if before.full then return rebuildTelemetryTotals() end

  -- A handler found an indirect recipient we could not derive before it ran.
  -- We cannot subtract that record's old contribution, so rebuild once rather
  -- than allowing a silent aggregate drift.
  for address in pairs(alsoTouched) do
    if not before.addresses[address] then return rebuildTelemetryTotals() end
  end

  local totals = ensureTelemetryTotals()
  for address, old in pairs(before.players) do
    local new = telemetryPlayer(Players[address])
    for _, field in ipairs(TELEMETRY_GAUGES) do
      totals[field] = int(totals[field], 0) - old[field] + new[field]
    end
    if old.faction and totals.factions[old.faction] ~= nil then
      totals.factions[old.faction] = totals.factions[old.faction] - 1
    end
    if new.faction and totals.factions[new.faction] ~= nil then
      totals.factions[new.faction] = totals.factions[new.faction] + 1
    end
  end

  for id, oldStatus in pairs(before.battles) do
    local wasActive = oldStatus ~= false and oldStatus ~= "ended"
    local current = Battles[id]
    local isActive = current ~= nil and current.status ~= "ended"
    if wasActive and not isActive then
      totals.activeBattles = math.max(0, int(totals.activeBattles, 0) - 1)
    elseif not wasActive and isActive then
      totals.activeBattles = int(totals.activeBattles, 0) + 1
    end
  end
  -- New ids are active when created. Existing ids were handled above.
  local created = math.max(0, int(BattleSeq, 0) - int(before.battleSeq, 0))
  totals.activeBattles = int(totals.activeBattles, 0) + created
  totals.completedBattles = int(BattlesCompleted, 0)
  return totals
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

local function recordTelemetry(action, actor, target, before, deltaBefore,
                               timestamp, tags, totals)
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

  -- Rune can move through more than the nominal target. A market purchase pays
  -- its seller, a refund names only a withdrawal id, a burn notice is signed by
  -- the scheduler, and a settled battle touches both combatants. Account the
  -- gross flow across every captured/touched wallet, not merely the signer.
  local runeAdded, runeRemoved, seen = 0, 0, {}
  for address, old in pairs((deltaBefore and deltaBefore.players) or {}) do
    seen[address] = true
    local after = telemetryPlayer(Players[address]).runes
    local delta = after - int(old.runes, 0)
    if delta > 0 then runeAdded = runeAdded + delta
    elseif delta < 0 then runeRemoved = runeRemoved - delta end
  end
  -- New indirect accounts are normally captured before the handler. Keep this
  -- fallback for a future handler that can only discover its recipient while
  -- running; syncTelemetryTotals already rebuilds safely in the same case.
  for address in pairs(alsoTouched) do
    if not seen[address] then
      local delta = telemetryPlayer(Players[address]).runes
      if delta > 0 then runeAdded = runeAdded + delta end
    end
  end
  today.runeAdded = int(today.runeAdded, 0) + runeAdded
  today.runeRemoved = int(today.runeRemoved, 0) + runeRemoved

  -- Absolute gauges come from the incrementally maintained cache. This used
  -- to call `operationalStats` and `adminFactionStats`, which meant five full
  -- player-table passes for every feed, quest and combat round.
  totals = totals or ensureTelemetryTotals()
  today.players = totals.players
  today.unlocked = totals.unlocked
  today.monsters = totals.monsters
  today.runes = totals.runes
  today.lootboxes = totals.lootboxes
  today.activeBattles = totals.activeBattles
  today.wins = totals.wins
  today.losses = totals.losses
  today.quests = totals.quests
  local checkin = Checkins[day] or {}
  today.worshipClaims = int(checkin.high, 0) + int(checkin.medium, 0) + int(checkin.low, 0)
  today.factions = today.factions or {}
  for _, faction in ipairs(C.FACTIONS) do
    today.factions[faction.element] = int(totals.factions[faction.name], 0)
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

--- Find a handler by name, ignoring case.
---
--- An action arrives as a VALUE, and nothing on the way here preserves its case
--- reliably: a wallet-signed message carries whatever the client typed, and a
--- message delivered from another process's outbox carries whatever that
--- process wrote. That mismatch is not hypothetical -- `Rune.Withdraw` emitted
--- `action = "mint"` against a token holding `Mint`, so the game deducted the
--- player's runes and the token answered "unknown action", destroying them.
---
--- The exact name still wins, so no existing caller changes behaviour.
local ACTION_ALIASES = nil
local function resolveHandler(action)
  if H[action] then return H[action], action end
  if ACTION_ALIASES == nil then
    ACTION_ALIASES = {}
    for name, fn in pairs(H) do
      ACTION_ALIASES[tostring(name):lower()] = { handler = fn, action = name }
    end
  end
  local resolved = ACTION_ALIASES[tostring(action):lower()]
  if not resolved then return nil, nil end
  return resolved.handler, resolved.action
end

--- Handlers that provably change nothing.
---
--- This is the whitelist behind the aggregate gating at the end of `compute`,
--- and the ONLY thing it is allowed to be is under-inclusive. A handler left
--- out of it recomputes every derived key exactly as the process always did;
--- a handler wrongly put IN it publishes stale state to everyone. So the bar
--- for membership is that the handler reads and returns, with no call that can
--- write through to a player, a battle, a queue or a counter.
---
--- Two absences are deliberate, and both are handlers whose names suggest they
--- belong here:
---
---   * `Admin.Export` calls `ensureRoster`, which MIGRATES an old single-
---     companion record into the roster shape. That is a write, on a read verb.
---   * `User.Info` is listed because it reads `Players[address]` directly. If
---     it is ever changed to `getPlayer`, it mints accounts and must come out.
---
--- Matched case-insensitively, for the same reason `resolveHandler` is: an
--- action arrives as a value and nothing on the way here preserves its case.
--- A spelling that fails to match is simply not recognised as a read, which
--- costs a recomputation and nothing else.
local READ_ONLY = {
  ["user.info"] = true,
  ["user.login"] = true,
  ["faction.list"] = true,
  ["battle.info"] = true,
  ["battle.openchallenges"] = true,
  ["leaderboard"] = true,
  ["stats"] = true,
  ["rune.deposits"] = true,
  ["rune.withdrawals"] = true,
  ["admin.snapshot"] = true,
  ["economy.view"] = true,
  ["admin.economy.preview"] = true,
  ["pass.info"] = true,
}

local function isReadOnly(action)
  return READ_ONLY[tostring(action):lower()] == true
end

--- Which derived read surfaces a known action can make stale.
---
--- Missing actions deliberately mean ALL domains. Adding a handler without
--- adding it here therefore costs the old blanket republish but cannot leave a
--- stale public key. The tables are conservative: a false positive costs an
--- encode; a false negative is a correctness bug.
local ACTION_DIRTY = {
  ["user.info"] = {}, ["user.login"] = {}, ["faction.list"] = {},
  ["battle.info"] = {}, ["battle.openchallenges"] = {},
  ["leaderboard"] = {}, ["stats"] = {}, ["rune.deposits"] = {},
  ["rune.withdrawals"] = {}, ["admin.snapshot"] = {},
  ["economy.view"] = {}, ["admin.economy.preview"] = {},
  ["pass.info"] = {},
  -- Export normalises legacy roster records while it reads them, so it keeps
  -- the conservative blanket path rather than pretending to be a pure read.
  ["admin.export"] = {
    aggregates = true, challenges = true, altar = true, market = true,
    bridge = true, mint = true, deposit = true, assets = true, users = true,
  },

  ["faction.join"] = { aggregates = true, users = true },
  ["monster.adopt"] = { aggregates = true, users = true },
  ["monster.store"] = { aggregates = true, users = true },
  ["monster.retrieve"] = { aggregates = true, users = true },
  ["monster.setactive"] = { aggregates = true, users = true },
  ["monster.transfer"] = { users = true },
  ["pass.setrecovery"] = { users = true },
  ["pass.recover"] = { market = true, bridge = true, users = true, economy = true },
  ["pass.bond"] = { users = true, economy = true },
  ["pass.beginunbond"] = { users = true, economy = true },
  ["pass.completeunbond"] = { users = true, economy = true },
  ["market.list"] = { market = true, users = true },
  ["market.cancel"] = { market = true, users = true },
  ["market.buy"] = { market = true, users = true },
  -- Feeding changes the companion data published in factions/leaderboard and
  -- the action metrics, but it cannot add/remove a player. Do not recount the
  -- entire Players table just to rewrite the unchanged `/now/users` scalar.
  ["monster.feed"] = { aggregates = true },
  ["monster.play"] = { aggregates = true, users = true },
  ["monster.quest"] = { aggregates = true, users = true },
  ["monster.claim"] = { aggregates = true, users = true },
  ["monster.levelup"] = { aggregates = true, users = true },
  ["sprite.update"] = { users = true },
  ["daily.claim"] = { altar = true, users = true },
  ["lootbox.open"] = { users = true },
  ["rune.withdraw"] = { bridge = true, users = true },
  ["rune.minted"] = { bridge = true },
  ["burn-notice"] = { bridge = true, users = true },

  ["battle.begin"] = { aggregates = true, users = true },
  ["battle.leave"] = { aggregates = true, challenges = true, users = true },
  ["battle.start"] = { users = true },
  ["battle.challenge"] = { challenges = true, users = true },
  ["battle.accept"] = { challenges = true, users = true },
  ["battle.attack"] = { aggregates = true, users = true },

  ["hunt.begin"] = { aggregates = true, users = true },
  ["hunt.opened"] = { users = true },
  ["hunt.settle"] = { aggregates = true, users = true },
  ["hunt.released"] = { aggregates = true, users = true },

  ["monster.mint"] = { aggregates = true, mint = true },
  ["monster.deposit"] = { deposit = true },
  ["admin.adjustinventory"] = {},
  ["admin.updateplayer"] = { aggregates = true, challenges = true },
  ["admin.releasebattle"] = { aggregates = true, challenges = true },
  ["admin.adjustall"] = { aggregates = true },
  ["admin.setrunetoken"] = {},
  ["admin.sethuntprocess"] = {},
  ["admin.settlewithdrawal"] = { bridge = true, users = true },
  ["admin.unlock"] = { users = true },
  ["admin.lock"] = {},
  ["admin.grant"] = { users = true },
  ["admin.setstats"] = { aggregates = true },
  ["admin.removeuser"] = { aggregates = true, challenges = true, users = true },
  ["admin.load"] = {
    aggregates = true, challenges = true, altar = true, market = true,
    bridge = true, mint = true, deposit = true, assets = true, users = true,
  },
  ["admin.createmonster"] = { aggregates = true, users = true },
  ["admin.deletemonster"] = { aggregates = true },
  ["admin.movemonster"] = { aggregates = true, users = true },
  ["admin.minted"] = { aggregates = true, mint = true, assets = true },
  ["admin.mintfailed"] = { aggregates = true, mint = true },
  ["admin.deposited"] = { aggregates = true, deposit = true, assets = true },
  ["admin.setvault"] = {},
  ["admin.configurebattlefleet"] = {},
  ["admin.expirefleetbattle"] = { aggregates = true, users = true },
  ["admin.forceresolvefleetbattle"] = { aggregates = true, users = true },
  ["admin.retryfleetack"] = {},
  ["admin.retryfleetcancel"] = {},
  ["admin.retryfleetopen"] = {},

  -- Cross-process lifecycle notices used to miss this table and therefore
  -- took the conservative all-domain rebuild on every hop. These are the only
  -- derived surfaces their authoritative mutations can make stale.
  ["battle.fleet.opened"] = { users = true },
  ["battle.fleet.openrejected"] = { users = true },
  ["battle.fleet.settle"] = { aggregates = true, metrics = true, users = true },
  ["battle.fleet.cancelled"] = { aggregates = true, metrics = true, users = true },
  ["battle.fleet.finalacked"] = {},
}

local ECONOMY_DIRTY = {
  ["faction.join"] = true, ["monster.adopt"] = true,
  ["monster.store"] = true, ["monster.feed"] = true,
  ["monster.play"] = true, ["monster.quest"] = true,
  ["monster.claim"] = true, ["monster.levelup"] = true,
  ["daily.claim"] = true, ["lootbox.open"] = true,
  ["rune.withdraw"] = true, ["rune.minted"] = true,
  ["burn-notice"] = true, ["battle.begin"] = true,
  ["battle.leave"] = true, ["battle.attack"] = true,
  ["battle.fleet.settle"] = true, ["hunt.begin"] = true,
  ["hunt.settle"] = true, ["monster.mint"] = true,
  ["admin.adjustinventory"] = true, ["admin.updateplayer"] = true,
  ["admin.settlewithdrawal"] = true, ["admin.grant"] = true,
  ["admin.removeuser"] = true, ["admin.load"] = true,
  ["admin.mintfailed"] = true,
}

local function dirtyDomains(action, succeeded)
  local classified = ACTION_DIRTY[tostring(action):lower()]
  if not classified then
    return {
      aggregates = true, challenges = true, altar = true, market = true,
      bridge = true, mint = true, deposit = true, assets = true,
      users = true, metrics = true, economy = true,
    }
  end
  local dirty = {}
  for domain, changed in pairs(classified) do dirty[domain] = changed end
  if succeeded and TRACKED_MUTATIONS[action] then dirty.metrics = true end
  if succeeded and ECONOMY_DIRTY[tostring(action):lower()] then dirty.economy = true end
  return dirty
end

function compute(base, req, opts)
  resolveOwner(base)

  -- Emptied per message. `result` IS `base` and survives into the next slot,
  -- so a list left over from the last one would republish strangers on every
  -- message after a trade — cheap, but a lie about what this message did.
  alsoTouched = {}

  local msg = (req and req.body) or {}
  local tags = caseInsensitive(msg.Tags or msg)
  local requestedAction = tags.Action or tags.action or "none"
  local timestamp = int((req and (req.timestamp or req.Timestamp)) or tags.Timestamp, 0)
  local actor = signer(msg)
  local handler, action = resolveHandler(requestedAction)
  -- Every decision after dispatch uses the canonical handler name. Dispatch has
  -- always been case-insensitive, but the old code then classified the raw
  -- spelling: `admin.grant` mutated successfully while looking non-admin to
  -- target selection, audit, telemetry and publication.
  action = action or requestedAction
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

  -- Initialise/snapshot telemetry before the handler mutates anything. Reads
  -- and unknown verbs skip this work; unknown verbs cannot mutate and their
  -- publish classification below deliberately falls back to every domain.
  local telemetryBefore = handler and not isReadOnly(action)
    and captureTelemetryDelta(action, actor, target, tags) or nil
  local economyBefore = nil
  if telemetryBefore and string.sub(tostring(action), 1, 8) ~= "Economy." then
    local economyAddresses = {}
    for address in pairs(telemetryBefore.players or {}) do economyAddresses[address] = true end
    economyBefore = EconomyEngine.capturePlayers(Players, economyAddresses)
  end
  local result
  if not handler then
    local names = {}
    for k in pairs(H) do names[#names + 1] = k end
    table.sort(names)
    result = fail(base, "unknown action '" .. tostring(requestedAction) ..
      "'. known: " .. table.concat(names, ", "))
  else
    local ok, out = pcall(function() return handler(base, tags, timestamp) end)
    result = ok and out or fail(base, tostring(out))
  end

  local succeeded, decodedReply = actionOutcome(result)
  local telemetryTotals = telemetryBefore and syncTelemetryTotals(telemetryBefore) or nil
  if succeeded then
    if action == "Admin.Load" then
      EconomyState = EconomyEngine.syncHoldings(EconomyState, Players, timestamp)
    elseif economyBefore then
      EconomyState = EconomyEngine.recordPlayerDeltas(
        EconomyState, economyBefore, Players, action, timestamp)
    end
    recordTelemetry(action, actor, target, before, telemetryBefore,
      timestamp, tags, telemetryTotals)
  end

  -- A successful admin write already proved ownership and already consumed
  -- the one signature that should be necessary for that operation. Include a
  -- fresh console view in the same reply so the page can repaint its roster,
  -- aggregates, battles and audit trail without signing Admin.Snapshot next.
  -- The snapshot and paged export handlers are reads, so embedding another
  -- snapshot there would either recurse or needlessly bloat an export page.
  if succeeded and actionIsAdmin and isOwner(actor)
     and action ~= "Admin.Snapshot" and action ~= "Admin.Export" then
    local output = result and result.results and result.results.output
    if output and type(decodedReply) == "table" then
      -- Economy state has its own unsigned published key and can be much larger
      -- than the player console. Do not duplicate it inside every admin-write
      -- reply; Admin.Snapshot includes it when explicitly requested.
      decodedReply.adminSnapshot = adminSnapshotView(timestamp, false)
      output.data = encode(decodedReply)
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
  local isAdminAction = actionIsAdmin
  if isAdminAction and isOwner(touched) then
    local target = tags.PlayerId
    if target and Players[target] then touched = target end
  end

  -- A normal player mutation publishes the same player twice: the singleton
  -- `/now/player` compatibility key and the stable `/now/player-<address>` key.
  -- `playerView` deep-clones the roster/collection and hydrates every compact
  -- move, then JSON encoding walks it all again. Build that identical string
  -- once per touched address instead of paying twice on every write.
  local encodedPlayerViews = {}
  local function encodedPlayerView(address)
    local cached = encodedPlayerViews[address]
    if cached ~= nil then return cached end
    local p = address and Players[address]
    cached = p and encode(playerView(p)) or "null"
    encodedPlayerViews[address] = cached
    return cached
  end
  if touched and Players[touched] then
    result.player = encodedPlayerView(touched)
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
    -- A removed player publishes the four bytes "null", not nil and not "".
    -- Dropping the key from the returned state is not guaranteed to clear what
    -- the previous slot wrote, and an EMPTY value is worse than either: the
    -- node answers that request with its own HTML landing page, at status 200.
    -- The client survives it — the JSON parse fails and it reads as absent —
    -- but only by accident, and "null" says the thing outright.
    result["player-" .. tostring(address)] = encodedPlayerView(address)
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
  elseif succeeded and before.battleId then
    -- Settlement clears `activeBattleId` before publication. Without an
    -- explicit terminal write, the singleton `/now/battle` key kept the live
    -- view from the preceding slot forever. A withdrawn pending challenge has
    -- already been removed, so publish JSON null for that case.
    local terminal = Battles[before.battleId]
    result.battle = terminal and encode(Battle.view(terminal)) or "null"
    result.battleid = terminal and terminal.id or "null"
  end

  -- The other side of a trade, a gift, or a settled fight.
  --
  -- Whoever a handler said it also changed. The block above catches a PvP
  -- opponent by looking the live battle up, which only works while there IS a
  -- live battle — so a forfeit, a sale and a transfer all arrive here instead.
  for address in pairs(alsoTouched) do
    if address ~= touched and Players[address] then publishPlayer(address) end
  end

  -- An account this message DELETED still needs a key written, and it cannot
  -- come from the loops above because it is no longer in `Players`. Writing
  -- "null" is what tells a client the record is gone; leaving the key alone
  -- would leave the last slot's copy standing forever.
  if isAdminAction then
    local removed = tags.PlayerId
    if removed and not Players[removed] then publishPlayer(removed) end
  end

  -- This used to be `for addr in pairs(Players) do publishPlayer(addr) end`,
  -- guarded only by "is this an Admin.* action". The comment defending it said
  -- rewriting the whole table was affordable because it only happened on an
  -- admin message -- but the bulk handlers are the minority of them. Every
  -- Admin.CreateMonster grants ONE companion to ONE wallet and re-encoded every
  -- account in the process; seeding a test population that way costs a full
  -- table rewrite per companion granted, and at tens of thousands of players it
  -- is the single most expensive thing this file could do.
  --
  -- The three handlers that genuinely change accounts in bulk -- Admin.Unlock,
  -- Admin.Load and Admin.AdjustAll -- now name each one through `touchAlso`, so
  -- they publish exactly the records they moved and the cost of a bulk action
  -- is the size of the batch rather than the size of the table.

  -- The aggregates, and when they are worth recomputing.
  --
  -- Everything below is DERIVED -- from `Players`, from `Market`, from the
  -- queues -- so producing one means walking the table behind it and encoding
  -- the answer. All of it used to run on every single message, including the
  -- ones that only read and the ones that failed. At a few hundred players that
  -- was free and it was written as though it always would be. It is not: at
  -- tens of thousands, `factionStats()` and `leaderboard()` each walk every
  -- account in the process, and a wallet merely opening the faction screen paid
  -- for both.
  --
  -- `result` IS `base`, so a key NOT written here keeps the value the previous
  -- slot gave it. That is the same mechanism `player-<address>` has relied on
  -- all along; this extends it to the derived keys.
  --
  -- The test is deliberately coarse and it fails SAFE. Only the handlers named
  -- in READ_ONLY are trusted to change nothing, and every one of them is a pure
  -- read. An action nobody classified, an action whose handler raised, an alias
  -- spelled differently -- all of them recompute everything, exactly as before.
  -- Getting this table wrong makes the process slow, never stale.
  local dirty = dirtyDomains(action, succeeded)

  -- Small, always-current, and read by screens that should cost nothing.
  -- The Alter's faction tally, readable by anyone. This was a standing
  -- competition between the four factions in the old game and there is no
  -- reason it should need a wallet to look at.
  --
  -- The `== nil` half of each guard is what makes the whole scheme safe to be
  -- wrong about: a key that has never been written is always written, so a
  -- fresh spawn, a redeploy, and a first message that fails all still leave a
  -- complete published state behind them.
  if dirty.altar or result.offerings == nil or result.checkins == nil then
    result.offerings = encode(Offerings)
    result.checkins = encode(Checkins)
  end
  if dirty.metrics or result.metrics == nil then
    result.metrics = encode(metricsView())
  end
  if dirty.economy or result.economy == nil then
    result.economy = encode(EconomyEngine.publicView(
      EconomyState, Withdrawals, Deposits, timestamp))
  end
  if dirty.aggregates or result.factions == nil or result.leaderboard == nil then
    result.factions = encode(factionStats())
    result.leaderboard = encode(leaderboard(50))
  end
  if dirty.challenges or result.challenges == nil then
    result.challenges = encode(openChallenges())
  end

  -- Constants, written once and then never again.
  --
  -- `catalog` is built out of `C.ITEMS`, `C.ACTIVITIES`, `C.ELEMENTS`,
  -- `Battle.TUNING` and `C.EFFECTIVENESS`, and `access` out of
  -- `C.PUBLIC_ACCESS`. Nothing in this file assigns any of them at runtime --
  -- they arrive with the source and change only when the source is redeployed,
  -- which spawns a process with an empty `base` and writes them again here.
  -- Re-encoding roughly eight kilobytes of unchanging JSON on every message was
  -- pure waste.
  --
  -- `tuning` is in the catalog so the client never has to hardcode a combat
  -- constant. It was doing exactly that, and the numbers on screen had drifted
  -- from the numbers the engine used.
  if result.catalog == nil then
    result.catalog = encode({
      items = C.ITEMS,
      activities = C.ACTIVITIES,
      hunt = C.HUNT,
      elements = C.ELEMENTS,
      tuning = Battle.TUNING,
      effectiveness = C.EFFECTIVENESS,
      -- Published so the client can price a level-up from the process rather
      -- than hardcoding the rule. HANDOFF §5.23 is the reason: the client drew
      -- HP as `health * 10` against an engine using 12, and a move's damage as
      -- `damage * 5` against an engine multiplying by the attack stat, so the
      -- number on screen was wrong and the stat looked inert. A cost the player
      -- is about to be charged is exactly that class of number.
      levelUp = {
        points = C.LEVEL_UP_POINTS,
        maxPerStat = C.LEVEL_UP_MAX_PER_STAT,
        -- cost = ceil(targetLevel / levelsPerRune)
        levelsPerRune = 4,
        costItem = "rune",
      },
    })
  end
  -- Published independently so the client never has to trust a frontend-only
  -- flag. A build can say the gates are open, but only this process decides
  -- whether a signed action is admitted.
  if result.access == nil then
    result.access = encode({ publicAccess = C.PUBLIC_ACCESS == true })
  end
  if action == "Admin.ConfigureBattleFleet" or result.battlefleet == nil then
    local routes = {}
    if FLEET_ENABLED then
      for _, worker in ipairs(FLEET_WORKERS) do
        routes[#routes + 1] = {
          workerId = worker.workerId,
          workerProcessId = worker.workerProcessId,
          runtime = worker.runtime,
          imageId = worker.imageId,
          abi = worker.abi,
          clockMode = worker.clockMode,
        }
      end
    end
    result.battlefleet = encode({
      enabled = FLEET_ENABLED,
      protocol = FLEET_PROTOCOL,
      managerMode = FLEET_ENABLED and FLEET_CFG.managerMode or nil,
      node = FLEET_ENABLED and FLEET_CFG.node or nil,
      ticketTtl = FLEET_ENABLED and FLEET_CFG.ticketTtl or nil,
      replayWindow = FLEET_ENABLED and FLEET_CFG.replayWindow or nil,
      maxEntries = FLEET_ENABLED and FLEET_CFG.maxEntries or nil,
      auditLimit = FLEET_ENABLED and FLEET_CFG.auditLimit or nil,
      workers = routes,
    })
  end
  if action == "Admin.SetHuntProcess" or result.huntconfig == nil then
    -- `processId`/`node` stay for the single-process clients that read them.
    -- `workers` is the fleet; a client never picks from it, because the run's
    -- worker is assigned by this process and carried in the player's route.
    local huntRoutes = huntFleet()
    result.huntconfig = encode({
      protocol = HUNT_PROTOCOL,
      enabled = HuntProcess ~= "",
      processId = HuntProcess ~= "" and HuntProcess or nil,
      node = HuntNode ~= "" and HuntNode or nil,
      size = #huntRoutes,
      workers = huntRoutes,
    })
  end
  if FLEET_ENABLED and (result.battlefleetops == nil
     or action == "Battle.Start" or action == "Battle.Leave"
     or string.sub(tostring(action), 1, 13) == "Battle.Fleet."
     or string.sub(tostring(action), 1, 11) == "Admin.Expire"
     or string.sub(tostring(action), 1, 11) == "Admin.RetryF"
     or string.sub(tostring(action), 1, 12) == "Admin.ForceR") then
    local operations = {
      protocol = FLEET_PROTOCOL,
      node = FLEET_CFG.node,
      replayWindow = FLEET_CFG.replayWindow,
      live = {}, finals = {},
    }
    for reservationId, reservation in pairs(BattleFleetAuthorityState.reservations or {}) do
      operations.live[#operations.live + 1] = {
        reservationId = reservationId,
        battleId = reservation.battleId,
        playerId = reservation.playerId,
        workerId = reservation.workerId,
        workerProcessId = reservation.workerProcessId,
        status = reservation.status,
        expiresAt = reservation.expiresAt,
        cancelId = reservation.cancelId,
        assignmentId = reservation.assignmentId,
        ticket = reservation.ticket,
      }
    end
    for reservationId, final in pairs(BattleFleetAuthorityState.finalized or {}) do
      operations.finals[#operations.finals + 1] = {
        reservationId = reservationId,
        battleId = final.battleId,
        playerId = final.playerId,
        workerId = final.workerId,
        workerProcessId = final.workerProcessId,
        kind = final.kind,
        finalId = final.finalId,
        deliveryConfirmed = final.deliveryConfirmed == true,
        finalizedAt = final.finalizedAt,
      }
    end
    result.battlefleetops = encode(operations)
  end

  -- The marketplace, readable with no wallet.
  --
  -- `market` carries the whole companion for each listing, not a summary: a
  -- buyer is choosing between creatures, and the record IS the creature. There
  -- is no second place to look it up, because a listed companion is in escrow
  -- and in nobody's collection.
  if dirty.market or result.market == nil or result.marketstats == nil
     or result.markethistory == nil then
    result.market = encode(marketView())
    result.marketstats = encode({
      -- Counters are narrowed on the way out for the same reason every other
      -- number here is: Luerl counts in floats, and a published "0" that is
      -- really 0.00000000000 is stored that way for good.
      listings = int(marketCount(), 0),
      sales = int(#MarketHistory, 0),
    })
    result.markethistory = encode(MarketHistory)
  end

  -- The token this game mints into, as a key of its own.
  --
  -- A deploy used to confirm `Admin.SetRuneToken` by reading
  -- `now/results/output/data`, which is whoever computed LAST — so a concurrent
  -- Admin.Load answered for it and the wiring looked done when it was not.
  -- A dedicated key belongs to this value alone and cannot be another
  -- message's reply.
  result.runetoken = RuneToken

  -- The two ledgers of the bridge, readable without a wallet.
  --
  -- These are the only record on this side of value that has crossed to another
  -- process, and they were held in memory and published nowhere — so the one
  -- question worth asking about a withdrawal, "did it settle", had no answer a
  -- client or a verifier could read. `verify-withdraw.mjs` was already fetching
  -- `runewithdrawals` and silently getting nothing back, which made its
  -- settlement check pass by never being able to fail.
  --
  -- Lists, not objects: nothing indexes these by id, and a row carries its own.
  if dirty.bridge or result.runewithdrawals == nil or result.runedeposits == nil then
    local out = {}
    for _, w in pairs(Withdrawals) do out[#out + 1] = w end
    result.runewithdrawals = encode(out)
    local back = {}
    for _, d in pairs(Deposits) do back[#back + 1] = d end
    result.runedeposits = encode(back)
  end

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
  if dirty.mint or result.mintqueue == nil then
    result.mintqueue = encode(MintQueue)
  end
  if dirty.deposit or result.depositqueue == nil then
    result.depositqueue = encode(DepositQueue)
  end
  -- Two plain strings, no encode behind either: cheap enough to write every
  -- time, and `mintvault` has to be able to change the moment the key rotates.
  result.mintvault = MintVault or "null"
  if result.mintcost == nil then
    result.mintcost = string.format("%d", C.MINT.cost.amount)
  end

  -- The registry, whole, as one unsigned GET. Keyed by asset id, so it is a
  -- jsonObject: empty encodes as `[]` otherwise and a client indexing by id
  -- would break on the day before the first mint and work ever after.
  --
  -- It is published in full on every message, which is affordable while this
  -- is hundreds of entries and will not be at tens of thousands -- the same
  -- trade `player-<address>` already makes, and the same fix applies when it
  -- stops being affordable: publish per-asset keys and a count.
  if dirty.assets or result.assets == nil or result.assetcount == nil then
    local assetCount = 0
    for _ in pairs(Assets) do assetCount = assetCount + 1 end
    result.assets = encode(jsonObject(Assets))
    result.assetcount = string.format("%d", assetCount)
  end

  if dirty.users or result.users == nil then
    local playerCount
    if telemetryTotals then
      playerCount = int(telemetryTotals.players, 0)
    else
      playerCount = 0
      for _ in pairs(Players) do playerCount = playerCount + 1 end
    end
    result.users = string.format("%d", playerCount)
  end

  -- Always publish the action, even on failure. Without it the client waits out
  -- its whole timeout on a typo instead of seeing the error in about a second.
  -- Echo what the caller sent for diagnostics. All correctness decisions above
  -- used the resolved canonical name.
  result.action = requestedAction

  -- Compact the heap before the node photographs it.
  --
  -- HyperBEAM snapshots this process by term_to_binary-ing the WHOLE Luerl VM
  -- on the latest slot, and the latest slot is re-snapshotted every time it is
  -- computed. So everything the interpreter is still holding goes to disk --
  -- every transient table this message built, every `Battle.clone`, every
  -- encode buffer -- whether or not anything can still reach it.
  --
  -- Nothing was collecting on the message path. The only `collectgarbage` in
  -- the whole bundle sits inside aos's `state.reset`, which this process never
  -- reaches: it replaces aos's `compute` outright and none of that pipeline
  -- runs. That is the difference between a snapshot sized by the live state and
  -- one sized by every allocation since the process started, which is what a
  -- measured 600x steady-state overhead against a 2000x per-action one looks
  -- like.
  --
  -- A full `collect`, and NOT through `pcall`. That distinction is the whole
  -- fix, and getting it backwards is what made this look unfixable.
  --
  -- The first attempt here was `pcall(collectgarbage, "collect")`, because
  -- everything else on this path is pcall'd. It killed the Luerl VM: the Erlang
  -- process died and the node answered 500 with an HTML page, which reads
  -- exactly like a crash inside the collector. It is not. Reproduced on a live
  -- `~lua@5.3a` down to a four-line function:
  --
  --   local keep = {}                       -- anything still reachable
  --   for i = 1, 2000 do keep[i] = {a = i} end
  --   for i = 1, 20000 do local t = {b = i} end
  --   collectgarbage("collect")             -- statement    -> 200, keep intact
  --   pcall(collectgarbage, "collect")      -- through pcall -> 500, VM gone
  --
  -- Luerl's `pcall` restores the interpreter state it captured on entry, and a
  -- collection renumbers the table store, so the restored state indexes tables
  -- the sweep has already freed. It only shows up when something is LIVE across
  -- the collection -- with pure garbage and nothing to preserve, the pcall form
  -- survives, which is exactly how it passes a small test and dies in a real
  -- process. The same is true of a bare `collect` called anywhere INSIDE a pcall
  -- frame. So this call sits at the top level of `compute`, after the `pcall`
  -- around the handler at the top of this function has already returned.
  --
  -- `"step"` -- what stood here -- is not a weaker collect on this runtime. It
  -- is unimplemented: Luerl's `collectgarbage` answers every argument except
  -- `"collect"` with nil and does nothing. Measured on a live node with the
  -- table store's own index, which `tostring` exposes:
  --
  --   5,000 dead tables, then "step"     -> next table is 5020  (nothing freed)
  --   5,000 dead tables, then "collect"  -> next table is 1093  (store reclaimed)
  --
  -- So this process ran with no collection at all, and every transient table
  -- from every message since spawn was still in the heap when the node
  -- photographed it. That is the 900x snapshot, not the data model.
  --
  -- ao-loader is real Lua 5.3, where all three forms are ordinary and correct,
  -- so the local suite cannot see any of this. `run-smoke.sh` runs the deployed
  -- bundle on a live Luerl and is the only thing that can.
  --
  -- Deliberately the LAST statement, so the reply is fully built before the
  -- heap is touched, and deliberately unguarded.
  collectgarbage("collect")

  return result
end
