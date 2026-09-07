/**
 * verify-hunt-settlement.mjs — drive one real capture and prove it settles.
 *
 *   HB_WALLET=key.json node backend/native/verify-hunt-settlement.mjs
 *   ... --wallet burner-03 --bid 2
 *
 * THE ONE ASSERTION THAT MATTERS
 *
 * A capture crosses two processes: the Hunt worker rolls it and hands the roll
 * to the game ledger, the ledger spends the Rune and grants the companion, and
 * its acknowledgement puts the worker back to `roaming`. On a live deployment
 * that last hop was refused for every capture ever made — the worker could not
 * read `run-id` off the tags, answered "Capture settlement not found", and left
 * the run in `settling` permanently with the Rune already spent. `Hunt.End`
 * refuses to leave while settling, so the account was stuck for good.
 *
 * Nothing in the offline suite caught it, because the suite sent `RunId` and
 * the game sends `run-id`. Only a real signed capture against a real worker
 * proves the round trip, so that is what this does: **it fails unless the run
 * comes back out of `settling` with a receipt on it.**
 *
 * It uses a burner, never the owner wallet. Swearing a faction is once per
 * account forever, and picking somebody's faction for them to run a test is not
 * a thing a test may do.
 *
 * The client is the SHIPPED client — `src/lib/game.ts` and `src/lib/hunt.ts`,
 * bundled for Node by the swarm's builder, with a real ANS-104 signer. No verb
 * is reimplemented here, so a pass means the path the browser takes works, not
 * that a parallel implementation of it does.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installWalletShim, jwkToAddress } from './ans104.mjs';
import { sendMessage } from './hbclient.mjs';
import { buildSwarmClient } from './swarm/build-client.mjs';
import { listBurners } from './burners.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }), { requireHunt: true });
const { game: pid, node } = graph;

const ownerFile = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const ownerJwk = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));

const wanted = flag('wallet', 'burner-01');
const burner = listBurners().find((entry) => entry.name === wanted);
if (!burner) throw new Error(`no burner named ${wanted}; run \`npm run swarm:wallets\``);
const burnerJwk = JSON.parse(fs.readFileSync(burner.file, 'utf8'));
const player = await jwkToAddress(burnerJwk);
const bid = Math.max(1, Math.min(3, Number(flag('bid', '1'))));

console.log(`game    ${pid}`);
console.log(`node    ${node}`);
console.log(`player  ${player} (${wanted})`);
console.log(`bid     ${bid} Rune\n`);

/** One owner-signed admin write. */
const admin = (action, tags, data) => sendMessage({
  node, jwk: ownerJwk, process: pid, action, tags, ...(data ? { data } : {}),
});

// -- the shipped client, with this burner's signature -------------------------

installWalletShim(burnerJwk);
const { url } = await buildSwarmClient({
  root: ROOT, graph, outDir: path.join(ROOT, '.verify', 'hunt'),
});
const api = await import(`${url}?run=${Date.now()}`);

const step = (name) => process.stdout.write(`${name.padEnd(28)}`);
const done = (text) => console.log(text);

