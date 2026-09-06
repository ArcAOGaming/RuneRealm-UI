/**
 * Shelf geometry for the market stock-room, shared by the WebGPU scene that
 * builds the shelves and the pixel overlay that draws goods onto them.
 *
 * The layout used to be written twice — world coordinates in `marketDiorama.ts`
 * and hand-tuned CSS percentages in `MarketDiorama.tsx` — so the sprites only
 * sat on their boards at the one aspect ratio the percentages were tuned at,
 * and drifted off the shelf at every other size. Everything here is world
 * space. `makeProjector` turns it into canvas coordinates using the same camera
 * the renderer uses, so a berry lands on the board it belongs to by
 * construction rather than by guessing at the overlay's dimensions.
 *
 * Coordinates are the chamber's; `CHAMBER_Y` is the group offset the renderer
 * applies, and the projector applies it too.
 */

/* The chamber hangs this far below the origin. It frames the shelves in the
   canvas: the top rail and the lowest board want roughly equal margins, so
   moving a shelf means re-checking this number, not nudging a percentage. */
export const CHAMBER_Y = -.46;

export const CAMERA = {
  fov: 31,
  /**
   * The aspect the vertical field of view is authored for. Narrower than this
   * and a fixed vertical FOV crops the shelf wall off the sides, so the camera
   * pulls back instead: `fovFor` keeps the HORIZONTAL extent constant, which is
   * the extent the wall fills.
   */
  refAspect: 2,
  z: 7.25,
  y: .68,
  lookAt: { x: 0, y: -.34, z: 0 },
  /** Pointer parallax: camera offset and chamber yaw per unit of aim. */
  swayX: .07,
  swayY: .035,
  yaw: .016,
} as const;

/** Vertical field of view that keeps the whole shelf wall in frame at any aspect. */
export function fovFor(aspect: number): number {
  const safe = Math.max(.0001, aspect);
  if (safe >= CAMERA.refAspect) return CAMERA.fov;
  const half = Math.tan((CAMERA.fov * Math.PI / 180) / 2) * (CAMERA.refAspect / safe);
  return Math.min(74, Math.atan(half) * 2 * 180 / Math.PI);
}

/** Depths of the parts of a bay, front of the backdrop and behind the counter. */
export const BAY_Z = {
  back: -1.52,
  board: -1.18,
  boardDepth: .55,
  frame: -1.26,
} as const;

export const BOARD_THICKNESS = .09;
export const RAIL_THICKNESS = .055;
export const UPRIGHT_WIDTH = .085;

/** Which wall a bay belongs to: the shop's stock, or the player's own satchel. */
export type WallId = 'shop' | 'satchel';

export type ShelfBay = {
  id: string;
  wall: WallId;
  /** Centre of the bay opening. */
  x: number;
  y: number;
  /** Inner opening, excluding the frame around it. */
  width: number;
  height: number;
  label: string;
};

/** Bays are addressed by wall and item, since both walls carry the same items. */
export function bayKey(bay: ShelfBay): string {
  return `${bay.wall}:${bay.id}`;
}

/**
 * The wall is a regular grid: two columns, three rows, every bay identical.
 * Scroll and Rune used to be half-height oddities; making the grid uniform is
 * what keeps them the same size as the rest, and it means widening a shelf is
 * one number rather than six.
 *
 * `WALL_X` is the left column's centre and `WALL_Y` the middle row's, so the
 * wall moves independently of the counter — the counter is placed off `COUNTER`
 * and stays where it is when the shelves are re-laid.
 */
const BAY_WIDTH = 2.725;
const BAY_HEIGHT = 1.3;
const COLUMN_PITCH = BAY_WIDTH + .13;
const ROW_PITCH = BAY_HEIGHT + .12;
const WALL_X = -2.6;
const WALL_Y = -.14;

const WALL_ORDER: Array<[string, string]> = [
  ['scroll', 'Scroll'], ['rune', 'Rune'],
  ['fire_berry', 'Fire'], ['water_berry', 'Water'],
  ['air_berry', 'Air'], ['rock_berry', 'Rock'],
];

/**
 * The satchel wall is the same grid again, off to the right of the counter: in
 * sell mode the camera trucks over to it and it shows what the PLAYER holds,
 * the way the shop wall shows what the shop holds. Identical geometry is the
 * point — the two walls read as the same kind of thing.
 */
