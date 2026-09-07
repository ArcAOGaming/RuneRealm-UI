/**
 * layout.mjs — where everything sits on a card, plain or extended.
 *
 * This module decides; it does not draw. `cardOps(monster)` returns a flat list
 * of two kinds of instruction — blit this rectangle of that PNG here, and fill
 * this rectangle with that colour — and a painter turns them into pixels. The
 * browser paints them onto a canvas for the preview, the worker paints them
 * into a raw RGBA buffer for the mint. One layout, two painters, no chance of
 * the picture a player approved differing from the picture that gets signed.
 *
 * Every coordinate below was measured off the art rather than guessed:
 *
 *   window        the frame's transparent interior, x 48-593, y 126-575
 *   level coin    the empty gold disc at 12,12-99,99 (the number is not baked)
 *   stat columns  the four icon discs are 96x96 sprites in the frame art,
 *                 re-cut to centre on x 108, 252, 396, 540 and to STRADDLE the
 *                 seam at y 576: they run y 528-623, half over the portrait
 *                 and half in the band. The frame paints after the portrait,
 *                 so they simply cover it. Their ATTACK/SPEED/DEFENSE/HEALTH
 *                 labels were painted out — the disc says which stat it is,
 *                 and the room the words took now belongs to the number, which
 *                 sits in the band between the discs and the moves box at 696
 *   move slots    the box's flat interior is x 67-612, y 680-914. THREE rows
 *                 of 78, each a full-size 78x75 badge then a name
 *
 * The art is 4x-scaled pixel art, so everything here is integers and every
 * glyph scales by whole pixels. See STYLE.md: no resampling, ever.
 *
 * EXTENDED is the second mode, carried over from the original renderer
 * (`src/components/monster/MonsterCardDisplay.tsx`, in this repo's history at
 * b28f29d). It widens the canvas to 1065 and fills the extra 417 with the
 * `Side Background` plate and three sections — moves with their full stat
 * riders, the status meters, and the satchel. Same card on the left, so a
 * player is looking at the same picture either way.
 */
import { FACES, glyphRects, lineHeight, measure, wrap } from './font.mjs';
import { ICON_H, ICON_W, moveIcon } from './moves.mjs';
import { label } from './naming.mjs';

export const CARD_W = 693;
export const CARD_H = 968;

/**
 * The extended panel, measured off `Side Background.png`.
 *
 * The original config called the panel 417 wide and drew the plate STRETCHED
 * to fit it. The copy of that plate in this repo is a 648x1065 canvas with the
 * panel padded inside it, so it is placed by TRANSLATION instead — no
 * resampling, which the art spec forbids outright.
 *
 * Its content sits at x 126-522, so the panel is its true width, 396, and the
 * shift is 522 — which butts the panel's left frame exactly against the card's
 * right edge at 648. Shifting by the original 532 left a ten-pixel transparent
 * seam down the middle of the card, which reads as a rendering fault on any
 * background that is not the page's.
 *
 * The interior (the flat plum field inside the copper frame) is x 135-506,
 * y 36-1031 on the plate, so 657-1028 once moved.
 */
export const PANEL_W = 396;
const PANEL = {
  dx: 567,
  x: 702,
  y: 36,
  w: 372,
  h: 996,
  pad: 18,
};

/** The art repo calls the rock element "Earth"; the process only ever says "rock". */
const ART_ELEMENT = { fire: 'Fire', water: 'Water', air: 'Air', rock: 'Earth' };

/**
 * The portrait family a card may show.
 *
 * `src/assets/Monsters/portraits/` holds five: doge, super, dragon, mix and
 * ledgendary. ONLY doge is a released monster. The other four are art for
 * creatures this game does not have yet, and `src/ui/art.ts` reaches for two of
 * them by level — `ascended` is Super, `dragon` is the Dragon family — which is
 * survivable on a screen and is not survivable here. A minted card is a
 * permanent, public, tradable picture; publishing unreleased designs on it
 * cannot be taken back, and it would put creatures into a marketplace before
 * they exist in the game.
 *
 * So the card does not follow the screen's evolution tiers at all. Level is
 * shown on the coin, where it belongs. When a family ships, add it here.
 *
 * Unlike the 320x448 crops in `assets/art/`, these plates are full 648x1065
 * canvases already registered to the frame's window — they composite at the
 * origin like every other layer, and there is no placement to get wrong.
 */
