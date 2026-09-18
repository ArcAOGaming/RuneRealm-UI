/**
 * The W8 stream contract, as the SwarmMonitor reads it.
 *
 * `GET /snapshot` answers `SwarmSnapshot`; `GET /events` pushes `tick`
 * (`SwarmTick`), `acct`/`trade`/`halt`/`alert`/`msg`/`send`/`launch` (the schema v1 records themselves) and
 * `run`. The shapes mirror `backend/native/swarm/aggregate.mjs` field for field;
 * nothing here is computed by the browser that the aggregator already knows.
 */

export type PidRole =
  | 'game' | 'rune' | 'quote' | 'venue.internal' | 'venue.external'
  | 'pair.internal' | 'pair.external'
  | 'hunt.worker' | 'battle.worker' | 'admin' | 'unknown';

export interface RoundTrip {
  avg: number | null;
  avgCensored?: boolean;
  p50: number | null;
  p95: number | null;
  /** The figure is a lower bound: writes were still waiting at the bucket end. */
  p50Censored: boolean;
  p95Censored: boolean;
  /** Exact `ok` samples. */
  n: number;
  /** In-flight writes counted at the time they had already waited. */
  censored: number;
}

export interface WindowStats {
  sentPerS: number;
  resolvedPerS: number;
  rt: RoundTrip;
  inFlight: number;
  outcomes: Record<string, number>;
  errorRate: number | null;
  rejectedRate: number | null;
  phases: { signP50: number | null; postP50: number | null; readP50: number | null; pushP50: number | null };
  readsPerS: number;
  readP50: number | null;
  readStatus: Record<string, number>;
  reqPerS: number;
  receivedSlotsPerS: number | null;
  receivedMinusSentPerS: number | null;
  wallets: number;
  fillsPerMin: number;
  tokensWastedPerMin: number;
  /** Fleet only, and only once a custody write landed in the window. */
  flows?: FlowCounts;
  /** Fleet only, and only once a trade landed in the window. */
  markets?: MarketCounts;
}

/** Where value moved (`aggregate.mjs` FLOWS). */
export type FlowName =
  | 'game->venue' | 'venue->game' | 'game->token' | 'token->game' | 'token->venue' | 'venue->token' | 'wallet->wallet';

/**
 * One flow's writes: `ok` of `msgs` landed, `derived` were read from a verb
 * name (a log without flow fields, so no quantity), `qty` is whole units moved
 * by asset, from `ok` writes that carried one.
 */
export interface FlowRow { msgs: number; ok: number; derived: number; qty: Record<string, number> }
export type FlowCounts = Partial<Record<FlowName, FlowRow>>;

/** One side of a market's `trade` records; `filled` is what filled at placement. */
export interface MarketSide { orders: number; maker: number; taker: number; qty: number; filled: number; fills: number }
export interface MarketCount { venue: string; market: string; buy: MarketSide; sell: MarketSide }
/** Keyed `venue:market`. */
export type MarketCounts = Record<string, MarketCount>;

/** One closed 5 s bucket; `t` is its start. */
export interface BucketRow extends WindowStats { t: number; publishedBytes: number | null }

export interface Saturation {
  rtSlopeMsPerMin: number | null;
  receivedSlotsPerS: number | null;
  inFlight: number;
}

/** A hard halt awareness latched (§10): node down, or battle-fleet pending >= 80%. */
export interface Halt { at: number; reason: string | null; pid: string | null }

/**
 * The latest node alert awareness reported (display only: a run carries on
 * through an outage). While down, `since` is when it started failing and
 * `downMs` how long it has been down at the snapshot; once up again, `downMs`
 * is how long the outage lasted.
 */
export interface NodeStatus { up: boolean; since: number | null; downMs: number | null; node: string | null }

/** Event schema v1 `alert`, without `v`/`k`. */
export interface AlertRecord { at: number; reason: string; node?: string | null; since?: number | null; downMs?: number | null }

export interface FleetView {
  current: WindowStats;
  saturation: Saturation;
  targetMsgPerS: number;
  accounts: number;
  activeAccounts: number;
  states: Record<string, number>;
  halt?: Halt | null;
  /** Absent from a stream started before the aggregator reported it. */
  nodeStatus?: NodeStatus | null;
  admin?: { msgs: number; outcomes?: Record<string, number> } | null;
  /** Whole-log totals. Absent from a stream started before the aggregator counted them. */
  flows?: FlowCounts;
  markets?: MarketCounts;
  series: BucketRow[];
}

export interface ProcessView {
  pid: string;
  pidRole: string;
  current: WindowStats;
  saturation: Saturation;
  published?: { at: number; bytes: number } | null;
  series: BucketRow[];
}

export interface RoleView {
  pidRole: string;
  pids?: string[];
  current: WindowStats;
  saturation: Saturation;
  series: BucketRow[];
}

/** Event schema v1 `acct`, without `v`/`k`. `acctEvent` writes null for a field the account lacks. */
export interface AcctRecord {
  at: number;
  wallet: string;
  state?: string | null;
  level?: number | null;
  exp?: number | null;
  moves?: number | null;
  pendingMove?: string | null;
  roster?: number | null;
  collection?: number | null;
  energy?: number | null;
  happiness?: number | null;
  gold?: number | null;
  runes?: number | null;
  scrolls?: number | null;
  berries?: Record<string, number> | null;
  lootboxes?: number | null;
  wins?: number | null;
  losses?: number | null;
  rating?: number | null;
  quests?: number | null;
  captures?: number | null;
  openOrders?: number | null;
  /**
   * The active companion: its status (`Home`, `Play`, `Quest`, `Battle`,
   * `Hunt`, `Minting`), when that status ends (ms), its name and element.
   * Additive: rows from a swarm started before these existed lack them.
   */
  activity?: string | null;
  activityUntil?: number | null;
  monsterName?: string | null;
  element?: string | null;
  pnlGold?: number | null;
  msgs?: number;
  errs?: number;
  tokensWasted?: number;
}

