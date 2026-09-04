/**
 * The shapes `backend/native/game.lua` actually returns.
 *
 * These are written from the handlers' `reply(...)` calls, not from the old
 * legacynet interfaces. The lesson the Dumverse port paid for twice: the two
 * ends must be read against each other, and when they disagree it is the
 * rendering side that is the specification.
 */

export type Element = 'fire' | 'water' | 'air' | 'rock';
/** `normal` is an untyped creature affinity, not a fifth element. */
export type Affinity = Element | 'normal';

export type BerryItemId = 'air_berry' | 'water_berry' | 'fire_berry' | 'rock_berry';

export type ItemId = BerryItemId | 'rune' | 'scroll' | 'legendary_scroll';

export type GoldMarketItemId = ItemId;
export type GoldOrderSide = 'buy' | 'sell';

export interface EconomyOrder {
  id: string;
  seq: number;
  account: string;
  side: GoldOrderSide;
  item: GoldMarketItemId;
  price: number;
  quantity: number;
  remaining: number;
  createdAt: number;
  expiresAt: number;
}

export interface EconomyFill {
  id: string;
  item: GoldMarketItemId;
  buyOrder: string;
  sellOrder: string;
  buyer: string;
  seller: string;
  maker: string;
  taker: string;
  price: number;
  quantity: number;
  gross: number;
  fee: number;
  filledAt: number;
}

export interface EconomyRollingFlow { issued: number; consumed: number }

export interface EconomyAssetLedger {
  issued: number;
  consumed: number;
  player: number;
  escrow: number;
  shop: number;
  rolling7d: EconomyRollingFlow;
  rolling30d: EconomyRollingFlow;
  sources: Record<string, number>;
  sinks: Record<string, number>;
}

export interface EconomyInvariant {
  ok: boolean;
  expected: number;
  accounted: number;
  difference: number;
}

export interface EconomyDesk {
  item: GoldMarketItemId;
  stock: number;
  stockCap: number;
  goldReserve: number;
  anchorBps: number;
  band?: number;
  bid?: number;
  ask?: number;
  limits: { perAction: number; perAccount: number; global: number };
  enabled: Record<GoldOrderSide, boolean>;
  /** Player-facing sides: buy means buying from the NPC; sell means selling to it. */
  pause: Partial<Record<GoldOrderSide, string>>;
  projectedExhaustion: number;
  traded: { bought: number; sold: number; goldIn: number; goldOut: number };
}

export interface EconomyMarketStats {
  bestBid?: number;
  bestAsk?: number;
  depth: {
    bids: Array<{ price: number; quantity: number }>;
    asks: Array<{ price: number; quantity: number }>;
  };
  volume24h: number;
  volume7d: number;
  median7d?: number;
  median30d?: number;
  medianSamples7d: number;
  medianSamples30d: number;
  uniqueMakers7d: number;
  uniqueTakers7d: number;
}

export interface EconomyPolicyChange {
  id: string;
  path: string;
  oldValue: number | boolean | Record<string, number>;
  newValue: number | boolean | Record<string, number>;
  actor: string;
  reason: string;
  proposedAt: number;
  effectiveAt: number;
  status: 'pending' | 'applied' | string;
  appliedAt?: number;
}

