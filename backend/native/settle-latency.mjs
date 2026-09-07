/**
 * settle-latency.mjs -- what the head settle costs per action.
 *
 * Bundles `src/lib/hyperbeam.ts` exactly as the swarm does and times N signed
 * writes end to end (POST -> reply in hand), through the app's own transport
 * rather than a reimplementation of it.
 *
 * Point it at a THROWAWAY process, never the live one: the arm without the
 * settle races the head by definition, and a race can leave the process it is
 * measured on with an empty `Players`.
 *
 *   S=$(node backend/native/.spawn-scratch.mjs)   # or any scratch pid
 *   GAME_PROCESS=$S ROUNDS=10 node backend/native/settle-latency.mjs after
 *
 * Measured 2026-09-06 on hyperbeam.tylerw.ai, one fresh process per arm:
 *
 *   no settle                        p50 1900 ms
 *   probe the head every action      p50 3227 ms
 *   probe adaptively (shipped)       p50 1899 ms
 *
 * The middle row is what a fixed probe costs on a node whose head does not
 * advance for these writes; the last is `settleHeadIfUseful` declining to keep
 * paying for an answer that never arrives. See `src/lib/slot-settle.mjs`.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSwarmClient } from './swarm/build-client.mjs';
import { listBurners } from './burners.mjs';
import { useKeepAlive } from './keepalive.mjs';
import { installWalletShim } from './ans104.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
const NODE = graph.node;
const PID = graph.game;
const LABEL = process.argv[2] || 'run';
const ROUNDS = Number(process.env.ROUNDS || 12);

await useKeepAlive({ quiet: false });

const outDir = path.join(ROOT, '.test-tmp', `settle-${LABEL}-${Date.now()}`);
console.log(`process: ${PID}`);
await buildSwarmClient({ root: ROOT, graph, outDir });
const burners = await listBurners();
const actor = burners.find((b) => b.name === (process.env.BURNER || 'burner-01')) || burners[0];
installWalletShim(actor.jwk);
const client = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);

// `rawSend` is the app's whole write path: sign, schedule, read this slot's own
// reply. `Stats` is chosen deliberately -- it is a read-only verb, so every
// round costs the same and nothing accumulates that could make a later round
// slower for a reason other than the settle.
// Warm the process worker first and do not count it. The head only advances on
// its own while a worker is alive, so the FIRST write after an idle period is a
// different measurement from the steady state a player or a swarm actor sees.
await client.rawSend([{ name: 'Action', value: 'Stats' }], { process: PID, node: NODE })
  .catch((err) => console.error('  warmup failed: ' + String(err.message).slice(0, 120)));

const times = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const started = Date.now();
  try {
    await client.rawSend([{ name: 'Action', value: 'Stats' }], { process: PID, node: NODE });
  } catch (err) {
    console.error('  round ' + (i + 1) + ' failed: ' + String(err.message).slice(0, 120));
    continue;
  }
  times.push(Date.now() - started);
}
times.sort((a, b) => a - b);
const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(`${LABEL}  n=${times.length}  p50=${at(0.5)}ms  p90=${at(0.9)}ms  min=${times[0]}ms  max=${times[times.length - 1]}ms`);
console.log(`${LABEL}  raw: ${times.join(',')}`);
fs.rmSync(outDir, { recursive: true, force: true });
