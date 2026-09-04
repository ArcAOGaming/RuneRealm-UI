/**
 * redeploy.mjs — stand the whole thing up: game, token, wiring, verification.
 *
 *   npm run redeploy
 *   HB_WALLET=key.json node backend/native/redeploy.mjs
 *
 * Options:
 *   NODE_URL=https://…      node to deploy onto (default: the current one)
 *   --seed                  FINAL BUILD ONLY: migrate the current process,
 *                           restore the legacynet players, unlock the paid list
 *   --from <pid>            migrate from this process (implies --seed)
 *   --fresh                 --seed without the migration: legacy + paid only
 *   --blank                 accepted, and already the default
 *   --migrate-node <url>    node hosting --from, when moving between nodes
 *   --game-only             skip the token
 *   --no-market             deploy only the game and Rune bridge
 *   --no-env                do not repoint the app
 *   --skip-checks           skip offline tests and the preflight build
 *   --preflight-only        run checks/build, then create nothing
 *   --live-test-node <url>  public ~lua@5.3a used by free preflight suites
 *   --resume                reuse completed stages recorded by prior deploys
 *   --quote <pid>           use an existing compatible quote token
 *   --quote-ticker <name>   ticker for --quote (default TEST-RELIC)
 *   --quote-denomination N  decimals for --quote (default 6)
 *   --fee-bps N             AMM fee in basis points (default 30)
 *   --site                  upload the final build and print its manifest id
 *   --free / --public-access  explicit free sign-up — already the default
 *   --paid-access           gate sign-up behind the Eternal Pass allow-list
 *   --no-free               alias for --paid-access
 *   --with-bots             validate the 50-wallet swarm and grant it access
 *   --no-hunt               skip the hunt fleet
 *   --hunt-size N           hunt workers to spawn (default 3)
 *   --hunt-node <url>       node for the hunt fleet (default: the deploy node)
 *   --plan                  print the stages and create nothing
 *
 * This replaces running `deploy.mjs` and `deploy-rune.mjs` by hand, and exists
 * because doing that by hand went wrong in a way worth not repeating: the two
 * were started concurrently, the token read `live-process.txt` while the game
 * deploy was still rewriting it, and wired itself to a half-built game. Then
 * the wiring "confirmation" came back as `{"loaded":10,"players":160}` — an
 * `Admin.Load` reply from the other deploy, because a published reply key is
 * whoever computed LAST, not whoever asked.
 *
 * So: one process, strictly in order, and every step verified against a key
 * that belongs to that step alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sendMessage, jwkToAddress, transportNode } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { PROFILES } from './swarm/profiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const flag = (name) => process.argv.includes(name);
const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const liveFile = path.join(ROOT, 'live-process.txt');
const live = fs.existsSync(liveFile)
  ? fs.readFileSync(liveFile, 'utf8').trim().split(/\r?\n/)
  : [];

const NODE = process.env.NODE_URL || live[1] || 'https://schedule.forward.computer';
const REQUEST_NODE = transportNode(NODE);
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
/**
 * A deployment carries NOTHING unless this run says so.
 *
 * The default used to be the opposite: migrate whatever `live-process.txt`
 * points at, restore the 168 legacynet players, unlock the paid list. That is
 * right exactly once — the build that actually launches — and wrong every other
 * time. Each test deploy re-loaded real accounts onto a throwaway process,
 * measured its own numbers on top of someone else's history, and gave the next
 * migration one more half-finished deployment to chain from.
 *
 * So seeding is a deliberate act: `--seed` (or `SEED_DATA=1`). Asking for a
 * specific source with `--from` is the same request said more precisely, and
 * implies it. `--fresh` seeds the players without chaining the migration.
 */
const explicitFrom = opt('--from', null);
const seedData = flag('--seed')
  || flag('--seed-data')
  || flag('--fresh')
  || !!explicitFrom
  || /^(1|true|yes|on)$/i.test(process.env.SEED_DATA || '');
if (seedData && flag('--blank')) {
  throw new Error('Choose one: --seed (final build) or --blank (the default), not both');
}
const from = (!seedData || flag('--fresh'))
  ? null
  : (explicitFrom || live[0] || null);
