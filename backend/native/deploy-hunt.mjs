/** Spawn Hunt beside the current game process, wire both ends, and update UI config. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jwkToAddress, sendMessage, spawnProcess, transportNode } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const owner = jwkToAddress(jwk);
// The hunt fleet defaults to the GAME's node, not to a different one.
//
// Workers on another scheduler make every open and settle a cross-node
// delivery, which is a property to choose deliberately rather than inherit
// from a default. The first run of this script put three workers on
// schedule.forward.computer while the game sat on hyperbeam.tylerw.ai, purely
// because NODE_URL happened to be unset in that shell.
const liveFile = path.join(ROOT, 'live-process.txt');
const live = fs.existsSync(liveFile) ? fs.readFileSync(liveFile, 'utf8').trim().split(/\r?\n/) : [];
const gameProcess = process.env.HUNT_GAME_PROCESS || process.env.VITE_GAME_PROCESS || live[0];
const gameNode = (process.env.HUNT_GAME_NODE || process.env.VITE_HB_NODE || live[1]
  || 'https://schedule.forward.computer').replace(/\/$/, '');
const huntNode = (process.env.HUNT_NODE || process.env.NODE_URL || gameNode).replace(/\/$/, '');
const gameRequestNode = transportNode(gameNode);
if (!/^[A-Za-z0-9_-]{43}$/.test(gameProcess || '')) {
  throw new Error('Set HUNT_GAME_PROCESS or deploy the game first so live-process.txt names it.');
}

const config = `HuntConfig = { enabled = true, gameProcess = ${JSON.stringify(gameProcess)}, node = ${JSON.stringify(huntNode)}, maxRetained = 250 }`;
const lua = [
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local C = (function()', read('constants.lua'), 'end)()',
  read('monster-index.generated.lua'),
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', read('battle.lua'), 'end)()',
  config,
  read('hunt.lua'),
].join('\n');

// Three workers by default, for the same reason the battle fleet has several:
// hunt runs are independent of each other, so serialising them behind one
// process buys nothing. A run is assigned ONE worker by the game and talks to
// it directly for the whole session, so the split costs two hops per run and
// nothing per action.
const huntSize = Number(process.env.HUNT_FLEET_SIZE || 3);
if (!Number.isInteger(huntSize) || huntSize < 1 || huntSize > 16) {
  throw new Error('HUNT_FLEET_SIZE must be an integer from 1 to 16.');
}

console.log(`game:   ${gameProcess} @ ${gameNode}`);
console.log(`hunt:   spawning ${huntSize} @ ${huntNode}`);
console.log(`owner:  ${owner}`);
console.log(`module: ${Buffer.byteLength(lua)} bytes`);

const huntWorkers = [];
for (let index = 1; index <= huntSize; index += 1) {
  const workerProcess = await spawnProcess({
    node: huntNode, jwk, lua,
    name: `TEST-Rune Realm Hunt ${String(index).padStart(2, '0')}`,
  });
  console.log(`pid:    ${workerProcess} (hunt-worker-${String(index).padStart(2, '0')})`);
  huntWorkers.push({ processId: workerProcess, node: huntNode });
}
// The first worker stays the legacy `HuntProcess`, so a client or export that
// still reads a single processId keeps resolving to a real worker.
const huntProcess = huntWorkers[0].processId;
fs.writeFileSync(path.join(ROOT, 'hunt-process.txt'),
  `${huntWorkers.map((worker) => worker.processId).join('\n')}\n${huntNode}\n${gameProcess}\n`);

// One call carries the whole fleet: the head as tags for the legacy field, the
// rest in the body. Registering them one at a time would leave the game briefly
// publishing a fleet that does not match what was spawned.
await sendMessage({
  node: gameNode, jwk, process: gameProcess, action: 'Admin.SetHuntProcess',
  tags: { ProcessId: huntProcess, Node: huntNode },
  data: JSON.stringify(huntWorkers.slice(1)),
});

let wired = false;
// Two minutes, not fifteen seconds. `/now/<key>` computes to the scheduler
// head, so it inherits whatever the process is already working through — under
// a soak that is easily longer than 15s, and the failure reads as "the wiring
// did not land" when the wiring landed fine.
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    // `text/plain`, NOT `application/json`.
    //
    // Asking for JSON gets an ENVELOPE — `{"ao-result":"body","body":"<the
    // json, as a string>"}` — so `body.processId` and `body.workers` are
    // undefined and this check could never pass, even on a perfectly wired
    // deployment. It reported a false failure twice before anyone read the
    // published key by hand.
    const response = await fetch(`${gameRequestNode}/${gameProcess}~process@1.0/now/huntconfig`, {
      headers: { accept: 'text/plain' },
    });
    const text = response.ok ? (await response.text()).trim() : '';
    const body = text && !/^<!DOCTYPE html|^<html/i.test(text)
      ? JSON.parse(text) : null;
    const published = Array.isArray(body?.workers)
      ? body.workers.map((worker) => worker.processId) : [];
    const expected = huntWorkers.map((worker) => worker.processId);
    if (body?.processId === huntProcess && body?.enabled === true
        && published.length === expected.length
        && expected.every((id, index) => published[index] === id)) {
      wired = true;
      break;
    }
  } catch { /* process may still be computing */ }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!wired) {
  throw new Error(`Hunt spawned ${huntWorkers.length} worker(s) starting at ${huntProcess}, `
    + 'but the game did not publish a matching huntconfig.');
}
console.log(`wired:  game and all ${huntWorkers.length} Hunt workers agree`);

if (!process.argv.includes('--no-env')) {
  const rewrite = (relative, mutate) => {
    const file = path.join(ROOT, relative);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const after = mutate(before);
    if (after !== before) fs.writeFileSync(file, after);
  };
  const setVar = (text, key, value) => {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  };
  rewrite('src/lib/hyperbeam.ts', (text) => text
    .replace(/(env\.VITE_HUNT_PROCESS \|\| ')[^']*(')/, `$1${huntProcess}$2`)
    .replace(/(env\.VITE_HUNT_NODE \|\| )(?:HB_NODE|'[^']*')/, `$1'${huntNode}'`));
  rewrite('.env.example', (text) => setVar(setVar(text, 'VITE_HUNT_PROCESS', huntProcess), 'VITE_HUNT_NODE', huntNode));
  rewrite('.env.local', (text) => setVar(setVar(text, 'VITE_HUNT_PROCESS', huntProcess), 'VITE_HUNT_NODE', huntNode));
  console.log('config: UI now points at Hunt (rebuild the site to publish it)');
} else {
  console.log(`config: --no-env; set VITE_HUNT_PROCESS=${huntProcess} and VITE_HUNT_NODE=${huntNode}`);
}
