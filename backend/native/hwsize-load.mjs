/**
 * hwsize-load.mjs — deliver a known number of round trips in a timed window,
 * so beam.smp CPU sampled on the node can be divided by them.
 *
 * Differences from concurrency-ramp.mjs, all deliberate:
 *  - no 200 ms pre-poll sleep (poll immediately, then back off);
 *  - undici pool sized 4x lanes, so the client is never the queue;
 *  - prints machine-readable phase boundaries in epoch ms for CPU alignment.
 *
 * LANES=6 SECONDS=90 node backend/native/hwsize-load.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sendMessage, pendingPushes } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
const NODE = process.env.NODE_URL || graph.node;
const PID = process.env.PID || graph.game;
const LANES = Number(process.env.LANES || 4);
const SECONDS = Number(process.env.DURATION_S || 60);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 45_000);
const ACTION = process.env.ACTION || 'Sprite.Update';
const DATA = JSON.stringify(['Gloves', 'Long', 'Beanie', 'Skirt', 'Shirt', 'Shoes']);

const { Agent, setGlobalDispatcher } = await import('undici');
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 60_000, keepAliveMaxTimeout: 120_000,
  connections: Math.max(16, LANES * 4), pipelining: 1,
}));

let requests = 0;
async function roundTrip(jwk) {
  const started = performance.now();
  let slot;
  try {
    const sent = await sendMessage({ node: NODE, jwk, process: PID, action: ACTION, data: DATA });
    requests += 1; slot = sent?.slot;
  } catch (e) { requests += 1; return { ok: false, reason: 'post', totalMs: performance.now() - started }; }
  if (slot === undefined || slot === null) return { ok: false, reason: 'no-slot', totalMs: performance.now() - started };
  const url = `${NODE}/${PID}~process@1.0/compute&slot=${slot}/results/output/data`;
  let wait = 0;
  while (performance.now() - started < DEADLINE_MS) {
    if (wait) await new Promise((d) => setTimeout(d, wait));
    wait = wait ? Math.min(500, Math.round(wait * 1.4)) : 60;
    const r = await fetch(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    requests += 1;
    if (r?.status === 429) return { ok: false, reason: 'rate-limited', totalMs: performance.now() - started };
    if (r?.ok) {
      const body = (await r.text()).trim();
      if (body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        return { ok: true, slot, totalMs: performance.now() - started };
      }
    }
  }
  return { ok: false, reason: 'timeout', totalMs: performance.now() - started };
}

const wallets = listBurners().map((b) => b.jwk);
if (!wallets.length) throw new Error('no burners');
const results = [];
const t0 = Date.now();
const until = t0 + SECONDS * 1000;
await Promise.all(Array.from({ length: LANES }, async (_u, lane) => {
  const jwk = wallets[lane % wallets.length];
  while (Date.now() < until) results.push(await roundTrip(jwk));
}));
const tLoopEnd = Date.now();
await pendingPushes({ node: NODE, process: PID }).catch(() => {});
const t1 = Date.now();
const ok = results.filter((r) => r.ok);
const totals = ok.map((r) => r.totalMs).sort((a, b) => a - b);
const q = (p) => (totals.length ? Math.round(totals[Math.min(totals.length - 1, Math.floor(p * totals.length))]) : null);
console.log(JSON.stringify({
  lanes: LANES, node: NODE, pid: PID, action: ACTION,
  startedEpochMs: t0, loopEndEpochMs: tLoopEnd, endedEpochMs: t1,
  wallMs: tLoopEnd - t0, drainMs: t1 - tLoopEnd,
  attempts: results.length, ok: ok.length,
  failures: results.filter((r) => !r.ok).reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] || 0) + 1 }), {}),
  httpRequests: requests,
  msgPerSec: +(ok.length / ((tLoopEnd - t0) / 1000)).toFixed(3),
  reqPerSec: +(requests / ((tLoopEnd - t0) / 1000)).toFixed(2),
  roundTripMs: { p50: q(0.5), p95: q(0.95), mean: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null },
}));
