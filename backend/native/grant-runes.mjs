/**
 * grant-runes.mjs — top the test wallets up with Rune, as the owner.
 *
 *   HB_WALLET=key.json node backend/native/grant-runes.mjs --amount 5
 *   node backend/native/grant-runes.mjs --amount 5 --plan
 *
 * Rune is the binding constraint on everything a soak wants to measure. A quest
 * costs one and an arena session of four battles costs one. Per-wallet starter,
 * daily, and loot-box Rune faucets are gone; a real deployment uses one fixed
 * global budget. TEST burners are therefore funded explicitly and audibly so a
 * soak measures gameplay/economy behavior rather than waiting for launch policy.
 *
 * `Admin.AdjustInventory` is owner-only and applies a signed delta to one item
 * on one player, reporting `before`/`after` so the grant can be verified rather
 * than assumed. It is the same door the owner console uses.
 *
 * This is a TEST-deployment tool. It mints spending money out of nothing, which
 * is exactly what you must not do on a real one.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jwkToAddress, sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const amount = Number(opt('amount', 5));
if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 10_000) {
  throw new Error('--amount must be a non-zero integer within +/-10000');
}
const item = opt('item', 'rune');
const limit = Number(opt('limit', 50));
const PLAN = has('plan');

const live = fs.existsSync(path.join(ROOT, 'live-process.txt'))
  ? fs.readFileSync(path.join(ROOT, 'live-process.txt'), 'utf8').trim().split(/\r?\n/).map((l) => l.trim())
  : [];
const pid = process.env.GAME_PROCESS || live[0];
const node = process.env.NODE_URL || live[1] || 'https://hyperbeam.tylerw.ai';
if (!/^[A-Za-z0-9_-]{43}$/.test(pid || '')) throw new Error('no game process id');

const walletFile = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
if (!fs.existsSync(walletFile)) throw new Error(`no keyfile at ${walletFile}`);
const jwk = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
const owner = jwkToAddress(jwk);

const targets = listBurners().slice(0, limit);
if (!targets.length) throw new Error('no burners; run: npm run swarm:wallets');

/**
 * `--gold N` — set every test wallet's Gold balance, in ONE message.
 *
 * Gold is not an item, so `Admin.AdjustInventory` cannot touch it: the only
 * door that writes `p.gold` is `Admin.Load`. That matters more than it sounds,
 * because on a fresh deployment players have NO gold and only one external way
 * to get any — selling to an NPC desk, which stops buying at a stock cap of
 * twelve. Measured on a blank deploy mid-soak: fifty wallets holding 47 Gold
 * between them, eight resting p2p orders and zero fills, because nobody could
 * afford to take the other side. Selling works; buying, order-taking and
 * arbitrage are all unreachable.
 *
 * A row carrying ONLY an address and a gold amount is safe to load: `Admin.Load`
 * rebuilds the holding only when the row actually carries one (`carriesHolding`
 * in game.lua), so this leaves companions, inventory and streaks untouched.
 *
 * Like the rest of this file: a TEST-deployment tool that mints spending money
 * out of nothing. It is exactly what you must not run on a real deployment.
 */
const goldArg = opt('gold', null);
if (goldArg !== null) {
  const goldAmount = Number(goldArg);
  if (!Number.isSafeInteger(goldAmount) || goldAmount < 0 || goldAmount > 1_000_000) {
    throw new Error('--gold must be an integer from 0 to 1000000');
  }
  console.log(`setting Gold to ${goldAmount} for ${targets.length} wallets`);
  console.log(`process ${pid}\nnode    ${node}\nowner   ${owner}\n`);
  const players = targets.map((t) => ({ address: t.address, gold: goldAmount }));
  if (PLAN) {
    console.log(`  would load ${players.length} gold-only rows in one Admin.Load`);
    process.exit(0);
  }
  const sent = await sendMessage({
    node, jwk, process: pid, action: 'Admin.Load',
    tags: { Action: 'Admin.Load' }, data: JSON.stringify({ players }),
  });
  const slot = Number(sent?.slot ?? sent?.Slot);
  if (!Number.isInteger(slot)) throw new Error('Admin.Load did not report a slot');
  // Pull compute to the message's own slot; a published key read before that
  // answers with the pre-load balance. See the note in seed-monsters.mjs.
  let reply = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const res = await fetch(`${node}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`,
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(45_000) }).catch(() => null);
    if (res && res.ok) {
      const body = (await res.text()).trim();
      if (body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        try { reply = JSON.parse(body); } catch { /* non-JSON */ }
        if (reply) break;
      }
    }
    await new Promise((done) => setTimeout(done, 2_000));
  }
  if (reply?.error) throw new Error(`Admin.Load refused: ${reply.error}`);
  console.log(`  loaded ${reply?.loaded ?? '?'} row(s)\n\nreading back:`);
  for (const target of targets.slice(0, 5)) {
    const p = await readPlayer(target.address);
    console.log(`  ${target.name.padEnd(11)} gold = ${p?.gold ?? '(unreadable)'}`);
  }
  process.exit(0);
}

console.log(`granting ${amount >= 0 ? '+' : ''}${amount} ${item} to ${targets.length} wallets`);
console.log(`process ${pid}\nnode    ${node}\nowner   ${owner}\n`);

async function readPlayer(address) {
  const res = await fetch(`${node}/${pid}~process@1.0/now/player-${address}`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  const body = (await res.text()).trim();
  if (!res.ok || /^<!DOCTYPE html|^<html/i.test(body)) return null;
  try { return JSON.parse(body); } catch { return null; }
}

const runeOf = (p) => Number(p?.inventory?.[item] ?? 0);

let granted = 0;
let refused = 0;
for (const target of targets) {
  if (PLAN) { console.log(`  would grant ${amount} ${item} to ${target.name}`); continue; }
  try {
    const sent = await sendMessage({
      node, jwk, process: pid, action: 'Admin.AdjustInventory',
      tags: { Action: 'Admin.AdjustInventory', PlayerId: target.address, Item: item, Delta: String(amount) },
    });
    // Read the reply rather than trusting the send: a scheduled message says
    // nothing about what the handler decided, and `Admin.AdjustInventory`
    // refuses an unknown player or an unknown item.
    let applied = null;
    let error = null;
    if (sent?.slot !== undefined && sent.slot !== null) {
      const res = await fetch(`${node}/${pid}~process@1.0/compute&slot=${sent.slot}/results/output/data`,
        { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(90_000) });
      const body = (await res.text()).trim();
      if (res.ok && body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.error) error = String(parsed.error);
          else if (parsed && 'after' in parsed) applied = { before: parsed.before, after: parsed.after };
        } catch { /* non-JSON reply */ }
      }
    }
    if (error) {
      refused += 1;
      console.log(`  ${target.name.padEnd(11)} REFUSED ${error}`);
    } else {
      granted += 1;
      console.log(`  ${target.name.padEnd(11)} ${item} ${applied ? `${applied.before} -> ${applied.after}` : 'granted'}`);
    }
  } catch (err) {
    refused += 1;
    console.log(`  ${target.name.padEnd(11)} FAILED ${err.message.split('\n')[0].slice(0, 80)}`);
  }
}

if (!PLAN) {
  console.log(`\n${granted} granted, ${refused} refused`);
  // Read a sample back so the number on screen is the process's, not this
  // script's optimism.
  const sample = targets.slice(0, 3);
  console.log('\nreading back:');
  for (const target of sample) {
    console.log(`  ${target.name.padEnd(11)} ${item} = ${runeOf(await readPlayer(target.address))}`);
  }
}