const SATCHEL_X = 5.025;

function wallBays(wall: WallId, originX: number): ShelfBay[] {
  return WALL_ORDER.map(([id, label], index) => ({
    id,
    wall,
    label,
    x: originX + (index % 2) * COLUMN_PITCH,
    y: WALL_Y + (1 - Math.floor(index / 2)) * ROW_PITCH,
    width: BAY_WIDTH,
    height: BAY_HEIGHT,
  }));
}

export const SHELF_BAYS: ShelfBay[] = wallBays('shop', WALL_X);
export const SATCHEL_BAYS: ShelfBay[] = wallBays('satchel', SATCHEL_X);
export const ALL_BAYS: ShelfBay[] = [...SHELF_BAYS, ...SATCHEL_BAYS];

export const BAY_BY_ID: Record<string, ShelfBay> =
  Object.fromEntries(SHELF_BAYS.map((bay) => [bay.id, bay]));

/**
 * Where the camera stands for each side of the trade. Buying looks at the shop
 * wall with the counter in the right quarter; selling trucks right until the
 * counter sits in the LEFT quarter and the satchel fills the rest — the same
 * split, mirrored. The distance is solved from the counter's own screen span,
 * not guessed, so the mirror actually lands.
 */
export const STATION = { buy: 0, sell: 5.24 } as const;
export type MarketMode = keyof typeof STATION;

/**
 * The room behind it all. It has to span both stations plus the pan between
 * them, or trucking the camera reveals the edge of the backdrop.
 */
export const ROOM = {
  x: 2.6,
  y: -.5,
  backZ: -2.6,
  width: 21,
  height: 11.5,
  floorY: -2.75,
  floorDepth: 6.5,
} as const;

/** The counter the player's own order is staged on, and the gold table above it. */
export const COUNTER = {
  x: 2.62,
  /** Top face of the trade table, where ordered goods stand. */
  surfaceY: -1.35,
  z: .34,
  width: 1.82,
  depth: 1.08,
} as const;

/**
 * The two tables of the exchange, and the front lip of each — where its label
 * plate hangs. The upper table always holds the Gold and the lower one always
 * holds the goods; which of them the player GIVES and which they GET is what
 * the side of the trade decides, so the plates swap and the tables do not.
 */
export const EXCHANGE = {
  /* Centred on each table's front PANEL, not its lip: a sign on the front of
     the counter never covers the goods standing on top of it, and never runs
     off the bottom of the frame the way a plate hanging under the lip does. */
  gold: { x: COUNTER.x, y: -.18, z: .29 },
  goods: { x: COUNTER.x, y: COUNTER.surfaceY - .2, z: .80 },
} as const;

/* ------------------------------------------------------------------ stock */

export type UnitKind = 'basket' | 'crate' | 'pallet';
export type UnitAmount = 10 | 100 | 1000;

/**
 * A container's footprint at scale 1, and the scale it is built at. Every
 * container mesh is modelled with its ORIGIN AT ITS BASE, so a unit's `y` is
 * the surface it stands on and `y + height` is the surface its pixel goods sit
 * on. Nothing has to compensate for a centred box afterwards.
 */
const UNIT_SPEC: Record<UnitAmount, { kind: UnitKind; width: number; height: number; scale: number }> = {
  10: { kind: 'basket', width: .72, height: .42, scale: .70 },
  100: { kind: 'crate', width: .66, height: .54, scale: .82 },
  1000: { kind: 'pallet', width: 1.02, height: .70, scale: .84 },
};

/** A loose berry standing directly on the board, in front of the containers. */
const LOOSE_SPRITE = .26;
const LOOSE_Z = BAY_Z.board + BAY_Z.boardDepth / 2 - .12;
const UNIT_Z = BAY_Z.board + .02;
const UNIT_GAP = .07;
const ROW_GAP = .015;
const MAX_UNITS = 10;
const MAX_LOOSE = 9;
/** How many containers fit on the counter, and how far apart its rows sit. */
const MAX_ORDER_UNITS = 12;
const ROW_DEPTH = .34;

/**
 * The largest order the counter is drawn for. The desk's own per-action limit
 * is the rule; this only bounds what the staging table has to depict.
 */
export const MAX_ORDER = 1000;

