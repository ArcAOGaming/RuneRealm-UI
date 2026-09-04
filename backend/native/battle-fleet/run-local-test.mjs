/** Run the battle-fleet Lua suite twice in fresh VMs and compare transcripts. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.dirname(HERE);
const ROOT = path.resolve(NATIVE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const readNative = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');
const readHere = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

const GAME = `G${'a'.repeat(42)}`;
function config({
  capacity = 3, maxRetained = 4, maxPending = maxRetained, maxOutcomes = 1000,
  maxConfirmations = maxOutcomes,
} = {}) {
  return [
  'BattleFleetConfig = {',
  '  enabled = true,',
  `  gameProcess = ${JSON.stringify(GAME)},`,
  '  workerId = "test-worker",',
  `  capacity = ${capacity},`,
  `  maxRetained = ${maxRetained},`,
  `  maxPending = ${maxPending},`,
  `  maxOutcomes = ${maxOutcomes},`,
  `  maxConfirmations = ${maxConfirmations},`,
  '}',
  ].join('\n');
}

function sourceFor(testFile, entrypoint, options) {
  return [
  'package.loaded[".json"] = require("json")',
  'local C = (function()', readNative('constants.lua'), 'end)()',
  readNative('monster-index.generated.lua'),
  'local jsonx = (function()', readNative('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', readNative('battle.lua'), 'end)()',
  'Authority = (function()', readHere('authority.lua'), 'end)()',
  config(options),
  readHere('worker.lua'),
  readHere(testFile),
  `return ${entrypoint}()`,
  ].join('\n');
}

async function runOnce(source) {
  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 9_000_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
  });
  const result = await handle(null, {
    Id: 'eval-battle-fleet-tests',
    Target: 'local-battle-fleet-tests'.padEnd(43, '_'),
    Owner: 'local-battle-fleet-owner'.padEnd(43, '_'),
    From: 'local-battle-fleet-owner'.padEnd(43, '_'),
    Tags: [{ name: 'Action', value: 'Eval' }],
    Data: source,
    'Block-Height': '1',
    Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'),
    Cron: false,
  }, {
    Process: {
      Id: 'local-battle-fleet-tests'.padEnd(43, '_'),
      Owner: 'local-battle-fleet-owner'.padEnd(43, '_'),
      Tags: [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Process' },
      ],
    },
  });
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  return typeof data === 'string' ? data : data?.output;
}

const mainSource = sourceFor('worker_test.lua', 'battle_fleet_test', {});
const first = await runOnce(mainSource);
const second = await runOnce(mainSource);
if (typeof first !== 'string') throw new Error(`No test output: ${JSON.stringify(first)}`);
const report = first.replace(/^TRACE .*$/m, 'TRACE (deterministic transcript captured)');
console.log(report);

if (/^FAIL/m.test(first) || /\b[1-9]\d* failed\b/.test(first)) process.exitCode = 1;
if (first !== second) {
  console.error('FAIL  deterministic replay differs across fresh VMs');
  process.exitCode = 1;
} else {
  console.log('PASS  deterministic replay matches across fresh VMs');
}

const retentionSource = sourceFor(
  'retention_test.lua', 'battle_fleet_retention_test',
  { capacity: 2, maxRetained: 1, maxPending: 1 },
);
const retention = await runOnce(retentionSource);
console.log(retention);
if (/^FAIL/m.test(retention) || /\b[1-9]\d* failed\b/.test(retention)) process.exitCode = 1;

const outcomeLimitSource = sourceFor(
  'outcome_limit_test.lua', 'battle_fleet_outcome_limit_test',
  {
    capacity: 2, maxRetained: 1, maxPending: 2,
    maxOutcomes: 2, maxConfirmations: 10,
  },
);
const outcomeLimit = await runOnce(outcomeLimitSource);
console.log(outcomeLimit);
if (/^FAIL/m.test(outcomeLimit) || /\b[1-9]\d* failed\b/.test(outcomeLimit)) {
  process.exitCode = 1;
}

const confirmationLimitSource = sourceFor(
  'confirmation_limit_test.lua', 'battle_fleet_confirmation_limit_test',
  {
    capacity: 2, maxRetained: 1, maxPending: 2,
    maxOutcomes: 10, maxConfirmations: 1,
  },
);
const confirmationLimit = await runOnce(confirmationLimitSource);
console.log(confirmationLimit);
if (/^FAIL/m.test(confirmationLimit) || /\b[1-9]\d* failed\b/.test(confirmationLimit)) {
  process.exitCode = 1;
}
