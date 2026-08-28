/**
 * recover-state.mjs — pull the WHOLE state of the dead legacynet processes out
 * of their public Arweave checkpoints, without touching legacynet.
 *
 *   node backend/native/recover-state.mjs            # everything
 *   node backend/native/recover-state.mjs game       # the three game processes
 *   node backend/native/recover-state.mjs tokens     # the berry and fuel tokens
 *   node backend/native/recover-state.mjs prempass   # just one
 *
 * `recover-unlocked.mjs` carved one Lua array out of a raw memory image by
 * hand, by walking TValue pointers. That was enough for the paid list and
 * nothing else. This does the honest thing instead: it BOOTS the checkpoint.
 *
 * A checkpoint is a snapshot of the aos WASM linear memory, and the module it
 * was taken against is an ordinary Arweave transaction too. Hand both to
 * `@permaweb/ao-loader` and the dead process is alive again inside this Node
 * process — the real Lua VM, the real globals, the real tables. An `Eval`
 * message signed as the owner then reads anything out.
 *
 * Nothing here talks to a CU, an SU or an MU. Legacynet being allowlisted-out
 * does not matter: gateways still serve the transactions.
 *
 * Output: backend/native/snapshot/<process>.json, one per process, each
 * carrying its provenance (checkpoint id, nonce, timestamp) alongside the
 * state. That is the artifact — the migration reads it, not the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  ensureMemory64, latestCheckpoint, txInfo, download, inflate,
  makeHandle, evaluate, ENCODER, FENCE_OPEN, FENCE_CLOSE, DEFAULT_FORMAT,
} from './aoloader.mjs';

ensureMemory64(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'snapshot');

/**
 * The processes the old game ran on: the three game processes, then the token
 * processes its economy was denominated in. Every activity used to cost a
 * transfer, so a player's berries are balances over there, not state here.
 *
 * Owners are resolved from each process's own spawn transaction — Eval answers
 * the owner and nobody else, and these were not all spawned by one wallet.
 */
const PROCESSES = {
  prempass: {
    id: 'j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI',
    label: 'PremPass / SkinChanger — access, factions, companions',
  },
  multibattle: {
    id: '3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs',
    label: 'MultiBattle — combat',
  },
  alter: {
    id: 'GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ',
    label: 'Alter — offerings and streaks',
  },
  // Token processes. `fire_berry_v1` is the id the live companions actually
  // referenced; `fire_berry` is the one PremPass listed as supported. Both are
  // pulled because either could hold a player's balance.
  fire_berry_v1: { id: '30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0', label: 'Fire Berry token (referenced by companions)' },
  fire_berry:    { id: 'j_CKoyoHKgWjDU-sy6Fp86ykks2tNyQbhDVd0tHX_RE', label: 'Fire Berry token (SUPPORTED_BERRIES)' },
  water_berry:   { id: 'twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0', label: 'Water Berry token' },
  air_berry:     { id: 'XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA', label: 'Air Berry token' },
  rock_berry:    { id: '2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM', label: 'Rock Berry token' },
  trunk:         { id: 'wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ', label: 'TRUNK — the old fuel token' },
};

const GAME = ['prempass', 'multibattle', 'alter'];
const TOKENS = Object.keys(PROCESSES).filter((k) => !GAME.includes(k));

const AUTHORITY = 'fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY';

/**
 * Globals that are the aos runtime rather than the game. `Inbox` is excluded
 * for size (7,421 messages on PremPass, 3,480 on Alter) and because it is a log
 * of traffic rather than state — but it IS recoverable the same way if the
 * message history is ever wanted: drop it from this set.
 */
const SKIP = new Set([
  '_G', 'package', 'string', 'table', 'math', 'io', 'os', 'coroutine', 'debug',
  'utf8', 'bit32', 'json', 'ao', 'Utils', 'Handlers', 'Inbox', 'Errors',
  'Colors', 'HANDLER_PRINT_LOGS', 'Bundler', 'crypto', 'base64', 'pretty',
]);

// -- per process ------------------------------------------------------------