const PORTRAIT_FAMILY = 'doge';
const portraitPlate = (art) =>
  `Monsters/portraits/${PORTRAIT_FAMILY}/level-1/Doge ${art}.png`;
const monsterIndexPortrait = (entryNo) => {
  const number = Math.round(Number(entryNo) || 0);
  return number > 0 ? `monster-index/${String(number).padStart(3, '0')}/portrait.png` : null;
};

/**
 * The portrait window, measured off the frame — the card's one authoring
 * contract. Everything that draws INTO the card (the studio, the monster
 * index, anything that crops art for a card) sizes against this rather than
 * against numbers of its own, so moving the window is one edit here.
 */
export const WINDOW = { x: 73, y: 121, w: 547, h: 450 };

/**
 * The canvas a studio portrait is authored on, and how it sits in the window:
 * centred across it, standing `FLOOR` above its bottom edge.
 *
 * It is deliberately NARROWER than the window. The window is 547 across and
 * only 450 tall — wider than it is high — and a creature drawn to fill that is
 * a creature seen from too far away. The subject takes the middle 320 and the
 * background carries the rest, which is what the scenery plates are for.
 *
 * The four portraits in `assets/monster-index/` are authored at this size by
 * `tools/studio-plugin.ts`. Change it in both places or neither.
 */
export const PORTRAIT_CANVAS = { w: 320, h: 448, floor: 8 };

const LEVEL_COIN = { cx: 81, cy: 56, maxWidth: 60 };
const NAME_BAND = { cx: 346, cy: 73, maxWidth: 430 };
/**
 * The stat columns, and the one place they are stated.
 *
 * `Frame *.png` bakes the four icon discs, so these numbers are not a choice
 * this module makes freely — they are where the art puts them, and moving them
 * means re-cutting all four frames. They were re-cut: the discs used to sit at
 * x 130/254/383/511 with labels beneath, an even pitch of ~128 crowded into the
 * middle of a 600-wide band. They now run on a true 144 pitch centred on the
 * card, 36 pixels clear of the band at either end, lifted 20 pixels, with the
 * labels gone.
 *
 * The value is what fills the space that bought. Its scale is picked from the
 * widest of the four numbers and then used for all four, because two sizes in
 * one row reads as a mistake rather than as fitting. Unlike the move names it
 * can be fitted per card: a number is its own label, so a 137 drawn smaller
 * than an 8 beside it is still the only thing it could be.
 */
const STAT_X = [130, 274, 418, 562];
const STAT_CY = 651;
/** Column pitch (144) less padding, so neighbouring numbers cannot touch. */
const STAT_MAX_W = 132;
const STAT_SCALES = [7, 6, 5, 4];

/**
 * Three rows, each a badge then a name, reading left to right.
 *
 * Three, not four, because a companion carries three moves. What replaced the
 * fourth slot is Rally and Mend — free to every companion, once each per
 * battle, carried by none — and a card prints what this creature IS, not what
 * everything can do. `orderedMoves` slices to `SLOTS.length`, so a record from
 * before the change shows the first three rather than overflowing the box.
 *
 * This replaced a 2x2 grid, and the reason was width. Two columns split the
 * 549-wide interior in half, so a name had ~180 and the longest words in the
 * pools ("ADRENALINE", "REGENERATE") were 177 of it at the smallest size worth
 * drawing — the panel could not be made bigger, only bolder. One move per row
 * gives the name 434 instead, which fits every name in the pools on ONE line
 * at more than twice the height the 2x2 grid could manage.
 *
 * The card is 693x968: 63 by 88 EXACTLY, eleven pixels to the millimetre, the
 * size Magic and Pokemon print at. Those two numbers are coprime, so whole
 * multiples of 63x88 are the only pixel-exact sizes that exist — 693x968 is
 * the smallest one this card's content fits in. It is NOT 2.5x3.5 inches;
 * that is a different standard by 0.23%.
 *
 * It is also symmetric to the pixel across its centre line, which needed the
 * box interior and the window hole to be the same width AND the same parity as
 * the card. Check both if you change any width here.
 *
 * Interior y 680-914, three rows of 78 from the top — 312 of the 313 there is,
 * because the box was cut down to the rows rather than the rows spaced out to
 * fill the box. The badge is centred in its row and the name on the same line.
 *
 * The badges are drawn at their full 78x75. There is no size between that and
 * 52x50: they are 26x25 art pixels at 3x, so 2x is the only other whole-block
 * reduction, and they have no transparent margin to crop either.
 */