const resume = flag('--resume');
// Free sign-up is the default; the Eternal Pass gate is asked for by name. See
// the note in deploy.mjs — a process nobody can join is not a safe default.
const freeEnabled = flag('--free') || flag('--public-access');
const freeDisabled = flag('--no-free') || flag('--no-public-access') || flag('--paid-access');
if (freeEnabled && freeDisabled) {
  throw new Error('Choose one access mode: --free (the default) or --paid-access, not both');
}
const publicAccess = freeEnabled ? true : !(
  freeDisabled || /^(0|false|no|off)$/i.test(process.env.PUBLIC_ACCESS || '')
);
const withBots = flag('--with-bots')
  || /^(1|true|yes)$/i.test(process.env.SWARM_BOTS || '');
const customQuote = opt('--quote', process.env.QUOTE_TOKEN || null);
const quoteTicker = opt('--quote-ticker', process.env.QUOTE_TICKER || 'TEST-RELIC');
const quoteDenomination = opt('--quote-denomination', process.env.QUOTE_DENOMINATION || '6');
const feeBps = opt('--fee-bps', process.env.FEE_BPS || '30');
// The node the free unsigned preflight suites run on. Defaults to the node
// being deployed to, and that default changed for a reason: the public
// zephyrdev/arweave.net nodes sit behind an nginx that gives up at ~25 s, and
// the recovered-player verification is a 441 KB bundle that loads 168 players
// and reads every one of them back inside a single request. It stopped fitting
// and started answering `502 Bad Gateway`, which fails the preflight and reads
// exactly like a broken build. It passes on the deploy node.
const liveTestNode = opt('--live-test-node', process.env.LUA_TEST_NODE || NODE);
const isId = (value) => /^[A-Za-z0-9_-]{43}$/.test(value || '');

function inspectBotRoster() {
  const expected = new Set(PROFILES.map((profile) => profile.wallet));
  const burners = listBurners().filter((burner) => expected.has(burner.name));
  const present = new Set(burners.map((burner) => burner.name));
  const uniqueAddresses = new Set(burners.map((burner) => burner.address));
  const missing = [...expected].filter((name) => !present.has(name));
  return {
    expected: expected.size,
    available: burners.length,
    uniqueAddresses: uniqueAddresses.size,
    addresses: burners.map((burner) => burner.address),
    missing,
    ready: missing.length === 0 && uniqueAddresses.size === expected.size,
  };
}

const botRoster = withBots ? inspectBotRoster() : null;

if (from && !isId(from)) throw new Error('--from must be a 43-character process id');
if (customQuote && !isId(customQuote)) throw new Error('--quote must be a 43-character process id');
if (!/^\d+$/.test(String(quoteDenomination)) || Number(quoteDenomination) > 18) {
  throw new Error('--quote-denomination must be an integer from 0 through 18');
}
if (!/^\d+$/.test(String(feeBps)) || Number(feeBps) > 1000) {
  throw new Error('--fee-bps must be an integer from 0 through 1000');
}
try {
  const url = new URL(liveTestNode);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
} catch {
  throw new Error('--live-test-node must be an HTTP(S) URL');
}

if (flag('--plan')) {
  console.log('Rune Realm full deployment plan (no writes):');
  console.log(`  node         ${NODE}`);
  console.log(`  wallet       ${path.basename(WALLET)} (${fs.existsSync(WALLET) ? 'present' : 'MISSING'}; contents are never printed)`);
  console.log(`  seed data    ${seedData
    ? 'ON (--seed: legacy players + paid allow-list) — FINAL BUILD'
    : 'OFF (blank process; --seed turns it on)'}`);
  console.log(`  migrate from ${from ?? (seedData
    ? '(--fresh — legacy restore only, no migration)'
    : '(nothing — blank deployment)')}`);
  console.log(`  quote        ${customQuote || 'new TEST-RELIC faucet token'}`);
  console.log(`  AMM fee      ${feeBps} bps`);
  console.log(`  sign-up      ${publicAccess
    ? 'FREE (any wallet may join) — the default'
    : 'PAID (--paid-access: Eternal Pass allow-list)'}`);
  console.log(`  test bots    ${withBots
    ? `${botRoster.available}/${botRoster.expected} wallets ready; ${publicAccess ? 'admitted by free mode' : 'allow-list after spawn'}`
    : 'not enrolled'}`);
  console.log(`  live tests   ${liveTestNode} (unsigned; creates no processes)`);
  console.log('  stages       offline/live preflight -> game -> Rune -> bridge -> quote/AMM'
    + ' -> hunt fleet -> verify -> build');
  console.log(`  hunt         ${flag('--no-hunt') ? 'skipped' : `${opt('--hunt-size', process.env.HUNT_FLEET_SIZE || '3')} worker(s), wired both ways`}`);
  console.log(`  site         ${flag('--site')
    ? 'upload after build (ArNS linking remains manual)'
    : 'build only'}`);
  process.exit(0);
}

