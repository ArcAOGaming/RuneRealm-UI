/**
 * The shapes `backend/native/game.lua` actually returns.
 *
 * These are written from the handlers' `reply(...)` calls, not from the old
 * legacynet interfaces. The lesson the Dumverse port paid for twice: the two
 * ends must be read against each other, and when they disagree it is the
 * rendering side that is the specification.
 */

export type Element = 'fire' | 'water' | 'air' | 'rock';

export type ItemId =
  | 'air_berry' | 'water_berry' | 'fire_berry' | 'rock_berry'
  | 'rune' | 'scroll' | 'legendary_scroll'
  | 'ruby' | 'emerald' | 'topaz' | 'diamond';

/**
 * `Minting` is a freeze, not an activity: the companion is queued for an
 * Arweave mint and its stats must not move, because the card was composited
 * from the snapshot taken when the player paid.
 */
export type ActivityType = 'Home' | 'Play' | 'Quest' | 'Battle' | 'Minting';

export interface MonsterStatus {
  type: ActivityType;
  since: number;
  /** Milliseconds. `until` is a Lua keyword, hence the name. */
  until_time: number;
}

export interface Move {
  name?: string;
  type: Element | 'boost' | 'heal' | 'normal';
  rarity: number;
  count: number;
  damage: number;
  attack: number;
  speed: number;
  defense: number;
  health: number;
}

export interface Monster {
  name: string;
  image: string;
  sprite: string;
  faction: string;
  elementType: Element;
  berryItem: ItemId;
  attack: number;
  defense: number;
  speed: number;
  health: number;
  energy: number;
  happiness: number;
  level: number;
  exp: number;
  nextLevelExp: number;
  totalTimesFed: number;
  totalTimesPlay: number;
  totalTimesQuest: number;
  moves: Record<string, Move>;
  status: MonsterStatus;
  bornAt: number;
}

/**
 * A companion that has left the game as a one-unit Arweave asset.
 *
 * `assetId` is the asset, the process AND the image — the standard makes them
 * the same transaction. The stored `monster` is what comes back on a deposit;
 * the card carries a picture, not a stat block, so re-rolling one from the
 * image would return a different creature.
 */
export interface MintedAsset {
  assetId: string;
  mintedAt: number;
  seq: number;
  monster: Monster;
}

/**
 * A row in the process's global mint registry (`/now/assets`).
 *
 * Deliberately not a whole Monster: it carries what a listing needs to draw a
 * row without reading every player record. The card image holds the full
 * creature, and the player record holds the snapshot a deposit restores from.
 */
export interface RegistryAsset {
  assetId: string;
  /** The wallet that minted it. Never changes. */
  minter: string;
  /** Where the process last saw it. Not authoritative once it is traded. */
  holder: string;
  state: 'minted' | 'returned';
  mintedAt: number;
  returnedAt?: number;
  seq: number;
  name: string;
  element: Element;
  faction: string;
  level: number;
  attack: number;
  defense: number;
  speed: number;
  health: number;
}

export interface Player {
  /** A published character sheet on Arweave, if they have made one. */
  spriteTxId?: string;
  /** The Phaser atlas describing that sheet's frames. */
  spriteAtlasTxId?: string;
  address: string;
  exists?: boolean;
  unlocked: boolean;
  // Absent rather than null: `nil` in Lua means the key is simply not in the
  // encoded object.
  faction?: string;
  monster?: Monster;
  inventory: Partial<Record<ItemId, number>>;
  lootboxes: number[];
  battlesRemaining: number;
  wins: number;
  losses: number;
  sessionWins?: number;
  sessionLosses?: number;
  questsCompleted: number;
  joinedAt: number;
  dailyStreak?: number;
  bestStreak?: number;
  offerings?: number;
  lastActiveAt?: number;
  lastAction?: string;
  activeBattleId?: string;
  /** When the daily worship can next be claimed. 0 means "never claimed". */
  dailyReadyAt: number;
  lastDaily?: number;
  /** Present only on the reply to the action that produced them. */
  rewards?: { happiness?: number; exp?: number; lootbox?: number };
  dailyClaimed?: { runes: number; lootboxRarity: number };
  /** Set when Battle.Leave withdrew an unaccepted challenge rather than forfeiting. */
  withdrawn?: boolean;
  /** Minted companions, keyed by asset id. Always present, possibly empty. */
  assets?: Record<string, MintedAsset>;
  /** The mint in flight, if any. Cleared by Admin.Minted or Admin.MintFailed. */
  mint?: { seq: number; state: string; requestedAt: number };
  lootResult?: LootResult;
  battle?: Battle;
  result?: 'win' | 'loss';
  waitingForOpponent?: boolean;
  /**
   * When a stalled PvP round may be forced through, if the opponent has still
   * not moved. Present only while waiting.
   */
  canForceAt?: number;
}

