/**
 * Deploy the Rune Realm Rune AMM and test quote token.
 *
 *   HB_WALLET=path/to/key.json node backend/native/deploy-marketplace.mjs
 *
 * Inputs:
 *   RUNE_TOKEN=<pid>       defaults to rune-process.txt
 *   QUOTE_TOKEN=<pid>      reuse a compatible token instead of TEST-RELIC
 *   QUOTE_TICKER=<ticker>  required for a custom quote (default TEST-RELIC)
 *   QUOTE_DENOMINATION=N   atomic decimals (default 6)
 *   GAME_PROCESS=<pid>     defaults to live-process.txt
 *   NODE_URL=<url>         all Lua processes must share this scheduler node
 *   FEE_BPS=30             AMM fee, one basis point = 0.01%
 *   --no-env               do not update frontend defaults or .env files
 *
 * This deploys an EMPTY pool. Rune has no premine by design, so a deployment
 * script cannot honestly invent the Rune side of initial liquidity. The owner
 * receives one TEST-RELIC faucet claim and can seed both sides after withdrawing
 * earned Rune from the game.
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
const gameLive = readLines('live-process.txt');
const runeLive = readLines('rune-process.txt');

const GAME = process.env.GAME_PROCESS || gameLive[0];
const RUNE = process.env.RUNE_TOKEN || runeLive[0];
const NODE = process.env.NODE_URL || runeLive[1] || gameLive[1] || 'https://hyperbeam.tylerw.ai';
const REQUEST_NODE = transportNode(NODE);
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const QUOTE_TICKER = process.env.QUOTE_TICKER || 'TEST-RELIC';
const QUOTE_DENOMINATION = Number(process.env.QUOTE_DENOMINATION || 6);
const FEE_BPS = Number(process.env.FEE_BPS || 30);

const isId = (v) => /^[A-Za-z0-9_-]{43}$/.test(v || '');
if (!fs.existsSync(WALLET)) throw new Error(`No keyfile at ${WALLET}. Set HB_WALLET.`);
if (!isId(GAME)) throw new Error('No valid game process. Set GAME_PROCESS or deploy the game first.');
if (!isId(RUNE)) throw new Error('No valid Rune token. Set RUNE_TOKEN or run deploy:rune first.');
if (!Number.isInteger(QUOTE_DENOMINATION) || QUOTE_DENOMINATION < 0 || QUOTE_DENOMINATION > 18) {
  throw new Error('QUOTE_DENOMINATION must be an integer from 0 through 18.');
}
if (!Number.isInteger(FEE_BPS) || FEE_BPS < 0 || FEE_BPS > 1000) {
  throw new Error('FEE_BPS must be an integer from 0 through 1000.');
}

const jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));
const owner = jwkToAddress(jwk);
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');
const bundle = (contract) => [
  // `json.lua` alone, not all of hyper-aos: this process defines its own
  // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
  // full runtime instead -- it registers `.json` the same way.
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  read(contract),
].join('\n');

async function readKey(pid, key, { attempts = 10, delayMs = 1000 } = {}) {
  let last = 'not found';
  const route = key.startsWith('compute&') ? key : `now/${key}`;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${REQUEST_NODE}/${pid}~process@1.0/${route}`, {
        headers: { accept: 'text/plain' },
      });
      if (res.ok) return (await res.text()).trim();
      last = `${res.status} ${(await res.text()).slice(0, 160)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Could not read ${pid}/${key}: ${last}`);
}

async function action(pid, name, tags = {}, data) {
  const sent = await sendMessage({ node: NODE, jwk, process: pid, action: name,
    tags: { Action: name, ...tags }, data });
  if (sent.slot == null || !/^\d+$/.test(String(sent.slot))) {
    throw new Error(`${name} was scheduled without a readable slot`);
  }
  const text = await readKey(pid, `compute&slot=${sent.slot}/results/output/data`);
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`${name} returned non-JSON: ${text.slice(0, 200)}`); }
  if (result?.error) throw new Error(`${name}: ${result.error}`);
  return result;
}

async function spawn(label, file, name) {
  const lua = bundle(file);
  const started = Date.now();
  const pid = await spawnProcess({ node: NODE, jwk, lua, name });
  console.log(`${label.padEnd(12)} ${pid}  (${Date.now() - started} ms, ${Buffer.byteLength(lua)} bytes)`);
  return pid;
}

console.log(`node:       ${NODE}`);
console.log(`owner:      ${owner}`);
console.log(`game:       ${GAME}`);
console.log(`Rune:       ${RUNE}`);
console.log('');

let quote = process.env.QUOTE_TOKEN;
if (quote) {
  if (!isId(quote)) throw new Error('QUOTE_TOKEN must be a 43-character process id.');
  console.log(`quote       ${quote}  (existing ${QUOTE_TICKER})`);
} else {
  quote = await spawn('quote', 'quote.lua', 'TEST-Relic');
  await action(quote, 'Admin.Mint', {
    Recipient: owner,
    Quantity: '1000000000',
  });
  console.log(`             owner faucet: 1000 ${QUOTE_TICKER}`);
}

const amm = await spawn('amm', 'amm.lua', 'TEST-Rune Realm Swap');

await action(amm, 'Admin.Configure', {
  BaseToken: RUNE,
  QuoteToken: quote,
  BaseTicker: 'TEST-RUNE',
  QuoteTicker: QUOTE_TICKER,
  BaseDenomination: '0',
  QuoteDenomination: String(QUOTE_DENOMINATION),
  FeeBps: String(FEE_BPS),
});
// `marketplace.lua` is deliberately NOT spawned here. It indexes one-unit
// `token@1.0` companion assets that settle in native AR, and monsters are no
// longer minted as those, so it would index nothing. The live companion market
// is `Market.List` / `Market.Buy` / `Market.Cancel` inside game.lua, paid in
// in-game Rune, where the listing itself is the custody and a sale is one
// atomic action rather than a saga.
//
// The file and its suite are kept and still tested. TODO: if monster minting is
// ever re-enabled, revisit whether the index should come back -- and note that
// it was never wired to the UI, so "bring it back" means building that too.
// See MARKETPLACE.md.
//
// What remains here is the exchange, which is a different thing and still real:
// Rune and the quote token have holders, so they stay their own processes with
// an AMM between them.

const state = {
  amm, rune: RUNE, quote, game: GAME,
  node: NODE, owner, quoteTicker: QUOTE_TICKER,
  quoteDenomination: QUOTE_DENOMINATION, feeBps: FEE_BPS,
};
fs.writeFileSync(path.join(ROOT, 'marketplace-processes.txt'), [
  amm, RUNE, quote, NODE, owner,
].join('\n') + '\n');
fs.writeFileSync(path.join(HERE, 'marketplace-state.json'), `${JSON.stringify(state, null, 2)}\n`);

function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  if (text == null) return `${line}\n`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function syncFrontend() {
  if (process.argv.includes('--no-env')) {
    console.log('\n--no-env: frontend configuration was not changed.');
    return;
  }
  const defaultsFile = path.join(ROOT, 'src', 'lib', 'marketplace-config.ts');
  let defaults = fs.readFileSync(defaultsFile, 'utf8');
  const values = {
    amm, rune: RUNE, quote, node: NODE,
  };
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`(${key}:\\s*')[^']*(')`);
    if (!pattern.test(defaults)) throw new Error(`Could not update marketplace default '${key}'`);
    defaults = defaults.replace(pattern, `$1${value}$2`);
  }
  fs.writeFileSync(defaultsFile, defaults);

  const vars = {
    VITE_AMM_PROCESS: amm,
    VITE_RUNE_PROCESS: RUNE,
    VITE_QUOTE_PROCESS: quote,
    VITE_MARKET_NODE: NODE,
  };
  for (const rel of ['.env.example', '.env.local']) {
    const file = path.join(ROOT, rel);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    for (const [key, value] of Object.entries(vars)) text = setEnv(text, key, value);
    fs.writeFileSync(file, text);
  }
  console.log('frontend   src/lib/marketplace-config.ts, .env.example, .env.local');
}
syncFrontend();

console.log('\nMarketplace deployed with an empty AMM. Next:');
console.log(`  1. Withdraw earned Rune to ${owner}`);
if (QUOTE_TICKER === 'TEST-RELIC') console.log('  2. The owner starts with 1,000 TEST-RELIC; every signed wallet may faucet 5 repeatedly');
console.log(`  3. Transfer both tokens to the AMM: ${amm}`);
console.log('  4. Open /market and add the credited deposits as initial liquidity');
console.log('\nNo production AO compatibility is claimed by this test deployment.');
