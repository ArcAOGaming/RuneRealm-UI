/**
 * Re-apply the test-fleet funding minimums to a named process.
 *
 * `redeploy.mjs` does this as part of a deployment; this exists for the case
 * where the process is already standing and only the wallets need topping up,
 * which is what a fleet looks like after a few soak runs have spent it.
 *
 * Takes the process id on the command line rather than from
 * `live-process.txt`, deliberately: that file names the newest deployment, and
 * the process you want to refund is not always the newest one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const pid = process.argv[2];
const node = process.argv[3] || 'https://hyperbeam.tylerw.ai';
if (!/^[A-Za-z0-9_-]{43}$/.test(pid || '')) {
  throw new Error('usage: node .refund.tmp.mjs <process-id> [node-url]');
}
const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

const FUNDING = { rune: 100, scroll: 20, gold: 1000 };
const addresses = listBurners().map((b) => b.address);
console.log(`funding ${addresses.length} wallets on ${pid}`);
console.log(`  ${JSON.stringify(FUNDING)}\n`);

const { slot } = await sendMessage({
  node, jwk, process: pid,
  action: 'Admin.Economy.FundTestBots',
  tags: { Action: 'Admin.Economy.FundTestBots' },
  data: JSON.stringify({ addresses, ...FUNDING }),
});
console.log(`scheduled at slot ${slot}`);

// Read the handler's own answer, not the fact that a message was accepted.
const res = await fetch(`${node}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`);
console.log(`reply ${res.status}: ${(await res.text()).slice(0, 300)}`);

// Then read a record back, because a reply is a claim and published state is
// the truth -- this is the same check `redeploy.mjs` makes after funding.
for (const address of addresses.slice(0, 3)) {
  const r = await fetch(`${node}/${pid}~process@1.0/now/player-${address}`);
  const text = await r.text();
  if (!r.ok || text.trimStart().startsWith('<')) { console.log(`${address} unreadable`); continue; }
  const p = JSON.parse(text);
  console.log(`${address.slice(0, 12)}  rune=${p.inventory?.rune ?? 0}  `
    + `scroll=${p.inventory?.scroll ?? 0}  gold=${p.gold ?? 0}`);
}
