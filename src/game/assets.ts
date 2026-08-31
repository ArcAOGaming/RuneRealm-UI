/**
 * Every bundled texture the game scenes load, resolved at BUILD time.
 *
 * `import.meta.glob` rather than runtime fetches from a gateway: the art is in
 * `src/assets`, so Vite hashes and bundles it, and a missing file is a broken
 * build rather than a broken scene in front of a player. It also means no
 * network round trip before the companion appears.
 *
 * Frame geometry is stated once, here, because it is the one thing that is
 * wrong everywhere if it is wrong anywhere. All four faction sheets are
 * 256x384 — 4 columns of 6 rows of 64x64. (Room.tsx used to measure this off
 * the loaded image "since the four faction sheets are not all the same
 * resolution". They are; three of them are simply WebP files named .png, which
 * is what that comment was really about.)
 */
import { Element } from '../lib/types';

const url = (m: Record<string, unknown>) => m as Record<string, string>;

const SHEETS = url(import.meta.glob('../assets/sprites/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const ARENAS = url(import.meta.glob('../assets/scenes/arena/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const HOMES = url(import.meta.glob('../assets/scenes/home/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const PLAY = url(import.meta.glob('../assets/scenes/play/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const QUEST = url(import.meta.glob('../assets/scenes/quest/*/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const FX = url(import.meta.glob('../assets/fx/*.png', {
  eager: true, query: '?url', import: 'default',
}));

const pick = (map: Record<string, string>, name: string) =>
  map[Object.keys(map).find((k) => k.endsWith(`/${name}.png`)) ?? ''] ?? '';

/** A faction walk sheet, by the transaction id the process stores as `sprite`. */
export const sheetUrl = (sprite: string) => pick(SHEETS, sprite);

export const arenaUrl = (name: string) => pick(ARENAS, name);
export const homeUrl = (name: string) => pick(HOMES, name);
export const playUrl = (name: string) => pick(PLAY, name);

/** One named layer inside one quest route folder. */
export const questLayerUrl = (route: string, layer: string) =>
  QUEST[Object.keys(QUEST).find((k) => k.endsWith(`/quest/${route}/${layer}.png`)) ?? ''] ?? '';
export const fxUrl = (name: string) => pick(FX, name);

export const arenaNames = () =>
  Object.keys(ARENAS).map((k) => k.split('/').pop()!.replace(/\.png$/, '')).sort();

export const homeNames = () =>
  Object.keys(HOMES).map((k) => k.split('/').pop()!.replace(/\.png$/, '')).sort();

export const playNames = () =>
  Object.keys(PLAY).map((k) => k.split('/').pop()!.replace(/\.png$/, '')).sort();

export const questRoutes = () => [...new Set(
  Object.keys(QUEST).map((k) => k.match(/\/quest\/([^/]+)\//)?.[1]).filter(Boolean) as string[],
)].filter((route) => ['sky', 'far', 'mid'].every((layer) => questLayerUrl(route, layer))).sort();

// Sheet geometry -------------------------------------------------------------

export const FRAME = { w: 64, h: 64 } as const;

/**
 * Which row of the sheet is which — checked against the art, not inherited.
 *
 * Room.tsx and the first version of BattleScene both called rows 4 and 5
 * "attack", which came from a comment in the original file. They are not.
 * Laying the sheet out row by row shows rows 4 and 5 are the creature STANDING
 * STILL and facing right, with a small emote in the middle frames — a lick in
 * one, a shake with motion lines in the other. Nothing in either row moves its
 * legs.
 *
 * That mistake is why an "idle" companion appeared to be walking on the spot:
 * idle was being played from the walk row because the rows that actually hold
 * a standing pose were being saved for an attack that never used them.
 *
 * The real attack is not on this sheet at all. It is `SPECIAL` below — a
 * separate 128x128 strip of the whole creature performing the move, which is
 * why it is drawn over the ATTACKER and not over the fighter being hit.
 */
export const ROW = {
  walkRight: 0, walkLeft: 1, walkUp: 2, walkDown: 3, idle: 4, emote: 5,
} as const;

export const rowFrames = (row: number) =>
  [0, 1, 2, 3].map((i) => row * 4 + i);

/**
 * The one frame a creature STANDS on.
 *
 * Row 4 is a standing row, but it is not four frames of standing: frame 0 is
 * the neutral pose and frames 1-3 are an emote — a paw comes up, the mouth
 * opens, motion lines appear. Looping the whole row therefore reads as the
 * creature repeatedly performing a small attack, which is what it looked like.
 *
 * So idle HOLDS this frame, and the emote is played deliberately and rarely as
 * a one-shot on top of it.
 */
export const STAND_FRAME = ROW.idle * 4;

// Element effects ------------------------------------------------------------

/**
 * The 8-frame 128x128 strike, per element.
 *
 * This is the creature itself performing the move — wind-up, lunge, the
 * element's arc, and a recover — not a decal to float over whoever got hit. So
 * it is played in place of the attacker's walk sprite for the length of the
 * swing, and the 64px sprite is hidden underneath it.
 */
export const SPECIAL: Record<Element, string> = {
  fire: 'special-fire',
  water: 'special-water',
  rock: 'special-rock',
  air: 'special-air',
};

export const SPECIAL_FRAME = { w: 128, h: 128, count: 8 } as const;

/** The 8-frame 64x64 item effects. */
export const HEAL_FRAME = { w: 64, h: 64, count: 8 } as const;

/**
 * Which arena a fight is staged in.
 *
 * Deterministic on the battle id so both players see the same room, and so a
 * reload does not teleport a fight somewhere else mid-round. Element-matched
 * temples come first — a fire companion fights in the fire temple — with the
 * neutral rooms as the pool for everything else.
 */
const NEUTRAL = [
  'moonlit-ruins', 'crystal-cave', 'canyon-floor', 'quarry', 'mushroom-grove',
  'sakura-court', 'night-market', 'throne-hall', 'dojo', 'catacombs',
  'bamboo-grove', 'zen-garden', 'pagoda-court', 'koi-pond', 'autumn-glade',
  'ruined-street', 'swamp-walk', 'ice-cavern', 'badlands', 'waterfall-basin',
  'castle-keep', 'shrine-steps', 'onsen', 'torii-shore', 'snow-village',
  'sunken-temple', 'forge-hall', 'ember-shrine', 'moonlit-ruins',
];

export function arenaFor(battleId: string, element?: Element): string {
  if (element && Math.abs(hash(battleId)) % 3 === 0) {
    const temple = `temple-${element}`;
    if (arenaUrl(temple)) return temple;
  }
  const pool = NEUTRAL.filter((n) => arenaUrl(n));
  if (!pool.length) return arenaNames()[0] ?? '';
  return pool[Math.abs(hash(battleId)) % pool.length];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
