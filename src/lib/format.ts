import { Affinity, BattleStat, BerryItemId, Element, ItemId, Move, Tuning } from './types';

/** "a Rockpup", but "an Airbud" and "an air companion". */
export const article = (word: string) =>
  /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';

export const shortAddress = (a?: string | null, n = 4) =>
  !a ? '' : a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;

/** "4m 12s", "1h 03m", "now". Never negative. */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export const pct = (value: number, max: number) =>
  max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

export const ELEMENT_LABEL: Record<Affinity, string> = {
  fire: 'Fire', water: 'Water', air: 'Air', rock: 'Rock', normal: 'Untyped',
};

/** Mirrors C.EFFECTIVENESS in backend/native/constants.lua. */
export const EFFECTIVENESS: Record<Element, Record<Element, number>> = {
  fire: { fire: 1, water: 0.5, air: 2, rock: 1 },
  water: { fire: 2, water: 1, air: 1, rock: 0.5 },
  air: { fire: 0.5, water: 2, air: 1, rock: 1 },
  rock: { fire: 1, water: 1, air: 0.5, rock: 2 },
};

const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
export const isElement = (t: string): t is Element => (ELEMENTS as string[]).includes(t);

/** How a move of this type will land on that element, or null if it is neutral. */
export function matchup(moveType: Move['type'], against?: Affinity | null):
  { multiplier: number; label: string } | null {
  if (!against || against === 'normal' || !isElement(moveType)) return null;
  const multiplier = EFFECTIVENESS[moveType][against];
  if (multiplier > 1) return { multiplier, label: 'Super effective' };
  if (multiplier < 1) return { multiplier, label: 'Not very effective' };
  return null;
}

/**
 * Whatever is added to the attack stat before a move's power multiplies it.
 *
 * `attackBase` alone is 1. The two floors on top of it are why a defensive
 * build still scales: see `attackFloor` in battle.lua. The budget is the four
 * stats, frozen when the fight started — a combatant carries that frozen
 * number, and a companion sitting outside a fight has not frozen one, so it is
 * summed from what it has right now.
 */
export const attackFloor = (fighter: Fighter, tuning: Tuning) => {
  const budget = fighter.statBudget
    ?? (fighter.attack + fighter.defense + fighter.speed + fighter.health);
  // Measured from the ten points every companion starts on, not from zero.
  const grown = Math.max(0, budget - (tuning.attackBudgetBaseline ?? 0));
  return tuning.attackBase
    + (tuning.attackPerLevel ?? 0) * (fighter.level ?? 0)
    + (tuning.attackPerStatPoint ?? 0) * grown;
};

/** Anything with the four stats: a companion, or a combatant mid-fight. */
export type Fighter = {
  attack: number; defense: number; speed: number; health: number;
  level?: number; statBudget?: number;
};

/**
 * What a move will actually hit for, computed the way the engine computes it.
 *
 * The UI used to print `move.damage * 5`, a constant copied out of the old
 * game. The engine multiplies by the attacker's ATTACK stat, so that number was
 * right only at attack 4 and — worse — never moved when a player spent points
 * into Attack, which made the stat look like it did nothing.
 *
 * It takes the whole fighter rather than its attack stat because the floor
 * above is sized against all four stats.
 */
export const moveDamage = (move: Move, fighter: Fighter, tuning: Tuning) =>
  Math.max(1, Math.floor(move.damage * (attackFloor(fighter, tuning) + fighter.attack)));

/** Max HP for a health stat, from the engine's own constant. */
export const maxHealth = (health: number, tuning: Tuning) =>
  Math.max(1, Math.round(health * tuning.hpPerHealth));

export const ITEM_NAME: Record<ItemId, string> = {
  air_berry: 'Air Berry',
  water_berry: 'Water Berry',
  fire_berry: 'Fire Berry',
  rock_berry: 'Rock Berry',
  rune: 'Rune',
  scroll: 'Scroll',
  legendary_scroll: 'Legendary Scroll',
};

/**
 * Arena berry maxing: intentionally strong for the first balance pass.
 * TODO(balance): test +3 or a shorter duration once real session data exists.
 */
export const BATTLE_BERRIES: Array<{
  id: BerryItemId; stat: BattleStat; amount: number; cost: number; note: string;
}> = [
  { id: 'fire_berry', stat: 'attack', amount: 5, cost: 3, note: '+5 attack for four battles' },
  { id: 'rock_berry', stat: 'defense', amount: 5, cost: 3, note: '+5 defense for four battles' },
  { id: 'air_berry', stat: 'speed', amount: 5, cost: 3, note: '+5 speed for four battles' },
  { id: 'water_berry', stat: 'health', amount: 5, cost: 3, note: '+5 health for four battles' },
];

export const BERRY_FOR: Record<Element, BerryItemId> = {
  air: 'air_berry', water: 'water_berry', fire: 'fire_berry', rock: 'rock_berry',
};

export const ITEM_ELEMENT: Partial<Record<ItemId, Element>> = {
  air_berry: 'air', water_berry: 'water', fire_berry: 'fire', rock_berry: 'rock',
};

export const LOOTBOX_TIER = ['', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export const isArweaveAddress = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s.trim());

/** Pull every distinct Arweave address out of arbitrary pasted text. */
export function extractAddresses(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z0-9_-]{43}/g)) {
    const before = text[m.index! - 1];
    const after = text[m.index! + 43];
    if (before && /[A-Za-z0-9_-]/.test(before)) continue;
    if (after && /[A-Za-z0-9_-]/.test(after)) continue;
    found.add(m[0]);
  }
  return [...found];
}
