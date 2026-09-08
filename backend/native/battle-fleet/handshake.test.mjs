/**
 * handshake.test.mjs — pin the terminal-handshake repair decisions.
 *
 * EVERY FIXTURE HERE IS A VERBATIM RESPONSE FROM THE LIVE NODE, key spellings
 * included, captured while reproducing and repairing the 2026-09-08 stall on
 * production `2xESlFS9AwACNgQQviiyp9krhhbr-d1gBLkVEkjMxow` /
 * `hyperbeam.tylerw.ai`. That is deliberate and it is the whole lesson of
 * HUNT.md: the previous ACK test passed against a spelling no real sender
 * emits, so it proved nothing about a real message. These bodies were read off
 * the wire with `curl`, not written by hand:
 *
 *   GET /<game>~process@1.0/compute&slot=1907/results/outbox
 *   GET /<game>~process@1.0/compute&slot=1907/results/outbox/acknowledgement
 *   GET /<game>~process@1.0/compute&slot=1908/results/outbox
 *   GET /<worker-03>~process@1.0/now/fleetstatus
 *   GET /<game>~process@1.0/now/battlefleetops
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_OUTBOX_KEYS, WORKER_OUTBOX_KEYS,
  decodeBody, handshakeOutstanding, outboxKeys,
} from './handshake.mjs';

// --- captured off the wire ---------------------------------------------------

/** `compute&slot=1907/results/outbox` — the authority holding an undelivered ACK. */
const ACK_OUTBOX = '{"acknowledgement+link":"YuAS_cqJKZBeFp9nCHLJgO9yd1dshjAEF_LKgBbD5RM","commitments":{"k_G9O1Fjo_CRmwenMUv6sVvLDBpqDixNHNxVboT9M8k":{"commitment-device":"httpsig@1.0","committed":["acknowledgement"],"keyid":"constant:ao","signature":"k_G9O1Fjo_CRmwenMUv6sVvLDBpqDixNHNxVboT9M8k","type":"hmac-sha256"}},"status":200}';

/** `compute&slot=1908/results/outbox` — the authority holding an undelivered release. */
const RELEASE_OUTBOX = '{"commitments":{"znTSUftHalI2dVU85pyxk-3exND85pPiXYRTTg5M2fg":{"commitment-device":"httpsig@1.0","committed":["release"],"keyid":"constant:ao","signature":"znTSUftHalI2dVU85pyxk-3exND85pPiXYRTTg5M2fg","type":"hmac-sha256"}},"release+link":"azlikNv_ksZBrBvrRV6gwoHjFE8_vpjKScrlBscF6yE","status":200}';

/** `compute&slot=1905/results/outbox` — a `Battle.Open`. Not this module's to push. */
const OPEN_OUTBOX = '{"commitments":{"nsse4exuF-u3ogprDixkYg1lOVFwTMBzi3aehmK1nV4":{"commitment-device":"httpsig@1.0","committed":["open"],"keyid":"constant:ao","signature":"nsse4exuF-u3ogprDixkYg1lOVFwTMBzi3aehmK1nV4","type":"hmac-sha256"}},"open+link":"OCmhJBwgi5q62kE5PY_yQllRaUBRsBT3k-UjecanFyA","status":200}';

/**
 * `results/outbox/acknowledgement` on the same slot. This is the ACTUAL ACK the
 * live authority emitted, and the reason the "a tag name's separators do not
 * survive" hypothesis is REFUTED for this handshake: the id rides `SettlementId`
 * with no separator in it at all, and `worker.lua`'s `field()` matches it
 * case-insensitively. The message was accepted by the worker the moment it was
 * actually delivered.
 */
const ACK_MESSAGE = {
  SettlementId: 'battle-worker-03-fb12',
  action: 'Fleet.Settlement.Ack',
  assignmentId: 'fa12',
  'authority-timestamp': 1788842216561,
  battleId: 'fb12',
  playerId: 'AZa4_qW5FDX1EBucY8_hwFsP5Br8pTCS4OwqZi4vwKQ',
  protocol: 'runerealm-battle-fleet/1',
  reference: 'battle-worker-03-fb12',
  reservationId: 'fr12',
  status: 200,
  target: 'HL1StM5UnwAyVcp8qP0ic4NukP64Mk4GUQpCpM_DDbs',
  ticket: 'ft12_1788842116017',
  workerId: 'battle-worker-03',
};

/** `now/battlefleetops` while fr11 was stuck and fr12 had just been repaired. */
const OPS_STUCK = {
  protocol: 'runerealm-battle-fleet/1',
  replayWindow: 3600000,
  live: [],
  finals: [
    {
      finalId: 'fc11',
      kind: 'cancellation',
      deliveryConfirmed: false,
      reservationId: 'fr11',
      battleId: 'fb11',
      workerId: 'battle-worker-02',
      workerProcessId: 'ay8fImI69R29328yuOX3ZBz430KA5HviARajddaVgOo',
    },
    {
      finalId: 'battle-worker-03-fb12',
      kind: 'settlement',
      deliveryConfirmed: true,
      confirmationId: 'battle-worker-03-final-acked-settlement-battle-worker-03-fb12',
      reservationId: 'fr12',
      battleId: 'fb12',
      workerId: 'battle-worker-03',
      workerProcessId: 'HL1StM5UnwAyVcp8qP0ic4NukP64Mk4GUQpCpM_DDbs',
    },
  ],
};

