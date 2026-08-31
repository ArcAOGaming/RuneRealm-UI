export const BATTLE_FLEET_PROTOCOL = 'runerealm-battle-fleet/1';

/**
 * Validate the immutable identity/configuration behind a worker status read.
 *
 * `accepting` is deliberately not a readiness requirement: it is a stale,
 * advisory capacity sample. Battle.Open remains the serialized admission
 * decision. Deployment does require the worker to be configured, undrained,
 * and bound to the exact game process that will seal the manifest.
 */
export function workerReadinessError(status, expected) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return 'status must be an object';
  }
  const exact = [
    ['protocol', BATTLE_FLEET_PROTOCOL],
    ['workerId', expected.workerId],
    ['runtime', expected.runtime],
    ['gameProcess', expected.gameProcess],
    ['enabled', true],
    ['configured', true],
    ['lifecycle', 'ready'],
    ['managerMode', 'assign-only'],
    ['managerProxiesRounds', false],
    ['directAction', 'Battle.Attack'],
    ['capacity', expected.capacity],
    ['retentionLimit', expected.maxRetained],
    ['pendingLimit', expected.maxPending],
    ['maxTicketTtl', expected.maxTicketTtl],
    ['outcomeLimit', expected.maxOutcomes],
    ['confirmationLimit', expected.maxConfirmations],
  ];
  for (const [field, value] of exact) {
    if (status[field] !== value) {
      return `${field}=${JSON.stringify(status[field])}; expected ${JSON.stringify(value)}`;
    }
  }
  if (expected.runtime === 'rust-wasm@1') {
    if (status.imageId !== expected.imageId) {
      return `imageId=${JSON.stringify(status.imageId)}; expected ${JSON.stringify(expected.imageId)}`;
    }
    if (status.abi !== 'hyperbeam-json-iface-cstr/1') {
      return `abi=${JSON.stringify(status.abi)}; expected "hyperbeam-json-iface-cstr/1"`;
    }
    if (status.clockMode !== 'trusted-game-clock-v1') {
      return `clockMode=${JSON.stringify(status.clockMode)}; expected "trusted-game-clock-v1"`;
    }
  }
  return null;
}

export function assertWorkerReady(status, expected) {
  const problem = workerReadinessError(status, expected);
  if (problem) throw new Error(`worker readiness mismatch: ${problem}`);
  return status;
}
