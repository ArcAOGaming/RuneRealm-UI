/**
 * Progression-aware choice for a bot that should still feel unscripted.
 *
 * Legality stays in worker.mjs, where candidates are built from fresh chain
 * state. This layer only ranks those legal choices. Hard needs win first;
 * ordinary play remains a weighted lottery whose weights are adjusted by what
 * the account and companion need next.
 */

const weighted = (rows, random, field) => {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row[field] ?? 0), 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const row of rows) {
    roll -= Math.max(0, row[field] ?? 0);
    if (roll <= 0) return row;
  }
  return rows.at(-1) ?? null;
};

const countInventory = (player, names) => names.reduce((sum, name) =>
  sum + Math.max(0, Number(player?.inventory?.[name] ?? 0)), 0);

const berries = ['air_berry', 'water_berry', 'fire_berry', 'rock_berry'];

function progressionMultiplier(name, player, profile) {
  const monster = player?.monster ?? {};
  const energy = Number(monster.energy ?? 0);
  const happiness = Number(monster.happiness ?? 0);
  const boxes = Number(player?.lootboxes?.length ?? 0);
  const berryCount = countInventory(player, berries);
  const exp = Number(monster.exp ?? 0);
  const next = Number(monster.nextLevelExp ?? Number.POSITIVE_INFINITY);
  const closeToLevel = Number.isFinite(next) && next > exp && next - exp <= 15;
  const roster = Object.keys(player?.monsters ?? {}).length;
  const collection = Object.keys(player?.collection ?? {}).length;

  switch (name) {
    case 'daily': return 40;
    case 'feed': return energy < 25 ? 80 : energy < 50 ? 20 : energy < 75 ? 6 : 2;
    case 'play': return happiness < 25 ? 70 : happiness < 50 ? 18 : happiness < 75 ? 5 : 1.5;
    case 'loot': return boxes > 0 ? (berryCount < 16 ? 18 : 4 + Math.min(8, boxes)) : 0;
    case 'quest': return (profile.role === 'quester' ? 6 : 2) * (closeToLevel ? 4 : 1);
    case 'bot': return (profile.role === 'arena' ? 7 : 2) * (closeToLevel ? 3 : 1);
    case 'hunt': return (profile.role === 'collector' || profile.role === 'chaos' ? 5 : 2)
      * (collection + roster < Number(player?.rosterMax ?? 1) + 2 ? 2 : 1);
    case 'retrieve': return roster < Number(player?.rosterMax ?? 1) ? 4 : 1;
    case 'swap': {
      const strongestStored = Math.max(-1,
        ...Object.values(player?.collection ?? {}).map((entry) => Number(entry?.level ?? 0)));
      return strongestStored > Number(monster.level ?? 0) ? 8 : 1.5;
    }
    case 'store': return roster > 2 ? 2.5 : 0.8;
    case 'buy': return collection < 2 ? 2.5 : 1;
    case 'list': return collection > 2 ? 2.5 : 1;
    case 'give': return collection > 3 ? 2 : 0.7;
    case 'shop_trade':
    case 'goods_take': return Number(player?.gold ?? 0) < 100 ? 4 : 1.5;
    case 'goods_make':
    case 'goods_amend': return Number(player?.gold ?? 0) >= 100 ? 2 : 0.8;
    case 'goods_cancel_all': return 0.7;
    case 'goods_maintain': return 0.6;
    case 'venue_internal': return Number(player?.gold ?? 0) >= 100 ? 2.5 : 0.8;
    case 'venue_external': return Number(player?.inventory?.rune ?? 0) > 20 ? 2.5 : 0.7;
    case 'withdraw': return Number(player?.inventory?.rune ?? 0) > 50 ? 2 : 0.6;
    case 'deposit': return Number(player?.inventory?.rune ?? 0) < 20 ? 3 : 1;
    case 'probe': return 0.45;
    default: return 1;
  }
}

export function chooseProgressionAction({
  candidates,
  player,
  profile,
  random,
  prefer,
  explorationRate = 0.12,
  arenaMinEntry = 0,
}) {
  if (!candidates?.length) return { action: null, reason: 'no-legal-action' };
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));

  // Time-sensitive account value and hard companion needs are not gambles.
  if (byName.has('daily')) return { action: 'daily', reason: 'claim-ready-worship' };
  if (Number(player?.monster?.energy ?? 0) < 25 && byName.has('feed')) {
    return { action: 'feed', reason: 'restore-quest-and-arena-energy' };
  }
  if (Number(player?.monster?.happiness ?? 0) < 25 && byName.has('play')) {
    return { action: 'play', reason: 'restore-quest-and-arena-happiness' };
  }
  const needsArenaGold = ((profile.weights?.bot ?? 0) > 0 || profile.role === 'duelist')
    && Number(player?.gold ?? 0) < Number(arenaMinEntry ?? 0);
  if (needsArenaGold && byName.has('shop_trade')) {
    return { action: 'shop_trade', reason: 'sell-surplus-for-arena-stake' };
  }
  if (needsArenaGold && byName.has('quest')) {
    return { action: 'quest', reason: 'quest-for-arena-stake' };
  }

  // The full-world runner may ask this actor to cover a missing path. It still
  // only wins if worker.mjs found that path legal from fresh published state.
  if (prefer && byName.has(prefer)) {
    return { action: prefer, reason: `coverage:${prefer}` };
  }

  const rows = candidates.map((candidate) => ({
    ...candidate,
    utility: Math.max(0, Number(candidate.weight ?? 0))
      * progressionMultiplier(candidate.name, player, profile),
  }));

  // A small exploration share uses the role's original weights. Most turns
  // use progression utility, but both paths are lotteries: two bots in the
  // same state do not march through a fixed script.
  const explore = random() < explorationRate;
  const picked = weighted(rows, random, explore ? 'weight' : 'utility')
    ?? weighted(rows, random, 'weight');
  return {
    action: picked?.name ?? null,
    reason: explore ? 'role-weighted-exploration' : 'progression-weighted',
  };
}
