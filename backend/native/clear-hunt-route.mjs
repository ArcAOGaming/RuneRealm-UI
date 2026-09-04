/**
 * clear-hunt-route.mjs — free a player stranded on a Hunt worker.
 *
 *   node backend/native/clear-hunt-route.mjs --address <addr>            # dry run
 *   node backend/native/clear-hunt-route.mjs --address <addr> --apply
 *
 * WHY THIS EXISTS
 *
 * A Hunt route is authority into one run on one worker, and only that worker
 * may hand it back — `Hunt.Released` is refused from anybody else, deliberately,
 * because otherwise a player could walk away from a capture roll that was going
 * against them. That is the right rule and it has one consequence: when a run
 * cannot reach a terminal state on its worker, nothing the player does will
 * ever clear `p.hunt`, and the account is stuck in a hunt forever.
 *
 * Which is exactly what a live process did. A capture settled on the game
 * ledger — the Rune was spent and the companion granted — and the worker
 * refused the acknowledgement because it could not read `run-id` off the tags
 * (see the note above `field` in hunt.lua). The run has been `settling` ever
 * since. `Hunt.End` refuses while settling, so there is no way out from the
 * worker's side, and replacing the fleet does not help: the new workers have
 * never heard of the run.
 *
 * `Admin.Load` is the only door. An exported row carries no `hunt` field at all
 * and `restoreMonster` thaws a `Hunt` status back to `Home`, so loading a
 * player's own current row is precisely "forget the route, unfreeze the
 * companion, change nothing else".
 *
 * WHAT MAKES THIS SAFE, AND WHAT WOULD NOT
 *
 * `Admin.Load` SETS inventory and REPLACES the roster and collection from the
 * row it is given. A stale row therefore rolls the account back, and an EMPTY
 * row destroys the holding — that is the failure `Admin.Load`'s own comments
 * are about. So this script never writes a row it did not just read from
 * `Admin.Export` (the migration door, which carries the whole holding — NOT
 * `Admin.Snapshot`, which is the console's flattened view), and it refuses to
 * load a row that carries no companions at all.
 *
 * It also touches exactly one player. `Admin.Load` merges per row and leaves
 * every address it was not given alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jwkToAddress, sendMessage } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const APPLY = argv.includes('--apply');

function liveProcess() {
  const file = path.join(ROOT, 'live-process.txt');
  const [fileId, fileNode] = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => line.trim())
    : [];
  const pid = process.env.GAME_PROCESS || fileId;
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(pid ?? ''))) {
    throw new Error('set GAME_PROCESS, or write live-process.txt');
  }
  return { pid, node: (process.env.NODE_URL || fileNode || '').replace(/\/$/, '') };
}

function wallet() {
  const file = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(file)) throw new Error(`no keyfile at ${file}; set HB_WALLET`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * A published key, with a plain GET.
 *
 * No `accept: application/json` — that makes the node answer with its own
 * envelope and the value arrives as a string inside it. An HTML body at 200 is
 * the node's landing page, which is what an absent key looks like on some
 * routes; it is "absent", never data.
 */
async function readKey(node, pid, key) {
  const res = await fetch(`${node}/${pid}~process@1.0/now/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${key}: ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || text === 'null' || text.startsWith('<')) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * The reply produced by ONE slot.
 *
 * Not `/now/results/output/data`: that is whatever the process computed last,
 * so a concurrent message answers for yours.
 */
async function readSlot(node, pid, slot, { attempts = 120, delayMs = 500 } = {}) {
  const url = `${node}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) {
      const text = (await res.text()).trim();
      if (text && !text.startsWith('<')) {
        try { return JSON.parse(text); } catch { return text; }
      }
    }
    await new Promise((r) => { setTimeout(r, delayMs); });
  }
  throw new Error(`slot ${slot} never computed`);
}

const address = flag('address', process.env.PLAYER_ADDRESS || '');
if (!/^[A-Za-z0-9_-]{43}$/.test(address)) {
  throw new Error('pass --address <43-char wallet address>');
}

const { pid, node } = liveProcess();
const jwk = wallet();
const owner = await jwkToAddress(jwk);

console.log(`process ${pid}`);
console.log(`node    ${node}`);
console.log(`owner   ${owner}`);
console.log(`player  ${address}`);
console.log(`mode    ${APPLY ? 'APPLY' : 'dry run (pass --apply to write)'}\n`);

