/**
 * growth-probe.mjs — measure which Lua globals grow per message.
 *
 * Boots the real game.lua in the local AOS module (same bundle as
 * fuzz/local.mjs), drives a chosen action loop, and after every sample
 * interval walks the global table reporting reachable-table count and
 * approximate byte size per global. Table count is the thing dev_lua pays
 * for (encode/decode per slot) and the thing Luerl's collectgarbage is
 * quadratic in.
 */
import fs from 'node:fs';
import path from 'node:path';
import AoLoader from '@permaweb/ao-loader';

const NATIVE = 'C:/REPO/RuneRealm-UI/backend/native';
const ROOT = 'C:/REPO/RuneRealm-UI';
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const PROCESS_ID = 'local-growth-probe'.padEnd(43, '_');
const OWNER = 'OWNERoooooooooooooooooooooooooooooooooooooo';
const read = (n) => fs.readFileSync(path.join(NATIVE, n), 'utf8');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const SHIM = `
FUZZT = 1700000000000
FUZZBASE = { process = { commitments = { sig1 = { committer = "${OWNER}" } } } }

function FUZZSEND(payload)
  local json = require(".json")
  local req = json.decode(payload)
  FUZZT = FUZZT + (req.advance or 1000)
  local body = { Address = req.from, id = req.id }
  for k, v in pairs(req.tags or {}) do body[k] = v end
  if req.data then body.Data = req.data end
  local okc, res = pcall(compute, FUZZBASE, { body = body, timestamp = FUZZT }, {})
  if not okc then return json.encode({ crash = tostring(res) }) end
  FUZZBASE = res
  return json.encode({ out = res.results.output.data })
end

function FUZZADVANCE(ms) FUZZT = FUZZT + ms return tostring(FUZZT) end

--- Reachable-table count and approximate marshalled byte size.
--- Costs are the ones dev_lua pays: one Erlang term per table, per key and
--- per value; a string costs its bytes.
local function measure(root, seen)
  local tables, bytes, entries = 0, 0, 0
  local stack = { root }
  while #stack > 0 do
    local v = stack[#stack]
    stack[#stack] = nil
    if not seen[v] then
      seen[v] = true
      tables = tables + 1
      bytes = bytes + 40
      for k, vv in pairs(v) do
        entries = entries + 1
        bytes = bytes + 24
        local tk = type(k)
        if tk == "string" then bytes = bytes + #k + 16
        elseif tk == "table" then stack[#stack + 1] = k end
        local tv = type(vv)
        if tv == "string" then bytes = bytes + #vv + 16
        elseif tv == "number" then bytes = bytes + 8
        elseif tv == "boolean" then bytes = bytes + 4
        elseif tv == "table" then stack[#stack + 1] = vv end
      end
    end
  end
  return tables, bytes, entries
end

local function countkeys(t)
  if type(t) ~= "table" then return 0 end
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n
end

--- Named roots. A path like "EconomyState.orderHistory" is resolved here so
--- sub-tables can be attributed separately from their parent.
local function resolve(pathstr)
  local cur = _G
  for part in string.gmatch(pathstr, "[^%.]+") do
    if type(cur) ~= "table" then return nil end
    cur = cur[part]
  end
  return cur
end

PROBEC = C
PROBEENG = EconomyEngine

--- The heaviest single player record, and the per-record breakdown.
function PSTAT()
  local json = require(".json")
  local out, best, bestaddr = {}, -1, nil
  local total, ntables, n = 0, 0, 0
  for a, p in pairs(Players) do
    local seen = {}
    local t, b = measure(p, seen)
    total = total + b; ntables = ntables + t; n = n + 1
    if b > best then best, bestaddr = b, a end
  end
  out.count = n
  out.bytes = total
  out.tables = ntables
  if bestaddr then
    local p = Players[bestaddr]
    local parts = {}
    for k, v in pairs(p) do
      if type(v) == "table" then
        local seen = {}
        local t, b = measure(v, seen)
        parts[k] = { tables = t, bytes = b }
      end
    end
    local seen = {}
    local t, b = measure(p, seen)
    out.worst = { addr = bestaddr, tables = t, bytes = b, parts = parts }
  end
  return json.encode(out)
end

function GSTAT(pathsJson)
  local json = require(".json")
  local paths = json.decode(pathsJson)
  local out = {}
  for _, p in ipairs(paths) do
    local root = resolve(p)
    if type(root) == "table" then
      local seen = {}
      local t, b, e = measure(root, seen)
      out[p] = { tables = t, bytes = b, entries = e, n = countkeys(root) }
    else
      out[p] = { tables = 0, bytes = 0, entries = 0, n = 0 }
    end
  end
  -- The published map, for contrast with the heap.
  local seen = {}
  local t, b, e = measure(FUZZBASE, seen)
  out["__published"] = { tables = t, bytes = b, entries = e, n = countkeys(FUZZBASE) }
  -- Everything reachable from _G that is not the stdlib, one shared seen set.
  local gseen = {}
  gseen[_G] = true
  gseen[package] = true
  gseen[string] = true; gseen[table] = true; gseen[math] = true
  gseen[os] = true; gseen[io] = true; gseen[coroutine] = true; gseen[debug] = true
  local gt, gb, ge = 0, 0, 0
  for _, p in ipairs(paths) do
    local root = resolve(p)
    if type(root) == "table" then
      local a, c, d = measure(root, gseen)
      gt = gt + a; gb = gb + c; ge = ge + d
    end
  end
  out["__allstate"] = { tables = gt, bytes = gb, entries = ge, n = 0 }
  return json.encode(out)
end
return "booted"
`;

