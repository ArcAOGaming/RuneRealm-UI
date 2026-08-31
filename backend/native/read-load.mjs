/**
 * read-load.mjs — the OTHER half of the load: what the frontend reads.
 *
 *   node backend/native/read-load.mjs --readers 20 --duration 300
 *   node backend/native/read-load.mjs --readers 50 --duration 300 --interval 2000
 *
 * The swarm measures signed WRITES. A real player also generates a steady
 * stream of unsigned reads, and those are not free of the write backlog: a
 * `/now/<key>` read has to compute to the scheduler head, so it queues behind
 * every write in flight. The old baseline measured a published read at 87 ms on
 * an idle node and 18-46 SECONDS under twelve concurrent writers. A load test
 * that only writes therefore reports a system far healthier than the one a
 * player is actually looking at.
 *
 * The key list and the shape of a poll are taken from instrumenting the real
 * app in a browser: on each state change it refreshes `challenges`, `factions`,
 * `access`, `leaderboard` and `catalog`, and a connected wallet additionally
 * reads its own `player-<address>`.
 *
 * Unsigned, free, and creates nothing. It still costs the NODE real work, which
 * is the point.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const int = (name, fallback, min, max) => {
  const value = Number(opt(name, fallback));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
};

const readers = int('readers', 20, 1, 500);
const durationSec = int('duration', 120, 5, 7200);
const intervalMs = int('interval', 1500, 100, 60_000);

const live = fs.existsSync(path.join(ROOT, 'live-process.txt'))
  ? fs.readFileSync(path.join(ROOT, 'live-process.txt'), 'utf8').trim().split(/\r?\n/)
  : [];
const pid = opt('pid', process.env.GAME_PROCESS || live[0]);
const node = (opt('node', process.env.NODE_URL || live[1] || 'https://hyperbeam.tylerw.ai'))
  .replace(/\/$/, '');
if (!/^[A-Za-z0-9_-]{43}$/.test(pid || '')) {
  throw new Error('No process id: pass --pid or write live-process.txt');
}

// What the app actually polls. `player-<address>` is included because it is the
// per-player key every connected wallet reads, and it is the one whose cost
// grows with the number of players rather than staying flat.
const SHARED_KEYS = ['challenges', 'factions', 'access', 'leaderboard', 'catalog'];

function burnerAddresses() {
  const dir = process.env.BURNER_DIR || path.join(ROOT, '.burners');
  if (!fs.existsSync(dir)) return [];
  const manifest = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifest)) {
    try {
      const body = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const rows = Array.isArray(body) ? body : body.wallets ?? body.rows ?? [];
      return rows.map((r) => r.address).filter((a) => /^[A-Za-z0-9_-]{43}$/.test(a || ''));
    } catch { /* fall through */ }
  }
  return [];
}

const addresses = burnerAddresses();
const samples = [];
let stopped = false;

