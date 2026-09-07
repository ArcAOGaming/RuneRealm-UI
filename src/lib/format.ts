import {
  Affinity, ArenaTiers, BattleStat, BerryItemId, Catalog, Element, ItemId, Move, Tuning,
} from './types';

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

/**
 * A whole number with thousands separators.
 *
 * Gold is counted in whole units everywhere — the process narrows every one of
 * them through `int()` on the way in — so this never shows a fraction, and a
 * five-figure purse still reads as a number rather than as a run of digits.
 */
export const formatInteger = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

/**
 * What an arena session costs and what it pays, read from the process.
 *
 * Every number here was a literal in `screens/Arena.tsx` — 25 energy, 25
 * happiness, a loot box on a win — and two of the three had already drifted
 * from the deployed process by the time anyone looked. They come out of
 * `catalog.activities.battle` and `catalog.arena` now, which are
 * `C.ACTIVITIES.battle` and `C.ARENA` published verbatim, so moving a cost in
 * constants.lua moves the sentence on the screen.
 *
 * The fallbacks exist only so a client that has not yet loaded the catalog
 * renders a plausible screen rather than `NaN`; the gate itself is always the
 * process's, never this. `staked` is false on a deployment from before the
 * arena charged, and the screens describe a free arena rather than quoting a
 * price nobody will take.
 */
export const SESSION_BATTLES = 4;

/**
 * The four difficulties, for a process that publishes no `catalog.arena`.
 *
 * A deployment from before the arena was staked has no tier table, and without
 * this the lobby renders an EMPTY difficulty picker and sends 1.0 for every
 * fight. These are the same four values that screen has always sent; they are a
 * fallback for an older process, never a second source of truth for a current
 * one — `catalog.arena.tiers` wins whenever it exists.
 */
const FALLBACK_TIERS = [
  { key: 'easy', label: 'Easy', difficulty: 0.75, below: 0.9 },
  { key: 'even', label: 'Even', difficulty: 1, below: 1.2 },
  { key: 'hard', label: 'Hard', difficulty: 1.4, below: 1.7 },
  { key: 'brutal', label: 'Brutal', difficulty: 2, below: 99 },
];

export function arenaTerms(catalog: Catalog | null | undefined) {
  const battle = catalog?.activities?.battle;
  const arena = catalog?.arena;
  const winGold = Math.max(0, Math.round(battle?.winGold ?? 5));
  const battles = Math.max(1, Math.round(arena?.battlesPerSession ?? SESSION_BATTLES));
  const stake = Math.max(0, Math.round(arena?.stake ?? 0));
  return {
    energyCost: Math.max(0, Math.round(battle?.energyCost ?? 25)),
    happinessCost: Math.max(0, Math.round(battle?.happinessCost ?? 25)),
    /**
     * The BASE layer: what the capped 20-hour allowance pays for a win.
     *
     * This is the only thing in the arena that issues Gold, it is shared with
     * quests, and it can legitimately pay nothing once the day's allowance is
     * spent. Everything else a win pays is redistribution out of a pot.
     */
    winGold,
    battles,
    /** Gold per BATTLE, into the tier's pot. 0 means this deployment is free. */
    stake,
    staked: stake > 0,
    /** What a purse must hold to get through the door: one battle's stake. */
    minEntry: Math.max(0, Math.round(arena?.minEntry ?? 0)),
    /** A whole session's stakes, if every battle is used. */
    sessionStake: stake * battles,
    drainNum: Math.max(1, Math.round(arena?.drainNum ?? 1)),
    drainDen: Math.max(1, Math.round(arena?.drainDen ?? 3)),
    tiers: arena?.tiers?.length ? arena.tiers : FALLBACK_TIERS,
    /**
     * The Rune entry fee, if this deployment still charges one. v2 removed it:
     * Rune buys advancement now, never the right to play. Absent means free.
     */
    runeCost: battle?.cost,
  };
}

export type ArenaTerms = ReturnType<typeof arenaTerms>;