export interface EconomyView {
  version: number;
  mode: 'testing' | 'active' | string;
  generatedAt: number;
  invariants: {
    ok: boolean;
    gold: EconomyInvariant;
    assets: Record<GoldMarketItemId, EconomyInvariant>;
    lootboxes: EconomyInvariant[];
    rune: {
      inGame: number;
      outsideTokenSupply?: number;
      pendingWithdrawals: number;
      pendingDeposits: number;
      economic: number;
      accounted: number;
      difference?: number;
      observedAt: number;
    };
  };
  gold: {
    issued: number; burned: number; outstanding: number; authorized: number;
    ceiling: number; player: number; escrow: number; shop: number; locked: number;
    target: number; perQualifiedPlayer: number; qualifiedActive: number;
    candidateQualifiedActive: number;
    rolling7d: EconomyRollingFlow; rolling30d: EconomyRollingFlow;
  };
  assets: Record<GoldMarketItemId, EconomyAssetLedger>;
  lootboxes: Array<{
    issued: number; opened: number; held: number;
    rolling7d: EconomyRollingFlow; rolling30d: EconomyRollingFlow;
    sources: Record<string, number>;
  }>;
  orders: EconomyOrder[];
  fills: EconomyFill[];
  market: Record<GoldMarketItemId, EconomyMarketStats>;
  desks: Partial<Record<GoldMarketItemId, EconomyDesk>>;
  rejected: Record<string, number>;
  policy: {
    emergency: { paused: boolean; reason?: string; at: number; actor?: string };
    gold: Record<string, number | boolean>;
    qualification: { enabled: boolean; reason?: string; requiredDistinctDays: number; requiredSinkActions: number };
    runeRewards: Record<string, unknown> & { enabled: boolean; epochBudget: number; reserveBalance: number; reason?: string };
    proceeds: { teamBps: number; runeBps: number; treasuryBps: number };
    amm: { maxSlippageBps: number; maxWeeklyPoolBps: number };
    runeAcquisition: { budgetQuote: number; quoteSpent: number; runeReceived: number; executions: unknown[] };
    passes: Record<string, unknown> & {
      genesisSealed: boolean; genesisPassCount: number; lifetimePassCount: number;
      legacyCount: number; promisedCount: number; promisedManifestHash?: string;
      unassignedPromiseSlots: number; promiseClaimDeadline: number;
      purchaseEnabled: boolean; foregoneRuneAcquisitionReference: number;
    };
    externalRuneSupply?: number;
    externalRuneObservedAt: number;
    pending: Record<string, EconomyPolicyChange>;
    history: Array<Record<string, unknown>>;
  };
  passQuote: {
    referenceUnit: string; launch: number; growth: number; security: number; next: number;
    genesisPassCount: number; lifetimePassCount: number; purchaseEnabled: boolean;
    paymentAsset?: string;
  };
}

export interface PassRecord {
  accountId: string;
  controller: string;
  origin: 'legacy' | 'promised' | 'purchased' | 'sponsored' | 'test' | string;
  grantedAt: number;
  recoveryController?: string;
  recoverySetAt?: number;
  recoveredAt: number;
  recoveryCooldownUntil: number;
  bond: number;
  unbond?: { amount: number; requestedAt: number; readyAt: number };
}

export type BattleStat = 'attack' | 'defense' | 'speed' | 'health';

/** Three berries consumed for a temporary four-fight arena boost. */
export interface ArenaBoost {
  item: BerryItemId;
  stat: BattleStat;
  amount: number;
  cost: number;
}

/**
 * `Minting` is a freeze, not an activity: the companion is queued for an
 * Arweave mint and its stats must not move, because the card was composited
 * from the snapshot taken when the player paid.
 */
export type ActivityType = 'Home' | 'Play' | 'Quest' | 'Battle' | 'Hunt' | 'Minting';

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
  /**
   * Unique within the owning account.
   *
   * Per-player rather than global: an id only has to tell one player's
   * companions apart, and it is reissued when a companion changes hands, so it
   * is never a stable name for the creature across owners.
   */
  id: string;
  /** Permanent Monster Index form number; absent only on older deployments. */
  entryNo?: number;
  /** Resolved presentation helpers supplied with Monster Index-aware views. */
  entryKey?: string;
  evolutionStage?: 1 | 2 | 3;
  nameMode?: 'species' | 'custom';
  name: string;
  image: string;
  sprite: string;
  /** Every companion is holographic for now. The field exists so that can change. */
  holographic: boolean;
  /** Card art, carried by the companion rather than derived from its element. */
  background: string;
  border: string;
  faction: string;
  elementType: Affinity;
  berryItem?: ItemId;
  careMode?: 'element-berry' | 'any-berry';
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
 * A companion for sale, held in escrow by the game process.
 *
 * `monster` is the whole record, not a summary: a listed companion is in the
 * market and in nobody's collection, so there is no second place to look it up.
 */