/** Wait for the player record itself to catch up with an owner write. */
async function settle(predicate, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await api.readPlayer(player).catch(() => null);
    if (last && predicate(last)) return last;
    await new Promise((r) => { setTimeout(r, 1200); });
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Wait for the published run to leave a state.
 *
 * Reads, never writes: `hunt-run-<id>` is kept current by the worker's own
 * patch, so watching it costs the node nothing and cannot perturb what it is
 * measuring.
 */
async function until(route, predicate, { label, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await api.readHunt(route).catch(() => null);
    if (last && predicate(last)) return last;
    await new Promise((r) => { setTimeout(r, 1500); });
  }
  throw new Error(`timed out waiting for ${label}; last status ${last?.status ?? 'unreadable'}`);
}

// -- stand the account up -----------------------------------------------------

step('account');
let me = await api.readPlayer(player).catch(() => null);
if (!me?.faction) {
  await api.joinFaction('Inferno Blades');
  me = await api.readPlayer(player);
}
done(`${me.faction}, companion ${me.monster?.id ?? '(none)'}`);

// A previous run of this script may have left a route behind — a lost fight, or
// an interrupted one. `Hunt.Begin` refuses while one is open, so clear it first
// rather than reporting that as the failure.
if (me.hunt) {
  step('clear old route');
  await api.huntEnd(me.hunt).catch(() => {});
  me = await settle((record) => !record.hunt, 'the previous route to release');
  done('released');
}

step('offering + bid + ticket');
for (const item of ['fire_berry', 'water_berry', 'air_berry', 'rock_berry']) {
  await admin('Admin.Grant', { PlayerId: player, Item: item, Amount: '20' });
}
await admin('Admin.Grant', { PlayerId: player, Item: 'rune', Amount: '5' });
// A capture spends a Scroll as well as the Rune, and a settlement short of
// either is refused — which the worker then retries, so the run would sit in
// `settling` and this script would fail for a reason it is not testing.
await admin('Admin.Grant', { PlayerId: player, Item: 'scroll', Amount: '3' });
// `sendMessage` returns when the SCHEDULER accepts the item, which is before
// the assignment is visible to a `/now` read. Reading once here saw the berries
// and not the Rune granted a beat later, and then failed at the capture for a
// reason that had nothing to do with the capture.
me = await settle((record) => (record.inventory?.rune ?? 0) >= bid
  && (record.inventory?.scroll ?? 0) >= 1
  && (record.inventory?.fire_berry ?? 0) >= 5, 'the grants to land');
done(`${me.inventory.fire_berry} of each berry, ${me.inventory.rune} Rune, `
  + `${me.inventory.scroll} Scroll`);

// A level-0 starter loses to a level-0 wild about as often as it wins, and a
// lost fight exercises nothing this script is here to check. Stack it: the
// point is to reach a capture reliably, not to measure combat.
step('stack the hunter');
await admin('Admin.SetStats', { PlayerId: player }, JSON.stringify({
  level: 12, attack: 90, defense: 60, speed: 60, health: 90,
  energy: 100, happiness: 100,
}));
me = await settle((record) => (record.monster?.level ?? 0) >= 12, 'the stat patch to land');
done(`level ${me.monster.level}, attack ${me.monster.attack}`);

// -- open the run -------------------------------------------------------------

step('hunt.begin');
const opened = await api.beginHunt(me.monster.id);
const route = opened.hunt;
if (!route) throw new Error('Hunt.Begin returned no route');
done(`run ${route.runId} on ${route.processId.slice(0, 10)}…`);

step('worker opens');
await until(route, (run) => run.status === 'roaming', { label: 'the trail to open' });
done('roaming');

// -- find something and beat it ----------------------------------------------

step('hunt.search');
let run = await api.huntSearch(route);
if (run.status !== 'battle') throw new Error(`search did not produce a battle: ${run.status}`);
done(`${run.encounter.name} lvl ${run.encounter.level}`);

step('hunt.attack');
let rounds = 0;
while (run.battle && run.battle.status !== 'ended' && rounds < 60) {
  rounds += 1;
  const moves = run.battle.challenger.moves ?? {};
  const move = Object.keys(moves).find((name) => (moves[name].count ?? 0) > 0) ?? 'struggle';
  run = await api.huntAttack(route, move, run.battle.round);
}
if (run.status !== 'defeated') {
  // A loss is a legitimate outcome of a real fight and not a failure of the
  // thing under test. Say so plainly rather than reporting a broken settlement.
  console.log(`\nthe wild won after ${rounds} rounds (status ${run.status}).`);
  console.log('Nothing was captured, so the settlement path was not exercised.');
  console.log(`Re-run with a different burner: --wallet ${wanted === 'burner-01' ? 'burner-02' : 'burner-01'}`);
  await api.huntEnd(route).catch(() => {});
  process.exit(2);
}
done(`${rounds} rounds, defeated`);

// -- the capture, and the hop this whole script exists for --------------------

const runeBefore = (await api.readPlayer(player)).inventory.rune ?? 0;

step('hunt.capture');
const settling = await api.huntCapture(route, bid);
done(`status ${settling.status}`);

step('settlement lands');
const settled = await until(route, (r) => r.status !== 'settling', {
  label: 'the game acknowledgement to reach the worker',
});
if (!settled.lastCapture) {
  throw new Error(`run left settling as ${settled.status} but carries no receipt`);
}
const receipt = settled.lastCapture;
done(`${settled.status} — ${receipt.success ? 'BOUND' : 'broke'}, `
  + `rolled ${receipt.roll} against ${receipt.chance}%`);

// -- and the ledger agrees ----------------------------------------------------

step('ledger agrees');
const after = await api.readPlayer(player);
const spent = runeBefore - (after.inventory.rune ?? 0);
if (spent !== bid) throw new Error(`expected ${bid} Rune spent, saw ${spent}`);
const collection = Object.keys(after.collection ?? {}).length;
done(`${spent} Rune spent, ${collection} in collection`);

step('hunt.end');
await api.huntEnd(route);
const home = await api.readPlayer(player);
if (home.hunt) throw new Error('the route did not clear after Hunt.End');
done('route cleared, companion home');

console.log('\nPASS — a capture rolled on the worker, settled on the game ledger,');
console.log('and the acknowledgement came back. The run is not stuck.');
