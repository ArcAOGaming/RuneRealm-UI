import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBattleWorker, managerContract, PROTOCOL } from './allocator.mjs';

const onePid = `1${'a'.repeat(42)}`;
const twoPid = `2${'b'.repeat(42)}`;
const threePid = `3${'c'.repeat(42)}`;
const runtimes = {
  one: 'lua@5.3a',
  two: 'lua@5.3a',
  three: 'rust-wasm@1',
};
const manifest = {
  protocol: PROTOCOL,
  enabled: true,
  workers: [
    { workerId: 'one', workerProcessId: onePid, runtime: runtimes.one, lifecycle: 'ready' },
    { workerId: 'two', workerProcessId: twoPid, runtime: runtimes.two, lifecycle: 'ready' },
    { workerId: 'three', workerProcessId: threePid, runtime: runtimes.three, lifecycle: 'ready' },
  ],
};
const status = (workerId, workerProcessId, availableSlots, accepting = true, runtime = runtimes[workerId]) => ({
  protocol: PROTOCOL, workerId, workerProcessId, runtime, availableSlots, accepting,
});

test('returns null when every worker is unavailable', () => {
  assert.equal(chooseBattleWorker([
    status('one', onePid, 9, false),
    status('two', twoPid, 0),
  ], 'assignment', manifest), null);
});

test('prefers capacity and breaks ties deterministically', () => {
  const statuses = [
    status('one', onePid, 1),
    status('two', twoPid, 5),
    status('three', threePid, 5),
  ];
  const first = chooseBattleWorker(statuses, 'reservation-7', manifest);
  const replay = chooseBattleWorker([...statuses].reverse(), 'reservation-7', manifest);
  assert.equal(first.workerId, replay.workerId);
  assert.equal(first.availableSlots, 5);
});

test('fails closed without an exact protocol and manifest identity match', () => {
  const roguePid = `R${'x'.repeat(42)}`;
  assert.equal(chooseBattleWorker([status('one', onePid, 2)], 'a'), null,
    'a manifest is mandatory');
  assert.equal(chooseBattleWorker([
    status('rogue', roguePid, 999),
    status('one', onePid, 2),
  ], 'a', manifest).workerId, 'one', 'unknown workers are ignored');
  assert.equal(chooseBattleWorker([
    status('one', roguePid, 999),
    status('two', twoPid, 2),
  ], 'a', manifest).workerId, 'two', 'logical/process mismatches are ignored');
  assert.equal(chooseBattleWorker([
    { ...status('one', onePid, 2), protocol: 'wrong/1' },
  ], 'a', manifest), null, 'status protocol must match');
  assert.equal(chooseBattleWorker([
    status('three', threePid, 2, true, 'lua@5.3a'),
  ], 'a', manifest), null, 'status runtime must match the manifest');
  assert.equal(chooseBattleWorker([status('one', onePid, 2)], 'a', {
    ...manifest, protocol: 'wrong/1',
  }), null, 'manifest protocol must match');
});

test('fails closed on ambiguous manifest identities', () => {
  assert.equal(chooseBattleWorker([status('one', onePid, 2)], 'a', {
    ...manifest,
    workers: [
      { workerId: 'one', workerProcessId: onePid, runtime: 'lua@5.3a', lifecycle: 'ready' },
      { workerId: 'one', workerProcessId: twoPid, runtime: 'lua@5.3a', lifecycle: 'ready' },
    ],
  }), null);
  assert.equal(chooseBattleWorker([status('one', onePid, 2)], 'a', {
    ...manifest,
    workers: [
      { workerId: 'one', workerProcessId: onePid, runtime: 'lua@5.3a', lifecycle: 'ready' },
      { workerId: 'two', workerProcessId: onePid, runtime: 'lua@5.3a', lifecycle: 'ready' },
    ],
  }), null);
});

test('manager contract cannot proxy battle rounds', () => {
  assert.deepEqual(managerContract, {
    mode: 'assign-only',
    proxiesRounds: false,
    manifestRequired: true,
    protocol: PROTOCOL,
    statusKey: 'fleetstatus',
    directAction: 'Battle.Attack',
  });
});