export interface Listing {
  id: string;
  seller: string;
  /** In-game runes. Not the withdrawn token. */
  price: number;
  listedAt: number;
  monster: Monster;
}

/** A completed sale. Newest first, capped at 100 by the process. */
export interface Sale {
  id: string;
  seller: string;
  buyer: string;
  price: number;
  soldAt: number;
  entryNo?: number;
  name: string;
  element: Affinity;
  level: number;
}

/**
 * One `Rune.Withdraw`, from deduction to settlement on the token.
 *
 * `pending` is the normal state for a moment: the game deducts and queues the
 * token's mint in the same message, and the token applies it from its own
 * outbox afterwards. The id is carried to the token as the mint's `reference`,
 * which is what makes a duplicate recognisable rather than payable twice.
 */
export interface RuneWithdrawal {
  id: string;
  address?: string;
  amount: number;
  status: 'pending' | 'settled' | string;
  requestedAt?: number;
  settledAt?: number;
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
  entryNo?: number;
  name: string;
  element: Affinity;
  faction: string;
  level: number;
  attack: number;
  defense: number;
  speed: number;
  health: number;
}

export interface HuntRoute {
  protocol: 'runerealm-hunt/1';
  status: 'opening' | 'roaming' | 'settling' | string;
  runId: string;
  ticket: string;
  playerId: string;
  monsterId: string;
  processId: string;
  node?: string;
  openedAt: number;
  lastCapture?: HuntCaptureReceipt;
}

export interface HuntCaptureReceipt {
  settlementId?: string;
  encounterId: string;
  success: boolean;
  chance: number;
  roll: number;
  runesSpent: number;
  monster?: Monster;
  settledAt?: number;
}

export interface HuntRun {
  protocol: 'runerealm-hunt/1';
  runId: string;
  playerId: string;
  monsterId: string;
  status: 'opening' | 'roaming' | 'battle' | 'defeated' | 'settling' | 'lost' | 'ended';
  openedAt: number;
  encounterCount: number;
  lastSearchAt?: number;
  encounter?: Monster;
  battle?: Battle;
  captureAvailable?: boolean;
  lastCapture?: HuntCaptureReceipt;
  settlementStatus?: 'pending' | 'acknowledged';
  duplicate?: boolean;
}

export interface HuntTuning {
  protocol: 'runerealm-hunt/1';
  levelRange: number;
  searchCooldown: number;
  /** Paid once when Hunt.Begin creates a new run; retries never pay twice. */
  entry?: {
    berries: Record<BerryItemId, number>;
  };
  capture: {
    minRuneBid: number;
    maxRuneBid: number;
    minChance: number;
    maxChance: number;
    baseChance: number;
    runeScale: number;
    runeHalf: number;
    levelStep: number;
  };
}

/** The six composited layers that make a player character. */
export type CharacterCategory = 'Hair' | 'Hat' | 'Shirt' | 'Pants' | 'Gloves' | 'Shoes';

export interface CharacterPiece {
  /** Bundled style name, such as `Beanie`, `Long`, or `None`. */
  style: string;
  /** The dye selected for this layer, as `#rrggbb`. */
  color: string;
}

/**
 * Character source data stored by the game.
 *
 * The sprite sheet is derived from this map in the browser. Keeping the small
 * recipe means changing a character is one game write, with no Arweave upload
 * and no permanent bitmap/atlas pair.
 */
export type CharacterOutfit = Record<CharacterCategory, CharacterPiece>;

