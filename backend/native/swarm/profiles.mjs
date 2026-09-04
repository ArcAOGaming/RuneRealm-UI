/**
 * Stable identities and behavior for the fifty test wallets.
 *
 * Private keys never appear here. A profile is safe to commit: it only maps a
 * burner filename to a role that the swarm runner can explain and reproduce.
 */

export const FACTIONS = [
  'Sky Nomads',
  'Aqua Guardians',
  'Inferno Blades',
  'Stone Titans',
];

/**
 * Every reversible player capability selected by the routine dispatcher.
 *
 * Keep this list explicit: `swarm.test.mjs` requires every role to make a
 * deliberate choice for every adapter, including a weight of zero. A new
 * action therefore cannot exist in the worker while silently disappearing
 * from some (or all) of the fifty-wallet fleet.
 */
export const ROUTINE_ACTIONS = Object.freeze([
  'daily', 'quest', 'loot', 'feed', 'play', 'hunt', 'bot',
  'store', 'retrieve', 'swap', 'list', 'buy', 'cancel', 'give',
  'goods_make', 'goods_take', 'goods_cancel', 'shop_trade', 'arbitrage', 'probe',
  // The Rune bridge and the AMM pair. `withdraw` mints game Rune out to the
  // token; `deposit` burns it back in. They are the two halves of the same
  // saga and a fleet that only ever ran one of them would drain the game.
  // `liquidity` funds the pair, `trade` swaps against it.
  'withdraw', 'deposit', 'liquidity', 'trade',
]);

export const ROLE_DEFINITIONS = Object.freeze({
  quester: {
    label: 'Quest runner',
    weights: { daily: 4, quest: 12, loot: 3, feed: 5, play: 1, hunt: 3, bot: 1, store: 3, retrieve: 3, swap: 2, list: 2, buy: 2, cancel: 1, give: 1, goods_make: 3, goods_take: 5, goods_cancel: 2, shop_trade: 8, arbitrage: 3, probe: 4, withdraw: 1, deposit: 1, liquidity: 0, trade: 1 },
    statPlan: { attack: 2, defense: 2, speed: 2, health: 4 },
    botDifficulty: 0.8,
  },
  caretaker: {
    label: 'Companion caretaker',
    weights: { daily: 4, quest: 1, loot: 3, feed: 12, play: 10, hunt: 2, bot: 0, store: 4, retrieve: 5, swap: 5, list: 1, buy: 2, cancel: 1, give: 1, goods_make: 2, goods_take: 6, goods_cancel: 2, shop_trade: 10, arbitrage: 2, probe: 4, withdraw: 1, deposit: 1, liquidity: 0, trade: 1 },
    statPlan: { attack: 2, defense: 2, speed: 1, health: 5 },
    botDifficulty: 0.7,
  },
  arena: {
    label: 'Bot arena fighter',
    weights: { daily: 4, quest: 0, loot: 3, feed: 5, play: 1, hunt: 4, bot: 14, store: 2, retrieve: 3, swap: 4, list: 1, buy: 2, cancel: 1, give: 1, goods_make: 2, goods_take: 8, goods_cancel: 2, shop_trade: 8, arbitrage: 4, probe: 4, withdraw: 1, deposit: 1, liquidity: 0, trade: 2 },
    statPlan: { attack: 5, defense: 1, speed: 2, health: 2 },
    botDifficulty: 1.2,
  },
  duelist: {
    label: 'PvP duelist',
    weights: { daily: 5, quest: 0, loot: 2, feed: 6, play: 2, hunt: 0, bot: 0, store: 2, retrieve: 2, swap: 3, list: 1, buy: 1, cancel: 1, give: 1, goods_make: 2, goods_take: 7, goods_cancel: 2, shop_trade: 8, arbitrage: 4, probe: 3, withdraw: 0, deposit: 0, liquidity: 0, trade: 0 },
    statPlan: { attack: 4, defense: 2, speed: 3, health: 1 },
    botDifficulty: 1,
  },
  collector: {
    label: 'Loot collector',
    weights: { daily: 12, quest: 3, loot: 14, feed: 5, play: 2, hunt: 3, bot: 1, store: 5, retrieve: 4, swap: 2, list: 8, buy: 10, cancel: 3, give: 3, goods_make: 12, goods_take: 10, goods_cancel: 4, shop_trade: 12, arbitrage: 8, probe: 5, withdraw: 6, deposit: 5, liquidity: 6, trade: 8 },
    statPlan: { attack: 2, defense: 3, speed: 2, health: 3 },
    botDifficulty: 0.8,
  },
  progression: {
    label: 'Progression generalist',
    weights: { daily: 5, quest: 6, loot: 5, feed: 5, play: 4, hunt: 3, bot: 6, store: 4, retrieve: 4, swap: 4, list: 4, buy: 4, cancel: 2, give: 2, goods_make: 6, goods_take: 6, goods_cancel: 3, shop_trade: 7, arbitrage: 5, probe: 5, withdraw: 3, deposit: 3, liquidity: 2, trade: 4 },
    statPlan: { attack: 3, defense: 2, speed: 3, health: 2 },
    botDifficulty: 1,
  },
  chaos: {
    label: 'Randomized explorer',
    weights: { daily: 5, quest: 5, loot: 5, feed: 5, play: 5, hunt: 3, bot: 5, store: 5, retrieve: 5, swap: 5, list: 5, buy: 5, cancel: 5, give: 5, goods_make: 8, goods_take: 8, goods_cancel: 6, shop_trade: 8, arbitrage: 8, probe: 12, withdraw: 4, deposit: 4, liquidity: 3, trade: 6 },
    statPlan: { attack: 2, defense: 3, speed: 3, health: 2 },
    botDifficulty: 0.5,
  },
});