const BADGE_W = ICON_W;
const BADGE_H = ICON_H;
/**
 * 78, not the 84 the interior would divide into: the badges read as one column
 * when they nearly touch, and as four loose stickers when they are evenly
 * spaced down the box. Three pixels between them, and the slack it leaves
 * gathers at the bottom of the box rather than between the rows.
 */
const ROW_H = 78;
const SLOTS = [0, 1, 2].map((row) => {
  const top = 693 + row * ROW_H;
  return {
    iconX: 82,
    iconY: top + Math.round((ROW_H - BADGE_H) / 2),
    textX: 168,
    textW: 452,
    align: 'left',
    cy: top + Math.round(ROW_H / 2),
  };
});

const INK = {
  /** On the gold level coin. */
  level: [60, 34, 18, 255],
  /** On the red stats band and the orange banner. */
  light: [255, 255, 255, 255],
  /** Dropped a pixel down-right so white survives the orange it sits on. */
  shadow: [40, 14, 10, 200],
};

/** Ink for the extended panel, which is a dark plum field in a copper frame. */
const PANEL_INK = {
  title: [217, 160, 102, 255],
  rule: [217, 160, 102, 180],
  text: [246, 238, 232, 255],
  faint: [186, 158, 172, 255],
  good: [126, 205, 132, 255],
  bad: [226, 118, 118, 255],
  trough: [38, 22, 34, 255],
  energy: [255, 171, 25, 255],
  happy: [236, 110, 180, 255],
  exp: [154, 124, 226, 255],
};

/**
 * Satchel art, by item id.
 *
 * The same mapping `src/ui/art.ts` uses, repeated here because this module has
 * to run in the worker, where there is no React and no bundler — and because
 * the card is composited from the process's record, not from whatever the
 * screen happened to have loaded.
 */
const ITEM_ART = {
  air_berry: 'art/berry-air.png',
  water_berry: 'art/berry-water.png',
  fire_berry: 'art/berry-fire.png',
  rock_berry: 'art/berry-rock.png',
  scroll: 'art/scroll.png',
};

/** The order the satchel reads in, so a card is not a hash-order lottery. */
const ITEM_ORDER = [
  'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'scroll',
];

const ELEMENTS = new Set(['fire', 'water', 'air', 'rock']);

/** Blit a whole plate at the origin. */
/**
 * Blit a whole plate.
 *
 * `INSET` is why this takes an offset at all. The card gained two pixels of
 * border on each side, and only the FRAME was rewidened to 652 — every other
 * full-card plate is still the 648 it was authored at, so they are drawn
 * across and the frame is drawn at the origin. Two more went on when the
 * frame's lean was corrected: its inner band was 18 left against 21 right, so
 * two columns moved from one side to the other and the whole interior with
 * them. Every interior coordinate in this file is therefore four further
 * right than the art it was measured off — four from the widening, and five
 * more from equalising the inner band at 22 a side and adding two of outer
 * border, which put the card on bridge-card proportions at 662x1030.
 */
const INSET = 25;
/** How far the window's contents hang above where they were authored. */
const WINDOW_LIFT = -5;
/**
 * The monster rides higher than its scenery.
 *
 * Only the PORTRAIT moves: the background is the horizon and moving it with
 * the creature just re-frames the same picture. Lifting the creature alone
 * puts more sky over its head and settles it lower in the window, which is
 * where a card wants its subject.
 */
const PORTRAIT_LIFT = WINDOW_LIFT - 8;
const plate = (asset, dx = INSET) => ({ op: 'image', asset, dx, dy: 0 });

/**
 * Text as filled rectangles.
 *
 * `align` is 'center' about `x`, or 'left' from it. The shadow is emitted first
 * so the ink lands on top, and it is offset by exactly one font pixel (`scale`)
 * so it stays on the pixel grid.
 */
function text(ops, string, { x, y, scale, color, align = 'center', shadow = true, face = FACES.wide }) {
  const width = measure(string, scale, face);
  const left = align === 'center' ? Math.round(x - width / 2) : x;
  const top = Math.round(y - lineHeight(scale, face) / 2);
  // One font pixel down-right, on whichever axis the scale gives — a stretched
  // face would otherwise cast a shadow that does not match its own grid.
  const dx = typeof scale === 'number' ? scale : scale.x;
  const dy = typeof scale === 'number' ? scale : (scale.y ?? scale.x);
  if (shadow) {
    ops.push({ op: 'rects', rects: glyphRects(string, left + dx, top + dy, scale, face), color: INK.shadow });
  }
  ops.push({ op: 'rects', rects: glyphRects(string, left, top, scale, face), color });
}

