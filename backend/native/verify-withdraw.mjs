/**
 * verify-withdraw.mjs — prove a Rune withdrawal reaches the token.
 *
 *   node backend/native/verify-withdraw.mjs
 *   node backend/native/verify-withdraw.mjs --wallet burner-02 --amount 3
 *
 * This exists because the withdrawal path failed silently in the worst possible
 * way, twice over, and unit tests could not have caught either half:
 *
 *   1. The game emitted `action = "mint"` and the token declared `Mint`. The
 *      lookup was case-sensitive, so the token answered "unknown action" — AFTER
 *      the game had already deducted the player's runes.
 *
 *   2. Nothing pushes a process's outbox. The message sat in the game's results
 *      forever, and the token's slot count never moved.
 *
 * Both halves are invisible to a single-process test: game_test sees a correct
 * deduction and a correct outbox, rune_test sees a correct mint, and the live
 * system loses the rune in the gap between them. So this drives the REAL two
 * processes and asserts conservation across the boundary: what left the game
 * arrived at the token, and the totals moved by exactly the same amount.
 *
 * It signs as a burner through the same ANS-104 path the browser uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signDataItem, jwkToAddress } from './ans104.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const WALLET = flag('wallet', 'burner-01');
const AMOUNT = Math.max(1, Math.floor(Number(flag('amount', 1))));

function liveProcess() {
  const file = path.join(ROOT, 'live-process.txt');
  const [pid, node] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.trim());
  return { pid, node: process.env.NODE_URL || node };
}

const { pid: GAME, node: NODE } = liveProcess();
const jwk = JSON.parse(fs.readFileSync(path.join(ROOT, '.burners', `${WALLET}.json`), 'utf8'));
const me = jwkToAddress(jwk);

/** A plain GET of a published key. HTML at 200 means the key is absent. */
async function readKey(pid, key, { timeoutMs = 120_000 } = {}) {
  const res = await fetch(`${NODE}/${pid}~process@1.0/now/${key}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${key}: ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || text === 'null' || text.startsWith('<')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Sign and schedule, exactly as the browser does. Returns the slot. */
async function send(pid, tags) {
  const fields = [
    { name: 'type', value: 'Message' },
    { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    ...Object.entries(tags).map(([name, value]) => ({ name, value: String(value) })),
    { name: 'random-seed', value: String(Math.floor(Math.random() * 1e9)) },
  ];
  const signed = await signDataItem(jwk, { data: '', target: pid, tags: fields });
  const res = await fetch(`${NODE}/${pid}~process@1.0/schedule?codec-device=ans104@1.0`, {
    method: 'POST',
    headers: { 'content-type': 'application/ans104', 'accept-bundle': 'true' },
    body: Buffer.from(signed),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`schedule ${res.status}: ${res.headers.get('details') ?? ''}`);
  }
  return Number(res.headers.get('slot'));
}

/**
 * The other half of every cross-process message. See pushSlot in hyperbeam.ts.
 *
 * The RESULT IS NOT THE VERDICT, and treating it as one made this script report
 * a working bridge as a broken one. A push of a real withdrawal took 223
 * seconds and came back `500` with an HTML error page — and the mint had landed
 * anyway: the token was credited, the supply had grown. The node finished the
 * compute and the HTTP response died on the way back.
 *
 * A timeout means the same thing, only more so. So this reports what happened
 * and never decides anything; the only evidence that counts is the balances on
 * the two processes afterwards, which is what every check below reads.
 */
async function push(pid, slot) {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${NODE}/${pid}~process@1.0/push&slot=${slot}`, {
      signal: AbortSignal.timeout(540_000),
    });
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  push ${pid.slice(0, 8)}… slot ${slot}: ${res.status} after ${seconds}s`);
    return { attempted: true, status: res.status, seconds };
  } catch (error) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  push ${pid.slice(0, 8)}… slot ${slot}: ${error.name} after ${seconds}s`
      + ' (the compute may still have landed — the balances decide)');
    return { attempted: true, status: error.name, seconds };
  }
}

const results = [];
const check = (label, pass, detail) => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS ' : 'FAIL '} ${label}${detail !== undefined ? `  <- ${detail}` : ''}`);
};

