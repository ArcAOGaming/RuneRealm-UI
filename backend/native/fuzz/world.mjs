/**
 * The shadow world: what the fuzzer believes the process holds.
 *
 * Every prediction in `ops.mjs` is made against this mirror, and the mirror is
 * rebuilt from published replies rather than from what the fuzzer asked for.
 * That direction matters. A model that updated itself from its own intentions
 * would agree with itself forever; one that updates only from what the process
 * actually published disagrees the moment the process does something else, and
 * disagreement is the entire output of this tool.
 */

/** Number of companions a player is actively raising. */
export const rosterIds = (view) => Object.keys(view?.monsters ?? {});
/** Owned but not active. Unbounded, and the only place a listing comes from. */
export const collectionIds = (view) => Object.keys(view?.collection ?? {});
export const runes = (view) => Number(view?.inventory?.rune ?? 0);
export const itemCount = (view, item) => Number(view?.inventory?.[item] ?? 0);

/**
 * A companion's identity across owners.
 *
 * Monster ids are PER PLAYER and are reissued on every hand-off, so `m1` names
 * a different creature in every account and the same creature carries a
 * different id after it is sold. Nothing that follows a companion from one
 * owner to the next can key on the id, so it keys on this instead: the birth
 * timestamp, the name, and the four rolled move names. All five are written
 * once at creation and no handler touches them again.
 *
 * Stats, status and move counts deliberately stay out of it, because a
 * companion that levelled up or spent a move is still the same companion. The
 * cost of that choice is that two companions created for the same account in
 * the same millisecond with the same roll are indistinguishable here, which is
 * why a fingerprint collision is reported as a warning to look at rather than
 * as a duplication failure.
 */
export const fingerprint = (monster) => {
  if (!monster) return null;
  const moves = Object.keys(monster.moves ?? {}).sort().join(',');
  return `${monster.bornAt ?? 0}:${monster.name ?? '?'}:${moves}`;
};

export class World {
  constructor({ rosterMax = 1, minPrice = 1, maxPrice = 1_000_000 } = {}) {
    /** address -> last published player view. */
    this.players = new Map();
    /** listing id -> last published listing. */
    this.market = new Map();
    this.economy = null;
    this.rosterMax = rosterMax;
    this.minPrice = minPrice;
    this.maxPrice = maxPrice;
    /**
     * How many companions are believed to exist anywhere.
     *
     * Only three things move it: adoption and an owner grant create one, and a
     * completed mint takes one out of the game. Storing, retrieving, selling,
     * buying and transferring are all MOVES, so a population that changed
     * across any of those is a companion duplicated or destroyed, which is the
     * one bug in this feature that would mint value out of nothing.
     */
    this.population = null;
    this.populationDelta = 0;
  }

  view(address) { return this.players.get(address) ?? null; }

  /**
   * Absorb a player view from any reply that carried one.
   *
   * The address has to come from the REPLY, never from whoever was asked. Half
   * the verbs here answer with somebody else's record — an admin write
   * publishes the player it acted on, not the signer — and several answer with
   * no player at all. Filing one of those under the caller would quietly
   * poison every prediction made about that account afterwards.
   */
  observe(view) {
    if (!view || typeof view !== 'object' || view.error) return;
    if (typeof view.address !== 'string' || !view.address) return;
    this.players.set(view.address, view);
    if (Number.isFinite(view.rosterMax)) this.rosterMax = view.rosterMax;
  }

  /** Absorb the published market, which rides on every reply. */
  observeMarket(market) {
    if (!market || typeof market !== 'object') return;
    this.market = new Map(Object.entries(market));
  }

  observeEconomy(economy) {
    if (economy && typeof economy === 'object') this.economy = economy;
  }

  listing(id) { return this.market.get(id) ?? null; }
  listingIds() { return [...this.market.keys()]; }

  /** Every listing this address is the seller of. */
  listingsBy(address) {
    return [...this.market.values()].filter((entry) => entry.seller === address);
  }

  /** Every listing this address could legally buy, given what it holds. */
  affordableListings(address) {
    const held = runes(this.view(address));
    return [...this.market.values()]
      .filter((entry) => entry.seller !== address && Number(entry.price) <= held);
  }

  /**
   * The companion population as the fuzzer can see it, over a full state sweep.
   *
   * `views` must be every account the run touches, or this undercounts and the
   * conservation check becomes noise. The market is counted once, separately:
   * an escrowed companion is in nobody's collection by design.
   */
  countPopulation(views) {
    let total = this.market.size;
    const seen = new Map();
    const duplicates = [];
    for (const view of views) {
      if (!view || view.error) continue;
      total += rosterIds(view).length + collectionIds(view).length;
      const all = [
        ...Object.values(view.monsters ?? {}),
        ...Object.values(view.collection ?? {}),
      ];
      for (const monster of all) {
        const print = fingerprint(monster);
        if (!print) continue;
        const owner = `${view.address}`;
        if (seen.has(print)) duplicates.push({ fingerprint: print, owners: [seen.get(print), owner] });
        else seen.set(print, owner);
      }
    }
    for (const entry of this.market.values()) {
      const print = fingerprint(entry.monster);
      if (print && seen.has(print)) {
        duplicates.push({ fingerprint: print, owners: [seen.get(print), `market:${entry.id}`] });
      }
    }
    return { total, duplicates };
  }
}