/**
 * The three moves, in the order the card shows them: RAREST FIRST.
 *
 * The top row is the thing worth looking at. A roster's rarity-1 move is about
 * a one-in-twenty draw, and burying it under an alphabetically earlier common
 * meant the one fact that makes a card worth keeping was wherever the alphabet
 * put it. Rarity leads; element leads within a tier, because the art calls the
 * top row the signature row; the name breaks the remaining ties.
 *
 * The engine has no slot ORDER — a roster is a map keyed by name — so this is
 * purely how it is read, and nothing downstream of it changes.
 *
 * Deterministic, and it has to be: `rollMoves` sorts its candidate names before
 * drawing so a seed reproduces a roll, and sorting here means one monster
 * always produces one card, which matters when the card is about to be signed.
 * Every term in the comparison is a fact about the move rather than about the
 * fighter, so it cannot move between the preview and the mint.
 *
 * A move with no `rarity` sorts as the common tier. That is the compact stored
 * form, `{ count }` and nothing else, which is what a record carries before
 * `hydrateMoves` joins it against `catalog.movePools` — on that path every move
 * ties and the order falls back to what it was before, element then name.
 */
export function orderedMoves(monster) {
  const entries = Object.entries(monster?.moves ?? {}).map(([name, move]) => ({
    name: move?.name ?? name,
    type: move?.type ?? 'normal',
    rarity: Number.isFinite(move?.rarity) ? move.rarity : 3,
  }));
  const element = (m) => (ELEMENTS.has(m.type) ? 0 : 1);
  entries.sort((a, b) => (
    a.rarity - b.rarity
    || element(a) - element(b)
    || a.name.localeCompare(b.name)
  ));
  return entries.slice(0, SLOTS.length);
}

/**
 * Break a move name into the lines its slot will draw, at `MOVE_SCALE`.
 *
 * The scale is FIXED and not fitted. A per-card fit is what a naive pass does,
 * and it means the same move is drawn at two different sizes on two cards,
 * depending on what else was rolled beside it — the size stops meaning
 * anything and the panel looks unfinished. Scale 3 is the largest that fits
 * every name in the pools in two lines at the current column width
 * ("ADRENALINE" and "REGENERATE", the longest words, are 177 of the 180).
 *
 * The fallback truncates rather than overflowing into the neighbouring slot,
 * because a card that bleeds is worse than a card that abbreviates. Nothing in
 * the pools reaches it; an admin-written move can.
 */
