/**
 * Public identities for the local test swarm.
 *
 * This file is safe to ship: it contains addresses and test intent only. The
 * corresponding JWKs stay in the gitignored `.burners/` directory and must
 * never be imported by browser code.
 */

export type SwarmRole =
  | 'quester'
  | 'caretaker'
  | 'arena'
  | 'duelist'
  | 'collector'
  | 'progression'
  | 'chaos';

export type SwarmFaction =
  | 'Inferno Blades'
  | 'Aqua Guardians'
  | 'Sky Nomads'
  | 'Stone Titans';

export interface SwarmWalletProfile {
  wallet: string;
  address: string;
  callSign: string;
  role: SwarmRole;
  roleLabel: string;
  faction: SwarmFaction;
  description: string;
  pvpPair?: string;
  pvpSide?: 'challenger' | 'accepter';
}

const ROLE_LABELS: Record<SwarmRole, string> = {
  quester: 'Quest runner',
  caretaker: 'Companion caretaker',
  arena: 'Bot arena fighter',
  duelist: 'PvP duelist',
  collector: 'Loot collector',
  progression: 'Progression generalist',
  chaos: 'Randomized explorer',
};

type ProfileRow = readonly [
  wallet: string,
  address: string,
  callSign: string,
  role: SwarmRole,
  faction: SwarmFaction,
  description: string,
];

