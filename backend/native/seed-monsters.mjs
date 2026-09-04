/**
 * seed-monsters.mjs — put collections in front of the test wallets.
 *
 *   HB_WALLET=key.json node backend/native/seed-monsters.mjs
 *   HB_WALLET=key.json node backend/native/seed-monsters.mjs --plan
 *   HB_WALLET=key.json node backend/native/seed-monsters.mjs --seed 20260829
 *
 * It walks each test wallet through the arrival every real player makes, in
 * that order: PLEDGE a faction, ADOPT a starter, then be GIFTED extras. The
 * first two are signed by the wallet itself because they are player actions;
 * only the gifts use the owner-only `Admin.CreateMonster`.
 *
 * The order is load-bearing. `Monster.Adopt` refuses when the account already
 * holds an active companion, so gifting into the roster first permanently locks
 * that wallet out of adopting — the one path every player walks exactly once
 * would then be untested across all fifty accounts.
 *
 * Two populations, deliberately different:
 *
 *   * The DEPLOYER gets two of each of the four faction creatures — eight in
 *     total, three of them active. It is the wallet a human sits in front of,
 *     so it wants a full roster AND a collection behind it: that is the only
 *     way to look at the switcher, the store/retrieve round trip and a listing
 *     without setting them up by hand first.
 *
 *   * EVERY burner pledges, adopts, and then receives up to four more, so each
 *     holds between one and five. The randomness is in how many, never in
 *     whether: fifty wallets exist so that fifty of them can act, and a wallet
 *     seeded with nothing cannot feed, quest, battle, list or sell.
 *
 * Deterministic: the same `--seed` produces the same grants, so a run can be
 * repeated and reasoned about. Free — every message here is HyperBEAM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jwkToAddress, sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { profileFor } from './swarm/profiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const FACTIONS = ['Inferno Blades', 'Aqua Guardians', 'Sky Nomads', 'Stone Titans'];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PLAN = has('plan');

/** Deterministic PRNG, so a seeded run is reproducible. */
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function liveProcess() {
  const file = path.join(ROOT, 'live-process.txt');
  const [fileId, fileNode] = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.trim())
    : [];
  const pid = process.env.GAME_PROCESS || fileId;
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(pid ?? ''))) {
    throw new Error('set GAME_PROCESS, or write live-process.txt');
  }
  return { pid, node: process.env.NODE_URL || fileNode || 'https://schedule.forward.computer' };
}

