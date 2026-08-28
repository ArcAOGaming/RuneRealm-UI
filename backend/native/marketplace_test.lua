--- marketplace_test.lua - marketplace index regression suite.

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
  local OWNER = "O" .. string.rep("o", 42)
  local ALICE = "A" .. string.rep("a", 42)
  local BOB = "B" .. string.rep("b", 42)
  local GAME = "G" .. string.rep("g", 42)
  local RUNE = "T" .. string.rep("t", 42)
  local QUOTE = "Q" .. string.rep("q", 42)
  local AMM = "M" .. string.rep("m", 42)
  local ASSET = "X" .. string.rep("x", 42)
  local ORDER = "R" .. string.rep("r", 42)
  local PROCESS = { commitments = { sig = { committer = OWNER, type = "rsa-pss-sha512" } } }

  local function send(from, tags, data)
    T = T + 1000
    local body = { commitments = { sig = { committer = from, alg = "rsa-pss-sha512" } } }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(res.results.output.data), res
  end

  local r = send(OWNER, { Action = "Market.Info" })
  ok("market carries the TEST prefix", r and r.name == "TEST-Rune Realm Companion Market", json.encode(r))
  ok("settlement truth is the asset process", r and r.settlement == "arweave-swap@1.0", json.encode(r))

  r = send(ALICE, { Action = "Admin.Configure", GameProcess = GAME })
  ok("a stranger cannot configure the registry", r and r.error == "Not authorised", json.encode(r))
  r = send(OWNER, { Action = "Admin.Configure", GameProcess = GAME,
                    RuneToken = RUNE, QuoteToken = QUOTE, AmmProcess = AMM,
                    QuoteTicker = "AR" })
  ok("the owner configures the complete process graph",
     r and r.gameProcess == GAME and r.runeToken == RUNE
       and r.quoteToken == QUOTE and r.ammProcess == AMM, json.encode(r))

  local rows = { assets = {{
    assetId = ASSET, minter = ALICE, holder = ALICE, state = "minted",
    mintedAt = 1700000000000, seq = 1,
    name = "TEST-Rockpup", element = "rock", faction = "Earth", level = 10,
    attack = 7, defense = 6, speed = 4, health = 8,
  }} }
  r = send(OWNER, { Action = "Admin.LoadAssets" }, json.encode(rows))
  ok("the game registry seeds the curated index", r and r.added == 1 and r.total == 1, json.encode(r))
  local _, published = send(OWNER, { Action = "Market.Assets" })
  local indexed = json.decode(published.assets)
  ok("the curated row keeps game state and last-seen holder",
     indexed[ASSET] and indexed[ASSET].state == "minted" and indexed[ASSET].holder == ALICE,
     published.assets)

  r = send(ALICE, { Action = "Listing.Create", AssetId = "Z" .. string.rep("z", 42),
                    OrderId = ORDER, Price = "1000000" })
  ok("an arbitrary asset cannot enter the collection", r and r.error ~= nil, json.encode(r))

  r = send(ALICE, { Action = "Listing.Create", AssetId = ASSET,
                    OrderId = ORDER, Price = "1000000" })
  ok("a holder can announce a native offer", r and r.seller == ALICE and r.status == "active", json.encode(r))
  ok("the index never claims it verified settlement", r and r.verified == false, json.encode(r))
  ok("prices stay integer strings", r and r.price == "1000000", json.encode(r))

  r = send(BOB, { Action = "Listing.Create", AssetId = ASSET,
                  OrderId = "Q" .. string.rep("q", 42), Price = "1" })
  ok("a second wallet cannot replace an active announcement", r and r.error ~= nil, json.encode(r))
  r = send(BOB, { Action = "Listing.Cancel", AssetId = ASSET })
  ok("a stranger cannot cancel a listing", r and r.error == "Not authorised", json.encode(r))
  r = send(ALICE, { Action = "Listing.Cancel", AssetId = ASSET })
  ok("the seller can cancel", r and r.status == "cancelled", json.encode(r))

  do
    T = T + 1000
    local res = compute({ process = PROCESS }, { body = {
      commitments = { hmac = { committer = OWNER, type = "hmac-sha256" } },
      Action = "Admin.Configure", GameProcess = "N" .. string.rep("n", 42),
    }, timestamp = T }, {})
    r = json.decode(res.results.output.data)
    ok("an hmac cannot impersonate the owner", r and r.error == "Not authorised", json.encode(r))
  end

  local _, raw = send(OWNER, { Action = "Market.Listings" })
  ok("published numeric state contains no floats",
     not raw.listings:match("[%d]%.[%d]"), raw.listings:sub(1, 160))

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

function markettest(base, req)
  local ok, res = pcall(run, base, req)
  return ok and res or ("ERROR: " .. tostring(res))
end