function bundle(fleet) {
  return [
    'package.loaded[".json"] = require("json")',
    'Owner = nil',
    'local C = (function()', read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()', read('battle.lua'), 'end)()',
    'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
    fleet
      ? 'BattleFleetAuthority = (function()' + read('battle-fleet/authority.lua') + 'end)()'
      : 'BattleFleetConfig = nil',
    read('game.lua'),
    SHIM,
  ].join('\n');
}

const handle = await AoLoader(fs.readFileSync(WASM), {
  format: 'wasm32-unknown-emscripten',
  computeLimit: 90_000_000_000_000,
  memoryLimit: 2048 * 1024 * 1024,
});
const env = { Process: { Id: PROCESS_ID, Owner: OWNER, Tags: [
  { name: 'Data-Protocol', value: 'ao' },
  { name: 'Variant', value: 'ao.TN.1' },
  { name: 'Type', value: 'Process' }] } };
let memory = null;
let seq = 0;
async function evaluate(source) {
  const result = await handle(memory, {
    Id: `eval-${++seq}`.padEnd(43, '_'), Target: PROCESS_ID, Owner: OWNER, From: OWNER,
    Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
    'Block-Height': String(seq), Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
  }, env);
  if (result.Error) throw new Error(String(result.Error));
  memory = result.Memory;
  const d = result.Output?.data;
  return typeof d === 'string' ? d : d?.output ?? '';
}
const quote = (v) => `[====[${v}]====]`;

const boot = await evaluate(bundle(false));
if (!String(boot).includes('booted')) throw new Error(`boot failed: ${boot}`);

async function send(from, tags, data) {
  const payload = JSON.stringify({ from, tags, id: `f${++seq}`, ...(data ? { data } : {}) });
  const outer = JSON.parse(await evaluate(`return FUZZSEND(${quote(payload)})`));
  if (outer.crash) throw new Error(`crash: ${outer.crash}`);
  let body = null;
  try { body = JSON.parse(outer.out); } catch { /* raw */ }
  return { raw: outer.out, body };
}

const PATHS = [
  'Players', 'Battles', 'Unlocked', 'Offerings', 'Checkins', 'Metrics',
  'TelemetryTotals', 'AdminAudit', 'MonsterIndexOverrides', 'MintQueue',
  'DepositQueue', 'HuntSettlements', 'Assets', 'Market', 'MarketHistory',
  'Withdrawals', 'Deposits', 'BattleFleetStarts', 'BattleFleetAuthorityState',
  'EconomyState',
  'EconomyState.orderHistory', 'EconomyState.fills', 'EconomyState.orders',
  'EconomyState.books', 'EconomyState.actionReceipts',
  'EconomyState.actionReceiptOrder', 'EconomyState.rejected',
  'EconomyState.activity', 'EconomyState.desks', 'EconomyState.gold',
  'EconomyState.marketDaily', 'EconomyState.policy', 'EconomyState.assets',
  'EconomyState.bookIndex', 'EconomyState.bookIndex.trades',
  'EconomyState.desks.gold_fire_berry', 'EconomyState.markets',
  'PROBEC', 'PROBEENG', 'Battle',
];

