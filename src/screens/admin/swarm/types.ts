/**
 * The W8 stream contract, as the SwarmMonitor reads it.
 *
 * `GET /snapshot` answers `SwarmSnapshot`; `GET /events` pushes `tick`
 * (`SwarmTick`), `acct`/`trade`/`brake` (the schema v1 records themselves) and
 * `run`. The shapes mirror `backend/native/swarm/aggregate.mjs` field for field;
 * nothing here is computed by the browser that the aggregator already knows.
 */

export type PidRole =
  | 'game' | 'rune' | 'quote' | 'venue.internal' | 'venue.external'
  | 'hunt.worker' | 'battle.worker' | 'admin' | 'unknown';

export interface RoundTrip {
  avg: number | null;
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
}

/** One closed 5 s bucket; `t` is its start. */
export interface BucketRow extends WindowStats { t: number }

export interface Saturation {
  rtSlopeMsPerMin: number | null;
  receivedSlotsPerS: number | null;
  inFlight: number;
}

export interface Brake { at: number; mul: number | null; reason: string | null }

export interface FleetView {
  current: WindowStats;
  saturation: Saturation;
  targetMsgPerS: number;
  accounts: number;
  activeAccounts: number;
  states: Record<string, number>;
  brake: Brake | null;
  series: BucketRow[];
}

export interface ProcessView {
  pid: string;
  pidRole: string;
  current: WindowStats;
  saturation: Saturation;
  series: BucketRow[];
}

export interface RoleView {
  pidRole: string;
  pids?: string[];
  current: WindowStats;
  saturation: Saturation;
  series: BucketRow[];
}

/** Event schema v1 `acct`, without `v`/`k`. */
export interface AcctRecord {
  at: number;
  wallet: string;
  state?: string;
  level?: number;
  exp?: number;
  moves?: number;
  pendingMove?: string | null;
  roster?: number;
  collection?: number;
  energy?: number;
  happiness?: number;
  gold?: number;
  runes?: number;
  scrolls?: number;
  berries?: Record<string, number>;
  lootboxes?: number;
  wins?: number;
  losses?: number;
  rating?: number;
  quests?: number;
  captures?: number;
  openOrders?: number;
  pnlGold?: number;
  msgs?: number;
  errs?: number;
  tokensWasted?: number;
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
  px?: number;
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
}

export interface SwarmSnapshot {
  v: number;
  run: string | null;
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
  /** Added by `stream.mjs`: the run it is tailing, and every run with a log. */
  active?: boolean;
  live?: string | null;
  runs?: string[];
}

type TickEntity<T> = Omit<T, 'series'> & { buckets: BucketRow[] };

/** SSE `tick`: the snapshot's shape with the changed closed buckets in place of `series`. */
export interface SwarmTick {
  v: number;
  run: string | null;
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