async function pollOnce(key) {
  const started = performance.now();
  try {
    const res = await fetch(`${node}/${pid}~process@1.0/now/${key}`, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.text();
    const ms = performance.now() - started;
    // A 404 is a legitimate "not published yet", not a failure. The HTML
    // landing page served at 200 IS one -- see CLAUDE.md.
    const html = /^<!DOCTYPE html|^<html/i.test(body.trim());
    return { key, ms, status: res.status, ok: res.ok && !html, at: Date.now() };
  } catch (error) {
    return { key, ms: performance.now() - started, status: 'ERR', ok: false, at: Date.now(),
      error: error.message };
  }
}

async function reader(index) {
  // Each reader watches its own player key when there are burners to stand in
  // for connected wallets, plus the shared board keys every client polls.
  const own = addresses.length ? `player-${addresses[index % addresses.length]}` : null;
  const keys = own ? [...SHARED_KEYS, own] : SHARED_KEYS;
  let cursor = index % keys.length;
  while (!stopped) {
    samples.push(await pollOnce(keys[cursor % keys.length]));
    cursor += 1;
    if (stopped) break;
    // Jittered so fifty readers do not march in lockstep, which would measure a
    // thundering herd rather than steady client traffic.
    await new Promise((r) => setTimeout(r, intervalMs * (0.5 + Math.random())));
  }
}

const pct = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

console.log(`read load: ${readers} readers, ${durationSec}s, ~${intervalMs}ms interval`);
console.log(`process ${pid}`);
console.log(`node    ${node}`);
console.log(`keys    ${SHARED_KEYS.join(', ')}${addresses.length ? `, player-<addr> (${addresses.length} wallets)` : ''}\n`);

const started = Date.now();
setTimeout(() => { stopped = true; }, durationSec * 1000);
await Promise.all(Array.from({ length: readers }, (_, i) => reader(i)));

const elapsed = (Date.now() - started) / 1000;
const ok = samples.filter((s) => s.ok);
const bad = samples.filter((s) => !s.ok);
const all = ok.map((s) => s.ms);

console.log(`\n${samples.length} reads in ${elapsed.toFixed(0)}s `
  + `(${(samples.length / elapsed).toFixed(1)}/s), ${bad.length} failed`);
console.log(`latency  p50 ${pct(all, 50)}ms  p90 ${pct(all, 90)}ms  `
  + `p99 ${pct(all, 99)}ms  max ${pct(all, 100)}ms`);

// Early vs late is the tell for a queue building: a median that doubles over
// the run means the node is falling behind, even when the aggregate looks fine.
const half = Math.floor(ok.length / 2);
if (half > 4) {
  console.log(`drift    median ${pct(ok.slice(0, half).map((s) => s.ms), 50)}ms early `
    + `-> ${pct(ok.slice(half).map((s) => s.ms), 50)}ms late`);
}

console.log('\nby key:');
for (const key of [...new Set(samples.map((s) => s.key.replace(/^player-.*/, 'player-<addr>')))]) {
  const forKey = ok.filter((s) => s.key.replace(/^player-.*/, 'player-<addr>') === key);
  if (!forKey.length) continue;
  const ms = forKey.map((s) => s.ms);
  console.log(`  ${key.padEnd(16)} n=${String(forKey.length).padStart(4)}  `
    + `p50 ${String(pct(ms, 50)).padStart(6)}ms  p90 ${String(pct(ms, 90)).padStart(6)}ms  `
    + `max ${String(pct(ms, 100)).padStart(6)}ms`);
}
if (bad.length) {
  const kinds = new Map();
  for (const s of bad) {
    const kind = s.error ? s.error.slice(0, 60) : `status ${s.status}`;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.log('\nfailures:');
  for (const [kind, count] of kinds) console.log(`  ${String(count).padStart(4)}x ${kind}`);

  // Say what a 429 means, loudly, because it does not mean what it looks like.
  //
  // A rate-limited run reports ~100% read failure and zero write throughput,
  // which reads exactly like the system collapsing under load. It is an nginx
  // `limit_req` in front of the node — measured on hyperbeam.tylerw.ai at
  // roughly 25 req/s AGGREGATE, while reads alone sustain 20/s and a burst of
  // 40 simultaneous reads all succeed. Compute was never the constraint, so a
  // run that trips this has measured the proxy and nothing else.
  const throttled = [...kinds].filter(([kind]) => /status 429/.test(kind))
    .reduce((n, [, count]) => n + count, 0);
  if (throttled) {
    console.log(`\n!! ${throttled} of ${samples.length} reads were RATE LIMITED (429).`);
    console.log('   This is the reverse proxy in front of the node, not HyperBEAM');
    console.log('   capacity and not the battle fleet. Numbers from this run say');
    console.log('   nothing about how much load the system can carry.');
    console.log('   Re-run at lower concurrency, or raise limit_req on the node first.');
    process.exitCode = 1;
  }
}
