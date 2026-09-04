#!/usr/bin/env node
/**
 * Read or republish this node's Scheduler-Location record.
 *
 *   node backend/native/scheduler-location.mjs status
 *   HB_NODE_WALLET=/path/to/node-key.json node backend/native/scheduler-location.mjs publish
 *
 * WHAT THIS RECORD IS FOR
 *
 * A process is bound to the ADDRESS of the scheduler that spawned it, not to a
 * URL. Every other node resolves that address to a URL by looking up a
 * `Type: Scheduler-Location` transaction signed by the scheduler's wallet, over
 * the gateway's GraphQL. No valid record means no other node can read your
 * process or proxy a write to you — the process is reachable only by callers
 * who already know the hostname.
 *
 * The record carries a `Time-To-Live`. Once it lapses, resolvers treat it as
 * absent. Republishing is therefore routine maintenance, not a one-off.
 *
 * WHY THIS SCRIPT EXISTS
 *
 * On 2026-08-31 the live record read:
 *
 *   url: https://hyperbeam.tylerw.ai   ttl: 60,480,000 ms  (0.70 days)
 *   published 3.78 days ago            -> expired ~3 days earlier
 *
 * while the node's own `scheduler-location-ttl` was 604,800,000 (7 days) — one
 * digit short in whatever published it. `schedule.forward.computer` answered
 * 500 for the process and 404 for its id as a direct consequence.
 *
 * WHAT THE NODE REQUIRES (from dev_scheduler.erl:345-470)
 *
 *   - The request must be SIGNED BY THE OPERATOR. `post_location` compares the
 *     signers against the node's own address; a request signed by anyone else
 *     is filed as a foreign peer's record and never published.
 *   - `nonce` must be strictly greater than the nonce already on Arweave. The
 *     node looks the current one up itself and rejects with 400 otherwise.
 *     Omit it and the node increments for you.
 *   - `url` is taken from the request. Omitted, the node builds one from its
 *     `host`/`port`/`protocol` config, which on a node listening on :10000
 *     behind a proxy produces a URL nobody can reach. Always pass it.
 *   - `time-to-live` is taken from the request, else `scheduler_location_ttl`.
 *
 * The node then builds, signs and uploads its own record. The item is small, so
 * it rides Turbo's free tier — this needs no credits, which is why the expired
 * record published successfully from a wallet that has none.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signDataItem, jwkToAddress } from './ans104.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const command = process.argv[2] || 'status';
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const NODE = flag('--node', process.env.HB_NODE || readNodeUrl());
const GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net';

function readNodeUrl() {
  // live-process.txt is written by deploy.mjs: id, node, owner.
  const file = path.join(ROOT, 'live-process.txt');
  if (fs.existsSync(file)) {
    const line = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)[1];
    if (line) return line.trim();
  }
  return 'https://hyperbeam.tylerw.ai';
}

const days = (ms) => (Number(ms) / 86_400_000).toFixed(2);

/** The operator address this node signs as. */
async function nodeAddress() {
  const res = await fetch(`${NODE}/~meta@1.0/info/address`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${NODE} /~meta@1.0/info/address -> ${res.status}`);
  const body = (await res.text()).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(body)) {
    // A node that does not know the key answers with its HTML index at 200.
    throw new Error(`${NODE} did not return an address (got ${body.slice(0, 60)})`);
  }
  return body;
}

async function configuredTtl() {
  const res = await fetch(`${NODE}/~meta@1.0/info/serialize~json@1.0`,
    { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  try {
    return Number(JSON.parse(await res.text())['scheduler-location-ttl']) || null;
  } catch {
    return null;
  }
}

/** The record as the rest of the world resolves it: newest first, over GraphQL. */
async function publishedRecord(address) {
  const query = `query($owner:String!){
    transactions(owners:[$owner],tags:[{name:"Type",values:["Scheduler-Location"]}],
      sort:HEIGHT_DESC,first:5){ edges{ node{ id block{timestamp} tags{name value} } } }
  }`;
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner: address } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status} from ${GATEWAY}`);
  const edges = (await res.json())?.data?.transactions?.edges ?? [];
  if (edges.length === 0) return null;

  const node = edges[0].node;
  const tags = Object.fromEntries(node.tags.map((t) => [t.name.toLowerCase(), t.value]));
  const ageMs = Date.now() - Number(node.block?.timestamp ?? 0) * 1000;
  const ttlMs = Number(tags['time-to-live'] ?? 0);
  return {
    id: node.id,
    url: tags.url,
    nonce: Number(tags.nonce ?? 0),
    ttlMs,
    ageMs,
    expired: ttlMs > 0 && ageMs > ttlMs,
    // A record still in a block-less state has no timestamp to age against.
    pending: !node.block,
  };
}