console.log(`game   ${GAME}\nnode   ${NODE}\nwallet ${WALLET} ${me}\namount ${AMOUNT}\n`);

const runeToken = await readKey(GAME, 'runetoken');
if (!runeToken) {
  console.error('The game has no Rune token wired (`runetoken` is unset). Deploy the bridge first.');
  process.exit(1);
}
console.log(`rune   ${runeToken}\n`);

const playerBefore = await readKey(GAME, `player-${me}`);
const heldBefore = Number(playerBefore?.inventory?.rune ?? 0);
const balancesBefore = (await readKey(runeToken, 'balances')) ?? {};
const tokenBefore = Number(balancesBefore[me] ?? 0);
const supplyBefore = Number(await readKey(runeToken, 'totalsupply') ?? 0);

console.log(`in-game runes  ${heldBefore}`);
console.log(`token balance  ${tokenBefore}`);
console.log(`total supply   ${supplyBefore}\n`);

if (heldBefore < AMOUNT) {
  console.error(`${WALLET} holds ${heldBefore} runes in game; needs ${AMOUNT}.`);
  console.error('Claim a daily or grant some with Admin.AdjustInventory first.');
  process.exit(1);
}

const slot = await send(GAME, { action: 'Rune.Withdraw', amount: String(AMOUNT) });
console.log(`withdraw scheduled at slot ${slot}`);
// Reported, not asserted. See push() above: a 500 here is not a failure.
await push(GAME, slot);

// The token applies the mint on its own timeline. Poll rather than assume.
let tokenAfter = tokenBefore;
let supplyAfter = supplyBefore;
for (let i = 0; i < 40; i += 1) {
  const balances = (await readKey(runeToken, 'balances').catch(() => null)) ?? {};
  tokenAfter = Number(balances[me] ?? 0);
  supplyAfter = Number(await readKey(runeToken, 'totalsupply').catch(() => 0) ?? 0);
  if (tokenAfter >= tokenBefore + AMOUNT) break;
  await new Promise((r) => { setTimeout(r, 5_000); });
}

// The SECOND hop.
//
// The game's outbox carried the mint to the token; the token's own outbox
// carries a `Rune.Minted` confirmation back, which is what closes the
// withdrawal. Whether one push cascades through both hops or each has to be
// pushed on its own is not documented anywhere, so this finds out rather than
// assuming: read the token's current slot and push it, and report which of the
// two it turned out to be.
const settledBySingle = await (async () => {
  const w = await readKey(GAME, 'runewithdrawals').catch(() => null);
  return Array.isArray(w) && w.some((row) => row.id && row.status === 'minted');
})();

