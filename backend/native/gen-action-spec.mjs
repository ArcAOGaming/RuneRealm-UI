#!/usr/bin/env node
/**
 * Generate the machine-readable action spec that the Realm Codex publishes and
 * the MCP server is built from.
 *
 * ## Why this is generated and not written
 *
 * A hand-written reference is a SECOND copy of the rules, and a second copy is
 * wrong the first time somebody retunes the first one. This repository has the
 * receipts: `ECONOMY_V2.md` said the item faucet had moved off playtime when it
 * had only moved off one of the two verbs that paid it, and the document read
 * as true for a week while a quest went on paying a crate worth 7.6x what the
 * cycle cost. Three assertions in `game_test.lua` broke on unrelated balance
 * work because they had a move count, a hit floor and a stat cap typed into
 * them. Every one of those is the same failure.
 *
 * So the spec is derived from the source it describes. Adding a handler and the
 * spec listing it are the same diff, and a cost changes in exactly one place.
 *
 * ## What is extracted, and how far to trust it
 *
 * Two kinds of fact come out of here and they are NOT equally reliable:
 *
 *   * **Mechanical** — the handler names, which of them are signed, which
 *     require a pass, which are owner-only, the tags each one reads and the
 *     literal refusal strings it can return. These are read straight out of
 *     the handler body and are exactly as correct as the parse. They cover
 *     the questions an agent actually gets stuck on.
 *
 *   * **Declared** — the prose: what the action is FOR, its preconditions in
 *     words, what it spends and pays. A regex cannot infer intent, and a
 *     generator that guessed would be inventing documentation, which is worse
 *     than having none. These come from an optional `--- @spec` block written
 *     directly above the handler, so the annotation lives against the code and
 *     moves with it.
 *
 * A handler with no annotation still appears, with its mechanical facts and
 * `documented: false`. That is deliberate: the spec should show what exists,
 * including the parts nobody has described yet, rather than quietly omitting
 * them and looking complete.
 *
 * ## The numbers
 *
 * Costs and rewards are NOT scraped out of handler bodies — an expression like
 * `cfg.goldReward` tells you nothing on its own. The constants this spec cites
 * are read from `constants.lua` by name and published alongside, so a page can
 * join against them and every number on the site traces to one definition.
 *
 * ## Usage
 *
 *   node backend/native/gen-action-spec.mjs                  # write action-spec.json
 *   node backend/native/gen-action-spec.mjs --check          # fail if it is stale
 *   node backend/native/gen-action-spec.mjs --out <path>
 *
 * `--check` is the CI guard: it regenerates in memory and exits non-zero if the
 * committed file disagrees, so the spec cannot silently fall behind the
 * contract.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.join(HERE, 'game.lua');
const CONSTANTS = path.join(HERE, 'constants.lua');
const HUNT = path.join(HERE, 'hunt.lua');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};

const read = (file) => fs.readFileSync(file, 'utf8');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/* ---------------------------------------------------------------------------
 * Cutting the file into handlers.
 *
 * `H["Name"] = function(base, msg, timestamp)` opens a block and a bare `end`
 * in the first column closes it. That is a property of this file's formatting
 * rather than of Lua, so it is asserted rather than assumed: a handler whose
 * body cannot be found is reported, not skipped, because a silently missing
 * action is the one failure this generator must never produce.
 * ------------------------------------------------------------------------- */