const ROWS: readonly ProfileRow[] = [
  ['burner-01', 'nmayR9TJ6zSl1_ZdKAbqsP19hy3CCV4Ffeqtx2E6Lzg', 'Ashrunner', 'quester', 'Inferno Blades', 'Runs long fire quests and claims every completed expedition.'],
  ['burner-02', 'cE0TD-WqbaazdFy8Y8qGGxfKVy0z2D1GamgIjB0daws', 'Cloudpath', 'quester', 'Sky Nomads', 'Keeps an air companion on a steady quest-and-recovery loop.'],
  ['burner-03', '_TTLEBiWKaLGY8S_pSrsJ5Eie3gRhP2ZWR4RgL7bQG8', 'Tidewalker', 'quester', 'Aqua Guardians', 'Tests water quest costs, rewards, loot, and later claims.'],
  ['burner-04', 'dRbI7z__cUdhQMT9CDw8XIm9S1pdWRSCdH1Uc00NS6Y', 'Flinttrail', 'quester', 'Stone Titans', 'Pushes a rock companion through resource-limited questing.'],
  ['burner-05', 'AZa4_qW5FDX1EBucY8_hwFsP5Br8pTCS4OwqZi4vwKQ', 'Embermap', 'quester', 'Inferno Blades', 'Prioritizes quest experience and health-heavy level allocations.'],
  ['burner-06', 'AtYWgOnQxXoalaaRZFtJ4AdKDoo23yh6jI0B1gNlwiI', 'Rainroute', 'quester', 'Aqua Guardians', 'Alternates quest rewards with feeding and chest cleanup.'],
  ['burner-07', 'CV2QRgkdD9KZwfSXirgnSV-Rin1_EUQB22SHMqHyrmI', 'Highwind', 'quester', 'Sky Nomads', 'Exercises long-lived activities across repeated harness runs.'],
  ['burner-08', 'RmfBu_1SP8wYwp8fU9aGQrufiQungmXK_46XJ5bjYP8', 'Cairnroad', 'quester', 'Stone Titans', 'Acts as a conservative quester that keeps resources in reserve.'],
  ['burner-09', '-1VKf5iouA9PnULq2SO5nvLZPUp9rTlcCEzhW6pb9mU', 'Hearthkeeper', 'caretaker', 'Inferno Blades', 'Feeds and plays with its companion whenever care is useful.'],
  ['burner-10', 'OO4hhmx5mGlAK0j1zEhzfz72zNS-FhUj70rlwXwhWt4', 'Mistkeeper', 'caretaker', 'Aqua Guardians', 'Focuses on happiness recovery, berries, and play claims.'],
  ['burner-11', '3IThR2iIReDQ4X75jfZXcqkQPHo9A4rQCP8tM7RiC4I', 'Nestkeeper', 'caretaker', 'Sky Nomads', 'Keeps companion care counters and energy changes moving.'],
  ['burner-12', 'Z6-4ibcydfVsNDmFM8lGmb3Za0HWJwCoOME09FNZq6w', 'Denkeeper', 'caretaker', 'Stone Titans', 'Stress-tests repeated feeding and defensive stat growth.'],
  ['burner-13', 'fggcDSakB0ZwVruJQ1r9UCOeMo_WDoyUo5zUipqZeMU', 'Kindlecare', 'caretaker', 'Inferno Blades', 'Consumes fire berries and checks full-energy edge behavior.'],
  ['burner-14', 'Rrot7aTmESMH3z-l3bF5OiJYmeaDgo0riO7WMk2JxxU', 'Reefcare', 'caretaker', 'Aqua Guardians', 'Maintains a water companion and opens spare reward chests.'],
  ['burner-15', 'iwJx7QqsNtEwrtDlvh5eCVF9NrTuwx7l-T_VH0QWkTw', 'Gustcare', 'caretaker', 'Sky Nomads', 'Balances play sessions, feeding, daily claims, and idle timers.'],
  ['burner-16', 'ZxdE0Rd2Dz88xST8dqD0GxiCgdxmYBDB_p1840b4fjE', 'Redblade', 'arena', 'Inferno Blades', 'Runs aggressive bot battles at above-normal difficulty.'],
  ['burner-17', '26OBG86KTY49R7uorqLyAeqLv3BD2Oi5VKx-ECiYcjg', 'Blueguard', 'arena', 'Aqua Guardians', 'Grinds bot sessions and records wins, losses, and move use.'],
  ['burner-18', 'Ud11zB6UiHk2DuCzwLdIeK7VI_YWIb30agrYj1enoyM', 'Whitegale', 'arena', 'Sky Nomads', 'Favors fast attack growth while repeatedly exercising combat.'],
  ['burner-19', 'f4iWi4fjTcwK-_xW8ks05EH5PYDrSfcXS7dYAw8apGI', 'Greywall', 'arena', 'Stone Titans', 'Provides durable bot fights that probe round-limit behavior.'],
  ['burner-20', 'mI9rvjP62PRt8_7qFjrFCoOImngWmBEflj7pkcrDUIU', 'Sparkspear', 'arena', 'Inferno Blades', 'Spends runes on arena sessions and prioritizes damaging moves.'],
  ['burner-21', 'E9cV0IG-aXtxjenPb15HBLZaxQZ_LrJb8r07ij1Jb58', 'Riptide', 'arena', 'Aqua Guardians', 'Tests water matchups across randomized bot opponents.'],
  ['burner-22', 'nhRat0LQgMumGrby_fN5yYDlDejVDNk8_59EkgNRB5c', 'Crosswind', 'arena', 'Sky Nomads', 'Exercises accuracy, speed, and elemental effectiveness in combat.'],
  ['burner-23', 'GkZsvoyJwXvwlT9i16NQS3oaPqjAyVV9x4Mn692tEow', 'Boulderhand', 'arena', 'Stone Titans', 'Produces slower defensive fights and sustained battle logs.'],
  ['burner-24', 'FwQvt2zn303cMEyDepS3L6vpUz54YrYGD7xL4t2rqZM', 'Wildfire', 'arena', 'Inferno Blades', 'Uses higher bot difficulty to generate loss-path coverage.'],
  ['burner-25', '0HTxfelB5WIILr1RHFZBylIyObM0WFgvkUWw14vZ3QM', 'Undertow', 'arena', 'Aqua Guardians', 'Keeps arena session rollover and loot payouts active.'],
  ['burner-26', 'HghbeIvQxTiF-DYSUAnmEbAbP-r6sBzL6Qb7JAO88LI', 'Cinder', 'duelist', 'Inferno Blades', 'Challenges Tide in a fixed targeted PvP pairing.'],
  ['burner-27', 'dAhjECcGxcFWnrd99nNKOW4KvAePezKbhlL0WDrNKJs', 'Tide', 'duelist', 'Aqua Guardians', 'Accepts Cinder and resolves the second half of each PvP round.'],
  ['burner-28', 'PO6-o0zao4JQm9whIWT62a47COMQz7DyYvWkbKZiY80', 'Gale', 'duelist', 'Sky Nomads', 'Challenges Granite to test air-versus-rock PvP.'],
  ['burner-29', 'bK9w11tAxhr8VDuMOeda5ZMkMSZSp5SLvFJRCz9K6YM', 'Granite', 'duelist', 'Stone Titans', 'Accepts Gale and exercises defensive PvP move selection.'],
  ['burner-30', '2z9jF_gQgexLbMMno3P2ojJoeexj0TcdkytP7vQLWnI', 'Steam', 'duelist', 'Aqua Guardians', 'Challenges Brand in a water-versus-fire PvP loop.'],
  ['burner-31', 'QFZ6Z07Bynd3UhzGAAZZo5BmjIjrOgDI4eUL6OE_CCI', 'Brand', 'duelist', 'Inferno Blades', 'Accepts Steam and tests committed-move ordering.'],
  ['burner-32', 'oUwy4w44YTLCvJH6RblE2dsXIN5kkKBsQCMoXbOuvA4', 'Squall', 'duelist', 'Sky Nomads', 'Challenges Ash and helps expose concurrent round races.'],
  ['burner-33', 'yNoJY9JLTXU6PGt4w-LO8EvT5RpWswXmbuHfnkfu5oA', 'Ash', 'duelist', 'Inferno Blades', 'Accepts Squall and supplies the opposing elemental strategy.'],
  ['burner-34', 'jJmHKqHsSwzy-uo30N-O_yYfAcsqyLvQd_MF1kpr9iQ', 'Deep', 'duelist', 'Aqua Guardians', 'Challenges Crag in a long defensive PvP matchup.'],
  ['burner-35', 'hKGhfWMjCnEQbIrD83KT5QjvRg6gdGP8mKAzGiPH6W4', 'Crag', 'duelist', 'Stone Titans', 'Accepts Deep and tests settlement for the final duel pair.'],
  ['burner-36', 'HGkH-1z--UnWpeU8-7PEYky8yFiyDvGejctg0MxP5c0', 'Chestwatch', 'collector', 'Sky Nomads', 'Claims dailies and opens every available chest for loot coverage.'],
  ['burner-37', 'TeLClQMvZzROk31yL1lUOn4ysGjM_GdBZXyOKF_7dpg', 'Gemledger', 'collector', 'Stone Titans', 'Builds a varied inventory and records randomized chest rewards.'],
  ['burner-38', 'nq8saJ7h7pi-oIhJ423rCW7sSqhnZ5q-aj-xsGVp-Qc', 'Berrybook', 'collector', 'Aqua Guardians', 'Turns loot into feeding while tracking water-berry consumption.'],
  ['burner-39', '2wIIgjQCvAWkpyTzp1WpmkO2yQvut7sW9vAppyGbEDA', 'Runecounter', 'collector', 'Inferno Blades', 'Exercises the Rune faucet and spending paths without withdrawal.'],
  ['burner-40', 'OApL0HxPqomql9WSs7d1d_9yzT-fdFXNZtHi0TbmXiA', 'Satchel', 'collector', 'Stone Titans', 'Keeps inventory, lootbox rarity, and reward serialization busy.'],
  ['burner-41', '9cFr2nlrhAu9VidILi7p1wbq5qdAdi95kr0NVLNOyg4', 'Wayfarer', 'progression', 'Sky Nomads', 'Mixes quests, care, loot, bot battles, and balanced level-ups.'],
  ['burner-42', 'fbhip50ZaLYiL9L1bPik6KvFxNNMYFBaOQdb9S5emuI', 'Mariner', 'progression', 'Aqua Guardians', 'Acts like a broad normal player with no single dominant action.'],
  ['burner-43', 'vaieY0vvpfBLoZPZLkaa9DcjVdDjE5IgZi91wQFHN70', 'Torchbearer', 'progression', 'Inferno Blades', 'Moves through the full progression loop with moderate risk.'],
  ['burner-44', 'AL8c2mAQzjgGFMe8n-kIBC8QwjqHiPHGIb5abZ2Dk40', 'Mason', 'progression', 'Stone Titans', 'Builds a balanced rock companion across every reversible feature.'],
  ['burner-45', '5B50VeNrw2egcqAeWw9MpjpKrcyoOgNkz4pws6P8ARI', 'Drifter', 'progression', 'Sky Nomads', 'Provides a second generalist path with different random timing.'],
  ['burner-46', 'IWeO7Ig98g4DUlokCFqIDqvWLNGiVJO6d5L0SawoB74', 'Dicefire', 'chaos', 'Inferno Blades', 'Chooses uniformly among every currently legal routine action.'],
  ['burner-47', 'ZV1-YxUrYPKmXUxeFIkRvx-bAyM8qws4Z9HDyOZ1wmI', 'Dicewater', 'chaos', 'Aqua Guardians', 'Supplies randomized water behavior for broad soak coverage.'],
  ['burner-48', 'AY5Vdi9QMH7Ewil6hNchpu64KRl0wP_lVJvHrMPA0tA', 'Diceair', 'chaos', 'Sky Nomads', 'Supplies randomized air behavior and low-difficulty bot fights.'],
  ['burner-49', 'NRVgznPf56nVN4ENxlltxytmkOR86rYWd8Qbs1upJ1w', 'Dicerock', 'chaos', 'Stone Titans', 'Supplies randomized rock behavior and unusual action sequences.'],
  ['burner-50', 'aQm5TEcP5tGShuSyfw9_AFZiBqc2gdwfyoi9H3DLI_I', 'Wildcard', 'chaos', 'Aqua Guardians', 'Acts as the final catch-all account for future action adapters.'],
];

const DUEL_PAIRS = [
  ['cinder-tide', 25, 26],
  ['gale-granite', 27, 28],
  ['steam-brand', 29, 30],
  ['squall-ash', 31, 32],
  ['deep-crag', 33, 34],
] as const;

export const SWARM_WALLETS: readonly SwarmWalletProfile[] = Object.freeze(
  ROWS.map(([wallet, address, callSign, role, faction, description], index) => {
    const duel = DUEL_PAIRS.find(([, challenger, accepter]) => (
      index === challenger || index === accepter
    ));
    return Object.freeze({
      wallet,
      address,
      callSign,
      role,
      roleLabel: ROLE_LABELS[role],
      faction,
      description,
      ...(duel ? {
        pvpPair: duel[0],
        pvpSide: index === duel[1] ? 'challenger' as const : 'accepter' as const,
      } : {}),
    });
  }),
);

export const SWARM_ADDRESSES = new Set(SWARM_WALLETS.map(({ address }) => address));
