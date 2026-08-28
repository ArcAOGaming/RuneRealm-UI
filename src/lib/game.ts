/**
 * The game's verbs.
 *
 * Every write is one signed message and one reply; every read is a free
 * unsigned GET of published state. There is no transfer-then-wait-for-a-
 * Credit-Notice dance any more — the token processes those depended on were
 * legacynet and are gone, so items live in the player's record on the process.
 * Feeding a companion used to be: sign a Transfer, wait for the token process
 * to push a Credit-Notice, hope the game process handled it. It is now one
 * message.
 *
 * Handler errors are turned into thrown `GameError`s here, deliberately. The
 * old client discarded them in several places, so a rejected action presented
 * as "nothing happened" and there was no way to tell a failure from a slow
 * network.
 */

import { readJSON, readState, send, GAME_PROCESS } from './hyperbeam';
import {
  AdminAuditEntry, AdminFactionStats, AdminMetrics, AdminPlayerPatch,
  AdminPlayerSummary, AdminSnapshot, Battle, Catalog, Element, Faction,
  GameError, GameStats, ItemId, LeaderboardRow, OpenChallenge, Player,
  RegistryAsset, Reply,
} from './types';

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new GameError(String(reply.error));
  }
  return reply as T;
}

let adminSnapshotCache: AdminSnapshot | null = null;
let adminSnapshotInFlight: Promise<AdminSnapshot> | null = null;

// This is the process that preceded Admin.Snapshot. Keeping the compatibility
// decision beside the process id means its first admin page load uses its
// existing one-message export directly instead of spending a signature on a
// feature probe we already know will fail. A newly deployed process gets the
// compact modern snapshot automatically.
const LEGACY_ADMIN_PROCESSES = new Set([
  'jTrUI4aKamj3KAGsiOtzEOjkVFcDcQ8XL1OA5SxBGHw',
]);
let adminSnapshotMode: 'modern' | 'legacy' = LEGACY_ADMIN_PROCESSES.has(GAME_PROCESS)
  ? 'legacy' : 'modern';

/**
 * Newer processes attach a fresh console snapshot to successful admin
 * mutations. Remember it here so updating one player does not immediately ask
 * the wallet for a second signature just to repaint the tables.
 */
function rememberAdminSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || !('adminSnapshot' in value)) return;
  const snapshot = (value as { adminSnapshot?: unknown }).adminSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || !('players' in snapshot)) return;
  adminSnapshotCache = snapshot as AdminSnapshot;
}

const write = async <T>(tags: Record<string, string>, data?: string): Promise<T> => {
  const action = tags.Action ?? '';
  const mutatesAdminState = action.startsWith('Admin.')
    && action !== 'Admin.Snapshot' && action !== 'Admin.Export';
  // An older process will not attach the new snapshot. Clearing before the
  // write makes the caller fall back to one explicit refresh instead of
  // quietly showing stale operational data.
  if (mutatesAdminState) adminSnapshotCache = null;

  const value = unwrap<T>(await send<Reply<T>>(
    Object.entries(tags).map(([name, value]) => ({ name, value })),
    { data },
  ));
  rememberAdminSnapshot(value);
  return value;
};

// Reads ---------------------------------------------------------------------
// None of these prompt the wallet or cost anything.

/**
 * A whole player record, by wallet, with no signature.
 *
 * This is what makes looking at the game free. The process publishes every
 * player under their own address (`player-<address>`), so reading your own
 * account — or anyone else's companion, to draw their card on the leaderboard —
 * is a plain GET.
 *
 * Null means the process has no record for that wallet, which is the same thing
 * as "no Eternal Pass": the paid list is seeded through `Admin.Unlock`, and
 * that mints a record for every address on it.
 *
 * The predecessor read the bare `player` key, which holds whichever player the
 * process computed LAST — so it answered null most of the time the moment
 * anybody else was playing, and login had to be a signed write to be reliable.
 */
export const readPlayer = (address: string) => readJSON<Player>(`player-${address}`);

/** Whether this deployment admits new wallets without an Eternal Pass. */
export const readAccess = () => LEGACY_ADMIN_PROCESSES.has(GAME_PROCESS)
  // This closed predecessor never published the optional access flag. Avoid a
  // guaranteed 404 on every poll; closed access is its real configuration.
  ? Promise.resolve({ publicAccess: false })
  : readJSON<{ publicAccess: boolean }>('access');