if (withBots && !botRoster.ready) {
  const detail = botRoster.missing.length
    ? `missing ${botRoster.missing.slice(0, 5).join(', ')}${botRoster.missing.length > 5 ? ', ...' : ''}`
    : 'wallet addresses are not unique';
  throw new Error(`The test-bot roster is not ready (${detail}). Run: npm run swarm:wallets`);
}

const preflightOnly = flag('--preflight-only');
if (!preflightOnly && !fs.existsSync(WALLET)) {
  console.error(`No keyfile at ${WALLET}. Set HB_WALLET=path/to/key.json`);
  process.exit(1);
}
let jwk;
let owner;

const rule = (t) => console.log(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);

/** Run a child script to completion, streaming its output. Throws on failure. */
function run(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HERE, script), ...args], {
      stdio: 'inherit',
      env: { ...process.env, HB_WALLET: WALLET, NODE_URL: NODE, ...env },
    });
    child.on('exit', (code) => (code === 0
      ? resolve()
      : reject(new Error(`${script} exited ${code}`))));
    child.on('error', reject);
  });
}

/** Run a checked-in JavaScript CLI without a platform-specific shell wrapper. */
function runCommand(label, command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => (code === 0
      ? resolve()
      : reject(new Error(`${label} exited ${code}`))));
    child.on('error', reject);
  });
}

async function buildApp() {
  await runCommand('TypeScript', process.execPath,
    [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
  await runCommand('Vite', process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
}

/**
 * Read a published key, waiting one out rather than believing the first answer.
 *
 * Two things that are NOT the value: a 404 while the node computes to the
 * scheduler head, and the node's own HTML landing page served at status 200
 * when a key does not exist. Both look like data to a caller that does not
 * check, and the second one reaches `JSON.parse` as `<!DOCTYPE html>`.
 */
// 30 seconds was not enough and the failure was indistinguishable from a
// handler that never ran. `/now` has to compute to the scheduler head, and a
// freshly migrated process has ~120 slots of `Admin.Load` in front of it, each
// one republishing the whole read surface. Stage 4 aborted a deploy whose
// `Admin.SetRuneToken` had in fact computed correctly at slot 121; the key was
// readable a minute later. Two minutes, and the wait is worth more than the
// speed.
async function readKey(pid, key, { attempts = 40, delayMs = 3000 } = {}) {
  let last = '(no answer)';
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${REQUEST_NODE}/${pid}~process@1.0/now/${key}`, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(30000),
      });
      const body = (await r.text()).trim();
      if (r.ok && !/^<!DOCTYPE html|^<html/i.test(body) && body !== '') return body;
      last = r.ok ? 'HTML landing page (key absent)' : `status ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(`could not read ${key} from ${pid}: ${last}`);
}

/**
 * Send a message and WAIT FOR ITS OWN SLOT to compute, returning its reply.
 *
 * Every verification in this file used to be "send, then `readKey` the value it
 * should have changed", and that is wrong on HyperBEAM in a way that looks like
 * a broken deploy. Compute is pull-based: a scheduled message does not run
 * until somebody asks for a slot at or past it, and `readKey` returns the first
 * non-empty answer it gets. So when the key ALREADY EXISTS — `player-<address>`
 * written by the migration, `minter` written by the previous deploy — the read
 * comes back instantly with the stale value, the check fails, and the deploy
 * aborts on a message that was fine and simply had not been asked for yet.
 *
 * Both of those actually happened on the 2026-08-31 redeploy, one stage apart.
 * Asking for the message's own slot is what forces it to run; after that the
 * published keys are current and `readKey` means what it says.
 *
 * The reply is also CHECKED here. The old code ignored it, so a handler that
 * refused outright was indistinguishable from one that had not run.
 */
async function sendAndSettle(pid, message, label, { attempts = 60, delayMs = 2000 } = {}) {
  const sent = await sendMessage({ node: NODE, jwk, process: pid, ...message });
  const slot = sent && (sent.slot ?? sent.Slot);
  if (slot === undefined || slot === null) {
    throw new Error(`${label} did not report a compute slot; it cannot be verified`);
  }
  let body = '';
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(
        `${REQUEST_NODE}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`,
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(30000) },
    ).catch(() => null);
    if (r && r.ok) {
      const text = (await r.text()).trim();
      // An HTML body at status 200 is "key absent", never a reply. See CLAUDE.md.
      if (text && !/^<!DOCTYPE html|^<html/i.test(text)) { body = text; break; }
    }
    await new Promise((done) => setTimeout(done, delayMs));
  }
  if (!body) throw new Error(`${label} slot ${slot} never returned a reply`);
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    throw new Error(`${label} returned a non-JSON reply: ${body.slice(0, 160)}`);
  }
  if (reply && reply.error) throw new Error(`${label} was refused: ${reply.error}`);
  return reply;
}

