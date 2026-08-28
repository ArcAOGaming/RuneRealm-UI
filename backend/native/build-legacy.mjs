/**
 * build-legacy.mjs — turn the recovered legacynet snapshot into player records
 * the live process can actually load.
 *
 *   node backend/native/recover-state.mjs     # first: pull the archive
 *   node backend/native/build-legacy.mjs      # then: map it
 *   HB_WALLET=key.json node backend/native/deploy.mjs --seed-legacy
 *
 * Input is `snapshot/`, written by `recover-state.mjs`. Output is
 * `legacy-players.json`, whose rows are exactly the shape `Admin.Load` takes —
 * the same door a redeploy already walks players through.
 *
 * What carries across, and what cannot:
 *
 *   faction, companion, level, exp, stats, energy, happiness, feed/play/quest
 *   counters, loot boxes, and berry balances all carry. The old and new
 *   progressions turn out to be the same shape — a base stat total of 10 and
 *   ten points a level — so stats transfer with no rescaling. Verified against
 *   all 93 companions.
 *
 *   WINS AND LOSSES DO NOT EXIST to carry. The old game never persisted them:
 *   MultiBattle held `battles`, `battleLogs` and `activeBattles`, all of which
 *   are per-fight, and its last checkpoint is August 2025 while the game ran to
 *   February 2026. Everyone lands on 0/0.
 *
 *   Moves are re-derived rather than copied. A move's numbers were retuned when
 *   type effectiveness was fixed (§5.1 of HANDOFF.md), so a roster is rebuilt
 *   from the names the player actually had, using the CURRENT definition of
 *   each. Names the new pools no longer have are dropped and made up
 *   deterministically from the companion's own element.
 *
 *   Skins are recovered but deliberately NOT loaded. The 85 that survived are
 *   written to `legacy-skins.json` and stay there: the character creator is
 *   being rebuilt and everyone makes a new avatar, so restoring an old
 *   `spriteTxId` would only pin people to art from the previous game. The
 *   archive keeps them if that is ever reconsidered.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ensureMemory64, luaSandbox } from './aoloader.mjs';

ensureMemory64(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(HERE, 'snapshot');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

/**
 * A cap on carried berries, off by default.
 *
 * The old berries were bought with legacynet tokens and the top holder has
 * 6,282 of them, against a new economy where feeding costs one. Capping is a
 * balance decision rather than a recovery one, so it is a flag: the archive
 * keeps the true number either way.
 */
const BERRY_CAP = Number(arg('--berry-cap', '0')) || 0;

/**
 * The Rune every recovered player starts with.
 *
 * It lands as an IN-GAME balance, not as minted token supply: Rune is earned in
 * the game and only becomes circulating supply when somebody withdraws it, so
 * the token's supply stays at zero until a player asks for it. 25 is roughly
 * eight days of the daily stipend, against one Rune per quest and one per
 * four-battle arena session — enough to actually play on return without being
 * a windfall.
 *
 * Safe on a redeploy because `Admin.Load` SETS an inventory count rather than
 * adding to it, and the legacy rows load BEFORE the live migration: a returning
 * player is seeded 25 and then immediately overwritten by whatever they really
 * hold. Someone who never came back keeps the full 25, which is correct — they
 * have not spent any.
 */
const LAUNCH_RUNE = Number(arg('--rune', '25'));

