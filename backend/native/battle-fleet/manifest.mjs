import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PROTOCOL = 'runerealm-battle-fleet/1';
const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;

export function createManifest(config) {
  return {
    protocol: PROTOCOL,
    enabled: true,
    node: config.node,
    gameProcess: config.gameProcess,
    size: config.size,
    composition: config.composition,
    capacityPerWorker: config.capacity,
    maxRetainedPerWorker: config.maxRetained,
    maxPendingPerWorker: config.maxPending,
    maxTicketTtlPerWorker: config.maxTicketTtl,
    maxOutcomesPerWorker: config.maxOutcomes,
    maxConfirmationsPerWorker: config.maxConfirmations,
    managerMode: 'assign-only',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workers: [],
  };
}

function assertCompatible(manifest, expected) {
  const pairs = [
    ['protocol', PROTOCOL], ['enabled', true], ['managerMode', 'assign-only'],
    ['node', expected.node],
    ['gameProcess', expected.gameProcess], ['size', expected.size],
    ['capacityPerWorker', expected.capacity],
    ['maxRetainedPerWorker', expected.maxRetained],
    ['maxPendingPerWorker', expected.maxPending],
    ['maxTicketTtlPerWorker', expected.maxTicketTtl],
    ['maxOutcomesPerWorker', expected.maxOutcomes],
    ['maxConfirmationsPerWorker', expected.maxConfirmations],
  ];
  for (const [key, value] of pairs) {
    if (manifest[key] !== value) {
      throw new Error(`Cannot resume: manifest ${key}=${JSON.stringify(manifest[key])}; expected ${JSON.stringify(value)}`);
    }
  }
  if (JSON.stringify(manifest.composition) !== JSON.stringify(expected.composition)) {
    throw new Error(`Cannot resume: manifest composition=${JSON.stringify(manifest.composition)}; expected ${JSON.stringify(expected.composition)}`);
  }
  if (!Array.isArray(manifest.workers)) throw new Error('Cannot resume: manifest workers must be an array');
  const ids = new Set();
  const operationIds = new Set();
  const processIds = new Set();
  for (const worker of manifest.workers) {
    if (!worker || typeof worker.workerId !== 'string' || !worker.workerId
        || typeof worker.runtime !== 'string' || !worker.runtime
        || typeof worker.operationId !== 'string' || !worker.operationId) {
      throw new Error('Cannot resume: every worker needs workerId, runtime, and operationId');
    }
    if (worker.lifecycle === 'spawn-intent') {
      if (worker.workerProcessId !== undefined) {
        throw new Error('Cannot resume: spawn-intent must not claim a workerProcessId');
      }
    } else if (!['spawned', 'ready'].includes(worker.lifecycle)
        || !PROCESS_ID.test(worker.workerProcessId || '')) {
      throw new Error('Cannot resume: completed spawn needs a 43-character workerProcessId');
    }
    if (worker.lifecycle === 'ready' && worker.runtime === 'rust-wasm@1'
        && (worker.abi !== 'hyperbeam-json-iface-cstr/1'
          || worker.clockMode !== 'trusted-game-clock-v1')) {
      throw new Error(`Cannot resume: ready Rust worker ${worker.workerId} has no verified ABI/clock`);
    }
    if (ids.has(worker.workerId)) throw new Error(`Cannot resume: duplicate ${worker.workerId}`);
    if (worker.workerProcessId && processIds.has(worker.workerProcessId)) {
      throw new Error(`Cannot resume: duplicate process ${worker.workerProcessId}`);
    }
    if (operationIds.has(worker.operationId)) {
      throw new Error(`Cannot resume: duplicate operation ${worker.operationId}`);
    }
    ids.add(worker.workerId);
    operationIds.add(worker.operationId);
    if (worker.workerProcessId) processIds.add(worker.workerProcessId);
    const planned = expected.specs?.find((candidate) => candidate.workerId === worker.workerId);
    if (!planned || planned.runtime !== worker.runtime
        || (planned.runtime === 'rust-wasm@1' && planned.imageId !== worker.imageId)) {
      throw new Error(`Cannot resume: ${worker.workerId} does not match the requested runtime/image plan`);
    }
  }
  if (manifest.workers.length > expected.size) {
    throw new Error('Cannot resume: manifest contains more workers than requested fleet size');
  }
}

export function prepareManifest(file, expected, { resume = false, replace = false } = {}) {
  if (resume && replace) throw new Error('Choose --resume or --replace, not both');
  const exists = fs.existsSync(file);
  if (exists && !resume && !replace) {
    throw new Error(`Manifest already exists at ${file}; use --resume or --replace explicitly`);
  }
  if (resume && !exists) throw new Error(`Cannot resume: no manifest exists at ${file}`);
  if (resume) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertCompatible(manifest, expected);
    return manifest;
  }
  return createManifest(expected);
}

export function atomicWriteManifest(file, manifest) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  const temporary = path.join(directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function spawnOperationId(manifest, workerId, runtime = 'lua@5.3a') {
  return `${PROTOCOL}:${manifest.gameProcess}:${workerId}:${runtime}`;
}

export function recordSpawnIntent(manifest, worker) {
  if (manifest.workers.some((entry) => entry.workerId === worker.workerId)) {
    throw new Error(`Manifest already contains ${worker.workerId}`);
  }
  if (typeof worker.operationId !== 'string' || !worker.operationId) {
    throw new Error('operationId is required before spawning');
  }
  manifest.workers.push({
    workerId: worker.workerId,
    runtime: worker.runtime,
    ...(worker.imageId ? { imageId: worker.imageId } : {}),
    operationId: worker.operationId,
    lifecycle: 'spawn-intent',
    statusKey: 'fleetstatus',
    intentAt: new Date().toISOString(),
  });
}

export function recordSpawnResult(manifest, worker) {
  const entry = manifest.workers.find((candidate) => candidate.workerId === worker.workerId);
  if (!entry || entry.lifecycle !== 'spawn-intent'
      || entry.operationId !== worker.operationId || entry.workerProcessId !== undefined) {
    throw new Error(`No matching pending spawn intent for ${worker.workerId}`);
  }
  if (!PROCESS_ID.test(worker.workerProcessId || '')) {
    throw new Error('workerProcessId must be a 43-character AO process id');
  }
  if (manifest.workers.some((candidate) => candidate !== entry
      && candidate.workerProcessId === worker.workerProcessId)) {
    throw new Error(`Manifest already contains process ${worker.workerProcessId}`);
  }
  entry.workerProcessId = worker.workerProcessId;
  entry.lifecycle = 'spawned';
  entry.spawnedAt = new Date().toISOString();
  return entry;
}

export function assertNoAmbiguousSpawnIntents(manifest) {
  const pending = manifest.workers.filter((worker) => worker.lifecycle === 'spawn-intent');
  if (pending.length) {
    throw new Error(`Ambiguous remote spawn intent(s): ${pending.map((worker) =>
      `${worker.workerId} [${worker.operationId}]`).join(', ')}. hbclient spawn has no idempotency key; reconcile the node result manually or use --replace after accounting for any orphan process.`);
  }
}
