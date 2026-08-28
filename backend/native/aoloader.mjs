/**
 * aoloader.mjs — run legacynet Lua locally.
 *
 * Shared by `recover-state.mjs`, which revives the dead processes from their
 * Arweave checkpoints, and `build-legacy.mjs`, which needs a Lua interpreter to
 * read `constants.lua`. Both boot the same aos WASM module through
 * `@permaweb/ao-loader`: with a checkpoint's memory it is the old process, with
 * no memory it is an empty Lua 5.3 sandbox.
 *
 * Nothing here touches a CU, an SU or an MU.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

export const CACHE = process.env.CHECKPOINT_CACHE || path.join(HERE, '.checkpoint-cache');
export const GATEWAY = process.env.GATEWAY || 'https://arweave.net';
export const GQL = process.env.GQL || 'https://arweave-search.goldsky.com/graphql';

/** aos-lg-2.0.1 — the module the game processes ran, and a fine bare sandbox. */
export const AOS_MODULE = 'Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM';
export const DEFAULT_FORMAT = 'wasm64-unknown-emscripten-draft_2024_02_15';

/** Fences around an Eval's payload — see `evaluate()`. */
export const FENCE_OPEN = '<<<RECOVER';
export const FENCE_CLOSE = 'RECOVER>>>';

/**
 * The aos module is wasm64-unknown-emscripten and Node runs one only behind a
 * flag. Re-exec with it rather than failing with "invalid memory type" a
 * hundred megabytes into a download. Call this first in any entry point.
 */
