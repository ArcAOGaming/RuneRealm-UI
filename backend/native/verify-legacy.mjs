/**
 * verify-legacy.mjs — prove the recovered players actually load.
 *
 *   node backend/native/verify-legacy.mjs [node-url]
 *
 * Free, unsigned, and nothing is deployed: this bundles exactly what
 * `deploy.mjs` deploys, appends a check script, and runs the whole thing on a
 * public `~lua@5.3a` device — the same way `run-test.sh` runs the test suite.
 *
 * It pushes every row of `legacy-players.json` through `Admin.Load` and then
 * reads each player back as themselves, asserting that what the process holds
 * matches what was recovered: faction, level, exp, stats, berries, loot boxes,
 * a legal move roster, and integers that are still integers rather than
 * `1.0000000000` — which HANDOFF.md §4 names as the first thing to check when a
 * migration looks wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.argv[2] || process.env.LUA_NODE || 'https://alpha.neo.zephyrdev.xyz';

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

const file = path.join(HERE, process.env.LEGACY_FILE || 'legacy-players.json');
if (!fs.existsSync(file)) {
  console.error(`No ${path.basename(file)} — run build-legacy.mjs first`);
  process.exit(1);
}
const payload = fs.readFileSync(file, 'utf8');
if (payload.includes(']==]')) {
  // The rows are embedded in a Lua long string; that sequence would close it.
  console.error('legacy-players.json contains "]==]" and cannot be embedded');
  process.exit(1);
}

/**
 * The checks. Written against the same `compute()` entry point HyperBEAM calls,
 * with a process definition whose committer is the owner — which is how
 * `game_test.lua` drives it too.
 */
const CHECK = `
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

  --- Returns the decoded reply AND the raw one. The raw string is the only
  --- honest place to check integer-ness: this harness decodes with aos's own
  --- json, which turns every number into a float on the way in, so math.type
  --- on a decoded value says nothing about what the process actually holds.
  local raw = nil
  local function send(from, tags, data)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    if data then body.Data = data end
    local res = compute({ process = PROCESS }, { body = body, timestamp = T }, {})
    raw = res.results.output.data
    return json.decode(raw), raw
  end

  local payload = json.decode([==[__PAYLOAD__]==])
  local rows = payload.players
  ok("legacy-players.json parsed", type(rows) == "table" and #rows > 0, rows and #rows)

  -- Load, in the same batches deploy.mjs uses.
  local loaded = 0
  for i = 1, #rows, 10 do
    local chunk = {}
    for j = i, math.min(i + 9, #rows) do chunk[#chunk + 1] = rows[j] end
    local r = send(OWNER, { Action = "Admin.Load" }, json.encode({ players = chunk }))
    if r and r.error then
      ok("Admin.Load batch " .. i, false, r.error)
      break
    end
    loaded = loaded + ((r and r.loaded) or 0)
  end
  ok("every recovered player loaded", loaded == #rows, loaded .. "/" .. #rows)

  local stats = send(OWNER, { Action = "Stats" })
  ok("Stats counts them", stats and stats.players == #rows, stats and stats.players)

  -- Read each one back AS THEMSELVES and compare against what was recovered.
  local mismatched, floats, badMoves, checked = {}, {}, {}, 0
  -- Numeric, NOT ipairs: \`compute\` ends with \`collectgarbage("collect")\` and
  -- Luerl kills the VM if a collect runs with an ipairs iterator open on the
  -- stack. See the note at the end of \`compute\` in game.lua.
  for ri = 1, #rows do
    local row = rows[ri]
    local p, rawInfo = send(row.address, { Action = "User.Info" })
    checked = checked + 1
    -- Every number this game stores is an integer, and no address or item id
    -- contains a dot, so a digit-dot-digit anywhere in the reply is a float
    -- that should not be there: the "level":3.0000000000 defect.
    local float = rawInfo:match("[%d]%.[%d]")
    if float then floats[#floats + 1] = row.address .. " -> " .. rawInfo:sub(1, 80) end
    local why = nil
    if not p or p.exists ~= true then why = "does not exist"
    elseif p.unlocked ~= true then why = "not unlocked"
    elseif row.faction and p.faction ~= row.faction then why = "faction " .. tostring(p.faction)
    end

    if not why and row.monster then
      local m = p.monster
      if not m then why = "no companion"
      elseif m.level ~= row.monster.level then why = "level " .. tostring(m.level)
      elseif m.exp ~= row.monster.exp then why = "exp " .. tostring(m.exp)
      elseif m.attack ~= row.monster.attack then why = "attack " .. tostring(m.attack)
      elseif m.defense ~= row.monster.defense then why = "defense " .. tostring(m.defense)
      elseif m.speed ~= row.monster.speed then why = "speed " .. tostring(m.speed)
      elseif m.health ~= row.monster.health then why = "health " .. tostring(m.health)
      elseif m.elementType ~= row.monster.elementType then why = "element " .. tostring(m.elementType)
      elseif m.status == nil or m.status.type ~= "Home" then why = "status " .. tostring(m.status and m.status.type)
      end

      if not why then
        local n, damaging = 0, false
        for _, move in pairs(m.moves or {}) do
          n = n + 1
          if (move.damage or 0) > 0 then damaging = true end
        end
        if n ~= 4 or not damaging then
          badMoves[#badMoves + 1] = row.address .. " moves=" .. n .. " damaging=" .. tostring(damaging)
        end
      end
    end

    if not why and row.inventory then
      for item, count in pairs(row.inventory) do
        if (p.inventory or {})[item] ~= count then
          why = item .. " " .. tostring((p.inventory or {})[item]) .. " not " .. tostring(count)
        end
      end
    end

    if not why and row.lootboxes and #row.lootboxes > 0 then
      if #(p.lootboxes or {}) ~= #row.lootboxes then
        why = "lootboxes " .. tostring(#(p.lootboxes or {}))
      end
    end

    if why then mismatched[#mismatched + 1] = row.address .. ": " .. why end
  end

  ok("read back " .. checked .. " players, all matching", #mismatched == 0,
     #mismatched > 0 and table.concat(mismatched, " | ", 1, math.min(4, #mismatched)) or nil)
  ok("every restored number comes back an integer", #floats == 0,
     #floats > 0 and table.concat(floats, " | ", 1, math.min(4, #floats)) or nil)
  ok("every restored roster is four moves with a damaging one", #badMoves == 0,
     #badMoves > 0 and table.concat(badMoves, " | ", 1, math.min(4, #badMoves)) or nil)

  -- A restored player must be able to PLAY, not merely exist.
  local subject = nil
  for _, row in ipairs(rows) do
    if row.monster and row.inventory and (row.inventory[row.monster.berryItem] or 0) > 0 then
      subject = row
      break
    end
  end
  if subject then
    local before = send(subject.address, { Action = "User.Info" })
    local fed = send(subject.address, { Action = "Monster.Feed" })
    ok("a restored player can feed its companion with a restored berry",
       fed and fed.error == nil and fed.monster and fed.monster.energy >= before.monster.energy,
       fed and (fed.error or fed.monster.energy))
    -- Reaching the arena means access was restored. Being turned away for a
    -- Rune, or for a companion that has not been played with lately, is the
    -- game working — a restored companion arrives with the mood it died with.
    local began = send(subject.address, { Action = "Battle.Begin" })
    local gated = began ~= nil and (began.error == nil
      or began.error:find("Rune") ~= nil
      or began.error:find("happy") ~= nil
      or began.error:find("energy") ~= nil)
    ok("a restored player reaches the arena gate", gated, began and began.error)
  else
    ok("a restored player holds a berry of its own element", false, "none found")
  end

  -- Nobody who did not pay may be let in by this.
  local stranger = send("STRANGERssssssssssssssssssssssssssssssssss", { Action = "User.Info" })
  ok("an unrecovered wallet is still locked out",
     stranger and stranger.exists == false and stranger.unlocked ~= true, json.encode(stranger))

  out[#out + 1] = ""
  out[#out + 1] = passed .. " passed, " .. failed .. " failed"
  return table.concat(out, "\\n")
end

--- Driven from the outermost Lua frame, NOT through \`pcall\`. \`compute\` ends
--- with a collect, and on Luerl a collect inside a pcall frame corrupts the
--- state pcall restores on return and takes the VM down with it. Production
--- calls \`compute\` from Erlang with no Lua frame above it, so this has to
--- match. The cost is that a runtime error comes back as a bare \`500 Oops\`
--- naming nothing; it still fails the run, because an HTML page carries no
--- "0 failed" for the runner to match.
function verifylegacy(base, req)
  return run(base, req)
end
`;

