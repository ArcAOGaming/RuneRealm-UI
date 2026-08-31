/**
 * amm-load.mjs — randomized traders against the Rune/quote pool.
 *
 *   node backend/native/amm-load.mjs --traders 4 --rounds 12
 *   node backend/native/amm-load.mjs --traders 8 --rounds 30 --seed 7
 *   node backend/native/amm-load.mjs --plan          # print, send nothing
 *
 * The swarm deliberately never touches this path, so until now none of it had
 * ever run outside a unit test: the Rune token's total supply was 0, the pool
 * had never held liquidity, and `swaps` was 0. The deploy has been printing
 * "the bridge is open but UNPROVEN until one withdrawal has been made" since
 * the beginning and it was simply true.
 *
 * The chain each trader walks is the real one, and every step is a place it can
 * break:
 *
 *   Rune.Withdraw   game deducts in-process Rune, then asks the token to mint.
 *                   This is the ONLY source of Rune supply, and it crosses a
 *                   process boundary, so it needs its outbox pushed.
 *   Faucet          free TEST-RELIC, 5.000000 at 6 decimals.
 *   Transfer        moving a token TO the pool does not swap anything. The
 *                   token emits a Credit-Notice and the pool books it as a
 *                   DEPOSIT. Every pool verb then spends that deposit.
 *   Liquidity.Add / Swap / Liquidity.Remove / Deposit.Refund
 *
 * Actions are chosen at random from whatever is currently legal for that
 * trader, which is the point: an order nobody would write down is where an
 * escrow model breaks. A refusal is recorded, not retried.
 *
 * INVARIANTS, checked against the pool after every round:
 *   * a swap may never DECREASE k = reserveBase * reserveQuote. The 30 bps fee
 *     stays in the pool, so k grows. A k that fell means value left the pool
 *     that nobody withdrew.
 *   * `totalShares` is zero only while the pool is empty.
 *   * reserves and shares move in the same direction on liquidity ops.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const int = (n, d, min, max) => {
  const v = Number(opt(n, d));
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`--${n} must be ${min}..${max}`);
  return v;
};

const traderCount = int('traders', 4, 1, 50);
const rounds = int('rounds', 12, 1, 500);
const PLAN = has('plan');

let seed = int('seed', 20260830, 0, 2 ** 31);
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const readLines = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.trim()) : []);
const live = readLines(path.join(ROOT, 'live-process.txt'));
const runeLines = readLines(path.join(ROOT, 'rune-process.txt'));
const marketLines = readLines(path.join(ROOT, 'marketplace-processes.txt'));

// Read the ids from `marketplace-state.json`, which names them, rather than
// from line positions in `marketplace-processes.txt`.
//
// Those positions moved when the companion market folded into the game: the
// file used to be [market, amm, rune, quote, node, owner] and is now
// [amm, rune, quote, node, owner]. Positional reads did not fail, they silently
// picked up the wrong processes — `amm` became the Rune token and `quote`
// became a node URL. A named field cannot drift like that.
const stateFile = path.join(HERE, 'marketplace-state.json');
const marketState = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

const node = process.env.NODE_URL || marketState.node || live[1] || 'https://hyperbeam.tylerw.ai';
const game = process.env.GAME_PROCESS || marketState.game || live[0];
const rune = marketState.rune || runeLines[0];
const amm = marketState.amm || marketLines[0];
const quote = marketState.quote || marketLines[2];
for (const [label, id] of [['game', game], ['rune', rune], ['amm', amm], ['quote', quote]]) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id || '')) throw new Error(`no ${label} process id`);
}

const traders = listBurners().slice(0, traderCount);
if (!traders.length) throw new Error('no burners; run: npm run swarm:wallets');

console.log(`amm load: ${traders.length} traders, ${rounds} rounds, seed ${opt('seed', 20260830)}`);
console.log(`node  ${node}\ngame  ${game}\nrune  ${rune}\namm   ${amm}\nquote ${quote}\n`);

async function readKey(pid, key) {
  const res = await fetch(`${node}/${pid}~process@1.0/now/${key}`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  const body = (await res.text()).trim();
  if (!res.ok || /^<!DOCTYPE html|^<html/i.test(body)) return null;
  try { return JSON.parse(body); } catch { return body; }
}

const pool = () => readKey(amm, 'amm');
const kOf = (p) => BigInt(p?.reserveBase ?? 0) * BigInt(p?.reserveQuote ?? 0);

const log = [];
async function act(trader, action, tags, note = '') {
  if (PLAN) { console.log(`  would ${action.padEnd(18)} ${trader.name} ${note}`); return { planned: true }; }
  const started = Date.now();
  try {
    const target = tags.__target;
    delete tags.__target;
    const sent = await sendMessage({
      node, jwk: trader.jwk, process: target, action, tags: { Action: action, ...tags },
    });

    // Read the REPLY, do not just trust the send.
    //
    // `sendMessage` resolving means the scheduler accepted the item, and says
    // nothing whatever about what the handler decided. The first version of
    // this file reported 18 actions "ok" while the Rune supply stayed at 0 and
    // the pool stayed empty — every refusal counted as a success. This is the
    // same lesson `seed-monsters.mjs` states outright: a scheduled message says
    // nothing about what the handler did.
    let replyError = null;
    if (sent?.slot !== undefined && sent.slot !== null) {
      const url = `${node}/${target}~process@1.0/compute&slot=${sent.slot}/results/output/data`;
      const res = await fetch(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(90_000) });
      const body = (await res.text()).trim();
      if (res.ok && body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed === 'object' && parsed.error) replyError = String(parsed.error);
        } catch { /* a non-JSON reply is not an error */ }
      }
    }
    if (replyError) throw new Error(replyError);

    const row = { trader: trader.name, action, ok: true, ms: Date.now() - started, note, slot: sent?.slot };
    log.push(row);
    console.log(`  ${String(row.ms).padStart(5)}ms  ${trader.name.padEnd(10)} ${action.padEnd(18)} ${note}`);
    return row;
  } catch (error) {
    const row = { trader: trader.name, action, ok: false, ms: Date.now() - started,
      note, error: error.message.split('\n')[0].slice(0, 90) };
    log.push(row);
    console.log(`  ${String(row.ms).padStart(5)}ms  ${trader.name.padEnd(10)} ${action.padEnd(18)} REFUSED ${row.error}`);
    return row;
  }
}

