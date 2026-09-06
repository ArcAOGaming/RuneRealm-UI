import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  livedInCoverage, loadCoverageLedger, missingCoveragePreferences, updateCoverageLedger,
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
