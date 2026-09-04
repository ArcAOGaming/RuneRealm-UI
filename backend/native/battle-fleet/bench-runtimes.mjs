/**
 * Offline per-action compute: the Rust worker against the Lua worker, driving
 * the same battle protocol.
 *
 * Free, local, and touches nothing public. `bench-workers.mjs` measures the
 * live action path and is dominated by the scheduler and two HTTP round trips;
 * this measures only the handler, so the two together separate "the language is
 * slow" from "the transport is slow".
 *
 * What it compares, precisely: `worker.lua`'s `compute` inside the AOS
 * emscripten module, against the Rust worker's `handle` in Node's WASM engine.
 * Both are WebAssembly under the same Node process, which is as close to
 * like-for-like as an offline test gets -- but it is NOT what production runs.
 * There, Rust is under WAMR and the Lua worker is Luerl on the BEAM, neither of
 * which appears here. Read this for the shape of the difference, not for
 * BATTLE_FLEET.md's gate 4, which needs the node.
 *
 *   node backend/native/battle-fleet/bench-runtimes.mjs [battles]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';
import { WASM_PATH } from './image.mjs';

// The AOS loader installs deterministic clock shims while it executes. Keep a
// bound reference to Node's real monotonic clock before creating the loader.
const hostNow = performance.now.bind(performance);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.dirname(HERE);
const ROOT = path.resolve(NATIVE, '..', '..');
const AOS = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const readNative = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');
const readHere = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

const battles = Number(process.argv[2] ?? 40);
if (!Number.isSafeInteger(battles) || battles < 1 || battles > 2000) {
  throw new Error('Battle count must be an integer from 1 to 2000.');
}

const OWNER = `O${'w'.repeat(42)}`;
const SCHEDULER = `S${'c'.repeat(42)}`;
const GAME = `G${'a'.repeat(42)}`;
const PLAYER = `A${'l'.repeat(42)}`;
const IMAGE = `I${'m'.repeat(42)}`;
const START = 1700000000000;

const monster = {
  name: 'Fleet Tester',
  elementType: 'fire',
  faction: 'Inferno Blades',
  level: 0,
  attack: 100,
  defense: 2,
  speed: 100,
  health: 12,
  moves: { 'Body Slam': { count: 3 }, Firenado: { count: 2 } },
};

/* ------------------------------------------------------------------ *
 * Lua: worker.lua inside the AOS module                                *
 * ------------------------------------------------------------------ */

// The whole run happens in ONE Eval. Crossing the AOS message boundary per
// action would measure the loader's JSON marshalling, which is not the Lua
// worker's cost and has no counterpart on the Rust side.
const luaBench = (count) => `
function battle_fleet_bench()
  local SCHEDULER = ${JSON.stringify(SCHEDULER)}
  local GAME = ${JSON.stringify(GAME)}
  local PLAYER = ${JSON.stringify(PLAYER)}
  local T = ${START}
  local base = {
    ["scheduler-location"] = SCHEDULER,
    process = { commitments = { owner = { type = "rsa-pss-sha512", committer = ${JSON.stringify(OWNER)} } } },
  }
  -- No in-VM timing. os.clock inside the AOS module is shimmed for
  -- determinism and returns 0 for every interval, which reads as "Lua took no
  -- time at all". The host times the Eval instead, and subtracts a run that
  -- loads exactly the same sources and plays zero battles.
  local actions = 0
  local function drive(msg)
    T = T + 1000
    base = compute(base, { body = msg, timestamp = T }, {})
    actions = actions + 1
    return json.decode(base.results.output.data)
  end
  local function delivered(fields)
    local msg = { ["from-process"] = GAME }
    for k, v in pairs(fields) do msg[k] = v end
    msg.commitments = {
      scheduler = { type = "rsa-pss-sha512", committer = SCHEDULER },
      noise = { type = "hmac-sha256", committer = GAME },
    }
    return drive(msg)
  end
  local function signed(fields)
    local msg = {}
    for k, v in pairs(fields) do msg[k] = v end
    msg.commitments = {
      signature = { alg = "rsa-pss-sha512", committer = PLAYER },
      noise = { alg = "hmac-sha256", committer = ${JSON.stringify(OWNER)} },
    }
    return drive(msg)
  end
  local function chooseMove(battleId)
    local record = BattleFleetState.battles[battleId]
    local names = {}
    for name, move in pairs(record.battle.challenger.moves or {}) do
      if (math.tointeger(move.count) or 0) > 0 then names[#names + 1] = name end
    end
    table.sort(names)
    return names[1] or "Struggle"
  end
  local rounds = 0
  for n = 1, ${count} do
    local id = "battle-" .. n
    delivered({ Action = "Battle.Open", Data = json.encode({
      protocol = "runerealm-battle-fleet/1",
      battleId = id, ticket = "ticket-" .. n,
      reservationId = "reservation-" .. n, assignmentId = "assignment-" .. n,
      playerId = PLAYER, issuedAt = T + 1000, expiresAt = T + 601000,
      difficulty = 1, monster = ${JSON.stringify(JSON.stringify(monster))} and json.decode(${JSON.stringify(JSON.stringify(monster))}),
      rewardPlan = { lootbox = 1, winExperience = 1 },
    }) })
    local index = 0
    while BattleFleetState.battles[id] and BattleFleetState.battles[id].battle.status ~= "ended" do
      index = index + 1
      rounds = rounds + 1
      signed({
        Action = "Battle.Attack", BattleId = id,
        Ticket = BattleFleetState.battles[id].ticket,
        ActionId = id .. "-attack-" .. index,
        Round = tostring(BattleFleetState.battles[id].battle.round),
        Move = chooseMove(id),
      })
      if index > 200 then error("battle " .. id .. " did not terminate") end
    end
  end
  return json.encode({ actions = actions, rounds = rounds })
end
`;

