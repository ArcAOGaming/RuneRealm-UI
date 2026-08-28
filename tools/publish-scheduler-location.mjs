/**
 * publish-scheduler-location.mjs — let a HyperBEAM node be spawned on.
 *
 *   node tools/publish-scheduler-location.mjs <wallet.json> <url> [--dry-run]
 *
 * e.g. on the node itself:
 *   node tools/publish-scheduler-location.mjs /root/.hyperbeam-wallet.json \
 *        https://hyperbeam.tylerw.ai
 *
 * WHY THIS EXISTS
 *
 * Spawning a process sets `scheduler-location` to the node's WALLET ADDRESS,
 * not its URL. Anything that later wants to reach that scheduler has to resolve
 * the address back to a URL, and it does so by looking on Arweave for a signed
 * `Scheduler-Location` record from that wallet. A node with no such record is
 * unreachable as a scheduler — and the failure is nothing like the cause: the
 * spawn dies with a bare `404 not_found`, which reads as a missing HTTP route.
 *
 * This is not a HyperBEAM command. `~scheduler@1.0` exports `schedule`,
 * `router`, `slot`, `status` and `next` — nothing that publishes a location.
 * The record is an ordinary Arweave transaction, and this posts one.
 *
 * The tag set below is copied from a record that demonstrably works
 * (`tWYnOtJo6nQRLK0I7dvMeW4CdIJqt6XPkRa8bJWSfqY`, published by
 * schedule.forward.computer) rather than from documentation.
 *
 * Costs a few winston. Re-running publishes a NEWER record, which is how a
 * node moves URL or extends its TTL; the resolver takes the most recent.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Arweave = require('arweave');

const [walletPath, url] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');

if (!walletPath || !url) {
  console.error('usage: node tools/publish-scheduler-location.mjs <wallet.json> <url> [--dry-run]');
  process.exit(1);
}
if (!/^https?:\/\//.test(url)) {
  console.error(`"${url}" is not a URL. It must be the scheme and host the node answers on.`);
  process.exit(1);
}
if (url.endsWith('/')) {
  // A trailing slash produces double-slashed paths downstream, which some
  // resolvers treat as a different host.
  console.error(`Drop the trailing slash: ${url.replace(/\/+$/, '')}`);
  process.exit(1);
}
if (!fs.existsSync(walletPath)) {
  console.error(`No keyfile at ${walletPath}`);
  process.exit(1);
}

const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });

const address = await arweave.wallets.jwkToAddress(jwk);
const balance = await arweave.wallets.getBalance(address);
console.log(`wallet   ${address}`);
console.log(`balance  ${arweave.ar.winstonToAr(balance)} AR`);
console.log(`url      ${url}`);

// Roughly two years, matching the record this was modelled on.
const TIME_TO_LIVE = '60480000';

const tx = await arweave.createTransaction({ data: 'scheduler-location' }, jwk);
const tags = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Data-Protocol': 'ao',
  'Type': 'Scheduler-Location',
  'Variant': 'ao.N.1',
  'Url': url,
  'Time-To-Live': TIME_TO_LIVE,
  'codec-device': 'ans104@1.0',
  'nonce': '1',
  'ao-types': 'nonce="integer", time-to-live="integer"',
};
for (const [name, value] of Object.entries(tags)) tx.addTag(name, value);

console.log('\ntags:');
for (const [k, v] of Object.entries(tags)) console.log(`  ${k} = ${v}`);
console.log(`\nfee      ${arweave.ar.winstonToAr(tx.reward)} AR`);

if (dryRun) {
  console.log('\n--dry-run: nothing posted.');
  process.exit(0);
}

await arweave.transactions.sign(tx, jwk);
const res = await arweave.transactions.post(tx);
console.log(`\nposted   ${tx.id}  (HTTP ${res.status})`);
if (res.status !== 200 && res.status !== 208) {
  console.error('That is not an accepted status. Nothing is published.');
  process.exit(1);
}

console.log('\nIt is not usable until a gateway has indexed it — a minute or two.');
console.log('Confirm with:');
console.log(`  node tools/publish-scheduler-location.mjs --check ${address}`);
console.log('or the same GraphQL query by owner:');
console.log(`  {transactions(owners:["${address}"],`);
console.log('    tags:[{name:"Type",values:["Scheduler-Location"]}]){edges{node{id}}}}');
