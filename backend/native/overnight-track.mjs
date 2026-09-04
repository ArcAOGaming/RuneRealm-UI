/**
 * overnight-track.mjs — sample the live graph while the swarm runs.
 *
 *   node backend/native/overnight-track.mjs --minutes 360 --every 300
 *
 * Writes one JSON line per sample to .ladder/overnight-<start>.jsonl and keeps
 * a human-readable summary next to it. This exists because the last long swarm
 * ran for hours and left nothing behind except a slow node: the run itself was
 * not the artefact, and there was no record of when throughput or latency
 * changed. Sampling is read-only -- every value here comes from published state
 * or a HEAD-shaped GET, so tracking never competes with the swarm for slots.
 *
 * Latency is measured the way a player experiences it: a published read of the
 * process's own head. `at-slot` deltas between samples give scheduler
 * throughput without scheduling anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const minutes = Number(opt('--minutes', '360'));
const everySec = Number(opt('--every', '300'));
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
  throw new Error('--minutes must be a number from 1 to 1440');
}
if (!Number.isFinite(everySec) || everySec < 10 || everySec > 3600) {
  throw new Error('--every must be a number of seconds from 10 to 3600');
}

const state = JSON.parse(
  fs.readFileSync(path.join(HERE, 'deployment-state.json'), 'utf8'));
const NODE = process.env.NODE_URL || state.node;
const P = state.processes;

const outDir = path.join(ROOT, '.ladder');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonl = path.join(outDir, `overnight-${stamp}.jsonl`);
const summary = path.join(outDir, `overnight-${stamp}.md`);

/**
 * Read a published key and time it.
 *
 * An HTML body at status 200 is how this node says "key absent" -- it serves
 * its own landing page rather than a 404 -- so that is treated as a miss here
 * exactly as it is everywhere else a published key is read.
 */
async function readKey(pid, key) {
  const t0 = process.hrtime.bigint();
  try {
    const r = await fetch(`${NODE}/${pid}~process@1.0/now/${key}`, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.text();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const html = /^\s*<!DOCTYPE html|^\s*<html/i.test(body);
    return {
      ok: r.ok && !html && body.trim() !== '',
      status: r.status, ms: Math.round(ms), bytes: body.length,
      value: (!r.ok || html) ? null : body.trim().slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false, status: 0,
      ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6),
      bytes: 0, value: null, error: e.message,
    };
  }
}

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

let prev = null;
const rows = [];
const started = Date.now();
const deadline = started + minutes * 60_000;

console.log(`tracking ${NODE}`);
console.log(`game    ${P.game}`);
console.log(`every   ${everySec}s for ${minutes} minutes`);
console.log(`events  ${jsonl}\n`);

