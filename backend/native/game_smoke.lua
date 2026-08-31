--- game_smoke.lua — the short Luerl check.
---
--- `game_test.lua` is the real suite and it is the one that has to pass. It has
--- also outgrown a single HTTP request: the node's gateway gives up at five
--- minutes and the full run no longer finishes inside that, so `run-test.sh`
--- against a live node currently answers `curl (22) ... 504` no matter how long
--- `LUA_TEST_TIMEOUT` is set to, because the ceiling is not curl's.
---
--- That is a problem worth fixing properly, by splitting the suite. Until it
--- is, this exists so that "does Luerl accept and correctly run the code we are
--- about to deploy" is still a question with an answer.
---
--- It is deliberately NOT a second suite. It covers only what the local
--- `ao-loader` run cannot: constructs Luerl rejects or implements differently,
--- and the arithmetic that goes wrong when `tonumber` hands back a float. Every
--- behavioural rule stays in `game_test.lua`.
---
---   bash backend/native/run-smoke.sh [node-url]

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
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }

  local function send(from, tags, data)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    return json.decode(res.results.output.data), res
  end
  local function errOf(r) return type(r) == "table" and r.error or nil end

  local A = "SMOKEAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local B = "SMOKEBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  local C_ = "SMOKECcccccccccccccccccccccccccccccccccccccc"
  send(OWNER, { Action = "Admin.Unlock", Addresses = A .. "," .. B .. "," .. C_ })
  send(A, { Action = "Faction.Join", Faction = "Inferno Blades" })
  send(B, { Action = "Faction.Join", Faction = "Sky Nomads" })
  send(C_, { Action = "Faction.Join", Faction = "Stone Titans" })
  send(A, { Action = "Monster.Adopt" })
  send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = A,
                Item = "rune", Amount = "20" })
  send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = B,
                Item = "rune", Amount = "80" })

  -- Luerl runs this at all -------------------------------------------------
  --
  -- The point of the whole file. A construct Luerl rejects does not fail a
  -- test, it fails the CHUNK -- so reaching this line already proves the module
  -- parsed and loaded on the real engine.
  ok("game.lua loads and answers on Luerl",
     (send(A, { Action = "User.Login" }) or {}).address == A)

  -- Integers, asserted on the RAW reply --------------------------------------
  --
  -- `tonumber` returns a float here and every tag arrives as a string, so an
  -- unnarrowed conversion stores 25 as 25.00000000000 and keeps it that way.
  -- Decoding the reply first would turn it straight back into 25 and hide the
  -- defect, which is why this looks at the bytes.
  do
    local p = send(A, { Action = "User.Login" })
    local mid = p.activeId
    send(A, { Action = "Monster.Store", MonsterId = mid })
    local listed, res = send(A, { Action = "Market.List",
                                  MonsterId = mid, Price = "25" })
    ok("a listing is created", listed and listed.listing ~= nil, errOf(listed))
    local raw = res.market or ""
    ok("a price survives as an integer",
       string.find(raw, '"price":25', 1, true) ~= nil
         and string.find(raw, '"price":25.', 1, true) == nil,
       string.sub(raw, 1, 120))

    -- The id counter is arithmetic on a decoded number, which is the same
    -- hazard one level down.
    ok("a monster id is not a float",
       type(mid) == "string" and string.find(mid, ".", 1, true) == nil, mid)
  end

  -- string.match with a captured %d+ ------------------------------------------
  --
  -- `highestSeq` uses it to find the largest id already in a restored account,
  -- and a pattern the engine handles differently would silently return zero and
  -- reissue ids that are already taken. Exercised through Admin.Load rather
  -- than directly, because the local function is not reachable from here.
  do
    local row = nil
    for offset = 0, 200, 50 do
      local page = send(OWNER, { Action = "Admin.Export",
                                 Offset = tostring(offset), Limit = "50" })
      for _, candidate in ipairs(page.players or {}) do
        if candidate.address == A then row = candidate end
      end
      if row or page.done then break end
    end
    ok("the account exports", row ~= nil)
    ok("and carries its id counter", row and row.monsterSeq ~= nil, row and row.monsterSeq)

    local _, loaded = send(OWNER, { Action = "Admin.Load" },
                           json.encode({ players = { row } }))
    local after = send(A, { Action = "User.Login" })

    -- The RAW published record, which is the only place this is visible.
    --
    -- A restore is where float leakage gets in: every number in the body came
    -- through `json.decode` as a float, so a field that is not narrowed on the
    -- way back in is stored as one and stays that way. Every reading above is
    -- a DECODED value and would show `1.0` whether or not the process has it
    -- right -- see the repo rule. These bytes are what the process actually
    -- wrote.
    local raw = loaded["player-" .. A] or ""
    ok("a reload publishes the account", #raw > 0, #raw)
    local leaked = nil
    for _, field in ipairs({ "monsterSeq", "level", "exp", "attack", "defense",
                             "speed", "health", "energy", "happiness",
                             "bornAt", "since", "until_time" }) do
      if not leaked and string.find(raw, '"' .. field .. '":%-?%d+%.') then
        leaked = field
      end
    end
    ok("and no restored number came back as a float", leaked == nil,
       leaked and (leaked .. " in " .. string.sub(raw, 1, 200)))
    -- A counter that came back below the ids in use would hand the next
    -- companion an id that already exists.
    send(OWNER, { Action = "Admin.CreateMonster", PlayerId = A,
                  Faction = "Inferno Blades", Into = "collection" })
    local grown = send(A, { Action = "User.Login" })
    local seen, collisions = {}, 0
    for id in pairs(grown.collection or {}) do
      if seen[id] then collisions = collisions + 1 end
      seen[id] = true
    end
    for id in pairs(grown.monsters or {}) do
      if seen[id] then collisions = collisions + 1 end
      seen[id] = true
    end
    ok("a reload does not reissue an id that is in use", collisions == 0, collisions)
    ok("and the adoption does not come back", after and after.adopted == true,
       after and tostring(after.adopted))
  end

  -- The market exports as its own paged section ------------------------------
  do
    local page = send(OWNER, { Action = "Admin.Export", Section = "market" })
    ok("the market has a section of its own", page and page.section == "market",
       page and json.encode(page.section))
    ok("and it carries whole companions",
       page and page.market and page.market[1] and page.market[1].monster ~= nil,
       page and json.encode(page.count))
    ok("and its own sequence counter", page and page.marketSeq ~= nil,
       page and page.marketSeq)
  end

  -- The counterparty is republished ------------------------------------------
  --
  -- Arithmetic and table work rather than a Luerl construct, but it is the
  -- newest thing in `compute` and it is what a seller sees.
  do
    local market = send(A, { Action = "User.Login" })
    local _, res = send(OWNER, { Action = "Admin.Export", Section = "market" })
    local listings = json.decode(res.market or "{}")
    local id = next(listings)
    if id then
      local before = send(A, { Action = "User.Login" })
      local runesBefore = (before.inventory or {}).rune or 0
      local price = listings[id].price
      local _, bought = send(B, { Action = "Market.Buy", ListingId = id })
      local sellerKey = bought["player-" .. A]
      ok("a sale republishes the seller", type(sellerKey) == "string", type(sellerKey))
      local seller = sellerKey and json.decode(sellerKey)
      ok("and the seller can see the payment without signing",
         seller and ((seller.inventory or {}).rune or 0) == runesBefore + price,
         seller and (seller.inventory or {}).rune)
    else
      ok("a listing was available to buy", false, "no listing")
    end
  end

  -- Adoption is once per account, ever ---------------------------------------
  do
    -- C_ swore at the top of this file, and swearing IS the adoption -- one
    -- turn, no window in which an account has a faction and holds nothing.
    local fresh = send(C_, { Action = "User.Login" })
    ok("swearing already gave this account its companion",
       fresh and fresh.monster ~= nil, errOf(fresh))
    ok("and it is recorded", fresh and fresh.adopted == true, fresh and tostring(fresh.adopted))
    send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = C_,
                  Item = "rune", Amount = "5" })
    local mid = fresh.activeId
    send(C_, { Action = "Monster.Store", MonsterId = mid })
    send(C_, { Action = "Monster.Transfer", MonsterId = mid, Recipient = B })
    local emptied = send(C_, { Action = "User.Login" })
    ok("the account is empty", emptied.monster == nil
         and next(emptied.collection or {}) == nil)
    ok("and still cannot adopt again",
       errOf(send(C_, { Action = "Monster.Adopt" })) ~= nil)
  end

  out[#out + 1] = ""
  out[#out + 1] = string.format("%d passed, %d failed", passed, failed)
  return table.concat(out, "\n")
end

--- The device calls the global named by the request path, so this must match
--- the /~lua@5.3a/gametest path in run-smoke.sh, which is the same entrypoint
--- name the full suite uses; the device resolves the global from the path. A runtime error inside it comes
--- back from the node as a bare 500 naming nothing, so it is caught and
--- reported as a line of output like any other failure.
function gametest(base, req)
  -- NOT `pcall(run, ...)`, and that is load-bearing rather than tidy.
  --
  -- `compute` ends with `collectgarbage("collect")`. On Luerl a collection
  -- renumbers the table store, and `pcall` restores the interpreter state it
  -- captured on entry -- so a collect that happens ANYWHERE inside a pcall
  -- frame leaves the restored state pointing at tables the sweep has freed and
  -- takes the VM down with it. Reproduced on a live node; the full account is
  -- at the end of `compute` in game.lua.
  --
  -- So this suite has to drive `compute` from the outermost Lua frame, exactly
  -- as `dev_lua` does in production. Wrapping it to get a nicer error message
  -- would test a shape that is never deployed, and would fail on the first
  -- message.
  --
  -- A raised error therefore comes back as a bare `500 Oops` naming nothing.
  -- That still fails the run: `run-smoke.sh` passes `--fail-with-body`, and the
  -- "0 failed" grep cannot match an HTML error page either way.
  return run(base, req)
end
