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

/**
 * Time in force. Everything else a book does is a special case of these four.
 *
 * `GTC` rests whatever it could not fill. `IOC` is the market order — take what
 * is there at this limit or better and cancel the rest — which is how "spend N
 * Gold" is expressed: the client reads the ask ladder, computes the limit, and
 * sends an IOC. `FOK` refuses unless the whole quantity can be taken at once.
 * `PostOnly` refuses to cross, so a maker can never pay a taker fee by
 * accident.
 *
 * The process never accepts an unpriced order, so the limit is always ours to
 * work out. See ORDERBOOK.md §2.1.
 */
export type GoldOrderTif = 'GTC' | 'IOC' | 'FOK' | 'PostOnly';

/**
 * What happens when an order would trade with the sender's own resting one.
 *
 * `CancelResting` is the default and pulls the account's own crossing quote so
 * the new order can go on; `Reject` is the old refuse-everything behaviour, for
 * an automated maker that would rather be told; `CancelBoth` leaves the account
 * flat.
 */
export type GoldOrderStp = 'CancelResting' | 'Reject' | 'CancelBoth';

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
  /** `<base>/<quote>`. Absent on orders placed before the market registry. */
  market?: string;
  /** Base units per lot. One on every current market. */
  lot?: number;
  /** Set on an order produced by a re-queueing amend: the id it replaced. */
  amendedFrom?: string;
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
  /** True when the counterparty was the NPC desk quoting into the ladder. */
  house?: boolean;
}

/**
 * One of the caller's own open orders, carried on the PLAYER record.
 *
 * Not a convenience copy of `EconomyOrder` — it is where own-orders now live.
 * The published book is a tax on every message the process handles rather than
 * a market-screen cost: `economy.orders` is a full copy of every open order,
 * and the whole published map is marshalled five times per slot whatever the
 * handler did. A trader only ever draws their own handful, so it goes per
 * wallet and bounded, and the global array shrinks to the aggregated ladder.
 *
 * `account` and `seq` are gone because the record the list hangs off already
 * says whose it is; `market` arrives instead, because the registry id is the
 * one thing the item alone no longer tells you.
 *
 * Absent when there are none: `nil` in Lua is a key that is simply not there.
 */
