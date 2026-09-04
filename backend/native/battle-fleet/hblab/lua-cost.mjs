/**
 * lua-cost.mjs -- how much of a slot is the CONTRACT, at N accounts?
 *
 *   node lua-cost.mjs [node-url]          # default http://localhost:8734
 *
 * The soak shows `execution_ms` for a plain `User.Info` going 13 ms -> 514 ms
 * as a process fills up with accounts, and `execution_ms` covers two different
 * things: HyperBEAM marshalling the base message in and out of Luerl, and the
 * contract's own Lua. This separates them.
 *
 * The trick is the free unsigned `~lua@5.3a` device: it runs a script we POST,
 * in one Luerl VM, and `compute()` is called DIRECTLY -- no base message is
 * encoded in, no result map is decoded out, no cache is written. So the only
 * thing being timed is the Lua.
 *
 * Two requests per population, identical except for the number of measured
 * messages; the difference divided by that number is the per-message Lua cost.
 * Seeding is therefore never counted, which matters because seeding 1,500
 * accounts dominates the request.
 *
 * `os.clock` is a stub on Luerl and `os.time` has one-second resolution, so
 * wall-clock from outside is the only timer available. Everything is local.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.resolve(HERE, '..', '..');
const NODE = (process.argv[2] || 'http://localhost:8734').replace(/\/$/, '');
const read = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');

/** The measured script. Seeds `seed` accounts, then runs `msgs` reads. */
const probe = (seed, msgs) => `
function luacost(base, req)
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }
  local T = 1700000000000

  -- result IS base and the node feeds it back in as the next slot's base, so
  -- the published map has to be threaded here too. Handing compute a fresh
  -- empty table each message makes every derived key look absent, and the
  -- "is this key nil" guards then recompute users, factions and leaderboard on
  -- every message -- turning a read-only action into a full table walk that the
  -- real process never performs.
  local state = { process = PROCESS }
  local function send(from, tags)
    T = T + 1000
    local body = { Address = from }
    for k, v in pairs(tags) do body[k] = v end
    state = compute(state, { body = body, timestamp = T }, {})
    return state
  end

  local function addr(n)
    local s = "SOAK" .. tostring(n)
    return s .. string.rep("z", 43 - #s)
  end

  -- One player who will do the measured reads, seeded first so the measured
  -- account is identical at every population.
  send(OWNER, { Action = "Admin.Unlock", Addresses = addr(0) })
  send(addr(0), { Action = "Faction.Join", Faction = "Inferno Blades" })

  -- The population. Fifty per message, exactly as the soak drives it.
  local n = 1
  while n <= ${seed} do
    local list = {}
    for _ = 1, 50 do
      if n > ${seed} then break end
      list[#list + 1] = addr(n)
      n = n + 1
    end
    send(OWNER, { Action = "Admin.Unlock", Addresses = table.concat(list, ",") })
  end

  for _ = 1, ${msgs} do send(addr(0), { Action = "User.Info" }) end
  return "seeded=${seed} msgs=${msgs}"
end
`;

/** The deploy bundle, so this measures what ships. */
const bundle = (seed, msgs) => [
  read('json.lua'),
  'local C = (function()', read('constants.lua'), 'end)()',
  read('monster-index.generated.lua'),
  'C.PUBLIC_ACCESS = true',
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', read('battle.lua'), 'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
  'BattleFleetBootstrapConfig = { enabled = true }',
  'BattleFleetConfig = nil',
  'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
  read('game.lua'),
  probe(seed, msgs),
].join('\n');

async function timeOne(seed, msgs) {
  const t0 = Date.now();
  const res = await fetch(`${NODE}/~lua@5.3a/luacost`, {
    method: 'POST',
    headers: { 'content-type': 'application/lua' },
    body: bundle(seed, msgs),
    signal: AbortSignal.timeout(1800000),
  });
  const body = (await res.text()).trim();
  return { ms: Date.now() - t0, ok: res.ok, body: body.slice(0, 120) };
}

const MSGS = 20;
console.log(`node ${NODE}\ncontract Lua only -- no base message encoded in, no result decoded out\n`);
console.log(`${'accounts'.padStart(9)} ${'seed only'.padStart(11)} ${`+${MSGS} reads`.padStart(11)} `
  + `${'per read'.padStart(10)}`);

for (const seed of [0, 250, 500, 1000, 1500]) {
  let base;
  let withMsgs;
  try {
    base = await timeOne(seed, 0);
    withMsgs = await timeOne(seed, MSGS);
  } catch (err) {
    console.log(`${String(seed).padStart(9)}  node dropped the connection (${err.cause?.code || err.message})`);
    continue;
  }
  if (!base.ok || !withMsgs.ok) {
    console.log(`${String(seed).padStart(9)}  failed: ${(base.ok ? withMsgs : base).body}`);
    continue;
  }
  console.log(`${String(seed).padStart(9)} ${`${base.ms}ms`.padStart(11)} ${`${withMsgs.ms}ms`.padStart(11)} `
    + `${`${((withMsgs.ms - base.ms) / MSGS).toFixed(1)}ms`.padStart(10)}`);
}
