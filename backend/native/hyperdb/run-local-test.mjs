/** Offline syntax and state-machine runner for TEST-HyperDB. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

const source = [
  read('store.lua'),
  read('store_test.lua'),
  'return hyperdbtest()',
].join('\n');

const handle = await AoLoader(fs.readFileSync(WASM), {
  format: 'wasm32-unknown-emscripten',
  computeLimit: 9_000_000_000_000,
  memoryLimit: 512 * 1024 * 1024,
});

const id = 'TEST-HyperDB-local'.padEnd(43, '_');
const owner = 'TEST-HyperDB-owner'.padEnd(43, '_');
const result = await handle(null, {
  Id: 'TEST-HyperDB-eval'.padEnd(43, '_'),
  Target: id,
  Owner: owner,
  From: owner,
  Tags: [{ name: 'Action', value: 'Eval' }],
  Data: source,
  'Block-Height': '1',
  Timestamp: '1700000000000',
  Module: 'TEST-HyperDB-module'.padEnd(43, '_'),
  Cron: false,
}, {
  Process: { Id: id, Owner: owner, Tags: [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
  ] },
});

if (result.Error) throw new Error(result.Error);
const data = result.Output?.data;
const output = typeof data === 'string' ? data : data?.output;
const text = typeof output === 'string' ? output : JSON.stringify(output);
console.log(text);
if (!text.includes('assertions passed')) process.exitCode = 1;