export interface Player {
  /** Current character recipe. New characters use this instead of uploads. */
  outfit?: CharacterOutfit;
  /** Legacy published sheet, retained so existing characters still render. */
  spriteTxId?: string;
  /** Legacy atlas describing that sheet's frames. */
  spriteAtlasTxId?: string;
  address: string;
  exists?: boolean;
  unlocked: boolean;
  // Absent rather than null: `nil` in Lua means the key is simply not in the
  // encoded object.
  faction?: string;
  /**
   * The active companion — the same record as `monsters[activeId]`, not a copy.
   *
   * Every untargeted verb (feed, quest, battle) acts on this one, which is why
   * a client that knows nothing about the roster still works.
   */
  monster?: Monster;
  /** The active companion as a one-entry map, keyed by monster id. */
  monsters?: Record<string, Monster>;
  /** Owned but not active. Unbounded, and the only place a listing comes from. */
  collection?: Record<string, Monster>;
  activeId?: string;
  /** Always one in the current game; retained for old clients and migrations. */
  rosterMax?: number;
  /**
   * Whether this account has ever used its one adoption.
   *
   * The onboarding gate, and deliberately not "does this account hold a
   * companion". Those came apart the moment a companion could be sold or given
   * away: an empty account is a state a player can return to on purpose, so
   * offering adoption to anyone holding nothing handed out an endless free
   * supply. A player who has adopted and now holds nothing is not a new player
   * — they are somebody who needs the market, and the screen has to say so.
   */
  adopted?: boolean;
  /** Permanent discovery; current ownership is derived separately. */
  seenEntries?: number[];
  seenEntriesVersion?: number;
  pass?: PassRecord;
  /** Present only on the reply to `Market.List`. */
  listing?: Listing;
  inventory: Partial<Record<ItemId, number>>;
  gold: number;
  lootboxes: number[];
  battlesRemaining: number;
  /** Applies to battle copies for this arena session; permanent stats never move. */
  arenaBoost?: ArenaBoost;
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
  /**
   * Immutable account-authority route for a feature-gated bot battle. It is
   * published with the player so a reload can resume directly on the worker.
   * PvP and disabled deployments never set it.
   */
  battleFleet?: BattleFleetRoute;
  /** Route to the separate Hunt process while the chosen companion is away. */
  hunt?: HuntRoute;
  /** Present on the game-process reply that settled a capture roll. */
  huntCapture?: HuntCaptureReceipt;
  /** Browser-only state while rebuilding a fleet battle from worker cache. */
  battleFleetHydration?: 'opening' | 'unavailable' | 'invalid' | 'ready' | 'cancel-pending';
  /** When the daily worship can next be claimed. 0 means "never claimed". */
  dailyReadyAt: number;
  lastDaily?: number;
  /** Present only on the reply to the action that produced them. */
  rewards?: { happiness?: number; exp?: number; lootbox?: number };
  /**
   * What the daily worship actually paid out.
   *
   * `runeRewardReason` is why `runes` is what it is, and it is not decoration:
   * global Rune emission is an unresolved launch decision, so it ships PAUSED
   * (`runeRewards.enabled = false`, `epochBudget = 0`) and every worship pays
   * zero. The process has always said so in this field and the dialog has never
   * read it, which is why claiming looked like a broken faucet — "+0 Runes" and
   * no explanation — rather than a switch nobody has turned on yet.
   */
  dailyClaimed?: {
    runes: number;
    lootboxRarity: number;
    runeRewardReason?: string;
    streak?: number;
    offerings?: number;
    factionOfferings?: number;
  };
  economyResult?: {
    order?: EconomyOrder;
    fills?: EconomyFill[];
    open?: boolean;
    cancelled?: string;
    expired?: number;
    item?: GoldMarketItemId;
    side?: GoldOrderSide;
    quantity?: number;
    total?: number;
    average?: number;
  };
  recovery?: { from: string; to: string; cooldownUntil: number };
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

/**
 * One browser-session activity settlement.
 *
 * The process only includes `rewards` on the reply that grants them, so the
 * companion screen captures that reply before the next free refresh can
 * replace it. The id makes the visual celebration exactly-once even when
 * React re-renders the room while the animation is running.
 */
export interface ActivityReceipt {
  id: string;
  kind: 'Play' | 'Quest';
  rewards: NonNullable<Player['rewards']>;
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
  entryNo?: number;
  elementType: Affinity;
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
  /**
   * The four stats summed and frozen when the fight started, which is what the
   * engine sizes `attackPerStatPoint` against. Absent on a battle produced by a
   * process deployed before the floor existed.
   */
  statBudget?: number;
  moves: Record<string, Move>;
  /** The session's berry boost already folded into this combatant's displayed stats. */
  battleBoost?: ArenaBoost;
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
  elementType: Affinity;
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
  /**
   * The swing rolled a critical.
   *
   * The counterpart to `missed`, rolled from the same stream right after the
   * damage variance — see `Battle.TUNING.criticalChance`. Absent on turns
   * recorded before crits existed, so it is optional rather than assumed.
   */
  critical?: boolean;
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
  kind: 'bot' | 'pvp' | 'hunt';
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
  /** Worker metadata on fleet bot battles. */
  protocol?: string;
  workerId?: string;
  settlementStatus?: 'pending' | 'acknowledged' | string;
  cancellationStatus?: 'pending' | 'acknowledged' | string;
}

export interface BattleFleetRoute {
  protocol: 'runerealm-battle-fleet/1' | string;
  status: 'opening' | 'battling' | 'cancel-pending' | string;
  battleId: string;
  reservationId: string;
  assignmentId: string;
  ticket: string;
  workerId: string;
  workerProcessId: string;
  node?: string;
}

export interface BattleFleetConfig {
  enabled: boolean;
  protocol: 'runerealm-battle-fleet/1' | string;
  node?: string;
  workers: Array<Pick<BattleFleetRoute, 'workerId' | 'workerProcessId'>>;
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
  monsterEntryNo?: number;
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
  element: Affinity;
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
  element: Affinity;
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
  /**
   * The two damage FLOORS, added to the attack stat before a move's power is
   * multiplied by it — see `attackFloor` in battle.lua. They exist because
   * health and defense are multiplied on the way into a fight and damage is
   * not, so a build that never buys attack used to stop scaling entirely.
   *
   * Both are optional here: a process deployed before they existed publishes a
   * tuning without them, and a missing floor is a zero floor.
   */
  attackPerLevel?: number;
  attackPerStatPoint?: number;
  /** The budget `attackPerStatPoint` is measured from — every companion starts on ten. */
  attackBudgetBaseline?: number;
  variance: number;
  hpPerHealth: number;
  shieldPerDefense: number;
  healPerPoint: number;
  /**
   * Share of its cap a shield recovers at the end of a round in which its
   * owner took no damage. Nothing is recovered in a round they were hit.
   */
  shieldRegenShare: number;
  moveUses: number;
  struggleDamage: number;
  baseHitChance: number;
  minHitChance: number;
  maxHitChance: number;
  criticalChance: number;
  criticalMultiplier: number;
}

export type MonsterIndexLifecycle = 'planned' | 'art-in-progress' | 'testing' | 'live' | 'retired';
export type MonsterIndexAssetStatus = 'missing' | 'planned' | 'partial' | 'draft' | 'fallback' | 'approved';
export type MonsterRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type MonsterSourceRows = Record<
  'idle' | 'emote' | 'walk.right' | 'walk.left' | 'walk.up' | 'walk.down',
  number
>;

export interface MonsterIndexAssetSlot {
  status: MonsterIndexAssetStatus;
  path?: string;
  notes?: string;
  sourceRect?: readonly [number, number, number, number];
  /** Optional authored row map for uniform-grid world sheets. */
  rows?: MonsterSourceRows;
}

export interface MonsterIndexEntry {
  entryNo: number;
  entryKey: string;
  lineKey: string;
  stage: 1 | 2 | 3;
  /** Null while an unreleased evolution still has only a working label. */
  displayName?: string | null;
  /** Contract views use `name`; generated authoring views use `displayName`. */
  name?: string | null;
  workingName: string;
  affinity: Affinity;
  rarity?: MonsterRarity;
  /** Number and placement may change until the content line is accepted. */
  provisional?: boolean;
  starterFaction?: string | null;
  evolution?: { from: number | null; to: number | null; atLevel: number | null };
  evolvesFrom?: number | null;
  evolvesTo?: number | null;
  evolvesAtLevel?: number | null;
  moves?: { basic: string | null; advanced: string | null };
  basicMove?: string | null;
  advancedMove?: string | null;
  availability?: {
    state: MonsterIndexLifecycle;
    starter: boolean;
    huntCatchable: boolean;
    huntWeight: number;
  };
  state?: MonsterIndexLifecycle;
  starter?: boolean;
  huntCatchable?: boolean;
  huntWeight?: number;
  assetReady?: boolean;
  artRevision: string;
  assets?: Record<'portrait' | 'world' | 'basicAttack' | 'advancedAttack' | 'runtimeAtlas', MonsterIndexAssetSlot>;
  plan?: { appearance: string; basicAttack: string; advancedAttack: string };
}

export interface MonsterIndexView {
  schemaVersion: number;
  catalogHash?: string;
  revision: number;
  nextEntryNo: number;
  entries: MonsterIndexEntry[];
}

export interface Catalog {
  items: Record<string, { id: ItemId; name: string; section: string; element?: Element }>;
  activities: Record<string, unknown>;
  /** Absent on deployments from before Hunt shipped. */
  hunt?: HuntTuning;
  elements: Element[];
  tuning: Tuning;
  monsterIndex?: { schemaVersion: number; nextEntryNo: number };
  effectiveness: Record<Element, Record<Element, number>>;
  /**
   * What a level-up costs, as a rule rather than a number.
   *
   * Absent on deployments from before levelling was charged for. Price a
   * level-up with `levelUpCost` rather than inlining the arithmetic — the
   * process owns this rule, and a client that hardcodes it drifts from the
   * engine exactly the way the HP and damage numbers once did.
   */
  levelUp?: {
    points: number;
    maxPerStat: number;
    levelsPerRune: number;
    costItem: ItemId;
  };
  /**
   * Every move definition, by pool then by name. The join table.
   *
   * A stored move is `{ count }` and nothing else — the other eight fields are
   * identical for every companion that ever rolled that move, so the process
   * publishes them once, here, instead of once per companion in every player
   * record, leaderboard row and listing it writes. `hydrateMoves` in
   * `lib/game.ts` puts them back at the read boundary, so components still see
   * a whole `Move`.
   *
   * Absent on deployments from before the split; those publish whole moves
   * already and the join is a no-op against them.
   */
  movePools?: Record<string, Record<string, Omit<Move, 'name'> & { name?: string }>>;
}

/**
 * Rune cost of reaching `targetLevel`: one per `levelsPerRune` levels, rounded
 * up. Returns 0 when the deployment predates the charge, so an older process
 * keeps working rather than showing a price it will not take.
 */
export function levelUpCost(catalog: Catalog | null | undefined, targetLevel: number): number {
  const per = catalog?.levelUp?.levelsPerRune;
  if (!per || per <= 0) return 0;
  return Math.ceil(Math.max(1, targetLevel) / per);
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
  element?: Affinity;
  level: number;
  exp: number;
  energy: number;
  happiness: number;
  status: ActivityType | 'No companion';
  inventory: Partial<Record<ItemId, number>>;
  gold: number;
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
  passOrigin?: string;
  accountId?: string;
  recoveryCooldownUntil: number;
  runeBond: number;
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
  economy?: EconomyView;
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
