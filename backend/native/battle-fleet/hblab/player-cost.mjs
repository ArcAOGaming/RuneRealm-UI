/**
 * player-cost.mjs -- what does ONE account cost the collector, by depth?
 *
 *   node player-cost.mjs [node-url]        # default http://localhost:8734
 *
 * `gc-shape.mjs` shows Luerl's collect is O(live tables squared) and free in
 * bytes. This asks the question that ranks the fixes: is the table count driven
 * by the NUMBER of accounts or by the DEPTH of each one?
 *
 * It matters because the live process answers `users: 51` and takes 19 s a slot,
 * while a local process needs ~2,750 EMPTY accounts to reach the same number.
 * Fifty-one accounts cannot be the same table count as 2,750 stubs unless a real
 * player is worth a lot of stubs -- so measure how many.
 *
 *   stub    Admin.Unlock only: the record `getPlayer` mints and nothing more
 *   player  + Faction.Join, which also adopts: companion, moves, status
 *   loaded  + a satchel and a few loot boxes, i.e. what someone who plays has
 *
 * Same instrument as the rest: the free unsigned `~lua@5.3a` device, the real
 * bundle, `compute()` called directly, wall clock from outside because Luerl has
 * no usable timer. Each depth is timed with and without the collections so
 * seeding is subtracted rather than estimated.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.resolve(HERE, '..', '..');
const NODE = (process.argv[2] || 'http://localhost:8734').replace(/\/$/, '');
const read = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');
const REPS = 3;
const COUNT = 300;

const DEPTHS = {
  stub: '',
  player: `
    send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
  `,
  loaded: `
    send(who, { Action = "Faction.Join", Faction = "Inferno Blades" })
    send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = "fire_berry", Amount = 20 })
    send(OWNER, { Action = "Admin.Grant", PlayerId = who, Item = "rune", Amount = 20 })
    send(OWNER, { Action = "Admin.Grant", PlayerId = who, Lootboxes = 3, Rarity = 1 })
  `,
};

const probe = (depth, reps) => `
function playercost(base, req)
  local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
  local PROCESS = { commitments = { sig1 = { committer = OWNER } } }
  local T = 1700000000000
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

  for i = 1, ${COUNT} do
    local who = addr(i)
    send(OWNER, { Action = "Admin.Unlock", Addresses = who })
${DEPTHS[depth]}
  end

  -- Clear the per-message garbage first, so the timed collections below are
  -- walking live data and not sweeping the seeding run.
  collectgarbage("collect")
  for _ = 1, ${reps} do collectgarbage("collect") end
  return "seeded ${COUNT} ${depth}"
end
`;

const bundle = (depth, reps) => [
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
  probe(depth, reps),
].join('\n');

async function timeOne(depth, reps) {
  const t0 = Date.now();
  const res = await fetch(`${NODE}/~lua@5.3a/playercost`, {
    method: 'POST',
    headers: { 'content-type': 'application/lua' },
    body: bundle(depth, reps),
    signal: AbortSignal.timeout(1800000),
  });
  const body = (await res.text()).trim();
  return { ms: Date.now() - t0, ok: res.ok, body: body.slice(0, 120) };
}

console.log(`node ${NODE}\n${COUNT} accounts per row, ${REPS} timed collections\n`);
console.log(`${'depth'.padStart(8)} ${'seed only'.padStart(11)} ${`+${REPS} collects`.padStart(13)} `
  + `${'per collect'.padStart(12)} ${'vs stub'.padStart(9)}`);

let stubCost = null;
for (const depth of Object.keys(DEPTHS)) {
  let base;
  let withGc;
  try {
    base = await timeOne(depth, 0);
    withGc = await timeOne(depth, REPS);
  } catch (err) {
    console.log(`${depth.padStart(8)}  node dropped the connection (${err.cause?.code || err.message})`);
    continue;
  }
  if (!base.ok || !withGc.ok) {
    console.log(`${depth.padStart(8)}  failed: ${(base.ok ? withGc : base).body}`);
    continue;
  }
  const per = (withGc.ms - base.ms) / REPS;
  if (stubCost === null) stubCost = per;
  console.log(`${depth.padStart(8)} ${`${base.ms}ms`.padStart(11)} ${`${withGc.ms}ms`.padStart(13)} `
    + `${`${per.toFixed(1)}ms`.padStart(12)} `
    + `${(stubCost > 0 ? `${(per / stubCost).toFixed(1)}x` : '-').padStart(9)}`);
}

console.log('\nThe collect is quadratic in table count, so a depth that costs Nx here is'
  + '\nsqrt(N)x the tables per account -- and one account of that depth is worth'
  + '\nsqrt(N) stubs when you are deciding what to shrink.');
