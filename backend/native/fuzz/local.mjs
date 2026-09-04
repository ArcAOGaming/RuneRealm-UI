/**
 * Drive the real game.lua, one message at a time, inside a local AOS module.
 *
 * `run-local-game-test.mjs` evaluates the suite in a single shot. This does the
 * opposite: it boots the same bundle once and then steps it, so a fuzzer in
 * JavaScript can look at what came back before deciding what to send next.
 * That is the whole reason this file exists — a model that cannot see the reply
 * cannot predict the next refusal.
 *
 * Two things are kept faithful to HyperBEAM on purpose:
 *
 *   * `base` is carried from one call to the next. `result` IS `base` in
 *     game.lua, so published keys accumulate across slots exactly as they do on
 *     a node — which is also what makes `player-<address>` readable here
 *     without signing anything, the same free read the client uses.
 *
 *   * the signer arrives as it does from the test harness door in `signer()`,
 *     with no commitment. A local run therefore proves the state machine and
 *     NOT the signature path; that is `e2e.mjs` and the live swarm.
 *
 * Luerl is not in the loop here either. Anything about float narrowing,
 * `goto`, or `string.pack` still has to go through `npm run test:lua`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.resolve(HERE, '..');
const ROOT = path.resolve(NATIVE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');

const PROCESS_ID = 'local-fuzz-process'.padEnd(43, '_');
export const OWNER = 'OWNERoooooooooooooooooooooooooooooooooooooo';

const read = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');

/**
 * The stepping shim, in Lua.
 *
 * `FUZZSEND` returns the reply body as the RAW string the process encoded, not
 * a decoded value. That matters: decoding in Lua and re-encoding on the way out
 * would launder exactly the defect the repo rules care about, where an integer
 * that was stored as a float comes back as `25.00000000000`. The caller asserts
 * against these bytes.
 */
const SHIM = `
FUZZT = 1700000000000
FUZZBASE = { process = { commitments = { sig1 = { committer = "${OWNER}" } } } }

function FUZZSEND(payload)
  local json = require(".json")
  local req = json.decode(payload)
  FUZZT = FUZZT + (req.advance or 1000)
  local body = { Address = req.from, id = req.id }
  for k, v in pairs(req.tags or {}) do body[k] = v end
  if req.data then body.Data = req.data end
  local started = os.clock()
  local okc, res = pcall(compute, FUZZBASE, { body = body, timestamp = FUZZT }, {})
  if not okc then return json.encode({ crash = tostring(res) }) end
  FUZZBASE = res
  return json.encode({
    out = res.results.output.data,
    market = res.market,
    marketstats = res.marketstats,
    economy = res.economy,
    now = FUZZT,
    computeMs = math.floor((os.clock() - started) * 1000),
  })
end

--- A published player key, read the way an unsigned client reads it.
function FUZZREAD(address)
  local v = FUZZBASE["player-" .. tostring(address)]
  return type(v) == "string" and v or "null"
end

--- The record itself, not the published view of it.
---
--- Reading the published key answers "what has the process last told anyone",
--- which is the right question for a client and the wrong one for an assertion:
--- a message republishes only the record it touched, so the other side of a
--- trade still has last slot's key sitting there. This reads the table.
---
--- It is also the only affordable way to do it. Forcing a republish means an
--- admin write, and an admin write re-encodes EVERY player -- around 160ms once
--- fifty accounts hold a hundred and seventy companions between them. Paying
--- that per assertion would make the soak quadratic in the thing it is
--- measuring.
function FUZZTRUTH(address)
  local json = require(".json")
  local p = Players[tostring(address)]
  if not p then return "null" end
  -- A shallow copy so the cap can ride along. rosterMax is computed by the
  -- view rather than stored, and half the assertions are about the cap.
  local out = {}
  for k, v in pairs(p) do out[k] = v end
  out.rosterMax = C.ROSTER.max
  local ok, encoded = pcall(json.encode, out)
  if not ok then return "null" end
  return encoded
end

--- Every account the process holds, published or not.
---
--- FUZZADDRESSES below answers a different question -- which accounts have a
--- published key -- and a companion handed to an address that has never sent a
--- message is real, owned, and has no key. Counting from the published keys
--- would report it as destroyed.
function FUZZPLAYERS()
  local json = require(".json")
  local out = {}
  for address in pairs(Players) do out[#out + 1] = address end
  return json.encode(out)
end

--- Every address the process has published a key for.
function FUZZADDRESSES()
  local json = require(".json")
  local out = {}
  for k, v in pairs(FUZZBASE) do
    if type(k) == "string" and type(v) == "string" and string.sub(k, 1, 7) == "player-" then
      out[#out + 1] = string.sub(k, 8)
    end
  end
  return json.encode(out)
end

--- The clock, so the driver can push companions past a real timer.
function FUZZADVANCE(ms)
  FUZZT = FUZZT + ms
  return tostring(FUZZT)
end
`;

