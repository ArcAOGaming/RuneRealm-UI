import { FRAMES, SHEET_SIZE } from './spriteAtlas';
import { recolour } from './colorize';
import type { CharacterOutfit, CharacterPiece } from './types';

/**
 * The character creator's layer art.
 *
 * The old customiser fetched `/assets/<Folder>/index.json` at runtime and
 * guessed at `none.png` when that 404'd. The art lives in `src/assets/`, not
 * `public/`, so Vite can enumerate it at BUILD time instead: every layer is
 * hashed, bundled and present or the build fails. A missing file becomes a
 * broken build rather than a broken avatar in front of a player.
 *
 * Everything below is drawing only — no wallet, no process, no network.
 */

/** One thing you can put on a character. `None` is a real option, not absence. */
export type LayerOption = {
  /** As it appears in the picker: "Long", "Beanie", "None". */
  name: string;
  /** The bundled URL Vite resolved for it. */
  url: string;
};

export type LayerCategory = {
  /** "Hair", "Hat", … — also the folder, and the key in an `Outfit`. */
  name: CategoryName;
  options: LayerOption[];
};

/**
 * The body every character is drawn on top of.
 *
 * Not a category and not optional: with all six categories set to `None` — the
 * state a new character starts in — every layer is transparent, so without this
 * the creator renders a perfectly empty box. That is exactly what it did.
 *
 * It is also the one layer that is never recoloured. The body is drawn in skin
 * tones, not in the five greys the garments use, so the tint would find nothing
 * to work on; and a hue slider over somebody's skin is not a control this game
 * needs.
 *
 * Despite the extension this file is a WebP, as are `Beanie`, `T-shirt` and
 * `Dress-pants`. Browsers sniff the content and load them regardless, so it is
 * a naming wart rather than a bug — but anything that reads these bytes
 * directly should not trust the extension.
 */
import BASE_URL from '../assets/BASE.png?url';

/**
 * Draw order, bottom to top, and it is a different list from the picker order.
 *
 * Trousers over shoes, shirt over trousers, hair over the shirt collar, hat
 * over the hair. The old `SPRITE_CATEGORIES` order was a menu, not a z-order,
 * and compositing in it puts a shirt on top of somebody's hair.
 */
const DRAW_ORDER = ['Shoes', 'Pants', 'Shirt', 'Gloves', 'Hair', 'Hat'] as const;

/** The order the picker lists categories in. */
const ORDER = ['Hair', 'Hat', 'Shirt', 'Pants', 'Gloves', 'Shoes'] as const;
export type CategoryName = (typeof ORDER)[number];

// Eager so the URLs are plain strings at module load. These are six folders of
// small PNGs, not something worth code-splitting.
//
// One flat pattern, filtered below, rather than a `{Hair,Hat,...}` brace: the
// brace form matched NOTHING here, which is a silent failure — `CATEGORIES`
// came out empty, the build succeeded, and the creator would have rendered a
// picker with no options in it. A pattern that over-matches and is narrowed in
// code cannot fail that way.
const FILES = import.meta.glob<string>(
  '../assets/*/*.png',
  { eager: true, query: '?url', import: 'default' },
);

/** "../assets/Hair/Long.png" -> { category: "Hair", name: "Long" } */
function parse(path: string): { category: string; name: string } | null {
  const m = path.match(/\/assets\/([^/]+)\/([^/]+)\.png$/);
  return m ? { category: m[1], name: m[2] } : null;
}

/**
 * Every category, in draw order, each with `None` first and the rest sorted.
 *
 * `None` is pinned to the front rather than sorted into place because it is the
 * default and the way back out of a choice, and a picker that hides it halfway
 * down an alphabetical list is a picker people get stuck in.
 *
 * Every other label is the filename, which is why the two hair options are
 * `Short` and `Long` rather than the `Boy` and `Girl` the art shipped as. A
 * haircut is a haircut; the sprite does not change according to who picks it,
 * and asking somebody to choose a gender in order to choose a fringe is a
 * question this screen has no reason to ask. Renaming the files rather than
 * mapping the labels in code keeps one source of truth — a mapping table is a
 * second place to forget.
 */