const luaSource = (count) => [
  'package.loaded[".json"] = require("json")',
  'local C = (function()', readNative('constants.lua'), 'end)()',
  readNative('monster-index.generated.lua'),
  'local jsonx = (function()', readNative('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', readNative('battle.lua'), 'end)()',
  'Authority = (function()', readHere('authority.lua'), 'end)()',
  'BattleFleetConfig = {',
  '  enabled = true,',
  `  gameProcess = ${JSON.stringify(GAME)},`,
  '  workerId = "bench-worker",',
  `  capacity = ${battles + 1},`,
  `  maxRetained = ${battles + 1},`,
  `  maxPending = ${battles + 1},`,
  '  maxOutcomes = 100000,',
  '  maxConfirmations = 100000,',
  '}',
  readHere('worker.lua'),
  luaBench(count),
  'return battle_fleet_bench()',
].join('\n');

async function runLua(count) {
  const handle = await AoLoader(fs.readFileSync(AOS), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 9_000_000_000_000,
    memoryLimit: 1024 * 1024 * 1024,
  });
  const identity = 'battle-fleet-bench'.padEnd(43, '_');
  const result = await handle(null, {
    Id: 'eval-battle-fleet-bench',
    Target: identity,
    Owner: OWNER,
    From: OWNER,
    Tags: [{ name: 'Action', value: 'Eval' }],
    Data: luaSource(count),
    'Block-Height': '1',
    Timestamp: String(START),
    Module: 'local-aos-module'.padEnd(43, '_'),
    Cron: false,
  }, {
    Process: {
      Id: identity,
      Owner: OWNER,
      Tags: [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Process' },
      ],
    },
  });
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  return JSON.parse(typeof data === 'string' ? data : data?.output);
}

/** Host-timed Lua run: the full battle Eval minus an identical setup-only one.
 * Both load the same sources into the same fresh VM, so what is left is the
 * battles. Each is run twice and the faster taken, because a single cold Eval
 * carries the module's own JIT warm-up. */
async function timeLua(count) {
  let best = Infinity;
  let result = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = hostNow();
    const run = await runLua(count);
    const seconds = (hostNow() - started) / 1000;
    if (seconds < best) { best = seconds; result = run; }
  }
  return { ...result, seconds: best };
}

/* ------------------------------------------------------------------ *
 * Rust: the shipped module through its C-string ABI                    *
 * ------------------------------------------------------------------ */

// Header-cased tag names, because that is what JSON-Iface hands the module on
// a real node; the worker matches them case-insensitively.
const rustEnv = {
  Process: {
    Id: `P${'r'.repeat(42)}`,
    Owner: OWNER,
    From: OWNER,
    Target: '',
    Data: null,
    Signature: '',
    PublicKey: '',
    Tags: [
      ['Scheduler-Location', SCHEDULER],
      ['Image', IMAGE],
      ['Battle-Protocol', 'runerealm-battle-fleet/1'],
      ['Battle-Runtime', 'rust-wasm@1'],
      ['Battle-ABI', 'hyperbeam-json-iface-cstr/1'],
      ['Battle-Clock-Mode', 'trusted-game-clock-v1'],
      ['Battle-Enabled', 'true'],
      ['Battle-Game-Process', GAME],
      ['Battle-Worker-Id', 'bench-worker'],
      ['Battle-Worker-Capacity', String(battles + 1)],
      ['Battle-Worker-Retained', String(battles + 1)],
      ['Battle-Worker-Pending', String(battles + 1)],
      ['Battle-Worker-Ticket-TTL', '3600000'],
      ['Battle-Worker-Outcomes', '100000'],
      ['Battle-Worker-Confirmations', '100000'],
    ].map(([name, value]) => ({ name, value })),
  },
};