function bundle() {
  return [
    'package.loaded[".json"] = require("json")',
    'Owner = nil',
    'local C = (function()', read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()', read('battle.lua'), 'end)()',
    'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
    read('game.lua'),
    SHIM,
    'return "booted"',
  ].join('\n');
}

export async function createLocalBackend({ memoryMb = 1024 } = {}) {
  if (!fs.existsSync(WASM)) {
    throw new Error(`AOS.wasm not found at ${WASM}. The Reality submodule supplies it: `
      + 'git submodule update --init Reality');
  }
  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 9_000_000_000_000,
    memoryLimit: memoryMb * 1024 * 1024,
  });
  const env = {
    Process: {
      Id: PROCESS_ID, Owner: OWNER,
      Tags: [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Process' },
      ],
    },
  };
  let memory = null;
  let sequence = 0;

  const evaluate = async (source) => {
    const message = {
      Id: `eval-${++sequence}`.padEnd(43, '_'),
      Target: PROCESS_ID, Owner: OWNER, From: OWNER,
      Tags: [{ name: 'Action', value: 'Eval' }],
      Data: source,
      'Block-Height': String(sequence),
      Timestamp: '1700000000000',
      Module: 'local-aos-module'.padEnd(43, '_'),
      Cron: false,
    };
    const result = await handle(memory, message, env);
    if (result.Error) throw new Error(String(result.Error));
    memory = result.Memory;
    const data = result.Output?.data;
    return typeof data === 'string' ? data : data?.output ?? '';
  };

  const boot = await evaluate(bundle());
  if (!String(boot).includes('booted')) {
    throw new Error(`game.lua did not load in the local module: ${boot}`);
  }

  // A Lua long-bracket level that cannot appear inside JSON, so a payload
  // carrying `]]` — which a fuzzed monster name easily could — never closes
  // the literal early.
  const quote = (value) => `[====[${value}]====]`;

  return {
    kind: 'local',
    owner: OWNER,

    async send(from, tags, data) {
      const startedAt = Date.now();
      const payload = JSON.stringify({ from, tags, id: `f${++sequence}`, ...(data ? { data } : {}) });
      const outer = JSON.parse(await evaluate(`return FUZZSEND(${quote(payload)})`));
      if (outer.crash) {
        const error = new Error(`game.lua raised: ${outer.crash}`);
        error.crash = true;
        throw error;
      }
      return {
        raw: outer.out,
        body: JSON.parse(outer.out),
        market: outer.market ? JSON.parse(outer.market) : null,
        marketStats: outer.marketstats ? JSON.parse(outer.marketstats) : null,
        economy: outer.economy ? JSON.parse(outer.economy) : null,
        now: outer.now,
        latencyMs: Date.now() - startedAt,
        computeMs: outer.computeMs ?? null,
      };
    },

    /**
     * The free, unsigned read — exactly what a client without a wallet gets.
     *
     * This is the PUBLISHED key, which is deliberately not the same thing as
     * the truth. A message republishes the record of whoever it touched, so a
     * counterparty who was changed by somebody else's message still has last
     * slot's key sitting there. Reading it here rather than reaching into the
     * table is what lets the fuzzer notice that.
     */
    async readPlayer(address) {
      const value = await evaluate(`return FUZZREAD(${quote(address)})`);
      if (!value || value === 'null') return null;
      return JSON.parse(value);
    },

    /**
     * What the process actually holds, as opposed to what it last published.
     *
     * This is the record straight out of `Players`, so it is missing the two
     * things `playerView` adds — the per-entry `nextLevelExp`, and the empty-
     * table-to-object coercion. Neither matters to an assertion about where a
     * companion is or what an account holds, and the coercion difference is
     * handled by reading counts rather than shapes.
     */
    async readPlayerAuthoritative(address) {
      const value = await evaluate(`return FUZZTRUTH(${quote(address)})`);
      if (!value || value === 'null') return null;
      return JSON.parse(value);
    },

    async publishedAddresses() {
      return JSON.parse(await evaluate('return FUZZADDRESSES()'));
    },

    /** Every account, including one that has never sent a message. */
    async allAddresses() {
      return JSON.parse(await evaluate('return FUZZPLAYERS()'));
    },

    /** Push the clock, so a quest or a play session can actually finish. */
    async advance(ms) {
      return Number(await evaluate(`return FUZZADVANCE(${Math.floor(ms)})`));
    },
  };
}
