/**
 * PARKED FEATURE: companion asset export/import is excluded from normal routes
 * and deployments by ECONOMY_MARKETPLACE_PLAN.md. This worker is retained as
 * source only and exposed solely through `npm run parked:mint:*` commands.
 *
 * mint-worker.mjs — the half of the mint that needs a wallet.
 *
 *   node backend/native/mint-worker.mjs               # drain, then poll
 *   node backend/native/mint-worker.mjs --once        # one pass and exit (cron)
 *   node backend/native/mint-worker.mjs --dry-run     # render and price, sign nothing
 *   node backend/native/mint-worker.mjs --seed <id>   # pay one asset's premium
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
 * Seeding — the expensive half — is LAZY. See `seedAsset`.
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

const LEDGER = process.env.MINT_LEDGER || path.join(HERE, 'mint-ledger.json');
const POLL_MS = Number(process.env.MINT_POLL_MS || 60_000);

/**
 * Refuse to start below this, so a pass cannot die halfway through a batch.
 *
 * A mint is ~0.003 AR now that seeding is lazy, so this floor is about thirty
 * cards rather than two. Seeding has its own budget below and its own floor;
 * running out of seed money must not stop minting.
 */
const MIN_BALANCE_WINSTON = Number.isFinite(Number(process.env.MINT_MIN_BALANCE_AR))
  ? BigInt(Math.round(Number(process.env.MINT_MIN_BALANCE_AR) * 1e12))
  : 100_000_000_000n;                           // 0.1 AR

/**
 * The most a single pass may spend on wallet-generation seeds.
 *
 * A seed is ~0.22 AR — seventy-five times a mint — so an unbounded pass over a
 * queue that fifty test wallets can fill is a way to empty the minter's wallet
 * by accident. Nothing here needs to be fast; it needs to be impossible to be
 * surprised by. Raise it deliberately with MINT_SEED_BUDGET_AR.
 */
const SEED_BUDGET_WINSTON = BigInt(Math.round(
  Number(process.env.MINT_SEED_BUDGET_AR ?? 1) * 1e12,
));

/** Anything at or above this quote is the wallet-generation premium, not dust. */
const PREMIUM_FLOOR = 1_000_000_000n;           // 0.001 AR

