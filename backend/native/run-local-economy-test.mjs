/** Offline runner for the order book engine suite (economy_test.lua). */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const PROCESS_ID = 'local-economy-tests'.padEnd(43, '_');
const OWNER = 'local-economy-owner'.padEnd(43, '_');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

// The engine needs only the constants and the monster index `C` closes over —
// not the game, not the battle module. That is the point of the file: the book
// is separable, and this runner is the first thing that proves it.
const source = [
  'package.loaded[".json"] = require("json")',
  'C = (function()', read('constants.lua'), 'end)()',
  read('monster-index.generated.lua'),
  'local OrderBook = (function()', read('orderbook.lua'), 'end)()',
  'EconomyEngine = (function()', read('economy.lua'), 'end)()',
  'local economytest = (function()', read('economy_test.lua'), 'end)()',
  'return economytest()',
].join('\n');

const handle = await AoLoader(fs.readFileSync(WASM), {
  format: 'wasm32-unknown-emscripten',
  computeLimit: 18_000_000_000_000,
  memoryLimit: 512 * 1024 * 1024,
});
const result = await handle(null, {
  Id: 'eval-economy-tests', Target: PROCESS_ID, Owner: OWNER, From: OWNER,
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
// aos hands back either the printed string or a {output, json, prompt} record
// depending on how the chunk returned; the suite's verdict is in both.
const raw = result.Output?.data ?? '';
const output = typeof raw === 'string' ? raw : (raw.output ?? JSON.stringify(raw));
console.log(output);
if (!/^\d+ passed, 0 failed$/m.test(String(output))) {
  console.error('economy suite did not report zero failures');
  process.exit(1);
}
