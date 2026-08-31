/**
 * Put the comparison set on a node and record what it spawned.
 *
 * Four processes, all doing the same trivial `Fleet.Status`, so the only
 * variable is what executes it:
 *
 *   lua     the real Lua worker under `lua@5.3a` (Luerl, on the BEAM)
 *   rust    the real Rust worker under `json-iface@1.0` + `wasm-64@1.0`
 *   floor   a 275-byte WAT that returns a constant, same ABI, same stack
 *   bulk    a 360 KB WAT that returns the same constant
 *
 * `floor` and `bulk` are the controls that make the numbers mean something.
 * Without them a slow Rust worker is just "Rust is slow"; with them you can see
 * how much of a slot is the device stack, how much is module size, and how much
 * is the module actually running. On hyperbeam.tylerw.ai they answered that:
 * both cost the same, and both cost what a whole Lua slot costs.
 *
 *   node seed.mjs [node-url]        # default http://localhost:8734
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnProcess, spawnWasmProcess, sendMessage } from '../../hbclient.mjs';
import { buildWorkerSource } from '../bundle.mjs';
import { cacheModuleOnNode, verifyCachedModule, WASM_PATH } from '../image.mjs';
import { missingDeviceError, probeDevices } from '../probe-devices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const node = (process.argv[2] || process.env.NODE_URL || 'http://localhost:8734').replace(/\/$/, '');
const outputPath = path.join(HERE, `workers.${new URL(node).port || 'remote'}.json`);

const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
if (!fs.existsSync(walletPath)) throw new Error(`No keyfile at ${walletPath}`);
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

// Any 43-character id works: nothing here ever sends a game-origin action, and
// binding a real game process to a throwaway lab worker would be worse.
const gameProcess = process.env.BATTLE_GAME_PROCESS || `L${'ab'.repeat(21)}`;

const missing = missingDeviceError(await probeDevices(node));
if (missing) throw new Error(`${missing} -- nothing here can run on that node.`);
console.log(`node ${node}: devices ok`);

/** Assemble a control module from WAT. Kept as source, not a checked-in binary,
 * because the whole point of a control is that you can read what it does. */
function assembleWat(name) {
  const wat = path.join(HERE, `${name}.wat`);
  const wasm = path.join(HERE, `${name}.wasm`);
  const result = spawnSync('wasm-tools', ['parse', wat, '-o', wasm], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`wasm-tools parse ${name}.wat failed: ${result.stderr || result.stdout}`);
  }
  return fs.readFileSync(wasm);
}

async function cache(label, bytes) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const { id } = await cacheModuleOnNode({ node, jwk, bytes, sha256, log: () => {} });
  const check = await verifyCachedModule(id, { node, sha256 });
  if (!check.ok) throw new Error(`${label} did not cache correctly: ${check.reason}`);
  console.log(`  cached ${label.padEnd(6)} ${bytes.length.toString().padStart(7)} bytes -> ${id}`);
  return id;
}

const wasmWorkers = [
  ['rust', fs.readFileSync(WASM_PATH), true],
  ['floor', assembleWat('floor'), false],
  ['bulk', assembleWat('bulk'), false],
];

const workers = [];

// Lua first: it needs no image, so a failure here is about the node, not us.
process.stdout.write('spawning lua... ');
const luaProcessId = await spawnProcess({
  node,
  jwk,
  lua: buildWorkerSource({
    gameProcess,
    workerId: 'lab-lua',
    capacity: 32,
    maxRetained: 100,
    maxPending: 100,
    maxTicketTtl: 3600000,
    maxOutcomes: 10000,
    maxConfirmations: 10000,
    enabled: true,
  }),
  name: 'TEST-Rune Realm Lab Worker [Lua]',
  'battle-runtime': 'lua@5.3a',
});
console.log(luaProcessId);
workers.push({ label: 'lua', runtime: 'lua@5.3a', processId: luaProcessId, results: ['results/output/data', 'results/data'] });

for (const [label, bytes, isRealWorker] of wasmWorkers) {
  const image = await cache(label, bytes);
  process.stdout.write(`spawning ${label}... `);
  const processId = await spawnWasmProcess({
    node,
    jwk,
    image,
    name: `TEST-Rune Realm Lab Worker [${label}]`,
    // The controls answer any action with the same constant, so they need no
    // configuration; the real worker refuses to initialize without all of it.
    ...(isRealWorker ? {
      'battle-protocol': 'runerealm-battle-fleet/1',
      'battle-runtime': 'rust-wasm@1',
      'battle-abi': 'hyperbeam-json-iface-cstr/1',
      'battle-clock-mode': 'trusted-game-clock-v1',
      'battle-enabled': true,
      'battle-game-process': gameProcess,
      'battle-worker-id': 'lab-rust',
      'battle-worker-capacity': 32,
      'battle-worker-retained': 100,
      'battle-worker-pending': 100,
      'battle-worker-ticket-ttl': 3600000,
      'battle-worker-outcomes': 10000,
      'battle-worker-confirmations': 10000,
    } : { 'lab-control': label }),
  });
  console.log(processId);
  workers.push({ label, runtime: 'rust-wasm@1', processId, image, results: ['results/data', 'results/output/data'] });
}

// Prove each one computes before recording it. A process that spawned but dies
// at init looks identical in a manifest and turns the whole benchmark into a
// timeout.
for (const worker of workers) {
  const { slot } = await sendMessage({ node, jwk, process: worker.processId, action: 'Fleet.Status' });
  let ok = false;
  for (const suffix of worker.results) {
    const response = await fetch(`${node}/${worker.processId}~process@1.0/compute&slot=${slot}/${suffix}`,
      { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(120000) });
    const body = await response.text();
    if (response.ok && !/^<!doctype|^<html/i.test(body.trim())) {
      console.log(`${worker.label.padEnd(6)} ok: ${body.slice(0, 90)}`);
      worker.results = [suffix];
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error(`${worker.label} (${worker.processId}) produced no readable result`);
}

fs.writeFileSync(outputPath, `${JSON.stringify({ node, gameProcess, workers }, null, 2)}\n`);
console.log(`\nwrote ${outputPath}`);
