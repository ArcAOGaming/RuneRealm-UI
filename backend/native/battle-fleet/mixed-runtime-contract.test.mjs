import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  battleFleetConfigMatches,
  validateBattleFleetManifest,
} from '../battle-fleet-config.mjs';
import {
  atomicWriteManifest,
  prepareManifest,
  recordSpawnIntent,
  recordSpawnResult,
  spawnOperationId,
} from './manifest.mjs';
import { workerReadinessError } from './readiness.mjs';
import { wasmProcessDefinition } from '../hbclient.mjs';
import {
  LUA_BATTLE_RUNTIME,
  RUST_BATTLE_RUNTIME,
  battleFleetComposition,
  battleWorkerSpecs,
} from './runtime.mjs';

const GAME_PROCESS = 'G'.repeat(43);
const RUST_IMAGE_ID = 'I'.repeat(43);

const plan = () => battleWorkerSpecs({
  BATTLE_FLEET_LUA: '2',
  BATTLE_FLEET_RUST: '2',
  BATTLE_FLEET_SIZE: '4',
  BATTLE_RUST_IMAGE_ID: RUST_IMAGE_ID,
});

const manifestConfig = (specs = plan()) => ({
  node: 'https://node.example',
  gameProcess: GAME_PROCESS,
  size: specs.length,
  composition: battleFleetComposition(specs),
  specs,
  capacity: 32,
  maxRetained: 100,
  maxPending: 64,
  maxTicketTtl: 3600000,
  maxOutcomes: 10000,
  maxConfirmations: 10000,
});

const sealedConfig = () => ({
  enabled: true,
  protocol: 'runerealm-battle-fleet/1',
  managerMode: 'assign-only',
  node: 'https://node.example',
  ticketTtl: 600000,
  replayWindow: 3600000,
  maxEntries: 2000,
  auditLimit: 1000,
  workers: plan().map((worker, index) => ({
    workerId: worker.workerId,
    workerProcessId: String.fromCharCode(65 + index).repeat(43),
    runtime: worker.runtime,
    ...(worker.runtime === RUST_BATTLE_RUNTIME ? {
      imageId: worker.imageId,
      abi: 'hyperbeam-json-iface-cstr/1',
      clockMode: 'trusted-game-clock-v1',
    } : {}),
    lifecycle: 'ready',
  })),
});

const expectedReadiness = (worker) => ({
  workerId: worker.workerId,
  runtime: worker.runtime,
  imageId: worker.imageId,
  gameProcess: GAME_PROCESS,
  capacity: 32,
  maxRetained: 100,
  maxPending: 64,
  maxTicketTtl: 3600000,
  maxOutcomes: 10000,
  maxConfirmations: 10000,
});

const readyStatus = (worker) => ({
  protocol: 'runerealm-battle-fleet/1',
  workerId: worker.workerId,
  runtime: worker.runtime,
  ...(worker.runtime === RUST_BATTLE_RUNTIME ? {
    imageId: worker.imageId,
    abi: 'hyperbeam-json-iface-cstr/1',
    clockMode: 'trusted-game-clock-v1',
  } : {}),
  gameProcess: GAME_PROCESS,
  enabled: true,
  configured: true,
  lifecycle: 'ready',
  managerMode: 'assign-only',
  managerProxiesRounds: false,
  directAction: 'Battle.Attack',
  capacity: 32,
  retentionLimit: 100,
  pendingLimit: 64,
  maxTicketTtl: 3600000,
  outcomeLimit: 10000,
  confirmationLimit: 10000,
});

test('default mixed plan is deterministic: two Lua then two Rust workers', () => {
  const specs = plan();
  assert.deepEqual(specs.map(({ workerId, runtime }) => ({ workerId, runtime })), [
    { workerId: 'battle-worker-01', runtime: LUA_BATTLE_RUNTIME },
    { workerId: 'battle-worker-02', runtime: LUA_BATTLE_RUNTIME },
    { workerId: 'battle-worker-03', runtime: RUST_BATTLE_RUNTIME },
    { workerId: 'battle-worker-04', runtime: RUST_BATTLE_RUNTIME },
  ]);
  assert.deepEqual(battleFleetComposition(specs), { lua: 2, rust: 2 });
  assert.equal(specs[2].imageId, RUST_IMAGE_ID);
  assert.equal(specs[3].imageId, RUST_IMAGE_ID);
});

