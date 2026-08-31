/**
 * Node-side throughput per process, with round-trip time overlapped away.
 *
 * Per-slot LATENCY is the wrong number for "what happens under load": most of
 * it is network, and every client pays that in parallel. This queues K messages
 * at one process first, then times the drain, so what it reports is the rate a
 * backlog actually clears at -- which is what a queue under load is.
 *
 * Reads the process set written by `hblab/seed.mjs`, so the same command
 * measures a local container and a remote node:
 *
 *   node bench-throughput.mjs hblab/workers.8734.json [depth]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { postSigned } from '../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const manifestPath = path.resolve(process.argv[2] || path.join(HERE, 'hblab', 'workers.8734.json'));
const depth = Number(process.argv[3] || 12);
if (!Number.isSafeInteger(depth) || depth < 1 || depth > 500) {
  throw new Error('Queue depth must be an integer from 1 to 500.');
}
const { node, workers } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

/** Round-trip floor for this client and node, so a reader can tell how much of
 * any latency figure is simply distance. */
async function baseline() {
  const samples = [];
  for (let i = 0; i < 15; i += 1) {
    const started = performance.now();
    const response = await fetch(`${node}/~meta@1.0/info/address`);
    await response.arrayBuffer();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

async function queue(processId, count) {
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const response = await postSigned(node, `/${processId}~process@1.0/schedule`, {
      target: processId, type: 'Message', subject: 'self', action: 'Fleet.Status',
      // Without a unique field the messages are identical, and `dedup@1.0`
      // would legitimately collapse them into one slot's worth of work.
      'random-seed': String(Math.floor(Math.random() * 1e9)),
    }, jwk);
    if (response.status !== 200) throw new Error(`schedule returned ${response.status}`);
    slots.push(Number(response.headers.slot));
  }
  return slots;
}

async function drain(processId, slots, results) {
  await Promise.all(slots.map(async (slot) => {
    for (const suffix of results) {
      const response = await fetch(`${node}/${processId}~process@1.0/compute&slot=${slot}/${suffix}`,
        { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(300000) });
      await response.arrayBuffer();
      if (response.ok) return;
    }
    throw new Error(`slot ${slot} produced no result`);
  }));
}

const rtt = await baseline();
console.log(`${node}  (trivial GET p50 ${rtt.toFixed(1)} ms)\n`);

for (const worker of workers) {
  // A cold process pays worker start-up on the first slot, which is a real cost
  // but not a per-slot one, and it would land entirely on whichever runtime
  // happens to be measured first.
  await drain(worker.processId, await queue(worker.processId, 2), worker.results);
  const slots = await queue(worker.processId, depth);
  const started = performance.now();
  await drain(worker.processId, slots, worker.results);
  const seconds = (performance.now() - started) / 1000;
  console.log(`${worker.label.padEnd(6)} ${worker.runtime.padEnd(12)} `
    + `${depth} queued drained in ${seconds.toFixed(2)}s = `
    + `${(depth / seconds).toFixed(2)} slots/sec, ${(seconds * 1000 / depth).toFixed(0)} ms/slot`);
}
