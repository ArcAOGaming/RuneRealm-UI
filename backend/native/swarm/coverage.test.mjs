import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assignCoveragePreferences, livedInCoverage, loadCoverageLedger,
  missingCoveragePreferences, updateCoverageLedger,
} from './coverage.mjs';

test('the eventual ledger accumulates successful actions across runs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'eventual-coverage.json');
  assert.deepEqual(loadCoverageLedger(file), { version: 1, runs: 0, actions: {} });

  updateCoverageLedger(file, {
    runId: 'run-1', actions: ['daily.claim', 'monster.feed'], at: '2026-01-01T00:00:00Z',
  });
  const ledger = updateCoverageLedger(file, {
    runId: 'run-2', actions: ['monster.feed', 'arena.enter'], at: '2026-01-02T00:00:00Z',
  });
  assert.equal(ledger.runs, 2);
  assert.equal(ledger.actions['monster.feed'].hits, 2);
  assert.equal(ledger.actions['monster.feed'].firstRunId, 'run-1');
  assert.equal(ledger.actions['monster.feed'].lastRunId, 'run-2');
  assert.equal(livedInCoverage(Object.keys(ledger.actions)).covered, 3);
});

test('never-seen paths are directed ahead of paths covered in earlier runs', () => {
  const preferences = missingCoveragePreferences([], {
    historicalActions: ['daily.claim', 'lootbox.open', 'monster.feed'],
  });
  assert.notEqual(preferences[0], 'daily');
  assert.notEqual(preferences[0], 'loot');
  assert.notEqual(preferences[0], 'feed');
  assert.ok(preferences.indexOf('daily') > preferences.indexOf('quest'));
});

test('a corrupt ledger fails loudly instead of erasing campaign history', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'eventual-coverage.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => loadCoverageLedger(file), /Cannot read eventual-coverage ledger/);
});

test('coverage assignment handles complete runs and roles with no eligible adapter', () => {
  const all = [
    'bootstrap', 'daily.claim', 'lootbox.open', 'monster.feed', 'activity.start.play',
    'activity.start.quest', 'activity.claim.quest', 'monster.level-up', 'character.save',
    'arena.enter', 'battle.start.bot', 'battle.attack.bot', 'battle.settle.bot',
    'pvp.challenge', 'pvp.challenge.refund', 'pvp.accept', 'battle.attack.pvp',
    'battle.settle.pvp',
    'hunt.begin', 'hunt.search', 'hunt.attack', 'hunt.capture', 'hunt.end', 'monster.store',
    'monster.retrieve', 'monster.set-active', 'monster.transfer', 'market.list', 'market.buy',
    'market.cancel', 'goods.order.bid', 'goods.order.amend', 'goods.order.buy',
    'goods.order.cancel', 'goods.order.cancel-all', 'goods.order.maintain', 'shop.buy',
    'shop.sell', 'arbitrage.buy.house', 'venue.internal.deposit',
    'venue.internal.order.ask', 'venue.internal.order.amend', 'venue.internal.order.fill',
    'venue.internal.order.cancel', 'venue.internal.withdraw', 'venue.external.faucet',
    'venue.external.deposit.rune', 'venue.external.order.ask',
    'venue.external.order.amend', 'venue.external.order.fill',
    'venue.external.order.cancel', 'venue.external.withdraw', 'rune.withdraw',
    'rune.deposit', 'probe.refused',
  ];
  assert.equal(assignCoveragePreferences([], all).size, 0);
  const assigned = assignCoveragePreferences([
    { profile: { wallet: 'none', weights: {} } },
    { profile: { wallet: 'daily', weights: { daily: 1 } } },
  ], []);
  assert.equal(assigned.has('none'), false);
  assert.equal(assigned.get('daily'), 'daily');
});

test('a syntactically valid but unsupported ledger shape is rejected', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'eventual-coverage.json');
  fs.writeFileSync(file, JSON.stringify({ version: 2, actions: [] }));
  assert.throws(() => loadCoverageLedger(file), /unsupported coverage ledger shape/);
});
