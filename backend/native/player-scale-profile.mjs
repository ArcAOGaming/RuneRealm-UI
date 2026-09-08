/**
 * player-scale-profile.mjs -- does one message cost more because OTHER wallets
 * exist?
 *
 *   node backend/native/player-scale-profile.mjs <players> [samples] [--src DIR] [--json]
 *   npm run profile:players -- 1001
 *
 * `run-local-profile.mjs` answers "where does a message's time go" against the
 * 168 RECOVERED players, and it cannot go past them: its fixture is the real
 * legacynet export. This answers the other question -- "what does the message
 * cost at 1, at 1,001, at 5,000" -- and so it seeds SYNTHETIC accounts and has
 * no fixture ceiling. Run it at two sizes and subtract: the slope is the
 * per-wallet tax every message pays, and a flat curve is the whole point.
 *
 * It is OFFLINE, on ao-loader, deliberately. Handler CPU is the thing under
 * test; scheduler, snapshot and network time are not, and on a live node they
 * are large enough to bury a microsecond-scale slope. Nothing here is latency
 * in the sense CLAUDE.md means -- see `concurrency-ramp.mjs` for round trip.
 *
 * `--src DIR` reads the contract from another directory (the same knob
 * `run-local-profile.mjs` spells `PROFILE_SRC`), so a change can be measured
 * against its own baseline by INTERLEAVING the two -- A, B, A, B -- rather than
 * running all of one and then all of the other. Run-to-run spread on these
 * boxes is wide enough that an un-interleaved comparison of anything under ~3x
 * is not evidence.
 *
 * THREE probes, and the third is the sharp one:
 *
 *   read    `User.Info`     -- a read, so it skips the republish block
 *   feed    `Monster.Feed`  -- a write that touches one account
 *   reject  a wallet with no record at all, refused before any state moves
 *
 * `reject` is the sharp one because a refused message SHOULD cost nothing that
 * depends on the population -- it does not read another account, publish
 * another account, or derive anything from them. Whatever slope it has is pure
 * per-message tax, and it is the number to watch.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

// The loader installs deterministic clock shims while it executes; keep a bound
// reference to the host's real monotonic clock before creating it.
const hostNow = performance.now.bind(performance);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const srcIndex = argv.indexOf('--src');
const SRC = srcIndex >= 0 ? path.resolve(argv[srcIndex + 1]) : HERE;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--src');
const players = Number(positional[0] ?? 169);
const samples = Number(positional[1] ?? 10);
if (!Number.isSafeInteger(players) || players < 0 || players > 50_000) {
  throw new Error('player count must be an integer from 0 to 50000');
}
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1_000) {
  throw new Error('sample count must be an integer from 1 to 1000');
}

const readSrc = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const say = (line) => (asJson ? console.error(line) : console.log(line));

// Synthetic wallets, in fixed-width base 61 so every index maps to a distinct
// 43-character address. A variable-width encoding padded from the same alphabet
// collides -- the pad character is also a digit -- and `Admin.Load` then seeds
// fewer wallets than asked for while reporting success, which is how the seed
// count below came to be asserted rather than trusted.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const address = (i) => {
  let s = '';
  let n = i;
  for (let d = 0; d < 6; d += 1) {
    s = ALPHABET[n % ALPHABET.length] + s;
    n = Math.floor(n / ALPHABET.length);
  }
  if (n !== 0) throw new Error('player index out of encodable range');
  return `SYNTH${'z'.repeat(32)}${s}`;
};
const rows = Array.from({ length: players }, (_, i) => ({ address: address(i), unlocked: true }));

// The probe lives inside the process, because `compute` has to be driven the
// way HyperBEAM drives it: the result IS the next slot's base, and handing it a
// fresh table every message makes every derived key look absent and measures
// first-spawn publication instead of the steady state.
const probe = `
local json = require(".json")
PROFILE_T = 1700000000000
local OWNER = "OWNERoooooooooooooooooooooooooooooooooooooo"
local PROCESS = { commitments = { sig1 = { committer = OWNER } } }
PROFILE_STATE = { process = PROCESS }
function PROFILE_SEND(from, tags, data)
  PROFILE_T = PROFILE_T + 1000
  local body = { Address = from }
  for k, v in pairs(tags) do body[k] = v end
  if data then body.Data = data end
  local res = compute(PROFILE_STATE, { body = body, timestamp = PROFILE_T }, {})
  PROFILE_STATE = res
  return json.decode(res.results.output.data), res
end

function profileSeed(payload)
  local send = PROFILE_SEND
  local A = "PROFAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  PROFILE_A = A
  send(OWNER, { Action = "Admin.Unlock", Addresses = A })
  send(A, { Action = "Faction.Join", Faction = "Inferno Blades" })
  send(A, { Action = "Monster.Adopt" })
  send(OWNER, { Action = "Admin.AdjustInventory", PlayerId = A, Item = "fire_berry",
                Amount = "9000" })
  local rows = json.decode(payload).players
  for i = 1, #rows, 50 do
    local chunk = {}
    for j = i, math.min(i + 49, #rows) do chunk[#chunk + 1] = rows[j] end
    local r = send(OWNER, { Action = "Admin.Load" }, json.encode({ players = chunk }))
    if not r or r.error then error("seed failed: " .. tostring(r and r.error)) end
  end
  local n = 0
  for _ in pairs(Players) do n = n + 1 end
  -- One ordinary action after the bulk load, so the caches the bulk verbs
  -- rebuild are warm and the measured batches are not paying for the seeding.
  send(A, { Action = "User.Info" })
  return "seeded players: " .. tostring(n)
end

function profileBatch(kind, count)
  local A = PROFILE_A
  if kind == "noop" then
    for _ = 1, count do end
  elseif kind == "read" then
    for _ = 1, count do
      local r = PROFILE_SEND(A, { Action = "User.Info" })
      if not r or r.error then error("read sample failed: " .. tostring(r.error)) end
    end
  elseif kind == "feed" then
    for _ = 1, count do
      if Players[A] and Players[A].monster then Players[A].monster.energy = 0 end
      local r = PROFILE_SEND(A, { Action = "Monster.Feed", Item = "fire_berry" })
      if not r or r.error then error("feed sample failed: " .. tostring(r.error)) end
    end
  elseif kind == "reject" then
    -- No record and no admission, so every one of these is refused before any
    -- state is touched. Its cost may not depend on how many OTHER wallets exist.
    for _ = 1, count do
      local r = PROFILE_SEND("NOBODYnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn",
                             { Action = "Monster.Feed", Item = "fire_berry" })
      if not r or not r.error then error("reject sample unexpectedly succeeded") end
    end
  else
    error("unknown batch " .. tostring(kind))
  end
  return "batch done"
end
return "probe ready"
`;

const bootstrapSource = [
  'package.loaded[".json"] = require("json")',
  'Owner = nil',
  'local C = (function()', readSrc('constants.lua'), 'end)()',
  readSrc('monster-index.generated.lua'),
  'local jsonx = (function()', readSrc('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', readSrc('battle.lua'), 'end)()',
  'local OrderBook = (function()', readSrc('orderbook.lua'), 'end)()',
  'local EconomyEngine = (function()', readSrc('economy.lua'), 'end)()',
  readSrc('game.lua'),
  probe,
].join('\n');

const wasm = fs.readFileSync(WASM);
const handle = await AoLoader(wasm, {
  format: 'wasm32-unknown-emscripten',
  // Seeding thousands of accounts through `Admin.Load` is far more work than
  // any single message, and the loader charges the whole evaluation.
  computeLimit: 900_000_000_000_000,
  memoryLimit: 1024 * 1024 * 1024,
});
const id = 'player-scale-profile'.padEnd(43, '_');
const owner = 'OWNERoooooooooooooooooooooooooooooooooooooo';
const environment = { Process: { Id: id, Owner: owner, Tags: [
  { name: 'Data-Protocol', value: 'ao' },
  { name: 'Variant', value: 'ao.TN.1' },
  { name: 'Type', value: 'Process' },
] } };
let sequence = 0;

const run = async (memory, code) => {
  const started = hostNow();
  const result = await handle(memory, {
    Id: `scale-${++sequence}`.padEnd(43, '_'),
    Target: id, Owner: owner, From: owner,
    Tags: [{ name: 'Action', value: 'Eval' }], Data: code,
    'Block-Height': String(sequence), Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
  }, environment);
  const elapsedMs = hostNow() - started;
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  return { elapsedMs, memory: result.Memory, output: typeof data === 'string' ? data : data?.output };
};

const boot = await run(null, bootstrapSource);
if (!String(boot.output).includes('probe ready')) throw new Error(`bootstrap: ${boot.output}`);
const seeded = await run(boot.memory,
  `return profileSeed([==[${JSON.stringify({ players: rows })}]==])`);
const seededCount = Number(/seeded players: (\d+)/.exec(seeded.output)?.[1]);
if (seededCount !== players + 1) {
  throw new Error(`seeded ${seededCount}; expected ${players + 1} (synthetics + profile player)`);
}

const kinds = ['read', 'feed', 'reject'];
const observations = new Map(kinds.map((k) => [k, []]));
const batch = (kind) => `return profileBatch("${kind}", ${samples})`;
const REPEATS = 3;

await run(seeded.memory, batch('noop'));       // discard host warm-up
for (let repeat = 0; repeat < REPEATS; repeat += 1) {
  for (const kind of kinds) {
    // Every measured batch is forked from the SAME seeded checkpoint and paired
    // with a matched no-op batch, so VM restore and checkpoint overhead cancel.
    // The order alternates so drift cannot land on one side of the subtraction.
    let baselineMs; let rawMs;
    if (repeat % 2 === 0) {
      baselineMs = (await run(seeded.memory, batch('noop'))).elapsedMs;
      rawMs = (await run(seeded.memory, batch(kind))).elapsedMs;
    } else {
      rawMs = (await run(seeded.memory, batch(kind))).elapsedMs;
      baselineMs = (await run(seeded.memory, batch('noop'))).elapsedMs;
    }
    observations.get(kind).push((rawMs - baselineMs) * 1000 / samples);
  }
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const out = { src: SRC, players: seededCount, samples, repeats: REPEATS, us: {} };
say(`${seededCount} accounts, ${samples} messages/batch, median of ${REPEATS} paired runs`);
for (const kind of kinds) {
  const v = observations.get(kind);
  out.us[kind] = { median: median(v), min: Math.min(...v), max: Math.max(...v), all: v };
  say(`${String(kind).padEnd(7)} ${median(v).toFixed(1).padStart(10)} us/msg  `
    + `range ${Math.min(...v).toFixed(1)}..${Math.max(...v).toFixed(1)}`);
}
if (asJson) process.stdout.write(`${JSON.stringify(out)}\n`);
