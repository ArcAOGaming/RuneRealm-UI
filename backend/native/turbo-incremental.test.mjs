/**
 * Tests for the incremental uploader.
 *
 * Every case here is a bug that was actually shipped and found by review, not a
 * hypothetical. Run with: node --test backend/native/turbo-incremental.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  composeIndex,
  createChainIndex,
  createFileIndex,
  createMemoryIndex,
  entryKey,
  planFolderUpload,
  uploadFolderIncremental,
} from './turbo-incremental.mjs';

const tempFolder = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-inc-'));
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
};

/** A turbo client that records what it was asked to upload. */
const fakeTurbo = () => {
  const uploads = [];
  return {
    uploads,
    uploadFile: async ({ file, dataItemOpts }) => {
      const tags = Object.fromEntries((dataItemOpts?.tags ?? []).map((t) => [t.name, t.value]));
      uploads.push({ file, tags });
      return { id: String(uploads.length - 1).padStart(43, 'a'), winc: '0' };
    },
  };
};

test('byte-identical files with different extensions get their own item', async () => {
  // The shipped bug: keyed on sha256 alone, an empty a.css and an empty b.js
  // collapsed into one text/css item and /b.js was served unexecutable.
  const dir = tempFolder({ 'index.html': '<!doctype html>', 'a.css': '', 'b.js': '' });
  const turbo = fakeTurbo();

  const result = await uploadFolderIncremental({
    turbo, folderPath: dir, index: createMemoryIndex(),
  });

  assert.equal(result.fileResponses.length, 3, 'three files, three uploads');
  assert.notEqual(
    result.manifest.paths['a.css'].id,
    result.manifest.paths['b.js'].id,
    'the two must not share an id',
  );
  // The manifest is uploaded from a buffer and carries no `file`, so skip it.
  const byName = Object.fromEntries(
    turbo.uploads.filter((u) => u.file).map((u) => [path.basename(u.file), u.tags]),
  );
  assert.equal(byName['a.css']['Content-Type'], 'text/css');
  assert.equal(byName['b.js']['Content-Type'], 'application/javascript');
});

test('an unchanged rerun uploads nothing, and one edit uploads exactly one', async () => {
  const dir = tempFolder({ 'index.html': '<h1>hi</h1>', 'assets/app.js': 'let a = 1;' });
  const index = createMemoryIndex();

  const first = await uploadFolderIncremental({ turbo: fakeTurbo(), folderPath: dir, index });
  assert.equal(first.plan.uploadedFiles, 2);

  const second = await uploadFolderIncremental({ turbo: fakeTurbo(), folderPath: dir, index });
  assert.equal(second.plan.uploadedFiles, 0, 'nothing changed, nothing paid for');
  assert.equal(second.plan.reusedFiles, 2);

  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'let a = 2;');
  const third = await uploadFolderIncremental({ turbo: fakeTurbo(), folderPath: dir, index });
  assert.equal(third.plan.uploadedFiles, 1, 'one edit, one upload');
  assert.equal(third.plan.reusedFiles, 1);
});

test('an index layer that throws is a miss, not a failed deploy', async () => {
  // An index is a cache. A gateway having a bad minute must cost a re-upload,
  // never the whole deploy.
  const dir = tempFolder({ 'index.html': '<h1>hi</h1>' });
  const warnings = [];
  const exploding = {
    name: 'exploding', writable: false,
    get() { throw new Error('gateway 503'); },
    set() {},
    resolve() { throw new Error('gateway 503'); },
    entries: () => ({}),
  };
  const index = composeIndex([exploding, createMemoryIndex()],
    { onWarning: (m) => warnings.push(m) });

  const result = await uploadFolderIncremental({ turbo: fakeTurbo(), folderPath: dir, index });
  assert.equal(result.fileResponses.length, 1, 'the deploy still completes');
  assert.ok(warnings.length > 0, 'and the failure is reported, not swallowed silently');
});

test('the file index survives a torn write', async () => {
  // The shipped bug: a non-atomic writeFileSync after every upload, where a
  // truncated file made JSON.parse throw and the recovery path dropped the
  // whole index. The temp-file rename makes a partial file unobservable.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-idx-'));
  const file = path.join(dir, 'index.json');
  const index = createFileIndex(file);
  for (let i = 0; i < 50; i += 1) {
    index.set(entryKey(String(i).padStart(64, '0'), 'text/css'), String(i).padStart(43, 'b'));
  }
  assert.equal(Object.keys(createFileIndex(file).entries()).length, 50);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'no temp file is left behind');
});

test('the chain index ignores an item belonging to someone else', async () => {
  // The gateway applies the owner filter itself, and the gateway URL is user
  // configurable, so the answer is verified rather than believed.
  const owner = 'o'.repeat(43);
  const hash = 'a'.repeat(64);
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      data: {
        transactions: {
          pageInfo: { hasNextPage: false },
          edges: [{
            cursor: 'c1',
            node: {
              id: 'z'.repeat(43),
              owner: { address: 'x'.repeat(43) },
              tags: [{ name: 'File-SHA256', value: hash },
                { name: 'Content-Type', value: 'text/css' }],
            },
          }],
        },
      },
    }),
  });

  const index = createChainIndex({ owner, fetchImpl });
  const found = await index.resolve([entryKey(hash, 'text/css')]);
  assert.deepEqual(found, {}, 'a foreign id must never reach the manifest');
});

test('the chain index tolerates a malformed gateway response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ data: { transactions: { pageInfo: {}, edges: null } } }),
  });
  const index = createChainIndex({ owner: 'o'.repeat(43), fetchImpl });
  const found = await index.resolve([entryKey('a'.repeat(64), 'text/css')]);
  assert.deepEqual(found, {}, 'a degraded node is a miss, not a TypeError');
});

test('a plan reuses across content types independently', async () => {
  const dir = tempFolder({ 'index.html': 'x', 'a.css': '', 'b.js': '' });
  const index = createMemoryIndex();
  await uploadFolderIncremental({ turbo: fakeTurbo(), folderPath: dir, index });

  const plan = await planFolderUpload({ folderPath: dir, index });
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.reusedFiles, 3);
});
