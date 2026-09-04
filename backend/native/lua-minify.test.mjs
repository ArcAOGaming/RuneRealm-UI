/**
 * npm run test:minify        (node --test backend/native/lua-minify.test.mjs)
 *
 * The minifier decides what bytes a spawn message carries, so a bug in it is a
 * bug in the deployed game with no source-level trace. There are three families
 * of test here and they are deliberately different in kind:
 *
 *   1. Unit cases. One construct each, asserted on exact output. These are the
 *      shapes that have actually broken: `--` inside a string, `]]` inside a
 *      long string, and -- the one that shipped -- a removed comment closing
 *      the gap between two tokens.
 *
 *   2. A token-stream differential (`the minified sources lex to the same
 *      tokens`). An INDEPENDENT Lua lexer, written below and sharing no code
 *      with the minifier, runs over every `.lua` file in `backend/native/` and
 *      over the assembled deploy bundle, and asserts the token sequence is
 *      identical before and after minification. This is the check that
 *      generalises: it does not need someone to have thought of the construct,
 *      only for the construct to appear in a source file. It is maximal-munch
 *      on purpose, so `1local` is ONE token and therefore never compares equal
 *      to `1` followed by `local`.
 *
 *   3. A behavioural differential (`the minified module runs the whole suite
 *      identically`). The 637-assertion game suite is executed twice in a real
 *      Lua 5.3 (`@permaweb/ao-loader` on `Reality/process/module/AOS.wasm`) --
 *      once on the sources, once on the minified sources -- and the two
 *      transcripts must be byte-identical. A byte reduction that is not proven
 *      equivalent is worse than no reduction.
 *
 * The size ceiling at the bottom imports the bundle list from
 * `game-bundle.mjs`, the same module `deploy.mjs` builds its spawn message
 * from, so this file cannot measure a bundle that is not the one that ships.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';
import { minifyLua } from './lua-minify.mjs';
import { gameModuleSources, GAME_BUNDLE_FILES } from './game-bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const B = String.fromCharCode(92); // a literal backslash, unambiguously
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

/* ------------------------------------------------------------------ units */

test('drops line comments, blank lines and indentation', () => {
  assert.equal(minifyLua('local a = 1 -- hi\n'), 'local a = 1\n');
  assert.equal(minifyLua('-- doc\n\nlocal a = 1\n'), 'local a = 1\n');
  assert.equal(minifyLua('    local a = 1\n'), 'local a = 1\n');
  assert.equal(minifyLua('local a = 1   \n'), 'local a = 1\n');
});

test('collapses interior whitespace without gluing tokens', () => {
  assert.equal(minifyLua('local   a   =   1\n'), 'local a = 1\n');
  // `1 - -2` must not become `1 --2`, which is a comment.
  assert.equal(minifyLua('local a = 1 - -2\n'), 'local a = 1 - -2\n');
});

test('a removed comment still separates the tokens it sat between', () => {
  // The shipped bug. `local a=1--[[c]]local b=2` produced `local a=1local b=2`,
  // which does not parse.
  assert.equal(minifyLua('local a=1--[[c]]local b=2\n'), 'local a=1 local b=2\n');
  assert.equal(minifyLua('local a=1--[==[c]==]local b=2\n'), 'local a=1 local b=2\n');
  assert.equal(minifyLua('local a=1--[=[c]=]local b=2\n'), 'local a=1 local b=2\n');

  // Numbers and names must not fuse either.
  assert.equal(minifyLua('local a=1--[[c]]2\n'), 'local a=1 2\n');
  assert.equal(minifyLua('x=n--[[c]]e5\n'), 'x=n e5\n');
  assert.equal(minifyLua('if a--[[c]]==b then end\n'), 'if a ==b then end\n');

  // `---[[c]]` is NOT a long comment: Lua reads `--`, looks for a long bracket
  // at the next character, finds `-`, and takes the rest of the LINE. So the
  // one shape that could glue silently -- a `-` meeting a `-` and forming a new
  // line comment -- cannot be written. Pinned here so nobody "fixes" it into
  // emitting `local a=b - -1`, which would be a real change of meaning.
  assert.equal(minifyLua('local a=b---[[c]]-1\nlocal d=2\n'), 'local a=b\nlocal d=2\n');
  assert.deepEqual(lexLua('local a=b---[[c]]-1'), lexLua('local a=b'));

  // Nothing on the left means nothing to separate from, and the space would be
  // pure cost.
  assert.equal(minifyLua('--[[c]]local a=1\n'), 'local a=1\n');
  // Already separated: do not add a second space.
  assert.equal(minifyLua('local a=1 --[[c]] local b=2\n'), 'local a=1 local b=2\n');
  // A comment at end of line leaves no trailing space behind.
  assert.equal(minifyLua('local a=1 --[[c]]\nlocal b=2\n'), 'local a=1\nlocal b=2\n');
});