const readLive = () => fs.readFileSync(liveFile, 'utf8').trim().split(/\r?\n/);

// -- preflight ---------------------------------------------------------------

rule('1/8  offline checks, live Luerl suites and preflight build');
if (flag('--skip-checks')) {
  console.log('skipped by --skip-checks');
} else {
  if (customQuote) {
    const quoteInfo = JSON.parse(await readKey(customQuote, 'tokeninfo'));
    if (quoteInfo.Ticker !== quoteTicker
        || String(quoteInfo.Denomination) !== String(quoteDenomination)) {
      throw new Error(`quote token reports ${quoteInfo.Ticker}/${quoteInfo.Denomination}; `
        + `expected ${quoteTicker}/${quoteDenomination}`);
    }
    console.log(`quote preflight: ${quoteInfo.Ticker}, denomination ${quoteInfo.Denomination}`);
  }
  await runCommand('native game tests', process.execPath,
    [path.join(HERE, 'run-local-game-test.mjs')]);
  await runCommand('native exchange tests', process.execPath,
    [path.join(HERE, 'run-local-marketplace-test.mjs')]);
  await runCommand('native hunt bridge tests', process.execPath,
    [path.join(HERE, 'run-local-hunt-test.mjs')]);
  await runCommand('adversarial economy calibration', process.execPath,
    [path.join(HERE, 'economy-sim.mjs')]);
  await runCommand('economy and marketplace fuzz', process.execPath,
    [path.join(HERE, 'fuzz.mjs'), '--ops', '500', '--wallets', '20', '--seed', '20260830']);
  await runCommand('swarm orchestration tests', process.execPath,
    [path.join(HERE, 'swarm', 'swarm.test.mjs')]);
  // The game's LIVE gate is the smoke test, not the full suite.
  //
  // The full suite is 367 tests: 29 seconds on the offline aos WASM (already
  // run above) and over five minutes on Luerl, which is an interpreter written
  // in Erlang. The node serving `~lua@5.3a` sits behind an nginx with a
  // 300-second read timeout, so the full suite is killed mid-run and answers
  // `504` — indistinguishable from the node being down, and it blocked two
  // deploys before it was understood.
  //
  // The two runs answer different questions. Behaviour is covered offline and
  // covered completely. What only a live run can answer is whether LUERL
  // accepts the module — the `goto` / `string.pack` / `gmatch` class of
  // rejection that the WASM does not object to and that bricks a deployed
  // process. That is settled by loading the module and walking one path through
  // each construct, which is what the smoke test does in about 35 seconds.
  await runCommand('live Luerl smoke test (game.lua)', process.env.BASH || 'bash',
    [path.join(HERE, 'run-smoke.sh'), liveTestNode]);
  await runCommand('live Rune tests', process.env.BASH || 'bash',
    [path.join(HERE, 'run-rune-test.sh'), liveTestNode]);
  await runCommand('live exchange tests', process.env.BASH || 'bash',
    [path.join(HERE, 'run-marketplace-test.sh'), liveTestNode]);
  // Only when the legacy players are actually part of this deployment.
  //
  // Without `--seed` nothing restores them, so the check would verify a body of
  // state this process will never hold. It is also the single slowest thing in
  // the preflight — one request that loads 168 players and reads every one back
  // on Luerl — so a test deployment was paying minutes to prove something about
  // a file it does not use. It still runs, and still gates, for any deploy that
  // does restore them.
  if (!seedData) {
    console.log('skipping recovered-player verification: a blank deploy restores none');
  } else {
    await runCommand('live recovered-player verification', process.execPath,
      [path.join(HERE, 'verify-legacy.mjs'), liveTestNode]);
  }
  await buildApp();
}
if (preflightOnly) {
  rule('done (--preflight-only; no processes created)');
  process.exit(0);
}

