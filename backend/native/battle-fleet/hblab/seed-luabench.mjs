/**
 * How much does a REAL battle round cost in Luerl, on a node?
 *
 * Every Lua number so far came from `Fleet.Status`, which is a read: 3 ms of
 * execution that says nothing about combat. This spawns a `lua@5.3a` process
 * carrying the actual `battle.lua`, and each message runs N complete rounds --
 * `makeOpponent`, `new`, `chooseNpcMove`, `resolveRound` -- so the node's own
 * `execution_ms` divided by N is the real per-round cost of the language.
 *
 * That is the number that decides whether a faster language would matter in a
 * monolith, where one process does everything and per-slot compute is no longer
 * a rounding error next to per-message overhead.
 *
 *   node seed-luabench.mjs [node-url]
 *   node harvest.mjs hb-stock luabench.<port>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage } from '../../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(NATIVE, '..', '..');
const node = (process.argv[2] || 'http://localhost:8734').replace(/\/$/, '');
const readNative = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');
const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

// Same assembly order as bundle.mjs, so battle.lua sees the constants and JSON
// helpers it expects. Only the handler differs.
const source = [
  readNative('json.lua'),
  'local C = (function()', readNative('constants.lua'), 'end)()',
  'local jsonx = (function()', readNative('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', readNative('battle.lua'), 'end)()',
  `
-- battle.lua reads its constants from a module-level upvalue that only
-- Battle.configure sets, and every move lookup goes through it. Without this the
-- process dies computing slot 0 -- its own boot message -- and the failure
-- surfaces as a bare 500 with "[No details]".
Battle.configure(C)

local function tag(msg, name)
  if type(msg) ~= "table" then return nil end
  for key, value in pairs(msg) do
    if type(key) == "string" and key:lower() == name then return value end
  end
  return nil
end

local function monster()
  return {
    name = "Bench", elementType = "fire", faction = "Inferno Blades",
    -- Deliberately a long fight: high health, low attack, high defense. At
    -- combat-realistic stats both sides die in one round, and one round per
    -- battle measures construction, not rounds.
    level = 5, attack = 2, defense = 90, speed = 30, health = 600,
    moves = { ["Body Slam"] = { count = 99 }, ["Firenado"] = { count = 99 } },
  }
end

-- One complete round: build the fighters, pick the NPC's move, resolve. Battles
-- are rebuilt each iteration on purpose -- a monolith pays construction too, and
-- resolving the same finished battle 100 times would measure nothing.
local function playRounds(n)
  local rounds, ended = 0, 0
  for i = 1, n do
    local player = monster()
    local opponent = Battle.makeOpponent(5, { difficulty = 1 })
    local battle = Battle.new("bench-" .. i, player, "P" .. string.rep("l", 42),
      opponent, "npc", { kind = "bot", timestamp = 1700000000000 + i })
    local guard = 0
    while battle.status ~= "ended" and guard < 300 do
      guard = guard + 1
      rounds = rounds + 1
      local npcMove = Battle.chooseNpcMove(battle.accepter, battle.challenger)
      local playerMove = Battle.chooseNpcMove(battle.challenger, battle.accepter)
      Battle.resolveRound(battle, playerMove, npcMove)
    end
    if battle.status == "ended" then ended = ended + 1 end
  end
  return rounds, ended
end

function compute(base, req, opts)
  base = base or {}
  local msg = req and req.body or {}
  local asked = tag(msg, "battles")
  if asked == nil then
    -- Slot 0 is the process's own boot message. Fighting a battle there would
    -- put an unlabelled outlier in the very log this exists to read.
    base.results = { output = { data = encode({ idle = true }) } }
    return base
  end
  local requested = tonumber(asked) or 1
  if requested < 1 then requested = 1 end
  if requested > 500 then requested = 500 end
  Battle.seedDeterministic(12345)
  local rounds, ended = playRounds(requested)
  base.results = {
    output = { data = encode({ battles = requested, rounds = rounds, ended = ended }) },
  }
  return base
end
`,
].join('\n');

process.stdout.write(`spawning lua battle bench (${Buffer.byteLength(source)} bytes)... `);
const processId = await spawnProcess({
  node, jwk, lua: source, name: 'TEST-Rune Realm Lua Battle Bench',
});
console.log(processId);

// One battle count per process would confound per-round cost with the fixed
// per-slot cost. Several counts, and the slope between them is the round.
const counts = [1, 5, 20];
const workers = [];
for (const battles of counts) {
  const { slot } = await sendMessage({
    node, jwk, process: processId, action: 'Bench.Battles', tags: { battles: String(battles) },
  });
  const response = await fetch(`${node}/${processId}~process@1.0/compute&slot=${slot}/results/output/data`,
    { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(300000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`battles=${battles} failed: ${body.slice(0, 300)}`);
  console.log(`  battles=${String(battles).padStart(3)} -> ${body.trim()}`);
  workers.push({
    label: `lua-x${battles}`, runtime: 'lua@5.3a', processId,
    battles, results: ['results/output/data'],
    tags: { battles: String(battles) },
  });
}

const outputPath = path.join(HERE, `luabench.${new URL(node).port}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify({ node, workers }, null, 2)}\n`);
console.log(`\nwrote ${outputPath}`);
