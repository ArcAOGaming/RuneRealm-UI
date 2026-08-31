/**
 * Read the node's OWN per-slot timings instead of timing it from outside.
 *
 * HyperBEAM logs a `computed_slot` line per slot with `prep_ms`,
 * `execution_ms`, `store_ms` and the result size. Those are measured inside the
 * node, so they are immune to client round-trip time, to Docker Desktop's
 * variable networking, and to whatever else the laptop is doing -- all of which
 * made external timing swing by 2.5x between identical runs here.
 *
 *   node harvest.mjs <container> [workers.json] [depth]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { postSigned } from '../../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const container = process.argv[2] || 'hb-stock';
const manifestPath = path.resolve(process.argv[3] || path.join(HERE, 'workers.8734.json'));
const depth = Number(process.argv[4] || 30);
const { node, workers } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

/** The node abbreviates ids in logs as `first5..last5`. */
const short = (id) => `${id.slice(0, 5)}..${id.slice(-5)}`;

async function queue(processId, count) {
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const response = await postSigned(node, `/${processId}~process@1.0/schedule`, {
      target: processId, type: 'Message', subject: 'self', action: 'Fleet.Status',
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

// A marker slot in the log stream, so only this run's lines are counted even
// when the container has been serving for a while.
const startedAt = new Date().toISOString();

for (const worker of workers) {
  await drain(worker.processId, await queue(worker.processId, 2), worker.results);
  await drain(worker.processId, await queue(worker.processId, depth), worker.results);
  process.stdout.write(`${worker.label} `);
}
console.log('\n');

const logs = spawnSync('docker', ['logs', '--since', startedAt, container],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
const text = `${logs.stdout || ''}${logs.stderr || ''}`;

const median = (values) => {
  if (!values.length) return NaN;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};

console.log(`node-measured, ${depth} slots each (median of the node's own per-slot log)\n`);
console.log(`${'worker'.padEnd(7)} ${'runtime'.padEnd(12)} ${'n'.padStart(4)} `
  + `${'prep'.padStart(6)} ${'exec'.padStart(7)} ${'store'.padStart(7)} ${'total'.padStart(7)} ${'bytes'.padStart(8)}`);

for (const worker of workers) {
  const marker = short(worker.processId);
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.includes('computed_slot') || !line.includes(marker)) continue;
    const field = (name) => {
      const match = new RegExp(`${name}: (\\d+)`).exec(line);
      return match ? Number(match[1]) : null;
    };
    const row = {
      prep: field('prep_ms'), exec: field('execution_ms'),
      store: field('store_ms'), size: field('computed_slot_size'),
    };
    if (row.exec !== null) rows.push(row);
  }
  const stat = (key) => median(rows.map((row) => row[key]).filter((value) => value !== null));
  const total = median(rows.map((row) => row.prep + row.exec + row.store));
  console.log(`${worker.label.padEnd(7)} ${worker.runtime.padEnd(12)} ${String(rows.length).padStart(4)} `
    + `${`${stat('prep')}ms`.padStart(6)} ${`${stat('exec')}ms`.padStart(7)} `
    + `${`${stat('store')}ms`.padStart(7)} ${`${total}ms`.padStart(7)} ${String(stat('size')).padStart(8)}`);
}
