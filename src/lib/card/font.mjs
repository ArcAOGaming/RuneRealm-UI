/**
 * font.mjs — the card's bitmap faces, drawn as rectangles.
 *
 * The card art bakes its own typefaces (Bitsumis for the monster name, Bkant
 * for the move names) into the PNG plates, and those plates carry the WRONG
 * words: the nameplates say ZEPHOUND / AQUANINE / IGNISFANG / TERRABARK while
 * the process names its monsters Airbud, WaterDoge, FireFox and Rockpup, and
 * eight of the twenty-four move plates are labelled for moves this game does
 * not have. A minted card has to say what the process says, so the text is
 * drawn rather than composited, and the plates are used for their ICONS only.
 *
 * Why a bitmap font rather than a real one: a font file is a dependency that
 * has to resolve identically in a browser and in the Node worker, and the two
 * have no common text API. Rectangles do. This also satisfies the one rule the
 * art spec is absolute about (STYLE.md): no anti-aliasing, integer scaling
 * only. Every glyph here scales by whole pixels, so a card composed in the
 * worker is byte-identical to the preview the player approved.
 *
 * Uppercase only. Lowercase input is folded up, and anything unmapped becomes a
 * space rather than an exception — a move name is not worth a failed mint.
 *
 * There are three faces: `wide`, 5 columns by 7 rows, which is the card's
 * typeface; `slim` at 3 by 7, which trades grid width for point size; and
 * `book` at 6 by 9, which is the one that looks like writing. See each.
 */

/** Each glyph is 7 rows of 5 bits, MSB (bit 4) leftmost. */
const G = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x13, 0x13, 0x15, 0x19, 0x19, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "'": [0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
};

/**
 * The second face: 3 columns wide, same 7 rows. Each glyph is 7 rows of 3 bits.
 *
 * This exists for one reason, and it is not variety. A move name is capped by
 * the width of its column, so the size the panel can draw is set by the widest
 * word in the pools: at 5 columns plus tracking, "ADRENALINE" is 177 of the
 * 180 it has at scale 3, and scale 4 would need 236. At 3 columns it is 156 at
 * SCALE 4 — so the same word fits with letters a third TALLER (28 rather than
 * 21 pixels) and strokes a third thicker. Narrower grid, bigger type.
 *
 * What that costs is the letters a 3-wide grid cannot draw honestly. M and W
 * are the usual casualties and they are drawn here as H with a filled middle,
 * which is legible in a word and poor in isolation; N leans on a single top-
 * left serif to separate itself from D. Judge it at size, on the card, against
 * the 5-wide face — that is what `MOVE_FACE` in layout.mjs is for.
 */
const SLIM = {
  A: [0x2, 0x5, 0x5, 0x7, 0x5, 0x5, 0x5],
  B: [0x6, 0x5, 0x5, 0x6, 0x5, 0x5, 0x6],
  C: [0x3, 0x4, 0x4, 0x4, 0x4, 0x4, 0x3],
  D: [0x6, 0x5, 0x5, 0x5, 0x5, 0x5, 0x6],
  E: [0x7, 0x4, 0x4, 0x6, 0x4, 0x4, 0x7],
  F: [0x7, 0x4, 0x4, 0x6, 0x4, 0x4, 0x4],
  G: [0x3, 0x4, 0x4, 0x5, 0x5, 0x5, 0x3],
  H: [0x5, 0x5, 0x5, 0x7, 0x5, 0x5, 0x5],
  I: [0x7, 0x2, 0x2, 0x2, 0x2, 0x2, 0x7],
  J: [0x1, 0x1, 0x1, 0x1, 0x1, 0x5, 0x2],
  K: [0x5, 0x5, 0x5, 0x6, 0x5, 0x5, 0x5],
  L: [0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x7],
  M: [0x5, 0x7, 0x7, 0x5, 0x5, 0x5, 0x5],
  N: [0x6, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5],
  O: [0x2, 0x5, 0x5, 0x5, 0x5, 0x5, 0x2],
  P: [0x6, 0x5, 0x5, 0x6, 0x4, 0x4, 0x4],
  Q: [0x2, 0x5, 0x5, 0x5, 0x5, 0x2, 0x1],
  R: [0x6, 0x5, 0x5, 0x6, 0x5, 0x5, 0x5],
  S: [0x3, 0x4, 0x4, 0x2, 0x1, 0x1, 0x6],
  T: [0x7, 0x2, 0x2, 0x2, 0x2, 0x2, 0x2],
  U: [0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x7],
  V: [0x5, 0x5, 0x5, 0x5, 0x5, 0x2, 0x2],
  W: [0x5, 0x5, 0x5, 0x5, 0x7, 0x7, 0x5],
  X: [0x5, 0x5, 0x2, 0x2, 0x2, 0x5, 0x5],
  Y: [0x5, 0x5, 0x5, 0x2, 0x2, 0x2, 0x2],
  Z: [0x7, 0x1, 0x1, 0x2, 0x4, 0x4, 0x7],
  0: [0x7, 0x5, 0x5, 0x5, 0x5, 0x5, 0x7],
  1: [0x2, 0x6, 0x2, 0x2, 0x2, 0x2, 0x7],
  2: [0x6, 0x1, 0x1, 0x2, 0x4, 0x4, 0x7],
  3: [0x6, 0x1, 0x1, 0x2, 0x1, 0x1, 0x6],
  4: [0x5, 0x5, 0x5, 0x7, 0x1, 0x1, 0x1],
  5: [0x7, 0x4, 0x4, 0x6, 0x1, 0x1, 0x6],
  6: [0x3, 0x4, 0x4, 0x6, 0x5, 0x5, 0x2],
  7: [0x7, 0x1, 0x1, 0x1, 0x2, 0x2, 0x2],
  8: [0x2, 0x5, 0x5, 0x2, 0x5, 0x5, 0x2],
  9: [0x2, 0x5, 0x5, 0x3, 0x1, 0x1, 0x6],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0x0, 0x0, 0x0, 0x7, 0x0, 0x0, 0x0],
  "'": [0x2, 0x2, 0x0, 0x0, 0x0, 0x0, 0x0],
  '.': [0x0, 0x0, 0x0, 0x0, 0x0, 0x2, 0x2],
  '+': [0x0, 0x0, 0x2, 0x7, 0x2, 0x0, 0x0],
  '/': [0x1, 0x1, 0x2, 0x2, 0x2, 0x4, 0x4],
  ':': [0x0, 0x2, 0x2, 0x0, 0x2, 0x2, 0x0],
  '!': [0x2, 0x2, 0x2, 0x2, 0x2, 0x0, 0x2],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** Blank columns between glyphs, in font pixels. */
