/** Pre-provision a crash-resumable, explicitly gated bot-battle worker pool. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnProcess, spawnWasmProcess, sendMessage } from '../hbclient.mjs';
import { buildWorkerSource } from './bundle.mjs';
import {
  assertNoAmbiguousSpawnIntents, atomicWriteManifest, prepareManifest,
  recordSpawnIntent, recordSpawnResult, spawnOperationId,
} from './manifest.mjs';
import { resolveRustImageId } from './image.mjs';
import { httpFailureSummary } from './http-error.mjs';
import { workerReadinessError } from './readiness.mjs';
import {
  LUA_BATTLE_RUNTIME, RUST_BATTLE_RUNTIME, battleFleetComposition, battleWorkerSpecs,
} from './runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
if (!/^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || '')) {
  throw new Error('Battle fleet is feature-gated. Set BATTLE_FLEET_ENABLED=1 explicitly to deploy.');
}

const resume = process.argv.includes('--resume');
const replace = process.argv.includes('--replace');
const node = process.env.NODE_URL || 'https://schedule.forward.computer';
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const gameProcess = process.env.BATTLE_GAME_PROCESS || '';

// Resolve the Rust worker's image before planning the fleet.
//
// `battleWorkerSpecs` is a pure planner and stays one: it is handed an id, it
// does not go and get one. What it used to demand was that an operator had
// already cached the WASM on the node by hand and pasted the result into an
// environment variable, which made every deploy depend on privileged access to
// the host. `image.mjs` publishes the module to Arweave instead -- once per
// distinct binary, recorded in published.json -- and verifies the node serves
// exactly those bytes. Set BATTLE_RUST_IMAGE_ID to pin a known image; it is
// still verified against the build.
const deployEnv = { ...process.env };
if (Number(deployEnv.BATTLE_FLEET_RUST ?? 2) > 0 && !deployEnv.BATTLE_RUST_IMAGE_ID) {
  const keyfile = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  const { imageId } = await resolveRustImageId({
    node,
    jwk: fs.existsSync(keyfile) ? JSON.parse(fs.readFileSync(keyfile, 'utf8')) : null,
    env: deployEnv,
    publish: !process.argv.includes('--no-publish'),
  });
  deployEnv.BATTLE_RUST_IMAGE_ID = imageId;
}

const specs = battleWorkerSpecs(deployEnv);
const size = specs.length;
const composition = battleFleetComposition(specs);
const capacity = Number(process.env.BATTLE_WORKER_CAPACITY || 32);
const maxRetained = Number(process.env.BATTLE_WORKER_RETAINED || 100);
const maxPending = Number(process.env.BATTLE_WORKER_PENDING || maxRetained);
const maxTicketTtl = Number(process.env.BATTLE_WORKER_TICKET_TTL || 60 * 60 * 1000);
const maxOutcomes = Number(process.env.BATTLE_WORKER_OUTCOMES || 10000);
const maxConfirmations = Number(process.env.BATTLE_WORKER_CONFIRMATIONS || maxOutcomes);
const outputPath = path.resolve(process.env.BATTLE_FLEET_MANIFEST
  || path.join(HERE, 'manifest.local.json'));

if (!/^[A-Za-z0-9_-]{43}$/.test(gameProcess)) {
  throw new Error('Set BATTLE_GAME_PROCESS to the 43-character clean-test game process id.');
}
for (const [name, value, limit] of [
  ['BATTLE_FLEET_SIZE', size, 64],
  ['BATTLE_WORKER_CAPACITY', capacity, 10000],
  ['BATTLE_WORKER_RETAINED', maxRetained, 10000],
  ['BATTLE_WORKER_PENDING', maxPending, 10000],
  ['BATTLE_WORKER_TICKET_TTL', maxTicketTtl, 7 * 24 * 60 * 60 * 1000],
  ['BATTLE_WORKER_OUTCOMES', maxOutcomes, 100000],
  ['BATTLE_WORKER_CONFIRMATIONS', maxConfirmations, 100000],
]) {
  const minimum = name === 'BATTLE_WORKER_TICKET_TTL' ? 60000 : 1;
  if (!Number.isInteger(value) || value < minimum || value > limit) {
    throw new Error(`${name} must be an integer from ${minimum} to ${limit}.`);
  }
}
if (!fs.existsSync(walletPath)) throw new Error(`No keyfile at ${walletPath}`);
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const expected = {
  node, gameProcess, size, composition, specs, capacity, maxRetained, maxPending, maxTicketTtl,
  maxOutcomes,
  maxConfirmations,
};
const manifest = prepareManifest(outputPath, expected, { resume, replace });
// Establish the destination before the first permanent operation and enforce
// the explicit no-overwrite policy even for an empty fleet.
atomicWriteManifest(outputPath, manifest);
// hbclient's spawn endpoint does not accept an idempotency key. A persisted
// intent with no result therefore represents an unknowable remote outcome and
// must never be retried automatically.
assertNoAmbiguousSpawnIntents(manifest);

async function readStatus(workerProcessId, worker) {
  let last = 'not computed';
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(
        `${node}/${workerProcessId}~process@1.0/now/fleetstatus`,
        { headers: { accept: 'application/json, text/plain' } },
      );
      const body = (await response.text()).trim();
      last = httpFailureSummary(response.status, body);
      if (response.ok && body && !/^<!doctype|^<html/i.test(body)) {
        const status = JSON.parse(body);
        const mismatch = workerReadinessError(status, {
          workerId: worker.workerId, runtime: worker.runtime, imageId: worker.imageId,
          gameProcess, capacity, maxRetained, maxPending,
          maxTicketTtl, maxOutcomes, maxConfirmations,
        });
        if (!mismatch) return status;
        last = `readiness mismatch: ${mismatch}`;
      }
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${worker.workerId} (${worker.runtime}) did not publish a valid fleetstatus: ${last}`);
}

async function readImmutableField(workerProcessId, field) {
  let last = 'not available';
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(
        `${node}/${workerProcessId}~process@1.0/now/process/${field}`,
        { headers: { accept: 'application/json, text/plain' } },
      );
      const body = (await response.text()).trim();
      last = httpFailureSummary(response.status, body);
      if (response.ok && body && !/^<!doctype|^<html/i.test(body)) {
        try {
          const decoded = JSON.parse(body);
          if (typeof decoded === 'string' || typeof decoded === 'number') return String(decoded);
        } catch { /* plain scalar */ }
        return body;
      }
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${workerProcessId} immutable process/${field} was not readable: ${last}`);
}

async function verifyRustProcessDefinition(workerProcessId, worker) {
  const exact = new Map([
    ['image', worker.imageId],
    ['execution-device', 'stack@1.0'],
    ['patch-from', '/results/outbox'],
    ['patch-to', '/'],
    ['passes', '2'],
    ['device-stack/1', 'json-iface@1.0'],
    ['device-stack/2', 'wasm-64@1.0'],
    ['device-stack/3', 'multipass@1.0'],
    ['device-stack/4', 'patch@1.0'],
  ]);
  for (const [field, expectedValue] of exact) {
    const actual = await readImmutableField(workerProcessId, field);
    if (actual !== expectedValue) {
      throw new Error(`${worker.workerId} immutable process/${field}=${JSON.stringify(actual)}; expected ${JSON.stringify(expectedValue)}`);
    }
  }
}

for (let index = 1; index <= size; index++) {
  const worker = specs[index - 1];
  const { workerId, runtime } = worker;
  let entry = manifest.workers.find((worker) => worker.workerId === workerId);
  if (!entry) {
    const operationId = spawnOperationId(manifest, workerId, runtime);
    recordSpawnIntent(manifest, {
      workerId, runtime, operationId, ...(worker.imageId ? { imageId: worker.imageId } : {}),
    });
    // This write is deliberately before the first remote side effect.
    atomicWriteManifest(outputPath, manifest);
    let workerProcessId;
    if (runtime === LUA_BATTLE_RUNTIME) {
      const source = buildWorkerSource({
        gameProcess, workerId, capacity, maxRetained, maxPending, maxTicketTtl,
        maxOutcomes, maxConfirmations, enabled: true,
      });
      process.stdout.write(`spawning ${workerId} (${runtime}, ${Buffer.byteLength(source)} bytes)... `);
      workerProcessId = await spawnProcess({
        node, jwk, lua: source,
        name: `TEST-Rune Realm Battle Worker ${String(index).padStart(2, '0')} [Lua]`,
        'battle-runtime': runtime,
      });
    } else if (runtime === RUST_BATTLE_RUNTIME) {
      process.stdout.write(`spawning ${workerId} (${runtime}, image ${worker.imageId})... `);
      workerProcessId = await spawnWasmProcess({
        node, jwk, image: worker.imageId,
        name: `TEST-Rune Realm Battle Worker ${String(index).padStart(2, '0')} [Rust]`,
        'battle-protocol': 'runerealm-battle-fleet/1',
        'battle-runtime': runtime,
        'battle-abi': 'hyperbeam-json-iface-cstr/1',
        'battle-clock-mode': 'trusted-game-clock-v1',
        'battle-enabled': true,
        'battle-game-process': gameProcess,
        'battle-worker-id': workerId,
        'battle-worker-capacity': capacity,
        'battle-worker-retained': maxRetained,
        'battle-worker-pending': maxPending,
        'battle-worker-ticket-ttl': maxTicketTtl,
        'battle-worker-outcomes': maxOutcomes,
        'battle-worker-confirmations': maxConfirmations,
      });
    } else {
      throw new Error(`Unsupported battle runtime ${runtime}`);
    }
    // Complete the already-persisted intent before initialization, reads, or
    // any other fallible network operation. --resume will pick up here.
    recordSpawnResult(manifest, { workerId, operationId, workerProcessId });
    atomicWriteManifest(outputPath, manifest);
    entry = manifest.workers.find((worker) => worker.workerId === workerId);
  } else {
    process.stdout.write(`resuming ${workerId} ${entry.workerProcessId}... `);
  }

  const { slot } = await sendMessage({
    node, jwk, process: entry.workerProcessId, action: 'Fleet.Status',
  });
  const status = await readStatus(entry.workerProcessId, worker);
  if (runtime === RUST_BATTLE_RUNTIME) {
    await verifyRustProcessDefinition(entry.workerProcessId, worker);
  }
  entry.lifecycle = 'ready';
  if (runtime === RUST_BATTLE_RUNTIME) {
    entry.abi = status.abi;
    entry.clockMode = status.clockMode;
  }
  entry.initializedSlot = slot;
  entry.accepting = status.accepting;
  entry.verifiedAt = new Date().toISOString();
  atomicWriteManifest(outputPath, manifest);
  console.log(`${entry.workerProcessId} (init slot ${slot}, ${status.availableSlots} slots)`);
}

console.log(`wrote ${outputPath}`);
