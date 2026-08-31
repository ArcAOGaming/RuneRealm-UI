--- PARKED FEATURE: this external one-unit companion-asset index is not deployed.
--- Companions remain inside game.lua; this source is retained only for a future
--- explicit decision to reintroduce external companion assets.
---
--- marketplace.lua - curated Rune Realm companion market index.
---
--- Companion assets already are one-unit token@1.0 processes with the
--- arweave-swap@1.0 device.  That asset process is the settlement authority:
--- it owns the balance and order book, and purchases settle there in native
--- AR.  This process deliberately does not pretend to custody an L1 asset or
--- to make an unverified payment atomic.  It provides the Rune Realm-specific
--- layer the generic market cannot: a curated registry, creature metadata,
--- signed listing announcements, filtering, and stable published state.
---
--- A listing announcement is a discovery hint.  Clients MUST verify the live
--- holder/order on the asset process before presenting it as purchasable.  The
--- distinction is explicit in every record (`verified = false`) so stale index
--- state can never be mistaken for ownership truth.

MarketName = "TEST-Rune Realm Companion Market"
GameProcess = GameProcess or ""
CollectionId = CollectionId or ""
RuneToken = RuneToken or ""
QuoteToken = QuoteToken or ""
AmmProcess = AmmProcess or ""
QuoteTicker = QuoteTicker or "AR"

Assets = Assets or {}
Listings = Listings or {}
AssetCount = AssetCount or 0
ActiveListingCount = ActiveListingCount or 0

local ADDRESS = "^[A-Za-z0-9_-]+$"
local SIGNATURE_ALGS = { ["rsa-pss-sha512"] = true, ["rsa-pss-sha256"] = true }

local function int(v, default)
  if v == nil then return default end
  local n = tonumber(v)
  if not n then return default end
  return math.tointeger(n) or default
end

local function validId(v)
  return type(v) == "string" and #v == 43 and v:match(ADDRESS) ~= nil
end

local function provenSigner(msg)
  local c = msg.commitments or msg.Commitments
  if type(c) ~= "table" then return msg.Address or msg.From end
  for _, commitment in pairs(c) do
    if type(commitment) == "table" and commitment.committer
       and SIGNATURE_ALGS[commitment.type or commitment.alg] then
      return commitment.committer
    end
  end
  return nil
end

local function isOwner(address)
  return Owner ~= nil and Owner ~= "" and address ~= nil and address == Owner
end

local function reply(base, value)
  base.results = { output = { data = type(value) == "string" and value or encode(value) } }
  return base
end

local function fail(base, message)
  return reply(base, { error = message })
end

local function assetView(asset)
  return {
    assetId = asset.assetId,
    minter = asset.minter,
    holder = asset.holder,
    state = asset.state == "returned" and "returned" or "minted",
    mintedAt = int(asset.mintedAt, 0),
    seq = int(asset.seq, 0),
    name = asset.name,
    element = asset.element,
    faction = asset.faction,
    level = int(asset.level, 0),
    attack = int(asset.attack, 0),
    defense = int(asset.defense, 0),
    speed = int(asset.speed, 0),
    health = int(asset.health, 0),
  }
end

local function assetsView()
  local out = jsonObject({})
  for id, asset in pairs(Assets) do out[id] = assetView(asset) end
  return out
end

local function listingView(listing)
  return {
    assetId = listing.assetId,
    seller = listing.seller,
    orderId = listing.orderId,
    price = string.format("%d", int(listing.price, 0)),
    quote = QuoteTicker,
    status = listing.status,
    createdAt = int(listing.createdAt, 0),
    updatedAt = int(listing.updatedAt, 0),
    -- This process indexes the announcement. The asset process verifies it.
    verified = false,
  }
end

local function listingsView()
  local out = jsonObject({})
  for id, listing in pairs(Listings) do out[id] = listingView(listing) end
  return out
end

local function infoView()
  return {
    name = MarketName,
    gameProcess = GameProcess,
    collectionId = CollectionId,
    runeToken = RuneToken,
    quoteToken = QuoteToken,
    ammProcess = AmmProcess,
    quoteTicker = QuoteTicker,
    settlement = "arweave-swap@1.0",
    settlementAsset = "AR",
    assetCount = AssetCount,
    activeListings = ActiveListingCount,
    owner = Owner or "",
  }
end

local function decodeData(msg)
  local body = msg.Data or msg.data or msg.Body or msg.body
  if type(body) ~= "string" or body == "" then return nil, "JSON body is required" end
  local ok, value = pcall(function() return require(".json").decode(body) end)
  if not ok or type(value) ~= "table" then return nil, "JSON body is invalid" end
  return value
end

local H = {}

H["Market.Info"] = function(base)
  return reply(base, infoView())
end

H["Market.Assets"] = function(base)
  return reply(base, assetsView())
end

H["Market.Listings"] = function(base)
  return reply(base, listingsView())
end

