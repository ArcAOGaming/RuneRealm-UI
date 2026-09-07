/**
 * burners.mjs — throwaway wallets for testing.
 *
 *   node backend/native/burners.mjs make 4      # generate four, unlock them
 *   node backend/native/burners.mjs ensure 50   # ensure 50 exist; no live write
 *   node backend/native/burners.mjs list        # show what exists
 *   node backend/native/burners.mjs unlock      # (re)grant access to all of them
 *   node backend/native/burners.mjs unlock 50   # grant burner-01 through -50
 *
 * Keys land in `.burners/` which is gitignored, same as any other keyfile.
 * They hold nothing and are meant to be thrown away: never point a test at a
 * real player's wallet.
 *
 * Unlocking requires the process owner's key (HB_WALLET), because the process
 * refuses Admin.* from anyone else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateWallet, jwkToAddress } from './ans104.mjs';
import { sendMessage, awaitComputedSlot } from './hbclient.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIR = process.env.BURNER_DIR || path.join(ROOT, '.burners');

export function liveProcess() {
  const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
  return { pid: graph.game, node: graph.node, graph };
}

export function listBurners() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    // The swarm also keeps a public address/role manifest beside the keys.
    // Only files with this exact shape are wallets.
    .filter((f) => /^burner-\d+\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => {
      const jwk = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      return { name: path.basename(f, '.json'), file: path.join(DIR, f), jwk, address: jwkToAddress(jwk) };
    });
}

export function loadBurner(name) {
  const found = listBurners().find((b) => b.name === name || b.address === name);
  if (!found) throw new Error(`No burner "${name}". Run: node backend/native/burners.mjs make 4`);
  return found;
}

function validCount(value, label = 'count') {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
    throw new Error(`${label} must be an integer from 1 to 500`);
  }
  return count;
}

function nonNegativeInt(value, fallback, max, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${label} must be an integer from 0 to ${max}`);
  }
  return parsed;
}

function cliOption(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

function writeWallet(name) {
  process.stdout.write(`  generating ${name} (RSA-4096, takes a moment) ... `);
  const jwk = generateWallet();
  const file = path.join(DIR, `${name}.json`);
  // 0600 is enforced on POSIX. Windows ignores the mode but the directory is
  // still local and gitignored; never copy these files into a tracked path.
  fs.writeFileSync(file, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' });
  const address = jwkToAddress(jwk);
  console.log(address);
  return { name, file, jwk, address };
}

/**
 * Retire one burner and leave a fresh, unsworn key in its place.
 *
 * Swearing is irreversible: a wallet that ends up in the wrong faction — a
 * migration carrying an old oath across a redeploy is how it happens — can
 * never be corrected on that process. `seed-monsters` skips it, the swarm
 * reports `blocked.faction-plan`, and the PvP pair it belongs to stops duelling
 * for as long as the key exists.
 *
 * The address is the only thing wrong with it, so the fix is a new address. The
 * old key is archived rather than deleted: it still owns whatever it holds on
 * every process it has ever played, and this repository does not get to destroy
 * that on the operator's behalf.
 */
