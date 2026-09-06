#!/usr/bin/env node
/**
 * slot-continuity.mjs — does the process's state survive a SLOT BOUNDARY?
 *
 * Every other suite in this repo drives `compute()` over and over inside ONE
 * Lua VM: `game_test.lua` on a live `~lua@5.3a`, `run-local-game-test.mjs` on
 * ao-loader, the hunt/economy/marketplace runners, `fuzz.mjs`. In all of them
 * `Players` is a Lua global that was never disturbed, because there is nothing
 * in a single request that could disturb it. **Nothing in the suite crosses a
 * slot boundary, so state that does not survive one cannot fail a test.**
 *
 * A real node crosses that boundary on every message, and it carries two things
 * forward by two different routes:
 *
 *   - the published map (`users`, `player-<address>`, `leaderboard`, ...) goes
 *     through the message cache;
 *   - the Luerl VM — every global the contract keeps its world in — goes
 *     through the message's `priv`, which is NOT cached.
 *
 * When a slot is computed off a path with no live worker behind it, `dev_lua`
 * re-enters `init`, runs the module from the top, and calls the handler with a
 * COMPLETE `base` and an EMPTY set of globals. Nothing errors. `users` still
 * says fifty, every `player-<address>` still holds its funded record, and
 * `Players` is empty — so the next wallet to act is minted from nothing, its
 * Rune and Gold are gone and its `joinedAt` is rewritten to now.
 *
 * That is what this checks, on a throwaway process, for free (no AR is spent:
 * a spawn and a scheduled message cost nothing on a HyperBEAM node).
 *
 * ## What it asserts, and why none of it needs the contract's help
 *
 * Only surviving STATE, read back through the published keys the game already
 * has. Nothing here is a counter added to observe a node bug.
 *
 *   1. A wallet funded at slot 1 still holds its Rune, its Scroll and its Gold
 *      after it joins a faction many slots later. A re-minted record holds
 *      none of them.
 *   2. It keeps the `joinedAt` it was minted with. This is the sharpest signal
 *      there is: an account's age cannot move, so a `joinedAt` that has become
 *      later is proof the record was created a second time.
 *   3. A wallet that has already sworn is REFUSED a second `Faction.Join`.
 *      A process that still knows its players says so; one that has forgotten
 *      them accepts the oath again and hands out another companion.
 *   4. `users` never falls below what was funded. Listed last on purpose: it is
 *      an incremental counter, it is the weakest of the four, and reading it
 *      alone is how an earlier run of this investigation fooled itself.
 *
 * ## Modes
 *
 *   --settle=head   (default) wait for `now/at-slot` to pass the slot, then
 *                   address it. This is what the deploy scripts now do.
 *   --settle=race   address `compute&slot=N` immediately after the POST, which
 *                   is what they used to do. This mode is expected to FAIL and
 *                   is how the regression is demonstrated:
 *
 *     node backend/native/slot-continuity.mjs --settle=race   -> fails
 *     node backend/native/slot-continuity.mjs                 -> passes
 *
 * Usage:
 *   node backend/native/slot-continuity.mjs [--settle=head|race] [--wallets=N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnProcess, sendMessage, jwkToAddress, awaitComputedSlot, transportNode,
} from './hbclient.mjs';
import { minifyLua } from './lua-minify.mjs';
import { gameModuleSources } from './game-bundle.mjs';
import { listBurners } from './burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const NODE = process.env.HB_NODE || process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SETTLE = argOf('settle', 'head');
const WALLETS = Math.max(2, Math.min(50, Number(argOf('wallets', '12')) || 12));
if (SETTLE !== 'head' && SETTLE !== 'race') {
  console.error('--settle must be `head` or `race`');
  process.exit(2);
}

if (!fs.existsSync(WALLET)) {
  console.error(`No keyfile at ${WALLET}. Set HB_WALLET=path/to/key.json`);
  process.exit(2);
}
const jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));

// Burners, never a real player's wallet. `.burners/` is gitignored and holds
// nothing; `node backend/native/burners.mjs make 12` creates more.
const burners = (await listBurners()).slice(0, WALLETS);
if (burners.length < 2) {
  console.error('Need at least two burner wallets: node backend/native/burners.mjs make 12');
  process.exit(2);
}
const addresses = burners.map((b) => b.address);

let passed = 0;
let failed = 0;
const ok = (label, cond, extra) => {
  if (cond) passed += 1; else failed += 1;
  const line = `${cond ? 'PASS' : 'FAIL'}  ${label}`;
  console.log(extra === undefined ? line : `${line}  <- ${extra}`);
};

const get = async (suffix) => {
  try {
    const res = await fetch(`${transportNode(NODE)}/${pid}~process@1.0/${suffix}`,
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    // An HTML body at status 200 is "key absent", everywhere. See CLAUDE.md.
    if (/^<!DOCTYPE html|^<html/i.test(body)) return null;
    return body;
  } catch { return null; }
};

const lua = minifyLua(gameModuleSources({}));
console.log(`node:    ${NODE}`);
console.log(`settle:  ${SETTLE}`);
console.log(`wallets: ${addresses.length}`);
console.log(`module:  ${Buffer.byteLength(lua)} B`);
const pid = await spawnProcess({
  node: NODE, jwk, lua, name: 'TEST-Rune Realm Slot Continuity',
});
console.log(`pid:     ${pid}\n`);

/** Send one message and settle it the way the mode says. Returns the slot. */
const drive = async (signer, tags, data) => {
  const sent = await sendMessage({ node: NODE, jwk: signer, process: pid, tags, data });
  const slot = Number(sent && (sent.slot ?? sent.Slot));
  if (!Number.isSafeInteger(slot)) throw new Error('no slot reported for ' + tags.Action);
  if (SETTLE === 'head') {
    await awaitComputedSlot({ node: NODE, process: pid, slot, attempts: 90, delayMs: 1_000 });
  }
  for (let i = 0; i < 90; i += 1) {
    const reply = await get(`compute&slot=${slot}/results/output/data`);
    if (reply) return { slot, reply };
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error(`slot ${slot} never returned a reply`);
};

const RUNE = 100;
const GOLD = 1000;
const FACTIONS = ['Inferno Blades', 'Stone Titans', 'Sky Nomads', 'Aqua Guardians'];

// Slot 1: fund every burner. This is the population the rest of the run is
// about, and it exists only in the Lua globals.
await drive(jwk, { Action: 'Admin.Economy.FundTestBots' },
  JSON.stringify({ addresses, rune: RUNE, scroll: 20, gold: GOLD }));

const funded = await get(`now/player-${addresses[1]}`);
const fundedRow = funded ? JSON.parse(funded) : null;
ok('the second wallet is funded before anything else happens',
   fundedRow && fundedRow.gold === GOLD && (fundedRow.inventory || {}).rune === RUNE,
   funded && funded.slice(0, 120));
const joinedAtBefore = fundedRow && fundedRow.joinedAt;

// The bootstrap admin messages the deploy sends next. Every one of these is
// classified with an EMPTY dirty set, so none of them republishes `users` —
// which is exactly why a state loss here stays invisible until somebody joins.
const bootstrap = [
  { Action: 'Admin.SetRuneToken', RuneToken: 'T'.padEnd(43, 'z') },
  { Action: 'Admin.SetHuntProcess', HuntProcess: 'H'.padEnd(43, 'z') },
  { Action: 'Admin.SetVault', Vault: 'V'.padEnd(43, 'z') },
];
for (const tags of bootstrap) await drive(jwk, tags);

// Then real players. A `Faction.Join` republishes `users`, so this is the first
// message whose published output can show the loss.
const joiners = burners.slice(0, Math.min(5, burners.length));
const counts = [];
for (let i = 0; i < joiners.length; i += 1) {
  await drive(joiners[i].jwk, { Action: 'Faction.Join', Faction: FACTIONS[i % 4] });
  // RAW text: `users` is published through `string.format("%d", ...)` and the
  // point of reading it as text is that a decode would turn it into a float.
  const users = await get('now/users');
  counts.push({ who: joiners[i].name, users });
  console.log(`  after ${joiners[i].name.padEnd(10)} users=${users}`);
}

console.log('');

// THE SHARPEST CHECK: a wallet that has already sworn must be REFUSED.
//
// A process that still knows its players answers "You have already joined a
// faction". One that lost them has no record to object with, so it accepts the
// oath, mints the account again and hands out a second companion -- which is
// what a night of "35 of 50 wallets are not as planned" actually was.
const repeat = await drive(joiners[0].jwk,
  { Action: 'Faction.Join', Faction: FACTIONS[1] });
let repeatError = null;
try { repeatError = JSON.parse(repeat.reply).error ?? null; } catch { repeatError = null; }
ok('a wallet that already swore is refused a second oath',
   typeof repeatError === 'string' && repeatError.length > 0,
   repeat.reply.slice(0, 140));

// A wallet that was funded at slot 1 and joined many slots later must still be
// the SAME account: same funding, same age. A re-minted record has neither.
const after = await get(`now/player-${addresses[1]}`);
const afterRow = after ? JSON.parse(after) : null;
ok('a funded wallet still holds its Gold after joining',
   afterRow && afterRow.gold === GOLD, afterRow && afterRow.gold);
ok('a funded wallet still holds its Rune after joining',
   afterRow && (afterRow.inventory || {}).rune === RUNE,
   afterRow && JSON.stringify(afterRow.inventory));
ok('a funded wallet still holds its Scrolls after joining',
   afterRow && (afterRow.inventory || {}).scroll === 20,
   afterRow && JSON.stringify(afterRow.inventory));
ok('a funded wallet keeps the age it was minted with',
   afterRow && afterRow.joinedAt === joinedAtBefore,
   `${afterRow && afterRow.joinedAt} vs ${joinedAtBefore}`);

// Weakest last, and only after the four above have already decided the run.
ok('the published population never falls below what was funded',
   counts.every((c) => Number(c.users) >= addresses.length),
   counts.map((c) => c.users).join(','));
ok('and it is an integer in the published text',
   counts.every((c) => /^\d+$/.test(String(c.users))),
   counts.map((c) => c.users).join(','));

console.log(`\npid ${pid}`);
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
