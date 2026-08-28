/**
 * mint-worker.mjs — the half of the mint that needs a wallet.
 *
 *   node backend/native/mint-worker.mjs            # drain, then poll
 *   node backend/native/mint-worker.mjs --once     # one pass and exit (cron)
 *   node backend/native/mint-worker.mjs --dry-run  # render and price, sign nothing
 *
 * The game process publishes two queues and this drains them. It is the ONLY
 * component holding a funded key, and it holds no authority the process owner
 * does not already have — it IS the process owner. What that split buys is that
 * a player never needs AR, never signs an Arweave transaction, and cannot mint
 * a companion the process does not agree they own.
 *
 * Everything here is built to survive being killed at any instant, because it
 * spends real money in the middle:
 *
 *   * The ledger records a transaction id the moment it is SIGNED, before it is
 *     posted. A crash after posting therefore never re-signs; it reposts the
 *     same id, which the gateway answers 208, and reports it.
 *
 *   * `Admin.Minted` is idempotent on the process side: it consumes a queued
 *     job by sequence number, so reporting twice fails harmlessly the second
 *     time rather than taking a second companion.
 *
 *   * A job that fails BEFORE anything was signed is refunded through
 *     `Admin.MintFailed`. A job that fails after is never refunded — the asset
 *     exists and the player has it.
 *
 * The collection is appended in a batch at the end of a pass, not per mint:
 * every append republishes the whole manifest, so per-mint appends would make
 * the cost of minting grow with the size of the collection.
 *
 * Each new asset is also SEEDED with one winston — see `seedAsset`. The minter
 * pays that so a player never can.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assetHolder, balance, jwkToAddress, mintTags, price, signAndPost, targetPrice,
} from './asset.mjs';
import { appendAssets, loadCollection } from './collection.mjs';
import { sendMessage } from './hbclient.mjs';
import { renderCardPng } from './card/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const NODE = process.env.NODE_URL || 'https://schedule.forward.computer';
const LEDGER = process.env.MINT_LEDGER || path.join(HERE, 'mint-ledger.json');
const POLL_MS = Number(process.env.MINT_POLL_MS || 60_000);

/**
 * Refuse to start below this, so a pass cannot die halfway through a batch.
 *
 * A mint is cheap (~0.003 AR) but its seed is not (~0.23 AR), so one card costs
 * about a quarter of an AR all in. This floor is two of them.
 */
const MIN_BALANCE_WINSTON = 500_000_000_000n;   // 0.5 AR

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const DRY = has('dry-run');

function processId() {
  if (process.env.GAME_PROCESS) return process.env.GAME_PROCESS;
  const file = path.join(ROOT, 'live-process.txt');
  if (fs.existsSync(file)) {
    const found = fs.readFileSync(file, 'utf8').match(/[A-Za-z0-9_-]{43}/);
    if (found) return found[0];
  }
  throw new Error('set GAME_PROCESS, or write live-process.txt');
}