/**
 * Everything a player needs to judge one tier, derived from four published
 * integers.
 *
 * This is ARENA_STAKES.md §8 in one function, and the separation it describes
 * is the whole point:
 *
 *  - `payout` and `breakEven` are facts about the POT, and the pot is what
 *    actually pays. Neither can be pushed by a player: a pot cannot hand out
 *    Gold nobody staked, so fattening it means funding it yourself.
 *  - `winRate` is a DISPLAY statistic and nothing reads it but this screen. A
 *    player who dumps games to drag it down gains nothing, because the payout
 *    still comes only from what is in the pot. It must stay that way.
 *
 * `edge` is the gap between the two, and it is the signal worth showing:
 * break-even converges on the tier's own win rate at equilibrium, so a positive
 * gap means the pot is currently fat — a run of losses fed it and the next win
 * takes a third of a bigger number. That makes timing a decision a player can
 * see rather than one they cannot.
 *
 * Never derive an "expected value" from this. EV depends on the player's own
 * win rate, which is exactly what the design refuses to assume about them.
 */
export function arenaTierMath(
  terms: ArenaTerms,
  row: { pot: number; wins: number; attempts: number } | undefined,
) {
  const pot = Math.max(0, Math.round(row?.pot ?? 0));
  const wins = Math.max(0, Math.round(row?.wins ?? 0));
  const attempts = Math.max(0, Math.round(row?.attempts ?? 0));
  // The stake goes in BEFORE the draw, so a win on an empty pot still takes a
  // third of its own stake back. Quoting the pot as it stands would understate
  // every payout by exactly that much.
  const pool = pot + terms.stake;
  const payout = Math.floor((pool * terms.drainNum) / terms.drainDen);
  // Undefined rather than Infinity when a tier pays nothing yet: there is no
  // win rate that breaks even on a zero payout, and a screen must say "no data"
  // rather than print a number.
  const breakEven = payout > 0 && terms.stake > 0 ? terms.stake / payout : undefined;
  // A handful of battles is not a rate. Below this the tier has been played too
  // little to say anything, and pretending otherwise is the misinformed-player
  // failure this statistic exists to avoid.
  const winRate = attempts >= 10 ? wins / attempts : undefined;
  const edge = winRate !== undefined && breakEven !== undefined
    ? winRate - breakEven : undefined;
  return { pot, wins, attempts, payout, breakEven, winRate, edge };
}

export type ArenaTierMath = ReturnType<typeof arenaTierMath>;

/** One tier, joined: its constants, its pot, and everything derived from both. */
export function arenaTierRows(terms: ArenaTerms, tiers: ArenaTiers | null | undefined) {
  return terms.tiers.map((tier) => ({
    ...tier,
    ...arenaTierMath(terms, tiers?.[tier.key]),
  }));
}

/** "38%", and "—" for a rate nothing has been measured for yet. */
export const ratePct = (value: number | undefined) =>
  value === undefined ? '—' : `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

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

/**
 * What a printed rider is actually worth to this fighter, in stat points.
 *
 * A move's `+5 speed` is not five points and has not been since riders were
 * scaled: the engine multiplies it by `riderPerPoint` against a quarter of the
 * fighter's whole stat budget, rounded away from zero. Mirrors `riderPoints`
 * in battle.lua, and MUST keep mirroring it — this is the number the player
 * watches move on their own stat line, and the whole reason riders stopped
 * being flat is that a flat one meant two different things at level 0 and
 * level 20.
 *
 * Measured against the BUDGET rather than the stat being moved, which is what
 * makes a buff worth the same to a build that dumped that stat as to one that
 * bought it.
 *
 * Falls back to the printed number when the process publishes no
 * `riderPerPoint`, which is what a deployment from before the change does.
 */
export const riderPoints = (points: number, fighter: Fighter, tuning: Tuning) => {
  if (points === 0) return 0;
  const share = tuning.riderPerPoint;
  if (!share) return points;
  const budget = fighter.statBudget
    ?? (fighter.attack + fighter.defense + fighter.speed + fighter.health);
  const yardstick = Math.max(1, Math.floor(budget / 4));
  const size = Math.max(1, Math.floor(Math.abs(points) * share * yardstick + 0.5));
  return points > 0 ? size : -size;
};

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