// The no-write paths above never need to parse private wallet material.
jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));
owner = jwkToAddress(jwk);

// -- the game -----------------------------------------------------------------

console.log(`node   ${NODE}`);
console.log(`owner  ${owner}`);
console.log(`from   ${from ?? (seedData ? '(fresh — legacy restore only)' : '(nothing — blank)')}`);

rule('2/8  the game process');
const gameArgs = [];
if (from) gameArgs.push('--migrate-from', from);
// A deployment starts empty on purpose, and says so out loud either way.
//
// Blank is the default: create nothing but the process, let the 50 burners be
// seeded into it if `--with-bots` asks, and leave `legacy-players.json`
// untouched on disk as the thing it is — the origin, restored ONCE when the
// game actually launches, onto a process that is not a test.
//
// `--seed` is that launch. It restores the 168 recovered legacynet players and
// unlocks the paid list; `--fresh` is the same minus the chained migration.
// Both are passed explicitly rather than left to `deploy.mjs`'s own defaults,
// so the intent of this run is visible in the child's argv.
if (seedData) gameArgs.push('--seed-legacy', '--paid-list');
else gameArgs.push('--no-seed-legacy', '--no-paid');
// Moving between nodes: the old process must be read from ITS node, not the one
// being deployed to. `deploy.mjs` infers this from the previous
// `live-process.txt` pairing, which is right for the ordinary case — but a
// half-finished deploy can have already claimed that file, so it is passable.
const migrateNode = opt('--migrate-node', null);
if (migrateNode) gameArgs.push('--migrate-node', migrateNode);
if (flag('--no-env')) gameArgs.push('--no-env');
let game;
// `--resume` may only pick up a process that was born the way this run asks
// for. A blank run must never adopt a process that was migrated or restored
// into, and a `--seed` run must never call a blank process seeded — so the
// previous deployment's own record decides, and a record that predates the
// `seeded` field decides nothing.
const priorState = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, 'deployment-state.json'), 'utf8'));
  } catch { return null; }
})();
let reuseGame = resume && isId(live[0]) && live[1] === NODE
  && priorState?.processes?.game === live[0]
  && typeof priorState?.seeded === 'boolean'
  && priorState.seeded === seedData;
if (resume && !reuseGame && isId(live[0]) && live[1] === NODE) {
  console.log(`resume: ${live[0]} was not recorded as a ${seedData ? 'seeded' : 'blank'} `
    + 'deployment; deploying a new game process');
}
if (reuseGame) {
  // Public access is process policy, not frontend decoration. Never reuse a
  // process compiled in the opposite mode just because --resume was supplied.
  const current = await readKey(live[0], 'access', { attempts: 3, delayMs: 500 })
    .then((body) => JSON.parse(body))
    .catch(() => ({ publicAccess: false }));
  reuseGame = (current.publicAccess === true) === publicAccess;
  if (!reuseGame) console.log('resume: access mode changed; deploying a new game process');
}
if (reuseGame) {
  game = live[0];
  console.log(`resume: reusing game ${game}`);
} else {
  // The smoke test plays as the OWNER, which mutates the owner's own account
  // and adds minutes. Skipped by default here; SKIP_SMOKE=0 turns it back on.
  await run('deploy.mjs', gameArgs, {
    SKIP_SMOKE: process.env.SKIP_SMOKE ?? '1',
    PUBLIC_ACCESS: publicAccess ? '1' : '0',
  });
  [game] = readLive();
  if (!game || game === from) {
    throw new Error(`deploy.mjs did not record a new process (live-process.txt says ${game})`);
  }
}

