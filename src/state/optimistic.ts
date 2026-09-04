/**
 * Optimistic projections: what a write is going to do, applied locally before
 * the node says so.
 *
 * A write is three round trips — schedule, push, read the reply — and on this
 * node that is anywhere from one to forty-five seconds. Nothing on the screen
 * moved for any of it, so feeding a companion looked broken until it wasn't.
 *
 * The rule for what may be projected, and it is a narrow one:
 *
 *   - the handler's arithmetic must be reproducible here from state the client
 *     already holds, with no roll, no clock the process owns, and no reward;
 *   - the whole projection must be discardable, because the reply REPLACES the
 *     player record rather than merging into it — a projection is never a
 *     source of truth for a single field, only a picture held until the real
 *     one lands;
 *   - and it must be visibly reversible, because a rejected write rolls it back
 *     under a toast that says why.
 *
 * That admits Feed and Play — deterministic costs, a capped energy change and a
 * status flip, all of which the player can see undo. It does NOT admit
 * anything that rolls dice or moves value: quests, battles, hunts, captures,
 * loot, Rune, gold or the marketplace are authoritative-only, and faking any of
 * them would be showing a player a reward the process has not agreed to. Do not
 * add one here because it would feel faster.
 */
import { BerryItemId, ItemId, Monster, Player } from '../lib/types';

/** `C.MAX_ENERGY` in constants.lua. */
const MAX_ENERGY = 100;
/** `C.ACTIVITIES.feed.energyGain`, doubled for the companion's own element. */
const FEED_ENERGY_GAIN = 10;
/** `C.ACTIVITIES.play` — 10 energy, 15 minutes away. */
const PLAY_ENERGY_COST = 10;
const PLAY_DURATION_MS = 900 * 1000;

const spend = (inventory: Player['inventory'], item: ItemId, amount: number) => ({
  ...inventory,
  [item]: Math.max(0, (inventory[item] ?? 0) - amount),
});

/**
 * Replace one companion everywhere the record mentions it.
 *
 * `monster` and `monsters[activeId]` are the same companion, and a projection
 * that edits one of them leaves the screen showing both numbers at once — the
 * card reads the active slot and the activity rows read the roster.
 */
function withMonster(player: Player, id: string, edit: (m: Monster) => Monster): Player {
  const next: Player = { ...player };
  if (player.monster?.id === id) next.monster = edit(player.monster);
  if (player.monsters?.[id]) {
    next.monsters = { ...player.monsters, [id]: edit(player.monsters[id]) };
  }
  return next;
}

/**
 * `Monster.Feed`: one berry, energy up, capped, and the lifetime counter.
 *
 * The doubling rule is the handler's: a companion's own element's berry is
 * worth twice as much, which is the only reason to hold four kinds.
 */
export const projectFeed = (monster: Monster, item: BerryItemId) => (player: Player): Player => {
  const gain = FEED_ENERGY_GAIN * (itemElement(item) === monster.elementType ? 2 : 1);
  return withMonster(
    { ...player, inventory: spend(player.inventory, item, 1) },
    monster.id,
    (m) => ({
      ...m,
      energy: Math.min(MAX_ENERGY, m.energy + gain),
      totalTimesFed: (m.totalTimesFed ?? 0) + 1,
    }),
  );
};

/**
 * `Monster.Play`: one berry, ten energy, and fifteen minutes away.
 *
 * `since` is the browser's clock, and the process's is authoritative — the
 * countdown this paints can be a second or two out until the reply lands and
 * replaces it. That is the whole error budget of the projection, and it is
 * smaller than the round trip it is covering.
 */
export const projectPlay = (monster: Monster, item: ItemId, now = Date.now()) =>
  (player: Player): Player => withMonster(
    { ...player, inventory: spend(player.inventory, item, 1) },
    monster.id,
    (m) => ({
      ...m,
      energy: Math.max(0, m.energy - PLAY_ENERGY_COST),
      status: { type: 'Play', since: now, until_time: now + PLAY_DURATION_MS },
    }),
  );

/** The element a berry feeds, mirroring `C.ITEMS[item].element`. */
function itemElement(item: BerryItemId): string {
  return item.replace(/_berry$/, '');
}