// -- what is actually stuck ---------------------------------------------------

const before = await readKey(node, pid, `player-${address}`);
if (!before) throw new Error(`the process has no record for ${address}`);
if (!before.hunt) {
  console.log('This account has no Hunt route. Nothing to clear.');
  process.exit(0);
}

const route = before.hunt;
const frozen = Object.values(before.monsters ?? {})
  .filter((m) => m?.status?.type === 'Hunt')
  .map((m) => `${m.id} ${m.name}`);

console.log('hunt route:');
console.log(`  run       ${route.runId}`);
console.log(`  worker    ${route.processId}`);
console.log(`  status    ${route.status}`);
if (route.lastCapture) {
  const c = route.lastCapture;
  console.log(`  ledger    settled ${c.settlementId}: ${c.success ? 'BOUND' : 'broke'}`
    + `, rolled ${c.roll}/${c.chance}%, ${c.runesSpent} Rune spent`);
}
console.log(`  frozen    ${frozen.length ? frozen.join(', ') : 'none'}`);

// The worker's own view, so the report says which side is behind.
if (route.processId && route.node) {
  const run = await readKey(route.node.replace(/\/$/, ''), route.processId, `hunt-run-${route.runId}`)
    .catch(() => null);
  console.log(`  worker says ${run ? run.status : 'nothing published'}`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to export this row and load it back,');
  console.log('which drops the route and thaws the companion. Nothing else changes.');
  process.exit(0);
}

// -- export the row, then load it back ----------------------------------------

console.log('\nexporting…');
let row = null;
for (let offset = 0; offset < 1000 && !row; offset += 25) {
  const receipt = await sendMessage({
    node, jwk, process: pid, action: 'Admin.Export',
    tags: { Offset: String(offset), Limit: '25' },
  });
  const slot = Number(receipt?.slot ?? receipt?.headers?.slot);
  if (!Number.isFinite(slot)) throw new Error('Admin.Export was not scheduled');
  const page = await readSlot(node, pid, slot);
  if (page?.error) throw new Error(`Admin.Export: ${page.error}`);
  row = (page?.players ?? []).find((entry) => entry.address === address) ?? null;
  if (page?.done) break;
}
if (!row) throw new Error(`Admin.Export never returned a row for ${address}`);

// The guard that matters. `Admin.Load` REPLACES the holding from the row, and an
// empty holding is a real export shape — it is what `Admin.Unlock` mints for a
// wallet that never played. Loading one on top of a real player erases them.
const roster = Object.keys(row.monsters ?? {}).length;
const collection = Object.keys(row.collection ?? {}).length;
if (roster === 0 && collection === 0 && !row.monster) {
  throw new Error('refusing to load: the exported row carries no companions at all');
}
if (row.hunt) {
  throw new Error('refusing to load: this export carries a hunt route, which it never should');
}

console.log(`row     ${roster} roster, ${collection} collection, `
  + `${Object.keys(row.inventory ?? {}).length} item kinds, `
  + `${(row.lootboxes ?? []).length} loot boxes`);
console.log('loading…');

const receipt = await sendMessage({
  node, jwk, process: pid, action: 'Admin.Load',
  data: JSON.stringify({ players: [row] }),
});
const slot = Number(receipt?.slot ?? receipt?.headers?.slot);
const result = await readSlot(node, pid, slot);
if (result?.error) throw new Error(`Admin.Load: ${result.error}`);
console.log(`loaded  ${JSON.stringify(result)}`);

// -- confirm ------------------------------------------------------------------

let after = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  after = await readKey(node, pid, `player-${address}`);
  if (after && !after.hunt) break;
  await new Promise((r) => { setTimeout(r, 3000); });
}
if (!after) throw new Error('could not read the player record back');
if (after.hunt) throw new Error('the hunt route is still published; nothing was freed');

const stillFrozen = Object.values(after.monsters ?? {})
  .filter((m) => m?.status?.type === 'Hunt')
  .map((m) => m.id);
console.log('\ncleared: no hunt route');
console.log(`companions: ${Object.keys(after.monsters ?? {}).length} roster, `
  + `${Object.keys(after.collection ?? {}).length} collection`);
console.log(`still frozen: ${stillFrozen.length ? stillFrozen.join(', ') : 'none'}`);
console.log(`rune: ${after.inventory?.rune ?? 0}`);
