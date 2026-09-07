/** lane1-delay-probe.mjs — is the ~1.6s tied to the GET, or to time-since-POST? */
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
const outDir = path.join(ROOT, '.test-tmp', `lane1-dp-${Date.now()}`);
await buildSwarmClient({ root: ROOT, graph: { ...graph, game: PID, node: NODE }, outDir });
const burners = await listBurners();
const actor = burners.find((b) => b.name === 'burner-01') || burners[0];
installWalletShim(actor.jwk);
const c = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);
const get = async (p) => { const t = performance.now();
  const r = await fetch(`${NODE}/${PID}~process@1.0/${p}`, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(120000) });
  const b = await r.text(); return { ms: Math.round(performance.now() - t), status: r.status, len: b.length }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const waitMs of [0, 500, 1000, 1500, 2000, 3000, 5000, 0, 3000]) {
  const s = await c.rawSendMessage({ process: PID, node: NODE, tags: [{ name: 'Action', value: 'Stats' }] });
  await sleep(waitMs);
  const g = await get(`compute&slot=${s.slot}/results/output/data`);
  console.log(`waitAfterPost=${String(waitMs).padStart(4)}ms  slot=${s.slot}  computeGet=${String(g.ms).padStart(5)}ms  status=${g.status}  postToReply=${waitMs + g.ms}ms`);
}
console.log('--- control: head poll instead of compute read ---');
for (let i = 0; i < 3; i++) {
  const s = await c.rawSendMessage({ process: PID, node: NODE, tags: [{ name: 'Action', value: 'Stats' }] });
  const t0 = performance.now();
  let head = null, polls = 0;
  while (performance.now() - t0 < 20000) {
    polls++;
    const r = await get('now/at-slot'); head = Number((await (await fetch(`${NODE}/${PID}~process@1.0/now/at-slot`)).text()).trim());
    if (head >= s.slot) break;
    await sleep(100);
  }
  console.log(`  slot=${s.slot} head reached it in ${Math.round(performance.now()-t0)}ms after ${polls} polls (head=${head})`);
}
