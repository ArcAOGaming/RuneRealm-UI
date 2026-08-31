/** Spawn ONE throwaway Rust/WASM battle worker and prove it initializes.
 *
 * This is the smallest live test that separates "the Rust module runs on a
 * HyperBEAM node" from every deployment concern around it. It writes no
 * manifest, joins no fleet, and is never read by the allocator; the process it
 * creates is a probe and is meant to be abandoned. Use `deploy-workers.mjs` for
 * anything a player will touch.
 *
 * It is still a permanent public spawn, so it is gated the same way the fleet
 * deploy is and names itself `TEST-` like everything else this repo creates.
 *
 *   BATTLE_FLEET_ENABLED=1 node backend/native/battle-fleet/probe-rust-worker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnWasmProcess, sendMessage } from '../hbclient.mjs';
import { httpFailureSummary } from './http-error.mjs';
import { missingDeviceError, probeDevices } from './probe-devices.mjs';
import { WASM_PATH } from './image.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

if (!/^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || '')) {
  throw new Error('Battle fleet is feature-gated. Set BATTLE_FLEET_ENABLED=1 explicitly to spawn a probe.');
}

const node = (process.env.NODE_URL || 'https://hyperbeam.tylerw.ai').replace(/\/$/, '');
const gameProcess = String(process.env.BATTLE_GAME_PROCESS || '').trim();
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
if (!/^[A-Za-z0-9_-]{43}$/.test(gameProcess)) {
  throw new Error('Set BATTLE_GAME_PROCESS to a 43-character id.');
}

// `--image-id` uses a cached content id, which only resolves for a node that
// holds the module as a message with a `body` key; see wasmProcessDefinition.
// The default carries the module inline and needs nothing from the node.
const useImageId = process.argv.includes('--image-id');
const imageId = String(process.env.BATTLE_RUST_IMAGE_ID || '').trim();
if (useImageId && !/^[A-Za-z0-9_-]{43}$/.test(imageId)) {
  throw new Error('Set BATTLE_RUST_IMAGE_ID to a 43-character id, or drop --image-id.');
}
const imageBytes = useImageId ? undefined : fs.readFileSync(WASM_PATH);
if (!fs.existsSync(walletPath)) throw new Error(`No keyfile at ${walletPath}`);
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

// Fail before spawning, not after: an unresolvable device name kills the
// process at init and the spawn is permanent either way.
const devices = await probeDevices(node);
const missing = missingDeviceError(devices);
if (missing) throw new Error(`${missing} -- refusing to spawn a process that cannot initialize.`);
console.log(`devices ok on ${node}; module ${useImageId ? `by id ${imageId}` : `inline (${imageBytes.length} bytes)`}`);

const workerId = process.env.BATTLE_WORKER_ID || 'battle-probe-01';

// `--no-patch` drops `patch@1.0` from the stack. The worker then publishes
// nothing, but its raw reply is readable at `results/output/data`, which is the
// only way to see what the module actually said when the patch device is the
// thing that crashed.
const deviceStack = process.argv.includes('--no-patch')
  ? ['json-iface@1.0', 'wasm-64@1.0', 'multipass@1.0']
  : undefined;

const workerProcessId = await spawnWasmProcess({
  node,
  jwk,
  ...(useImageId ? { image: imageId } : { imageBytes }),
  ...(deviceStack ? { deviceStack } : {}),
  name: 'TEST-Rune Realm Battle Worker Probe [Rust]',
  'battle-protocol': 'runerealm-battle-fleet/1',
  'battle-runtime': 'rust-wasm@1',
  'battle-abi': 'hyperbeam-json-iface-cstr/1',
  'battle-clock-mode': 'trusted-game-clock-v1',
  'battle-enabled': true,
  'battle-game-process': gameProcess,
  'battle-worker-id': workerId,
  'battle-worker-capacity': 32,
  'battle-worker-retained': 100,
  'battle-worker-pending': 100,
  'battle-worker-ticket-ttl': 3600000,
  'battle-worker-outcomes': 10000,
  'battle-worker-confirmations': 10000,
});
console.log(`spawned ${workerProcessId}`);

// Compute is pull-based. Nothing runs until a message is scheduled and then
// somebody asks for the result.
const { slot } = await sendMessage({ node, jwk, process: workerProcessId, action: 'Fleet.Status' });
console.log(`Fleet.Status at slot ${slot}; computing...`);

async function read(pathSuffix, attempts = 20) {
  let last = 'not computed';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${node}/${workerProcessId}~process@1.0/${pathSuffix}`, {
        headers: { accept: 'application/json, text/plain' },
      });
      const body = (await response.text()).trim();
      last = httpFailureSummary(response.status, body);
      if (response.ok && body && !/^<!doctype|^<html/i.test(body)) return { ok: true, body };
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, body: last };
}

// Every path is reported rather than thrown on, because which ones answer is
// itself the diagnosis: `results/output/data` without `fleetstatus` means the
// module ran and the publish failed, and neither means it never ran.
const paths = deviceStack
  ? ['now/results/output/data', 'now/results/patches/1/fleetstatus']
  : ['now/fleetstatus', 'now/results/output/data'];
let ran = false;
for (const suffix of paths) {
  const result = await read(suffix, suffix === paths[0] ? 20 : 3);
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${suffix}: ${result.body.slice(0, 600)}`);
  ran ||= result.ok;
}
console.log(`
${ran ? 'Rust worker executed' : 'Rust worker produced nothing readable'}: ${workerProcessId}`);
