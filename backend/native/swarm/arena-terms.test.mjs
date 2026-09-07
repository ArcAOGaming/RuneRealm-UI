import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readArenaTerms } from './arena-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('arena terms come from the contract source', () => {
  assert.deepEqual(readArenaTerms(ROOT), { stake: 10, minEntry: 10 });
});

function fixture(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-arena-terms-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'backend', 'native');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'constants.lua'), source);
  return root;
}

test('a missing arena table fails the build instead of inventing prices', (t) => {
  assert.throws(() => readArenaTerms(fixture(t, 'return {}\n')), /Cannot find C\.ARENA/);
});

test('invalid arena prices fail the build', (t) => {
  const missing = fixture(t, 'C.ARENA = {\n  stake = 10,\n}\n');
  assert.throws(() => readArenaTerms(missing), /minEntry must be a non-negative integer/);

  const unfunded = fixture(t, 'C.ARENA = {\n  stake = 10,\n  minEntry = 5,\n}\n');
  assert.throws(() => readArenaTerms(unfunded), /must fund at least one battle/);
});
