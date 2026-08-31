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

import {
  AcceptedWriteError, activeAddress, HB_NODE, OutboxDeliveryError, pushSlotWithRetry,
  readJSON, readState, send, GAME_PROCESS, type SendOptions,
} from './hyperbeam';
import {
  AdminAuditEntry, AdminFactionStats, AdminMetrics, AdminPlayerPatch,
  AdminPlayerSummary, AdminSnapshot, Battle, BattleFleetConfig, BattleFleetRoute, BerryItemId,
  Catalog, CharacterOutfit, EconomyPolicyChange, EconomyView, Element, Faction,
  GoldMarketItemId, GoldOrderSide,
  GameError, GameStats, ItemId, LeaderboardRow, Listing, OpenChallenge, Player,
  RegistryAsset, Reply, RuneWithdrawal, Sale,
} from './types';

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new GameError(String(reply.error));
  }
  return reply as T;
}

let adminSnapshotCache: AdminSnapshot | null = null;
let adminSnapshotInFlight: Promise<AdminSnapshot> | null = null;
let economyActionSeq = 0;
const economyActionId = (kind: string) =>
  `${kind}-${Date.now().toString(36)}-${(++economyActionSeq).toString(36)}`;

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

const write = async <T>(
  tags: Record<string, string>, data?: string,
  options: SendOptions<T> = {},
): Promise<T> => {
  const action = tags.Action ?? '';
  const mutatesAdminState = action.startsWith('Admin.')
    && action !== 'Admin.Snapshot' && action !== 'Admin.Export';
  // An older process will not attach the new snapshot. Clearing before the
  // write makes the caller fall back to one explicit refresh instead of
  // quietly showing stale operational data.
  if (mutatesAdminState) adminSnapshotCache = null;

  const value = unwrap<T>(await send<Reply<T>>(
    Object.entries(tags).map(([name, value]) => ({ name, value })),
    { data, ...options },
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
const fleetRoutes = new Map<string, BattleFleetRoute>();
const fleetPlayers = new Map<string, Player>();
let battleFleetConfigPromise: Promise<BattleFleetConfig | null> | null = null;
const FLEET_PROTOCOL = 'runerealm-battle-fleet/1';
const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,192}$/;

function clearFleetRoutes(address: string, exceptBattleId?: string) {
  for (const [battleId, cached] of fleetPlayers) {
    if (cached.address === address && battleId !== exceptBattleId) {
      fleetPlayers.delete(battleId);
      fleetRoutes.delete(battleId);
    }
  }
}

function validateFleetRoute(
  player: Player, config: BattleFleetConfig | null,
): BattleFleetRoute | null {
  const route = player.battleFleet;
  if (!route || !config?.enabled || config.protocol !== FLEET_PROTOCOL
      || route.protocol !== FLEET_PROTOCOL
      || player.activeBattleId !== route.battleId
      || !OPAQUE_ID.test(route.battleId) || !OPAQUE_ID.test(route.reservationId)
      || !OPAQUE_ID.test(route.assignmentId) || !OPAQUE_ID.test(route.ticket)
      || !OPAQUE_ID.test(route.workerId) || !PROCESS_ID.test(route.workerProcessId)
      || !['opening', 'battling', 'cancel-pending'].includes(route.status)
      || !Array.isArray(config.workers)) return null;
  const worker = config.workers.find((candidate) => candidate.workerId === route.workerId
    && candidate.workerProcessId === route.workerProcessId);
  if (!worker) return null;
  const configuredNode = (config.node || HB_NODE).replace(/\/$/, '');
  const routedNode = (route.node || configuredNode).replace(/\/$/, '');
  if (!/^https?:\/\//.test(configuredNode) || routedNode !== configuredNode) return null;
  return { ...route, node: configuredNode };
}

function validateFleetBattle(
  battle: Battle | null, route: BattleFleetRoute, playerAddress: string,
): battle is Battle {
  if (!battle || battle.id !== route.battleId || battle.protocol !== FLEET_PROTOCOL
      || battle.workerId !== route.workerId || battle.kind !== 'bot'
      || (battle.status !== 'battling' && battle.status !== 'ended')
      || !Number.isSafeInteger(battle.round) || battle.round < 0
      || !Array.isArray(battle.turns)
      || !battle.challenger || battle.challenger.address !== playerAddress
      || battle.challenger.side !== 'challenger'
      || !battle.challenger.moves || typeof battle.challenger.moves !== 'object'
      || !battle.accepter || battle.accepter.side !== 'accepter'
      || !battle.accepter.moves || typeof battle.accepter.moves !== 'object') return false;
  return true;
}

function rememberFleetRoute(player: Player, route: BattleFleetRoute) {
  clearFleetRoutes(player.address, route.battleId);
  fleetRoutes.set(route.battleId, route);
  fleetPlayers.set(route.battleId, player);
}

const readAuthorityPlayer = (address: string) => readJSON<Player>(`player-${address}`);

async function hydrateFleetPlayer(player: Player): Promise<Player> {
  if (!player.battleFleet) {
    clearFleetRoutes(player.address);
    return player;
  }
  const config = await fleetConfig();
  const route = validateFleetRoute(player, config);
  if (!route) {
    clearFleetRoutes(player.address);
    return { ...player, battle: undefined, battleFleetHydration: 'invalid' };
  }
  const routed = { ...player, battleFleet: route };
  rememberFleetRoute(routed, route);

  let battle: Battle | null = null;
  let unavailable = false;
  try { battle = await readFleetBattle(route); }
  catch { unavailable = true; }
  if (!battle) {
    const waiting = {
      ...routed, battle: undefined,
      battleFleetHydration: unavailable ? 'unavailable' as const : 'opening' as const,
    };
    fleetPlayers.set(route.battleId, waiting);
    return waiting;
  }
  if (!validateFleetBattle(battle, route, player.address)) {
    clearFleetRoutes(player.address);
    return { ...routed, battle: undefined, battleFleetHydration: 'invalid' };
  }

  // A terminal worker publication can race the authority settlement. Re-read
  // the account once: if recursive delivery already cleared this exact route,
  // use the settled account instead of resurrecting a stale outcome route.
  if (battle.status === 'ended') {
    const latest = await readAuthorityPlayer(player.address).catch(() => null);
    if (latest && (latest.activeBattleId !== route.battleId
        || latest.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(player.address);
      return latest;
    }
  }
  const hydrated = { ...routed, battle, battleFleetHydration: 'ready' as const };
  fleetPlayers.set(route.battleId, hydrated);
  return hydrated;
}

export const readPlayer = async (address: string) => {
  const player = await readAuthorityPlayer(address);
  return player ? hydrateFleetPlayer(player) : null;
};

/** Whether this deployment admits new wallets without an Eternal Pass. */
export const readAccess = () => LEGACY_ADMIN_PROCESSES.has(GAME_PROCESS)
  // This closed predecessor never published the optional access flag. Avoid a
  // guaranteed 404 on every poll; closed access is its real configuration.
  ? Promise.resolve({ publicAccess: false })
  : readJSON<{ publicAccess: boolean }>('access');
export const readFactions = () => readJSON<Faction[]>('factions');
export const readLeaderboard = () => readJSON<LeaderboardRow[]>('leaderboard');
export const readBattle = () => readJSON<Battle>('battle');
/** Immutable fleet routes published by the game authority. */
export const readBattleFleet = () => readJSON<BattleFleetConfig>('battlefleet');

async function fleetConfig() {
  const pending = battleFleetConfigPromise ?? readBattleFleet().catch(() => null);
  battleFleetConfigPromise = pending;
  const config = await pending;
  // Enabled manifests are sealed forever and safe to cache. An unconfigured
  // clean-test game may be sealed after this tab opened, so do not cache its
  // disabled publication (or a transient missing-key read) forever.
  const valid = config?.enabled === true && config.protocol === FLEET_PROTOCOL
    && Array.isArray(config.workers) && config.workers.length > 0;
  if (!valid && battleFleetConfigPromise === pending) {
    battleFleetConfigPromise = null;
  }
  return valid ? config : null;
}

const fleetActionId = (prefix: string) => {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${random}`;
};

async function readFleetBattle(route: BattleFleetRoute, signal?: AbortSignal) {
  return readJSON<Battle>(`battle-${route.battleId}`, {
    process: route.workerProcessId,
    node: route.node || HB_NODE,
    signal,
  });
}

/** Poll worker and authority caches only. This never requests computation. */
async function waitForFleetBattle(
  route: BattleFleetRoute, playerAddress: string, attempts = 60,
): Promise<Battle> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [battle, authority] = await Promise.all([
      readFleetBattle(route).catch(() => null),
      readAuthorityPlayer(playerAddress).catch(() => null),
    ]);
    if (battle) {
      if (!validateFleetBattle(battle, route, playerAddress)) {
        throw new GameError('The assigned worker published an invalid battle route.');
      }
      return battle;
    }
    if (authority && (authority.activeBattleId !== route.battleId
        || authority.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(playerAddress);
      throw new GameError('The battle worker rejected this reservation and the session credit '
        + 'was restored. It is safe to try another battle.');
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 100 + attempt * 50)));
    }
  }
  throw new GameError('The assigned battle worker has not published this battle yet. '
    + 'The reservation is durable; refresh instead of starting another battle.');
}
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

export const feed = (item?: ItemId, monsterId?: string) =>
  write<Player>({
    Action: 'Monster.Feed',
    ...(item ? { Item: item } : {}),
    ...(monsterId ? { MonsterId: monsterId } : {}),
  });

export const startPlay = (monsterId?: string) =>
  write<Player>({ Action: 'Monster.Play', ...(monsterId ? { MonsterId: monsterId } : {}) });

export const startQuest = (monsterId?: string) =>
  write<Player>({ Action: 'Monster.Quest', ...(monsterId ? { MonsterId: monsterId } : {}) });

/** Collects a finished Play or Quest — one verb for both. */
export const claim = (monsterId?: string) =>
  write<Player>({ Action: 'Monster.Claim', ...(monsterId ? { MonsterId: monsterId } : {}) });

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

// Hunt ----------------------------------------------------------------------

/** Freeze a chosen roster companion and open its run on the Hunt process. */
export const beginHunt = (monsterId: string) =>
  write<Player>({ Action: 'Hunt.Begin', MonsterId: monsterId }, undefined, {
    requiredOutbox: true,
  });

// Arena ---------------------------------------------------------------------

/** Pay the Rune, take the four battles. */
export const enterArena = (berry?: BerryItemId) =>
  write<Player>({ Action: 'Battle.Begin', ...(berry ? { Item: berry } : {}) });

export async function leaveArena(): Promise<Player> {
  const pending = await write<Player>({ Action: 'Battle.Leave' }, undefined, {
    // This action can emit a fleet cancellation. Delivery cannot depend on a
    // fallible pre-read or even on reading this slot's reply: the write may be
    // durably accepted and cancel-pending while its correlated read times out.
    // A monolith leave has an empty outbox, so its rare extra push is harmless.
    requiredOutbox: true,
  });
  const route = pending.battleFleet;
  if (!route || route.status !== 'cancel-pending') return pending;
  for (let attempt = 0; attempt < 20; attempt++) {
    const settled = await readAuthorityPlayer(pending.address).catch(() => null);
    if (settled && (settled.activeBattleId !== route.battleId
        || settled.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(pending.address);
      return settled;
    }
    if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 50));
  }
  return { ...pending, battle: undefined, battleFleetHydration: 'cancel-pending' };
}

export async function startBotBattle(difficulty = 1): Promise<Player> {
  const config = await fleetConfig();
  if (!config?.enabled) {
    return write<Player>({ Action: 'Battle.Start', Difficulty: String(difficulty) });
  }

  const authorityPlayer = await write<Player>({
    Action: 'Battle.Start',
    Difficulty: String(difficulty),
    StartId: fleetActionId('start'),
  }, undefined, { requiredOutbox: true });
  const route = validateFleetRoute(authorityPlayer, config);
  if (!route) throw new GameError('Fleet-enabled Battle.Start returned an invalid worker route.');
  rememberFleetRoute(authorityPlayer, route);
  const battle = await waitForFleetBattle(route, authorityPlayer.address);
  const rendered = { ...authorityPlayer, battle };
  fleetPlayers.set(route.battleId, rendered);
  return rendered;
}

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
const attackMonolith = (battleId: string, move: string, round?: number) =>
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

export async function attack(
  battleId: string, move: string, round?: number, actionId = fleetActionId('attack'),
): Promise<Player> {
  let route = fleetRoutes.get(battleId);
  if (!route) {
    // A reload recovers the route from the authority's published player state.
    const address = await activeAddress();
    if (address) await readPlayer(address);
    route = fleetRoutes.get(battleId);
  }
  if (!route) return attackMonolith(battleId, move, round);

  let battle: Battle | null = null;
  try {
    battle = unwrap<Battle>(await send<Reply<Battle>>([
      { name: 'Action', value: 'Battle.Attack' },
      { name: 'BattleId', value: battleId },
      { name: 'Move', value: move },
      { name: 'Ticket', value: route.ticket },
      { name: 'ActionId', value: actionId },
      { name: 'Round', value: String(round ?? 0) },
    ], {
      process: route.workerProcessId,
      node: route.node || HB_NODE,
      // Ordinary rounds have no outbox. Only terminal settlement is pushed.
      requiredOutbox: (reply) => !!reply && typeof reply === 'object'
        && !('error' in reply) && reply.status === 'ended',
    }));
  } catch (error) {
    if (error instanceof AcceptedWriteError) {
      // A cache read proves whether the accepted, unread slot was terminal.
      const published = await readFleetBattle(route).catch(() => null);
      const cachedAddress = fleetPlayers.get(battleId)?.address ?? await activeAddress();
      if (cachedAddress && validateFleetBattle(published, route, cachedAddress)
          && published.status === 'ended') {
        const delivered = await pushSlotWithRetry(error.slot, {
          process: route.workerProcessId,
          node: route.node || HB_NODE,
        });
        if (!delivered) {
          throw new OutboxDeliveryError({
            slot: error.slot, action: 'battle.attack', completed: true, cause: error,
          });
        }
        // The signed action is known terminal and its durable slot has now
        // been delivered. Continue into the normal authority-settlement poll
        // instead of surfacing the original reply-read failure and tempting a
        // caller to replay an already-applied round.
        battle = published;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (!battle) throw new GameError('The battle worker returned no battle state.');

  const cached = fleetPlayers.get(battleId);
  if (battle.status !== 'ended' && cached) {
    const rendered = { ...cached, battle };
    fleetPlayers.set(battleId, rendered);
    return rendered;
  }

  // The pushed terminal slot recursively settles at the account authority.
  // Refresh that account; the worker itself never awards inventory or wins.
  const address = cached?.address ?? await activeAddress();
  if (address) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const settled = await readPlayer(address).catch(() => null);
      if (settled && settled.activeBattleId !== battleId) {
        fleetRoutes.delete(battleId);
        fleetPlayers.delete(battleId);
        return { ...settled, battle, result: battle.winner === 'challenger' ? 'win' : 'loss' };
      }
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 50));
    }
  }
  throw new GameError('The battle ended, but account settlement is not published yet. '
    + 'Refresh; do not replay the terminal attack.');
}

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

/** Save the small character recipe; the browser rebuilds its sheet locally. */
export const spriteUpdate = (outfit: CharacterOutfit) =>
  write<Player>({ Action: 'Sprite.Update' }, JSON.stringify(outfit));

// The active companion and the collection --------------------------------------
//
// A player has exactly one active companion and any number of others in a
// collection. Storing the active companion costs a rune; choosing a different
// collection companion is one free atomic exchange and cannot happen while the
// active companion is away.

/** Send a roster companion to the collection. Home only, costs one rune. */
export const storeMonster = (monsterId?: string) =>
  write<Player>({ Action: 'Monster.Store', ...(monsterId ? { MonsterId: monsterId } : {}) });

/** Bring one back out when the active slot is empty. */
export const retrieveMonster = (monsterId: string) =>
  write<Player>({ Action: 'Monster.Retrieve', MonsterId: monsterId });

/** Atomically exchange the active companion with one in the collection. */
export const setActiveMonster = (monsterId: string) =>
  write<Player>({ Action: 'Monster.SetActive', MonsterId: monsterId });

/**
 * Hand a companion to another account.
 *
 * From the collection only, same rule as a listing — the roster is what the
 * game is acting on, and a companion cannot change hands mid-quest. The whole
 * record moves, so the receiver gets the creature exactly as it was.
 */
export const transferMonster = (monsterId: string, recipient: string) =>
  write<Player>({ Action: 'Monster.Transfer', MonsterId: monsterId, Recipient: recipient });

// The marketplace ---------------------------------------------------------------
//
// Sales settle in this process, in in-game runes. A listing is custody: the
// companion leaves the seller's collection and lives in escrow until it is
// bought or cancelled, so it can never be sold twice or sold and kept.

/** Every companion currently for sale, keyed by listing id. Free to read. */
export const readMarket = () => readJSON<Record<string, Listing>>('market');

/** What has actually sold, newest first. Free to read. */
export const readMarketHistory = () => readJSON<Sale[]>('markethistory');

export const readMarketStats = () =>
  readJSON<{ listings: number; sales: number }>('marketstats');

// Gold goods economy --------------------------------------------------------

/** Exact ledgers, Gold order book, finite NPC desks and public policy state. */
export const readEconomy = () => readJSON<EconomyView>('economy');

export const placeGoldOrder = (
  side: GoldOrderSide,
  item: GoldMarketItemId,
  price: number,
  quantity: number,
) => write<Player>({
  Action: 'Economy.Order.Place', Side: side, Item: item,
  ActionId: economyActionId('order'),
  Price: String(Math.max(1, Math.floor(price))),
  Quantity: String(Math.max(1, Math.floor(quantity))),
});

export const cancelGoldOrder = (orderId: string) =>
  write<Player>({ Action: 'Economy.Order.Cancel', OrderId: orderId,
    ActionId: economyActionId('cancel') });

export const maintainGoldOrders = (limit = 25) =>
  write<Player>({ Action: 'Economy.Order.Maintain', Limit: String(Math.max(1, Math.floor(limit))) });

/** `buy` buys from the NPC; `sell` sells the named inventory item to it. */
export const tradeGameShop = (
  side: GoldOrderSide,
  item: GoldMarketItemId,
  quantity: number,
) => write<Player>({
  Action: 'Economy.Shop.Trade', Side: side, Item: item,
  ActionId: economyActionId('shop'),
  Quantity: String(Math.max(1, Math.floor(quantity))),
});

export const setPassRecovery = (recovery: string) =>
  write<Player>({ Action: 'Pass.SetRecovery', Recovery: recovery });

export const claimPromisedPass = (claimId: string) =>
  write<Player>({ Action: 'Pass.ClaimPromise', ClaimId: claimId });

export const recoverPassAccount = (account: string, newController: string) =>
  write<Player>({ Action: 'Pass.Recover', Account: account, NewController: newController });

export const bondPassRune = () => write<Player>({ Action: 'Pass.Bond' });
export const beginPassUnbond = () => write<Player>({ Action: 'Pass.BeginUnbond' });
export const completePassUnbond = () => write<Player>({ Action: 'Pass.CompleteUnbond' });

/** List a collection companion for a whole number of runes. */
export const listMonster = (monsterId: string, price: number) =>
  write<Player>({
    Action: 'Market.List',
    MonsterId: monsterId,
    Price: String(Math.max(1, Math.floor(price))),
  });

/** Take your own listing down; the companion returns to your collection. */
export const cancelListing = (listingId: string) =>
  write<Player>({ Action: 'Market.Cancel', ListingId: listingId });

/**
 * Buy a listed companion.
 *
 * One message does all of it — the buyer is debited, the seller credited, and
 * the companion moves — so there is no window where the runes have moved and
 * the companion has not.
 */
export const buyListing = (listingId: string) =>
  write<Player>({ Action: 'Market.Buy', ListingId: listingId });

// Rune, out of the game --------------------------------------------------------

/**
 * Take in-game Rune out to the TEST-Rune token process.
 *
 * The process deducts BEFORE it asks the token to mint, and carries the
 * withdrawal's own id as the mint's `reference` — so a mint that arrives twice
 * is recognised as the same one rather than paid out again. That ordering is
 * the whole safety property; see the note above `Rune.Withdraw` in game.lua.
 *
 * The reply comes back with `withdrawal` set to `pending`. Settlement is the
 * token process applying an outbox message, so the balance appears on the token
 * a moment later, not in this reply.
 */
export const withdrawRune = (amount: number) =>
  write<Player & { withdrawal?: RuneWithdrawal }>({
    Action: 'Rune.Withdraw',
    Amount: String(Math.max(1, Math.floor(amount))),
  });

/** This wallet's withdrawals, and the token they settle on. */
export const readWithdrawals = () =>
  write<{ withdrawals: RuneWithdrawal[]; token: string }>({ Action: 'Rune.Withdrawals' });

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
  'scroll',
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
      gold: player.gold ?? 0,
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
      passOrigin: player.pass?.origin,
      accountId: player.pass?.accountId,
      recoveryCooldownUntil: player.pass?.recoveryCooldownUntil ?? 0,
      runeBond: player.pass?.bond ?? 0,
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

export const adminPreviewEconomyPolicy = (path: string, value: unknown) =>
  write<{ path: string; oldValue: unknown; newValue: unknown; effectiveAt: number; effect?: Record<string, unknown> }>(
    { Action: 'Admin.Economy.Preview' }, JSON.stringify({ path, value }),
  );

export const adminProposeEconomyPolicy = (
  path: string, value: unknown, reason: string,
) => write<{ change: EconomyPolicyChange }>(
  { Action: 'Admin.Economy.Propose' }, JSON.stringify({ path, value, reason }),
);

export const adminApplyEconomyPolicy = (changeId: string) =>
  write<{ change: EconomyPolicyChange }>({
    Action: 'Admin.Economy.Apply', ChangeId: changeId,
  });

export const adminEmergencyPauseEconomy = (reason: string) =>
  write<{ emergency: { paused: boolean; reason: string; at: number } }>({
    Action: 'Admin.Economy.EmergencyPause', Reason: reason,
  });

export const adminPauseEconomyDesk = (
  item: GoldMarketItemId, side: GoldOrderSide, reason: string,
) => write<{ desk: { item: GoldMarketItemId; side: GoldOrderSide; paused: boolean; reason: string } }>({
  Action: 'Admin.Economy.PauseDesk', Item: item, Side: side, Reason: reason,
});

export const adminObserveRuneSupply = (totalSupply: number, reason: string) =>
  write<{ totalSupply: number }>({
    Action: 'Admin.Economy.ObserveRuneSupply', TotalSupply: String(Math.max(0, Math.floor(totalSupply))), Reason: reason,
  });

export const adminReleaseGold = (
  item: GoldMarketItemId, amount: number, reason: string,
) => write<{ release: { item: GoldMarketItemId; amount: number; issued: number; reserve: number } }>({
  Action: 'Admin.Economy.ReleaseGold', Item: item,
  Amount: String(Math.max(1, Math.floor(amount))), Reason: reason,
});

export const adminObserveGoldPolicy = (reason: string) =>
  write<{ observation: {
    target: number; qualifiedActive: number; observations: number;
    authorizedBefore: number; authorizedAfter: number;
  } }>({ Action: 'Admin.Economy.ObserveGold', Reason: reason });

export const adminConfigureGenesisPasses = (configuration: {
  addresses: string[]; commitmentHash: string; unassignedSlots: number; claimDeadline: number;
}) => write<{ genesis: Record<string, unknown>; quote: EconomyView['passQuote'] }>(
  { Action: 'Admin.Pass.ConfigureGenesis' }, JSON.stringify(configuration),
);

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