export interface PlayerOpenOrder {
  id: string;
  /** Registry market id, `<base>/<quote>`. */
  market: string;
  item: GoldMarketItemId;
  side: GoldOrderSide;
  price: number;
  quantity: number;
  remaining: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * One of the caller's own fills, on the player record for the same reason and
 * bounded the same way.
 *
 * `side` and `role` are THIS account's, which is the thing a global
 * `EconomyFill` cannot state without being read back against an address.
 */
export interface PlayerFill {
  id: string;
  market: string;
  item: GoldMarketItemId;
  side: GoldOrderSide;
  price: number;
  quantity: number;
  gross: number;
  fee: number;
  filledAt: number;
  role: 'maker' | 'taker';
}

export interface EconomyRollingFlow { issued: number; consumed: number }

/**
 * One day of a market, as open/high/low/close plus volume.
 *
 * Compact on purpose: this is published for every market, every day, forever,
 * and every published byte is marshalled five times on every message the
 * process handles — see the note at the head of `CLAUDE.md`. Four letters and
 * four integers is a chart the raw fills cannot draw, at a fraction of what
 * the raw fills cost.
 */
export interface EconomyCandle {
  /** Day index: epoch milliseconds divided by 86_400_000. */
  d: number;
  o: number; h: number; l: number; c: number;
  /** Base units traded, Gold turned over, and how many fills made it up. */
  v: number; g: number; n: number;
}

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
  /* One row per PRICE LEVEL, with `orders` counting how many rest there.
     Older deployments publish one row per order and no `orders` field, which
     is why the renderer still collapses by price defensively. */
  /* What the PLAYERS alone are quoting, with the house taken out.
     `bestBid`/`bestAsk` include the NPC desk, because a taker gets whichever
     of the two is better without choosing a venue. These two are what the
     corridor is stated over: while the P2P best sits inside the desk's band
     the desk is never the best price on either side. */
  p2pBid?: number;
  p2pAsk?: number;
  /** The desk's own quote, and how deep it is before the band moves. */
  houseBid?: number;
  houseAsk?: number;
  houseBidUnits: number;
  houseAskUnits: number;
  /** The corridor an order must be priced inside, or absent if unpriced. */
  band?: { low: number; high: number; bps: number };
  depth: {
    bids: Array<{ price: number; quantity: number; orders?: number; house?: number }>;
    asks: Array<{ price: number; quantity: number; orders?: number; house?: number }>;
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
  /* Daily OHLCV, oldest first, one array per market that has ever traded.
     `d` is a day index (epoch ms / 86_400_000), `v` base volume, `g` Gold
     turned over and `n` the number of fills. These are permanent; `fills` is a
     500-row ring, so anything older than the last five hundred trades exists
     here and nowhere else. */
  candles?: Partial<Record<GoldMarketItemId, EconomyCandle[]>>;
  desks: Partial<Record<GoldMarketItemId, EconomyDesk>>;
  /* The market registry, keyed `<base>/<quote>`. Fees, tick, lot and status
     are per market and are read from here, never assumed. */
  markets?: Record<string, {
    id: string; base: string; quote: string;
    tick: number; lot: number; minValue: number;
    maxPrice: number; maxQuantity: number;
    takerBps: number; makerBps: number; rebateBps: number;
    feeCarry: number; status: string;
    /** Basis points either side of the reference price. 0 switches it off. */
    bandBps?: number;
    /** Whether the NPC desk quotes into this market's ladder. */
    houseQuotes?: boolean;
  }>;
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
    /** The best tier awarded. With a streak ladder this is no longer a constant. */
    lootboxRarity: number;
    /**
     * Everything the streak actually paid, because it is no longer always one
     * box: `C.DAILY.streakTiers` gives a second crate from a 3-day streak and a
     * tier-3 from ten. Absent on a deployment predating the ladder, in which
     * case `lootboxRarity` alone is the whole award.
     */
    lootboxes?: Array<{ rarity: number; count: number }>;
    runeRewardReason?: string;
    streak?: number;
    offerings?: number;
    factionOfferings?: number;
  };
  /** This account's live orders on the Gold book, already free of expired ones. */
  openOrders?: PlayerOpenOrder[];
  /** This account's own fills, newest first and bounded by the process. */
  recentFills?: PlayerFill[];
  economyResult?: {
    order?: EconomyOrder;
    fills?: EconomyFill[];
    open?: boolean;
    cancelled?: string | number;
    /** Every id a batch cancel released. */
    cancelledIds?: string[];
    expired?: number;
    /** Echoed back so the ticket can say what it actually sent. */
    tif?: string;
    stp?: string;
    /** How many of the sender's own resting orders were pulled. */
    selfCancelled?: number;
    /** True when an IOC or FOK remainder was retired rather than rested. */
    killed?: boolean;
    /** The corridor the order was checked against. */
    bandLow?: number;
    bandHigh?: number;
    /** Amend only: the live id, and whether it went to the back of the queue. */
    orderId?: string;
    requeued?: boolean;
    amendedFrom?: string;
    released?: number;
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
  superEffective: boolean;
  notEffective: boolean;
  /**
   * The per-swing detail, present only while it is still worth animating.
   *
   * These three are the expensive part of a turn — a `statsChanged` table and
   * a ten-field snapshot of each combatant, three Lua tables per swing on top
   * of the entry itself — and the process drops them from every round except
   * the closing one the moment a fight settles (`compactTurnLog` in
   * `game.lua`). A finished fight is retained for the result screen, and the
   * result screen reads the text: `move`, `missed`, `critical`, the two damage
   * numbers. Only `BattleScene` wants the snapshots, and only for a round it
   * has not played yet, of which a settled fight has at most one.
   *
   * So they are optional here rather than assumed, and every reader treats
   * their absence as "nothing to correct": `reconcile` returns early, the stat
   * riders read an empty object. A live fight still carries all three on every
   * round, which is what the animation actually runs on.
   */
  statsChanged?: Partial<Record<'attack' | 'speed' | 'defense' | 'health', number>>;
  attackerState?: CombatantState;
  defenderState?: CombatantState;
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
   * The companion the standings DRAW, so the board renders from one blob
   * instead of a request per trainer. Optional only because a process deployed
   * before this existed publishes rows without it.
   *
   * A PROJECTION, not the record. Typed as `Monster` because that is what the
   * card renderer takes, but the process publishes only the fields the board
   * shows: `entryNo`, `entryKey`, `name`, `elementType`, `evolutionStage`,
   * `faction`, `level`, `nextLevelExp` and the compact `moves`. Everything a
   * stranger's row cannot act on has always been absent — `attack`, `energy`,
   * `happiness`, `exp`, `background`, `border`, `id` — and `image` and `sprite`
   * joined them: both are a function of `entryNo`, `portrait()` in `ui/art.ts`
   * already resolves the art from that, and neither is read off a board row
   * anywhere here. That was 110 bytes a row in a map the node marshals five
   * times per message.
   *
   * `moves` stays. A move set is rolled per companion rather than per species,
   * so unlike the two above it cannot be joined back from `catalog` or
   * `monsterindex`, and `CardPreview` draws all four tiles on these cards.
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
  /**
   * Absent on the published `monsterindex` key, which carries only
   * {@link MonsterIndexView.overrides}. `Monster.Index` still replies with the
   * full effective catalog; the published key does not, because it was 32 KB
   * of a constant this bundle already ships and every message pays for the
   * whole published map five times over.
   */
  entries?: MonsterIndexEntry[];
  /**
   * Sparse admin patches, keyed by entry number, to join onto the authored
   * catalog. Only the six mutable fields ever appear here.
   */
  overrides?: Record<string, Partial<MonsterIndexEntry>>;
}

/**
 * A {@link MonsterIndexView} after {@link mergeMonsterIndex} has joined the wire
 * shape onto the authored catalog. The wire may omit `entries`; the resolved
 * catalog never does, so screens index it without a null check.
 */
export type MonsterIndexCatalog = MonsterIndexView & { entries: MonsterIndexEntry[] };

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
    /** Divisor in `ceil(targetLevel^2 / costDivisor)`. Replaced `levelsPerRune`. */
    costDivisor: number;
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
 * Rune cost of reaching `targetLevel`: `ceil(targetLevel^2 / costDivisor)`.
 *
 * v2 made this quadratic. It was `ceil(targetLevel / levelsPerRune)`, which
 * totalled sixty Rune for the whole climb to level 20 — and with the core loop
 * now free, levelling is one of the few things Rune still buys. The curve stays
 * flat and cheap early and bites in the 14-20 band, which is where a companion
 * becomes worth owning and where the market competes for one.
 *
 * Mirrors `C.levelUpCost` in constants.lua exactly, and MUST keep mirroring it:
 * this is a price the player is about to be charged, so a client that disagrees
 * with the engine quotes a number the process will not take.
 *
 * Returns 0 when the deployment publishes no `costDivisor` — an older process,
 * or one predating the charge — so it keeps working rather than showing a price
 * that is wrong. The old `levelsPerRune` is deliberately NOT read as a
 * fallback: it would quote 5 Rune for level 20 against a charge of 25.
 */
export function levelUpCost(catalog: Catalog | null | undefined, targetLevel: number): number {
  const divisor = catalog?.levelUp?.costDivisor;
  if (!divisor || divisor <= 0) return 0;
  const level = Math.max(1, targetLevel);
  return Math.ceil((level * level) / divisor);
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
