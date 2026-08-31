/**
 * bench-compare.mjs — did it actually get faster?
 *
 *   node backend/native/bench-compare.mjs                 # HEAD vs working tree
 *   node backend/native/bench-compare.mjs --against f9410a4
 *   node backend/native/bench-compare.mjs --players 168 --samples 100
 *
 * A single profile run answers "how long does a message take". It cannot answer
 * "is this faster than what we had", which is the only question a rewrite is
 * actually trying to settle, and the one a number in a commit message is least
 * able to prove a week later.
 *
 * So this measures BOTH revisions in one process, on one machine, back to back:
 * it checks the contract sources out of a git revision into a scratch directory,
 * points `run-local-profile.mjs` at them with `PROFILE_SRC`, and then runs the
 * same profile against the working tree. Only the code under measurement moves
 * -- the probe, the 168 recovered players and the AOS module are this
 * checkout's in both halves -- so the two columns are comparable.
 *
 * Interleaved, not sequential: each revision is measured, then the other, then
 * back, `--rounds` times, and the median of each revision's rounds is reported.
 * A laptop that thermally throttles partway through a long run otherwise hands
 * the second revision a penalty that looks exactly like a regression.
 *
 * What it reports is host CPU inside a real AOS VM. It says nothing about
 * scheduler, network or node queueing -- `swarm:verify` and the fleet benchmark
 * are where those live.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// Only the contract sources move between revisions. `profile_compute.lua` is
// deliberately NOT in this list: it is the measuring instrument, and swapping
// the instrument with the subject would make the comparison meaningless.
const SOURCES = ['game.lua', 'battle.lua', 'constants.lua', 'jsonenc.lua'];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const against = opt('against', 'HEAD');
const players = opt('players', '50');
const samples = opt('samples', '50');
const rounds = Number(opt('rounds', '3'));
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 25) {
  throw new Error('--rounds must be an integer from 1 to 25');
}

function checkout(revision) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-bench-'));
  for (const name of SOURCES) {
    let content;
    try {
      content = execFileSync('git', ['show', `${revision}:backend/native/${name}`],
        { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      throw new Error(`${revision} has no backend/native/${name}; pick a revision that does.`);
    }
    fs.writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function profile(sourceDirectory) {
  const stdout = execFileSync(process.execPath,
    [path.join(HERE, 'run-local-profile.mjs'), players, samples, '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // stderr is the profiler's own commentary; let it through so a long run
      // does not look hung.
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PROFILE_SRC: sourceDirectory },
    });
  return JSON.parse(stdout);
}

const baseDirectory = checkout(against);
const revision = execFileSync('git', ['rev-parse', '--short', against],
  { cwd: ROOT, encoding: 'utf8' }).trim();

process.stderr.write(`\ncomparing ${against} (${revision}) against the working tree\n`);
process.stderr.write(`${players} players, ${samples} messages/type, ${rounds} interleaved rounds\n\n`);

const runs = { before: [], after: [] };
try {
  for (let round = 0; round < rounds; round += 1) {
    // Alternate which side goes first, so a machine that drifts in one
    // direction over the run does not systematically favour either revision.
    const order = round % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    for (const side of order) {
      process.stderr.write(`round ${round + 1}/${rounds}: ${side}\n`);
      runs[side].push(profile(side === 'before' ? baseDirectory : HERE));
    }
  }
} finally {
  fs.rmSync(baseDirectory, { recursive: true, force: true });
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const labels = Object.keys(runs.after[0].profiles);
const pick = (side, label) => median(runs[side].map((run) => run.profiles[label].usPerMessage));

const rows = labels.map((label) => {
  const before = pick('before', label);
  const after = pick('after', label);
  return { label, before, after, change: before > 0 ? ((after - before) / before) * 100 : NaN };
});

const width = Math.max(...labels.map((label) => label.length));
console.log(`\n${'action'.padEnd(width)}  ${`${revision} us/msg`.padStart(16)}  `
  + `${'now us/msg'.padStart(14)}  change`);
console.log('-'.repeat(width + 56));
for (const row of rows) {
  const direction = !Number.isFinite(row.change) ? ''
    : row.change < -1 ? `  ${(-row.change).toFixed(1)}% faster`
      : row.change > 1 ? `  ${row.change.toFixed(1)}% SLOWER`
        : '  unchanged';
  console.log(`${row.label.padEnd(width)}  ${row.before.toFixed(3).padStart(16)}  `
    + `${row.after.toFixed(3).padStart(14)}  ${direction.trim()}`);
}
console.log(`\nhost CPU in a real AOS VM. Scheduler, network and node queueing are `
  + `not measured here.`);
