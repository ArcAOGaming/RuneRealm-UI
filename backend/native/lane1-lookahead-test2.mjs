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
const NODE = process.env.NODE_URL || graph.node; const PID = process.env.PID;
await useKeepAlive({ quiet: true });
const outDir = path.join(ROOT, '.test-tmp', `lane1-la2-${Date.now()}`);
await buildSwarmClient({ root: ROOT, graph: { ...graph, game: PID, node: NODE }, outDir });
const burners = await listBurners();
installWalletShim((burners.find((b) => b.name === 'burner-01') || burners[0]).jwk);
const c = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);
const post = () => c.rawSendMessage({ process: PID, node: NODE, tags: [{ name: 'Action', value: 'Stats' }] });
const read = async (s) => { const t = performance.now();
  const r = await fetch(`${NODE}/${PID}~process@1.0/compute&slot=${s}/results/output/data`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(120000) }); await r.text();
  return Math.round(performance.now() - t); };
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
const A=[],B=[];
for (let i=0;i<15;i++){ const s=await post(); A.push(await read(s.slot)); }
const slots=[]; for(let i=0;i<16;i++) slots.push((await post()).slot);
for (let i=0;i<slots.length;i++){ const ms=await read(slots[i]); if(i>0) B.push(ms); }
console.log(`ARM A  interleaved post->read (next assignment absent at compute time)`);
console.log(`  n=${A.length} p50=${q(A,0.5)} p10=${q(A,0.1)} p90=${q(A,0.9)} min=${Math.min(...A)} max=${Math.max(...A)}`);
console.log(`ARM B  batch-posted, read in order (next assignment already present)`);
console.log(`  n=${B.length} p50=${q(B,0.5)} p10=${q(B,0.1)} p90=${q(B,0.9)} min=${Math.min(...B)} max=${Math.max(...B)}`);
console.log(`DELTA p50 = ${q(A,0.5)-q(B,0.5)} ms   (?LOOKAHEAD_TIMEOUT is 1500)`);
console.log(`A raw: ${A.join(',')}`);
console.log(`B raw: ${B.join(',')}`);
