import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLE_FLEET_PROTOCOL, battleFleetConfigMatches, battleFleetLua, validateBattleFleetManifest,
} from './battle-fleet-config.mjs';

const id = (letter) => letter.repeat(43);
const valid = () => ({
  enabled: true,
  protocol: BATTLE_FLEET_PROTOCOL,
  node: 'https://schedule.forward.computer',
  managerMode: 'assign-only',
  workers: [
    { workerId: 'battle-worker-01', workerProcessId: id('A'), runtime: 'lua@5.3a', lifecycle: 'ready' },
    { workerId: 'battle-worker-02', workerProcessId: id('B'), runtime: 'rust-wasm@1',
      imageId: id('I'), abi: 'hyperbeam-json-iface-cstr/1',
      clockMode: 'trusted-game-clock-v1', lifecycle: 'ready' },
  ],
});

test('seal verification compares ordered routes and every authority limit', () => {
  const config = validateBattleFleetManifest(valid());
  const observed = JSON.parse(JSON.stringify(config));
  assert.equal(battleFleetConfigMatches(observed, config), true);
  observed.ticketTtl += 1;
  assert.equal(battleFleetConfigMatches(observed, config), false);
  observed.ticketTtl = config.ticketTtl;
  observed.workers.reverse();
  assert.equal(battleFleetConfigMatches(observed, config), false);
});

test('valid manifest compiles an immutable protocol/worker allowlist', () => {
  const config = validateBattleFleetManifest(valid(), {
    expectedNode: 'https://schedule.forward.computer/',
  });
  assert.equal(config.workers.length, 2);
  assert.deepEqual(config.workers.map((worker) => worker.runtime), ['lua@5.3a', 'rust-wasm@1']);
  assert(Object.isFrozen(config));
  assert(Object.isFrozen(config.workers));
  const lua = battleFleetLua(config);
  assert.match(lua, /BattleFleetConfig/);
  assert.match(lua, new RegExp(id('A')));
  assert.match(lua, /rust-wasm@1/);
  assert.match(lua, /\["lifecycle"\]="ready"/);
});

test('manifest trust fails closed on non-ready and duplicate identities', () => {
  const notReady = valid();
  notReady.workers[0].lifecycle = 'spawned';
  assert.throws(() => validateBattleFleetManifest(notReady), /not verified ready/);
  const duplicate = valid();
  duplicate.workers[1].workerProcessId = duplicate.workers[0].workerProcessId;
  assert.throws(() => validateBattleFleetManifest(duplicate), /duplicate workerProcessId/);
});

test('manifest protocol, manager mode, enabled flag, and node are strict', () => {
  for (const [field, value] of [
    ['enabled', false], ['protocol', 'v0'], ['managerMode', 'proxy'], ['node', 'file:///tmp/node'],
  ]) {
    const manifest = valid();
    manifest[field] = value;
    assert.throws(() => validateBattleFleetManifest(manifest));
  }
  assert.throws(() => validateBattleFleetManifest(valid(), { expectedNode: 'https://other.invalid' }),
    /does not match/);
});