/**
 * The edge of a container that hides part of a good standing behind it.
 *
 * The overlay draws over the canvas, so 3D geometry can never occlude a sprite;
 * cutting the sprite gets the same read. But the cut has to be the REAL edge,
 * projected — a fixed fraction of the image is right at one camera and wrong at
 * every other, which is the same mistake as hand-tuned overlay percentages. So
 * an occluder is two world points on the container's own lip or lid, and the
 * cut is wherever that line crosses the sprite on screen.
 */
export type SpriteOccluder = {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  /** The side of the line the container stands in front of. */
  hides: 'below' | 'above';
};

/** One pixel good riding on a container. */
export type UnitSprite = {
  x: number;
  y: number;
  z: number;
  /** World width of the sprite; its anchor is its centre. */
  size: number;
  occluder?: SpriteOccluder;
};

/** The count stencilled on the container, placed on its front in world space. */
export type UnitBadge = { x: number; y: number; z: number; size: number };

export type StockUnit = {
  amount: UnitAmount;
  kind: UnitKind;
  /** Base of the container: the surface it rests on. */
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Height of the built container, so goods can be stood on top of it. */
  height: number;
  /** Where its goods sit and where its count is stencilled. */
  sprites: UnitSprite[];
  badge: UnitBadge;
};

/**
 * The basket's rim and the crate's lid, in the container's own unscaled space.
 * The MESH is built from these numbers and so are the sprite cuts, so moving a
 * lid takes its cut with it instead of leaving behind a fraction that used to
 * line up.
 */
export const BASKET_RIM = { radius: .32, y: .40, front: .30 } as const;

export const CRATE_LID = {
  width: .66, height: .06, depth: .56,
  x: .07, y: .62, z: .03,
  tilt: .17, yaw: .07,
} as const;

/** The lid's front underside edge: what the goods inside are seen below. */
export function crateLidEdge(): SpriteOccluder {
  const halfWidth = CRATE_LID.width / 2;
  const halfHeight = CRATE_LID.height / 2;
  const cos = Math.cos(CRATE_LID.tilt);
  const sin = Math.sin(CRATE_LID.tilt);
  const corner = (side: number) => ({
    x: CRATE_LID.x + side * halfWidth * cos + halfHeight * sin,
    y: CRATE_LID.y + side * halfWidth * sin - halfHeight * cos,
    z: CRATE_LID.z + CRATE_LID.depth / 2,
  });
  return { a: corner(-1), b: corner(1), hides: 'above' };
}

/** The basket's front lip: goods sit in the mouth behind it. */
export function basketLipEdge(): SpriteOccluder {
  return {
    a: { x: -BASKET_RIM.radius - .04, y: BASKET_RIM.y, z: BASKET_RIM.front },
    b: { x: BASKET_RIM.radius + .04, y: BASKET_RIM.y, z: BASKET_RIM.front },
    hides: 'below',
  };
}

/**
 * How each container carries its goods, in the container's own unscaled space
 * with the origin at its base. Three kinds, three readings:
 *
 * - a basket is open, so three sit in its mouth with the front lip across them;
 * - a crate is lidded but the lid is askew, so five show through the gap;
 * - a pallet is shrink-wrapped and says what it is, so the good and the count
 *   are stencilled side by side on its side.
 */
const UNIT_CONTENTS: Record<UnitAmount, { sprites: UnitSprite[]; badge: UnitBadge }> = {
  10: {
    /* Sunk until the projected lip actually crosses them — a third of each is
       behind the front of the basket, which is what sitting IN it looks like. */
    sprites: [
      { x: -.17, y: .38, z: .10, size: .30, occluder: basketLipEdge() },
      { x: .00, y: .41, z: .17, size: .30, occluder: basketLipEdge() },
      { x: .17, y: .38, z: .10, size: .30, occluder: basketLipEdge() },
    ],
    badge: { x: 0, y: .18, z: .31, size: .17 },
  },
  100: {
    /* Set so the lid takes about a quarter off the top. The back pair sits
       lower because, being further from the camera, the same lid reaches
       further down them. */
    sprites: [
      { x: -.19, y: .40, z: .12, size: .26, occluder: crateLidEdge() },
      { x: .00, y: .41, z: .14, size: .26, occluder: crateLidEdge() },
      { x: .19, y: .40, z: .12, size: .26, occluder: crateLidEdge() },
      { x: -.10, y: .36, z: -.06, size: .24, occluder: crateLidEdge() },
      { x: .10, y: .36, z: -.06, size: .24, occluder: crateLidEdge() },
    ],
    badge: { x: 0, y: .24, z: .28, size: .19 },
  },
  1000: {
    sprites: [{ x: -.17, y: .44, z: .28, size: .34 }],
    badge: { x: .19, y: .44, z: .28, size: .22 },
  },
};