async function runRust() {
  const module = new WebAssembly.Module(fs.readFileSync(WASM_PATH));
  const instance = new WebAssembly.Instance(module, {});
  const { memory, malloc, handle } = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const cString = (text) => {
    const encoded = encoder.encode(`${text}\0`);
    const pointer = malloc(encoded.length);
    new Uint8Array(memory.buffer, pointer, encoded.length).set(encoded);
    return pointer;
  };
  const readCString = (pointer) => {
    const view = new Uint8Array(memory.buffer);
    let end = pointer;
    while (view[end] !== 0) end += 1;
    return decoder.decode(view.subarray(pointer, end));
  };
  const environment = JSON.stringify(rustEnv);

  let elapsed = 0;
  let actions = 0;
  const call = (message) => {
    const started = hostNow();
    const pointer = handle(cString(JSON.stringify(message)), cString(environment));
    const envelope = JSON.parse(readCString(pointer));
    elapsed += hostNow() - started;
    actions += 1;
    const output = JSON.parse(envelope.response.Output.data);
    if (output.error) throw new Error(`Rust worker rejected an action: ${output.error}`);
    return output;
  };

  let clock = START;
  let rounds = 0;
  for (let n = 1; n <= battles; n += 1) {
    clock += 1000;
    const id = `battle-${n}`;
    let view = call({
      Owner: SCHEDULER,
      From: GAME,
      Tags: [
        { name: 'Action', value: 'Battle.Open' },
        { name: 'Authority-Timestamp', value: String(clock) },
      ],
      Data: JSON.stringify({
        protocol: 'runerealm-battle-fleet/1',
        battleId: id,
        ticket: `ticket-${n}`,
        reservationId: `reservation-${n}`,
        assignmentId: `assignment-${n}`,
        playerId: PLAYER,
        issuedAt: clock,
        expiresAt: clock + 600000,
        difficulty: 1,
        monster,
        rewardPlan: { lootbox: 1, winExperience: 1 },
      }),
    });
    // `Battle.Open` and every `Battle.Attack` reply IS the battle view, so the
    // loop needs no extra reads -- which matters, because a scaffolding read
    // per round would land in the measured total on one side only.
    if (view.round === undefined) {
      view = call({
        Owner: PLAYER,
        From: PLAYER,
        Tags: [
          { name: 'Action', value: 'Battle.Info' },
          { name: 'BattleId', value: id },
          { name: 'Ticket', value: `ticket-${n}` },
        ],
      });
      actions -= 1;
    }
    let index = 0;
    while (view.status !== 'ended') {
      index += 1;
      rounds += 1;
      const moves = Object.entries(view.challenger?.moves || {})
        .filter(([, move]) => Number(move.count) > 0)
        .map(([name]) => name)
        .sort();
      view = call({
        Owner: PLAYER,
        From: PLAYER,
        Tags: [
          { name: 'Action', value: 'Battle.Attack' },
          { name: 'BattleId', value: id },
          { name: 'Ticket', value: `ticket-${n}` },
          { name: 'ActionId', value: `${id}-attack-${index}` },
          { name: 'Round', value: String(view.round) },
          { name: 'Move', value: moves[0] || 'Struggle' },
        ],
      });
      if (index > 200) throw new Error(`battle ${id} did not terminate`);
    }
  }
  return { actions, rounds, seconds: elapsed / 1000 };
}

/* ------------------------------------------------------------------ */

const luaSetup = await timeLua(0);
const luaFull = await timeLua(battles);
const lua = {
  actions: luaFull.actions,
  rounds: luaFull.rounds,
  seconds: Math.max(0, luaFull.seconds - luaSetup.seconds),
};
const rust = await runRust();
console.log(`lua eval: ${luaFull.seconds.toFixed(3)}s with battles, `
  + `${luaSetup.seconds.toFixed(3)}s loading the same sources with none\n`);
const report = (label, result) => {
  const perAction = (result.seconds * 1000) / result.actions;
  console.log(`${label.padEnd(12)} ${String(result.actions).padStart(5)} actions  `
    + `${String(result.rounds).padStart(5)} rounds  `
    + `${result.seconds.toFixed(3)}s total  ${perAction.toFixed(3)}ms/action`);
  return perAction;
};
console.log(`${battles} battles, open + attack until each ends\n`);
const luaPerAction = report('lua@5.3a', lua);
const rustPerAction = report('rust-wasm@1', rust);
if (lua.rounds !== rust.rounds) {
  console.log(`\nNOTE: the two runtimes played ${lua.rounds} and ${rust.rounds} rounds. `
    + 'Per-action cost is still comparable; total time is not.');
}
console.log(`\nrust/lua per action: ${(rustPerAction / luaPerAction).toFixed(2)}x`);
console.log('Handler compute only, both under Node\'s WASM engine. Production runs '
  + 'Rust on WAMR and Lua on Luerl/BEAM, so treat this as the shape, not the number.');
