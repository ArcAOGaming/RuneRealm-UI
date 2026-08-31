import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoAmbiguousSpawnIntents, atomicWriteManifest, prepareManifest,
  recordSpawnIntent, recordSpawnResult, spawnOperationId,
} from './manifest.mjs';
import { assertWorkerReady, workerReadinessError } from './readiness.mjs';

const expected = {
  node: 'https://node.example',
  gameProcess: `G${'a'.repeat(42)}`,
  size: 2,
  composition: { lua: 2, rust: 0 },
  specs: [
    { workerId: 'battle-worker-01', runtime: 'lua@5.3a' },
    { workerId: 'battle-worker-02', runtime: 'lua@5.3a' },
  ],
  capacity: 8,
  maxRetained: 4,
  maxPending: 2,
  maxTicketTtl: 3600000,
  maxOutcomes: 1000,
  maxConfirmations: 1000,
};

test('manifest is atomic, crash-resumable, and never implicitly overwritten', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-fleet-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'nested', 'manifest.json');

  const manifest = prepareManifest(file, expected);
  atomicWriteManifest(file, manifest);
  assert.equal(fs.existsSync(file), true, 'writer creates parent directory');
  assert.throws(() => prepareManifest(file, expected), /--resume or --replace/);

  const workerProcessId = `W${'p'.repeat(42)}`;
  const operationId = spawnOperationId(manifest, 'battle-worker-01');
  recordSpawnIntent(manifest, {
    workerId: 'battle-worker-01', runtime: 'lua@5.3a', operationId,
  });
  atomicWriteManifest(file, manifest);
  const persistedIntent = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persistedIntent.maxOutcomesPerWorker, expected.maxOutcomes);
  assert.equal(persistedIntent.maxConfirmationsPerWorker, expected.maxConfirmations);
  assert.equal(persistedIntent.workers[0].lifecycle, 'spawn-intent');
  assert.equal(persistedIntent.workers[0].operationId, operationId);
  assert.equal(persistedIntent.workers[0].workerProcessId, undefined);
  assert.throws(() => assertNoAmbiguousSpawnIntents(persistedIntent),
    /hbclient spawn has no idempotency key/);

  recordSpawnResult(manifest, {
    workerId: 'battle-worker-01', operationId, workerProcessId,
  });
  atomicWriteManifest(file, manifest);
  const persistedImmediately = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(persistedImmediately.workers[0], {
    workerId: 'battle-worker-01',
    runtime: 'lua@5.3a',
    operationId,
    workerProcessId,
    lifecycle: 'spawned',
    statusKey: 'fleetstatus',
    intentAt: persistedImmediately.workers[0].intentAt,
    spawnedAt: persistedImmediately.workers[0].spawnedAt,
  });

  const resumed = prepareManifest(file, expected, { resume: true });
  assert.doesNotThrow(() => assertNoAmbiguousSpawnIntents(resumed));
  assert.equal(resumed.workers[0].workerProcessId, workerProcessId);
  assert.throws(() => prepareManifest(file, { ...expected, capacity: 9 }, { resume: true }),
    /capacityPerWorker/);
  assert.throws(() => prepareManifest(file, { ...expected, maxOutcomes: 999 }, { resume: true }),
    /maxOutcomesPerWorker/);
  assert.throws(() => prepareManifest(file, {
    ...expected, maxConfirmations: 999,
  }, { resume: true }), /maxConfirmationsPerWorker/);
  assert.throws(() => prepareManifest(file, expected, { resume: true, replace: true }),
    /not both/);

  const replacement = prepareManifest(file, expected, { replace: true });
  assert.equal(replacement.workers.length, 0);
  atomicWriteManifest(file, replacement);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).workers.length, 0);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')), []);
});

test('resume refuses malformed worker identity and duplicate logical ids', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-fleet-resume-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'manifest.json');
  const manifest = prepareManifest(file, expected);
  manifest.workers = [
    { workerId: 'battle-worker-01', runtime: 'lua@5.3a', operationId: 'one', lifecycle: 'spawned',
      workerProcessId: `W${'p'.repeat(42)}` },
    { workerId: 'battle-worker-01', runtime: 'lua@5.3a', operationId: 'two', lifecycle: 'spawned',
      workerProcessId: `X${'p'.repeat(42)}` },
  ];
  atomicWriteManifest(file, manifest);
  assert.throws(() => prepareManifest(file, expected, { resume: true }), /duplicate/);
});

test('resume preserves ambiguous pre-spawn intent and never converts it to a retry', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-fleet-intent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'manifest.json');
  const manifest = prepareManifest(file, expected);
  const operationId = spawnOperationId(manifest, 'battle-worker-01');
  recordSpawnIntent(manifest, {
    workerId: 'battle-worker-01', runtime: 'lua@5.3a', operationId,
  });
  atomicWriteManifest(file, manifest);

  const resumed = prepareManifest(file, expected, { resume: true });
  assert.deepEqual(resumed.workers, manifest.workers);
  assert.throws(() => assertNoAmbiguousSpawnIntents(resumed), /Ambiguous remote spawn/);
  assert.throws(() => recordSpawnIntent(resumed, {
    workerId: 'battle-worker-01', runtime: 'lua@5.3a', operationId,
  }), /already contains/);
  assert.throws(() => recordSpawnResult(resumed, {
    workerId: 'battle-worker-01', operationId: 'wrong',
    workerProcessId: `W${'p'.repeat(42)}`,
  }), /No matching pending/);
});

test('deployment readiness is bound to the exact game and worker lifecycle', () => {
  const workerId = 'battle-worker-01';
  const status = {
    protocol: 'runerealm-battle-fleet/1',
    workerId,
    runtime: 'lua@5.3a',
    gameProcess: expected.gameProcess,
    enabled: true,
    configured: true,
    lifecycle: 'ready',
    managerMode: 'assign-only',
    managerProxiesRounds: false,
    directAction: 'Battle.Attack',
    capacity: expected.capacity,
    retentionLimit: expected.maxRetained,
    pendingLimit: expected.maxPending,
    maxTicketTtl: expected.maxTicketTtl,
    outcomeLimit: expected.maxOutcomes,
    confirmationLimit: expected.maxConfirmations,
    accepting: false,
  };
  const readiness = { workerId, runtime: 'lua@5.3a', ...expected };
  assert.equal(assertWorkerReady(status, readiness), status,
    'accepting is advisory and does not replace serialized Open admission');
  assert.match(workerReadinessError({
    ...status, gameProcess: `X${'x'.repeat(42)}`,
  }, readiness), /^gameProcess=/);
  assert.match(workerReadinessError({ ...status, gameProcess: undefined }, readiness),
    /^gameProcess=/);
  assert.match(workerReadinessError({ ...status, workerId: 'rogue' }, readiness),
    /^workerId=/);
  assert.match(workerReadinessError({ ...status, lifecycle: 'draining' }, readiness),
    /^lifecycle=/);
  assert.match(workerReadinessError({ ...status, configured: false }, readiness),
    /^configured=/);
});
