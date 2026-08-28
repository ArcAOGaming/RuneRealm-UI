/**
 * recover-unlocked.mjs — pull the paid-access list out of the dead legacynet
 * process, without touching legacynet.
 *
 *   node backend/native/recover-unlocked.mjs
 *
 * The old PremPass process (j7Ncra...) is unreachable: the CU and SU both
 * refuse it. What IS reachable is its public Arweave checkpoints, which are
 * ordinary transactions anyone can download from a gateway. A checkpoint is a
 * gzipped image of the aos WASM linear memory, and `Unlocked` — the list of
 * addresses that paid for an Eternal Pass — is a plain Lua array inside it.
 *
 * Carving it out by grepping for 43-character base64url strings does not work:
 * the heap holds ~18,000 of them, nearly all message ids, transaction ids and
 * dead copies. So this walks the actual Lua data structures instead:
 *
 *   1. Find every Lua long-string object holding a 43-char base64url value.
 *      In this build a TString is 24 bytes of header followed by the bytes,
 *      with the type byte (LUA_TLNGSTR = 0x14) 16 back from the data and the
 *      length 8 back. Both are checked, so a random run of base64 in a JSON
 *      blob is rejected.
 *
 *   2. Scan the whole image as 32-bit words for pointers to those objects.
 *
 *   3. A Lua TValue is 16 bytes, so an ARRAY of strings shows up as pointers at
 *      a stride of four words. Exactly one such run exists in the image, 168
 *      entries long, and it contains no process ids — that is `Unlocked`.
 *
 * The offsets above were measured against this specific checkpoint (a
 * histogram of the bytes preceding known strings), not assumed from Lua's
 * source. If you re-run this against a checkpoint built by a different aos
 * module, re-measure: HEADER and TT_BACK are the two numbers that matter.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROCESS = process.env.OLD_PROCESS || 'j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI';
const GATEWAY = process.env.GATEWAY || 'https://arweave.net';
const GQL = process.env.GQL || 'https://arweave-search.goldsky.com/graphql';
const CACHE = process.env.CHECKPOINT_CACHE || path.join(HERE, '.checkpoint-cache');

// Measured against the aos module Do_Uc2Sju_... — see the header comment.
const HEADER = 24;    // bytes from the start of the object to the string data
const TT_BACK = 16;   // bytes back from the data to the type byte
const LUA_TLNGSTR = 0x14;
const LEN_BACK = 8;   // bytes back from the data to the 32-bit length
const TVALUE_WORDS = 4;

async function latestCheckpoint() {
  const query = `{transactions(
      tags:[{name:"Process",values:["${PROCESS}"]},{name:"Type",values:["Checkpoint"]}],
      first:5, sort:HEIGHT_DESC
    ){edges{node{id tags{name value}}}}}`;
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  const edges = body?.data?.transactions?.edges ?? [];
  if (!edges.length) throw new Error(`No checkpoints found for ${PROCESS}`);
  const node = edges[0].node;
  const tag = (n) => node.tags.find((t) => t.name === n)?.value;
  return { id: node.id, nonce: tag('Nonce'), timestamp: Number(tag('Timestamp')) };
}

async function fetchMemory(id) {
  fs.mkdirSync(CACHE, { recursive: true });
  const gz = path.join(CACHE, `${id}.gz`);
  if (!fs.existsSync(gz)) {
    console.log(`downloading checkpoint ${id} ...`);
    const res = await fetch(`${GATEWAY}/${id}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    fs.writeFileSync(gz, Buffer.from(await res.arrayBuffer()));
  }
  const raw = fs.readFileSync(gz);
  // The checkpoint is stored gzipped AND tagged `Content-Encoding: gzip`, so a
  // gateway sets that header and fetch() transparently inflates it — meaning
  // what lands on disk may already be the raw image. Decide by the magic bytes
  // rather than by the filename.
  const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
  console.log(`checkpoint ${(raw.length / 1048576).toFixed(1)} MB` +
    (gzipped ? ' compressed' : ' (already inflated by the gateway)'));
  const mem = gzipped
    ? zlib.gunzipSync(raw, { maxOutputLength: 512 * 1024 * 1024 })
    : raw;
  console.log(`memory image ${(mem.length / 1048576).toFixed(1)} MB`);
  return mem;
}

const B64 = new Uint8Array(256);
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
  B64[c.charCodeAt(0)] = 1;
}

/** Every Lua long-string object in the image whose value is a 43-char address. */
function findStringObjects(mem) {
  const byAddress = new Map();
  for (let i = 0; i + 43 <= mem.length; i++) {
    if (!B64[mem[i]]) continue;
    // Must be exactly 43 long: bounded by a non-base64url byte on both sides.
    if (i > 0 && B64[mem[i - 1]]) continue;
    let j = i;
    while (j < mem.length && B64[mem[j]]) j++;
    if (j - i !== 43) { i = j - 1; continue; }
    if (i < HEADER) continue;
    if (mem[i - TT_BACK] !== LUA_TLNGSTR) continue;
    if (mem.readUInt32LE(i - LEN_BACK) !== 43) continue;
    byAddress.set(i - HEADER, mem.toString('latin1', i, j));
  }
  return byAddress;
}

