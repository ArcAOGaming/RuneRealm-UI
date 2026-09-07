/**
 * verify-battle-fleet.mjs — put one real arena battle through a fleet worker.
 *
 *   HB_WALLET=key.json node backend/native/verify-battle-fleet.mjs
 *   ... --wallet burner-04 --rounds 40
 *
 * WHY THIS EXISTS
 *
 * The battle fleet has been written, unit-tested and spawned for a while, and
 * until today the game published `battlefleet {"enabled":false,"workers":[]}` —
 * so every arena battle ran in the monolith and no fight had ever crossed the
 * boundary on a live node. Sealing a manifest turns that path on for every
 * player at once. This drives it once, on purpose, first.
 *
 * There are three separate claims to check and they fail differently:
 *
 *   1. the authority ASSIGNS a worker — `Battle.Start` comes back with a route
 *      naming one of the sealed workers, rather than a monolith battle;
 *   2. the worker RUNS the fight — rounds are signed straight at the worker and
 *      it publishes the battle;
 *   3. the settlement COMES BACK — the exactly-once handshake reaches the game
 *      and the account's own win/loss counters move.
 *
 * (3) is the one worth the script. It is four of the six hops, it runs after
 * the player is already done watching, and a break there looks exactly like
 * nothing at all: the battle ends on screen and the ledger never hears. That is
 * the same shape as the hunt settlement bug — see verify-hunt-settlement.mjs —
 * and the same reason an offline suite would not have found it.
 *
 * And for a while this script checked only the FIRST of those four hops. It
 * declared PASS the moment the account's win counter moved, which is precisely
 * where the 2026-09-08 production stall began: the reward landed, and the
 * `Fleet.Settlement.Ack` -> `Battle.Fleet.FinalAcked` -> `Fleet.FinalAcked.Release`
 * chain behind it was never delivered on a single battle the live fleet ever
 * ran. Unacknowledged finals are never pruned and admission stops at
 * `pendingLimit`, so each worker was on course to refuse every new battle after
 * 100 fights — invisibly, with this script still printing PASS.
 *
 * So step 4 below is a gate now: the authority's tombstone must reach
 * `deliveryConfirmed`, and the worker must drain its pending finals. See
 * `battle-fleet/delivery-health.mjs` for what the numbers mean and how a stall
 * is repaired.
 *
 * Burner, never the owner wallet: entering the arena spends Rune and swearing a
 * faction is once per account forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { installWalletShim, jwkToAddress } from './ans104.mjs';
import { sendMessage } from './hbclient.mjs';
import { buildSwarmClient } from './swarm/build-client.mjs';
import { listBurners } from './burners.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';
import {
  decodePublished, deliveryHealth, finalConfirmed, recoveryHint,
} from './battle-fleet/delivery-health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }), { requireBattleFleet: true });
const { game: pid, node } = graph;

const ownerJwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

const wanted = flag('wallet', 'burner-03');
const burner = listBurners().find((entry) => entry.name === wanted);
if (!burner) throw new Error(`no burner named ${wanted}; run \`npm run swarm:wallets\``);
const player = await jwkToAddress(JSON.parse(fs.readFileSync(burner.file, 'utf8')));
const maxRounds = Math.max(1, Number(flag('rounds', '60')));

console.log(`game    ${pid}`);
console.log(`node    ${node}`);
console.log(`player  ${player} (${wanted})\n`);

const admin = (action, tags, data) => sendMessage({
  node, jwk: ownerJwk, process: pid, action, tags, ...(data ? { data } : {}),
});

installWalletShim(JSON.parse(fs.readFileSync(burner.file, 'utf8')));
const { url } = await buildSwarmClient({
  root: ROOT, graph, outDir: path.join(ROOT, '.verify', 'battle'),
});
const api = await import(`${url}?run=${Date.now()}`);

const step = (name) => process.stdout.write(`${name.padEnd(28)}`);
const done = (text) => console.log(text);

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

// -- is the fleet even on? ----------------------------------------------------

/**
 * Read a published key. An absent key is answered by this node with its own
 * HTML landing page AT STATUS 200, so `r.ok` proves nothing — `decodePublished`
 * is the only thing that separates "no such key" from a real value.
 */
const published = async (process_, key) => decodePublished(
  await fetch(`${node}/${process_}~process@1.0/now/${key}`, {
    headers: { accept: 'text/plain' },
  }).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
);

step('fleet config');
const fleet = await published(pid, 'battlefleet');
if (!fleet?.enabled) throw new Error('the game publishes no enabled battle fleet; nothing to verify');
const sealed = new Set((fleet.workers ?? []).map((w) => w.workerProcessId));
done(`${sealed.size} worker(s), enabled`);

// -- stand the account up -----------------------------------------------------

step('account');
let me = await api.readPlayer(player).catch(() => null);
if (!me?.faction) {
  await api.joinFaction('Sky Nomads');
  me = await settle((record) => !!record.faction, 'the faction to land');
}
done(`${me.faction}, companion ${me.monster?.id ?? '(none)'}`);

if (me.hunt) {
  step('clear hunt route');
  await api.huntEnd(me.hunt).catch(() => {});
  me = await settle((record) => !record.hunt, 'the hunt route to release');
  done('released');
}

// Entering the arena costs one Rune for four battles, and 25 each of energy and
// happiness. Grant the Rune and top the companion up so the entry cannot be
// refused for a reason that has nothing to do with the fleet.
step('arena entry cost');
await admin('Admin.Grant', { PlayerId: player, Item: 'rune', Amount: '5' });
await admin('Admin.SetStats', { PlayerId: player }, JSON.stringify({
  level: 12, attack: 90, defense: 60, speed: 60, health: 90,
  energy: 100, happiness: 100, status: { type: 'Home' },
}));
me = await settle((record) => (record.inventory?.rune ?? 0) >= 1
  && (record.monster?.energy ?? 0) >= 25 && (record.monster?.happiness ?? 0) >= 25,
'the Rune and the top-up to land');
done(`${me.inventory.rune} Rune, energy ${me.monster.energy}`);

