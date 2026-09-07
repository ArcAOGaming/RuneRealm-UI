/**
 * The catalog pin, tested against the REAL assembled module.
 *
 * Three things have to hold, and each of them has a way of failing silently:
 *
 *  1. With no ref injected, the module publishes `catalog` inline exactly as it
 *     always did. Every existing deployment and every test suite depends on
 *     that, and a regression here would only show up as a client that renders
 *     no combat numbers.
 *  2. With a ref injected, it publishes `catalogref` and NOT `catalog`. If both
 *     appeared the change would buy nothing — the ~6.9 KB would still be in the
 *     published map, which a slot pays for five times over whatever the message
 *     did — and nothing would look wrong.
 *  3. The id is interpolated into Lua source, so a value that is not an Arweave
 *     id must be refused rather than concatenated.
 *
 * `buildCatalogBytes()` is checked against the module's own output for the same
 * reason: it is what gets uploaded, and an upload is permanent. If it ever
 * stopped matching what `game.lua` would have published, the client would join
 * move definitions against a catalog the engine does not use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';
import { gameModuleSources } from './game-bundle.mjs';
import { buildCatalogBytes } from './catalog-ref.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const ID = 'XcRC7hi-hNI5-lMYTKVpyQ1Ywf4eeIFNik__fNyjMy0';
const pad = (s) => s.padEnd(43, '_');

/** Run one bare message through the assembled module and return its state. */
async function publishedState(catalogRef) {
  const source = [
    'package.loaded[".json"] = require("json")',
    'Owner = nil',
    gameModuleSources({ catalogRef }),
    'local st = compute({}, { body = { Tags = {} } }, {})',
    'return (st.catalogref or "") .. "\\1" .. (st.catalog or "")',
  ].join('\n');
  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 18_000_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
  });
  const result = await handle(null, {
    Id: 'eval', Target: pad('p'), Owner: pad('o'), From: pad('o'),
    Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
    'Block-Height': '1', Timestamp: '1700000000000', Module: pad('m'), Cron: false,
  }, {
    Process: { Id: pad('p'), Owner: pad('o'), Tags: [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'Type', value: 'Process' },
    ] },
  });
  assert.equal(result.Error, undefined, `module failed: ${result.Error}`);
  const data = result.Output?.data;
  const text = typeof data === 'string' ? data : data?.output;
  const [catalogref, catalog] = String(text).split('');
  return { catalogref, catalog };
}

test('with no ref, the catalog is published inline as it always was', async () => {
  const { catalogref, catalog } = await publishedState(null);
  assert.equal(catalogref, '', 'catalogref must be absent when nothing was pinned');
  assert.ok(catalog.length > 5_000, `catalog looks too small: ${catalog.length} B`);
  const parsed = JSON.parse(catalog);
  for (const key of ['movePools', 'tuning', 'items', 'elements', 'effectiveness']) {
    assert.ok(parsed[key] !== undefined, `inline catalog is missing ${key}`);
  }
});

test('with a ref, the id is published and the catalog is NOT', async () => {
  const { catalogref, catalog } = await publishedState(ID);
  assert.equal(catalogref, ID);
  assert.equal(catalog, '', 'publishing both keys would save nothing');
  // The whole point is the byte count: 43 in place of ~6.9 KB, on every slot.
  assert.equal(catalogref.length, 43);
});

test('buildCatalogBytes matches what the module would have published', async () => {
  const { catalog } = await publishedState(null);
  const built = await buildCatalogBytes();
  assert.equal(
    built.toString('utf8'), catalog,
    'the bytes uploaded to Arweave must be the bytes game.lua would publish',
  );
});

test('a ref that is not an Arweave id is refused, not interpolated', () => {
  for (const bad of ['not-an-id', '"; os.exit() --', 'x'.repeat(42), 'x'.repeat(44), '']) {
    assert.throws(
      () => gameModuleSources({ catalogRef: bad }),
      /not an Arweave id/,
      `should have refused ${JSON.stringify(bad)}`,
    );
  }
});