let seedSpent = 0n;

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flagValue = (name) => (has(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const DRY = has('dry-run');

/**
 * Restore the old behaviour: pay every card's seed the moment it is minted.
 *
 * Off by default and worth leaving off. It only buys a player the ability to
 * transfer an asset they never told the game they wanted to move — which the
 * app has no button for.
 */
const SEED_ON_MINT = has('seed-on-mint') || process.env.MINT_SEED_ON_MINT === '1';

/**
 * The process and the node it lives on, both from `live-process.txt`.
 *
 * Line 1 is the id and line 2 is the node, and they belong together: a deploy
 * writes both at once. Reading the id from the file while defaulting the node
 * to some other host is how the worker ends up asking a node that has never
 * heard of this process, which answers 404 for `mintqueue` and reads exactly
 * like a process deployed without the mint handlers.
 */
function liveProcess() {
  const file = path.join(ROOT, 'live-process.txt');
  const [fileId, fileNode] = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => line.trim())
    : [];
  const pid = process.env.GAME_PROCESS || (/^[A-Za-z0-9_-]{43}$/.test(fileId ?? '') ? fileId : null);
  if (!pid) throw new Error('set GAME_PROCESS, or write live-process.txt');
  return { pid, node: process.env.NODE_URL || fileNode || 'https://schedule.forward.computer' };
}

function wallet() {
  const file = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(file)) throw new Error(`no keyfile at ${file}; set HB_WALLET`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Ledger ---------------------------------------------------------------------

const readLedger = () => {
  const base = { mints: {}, deposits: {}, seeds: {} };
  if (!fs.existsSync(LEDGER)) return base;
  return { ...base, ...JSON.parse(fs.readFileSync(LEDGER, 'utf8')) };
};

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
  // NOT seeded here. Seeding costs seventy-five times what the card does and
  // most cards are never moved, so it is paid at the moment one is — see
  // `seedAsset` and `settleDeposits`.
  if (SEED_ON_MINT) {
    await seedAsset(jwk, assetId, { seq }).catch((error) => {
      console.error(`  #${seq} seed failed (${error.message}) — it will be`
        + ' seeded when this asset is first asked to move');
    });
  }
  await report(jwk, pid, seq, assetId, job.address);
  return assetId;
}

/**
 * Send an asset one winston, so that transferring it costs dust.
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
 * WHEN it is paid is the whole cost of this pipeline. The premium is 0.22 AR
 * and a card is 0.003, so seeding at mint time makes every card cost
 * seventy-five times what it needs to — and it buys nothing for the great
 * majority of cards, which are minted, looked at, and never moved again. Fifty
 * test wallets minting once each is 11 AR of seeds and 0.15 AR of cards.
 *
 * So it is paid on the first move instead. A deposit is queued on the game
 * process BEFORE the player signs the transfer (`Monster.Deposit` claims
 * nothing and verifies nothing — it only publishes the intent), which gives
 * this worker the one thing it needs: notice. It seeds, and the player's
 * transfer that follows costs dust.
 *
 * It is charged to the MINTER deliberately. It is the cost of issuing a
 * tradable thing, and it belongs with whoever issues it, not with the player
 * who later tries to bring their companion home.
 *
 * Failure here is not fatal: the asset is already minted and perfectly valid.
 * It only means the first transfer pays the premium instead of us, so it is
 * logged loudly and the pass carries on.
 */
async function seedAsset(jwk, assetId, { seq = null, label = assetId } = {}) {
  const ledger = readLedger();
  if (seq !== null && ledger.mints[seq]?.seedTx) return 'already';
  if (ledger.seeds?.[assetId]) return 'already';

  const cost = await targetPrice(assetId);
  if (cost < PREMIUM_FLOOR) {
    // Already seeded — someone has sent this address AR before. Nothing to do.
    if (seq !== null) recordMint(seq, { seeded: 'already' });
    writeLedger({ seeds: { ...readLedger().seeds, [assetId]: { at: Date.now(), tx: null } } });
    return 'already';
  }
  if (seedSpent + cost > SEED_BUDGET_WINSTON) {
    console.log(`  ${label}: seed would cost ${Number(cost) / 1e12} AR and this pass has`
      + ` ${Number(SEED_BUDGET_WINSTON - seedSpent) / 1e12} AR of seed budget left`
      + ' — raise MINT_SEED_BUDGET_AR to allow it');
    return 'over-budget';
  }
  console.log(`  ${label}: seeding ${assetId} — ${Number(cost) / 1e12} AR`);
  if (DRY) return 'dry';

  const id = await signAndPost(jwk, {
    target: assetId,
    quantity: '1',
    tags: {},
    onSigned: (tx) => {
      if (seq !== null) recordMint(seq, { seedTx: tx });
      writeLedger({ seeds: { ...readLedger().seeds, [assetId]: { at: Date.now(), tx, state: 'signed' } } });
    },
  });
  seedSpent += cost;
  if (seq !== null) recordMint(seq, { seedTx: id, seeded: true });
  writeLedger({
    seeds: { ...readLedger().seeds, [assetId]: { at: Date.now(), tx: id, winston: String(cost) } },
  });
  console.log(`  ${label}: seeded -> ${id}`);
  return id;
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
 *
 * This is also where seeding happens. A queued deposit is the player saying
 * they are about to move the asset, which is the notice the minter needs to pay
 * the wallet-generation premium before they do — see `seedAsset`. A deposit
 * that is queued and not yet transferred is the normal case on the first pass,
 * not a fault.
 */
async function settleDeposits(jwk, pid, vault) {
  const queue = asList(await readKey(pid, 'depositqueue'));
  for (const job of queue) {
    try {
      const holder = await assetHolder(job.assetId);
      if (holder !== vault) {
        // Seed FIRST, while the asset is still theirs to send. Once they have
        // signed the transfer it is too late to save them the fee.
        await seedAsset(jwk, job.assetId, { label: `deposit #${job.seq}` })
          .catch((error) => console.error(`  deposit ${job.assetId}: seed failed: ${error.message}`));
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
const { pid, node: NODE } = liveProcess();
console.log(`minter  ${owner}\nnode    ${NODE}\nprocess ${pid}${DRY ? '\n(dry run)' : ''}`);

if (has('test-mint')) {
  await testMint(jwk, owner, argv[argv.indexOf('--test-mint') + 1]);
  process.exit(0);
}

// Seed one asset by hand. This is the escape hatch for an asset that needs to
// move for a reason the game never hears about — a marketplace listing, say —
// and it is the only place a 0.22 AR premium is paid on a bare instruction.
if (has('seed')) {
  const assetId = flagValue('seed');
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(assetId ?? ''))) {
    console.error('usage: --seed <assetId>');
    process.exit(1);
  }
  const outcome = await seedAsset(jwk, assetId, { label: 'manual' });
  console.log(`seed: ${outcome}`);
  process.exit(0);
}

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