test('never touches the inside of a string', () => {
  assert.equal(minifyLua('local s = "-- not a comment"\n'), 'local s = "-- not a comment"\n');
  assert.equal(minifyLua("local s = '--x'\n"), "local s = '--x'\n");
  assert.equal(minifyLua('local s = "  spaced  "\n'), 'local s = "  spaced  "\n');
  // A quoted string may contain `]]`, `[[` and `--[[` without any of them
  // meaning anything.
  assert.equal(minifyLua('local s = "]] [[ --[[ ]=]"\n'), 'local s = "]] [[ --[[ ]=]"\n');
  // An escaped quote does not close the string, so the `-- c` after it is
  // still string content.
  assert.equal(minifyLua(`local s = "a${B}"b -- c"\n`), `local s = "a${B}"b -- c"\n`);
  // A trailing `\\` DOES close it, and the comment after really is a comment.
  assert.equal(minifyLua(`local s = "a${B}${B}"\nlocal b = 2 -- c\n`), `local s = "a${B}${B}"\nlocal b = 2\n`);
  // `\z` skips the following whitespace in Lua, so the newline it swallows is
  // string syntax and must survive verbatim rather than being flushed as layout.
  // A line carrying a raw newline keeps its trailing space: the trim is
  // switched off for the whole line, which costs a byte and cannot cost
  // correctness, because whitespace at the end of a line is never inside a
  // string -- a string is always consumed to its closer before the line ends.
  assert.equal(
    minifyLua(`local s = "a${B}z\n   b" -- c\n`),
    `local s = "a${B}z\n   b" \n`,
  );
  // A backslash-escaped literal newline is the same story reached through the
  // escape pair.
  assert.equal(minifyLua(`local s = "a${B}\nb"\n`), `local s = "a${B}\nb"\n`);
});

test('keeps long strings byte for byte and removes long comments', () => {
  assert.equal(minifyLua('local s = [[  a -- b\n   c]]\n'), 'local s = [[  a -- b\n   c]]\n');
  assert.equal(minifyLua('local s = [==[ ]] -- ]==]\n'), 'local s = [==[ ]] -- ]==]\n');
  // A long comment spanning lines must leave a newline behind, or the code
  // before it glues to the code after it.
  assert.equal(minifyLua('local a=1 --[[ x\ny ]] local b=2\n'), 'local a=1\nlocal b=2\n');
  assert.equal(minifyLua('local a=1 --[==[ ]] ]==] local b=2\n'), 'local a=1 local b=2\n');
  // Indentation inside a long string is content, not layout.
  assert.equal(minifyLua('local s = [[\n    keep me   \n]]\n'), 'local s = [[\n    keep me   \n]]\n');
  // A long string is not a long comment even when it opens on the same
  // characters: `t[[x]]` is a call with a string argument.
  assert.equal(minifyLua('f[[x]]\n'), 'f[[x]]\n');
  // `--[` with no second bracket is an ordinary line comment.
  assert.equal(minifyLua('local a=1 --[ not long\nlocal b=2\n'), 'local a=1\nlocal b=2\n');
  assert.equal(minifyLua('local a=1 --[== not long\nlocal b=2\n'), 'local a=1\nlocal b=2\n');
});

test('leaves numbers and identifiers alone', () => {
  // CLAUDE.md: values narrow through int(), and a rewritten literal would be a
  // silent balance change.
  assert.equal(minifyLua('local x = int(25)  -- narrow\n'), 'local x = int(25)\n');
  assert.equal(minifyLua('local x = 0.5\nlocal y = 1e12\n'), 'local x = 0.5\nlocal y = 1e12\n');
  assert.equal(minifyLua('local x = 0xff\nlocal y = 0x1p-4\n'), 'local x = 0xff\nlocal y = 0x1p-4\n');
});