async function recover(key) {
  const proc = PROCESSES[key];
  console.log(`\n${key} — ${proc.label}`);
  console.log(`  ${proc.id}`);

  const meta = await latestCheckpoint(proc.id);
  console.log(`  checkpoint ${meta.id}`);
  console.log(`  nonce ${meta.nonce}, ${new Date(meta.timestamp).toISOString()}`);

  // Read the owner off the spawn transaction rather than hard-coding it, and
  // the module's format off the module — the berry tokens do not all run the
  // same one as the game.
  const [spawn, mod] = await Promise.all([txInfo(proc.id), txInfo(meta.module)]);
  proc.owner = spawn.owner;
  proc.module = meta.module;
  proc.tags = [{ name: 'Authority', value: AUTHORITY }];
  const format = mod.tags['Module-Format'] || DEFAULT_FORMAT;
  const gb = /^(\d+)-gb$/.exec(mod.tags['Memory-Limit'] || '');
  const memoryLimit = (gb ? Number(gb[1]) : 1) * 1024 * 1024 * 1024;
  console.log(`  owner ${proc.owner}`);
  console.log(`  module ${meta.module} (${format})`);

  const wasm = await download(meta.module, '.wasm');
  const memory = inflate(await download(meta.id, '.bin'));
  console.log(`  memory ${(memory.length / 1048576).toFixed(1)} MB`);

  const handle = await makeHandle(wasm, format, memoryLimit);
  const skipLua = [...SKIP].map((s) => `["${s}"]=true`).join(',');

  // Which globals are game state? Ask the process rather than hard-coding a
  // list that would silently miss a table.
  let names;
  try {
    names = JSON.parse(await evaluate(handle, memory, proc, `
      local skip = {${skipLua}}
      local out = {}
      for k, v in pairs(_G) do
        if not skip[k] and type(v) == 'table' then out[#out+1] = k end
      end
      table.sort(out)
      local q = {}
      for i, n in ipairs(out) do q[i] = '"' .. n .. '"' end
      return '${FENCE_OPEN}[' .. table.concat(q, ',') .. ']${FENCE_CLOSE}'
    `));
  } catch (e) {
    // TRUNK refuses Eval: its runtime `Owner` is not the wallet that spawned
    // it, so there is nothing we can sign as. A token still answers its own
    // public `Balances` handler, and the balances are the only part of a token
    // that matters here.
    console.log(`  Eval refused — asking for Balances instead (${e.message.slice(0, 60)})`);
    const balances = await askBalances(handle, memory, proc);
    return writeSnapshot(key, proc, meta, { Balances: balances },
      { Balances: Object.keys(balances).length }, 'Balances handler (Eval refused)', {});
  }
  console.log(`  state tables: ${names.length}`);

  // Scalars matter too: a token's `Denomination` decides whether a balance of
  // "5000" is five berries or five thousand, and it is a plain number global.
  const scalars = JSON.parse(await evaluate(handle, memory, proc, `${ENCODER}
    local skip = {${skipLua}}
    local out = {}
    for k, v in pairs(_G) do
      local t = type(v)
      if not skip[k] and (t == 'string' or t == 'number' or t == 'boolean') then
        out[k] = v
      end
    end
    return '${FENCE_OPEN}' .. enc(out) .. '${FENCE_CLOSE}'
  `));

  // One Eval per table. A single message carrying everything would work for
  // PremPass and blow up on MultiBattle's battle logs; per-table keeps every
  // reply a sane size and makes a failure name itself.
  const state = {};
  const counts = {};
  let done = 0;
  for (const name of names) {
    const text = await evaluate(handle, memory, proc,
      `${ENCODER}\nreturn '${FENCE_OPEN}' .. enc(_G["${name}"]) .. '${FENCE_CLOSE}'`);
    done += 1;
    try {
      state[name] = JSON.parse(text);
    } catch (e) {
      console.log(`\n  ! ${name} did not parse (${text.length} bytes): ${e.message}`);
      state[name] = null;
      continue;
    }
    counts[name] = Array.isArray(state[name])
      ? state[name].length
      : Object.keys(state[name] ?? {}).length;
    process.stdout.write(`\r  read ${done}/${names.length} tables`);
  }
  console.log('');

  return writeSnapshot(key, proc, meta, state, counts, 'Eval', scalars);
}