export interface LootResult {
  rarity: number;
  rewards: Array<{ item: ItemId; name: string; amount: number }>;
}

/**
 * A fighter. NOT a `Monster`: `Battle.makeOpponent` builds a bot with no
 * `status`, `energy`, `happiness`, `exp`, `berryItem` or activity totals, so
 * declaring this as `extends Monster` would promise fields that are simply
 * absent from half the combatants on screen. That is the exact shape that
 * produced the crash on `inventory.rune`.
 */
export interface Combatant {
  side: 'challenger' | 'accepter';
  address: string;
  name: string;
  image: string;
  sprite?: string;
  faction?: string;
  elementType: Element;
  level: number;
  attack: number;
  defense: number;
  speed: number;
  health: number;
  healthPoints: number;
  maxHealthPoints: number;
  shield: number;
  maxShield: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  moves: Record<string, Move>;
}

export interface CombatantState {
  side: 'challenger' | 'accepter';
  name: string;
  healthPoints: number;
  maxHealthPoints: number;
  shield: number;
  maxShield: number;
  attack: number;
  defense: number;
  speed: number;
  elementType: Element;
}

export interface Turn {
  round: number;
  attacker: 'challenger' | 'accepter';
  attackerAddress: string;
  monsterName: string;
  move: string;
  moveType: Move['type'];
  moveRarity: number;
  missed: boolean;
  shieldDamage: number;
  healthDamage: number;
  statsChanged: Partial<Record<'attack' | 'speed' | 'defense' | 'health', number>>;
  superEffective: boolean;
  notEffective: boolean;
  attackerState: CombatantState;
  defenderState: CombatantState;
}

export interface Battle {
  id: string;
  kind: 'bot' | 'pvp';
  status: 'pending' | 'battling' | 'ended';
  round: number;
  turns: Turn[];
  startedAt: number;
  winner?: 'challenger' | 'accepter';
  challenger: Combatant;
  /** Absent while a PvP challenge is still open. */
  accepter?: Combatant;
  challengerAddress?: string;
  accepterAddress?: string;
  challengeType?: 'OPEN' | 'TARGETED';
  targetAccepter?: string | null;
  /** Which sides have committed a move this round. Never WHAT they committed. */
  waitingOn?: { challenger?: boolean; accepter?: boolean };
  /** The last round resolved without one player, past the move deadline. */
  forcedRound?: boolean;
  /** The fight hit the round cap and was decided on remaining health. */
  timedOut?: boolean;
  forfeited?: boolean;
}

export interface FactionMember {
  id: string;
  level: number;
  wins: number;
  timesFed: number;
  timesPlay: number;
  timesQuest: number;
}

export interface Faction {
  name: string;
  element: Element;
  description: string;
  mascot: string;
  berry: ItemId;
  monsterName: string;
  monsterImage: string;
  memberCount: number;
  monsterCount: number;
  members: FactionMember[];
  averageLevel: number;
  totalTimesFed: number;
  totalTimesPlay: number;
  totalTimesQuest: number;
}

export interface LeaderboardRow {
  address: string;
  faction?: string;
  name: string;
  element: Element;
  level: number;
  exp: number;
  wins: number;
  losses: number;
  quests: number;
  /**
   * The whole companion, moves included, so the standings can draw a card per
   * trainer without a request per trainer. Optional only because a process
   * deployed before this existed publishes rows without it.
   */
  monster?: Monster;
}

export interface OpenChallenge {
  id: string;
  challenger: string;
  monsterName: string;
  level: number;
  element: Element;
  startedAt: number;
}

/**
 * The engine's tuning, published by the process in `catalog`.
 *
 * The client used to derive a companion's HP and a move's damage from constants
 * copied into the UI, and they had drifted: a health stat of 5 was displayed as
 * "50 HP" and fought with 60. Reading them from the process is the only way
 * those two numbers stay the same number.
 */
export interface Tuning {
  attackBase: number;
  variance: number;
  hpPerHealth: number;
  shieldPerDefense: number;
  healPerPoint: number;
  shieldRegen: number;
  moveUses: number;
  struggleDamage: number;
  baseHitChance: number;
  minHitChance: number;
  maxHitChance: number;
}

