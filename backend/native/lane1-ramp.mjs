/** lane1-ramp.mjs — throughput vs concurrency: plateau (serial queue) or collapse? */
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
const LEVELS = (process.env.LEVELS || '1,2,4,8,12,16,24').split(',').map(Number);
const PER = Number(process.env.PER || 40);
await useKeepAlive({ quiet: true });
const outDir = path.join(ROOT, '.test-tmp', `lane1-ramp-${Date.now()}`);
await buildSwarmClient({ root: ROOT, graph: { ...graph, game: PID, node: NODE }, outDir });
const burners = await listBurners();
installWalletShim((burners.find((b) => b.name === 'burner-01') || burners[0]).jwk);
const c = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);
const q = (a, p) => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y);
  return Math.round(s[Math.min(s.length-1, Math.floor(p*s.length))]); };
const one = async () => {
  const t0 = performance.now();
  const s = await c.rawSendMessage({ process: PID, node: NODE, tags: [{ name: 'Action', value: 'Stats' }] });
  const tp = performance.now();
  const r = await fetch(`${NODE}/${PID}~process@1.0/compute&slot=${s.slot}/results/output/data`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(300000) });
  const body = await r.text();
  return { slot: s.slot, postMs: tp - t0, readMs: performance.now() - tp, rt: performance.now() - t0,
    ok: r.status === 200 && body !== '' };
};
console.log(`pid=${PID}  per-level=${PER}`);
console.log('conc |  n  fail |  rt p50   p90    max | post p50 | read p50 | thru/s | ms/slot | slots');
for (const conc of LEVELS) {
  const rows = []; let fail = 0; let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) { const i = next++; if (i >= PER) return;
      try { const r = await one(); if (r.ok) rows.push(r); else fail++; } catch { fail++; } }
  }));
  const wall = (Date.now() - t0) / 1000;
  const slots = rows.map((r) => r.slot);
  const span = slots.length ? Math.max(...slots) - Math.min(...slots) + 1 : 0;
  console.log(`${String(conc).padStart(4)} |${String(rows.length).padStart(4)}${String(fail).padStart(5)} |` +
    `${String(q(rows.map(r=>r.rt),0.5)).padStart(7)}${String(q(rows.map(r=>r.rt),0.9)).padStart(7)}${String(q(rows.map(r=>r.rt),1)).padStart(7)} |` +
    `${String(q(rows.map(r=>r.postMs),0.5)).padStart(9)} |${String(q(rows.map(r=>r.readMs),0.5)).padStart(9)} |` +
    `${(rows.length/wall).toFixed(3).padStart(7)} |${String(Math.round(wall*1000/Math.max(1,span))).padStart(8)} |${String(span).padStart(6)}`);
  await new Promise((r) => setTimeout(r, 3000));
}