export const readFactions = () => readJSON<Faction[]>('factions');
export const readLeaderboard = () => readJSON<LeaderboardRow[]>('leaderboard');
export const readBattle = () => readJSON<Battle>('battle');
/** Items, activities and the combat tuning. Static; safe to fetch once. */
export const readCatalog = () => readJSON<Catalog>('catalog');
/** Open PvP challenges. Published, so the lobby's refresh costs nothing. */
export const readChallenges = () => readJSON<OpenChallenge[]>('challenges');

export async function readPlayerCount(): Promise<number> {
  const users = await readState('users');
  return Number(users ?? 0);
}

// Identity ------------------------------------------------------------------

/**
 * Who is this wallet?
 *
 * NOT on the connect path any more, and that is the point: it is a signed
 * write, so using it to answer "what do I own" put a wallet prompt in front of
 * merely looking at the game. `readPlayer` answers the same question for free.
 *
 * Kept because it is the only read that is authoritative as of *now* rather
 * than as of the last message that touched the wallet — worth having if a
 * screen ever needs to be certain it is not a scheduler-head behind.
 */
export const login = () => write<Player>({ Action: 'User.Login' });

export const stats = () => write<GameStats>({ Action: 'Stats' });

// Factions ------------------------------------------------------------------

export const listFactions = () => write<Faction[]>({ Action: 'Faction.List' });

export const joinFaction = (faction: string) =>
  write<Player>({ Action: 'Faction.Join', Faction: faction });

// Companion -----------------------------------------------------------------

export const adopt = () => write<Player>({ Action: 'Monster.Adopt' });

export const feed = (item?: ItemId) =>
  write<Player>({ Action: 'Monster.Feed', ...(item ? { Item: item } : {}) });

export const startPlay = () => write<Player>({ Action: 'Monster.Play' });

export const startQuest = () => write<Player>({ Action: 'Monster.Quest' });

/** Collects a finished Play or Quest — one verb for both. */
export const claim = () => write<Player>({ Action: 'Monster.Claim' });

export const levelUp = (points: {
  attack: number; defense: number; speed: number; health: number;
}) =>
  write<Player>({
    Action: 'Monster.LevelUp',
    AttackPoints: String(points.attack),
    DefensePoints: String(points.defense),
    SpeedPoints: String(points.speed),
    HealthPoints: String(points.health),
  });

/**
 * The daily worship.
 *
 * Every other source of Runes is a reward for spending Runes, so the economy is
 * a net sink by design. This is the faucet, and it is keyed on the wallet and
 * the clock rather than on activity, so playing more cannot farm it.
 */
export const claimDaily = () => write<Player>({ Action: 'Daily.Claim' });

export const openLootbox = (rarity?: number) =>
  write<Player>({
    Action: 'Lootbox.Open',
    ...(rarity ? { Rarity: String(rarity) } : {}),
  });

// Arena ---------------------------------------------------------------------

/** Pay the Rune, take the four battles. */
export const enterArena = () => write<Player>({ Action: 'Battle.Begin' });

export const leaveArena = () => write<Player>({ Action: 'Battle.Leave' });

export const startBotBattle = (difficulty = 1) =>
  write<Player>({ Action: 'Battle.Start', Difficulty: String(difficulty) });

/**
 * `Opponent`, not `Target`. An ANS-104 data item carries a lowercase `target`
 * field holding the process id, and tag names become HTTP headers, so a tag
 * called `Target` is ambiguous by the time the process reads it.
 */
export const challenge = (target: string | 'OPEN' = 'OPEN') =>
  write<Player>({ Action: 'Battle.Challenge', Opponent: target });

export const acceptChallenge = (battleId: string) =>
  write<Player>({ Action: 'Battle.Accept', BattleId: battleId });

/**
 * One signed message is one full round.
 *
 * Against the house the reply already carries your swing, the opponent's answer
 * and the whole new battle, so there is nothing to poll. This is not a style
 * choice: the Dumverse port shipped a lazy-tick design first, discovered that
 * the 1 Hz poll was an unsigned READ, that a read schedules nothing, and that
 * the fight therefore never advanced — the countdown ran out and the enemy
 * never moved.
 */
export const attack = (battleId: string, move: string, round?: number) =>
  write<Player>({
    Action: 'Battle.Attack',
    BattleId: battleId,
    Move: move,
    // The round this click was made in. Without it a message sent for round N
    // that arrives after round N resolved is silently applied to round N+1 —
    // so a double-click picks your next move for you, and which of the two
    // choices survives is scheduler order rather than click order.
    ...(round === undefined ? {} : { Round: String(round) }),
  });