export function ensureMemory64(entryUrl) {
  if (process.execArgv.includes('--experimental-wasm-memory64')) return;
  const file = new URL(entryUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath,
    ['--experimental-wasm-memory64', file, ...process.argv.slice(2)],
    { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

export function loadAoLoader() {
  try {
    return require('@permaweb/ao-loader');
  } catch {
    console.error('@permaweb/ao-loader is not installed.\n  npm install --save-dev @permaweb/ao-loader');
    process.exit(1);
  }
}

// -- Arweave ----------------------------------------------------------------

export async function gql(query) {
  const res = await fetch(GQL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`gql ${res.status}`);
  return res.json();
}

/** The most recent checkpoint a process published, with its provenance. */
export async function latestCheckpoint(pid) {
  const body = await gql(`{transactions(
      tags:[{name:"Process",values:["${pid}"]},{name:"Type",values:["Checkpoint"]}],
      first:1, sort:HEIGHT_DESC
    ){edges{node{id tags{name value}}}}}`);
  const node = body?.data?.transactions?.edges?.[0]?.node;
  if (!node) throw new Error(`no checkpoints for ${pid}`);
  const tag = (n) => node.tags.find((t) => t.name === n)?.value;
  return {
    id: node.id,
    nonce: Number(tag('Nonce')),
    timestamp: Number(tag('Timestamp')),
    module: tag('Module'),
  };
}

/** One round trip for a transaction's owner and tags. */
export async function txInfo(id) {
  const body = await gql(`{transactions(ids:["${id}"]){edges{node{id owner{address} tags{name value}}}}}`);
  const node = body?.data?.transactions?.edges?.[0]?.node;
  if (!node) throw new Error(`transaction ${id} not found`);
  return {
    owner: node.owner.address,
    tags: Object.fromEntries(node.tags.map((t) => [t.name, t.value])),
  };
}

export async function download(id, suffix) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${id}${suffix}`);
  if (!fs.existsSync(file)) {
    process.stdout.write(`  downloading ${id} ... `);
    const res = await fetch(`${GATEWAY}/${id}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  }
  return fs.readFileSync(file);
}

/**
 * Checkpoints are gzipped AND tagged `Content-Encoding: gzip`, so a gateway may
 * have inflated one already. Decide by the magic bytes, not the filename.
 */
export function inflate(buf) {
  return (buf[0] === 0x1f && buf[1] === 0x8b)
    ? zlib.gunzipSync(buf, { maxOutputLength: 1024 * 1024 * 1024 })
    : buf;
}

// -- Lua --------------------------------------------------------------------

/**
 * A JSON encoder written in Lua, injected with every read rather than using the
 * module's own `json`.
 *
 * Two reasons. Integers: aos serialises numbers through `%.14g`, so a level of
 * 3 comes back `3.00000000000` and whatever restores it gets a float — the
 * exact defect §4 of HANDOFF.md says to check first when a migration looks
 * wrong. And emptiness: `{}` is ambiguous in Lua, so a table is an array only
 * when it actually holds a positive integer key, which is what keeps a loot box
 * list an array and a player map an object.
 *
 * No backslash appears in this source. Escaping a Lua string literal inside a
 * JS template literal is two levels of quoting; `string.char(92)` is one.
 */
export const ENCODER = `
local BS = string.char(92)
local function esc(s)
  if not s:find('[%c"]') and not s:find(BS, 1, true) then return s end
  local out = {}
  for i = 1, #s do
    local c = s:sub(i, i)
    local b = c:byte()
    if c == '"' then out[#out+1] = BS .. '"'
    elseif b == 92 then out[#out+1] = BS .. BS
    elseif b == 10 then out[#out+1] = BS .. 'n'
    elseif b == 13 then out[#out+1] = BS .. 'r'
    elseif b == 9  then out[#out+1] = BS .. 't'
    elseif b < 32 or b == 127 then out[#out+1] = string.format(BS .. 'u%04X', b)
    else out[#out+1] = c end
  end
  return table.concat(out)
end
local function enc(v, depth)
  depth = depth or 0
  if depth > 32 then return '"<too deep>"' end
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'string' then return '"' .. esc(v) .. '"' end
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if math.type(v) == 'integer' then return string.format('%d', v) end
    -- A float that is exactly an integer IS one: every timestamp and counter
    -- that arrived over JSON is stored as a float.
    if v == math.floor(v) and math.abs(v) < 2^53 then return string.format('%d', v) end
    return string.format('%.17g', v)
  end
  if t ~= 'table' then return '"<' .. t .. '>"' end
  local n, isArray = 0, true
  for k in pairs(v) do
    n = n + 1
    if math.type(k) ~= 'integer' or k < 1 then isArray = false end
  end
  if isArray and n > 0 and n == #v then
    local out = {}
    for i = 1, n do out[i] = enc(v[i], depth + 1) end
    return '[' .. table.concat(out, ',') .. ']'
  end
  local keys, byKey = {}, {}
  for k, val in pairs(v) do
    local ks = tostring(k)
    keys[#keys+1] = ks
    byKey[ks] = val
  end
  table.sort(keys)
  local out = {}
  for _, k in ipairs(keys) do
    out[#out+1] = '"' .. esc(k) .. '":' .. enc(byKey[k], depth + 1)
  end
  return '{' .. table.concat(out, ',') .. '}'
end
`;

/** Wrap a Lua expression so `evaluate()` can find its value in any reply. */
export function fenced(luaExpression) {
  return `${ENCODER}\nreturn '${FENCE_OPEN}' .. (${luaExpression}) .. '${FENCE_CLOSE}'`;
}

export async function makeHandle(wasm, format = DEFAULT_FORMAT, memoryLimit = 1024 * 1024 * 1024) {
  const AoLoader = loadAoLoader();
  return AoLoader(wasm, { format, computeLimit: 9_000_000_000_000, memoryLimit });
}

/**
 * Run one Eval and return the fenced payload.
 *
 * Where an Eval's answer lands depends on the aos version, and the processes
 * here span four of them: 2.0.1 puts the returned string straight in
 * `Output.data`; 0.2.1 makes `Output.data` an object and puts it in `.output`;
 * 2.0.0 answers with a coloured "New Message From" banner and never shows the
 * value at all. So look everywhere plausible, and fence the payload so it can
 * be found inside a banner.
 */
export async function evaluate(handle, memory, proc, code) {
  const res = await handle(memory, {
    Id: 'ao-eval', Target: proc.id, Owner: proc.owner, From: proc.owner,
    Tags: [{ name: 'Action', value: 'Eval' }],
    Data: code,
    'Block-Height': '1', Timestamp: '1770000000000',
    Module: proc.module || AOS_MODULE, Cron: false,
  }, {
    Process: { Id: proc.id, Owner: proc.owner, Tags: proc.tags || [] },
  });
  if (res.Error) throw new Error(res.Error);

  const out = res.Output?.data;
  const text = typeof out === 'string' ? out
    : typeof out?.output === 'string' ? out.output
    : typeof res.Output?.output === 'string' ? res.Output.output
    : JSON.stringify(out ?? null);

  const start = text.indexOf(FENCE_OPEN);
  const end = text.lastIndexOf(FENCE_CLOSE);
  if (start === -1 || end === -1) {
    const plain = text.replace(/\[\d+m/g, '');
    throw new Error(`no payload in reply (${text.length} bytes): ${plain.slice(0, 140)}`);
  }
  const payload = text.slice(start + FENCE_OPEN.length, end);

  // aos 0.2.1 hands the string back already JSON-escaped. Undo that, but only
  // when it IS escaped — an unescaped payload must pass through untouched.
  if (payload.includes('\\"')) {
    try { return JSON.parse(`"${payload}"`); } catch { /* not escaped after all */ }
  }
  return payload;
}

/**
 * An empty Lua sandbox: the aos module with no checkpoint behind it. Used to
 * read `constants.lua` without shipping a Lua interpreter or calling out to a
 * node's `~lua@5.3a` device.
 */
export async function luaSandbox() {
  const wasm = await download(AOS_MODULE, '.wasm');
  const handle = await makeHandle(wasm);
  const proc = {
    id: 'local-sandbox'.padEnd(43, '_'),
    owner: 'local-sandbox'.padEnd(43, '_'),
    module: AOS_MODULE,
  };
  let memory = null;
  return {
    /** Evaluate Lua and JSON-decode the value it returns. */
    async json(expression, preamble = '') {
      const code = preamble
        ? `${ENCODER}\n${preamble}\nreturn '${FENCE_OPEN}' .. enc(${expression}) .. '${FENCE_CLOSE}'`
        : fenced(`enc(${expression})`);
      return JSON.parse(await evaluate(handle, memory, proc, code));
    },
  };
}