// Read the id back from the file the child just wrote, NOT from the value this
// script captured at startup — the whole point of doing this in sequence.
console.log(`\ngame   ${game}`);
const users = await readKey(game, 'users');
console.log(`       ${users} players restored`);
const access = JSON.parse(await readKey(game, 'access'));
if ((access.publicAccess === true) !== publicAccess) {
  throw new Error(`game access is ${access.publicAccess === true ? 'free' : 'closed'}, `
    + `expected ${publicAccess ? 'free' : 'closed'}`);
}
console.log(`       sign-up ${publicAccess ? 'FREE' : 'PAID (Eternal Pass)'}`);

if (withBots) {
  if (publicAccess) {
    console.log(`       ${botRoster.expected} test wallets ready (free mode admits them on first signed action)`);
  } else {
    console.log(`       granting access to ${botRoster.expected} test wallets`);
    await run('burners.mjs', ['unlock', String(botRoster.expected)], { GAME_PROCESS: game });
  }
  console.log('       funding test-only Rune/Scroll minimums for economic play');
  await sendAndSettle(game, {
    action: 'Admin.Economy.FundTestBots',
    tags: { Action: 'Admin.Economy.FundTestBots' },
    data: JSON.stringify({ addresses: botRoster.addresses, rune: 25, scroll: 5 }),
  }, 'test-bot funding');
  // The handler has run, so the published record is the funded one.
  const fundedSample = JSON.parse(await readKey(game, `player-${botRoster.addresses[0]}`));
  if (Number(fundedSample?.inventory?.rune ?? 0) < 25
      || Number(fundedSample?.inventory?.scroll ?? 0) < 5) {
    throw new Error('test-bot economy funding did not publish the configured minimums');
  }
}

if (flag('--game-only')) {
  rule('done (--game-only)');
  console.log(`GAME  ${game}\nNODE  ${NODE}`);
  process.exit(0);
}

// -- the token ----------------------------------------------------------------

rule('3/8  the Rune token');
const runeFile = path.join(ROOT, 'rune-process.txt');
const priorRune = fs.existsSync(runeFile)
  ? fs.readFileSync(runeFile, 'utf8').trim().split(/\r?\n/)
  : [];
let token;
if (resume && isId(priorRune[0]) && priorRune[1] === NODE) {
  token = priorRune[0];
  console.log(`resume: reusing Rune ${token}`);
} else {
  await run('deploy-rune.mjs', ['--no-wire'], { GAME_PROCESS: game });
  [token] = fs.readFileSync(runeFile, 'utf8').trim().split(/\r?\n/);
}
console.log(`\ntoken  ${token}`);

// -- wiring -------------------------------------------------------------------

rule('4/8  wiring the game and Rune together');

console.log('naming the game as the only minter');
await sendAndSettle(token, {
  action: 'Admin.SetMinter',
  tags: { Action: 'Admin.SetMinter', Minter: game },
}, 'Admin.SetMinter');
const minter = await readKey(token, 'minter');
if (minter !== game) throw new Error(`token minter is "${minter}", expected ${game}`);
console.log(`  token.minter    = ${minter}`);

console.log('telling the game where the token is');
await sendAndSettle(game, {
  action: 'Admin.SetRuneToken',
  tags: { Action: 'Admin.SetRuneToken', RuneToken: token },
}, 'Admin.SetRuneToken');
const wired = await readKey(game, 'runetoken');
if (wired !== token) throw new Error(`game runetoken is "${wired}", expected ${token}`);
console.log(`  game.runetoken  = ${wired}`);

// -- Rune quote token and AMM -------------------------------------------------

rule('5/8  quote token and Rune AMM');
const marketplaceStateFile = path.join(HERE, 'marketplace-state.json');
let amm = '';
let quote = '';
let marketState = null;