export const TRACKING = 1;

/**
 * The faces, by name. `wide` is the card's typeface everywhere except where a
 * caller asks otherwise; every function below takes one and defaults to it, so
 * nothing that does not care about faces has to know they exist.
 */
/**
 * The third face: 6 columns by NINE rows, written out as pictures.
 *
 * The other two are hex because they are 7 rows of 5 bits and a hex digit is
 * legible at that size. This one is not: 9 rows of 6, and the whole reason it
 * exists is the shape of the letters, which nobody can review as `0x3e`.
 * The rows are parsed once at load.
 *
 * Why nine rows. A card's move name has a fixed width — seventeen characters
 * of "WARRIOR'S RESOLVE" inside a row that is 447 across — so the SIZE of the
 * type is set by arithmetic and the only thing a face can change is how much
 * letter it fits in it. At 5x7 a letter drawn to fill the height is a third
 * narrower than it is tall, which is why it read as squashed. Six by nine is
 * 0.667, near enough the proportion of real capitals, and the extra rows are
 * what let an S have a spine and an R have a leg.
 *
 * Strokes are two units. One unit at this size is a hairline against the
 * card's own artwork, and the counters stay open at two.
 *
 * The cell is SEVEN wide and almost every letter inks six of it. The seventh
 * column exists for M and W alone: two stems of two units with an apex
 * between them does not fit in six, and drawn there they come out as a solid
 * block with a notch. Because the face is spaced proportionally, that column
 * costs nothing on the other forty-two glyphs.
 */
