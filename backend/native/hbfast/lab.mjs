/**
 * hbfast — how fast can a HyperBEAM process take writes, and what slows it down.
 *
 * Everything here is measured against a node you control (default the local
 * lab container on :8734). Nothing in it is Rune Realm; it is one KV contract
 * and a stopwatch, so the numbers are about the platform rather than a game.
 *
 *   node lab.mjs spawn   [--shards 4] [--policy hot|none|all]
 *   node lab.mjs ceiling [--shards 1,2,4] [--conc 1,4,16,32] [--n 64]
 *   node lab.mjs growth  [--to 20000] [--step 2000]
 *   node lab.mjs reads   [--conc 16]
 *
 * Two things it deliberately does NOT do, because both are what makes the
 * production client slow:
 *
 *   - it never fires a background `push` alongside a `compute` (that is the
 *     2.79x slot-replay factor in SLOT_LATENCY_INVESTIGATION), and
 *   - it can measure the write WITHOUT awaiting the writer's own slot, which
 *     is the difference between a 12 s action and a 200 ms one.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnProcess, postSigned, send } from '../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const NODE = (process.env.NODE_URL || 'http://localhost:8734').replace(/\/$/, '');
const STATE = path.join(HERE, `shards.${new URL(NODE).port || 'remote'}.json`);

const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

const argv = process.argv.slice(3);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const nums = (s) => String(s).split(',').map((x) => Number(x.trim())).filter(Number.isFinite);

/** Schedule one signed message. Returns the slot, and nothing else happens:
 *  no push, no compute. This is the whole durable write. */
async function schedule(pid, tags) {
  const msg = {
    target: pid, type: 'Message', subject: 'self',
    'random-seed': String(Math.floor(Math.random() * 1e9)),
    ...tags,
  };
  const res = await postSigned(NODE, `/${pid}~process@1.0/schedule`, msg, jwk);
  if (res.status !== 200) throw new Error(`schedule ${res.status}: ${res.body?.toString().slice(0, 200)}`);
  return Number(res.headers.slot);
}

/** Ask the node to compute one slot and hand back its reply. This is the part
 *  that queues: every uncomputed compute for a process funnels through one
 *  worker (dev_process_worker:compute_group). */
async function compute(pid, slot) {
  const res = await send(NODE, `/${pid}~process@1.0/compute&slot=${slot}/results/output/data`, 'GET', { accept: 'text/plain' });
  return { status: res.status, body: res.body.toString() };
}

async function readKey(pid, key) {
  const res = await send(NODE, `/${pid}~process@1.0/now/${key}`, 'GET', { accept: 'text/plain' });
  return { status: res.status, body: res.body.toString() };
}

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (n >= 1000 ? Math.round(n) : Number(n.toFixed(1)));

/** Run `total` tasks with at most `conc` in flight. Returns per-task ms. */
async function drive(total, conc, task) {
  const times = [];
  let next = 0;
  const started = now();
  await Promise.all(Array.from({ length: Math.min(conc, total) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const t0 = now();
      try { await task(i); } catch { times.push(NaN); continue; }
      times.push(now() - t0);
    }
  }));
  const wall = now() - started;
  const good = times.filter(Number.isFinite);
  return {
    ok: good.length, failed: times.length - good.length, wallMs: wall,
    perSec: good.length / (wall / 1000),
    p50: pct(good, 50), p90: pct(good, 90), max: Math.max(0, ...good),
  };
}

const loadShards = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));

// ---------------------------------------------------------------- commands

async function cmdSpawn() {
  const count = Number(flag('shards', 4));
  const policy = flag('policy', 'hot');
  const lua = fs.readFileSync(path.join(HERE, 'kv.lua'), 'utf8');
  const shards = [];
  for (let i = 0; i < count; i++) {
    const pid = await spawnProcess({
      node: NODE, jwk, lua,
      name: `TEST-hbfast-kv-${policy}-${i}`,
      'kv-publish': policy,
    });
    // First compute is also what initializes the VM, so do it once here rather
    // than letting the first benchmarked write pay for it.
    const slot = await schedule(pid, { action: 'stat' });
    const r = await compute(pid, slot);
    shards.push(pid);
    console.log(`  shard ${i}  ${pid}  ${r.status} ${r.body.slice(0, 60)}`);
  }
  fs.writeFileSync(STATE, JSON.stringify({ node: NODE, policy, shards }, null, 2));
  console.log(`\n${count} shards, policy=${policy}, node=${NODE}\n-> ${STATE}`);
}

/** The headline: writes per second, with and without waiting for your own slot,
 *  across shard counts and concurrency. */