test('a file with no trailing newline still ends in one', () => {
  assert.equal(minifyLua('local a = 1'), 'local a = 1\n');
  // A line comment is allowed to be the last thing in the file.
  assert.equal(minifyLua('local a = 1 -- trailing'), 'local a = 1\n');
  assert.equal(minifyLua('-- only a comment'), '');
  assert.equal(minifyLua('local a = 1 --[[ done ]]'), 'local a = 1\n');
});

test('CRLF sources minify to the same bytes as LF sources', () => {
  // This repo is on Windows with core.autocrlf, so a working tree can hand the
  // bundler CRLF. Layout newlines normalise; newlines inside a long string are
  // content and stay exactly as they arrived.
  assert.equal(minifyLua('local a = 1\r\n-- c\r\nlocal b = 2\r\n'), 'local a = 1\nlocal b = 2\n');
  assert.equal(minifyLua('local a=1--[[x\r\ny]]local b=2\r\n'), 'local a=1\nlocal b=2\n');
  assert.equal(minifyLua('local s = [[a\r\nb]]\r\n'), 'local s = [[a\r\nb]]\n');
});

test('high bytes and unicode survive in code and in strings', () => {
  assert.equal(minifyLua('local s = "é中文🐍"  -- c\n'), 'local s = "é中文🐍"\n');
  assert.equal(minifyLua('local s = [[🐍 -- ]]\n'), 'local s = [[🐍 -- ]]\n');
  // A comment made of high bytes is still just a comment.
  assert.equal(minifyLua('local a=1 -- 中文\nlocal b=2\n'), 'local a=1\nlocal b=2\n');
});

test('losing the lexer is a throw, not a silently shorter file', () => {
  // Answering "no closer" with "closes at end of input" deletes the rest of the
  // bundle and reports a wonderful byte saving.
  assert.throws(() => minifyLua('--[[ never closed\nlocal a=1\n'), /unterminated long comment/);
  assert.throws(() => minifyLua('local s = [==[ oops\nlocal a=1\n'), /unterminated long string/);
  assert.throws(() => minifyLua('local s = "oops\n'), /unterminated double-quoted string/);
  assert.throws(() => minifyLua("local s = 'oops\n"), /unterminated single-quoted string/);
});

/* ------------------------------------------------- an independent Lua lexer */

/**
 * Tokenise Lua 5.3, sharing no code with the minifier.
 *
 * Two properties matter for the differential:
 *
 *  - It is MAXIMAL MUNCH over name/number characters, so a glue like
 *    `1local` lexes as the single token `1local`, which never compares equal
 *    to `1` then `local`. A lexer that stopped at the first non-digit would
 *    happily agree that the glued output is the same program.
 *  - It removes comments the same way Lua does, so `b---[[c]]-1` collapsing
 *    into `b--1` shows up as MISSING tokens rather than as different ones.
 *
 * Strings are compared by their raw source text, which is exactly what the
 * minifier promises to copy byte for byte.
 */
function lexLua(src, label = 'source') {
  const n = src.length;
  const out = [];
  let i = 0;
  const at = (k) => {
    const before = src.slice(0, k);
    return `${label} line ${before.split('\n').length}`;
  };
  const level = (k) => {
    if (src[k] !== '[') return -1;
    let j = k + 1;
    while (src[j] === '=') j++;
    return src[j] === '[' ? j - k - 1 : -1;
  };
  const closeAt = (k, lv) => {
    const close = `]${'='.repeat(lv)}]`;
    const found = src.indexOf(close, k + lv + 2);
    if (found === -1) throw new Error(`lexer: unterminated long bracket at ${at(k)}`);
    return found + close.length;
  };
  const OPS = ['...', '..', '::', '<<', '>>', '//', '==', '~=', '<=', '>='];
  const SINGLE = '+-*/%^#&~|<>=(){}[];:,.';
  const word = /[A-Za-z0-9_]/;

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }

    if (c === '-' && src[i + 1] === '-') {
      const lv = level(i + 2);
      if (lv >= 0) i = closeAt(i + 2, lv);
      else while (i < n && src[i] !== '\n') i++;
      continue;
    }

    if (c === '[') {
      const lv = level(i);
      if (lv >= 0) { const e = closeAt(i, lv); out.push(`str:${src.slice(i, e)}`); i = e; continue; }
    }

    if (c === '"' || c === "'") {
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        const d = src[i];
        i++;
        if (d === c) { closed = true; break; }
      }
      if (!closed) throw new Error(`lexer: unterminated string at ${at(start)}`);
      out.push(`str:${src.slice(start, i)}`);
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      const hex = c === '0' && /[xX]/.test(src[i + 1] || '');
      if (hex) i += 2;
      const expChars = hex ? 'pP' : 'eE';
      while (i < n) {
        const d = src[i];
        if (expChars.includes(d)) {
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          continue;
        }
        // Maximal munch: `.` continues a number, and so does any word
        // character, which is what makes a glued `1local` a single token.
        if (d === '.' || word.test(d)) { i++; continue; }
        break;
      }
      out.push(`num:${src.slice(start, i)}`);
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && word.test(src[i])) i++;
      out.push(`name:${src.slice(start, i)}`);
      continue;
    }

    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS.includes(three)) { out.push(`op:${three}`); i += 3; continue; }
    if (OPS.includes(two)) { out.push(`op:${two}`); i += 2; continue; }
    if (SINGLE.includes(c)) { out.push(`op:${c}`); i++; continue; }

    throw new Error(`lexer: unexpected character ${JSON.stringify(c)} at ${at(i)}`);
  }
  return out;
}