/** `now/fleetstatus` on worker-02 while it held fc11, and on worker-03 once drained. */
const WORKER_02_STUCK = {
  workerId: 'battle-worker-02',
  accepting: true,
  pendingCancellations: 1,
  pendingConfirmations: 0,
  pendingFinals: 1,
  pendingLimit: 100,
  pendingSettlements: 0,
  retainedConfirmations: 3,
};
const WORKER_03_DRAINED = {
  workerId: 'battle-worker-03',
  accepting: true,
  pendingCancellations: 0,
  pendingConfirmations: 0,
  pendingFinals: 0,
  pendingLimit: 100,
  pendingSettlements: 0,
  retainedConfirmations: 1,
};
/** worker-03 between hop 3 and hop 4: the authority confirmed, the release is not back. */
const WORKER_03_UNRELEASED = { ...WORKER_03_DRAINED, pendingConfirmations: 1 };

// --- the node's absent-key answer -------------------------------------------

test('an HTML body at 200 decodes as absent, never as content', () => {
  assert.equal(decodeBody('<!DOCTYPE html>\n<html lang="en">'), null);
  assert.equal(decodeBody('   '), null);
  assert.equal(decodeBody('not json'), null);
  assert.deepEqual(decodeBody('{"a":1}'), { a: 1 });
});

// --- which hop is a slot holding --------------------------------------------

test('a nested outbox value is named `<key>+link`, and both spellings count', () => {
  assert.deepEqual(outboxKeys(ACK_OUTBOX, AUTHORITY_OUTBOX_KEYS), ['acknowledgement']);
  assert.deepEqual(outboxKeys(RELEASE_OUTBOX, AUTHORITY_OUTBOX_KEYS), ['release']);
  // The un-linked spelling has to work too: a small value is inlined.
  assert.deepEqual(
    outboxKeys('{"acknowledgement":{"action":"Fleet.Settlement.Ack"},"status":200}',
      AUTHORITY_OUTBOX_KEYS),
    ['acknowledgement'],
  );
});

test('a Battle.Open slot is not this module\'s to push', () => {
  assert.deepEqual(outboxKeys(OPEN_OUTBOX, AUTHORITY_OUTBOX_KEYS), []);
  assert.deepEqual(outboxKeys(OPEN_OUTBOX, WORKER_OUTBOX_KEYS), []);
  // A mint is the one that must never be re-pushed from a repair loop.
  assert.deepEqual(
    outboxKeys('{"mint+link":"x","status":200}', AUTHORITY_OUTBOX_KEYS), [],
  );
});

test('commitments and status are envelope, not outbox entries', () => {
  const keys = outboxKeys(ACK_OUTBOX);
  assert.ok(keys.includes('acknowledgement'));
  assert.ok(!keys.includes('commitments'));
});

// --- the ACK the authority really emits -------------------------------------

test('the live ACK carries its id on `SettlementId`, which survives HTTP intact', () => {
  // Header names are lowercased on the wire, so this is what `worker.lua`'s
  // `field(msg, "settlementid")` has to match — and does, case-insensitively.
  assert.equal(ACK_MESSAGE.SettlementId.toLowerCase(), 'battle-worker-03-fb12');
  assert.equal(String(ACK_MESSAGE.SettlementId).includes('-'), true,
    'the VALUE contains hyphens; the KEY must not, or the separator rule bites');
  assert.equal(Object.keys(ACK_MESSAGE).some((k) => /^settlementid$/i.test(k)), true);
  // `target` is the ANS-104 routing field, not a tag the handler reads.
  assert.equal(ACK_MESSAGE.target.length, 43);
  assert.equal(ACK_MESSAGE.action, 'Fleet.Settlement.Ack');
});

// --- what is still outstanding ----------------------------------------------

test('an unconfirmed tombstone is outstanding even when its worker looks idle', () => {
  const out = handshakeOutstanding({
    ops: OPS_STUCK, workers: [WORKER_02_STUCK, WORKER_03_DRAINED],
  });
  assert.equal(out.done, false);
  assert.deepEqual(out.finals.map((f) => f.reservationId), ['fr11']);
  assert.deepEqual(out.holding.map((w) => w.workerId), ['battle-worker-02']);
});

test('a worker holding an unreleased receipt is outstanding with no unconfirmed final', () => {
  const ops = { finals: [{ ...OPS_STUCK.finals[1] }] };
  const out = handshakeOutstanding({ ops, workers: [WORKER_03_UNRELEASED] });
  assert.equal(out.done, false, 'hop 4 (the release) is still owed');
  assert.deepEqual(out.finals, []);
  assert.deepEqual(out.holding, [{
    workerId: 'battle-worker-03', pendingFinals: 0, pendingConfirmations: 1,
  }]);
});

test('a fully closed handshake is done', () => {
  const ops = { finals: [{ ...OPS_STUCK.finals[1] }] };
  const out = handshakeOutstanding({ ops, workers: [WORKER_03_DRAINED] });
  assert.equal(out.done, true);
  assert.deepEqual(out.finals, []);
  assert.deepEqual(out.holding, []);
});

test('an owner force-resolution is not waiting on any worker', () => {
  const ops = {
    finals: [{
      finalId: 'fx1', kind: 'force', deliveryConfirmed: false, reservationId: 'fr99',
    }],
  };
  assert.equal(handshakeOutstanding({ ops, workers: [] }).done, true);
});

test('an absent battlefleetops is not read as "nothing outstanding"', () => {
  // `readPublished` returns null for the node's HTML-at-200, and null ops must
  // not be mistaken for a clean fleet by a caller that only checks `done`.
  const out = handshakeOutstanding({ ops: null, workers: [WORKER_02_STUCK] });
  assert.equal(out.done, false, 'the worker is still holding, so this is not clean');
});
