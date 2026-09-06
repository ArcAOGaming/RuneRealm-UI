/**
 * Deploy the two venues.
 *
 *   HB_WALLET=path/to/key.json node backend/native/deploy-venue.mjs
 *   node backend/native/deploy-venue.mjs --only=external
 *
 * Inputs:
 *   GAME_PROCESS=<pid>   defaults to live-process.txt
 *   RUNE_TOKEN=<pid>     defaults to rune-process.txt
 *   QUOTE_TOKEN=<pid>    the TEST-RELIC token; defaults to marketplace-state.json
 *   NODE_URL=<url>       every Lua process must share this scheduler node
 *   --only=internal|external   deploy one of them
 *   --launch             open the markets as well as create them
 *
 * WHAT THIS DEPLOYS, and why it is two processes rather than one.
 *
 *   INTERNAL  in-game assets -- Gold, berries, scrolls, in-game Rune -- moved
 *             between the game and the venue as trusted messages. Those assets
 *             are NOT tokens and never will be, so this venue has no token
 *             process anywhere in its configuration and no verb that could use
 *             one. It listens to exactly one address: the game.
 *
 *   EXTERNAL  real tokens. TEST-RUNE against TEST-RELIC, and for now that is
 *             the only pair. Deposits arrive as Credit-Notice, withdrawals
 *             leave as Transfer, and it has never heard of the game.
 *
 * Each is sealed after configuration, which freezes the mode, the game process
 * and every listed token. Markets stay creatable and launchable afterwards --
 * that is the point of the split, and `Admin.LaunchAll` is the going-live
 * switch.
 *
 * MARKETS ARE CREATED CLOSED. Without `--launch` this script leaves them that
 * way, so a deployment can be inspected before anybody can rest an order on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage, jwkToAddress, transportNode } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const readLines = (name) => {
  const file = path.join(ROOT, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/) : [];
};
const readJson = (file) => (fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

const gameLive = readLines('live-process.txt');
const runeLive = readLines('rune-process.txt');
const marketState = readJson(path.join(HERE, 'marketplace-state.json'));

const GAME = process.env.GAME_PROCESS || gameLive[0];
const RUNE = process.env.RUNE_TOKEN || runeLive[0];
const QUOTE = process.env.QUOTE_TOKEN || marketState.quote;
const NODE = process.env.NODE_URL || runeLive[1] || gameLive[1] || 'https://hyperbeam.tylerw.ai';
const REQUEST_NODE = transportNode(NODE);
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'both';
const LAUNCH = process.argv.includes('--launch');
const wantInternal = only === 'both' || only === 'internal';
const wantExternal = only === 'both' || only === 'external';

const isId = (v) => /^[A-Za-z0-9_-]{43}$/.test(v || '');
if (!fs.existsSync(WALLET)) throw new Error(`No keyfile at ${WALLET}. Set HB_WALLET.`);
if (!['both', 'internal', 'external'].includes(only)) {
  throw new Error('--only must be internal or external');
}
if (wantInternal && !isId(GAME)) {
  throw new Error('The internal venue needs a game process. Set GAME_PROCESS.');
}
if (wantExternal && !isId(RUNE)) {
  throw new Error('The external venue needs the Rune token. Set RUNE_TOKEN or run deploy:rune.');
}
if (wantExternal && !isId(QUOTE)) {
  throw new Error('The external venue needs the quote token. Set QUOTE_TOKEN or run deploy:marketplace.');
}

const jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));
const owner = jwkToAddress(jwk);
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

// Exactly what run-venue-test.sh bundles, in the same order. The venue is a
// process, so `venue.lua` is not wrapped -- it defines globals and `compute`.
const bundle = () => [
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local C = (function()', read('constants.lua'), 'end)()',
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'local OrderBook = (function()', read('orderbook.lua'), 'end)()',
  read('venue.lua'),
].join('\n');

async function readKey(pid, key, { attempts = 10, delayMs = 1000 } = {}) {
  let last = 'not found';
  const route = key.startsWith('compute&') ? key : `now/${key}`;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${REQUEST_NODE}/${pid}~process@1.0/${route}`, {
        headers: { accept: 'text/plain' },
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        // An absent key is answered with the node's own HTML landing page, at
        // status 200. See CLAUDE.md: treat HTML at 200 as "key absent".
        if (!/^\s*<(!doctype|html)/i.test(text)) return text;
        last = 'the node served HTML, which means the key is absent';
      } else {
        last = `${res.status} ${(await res.text()).slice(0, 160)}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  throw new Error(`Could not read ${pid}/${key}: ${last}`);
}

async function action(pid, name, tags = {}, data) {
  const sent = await sendMessage({
    node: NODE, jwk, process: pid, action: name,
    tags: { Action: name, ...tags }, data,
  });
  if (sent.slot == null || !/^\d+$/.test(String(sent.slot))) {
    throw new Error(`${name} was scheduled without a readable slot`);
  }
  const text = await readKey(pid, `compute&slot=${sent.slot}/results/output/data`);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`${name} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (result?.error) throw new Error(`${name}: ${result.error}`);
  return result;
}

async function spawn(label, name) {
  const lua = bundle();
  const started = Date.now();
  const pid = await spawnProcess({ node: NODE, jwk, lua, name });
  console.log(`${label.padEnd(10)} ${pid}  (${Date.now() - started} ms, ${Buffer.byteLength(lua)} bytes)`);
  return pid;
}

console.log(`node:      ${NODE}`);
console.log(`owner:     ${owner}`);
if (wantInternal) console.log(`game:      ${GAME}`);
if (wantExternal) console.log(`Rune:      ${RUNE}`);
if (wantExternal) console.log(`Relic:     ${QUOTE}`);
console.log('');

const deployed = {};

if (wantInternal) {
  const pid = await spawn('internal', 'TEST-Rune Realm Internal Venue');
  await action(pid, 'Admin.Configure', {
    Mode: 'internal',
    Name: 'TEST-Rune Realm Internal Venue',
    GameProcess: GAME,
  });

  // The in-game assets that may be traded. Every one of them is a NAME: there
  // is no process behind `fire_berry` and there is not going to be one, which
  // is the whole reason the internal venue exists as its own mode.
  const assets = [
    ['gold', 'Gold'],
    ['air_berry', 'Air Berry'],
    ['water_berry', 'Water Berry'],
    ['fire_berry', 'Fire Berry'],
    ['rock_berry', 'Rock Berry'],
    ['scroll', 'Scroll'],
    ['legendary_scroll', 'Legendary Scroll'],
    ['rune', 'Rune'],
  ];
  for (const [id, name] of assets) {
    await action(pid, 'Admin.ListAsset', { Asset: id, Name: name });
  }

  // Everything trades against Gold, one unit at a time, exactly as it does
  // inside the game -- so a trader who learned the in-game ladder already
  // knows this one. `CreationCost` is 0 because the in-game 1 Gold exists to
  // fund the Gold sink, and this venue has no sink to fund.
  for (const [id] of assets.filter(([id]) => id !== 'gold')) {
    await action(pid, 'Admin.CreateMarket', {
      Base: id, Quote: 'gold', Tick: '1', Lot: '1',
      MinValue: '1', CreationCost: '0', TakerBps: '0',
    });
  }

  await action(pid, 'Admin.Seal');
  if (LAUNCH) {
    const opened = await action(pid, 'Admin.LaunchAll');
    console.log(`           launched ${opened.opened?.length ?? 0} markets`);
  }
  deployed.internal = pid;
  console.log(`           ${assets.length} assets, ${assets.length - 1} markets${LAUNCH ? '' : ' (closed)'}`);
}

if (wantExternal) {
  const pid = await spawn('external', 'TEST-Rune Realm External Venue');
  await action(pid, 'Admin.Configure', {
    Mode: 'external',
    Name: 'TEST-Rune Realm External Venue',
  });
  await action(pid, 'Admin.ListAsset', {
    Asset: 'rune', Name: 'TEST-Rune', Process: RUNE,
    Ticker: 'TEST-RUNE', Denomination: '6',
  });
  await action(pid, 'Admin.ListAsset', {
    Asset: 'relic', Name: 'TEST-Relic', Process: QUOTE,
    Ticker: 'TEST-RELIC', Denomination: '6',
  });

  // ONE PAIR, for now, and its numbers are the whole reason `lot` exists.
  //
  // Both tokens carry six decimals, so a price in raw atoms would be a price
  // per millionth of a Rune and every quote on the screen would be unreadable.
  // A lot of 1,000,000 makes the unit ONE WHOLE RUNE and the price Relic atoms
  // per Rune; a tick of 1,000 makes the increment a thousandth of a Relic.
  // `MaxPrice` has to be raised for the same reason -- the default ceiling is
  // a sane cap on a price in Gold and would refuse two Relic.
  await action(pid, 'Admin.CreateMarket', {
    Base: 'rune', Quote: 'relic',
    Lot: '1000000', Tick: '1000', MinValue: '1000',
    MaxPrice: '1000000000000', MaxQuantity: '1000000',
    TakerBps: '30', CreationCost: '0',
  });

  await action(pid, 'Admin.Seal');
  if (LAUNCH) {
    const opened = await action(pid, 'Admin.LaunchAll');
    console.log(`           launched ${opened.opened?.length ?? 0} markets`);
  }
  deployed.external = pid;
  console.log(`           rune/relic${LAUNCH ? '' : ' (closed)'}`);
}

const state = {
  ...readJson(path.join(HERE, 'venue-state.json')),
  ...deployed,
  game: GAME, rune: RUNE, quote: QUOTE, node: NODE, owner,
  launched: LAUNCH,
  deployedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(HERE, 'venue-state.json'), `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'venue-processes.txt'),
  `${[state.internal || '', state.external || '', NODE, owner].join('\n')}\n`);

console.log('\nWritten: backend/native/venue-state.json, venue-processes.txt');
console.log('\nNext:');
if (deployed.internal) {
  console.log(`  1. Point the game at the internal venue:`);
  console.log(`     Admin.SetVenueProcess ProcessId=${deployed.internal}`);
  console.log('     Until you do, Venue.Send refuses and nothing can cross.');
}
if (deployed.external) {
  console.log('  2. Deposit by Transfer-ing TEST-RUNE or TEST-RELIC to the external venue.');
  console.log('     The token puts a Reference on the Credit-Notice; the venue credits once.');
}
if (!LAUNCH) {
  console.log('  3. Markets are CLOSED. Open them all with Admin.LaunchAll when you are ready.');
}
console.log('\nNo production AO compatibility is claimed by this test deployment.');