/** A snapshot is stored gzipped when it is large. Read either form. */
const readSnapshot = (name) => {
  const plain = path.join(SNAP, `${name}.json`);
  if (fs.existsSync(plain)) return JSON.parse(fs.readFileSync(plain, 'utf8'));
  const gz = `${plain}.gz`;
  if (fs.existsSync(gz)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
  return null;
};

const prempass = readSnapshot('prempass');
if (!prempass) {
  console.error('snapshot/prempass.json is missing — run recover-state.mjs first');
  process.exit(1);
}

// -- the current game's own constants ---------------------------------------

// Read constants.lua with a real Lua interpreter rather than a regex: it is
// the authority on faction names, move numbers, item ids and caps, and a
// mapping built from a stale copy of any of those would load wrong data.
const lua = await luaSandbox();
const constantsSource = fs.readFileSync(path.join(HERE, 'constants.lua'), 'utf8');
const C = await lua.json('C', `local chunk = load([==[\n${constantsSource}\n]==])\nlocal C = chunk()`);
console.log(`constants.lua: ${C.FACTIONS.length} factions, ` +
  `${Object.keys(C.MOVE_POOLS).length} move pools, ${Object.keys(C.ITEMS).length} items`);

const FACTION_BY_NAME = Object.fromEntries(C.FACTIONS.map((f) => [f.name, f]));
const FACTION_BY_ELEMENT = Object.fromEntries(C.FACTIONS.map((f) => [f.element, f]));
const MOVE_BY_NAME = {};
for (const [pool, moves] of Object.entries(C.MOVE_POOLS)) {
  for (const [name, move] of Object.entries(moves)) MOVE_BY_NAME[name] = { pool, name, move };
}

// -- helpers ----------------------------------------------------------------

const int = (v, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * A stable pseudo-random stream per address, so re-running this produces the
 * same rosters. Nothing about a migration should change between two runs.
 */
function stream(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

/**
 * Rebuild a move roster from the names a player actually had.
 *
 * Keeps every name the current pools still define, taking the CURRENT numbers
 * — the old ones were tuned against a type chart that never fired. Tops up to
 * four from the companion's own element and then the support pools, and
 * guarantees at least one damaging move, which the original did not: four
 * zero-damage moves was a real roster in the old game and two of them could not
 * hurt each other at all (§5.6).
 */
function rebuildMoves(oldMoves, element, rng) {
  const chosen = {};
  for (const name of Object.keys(oldMoves || {}).sort()) {
    const known = MOVE_BY_NAME[name];
    if (known) chosen[name] = { ...known.move };
  }

  const poolNames = (pool) => Object.keys(C.MOVE_POOLS[pool] || {}).sort();
  const take = (pool) => {
    const options = poolNames(pool).filter((n) => !chosen[n]);
    if (!options.length) return false;
    const name = options[Math.floor(rng() * options.length)];
    chosen[name] = { ...C.MOVE_POOLS[pool][name] };
    return true;
  };

  const damaging = () => Object.values(chosen).some((m) => (m.damage || 0) > 0);
  const count = () => Object.keys(chosen).length;

  // Trim first: a roster longer than four would be a free upgrade.
  while (count() > 4) {
    const names = Object.keys(chosen).sort();
    const droppable = damaging()
      ? names.filter((n) => (chosen[n].damage || 0) === 0 || names.filter((x) => chosen[x].damage > 0).length > 1)
      : names;
    delete chosen[droppable[droppable.length - 1] ?? names[names.length - 1]];
  }

  const pools = [element, 'normal', 'boost', 'heal'];
  let guard = 0;
  while (count() < 4 && guard++ < 40) {
    if (!damaging()) { if (take(element) || take('normal')) continue; }
    take(pools[guard % pools.length]);
  }
  if (!damaging()) {
    // Displace the alphabetically last support move for an element attack.
    const names = Object.keys(chosen).sort();
    delete chosen[names[names.length - 1]];
    take(element) || take('normal');
  }
  return chosen;
}

// -- inputs -----------------------------------------------------------------

const S = prempass.state;
const unlocked = new Set(S.Unlocked ?? []);
const factions = S.UserFactions ?? {};
const monsters = S.UserMonsters ?? {};
const lootboxes = S.UserLootBoxes ?? {};
const skins = S.UserSkins ?? {};

/**
 * Berry balances live in the token processes, not in the game. Fire has two
 * ids — the one PremPass listed as supported and the one the live companions
 * actually charged against — so both are read and summed.
 */
const BERRY_SOURCES = {
  fire_berry: ['fire_berry', 'fire_berry_v1'],
  water_berry: ['water_berry'],
  air_berry: ['air_berry'],
  rock_berry: ['rock_berry'],
};
/**
 * The Alter's records, recovered from its own checkpoint.
 *
 * Lifetime offerings and the faction tally carry; live STREAKS do not — see the
 * note where they would have been applied.
 *
 * The old process was `StreakAlter.lua` and the streak was the point: one Rune
 * for turning up, two at three days, three at ten. 80 players had a live streak
 * and 91 had a lifetime offering count when it stopped. Restoring the numbers
 * without restoring these would hand everyone a clean slate and quietly delete
 * months of showing up.
 *
 * `LastOffering` is NOT carried either: it is a calendar day index from a
 * different epoch, and mapping it onto `lastDaily` would either lock people out
 * or mean nothing. Left at zero, everyone can claim once immediately.
 *
 * `CheckinHistory` stays in the archive rather than the process: it is a
 * per-DAY aggregate across all players ({High, Medium, Low} counts), not
 * anything a player record could hold.
 */
const alter = readSnapshot('alter');
const streaks = alter?.state?.Streak ?? {};
const offerings = alter?.state?.IndividualOfferings ?? {};
const factionOfferings = alter?.state?.TotalOfferings ?? {};

/**
 * 131 days of who worshipped, bucketed by streak tier — 2025-05-03 to
 * 2025-09-13. The only engagement history the game has, and the buckets are the
 * same three reward tiers the streak still pays at, so the recovered days and
 * everything recorded from now on are one continuous series.
 */
const checkins = alter?.state?.CheckinHistory ?? {};

const berries = {};
const berrySources = {};
for (const [item, names] of Object.entries(BERRY_SOURCES)) {
  berries[item] = {};
  const found = [];
  for (const name of names) {
    const snap = readSnapshot(name);
    if (!snap?.state?.Balances) continue;
    found.push(name);
    const denomination = int(snap.scalars?.Denomination, 0);
    const divisor = 10 ** denomination;
    for (const [address, raw] of Object.entries(snap.state.Balances)) {
      const n = Math.floor(int(raw, 0) / divisor);
      if (n > 0) berries[item][address] = (berries[item][address] ?? 0) + n;
    }
  }
  berrySources[item] = found;
}

// -- the mapping ------------------------------------------------------------

const report = {
  noFaction: [], noMonster: [], unknownFaction: [], statsAdjusted: [],
  movesDropped: {}, berriesCapped: [],
};

const addresses = [...new Set([
  ...unlocked,
  ...Object.keys(factions),
  ...Object.keys(monsters),
  ...Object.keys(lootboxes),
])].sort();

const players = [];
for (const address of addresses) {
  const oldFactionName = factions[address]?.faction;
  const oldMonster = monsters[address];

  let faction = oldFactionName && FACTION_BY_NAME[oldFactionName] ? oldFactionName : null;
  if (oldFactionName && !faction) report.unknownFaction.push(`${address} (${oldFactionName})`);
  // A companion with no faction record still names its own element, and the
  // element is what the faction is for.
  if (!faction && oldMonster?.elementType) {
    faction = FACTION_BY_ELEMENT[oldMonster.elementType]?.name ?? null;
  }
  if (!faction) report.noFaction.push(address);

  const row = { address, unlocked: true, seeded: true, wins: 0, losses: 0 };
  if (faction) row.faction = faction;

  let joinedAt = int(prempass.checkpointedAt && Date.parse(prempass.checkpointedAt), 0);

  if (oldMonster && faction) {
    const f = FACTION_BY_NAME[faction];
    const rng = stream(address);
    const level = clamp(int(oldMonster.level, 0), 0, 100);

    // Old and new progressions agree: a base total of 10, ten points a level.
    // Anything else is an anomaly from the old process (one companion sits at
    // 103 for a level that should total 70), so normalise it proportionally
    // rather than importing a stat block the balance was never measured on.
    const expected = 10 + 10 * level;
    const raw = {
      attack: Math.max(1, int(oldMonster.attack, 1)),
      defense: Math.max(1, int(oldMonster.defense, 1)),
      speed: Math.max(1, int(oldMonster.speed, 1)),
      health: Math.max(1, int(oldMonster.health, 1)),
    };
    const total = raw.attack + raw.defense + raw.speed + raw.health;
    const stats = { ...raw };
    if (total !== expected) {
      report.statsAdjusted.push(`${address} level ${level}: ${total} -> ${expected}`);
      let left = expected;
      const names = ['attack', 'defense', 'speed', 'health'];
      for (const n of names) {
        stats[n] = Math.max(1, Math.round((raw[n] / total) * expected));
        left -= stats[n];
      }
      // Rounding rarely lands exactly; put the remainder on the largest stat.
      const biggest = names.sort((a, b) => stats[b] - stats[a])[0];
      stats[biggest] = Math.max(1, stats[biggest] + left);
    }

    const before = Object.keys(oldMonster.moves ?? {});
    const moves = rebuildMoves(oldMonster.moves, f.element, rng);
    for (const name of before) {
      if (!MOVE_BY_NAME[name]) {
        report.movesDropped[name] = (report.movesDropped[name] ?? 0) + 1;
      }
    }

    joinedAt = int(oldMonster.status?.since, joinedAt) || joinedAt;

    row.monster = {
      // Identity comes from the CURRENT constants so the client can resolve the
      // art; only progression comes from the old record.
      name: f.monster.name,
      image: f.monster.image,
      sprite: f.monster.sprite,
      faction: f.name,
      elementType: f.element,
      berryItem: f.berry,

      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      health: stats.health,
      energy: clamp(int(oldMonster.energy, 50), 0, C.MAX_ENERGY),
      happiness: clamp(int(oldMonster.happiness, 50), 0, C.MAX_HAPPINESS),
      level,
      exp: Math.max(0, int(oldMonster.exp, 0)),
      totalTimesFed: Math.max(0, int(oldMonster.totalTimesFed, 0)),
      totalTimesPlay: Math.max(0, int(oldMonster.totalTimesPlay, 0)),
      totalTimesQuest: Math.max(0, int(oldMonster.totalTimesMission, 0)),
      moves,
      // Nobody is restored mid-activity: the play and mission timers they were
      // counting against died with the process.
      status: { type: 'Home', since: joinedAt, until_time: joinedAt },
      bornAt: joinedAt,
    };
    row.questsCompleted = row.monster.totalTimesQuest;
  } else if (!oldMonster) {
    report.noMonster.push(address);
  }

  const boxes = lootboxes[address];
  row.lootboxes = Array.isArray(boxes)
    ? boxes.map((r) => clamp(int(r, 1), 1, C.MAX_LOOT_RARITY))
    : [];

  const inventory = {};
  for (const item of Object.keys(BERRY_SOURCES)) {
    let n = berries[item][address] ?? 0;
    if (BERRY_CAP && n > BERRY_CAP) {
      report.berriesCapped.push(`${address} ${item} ${n} -> ${BERRY_CAP}`);
      n = BERRY_CAP;
    }
    if (n > 0) inventory[item] = n;
  }
  if (LAUNCH_RUNE > 0) inventory.rune = LAUNCH_RUNE;
  if (Object.keys(inventory).length) row.inventory = inventory;

  // Streaks are deliberately NOT carried. The old ones ran to 2026-02 and the
  // rebuild does not launch for weeks yet — every one of them would be broken
  // by the time anybody could claim against it, so restoring them would only
  // hand people a number that is about to be taken away. Everyone starts at
  // zero and builds a real one.
  //
  // The lifetime offering count IS carried: it is a record of what somebody
  // did, not a live position, and nothing about a gap invalidates it.
  const offered = int(offerings[address], 0);
  if (offered > 0) row.offerings = offered;

  row.joinedAt = joinedAt;
  players.push(row);
}

// -- output -----------------------------------------------------------------

const out = {
  builtBy: 'backend/native/build-legacy.mjs',
  from: {
    prempass: { checkpoint: prempass.checkpoint, nonce: prempass.nonce, at: prempass.checkpointedAt },
    berries: berrySources,
  },
  notes: [
    'wins and losses are 0 for everyone: the old game never persisted them',
    'moves are rebuilt from the names each player had, using current numbers',
    'nobody is restored mid-activity or mid-battle',
    BERRY_CAP ? `berries capped at ${BERRY_CAP}` : 'berries carried in full',
    LAUNCH_RUNE > 0
      ? `every restored player starts with ${LAUNCH_RUNE} Rune, held in game`
      : 'no launch Rune',
  ],
  players,
  offerings: factionOfferings,
  checkins,
};
const outFile = path.join(HERE, arg('--out', 'legacy-players.json'));
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');

const skinRows = Object.entries(skins)
  .map(([address, v]) => ({ address, txId: v?.txId }))
  .filter((r) => typeof r.txId === 'string');
fs.writeFileSync(path.join(HERE, 'legacy-skins.json'), JSON.stringify({
  note: 'recovered sprite customiser skins — the live process has nowhere to put these yet',
  from: prempass.checkpoint,
  skins: skinRows,
}, null, 1) + '\n');

// -- what happened ----------------------------------------------------------

const withMonster = players.filter((p) => p.monster).length;
const withFaction = players.filter((p) => p.faction).length;
const withBoxes = players.filter((p) => p.lootboxes.length).length;
const withBerries = players.filter((p) => p.inventory).length;
const totalBerries = players.reduce((n, p) =>
  n + Object.values(p.inventory ?? {}).reduce((a, b) => a + b, 0), 0);

console.log(`\n${players.length} players built from ${prempass.checkpoint}`);
console.log(`  ${unlocked.size} on the recovered paid list`);
console.log(`  ${withFaction} with a faction`);
console.log(`  ${withMonster} with a companion`);
console.log(`  ${withBoxes} holding loot boxes`);
console.log(`  ${withBerries} holding berries (${totalBerries} berries in total)`);
if (LAUNCH_RUNE > 0) {
  const runes = players.filter((p) => p.inventory?.rune).length;
  console.log(`  ${runes} seeded with ${LAUNCH_RUNE} Rune each, in game (token supply stays 0)`);
}

const levels = {};
for (const p of players) if (p.monster) levels[p.monster.level] = (levels[p.monster.level] ?? 0) + 1;
const withOfferings = players.filter((p) => p.offerings).length;
console.log(`  ${withOfferings} with lifetime offerings (streaks deliberately not carried)`);
console.log(`  faction offerings: ${Object.entries(factionOfferings).map(([f, n]) => `${f} ${n}`).join(', ') || '(none)'}`);
const days = Object.keys(checkins).length;
if (days) {
  const span = Object.keys(checkins).map(Number).sort((a, b) => a - b);
  const asDate = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
  console.log(`  ${days} days of worship history (${asDate(span[0])} to ${asDate(span[span.length - 1])})`);
}
console.log(`  levels: ${Object.entries(levels).sort((a, b) => a[0] - b[0])
  .map(([l, n]) => `${l}:${n}`).join(' ')}`);

if (report.unknownFaction.length) {
  console.log(`\n  ! ${report.unknownFaction.length} unknown faction names: ${report.unknownFaction.join(', ')}`);
}
if (report.statsAdjusted.length) {
  console.log(`\n  ${report.statsAdjusted.length} stat block(s) normalised to the level's total:`);
  for (const line of report.statsAdjusted) console.log(`    ${line}`);
}
const dropped = Object.entries(report.movesDropped);
if (dropped.length) {
  console.log(`\n  moves the current pools no longer define (replaced in kind):`);
  for (const [name, n] of dropped.sort((a, b) => b[1] - a[1])) console.log(`    ${name} x${n}`);
}
if (report.berriesCapped.length) {
  console.log(`\n  ${report.berriesCapped.length} berry balance(s) capped at ${BERRY_CAP}`);
}
console.log(`\nwrote ${path.basename(outFile)} and legacy-skins.json`);
console.log('Load it with:  HB_WALLET=key.json node backend/native/deploy.mjs --seed-legacy');
