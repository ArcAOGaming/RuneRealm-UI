/** lane1-lookahead-test.mjs — is the fixed ~1.5s the dev_scheduler lookahead
 *  worker's `receive ... after 1500` on a worker that already died?
 *
 *  Prediction: if slot N+1 ALREADY EXISTS at the moment slot N is computed, the
 *  lookahead worker finds it and sends it, so no timeout is paid. Batch-POST a
 *  run of slots first, then read them in order: read #1 pays the timeout, the
 *  rest should not.  Interleaved (post,read,post,read) every read pays it. */
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
const NODE = process.env.NODE_URL || graph.node;
const PID = process.env.PID;
await useKeepAlive({ quiet: true });
const outDir = path.join(ROOT, '.test-tmp', `lane1-la-${Date.now()}`);
await buildSwarmClient({ root: ROOT, graph: { ...graph, game: PID, node: NODE }, outDir });
const burners = await listBurners();
installWalletShim((burners.find((b) => b.name === 'burner-01') || burners[0]).jwk);
const c = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);
const post = () => c.rawSendMessage({ process: PID, node: NODE, tags: [{ name: 'Action', value: 'Stats' }] });
const read = async (slot) => { const t = performance.now();
  const r = await fetch(`${NODE}/${PID}~process@1.0/compute&slot=${slot}/results/output/data`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(120000) });
  await r.text(); return Math.round(performance.now() - t); };

console.log('--- ARM A: interleave post,read (next slot does NOT exist at compute time) ---');
for (let i = 0; i < 5; i++) { const s = await post(); console.log(`  slot=${s.slot} read=${await read(s.slot)}ms`); }

console.log('--- ARM B: batch-POST 8 slots first, THEN read them in order ---');
const slots = [];
for (let i = 0; i < 8; i++) slots.push((await post()).slot);
console.log(`  posted slots ${slots[0]}..${slots[slots.length-1]}`);
for (const s of slots) console.log(`  slot=${s} read=${await read(s)}ms`);

console.log('--- ARM A again (control) ---');
for (let i = 0; i < 3; i++) { const s = await post(); console.log(`  slot=${s.slot} read=${await read(s.slot)}ms`); }
