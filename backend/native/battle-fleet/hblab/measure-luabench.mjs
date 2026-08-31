/**
 * Per-round cost of real combat in Luerl, taken from the node's own clock.
 *
 * Sends batches of messages that each play N battles, and reads `execution_ms`
 * out of HyperBEAM's `computed_slot` log. The intercept is the fixed per-slot
 * cost; the SLOPE between counts is what one battle round actually costs in
 * Lua on a node. A single count could not separate the two.
 *
 *   node measure-luabench.mjs <container> luabench.8734.json [samples]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sendMessage } from '../../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const container = process.argv[2] || 'hb-stock';
const manifestPath = path.resolve(process.argv[3] || path.join(HERE, 'luabench.8734.json'));
const samples = Number(process.argv[4] || 8);
const { node, workers } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const processId = workers[0].processId;
const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

const short = `${processId.slice(0, 5)}..${processId.slice(-5)}`;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function runBatch(battles) {
  const since = new Date().toISOString();
  let rounds = 0;
  for (let i = 0; i < samples; i += 1) {
    const { slot } = await sendMessage({
      node, jwk, process: processId, action: 'Bench.Battles',
      tags: { battles: String(battles), nonce: String(Math.random()) },
    });
    const response = await fetch(`${node}/${processId}~process@1.0/compute&slot=${slot}/results/output/data`,
      { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(300000) });
    const body = await response.text();
    if (!response.ok) throw new Error(`battles=${battles}: ${body.slice(0, 200)}`);
    rounds = JSON.parse(body).rounds;
  }
  const logs = spawnSync('docker', ['logs', '--since', since, container],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  const text = `${logs.stdout || ''}${logs.stderr || ''}`;
  const values = [];
  for (const line of text.split('\n')) {
    if (!line.includes('computed_slot') || !line.includes(short)) continue;
    const match = /execution_ms: (\d+)/.exec(line);
    if (match) values.push(Number(match[1]));
  }
  return { battles, rounds, exec: values.length ? median(values) : NaN, n: values.length };
}

const results = [];
for (const battles of [1, 5, 20, 60]) results.push(await runBatch(battles));

console.log(`\n${'battles'.padStart(8)} ${'rounds'.padStart(7)} ${'exec'.padStart(7)} ${'n'.padStart(4)}`);
for (const row of results) {
  console.log(`${String(row.battles).padStart(8)} ${String(row.rounds).padStart(7)} `
    + `${`${row.exec}ms`.padStart(7)} ${String(row.n).padStart(4)}`);
}

// Least-squares slope of execution_ms against rounds played. The intercept is
// the per-slot floor Lua pays regardless; the slope is the round itself.
const usable = results.filter((row) => Number.isFinite(row.exec));
const meanX = usable.reduce((sum, row) => sum + row.rounds, 0) / usable.length;
const meanY = usable.reduce((sum, row) => sum + row.exec, 0) / usable.length;
const slope = usable.reduce((sum, row) => sum + (row.rounds - meanX) * (row.exec - meanY), 0)
  / usable.reduce((sum, row) => sum + (row.rounds - meanX) ** 2, 0);
console.log(`\nper round: ${(slope * 1000).toFixed(0)} us   fixed per slot: ${(meanY - slope * meanX).toFixed(1)} ms`);