function wallet() {
  const file = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(file)) throw new Error(`no keyfile at ${file}; set HB_WALLET`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const jwk = wallet();
const owner = await jwkToAddress(jwk);
const { pid, node } = liveProcess();
const random = mulberry32(Number(flag('seed', 20260829)));

console.log(`process ${pid}\nnode    ${node}\nowner   ${owner}`);
console.log(PLAN ? '(plan only — nothing is sent)\n' : '');

/**
 * The grants, worked out before anything is sent.
 *
 * Building the whole plan first means `--plan` shows exactly what a real run
 * would do, rather than a description of it.
 */
const plan = [];

// The deployer: two of each faction, eight total. The first three are the
// roster — one fire, one water, one air, so the switcher shows three different
// elements rather than three of the same card.
const deployerRoster = ['Inferno Blades', 'Aqua Guardians', 'Sky Nomads'];
const deployerAll = [...FACTIONS, ...FACTIONS];
{
  const remaining = [...deployerAll];
  for (const faction of deployerRoster) {
    remaining.splice(remaining.indexOf(faction), 1);
    plan.push({ address: owner, who: 'deployer', faction, into: 'roster' });
  }
  for (const faction of remaining) {
    plan.push({ address: owner, who: 'deployer', faction, into: 'collection' });
  }
}

// The burners, in the order a real player arrives ----------------------------
//
// PLEDGE, then ADOPT, then be GIFTED. That order is the product's, not a
// convenience, and doing it out of order does not merely look wrong — it
// changes the account:
//
//   * A gift lands before the wallet has a faction, so the account holds
//     companions while belonging to nobody. Nothing else in the game can
//     produce that, so nothing downstream is written to expect it.
//
//   * Worse, a gift into the ROSTER sets `p.monster`, and `Monster.Adopt`
//     refuses outright when that is set. The wallet can then never take its
//     own starter, so the pledge-and-adopt path — the one every real player
//     walks exactly once — goes untested on all fifty accounts.
//
// So each burner joins as itself, adopts as itself, and only then receives the
// extras. Both of the first two are signed by the BURNER, because they are
// player actions; only the gifts are owner actions.
const burners = listBurners();
const arrivals = [];
for (const burner of burners) {
  /*
   * The faction comes from `profiles.mjs`, NOT from the dice.
   *
   * It was drawn at random here, which put 32 of the 50 wallets in a different
   * faction from the one they are described as belonging to — and swearing is
   * irreversible ("You have already sworn to X"), so a seeded run could only be
   * undone by redeploying the process.
   *
   * Two things depend on the committed assignment. The swarm refuses to start
   * when a wallet's faction does not match its plan, so a randomly seeded
   * population blocks the harness outright. And the five PvP pairs are built
   * out of deliberate element matchups — Cinder's fire against Tide's water,
   * Gale's air against Granite's rock — which are the whole reason those ten
   * wallets exist; randomising them tests four factions fighting themselves.
   *
   * `profiles.mjs` is the committed description of these wallets. If a wallet
   * is not in it, there is nothing to be consistent with and the dice are fine.
   */
  // The draw happens either way so the random stream — and therefore how many
  // extras each wallet gets — does not shift depending on which wallets happen
  // to have a profile.
  const drawn = FACTIONS[Math.floor(random() * FACTIONS.length)];
  const profile = profileFor(burner.name);
  const faction = profile?.faction ?? drawn;
  arrivals.push({ burner, faction, planned: Boolean(profile) });

  // Up to four EXTRA companions on top of the adopted starter, so every wallet
  // ends up holding between one and five.
  const extras = Math.floor(random() * 5);
  for (let i = 0; i < extras; i += 1) {
    const gift = FACTIONS[Math.floor(random() * FACTIONS.length)];
    // Always the collection. A gift is something you have been given, not
    // something you are already raising — and the collection is the only place
    // a listing can be created from, which is what these wallets are for. The
    // roster cap gets exercised by `Monster.Retrieve` during a run instead.
    plan.push({ address: burner.address, who: burner.name, faction: gift, into: 'collection' });
  }
}

const byWallet = new Map();
for (const row of plan) {
  const seen = byWallet.get(row.who) ?? { roster: 0, collection: 0 };
  seen[row.into] += 1;
  byWallet.set(row.who, seen);
}
console.log(`${arrivals.length} wallets pledge and adopt, then ${plan.length} gifts\n`);

// Every wallet, not only the ones receiving a gift. Drawing this table from
// the gift list hid any wallet whose extras rolled zero — which is a perfectly
// ordinary outcome, and one where "this wallet is not in the output" would be
// indistinguishable from "this wallet was skipped".
const rows = [
  { who: 'deployer', faction: '(all four)', planned: true },
  ...arrivals.map((a) => ({ who: a.burner.name, faction: a.faction, planned: a.planned })),
];
for (const row of rows) {
  const counts = byWallet.get(row.who) ?? { roster: 0, collection: 0 };
  // Swearing is irreversible, so this has to show the faction each wallet is
  // about to be committed to, and where that came from.
  const source = row.planned ? '' : ' (no profile — drawn)';
  const holding = row.who === 'deployer'
    ? counts.roster + counts.collection
    : 1 + counts.collection;  // the adopted starter, plus the gifts
  console.log(`  ${row.who.padEnd(12)} roster ${counts.roster}  collection ${counts.collection}`
    + `  holds ${holding}  ${row.faction}${source}`);
}
const unplanned = arrivals.filter((a) => !a.planned);
if (unplanned.length) {
  console.log(`\n  ${unplanned.length} wallet(s) have no entry in profiles.mjs and were `
    + 'assigned a faction at random.');
}

// What the process already thinks -------------------------------------------
//
// Read before writing, because swearing cannot be taken back. If a wallet is
// already sworn to something other than its plan, seeding it again does not
// correct it — `Faction.Join` answers "You have already sworn to X" and the run
// reports a success it did not have. The population is then wrong for the life
// of the process, and the swarm refuses to start on it.
//
// That is not hypothetical: it is exactly what happened on the deployment
// before this one, where 32 of 50 wallets ended up in the wrong faction and the
// only fix was to redeploy.

/**
 * A published player record.
 *
 * Three outcomes, and keeping them apart is the whole point: the record
 * (an object), ABSENT (`null` — the process has no such account), and
 * UNREADABLE (`undefined` — the node did not answer).
 *
 * Collapsing the last two is not a cosmetic mistake. A first pass reported six
 * seeded wallets as "no record on the process" and failed the run, when the
 * node had simply answered 502 six times in a row — the accounts were fine.
 * Absent means the seeding did not work; unreadable means nothing at all, and
 * calling one the other either raises a false alarm or hides a real one.
 *
 * A node under load is ordinary here, so a 5xx is retried before being believed.
 */
async function readPlayer(address, { attempts = 2, timeoutMs = 45_000 } = {}) {
  let sawServerError = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(`${node}/${pid}~process@1.0/now/player-${address}`, {
        headers: { accept: 'text/plain' },
        // Short and few on purpose. A node that is answering takes well under a
        // second per key once warm; one that is not answering will not start
        // because this waited longer. Being patient here turned a wedged node
        // into a script that appeared to hang for twenty minutes instead of
        // saying "the node is not answering" in one.
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A key the process has never written.
      if (res.status === 404) return null;
      if (res.status >= 500) { sawServerError = true; }
      else if (res.ok) {
        const text = (await res.text()).trim();
        // The node serves its own HTML landing page at 200 for an absent key.
        if (!text || text === 'null' || text.startsWith('<')) return null;
        try { return JSON.parse(text); } catch { return null; }
      } else {
        return undefined;   // a 4xx that is not 404 will not improve
      }
    } catch {
      sawServerError = true;
    }
    await new Promise((r) => { setTimeout(r, 2_000 * (attempt + 1)); });
  }
  return sawServerError ? undefined : null;
}

/** Read them a few at a time. A cold key can take over a minute to compute. */
async function readAll(addresses, limit = 6) {
  const out = new Map();
  let next = 0;
  const worker = async () => {
    while (next < addresses.length) {
      const address = addresses[next++];
      out.set(address, await readPlayer(address));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, addresses.length) }, worker));
  return out;
}

