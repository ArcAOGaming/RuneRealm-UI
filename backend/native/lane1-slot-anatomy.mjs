/**
 * lane1-slot-anatomy.mjs — where does one slot's wall clock actually go?
 *
 * Separates NODE time from the client's own retry/sleep schedule by measuring,
 * for the same signed write:
 *
 *   postMs        — sendMessage: sign + POST /schedule, slot in hand
 *   rawGetMs      — ONE blocking GET compute&slot=N/results/output/data, issued
 *                   by this file, with no settle probe, no backoff, no retry
 *   clientReadMs  — the app's own readSlot() for the same slot, with attempts
 *
 * Arms alternate which read runs FIRST, because the second read of a slot is a
 * cache hit and measures nothing. So each action yields one COLD number and one
 * WARM number, and the cold numbers of the two arms are the comparison.
 *
 *   PID=<pid> NODE=<url> N=60 CONC=1 node backend/native/lane1-slot-anatomy.mjs <label>
 */
import fs from 'node:fs';
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
const PID = process.env.PID || graph.game;
const N = Number(process.env.N || 60);
const CONC = Number(process.env.CONC || 1);
const ACTION = process.env.ACTION || 'Stats';
const LABEL = process.argv[2] || 'run';
const OUT = process.env.OUT || path.join(ROOT, '.test-tmp', `lane1-${LABEL}.jsonl`);

await useKeepAlive({ quiet: true });
const outDir = path.join(ROOT, '.test-tmp', `lane1-client-${Date.now()}`);
await buildSwarmClient({ root: ROOT, graph: { ...graph, game: PID, node: NODE }, outDir });
const burners = await listBurners();
const actor = burners.find((b) => b.name === (process.env.BURNER || 'burner-01')) || burners[0];
installWalletShim(actor.jwk);
const client = await import(pathToFileURL(path.join(outDir, 'client.mjs')).href);

const rawGet = async (slot) => {
  const t0 = performance.now();
  const res = await fetch(`${NODE}/${PID}~process@1.0/compute&slot=${slot}/results/output/data`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(180000) });
  const body = await res.text();
  return { ms: performance.now() - t0, status: res.status, bytes: Buffer.byteLength(body),
           empty: body === '' };
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const sink = fs.createWriteStream(OUT, { flags: 'a' });
const rows = [];

async function oneAction(i) {
  const rawFirst = (i % 2) === 0;
  const rec = { i, rawFirst, t: Date.now() };
  const t0 = performance.now();
  let sent;
  try {
    sent = await client.rawSendMessage({ process: PID, node: NODE,
      tags: [{ name: 'Action', value: ACTION }] });
  } catch (err) { rec.err = String(err.message).slice(0, 200); sink.write(JSON.stringify(rec) + '\n'); return rec; }
  rec.postMs = performance.now() - t0;
  rec.slot = sent.slot;
  if (sent.timing) { rec.buildMs = sent.timing.buildMs; rec.signMs = sent.timing.signMs; rec.schedPostMs = sent.timing.postMs; }

  let attempts = 0;
  const readClient = async () => {
    const t = performance.now();
    try { await client.rawReadSlot(sent.slot, { process: PID, node: NODE, onAttempt: () => { attempts++; } }); }
    catch (e) { rec.clientErr = String(e.message).slice(0, 120); }
    return performance.now() - t;
  };

  if (rawFirst) {
    const g = await rawGet(sent.slot);
    rec.rawGetMs = g.ms; rec.rawStatus = g.status; rec.rawBytes = g.bytes; rec.rawEmpty = g.empty;
    rec.rawCold = true;
    rec.clientReadMs = await readClient(); rec.clientCold = false;
  } else {
    rec.clientReadMs = await readClient(); rec.clientCold = true;
    const g = await rawGet(sent.slot);
    rec.rawGetMs = g.ms; rec.rawStatus = g.status; rec.rawBytes = g.bytes; rec.rawEmpty = g.empty;
    rec.rawCold = false;
  }
  rec.attempts = attempts;
  rows.push(rec);
  sink.write(JSON.stringify(rec) + '\n');
  return rec;
}

const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a,b)=>a-b);
  return Math.round(s[Math.min(s.length-1, Math.floor(p*s.length))]); };

console.log(`pid=${PID}`);
console.log(`node=${NODE}  action=${ACTION}  N=${N}  conc=${CONC}  burner=${actor.name}`);
const started = Date.now();
if (CONC === 1) {
  for (let i = 0; i < N; i++) {
    const r = await oneAction(i);
    console.log(`  ${String(i).padStart(3)} slot=${r.slot ?? '-'} post=${Math.round(r.postMs ?? -1)}ms ` +
      `rawGet=${Math.round(r.rawGetMs ?? -1)}ms${r.rawCold ? '*' : ' '} ` +
      `clientRead=${Math.round(r.clientReadMs ?? -1)}ms${r.clientCold ? '*' : ' '} attempts=${r.attempts ?? '-'}` +
      (r.err ? ` ERR ${r.err}` : ''));
  }
} else {
  let next = 0;
  const worker = async () => { for (;;) { const i = next++; if (i >= N) return; await oneAction(i); } };
  await Promise.all(Array.from({ length: CONC }, worker));
}
const wall = (Date.now() - started) / 1000;
sink.end();

const ok = rows.filter((r) => r.slot != null);
const coldRaw = ok.filter((r) => r.rawCold).map((r) => r.rawGetMs);
const warmRaw = ok.filter((r) => !r.rawCold).map((r) => r.rawGetMs);
const coldClient = ok.filter((r) => r.clientCold).map((r) => r.clientReadMs);
const warmClient = ok.filter((r) => !r.clientCold).map((r) => r.clientReadMs);
const posts = ok.map((r) => r.postMs);
const att = ok.map((r) => r.attempts);
const slots = ok.map((r) => r.slot);
const line = (name, a) => console.log(`  ${name.padEnd(22)} n=${String(a.length).padStart(3)}  p50=${String(q(a,0.5)).padStart(7)}  p90=${String(q(a,0.9)).padStart(7)}  min=${String(q(a,0)).padStart(7)}  max=${String(q(a,1)).padStart(7)}`);
console.log(`\n=== ${LABEL}  wall=${wall.toFixed(1)}s  ok=${ok.length}/${N}  throughput=${(ok.length/wall).toFixed(3)} actions/s ===`);
line('postMs', posts);
line('rawGetMs COLD', coldRaw);
line('rawGetMs warm(cached)', warmRaw);
line('clientReadMs COLD', coldClient);
line('clientRead warm(cached)', warmClient);
console.log(`  attempts               p50=${q(att,0.5)} max=${q(att,1)}  (1 = client made exactly one GET)`);
console.log(`  slot span              ${Math.min(...slots)}..${Math.max(...slots)}  distinct=${new Set(slots).size}`);
console.log(`  implied ms/slot        ${((wall*1000)/(Math.max(...slots)-Math.min(...slots)+1)).toFixed(0)} (wall / slots consumed by everyone)`);
console.log(`  raw -> ${OUT}`);
fs.rmSync(outDir, { recursive: true, force: true });