/**
 * The candidates for the panel, each with the largest size its own grid can
 * draw the pools at. Flip `MOVE_FACE` to compare them on a real card.
 *
 * The ceiling is always the same word: "ADRENALINE" and "REGENERATE" are ten
 * letters and a name has 180 pixels, so whatever is chosen has to draw ten
 * letters in 180. That is what each of these does differently.
 *
 *   wide     5 columns at 3 — 15x21 letters, ten of them 177 wide. The plain
 *            card face, and as large as a square scale can go.
 *   heavy    the same face and the same 3 columns, stretched to 4 rows and
 *            with every stroke a pixel wider: 16x28, ten of them 179 wide. A
 *            third taller and visibly bolder in the room 15x21 already had.
 *   huge     the end of that road: 5 rows and two pixels of weight, 17x35,
 *            ten of them 179 of the 180. Nothing larger FITS.
 *   book     what the move box takes, and the only one on a 6x9 grid: 30x45
 *            letters with 4 between them. The longest name in the pools is
 *            now "LIGHTNING BOLT" at 452 of the row's 452, tied with
 *            "MOMENTUM SHIFT".
 *
 *            It is this size because three moves were renamed for it. One
 *            name out of forty-two used to set the type size for all of them
 *            — "WARRIOR'S RESOLVE" filled the row to the pixel while the
 *            median name used half of it — so Iron Will, Adrenal Rush and
 *            Stone Barrier bought every card a quarter more type. If a new
 *            move is ever longer than LIGHTNING BOLT, this is what it costs. It is also the only face spaced PROPORTIONALLY —
 *            each glyph advances by the width it inks, so an apostrophe stops
 *            reserving as much room as a W. That is worth 24 pixels on the
 *            longest name, which is the whole difference between 3 of air
 *            between letters and 4. Every other entry here is the 5x7 face stretched to
 *            fill a height it was not drawn for, which is why they read as
 *            squashed — 20 wide by 42 tall is a ratio of 0.48 against real
 *            capitals' 0.7. This one is 0.667 because its grid is, and the
 *            nine rows are what let an S have a spine.
 *
 *            It cannot be made larger. Seventeen characters have to fit 457
 *            pixels, so a letter gets 26 of them including its gap, full
 *            stop; the next size up needs 570. Bigger type means shorter
 *            names or a bigger card, not a different font.
 *   row      the previous best: 21x42 with SIX pixels between the
 *            letters, which is where the row's width went. Five-column
 *            letters were tried and reverted: at 25 across they only fit with
 *            2 pixels of air and read as one continuous word. Four columns
 *            with a wide gap is the more legible half of that trade — the
 *            letters are what they were, the space around them is not.
 *            "WARRIOR'S RESOLVE" is 437 of the row's 446, and 6 is the widest
 *            gap that fits — 7 would be 453. The HEIGHT is the free axis, so
 *            it carries the proportion: 20 wide by 49 tall read as stretched,
 *            and 42 is the same width at a shape that looks like type.
 *   narrow   the same row at 4 columns and a proper gap: 22x49, 406 wide.
 *            Fits comfortably and reads condensed, which is what it is.
 *   wider    a fourth column, 21x35, which does not fit and is drawn anyway:
 *            ten letters is 236 against 180, so the longest names run over
 *            the badges in the middle of the panel. This is a look-at-it
 *            setting, not a finished one — the two real fixes are smaller
 *            badges (hand art; they are 78x75 and off the 4x grid, so they
 *            cannot be shrunk in code without mangling) or move names with no
 *            word over seven letters, which fits 164 in the 180 with room to
 *            spare. Eleven of the forty-two names break that rule today.
 *   slim     3 columns at 4 — 12x28, ten of them 156 wide. Also a third
 *            taller, but it buys that with a narrower grid, and a 3-wide grid
 *            cannot draw an honest M or W.
 */
const MOVE_FACES = {
  wide: { face: FACES.wide, scale: 3 },
  heavy: { face: FACES.wide, scale: { x: 3, y: 4, bold: 1 } },
  huge: { face: FACES.wide, scale: { x: 3, y: 5, bold: 2 } },
  wider: { face: FACES.wide, scale: { x: 4, y: 5, bold: 1 } },
  row: { face: FACES.wide, scale: { x: 4, y: 6, bold: 1, track: 6 } },
  book: { face: FACES.book, scale: { x: 5, y: 5, track: 4 } },
  narrow: { face: FACES.wide, scale: { x: 4, y: 7, bold: 2 } },
  light: { face: FACES.wide, scale: { x: 5, y: 7, bold: 0, track: 1 } },
  slim: { face: FACES.slim, scale: 4 },
};
const MOVE_FACE = MOVE_FACES.book;
const MOVE_SCALE = MOVE_FACE.scale;

function moveNameLines(name, width) {
  const lines = wrap(name, width, MOVE_SCALE, 2, MOVE_FACE.face);
  if (lines) return lines;

  /*
   * A name too wide for its column overflows rather than being cut, and it
   * overflows one WORD at a time.
   *
   * The distinction is the whole behaviour. Re-wrapping the name against the
   * full panel puts "ADRENALINE SURGE" on one long line, which runs clean
   * through the badges and into the name in the other column — two names on
   * top of each other, which is worse than either problem it solves. Breaking
   * at the column and letting only the oversized word hang over keeps every
   * line starting where it should: "ADRENALINE" laps onto the badges,
   * "SURGE" sits in its column, and the other column is untouched.
   */
  const words = String(name).toUpperCase().split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate, MOVE_SCALE, MOVE_FACE.face) <= width) {
      line = candidate;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.slice(0, 2);
}

/** A section heading with its rule, as the original drew them. */
function panelTitle(ops, string, x, y, width) {
  text(ops, string, {
    x, y: y + lineHeight(4) / 2, scale: 4, color: PANEL_INK.title, align: 'left', shadow: false,
  });
  const ruleY = y + lineHeight(4) + 8;
  ops.push({ op: 'rects', rects: [[x, ruleY, Math.round(width * 0.9), 3]], color: PANEL_INK.rule });
  return ruleY + 14;
}