while (Date.now() < deadline) {
  const at = Date.now();
  const [gameSlot, users, lb, econ, runeSlot, runeSupply, ammSlot] = await Promise.all([
    readKey(P.game, 'at-slot'),
    readKey(P.game, 'users'),
    readKey(P.game, 'leaderboard'),
    readKey(P.game, 'economy'),
    P.rune ? readKey(P.rune, 'at-slot') : Promise.resolve(null),
    P.rune ? readKey(P.rune, 'totalsupply') : Promise.resolve(null),
    P.amm ? readKey(P.amm, 'at-slot') : Promise.resolve(null),
  ]);

  const slot = gameSlot.ok ? num(gameSlot.value) : null;
  const elapsedMin = (at - started) / 60_000;
  const dSlots = prev && slot !== null && prev.slot !== null ? slot - prev.slot : null;
  const dMin = prev ? (at - prev.at) / 60_000 : null;

  const row = {
    t: new Date(at).toISOString(),
    elapsedMin: Number(elapsedMin.toFixed(1)),
    gameSlot: slot,
    slotsPerMin: dSlots !== null && dMin ? Number((dSlots / dMin).toFixed(1)) : null,
    users: users.ok ? num(users.value) : null,
    readMs: gameSlot.ms,
    leaderboardMs: lb.ms,
    leaderboardBytes: lb.bytes,
    economyBytes: econ.bytes,
    runeSlot: runeSlot?.ok ? num(runeSlot.value) : null,
    runeSupply: runeSupply?.ok ? runeSupply.value : null,
    ammSlot: ammSlot?.ok ? num(ammSlot.value) : null,
    // A read that stops answering is the signal that matters most overnight.
    healthy: gameSlot.ok && users.ok,
    errors: [gameSlot, users, lb, econ].filter((r) => !r.ok)
      .map((r) => r.error || `status ${r.status}`),
  };

  rows.push(row);
  fs.appendFileSync(jsonl, JSON.stringify(row) + '\n');
  console.log(
    `${row.t}  +${String(row.elapsedMin).padStart(5)}m  slot ${String(row.gameSlot).padStart(6)}`
    + `  ${String(row.slotsPerMin ?? '-').padStart(6)}/min  users ${String(row.users ?? '-').padStart(4)}`
    + `  read ${String(row.readMs).padStart(5)}ms  lb ${String(row.leaderboardBytes).padStart(7)}B`
    + (row.healthy ? '' : `  UNHEALTHY ${row.errors.join(', ')}`));

  prev = { at, slot };
  const wait = Math.min(everySec * 1000, deadline - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// Summary. Written at the end AND safe to derive from the jsonl if this dies.
const healthy = rows.filter((r) => r.healthy);
const rates = rows.map((r) => r.slotsPerMin).filter((v) => v !== null);
const reads = healthy.map((r) => r.readMs).sort((a, b) => a - b);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
const first = rows[0] ?? {};
const last = rows[rows.length - 1] ?? {};

const text = [
  `# Overnight swarm tracking — ${stamp}`,
  '',
  `node: ${NODE}`,
  `game: ${P.game}`,
  `rune: ${P.rune}   amm: ${P.amm}   quote: ${P.quote}`,
  '',
  `samples: ${rows.length} (${healthy.length} healthy, ${rows.length - healthy.length} unhealthy)`,
  `window: ${first.t ?? '-'} .. ${last.t ?? '-'}`,
  '',
  '## Throughput',
  `slots: ${first.gameSlot ?? '-'} -> ${last.gameSlot ?? '-'}`
    + ` (${last.gameSlot !== null && first.gameSlot !== null ? last.gameSlot - first.gameSlot : '-'} total)`,
  `slots/min: median ${pct(rates.slice().sort((a, b) => a - b), 0.5) ?? '-'}`
    + `  min ${rates.length ? Math.min(...rates) : '-'}  max ${rates.length ? Math.max(...rates) : '-'}`,
  `users: ${first.users ?? '-'} -> ${last.users ?? '-'}`,
  '',
  '## Published read latency (what a player pays to look)',
  `p50 ${pct(reads, 0.5) ?? '-'}ms   p95 ${pct(reads, 0.95) ?? '-'}ms   max ${reads.length ? reads[reads.length - 1] : '-'}ms`,
  '',
  '## State growth',
  `leaderboard: ${first.leaderboardBytes ?? '-'}B -> ${last.leaderboardBytes ?? '-'}B`,
  `economy:     ${first.economyBytes ?? '-'}B -> ${last.economyBytes ?? '-'}B`,
  '',
  '## Unhealthy samples',
  ...(rows.filter((r) => !r.healthy).map((r) => `- ${r.t} (+${r.elapsedMin}m): ${r.errors.join(', ')}`)),
  ...(rows.every((r) => r.healthy) ? ['none — every sample answered'] : []),
  '',
  `events: ${path.relative(ROOT, jsonl)}`,
].join('\n');

fs.writeFileSync(summary, text);
console.log(`\n${text}`);
console.log(`\nsummary ${summary}`);
