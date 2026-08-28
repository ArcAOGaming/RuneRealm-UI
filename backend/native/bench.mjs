/**
 * bench.mjs — measure the read path of a live process, on whichever node.
 *
 *   node backend/native/bench.mjs                        # whatever live-process.txt says
 *   node backend/native/bench.mjs <pid> <node> [samples]
 *
 * Reads only: unsigned GETs of published keys. No wallet, nothing written,
 * nothing scheduled — so this is safe to point at production and safe to run
 * repeatedly. The write path is measured by `deploy.mjs`'s own smoke test,
 * which prints a write/read pair per action.
 *
 * Why the read path is worth measuring on its own: `/now/<key>` has to compute
 * to the scheduler head, so it inherits whatever write backlog the node is
 * carrying. HANDOFF §12 measured 87 ms when idle and 18–46 SECONDS under twelve
 * concurrent writers. A number from an idle node is a floor, not a promise —
 * which is exactly why comparing two nodes is only fair if both are idle.
 *
 * `factions`, `leaderboard` and `catalog` are recomputed and republished on
 * every message; `users` is a single number. Sampling all four separates "this
 * node is slow" from "this key is expensive".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const live = (() => {
  const f = path.join(ROOT, 'live-process.txt');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
})();

const PID = process.argv[2] || live[0];
const NODE = process.argv[3] || live[1] || 'https://schedule.forward.computer';
const SAMPLES = Number(process.argv[4] || 7);

if (!PID) {
  console.error('No process id. Pass one, or deploy so live-process.txt exists.');
  process.exit(1);
}

const KEYS = ['users', 'factions', 'leaderboard', 'catalog'];

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
};

async function sample(key) {
  const times = [];
  let bytes = 0;
  let failures = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${NODE}/${PID}~process@1.0/now/${key}`, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(45000),
      });
      const body = await res.text();
      if (!res.ok) { failures++; continue; }
      times.push(Date.now() - t0);
      bytes = Math.max(bytes, Buffer.byteLength(body));
    } catch {
      failures++;
    }
  }
  times.sort((a, b) => a - b);
  return {
    key,
    n: times.length,
    failures,
    bytes,
    p50: quantile(times, 0.5),
    p90: quantile(times, 0.9),
    min: times[0] ?? null,
    max: times[times.length - 1] ?? null,
  };
}

console.log(`process ${PID}`);
console.log(`node    ${NODE}`);
console.log(`samples ${SAMPLES} per key, sequential (an idle-node floor, not a promise)\n`);

console.log('  key            n   fails    p50     p90     min     max   size');
console.log('  ' + '-'.repeat(66));
const all = [];
for (const key of KEYS) {
  const r = await sample(key);
  all.push(r);
  const ms = (v) => (v === null ? '   -  ' : `${String(v).padStart(5)}ms`);
  console.log(`  ${r.key.padEnd(12)} ${String(r.n).padStart(3)} ${String(r.failures).padStart(5)}  ` +
    `${ms(r.p50)} ${ms(r.p90)} ${ms(r.min)} ${ms(r.max)} ${String(r.bytes).padStart(6)}B`);
}

const ok = all.filter((r) => r.p50 !== null);
if (ok.length) {
  const overall = ok.map((r) => r.p50).sort((a, b) => a - b);
  console.log(`\n  median across keys: ${quantile(overall, 0.5)}ms`);
}
const failed = all.filter((r) => r.failures);
if (failed.length) {
  console.log(`\n  ! ${failed.map((r) => `${r.key} failed ${r.failures}/${SAMPLES}`).join(', ')}`);
  console.log('    a process is bound to the scheduler it was spawned on: another');
  console.log('    node can only serve it if it can fetch it, and one that cannot');
  console.log('    answers necessary_message_not_found rather than "wrong node".');
}
