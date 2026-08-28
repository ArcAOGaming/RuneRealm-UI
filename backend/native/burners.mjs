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
import { sendMessage } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIR = process.env.BURNER_DIR || path.join(ROOT, '.burners');

export function liveProcess() {
  const file = path.join(ROOT, 'live-process.txt');
  if (process.env.GAME_PROCESS && process.env.NODE_URL) {
    return { pid: process.env.GAME_PROCESS, node: process.env.NODE_URL };
  }
  if (!fs.existsSync(file)) {
    throw new Error('No live-process.txt — run backend/native/deploy.mjs first.');
  }
  const [pid, node] = fs.readFileSync(file, 'utf8').trim().split('\n');
  return { pid: process.env.GAME_PROCESS || pid, node: process.env.NODE_URL || node };
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
} else if (cmd === 'list' || !cmd) {
  const all = listBurners();
  const { pid, node } = liveProcess();
  console.log(`process ${pid}\nnode    ${node}\n`);
  if (!all.length) {
    console.log('No burners. Create some: node backend/native/burners.mjs make 4');
  }
  for (const b of all) console.log(`  ${b.name}  ${b.address}`);
} else {
  console.error('usage: burners.mjs [make <n> [--no-unlock] | ensure <total> [--unlock] | unlock [total] | list]');
  process.exit(1);
}