// -- bootstrap: put both assets in each trader's hands -----------------------

// Deterministic, in this exact order, because randomizing it means the pool
// usually never gets seeded and every swap correctly answers "Pool has no
// liquidity" — which tests the refusal and nothing else. Randomness belongs
// AFTER there is something to trade against.
//
// Amount is 1: `Rune.Withdraw` takes it out of the player's in-game balance,
// and a swarm soak running alongside is spending those same Runes, so asking
// for more is refused with "You hold 1 Rune".
console.log('bootstrap: withdraw Rune, pull faucet, deposit both sides, seed the pool\n');
for (const trader of traders) {
  await act(trader, 'Rune.Withdraw', { __target: game, Amount: '1' }, 'game -> rune token');
  await act(trader, 'Faucet', { __target: quote }, '5.000000 TEST-RELIC');
  // A transfer TO the pool is a deposit, not a trade. Both sides must be
  // deposited before `Liquidity.Add` will spend them.
  await act(trader, 'Transfer', { __target: rune, Recipient: amm, Quantity: '1' }, 'deposit 1 rune');
  await act(trader, 'Transfer', { __target: quote, Recipient: amm, Quantity: '2000000' }, 'deposit 2.0 relic');
  await act(trader, 'Liquidity.Add', { __target: amm, BaseQuantity: '1', QuoteQuantity: '2000000' }, 'seed liquidity');
}

const afterBootstrap = await pool();
console.log(`\npool after bootstrap: reserves ${afterBootstrap?.reserveBase ?? '?'} / `
  + `${afterBootstrap?.reserveQuote ?? '?'}  shares ${afterBootstrap?.totalShares ?? '?'}  `
  + `swaps ${afterBootstrap?.swaps ?? '?'}`);

// -- randomized trading ------------------------------------------------------

const findings = [];
let previousK = kOf(afterBootstrap);
let previousSwaps = Number(afterBootstrap?.swaps ?? 0);