if (flag('--no-market')) {
  console.log('skipped by --no-market');
} else {
  if (resume && fs.existsSync(marketplaceStateFile)) {
    const candidate = JSON.parse(fs.readFileSync(marketplaceStateFile, 'utf8'));
    if (candidate.game === game && candidate.rune === token && candidate.node === NODE
        && isId(candidate.amm) && isId(candidate.quote)) {
      marketState = candidate;
      console.log(`resume: reusing AMM    ${candidate.amm}`);
      console.log(`resume: reusing quote  ${candidate.quote}`);
    }
  }

  if (!marketState) {
    const marketplaceArgs = flag('--no-env') ? ['--no-env'] : [];
    await run('deploy-marketplace.mjs', marketplaceArgs, {
      GAME_PROCESS: game,
      RUNE_TOKEN: token,
      ...(customQuote ? { QUOTE_TOKEN: customQuote } : {}),
      QUOTE_TICKER: quoteTicker,
      QUOTE_DENOMINATION: String(quoteDenomination),
      FEE_BPS: String(feeBps),
    });
    marketState = JSON.parse(fs.readFileSync(marketplaceStateFile, 'utf8'));
  }

  ({ amm, quote } = marketState);
  if (marketState.game !== game || marketState.rune !== token || marketState.node !== NODE) {
    throw new Error('marketplace deploy recorded a different game, Rune token or node');
  }
}

// -- the hunt fleet -----------------------------------------------------------
//
// Hunting is a fleet of its own, spawned fresh alongside the game and wired
// both ways: each worker is compiled knowing the game process, and the game is
// told the whole roster in one `Admin.SetHuntProcess`.
//
// It belongs in this script rather than in an operator's shell history. Every
// deployment before this one landed with hunting unconfigured, so `Hunt.Begin`
// answered "Hunting is not configured yet" on a brand new process and the whole
// feature was dark until somebody remembered to run `deploy:hunt` by hand.
// Fresh workers per deploy is the same rule the battle fleet follows: a worker
// is compiled against one game id and cannot be pointed at another.

rule('6/8  the hunt fleet');
if (flag('--no-hunt')) {
  console.log('skipped by --no-hunt');
} else {
  const huntArgs = flag('--no-env') ? ['--no-env'] : [];
  await run('deploy-hunt.mjs', huntArgs, {
    HUNT_GAME_PROCESS: game,
    HUNT_GAME_NODE: NODE,
    HUNT_NODE: opt('--hunt-node', process.env.HUNT_NODE || NODE),
    HUNT_FLEET_SIZE: opt('--hunt-size', process.env.HUNT_FLEET_SIZE || '3'),
  });
  // Read it back from the GAME, not from the deployer's own report: the point
  // of a wiring step is that both ends agree, and only the game can say what it
  // will actually route to.
  const huntConfig = JSON.parse(await readKey(game, 'huntconfig'));
  if (huntConfig.enabled !== true || !isId(huntConfig.processId)) {
    throw new Error(`game published huntconfig ${JSON.stringify(huntConfig).slice(0, 120)}`);
  }
  const huntWorkers = Array.isArray(huntConfig.workers) ? huntConfig.workers : [];
  console.log(`  hunt.enabled    = ${huntConfig.enabled}`);
  console.log(`  hunt.workers    = ${huntWorkers.length}`);
  console.log(`  hunt.lead       = ${huntConfig.processId}`);
}

// -- verification -------------------------------------------------------------

rule('7/8  checking every process relationship');

const supply = await readKey(token, 'totalsupply');
console.log(`  supply          = ${supply}  ${supply === '0' ? '(nothing pre-mined)' : '!! expected 0'}`);
const info = JSON.parse(await readKey(token, 'tokeninfo'));
console.log(`  ticker          = ${info.Ticker}`);
console.log(`  denomination    = ${info.Denomination}`);
if (!String(info.Ticker).startsWith('TEST-')) {
  console.log('  ! not TEST-prefixed — see CLAUDE.md before this reaches a wallet');
}