async function cmdCeiling() {
  const { shards, policy } = loadShards();
  const shardCounts = nums(flag('shards', [...new Set([1, 2, shards.length])].join(',')))
    .filter((n) => n >= 1 && n <= shards.length);
  const concs = nums(flag('conc', '1,4,16,32'));
  const n = Number(flag('n', 64));
  console.log(`node ${NODE}  policy=${policy}  ${n} writes per cell\n`);

  for (const mode of ['schedule-only', 'schedule+compute']) {
    console.log(`## ${mode}`);
    console.log('| shards | conc | writes/s | p50 ms | p90 ms | max ms | failed |');
    console.log('|---|---|---|---|---|---|---|');
    for (const s of [...new Set(shardCounts)]) {
      for (const c of concs) {
        const use = shards.slice(0, s);
        const r = await drive(n, c, async (i) => {
          const pid = use[i % use.length];
          const slot = await schedule(pid, { action: 'set', key: `c${c}s${s}n${i}`, value: `v${i}` });
          if (mode === 'schedule+compute') await compute(pid, slot);
        });
        console.log(`| ${s} | ${c} | ${fmt(r.perSec)} | ${fmt(r.p50)} | ${fmt(r.p90)} | ${fmt(r.max)} | ${r.failed} |`);
      }
    }
    console.log('');
  }
}

/** What the published map costs: latency of one write as the store grows. */
async function cmdGrowth() {
  const { shards, policy } = loadShards();
  const pid = shards[0];
  const to = Number(flag('to', 20000));
  const step = Number(flag('step', 2000));
  const probe = Number(flag('probe', 10));
  console.log(`node ${NODE}  policy=${policy}  process ${pid}\n`);
  console.log('| records | write p50 ms | write p90 ms | /now/keys ms | now bytes |');
  console.log('|---|---|---|---|---|');
  for (let at = 0; at <= to; at += step) {
    if (at > 0) {
      // Seed in chunks so no single slot runs away; the seed slot itself is
      // not measured.
      for (let from = at - step; from < at; from += 1000) {
        const slot = await schedule(pid, { action: 'seed', count: String(Math.min(1000, at - from)), from: String(from), size: '64' });
        await compute(pid, slot);
      }
    }
    const r = await drive(probe, 1, async (i) => {
      const slot = await schedule(pid, { action: 'set', key: `probe${at}_${i}`, value: 'p' });
      await compute(pid, slot);
    });
    // Both reads can genuinely fail under `policy=all`: every record becomes a
    // top-level key, keys become HTTP headers, and past a few thousand records
    // the response blows the client's header buffer outright
    // (UND_ERR_HEADERS_OVERFLOW). That is a result, not a harness bug, so it is
    // reported rather than thrown.
    const t0 = now();
    let count = String(at);
    let readMs = NaN;
    try { count = (await readKey(pid, 'keys')).body.trim() || String(at); readMs = now() - t0; }
    catch (err) { count = `${at}?`; }
    let bytes = 'FAILED';
    try { bytes = String((await send(NODE, `/${pid}~process@1.0/now`, 'GET', {})).body.length); }
    catch { /* header overflow — see above */ }
    console.log(`| ${count} | ${fmt(r.p50)} | ${fmt(r.p90)} | ${Number.isFinite(readMs) ? fmt(readMs) : 'FAILED'} | ${bytes} |`);
  }
}

/** Do writes starve reads? Read the published key while writes are in flight. */
async function cmdReads() {
  const { shards } = loadShards();
  const pid = shards[0];
  const conc = Number(flag('conc', 16));
  const idle = await drive(20, 4, async () => { await readKey(pid, 'keys'); });
  console.log(`idle reads:        p50 ${fmt(idle.p50)} ms  ${fmt(idle.perSec)}/s`);

  const load = drive(400, conc, async (i) => {
    const slot = await schedule(pid, { action: 'set', key: `load${i}`, value: 'x' });
    await compute(pid, slot);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const under = await drive(20, 4, async () => { await readKey(pid, 'keys'); });
  console.log(`reads under write: p50 ${fmt(under.p50)} ms  ${fmt(under.perSec)}/s  (${conc} writers)`);
  const w = await load;
  console.log(`writers:           p50 ${fmt(w.p50)} ms  ${fmt(w.perSec)}/s  failed ${w.failed}`);
}

const cmd = process.argv[2];
const table = { spawn: cmdSpawn, ceiling: cmdCeiling, growth: cmdGrowth, reads: cmdReads };
if (!table[cmd]) {
  console.error('usage: node lab.mjs <spawn|ceiling|growth|reads> [flags]');
  process.exit(1);
}
await table[cmd]();