/**
 * Signed variant, kept for the case where a caller needs the value as of *now*
 * rather than as of the last message. The lobby uses `readChallenges` instead,
 * because a poll should never prompt the wallet.
 */
export const listChallenges = () =>
  write<OpenChallenge[]>({ Action: 'Battle.OpenChallenges' });

export const battleInfo = (battleId: string) =>
  write<Battle>({ Action: 'Battle.Info', BattleId: battleId });

// Minting -------------------------------------------------------------------

/**
 * Where a deposited asset must be sent.
 *
 * Published rather than hardcoded on purpose: a client that bakes in the
 * address it transfers to will send an asset to a dead wallet the first time
 * the minter's key rotates, and a transferred asset does not come back.
 */
export const readMintVault = () => readState('mintvault');

/**
 * Every asset this game has ever minted, keyed by asset id.
 *
 * Free, unsigned, and the whole registry in one read. `holder` is where the
 * PROCESS last saw it — once an asset is traded on a marketplace the process is
 * not told, so ownership truth is still the asset's own balances (see
 * `assetHolder` in lib/mint.ts). This answers "what exists", not "who owns it".
 */
export const readAssetRegistry = () => readJSON<Record<string, RegistryAsset>>('assets');

/** How many have ever been minted. Cheaper than counting the registry. */
export async function readAssetCount(): Promise<number> {
  return Number((await readState('assetcount')) ?? 0);
}

/** What `Monster.Mint` costs in runes. Published so the button can say so. */
export async function readMintCost(): Promise<number> {
  const cost = await readState('mintcost');
  return Number(cost ?? 0);
}

/**
 * Queue the companion for minting.
 *
 * This charges runes and freezes the companion; it does not produce an asset.
 * The reply comes back immediately with `mint` set and the companion's status
 * at `Minting`, and the asset appears in `assets` once the worker has signed
 * the transaction and reported it — a couple of minutes, being a base-layer
 * Arweave transaction rather than a message.
 */
export const mint = () => write<Player>({ Action: 'Monster.Mint' });

/**
 * Tell the process an asset has been handed back to the vault.
 *
 * Call this AFTER the transfer is on chain. The process cannot see a transfer
 * and this claims nothing: it only puts the id where the worker will look, and
 * the companion returns when the worker has confirmed the vault holds it.
 */
export const depositAsset = (assetId: string) =>
  write<Player>({ Action: 'Monster.Deposit', AssetId: assetId });

/**
 * Point the account at a published character.
 *
 * Both ids are Arweave transactions: the sheet, and the Phaser atlas that
 * describes its frames. The process validates both and stores them on the
 * player, so the open world can render whatever somebody made.
 */
export const spriteUpdate = (txId: string, atlasTxId?: string) =>
  write<Player>({
    Action: 'Sprite.Update',
    TxId: txId,
    ...(atlasTxId ? { AtlasTxId: atlasTxId } : {}),
  });

/**
 * Daily worship, bucketed by streak tier: `{ [epochDay]: {high, medium, low} }`.
 *
 * Published state, so this is free and needs no wallet. 131 days were recovered
 * from the old Alter and everything since is appended to the same series.
 */
export const readCheckins = () =>
  readJSON<Record<string, { high: number; medium: number; low: number }>>('checkins');

/** Aggregated operational history. Public and deliberately free of addresses. */
export const readMetrics = () => readJSON<AdminMetrics>('metrics');

// Admin ---------------------------------------------------------------------
// The process rejects all of these unless the signer is its owner.

export const adminUnlock = (addresses: string[]) =>
  write<{ added: number; alreadyUnlocked: number; total: number }>(
    { Action: 'Admin.Unlock' },
    JSON.stringify({ addresses }),
  );

export const adminLock = (address: string) =>
  write<{ locked: string }>({ Action: 'Admin.Lock', PlayerId: address });

export const adminGrant = (
  address: string,
  opts: { item?: ItemId; amount?: number; lootboxes?: number; rarity?: number },
) =>
  write<Player>({
    Action: 'Admin.Grant',
    PlayerId: address,
    ...(opts.item ? { Item: opts.item, Amount: String(opts.amount ?? 1) } : {}),
    ...(opts.lootboxes ? { Lootboxes: String(opts.lootboxes), Rarity: String(opts.rarity ?? 1) } : {}),
  });

export const adminSetStats = (address: string, patch: Record<string, unknown>) =>
  write<Player>({ Action: 'Admin.SetStats', PlayerId: address }, JSON.stringify(patch));

