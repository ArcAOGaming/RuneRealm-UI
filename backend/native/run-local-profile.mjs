/** Offline CPU profile for the carried-state game hot path. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

// The WASM loader installs deterministic clock shims while it executes. Keep a
// bound reference to Node's real monotonic clock before creating the loader.
const hostNow = performance.now.bind(performance);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');

// Which CONTRACT sources to profile. The probe, the fixtures and the AOS module
// always come from this checkout -- only the code under measurement moves -- so
// an old revision is measured by the current probe against the same players,
// which is the only way the two numbers mean anything next to each other.
const SRC = process.env.PROFILE_SRC ? path.resolve(process.env.PROFILE_SRC) : HERE;
const readSrc = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const asJson = process.argv.includes('--json');
const asBytes = process.argv.includes('--bytes');
// stdout carries the JSON document when asked for, so progress and headings go
// to stderr rather than corrupting it.
const say = (line) => (asJson ? console.error(line) : console.log(line));

const requested = Number(process.argv[2] ?? 50);
if (!Number.isSafeInteger(requested) || requested < 0 || requested > 10_000) {
  throw new Error('player count must be an integer from 0 to 10000');
}
const samples = Number(process.argv[3] ?? 50);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10_000) {
  throw new Error('sample count must be an integer from 1 to 10000');
}

const recovered = JSON.parse(read('legacy-players.json'));
const availableRows = Array.isArray(recovered) ? recovered : recovered.players ?? [];
if (requested > availableRows.length) {
  throw new Error(`player count ${requested} exceeds fixture size ${availableRows.length}`);
}
const rows = availableRows.slice(0, requested);
const payload = JSON.stringify({ players: rows });
const probe = read('profile_compute.lua').replace('__PAYLOAD__', payload);
if (probe.includes('__PAYLOAD__')) throw new Error('profile payload marker was not replaced');

const bootstrapSource = [
  'package.loaded[".json"] = require("json")',
  'Owner = nil',
  'local C = (function()', readSrc('constants.lua'), 'end)()',
  readSrc('monster-index.generated.lua'),
  'local jsonx = (function()', readSrc('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', readSrc('battle.lua'), 'end)()',
  'local EconomyEngine = (function()', readSrc('economy.lua'), 'end)()',
  readSrc('game.lua'),
  // `--bytes` asks the probe for its published-size report instead of the host
  // timing report. The two are exclusive in the probe: the size report ends by
  // sending one more read so it has a reply to measure, and that trailing
  // publication would leak into a differential timing measurement.
  //
  // Size is the other half of "did it get faster". A write's cost here is
  // dominated by how much JSON it re-encodes and republishes, so a regression in
  // microseconds is only explicable next to a regression in bytes.
  `PROFILE_OPTIONS = { hostTiming = ${asBytes ? 'false' : 'true'}, readSamples = 0, `
    + 'feedSamples = 0, attackSamples = 0 }',
  probe,
  'return profile({}, {})',
].join('\n');

const wasm = fs.readFileSync(WASM);
const loaderOptions = {
  format: 'wasm32-unknown-emscripten',
  computeLimit: 9_000_000_000_000,
  memoryLimit: 512 * 1024 * 1024,
};
const handle = await AoLoader(wasm, loaderOptions);
const id = 'local-game-profile'.padEnd(43, '_');
// profile_compute seeds this same commitment as the game owner. Keeping the
// process owner identical preserves authorization for subsequent Eval batches.
const owner = 'OWNERoooooooooooooooooooooooooooooooooooooo';
const environment = {
  Process: { Id: id, Owner: owner, Tags: [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
  ] },
};
let sequence = 0;

const run = async (memory, code, expectedOutput) => {
  // Restore the exact same checkpoint for each sibling sample, so one action
  // batch cannot warm or mutate the next action's state.
  const started = hostNow();
  const result = await handle(memory, {
    Id: `eval-game-profile-${++sequence}`.padEnd(43, '_'),
    Target: id, Owner: owner, From: owner,
    Tags: [{ name: 'Action', value: 'Eval' }], Data: code,
    'Block-Height': String(sequence), Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
  }, environment);
  const elapsedMs = hostNow() - started;
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  const output = typeof data === 'string' ? data : data?.output;
  if (expectedOutput && (typeof output !== 'string' || !output.includes(expectedOutput))) {
    throw new Error(`Profiler returned invalid output: ${JSON.stringify(output)}`);
  }
  return { elapsedMs, memory: result.Memory, output };
};

// Seed once, then fork every measured run from this exact checkpoint. The
// setup evaluation is intentionally outside every reported timer.
const prepared = await run(null, bootstrapSource, 'measurements: 0');
if (asBytes) {
  // The bootstrap evaluation already produced the size report; print it and
  // stop, rather than going on to run timing batches that would not be used.
  console.log(prepared.output);
  process.exit(0);
}
const fixturePlayers = Number(/(?:^|\n)fixture players: (\d+)/.exec(prepared.output)?.[1]);
const effectivePlayers = Number(/(?:^|\n)effective players: (\d+)/.exec(prepared.output)?.[1]);
if (fixturePlayers !== rows.length) {
  throw new Error(`profiler loaded ${fixturePlayers} fixture players; expected ${rows.length}`);
}
if (effectivePlayers !== fixturePlayers + 1) {
  throw new Error(`profiler returned ${effectivePlayers} effective players; `
    + `expected fixture plus profile player = ${fixturePlayers + 1}`);
}
const preparedBattle = await run(prepared.memory, 'return profilePrepareBattle()');
const batchCode = (kind) => `return profileLocalBatch("${kind}", ${samples})`;
const profiles = [
  { label: 'User.Info (read-only)', kind: 'read', memory: prepared.memory, base: 'regular' },
  { label: 'Monster.Feed (write)', kind: 'feed', memory: prepared.memory, base: 'regular' },
  { label: 'Battle.Attack (long-log stress)', kind: 'attack', memory: preparedBattle.memory },
];
const repeats = 3;
const pairs = new Map(profiles.map(({ label }) => [label, []]));

// Discard one no-op evaluation so one-time host warm-up is not reported.
await run(prepared.memory, batchCode('noop'));
for (let repeat = 0; repeat < repeats; repeat += 1) {
  for (const profile of profiles) {
    let baselineMs;
    let rawMs;
    if (repeat % 2 === 0) {
      baselineMs = (await run(profile.memory, batchCode('noop'))).elapsedMs;
      rawMs = (await run(profile.memory, batchCode(profile.kind))).elapsedMs;
    } else {
      rawMs = (await run(profile.memory, batchCode(profile.kind))).elapsedMs;
      baselineMs = (await run(profile.memory, batchCode('noop'))).elapsedMs;
    }
    pairs.get(profile.label).push({ baselineMs, rawMs, deltaMs: rawMs - baselineMs });
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

say(`Offline host wall profile: ${fixturePlayers} fixture players, `
  + `${effectivePlayers} effective players (includes profile player), ${samples} messages/type`);
say(`median of ${repeats} paired checkpoint runs; each raw-minus-matched-baseline`);
say('Battle.Attack is a long-battle/growing-turn-log stress case, not a typical-fight average.');

const measured = {};
for (const profile of profiles) {
  const observations = pairs.get(profile.label);
  const actionMs = median(observations.map(({ deltaMs }) => deltaMs));
  measured[profile.label] = {
    usPerMessage: (actionMs * 1000) / samples,
    totalMs: actionMs,
    belowNoiseFloor: !(actionMs > 0),
  };
}

if (asJson) {
  process.stdout.write(`${JSON.stringify({
    source: SRC === HERE ? 'working-tree' : SRC,
    players: fixturePlayers,
    effectivePlayers,
    samples,
    repeats,
    profiles: measured,
  }, null, 2)}\n`);
}

for (const profile of profiles) {
  const observations = pairs.get(profile.label);
  const actionMs = median(observations.map(({ deltaMs }) => deltaMs));
  const rawMs = median(observations.map(({ rawMs: value }) => value));
  const baseMs = median(observations.map(({ baselineMs }) => baselineMs));
  const rangeMs = observations.map(({ deltaMs }) => deltaMs).sort((a, b) => a - b);
  const minUs = (rangeMs[0] * 1000) / samples;
  const maxUs = (rangeMs[rangeMs.length - 1] * 1000) / samples;
  if (!(actionMs > 0)) {
    say(`${profile.label.padEnd(39)} ${'below noise floor'.padStart(12)}  `
      + `x${samples}  paired range ${minUs.toFixed(3)}..${maxUs.toFixed(3)} us/msg  `
      + `(raw median ${rawMs.toFixed(3)} ms; baseline median ${baseMs.toFixed(3)} ms)`);
    continue;
  }
  const usPerMessage = (actionMs * 1000) / samples;
  say(`${profile.label.padEnd(39)} ${usPerMessage.toFixed(3).padStart(12)} us/msg  `
      + `x${samples}  total ${actionMs.toFixed(3).padStart(9)} ms  `
      + `range ${minUs.toFixed(3)}..${maxUs.toFixed(3)} us/msg  `
      + `(raw median ${rawMs.toFixed(3)} ms; baseline median ${baseMs.toFixed(3)} ms)`);
}
