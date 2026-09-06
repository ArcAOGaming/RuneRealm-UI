/** Offline runner for the two-venue suite (venue_test.lua). */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const PROCESS_ID = 'local-venue-tests'.padEnd(43, '_');
const OWNER = 'local-venue-owner'.padEnd(43, '_');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

// Exactly what deploy-venue.mjs deploys, plus the suite. The venue is a
// process, so `venue.lua` is NOT wrapped in a function -- it defines globals
// and `compute`, the same way `game.lua` and `rune.lua` do.
const source = [
  'package.loaded[".json"] = require("json")',
  'local C = (function()', read('constants.lua'), 'end)()',
  read('monster-index.generated.lua'),
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'local OrderBook = (function()', read('orderbook.lua'), 'end)()',
  read('venue.lua'),
  'local venuetest = (function()', read('venue_test.lua'), 'end)()',
  'return venuetest()',
].join('\n');

const handle = await AoLoader(fs.readFileSync(WASM), {
  format: 'wasm32-unknown-emscripten',
  computeLimit: 18_000_000_000_000,
  memoryLimit: 512 * 1024 * 1024,
});
const result = await handle(null, {
  Id: 'eval-venue-tests', Target: PROCESS_ID, Owner: OWNER, From: OWNER,
  Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
  'Block-Height': '1', Timestamp: '1700000000000',
  Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
}, {
  Process: { Id: PROCESS_ID, Owner: OWNER, Tags: [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
  ] },
});
if (result.Error) {
  const line = Number(/\[string "aos"\]:(\d+)/.exec(result.Error)?.[1]);
  if (Number.isFinite(line)) {
    const lines = source.split(/\r?\n/);
    const start = Math.max(0, line - 4);
    console.error(lines.slice(start, line + 3)
      .map((text, index) => `${start + index + 1}: ${text}`).join('\n'));
  }
  throw new Error(result.Error);
}
const raw = result.Output?.data ?? '';
const output = typeof raw === 'string' ? raw : (raw.output ?? JSON.stringify(raw));
console.log(output);
if (!/^\d+ passed, 0 failed$/m.test(String(output))) {
  console.error('venue suite did not report zero failures');
  process.exit(1);
}
