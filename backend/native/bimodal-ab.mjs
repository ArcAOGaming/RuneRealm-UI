/**
 * bimodal-ab.mjs — the two code paths, measured back to back on the same
 * process in the same second.
 *
 *   A: GET compute&slot=H where H is the current computed head  -> cached path
 *   B: post a mutation, GET compute&slot=S where S > H          -> replay path
 *
 * Same URL shape, same node, same process, seconds apart. Any difference is
 * the path, not the weather.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
const NODE = process.env.NODE_URL || graph.node;
const PID = process.env.PID || graph.game;
const N = Number(process.env.N || 25);
const OUT = process.env.OUT || path.join(ROOT, '.test-tmp', `bimodal-ab-${Date.now()}.jsonl`);
const DATA = JSON.stringify(['Gloves', 'Long', 'Beanie', 'Skirt', 'Shirt', 'Shoes']);
const burners = listBurners();
const actor = burners[burners.length - 2];
const isHtml = (s) => /^\s*<!DOCTYPE html|^\s*<html/i.test(s);

const timedGet = async (url) => {
  const t = performance.now();
  try {
    const r = await fetch(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(180000) });
    const b = (await r.text()).trim();
    return { ms: Math.round(performance.now() - t), status: r.status, bytes: Buffer.byteLength(b), html: isHtml(b), empty: !b };
  } catch (e) { return { ms: Math.round(performance.now() - t), status: null, err: String(e.message).slice(0, 60) }; }
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const sink = fs.createWriteStream(OUT, { flags: 'a' });
console.log(`A/B pid=${PID} burner=${actor.name} n=${N}`);
for (let i = 0; i < N; i++) {
  const rec = { i, t: Date.now() };
  const h = await timedGet(`${NODE}/${PID}~process@1.0/now/at-slot`);
  const head = Number(h.status === 200 ? (await (await fetch(`${NODE}/${PID}~process@1.0/now/at-slot`)).text()).trim() : NaN);
  rec.head = Number.isFinite(head) ? head : null;
  if (rec.head == null) { sink.write(JSON.stringify(rec) + '\n'); continue; }
  // A: a slot at/below the computed head
  const a = await timedGet(`${NODE}/${PID}~process@1.0/compute&slot=${rec.head}/results/output/data`);
  rec.aMs = a.ms; rec.aStatus = a.status; rec.aBytes = a.bytes; rec.aHtml = a.html;
  // B: our own new slot, necessarily ahead of the head
  const t0 = performance.now();
  let sent = null;
  try { sent = await sendMessage({ node: NODE, jwk: actor.jwk, process: PID, action: 'Sprite.Update', data: DATA }); }
  catch (e) { rec.postErr = String(e.message).slice(0, 80); sink.write(JSON.stringify(rec) + '\n'); continue; }
  rec.postMs = Math.round(performance.now() - t0);
  rec.slot = sent.slot; rec.gap = sent.slot - rec.head;
  const b = await timedGet(`${NODE}/${PID}~process@1.0/compute&slot=${rec.slot}/results/output/data`);
  rec.bMs = b.ms; rec.bStatus = b.status; rec.bBytes = b.bytes; rec.bHtml = b.html;
  // C: the SAME slot again, now that it is computed — the cached path for the identical URL
  const c = await timedGet(`${NODE}/${PID}~process@1.0/compute&slot=${rec.slot}/results/output/data`);
  rec.cMs = c.ms; rec.cStatus = c.status; rec.cBytes = c.bytes;
  rec.roundTripMs = rec.postMs + rec.bMs;
  sink.write(JSON.stringify(rec) + '\n');
  console.log(`${String(i).padStart(3)} head=${rec.head} slot=${rec.slot} gap=${rec.gap} | A(cached head)=${rec.aMs}ms ${rec.aBytes}B | B(ahead,replay)=${rec.bMs}ms ${rec.bBytes}B | C(same slot re-read)=${rec.cMs}ms | ROUND TRIP ${rec.roundTripMs}ms`);
}
sink.end();
console.log(`out ${OUT}`);
