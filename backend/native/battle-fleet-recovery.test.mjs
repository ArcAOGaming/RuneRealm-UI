import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planFinalFleetRecovery, planLiveFleetRecovery, settlementIdFor,
} from './battle-fleet-recovery.mjs';

const row = {
  reservationId: 'fr1', battleId: 'fb1', workerId: 'worker-01',
  workerProcessId: 'w'.repeat(43), status: 'open', expiresAt: 10,
};

test('pending terminal settlement is recovered before expiry/cancellation', () => {
  const job = planLiveFleetRecovery(row, {
    id: 'fb1', status: 'ended', settlementStatus: 'pending',
  }, 20);
  assert.equal(settlementIdFor(row), 'worker-01-fb1');
  assert.equal(job.action, 'Fleet.Settlement.Retry');
  assert.equal(job.target, row.workerProcessId);
  assert.deepEqual(job.tags, { SettlementId: 'worker-01-fb1' });
});

test('pending worker cancellation retries its stable terminal notice directly', () => {
  const job = planLiveFleetRecovery({ ...row, status: 'cancel-pending', cancelId: 'fc1' }, {
    id: 'fb1', status: 'cancelled', cancellationStatus: 'pending',
  }, 20);
  assert.equal(job.action, 'Fleet.Cancellation.Retry');
  assert.equal(job.target, row.workerProcessId);
  assert.deepEqual(job.tags, { CancelId: 'fc1' });
});

test('missing opened/rejected delivery replays immutable authority Open', () => {
  const job = planLiveFleetRecovery({ ...row, status: 'reserved' }, null, 20);
  assert.equal(job.action, 'Admin.RetryFleetOpen');
  assert.equal(job.target, 'game');
});

test('cancel-pending recovers a missing Open before retrying an existing cancellation', () => {
  assert.equal(
    planLiveFleetRecovery({ ...row, status: 'cancel-pending' }, null, 20).action,
    'Admin.RetryFleetOpen',
  );
  assert.equal(
    planLiveFleetRecovery({ ...row, status: 'cancel-pending' }, {
      id: row.battleId, status: 'battling',
    }, 20).action,
    'Admin.RetryFleetCancel',
  );
});

test('overdue opened reservation expires after visible worker state is checked', () => {
  assert.equal(planLiveFleetRecovery(row, { id: 'fb1', status: 'battling' }, 20).action,
    'Admin.ExpireFleetBattle');
});

test('confirmed finals still recover a possibly lost Release within replay window', () => {
  const confirmed = planFinalFleetRecovery({
    ...row, kind: 'settlement', deliveryConfirmed: true, finalizedAt: 100,
  }, 150, 100);
  assert.equal(confirmed.action, 'Admin.RetryFleetAck');
  assert.equal(confirmed.reason, 'release-may-be-undelivered');
  assert.equal(planFinalFleetRecovery({
    ...row, kind: 'settlement', deliveryConfirmed: true, finalizedAt: 100,
  }, 201, 100), null);
  assert.equal(planFinalFleetRecovery({ ...row, kind: 'force' }, 150, 100), null);
});

test('an UNCONFIRMED final stays recoverable past the replay window', () => {
  // Production 2026-09-08: `fc11` was finalized at 1788823367054 and read
  // `deliveryConfirmed:false` 5.9 hours later, while `battle-worker-02`
  // published `pendingFinals: 1`. The authority never prunes an unconfirmed
  // tombstone and the worker never releases the slot, so a planner that ages
  // this out leaves the stall in place with nothing offering to repair it.
  const stale = planFinalFleetRecovery({
    ...row, kind: 'cancellation', deliveryConfirmed: false, finalizedAt: 100,
  }, 100_000, 100);
  assert.equal(stale.action, 'Admin.RetryFleetAck');
  assert.equal(stale.reason, 'final-ack-unconfirmed');
});