/** Pointer slots, as word indices, that point at one of those objects. */
function findPointerSlots(mem, byAddress) {
  const slots = [];
  const words = Math.floor(mem.length / 4);
  for (let w = 0; w < words; w++) {
    if (byAddress.has(mem.readUInt32LE(w * 4))) slots.push(w);
  }
  return slots;
}

/** Contiguous stride-4 runs — a Lua table's array part. */
function findRuns(slots, minLength) {
  const runs = [];
  let cur = [slots[0]];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] - slots[i - 1] === TVALUE_WORDS) cur.push(slots[i]);
    else { if (cur.length >= minLength) runs.push(cur); cur = [slots[i]]; }
  }
  if (cur.length >= minLength) runs.push(cur);
  return runs.sort((a, b) => b.length - a.length);
}

const meta = await latestCheckpoint();
console.log(`latest checkpoint: ${meta.id}`);
console.log(`  nonce ${meta.nonce}, ${new Date(meta.timestamp).toISOString()}`);

const mem = await fetchMemory(meta.id);
const byAddress = findStringObjects(mem);
console.log(`verified Lua string objects holding a 43-char address: ${byAddress.size}`);

const slots = findPointerSlots(mem, byAddress);
console.log(`pointers to them: ${slots.length}`);

const runs = findRuns(slots, 5);
console.log(`string arrays (stride-4 runs of 5+): ${runs.length}`);

if (!runs.length) {
  console.error('\nNo string array found. The heap layout of this checkpoint does');
  console.error('not match HEADER/TT_BACK — re-measure before trusting anything.');
  process.exit(1);
}

const best = runs[0];
const addresses = [...new Set(best.map((w) => byAddress.get(mem.readUInt32LE(w * 4))))];
for (const run of runs.slice(1)) {
  console.log(`  (also saw a ${run.length}-entry array, ignored)`);
}

// A process id in the list would mean the run is something other than Unlocked.
const PROCESS_IDS = new Set([
  PROCESS,
  '3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs',
  'GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ',
  '4trQXXADjEPc8yVsGhyfmfv5EpY8dh9gBW3BujzMyB8',
]);
const contaminated = addresses.filter((a) => PROCESS_IDS.has(a));
if (contaminated.length) {
  console.error(`\nThis array contains process ids (${contaminated.join(', ')}).`);
  console.error('It is not the Unlocked list. Inspect before using it.');
  process.exit(1);
}

const out = path.join(HERE, 'unlocked-recovered.json');
fs.writeFileSync(out, JSON.stringify(addresses, null, 1) + '\n');
console.log(`\nrecovered ${addresses.length} unlocked addresses -> ${path.basename(out)}`);
console.log('\nThis is evidence, not truth. Reconcile it against the owner\'s own');
console.log('records with:  node backend/native/merge-paid.mjs <their-list>');