console.log('\nreading the process before writing to it...');

// One cheap read first. If the process is not answering at all there is no
// point signing a hundred and fifty messages into it, and no point spending
// forty-five seconds per wallet discovering that fifty times over. This is the
// difference between "the node is not answering" in one line and a script that
// appears to hang for twenty minutes.
{
  const startedAt = Date.now();
  let alive = false;
  try {
    const res = await fetch(`${node}/${pid}~process@1.0/now/users`, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(45_000),
    });
    alive = res.ok || res.status === 404;
  } catch { alive = false; }
  if (!alive) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.error(`\n  the process did not answer in ${seconds}s. Nothing has been sent.`);
    console.error('  Check the node, then re-run:');
    console.error(`    curl -m 20 "${node}/${pid}~process@1.0/now/users"`);
    process.exit(1);
  }
}

const live = await readAll(arrivals.map((a) => a.burner.address));

const conflicts = [];
const locked = [];
const unreadable = [];
let alreadyCorrect = 0;
for (const arrival of arrivals) {
  const view = live.get(arrival.burner.address);
  if (view === undefined) { unreadable.push(arrival); continue; }
  if (view && view.unlocked === false) locked.push(arrival);
  if (!view?.faction) continue;
  if (view.faction === arrival.faction) alreadyCorrect += 1;
  else conflicts.push({ arrival, found: view.faction });
}

if (alreadyCorrect) {
  console.log(`  ${alreadyCorrect} wallet(s) are already sworn correctly and will be left alone`);
}
if (unreadable.length) {
  console.log(`  ${unreadable.length} wallet(s) could not be read; they will be attempted anyway`);
}
if (locked.length) {
  console.error(`\n  ${locked.length} wallet(s) are LOCKED on this process. Swearing will be`);
  console.error('  refused for every one of them. Run this first:');
  console.error('    HB_WALLET=<owner key> npm run swarm:unlock');
  if (!has('force')) process.exit(1);
}
if (conflicts.length) {
  console.error(`\n  ${conflicts.length} wallet(s) are ALREADY SWORN to a different faction:\n`);
  for (const { arrival, found } of conflicts.slice(0, 12)) {
    console.error(`    ${arrival.burner.name.padEnd(12)} plan ${arrival.faction.padEnd(16)} live ${found}`);
  }
  if (conflicts.length > 12) console.error(`    ... and ${conflicts.length - 12} more`);
  console.error('\n  Swearing is irreversible, so these cannot be corrected here.');

  // Skip them and seed the rest, rather than refusing the whole run.
  //
  // This used to exit(1) and tell the operator to redeploy. That is the right
  // advice for a process that is ABOUT to become the real one, and exactly the
  // wrong advice for a live process somebody is already using: it made a
  // handful of mis-sworn wallets — three, in the case that prompted this —
  // enough to block all fifty from being prepared, and turned "stress test what
  // we have" into "throw it away and start again".
  //
  // A mis-sworn wallet is not silently included: the swarm's own worker returns
  // `blocked.faction-plan` for it, so it sits out of the run and says so. The
  // PvP pairs are the part that genuinely needs its factions, and a pair whose
  // partner is excluded simply does not duel.
  //
  // `--strict` restores the refuse-everything behaviour, for preparing a fresh
  // deployment where a conflict means something is actually wrong.
  if (has('strict')) {
    console.error('\n  --strict: refusing to seed. Redeploy and seed the new process.');
    process.exit(1);
  }
  if (has('force')) {
    console.error('\n  --force: seeding them anyway, into the wrong factions.');
  } else {
    const excluded = new Set(conflicts.map(({ arrival }) => arrival.burner.name));
    for (let i = arrivals.length - 1; i >= 0; i -= 1) {
      if (excluded.has(arrivals[i].burner.name)) arrivals.splice(i, 1);
    }
    // The gift plan is built per wallet before this point, so an excluded
    // wallet still has rows in it. Drop them too, or the owner would hand
    // companions to accounts the run has just decided to leave alone.
    for (let i = plan.length - 1; i >= 0; i -= 1) {
      if (excluded.has(plan[i].who)) plan.splice(i, 1);
    }
    console.error(`\n  Skipping those ${conflicts.length} and seeding the remaining `
      + `${arrivals.length} (${plan.length} gifts). They will report `
      + 'blocked.faction-plan in a swarm run.');
    console.error('  --strict refuses instead; --force seeds them anyway.');
  }
}