export const CATEGORIES: LayerCategory[] = ORDER.map((category) => {
  const options: LayerOption[] = [];
  for (const [path, url] of Object.entries(FILES)) {
    const parsed = parse(path);
    if (parsed?.category === category) options.push({ name: parsed.name, url });
  }
  options.sort((a, b) => {
    const an = a.name.toLowerCase() === 'none';
    const bn = b.name.toLowerCase() === 'none';
    if (an !== bn) return an ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { name: category, options };
}).filter((c) => c.options.length > 0);

if (CATEGORIES.length !== ORDER.length) {
  // Every category has art in `src/assets/`. If one resolved to nothing the
  // glob has stopped matching — a build-tool change, or the art moved — and the
  // symptom is an empty picker rather than an error. Say so.
  const missing = ORDER.filter((o) => !CATEGORIES.some((c) => c.name === o));
  console.error(
    `[sprites] no layer art found for: ${missing.join(', ')}. ` +
    'The character creator will be missing these categories.',
  );
}

// The outfit --------------------------------------------------------------

export type Piece = CharacterPiece;
export type Outfit = CharacterOutfit;

export const isNone = (style: string) => style.toLowerCase() === 'none';

/**
 * Where a fresh character's colours start.
 *
 * Not white, and not the raw grey. `#ffffff` was the parked customiser's
 * default, and it flattens the ladder against its own ceiling — the top three
 * rungs all clip to white and the garment loses its highlight before anyone has
 * touched a control. These are mid-tone, so every rung has room both ways, and
 * they are chosen to look like clothes rather than like a palette: brown hair,
 * indigo cap, a slate shirt, oxblood boots.
 */
const DEFAULT_COLOURS: Record<CategoryName, string> = {
  Hair: '#6b4a2f',
  Hat: '#3f4d80',
  Shirt: '#4a6c8c',
  Pants: '#4a4f5e',
  Gloves: '#6b5a46',
  Shoes: '#5c3a30',
};

/** Everything set to `None` — where a new character starts. */
export function emptyOutfit(): Outfit {
  const out = {} as Outfit;
  for (const c of CATEGORIES) {
    const none = c.options.find((o) => isNone(o.name));
    out[c.name] = {
      style: none?.name ?? c.options[0].name,
      color: DEFAULT_COLOURS[c.name] ?? '#8a8f9c',
    };
  }
  return out;
}

/**
 * Something on, in colours that go together.
 *
 * Not six independent random hex values: that is what the parked customiser
 * did and it reliably produced a lime hat over a magenta coat. One hue is
 * rolled and the garments are spread around the wheel from it, so a shuffle
 * lands on an outfit rather than on confetti.
 */
export function randomOutfit(): Outfit {
  const base = Math.random() * 360;
  const spread = [0, 172, 28, 200, 14, 340];
  const out = {} as Outfit;
  CATEGORIES.forEach((c, i) => {
    const wearable = c.options.filter((o) => !isNone(o.name));
    const pick = wearable.length && Math.random() < 0.82
      ? wearable[Math.floor(Math.random() * wearable.length)]
      : c.options.find((o) => isNone(o.name)) ?? c.options[0];
    out[c.name] = {
      style: pick.name,
      color: hsl(
        (base + spread[i % spread.length]) % 360,
        0.28 + Math.random() * 0.34,
        0.30 + Math.random() * 0.26,
      ),
    };
  });
  return out;
}

/** `hsl` in 0..1 saturation/lightness, out as `#rrggbb`. */
export function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function urlFor(category: string, option: string): string | null {
  const c = CATEGORIES.find((x) => x.name === category);
  return c?.options.find((o) => o.name === option)?.url ?? null;
}

/**
 * Whether nothing has been put on.
 *
 * No longer a reason to refuse a publish — the body renders on its own and a
 * bare character is a legitimate choice — but the button can still say so.
 */
export function isBare(outfit: Outfit): boolean {
  return Object.values(outfit).every((p) => isNone(p.style));
}

// Drawing -----------------------------------------------------------------

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function load(url: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(url);
  if (existing) return existing;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

/**
 * One layer, tinted, as a canvas ready to be drawn.
 *
 * Cached on url + colour. The wardrobe recomposites the whole sheet on every
 * step of a colour drag, and only one layer has actually changed; without this
 * the other five are re-read and re-tinted sixty times a second for nothing.
 *
 * The cache is bounded because the key space in practice is small — six
 * garments and whatever colours one session touches — but it is trimmed anyway
 * rather than left to grow for as long as the tab is open.
 */
const tinted = new Map<string, HTMLCanvasElement>();
const TINT_CACHE_MAX = 96;

async function layer(url: string, color: string | null): Promise<CanvasImageSource> {
  const img = await load(url);
  if (!color) return img;

  const key = `${url}|${color}`;
  const hit = tinted.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || SHEET_SIZE.w;
  canvas.height = img.naturalHeight || SHEET_SIZE.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return img;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolour(pixels.data, color);
  ctx.putImageData(pixels, 0, 0);

  if (tinted.size >= TINT_CACHE_MAX) {
    // Oldest first; a Map iterates in insertion order.
    const oldest = tinted.keys().next();
    if (!oldest.done) tinted.delete(oldest.value);
  }
  tinted.set(key, canvas);
  return canvas;
}

/**
 * Composite an outfit onto a canvas, bottom layer first.
 *
 * `imageSmoothingEnabled` is off throughout: this is pixel art, and a browser's
 * default bilinear scaling turns it to mush.
 */
export async function composite(
  outfit: Outfit,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const wanted: { url: string; color: string | null }[] = [{ url: BASE_URL, color: null }];
  for (const name of DRAW_ORDER) {
    const piece = outfit[name];
    if (!piece || isNone(piece.style)) continue;
    const url = urlFor(name, piece.style);
    if (url) wanted.push({ url, color: piece.color });
  }
  await paint(wanted, canvas);
}

/**
 * The body wearing one garment — what a wardrobe tile shows.
 *
 * Composited against the bare body rather than against the rest of the outfit
 * on purpose: a tile has to say what THAT garment is, and a hat tile under a
 * full head of hair mostly shows the hair.
 */
export async function compositeOne(
  category: string,
  style: string,
  color: string,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const wanted: { url: string; color: string | null }[] = [{ url: BASE_URL, color: null }];
  const url = isNone(style) ? null : urlFor(category, style);
  if (url) wanted.push({ url, color });
  await paint(wanted, canvas);
}

async function paint(
  wanted: { url: string; color: string | null }[],
  canvas: HTMLCanvasElement,
): Promise<void> {
  const images = await Promise.all(wanted.map((w) => layer(w.url, w.color)));
  if (!images.length) return;

  // Fixed, not taken from the first image: every layer is a 576x60 sheet and
  // the atlas describes that exact geometry. A layer that is a different size
  // is broken art, and inheriting its dimensions would silently misalign every
  // frame rather than showing up as one wrong-looking layer.
  canvas.width = SHEET_SIZE.w;
  canvas.height = SHEET_SIZE.h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const img of images) ctx.drawImage(img, 0, 0);
}

/**
 * Where a named frame sits on the sheet.
 *
 * Frames come from the atlas rather than a computed grid: the sheet is 12 cells
 * of 48x60, but the 21 animation frames do not map onto them one to one — some
 * names share a cell — so anything that derives a position arithmetically will
 * be subtly wrong for a third of them.
 */
export function frameRect(filename: string) {
  return FRAMES.find((f) => f.filename === filename)?.frame ?? null;
}

/** The whole cell, for a blit that wants the frame exactly as the atlas cut it. */
const FULL_CELL = { x: 0, y: 0, w: 48, h: 60 };

/**
 * The sprite's own bounding box inside the cell.
 *
 * Measured rather than guessed: every garment sheet in `src/assets/` was
 * scanned and nothing in any pose is drawn outside x 5..42, y 11..59 — the
 * widest is a walk frame with the arms out. The rest of the 48x60 cell is the
 * margin the walk cycle needs, and anywhere the character is shown standing
 * still (a wardrobe tile, the four-way strip) that margin is dead space.
 */
export const SPRITE_CROP = { x: 5, y: 10, w: 38, h: 50 };

/**
 * Draw a named frame into an existing context, at a position you choose.
 *
 * For the callers that are composing a scene — the roaming map puts the sprite
 * over a background at map coordinates, the four-way strip packs four of them
 * into one canvas — where `drawFrame`'s "resize the target and fill it" is
 * exactly the wrong shape.
 */
export function blitFrame(
  sheet: CanvasImageSource,
  ctx: CanvasRenderingContext2D,
  filename: string,
  dx: number, dy: number, scale: number,
  crop: { x: number; y: number; w: number; h: number } = FULL_CELL,
): void {
  const frame = frameRect(filename);
  if (!frame) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet,
    frame.x + crop.x, frame.y + crop.y, crop.w, crop.h,
    dx, dy, crop.w * scale, crop.h * scale,
  );
}

/** Draw one named frame from a composited sheet, sized to fit exactly. */
export function drawFrame(
  sheet: HTMLCanvasElement,
  target: HTMLCanvasElement,
  filename: string,
  scale: number,
): void {
  const frame = frameRect(filename);
  if (!frame) return;

  target.width = frame.w * scale;
  target.height = frame.h * scale;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(
    sheet, frame.x, frame.y, frame.w, frame.h,
    0, 0, frame.w * scale, frame.h * scale,
  );
}

/** The frames of one animation, in order — "walk_down" -> its frame names. */
export function framesOf(animation: string): string[] {
  return FRAMES
    .map((f) => f.filename)
    .filter((n) => n.replace(/_\d+\.png$/, '') === animation)
    .sort();
}

/** Which way a character can face in the preview. */
export const FACINGS = ['down', 'left', 'right', 'up'] as const;
export type Facing = (typeof FACINGS)[number];

/**
 * The frame to show for a facing, walking or standing.
 *
 * Falls back to the undirected `idle` set, which is the one animation the atlas
 * guarantees: a sheet re-cut without, say, `idle_up` should show a standing
 * character rather than an empty box.
 */
export function animationFrames(facing: Facing, walking: boolean): string[] {
  const named = framesOf(`${walking ? 'walk' : 'idle'}_${facing}`);
  if (named.length) return named;
  const idle = framesOf(`idle_${facing}`);
  return idle.length ? idle : framesOf('idle');
}
