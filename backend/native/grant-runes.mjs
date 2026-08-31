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