if (!flag('--no-market')) {
  // The companion market is INSIDE the game now, so there is no market process
  // to interrogate — `deploy-marketplace.mjs` stopped spawning `marketplace.lua`
  // when monsters stopped being one-unit `token@1.0` assets for it to index.
  // What is left out here is the exchange: Rune and the quote token have real
  // holders, so they stay their own processes with an AMM between them.
  //
  // Verify the market by asking the GAME for it, which is now where it lives.
  const marketStats = JSON.parse(await readKey(game, 'marketstats'));
  if (!Number.isFinite(Number(marketStats.listings))) {
    throw new Error(`game published no usable marketstats: ${JSON.stringify(marketStats).slice(0, 120)}`);
  }
  console.log(`  market.listings = ${marketStats.listings} (in-game, not a separate process)`);

  const pool = JSON.parse(await readKey(amm, 'amm'));
  if (!pool.configured || pool.baseToken !== token || pool.quoteToken !== quote) {
    throw new Error('AMM pair does not match the deployed Rune and quote processes');
  }
  const expectedFee = resume && marketState?.feeBps != null ? marketState.feeBps : feeBps;
  if (String(pool.feeBps) !== String(expectedFee)) {
    throw new Error(`AMM fee is ${pool.feeBps}, expected ${expectedFee}`);
  }
  const quoteInfo = JSON.parse(await readKey(quote, 'tokeninfo'));
  if (quoteInfo.Ticker !== pool.quoteTicker
      || String(quoteInfo.Denomination) !== String(pool.quoteDenomination)) {
    throw new Error('quote token metadata does not match the AMM configuration');
  }
  console.log(`  AMM.base        = ${pool.baseTicker} (${pool.baseToken})`);
  console.log(`  AMM.quote       = ${pool.quoteTicker} (${pool.quoteToken})`);
  console.log(`  AMM.fee         = ${pool.feeBps} bps`);
}

// IDs are now baked into the source defaults and local env by the child
// deployers. Build once more so dist contains this exact process graph.
rule('8/8  final app build');

// ...except on --resume, where `deploy.mjs` never ran and therefore never
// repointed anything. The exchange ids WERE rewritten (that deployer did run), so
// the result is the worst shape available: an app whose marketplace points at
// the new graph and whose game points at the process this deploy replaced.
// That builds cleanly, deploys cleanly, and reads to a player as "everybody
// lost their account". Refuse to build it.
if (!flag('--no-env')) {
  const baked = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'hyperbeam.ts'), 'utf8');
  const match = baked.match(/env\.VITE_GAME_PROCESS \|\| '([A-Za-z0-9_-]{43})'/);
  if (!match) {
    throw new Error('could not read the baked game default out of src/lib/hyperbeam.ts');
  }
  if (match[1] !== game) {
    throw new Error(`src/lib/hyperbeam.ts still points at ${match[1]}, but this deploy is ${game}. `
      + 'A resumed deploy does not repoint the app (deploy.mjs never ran). Set '
      + `VITE_GAME_PROCESS=${game} in src/lib/hyperbeam.ts, .env.example and .env.local, `
      + 'then re-run.');
  }
}

await buildApp();

const deployment = {
  version: 1,
  deployedAt: new Date().toISOString(),
  node: NODE,
  owner,
  processes: { game, rune: token, amm, quote },
  wiring: {
    runeMinter: minter,
    gameRuneToken: wired,
    ammPair: amm ? [token, quote] : [],
  },
  build: 'passed',
  publicAccess,
  // What this process was given at birth, so `--resume` can tell whether the
  // recorded game process is the one this run is asking for.
  seeded: seedData,
  seededFrom: from,
  testBots: {
    enabled: withBots,
    walletCount: withBots ? botRoster.expected : 0,
    access: withBots ? (publicAccess ? 'public' : 'allow-listed') : null,
  },
};
fs.writeFileSync(path.join(HERE, 'deployment-state.json'), `${JSON.stringify(deployment, null, 2)}\n`);

if (flag('--site')) {
  console.log('\nuploading the linked build to Arweave (ArNS remains unchanged)');
  await run('deploy-site.mjs', [], {
    // deploy-site.mjs accepts the JWK already held by this redeploy process.
    // CI supplies the same key as base64-encoded JSON.
    DEPLOY_KEY: process.env.DEPLOY_KEY || JSON.stringify(jwk),
  });
}

console.log(`\nGAME   ${game}`);
console.log(`TOKEN  ${token}`);
if (amm) console.log(`AMM    ${amm}`);
if (quote) console.log(`QUOTE  ${quote}`);
console.log(`NODE   ${NODE}`);
console.log(`FREE   ${publicAccess ? 'ON' : 'OFF'}`);
if (withBots) console.log(`BOTS   ${botRoster.expected} ready`);
console.log(`
BRIDGE ready. Verify supply moved with:`);
console.log(`  curl "${NODE}/${token}~process@1.0/now/totalsupply"`);