test('the independent lexer notices the failures the minifier used to ship', () => {
  // Self-check: if the lexer could not tell these apart it would rubber-stamp
  // every differential below.
  assert.notDeepEqual(lexLua('local a=1 local b=2'), lexLua('local a=1local b=2'));
  assert.notDeepEqual(lexLua('local a=b - -1'), lexLua('local a=b--1'));
  assert.notDeepEqual(lexLua('x = n e5'), lexLua('x = ne5'));
  assert.notDeepEqual(lexLua('a = = b'), lexLua('a == b'));
  assert.notDeepEqual(lexLua('f [[s]]'), lexLua('f "s"'));
  // ...and that it agrees with itself about comments and layout.
  assert.deepEqual(lexLua('local a = 1 -- c\n'), lexLua('local\ta=1--[[x]]\n'));
});

/* --------------------------------------------- differential: token streams */

const luaFiles = fs.readdirSync(HERE, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.lua'))
  .map((e) => e.name)
  .concat(['battle-fleet/authority.lua', 'battle-fleet/worker.lua', 'battle-fleet/worker_test.lua'])
  .filter((f) => fs.existsSync(path.join(HERE, f)))
  .sort();

test('every .lua source minifies to an identical token stream', () => {
  assert.ok(luaFiles.length >= 10, `expected the native Lua sources, found ${luaFiles.length}`);
  for (const name of luaFiles) {
    const src = read(name);
    const min = minifyLua(src);
    assert.deepEqual(
      lexLua(min, `minified ${name}`),
      lexLua(src, name),
      `${name}: minification changed the token stream`,
    );
  }
});

test('the assembled deploy bundle minifies to an identical token stream', () => {
  for (const publicAccess of [false, true]) {
    const src = gameModuleSources({ publicAccess });
    assert.deepEqual(
      lexLua(minifyLua(src), 'minified bundle'),
      lexLua(src, 'bundle'),
      `assembled bundle (publicAccess=${publicAccess}) changed under minification`,
    );
  }
});

test('is idempotent on every shipping source', () => {
  for (const name of GAME_BUNDLE_FILES) {
    const src = read(name);
    const once = minifyLua(src);
    assert.equal(minifyLua(once), once, `${name} is not stable under a second pass`);
    assert.ok(once.length < src.length, `${name} did not shrink`);
  }
});

test('every long-bracket STRING in the sources survives verbatim', () => {
  // hyper-aos.lua is the only shipping file that has both long strings and long
  // comments, which makes it the one file that can tell them apart wrongly.
  const src = read('hyper-aos.lua');
  const min = minifyLua(src);
  for (const m of src.matchAll(/(^|[^-])(\[(=*)\[[\s\S]*?\]\3\])/g)) {
    // `m[1]` is the character before the bracket; a `-` there means the match
    // is the tail of a `--[[` comment, which is meant to be gone.
    if (src[m.index] === '-' || m[1] === '-') continue;
    assert.ok(min.includes(m[2]), `long string dropped: ${m[2].slice(0, 40)}`);
  }
});

/* ------------------------------------------ differential: real Lua 5.3 runs */

const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');

/**
 * Run the game suite in a real Lua 5.3 and return its transcript.
 *
 * The assembled source is the same one `run-local-game-test.mjs` builds, plus
 * `game_test.lua` and the call that runs it. `transform` is applied to the
 * whole thing, so the minified run and the plain run differ in nothing else.
 */
async function runSuite(transform) {
  const source = transform([
    'package.loaded[".json"] = require("json")',
    'Owner = nil',
    'local C = (function()', read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()', read('battle.lua'), 'end)()',
    'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
    'BattleFleetConfig = nil',
    'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
    read('game.lua'), read('game_test.lua'),
    'return gametest({}, { body = { gc = "on" } })',
  ].join('\n'));

  const PROCESS_ID = 'local-game-tests'.padEnd(43, '_');
  const OWNER = 'local-game-owner'.padEnd(43, '_');
  const handle = await AoLoader(fs.readFileSync(WASM), {
    format: 'wasm32-unknown-emscripten',
    computeLimit: 18_000_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
  });
  const result = await handle(null, {
    Id: 'eval-game-tests', Target: PROCESS_ID, Owner: OWNER, From: OWNER,
    Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
    'Block-Height': '1', Timestamp: '1700000000000',
    Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
  }, {
    Process: { Id: PROCESS_ID, Owner: OWNER, Tags: [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'Type', value: 'Process' },
    ] },
  });
  if (result.Error) throw new Error(result.Error);
  const data = result.Output?.data;
  const output = typeof data === 'string' ? data : data?.output;
  return typeof output === 'string' ? output : JSON.stringify(output);
}