if (PLAN) {
  console.log('\n(plan only — nothing was sent)');
  process.exit(0);
}

// Step one and two: each burner joins and adopts AS ITSELF ------------------
//
// Signed by the burner, not the owner, because these are the player's own
// actions and the process checks the signature. Doing them here rather than
// leaving them to the swarm means every wallet starts a run already past
// onboarding — with a faction, a starter it chose, and `adopted` recorded.
/**
 * Send a batch, a few at a time.
 *
 * Every message here is an independent round trip: sign, POST, wait for the
 * scheduler to answer with a slot. Sent one after another, a hundred and fifty
 * of them is a hundred and fifty serial round trips, and the wall time is
 * almost entirely spent waiting rather than working.
 *
 * The scheduler serialises the messages regardless, so overlapping the requests
 * does not change what the process sees or the order it ends up in — it only
 * stops each send waiting for the previous one's reply. Bounded, because fifty
 * at once is how you find out what a node does under a burst when you were
 * trying to find out something else.
 */
async function sendAll(rows, describe, build, limit = 5) {
  let sent = 0;
  let refused = 0;
  let next = 0;
  let maxSlot = -1;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        const receipt = await sendMessage({ node, process: pid, ...build(row) });
        // `hbclient` returns the slot as it came off the HTTP header, so it is
        // a STRING. `Number.isInteger('42')` is false, which silently left the
        // high-water mark at -1 and skipped the compute pull below entirely.
        const slot = Number(receipt && (receipt.slot ?? receipt.Slot));
        if (Number.isInteger(slot) && slot > maxSlot) maxSlot = slot;
        sent += 1;
        if (sent % 10 === 0) console.log(`  ${sent}/${rows.length}`);
      } catch (error) {
        refused += 1;
        console.error(`  ${describe(row)}: ${error.message.split('\n')[0]}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return { sent, refused, maxSlot };
}

console.log('swearing (which adopts)...');
// Already-sworn is not an error here: this is re-runnable, and a wallet that
// swore on an earlier pass should be left alone. The preflight above has
// already established that anyone already sworn is sworn CORRECTLY.
//
// ONE message each. Swearing adopts: the oath and the companion are the same
// turn, so there is no window in which a wallet belongs to a faction and holds
// nothing. Across wallets the order does not matter — each signs for itself.
const oaths = await sendAll(
  arrivals,
  (row) => row.burner.name,
  (row) => ({
    jwk: row.burner.jwk, action: 'Faction.Join', tags: { Faction: row.faction },
  }),
);
const scheduled = oaths.sent;
// SCHEDULED, not succeeded. `sendMessage` returns the slot the message landed
// in and nothing about what the handler decided — so a run in which all fifty
// oaths were refused would report fifty successes here. The count is printed
// as what it is, and the verification pass at the bottom is what says whether
// the population is right.
console.log(`  ${scheduled} oath(s) scheduled\n`);

console.log('granting...');
// After the oaths, never alongside them: a gift into the roster before the
// wallet has sworn would take the slot the starter needs. Within the batch the
// order is free — every grant names its own recipient.
const grants = await sendAll(
  plan,
  (row) => `${row.who} ${row.faction}`,
  (row) => ({
    jwk, action: 'Admin.CreateMonster',
    tags: { PlayerId: row.address, Faction: row.faction, Into: row.into },
  }),
);
const done = grants.sent;
const failed = grants.refused;
console.log(`\n${done} grant(s) scheduled, ${failed} could not be sent`);

// Did any of it actually happen? --------------------------------------------
//
// Everything above reports what was SENT. Nothing so far has read back a single
// account, and a scheduled message says nothing about what the handler decided:
// the run that put 32 wallets in the wrong faction printed "50 pledged, 50
// adopted" and was wrong about every one of them.
//
// So the run ends by asking the process what it holds, and the answer is the
// result. A seeding run that cannot verify itself is a seeding run that will be
// discovered to have failed by the swarm, an hour later, on a process that
// cannot be corrected.
// Pull compute to the LAST slot this run scheduled, before reading anything.
//
// Compute on HyperBEAM is pull-based: a scheduled message does not execute
// until somebody asks for a slot at or past it. `player-<address>` is written by
// every message that touches a wallet, so it answers INSTANTLY with whatever
// that wallet looked like BEFORE this run — and the verification below then
// reports a correctly seeded fleet as unseeded. That happened twice, and both
// times re-reading after the head caught up showed 50/50.
//
// Asking for the highest slot this run scheduled is what makes the node execute
// everything up to it. One request; the reply itself is not interesting.
const lastSlot = Math.max(oaths.maxSlot ?? -1, grants.maxSlot ?? -1);
if (lastSlot >= 0) {
  console.log(`\npulling compute to slot ${lastSlot}...`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = await fetch(
      `${node}/${pid}~process@1.0/compute&slot=${lastSlot}/results/output/data`,
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(45_000) },
    ).catch(() => null);
    if (res && res.ok) break;
    await new Promise((done) => setTimeout(done, 2_000));
  }
}

console.log('\nverifying...');
const after = await readAll(arrivals.map((a) => a.burner.address));

const problems = [];
const unchecked = [];
let correct = 0;
const holdings = [];
for (const arrival of arrivals) {
  const view = after.get(arrival.burner.address);
  const name = arrival.burner.name;
  // Unreadable is not a verdict. Say so separately rather than reporting a
  // wallet as unseeded because the node was busy.
  if (view === undefined) { unchecked.push(name); continue; }
  if (!view) { problems.push(`${name}: no record on the process`); continue; }
  if (view.faction !== arrival.faction) {
    problems.push(`${name}: sworn to ${view.faction ?? '(nothing)'}, planned ${arrival.faction}`);
    continue;
  }
  if (view.adopted !== true) {
    problems.push(`${name}: sworn but the oath is not recorded as spent`);
    continue;
  }
  const held = Object.keys(view.monsters ?? {}).length
    + Object.keys(view.collection ?? {}).length;
  if (held < 1) { problems.push(`${name}: sworn but holds nothing`); continue; }
  // The roster is where the starter goes and gifts go to the collection, so an
  // empty roster means the starter never arrived.
  if (Object.keys(view.monsters ?? {}).length < 1) {
    problems.push(`${name}: holds ${held} but none of them is active`);
    continue;
  }
  holdings.push(held);
  correct += 1;
}

const spread = holdings.reduce((counts, n) => {
  counts[n] = (counts[n] ?? 0) + 1;
  return counts;
}, {});
console.log(`  ${correct}/${arrivals.length} wallets sworn to plan and holding a companion`);
console.log('  holdings: ' + Object.keys(spread).sort((a, b) => a - b)
  .map((n) => `${spread[n]}x${n}`).join('  '));

if (unchecked.length) {
  console.log(`  ${unchecked.length} wallet(s) could not be read and were not checked: `
    + `${unchecked.slice(0, 8).join(', ')}${unchecked.length > 8 ? ', ...' : ''}`);
  console.log('  (a node error, not a finding — re-run to check them)');
}

if (problems.length) {
  console.error(`\n${problems.length} wallet(s) are not as planned:`);
  for (const line of problems.slice(0, 15)) console.error(`  ${line}`);
  if (problems.length > 15) console.error(`  ... and ${problems.length - 15} more`);
  console.error('\nThe swarm will refuse to run against this population.');
  process.exitCode = 1;
} else if (unchecked.length) {
  console.log(`\nEvery wallet that could be read is sworn to its plan. `
    + `${unchecked.length} went unchecked; re-run to confirm them.`);
} else {
  console.log('\nEvery wallet is sworn to its plan and holding what it should.');
  console.log('The fleet can fly: npm run swarm -- --live --cycles 10');
}
console.log(`\nread one back: ${node}/${pid}~process@1.0/now/player-${owner}`);