export interface Catalog {
  items: Record<string, { id: ItemId; name: string; section: string; element?: Element }>;
  activities: Record<string, unknown>;
  elements: Element[];
  tuning: Tuning;
  effectiveness: Record<Element, Record<Element, number>>;
}

export interface GameStats {
  players: number;
  unlocked: number;
  monsters: number;
  battles: number;
  owner: string;
}

export interface AdminPlayerSummary {
  address: string;
  unlocked: boolean;
  faction?: string;
  name?: string;
  element?: Element;
  level: number;
  exp: number;
  energy: number;
  happiness: number;
  status: ActivityType | 'No companion';
  inventory: Partial<Record<ItemId, number>>;
  /** Counts by rarity; index 0 is tier one. */
  lootboxes: number[];
  wins: number;
  losses: number;
  questsCompleted: number;
  battlesRemaining: number;
  activeBattleId?: string;
  dailyStreak: number;
  bestStreak: number;
  offerings: number;
  lastDaily: number;
  joinedAt: number;
  lastActiveAt: number;
  lastAction?: string;
  assets: number;
}

export interface AdminBattleSummary {
  id: string;
  kind: 'bot' | 'pvp';
  status: 'pending' | 'battling';
  round: number;
  startedAt: number;
  challenger?: string;
  challengerName?: string;
  accepter?: string;
  accepterName?: string;
  challengeType?: 'OPEN' | 'TARGETED';
}

export interface AdminFactionStats {
  name: string;
  element: Element;
  members: number;
  companions: number;
  averageLevel: number;
  wins: number;
  losses: number;
  quests: number;
  runes: number;
  offerings: number;
  worshipersToday: number;
  feeds: number;
  plays: number;
}

export interface AdminMetricDay {
  actions: Record<string, number>;
  factions: Partial<Record<Element, number>>;
  activePlayers?: number;
  players?: number;
  unlocked?: number;
  monsters?: number;
  runes?: number;
  lootboxes?: number;
  activeBattles?: number;
  wins?: number;
  losses?: number;
  quests?: number;
  feeds?: number;
  playsStarted?: number;
  playsCompleted?: number;
  questsStarted?: number;
  questsCompleted?: number;
  worshipClaims?: number;
  lootboxesOpened?: number;
  battlesStarted?: number;
  battlesCompleted?: number;
  roundsPlayed?: number;
  runeAdded?: number;
  runeRemoved?: number;
  adminActions?: number;
  [key: string]: number | Record<string, number | undefined> | undefined;
}

export interface AdminMetrics {
  since: number;
  totals: Record<string, number>;
  daily: Record<string, AdminMetricDay>;
}

export interface AdminAuditEntry {
  seq: number;
  timestamp: number;
  actor?: string;
  action: string;
  target?: string;
  summary: string;
}

export interface AdminOperationalStats {
  players: number;
  unlocked: number;
  monsters: number;
  activeBattles: number;
  completedBattles: number;
  wins: number;
  losses: number;
  quests: number;
  runes: number;
  lootboxes: number;
  offerings: number;
  activeToday: number;
  items: Partial<Record<ItemId, number>>;
  mintedAssets: number;
}

export interface AdminSnapshot {
  generatedAt: number;
  players: AdminPlayerSummary[];
  battles: AdminBattleSummary[];
  factions: AdminFactionStats[];
  stats: AdminOperationalStats;
  metrics: AdminMetrics;
  audit: AdminAuditEntry[];
}

export interface AdminPlayerPatch {
  account?: Partial<Pick<Player,
    'unlocked' | 'faction' | 'wins' | 'losses' | 'questsCompleted' |
    'battlesRemaining' | 'dailyStreak' | 'bestStreak' | 'offerings' |
    'lastDaily' | 'joinedAt'>>;
  inventory?: Partial<Record<ItemId, number>>;
  lootboxes?: Record<string, number>;
  monster?: Partial<Pick<Monster,
    'name' | 'level' | 'exp' | 'attack' | 'defense' | 'speed' | 'health' |
    'energy' | 'happiness' | 'totalTimesFed' | 'totalTimesPlay' |
    'totalTimesQuest'>> & { status?: Partial<MonsterStatus>; rerollMoves?: boolean };
  createMonster?: boolean;
  clearBattle?: boolean;
}

/** Every handler answers either a payload or `{ error }`. */
export type Reply<T> = T & { error?: string };

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}
