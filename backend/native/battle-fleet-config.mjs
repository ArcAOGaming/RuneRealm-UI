/** Validate a verified worker manifest and compile its immutable game config. */
import fs from 'node:fs';
import path from 'node:path';

export const BATTLE_FLEET_PROTOCOL = 'runerealm-battle-fleet/1';
const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;
const WORKER_ID = /^[A-Za-z0-9_-]{1,96}$/;
const RUNTIMES = new Set(['lua@5.3a', 'rust-wasm@1']);

function boundedInteger(value, name, fallback, max) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return number;
}

/**
 * A game never trusts a process id claimed by worker status. The process ids
 * here came from deployment and are the allowlist used to authenticate
 * scheduler-attested notices. Only verified ready entries enter the Lua bundle.
 */
export function validateBattleFleetManifest(raw, { expectedNode } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Battle fleet manifest must be a JSON object');
  }
  if (raw.enabled !== true) throw new Error('Battle fleet manifest is not enabled');
  if (raw.protocol !== BATTLE_FLEET_PROTOCOL) {
    throw new Error(`Battle fleet protocol must be ${BATTLE_FLEET_PROTOCOL}`);
  }
  if (raw.managerMode !== 'assign-only') {
    throw new Error('Battle fleet managerMode must be assign-only');
  }
  if (typeof raw.node !== 'string' || !/^https?:\/\//.test(raw.node)) {
    throw new Error('Battle fleet manifest needs an http(s) node');
  }
  if (expectedNode && raw.node.replace(/\/$/, '') !== expectedNode.replace(/\/$/, '')) {
    throw new Error(`Battle fleet node ${raw.node} does not match game node ${expectedNode}`);
  }
  if (!Array.isArray(raw.workers) || raw.workers.length === 0 || raw.workers.length > 64) {
    throw new Error('Battle fleet manifest needs 1 to 64 workers');
  }

  const workerIds = new Set();
  const processIds = new Set();
  const workers = raw.workers.map((worker, index) => {
    if (!worker || typeof worker !== 'object') throw new Error(`worker ${index} is invalid`);
    if (!WORKER_ID.test(worker.workerId || '')) throw new Error(`worker ${index} has invalid workerId`);
    if (!RUNTIMES.has(worker.runtime)) throw new Error(`${worker.workerId} has invalid runtime`);
    if (worker.runtime === 'rust-wasm@1' && !PROCESS_ID.test(worker.imageId || '')) {
      throw new Error(`${worker.workerId} has invalid Rust imageId`);
    }
    if (worker.runtime === 'rust-wasm@1'
        && (worker.abi !== 'hyperbeam-json-iface-cstr/1'
          || worker.clockMode !== 'trusted-game-clock-v1')) {
      throw new Error(`${worker.workerId} has unverified Rust ABI/clock`);
    }
    if (!PROCESS_ID.test(worker.workerProcessId || '')) {
      throw new Error(`${worker.workerId} has invalid workerProcessId`);
    }
    if (worker.lifecycle !== 'ready') throw new Error(`${worker.workerId} is not verified ready`);
    if (workerIds.has(worker.workerId)) throw new Error(`duplicate workerId ${worker.workerId}`);
    if (processIds.has(worker.workerProcessId)) {
      throw new Error(`duplicate workerProcessId ${worker.workerProcessId}`);
    }
    workerIds.add(worker.workerId);
    processIds.add(worker.workerProcessId);
    return Object.freeze({
      workerId: worker.workerId,
      workerProcessId: worker.workerProcessId,
      runtime: worker.runtime,
      ...(worker.runtime === 'rust-wasm@1' ? {
        imageId: worker.imageId,
        abi: worker.abi,
        clockMode: worker.clockMode,
      } : {}),
      lifecycle: 'ready',
    });
  });

  return Object.freeze({
    enabled: true,
    protocol: BATTLE_FLEET_PROTOCOL,
    managerMode: 'assign-only',
    node: raw.node.replace(/\/$/, ''),
    ticketTtl: boundedInteger(raw.ticketTtl, 'ticketTtl', 10 * 60 * 1000, 60 * 60 * 1000),
    replayWindow: boundedInteger(raw.replayWindow, 'replayWindow', 60 * 60 * 1000, 7 * 86400000),
    maxEntries: boundedInteger(raw.maxEntries, 'maxEntries', 2000, 100000),
    auditLimit: boundedInteger(raw.auditLimit, 'auditLimit', 1000, 100000),
    workers: Object.freeze(workers),
  });
}

export function loadBattleFleetManifest(file, options) {
  const resolved = path.resolve(file);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (error) { throw new Error(`Could not read battle fleet manifest ${resolved}: ${error.message}`); }
  return validateBattleFleetManifest(parsed, options);
}

function luaValue(value) {
  if (value === null) return 'nil';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(luaValue).join(',')}}`;
  return `{${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}]=${luaValue(entry)}`)
    .join(',')}}`;
}

export function battleFleetLua(config) {
  return `BattleFleetConfig = ${luaValue(config)}`;
}

/** Exact canonical comparison used after the one-time seal. Worker order is
 * load-bearing because it defines deterministic round-robin assignment. */
export function battleFleetConfigMatches(actual, expected) {
  if (!actual || !expected || actual.enabled !== true
      || actual.protocol !== expected.protocol || actual.managerMode !== expected.managerMode
      || String(actual.node || '').replace(/\/$/, '') !== expected.node
      || actual.ticketTtl !== expected.ticketTtl || actual.replayWindow !== expected.replayWindow
      || actual.maxEntries !== expected.maxEntries || actual.auditLimit !== expected.auditLimit
      || !Array.isArray(actual.workers) || actual.workers.length !== expected.workers.length) return false;
  return expected.workers.every((worker, index) => {
    const observed = actual.workers[index];
    return observed?.workerId === worker.workerId
      && observed?.workerProcessId === worker.workerProcessId
      && observed?.runtime === worker.runtime
      && observed?.imageId === worker.imageId
      && observed?.abi === worker.abi
      && observed?.clockMode === worker.clockMode;
  });
}
