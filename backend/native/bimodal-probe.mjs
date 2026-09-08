/**
 * bimodal-probe.mjs — a single low-rate round-trip probe that records, per
 * sample, everything that could distinguish a fast message from a slow one.
 *
 * Round trip = sign -> scheduled slot -> the handler's changed record read back.
 * Every phase is recorded for DIAGNOSIS only; the headline is totalMs.
 *
 *   PID=... NODE_URL=... N=200 GAP_MS=2000 OUT=... node bimodal-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
const NODE = process.env.NODE_URL || graph.node;
const PID = process.env.PID || graph.game;
const N = Number(process.env.N || 200);
const GAP_MS = Number(process.env.GAP_MS || 2000);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 120000);
const POLL_MS = Number(process.env.POLL_MS || 250);
const BURNER = process.env.BURNER || null;
const OUT = process.env.OUT || path.join(ROOT, '.test-tmp', `bimodal-${Date.now()}.jsonl`);
const ACTION = 'Sprite.Update';
const DATA = JSON.stringify(['Gloves', 'Long', 'Beanie', 'Skirt', 'Shirt', 'Shoes']);

const burners = listBurners();
const actor = BURNER ? burners.find((b) => b.name === BURNER) : burners[burners.length - 1];
if (!actor) throw new Error('no burner');

const isHtml = (s) => /^\s*<!DOCTYPE html|^\s*<html/i.test(s);

async function readHead() {
  const t = performance.now();
  try {
    const r = await fetch(`${NODE}/${PID}~process@1.0/now/at-slot`,
      { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60000) });
    const b = (await r.text()).trim();
    const n = Number(b);
    return { head: Number.isFinite(n) ? n : null, ms: performance.now() - t, status: r.status };
  } catch (e) { return { head: null, ms: performance.now() - t, status: null, err: String(e.message).slice(0, 80) }; }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const sink = fs.createWriteStream(OUT, { flags: 'a' });
console.log(`bimodal probe pid=${PID} node=${NODE} burner=${actor.name} N=${N} gap=${GAP_MS}ms`);
console.log(`out ${OUT}`);

for (let i = 0; i < N; i++) {
  const wallStart = Date.now();
  const rec = { i, t: wallStart, iso: new Date(wallStart).toISOString() };
  const hb = await readHead();
  rec.headBefore = hb.head; rec.headBeforeMs = Math.round(hb.ms); rec.headBeforeStatus = hb.status;
  if (hb.err) rec.headBeforeErr = hb.err;

  const t0 = performance.now();
  let sent = null;
  try {
    sent = await sendMessage({ node: NODE, jwk: actor.jwk, process: PID, action: ACTION, data: DATA });
  } catch (e) {
    rec.postErr = String(e.message).slice(0, 160); rec.postStatus = e?.status ?? null;
    rec.postMs = Math.round(performance.now() - t0);
    sink.write(JSON.stringify(rec) + '\n');
    await new Promise((r) => setTimeout(r, GAP_MS));
    continue;
  }
  rec.postMs = Math.round(performance.now() - t0);
  rec.slot = sent?.slot ?? null;
  if (rec.slot != null && rec.headBefore != null) rec.backlog = rec.slot - rec.headBefore;

  const posted = performance.now();
  const url = `${NODE}/${PID}~process@1.0/compute&slot=${rec.slot}/results/output/data`;
  let polls = 0; let htmlPolls = 0; let firstNonHtmlMs = null; const statuses = {};
  let ok = false; let bytes = 0;
  while (performance.now() - t0 < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const pt = performance.now();
    let res = null;
    try {
      res = await fetch(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(DEADLINE_MS) });
    } catch (e) { statuses['neterr'] = (statuses['neterr'] || 0) + 1; polls += 1; continue; }
    polls += 1;
    statuses[res.status] = (statuses[res.status] || 0) + 1;
    if (res.status === 429) { rec.rateLimited = true; break; }
    if (res.ok) {
      const body = (await res.text()).trim();
      if (body && !isHtml(body)) {
        ok = true; bytes = Buffer.byteLength(body);
        firstNonHtmlMs = Math.round(performance.now() - pt);
        break;
      }
      htmlPolls += 1;
    }
  }
  rec.ok = ok;
  rec.readMs = Math.round(performance.now() - posted);
  rec.totalMs = Math.round(performance.now() - t0);
  rec.polls = polls; rec.htmlPolls = htmlPolls; rec.lastGetMs = firstNonHtmlMs;
  rec.statuses = statuses; rec.bytes = bytes;
  const ha = await readHead();
  rec.headAfter = ha.head; rec.headAfterMs = Math.round(ha.ms);
  if (rec.slot != null) rec.slotMod50 = rec.slot % 50;
  sink.write(JSON.stringify(rec) + '\n');
  console.log(`${String(i).padStart(4)} slot=${rec.slot} mod50=${rec.slotMod50} headBefore=${rec.headBefore} backlog=${rec.backlog} `
    + `post=${rec.postMs} read=${rec.readMs} TOTAL=${rec.totalMs}ms polls=${polls} html=${htmlPolls} ok=${ok} headAfter=${rec.headAfter}`);
  await new Promise((r) => setTimeout(r, GAP_MS));
}
sink.end();
console.log(`done -> ${OUT}`);