export function retireBurner(name) {
  if (!/^burner-\d+$/.test(name)) throw new Error(`not a burner name: ${name}`);
  const file = path.join(DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`${name} does not exist`);
  const attic = path.join(DIR, 'retired');
  fs.mkdirSync(attic, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archived = path.join(attic, `${name}.${stamp}.json`);
  const previous = jwkToAddress(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.renameSync(file, archived);
  const made = writeWallet(name);
  return { name, previous, address: made.address, archived };
}

export function makeBurners(value) {
  const count = validCount(value);
  fs.mkdirSync(DIR, { recursive: true });
  const next = listBurners().reduce((highest, burner) => {
    const index = Number(burner.name.slice('burner-'.length));
    return Math.max(highest, index);
  }, 0) + 1;
  const made = [];
  for (let i = 0; i < count; i++) {
    const name = `burner-${String(next + i).padStart(2, '0')}`;
    made.push(writeWallet(name));
  }
  return made;
}

/** Ensure burner-01 through burner-N exist without touching the live process. */
export function ensureBurners(value) {
  const count = validCount(value, 'total');
  fs.mkdirSync(DIR, { recursive: true });
  const existing = new Set(listBurners().map((burner) => burner.name));
  const made = [];
  for (let i = 1; i <= count; i++) {
    const name = `burner-${String(i).padStart(2, '0')}`;
    if (!existing.has(name)) made.push(writeWallet(name));
  }
  return made;
}

export async function unlockBurners(addresses) {
  const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Owner keyfile not found at ${walletPath}. Set HB_WALLET.`);
  }
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const { pid, node } = liveProcess();
  console.log(`\nunlocking ${addresses.length} address(es) on ${pid}`);
  const sent = await sendMessage({
    node, jwk, process: pid, action: 'Admin.Unlock',
    data: JSON.stringify({ addresses }),
  });
  // Read the reply back BY ITS SLOT. `/now/results/output/data` holds whatever
  // the process computed most RECENTLY, which with anyone else playing is
  // somebody else's reply — this printed a stranger's User.Info once.
  const slot = sent && sent.slot;
  if (slot === undefined || slot === null) {
    throw new Error('Admin.Unlock did not report a compute slot; access was not verified');
  }
  // Head first, slot second. Addressing an uncomputed slot is served without
  // the live worker's `priv` and re-initialises the Luerl VM, emptying
  // `Players` while the published map carries on looking complete. See
  // `awaitComputedSlot` in hbclient.mjs.
  await awaitComputedSlot({ node, process: pid, slot, attempts: 40, delayMs: 500 });

  let body = '';
  for (let i = 0; slot !== undefined && slot !== null && i < 40; i++) {
    const r = await fetch(
      `${node}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`,
      { headers: { accept: 'text/plain' } },
    );
    if (r.ok) { body = (await r.text()).trim(); break; }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!body) throw new Error(`Admin.Unlock slot ${slot} did not return a reply`);
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    throw new Error(`Admin.Unlock returned a non-JSON reply: ${body.slice(0, 160)}`);
  }
  if (reply.error) throw new Error(`Admin.Unlock failed: ${reply.error}`);
  if (Number(reply.total) !== addresses.length) {
    throw new Error(`Admin.Unlock verified ${reply.total ?? 0}/${addresses.length} addresses`);
  }
  console.log(`  -> ${reply.added ?? 0} added, ${reply.alreadyUnlocked ?? 0} already unlocked`);
  return reply;
}

/**
 * Give the live-test roster enough reversible inventory to reach every path.
 * This calls the contract's testing-only top-up; it is unavailable forever
 * after economy activation and Gold comes from the conserved locked reserve.
 */
export async function fundBurners(addresses, {
  rune = 100, scroll = 20, gold = 1000,
  berries = 25, boxes = 3, boxRarity = 2, extraMonsters = 2,
  pid: selectedPid, node: selectedNode, walletPath: selectedWalletPath,
} = {}) {
  const targets = {
    rune: nonNegativeInt(rune, 100, 100, 'rune'),
    scroll: nonNegativeInt(scroll, 20, 20, 'scroll'),
    gold: nonNegativeInt(gold, 1000, 5000, 'gold'),
    berries: nonNegativeInt(berries, 25, 50, 'berries'),
    boxes: nonNegativeInt(boxes, 3, 5, 'boxes'),
    boxRarity: nonNegativeInt(boxRarity, 2, 5, 'box-rarity'),
    extraMonsters: nonNegativeInt(extraMonsters, 2, 4, 'extra-monsters'),
  };
  if (targets.boxRarity < 1) throw new Error('box-rarity must be an integer from 1 to 5');
  const walletPath = selectedWalletPath || process.env.HB_WALLET
    || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Owner keyfile not found at ${walletPath}. Set HB_WALLET.`);
  }
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const live = selectedPid && selectedNode
    ? { pid: selectedPid, node: selectedNode }
    : liveProcess();
  const { pid, node } = live;
  console.log(`\nfunding ${addresses.length} test address(es) on ${pid}`);
  console.log(`minimums  ${targets.rune} Rune, ${targets.scroll} Scroll, ${targets.gold} Gold, `
    + `${targets.berries} of each berry, ${targets.boxes} tier-${targets.boxRarity} boxes, `
    + `${targets.extraMonsters} stored companions`);
  const sent = await sendMessage({
    node, jwk, process: pid, action: 'Admin.Economy.FundTestBots',
    data: JSON.stringify({ addresses, ...targets }),
  });
  const slot = sent?.slot;
  if (slot === undefined || slot === null) {
    throw new Error('Admin.Economy.FundTestBots did not report a compute slot');
  }
  await awaitComputedSlot({ node, process: pid, slot, attempts: 60, delayMs: 1_000 });
  let reply = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(
      `${node}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`,
      // This endpoint is a JSON *value* stored in a plain HyperBEAM leaf, not
      // a JSON-interface object.  Asking the node to content-negotiate it as
      // application/json can yield the interface's empty object (`{}`), which
      // is valid JSON but is not the handler reply.  Admin.Unlock and deploy's
      // sendAndSettle already use text/plain for the same reason.
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(45_000) },
    ).catch(() => null);
    if (response?.ok) {
      const body = (await response.text()).trim();
      if (body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        try { reply = JSON.parse(body); } catch { /* retry */ }
      }
      if (reply) break;
    }
    await new Promise((done) => setTimeout(done, 1_000));
  }
  if (!reply) throw new Error(`test funding slot ${slot} did not return a JSON reply`);
  if (reply.error) throw new Error(`test funding failed: ${reply.error}`);
  if (Number(reply.funded) !== addresses.length) {
    throw new Error(`test funding reported ${reply.funded ?? 0}/${addresses.length} wallets`);
  }
  console.log(`  -> ${reply.funded} wallets verified by the contract`);
  return reply;
}

