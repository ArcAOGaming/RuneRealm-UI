/**
 * Strip comments and layout from a Lua source bundle, byte-for-byte safely.
 *
 * Why this exists: a `~lua@5.3a` process is spawned by putting the whole module
 * in one signed message, and a public scheduler drops that message with
 * `500 scheduler_timeout` above a size cliff bracketed at 524,452 B OK /
 * 540,836 B failing. The shipping game bundle was 539,904 B, so it could not be
 * spawned on ANY public node. Roughly 30% of it is comments and indentation --
 * which is exactly right for the SOURCE files, because they are the
 * documentation, and exactly wrong for the bytes we hand a scheduler.
 *
 * So this runs on the CONCATENATED BUNDLE ONLY, never on a file in the repo.
 *
 * What it removes, and nothing else:
 *   - line comments (`--` to end of line) and long comments (`--[[ ]]`,
 *     `--[==[ ]==]`)
 *   - leading indentation and trailing whitespace
 *   - blank lines
 *   - runs of spaces/tabs between tokens, collapsed to one space
 *
 * What it never touches: newlines between statements (Lua has no statement
 * terminator, so joining lines can change what parses), the contents of any
 * string literal, and every token, name and number -- so `int()` narrowing,
 * published key names and every constant survive verbatim.
 *
 * The scanner is a real lexer, not a regex, because both traps here are
 * context: `--` inside a string is not a comment, and `]]` inside a `[[ ]]`
 * string is not the end of anything. It tracks short strings (with `\` escapes,
 * including `\z` line continuations) and long brackets at every level.
 *
 * ## A removed comment is still a token separator
 *
 * This is the rule the first version of this file got wrong. Deleting a comment
 * closes the gap it occupied, and in Lua that gap was doing work:
 *
 *   local a=1--[[c]]local b=2   ->  local a=1local b=2
 *   x = n--[[c]]e5              ->  x = ne5
 *
 * `1local` is one malformed-number token to Lua's lexer, not two tokens, and
 * `n` `e5` fuses into a single name. Every such fusion is a compile error, so
 * the module does not silently misbehave -- it fails to spawn, on a public
 * scheduler, with the same shapeless 500 the size cliff produces, after the
 * suite has passed against the unminified sources. That is the whole cost of
 * getting this wrong, and it is enough.
 *
 * So every removed comment that did not itself span a line break leaves one
 * space behind (`separate()` below) unless the line already ends in whitespace.
 * A space is free -- `flush()` trims it if the line ends there -- and it can
 * never change meaning outside a string, which is the only place this scanner
 * ever emits one.
 *
 * The one shape that would be genuinely silent -- a `-` on the left meeting a
 * `-` on the right and forming a NEW line comment that eats the rest of the
 * expression -- turns out to be unreachable, and it is worth knowing why rather
 * than assuming it. It would need `-` immediately followed by `--[[`, i.e. the
 * source text `---[[`; but Lua reads `--` and then looks for a long bracket at
 * the very next character, finds `-`, and the whole thing is an ordinary line
 * comment. `local a=b---[[c]]-1` is `local a=b` in Lua 5.3 and this minifier
 * agrees. `lua-minify.test.mjs` pins that.
 *
 * The line-comment branch needs no such care: it runs to the newline, and that
 * newline is left in the stream to be flushed as a separator of its own.
 *
 * ## Losing track is a throw, not a smaller file
 *
 * An unterminated long bracket or short string means the scanner's idea of
 * where it is has diverged from Lua's. The old code answered that by treating
 * "no closer" as "closes at end of file", which silently swallows the entire
 * rest of the bundle and reports a wonderful byte saving. Every such case now
 * throws with the offset, because a minifier that cannot lex its input has no
 * business deciding what gets deployed.
 */

/** Line and column of `i`, for an error a human can act on. */
const where = (s, i) => {
  const before = s.slice(0, i);
  const line = before.split('\n').length;
  const col = i - (before.lastIndexOf('\n') + 1) + 1;
  return `line ${line}, column ${col}`;
};

/**
 * Level of the long bracket opening at `i`, or -1 if one does not open there.
 * `[[` is level 0, `[==[` is level 2. The level has to match on the closing
 * side, which is the entire point of the syntax.
 */
