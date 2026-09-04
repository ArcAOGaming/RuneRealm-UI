/**
 * reconcile-rune-supply.mjs — tell the game what the Rune token actually holds.
 *
 *   node backend/native/reconcile-rune-supply.mjs
 *   node backend/native/reconcile-rune-supply.mjs --plan
 *
 * The Rune NPC desk refuses to trade until this has been done:
 *
 *   if rec.outsideTokenSupply == nil then
 *     return "Rune token supply has not been reconciled"   -- economy.lua
 *
 * That guard is correct and load-bearing. The desk prices Rune against Gold, and
 * the game cannot see the token process on its own — it cannot fetch — so until
 * somebody tells it the circulating supply it is being asked to price something
 * it knows nothing about. Refusing is the right answer to that.
 *
 * It is also, on a fresh deployment, the single biggest thing throttling the
 * economy. Measured mid-soak: 158 Gold of NPC buying capacity available across
 * the four berry desks, against 105,000 sitting behind this one paused desk.
 * Players are meant to earn Gold by selling, and the desk that can actually pay
 * for anything is shut.
 *
 * So: read the supply from the token itself rather than accepting a number on
 * the command line, and hand it to `Admin.Economy.ObserveRuneSupply`. Reading it
 * is the whole point — a reconciliation that trusts a typed-in figure reconciles
 * nothing.
 *
 * The reply is read back BY ITS SLOT. HyperBEAM compute is pull-based, so a
 * published key read straight after a write answers with the state from before
 * it; asking for the message's own slot is what makes the node run it.
 *
 * Reversible: `Admin.Economy.PauseDesk` closes the desk again.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jwkToAddress, sendMessage } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const PLAN = argv.includes('--plan');

const readLines = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.trim())
  : []);

const live = readLines(path.join(ROOT, 'live-process.txt'));
const rune = readLines(path.join(ROOT, 'rune-process.txt'));

const pid = process.env.GAME_PROCESS || live[0];
const node = process.env.NODE_URL || live[1] || 'https://hyperbeam.tylerw.ai';
const token = process.env.RUNE_TOKEN || rune[0];
const isId = (v) => /^[A-Za-z0-9_-]{43}$/.test(v || '');
if (!isId(pid)) throw new Error('no game process id (live-process.txt)');
if (!isId(token)) throw new Error('no Rune token id (rune-process.txt)');

const walletFile = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
if (!fs.existsSync(walletFile)) throw new Error(`no keyfile at ${walletFile}`);
const jwk = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
const owner = jwkToAddress(jwk);

/** The token's own published figure. Never a value passed in by hand. */
async function tokenTotalSupply() {
  const res = await fetch(`${node}/${token}~process@1.0/now/totalsupply`, {
    headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.text()).trim();
  // An HTML body at status 200 means the key is absent, not that it is zero.
  if (!res.ok || /^<!DOCTYPE html|^<html/i.test(body)) {
    throw new Error(`token did not publish totalsupply (status ${res.status})`);
  }
  if (!/^\d+$/.test(body)) throw new Error(`totalsupply is not an integer: ${body.slice(0, 40)}`);
  return Number(body);
}

const supply = await tokenTotalSupply();
console.log('reconciling Rune supply');
console.log(`  game    ${pid}`);
console.log(`  token   ${token}`);
console.log(`  node    ${node}`);
console.log(`  owner   ${owner}`);
console.log(`  supply  ${supply}\n`);

if (PLAN) {
  console.log(`would send Admin.Economy.ObserveRuneSupply TotalSupply=${supply}`);
  process.exit(0);
}

const sent = await sendMessage({
  node, jwk, process: pid, action: 'Admin.Economy.ObserveRuneSupply',
  tags: { Action: 'Admin.Economy.ObserveRuneSupply', TotalSupply: String(supply),
          Reason: 'bridge proven; token supply read from the token' },
});
const slot = Number(sent?.slot ?? sent?.Slot);
if (!Number.isInteger(slot)) throw new Error('no compute slot reported; nothing verified');

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
if (!reply) throw new Error(`slot ${slot} never returned a reply`);
if (reply.error) throw new Error(`refused: ${reply.error}`);
console.log(`observed totalSupply = ${reply.totalSupply ?? supply}`);

// Say whether the desk actually opened, rather than assuming the write implies
// it. The pause has two independent causes and this clears only one of them.
const econRes = await fetch(`${node}/${pid}~process@1.0/now/economy`,
  { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
if (econRes?.ok) {
  const body = (await econRes.text()).trim();
  try {
    const desk = JSON.parse(body)?.desks?.rune;
    const paused = desk?.pause && Object.keys(desk.pause).length > 0;
    console.log(paused
      ? `rune desk STILL paused: ${JSON.stringify(desk.pause)}`
      : `rune desk OPEN — bid ${desk?.bid} / ask ${desk?.ask}, room ${(desk?.stockCap ?? 0) - (desk?.stock ?? 0)}`);
  } catch { console.log('economy view unreadable; check the rune desk by hand'); }
}