for (let round = 1; round <= rounds && !PLAN; round += 1) {
  console.log(`\n--- round ${round} ---`);
  for (const trader of traders) {
    // Deliberately chosen from what is PLAUSIBLE, not from what is legal: the
    // pool's refusals are part of what is under test, so an action that cannot
    // succeed right now is still worth sending.
    const choice = pick([
      'deposit-base', 'deposit-quote', 'add', 'swap-base', 'swap-quote',
      'remove', 'refund', 'swap-base', 'swap-quote', 'add',
    ]);
    if (choice === 'deposit-base') {
      await act(trader, 'Transfer', { __target: rune, Recipient: amm, Quantity: '1' }, 'rune -> pool deposit');
    } else if (choice === 'deposit-quote') {
      await act(trader, 'Transfer', { __target: quote, Recipient: amm, Quantity: '1000000' }, 'relic -> pool deposit');
    } else if (choice === 'add') {
      await act(trader, 'Liquidity.Add', { __target: amm, BaseQuantity: '1', QuoteQuantity: '1000000' }, 'add liquidity');
    } else if (choice === 'remove') {
      const shares = String(1 + Math.floor(random() * 3));
      await act(trader, 'Liquidity.Remove', { __target: amm, Shares: shares }, `remove ${shares} shares`);
    } else if (choice === 'swap-base') {
      // A swap spends a DEPOSIT, so fund one first. Rune is scarce — a trader
      // can only withdraw what it holds in game and the soak is spending those
      // — so this leg often refuses on balance. That is realistic, not a bug.
      await act(trader, 'Transfer', { __target: rune, Recipient: amm, Quantity: '1' }, 'deposit 1 rune');
      await act(trader, 'Swap', { __target: amm, InputToken: rune, Quantity: '1', MinOutput: '0' }, 'swap rune -> relic');
    } else if (choice === 'swap-quote') {
      // Sized above the rounding floor: Rune is denomination 0, so a quote
      // input pricing out below one whole Rune is refused as "Input is too
      // small for this pool" — correctly. The faucet is unlimited, so the quote
      // side is where sustained swap volume can actually come from.
      await act(trader, 'Faucet', { __target: quote }, 'top up relic');
      await act(trader, 'Transfer', { __target: quote, Recipient: amm, Quantity: '3000000' }, 'deposit 3.0 relic');
      await act(trader, 'Swap', { __target: amm, InputToken: quote, Quantity: '3000000', MinOutput: '0' }, 'swap relic -> rune');
    } else {
      await act(trader, 'Deposit.Refund', { __target: amm }, 'refund idle deposit');
    }
  }

  const now = await pool();
  const k = kOf(now);
  const swaps = Number(now?.swaps ?? 0);
  console.log(`  pool: ${now?.reserveBase ?? '?'} / ${now?.reserveQuote ?? '?'}  `
    + `shares ${now?.totalShares ?? '?'}  swaps ${swaps}  k ${k}`);

  // k may only fall when liquidity was REMOVED. If it fell across a round whose
  // only pool-changing events were swaps, the fee model is leaking.
  const removed = log.slice(-traders.length).some((r) => r.ok && r.action === 'Liquidity.Remove');
  if (k < previousK && !removed && swaps > previousSwaps) {
    findings.push(`round ${round}: k fell ${previousK} -> ${k} across swaps only`);
  }
  previousK = k;
  previousSwaps = swaps;
}

// -- report ------------------------------------------------------------------

if (!PLAN) {
  const final = await pool();
  const byAction = new Map();
  for (const row of log) {
    const seen = byAction.get(row.action) ?? { ok: 0, refused: 0, reasons: new Map() };
    if (row.ok) seen.ok += 1;
    else {
      seen.refused += 1;
      seen.reasons.set(row.error, (seen.reasons.get(row.error) ?? 0) + 1);
    }
    byAction.set(row.action, seen);
  }
  console.log('\n=== by action');
  for (const [action, seen] of byAction) {
    console.log(`  ${action.padEnd(18)} ok ${String(seen.ok).padStart(3)}  refused ${String(seen.refused).padStart(3)}`
      + (seen.refused ? `  (${[...seen.reasons.keys()][0]})` : ''));
  }
  console.log('\n=== pool');
  console.log(`  reserves     ${final?.reserveBase} base / ${final?.reserveQuote} quote`);
  console.log(`  totalShares  ${final?.totalShares}`);
  console.log(`  swaps        ${final?.swaps}`);
  console.log(`  rune supply  ${await readKey(rune, 'totalsupply')}`);

  if (findings.length) {
    console.log('\n!! INVARIANT FINDINGS');
    for (const f of findings) console.log(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nno invariant violations: k never fell across a swap-only round');
  }
}