H["Admin.Configure"] = function(base, msg)
  if not isOwner(provenSigner(msg)) then return fail(base, "Not authorised") end
  if msg.GameProcess ~= nil then
    if not validId(msg.GameProcess) then return fail(base, "GameProcess must be a 43-character id") end
    GameProcess = msg.GameProcess
  end
  if msg.CollectionId ~= nil and msg.CollectionId ~= "" then
    if not validId(msg.CollectionId) then return fail(base, "CollectionId must be a 43-character id") end
    CollectionId = msg.CollectionId
  end
  if msg.RuneToken ~= nil then
    if not validId(msg.RuneToken) then return fail(base, "RuneToken must be a 43-character id") end
    RuneToken = msg.RuneToken
  end
  if msg.QuoteToken ~= nil then
    if not validId(msg.QuoteToken) then return fail(base, "QuoteToken must be a 43-character id") end
    QuoteToken = msg.QuoteToken
  end
  if msg.AmmProcess ~= nil then
    if not validId(msg.AmmProcess) then return fail(base, "AmmProcess must be a 43-character id") end
    AmmProcess = msg.AmmProcess
  end
  if msg.QuoteTicker ~= nil and msg.QuoteTicker ~= "" then
    QuoteTicker = tostring(msg.QuoteTicker):sub(1, 24)
  end
  return reply(base, infoView())
end

--- Load registry rows copied from the game's published `/now/assets` value.
--- Owner-only: otherwise a user could add an arbitrary token to the curated
--- collection by describing it as a companion in a message body.
H["Admin.LoadAssets"] = function(base, msg)
  if not isOwner(provenSigner(msg)) then return fail(base, "Not authorised") end
  local data, why = decodeData(msg)
  if not data then return fail(base, why) end
  local rows = data.assets or data
  if type(rows) ~= "table" then return fail(base, "assets must be an array") end

  local added, updated = 0, 0
  for _, row in ipairs(rows) do
    if type(row) == "table" and validId(row.assetId) then
      local existing = Assets[row.assetId]
      Assets[row.assetId] = assetView(row)
      if existing then updated = updated + 1 else added = added + 1 end
    end
  end
  AssetCount = AssetCount + added
  return reply(base, { added = added, updated = updated, total = AssetCount })
end

--- Announce an offer that the seller has already signed on the asset process.
--- The order transaction id is kept so a client can link the permanent action.
H["Listing.Create"] = function(base, msg, timestamp)
  local seller = provenSigner(msg)
  if not seller then return fail(base, "A signed wallet is required") end
  local assetId = msg.AssetId
  if not validId(assetId) or not Assets[assetId] then
    return fail(base, "Asset is not in the Rune Realm registry")
  end
  if not validId(msg.OrderId) then return fail(base, "OrderId must be a 43-character transaction id") end
  local price = int(msg.Price, nil)
  if not price or price <= 0 then return fail(base, "Price must be positive whole winston") end

  local current = Listings[assetId]
  if current and current.status == "active" and current.seller ~= seller then
    return fail(base, "Only the announced seller can replace this listing")
  end
  if not current or current.status ~= "active" then ActiveListingCount = ActiveListingCount + 1 end
  Listings[assetId] = {
    assetId = assetId,
    seller = seller,
    orderId = msg.OrderId,
    price = price,
    status = "active",
    createdAt = current and current.createdAt or timestamp,
    updatedAt = timestamp,
  }
  return reply(base, listingView(Listings[assetId]))
end

H["Listing.Cancel"] = function(base, msg, timestamp)
  local from = provenSigner(msg)
  if not from then return fail(base, "A signed wallet is required") end
  local listing = Listings[msg.AssetId]
  if not listing then return fail(base, "Listing not found") end
  if from ~= listing.seller and not isOwner(from) then return fail(base, "Not authorised") end
  if listing.status == "active" then ActiveListingCount = ActiveListingCount - 1 end
  listing.status = "cancelled"
  listing.updatedAt = timestamp
  return reply(base, listingView(listing))
end

local ENVELOPE = {
  target = true, id = true, owner = true, signature = true, anchor = true,
  commitments = true, from = true, type = true, variant = true,
  path = true, method = true, slot = true, device = true, nonce = true,
  epoch = true, accept = true, scheduler = true, subject = true,
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

local function resolveOwner(base)
  if Owner and Owner ~= "" then return Owner end
  local p = base and (base.process or base.Process)
  local c = type(p) == "table" and (p.commitments or p.Commitments) or nil
  if type(c) == "table" then
    for _, commitment in pairs(c) do
      if type(commitment) == "table" and commitment.committer
         and SIGNATURE_ALGS[commitment.type or commitment.alg] then
        Owner = commitment.committer
        return Owner
      end
    end
  end
  return Owner
end

function compute(base, req, opts)
  resolveOwner(base)
  local raw = (req and req.body) or {}
  local msg = caseInsensitive(raw.Tags or raw)
  local action = msg.Action or msg.action or "none"
  local timestamp = int((req and (req.timestamp or req.Timestamp)) or msg.Timestamp, 0)
  local handler = H[action]
  local result
  if not handler then
    result = fail(base, "unknown action '" .. tostring(action) .. "'")
  else
    local ok, out = pcall(function() return handler(base, msg, timestamp) end)
    result = ok and out or fail(base, tostring(out))
  end

  result.marketinfo = encode(infoView())
  result.assets = encode(assetsView())
  result.listings = encode(listingsView())
  result.marketstats = encode({ assets = AssetCount, activeListings = ActiveListingCount })
  if msg.AssetId and Listings[msg.AssetId] then
    result["listing-" .. msg.AssetId] = encode(listingView(Listings[msg.AssetId]))
  end
  return result
end