const winsBefore = me.wins ?? 0;
const lossesBefore = me.losses ?? 0;

if ((me.battlesRemaining ?? 0) < 1) {
  step('battle.begin');
  await api.enterArena();
  me = await settle((record) => (record.battlesRemaining ?? 0) > 0, 'the arena entry');
  done(`${me.battlesRemaining} battles`);
}

// -- 1. the authority assigns a worker ---------------------------------------

step('battle.start');
let state = await api.startBotBattle(1);
const route = state.battleFleet;
if (!route) throw new Error('Battle.Start produced no fleet route — this ran in the monolith');
if (!sealed.has(route.workerProcessId)) {
  throw new Error(`assigned worker ${route.workerProcessId} is not in the sealed manifest`);
}
if (!state.battle) throw new Error('the worker never published the battle');
done(`worker ${route.workerProcessId.slice(0, 10)}… battle ${route.battleId}`);

// -- 2. the worker runs the fight --------------------------------------------

step('rounds at the worker');
let rounds = 0;
while (state.battle && state.battle.status !== 'ended' && rounds < maxRounds) {
  rounds += 1;
  const moves = state.battle.challenger.moves ?? {};
  const move = Object.keys(moves).find((name) => (moves[name].count ?? 0) > 0) ?? 'struggle';
  state = await api.attack(route.battleId, move, state.battle.round);
}
if (state.battle?.status !== 'ended') throw new Error(`battle did not end in ${rounds} rounds`);
const iWon = state.battle.challenger.healthPoints > 0;
done(`${rounds} rounds, ${iWon ? 'won' : 'lost'}`);

// -- 3. the settlement comes back --------------------------------------------
//
// The part that is invisible when it breaks. The fight is over on the worker
// and on screen either way; this asks the AUTHORITY whether it heard.

step('settlement reaches game');
const after = await settle(
  (record) => (record.wins ?? 0) > winsBefore || (record.losses ?? 0) > lossesBefore,
  'the fleet settlement to reach the game ledger',
  120_000,
);
done(`wins ${winsBefore}→${after.wins}, losses ${lossesBefore}→${after.losses}`);

step('route released');
const clear = await settle((record) => !record.activeBattleId, 'the battle lock to clear', 120_000);
done(`battlesRemaining ${clear.battlesRemaining}`);

// -- 4. the confirmation handshake closes ------------------------------------
//
// The three hops after the reward. The player is gone by now and nothing on
// screen changes either way, which is why this was missed: an unacknowledged
// final is retained on the worker FOREVER and counts against `pendingLimit`.
// Nothing else in the repo reads these numbers.

async function pollConfirmed(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let ops = null;
  while (Date.now() < deadline) {
    ops = await published(pid, 'battlefleetops');
    if (finalConfirmed(ops, route.reservationId).confirmed) return { ops, confirmed: true };
    await new Promise((r) => { setTimeout(r, 2000); });
  }
  return { ops, confirmed: false };
}

step('final acknowledged');
const { ops, confirmed } = await pollConfirmed();
if (!ops) throw new Error('the game publishes no `battlefleetops`; the authority ledger is unreadable');
if (!confirmed) {
  const seen = finalConfirmed(ops, route.reservationId);
  throw new Error(
    `reservation ${route.reservationId} settled but its worker receipt never came back `
    + `(found=${seen.found}, deliveryConfirmed=${seen.confirmed}). The `
    + 'Fleet.Settlement.Ack -> Battle.Fleet.FinalAcked -> Fleet.FinalAcked.Release chain '
    + 'was not delivered. Push the slot that produced the stuck message: '
    + `GET ${node}/<pid>~process@1.0/push&slot=<slot>`,
  );
}
done(`${route.reservationId} deliveryConfirmed`);

// -- 5. no worker is walking into its admission wall -------------------------

step('fleet delivery health');
const statuses = (await Promise.all(
  (fleet.workers ?? []).map((w) => published(w.workerProcessId, 'fleetstatus')),
)).filter(Boolean);
if (statuses.length !== (fleet.workers ?? []).length) {
  throw new Error('at least one sealed worker did not answer `fleetstatus`');
}
const health = deliveryHealth({ ops, workers: statuses });
for (const w of health.workers) {
  console.log(`\n  ${w.workerId.padEnd(18)} pendingFinals ${String(w.pendingFinals).padStart(3)}`
    + ` / ${w.pendingLimit}   headroom ${w.headroom}   accepting ${w.accepting}`);
}
if (health.verdict !== 'ok') {
  console.log(`\n  ${health.unconfirmed.length} unconfirmed final(s):`,
    health.unconfirmed.map((f) => `${f.reservationId}:${f.kind}`).join(', ') || '(none)');
  console.log('  recovery:', JSON.stringify(recoveryHint(health), null, 2));
}
if (health.verdict === 'jammed') {
  throw new Error(`fleet workers are at their admission wall: ${health.jammed.join(', ')}`);
}
if (health.verdict !== 'ok') {
  throw new Error(
    `the fleet has ${health.unconfirmed.length} terminal(s) no worker has confirmed. `
    + 'They are never pruned and each one permanently costs a pending slot.',
  );
}
done('all terminals confirmed, every worker drained');

console.log('\nPASS — the authority assigned a sealed worker, the worker ran the');
console.log('fight, the settlement reached the game ledger, and the confirmation');
console.log('handshake closed on both sides.');