let tokenSlot = null;
try {
  const res = await fetch(`${NODE}/${runeToken}~process@1.0/now/at-slot`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  tokenSlot = Number((await res.json())?.body);
} catch { /* the token may still be computing */ }

if (Number.isFinite(tokenSlot)) {
  const pushedBack = await push(runeToken, tokenSlot);
  console.log(`pushed the token's slot ${tokenSlot}: ${pushedBack}`);
}

const playerAfter = await readKey(GAME, `player-${me}`);
const heldAfter = Number(playerAfter?.inventory?.rune ?? 0);

console.log('');
check('the game deducted exactly what was asked',
  heldAfter === heldBefore - AMOUNT, `${heldBefore} -> ${heldAfter}`);
check('the token credited the same amount',
  tokenAfter === tokenBefore + AMOUNT, `${tokenBefore} -> ${tokenAfter}`);
check('total supply grew by the same amount',
  supplyAfter === supplyBefore + AMOUNT, `${supplyBefore} -> ${supplyAfter}`);
// The one that actually mattered: nothing may vanish in the gap between the two
// processes. A deduction with no matching credit is the bug this file exists for.
check('nothing was destroyed crossing the boundary',
  (heldBefore - heldAfter) === (tokenAfter - tokenBefore),
  `game -${heldBefore - heldAfter}, token +${tokenAfter - tokenBefore}`);

// The way back: a DEPOSIT --------------------------------------------------
//
// Not the reverse of the above, and the asymmetry is why it is checked
// separately rather than assumed to follow.
//
// Going out, the GAME moves first: it deducts, then asks the token to mint. A
// failure leaves the player short with a `pending` row on this side saying so,
// and nothing was created out of nothing.
//
// Coming back, the TOKEN moves first. `Burn` destroys the supply immediately,
// and the credit in the game is the only thing that returns the value — there
// is no second source to reconcile against afterwards. So a burn whose notice
// never lands does not leave a pending row anywhere; it just deletes somebody's
// Rune. That is the failure this leg exists to catch, and it is the one that
// cannot be caught by testing either process on its own.
//
// `--no-deposit` skips it, for a run against a game process deployed before the
// `Burn-Notice` handler existed.
if (!argv.includes('--no-deposit') && tokenAfter > tokenBefore) {
  const depositAmount = Math.min(AMOUNT, tokenAfter - tokenBefore);
  console.log(`\ndepositing ${depositAmount} back...`);

  const gameBeforeBurn = Number(
    (await readKey(GAME, `player-${me}`))?.inventory?.rune ?? 0);
  const supplyBeforeBurn = Number(await readKey(runeToken, 'totalsupply') ?? 0);

  const burnSlot = await send(runeToken, {
    action: 'Burn', quantity: String(depositAmount),
  });
  console.log(`burn scheduled at slot ${burnSlot}`);
  await push(runeToken, burnSlot);

  // The game applies the credit on its own timeline, same as the mint did.
  let gameAfterBurn = gameBeforeBurn;
  for (let i = 0; i < 40; i += 1) {
    const player = await readKey(GAME, `player-${me}`).catch(() => null);
    gameAfterBurn = Number(player?.inventory?.rune ?? gameAfterBurn);
    if (gameAfterBurn >= gameBeforeBurn + depositAmount) break;
    await new Promise((r) => { setTimeout(r, 5_000); });
  }
  const supplyAfterBurn = Number(await readKey(runeToken, 'totalsupply') ?? 0);
  const balancesEnd = (await readKey(runeToken, 'balances')) ?? {};
  const tokenEnd = Number(balancesEnd[me] ?? 0);

  check('the token debited the depositor',
    tokenEnd === tokenAfter - depositAmount, `${tokenAfter} -> ${tokenEnd}`);
  check('and the supply shrank by the same amount',
    supplyAfterBurn === supplyBeforeBurn - depositAmount,
    `${supplyBeforeBurn} -> ${supplyAfterBurn}`);
  check('the game credited the player back',
    gameAfterBurn === gameBeforeBurn + depositAmount,
    `${gameBeforeBurn} -> ${gameAfterBurn}`);
  // The one that matters. A burn with no credit is Rune that simply stopped
  // existing, and no ledger on either side records the loss.
  check('nothing was destroyed coming back',
    (tokenAfter - tokenEnd) === (gameAfterBurn - gameBeforeBurn),
    `token -${tokenAfter - tokenEnd}, game +${gameAfterBurn - gameBeforeBurn}`);

  // A deposit is credited once per burn reference, and the ledger is what
  // makes a re-delivery recognisable rather than payable.
  const deposits = await readKey(GAME, 'runedeposits').catch(() => null);
  check('the deposit is on the published ledger',
    Array.isArray(deposits) && deposits.some((d) => d.address === me),
    Array.isArray(deposits) ? `${deposits.length} row(s)` : String(deposits));
}

// Settlement, which is the second hop coming home ----------------------------
//
// The token confirms the mint with `Rune.Minted`, and that is what moves the
// withdrawal off `pending`. It is read from the published ledger rather than
// inferred, because "the balance moved" and "this process knows the balance
// moved" are different facts and only the second one closes the row.
const ledger = await readKey(GAME, 'runewithdrawals').catch(() => null);
if (Array.isArray(ledger)) {
  const mine = ledger.filter((row) => row.address === me);
  const settled = mine.filter((row) => row.status === 'minted').length;
  const pending = mine.filter((row) => row.status === 'pending').length;
  check('the withdrawal is recorded as settled, not left pending',
    settled > 0 && pending === 0, `${settled} minted, ${pending} pending`);
} else {
  check('the withdrawal ledger is published', false,
    'runewithdrawals is absent — deploy a game process that publishes it');
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
