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

// What `PROFILE_SRC` has to contain, read out of the profiler itself.
//
// This list used to be written out by hand -- game.lua, battle.lua,
// constants.lua, jsonenc.lua -- and the profiler then grew two more `readSrc`
// calls, for `economy.lua` and `monster-index.generated.lua`. Nothing tied the
// two together, so the scratch directory was silently incomplete and every run
// of this tool died on `ENOENT ... monster-index.generated.lua` from inside a
// child process, i.e. as a stack trace about a temp path rather than as
// "bench-compare is out of date". Deriving the list means a future `readSrc`
// cannot break it the same way.
//
// `profile_compute.lua` is deliberately NOT reachable this way: it is read with
// `read`, not `readSrc`, because it is the measuring instrument, and swapping
// the instrument with the subject would make the comparison meaningless.
const PROFILER = path.join(HERE, 'run-local-profile.mjs');
const REQUIRED = [...new Set(
  Array.from(fs.readFileSync(PROFILER, 'utf8').matchAll(/\breadSrc\(\s*['"]([^'"]+)['"]/g),
    (match) => match[1]),
)];
if (REQUIRED.length === 0) {
  throw new Error(`no readSrc(...) calls found in ${PROFILER}; this tool cannot tell `
    + 'which sources to check out. Fix the pattern here rather than guessing.');
}

// Of those, the ones that are actually under version control move between
// revisions. Anything else -- `monster-index.generated.lua` is the case that
// exists -- is GENERATED and untracked, so no revision has a copy to check out
// and it is this checkout's in both halves, exactly like the probe, the 168
// recovered players and the AOS module. Copying it rather than checking it out
// is the whole reason the comparison stays honest: only the code under
// measurement moves.
const tracked = new Set(execFileSync('git', ['ls-files', '--', 'backend/native'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').map((line) => line.trim().replace(/^backend\/native\//, '')).filter(Boolean));
const SOURCES = REQUIRED.filter((name) => tracked.has(name));
const FIXTURES = REQUIRED.filter((name) => !tracked.has(name));

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

/** The commit that first added a source, so a too-old revision can be named. */
function firstCommitAdding(name) {
  try {
    return execFileSync('git',
      ['log', '--diff-filter=A', '--format=%h %s', '--', `backend/native/${name}`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      .trim().split('\n').pop().trim();
  } catch {
    return null;
  }
}

function checkout(revision) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-bench-'));
  for (const name of SOURCES) {
    let content;
    try {
      content = execFileSync('git', ['show', `${revision}:backend/native/${name}`],
        { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // A module that did not exist yet -- `economy.lua` arrived partway
      // through this history. Standing this checkout's copy in was tried and is
      // wrong: `economy.lua` reads `C.ECONOMY`, the revision's own
      // `constants.lua` predates that key, and the bundle dies on
      // "attempt to index a nil value (field 'ECONOMY')" from inside a child
      // process. Two revisions whose bundles are not the same SHAPE cannot be
      // compared, and saying which revision is the boundary is more use than
      // either a substitution or "pick a revision that does".
      const added = firstCommitAdding(name);
      throw new Error(`${revision} predates backend/native/${name}, which the profiler's `
        + `bundle requires.\n  Comparable revisions start at: ${added || '(unknown)'}\n  `
        + `git log --diff-filter=A -- backend/native/${name}`);
    }
    fs.writeFileSync(path.join(directory, name), content);
  }
  for (const name of FIXTURES) {
    fs.copyFileSync(path.join(HERE, name), path.join(directory, name));
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
process.stderr.write(`${players} players, ${samples} messages/type, ${rounds} interleaved rounds\n`);
process.stderr.write(`moving: ${SOURCES.join(', ')}\n`);
if (FIXTURES.length > 0) {
  process.stderr.write(`this checkout's in both halves (generated, untracked): ${FIXTURES.join(', ')}\n`);
}
process.stderr.write('\n');

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
