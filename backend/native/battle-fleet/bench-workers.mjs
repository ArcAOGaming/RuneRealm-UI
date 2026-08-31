/** Live mixed-fleet transport/runtime baseline.
 *
 * This schedules Fleet.Status on every ready worker in parallel. It measures
 * scheduler + queue + VM + correlated-result latency without changing battle
 * state. Use the swarm for actual Battle.Open/Attack/settlement throughput.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadBattleFleetManifest } from '../battle-fleet-config.mjs';
import { sendMessage } from '../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
if (!/^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || '')) {
  throw new Error('Set BATTLE_FLEET_ENABLED=1: this benchmark schedules public test messages.');
}
const manifestPath = path.resolve(process.env.BATTLE_FLEET_MANIFEST
  || path.join(HERE, 'manifest.local.json'));
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const samples = Number(process.env.BATTLE_BENCH_SAMPLES || 20);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1000) {
  throw new Error('BATTLE_BENCH_SAMPLES must be an integer from 1 to 1000.');
}
if (!fs.existsSync(walletPath)) throw new Error(`No keyfile at ${walletPath}`);
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const config = loadBattleFleetManifest(manifestPath);
const node = config.node;

async function waitForSlot(pid, rawSlot) {
  const slot = Number(rawSlot);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error(`Invalid scheduled slot ${rawSlot}`);
  for (let attempt = 0; attempt < 1200; attempt++) {
    const response = await fetch(`${node}/${pid}~process@1.0/now/at-slot`, {
      headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const at = response?.ok ? Number((await response.text()).trim()) : Number.NaN;
    // dev_process writes at-slot=NextSlot only after that transition executes.
    if (Number.isSafeInteger(at) && at >= slot) {
      // The two runtimes put the reply in different places. `lua@5.3a` writes
      // `results/output/data`; a JSON-Iface worker's reply is the `data` key of
      // `json_to_message`'s output, so it lands at `results/data` and there is
      // no `output` submessage at all. Reading only the first spelling times
      // Lua and 404s on every Rust sample, which reads as a broken worker.
      let last = 0;
      for (const suffix of ['results/output/data', 'results/data']) {
        const result = await fetch(
          `${node}/${pid}~process@1.0/compute&slot=${slot}/${suffix}`,
          { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(10_000) },
        );
        if (result.ok) return;
        last = result.status;
      }
      throw new Error(`${pid} slot ${slot} result returned ${last}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${pid} slot ${slot} did not compute within 60 seconds`);
}

const values = new Map(config.workers.map((worker) => [worker.workerId, []]));
const runRound = async (record) => Promise.all(config.workers.map(async (worker) => {
  const started = performance.now();
  const { slot } = await sendMessage({
    node, jwk, process: worker.workerProcessId, action: 'Fleet.Status',
  });
  await waitForSlot(worker.workerProcessId, slot);
  if (record) values.get(worker.workerId).push(performance.now() - started);
}));

await runRound(false);
await runRound(false);
const wallStarted = performance.now();
for (let round = 0; round < samples; round++) await runRound(true);
const wallSeconds = (performance.now() - wallStarted) / 1000;

const percentile = (input, p) => {
  const ordered = [...input].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)];
};
const byRuntime = new Map();
for (const worker of config.workers) {
  const timings = values.get(worker.workerId);
  const runtimeValues = byRuntime.get(worker.runtime) || [];
  runtimeValues.push(...timings);
  byRuntime.set(worker.runtime, runtimeValues);
  console.log(`${worker.workerId.padEnd(18)} ${worker.runtime.padEnd(12)} `
    + `p50=${percentile(timings, 0.50).toFixed(1)}ms `
    + `p95=${percentile(timings, 0.95).toFixed(1)}ms`);
}
for (const [runtime, timings] of byRuntime) {
  console.log(`${runtime.padEnd(18)} aggregate p50=${percentile(timings, 0.50).toFixed(1)}ms `
    + `p95=${percentile(timings, 0.95).toFixed(1)}ms`);
}
console.log(`fleet status throughput: ${(config.workers.length * samples / wallSeconds).toFixed(2)} actions/sec`);
console.log('This is a status-path baseline; run the swarm for battle-round throughput and settlement latency.');
