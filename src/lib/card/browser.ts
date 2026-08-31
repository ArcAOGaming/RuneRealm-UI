/**
 * browser.ts — the preview painter.
 *
 * Same ops as the worker (`src/lib/card/layout.mjs`), painted onto a canvas
 * instead of into a byte array. Nothing about the picture is decided here: if
 * this file and `backend/native/card/render.mjs` ever disagree, the layout is
 * not the thing that changed.
 *
 * `imageSmoothingEnabled = false` is not a nicety. The card is 648x1065 and is
 * almost always shown smaller than that, so the browser would resample it into
 * mush and the preview would stop resembling the file that gets signed.
 *
 * Assets come through `import.meta.glob` rather than a computed `new URL(...)`
 * because Vite has to see every asset statically to emit it. The glob is
 * deliberately narrow — `src/assets` also holds the sprite atlases and the
 * marketing renders, and none of that belongs in the bundle.
 */
import { assetsFor, cardPlan } from './layout.mjs';
import type { CardOp, CardOptions } from './layout.mjs';
import type { Monster } from '../types';

export type BrowserCardOptions = CardOptions & {
  /** Dev-studio URLs for authoring assets that are not in the Vite bundle. */
  assetUrls?: Record<string, string>;
};

/**
 * Narrow on purpose, folder by folder.
 *
 * The options object is repeated inline at every call because Vite's glob
 * transform is a static rewrite: it demands an object LITERAL and rejects a
 * shared constant with "Expected the second argument to be an object literal".
 *
 * A single `cards/**` glob also drags in `1-backgrounds/New *.png` and
 * `1-backgrounds/adjust/` — variants nothing composites — which Vite then emits
 * into `dist`, at about 150 KB each. Globs have to be statically analysable, so
 * the only way to exclude them is to not ask for them.
 */
const MODULES = {
  // `Side Background.png` sits loose in `cards/`, not in a numbered folder,
  // so the per-folder globs below all miss it — which failed the extended card
  // with "card asset not bundled" and nothing else.
  ...import.meta.glob('../../assets/Monsters/cards/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/cards/1-backgrounds/Background *.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/cards/2-cards-frame/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/cards/3-elements-type/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/cards/4-levels/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/cards/5-moves/*/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  ...import.meta.glob('../../assets/Monsters/portraits/doge/level-1/*.png', {
    eager: true, query: '?url', import: 'default',
  }),
  // The satchel icons, for the extended card only.
  ...import.meta.glob('../../assets/art/{berry,gem,scroll}*.png', {
    eager: true, query: '?url', import: 'default',
  }),
} as Record<string, string>;

/** '../../assets/Monsters/cards/...' -> 'Monsters/cards/...' */
const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(MODULES).map(([key, url]) => [key.replace('../../assets/', ''), url]),
);

const loaded = new Map<string, Promise<HTMLImageElement>>();

function image(asset: string, overrideUrl?: string): Promise<HTMLImageElement> {
  const url = overrideUrl ?? URLS[asset];
  const cacheKey = `${asset}\u0000${url ?? ''}`;
  let pending = loaded.get(cacheKey);
  if (!pending) {
    if (!url) return Promise.reject(new Error(`card asset not bundled: ${asset}`));
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`card asset failed to load: ${asset}`));
      img.src = url;
    });
    loaded.set(cacheKey, pending);
  }
  return pending;
}

const rgba = ([r, g, b, a]: [number, number, number, number]) =>
  `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;

type PreparedCard = {
  width: number;
  height: number;
  ops: CardOp[];
  images: Map<string, HTMLImageElement>;
};

async function prepareCard(
  monster: Partial<Monster>, opts?: BrowserCardOptions,
): Promise<PreparedCard> {
  const { width, height, ops } = cardPlan(monster, opts);
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(assetsFor(ops).map(async (asset) => {
    images.set(asset, await image(asset, opts?.assetUrls?.[asset]));
  }));
  return { width, height, ops, images };
}

function paint(
  canvas: HTMLCanvasElement, width: number, height: number,
  ops: CardOp[], images: Map<string, HTMLImageElement>,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  for (const op of ops) {
    if (op.op === 'image') {
      const img = images.get(op.asset)!;
      const sw = op.sw ?? img.naturalWidth;
      const sh = op.sh ?? img.naturalHeight;
      ctx.drawImage(img, op.sx ?? 0, op.sy ?? 0, sw, sh, op.dx ?? 0, op.dy ?? 0, sw, sh);
    } else {
      ctx.fillStyle = rgba(op.color);
      for (const [x, y, w, h] of op.rects) ctx.fillRect(x, y, w, h);
    }
  }
}

/**
 * Draw `monster` onto `canvas`, which is resized to the card.
 *
 * Every plate is awaited before the first is drawn. Painting as they arrive
 * would put the frame under the portrait whenever the cache order changed, and
 * the ops are an ordered stack, not a set.
 */
export async function drawCard(
  canvas: HTMLCanvasElement, monster: Partial<Monster>, opts?: BrowserCardOptions,
): Promise<void> {
  const prepared = await prepareCard(monster, opts);
  paint(canvas, prepared.width, prepared.height, prepared.ops, prepared.images);
}

export type CardAssemblyLayer = {
  id: 'foundation' | 'portrait' | 'frame' | 'element' | 'level' | 'inscription';
  label: string;
  canvas: HTMLCanvasElement;
};

export type CardAssembly = {
  /** The exact final face used by CardObject and by the mint preview. */
  face: HTMLCanvasElement;
  /** The same operations split into cinematic layers, still in paint order. */
  layers: CardAssemblyLayer[];
};

/**
 * Paint the real card once, plus transparent canvases for its assembly reveal.
 *
 * The first five operations are the five registered full-card plates emitted
 * by `cardPlan`: scenery, portrait, frame, element and level. Everything after
 * them is live record ink (name, stats and moves). Replaying these canvases in
 * this order therefore lands on the same pixels as `drawCard`; the animation
 * never maintains a second, approximate card layout of its own.
 */
export async function drawCardAssembly(
  monster: Partial<Monster>, opts?: BrowserCardOptions,
): Promise<CardAssembly> {
  const prepared = await prepareCard(monster, opts);
  const face = document.createElement('canvas');
  paint(face, prepared.width, prepared.height, prepared.ops, prepared.images);

  const groups: Array<{ id: CardAssemblyLayer['id']; label: string; ops: CardOp[] }> = [
    { id: 'foundation', label: 'Scenery', ops: prepared.ops.slice(0, 1) },
    { id: 'portrait', label: 'Portrait', ops: prepared.ops.slice(1, 2) },
    { id: 'frame', label: 'Forged frame', ops: prepared.ops.slice(2, 3) },
    { id: 'element', label: 'Element', ops: prepared.ops.slice(3, 4) },
    { id: 'level', label: 'Level seal', ops: prepared.ops.slice(4, 5) },
    { id: 'inscription', label: 'Living record', ops: prepared.ops.slice(5) },
  ];

  const layers = groups.map((group) => {
    const canvas = document.createElement('canvas');
    paint(canvas, prepared.width, prepared.height, group.ops, prepared.images);
    return { id: group.id, label: group.label, canvas };
  });
  return { face, layers };
}

/**
 * The card as a PNG blob.
 *
 * Only for a local download. It is NOT what gets minted — the worker composites
 * from the process's own copy of the record, so a page cannot talk a card into
 * existence that the monster does not justify.
 */
export async function cardBlob(monster: Partial<Monster>, opts?: BrowserCardOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await drawCard(canvas, monster, opts);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
