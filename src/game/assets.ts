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
import { Affinity, Element } from '../lib/types';

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

export function arenaFor(battleId: string, element?: Affinity): string {
  if (element && element !== 'normal' && Math.abs(hash(battleId)) % 3 === 0) {
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