async function report() {
  const address = await nodeAddress();
  const ttl = await configuredTtl();
  const record = await publishedRecord(address);

  console.log(`node        ${NODE}`);
  console.log(`operator    ${address}`);
  console.log(`config ttl  ${ttl ?? 'unknown'}${ttl ? ` ms (${days(ttl)} days)` : ''}`);

  if (!record) {
    console.log('published   NONE — no other node can resolve this scheduler');
    return { address, ttl, record: null };
  }
  console.log(`published   ${record.id}`);
  console.log(`  url       ${record.url}`);
  console.log(`  nonce     ${record.nonce}`);
  console.log(`  ttl       ${record.ttlMs} ms (${days(record.ttlMs)} days)`);
  console.log(`  age       ${days(record.ageMs)} days${record.pending ? ' (not yet in a block)' : ''}`);
  console.log(`  status    ${record.expired ? '*** EXPIRED ***' : 'valid'}`);
  if (ttl && record.ttlMs !== ttl) {
    console.log(`  MISMATCH  published ttl is not the configured ttl — republish to correct it`);
  }
  return { address, ttl, record };
}

if (command === 'status') {
  await report();
  process.exit(0);
}

if (command !== 'publish') {
  throw new Error('usage: scheduler-location.mjs status|publish [--node <url>] [--url <url>] [--ttl <ms>]');
}

// publish --------------------------------------------------------------------

const { address, ttl, record } = await report();
console.log('');

const walletFile = process.env.HB_NODE_WALLET;
if (!walletFile) {
  throw new Error(
    'HB_NODE_WALLET must point at the NODE operator keyfile. This is the key the '
    + `node itself signs with (${address}) and it lives on the node host, not in this repo.`,
  );
}
const jwk = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
const signer = jwkToAddress(jwk);
if (signer !== address) {
  // Signed by anyone else, the node files this as a foreign peer's record and
  // silently never publishes it — a 200 that achieved nothing.
  throw new Error(`${walletFile} is ${signer}, but ${NODE} signs as ${address}`);
}

const url = flag('--url', record?.url || NODE);
const timeToLive = String(flag('--ttl', ttl || 604_800_000));
const nonce = String(Number(flag('--nonce', (record?.nonce ?? 0) + 1)));

console.log('republishing:');
console.log(`  url       ${url}`);
console.log(`  ttl       ${timeToLive} ms (${days(timeToLive)} days)`);
console.log(`  nonce     ${nonce}${record ? ` (was ${record.nonce})` : ''}`);

const item = await signDataItem(jwk, {
  data: '',
  tags: [
    { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    { name: 'type', value: 'scheduler-location' },
    { name: 'url', value: url },
    { name: 'time-to-live', value: timeToLive },
    { name: 'nonce', value: nonce },
  ],
});

const res = await fetch(`${NODE}/~scheduler@1.0/location?codec-device=ans104@1.0`, {
  method: 'POST',
  headers: { 'content-type': 'application/ans104', accept: 'application/json' },
  body: Buffer.from(item),
  signal: AbortSignal.timeout(120_000),
});
const body = await res.text();
console.log('');
console.log(`POST /~scheduler@1.0/location -> ${res.status}`);
console.log(body.slice(0, 500));
if (!res.ok) {
  throw new Error(`republish failed with ${res.status}`);
}

console.log('');
console.log('The node signs and uploads its own record, so the new one reaches Arweave');
console.log('through Turbo and needs a minute or two to be indexed. Re-check with:');
console.log('  node backend/native/scheduler-location.mjs status');