/** Ask a token process for every balance it holds. Public; needs no owner. */
async function askBalances(handle, memory, proc) {
  const res = await handle(memory, {
    Id: 'recover-balances', Target: proc.id, Owner: proc.owner, From: proc.owner,
    Tags: [{ name: 'Action', value: 'Balances' }], Data: '',
    'Block-Height': '1', Timestamp: '1770000000000', Module: proc.module, Cron: false,
  }, { Process: { Id: proc.id, Owner: proc.owner, Tags: [] } });
  if (res.Error) throw new Error(res.Error);
  const data = res.Messages?.[0]?.Data;
  if (typeof data !== 'string') throw new Error('no Balances reply');
  return JSON.parse(data);
}

function writeSnapshot(key, proc, meta, state, counts, how, scalars) {
  for (const [n, c] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${n.padEnd(22)} ${c}`);
  }
  const snapshot = {
    process: proc.id,
    name: key,
    label: proc.label,
    owner: proc.owner,
    checkpoint: meta.id,
    nonce: meta.nonce,
    checkpointedAt: new Date(meta.timestamp).toISOString(),
    module: meta.module,
    recoveredBy: 'backend/native/recover-state.mjs',
    recoveredVia: how,
    counts,
    scalars,
    state,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const text = JSON.stringify(snapshot, null, 1) + '\n';
  const plain = path.join(OUT_DIR, `${key}.json`);
  const gz = `${plain}.gz`;

  // The archive is meant to be committed, and MultiBattle's battle logs are
  // 6 MB of per-fight turn records. Anything that large is stored gzipped —
  // 145 KB for the same data — and `build-legacy.mjs` reads either form. Only
  // one of the two ever exists, so a re-pull cannot leave a stale twin behind.
  const big = Buffer.byteLength(text) > 1024 * 1024;
  fs.rmSync(big ? plain : gz, { force: true });
  fs.writeFileSync(big ? gz : plain, big ? zlib.gzipSync(text, { level: 9 }) : text);
  const written = big ? gz : plain;
  console.log(`  -> snapshot/${path.basename(written)} (${(fs.statSync(written).size / 1048576).toFixed(2)} MB)`);
  return snapshot;
}

// -- run --------------------------------------------------------------------

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const keys = wanted.length === 0 ? Object.keys(PROCESSES)
  : wanted.flatMap((w) => (w === 'game' ? GAME : w === 'tokens' ? TOKENS : [w]));
for (const k of keys) {
  if (!PROCESSES[k]) {
    console.error(`unknown process "${k}" — one of: ${Object.keys(PROCESSES).join(', ')}`);
    console.error('  or the groups "game" and "tokens"');
    process.exit(1);
  }
}

// A manifest holding only this run's processes would lose the rest on a partial
// re-pull, so merge into whatever is already recorded.
const manifestPath = path.join(OUT_DIR, 'manifest.json');
const previous = fs.existsSync(manifestPath)
  ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).processes ?? [])
  : [];
const manifest = new Map(previous.map((p) => [p.name, p]));
const failed = [];
for (const k of keys) {
  try {
    const snap = await recover(k);
    manifest.set(k, {
      name: k, process: snap.process, label: snap.label, checkpoint: snap.checkpoint,
      nonce: snap.nonce, checkpointedAt: snap.checkpointedAt,
      recoveredVia: snap.recoveredVia, counts: snap.counts,
    });
  } catch (e) {
    // One unreachable process must not cost the rest of the archive.
    console.log(`  ! ${k} failed: ${e.message}`);
    failed.push(k);
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify({
  recoveredAt: new Date().toISOString(),
  processes: [...manifest.values()],
}, null, 1) + '\n');
if (failed.length) console.log(`\nfailed: ${failed.join(', ')}`);

console.log('\nwrote backend/native/snapshot/ — that is the archive.');
console.log('Map it into loadable players with: node backend/native/build-legacy.mjs');
