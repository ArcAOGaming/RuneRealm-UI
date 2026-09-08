/**
 * wire-anatomy-probe.mjs — decompose ONE round trip into its HTTP legs.
 * Read-mostly diagnostic: posts Sprite.Update (same action concurrency-ramp uses).
 * MODE=harness  replicate concurrency-ramp exactly (sleep 200 then poll)
 * MODE=tight    no client sleep, poll compute&slot as fast as possible
 * MODE=nopush   tight, and skip the background push entirely
 * MODE=head     tight, but settle on now/at-slot first (what the app does)
 */
import { commit, transportNode, pushSlot } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { useKeepAlive } from './keepalive.mjs';

const NODE = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const PID = process.env.PID || 'OLfTpKgOZtVO60iSkWCRU_xwuf5RbmGFf7Dq-Usbpys';
const MODE = process.env.MODE || 'harness';
const N = Number(process.env.N || 12);
const DATA = JSON.stringify(['Gloves', 'Long', 'Beanie', 'Skirt', 'Shirt', 'Shoes']);

await useKeepAlive({ quiet: true });
const burners = await listBurners();
const jwk = burners[Number(process.env.WALLET || 0)].jwk;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildMsg() {
  const f = new Map();
  const put = (k, v) => f.set(String(k).toLowerCase(), typeof v === 'string' ? v : String(v));
  put('target', PID); put('type', 'Message'); put('subject', 'self');
  put('action', 'Sprite.Update'); put('data', DATA);
  put('random-seed', String(Math.floor(Math.random() * 1e9)));
  return Object.fromEntries(f);
}

const rows = [];
for (let i = 0; i < N; i += 1) {
  const t0 = now();
  const { headers, body } = commit(buildMsg(), jwk, {});
  const tSigned = now();
  const res = await fetch(`${transportNode(NODE)}/${PID}~process@1.0/schedule`, {
    method: 'POST', headers: { ...headers, 'accept-bundle': 'true' },
    body: body && body.length ? body : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const tPosted = now();
  const slot = res.headers.get('slot');
  if (res.status !== 200 || slot == null) {
    console.log(`#${i} POST ${res.status} ${buf.toString().slice(0, 200)}`);
    continue;
  }

  let pushMs = null, pushStart = null;
  if (MODE !== 'nopush') {
    pushStart = now();
    // timed, not fire-and-forget, so the cost is visible
    pushSlot({ node: NODE, process: PID, slot }).then(() => { pushMs = now() - pushStart; });
  }

  let headMs = null;
  if (MODE === 'head') {
    const h0 = now();
    for (;;) {
      const r = await fetch(`${transportNode(NODE)}/${PID}~process@1.0/now/at-slot`,
        { headers: { accept: 'text/plain' } }).catch(() => null);
      const t = r && r.ok ? (await r.text()).trim() : '';
      if (/^\d+$/.test(t) && Number(t) >= Number(slot)) break;
      if (now() - h0 > 20000) break;
      await sleep(50);
    }
    headMs = now() - h0;
  }

  const pollStart = now();
  const url = `${transportNode(NODE)}/${PID}~process@1.0/compute&slot=${slot}/results/output/data`;
  let polls = 0, wait = MODE === 'harness' ? 200 : 0, firstByteAt = null, legs = [];
  const deadline = pollStart + 45000;
  while (now() < deadline) {
    if (wait > 0) await sleep(wait);
    if (MODE === 'harness') wait = Math.min(600, Math.round(wait * 1.4));
    const a = now();
    const r = await fetch(url, { headers: { accept: 'text/plain' } }).catch(() => null);
    const b = now();
    polls += 1;
    const txt = r && r.ok ? (await r.text()).trim() : '';
    const good = txt && !/^<!DOCTYPE html|^<html/i.test(txt);
    legs.push({ ms: Math.round(b - a), status: r?.status ?? null, bytes: txt.length, good });
    if (good) { firstByteAt = now(); break; }
    if (MODE !== 'harness') await sleep(25);
  }
  const tDone = firstByteAt ?? now();
  rows.push({
    i, slot: Number(slot),
    signMs: +(tSigned - t0).toFixed(1),
    postMs: +(tPosted - tSigned).toFixed(1),
    headMs: headMs === null ? null : Math.round(headMs),
    pollWallMs: Math.round(tDone - pollStart),
    polls,
    legs,
    totalMs: Math.round(tDone - t0),
    pushMs: pushMs === null ? null : Math.round(pushMs),
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(p * (s.length - 1))]) : null; };
const pick = (k) => rows.map((r) => r[k]).filter((v) => v != null);
console.log(`\nMODE=${MODE} n=${rows.length}`);
for (const k of ['signMs', 'postMs', 'headMs', 'pollWallMs', 'totalMs', 'polls']) {
  const v = pick(k); if (!v.length) continue;
  console.log(`${k.padEnd(12)} p50 ${String(q(v, 0.5)).padStart(6)}  p95 ${String(q(v, 0.95)).padStart(6)}  min ${String(q(v, 0)).padStart(6)}  max ${String(q(v, 1)).padStart(6)}`);
}
const firstLeg = rows.map((r) => r.legs[0]?.ms).filter((v) => v != null);
console.log(`poll HTTP    p50 ${q(firstLeg, 0.5)} ms (one read request, wire time)`);
