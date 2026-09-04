/**
 * TEST-HyperDB real-node benchmark.
 *
 * This is intentionally not a game benchmark. It gives multiple real signers
 * a database-shaped workload, routes each signer directly to one shard, and
 * batches many row updates into each message. Direct POST /push is the default;
 * the lower-level schedule + compute flow remains as a comparison mode.
 *
 *   node backend/native/hyperdb/benchmark.mjs
 *   node backend/native/hyperdb/benchmark.mjs --shards 8 --writers 32 --ops 500
 *
 * The default target is localhost and a non-local node requires the explicit
 * --allow-remote flag. Every spawned process is named TEST-HyperDB.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  commit, hbError, nodeAddress, send, spawnProcess,
} from '../hbclient.mjs';
import { signDataItem } from '../ans104.mjs';
import { listBurners } from '../burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'store.lua'), 'utf8');

if (process.argv.includes('--help')) {
  console.log(`TEST-HyperDB real-node benchmark

Options:
  --node URL          HyperBEAM node (default http://localhost:8734)
  --shards N          independent process lanes (default 4)
  --writers N         concurrent throwaway signers (default 16)
  --batches N         sequential messages per writer (default 8)
  --ops N             row updates per message, max 5000 (default 250)
  --keyspace N        retained keys per writer (default min(ops, 250))
  --value-bytes N     bytes per value, max 4096 (default 32)
  --transport MODE    push (one request, default) or split (schedule + compute)
  --codec CODEC       ans104 (browser path, default) or httpsig
  --timeout-ms N      compute request timeout (default 300000)
  --json              machine-readable report
  --allow-remote      permit TEST- process creation off localhost`);
  process.exit(0);
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function positiveInt(name, fallback, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

const NODE = String(option('--node', process.env.NODE_URL || 'http://localhost:8734'))
  .replace(/\/$/, '');
const parsedNode = new URL(NODE);
const localNames = new Set(['localhost', '127.0.0.1', '[::1]']);
if (!localNames.has(parsedNode.hostname) && !process.argv.includes('--allow-remote')) {
  throw new Error('Refusing to create benchmark processes on a non-local node without --allow-remote');
}

const SHARDS = positiveInt('--shards', 4, 64);
const WRITERS = positiveInt('--writers', 16, 500);
const BATCHES = positiveInt('--batches', 8, 1000);
const OPS = positiveInt('--ops', 250, 5000);
const KEYSPACE = positiveInt('--keyspace', Math.min(OPS, 250), 5000);
const VALUE_BYTES = positiveInt('--value-bytes', 32, 4096);
const REQUEST_TIMEOUT_MS = positiveInt('--timeout-ms', 300000, 3600000);
const JSON_OUTPUT = process.argv.includes('--json');
const TRANSPORT = String(option('--transport', 'push')).toLowerCase();
if (!['push', 'split'].includes(TRANSPORT)) {
  throw new Error('--transport must be push or split');
}
const CODEC = String(option('--codec', 'ans104')).toLowerCase();
if (!['ans104', 'httpsig'].includes(CODEC)) {
  throw new Error('--codec must be ans104 or httpsig');
}

const burners = listBurners();
if (burners.length < WRITERS) {
  throw new Error(
    `TEST-HyperDB needs ${WRITERS} throwaway signers, but found ${burners.length}. `
      + `Run: node backend/native/burners.mjs ensure ${WRITERS}`,
  );
}
const actors = burners.slice(0, WRITERS);
const owner = actors[0];

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const valueFor = (writer, batch, index) => {
  const prefix = `w${writer}-b${batch}-k${index}-`;
  if (prefix.length >= VALUE_BYTES) return prefix.slice(0, VALUE_BYTES);
  return prefix + 'x'.repeat(VALUE_BYTES - prefix.length);
};

function batchData(writer, batch) {
  const lines = new Array(OPS);
  for (let index = 0; index < OPS; index += 1) {
    const key = `writer/${writer}/key/${index % KEYSPACE}`;
    lines[index] = `P\t${key}\t${valueFor(writer, batch, index)}`;
  }
  return lines.join('\n');
}

function message(pid, writer, batch, data) {
  return {
    target: pid,
    type: 'Message',
    subject: 'self',
    action: 'Db.Batch',
    txid: `bench/${runId}/${writer}/${batch}`,
    data,
    'random-seed': `${runId}-${writer}-${batch}`,
  };
}

async function prepareMessage(msg, jwk) {
  if (CODEC === 'httpsig') return commit(msg, jwk);
  const { target, data, ...fields } = msg;
  const tags = [
    { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    ...Object.entries(fields).map(([name, value]) => ({ name, value: String(value) })),
  ];
  return {
    headers: { 'content-type': 'application/ans104' },
    body: await signDataItem(jwk, { target, data, tags }),
  };
}

const codecQuery = () => CODEC === 'ans104' ? '?codec-device=ans104@1.0' : '';

function percentile(values, fraction) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(fraction * ordered.length))];
}

const round = (value) => Math.round(value * 10) / 10;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function computeSlot(pid, slot) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(
      `${NODE}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`,
      { headers: { accept: 'application/json, text/plain' }, signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`compute ${pid} slot ${slot} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  return { value, ms: performance.now() - started };
}

async function readPublished(pid) {
  const started = performance.now();
  const response = await fetch(`${NODE}/${pid}~process@1.0/now/hyperdb`, {
    headers: { accept: 'application/json, text/plain' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`published read ${pid} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  if (value?.name !== 'TEST-HyperDB') {
    throw new Error(`published read ${pid} returned an invalid summary: ${text.slice(0, 300)}`);
  }
  return performance.now() - started;
}

async function schedulePrepared(pid, prepared) {
  const started = performance.now();
  let response;
  let retries = 0;
  for (;;) {
    response = await send(
      NODE,
      `/${pid}~process@1.0/schedule${codecQuery()}`,
      'POST',
      prepared.headers,
      prepared.body,
    );
    if (response.status !== 429 || retries >= 8) break;
    // A 429 is an explicit pre-admission refusal, so replaying the exact signed
    // item is safe. Count the wait as scheduler latency: hiding it would make
    // the reported capacity better than users actually receive.
    retries += 1;
    const retryAfter = Number(response.headers['retry-after']);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2000, 100 * (2 ** (retries - 1)));
    await delay(waitMs);
  }
  const ms = performance.now() - started;
  if (response.status !== 200) {
    throw new Error(`schedule returned ${response.status}: ${hbError(response)}`);
  }
  const slot = Number(response.headers.slot);
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new Error(`schedule accepted a message without a usable slot: ${response.headers.slot}`);
  }
  return { slot, ms, retries };
}

function directOutput(response) {
  const body = response.body.toString();
  const part = body.match(
    /content-disposition: form-data;name="(?:results\/)?output"\r\n([\s\S]*?)(?=\r\n--)/i,
  )?.[1];
  const headerValue = part?.match(/(?:^|\r\n)data: ([^\r\n]*)/)?.[1];
  const inlineValue = body.match(
    /content-disposition: form-data;name="(?:results\/)?output\/data"\r\n\r\n([\s\S]*?)(?=\r\n--)/i,
  )?.[1];
  const text = headerValue ?? inlineValue;
  if (text === undefined) {
    throw new Error(`direct push returned no output data: ${body.slice(0, 500)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function pushPrepared(pid, prepared) {
  const started = performance.now();
  let response;
  let retries = 0;
  for (;;) {
    response = await send(
      NODE,
      `/${pid}~process@1.0/push${codecQuery()}`,
      'POST',
      prepared.headers,
      prepared.body,
    );
    if (response.status !== 429 || retries >= 8) break;
    // TEST-HyperDB's txid makes replay idempotent even if a future node emits
    // a late 429 after admission. Current nodes reject at the admission gate.
    retries += 1;
    const retryAfter = Number(response.headers['retry-after']);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2000, 100 * (2 ** (retries - 1)));
    await delay(waitMs);
  }
  const ms = performance.now() - started;
  if (response.status !== 200) {
    throw new Error(`direct push returned ${response.status}: ${hbError(response)}`);
  }
  const slot = Number(response.headers.slot);
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new Error(`direct push returned no usable slot: ${response.headers.slot}`);
  }
  return { slot, ms, retries, value: directOutput(response) };
}

async function scheduleAndCompute(pid, msg, jwk) {
  const prepared = await prepareMessage(msg, jwk);
  const scheduled = await schedulePrepared(pid, prepared);
  const computed = await computeSlot(pid, scheduled.slot);
  return { scheduled, computed };
}

if (!JSON_OUTPUT) {
  console.log('TEST-HyperDB — sharded, batched, multi-writer HyperBEAM benchmark');
  console.log(`node      ${NODE}`);
  console.log(`transport ${TRANSPORT === 'push' ? 'POST /push (schedule + compute + reply)' : 'POST /schedule then GET /compute'}`);
  console.log(`codec     ${CODEC}`);
  console.log(`workload  ${SHARDS} shards, ${WRITERS} writers, ${BATCHES} batches/writer, ${OPS} ops/batch`);
  console.log(`total     ${(WRITERS * BATCHES).toLocaleString()} messages / `
    + `${(WRITERS * BATCHES * OPS).toLocaleString()} row updates\n`);
}

// Ask the node before spawning so an unavailable local service fails without
// producing any process definitions.
const scheduler = await nodeAddress(NODE);

const spawnStarted = performance.now();
const processIds = [];
for (let index = 0; index < SHARDS; index += 1) {
  let pid;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    try {
      pid = await spawnProcess({
        node: NODE,
        jwk: owner.jwk,
        lua: SOURCE,
        scheduler,
        name: `TEST-HyperDB shard ${index + 1}/${SHARDS}`,
        ticker: 'TEST-HDB',
      });
      break;
    } catch (error) {
      if (!/429|rate limit/i.test(String(error?.message || error)) || attempt === 8) throw error;
      await delay(Math.min(2000, 250 * (attempt + 1)));
    }
  }
  processIds.push(pid);
  // Process creation is not under test and all spawns share one owner signer.
  // Pace this control phase so its limiter does not contaminate the workload.
  if (index + 1 < SHARDS) await delay(250);
}

// Slot zero is the process definition itself. Warm every executor and make
// sure the contract can answer before timing user traffic.
await Promise.all(processIds.map(async (pid) => {
  const boot = await computeSlot(pid, 0);
  if (!boot.value?.ok || boot.value?.action !== 'db.stats') {
    throw new Error(`TEST-HyperDB ${pid} booted with an invalid reply: ${JSON.stringify(boot.value)}`);
  }
}));
const spawnWarmMs = performance.now() - spawnStarted;

// Build and sign outside the timed network run. In production these signatures
// are made on different users' machines; serializing them in this one Node.js
// event loop would falsely charge local RSA work to HyperBEAM throughput.
const signStarted = performance.now();
const work = [];
for (let writer = 0; writer < actors.length; writer += 1) {
  const actor = actors[writer];
  const shard = writer % SHARDS;
  const pid = processIds[shard];
  const writerWork = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const data = batchData(writer, batch);
    const msg = message(pid, writer, batch, data);
    const prepared = await prepareMessage(msg, actor.jwk);
    writerWork.push({ actor: actor.address, writer, batch, shard, pid, txid: msg.txid, prepared });
  }
  work.push(writerWork);
}
const signMs = performance.now() - signStarted;

const observations = [];
const runStarted = performance.now();
await Promise.all(work.map(async (writerWork) => {
  // One outstanding write per person, like an interactive client. Different
  // people run concurrently; a person preserves their own program order.
  for (const item of writerWork) {
    const started = performance.now();
    let scheduled;
    let computed;
    let pushed;
    if (TRANSPORT === 'push') pushed = await pushPrepared(item.pid, item.prepared);
    else {
      scheduled = await schedulePrepared(item.pid, item.prepared);
      computed = await computeSlot(item.pid, scheduled.slot);
    }
    const totalMs = performance.now() - started;
    const reply = pushed?.value ?? computed?.value;
    if (!reply?.ok || reply.action !== 'db.batch' || reply.applied !== OPS
        || reply.txid !== item.txid || reply.writer !== item.actor) {
      throw new Error(`writer ${item.writer} batch ${item.batch} returned ${JSON.stringify(reply)}`);
    }
    observations.push({
      writer: item.writer,
      shard: item.shard,
      slot: pushed?.slot ?? scheduled.slot,
      admissionRetries: pushed?.retries ?? scheduled.retries,
      pushMs: pushed?.ms,
      scheduleMs: scheduled?.ms,
      computeMs: computed?.ms,
      totalMs,
    });
  }
}));
const wallMs = performance.now() - runStarted;

// Verify using the lower-level exact-slot API outside the timed interval. The
// direct push path already completed each update and found no outbox to fan out.
const shardStats = await Promise.all(processIds.map(async (pid, shard) => {
  const { computed } = await scheduleAndCompute(pid, {
    target: pid,
    type: 'Message',
    subject: 'self',
    action: 'Db.Stats',
    'random-seed': `verify-${runId}-${shard}`,
  }, owner.jwk);
  return computed.value?.state;
}));

const pushTimes = observations.flatMap((row) => row.pushMs === undefined ? [] : [row.pushMs]);
const scheduleTimes = observations.flatMap((row) => row.scheduleMs === undefined ? [] : [row.scheduleMs]);
const computeTimes = observations.flatMap((row) => row.computeMs === undefined ? [] : [row.computeMs]);
const totalTimes = observations.map((row) => row.totalMs);
const totalOps = WRITERS * BATCHES * OPS;
const expectedWrites = totalOps;
const observedWrites = shardStats.reduce((sum, state) => sum + Number(state?.writes || 0), 0);
if (observedWrites !== expectedWrites) {
  throw new Error(`verification saw ${observedWrites} writes; expected ${expectedWrites}`);
}

const publishedReadTimes = [];
for (let sample = 0; sample < 5; sample += 1) {
  publishedReadTimes.push(...await Promise.all(processIds.map(readPublished)));
}

const phase = (values) => ({
  p50: round(percentile(values, 0.50)),
  p90: round(percentile(values, 0.90)),
  p99: round(percentile(values, 0.99)),
  max: round(Math.max(...values)),
});
const report = {
  name: 'TEST-HyperDB',
  node: NODE,
  scheduler,
  processIds,
  workload: {
    transport: TRANSPORT,
    codec: CODEC,
    shards: SHARDS,
    writers: WRITERS,
    batchesPerWriter: BATCHES,
    operationsPerBatch: OPS,
    keyspacePerWriter: KEYSPACE,
    valueBytes: VALUE_BYTES,
    messages: observations.length,
    operations: totalOps,
  },
  timingsMs: {
    spawnAndWarm: round(spawnWarmMs),
    preSign: round(signMs),
    measuredWall: round(wallMs),
    directPush: pushTimes.length ? phase(pushTimes) : null,
    schedule: scheduleTimes.length ? phase(scheduleTimes) : null,
    computeAndQueue: computeTimes.length ? phase(computeTimes) : null,
    roundTrip: phase(totalTimes),
    publishedRead: phase(publishedReadTimes),
  },
  throughput: {
    messagesPerSecond: round(observations.length / (wallMs / 1000)),
    operationsPerSecond: round(totalOps / (wallMs / 1000)),
  },
  verifiedWrites: observedWrites,
  admissionRetries: observations.reduce((sum, row) => sum + row.admissionRetries, 0),
  shardStats,
};

if (JSON_OUTPUT) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`spawned   ${processIds.length} TEST- processes in ${report.timingsMs.spawnAndWarm} ms`);
  console.log(`pre-sign  ${observations.length} messages in ${report.timingsMs.preSign} ms (excluded)\n`);
  console.log(`${'phase'.padEnd(22)} ${'p50'.padStart(10)} ${'p90'.padStart(10)} `
    + `${'p99'.padStart(10)} ${'max'.padStart(10)}`);
  const rows = TRANSPORT === 'push'
    ? [
      ['direct push + reply', report.timingsMs.directPush],
      ['published state GET', report.timingsMs.publishedRead],
    ]
    : [
      ['schedule admission', report.timingsMs.schedule],
      ['compute + queue', report.timingsMs.computeAndQueue],
      ['whole round trip', report.timingsMs.roundTrip],
      ['published state GET', report.timingsMs.publishedRead],
    ];
  for (const [label, values] of rows) {
    console.log(`${label.padEnd(22)} ${`${values.p50} ms`.padStart(10)} `
      + `${`${values.p90} ms`.padStart(10)} ${`${values.p99} ms`.padStart(10)} `
      + `${`${values.max} ms`.padStart(10)}`);
  }
  console.log(`\n${totalOps.toLocaleString()} verified row updates in ${(wallMs / 1000).toFixed(2)} s`);
  console.log(`${report.throughput.operationsPerSecond.toLocaleString()} row updates/s; `
    + `${report.throughput.messagesPerSecond.toLocaleString()} scheduled messages/s`);
  if (report.admissionRetries) console.log(`${report.admissionRetries} admission 429 retries (included in latency)`);
  console.log('\nprocesses');
  processIds.forEach((pid, index) => console.log(`  shard ${index + 1}: ${pid}`));
}
