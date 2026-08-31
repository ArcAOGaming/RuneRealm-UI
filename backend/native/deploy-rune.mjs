/**
 * deploy-rune.mjs — spawn the Rune token and wire it to the game.
 *
 *   HB_WALLET=key.json node backend/native/deploy-rune.mjs
 *
 * Optional:
 *   NODE_URL=https://…            which node to spawn on (default: the game's)
 *   GAME_PROCESS=<pid>            the game to wire it to (default: live-process.txt)
 *   --no-wire                     spawn only; do not name minter or token
 *
 * The two processes are joined by two owner-only messages, and BOTH are
 * required before a single Rune can move:
 *
 *   token.Admin.SetMinter    <game>   — only the game may mint or burn
 *   game.Admin.SetRuneToken  <token>  — the game knows where to send the mint
 *
 * Until then the token refuses to mint ("No minter is configured") and the game
 * refuses to withdraw ("Withdrawals are not open yet"). That is deliberate: a
 * half-wired pair would deduct somebody's balance and mint nothing.
 *
 * Both processes must be on the SAME node. A process is bound to the scheduler
 * it was spawned on, so a token on one node and a game on another means every
 * mint is a cross-node delivery — which is the least proven path available and
 * is not worth taking for a convenience.
 *
 * Supply starts at zero. Nothing is pre-mined and the recovered players' 25
 * Rune each is an IN-GAME balance, not token supply — it only becomes supply
 * when somebody withdraws it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage, jwkToAddress } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const live = (() => {
  const f = path.join(ROOT, 'live-process.txt');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
})();

const GAME = process.env.GAME_PROCESS || live[0];
const NODE = process.env.NODE_URL || live[1] || 'https://schedule.forward.computer';
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const wire = !process.argv.includes('--no-wire');

if (!fs.existsSync(WALLET)) {
  console.error(`No keyfile at ${WALLET}. Set HB_WALLET=path/to/key.json`);
  process.exit(1);
}
if (wire && !GAME) {
  console.error('No game process. Deploy the game first, or set GAME_PROCESS=<pid>.');
  process.exit(1);
}
const jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));
const owner = jwkToAddress(jwk);

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

// The bundle must match run-rune-test.sh exactly, or the suite is testing
// something other than what ships.
const lua = [
  // `json.lua` alone, not all of hyper-aos: this process defines its own
  // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
  // full runtime instead -- it registers `.json` the same way.
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  read('rune.lua'),
].join('\n');

console.log(`node:   ${NODE}`);
console.log(`owner:  ${owner}`);
console.log(`game:   ${GAME ?? '(not wiring)'}`);
console.log(`module: ${Buffer.byteLength(lua)} bytes`);

let t = Date.now();
const token = await spawnProcess({ node: NODE, jwk, lua, name: 'TEST-Rune' });
console.log(`spawn:  ${Date.now() - t} ms`);
console.log(`token:  ${token}\n`);

const readKey = async (pid, key, { attempts = 6, delayMs = 1000 } = {}) => {
  let status = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${NODE}/${pid}~process@1.0/now/${key}`, { headers: { accept: 'text/plain' } });
      if (r.ok) return (await r.text()).trim();
      status = r.status;
      if (r.status !== 404 && r.status < 500) break;
    } catch (err) {
      status = status || `network: ${err.message}`;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return `(${status})`;
};

const info = await readKey(token, 'tokeninfo');
console.log(`info:   ${info}\n`);

if (!wire) {
  console.log('--no-wire: nothing is minted until you run:');
  console.log(`  token Admin.SetMinter   Minter=<game>`);
  console.log(`  game  Admin.SetRuneToken RuneToken=${token}`);
} else {
  // Both directions, because either alone is a half-open bridge.
  console.log(`naming the game as the only minter`);
  await sendMessage({
    node: NODE, jwk, process: token, action: 'Admin.SetMinter',
    tags: { Action: 'Admin.SetMinter', Minter: GAME },
  });
  console.log(`  ${await readKey(token, 'results/output/data')}`);

  console.log(`telling the game where the token is`);
  await sendMessage({
    node: NODE, jwk, process: GAME, action: 'Admin.SetRuneToken',
    tags: { Action: 'Admin.SetRuneToken', RuneToken: token },
  });
  console.log(`  ${await readKey(GAME, 'results/output/data')}`);
}

fs.writeFileSync(path.join(ROOT, 'rune-process.txt'), `${token}\n${NODE}\n${owner}\n`);

console.log(`\nRUNE TOKEN: ${token}`);
console.log(`NODE:       ${NODE}`);
console.log(`\nSupply starts at 0. It grows only when a player withdraws:`);
console.log(`  curl "${NODE}/${token}~process@1.0/now/totalsupply"`);
console.log(`  curl "${NODE}/${token}~process@1.0/now/balances"`);
