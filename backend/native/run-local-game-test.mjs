/** Offline syntax and state-machine runner for game.lua. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const PROCESS_ID = 'local-game-tests'.padEnd(43, '_');
const OWNER = 'local-game-owner'.padEnd(43, '_');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

const source = [
  'package.loaded[".json"] = require("json")',
  'Owner = nil',
  'local C = (function()', read('constants.lua'), 'end)()',
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', read('battle.lua'), 'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
  'BattleFleetConfig = nil',
  'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
  read('game.lua'), read('game_test.lua'),
  'return gametest({}, {})',
].join('\n');

const handle = await AoLoader(fs.readFileSync(WASM), {
  format: 'wasm32-unknown-emscripten',
  // The integrated economy and pass scenarios deliberately exercise hundreds
  // of complete process messages in one Eval. This is a harness allowance, not
  // a per-message production budget: each handler still runs in its own slot on
  // HyperBEAM.
  computeLimit: 18_000_000_000_000,
  memoryLimit: 512 * 1024 * 1024,
});
const result = await handle(null, {
  Id: 'eval-game-tests', Target: PROCESS_ID, Owner: OWNER, From: OWNER,
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
const data = result.Output?.data;
const output = typeof data === 'string' ? data : data?.output;
const text = typeof output === 'string' ? output : JSON.stringify(output);
console.log(text);
if (/^(FAIL|ERROR):?/m.test(text) || /\b[1-9]\d* failed\b/.test(text)) process.exitCode = 1;