// This file is also imported by e2e.mjs for `listBurners`/`loadBurner`, so the
// CLI only runs when it is what was invoked.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

const [cmd, arg] = invokedDirectly ? process.argv.slice(2) : ['__library__'];
if (cmd === '__library__') {
  // imported, not run
} else
if (cmd === 'make') {
  const made = makeBurners(arg || 1);
  if (!process.argv.includes('--no-unlock')) {
    await unlockBurners(made.map((m) => m.address));
  }
  console.log('\nReady. Run a journey with:');
  console.log(`  node backend/native/e2e.mjs ${made[0].name}`);
} else if (cmd === 'ensure') {
  const made = ensureBurners(arg || 50);
  const all = listBurners().filter((burner) => {
    const index = Number(burner.name.slice('burner-'.length));
    return index <= Number(arg || 50);
  });
  console.log(`\n${made.length ? `Created ${made.length}; ` : ''}${all.length} burner wallets are present.`);
  if (process.argv.includes('--unlock')) {
    await unlockBurners(all.map((burner) => burner.address));
  } else {
    console.log('No live process was changed. Add --unlock when that is intended.');
  }
} else if (cmd === 'unlock') {
  const all = listBurners();
  if (!all.length) throw new Error('No burners yet. Run: node backend/native/burners.mjs make 4');
  const selected = arg ? all.filter((burner) => {
    const index = Number(burner.name.slice('burner-'.length));
    return index <= validCount(arg, 'total');
  }) : all;
  if (arg && selected.length !== Number(arg)) {
    throw new Error(`Expected burner-01 through burner-${String(arg).padStart(2, '0')}; found ${selected.length}`);
  }
  await unlockBurners(selected.map((b) => b.address));
} else if (cmd === 'fund') {
  const all = listBurners();
  if (!all.length) throw new Error('No burners yet. Run: node backend/native/burners.mjs ensure 50');
  const total = arg ? validCount(arg, 'total') : all.length;
  const selected = all.filter((burner) =>
    Number(burner.name.slice('burner-'.length)) <= total);
  if (selected.length !== total) {
    throw new Error(`Expected burner-01 through burner-${String(total).padStart(2, '0')}; found ${selected.length}`);
  }
  await fundBurners(selected.map((burner) => burner.address), {
    rune: cliOption('rune', 100), scroll: cliOption('scroll', 20),
    gold: cliOption('gold', 1000),
    berries: cliOption('berries', 25), boxes: cliOption('boxes', 3),
    boxRarity: cliOption('box-rarity', 2),
    extraMonsters: cliOption('extra-monsters', 2),
  });
} else if (cmd === 'retire') {
  if (!arg) throw new Error('usage: burners.mjs retire burner-02');
  const { previous, address, archived } = retireBurner(arg);
  console.log(`\n${arg} retired.`);
  console.log(`  was  ${previous}`);
  console.log(`  now  ${address}`);
  console.log(`  old key archived at ${archived}`);
  console.log('\nIt is unsworn and locked on every process. Next:');
  console.log('  npm run swarm:unlock && npm run seed:monsters');
} else if (cmd === 'list' || !cmd) {
  const all = listBurners();
  const { pid, node } = liveProcess();
  console.log(`process ${pid}\nnode    ${node}\n`);
  if (!all.length) {
    console.log('No burners. Create some: node backend/native/burners.mjs make 4');
  }
  for (const b of all) console.log(`  ${b.name}  ${b.address}`);
} else {
  console.error('usage: burners.mjs [make <n> [--no-unlock] | ensure <total> [--unlock] | unlock [total] | fund [total] [--rune N --scroll N --gold N --berries N --boxes N --box-rarity N --extra-monsters N] | retire <name> | list]');
  process.exit(1);
}