/**
 * How many times a move can be used in one fight, when nothing says otherwise.
 *
 * `Battle.TUNING.moveUses` in backend/native/battle.lua, which multiplies the
 * stored `count` at the start of every fight. The card printed the stored 3
 * while the arena — and every other reading of the same move — printed the 9
 * you actually get, which read as two different moves. Callers that can reach
 * the live tuning pass it in; the mint worker takes this, because it is the
 * engine's own default and a card is drawn once.
 */
const MOVE_USES = 3;

/** `X2  5 DMG  +3 ATK  -1 DEF` — what the badge on the card cannot say. */
function moveRiders(move, moveUses) {
  const parts = [];
  const uses = Math.max(1, Math.round(Number(moveUses) || MOVE_USES));
  const count = Math.round(Number(move.count) || 0) * uses;
  if (count > 0) parts.push({ s: `X${count}`, ink: PANEL_INK.faint });
  const damage = Math.round(Number(move.damage) || 0);
  if (damage > 0) parts.push({ s: `${damage} DMG`, ink: PANEL_INK.bad });
  for (const [key, short] of [['attack', 'ATK'], ['defense', 'DEF'], ['speed', 'SPD'], ['health', 'HP']]) {
    const value = Math.round(Number(move[key]) || 0);
    if (value !== 0) {
      parts.push({
        s: `${value > 0 ? '+' : '-'}${Math.abs(value)} ${short}`,
        ink: value > 0 ? PANEL_INK.good : PANEL_INK.bad,
      });
    }
  }
  return parts;
}

/** One labelled meter: trough, fill, and the numbers on the right. */
function meter(ops, { x, y, w, label: name, value, max, color }) {
  const safeMax = Math.max(1, Math.round(Number(max) || 0));
  const safe = Math.max(0, Math.min(safeMax, Math.round(Number(value) || 0)));
  text(ops, name, {
    x, y: y + lineHeight(2) / 2, scale: 2, color: PANEL_INK.faint, align: 'left', shadow: false,
  });
  const right = `${safe}/${safeMax}`;
  text(ops, right, {
    x: x + w - measure(right, 2), y: y + lineHeight(2) / 2, scale: 2,
    color: PANEL_INK.text, align: 'left', shadow: false,
  });
  const barY = y + lineHeight(2) + 6;
  ops.push({ op: 'rects', rects: [[x, barY, w, 14]], color: PANEL_INK.trough });
  const fill = Math.round((w * safe) / safeMax);
  if (fill > 0) ops.push({ op: 'rects', rects: [[x, barY, fill, 14]], color });
  return barY + 14 + 16;
}

/**
 * The extended panel: moves in full, the meters, and the satchel.
 *
 * The original drew these three sections in this order and this is a faithful
 * port of that decision, not of its code — that version themed itself at
 * runtime with gradients, drop shadows and a light mode, none of which belong
 * on pixel art that has to composite identically in a browser and in a worker.
 */