/** Event schema v1 `msg`, the fields an account row is built from. */
export interface MsgRecord {
  /** The `send` row's id, when the write had one. */
  id?: string | null;
  t0: number;
  t1?: number | null;
  wallet: string;
  profile?: string;
  pid?: string;
  pidRole?: string;
  action?: string;
  intent?: string;
  rtMs?: number;
  outcome?: string;
  late?: boolean;
  err?: unknown;
  /** Custody writes only: where value moved, which asset, whole units. */
  flow?: FlowName;
  asset?: string;
  qty?: number;
  /** A peer send's recipient wallet label, when known. */
  to?: string;
}

/** Event schema v1 `send`: a write handed to the node, open until its `msg` (same `id`) arrives. */
export interface SendRecord {
  at: number;
  id: string;
  acct: string;
  pid?: string | null;
  pidRole?: string | null;
  verb?: string | null;
}

/** A write still waiting on a reply, as `aggregate.mjs` lists it per account. */
export interface PendingWrite {
  id: string;
  t0: number;
  pid: string | null;
  pidRole: string | null;
  verb: string | null;
}

/** Event schema v1 `trade`, without `v`/`k`. */
export interface TradeRecord {
  at: number;
  wallet: string;
  venue?: string;
  market?: string;
  side?: string;
  tif?: string;
  liq?: string;
  /** Whole units of the quote asset; `pxAtoms` is the venue's raw value. */
  px?: number;
  pxAtoms?: number | null;
  qty?: number;
  filled?: number;
  fillPx?: number[];
  orderId?: string;
  reservation?: number;
  R?: number;
}

export interface TimelineEntry {
  t0: number;
  t1: number | null;
  action: string | null;
  pid: string | null;
  pidRole: string | null;
  rtMs: number | null;
  outcome: string;
  late: boolean;
  err: unknown;
}

export interface StateEntry { at: number; from: string | null; to: string | null; reason: string | null }

export interface ProgressPoint { at: number; level: number | null; exp: number | null; gold: number | null; runes: number | null }

export interface AccountView {
  wallet: string;
  profile: string | null;
  state: string | null;
  reason: string | null;
  lastRtMs: number | null;
  lastAt: number | null;
  msgs: number;
  ok: number;
  rejected: number;
  errors: number;
  fills: number;
  acct: AcctRecord | null;
  series: ProgressPoint[];
  timeline: TimelineEntry[];
  states: StateEntry[];
  trades: TradeRecord[];
  /** Open sends, oldest first. Absent from a stream started before the aggregator listed them. */
  pending?: PendingWrite[];
  /** Peer token sends that landed, either way. Absent from an older stream. */
  peer?: PeerSummary;
  /** The last 50 peer sends and receipts, oldest first. Absent from an older stream. */
  transfers?: PeerTransfer[];
}

export interface PeerSummary { sent: number; received: number; lastSentAt: number | null; lastReceivedAt: number | null }

export interface PeerTransfer {
  id: string;
  /** When it resolved. */
  at: number;
  dir: 'sent' | 'received';
  /** The other wallet, when the record named it. */
  peer: string | null;
  asset: string | null;
  qty: number | null;
  outcome: string;
}

/** Event schema v1 `launch`: a launch step or a wait for the node, written as it happens. */
export interface LaunchRecord { at: number; run?: string | null; step: string; note?: string | null }

/** The launch step in progress; `done` once the run's clock started or the run ended. */
export interface LaunchState { step: string; note: string | null; at: number; done: boolean }

export interface SwarmSnapshot {
  v: number;
  run: string | null;
  /** The run's planned end (ms), its `run.start` `until`; null when the log has none, absent from an older stream. */
  endsAt?: number | null;
  /** Null when the log has no `launch` record; absent from a stream started before they existed. */
  launch?: LaunchState | null;
  at: number;
  bucketMs: number;
  windowBuckets: number;
  lastEventAt: number | null;
  from: number | null;
  to: number | null;
  events: { lines: number; records: number; torn: number; unknown: number; invalid: number };
  fleet: FleetView;
  processes: ProcessView[];
  roles: RoleView[];
  accounts: AccountView[];
  /** Added by `stream.mjs`: whether the run it tails is launching or still writing, and its id while it is. */
  active?: boolean;
  live?: string | null;
}

type TickEntity<T> = Omit<T, 'series'> & { buckets: BucketRow[] };

/** SSE `tick`: the snapshot's shape with the changed closed buckets in place of `series`. */
export interface SwarmTick {
  v: number;
  run: string | null;
  endsAt?: number | null;
  launch?: LaunchState | null;
  at: number;
  bucketMs: number;
  lastEventAt: number | null;
  events: SwarmSnapshot['events'];
  active?: boolean;
  live?: string | null;
  fleet: TickEntity<FleetView>;
  processes: Array<TickEntity<ProcessView>>;
  roles: Array<TickEntity<RoleView>>;
}