export type LooseUnit = { x: number; y: number; z: number; sprite: number };

/** Break a stock count into the containers a stock-room would put it in. */
export function packageUnits(stock: number): UnitAmount[] {
  const units: UnitAmount[] = [];
  let remainder = Math.max(0, Math.floor(stock));
  for (let index = 0; index < Math.floor(remainder / 1000); index += 1) units.push(1000);
  remainder %= 1000;
  for (let index = 0; index < Math.floor(remainder / 100); index += 1) units.push(100);
  remainder %= 100;
  for (let index = 0; index < Math.floor(remainder / 10); index += 1) units.push(10);
  return units;
}

/** Top face of a bay's board — the surface everything in the bay stands on. */
export function boardTop(bay: ShelfBay): number {
  return bay.y - bay.height / 2 + BOARD_THICKNESS / 2;
}

/** Footprint of one container, at the scale it is built. */
function footprint(amount: UnitAmount) {
  const spec = UNIT_SPEC[amount];
  return { spec, width: spec.width * spec.scale, height: spec.height * spec.scale };
}

/** Greedily pack containers, biggest first, into rows of a given inner width. */
function packRows(amounts: UnitAmount[], inner: number): UnitAmount[][] {
  const rows: UnitAmount[][] = [];
  let row: UnitAmount[] = [];
  let width = 0;
  for (const amount of amounts) {
    const next = row.length ? width + UNIT_GAP + footprint(amount).width : footprint(amount).width;
    if (next > inner && row.length) { rows.push(row); row = [amount]; width = footprint(amount).width; continue; }
    row.push(amount); width = next;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Centre one packed row and emit its containers at a given base and depth. */
function placeRow(row: UnitAmount[], centreX: number, y: number, z: number, into: StockUnit[]) {
  const total = row.reduce((sum, amount) => sum + footprint(amount).width, 0) + UNIT_GAP * (row.length - 1);
  let cursor = -total / 2;
  for (const amount of row) {
    const { spec, width, height } = footprint(amount);
    const x = centreX + cursor + width / 2;
    const contents = UNIT_CONTENTS[amount];
    const place = (local: { x: number; y: number; z: number }) => ({
      x: x + local.x * spec.scale,
      y: y + local.y * spec.scale,
      z: z + local.z * spec.scale,
    });
    into.push({
      amount, kind: spec.kind,
      x, y, z,
      scale: spec.scale, height,
      sprites: contents.sprites.map((sprite) => ({
        ...place(sprite),
        size: sprite.size * spec.scale,
        occluder: sprite.occluder && {
          a: place(sprite.occluder.a),
          b: place(sprite.occluder.b),
          hides: sprite.occluder.hides,
        },
      })),
      badge: { ...place(contents.badge), size: contents.badge.size * spec.scale },
    });
    cursor += width + UNIT_GAP;
  }
}

/**
 * Lay a bay's stock out on its board: rows packed left to right, each row
 * standing on the one below it, and nothing placed above the bay opening. The
 * result is what the scene builds containers from AND what the overlay hangs
 * pixel goods on, so the two cannot disagree.
 */
export function stockUnits(bay: ShelfBay, stock: number): StockUnit[] {
  const amounts = packageUnits(stock).slice(0, MAX_UNITS);
  if (!amounts.length) return [];
  const ceiling = bay.height - .08;
  const base = boardTop(bay);
  const placed: StockUnit[] = [];
  let stacked = 0;
  for (const row of packRows(amounts, bay.width - .18)) {
    const height = Math.max(...row.map((amount) => footprint(amount).height));
    if (stacked + height > ceiling) break;
    placeRow(row, bay.x, base + stacked, UNIT_Z, placed);
    stacked += height + ROW_GAP;
  }
  return placed;
}

/** Single berries standing on the board's front lip, in front of the containers. */
export function looseUnits(bay: ShelfBay, stock: number): LooseUnit[] {
  const count = Math.min(MAX_LOOSE, Math.max(0, Math.floor(stock)) % 10);
  if (!count) return [];
  const inner = bay.width - .3;
  const step = Math.min(.3, inner / Math.max(1, count));
  const y = boardTop(bay);
  return Array.from({ length: count }, (_, index) => ({
    x: bay.x + (index - (count - 1) / 2) * step,
    y,
    z: LOOSE_Z + (index % 2) * .03,
    sprite: LOOSE_SPRITE,
  }));
}

/**
 * The player's staged order, packaged exactly like shelf stock: a hundred is a
 * crate and a thousand is a pallet, never ten baskets standing in for either.
 * The counter is a table rather than a shelf, so its rows run BACK across the
 * top instead of stacking upward.
 */
export function orderUnits(quantity: number): { units: StockUnit[]; loose: LooseUnit[] } {
  const amounts = packageUnits(quantity).slice(0, MAX_ORDER_UNITS);
  const units: StockUnit[] = [];
  const depth = COUNTER.depth - .28;
  let back = 0;
  let layer = 0;
  let layerHeight = 0;
  for (const row of packRows(amounts, COUNTER.width - .1)) {
    // Table full front to back: start another layer on top of the last one.
    if (back > depth) {
      if (layer > 0) break;
      back = 0; layer = layerHeight;
    }
    placeRow(row, COUNTER.x, COUNTER.surfaceY + layer, COUNTER.z - back, units);
    layerHeight = Math.max(layerHeight, Math.max(...row.map((amount) => footprint(amount).height)));
    back += ROW_DEPTH;
  }

  const looseCount = Math.min(MAX_LOOSE, Math.max(0, Math.floor(quantity)) % 10);
  const step = Math.min(.28, (COUNTER.width - .4) / Math.max(1, looseCount));
  const loose: LooseUnit[] = Array.from({ length: looseCount }, (_, index) => ({
    x: COUNTER.x + (index - (looseCount - 1) / 2) * step,
    y: COUNTER.surfaceY,
    z: COUNTER.z + .3,
    sprite: LOOSE_SPRITE,
  }));
  return { units, loose };
}

/**
 * Where a container's edge crosses a sprite on screen, as a CSS clip polygon.
 *
 * Both ends of the edge are projected with the same camera the sprite is, so
 * the cut follows the lid as the camera trucks, the aspect changes or the
 * shelf moves — it is the scene's own geometry, not a fraction of the image.
 * Returns undefined when nothing is cut.
 */
export function spriteClip(
  sprite: UnitSprite,
  project: Projector,
  width: number,
  height: number,
): string | undefined {
  const { occluder } = sprite;
  if (!occluder) return undefined;
  const centre = project.point(sprite.x, sprite.y, sprite.z);
  const a = project.point(occluder.a.x, occluder.a.y, occluder.a.z);
  const b = project.point(occluder.b.x, occluder.b.y, occluder.b.z);
  if (!centre.visible || !a.visible || !b.visible) return undefined;

  // The art is square, so the sprite's screen box is `size` on both axes.
  const box = centre.unit * sprite.size;
  if (box <= 0) return undefined;
  const cx = centre.left / 100 * width;
  const top = centre.top / 100 * height - box / 2;
  const ax = a.left / 100 * width; const ay = a.top / 100 * height;
  const bx = b.left / 100 * width; const by = b.top / 100 * height;
  const run = bx - ax;
  const at = (x: number) => (Math.abs(run) < .001 ? ay : ay + (x - ax) * (by - ay) / run);
  const clamp = (value: number) => Math.max(0, Math.min(1, (value - top) / box));
  const left = clamp(at(cx - box / 2)) * 100;
  const right = clamp(at(cx + box / 2)) * 100;
  if (occluder.hides === 'below') {
    if (left >= 100 && right >= 100) return undefined;
    return `polygon(0% 0%, 100% 0%, 100% ${right}%, 0% ${left}%)`;
  }
  if (left <= 0 && right <= 0) return undefined;
  return `polygon(0% ${left}%, 100% ${right}%, 100% 100%, 0% 100%)`;
}

/* ------------------------------------------------------------------- gold */

/**
 * The shopkeeper's table. Gold is grouped the way stock is — a thousand is a
 * bar, a hundred a tall stack, a ten a few coins — rather than one coin per ten
 * up to an arbitrary ceiling, which is what made a large sum and a small one
 * look the same.
 */
export const GOLD_TABLE = {
  x: COUNTER.x,
  /** Top of the shop table's lip, where the gold rests. */
  surfaceY: .01,
  z: -.18,
  width: 1.75,
  depth: .92,
} as const;

export type GoldKind = 'bar' | 'stack' | 'coins' | 'coin';

export type GoldPile = {
  kind: GoldKind;
  amount: number;
  x: number;
  y: number;
  z: number;
  /** Loose coins in the pile, for the mesh builder to stack. */
  coins: number;
  /** Stable per-pile randomness, so a rebuild does not reshuffle the table. */
  seed: number;
  badge?: UnitBadge;
};

const GOLD_SPEC: Record<number, { kind: GoldKind; width: number; depth: number; coins: number; badge: number }> = {
  1000: { kind: 'bar', width: .34, depth: .20, coins: 1, badge: .11 },
  100: { kind: 'stack', width: .28, depth: .28, coins: 7, badge: .10 },
  10: { kind: 'coins', width: .28, depth: .28, coins: 3, badge: 0 },
  1: { kind: 'coin', width: .22, depth: .22, coins: 1, badge: 0 },
};

const GOLD_ORDER = [1000, 100, 10, 1];
const GOLD_GAP = .06;
const GOLD_ROW_DEPTH = .26;
const MAX_GOLD_PILES = 14;

/**
 * Deterministic -1..1 from an integer. The piles need to look hand-stacked but
 * must not reshuffle every time the gold is republished.
 */
export function wobble(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

/** Break a sum into bars, stacks and loose coins, biggest first. */
export function goldDenominations(gold: number): number[] {
  const out: number[] = [];
  let remainder = Math.max(0, Math.floor(gold));
  for (const unit of GOLD_ORDER) {
    const count = Math.floor(remainder / unit);
    for (let index = 0; index < count; index += 1) out.push(unit);
    remainder %= unit;
  }
  return out;
}

/** Lay the gold out across the table: rows left to right, then back. */
export function goldPiles(gold: number): GoldPile[] {
  const amounts = goldDenominations(gold).slice(0, MAX_GOLD_PILES);
  if (!amounts.length) return [];
  const inner = GOLD_TABLE.width - .22;
  const piles: GoldPile[] = [];
  const labelled = new Set<number>();
  let row: number[] = [];
  let width = 0;
  let back = 0;
  let seed = 0;

  const flush = () => {
    if (!row.length) return;
    const total = row.reduce((sum, amount) => sum + GOLD_SPEC[amount].width, 0) + GOLD_GAP * (row.length - 1);
    let cursor = -total / 2;
    for (const amount of row) {
      const spec = GOLD_SPEC[amount];
      seed += 1;
      const x = GOLD_TABLE.x + cursor + spec.width / 2 + wobble(seed * 3) * .015;
      const z = GOLD_TABLE.z + GOLD_TABLE.depth / 2 - .16 - back + wobble(seed * 5) * .02;
      piles.push({
        kind: spec.kind,
        amount,
        x,
        y: GOLD_TABLE.surfaceY,
        z,
        coins: spec.coins,
        seed,
        /* One label per denomination, lying on the table in FRONT of the first
           pile of that kind. A plate on every bar buries the gold it counts,
           and twelve of them all reading 1000 says nothing twelve times. */
        badge: spec.badge && !labelled.has(amount)
          ? { x, y: GOLD_TABLE.surfaceY, z: z + spec.depth / 2 + .07, size: spec.badge }
          : undefined,
      });
      labelled.add(amount);
      cursor += spec.width + GOLD_GAP;
    }
    row = []; width = 0;
    back += GOLD_ROW_DEPTH;
  };

  for (const amount of amounts) {
    const next = row.length ? width + GOLD_GAP + GOLD_SPEC[amount].width : GOLD_SPEC[amount].width;
    if (next > inner && row.length) {
      flush();
      if (back > GOLD_TABLE.depth) return piles;
      row = [amount]; width = GOLD_SPEC[amount].width;
      continue;
    }
    row.push(amount); width = next;
  }
  flush();
  return piles;
}

/* -------------------------------------------------------------- projection */

export type ScreenPoint = {
  /** Percentage of the canvas, ready for `left`/`top`. */
  left: number;
  top: number;
  /** Device pixels per world unit at this depth, for sizing a sprite. */
  unit: number;
  /** True when the point is in front of the camera. */
  visible: boolean;
};

export type ScreenRect = { left: number; top: number; width: number; height: number };

export type Projector = {
  point(x: number, y: number, z: number): ScreenPoint;
  /** Screen box of a bay including its frame — the shelf as a hit target. */
  bay(bay: ShelfBay): ScreenRect;
};

/**
 * A camera identical to the renderer's, as plain arithmetic. Keeping this free
 * of Three means the overlay projects without pulling the 3D bundle in, and
 * still lines up when the renderer failed to start at all.
 */
export function makeProjector(width: number, height: number, aimX = 0, aimY = 0, station = 0): Projector {
  const aspect = Math.max(.0001, width / Math.max(1, height));
  /* `station` trucks the camera sideways: the eye AND the look-at move together,
     so the view direction is unchanged and every point at a given depth shifts
     by the same amount. That is what makes the buy/sell pan a translation the
     overlay can follow exactly. */
  const eyeX = station + aimX * CAMERA.swayX;
  const eyeY = CAMERA.y - aimY * CAMERA.swayY;
  const yaw = aimX * CAMERA.swayX * CAMERA.yaw;
  const cosYaw = Math.cos(yaw); const sinYaw = Math.sin(yaw);

  // Basis of a look-at camera: forward toward the target, right, then true up.
  let fx = CAMERA.lookAt.x + station - eyeX;
  let fy = CAMERA.lookAt.y - eyeY;
  let fz = CAMERA.lookAt.z - CAMERA.z;
  const flen = Math.hypot(fx, fy, fz) || 1;
  fx /= flen; fy /= flen; fz /= flen;
  // right = normalize(cross(forward, worldUp)), worldUp = (0, 1, 0)
  let rx = -fz; let ry = 0; let rz = fx;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen; ry /= rlen; rz /= rlen;
  // up = cross(right, forward)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const focal = 1 / Math.tan((fovFor(aspect) * Math.PI / 180) / 2);

  const point = (x: number, y: number, z: number): ScreenPoint => {
    // Chamber transform: yaw about the group origin, then its vertical offset.
    const wx = x * cosYaw + z * sinYaw;
    const wz = -x * sinYaw + z * cosYaw;
    const wy = y + CHAMBER_Y;

    const dx = wx - eyeX; const dy = wy - eyeY; const dz = wz - CAMERA.z;
    const depth = dx * fx + dy * fy + dz * fz;
    if (depth <= .01) return { left: 0, top: 0, unit: 0, visible: false };
    const viewX = dx * rx + dy * ry + dz * rz;
    const viewY = dx * ux + dy * uy + dz * uz;
    const ndcX = (viewX * focal / aspect) / depth;
    const ndcY = (viewY * focal) / depth;
    return {
      left: (ndcX + 1) / 2 * 100,
      top: (1 - ndcY) / 2 * 100,
      // A world unit spans focal/depth of NDC, i.e. half the canvas height per 2 NDC.
      unit: (focal / depth) * height / 2,
      visible: true,
    };
  };

  const bay = (target: ShelfBay): ScreenRect => {
    const halfWidth = target.width / 2 + UPRIGHT_WIDTH;
    const bottom = target.y - target.height / 2 - BOARD_THICKNESS;
    const top = target.y + target.height / 2 + RAIL_THICKNESS;
    const corners = [
      point(target.x - halfWidth, top, BAY_Z.frame),
      point(target.x + halfWidth, top, BAY_Z.frame),
      point(target.x - halfWidth, bottom, BAY_Z.frame),
      point(target.x + halfWidth, bottom, BAY_Z.frame),
    ];
    const lefts = corners.map((corner) => corner.left);
    const tops = corners.map((corner) => corner.top);
    const left = Math.min(...lefts); const right = Math.max(...lefts);
    const up = Math.min(...tops); const down = Math.max(...tops);
    return { left, top: up, width: right - left, height: down - up };
  };

  return { point, bay };
}