// callSign, role, faction, description, optional PvP pair and side.
const ASSIGNMENTS = [
  ['Ashrunner', 'quester', 'Inferno Blades', 'Runs long fire quests and claims every completed expedition.'],
  ['Cloudpath', 'quester', 'Sky Nomads', 'Keeps an air companion on a steady quest-and-recovery loop.'],
  ['Tidewalker', 'quester', 'Aqua Guardians', 'Tests water quest costs, rewards, loot, and later claims.'],
  ['Flinttrail', 'quester', 'Stone Titans', 'Pushes a rock companion through resource-limited questing.'],
  ['Embermap', 'quester', 'Inferno Blades', 'Prioritizes quest experience and health-heavy level allocations.'],
  ['Rainroute', 'quester', 'Aqua Guardians', 'Alternates quest rewards with feeding and chest cleanup.'],
  ['Highwind', 'quester', 'Sky Nomads', 'Exercises long-lived activities across repeated harness runs.'],
  ['Cairnroad', 'quester', 'Stone Titans', 'Acts as a conservative quester that keeps resources in reserve.'],

  ['Hearthkeeper', 'caretaker', 'Inferno Blades', 'Feeds and plays with its companion whenever care is useful.'],
  ['Mistkeeper', 'caretaker', 'Aqua Guardians', 'Focuses on happiness recovery, berries, and play claims.'],
  ['Nestkeeper', 'caretaker', 'Sky Nomads', 'Keeps companion care counters and energy changes moving.'],
  ['Denkeeper', 'caretaker', 'Stone Titans', 'Stress-tests repeated feeding and defensive stat growth.'],
  ['Kindlecare', 'caretaker', 'Inferno Blades', 'Consumes fire berries and checks full-energy edge behavior.'],
  ['Reefcare', 'caretaker', 'Aqua Guardians', 'Maintains a water companion and opens spare reward chests.'],
  ['Gustcare', 'caretaker', 'Sky Nomads', 'Balances play sessions, feeding, daily claims, and idle timers.'],

  ['Redblade', 'arena', 'Inferno Blades', 'Runs aggressive bot battles at above-normal difficulty.'],
  ['Blueguard', 'arena', 'Aqua Guardians', 'Grinds bot sessions and records wins, losses, and move use.'],
  ['Whitegale', 'arena', 'Sky Nomads', 'Favors fast attack growth while repeatedly exercising combat.'],
  ['Greywall', 'arena', 'Stone Titans', 'Provides durable bot fights that probe round-limit behavior.'],
  ['Sparkspear', 'arena', 'Inferno Blades', 'Spends runes on arena sessions and prioritizes damaging moves.'],
  ['Riptide', 'arena', 'Aqua Guardians', 'Tests water matchups across randomized bot opponents.'],
  ['Crosswind', 'arena', 'Sky Nomads', 'Exercises accuracy, speed, and elemental effectiveness in combat.'],
  ['Boulderhand', 'arena', 'Stone Titans', 'Produces slower defensive fights and sustained battle logs.'],
  ['Wildfire', 'arena', 'Inferno Blades', 'Uses higher bot difficulty to generate loss-path coverage.'],
  ['Undertow', 'arena', 'Aqua Guardians', 'Keeps arena session rollover and loot payouts active.'],

  ['Cinder', 'duelist', 'Inferno Blades', 'Challenges Tide in a fixed targeted PvP pairing.', 'cinder-tide', 'challenger'],
  ['Tide', 'duelist', 'Aqua Guardians', 'Accepts Cinder and resolves the second half of each PvP round.', 'cinder-tide', 'accepter'],
  ['Gale', 'duelist', 'Sky Nomads', 'Challenges Granite to test air-versus-rock PvP.', 'gale-granite', 'challenger'],
  ['Granite', 'duelist', 'Stone Titans', 'Accepts Gale and exercises defensive PvP move selection.', 'gale-granite', 'accepter'],
  ['Steam', 'duelist', 'Aqua Guardians', 'Challenges Brand in a water-versus-fire PvP loop.', 'steam-brand', 'challenger'],
  ['Brand', 'duelist', 'Inferno Blades', 'Accepts Steam and tests committed-move ordering.', 'steam-brand', 'accepter'],
  ['Squall', 'duelist', 'Sky Nomads', 'Challenges Ash and helps expose concurrent round races.', 'squall-ash', 'challenger'],
  ['Ash', 'duelist', 'Inferno Blades', 'Accepts Squall and supplies the opposing elemental strategy.', 'squall-ash', 'accepter'],
  ['Deep', 'duelist', 'Aqua Guardians', 'Challenges Crag in a long defensive PvP matchup.', 'deep-crag', 'challenger'],
  ['Crag', 'duelist', 'Stone Titans', 'Accepts Deep and tests settlement for the final duel pair.', 'deep-crag', 'accepter'],

  ['Chestwatch', 'collector', 'Sky Nomads', 'Claims dailies and opens every available chest for loot coverage.'],
  ['Gemledger', 'collector', 'Stone Titans', 'Builds a varied inventory and records randomized chest rewards.'],
  ['Berrybook', 'collector', 'Aqua Guardians', 'Turns loot into feeding while tracking water-berry consumption.'],
  ['Runecounter', 'collector', 'Inferno Blades', 'Drives the Rune bridge and the AMM pair: withdraws, funds liquidity, swaps, and burns back in.'],
  ['Satchel', 'collector', 'Stone Titans', 'Keeps inventory, lootbox rarity, and reward serialization busy.'],

  ['Wayfarer', 'progression', 'Sky Nomads', 'Mixes quests, care, loot, bot battles, and balanced level-ups.'],
  ['Mariner', 'progression', 'Aqua Guardians', 'Acts like a broad normal player with no single dominant action.'],
  ['Torchbearer', 'progression', 'Inferno Blades', 'Moves through the full progression loop with moderate risk.'],
  ['Mason', 'progression', 'Stone Titans', 'Builds a balanced rock companion across every reversible feature.'],
  ['Drifter', 'progression', 'Sky Nomads', 'Provides a second generalist path with different random timing.'],

  ['Dicefire', 'chaos', 'Inferno Blades', 'Chooses uniformly among every currently legal routine action.'],
  ['Dicewater', 'chaos', 'Aqua Guardians', 'Supplies randomized water behavior for broad soak coverage.'],
  ['Diceair', 'chaos', 'Sky Nomads', 'Supplies randomized air behavior and low-difficulty bot fights.'],
  ['Dicerock', 'chaos', 'Stone Titans', 'Supplies randomized rock behavior and unusual action sequences.'],
  ['Wildcard', 'chaos', 'Aqua Guardians', 'Acts as the final catch-all account for future action adapters.'],
];

export const PROFILES = Object.freeze(ASSIGNMENTS.map((assignment, index) => {
  const [callSign, role, faction, description, pvpPair, pvpSide] = assignment;
  const behavior = ROLE_DEFINITIONS[role];
  return Object.freeze({
    wallet: `burner-${String(index + 1).padStart(2, '0')}`,
    callSign,
    role,
    roleLabel: behavior.label,
    faction,
    description,
    weights: behavior.weights,
    statPlan: behavior.statPlan,
    botDifficulty: behavior.botDifficulty,
    ...(pvpPair ? { pvpPair, pvpSide } : {}),
  });
}));

export function profileFor(wallet) {
  return PROFILES.find((profile) => profile.wallet === wallet);
}

export function pvpPairs(profiles = PROFILES) {
  const grouped = new Map();
  for (const profile of profiles.filter((candidate) => candidate.pvpPair)) {
    const pair = grouped.get(profile.pvpPair) ?? {};
    pair[profile.pvpSide] = profile;
    grouped.set(profile.pvpPair, pair);
  }
  return [...grouped.entries()]
    .filter(([, pair]) => pair.challenger && pair.accepter)
    .map(([name, pair]) => ({ name, ...pair }));
}