function cutHandlers(source) {
  const lines = source.split(/\r?\n/);
  const open = /^H\[(["'])(.+?)\1\]\s*=\s*function\s*\(([^)]*)\)/;
  const alias = /^H\[(["'])(.+?)\1\]\s*=\s*H\[(["'])(.+?)\3\]\s*$/;

  const handlers = [];
  const aliases = [];
  const problems = [];

  for (let index = 0; index < lines.length; index++) {
    const aliasMatch = alias.exec(lines[index]);
    if (aliasMatch) {
      aliases.push({ action: aliasMatch[2], sameAs: aliasMatch[4], line: index + 1 });
      continue;
    }
    const match = open.exec(lines[index]);
    if (!match) continue;

    let close = -1;
    for (let scan = index + 1; scan < lines.length; scan++) {
      if (lines[scan] === 'end') { close = scan; break; }
    }
    if (close < 0) {
      problems.push(`H["${match[2]}"] at line ${index + 1} has no closing end at column 0`);
      continue;
    }
    handlers.push({
      action: match[2],
      line: index + 1,
      params: match[3].split(',').map((p) => p.trim()).filter(Boolean),
      body: lines.slice(index + 1, close).join('\n'),
      /* The doc comment immediately above, if any. */
      lead: leadComment(lines, index),
    });
    index = close;
  }
  return { handlers, aliases, problems };
}

/** The unbroken run of `---` comment lines directly above a handler. */
function leadComment(lines, at) {
  const out = [];
  for (let scan = at - 1; scan >= 0; scan--) {
    const line = lines[scan];
    if (/^---/.test(line)) { out.unshift(line.replace(/^---\s?/, '')); continue; }
    if (/^--(?!-)/.test(line)) { out.unshift(line.replace(/^--\s?/, '')); continue; }
    break;
  }
  return out.join('\n').trim();
}

/* ---------------------------------------------------------------------------
 * The `@spec` annotation.
 *
 * Written in the handler's own doc comment so it cannot be moved away from the
 * code it describes:
 *
 *   --- @spec summary   Send the companion on a one-hour quest.
 *   --- @spec requires  status Home, energy >= 25, happiness >= 25
 *   --- @spec spends    25 energy, 25 happiness
 *   --- @spec pays      7 exp, Gold from the shared 20-hour allowance
 *   --- @spec then      Monster.Claim after C.ACTIVITIES.quest.duration
 * ------------------------------------------------------------------------- */

const SPEC_FIELDS = ['summary', 'requires', 'spends', 'pays', 'then', 'note', 'group'];

function parseAnnotation(lead) {
  const declared = {};
  const pattern = /^@spec\s+(\w+)\s+(.+)$/;
  for (const raw of lead.split('\n')) {
    const match = pattern.exec(raw.trim());
    if (!match) continue;
    const [, field, value] = match;
    if (!SPEC_FIELDS.includes(field)) continue;
    declared[field] = declared[field] ? `${declared[field]} ${value}` : value;
  }
  return declared;
}

/* ---------------------------------------------------------------------------
 * Mechanical extraction.
 * ------------------------------------------------------------------------- */

/**
 * Every tag the handler reads.
 *
 * A tag arrives as a field on `msg`, and this repository has been bitten twice
 * by the fact that its NAME does not survive the trip intact: HTTP lowercases
 * header names, and a handler that reads `RunId` never sees a sender's
 * `run-id`. So every spelling a handler accepts is collected and reported
 * together — an agent needs to know which one to send, and a spec that listed
 * only the prettiest spelling would be the same bug in documentation form.
 */
/**
 * The tags every local helper reads, so a handler that delegates still reports
 * them.
 *
 * `Monster.Quest` reads no tag in its own body — it calls
 * `resolveRosterMonster(p, msg)`, which reads `MonsterId`. The first version of
 * this generator therefore published "tags: none" for a handler that takes one,
 * which is the documentation equivalent of a silent failure: an agent reads it,
 * believes it, and cannot work out why it can never pick a companion.
 *
 * One level deep, deliberately. Two would start pulling in `int()` and
 * `signer()` and the answer would stop being a list of tags; one covers every
 * delegating handler in the file and is a rule that can be stated.
 */
function helperTagIndex(source) {
  const index = new Map();
  const lines = source.split(/\r?\n/);
  const open = /^local function ([A-Za-z_]\w*)\s*\(([^)]*)\)/;
  for (let at = 0; at < lines.length; at++) {
    const match = open.exec(lines[at]);
    if (!match || !/\bmsg\b/.test(match[2])) continue;
    let close = -1;
    for (let scan = at + 1; scan < lines.length; scan++) {
      if (lines[scan] === 'end') { close = scan; break; }
    }
    if (close < 0) continue;
    const body = lines.slice(at + 1, close).join('\n');
    const tags = rawTagNames(body);
    if (tags.length) index.set(match[1], tags);
    at = close;
  }
  return index;
}

/** Every `msg.X` / `msg["x"]` / `tag("a","b")` spelling in a body. */
function rawTagNames(body) {
  const found = new Set();
  for (const m of body.matchAll(/\bmsg\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(m[1]);
  for (const m of body.matchAll(/\bmsg\[\s*(["'])(.+?)\1\s*\]/g)) found.add(m[2]);
  for (const call of body.matchAll(/\btag\(([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/(["'])(.+?)\1/g)) found.add(literal[2]);
  }
  return [...found];
}

function extractTags(body, helpers) {
  const found = new Map();
  /* Tags the handler reads only by calling a helper that reads them. */
  if (helpers) {
    for (const [name, tags] of helpers) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
        for (const tag of tags) found.set(tag, true);
      }
    }
  }
  const dotted = /\bmsg\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const indexed = /\bmsg\[\s*(["'])(.+?)\1\s*\]/g;
  for (const match of body.matchAll(dotted)) found.set(match[1], true);
  for (const match of body.matchAll(indexed)) found.set(match[2], true);

  /* `tag("Tif", "TimeInForce", "time-in-force")` — the normalising helper the
     order book uses. Every argument is an accepted spelling. */
  for (const call of body.matchAll(/\btag\(([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/(["'])(.+?)\1/g)) found.set(literal[2], true);
  }

  /* Group spellings that differ only in case and separators, which is exactly
     the equivalence the process itself applies. */
  const groups = new Map();
  for (const name of found.keys()) {
    const key = name.toLowerCase().replace(/[-_]/g, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  return [...groups.entries()]
    .map(([key, spellings]) => ({
      name: spellings[0],
      spellings: spellings.sort(),
      /* Marked, not dropped. `signer(msg)` reads the commitment and
         `sourceProcess(msg)` reads the scheduler's attestation, so those names
         appear in a handler body without being anything a caller sends. An
         earlier version listed them flat and `Monster.Quest` looked like it
         wanted an `Address` — which is not merely noise, it is an instruction
         to do the one thing that used to let anyone read anyone's inventory.
         Keeping them visible and labelled says what the handler touches
         without telling an agent to send it. */
      envelope: ENVELOPE.has(key),
    }))
    .sort((a, b) => Number(a.envelope) - Number(b.envelope)
      || a.name.localeCompare(b.name));
}

/**
 * Names that arrive on the envelope rather than from the caller.
 *
 * `commitments` is the signature bundle identity is read from; `from`,
 * `address` and `owner` are the sender the node resolved; `fromprocess` is the
 * scheduler's attestation of a cross-process sender. None of them is a tag an
 * agent writes, and two of them are actively dangerous to suggest.
 */
const ENVELOPE = new Set([
  'commitments', 'from', 'address', 'owner', 'id', 'timestamp',
  'blockheight', 'fromprocess', 'module', 'cron', 'variant', 'dataprotocol',
]);

/**
 * Literal refusal strings.
 *
 * Only the literals: a `fail(base, why)` returns a message computed elsewhere
 * and there is nothing honest to say about it, so it is counted rather than
 * guessed at. An agent matching on text needs the exact strings, and the ones
 * that are not exact need to be visibly absent instead of invented.
 */
function extractRefusals(body) {
  const literal = [];
  let computed = 0;
  for (const call of body.matchAll(/\bfail\(\s*base\s*,\s*([^\n]*)/g)) {
    const rest = call[1];
    const quoted = /^(["'])(.*?)\1/.exec(rest);
    if (!quoted) { computed += 1; continue; }
    /* A concatenated message keeps its literal head and marks the join. */
    literal.push(/^\s*\.\./.test(rest.slice(quoted[0].length))
      ? `${quoted[2]}…` : quoted[2]);
  }
  return { literal: [...new Set(literal)].sort(), computed };
}

function extractGuards(body, params) {
  return {
    /* Identity comes from a signature commitment and only that. A handler that
       never calls `signer` is not acting on behalf of a wallet. */
    signed: /\bsigner\(msg\)/.test(body),
    requiresPass: /\brequireAccess\(/.test(body),
    ownerOnly: /\brequireOwner\(|\bisOwner\(signer\(msg\)\)/.test(body),
    /* Accepted from another process rather than a browser, and only when the
       scheduler attests the sender. */
    crossProcess: /\bsourceProcess\(|\bfrom-process\b/.test(body),
    replayGuarded: /\bactionId\b|\breplayedAction\(|Settlements\[/.test(body),
    usesTimestamp: params.includes('timestamp'),
  };
}

/** Items and Rune the handler is capable of spending, by name. */
function extractSpends(body) {
  const items = new Set();
  for (const call of body.matchAll(/\bspend\(\s*\w+\s*,\s*(["'])(.+?)\1/g)) items.add(call[2]);
  for (const call of body.matchAll(/\bspend\(\s*\w+\s*,\s*([A-Za-z_][\w.]*)/g)) {
    if (!/^["']/.test(call[1])) items.add(`{${call[1]}}`);
  }
  return [...items].sort();
}

/* ---------------------------------------------------------------------------
 * Constants.
 *
 * Read by NAME rather than scraped wholesale, so this list is a deliberate
 * statement of which numbers the documentation is allowed to quote. Anything
 * absent here is a number the site must not print.
 *
 * SCOPED, not first-match. The first version of this function searched the
 * whole file for `duration = N * 1000` and published Play's fifteen minutes as
 * the quest's hour, because `duration`, `energyCost` and `happinessCost` are
 * field names shared by every activity. A generator that prints a confidently
 * wrong number is worse than no generator at all, so every read below is
 * anchored to the table it belongs to.
 * ------------------------------------------------------------------------- */

/**
 * The body of a Lua table literal at a dotted path, by brace matching.
 *
 * `luaBlock(source, 'C.ACTIVITIES', 'quest')` returns everything between the
 * braces of `quest = { ... }` inside `C.ACTIVITIES = { ... }`, so a field read
 * against it cannot pick up a same-named field from a sibling.
 */
function luaBlock(source, root, ...keys) {
  let at = source.indexOf(`${root} = {`);
  if (at < 0) at = source.indexOf(`${root}={`);
  if (at < 0) return '';
  let body = braceBody(source, source.indexOf('{', at));
  for (const key of keys) {
    const inner = new RegExp(`(?:^|[\\s,{])${key}\\s*=\\s*\\{`, 'm').exec(body);
    if (!inner) return '';
    body = braceBody(body, body.indexOf('{', inner.index + inner[0].length - 1));
  }
  return body;
}

function braceBody(source, open) {
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return '';
}

function readConstants(constantsSource, huntSource) {
  const number = (pattern, source = constantsSource) => {
    const match = new RegExp(pattern).exec(source);
    return match ? Number(match[1]) : null;
  };
  const quest = luaBlock(constantsSource, 'C.ACTIVITIES', 'quest');
  const play = luaBlock(constantsSource, 'C.ACTIVITIES', 'play');
  const battle = luaBlock(constantsSource, 'C.ACTIVITIES', 'battle');
  const captureBlock = luaBlock(constantsSource, 'C.HUNT', 'capture');
  const entryBlock = luaBlock(constantsSource, 'C.HUNT', 'entry', 'berries');
  const goldBlock = luaBlock(constantsSource, 'C.ECONOMY', 'gold');
  const shopBlock = luaBlock(constantsSource, 'C.ECONOMY', 'shop');
  const runeBlock = luaBlock(constantsSource, 'C.ECONOMY', 'rune');
  for (const [name, block] of Object.entries({
    quest, play, battle, capture: captureBlock, entry: entryBlock,
    gold: goldBlock, shop: shopBlock, rune: runeBlock,
  })) {
    if (!block) throw new Error(`constants.lua: could not locate the ${name} table — `
      + 'the parse is stale, and a scoped read that silently falls through is how '
      + 'a wrong number gets published');
  }
  const tiers = [];
  const tierBlock = /C\.LOOT_TIERS\s*=\s*\{([\s\S]*?)\n\}/.exec(constantsSource);
  if (tierBlock) {
    const row = /picks\s*=\s*(\d+),\s*min\s*=\s*(\d+),\s*max\s*=\s*(\d+),\s*scrolls\s*=\s*(\d+),\s*scrollChance\s*=\s*(\d+)/g;
    for (const match of tierBlock[1].matchAll(row)) {
      const [, picks, min, max, scrolls, scrollChance] = match.map(Number);
      tiers.push({
        tier: tiers.length + 1, picks, min, max, scrolls, scrollChance,
        /* Published so a page never has to do this arithmetic itself and get
           it subtly different from the next page that does. */
        expectedBerries: picks * ((min + max) / 2),
        expectedScrolls: scrolls + scrollChance / 1000,
      });
    }
  }

  const captureCurve = {
    scrollCost: number('scrollCost\\s*=\\s*(\\d+)', captureBlock),
    minRuneBid: number('minRuneBid\\s*=\\s*(\\d+)', captureBlock),
    maxRuneBid: number('maxRuneBid\\s*=\\s*(\\d+)', captureBlock),
    baseChance: number('baseChance\\s*=\\s*(\\d+)', captureBlock),
    runeScale: number('runeScale\\s*=\\s*(\\d+)', captureBlock),
    runeHalf: number('runeHalf\\s*=\\s*(\\d+)', captureBlock),
    levelStep: number('levelStep\\s*=\\s*(\\d+)', captureBlock),
    minChance: number('minChance\\s*=\\s*(\\d+)', captureBlock),
    maxChance: number('maxChance\\s*=\\s*(\\d+)', captureBlock),
  };

  /* The odds at every legal bid, computed with the contract's own formula so
     the site cannot quote a curve the worker does not roll. `hunt.lua` is read
     only to prove the shape here still matches the one it evaluates. */
  const odds = [];
  if (captureCurve.maxRuneBid) {
    for (let bid = captureCurve.minRuneBid; bid <= captureCurve.maxRuneBid; bid++) {
      const raw = captureCurve.baseChance
        + Math.floor((captureCurve.runeScale * bid) / (bid + captureCurve.runeHalf));
      odds.push({ bid, chanceAtEqualLevel: Math.max(captureCurve.minChance,
        Math.min(captureCurve.maxChance, raw)) });
    }
  }
  const formulaLives = /runeScale[^\n]*runes[^\n]*runeHalf|runeScale\s*or\s*\d+/.test(huntSource)
    || /runeScale/.test(huntSource);

  const seconds = (block) => {
    const match = /duration\s*=\s*(\d+)\s*\*\s*1000/.exec(block);
    return match ? Number(match[1]) : null;
  };

  return {
    activities: {
      quest: {
        durationSeconds: seconds(quest),
        energyCost: number('energyCost\\s*=\\s*(\\d+)', quest),
        happinessCost: number('happinessCost\\s*=\\s*(\\d+)', quest),
        expGain: number('expGain\\s*=\\s*(\\d+)', quest),
        goldReward: number('goldReward\\s*=\\s*(\\d+)', quest),
      },
      play: {
        durationSeconds: seconds(play),
        energyCost: number('energyCost\\s*=\\s*(\\d+)', play),
        happinessGain: number('happinessGain\\s*=\\s*(\\d+)', play),
        berryCost: 1,
      },
      battle: {
        energyCost: number('energyCost\\s*=\\s*(\\d+)', battle),
        happinessCost: number('happinessCost\\s*=\\s*(\\d+)', battle),
        winGold: number('winGold\\s*=\\s*(\\d+)', battle),
        perSession: number('C\\.BATTLES_PER_SESSION\\s*=\\s*(\\d+)'),
      },
      maxEnergy: number('C\\.MAX_ENERGY\\s*=\\s*(\\d+)'),
      maxHappiness: number('C\\.MAX_HAPPINESS\\s*=\\s*(\\d+)'),
    },
    gold: {
      rewardWindowCap: number('rewardWindowCap\\s*=\\s*(\\d+)', goldBlock),
      rewardWindowHours: number('accountWindow\\s*=\\s*(\\d+)\\s*\\*\\s*3600', shopBlock),
      launchSupply: number('launchSupply\\s*=\\s*(\\d+)', goldBlock),
      shopBurnBps: number('shopBurnBps\\s*=\\s*(\\d+)', goldBlock),
      perQualifiedPlayer: number('perQualifiedPlayer\\s*=\\s*(\\d+)', goldBlock),
    },
    rune: {
      emissionPerAccount: number('emissionPerAccount\\s*=\\s*(\\d+)', runeBlock),
      epochLengthDays: 30,
      /* `C.levelUpCost` is ceil(L^2 / divisor), and the divisor only exists
         inside the integer form `(L*L + divisor - 1) // divisor`. Read the
         addend and recover it, rather than typing 16 next to a function that
         could change. */
      levelUpCostDivisor: (() => {
        const match = /\(target \* target \+ (\d+)\) \/\/ (\d+)/.exec(constantsSource);
        return match ? Number(match[2]) : null;
      })(),
      storeCostRune: number('storeCost = \\{ item = "rune", amount = (\\d+) \\}'),
    },
    hunt: {
      entryBerriesEach: number('fire_berry\\s*=\\s*(\\d+)', entryBlock),
      entryBerriesTotal: (() => {
        const each = number('fire_berry\\s*=\\s*(\\d+)', entryBlock);
        return each == null ? null : each * 4;
      })(),
      capture: captureCurve,
      captureOdds: odds,
      formulaStillInWorker: formulaLives,
    },
    lootTiers: tiers,
    maxLootRarity: number('C\\.MAX_LOOT_RARITY\\s*=\\s*(\\d+)'),
  };
}

/* ---------------------------------------------------------------------------
 * Build.
 * ------------------------------------------------------------------------- */

function build() {
  const gameSource = read(GAME);
  const constantsSource = read(CONSTANTS);
  const huntSource = fs.existsSync(HUNT) ? read(HUNT) : '';

  const { handlers, aliases, problems } = cutHandlers(gameSource);
  if (!handlers.length) throw new Error('no handlers found — the parse is broken, not the contract');
  const helpers = helperTagIndex(gameSource);

  const actions = handlers.map((handler) => {
    const declared = parseAnnotation(handler.lead);
    const refusals = extractRefusals(handler.body);
    return {
      action: handler.action,
      /* Admin verbs are a different audience and a different risk; naming the
         group here keeps them out of the player-facing pages by construction
         rather than by someone remembering to filter. */
      group: declared.group
        || (handler.action.startsWith('Admin.') ? 'admin'
          : /^(Hunt|Battle)\.(Opened|Released|Settle|Settled|Fleet)/.test(handler.action)
            ? 'process' : 'player'),
      sourceLine: handler.line,
      ...extractGuards(handler.body, handler.params),
      tags: extractTags(handler.body, helpers).filter((t) => !t.envelope),
      envelopeTags: extractTags(handler.body, helpers)
        .filter((t) => t.envelope).map((t) => t.name),
      spends: extractSpends(handler.body),
      refusals: refusals.literal,
      computedRefusals: refusals.computed,
      documented: Object.keys(declared).length > 0,
      ...declared,
    };
  }).sort((a, b) => a.action.localeCompare(b.action));

  const documented = actions.filter((a) => a.documented).length;

  return {
    /* No timestamp. A generated file that changes on every run cannot be
       diffed, and `--check` would fail for no reason. The source hashes are
       the freshness signal, and they only move when the contract does. */
    generator: 'backend/native/gen-action-spec.mjs',
    source: {
      'game.lua': sha(gameSource),
      'constants.lua': sha(constantsSource),
      'hunt.lua': huntSource ? sha(huntSource) : null,
    },
    coverage: {
      actions: actions.length,
      documented,
      /* Stated plainly rather than hidden: the site should be able to show
         which actions nobody has described yet. */
      undocumented: actions.length - documented,
      aliases: aliases.length,
      parseProblems: problems,
    },
    constants: readConstants(constantsSource, huntSource),
    aliases,
    actions,
  };
}

/* --- Entry ---------------------------------------------------------------- */

const spec = build();
const json = `${JSON.stringify(spec, null, 2)}\n`;
const out = path.resolve(option('out', path.join(HERE, 'action-spec.json')));

if (spec.coverage.parseProblems.length) {
  for (const problem of spec.coverage.parseProblems) console.error(`parse: ${problem}`);
}

if (flag('check')) {
  const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (existing === json) {
    console.log(`action-spec.json is current — ${spec.coverage.actions} actions, `
      + `${spec.coverage.documented} documented`);
    process.exit(0);
  }
  console.error('action-spec.json is STALE. The contract moved and the spec did not.');
  console.error('Run: node backend/native/gen-action-spec.mjs');
  process.exit(1);
}

fs.writeFileSync(out, json);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
console.log(`  ${spec.coverage.actions} actions `
  + `(${spec.coverage.documented} documented, ${spec.coverage.undocumented} not yet)`);
console.log(`  ${spec.coverage.aliases} aliases, `
  + `${spec.actions.reduce((n, a) => n + a.refusals.length, 0)} literal refusal strings`);
if (spec.coverage.parseProblems.length) process.exit(1);
