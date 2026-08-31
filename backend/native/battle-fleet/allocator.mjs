/**
 * Assign-only battle-fleet selection.
 *
 * The game authority may use this while creating a reservation. The chosen
 * worker is returned to the client, which sends every Battle.Attack directly
 * there. This module deliberately has no attack/proxy API.
 */

function hash(value) {
  let h = 2166136261;
  for (const byte of Buffer.from(String(value))) {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export const PROTOCOL = 'runerealm-battle-fleet/1';
const RUNTIMES = new Set(['lua@5.3a', 'rust-wasm@1']);

function allowedWorkers(manifest) {
  if (!manifest || manifest.protocol !== PROTOCOL || manifest.enabled !== true
      || !Array.isArray(manifest.workers)) return null;
  const byLogicalId = new Map();
  const processIds = new Set();
  for (const worker of manifest.workers) {
    if (!worker || worker.lifecycle !== 'ready'
        || typeof worker.workerId !== 'string' || !worker.workerId
        || !RUNTIMES.has(worker.runtime)
        || !/^[A-Za-z0-9_-]{43}$/.test(worker.workerProcessId || '')
        || byLogicalId.has(worker.workerId) || processIds.has(worker.workerProcessId)) {
      return null;
    }
    byLogicalId.set(worker.workerId, {
      workerProcessId: worker.workerProcessId,
      runtime: worker.runtime,
    });
    processIds.add(worker.workerProcessId);
  }
  return byLogicalId;
}

export function chooseBattleWorker(statuses, assignmentKey, manifest) {
  const allowlist = allowedWorkers(manifest);
  if (!allowlist) return null;
  const candidates = (statuses || [])
    .filter((worker) => worker && worker.protocol === PROTOCOL)
    .filter((worker) => {
      const allowed = allowlist.get(worker.workerId);
      return allowed?.workerProcessId === worker.workerProcessId
        && allowed.runtime === worker.runtime;
    })
    .filter((worker) => worker && worker.accepting === true)
    .filter((worker) => Number(worker.availableSlots) > 0)
    .filter((worker) => typeof worker.workerId === 'string' && worker.workerId)
    .map((worker) => ({
      ...worker,
      availableSlots: Math.max(0, Number(worker.availableSlots) || 0),
    }));
  if (!candidates.length) return null;

  // Capacity first prevents an almost-full worker from winning merely because
  // of its id. Hashing only breaks equal-capacity ties deterministically, so a
  // replay chooses the same process without a central mutable round-robin.
  candidates.sort((a, b) =>
    b.availableSlots - a.availableSlots
      || hash(`${assignmentKey}/${b.workerId}`) - hash(`${assignmentKey}/${a.workerId}`)
      || a.workerId.localeCompare(b.workerId));
  return candidates[0];
}

export const managerContract = Object.freeze({
  mode: 'assign-only',
  proxiesRounds: false,
  manifestRequired: true,
  protocol: PROTOCOL,
  statusKey: 'fleetstatus',
  directAction: 'Battle.Attack',
});