function wallet() {
  const file = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(file)) throw new Error(`no keyfile at ${file}; set HB_WALLET`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Ledger ---------------------------------------------------------------------

const readLedger = () => (fs.existsSync(LEDGER)
  ? JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
  : { mints: {}, deposits: {} });

function writeLedger(update) {
  const next = { ...readLedger(), ...update };
  fs.writeFileSync(LEDGER, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function recordMint(seq, patch) {
  const ledger = readLedger();
  ledger.mints[seq] = { ...(ledger.mints[seq] ?? {}), ...patch };
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger.mints[seq];
}

// Reading the process --------------------------------------------------------

/**
 * Read one published key.
 *
 * NO `accept: application/json`. Asking for JSON makes the node answer with its
 * own envelope — `{"ao-result":"body","body":"<the value, as a string>"}` — so
 * `JSON.parse` succeeds, hands back an object that is not the queue, and the
 * worker sees an empty queue forever while everything looks healthy. A plain
 * GET returns the value the process wrote, which is what `readState` in
 * src/lib/hyperbeam.ts has always done.
 */
async function readKey(pid, key) {
  const res = await fetch(`${NODE}/${pid}~process@1.0/now/${key}`);
  // A process deployed before minting existed simply has no such key. That is
  // a deployment fact, not a failure, and it must not read like a broken node:
  // the pass reports it once and does nothing rather than crashing per key.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${key}: ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || text === 'null') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * An empty Lua table encodes as `{}` and a populated list as an array, so a
 * queue read can legitimately come back either way. Normalise once here rather
 * than guarding at three call sites.
 */
const asList = (value) => (Array.isArray(value) ? value : []);

// Minting --------------------------------------------------------------------

function describe(monster) {
  const level = Math.round(Number(monster.level) || 0);
  return `A level ${level} ${monster.elementType} companion of the ${monster.faction}, `
    + `raised in Rune Realm. Attack ${monster.attack}, speed ${monster.speed}, `
    + `defense ${monster.defense}, health ${monster.health}.`;
}

async function mintOne(jwk, pid, owner, job) {
  const seq = Number(job.seq);
  const prior = readLedger().mints[seq];

  // Already signed on an earlier pass: never sign again, just finish the job.
  if (prior?.assetId) {
    console.log(`  #${seq} already signed as ${prior.assetId}; reporting`);
    await report(jwk, pid, seq, prior.assetId, job.address);
    return prior.assetId;
  }

  const png = renderCardPng(job.monster);
  const cost = await price(png.length);
  console.log(`  #${seq} ${job.address} ${job.monster.name} lvl ${job.monster.level}`
    + ` — ${png.length} bytes, ${Number(cost) / 1e12} AR`);
  if (DRY) return null;

  const tags = mintTags({
    title: job.monster.name,
    description: describe(job.monster),
    collection: loadCollection()?.name,
    owner: job.address,      // the PLAYER holds it, not the wallet that paid
    creator: owner,
    contentType: 'image/png',
  });

  const assetId = await signAndPost(jwk, {
    data: png,
    tags,
    onSigned: (id) => { recordMint(seq, { address: job.address, txId: id, state: 'signed' }); },
  });
  recordMint(seq, { assetId, state: 'posted', bytes: png.length });
  // Seed before reporting: the player is told they own it only once it is a
  // thing they can actually move without a surprise fee.
  await seedAsset(jwk, assetId, seq).catch((error) => {
    console.error(`  #${seq} SEED FAILED (${error.message}) — the first transfer`
      + ' of this asset will pay the premium instead of us');
  });
  await report(jwk, pid, seq, assetId, job.address);
  return assetId;
}

/**
 * Send the new asset one winston, so that transferring it later costs dust.
 *
 * Arweave charges a premium on the FIRST transaction ever sent to an address
 * ("An extra fee is taken for the first transaction sent to a new wallet
 * address... to discourage wallet spam"). A token transfer targets the asset's
 * OWN process address, which is brand new for every asset we mint — so without
 * this, the first person to move a card would be ambushed by a ~0.22 AR fee for
 * doing nothing unusual.
 *
 * This is not our invention. Bazar's assets carry exactly one winston, put
 * there the same way: the Dumdumz asset `6eUuk…` shows two transactions in its
 * entire history — a `quantity: 1` seed that paid 0.228287 AR at block 1984705,
 * then a transfer at block 1984750 that paid 0.000037.
 *
 * It is charged to the MINTER deliberately. It is the cost of issuing a
 * tradable thing, and it belongs with whoever issues it, not with the player
 * who later tries to bring their companion home.
 *
 * Failure here is not fatal: the asset is already minted and perfectly valid.
 * It only means the first transfer pays the premium instead of us, so it is
 * logged loudly and the pass carries on.
 */
async function seedAsset(jwk, assetId, seq) {
  if (readLedger().mints[seq]?.seedTx) return;
  const cost = await targetPrice(assetId);
  if (cost < 1_000_000_000n) {
    // Already seeded — someone has sent this address AR before. Nothing to do.
    recordMint(seq, { seeded: 'already' });
    return;
  }
  console.log(`  #${seq} seeding ${assetId} — ${Number(cost) / 1e12} AR`);
  if (DRY) return;
  const id = await signAndPost(jwk, {
    target: assetId,
    quantity: '1',
    tags: {},
    onSigned: (tx) => { recordMint(seq, { seedTx: tx }); },
  });
  recordMint(seq, { seedTx: id, seeded: true });
  console.log(`  #${seq} seeded -> ${id}`);
}

async function report(jwk, pid, seq, assetId, address) {
  await sendMessage({
    node: NODE, jwk, process: pid, action: 'Admin.Minted',
    tags: { Seq: String(seq), AssetId: assetId, PlayerId: address },
  });
  recordMint(seq, { state: 'reported' });
  console.log(`  #${seq} -> ${assetId}`);
}

async function refund(jwk, pid, seq, reason) {
  await sendMessage({
    node: NODE, jwk, process: pid, action: 'Admin.MintFailed',
    tags: { Seq: String(seq), Reason: String(reason).slice(0, 200) },
  });
  recordMint(seq, { state: 'refunded', reason: String(reason).slice(0, 200) });
  console.log(`  #${seq} refunded: ${reason}`);
}

// Deposits -------------------------------------------------------------------

/**
 * A deposit is settled by the asset's own balances, never by a transfer showing
 * up in a gateway index. GraphQL finds candidates; only the process knows who
 * holds what, and a transfer is a message it applies.
 */
async function settleDeposits(jwk, pid, vault) {
  const queue = asList(await readKey(pid, 'depositqueue'));
  for (const job of queue) {
    try {
      const holder = await assetHolder(job.assetId);
      if (holder !== vault) {
        console.log(`  deposit ${job.assetId}: held by ${holder ?? 'nobody yet'}, waiting`);
        continue;
      }
      if (DRY) { console.log(`  deposit ${job.assetId}: would settle`); continue; }
      await sendMessage({
        node: NODE, jwk, process: pid, action: 'Admin.Deposited',
        tags: { Seq: String(job.seq), AssetId: job.assetId, PlayerId: job.address },
      });
      writeLedger({ deposits: { ...readLedger().deposits, [job.assetId]: { at: Date.now(), address: job.address } } });
      console.log(`  deposit ${job.assetId} -> ${job.address}`);
    } catch (error) {
      console.error(`  deposit ${job.assetId}: ${error.message}`);
    }
  }
}

// A pass ---------------------------------------------------------------------

async function pass(jwk, pid, owner) {
  const funds = await balance(owner);
  if (funds < MIN_BALANCE_WINSTON && !DRY) {
    throw new Error(`minter ${owner} holds ${Number(funds) / 1e12} AR; top it up`);
  }

  const vault = await readKey(pid, 'mintvault');
  if (vault !== owner) {
    // The vault is where players send an asset to bring a companion home. If it
    // does not name this wallet, deposits would be sent somewhere nobody can
    // return them from — so claim it before doing anything else.
    if (DRY) {
      console.log(`vault is ${vault ?? 'unset'}, would set to ${owner}`);
    } else {
      await sendMessage({
        node: NODE, jwk, process: pid, action: 'Admin.SetVault', tags: { Vault: owner },
      });
      console.log(`vault set to ${owner}`);
    }
  }

  const raw = await readKey(pid, 'mintqueue');
  if (raw === null) {
    console.log('this process does not publish `mintqueue` — redeploy it with the mint handlers');
    return;
  }
  const queue = asList(raw);
  const deposits = asList(await readKey(pid, 'depositqueue'));
  console.log(`${queue.length} queued, ${deposits.length} deposits`);

  const minted = [];
  for (const job of [...queue].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    try {
      const assetId = await mintOne(jwk, pid, owner, job);
      if (assetId) minted.push(assetId);
    } catch (error) {
      console.error(`  #${job.seq} failed: ${error.message}`);
      // Only refund when nothing was signed. Past that point the asset either
      // exists or will, and the player is getting it.
      if (!readLedger().mints[job.seq]?.txId && !DRY) {
        await refund(jwk, pid, job.seq, error.message).catch((e) => console.error(`  refund failed: ${e.message}`));
      }
    }
  }

  if (minted.length && !DRY && loadCollection()) {
    const state = await appendAssets(jwk, minted);
    console.log(`collection ${state.processId}: ${state.assets.length} assets`);
  }

  await settleDeposits(jwk, pid, owner);
}

/**
 * Mint one sample card to the minter's own wallet.
 *
 * The point is to prove the CHAIN half on its own. The queue half needs the
 * game process redeployed with the mint handlers, and a redeploy mints a new
 * process and resets everybody's state — far too much to spend on finding out
 * whether a tag set is right. This signs one real transaction with the real tag
 * set, so the asset either resolves on a HyperBEAM node and appears on Bazar or
 * it does not, and that answer costs about half a cent.
 *
 * It is a real mint: permanent, public, and prefixed TEST- like everything else
 * this pipeline publishes.
 */
async function testMint(jwk, owner, spec) {
  const [element = 'fire', level = '9'] = String(spec ?? 'fire:9').split(':');
  const names = { fire: 'FireFox', water: 'WaterDoge', air: 'Airbud', rock: 'Rockpup' };
  const factions = {
    fire: 'Inferno Blades', water: 'Aqua Guardians', air: 'Sky Nomads', rock: 'Stone Titans',
  };
  const n = Number(level);
  const monster = {
    name: names[element] ?? 'FireFox',
    elementType: element,
    faction: factions[element] ?? 'Inferno Blades',
    level: n,
    attack: 12 + n, speed: 9 + n, defense: 11 + n, health: 40 + n * 3,
    moves: {
      Firenado: { type: 'fire' }, 'Flame Shield': { type: 'fire' },
      'Power Up': { type: 'boost' }, Recovery: { type: 'heal' },
    },
  };

  const png = renderCardPng(monster);
  const cost = await price(png.length);
  console.log(`sample card: ${png.length} bytes, ${Number(cost) / 1e12} AR`);
  if (DRY) return;

  const assetId = await signAndPost(jwk, {
    data: png,
    tags: mintTags({
      title: monster.name,
      description: describe(monster),
      collection: loadCollection()?.name,
      owner,
      creator: owner,
      contentType: 'image/png',
    }),
    onSigned: (id) => console.log(`signed   ${id}`),
  });
  console.log(`asset    ${assetId}`);
  console.log(`image    https://arweave.net/${assetId}`);
  // Two segments: Bazar's asset route is `#/asset/<collection>/<asset>` and a
  // one-segment link silently redirects to the front page. `created-assets` is
  // its pass-through for anything not in a listed collection.
  console.log(`bazar    https://bazar.arweave.net/#/asset/created-assets/${assetId}`);
  if (loadCollection()) {
    const state = await appendAssets(jwk, [assetId]);
    console.log(`collection ${state.processId}: ${state.assets.length} assets`);
  }
}

// Entry ----------------------------------------------------------------------

const jwk = wallet();
const owner = await jwkToAddress(jwk);
console.log(`minter ${owner}\nnode    ${NODE}${DRY ? '\n(dry run)' : ''}`);

if (has('test-mint')) {
  await testMint(jwk, owner, argv[argv.indexOf('--test-mint') + 1]);
  process.exit(0);
}

const pid = processId();
console.log(`process ${pid}`);

if (has('once') || DRY) {
  // A single pass reports its failure and exits non-zero rather than dumping a
  // stack trace. A freshly redeployed process answers 500 on every key until
  // its spawn block is in the confirmed index, and that is a wait, not a fault.
  try {
    await pass(jwk, pid, owner);
  } catch (error) {
    console.error(`pass failed: ${error.message}`);
    process.exit(1);
  }
} else {
  for (;;) {
    await pass(jwk, pid, owner).catch((error) => console.error(`pass failed: ${error.message}`));
    await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
  }
}