const longBracketLevel = (s, i) => {
  if (s[i] !== '[') return -1;
  let j = i + 1;
  while (s[j] === '=') j++;
  return s[j] === '[' ? j - i - 1 : -1;
};

/**
 * Index just past the `]==]` that closes the level-`lv` bracket opening at `i`.
 *
 * Throws when there is no closer. Returning `s.length` instead -- which is what
 * this used to do -- turns a mis-lex into a silent deletion of everything after
 * the opener.
 */
const endOfLongBracket = (s, i, lv, what) => {
  const close = `]${'='.repeat(lv)}]`;
  const at = s.indexOf(close, i + lv + 2);
  if (at === -1) {
    throw new Error(
      `unterminated long ${what} opened at ${where(s, i)}: no ${close} before end of input`,
    );
  }
  return at + close.length;
};

export function minifyLua(src) {
  const n = src.length;
  let out = '';
  let line = '';
  let i = 0;

  // A line is only droppable when it holds no code. A long string that spans
  // lines is appended raw, newlines and all, so `line` can legitimately contain
  // them; trailing-whitespace trimming is skipped in that case because those
  // bytes are string content, not layout.
  let lineIsRaw = false;
  const flush = () => {
    const t = lineIsRaw ? line : line.replace(/[ \t]+$/, '');
    if (t.length) out += `${t}\n`;
    line = '';
    lineIsRaw = false;
  };

  // Keep the token that ended on the left of a deletion from touching the one
  // that starts on the right. See the header: `b-` + `-1` is not `b - -1`.
  const separate = () => {
    if (line.length && !/[ \t]$/.test(line)) line += ' ';
  };

  while (i < n) {
    const c = src[i];

    if (c === '\n') { flush(); i++; continue; }
    if (c === '\r') { i++; continue; }

    if (c === ' ' || c === '\t') {
      // Leading indentation goes; an interior run collapses to one space, which
      // still separates the tokens either side of it.
      separate();
      i++;
      continue;
    }

    // Comment: `--`, then either a long bracket or the rest of the line.
    if (c === '-' && src[i + 1] === '-') {
      const lv = longBracketLevel(src, i + 2);
      if (lv >= 0) {
        const end = endOfLongBracket(src, i + 2, lv, 'comment');
        // Emit one newline per line the comment spanned. Swallowing them would
        // glue the code before the comment to the code after it.
        let spannedLines = false;
        for (let k = i; k < end; k++) if (src[k] === '\n') { flush(); spannedLines = true; }
        // An inline `--[[ ]]` spans no line break, so nothing was flushed and
        // the two sides are now adjacent. One space is the whole fix.
        if (!spannedLines) separate();
        i = end;
      } else {
        // Runs to the newline, which stays in the stream and flushes itself.
        // At end of input with no newline there is nothing on the right to
        // glue to, and the final flush() below closes the line.
        while (i < n && src[i] !== '\n') i++;
      }
      continue;
    }

    // Long string: copied out byte for byte.
    if (c === '[') {
      const lv = longBracketLevel(src, i);
      if (lv >= 0) {
        const end = endOfLongBracket(src, i, lv, 'string');
        const raw = src.slice(i, end);
        line += raw;
        if (raw.includes('\n')) lineIsRaw = true;
        i = end;
        continue;
      }
    }

    // Short string: copied out byte for byte, escapes consumed in pairs so that
    // `"\""` does not look like it closed early.
    if (c === '"' || c === "'") {
      const quote = c;
      const opened = i;
      let closed = false;
      line += c;
      i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') {
          const e = src[i + 1] ?? '';
          line += d + e;
          i += 2;
          // `"a\<newline>b"` is a legal literal newline, reached through the
          // escape pair rather than through the branch below. Without this the
          // line carries a raw newline while claiming it is layout.
          if (e === '\n') lineIsRaw = true;
          continue;
        }
        line += d;
        i++;
        if (d === quote) { closed = true; break; }
        if (d === '\n') lineIsRaw = true; // only reachable via a `\z` continuation
      }
      if (!closed) {
        throw new Error(
          `unterminated ${quote === '"' ? 'double' : 'single'}-quoted string opened at `
          + `${where(src, opened)}`,
        );
      }
      continue;
    }

    line += c;
    i++;
  }
  flush();
  return out;
}

export default minifyLua;
