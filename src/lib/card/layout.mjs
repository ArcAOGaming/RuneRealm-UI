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
 *   stat columns  the four icon discs centre on x 130, 254, 383, 511; their
 *                 labels end at y 737 and the moves panel starts at 777, so the
 *                 values go in the clean red band between
 *   move slots    badges are 78x75 at x 204 / 505, y 789 / 891
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
import { glyphRects, lineHeight, measure, wrap } from './font.mjs';
import { moveIcon } from './moves.mjs';
import { label } from './naming.mjs';

export const CARD_W = 648;
export const CARD_H = 1065;

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
  dx: 522,
  x: 657,
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

const LEVEL_COIN = { cx: 56, cy: 56 };
const NAME_BAND = { cx: 324, cy: 75, maxWidth: 430 };
const STAT_X = [130, 254, 383, 511];
const STAT_CY = 757;

/**
 * Slot order: signature row first, left to right, then the support row.
 *
 * `textW` runs from the text origin to the badge that follows it. The left
 * column gets 141 rather than a rounder 135 because "FIRENADO" at scale 3 is
 * 141 wide to the pixel, and six pixels of padding would have demoted the
 * longest one-word move on the card to half-size text.
 */
const SLOTS = [
  { iconX: 204, iconY: 789, textX: 63, textW: 141, cy: 826 },
  { iconX: 505, iconY: 789, textX: 327, textW: 178, cy: 826 },
  { iconX: 204, iconY: 891, textX: 63, textW: 141, cy: 928 },
  { iconX: 505, iconY: 891, textX: 327, textW: 178, cy: 928 },
];

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
 * screen happened to have loaded. Diamond borrows the topaz gem and both
 * scrolls share one drawing; that is how the app renders them too.
 */
const ITEM_ART = {
  air_berry: 'art/berry-air.png',
  water_berry: 'art/berry-water.png',
  fire_berry: 'art/berry-fire.png',
  rock_berry: 'art/berry-rock.png',
  ruby: 'art/gem-ruby.png',
  emerald: 'art/gem-emerald.png',
  topaz: 'art/gem-topaz.png',
  diamond: 'art/gem-topaz.png',
  scroll: 'art/scroll.png',
  legendary_scroll: 'art/scroll.png',
};

/** The order the satchel reads in, so a card is not a hash-order lottery. */
const ITEM_ORDER = [
  'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'ruby', 'emerald', 'topaz', 'diamond', 'scroll', 'legendary_scroll',
];

const ELEMENTS = new Set(['fire', 'water', 'air', 'rock']);

/** Blit a whole plate at the origin. */
const plate = (asset) => ({ op: 'image', asset, dx: 0, dy: 0 });

/**
 * Text as filled rectangles.
 *
 * `align` is 'center' about `x`, or 'left' from it. The shadow is emitted first
 * so the ink lands on top, and it is offset by exactly one font pixel (`scale`)
 * so it stays on the pixel grid.
 */
function text(ops, string, { x, y, scale, color, align = 'center', shadow = true }) {
  const width = measure(string, scale);
  const left = align === 'center' ? Math.round(x - width / 2) : x;
  const top = Math.round(y - lineHeight(scale) / 2);
  if (shadow) {
    ops.push({ op: 'rects', rects: glyphRects(string, left + scale, top + scale, scale), color: INK.shadow });
  }
  ops.push({ op: 'rects', rects: glyphRects(string, left, top, scale), color });
}

/**
 * The four moves, in the order the card shows them.
 *
 * Element moves take the signature row because that is what the art calls that
 * row. `rollMoves` sorts its candidate names before drawing so a seed
 * reproduces a roll; sorting here too means one monster always produces one
 * card, which matters when the card is about to be signed.
 */
export function orderedMoves(monster) {
  const entries = Object.entries(monster?.moves ?? {}).map(([name, move]) => ({
    name: move?.name ?? name,
    type: move?.type ?? 'normal',
  }));
  const rank = (m) => (ELEMENTS.has(m.type) ? 0 : 1);
  entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return entries.slice(0, SLOTS.length);
}

/**
 * Fit a move name into its slot: two lines at scale 3, else two at scale 2.
 *
 * Every name in the pools fits one of those. The final fallback truncates
 * rather than overflowing into the neighbouring slot, because a card that
 * bleeds is worse than a card that abbreviates.
 */
function moveNameLines(name, width) {
  for (const scale of [3, 2]) {
    const lines = wrap(name, width, scale, 2);
    if (lines) return { lines, scale };
  }
  const scale = 2;
  const fits = Math.max(1, Math.floor((width / scale + 1) / 6));
  return { lines: [String(name).toUpperCase().slice(0, fits)], scale };
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

  ops.push(plate(`Monsters/cards/1-backgrounds/Background ${art}.png`));
  ops.push(plate(portraitPlate(art)));
  ops.push(plate(`Monsters/cards/2-cards-frame/Frame ${art}.png`));
  ops.push(plate(`Monsters/cards/3-elements-type/${art} Type.png`));
  ops.push(plate(`Monsters/cards/4-levels/Lvl ${art}.png`));

  text(ops, String(level), {
    x: LEVEL_COIN.cx, y: LEVEL_COIN.cy, scale: 4, color: INK.level, shadow: false,
  });

  // The nameplate PNGs are skipped on purpose: they bake ZEPHOUND / AQUANINE /
  // IGNISFANG / TERRABARK, and the process names its monsters otherwise.
  const name = label((monster && monster.name) || '');
  const nameScale = measure(name, 5) <= NAME_BAND.maxWidth ? 5 : 4;
  text(ops, name, { x: NAME_BAND.cx, y: NAME_BAND.cy, scale: nameScale, color: INK.light });

  const stats = monster
    ? [monster.attack, monster.speed, monster.defense, monster.health]
    : [0, 0, 0, 0];
  stats.forEach((value, i) => {
    text(ops, String(Math.round(Number(value) || 0)), {
      x: STAT_X[i], y: STAT_CY, scale: 4, color: INK.light,
    });
  });

  // One scale for all four names. Fitting each slot independently is what a
  // naive pass does, and it puts a half-size "FIRENADO" next to a full-size
  // "FLAME SHIELD" on the same card — the eye reads that as a mistake rather
  // than as fitting. The smallest scale any slot needs is the scale they all use.
  const moves = orderedMoves(monster);
  const fitted = moves.map((move, i) => moveNameLines(move.name, SLOTS[i].textW));
  const moveScale = Math.min(...fitted.map((f) => f.scale), 3);

  moves.forEach((move, i) => {
    const slot = SLOTS[i];
    const icon = moveIcon(move.name);
    if (icon) {
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
    }
    const scale = moveScale;
    const lines = wrap(move.name, slot.textW, scale, 2) || fitted[i].lines;
    const gap = scale;
    const block = lines.length * lineHeight(scale) + (lines.length - 1) * gap;
    let y = slot.cy - block / 2 + lineHeight(scale) / 2;
    for (const line of lines) {
      text(ops, line, { x: slot.textX, y, scale, color: INK.light, align: 'left' });
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