export const adminRemove = (address: string) =>
  write<{ removed: string }>({ Action: 'Admin.RemoveUser', PlayerId: address });

type LegacyAdminExport = {
  total: number;
  players: Player[];
  metrics?: AdminMetrics;
  audit?: AdminAuditEntry[];
};

const legacyItems: ItemId[] = [
  'rune', 'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'ruby', 'emerald', 'topaz', 'diamond', 'scroll', 'legendary_scroll',
];

const legacyFactions: Array<{ name: string; element: Element }> = [
  { name: 'Inferno Blades', element: 'fire' },
  { name: 'Aqua Guardians', element: 'water' },
  { name: 'Sky Nomads', element: 'air' },
  { name: 'Stone Titans', element: 'rock' },
];

/** Convert the predecessor's one-message migration export into the console view. */
function legacySnapshot(exported: LegacyAdminExport): AdminSnapshot {
  const now = Date.now();
  const today = Math.floor(now / 86_400_000);
  const rows = Array.isArray(exported.players) ? exported.players : [];
  const players: AdminPlayerSummary[] = rows.map((player) => {
    const monster = player.monster;
    return {
      address: player.address,
      unlocked: Boolean(player.unlocked),
      faction: player.faction,
      name: monster?.name,
      element: monster?.elementType,
      level: monster?.level ?? 0,
      exp: monster?.exp ?? 0,
      energy: monster?.energy ?? 0,
      happiness: monster?.happiness ?? 0,
      status: monster?.status?.type ?? 'No companion',
      inventory: player.inventory ?? {},
      lootboxes: Array.isArray(player.lootboxes) ? player.lootboxes : [],
      wins: player.wins ?? 0,
      losses: player.losses ?? 0,
      questsCompleted: player.questsCompleted ?? 0,
      battlesRemaining: player.battlesRemaining ?? 0,
      activeBattleId: player.activeBattleId,
      dailyStreak: player.dailyStreak ?? 0,
      bestStreak: player.bestStreak ?? 0,
      offerings: player.offerings ?? 0,
      lastDaily: player.lastDaily ?? 0,
      joinedAt: player.joinedAt ?? 0,
      lastActiveAt: player.lastActiveAt ?? 0,
      lastAction: player.lastAction,
      assets: Object.keys(player.assets ?? {}).length,
    };
  });

  const battles = [...new Set(players.flatMap((player) => (
    player.activeBattleId ? [player.activeBattleId] : []
  )))].map((id) => ({
    id, kind: 'pvp' as const, status: 'battling' as const, round: 0,
    startedAt: 0,
  }));

  const factions: AdminFactionStats[] = legacyFactions.map(({ name, element }) => {
    const members = players.filter((player) => player.faction === name);
    const companions = members.filter((player) => player.name);
    return {
      name, element, members: members.length, companions: companions.length,
      averageLevel: companions.length
        ? companions.reduce((sum, player) => sum + player.level, 0) / companions.length : 0,
      wins: members.reduce((sum, player) => sum + player.wins, 0),
      losses: members.reduce((sum, player) => sum + player.losses, 0),
      quests: members.reduce((sum, player) => sum + player.questsCompleted, 0),
      runes: members.reduce((sum, player) => sum + Number(player.inventory.rune ?? 0), 0),
      offerings: members.reduce((sum, player) => sum + player.offerings, 0),
      worshipersToday: members.filter((player) => (
        Math.floor((player.lastDaily ?? 0) / 86_400_000) === today
      )).length,
      feeds: 0, plays: 0,
    };
  });

  const items = Object.fromEntries(legacyItems.map((item) => [
    item,
    players.reduce((sum, player) => sum + Number(player.inventory[item] ?? 0), 0),
  ])) as Partial<Record<ItemId, number>>;
  const lootboxes = players.reduce((sum, player) => (
    sum + player.lootboxes.reduce((subtotal, value) => subtotal + Number(value ?? 0), 0)
  ), 0);

  return {
    generatedAt: now,
    players,
    battles,
    factions,
    stats: {
      // `total` remains authoritative if the legacy process has more than its
      // maximum 50-row export page. The visible directory is deliberately the
      // single signed page; a full modern snapshot arrives after redeploy.
      players: Number(exported.total ?? players.length),
      unlocked: players.filter((player) => player.unlocked).length,
      monsters: players.filter((player) => player.name).length,
      activeBattles: battles.length,
      completedBattles: players.reduce((sum, player) => sum + player.wins, 0),
      wins: players.reduce((sum, player) => sum + player.wins, 0),
      losses: players.reduce((sum, player) => sum + player.losses, 0),
      quests: players.reduce((sum, player) => sum + player.questsCompleted, 0),
      runes: Number(items.rune ?? 0),
      lootboxes,
      offerings: players.reduce((sum, player) => sum + player.offerings, 0),
      activeToday: players.filter((player) => (
        Math.floor(player.lastActiveAt / 86_400_000) === today
      )).length,
      items,
      mintedAssets: players.reduce((sum, player) => sum + player.assets, 0),
    },
    metrics: exported.metrics ?? { since: now, totals: {}, daily: {} },
    audit: Array.isArray(exported.audit) ? exported.audit : [],
  };
}