async function stat() {
  const raw = await evaluate(`return GSTAT(${quote(JSON.stringify(PATHS))})`);
  return JSON.parse(raw);
}

// --- Bootstrap -------------------------------------------------------------
const WALLETS = Number(opt('wallets', 20));
const addr = (i) => `W${String(i).padStart(2, '0')}`.padEnd(43, 'x');
const FACTIONS = ['Inferno Blades', 'Aqua Guardians', 'Sky Nomads', 'Stone Titans'];

process.stderr.write('bootstrapping...\n');
await send(OWNER, { Action: 'Admin.SetRuneToken', RuneToken: 'RUNEtokenxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
for (let i = 0; i < WALLETS; i++) {
  const a = addr(i);
  await send(OWNER, { Action: 'Admin.Unlock', Addresses: a });
  await send(a, { Action: 'Faction.Join', Faction: FACTIONS[i % 4] });
  await send(OWNER, { Action: 'Admin.Grant', PlayerId: a, Item: 'rune', Amount: '1000000' });
  for (const it of ['fire_berry','water_berry','air_berry','rock_berry','scroll'])
    await send(OWNER, { Action: 'Admin.Grant', PlayerId: a, Item: it, Amount: '100000' });
  await send(OWNER, { Action: 'Admin.Grant', PlayerId: a, Lootboxes: '400', Rarity: '1' });
}

{
  const addrs = [];
  for (let i = 0; i < WALLETS; i++) addrs.push(addr(i));
  for (let i = 0; i < addrs.length; i += 50) {
    const r = await send(OWNER, { Action: 'Admin.Economy.FundTestBots' },
      JSON.stringify({ addresses: addrs.slice(i, i + 50), gold: 5000, rune: 100, scroll: 20 }));
    process.stderr.write('fund: ' + String(r.raw).slice(0, 160) + String.fromCharCode(10));
  }
}

const scenario = opt('scenario', 'mix');
const OPS = Number(opt('ops', 400));
const EVERY = Number(opt('every', 50));

const samples = [];
async function sample(n) {
  const s = await stat();
  s.__pstat = JSON.parse(await evaluate('return PSTAT()'));
  samples.push({ n, s });
  process.stderr.write(`  n=${n} allstate tables=${s.__allstate.tables} bytes=${s.__allstate.bytes} published=${s.__published.bytes}\n`);
}

let errs = new Map();
async function attempt(from, tags, data) {
  try {
    const r = await send(from, tags, data);
    if (r.body?.error) errs.set(`${tags.Action}: ${r.body.error}`, (errs.get(`${tags.Action}: ${r.body.error}`) || 0) + 1);
    return r;
  } catch (e) { errs.set(`${tags.Action}: ${e.message.slice(0, 90)}`, (errs.get(`${tags.Action}: ${e.message.slice(0, 90)}`) || 0) + 1); return null; }
}

await sample(0);

const ops = {
  async withdraw(i) {
    await attempt(addr(i % WALLETS), { Action: 'Rune.Withdraw', Amount: '1' });
  },
  async ordersell(i) {
    await attempt(addr(i % WALLETS), {
      Action: 'Economy.Order.Place', Side: 'sell', Item: 'fire_berry',
      Quantity: '1', Price: String(900 + (i % 50)),
    });
  },
  async orderbuy(i) {
    await attempt(addr(i % WALLETS), {
      Action: 'Economy.Order.Place', Side: 'buy', Item: 'fire_berry',
      Quantity: '1', Price: String(900 + (i % 50)),
    });
  },
  async ordercross(i) {
    // alternating buy/sell at the same price so every other order FILLS
    const side = i % 2 === 0 ? 'sell' : 'buy';
    await attempt(addr(i % WALLETS), {
      Action: 'Economy.Order.Place', Side: side, Item: 'fire_berry',
      Quantity: '1', Price: String(Number(process.env.PROBE_PRICE || 12)),
    });
  },
  async shop(i) {
    await attempt(addr(i % WALLETS), {
      Action: 'Economy.Shop.Trade', Side: 'buy', Item: 'fire_berry', Quantity: '1',
    });
  },
  async lootbox(i) {
    await attempt(addr(i % WALLETS), { Action: 'Lootbox.Open' });
  },
  async battle(i) {
    const a = addr(i % WALLETS);
    await send(OWNER, { Action: 'Admin.AdjustAll', Energy: '100', Happiness: '100' });
    const info = await attempt(a, { Action: 'User.Info' });
    const moves = Object.keys(info?.body?.monster?.moves || info?.body?.moves || {});
    await attempt(a, { Action: 'Battle.Begin' });
    const started = await attempt(a, { Action: 'Battle.Start' });
    let names = moves;
    const bm = started?.body?.battle?.challenger?.moves;
    if (bm) names = Object.keys(bm);
    for (let r = 0; r < 30; r++) {
      let ok = false;
      for (const mv of names) {
        const res = await attempt(a, { Action: 'Battle.Attack', Move: mv });
        if (res && !res.body?.error) { ok = true; break; }
      }
      if (!ok) break;
    }
    await attempt(a, { Action: 'Battle.Leave' });
  },
  async badprice(i) {
    await attempt(addr(i % WALLETS), {
      Action: 'Economy.Order.Place', Side: 'buy', Item: 'fire_berry',
      Quantity: '1', Price: String(100000 + i),
    });
  },
  async info(i) {
    await attempt(addr(i % WALLETS), { Action: 'User.Info' });
  },
  async feed(i) {
    await attempt(addr(i % WALLETS), { Action: 'Monster.Feed' });
  },
  async daily(i) {
    await evaluate('return FUZZADVANCE(86400000)');
    await attempt(addr(i % WALLETS), { Action: 'Daily.Claim' });
  },
};

const chosen = scenario === 'mix'
  ? ['withdraw', 'ordercross', 'shop', 'lootbox', 'battle', 'info', 'feed']
  : scenario.split(',');

for (let i = 1; i <= OPS; i++) {
  const name = chosen[i % chosen.length];
  await ops[name](i);
  if (i % EVERY === 0) await sample(i);
}
if (OPS % EVERY !== 0) await sample(OPS);

// --- Report ---------------------------------------------------------------
const first = samples[0].s;
const last = samples[samples.length - 1].s;
const n = samples[samples.length - 1].n || 1;
const rows = [];
for (const p of [...PATHS, '__published', '__allstate']) {
  const db = (last[p]?.bytes || 0) - (first[p]?.bytes || 0);
  const dt = (last[p]?.tables || 0) - (first[p]?.tables || 0);
  rows.push({ path: p, bytes0: first[p]?.bytes || 0, bytes1: last[p]?.bytes || 0,
    dBytes: db, bytesPerOp: db / n, tables0: first[p]?.tables || 0,
    tables1: last[p]?.tables || 0, dTables: dt, tablesPerOp: dt / n,
    n0: first[p]?.n || 0, n1: last[p]?.n || 0 });
}
rows.sort((a, b) => b.dBytes - a.dBytes);
console.log(`\n=== scenario=${scenario} ops=${n} wallets=${WALLETS} ===`);
console.log('path'.padEnd(36), 'bytes@0'.padStart(9), 'bytes@N'.padStart(9),
  'B/op'.padStart(9), 'tbl@0'.padStart(7), 'tbl@N'.padStart(7), 'tbl/op'.padStart(8),
  'keys@0'.padStart(7), 'keys@N'.padStart(7));
for (const r of rows) {
  if (r.dBytes === 0 && r.bytes1 === 0) continue;
  console.log(r.path.padEnd(36), String(r.bytes0).padStart(9), String(r.bytes1).padStart(9),
    r.bytesPerOp.toFixed(1).padStart(9), String(r.tables0).padStart(7),
    String(r.tables1).padStart(7), r.tablesPerOp.toFixed(2).padStart(8),
    String(r.n0).padStart(7), String(r.n1).padStart(7));
}
console.log('\ntrajectory (allstate tables / allstate bytes / published bytes):');
for (const s of samples) {
  console.log(String(s.n).padStart(6), String(s.s.__allstate.tables).padStart(8),
    String(s.s.__allstate.bytes).padStart(10), String(s.s.__published.bytes).padStart(10));
}
if (errs.size) {
  console.log('\nrefusals/errors seen:');
  for (const [k, v] of [...errs].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v}x ${k}`);
}
fs.writeFileSync(path.join(
  'C:/Users/tyler/AppData/Local/Temp/claude/C--REPO-RuneRealm-UI/8abc3245-38df-46b5-b884-5f9a213a68f3/scratchpad',
  `growth-${scenario.replace(/[^a-z]/g, '')}.json`), JSON.stringify(samples, null, 1));
