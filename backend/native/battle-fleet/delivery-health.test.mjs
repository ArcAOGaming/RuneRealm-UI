/**
 * The gate that would have caught the 2026-09-08 production stall.
 *
 * Every fixture here is the SHAPE THE LIVE NODE ACTUALLY SERVED, keys and
 * spellings included — `battlefleetops.finals[].deliveryConfirmed` from the
 * authority and `fleetstatus.pendingFinals`/`pendingLimit` from a worker. A
 * test written against invented key names is exactly how a verifier passes
 * against a process it cannot read.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodePublished,
  deliveryHealth,
  finalConfirmed,
  recoveryHint,
  unconfirmedFinals,
  workerHeadroom,
} from './delivery-health.mjs';

// Verbatim from
// GET https://hyperbeam.tylerw.ai/2xESlFS9AwACNgQQviiyp9krhhbr-d1gBLkVEkjMxow~process@1.0/now/battlefleetops
// on 2026-09-08, trimmed to the fields the gate reads.
const STALLED_OPS = {
  lastSequence: 10,
  finals: [
    {
      reservationId: 'fr3',
      battleId: 'fb3',
      kind: 'settlement',
      finalId: 'battle-worker-03-fb3',
      workerProcessId: 'HL1StM5UnwAyVcp8qP0ic4NukP64Mk4GUQpCpM_DDbs',
      compact: true,
      deliveryConfirmed: false,
      status: 'settled',
    },
    {
      reservationId: 'fr4',
      battleId: 'fb4',
      kind: 'settlement',
      finalId: 'battle-worker-01-fb4',
      workerProcessId: 'JEQiNb0yalyPBTFsyyKcgmVcwlzDCQH-LcW8zg83fHU',
      compact: true,
      deliveryConfirmed: false,
      status: 'settled',
    },
  ],
};

// Verbatim from GET .../JEQiNb0y…~process@1.0/now/fleetstatus after the stuck
// slots were pushed by hand — the healthy shape.
const HEALTHY_WORKER = {
  workerId: 'battle-worker-01',
  accepting: true,
  active: 0,
  pendingFinals: 0,
  pendingSettlements: 0,
  pendingCancellations: 0,
  pendingConfirmations: 0,
  pendingLimit: 100,
  retainedFinals: 4,
  retainedConfirmations: 4,
  confirmationLimit: 10000,
  retentionLimit: 100,
};

const STALLED_WORKER = {
  ...HEALTHY_WORKER,
  workerId: 'battle-worker-03',
  pendingFinals: 3,
  pendingSettlements: 1,
  pendingCancellations: 2,
};

test('an absent published key is HTML at status 200, not an error', () => {
  // The node serves its own landing page for a key nobody published. Anything
  // that hands this to JSON.parse dies on `<`.
  assert.equal(decodePublished('<!DOCTYPE html>\n<html lang="en">…'), null);
  assert.equal(decodePublished('  <html><head><title>404 - Page not found.</title>'), null);
  assert.equal(decodePublished(''), null);
  assert.equal(decodePublished(null), null);
  assert.equal(decodePublished('not json'), null);
  assert.deepEqual(decodePublished('{"finals":[]}'), { finals: [] });
});

test('unconfirmed finals are the ones the worker never acknowledged', () => {
  assert.equal(unconfirmedFinals(STALLED_OPS).length, 2);
  const confirmed = {
    finals: STALLED_OPS.finals.map((f) => ({ ...f, deliveryConfirmed: true })),
  };
  assert.equal(unconfirmedFinals(confirmed).length, 0);
  assert.equal(unconfirmedFinals(undefined).length, 0);
  assert.equal(unconfirmedFinals({ finals: 'nope' }).length, 0);
});

test('a reservation is only confirmed when its own tombstone says so', () => {
  // Missing is not confirmed, and it is not an error either: the caller polls.
  assert.deepEqual(
    { ...finalConfirmed(STALLED_OPS, 'fr99'), final: null },
    { found: false, confirmed: false, final: null },
  );
  const stuck = finalConfirmed(STALLED_OPS, 'fr4');
  assert.equal(stuck.found, true);
  assert.equal(stuck.confirmed, false);

  const acked = {
    finals: [{ ...STALLED_OPS.finals[1], deliveryConfirmed: true }],
  };
  assert.equal(finalConfirmed(acked, 'fr4').confirmed, true);
});

test('headroom counts down to the wall that stops admission', () => {
  assert.deepEqual(workerHeadroom(HEALTHY_WORKER), {
    workerId: 'battle-worker-01',
    pendingFinals: 0,
    pendingSettlements: 0,
    pendingCancellations: 0,
    pendingLimit: 100,
    headroom: 100,
    retainedConfirmations: 4,
    confirmationLimit: 10000,
    accepting: true,
  });
  assert.equal(workerHeadroom(STALLED_WORKER).headroom, 97);
  // An unreadable status must not read as infinite headroom.
  assert.equal(workerHeadroom({}).headroom, null);
});

test('the production stall is reported as stalled, not ok', () => {
  const health = deliveryHealth({
    ops: STALLED_OPS,
    workers: [HEALTHY_WORKER, STALLED_WORKER],
  });
  assert.equal(health.verdict, 'stalled');
  assert.equal(health.unconfirmed.length, 2);
  assert.deepEqual(health.unconfirmed.map((f) => f.reservationId), ['fr3', 'fr4']);
  assert.deepEqual(health.jammed, []);
  // The wall is a tenth of the smallest configured limit, not a constant: the
  // next fleet may not use 100.
  assert.equal(health.warnAt, 10);
  assert.equal(recoveryHint(health).stuck, 2);
});

test('a fleet that drained its terminals is ok and needs no recovery', () => {
  const health = deliveryHealth({
    ops: { finals: STALLED_OPS.finals.map((f) => ({ ...f, deliveryConfirmed: true })) },
    workers: [HEALTHY_WORKER, { ...HEALTHY_WORKER, workerId: 'battle-worker-02' }],
  });
  assert.equal(health.verdict, 'ok');
  assert.equal(health.unconfirmed.length, 0);
  assert.equal(recoveryHint(health), null);
});

test('approaching the pending limit is jammed, and so is a worker that stopped accepting', () => {
  const nearWall = { ...HEALTHY_WORKER, workerId: 'battle-worker-04', pendingFinals: 91 };
  const jammed = deliveryHealth({ ops: STALLED_OPS, workers: [nearWall] });
  assert.equal(jammed.verdict, 'jammed');
  assert.deepEqual(jammed.jammed, ['battle-worker-04']);

  // Already refusing opens with terminals outstanding — the failure this whole
  // file exists to make loud. `accepting:false` alone is a drain, not a jam.
  const refusing = deliveryHealth({
    ops: STALLED_OPS,
    workers: [{ ...STALLED_WORKER, accepting: false }],
  });
  assert.equal(refusing.verdict, 'jammed');

  const drained = deliveryHealth({
    ops: { finals: [] },
    workers: [{ ...HEALTHY_WORKER, accepting: false }],
  });
  assert.equal(drained.verdict, 'ok');
});

test('warnAt can be pinned explicitly for a fleet with a small pending limit', () => {
  // Half of a four-deep worker is spent, but a tenth of 4 floors to the
  // minimum of 1, so the derived threshold calls this merely stalled. A
  // deployment that knows its limit is small says so.
  const small = { ...HEALTHY_WORKER, pendingFinals: 2, pendingLimit: 4 };
  const derived = deliveryHealth({ ops: { finals: [] }, workers: [small] });
  assert.equal(derived.warnAt, 1);
  assert.equal(derived.verdict, 'stalled');
  assert.equal(
    deliveryHealth({ ops: { finals: [] }, workers: [small], warnAt: 2 }).verdict,
    'jammed',
  );
});