function legacyAdminSnapshot() {
  return write<LegacyAdminExport>({
    Action: 'Admin.Export', Offset: '0', Limit: '50',
  }).then(legacySnapshot);
}

export const usesLegacyAdminApi = () => adminSnapshotMode === 'legacy';

/**
 * One compact owner-only roster, economy, battle and trend snapshot.
 *
 * React StrictMode mounts effects twice in development. Sharing the in-flight
 * request makes those mounts one wallet prompt, and retaining the last result
 * makes route changes free. The visible Refresh button passes `force: true`.
 */
export function adminSnapshot({ force = false }: { force?: boolean } = {}) {
  if (!force && adminSnapshotCache) return Promise.resolve(adminSnapshotCache);
  if (adminSnapshotInFlight) return adminSnapshotInFlight;
  if (force) adminSnapshotCache = null;

  const request = adminSnapshotMode === 'legacy'
    ? legacyAdminSnapshot()
    : write<AdminSnapshot>({ Action: 'Admin.Snapshot' }).catch((error: unknown) => {
      // Unknown/custom process ids cannot be classified ahead of time. Probe
      // once, remember the answer for this app session, then use the old
      // one-signature export on every later load.
      if (!/unknown action ['"]?Admin\.Snapshot/i.test(String(error))) throw error;
      adminSnapshotMode = 'legacy';
      return legacyAdminSnapshot();
    });

  adminSnapshotInFlight = request
    .then((snapshot) => {
      adminSnapshotCache = snapshot;
      return snapshot;
    })
    .finally(() => { adminSnapshotInFlight = null; });
  return adminSnapshotInFlight;
}

/** Positive gives inventory; negative removes it, floored at zero. */
export const adminAdjustInventory = (address: string, item: ItemId, delta: number) =>
  write<{
    player: Player; item: ItemId; before: number; after: number;
    requested: number; applied: number;
  }>({
    Action: 'Admin.AdjustInventory',
    PlayerId: address,
    Item: item,
    Delta: String(delta),
  });

export const adminUpdatePlayer = (address: string, patch: AdminPlayerPatch) =>
  write<Player>(
    { Action: 'Admin.UpdatePlayer', PlayerId: address },
    JSON.stringify(patch),
  );

export const adminReleaseBattle = (address: string) =>
  write<{ released: string[]; battleId?: string; player: Player }>({
    Action: 'Admin.ReleaseBattle', PlayerId: address,
  });

/** What `Admin.AdjustAll` reports back. */
export type AdjustAllResult = {
  adjusted: number;
  skipped: number;
  applied: Record<string, number | boolean | null>;
};

/**
 * Change every companion at once.
 *
 * The old process had `AdjustAllMonsters` and the rewrite dropped it. It is
 * what you want after touching a tuning number: doing it one player at a time
 * is a signed message each, and a write costs seconds.
 *
 * `energy` and `happiness` SET a value; the four stats ADD a delta, because a
 * rebalance means "everyone gets +1 defence", not "everyone is now defence 1".
 * A stat is never driven below 1 — a companion with 0 attack cannot act.
 */
export const adminAdjustAll = (opts: {
  energy?: number;
  happiness?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  health?: number;
  rerollMoves?: boolean;
}) =>
  write<AdjustAllResult>({
    Action: 'Admin.AdjustAll',
    ...(opts.energy !== undefined ? { Energy: String(opts.energy) } : {}),
    ...(opts.happiness !== undefined ? { Happiness: String(opts.happiness) } : {}),
    ...(opts.attack ? { Attack: String(opts.attack) } : {}),
    ...(opts.defense ? { Defense: String(opts.defense) } : {}),
    ...(opts.speed ? { Speed: String(opts.speed) } : {}),
    ...(opts.health ? { Health: String(opts.health) } : {}),
    ...(opts.rerollMoves ? { RerollMoves: 'true' } : {}),
  });

export { GAME_PROCESS };