function extendedOps(ops, monster, inventory, moveUses) {
  ops.push({ op: 'image', asset: 'Monsters/cards/Side Background.png', dx: PANEL.dx, dy: 0 });

  const x = PANEL.x + PANEL.pad;
  const w = PANEL.w - PANEL.pad * 2;
  let y = PANEL.y + 34;

  // The faction, first, because it is the one thing about a companion that is
  // not on the card face anywhere — the element plate says fire, not which of
  // the fire factions this trainer swore to. It used to be a line of grey text
  // under the card in the app, which is a fact about the companion printed
  // beside the drawing of the companion rather than on it.
  // Not through `label()`: the TEST- prefix belongs on names this pipeline
  // MINTS, and the faction is a fact about the record, like the element plate.
  const faction = String((monster && monster.faction) || '').trim();
  if (faction) {
    y = panelTitle(ops, 'FACTION', x, y, w);
    const lines = wrap(faction, w, 3, 2) || wrap(faction, w, 2, 2) || [faction];
    for (const line of lines) {
      text(ops, line, {
        x, y: y + lineHeight(3) / 2, scale: 3, color: PANEL_INK.text, align: 'left', shadow: false,
      });
      y += lineHeight(3) + 4;
    }
    y += 24;
  }

  y = panelTitle(ops, 'MOVES', x, y, w);
  for (const entry of orderedMoves(monster)) {
    const move = (monster && monster.moves && monster.moves[entry.name]) || {};
    const lines = wrap(entry.name, w, 3, 1) || wrap(entry.name, w, 2, 1) || [entry.name];
    text(ops, lines[0], {
      x, y: y + lineHeight(3) / 2, scale: 3, color: PANEL_INK.text, align: 'left', shadow: false,
    });
    y += lineHeight(3) + 6;

    // Riders are laid out by hand rather than joined into one string: each is
    // coloured by its sign, and one string can only carry one colour.
    let rx = x;
    for (const part of moveRiders(move, moveUses)) {
      const width = measure(part.s, 2);
      if (rx + width > x + w) break;
      text(ops, part.s, {
        x: rx, y: y + lineHeight(2) / 2, scale: 2, color: part.ink, align: 'left', shadow: false,
      });
      rx += width + 14;
    }
    y += lineHeight(2) + 20;
  }

  y += 10;
  y = panelTitle(ops, 'STATUS', x, y, w);
  y = meter(ops, { x, y, w, label: 'ENERGY', value: monster && monster.energy, max: 100, color: PANEL_INK.energy });
  y = meter(ops, { x, y, w, label: 'HAPPINESS', value: monster && monster.happiness, max: 100, color: PANEL_INK.happy });
  y = meter(ops, {
    x, y, w, label: 'EXPERIENCE',
    value: monster && monster.exp, max: (monster && monster.nextLevelExp) || 1, color: PANEL_INK.exp,
  });

  y += 8;
  y = panelTitle(ops, 'SATCHEL', x, y, w);
  const held = ITEM_ORDER
    .map((id) => ({ id, n: Math.round(Number(inventory && inventory[id]) || 0) }))
    .filter((item) => item.n > 0);

  if (!held.length) {
    text(ops, 'EMPTY', {
      x, y: y + lineHeight(2) / 2, scale: 2, color: PANEL_INK.faint, align: 'left', shadow: false,
    });
  } else {
    // 48px icons, five to a row, with the count under each.
    const cell = 66;
    held.slice(0, 10).forEach((item, i) => {
      const cx = x + (i % 5) * cell;
      const cy = y + Math.floor(i / 5) * (48 + 22);
      ops.push({ op: 'image', asset: ITEM_ART[item.id], dx: cx, dy: cy });
      text(ops, `X${item.n}`, {
        x: cx + 24, y: cy + 48 + 8, scale: 2, color: PANEL_INK.text, shadow: false,
      });
    });
    y += Math.ceil(Math.min(held.length, 10) / 5) * (48 + 22);
  }

  const runes = Math.round(Number(inventory && inventory.rune) || 0);
  if (runes > 0) {
    // Runes have no drawing in the art repo — the app shows them with a UI
    // icon, and a UI icon is not art and does not belong on a minted card.
    text(ops, `RUNES  ${runes}`, {
      x, y: y + 12 + lineHeight(2) / 2, scale: 2, color: PANEL_INK.faint, align: 'left', shadow: false,
    });
  }
}

/** The size a plan will paint to, without building the plan. */
export function cardSize(opts) {
  const extended = Boolean(opts && opts.extended);
  return { width: extended ? CARD_W + PANEL_W : CARD_W, height: CARD_H };
}

/**
 * Everything needed to draw one monster's card.
 *
 * `monster` is the record the process publishes — see `Monster` in
 * lib/types.ts. Asset paths are relative to `src/assets/`; each painter
 * resolves them its own way, because a bundler and a filesystem disagree about
 * what a path is.
 *
 * `opts.extended` widens the card and adds the side panel; `opts.inventory` is
 * the player's satchel, which only the extended card shows. A plan carries its
 * own size, because the two modes are different shapes and a painter that
 * assumed 648 would silently clip the panel off.
 */
