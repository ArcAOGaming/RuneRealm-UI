/**
 * Offline smoke runner for the Rune marketplace contracts.
 *
 * The authoritative compatibility check is still run-marketplace-test.sh on a
 * HyperBEAM ~lua@5.3a device. This runner uses the repo's checked-in aos wasm
 * to catch syntax, auth, arithmetic and state-machine regressions when that
 * public endpoint is unavailable. It does not perform network requests or
 * mutate a process.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const FORMAT = 'wasm32-unknown-emscripten';
const PROCESS_ID = 'local-marketplace-tests'.padEnd(43, '_');
const OWNER = 'local-marketplace-owner'.padEnd(43, '_');

const suites = [
  ['marketplace', 'marketplace.lua', 'marketplace_test.lua', 'markettest'],
  ['amm', 'amm.lua', 'amm_test.lua', 'ammtest'],
  ['quote', 'quote.lua', 'quote_test.lua', 'quotetest'],
  ['rune', 'rune.lua', 'rune_test.lua', 'runetest'],
];

function read(name) {
  return fs.readFileSync(path.join(HERE, name), 'utf8');
}

function evalMessage(source) {
  return {
    Id: `eval-${Date.now()}`,
    Target: PROCESS_ID,
    Owner: OWNER,
    From: OWNER,
    Tags: [{ name: 'Action', value: 'Eval' }],
    Data: source,
    'Block-Height': '1',
    Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'),
    Cron: false,
  };
}

const environment = {
  Process: {
    Id: PROCESS_ID,
    Owner: OWNER,
    Tags: [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'Type', value: 'Process' },
    ],
  },
};

if (!fs.existsSync(WASM)) {
  throw new Error(`Local aos wasm is missing: ${WASM}`);
}

let failed = false;
for (const [label, contract, test, entry] of suites) {
  const source = [
    '-- The checked-in aos module exposes json globally; HyperBEAM exposes it as .json.',
    'package.loaded[".json"] = require("json")',
    '-- aos predefines Owner; native HyperBEAM resolves it from the process commitment.',
    'Owner = nil',
    'local jsonx = (function()',
    read('jsonenc.lua'),
    'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    read(contract),
    read(test),
    `return ${entry}({}, {})`,
  ].join('\n');

  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: FORMAT,
    computeLimit: 9_000_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
  });
  const result = await handle(null, evalMessage(source), environment);
  if (result.Error) throw new Error(`${label}: ${result.Error}`);

  const data = result.Output?.data;
  const output = typeof data === 'string' ? data : data?.output;
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  console.log(`== ${label} ==`);
  console.log(text);
  if (/^(FAIL|ERROR):?/m.test(text) || /\b[1-9]\d* failed\b/.test(text)) failed = true;
}

if (failed) process.exitCode = 1;
