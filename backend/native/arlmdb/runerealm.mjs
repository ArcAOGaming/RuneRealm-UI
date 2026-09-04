/** What the published index can do for Rune Realm, measured on our own data.
 *
 *   node backend/native/arlmdb/runerealm.mjs [--sample N]
 *
 * Three questions, in order of how much they decide:
 *
 * 1. Does the traversal work on data items THIS project owns, not just on the
 *    two vectors HyperBEAM ships? The legacynet processes answer that.
 *
 * 2. Where does the published snapshot end? Our 2026-08 uploads miss and our
 *    2024-25 ones hit, so the corpus brackets the cutoff. Until a delta index
 *    covers the gap, anything recent still needs a gateway — which is the one
 *    fact that decides whether this is usable for live assets today.
 *
 * 3. What does a cold read cost? The `player-<address>` problem is that every
 *    wallet ever seen is carried in the process's published map, and every
 *    slot pays for the whole map five times over. A cold tier is only worth
 *    building if fetching a lapsed player back is cheap and bounded. The
 *    per-lookup chunk count is that number.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openContainer } from './container.mjs';
import { createChunkSource, readLocation } from './weave.mjs';
import { OFFSET_INDEX, RUNE_REALM, GOLDEN } from './vectors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_INDEX = path.resolve(HERE, '../../../.deploy/site-index.json');

/** A sample of the data items the site deploy actually uploaded. */
function siteItems(limit) {
  if (!fs.existsSync(SITE_INDEX)) return [];
  const index = JSON.parse(fs.readFileSync(SITE_INDEX, 'utf8'));
  const ids = [...new Set(Object.values(index.files || {}))];
  return ids.slice(0, limit).map((id) => ({ id, label: 'site asset (2026-08-30)', indexed: false }));
}

const sampleArg = process.argv.indexOf('--sample');
const sampleSize = sampleArg > -1 ? Number(process.argv[sampleArg + 1]) : 5;

const chunks = createChunkSource();
const container = await openContainer(OFFSET_INDEX, { chunks });
const weaveEnd = (await readLocation(OFFSET_INDEX)).start + container.size;

const corpus = [...RUNE_REALM, ...siteItems(sampleSize)];
const rows = [];
for (const item of corpus) {
  const before = { ...chunks.stats };
  const started = Date.now();
  const row = await container.read(`${container.tags.prefix}${item.id}`);
  rows.push({
    ...item,
    row,
    ms: Date.now() - started,
    fetched: chunks.stats.chunks - before.chunks,
    wire: chunks.stats.wireBytes - before.wireBytes,
  });
}

console.log(`container ${container.root} — ${(Number(container.size) / 1e9).toFixed(1)} GB`
  + `, ${container.rows} rows, never downloaded\n`);

let unexpected = 0;
for (const r of rows) {
  const answer = r.row ? `start=${r.row.start} length=${r.row.length}` : 'NOT INDEXED';
  const agrees = Boolean(r.row) === r.indexed;
  if (!agrees) unexpected += 1;
  console.log(`${agrees ? ' ' : '!'} ${r.label.padEnd(30)} ${r.id}`);
  console.log(`    ${answer}  (${r.ms} ms, ${r.fetched} chunks, ${(r.wire / 1024).toFixed(0)} KB)`);
}

const hits = rows.filter((r) => r.row);
const lookups = rows.length;
const perLookup = chunks.stats.chunks / lookups;

// Coverage is bounded from below by the furthest row anyone has resolved, and
// our own corpus is all old. The commit's vectors reach much further into the
// weave, so they set the floor — quoting our sample alone would understate the
// snapshot by an order of magnitude.
const highest = [...hits.map((r) => r.row.start), ...GOLDEN.map((g) => g.start)]
  .reduce((max, start) => (start > max ? start : max), 0n);

console.log('');
console.log(`indexed: ${hits.length}/${rows.length} of ours`);
console.log(`coverage reaches at least: ${highest}  (furthest row resolved, ours or HyperBEAM's)`);
console.log(`weave end (index tx tail):  ${weaveEnd}`);
console.log(`uncovered tail: at most ~${(Number(weaveEnd - highest) / 1e12).toFixed(2)} TB`
  + ' — anything uploaded inside it still needs a gateway');
console.log('');
console.log(`cost: ${perLookup.toFixed(1)} chunks per lookup`
  + ` (${(perLookup * 256).toFixed(0)} KB useful, ${(chunks.stats.wireBytes / lookups / 1024).toFixed(0)} KB wire)`);
console.log(`      ${chunks.stats.hits} of ${chunks.stats.hits + chunks.stats.chunks} page reads`
  + ' were answered by chunks already held — the tree above the leaves is shared');
console.log('');
console.log('read as: a cold record costs a bounded, constant number of chunk reads');
console.log('regardless of how many wallets the database holds. That is the property');
console.log('`player-<address>` in the published map does not have.');

if (unexpected) {
  console.error(`\n${unexpected} item(s) disagreed with vectors.mjs — the snapshot may have moved.`);
  process.exit(1);
}