const BOOK_ROWS = {
  A: '.####..|##..##.|##..##.|##..##.|######.|##..##.|##..##.|##..##.|##..##.',
  B: '#####..|##..##.|##..##.|##..##.|#####..|##..##.|##..##.|##..##.|#####..',
  C: '.####..|##..##.|##.....|##.....|##.....|##.....|##.....|##..##.|.####..',
  D: '#####..|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|#####..',
  E: '######.|##.....|##.....|##.....|#####..|##.....|##.....|##.....|######.',
  F: '######.|##.....|##.....|##.....|#####..|##.....|##.....|##.....|##.....',
  G: '.####..|##..##.|##.....|##.....|##.###.|##..##.|##..##.|##..##.|.####..',
  H: '##..##.|##..##.|##..##.|##..##.|######.|##..##.|##..##.|##..##.|##..##.',
  I: '######.|..##...|..##...|..##...|..##...|..##...|..##...|..##...|######.',
  J: '..####.|....##.|....##.|....##.|....##.|....##.|##..##.|##..##.|.####..',
  K: '##..##.|##.##..|####...|###....|###....|####...|##.##..|##..##.|##..##.',
  L: '##.....|##.....|##.....|##.....|##.....|##.....|##.....|##.....|######.',
  M: '##..##.|######.|######.|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.',
  N: '##..##.|###.##.|###.##.|##.###.|##.###.|##..##.|##..##.|##..##.|##..##.',
  O: '.####..|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|.####..',
  P: '#####..|##..##.|##..##.|##..##.|#####..|##.....|##.....|##.....|##.....',
  Q: '.####..|##..##.|##..##.|##..##.|##..##.|##..##.|##.###.|##..##.|.#####.',
  R: '#####..|##..##.|##..##.|##..##.|#####..|####...|##.##..|##..##.|##..##.',
  S: '.#####.|##.....|##.....|##.....|.####..|....##.|....##.|....##.|#####..',
  T: '######.|..##...|..##...|..##...|..##...|..##...|..##...|..##...|..##...',
  U: '##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|.####..',
  V: '##..##.|##..##.|##..##.|##..##.|##..##.|##..##.|.####..|.####..|..##...',
  W: '##...##|##...##|##...##|##...##|##.#.##|##.#.##|##.#.##|##.#.##|#######',
  X: '##..##.|##..##.|.####..|.####..|..##...|.####..|.####..|##..##.|##..##.',
  Y: '##..##.|##..##.|.####..|.####..|..##...|..##...|..##...|..##...|..##...',
  Z: '######.|....##.|....##.|...##..|..##...|.##....|##.....|##.....|######.',
  0: '.####..|##..##.|##..##.|##.###.|######.|###.##.|##..##.|##..##.|.####..',
  1: '..##...|.###...|..##...|..##...|..##...|..##...|..##...|..##...|######.',
  2: '.####..|##..##.|....##.|....##.|...##..|..##...|.##....|##.....|######.',
  3: '.####..|##..##.|....##.|...##..|..###..|....##.|....##.|##..##.|.####..',
  4: '...##..|..###..|.####..|##.##..|##.##..|######.|...##..|...##..|...##..',
  5: '######.|##.....|##.....|#####..|....##.|....##.|....##.|##..##.|.####..',
  6: '..###..|.##....|##.....|##.....|#####..|##..##.|##..##.|##..##.|.####..',
  7: '######.|....##.|....##.|...##..|...##..|..##...|..##...|.##....|.##....',
  8: '.####..|##..##.|##..##.|##..##.|.####..|##..##.|##..##.|##..##.|.####..',
  9: '.####..|##..##.|##..##.|##..##.|.#####.|....##.|....##.|...##..|.###...',
  ' ': '.......|.......|.......|.......|.......|.......|.......|.......|.......',
  '-': '.......|.......|.......|.......|######.|.......|.......|.......|.......',
  "'": '..##...|..##...|..##...|.......|.......|.......|.......|.......|.......',
  '.': '.......|.......|.......|.......|.......|.......|.......|..##...|..##...',
  '+': '.......|.......|..##...|..##...|######.|..##...|..##...|.......|.......',
  '/': '....##.|....##.|...##..|...##..|..##...|.##....|.##....|##.....|##.....',
  ':': '.......|..##...|..##...|.......|.......|..##...|..##...|.......|.......',
  '!': '..##...|..##...|..##...|..##...|..##...|..##...|.......|..##...|..##...',
};

const parseFace = (rows, width, height) => Object.fromEntries(
  Object.entries(rows).map(([ch, art]) => {
    const lines = art.split('|');
    if (lines.length !== height) throw new Error(`font: ${ch} has ${lines.length} rows`);
    return [ch, lines.map((line) => {
      if (line.length !== width) throw new Error(`font: ${ch} row is ${line.length} wide`);
      return [...line].reduce((bits, c) => (bits << 1) | (c === '#' ? 1 : 0), 0);
    })];
  }),
);

export const FACES = {
  wide: { glyphs: G, width: GLYPH_W, height: GLYPH_H, tracking: TRACKING },
  slim: { glyphs: SLIM, width: 3, height: GLYPH_H, tracking: TRACKING },
  book: {
    glyphs: parseFace(BOOK_ROWS, 7, 9), width: 7, height: 9, tracking: TRACKING,
    proportional: true, blank: 2,
  },
};

/**
 * Per-glyph ink widths, for a face that is spaced like writing rather than
 * like a table.
 *
 * A monospaced grid gives an apostrophe the same room as a W, so the gaps
 * around it swallow the letters either side and the line reads scrunched no
 * matter how much tracking is added — and tracking is exactly what a card
 * cannot afford, because the row's width is fixed by its longest name. This
 * measures what each glyph actually inks and advances by that instead, which
 * hands back the empty columns to the gaps. On "WARRIOR'S RESOLVE" it is 24
 * pixels, which is the difference between 3 of air between letters and 4.
 *
 * Blank glyphs have no ink to measure, so a space takes `blank` columns. Two,
 * not three: with 5 pixels of tracking either side a word break is already 18
 * against 5 between letters, which is the proportion a reader wants, and the
 * four pixels it gives back are four the longest name on a card does not
 * have.
 */