test('the minified module runs the whole suite identically', { timeout: 600_000 }, async (t) => {
  if (!fs.existsSync(WASM)) {
    t.skip(`no Lua 5.3 module at ${WASM} (the Reality submodule is not checked out)`);
    return;
  }
  const plain = await runSuite((s) => s);
  const minified = await runSuite(minifyLua);

  /**
   * A handful of assertions print a bare table or function, and Lua renders
   * those as `table: 0x7b0e60` -- a heap address. It moves when the chunk being
   * loaded is a different length, which minification guarantees, and it says
   * nothing about behaviour. Everything else the suite prints is a value.
   */
  const stable = (s) => s.replace(/\b(table|function|userdata|thread): 0x[0-9a-fA-F]+/g, '$1: 0x…');

  // Both must actually have run the suite, or "identical" is two identical
  // failures.
  assert.match(plain, /^\d+ passed, 0 failed$/m, 'the unminified suite did not pass');
  assert.match(minified, /^\d+ passed, 0 failed$/m, 'the MINIFIED suite did not pass');
  const count = Number(/^(\d+) passed, 0 failed$/m.exec(plain)[1]);
  assert.ok(count >= 600, `expected the full suite, got ${count} assertions`);

  // Every assertion prints its subject, and the economy tests print whole state
  // snapshots, so an exact transcript match is a strong statement: the two
  // programs computed the same numbers in the same order.
  // Write both transcripts out before asserting: the diff is ~800 KB and the
  // assertion message truncates it, so a failure needs files to diff.
  const outDir = path.join(ROOT, 'node_modules', '.cache', 'lua-minify');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'plain.txt'), stable(plain));
  fs.writeFileSync(path.join(outDir, 'minified.txt'), stable(minified));

  assert.equal(
    stable(minified),
    stable(plain),
    `the minified module produced a different transcript; diff ${outDir}/plain.txt against minified.txt`,
  );
});

/* -------------------------------------------------------------- the ceiling */

test('the assembled game module fits under the deploy ceiling', () => {
  // The reason this file exists. 524,452 B spawns on a public scheduler and
  // 540,836 B answers 500 scheduler_timeout; deploy.mjs refuses above 480,000.
  // The bundle comes from game-bundle.mjs, which is what deploy.mjs spawns --
  // this test used to re-declare the list and had already drifted from it.
  const sources = gameModuleSources({ publicAccess: false });
  const bytes = Buffer.byteLength(minifyLua(sources));
  assert.ok(
    bytes < 480_000,
    `assembled module is ${bytes} B, over the 480,000 B deploy ceiling`,
  );
  console.log(`minified module: ${bytes} B (${Buffer.byteLength(sources)} B of source)`);
});
