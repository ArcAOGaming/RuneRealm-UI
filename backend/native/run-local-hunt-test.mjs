/** Offline syntax/state-machine runner for both halves of the Hunt protocol. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');
const common = [
  'package.loaded[".json"] = require("json")',
  'local C = (function()', read('constants.lua'), 'end)()',
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', read('battle.lua'), 'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
].join('\n');

async function execute(source, id) {
  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 9_000_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
  });
  const owner = 'local-hunt-owner'.padEnd(43, '_');
  const result = await handle(null, {
    Id: `eval-${id}`, Target: id.padEnd(43, '_'), Owner: owner, From: owner,
    Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
    'Block-Height': '1', Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
  }, {
    Process: { Id: id.padEnd(43, '_'), Owner: owner, Tags: [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'Type', value: 'Process' },
    ] },
  });
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  return typeof data === 'string' ? data : data?.output ?? JSON.stringify(data);
}

const huntSource = [
  common,
  'HuntConfig = { enabled = true, gameProcess = "GAMEggggggggggggggggggggggggggggggggggggggg" }',
  read('hunt.lua'), read('hunt_test.lua'),
  'return hunttest({})',
].join('\n');

const gameSource = [
  common,
  'Owner = nil',
  'BattleFleetConfig = nil',
  'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
  read('game.lua'), read('game_hunt_test.lua'),
  'return gamehunttest({})',
].join('\n');

for (const [name, source] of [['hunt process', huntSource], ['game bridge', gameSource]]) {
  const text = await execute(source, `local-${name.replace(' ', '-')}`);
  console.log(`\n${name}\n${text}`);
  if (/^(FAIL|ERROR):?/m.test(text) || /\b[1-9]\d* failed\b/.test(text)) process.exitCode = 1;
}