export function cardPlan(monster, opts = {}) {
  const element = ELEMENTS.has(monster && monster.elementType) ? monster.elementType : 'fire';
  const art = ART_ELEMENT[element];
  const level = Math.max(0, Math.round(Number(monster && monster.level) || 0));
  const ops = [];

  // The window lost 10 rows off its TOP, and the plates behind it are still
  // the full-height originals — so they are hung 15 higher, which crops the
  // sky rather than the ground the monster is standing on.
  ops.push({
    ...plate(opts.backgroundAsset || `Monsters/cards/1-backgrounds/Background ${art}.png`),
    dy: WINDOW_LIFT,
  });
  const numberedPortrait = monsterIndexPortrait(monster && monster.entryNo);
  if (opts.portraitAsset || numberedPortrait) {
    // Studio portraits are normalized to the authoring spec's 320x448 canvas.
    // Its bottom aligns with the card window and leaves symmetric side room.
    // Placed FROM the window rather than at numbers of its own, so the two
    // cannot drift: centred across it, standing `floor` above its bottom.
    ops.push({
      op: 'image', asset: opts.portraitAsset || numberedPortrait,
      dx: WINDOW.x + Math.round((WINDOW.w - PORTRAIT_CANVAS.w) / 2),
      dy: WINDOW.y + WINDOW.h - PORTRAIT_CANVAS.h - PORTRAIT_CANVAS.floor,
    });
  } else {
    ops.push({ ...plate(portraitPlate(art)), dy: PORTRAIT_LIFT });
  }
  ops.push(plate(`Monsters/cards/2-cards-frame/Frame ${art}.png`, 0));
  ops.push(plate(`Monsters/cards/3-elements-type/${art} Type.png`));
  ops.push(plate(`Monsters/cards/4-levels/Lvl ${art}.png`));

  // As large as the coin's clear middle takes: two digits at 5, three at 4.
  const levelText = String(level);
  const levelScale = measure(levelText, 5) <= LEVEL_COIN.maxWidth ? 5 : 4;
  text(ops, levelText, {
    x: LEVEL_COIN.cx, y: LEVEL_COIN.cy, scale: levelScale, color: INK.level, shadow: false,
  });

  // The nameplate PNGs are skipped on purpose: they bake ZEPHOUND / AQUANINE /
  // IGNISFANG / TERRABARK, and the process names its monsters otherwise.
  const name = label((monster && monster.name) || '');
  const nameScale = measure(name, 5) <= NAME_BAND.maxWidth ? 5 : 4;
  text(ops, name, { x: NAME_BAND.cx, y: NAME_BAND.cy, scale: nameScale, color: INK.light });

  const stats = (monster
    ? [monster.attack, monster.speed, monster.defense, monster.health]
    : [0, 0, 0, 0]).map((value) => String(Math.round(Number(value) || 0)));
  const widest = stats.reduce((a, b) => (b.length > a.length ? b : a), '');
  const statScale = STAT_SCALES.find((s) => measure(widest, s) <= STAT_MAX_W)
    ?? STAT_SCALES[STAT_SCALES.length - 1];
  stats.forEach((value, i) => {
    text(ops, value, {
      x: STAT_X[i], y: STAT_CY, scale: statScale, color: INK.light, shadow: false,
    });
  });

  const moves = orderedMoves(monster);

  // Every badge first, then every name — so a name that overflows its column
  // lands ON the badges rather than under whichever one happens to be drawn
  // after it. Interleaved, slot 0's name went under slot 1's badge and slot
  // 1's did not, which reads as a rendering fault rather than as a tight fit.
  moves.forEach((move, i) => {
    const slot = SLOTS[i];
    const icon = moveIcon(move.name);
    if (!icon) return;
    ops.push({
      op: 'image',
      asset: icon.asset,
      sx: icon.sx,
      sy: icon.sy,
      sw: icon.sw,
      sh: icon.sh,
      dx: slot.iconX,
      dy: slot.iconY,
    });
  });

  moves.forEach((move, i) => {
    const slot = SLOTS[i];
    const scale = MOVE_SCALE;
    const lines = moveNameLines(move.name, slot.textW);
    const gap = typeof scale === 'number' ? scale : scale.x;
    const face = MOVE_FACE.face;
    const block = lines.length * lineHeight(scale, face) + (lines.length - 1) * gap;
    let y = slot.cy - block / 2 + lineHeight(scale, face) / 2;
    for (const line of lines) {
      // `textX` is the edge the name is anchored to: the left one in a column
      // that reads outward from the frame, the right one in a mirrored column
      // that reads back toward the badges in the middle.
      const x = slot.align === 'right'
        ? slot.textX - measure(line, scale, MOVE_FACE.face)
        : slot.textX;
      text(ops, line, { x, y, scale, color: INK.light, align: 'left', face: MOVE_FACE.face });
      y += lineHeight(scale) + gap;
    }
  });

  if (opts.extended) extendedOps(ops, monster, opts.inventory, opts.moveUses);

  const size = cardSize(opts);
  return { width: size.width, height: size.height, ops };
}

/** Every image a card can reference, so a painter can preload before drawing. */
export function assetsFor(ops) {
  return [...new Set(ops.filter((o) => o.op === 'image').map((o) => o.asset))];
}