const bundle = [
  // `json.lua` alone, not all of hyper-aos: this process defines its own
  // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
  // full runtime instead -- it registers `.json` the same way.
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local C = (function()',     read('constants.lua'), 'end)()',
  'local jsonx = (function()', read('jsonenc.lua'),   'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()',      read('battle.lua'),    'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
  read('game.lua'),
  CHECK.replace('__PAYLOAD__', payload),
].join('\n');

console.log(`node:   ${NODE}`);
console.log(`bundle: ${Buffer.byteLength(bundle)} bytes`);
console.log(`rows:   ${JSON.parse(payload).players.length}\n`);

// The whole verification is ONE request: 168 players pushed through Admin.Load
// and every one read back, on Luerl, which is Lua interpreted in Erlang. Its
// cost therefore tracks the size of `game.lua`, and that grew from ~184 KB to
// ~233 KB when hunt and the in-game market landed. Five minutes stopped being
// enough and the abort reads exactly like the node being down — it failed two
// deploys that way before anyone looked at the number.
//
// Raise `LUA_TEST_TIMEOUT` rather than trimming rows, the same way
// `run-test.sh` says to. Seconds, to match that file.
const timeoutSec = Number(process.env.LUA_TEST_TIMEOUT || 900);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
let res;
try {
  res = await fetch(`${NODE}/~lua@5.3a/verifylegacy`, {
    method: 'POST',
    headers: { 'content-type': 'application/lua' },
    body: bundle,
    signal: controller.signal,
  });
} finally {
  clearTimeout(timer);
}
const text = await res.text();
console.log(text.trim());
process.exit(/\b0 failed\b/.test(text) ? 0 : 1);