test('the default plan is three Lua workers and no Rust', () => {
  // The mixed 2+2 default put half of every player's battles on a runtime
  // measured at 20 ms a slot against Lua's 5 ms. Rust is opt-in now, so a
  // deploy that names nothing must not need an image id and must not spawn one.
  const specs = battleWorkerSpecs({});
  assert.deepEqual(battleFleetComposition(specs), { lua: 3, rust: 0 });
  assert.deepEqual(specs.map(({ runtime }) => runtime),
    [LUA_BATTLE_RUNTIME, LUA_BATTLE_RUNTIME, LUA_BATTLE_RUNTIME]);
  assert.ok(specs.every((spec) => spec.imageId === undefined),
    'a Lua-only plan must not carry a WASM image id');
});

test('mixed plan rejects inconsistent totals and Rust without a cached image id', () => {
  assert.throws(() => battleWorkerSpecs({
    BATTLE_FLEET_LUA: '2',
    BATTLE_FLEET_RUST: '2',
    BATTLE_FLEET_SIZE: '5',
    BATTLE_RUST_IMAGE_ID: RUST_IMAGE_ID,
  }), /must equal/);
  assert.throws(() => battleWorkerSpecs({
    BATTLE_FLEET_LUA: '2',
    BATTLE_FLEET_RUST: '2',
  }), /BATTLE_RUST_IMAGE_ID/);
});

test('validated game config preserves runtime and rejects runtime drift', () => {
  const expected = validateBattleFleetManifest(sealedConfig());
  assert.deepEqual(expected.workers.map(({ runtime }) => runtime), [
    LUA_BATTLE_RUNTIME,
    LUA_BATTLE_RUNTIME,
    RUST_BATTLE_RUNTIME,
    RUST_BATTLE_RUNTIME,
  ]);

  const drifted = structuredClone(expected);
  drifted.workers[2].runtime = LUA_BATTLE_RUNTIME;
  assert.equal(battleFleetConfigMatches(drifted, expected), false);

  const unsupported = sealedConfig();
  unsupported.workers[3].runtime = 'javascript@unknown';
  assert.throws(() => validateBattleFleetManifest(unsupported), /invalid runtime/);
});

test('manifest persists runtime/image identity and resume binds the exact plan', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-mixed-fleet-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'manifest.json');
  const expected = manifestConfig();
  const manifest = prepareManifest(file, expected);
  const rustWorker = expected.specs[2];
  const operationId = spawnOperationId(manifest, rustWorker.workerId, rustWorker.runtime);

  assert.match(operationId, /rust-wasm@1$/);
  recordSpawnIntent(manifest, { ...rustWorker, operationId });
  recordSpawnResult(manifest, {
    workerId: rustWorker.workerId,
    operationId,
    workerProcessId: 'W'.repeat(43),
  });
  atomicWriteManifest(file, manifest);

  const resumed = prepareManifest(file, expected, { resume: true });
  assert.equal(resumed.workers[0].runtime, RUST_BATTLE_RUNTIME);
  assert.equal(resumed.workers[0].imageId, RUST_IMAGE_ID);

  const wrongImageSpecs = expected.specs.map((worker) => ({ ...worker }));
  wrongImageSpecs[2].imageId = 'J'.repeat(43);
  assert.throws(() => prepareManifest(file, {
    ...expected,
    specs: wrongImageSpecs,
  }, { resume: true }), /runtime\/image plan/);
});

test('readiness requires each process to publish its planned runtime', () => {
  const rustWorker = plan()[2];
  const expected = expectedReadiness(rustWorker);
  assert.equal(workerReadinessError(readyStatus(rustWorker), expected), null);

  const wrongRuntime = readyStatus(rustWorker);
  wrongRuntime.runtime = LUA_BATTLE_RUNTIME;
  assert.match(workerReadinessError(wrongRuntime, expected), /^runtime=/);

  const wrongImage = readyStatus(rustWorker);
  wrongImage.imageId = 'J'.repeat(43);
  assert.match(workerReadinessError(wrongImage, expected), /^imageId=/);
});

test('Rust process definition pins the JSON-Iface/WASM/Patch stack', () => {
  const processDefinition = wasmProcessDefinition({
    image: RUST_IMAGE_ID,
    scheduler: 'S'.repeat(43),
    randomSeed: 'test-seed',
    'battle-runtime': RUST_BATTLE_RUNTIME,
  });
  assert.deepEqual(processDefinition['device-stack'], [
    'json-iface@1.0', 'wasm-64@1.0', 'multipass@1.0', 'patch@1.0',
  ]);
  assert.deepEqual(processDefinition['stack-keys'], [
    'init', 'compute', 'snapshot', 'normalize',
  ]);
  assert.equal(processDefinition['execution-device'], 'stack@1.0');
  assert.equal(processDefinition['patch-from'], '/results/outbox');
  assert.equal(processDefinition['patch-to'], '/');
  assert.equal(processDefinition.image, RUST_IMAGE_ID);
  assert.equal(processDefinition.authority, 'S'.repeat(43));
});