const METRICS = new WeakMap();

function metrics(face) {
  let m = METRICS.get(face);
  if (m) return m;
  m = new Map();
  for (const [ch, rows] of Object.entries(face.glyphs)) {
    let left = face.width, right = -1;
    for (const bits of rows) {
      for (let c = 0; c < face.width; c++) {
        if (!(bits & (1 << (face.width - 1 - c)))) continue;
        if (c < left) left = c;
        if (c > right) right = c;
      }
    }
    m.set(ch, right < 0
      ? { left: 0, width: face.blank ?? face.width }
      : { left, width: right - left + 1 });
  }
  METRICS.set(face, m);
  return m;
}

/** What one glyph occupies, and where its ink starts inside its cell. */
const cell = (face, ch) => (face.proportional
  ? metrics(face).get(ch) ?? metrics(face).get(' ')
  : { left: 0, width: face.width });

const glyph = (face, ch) => face.glyphs[ch] ?? face.glyphs[' '];
const pitch = (face) => face.width + face.tracking;

/**
 * A scale is a number, or the three ways type can be made heavier without
 * being made wider.
 *
 * `x` and `y` are separate because the move panel's width is fixed by its
 * longest word and its height is not: the same letterforms at x 3, y 4 are a
 * third taller in exactly the room they already had. `bold` then widens every
 * stroke by that many device pixels, which comes out of the blank column
 * between glyphs rather than out of the line — a string grows by `bold` in
 * total, not by `bold` per character.
 *
 * `track` is the gap between glyphs in DEVICE pixels, overriding the face's
 * one blank column. It is the only way to make a letter wider without making
 * the line wider: at x 5 the card's face is 25 across and seventeen of them
 * with a full column between is 507, against the 434 a move row has. Spending
 * the gap instead — 25 wide with 1 pixel of air — is 441. Small numbers here
 * are a real cost; below 1 the letters merge.
 *
 * All of it stays integer, so this is whole-pixel scaling and STYLE.md's rule
 * against resampling holds.
 */
const size = (scale) => (typeof scale === 'number'
  ? { x: scale, y: scale, bold: 0, track: null }
  : { x: scale.x, y: scale.y ?? scale.x, bold: scale.bold ?? 0, track: scale.track ?? null });

/** Width of `text` in device pixels at `scale`. Trailing tracking is trimmed. */
const gapOf = (face, s) => (s.track === null ? face.tracking * s.x : s.track);
const advance = (face, s, ch) => cell(face, ch).width * s.x + gapOf(face, s);

export function measure(text, scale, face = FACES.wide) {
  const chars = String(text).toUpperCase();
  if (!chars.length) return 0;
  const s = size(scale);
  let w = 0;
  for (const ch of chars) w += advance(face, s, ch);
  return w - gapOf(face, s) + s.bold;
}

export const lineHeight = (scale, face = FACES.wide) => face.height * size(scale).y;

/**
 * Break `text` into at most `maxLines` lines that each fit `width` device
 * pixels. Returns null when it cannot be done, which is the caller's signal to
 * try a smaller scale rather than to overflow the slot.
 */
export function wrap(text, width, scale, maxLines, face = FACES.wide) {
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (measure(word, scale, face) > width) return null;   // one word cannot fit
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, scale, face) <= width) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length && lines.length <= maxLines ? lines : null;
}

/**
 * Emit the filled rectangles for one line of text.
 *
 * Runs of set bits become a single rectangle rather than one per pixel: a name
 * at scale 5 is ~40 glyphs of up to 35 pixels each, and the run-length form
 * cuts that by roughly four times. The painter only ever sees axis-aligned
 * integer rects, which is what makes the browser and worker agree.
 */
export function glyphRects(text, x, y, scale, face = FACES.wide) {
  const rects = [];
  const chars = String(text).toUpperCase();
  const w = face.width;
  const s = size(scale);
  let pen = x;
  for (let i = 0; i < chars.length; i++) {
    const rows = glyph(face, chars[i]);
    const box = cell(face, chars[i]);
    // The pen sits where the INK starts, not where the cell does, so a narrow
    // glyph does not carry its empty columns along with it.
    const gx = pen - box.left * s.x;
    pen += advance(face, s, chars[i]);
    for (let r = 0; r < face.height; r++) {
      const bits = rows[r];
      let c = 0;
      while (c < w) {
        if (!(bits & (1 << (w - 1 - c)))) { c++; continue; }
        let run = 1;
        while (c + run < w && bits & (1 << (w - 1 - c - run))) run++;
        rects.push([gx + c * s.x, y + r * s.y, run * s.x + s.bold, s.y]);
        c += run;
      }
    }
  }
  return rects;
}
