/**
 * Pure view logic for the SwarmMonitor: folding live SSE frames into a
 * snapshot, grouping processes, and the few summaries the aggregator does not
 * publish (the trading panel). No React, no fetch, no clock.
 */
import type {
  AccountView, AcctRecord, AlertRecord, BucketRow, FlowCounts, FlowName, FlowRow, Halt, LaunchRecord, MarketCount, MarketCounts,
  MarketSide, MsgRecord, PeerSummary, PeerTransfer, ProcessView, RoundTrip, SendRecord, SwarmSnapshot, SwarmTick, TradeRecord, WindowStats,
} from './types';

/** `aggregate.mjs` RING_BUCKETS: one hour of 5 s buckets for a live run. */
export const RING_BUCKETS = 720;
const ACCOUNT_TIMELINE = 200;
const ACCOUNT_TRADES = 100;
const ACCOUNT_SERIES = 360;
const ACCOUNT_SERIES_MS = 10_000;
const ACCOUNT_TRANSFERS = 50;
/** `aggregate.mjs` OPEN_SEND_MS: a send older than this has been resolved as a timeout. */
export const OPEN_SEND_MS = 10 * 60_000;

/**
 * Default `--max-rps` fuse (REDESIGN.md §3.4). The event stream does not carry
 * the supervisor's configured value, so the fleet chart draws this reference.
 */
export const MAX_RPS_DEFAULT = 20;
/** Global open-order cap, `constants.lua` (100 accounts × 4 per REDESIGN.md §5). */
export const OPEN_ORDER_CAP = 2_000;

export const ROLE_ORDER = [
  'game', 'rune', 'quote', 'venue.internal', 'venue.external', 'pair.internal', 'pair.external',
  'battle.worker', 'hunt.worker', 'admin', 'unknown',
] as const;

const ROLE_LABEL: Record<string, string> = {
  game: 'Game authority',
  rune: 'Rune token',
  quote: 'Quote token',
  // The venue ids are VAULTS now (orderbook ORDERBOOK.md §16): custody and
  // the registry. Every market is its own pair process behind one.
  'venue.internal': 'Internal vault',
  'venue.external': 'External vault',
  'pair.internal': 'Internal pair',
  'pair.external': 'External pair',
  'battle.worker': 'Battle worker',
  'hunt.worker': 'Hunt worker',
  admin: 'Admin',
  unknown: 'Unattributed',
};

export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;
const roleRank = (role: string) => {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
};

// Formatting ----------------------------------------------------------------

export function fmtMs(ms: number | null | undefined, censored = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const prefix = censored ? '≥' : '';
  if (ms < 1_000) return `${prefix}${Math.round(ms)} ms`;
  if (ms < 100_000) return `${prefix}${(ms / 1_000).toFixed(1)} s`;
  return `${prefix}${Math.round(ms / 1_000)} s`;
}

export const fmtRate = (value: number | null | undefined, digits = 2) => (
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
);

export const fmtPct = (ratio: number | null | undefined) => (
  ratio === null || ratio === undefined || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(1)}%`
);

export const fmtInt = (value: number | null | undefined) => (
  value === null || value === undefined || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString()
);

export const fmtPx = (value: number | null | undefined) => (
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
);

export const fmtBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1_024) return `${Math.round(value)} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
};

export const shortPid = (pid: string) => (pid.length > 14 ? `${pid.slice(0, 6)}…${pid.slice(-4)}` : pid);

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Series --------------------------------------------------------------------

/** Chart and money-flow windows; `null` is the whole run. */
export const RANGES: Array<{ id: string; label: string; ms: number | null }> = [
  { id: '5m', label: '5 min', ms: 5 * 60_000 },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1h', label: '1 hour', ms: 60 * 60_000 },
  { id: 'all', label: 'All', ms: null },
];

/** Replaces rows by bucket start and keeps the newest `cap`. */
export function mergeSeries(series: BucketRow[], buckets: BucketRow[], cap = RING_BUCKETS): BucketRow[] {
  if (!buckets.length) return series;
  const byT = new Map(series.map((row) => [row.t, row]));
  for (const row of buckets) byT.set(row.t, row);
  const merged = [...byT.values()].sort((a, b) => a.t - b.t);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/** Rows whose bucket starts within the last `rangeMs` of the series. */
export function withinRange(series: BucketRow[], rangeMs: number | null): BucketRow[] {
  if (rangeMs === null || !series.length) return series;
  const floor = series[series.length - 1].t - rangeMs;
  return series.filter((row) => row.t > floor);
}

/** An empty bucket exactly as `aggregate.mjs` reports one. */
export const emptyRow = (t: number): BucketRow => ({
  t,
  publishedBytes: null,
  sentPerS: 0,
  resolvedPerS: 0,
  rt: { avg: null, avgCensored: false, p50: null, p95: null, p50Censored: false, p95Censored: false, n: 0, censored: 0 },
  inFlight: 0,
  outcomes: {},
  errorRate: null,
  rejectedRate: null,
  phases: { signP50: null, postP50: null, readP50: null, pushP50: null },
  readsPerS: 0,
  readP50: null,
  readStatus: {},
  reqPerS: 0,
  receivedSlotsPerS: null,
  receivedMinusSentPerS: null,
  wallets: 0,
  fillsPerMin: 0,
  tokensWastedPerMin: 0,
});

/**
 * Folds an SSE `tick` into the snapshot. Current figures are replaced; changed
 * closed buckets are replaced by `t` (a late reply revises every bucket it was
 * in flight across); a process seen for the first time is added, padded with
 * empty buckets back to the start of the fleet series as the aggregator does.
 */
export function applyTick(snapshot: SwarmSnapshot, tick: SwarmTick): SwarmSnapshot {
  const { buckets: fleetBuckets, ...fleet } = tick.fleet;
  const series = mergeSeries(snapshot.fleet.series, fleetBuckets);
  const padding = (buckets: BucketRow[]) => {
    const first = buckets.length ? buckets[0].t : Infinity;
    return series.filter((row) => row.t < first).map((row) => emptyRow(row.t));
  };
  const byPid = new Map(snapshot.processes.map((process) => [process.pid, process]));
  for (const { buckets, ...process } of tick.processes) {
    const prior = byPid.get(process.pid);
    byPid.set(process.pid, { ...prior, ...process, series: mergeSeries(prior?.series ?? padding(buckets), buckets) });
  }
  const byRole = new Map(snapshot.roles.map((role) => [role.pidRole, role]));
  for (const { buckets, ...role } of tick.roles) {
    const prior = byRole.get(role.pidRole);
    byRole.set(role.pidRole, { ...prior, ...role, series: mergeSeries(prior?.series ?? padding(buckets), buckets) });
  }
  return {
    ...snapshot,
    active: tick.active ?? snapshot.active,
    live: 'live' in tick ? tick.live : snapshot.live,
    endsAt: 'endsAt' in tick ? tick.endsAt : snapshot.endsAt,
    launch: 'launch' in tick ? tick.launch : snapshot.launch,
    at: tick.at,
    lastEventAt: tick.lastEventAt,
    events: tick.events,
    from: series.length ? series[0].t : snapshot.from,
    to: series.length ? series[series.length - 1].t + snapshot.bucketMs : snapshot.to,
    fleet: { ...snapshot.fleet, ...fleet, series },
    processes: [...byPid.values()],
    roles: [...byRole.values()],
  };
}

const emptyAccount = (wallet: string): AccountView => ({
  wallet, profile: null, state: null, reason: null, lastRtMs: null, lastAt: null,
  msgs: 0, ok: 0, rejected: 0, errors: 0, fills: 0, acct: null, series: [], timeline: [], states: [], trades: [],
  peer: { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }, transfers: [], pending: [],
});

function updateAccount(snapshot: SwarmSnapshot, wallet: string, change: (account: AccountView) => AccountView) {
  let found = false;
  const accounts = snapshot.accounts.map((account) => {
    if (account.wallet !== wallet) return account;
    found = true;
    return change(account);
  });
  if (!found) accounts.push(change(emptyAccount(wallet)));
  return { ...snapshot, accounts };
}

const stripKind = <T extends object>(rec: T) => {
  const { v: _v, k: _k, ...fields } = rec as T & { v?: unknown; k?: unknown };
  return fields;
};

/**
 * SSE `acct`: the same bookkeeping as the aggregator's `ingestAcct`. A record
 * older than the one held is ignored, so a frame replayed onto a newer
 * snapshot cannot roll a wallet back.
 */
export function applyAcct(snapshot: SwarmSnapshot, rec: AcctRecord): SwarmSnapshot {
  if (typeof rec?.wallet !== 'string' || !Number.isFinite(rec.at)) return snapshot;
  const acct = stripKind(rec) as AcctRecord;
  return updateAccount(snapshot, rec.wallet, (account) => {
    if (account.acct && account.acct.at > rec.at) return account;
    const point = {
      at: rec.at, level: rec.level ?? null, exp: rec.exp ?? null, gold: rec.gold ?? null, runes: rec.runes ?? null,
    };
    const last = account.series[account.series.length - 1];
    const series = last && rec.at - last.at < ACCOUNT_SERIES_MS
      ? [...account.series.slice(0, -1), point]
      : [...account.series, point].slice(-ACCOUNT_SERIES);
    return { ...account, acct, state: typeof rec.state === 'string' ? rec.state : account.state, series };
  });
}

/** SSE `trade`. A trade already held (same time and order) is not added twice. */
export function applyTrade(snapshot: SwarmSnapshot, rec: TradeRecord): SwarmSnapshot {
  if (typeof rec?.wallet !== 'string' || !Number.isFinite(rec.at)) return snapshot;
  const trade = stripKind(rec) as TradeRecord;
  const filled = Number(rec.filled) > 0;
  return updateAccount(snapshot, rec.wallet, (account) => (
    account.trades.some((held) => held.at === rec.at && (held.orderId ?? null) === (rec.orderId ?? null)) ? account : {
      ...account,
      fills: account.fills + (filled ? 1 : 0),
      trades: [...account.trades, trade].slice(-ACCOUNT_TRADES),
    }
  ));
}

/**
 * SSE `msg`: the per-account half of the aggregator's `ingestMsg` (the bucket
 * half arrives in ticks). Admin writes are not play and have no account; a
 * write already on the wallet's timeline (one lane, so `t0` is unique) is not
 * counted twice.
 */
export function applyMsg(snapshot: SwarmSnapshot, rec: MsgRecord): SwarmSnapshot {
  if (typeof rec?.wallet !== 'string' || rec.wallet === 'shared' || !Number.isFinite(rec.t0) || rec.pidRole === 'admin') {
    return snapshot;
  }
  const resolved = Number.isFinite(rec.t1);
  const t1 = rec.t1 as number;
  const outcome = typeof rec.outcome === 'string' ? rec.outcome : 'unknown';
  const rtMs = Number.isFinite(rec.rtMs) ? rec.rtMs as number : (resolved ? t1 - rec.t0 : null);
  const peer = rec.flow === 'wallet->wallet' ? peerTransfers(rec, resolved ? t1 : rec.t0, resolved ? outcome : 'unresolved') : null;
  const sent = updateAccount(snapshot, rec.wallet, (held) => {
    // Its reply closes the open send (by id; a record without one, by send time).
    const account = held.pending?.length
      ? { ...held, pending: held.pending.filter((open) => (rec.id ? open.id !== rec.id : open.t0 !== rec.t0)) }
      : held;
    if (account.timeline.some((entry) => entry.t0 === rec.t0)) return account;
    const ok = resolved && outcome === 'ok';
    const rejected = resolved && outcome === 'rejected';
    return {
      ...(peer ? withTransfer(account, peer.sent) : account),
      profile: typeof rec.profile === 'string' ? rec.profile : account.profile,
      msgs: account.msgs + 1,
      ok: account.ok + (ok ? 1 : 0),
      rejected: account.rejected + (rejected ? 1 : 0),
      errors: account.errors + (resolved && !ok && !rejected ? 1 : 0),
      lastRtMs: ok ? rtMs : account.lastRtMs,
      lastAt: Math.max(account.lastAt ?? 0, resolved ? t1 : rec.t0),
      timeline: [...account.timeline, {
        t0: rec.t0,
        t1: resolved ? t1 : null,
        action: rec.action ?? null,
        pid: rec.pid ?? null,
        pidRole: rec.pidRole ?? null,
        rtMs,
        outcome,
        late: rec.late === true,
        err: rec.err ?? null,
      }].slice(-ACCOUNT_TIMELINE),
    };
  });
  // The recipient's half, once it landed; a receipt already held is not added twice.
  if (!peer?.received) return sent;
  const received = peer.received;
  return updateAccount(sent, peer.to as string, (account) => (
    account.transfers?.some((entry) => entry.id === received.id && entry.dir === 'received') ? account : withTransfer(account, received)
  ));
}

const noPeer = (): PeerSummary => ({ sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null });

/** The sender's and (once it landed) the recipient's entries for a peer send, as `aggregate.mjs` peerTransfer writes them. */
function peerTransfers(rec: MsgRecord, at: number, outcome: string) {
  const id = rec.id ?? `${rec.wallet}:${rec.t0}`;
  const to = typeof rec.to === 'string' && rec.to ? rec.to : null;
  const asset = typeof rec.asset === 'string' && rec.asset ? rec.asset : null;
  const qty = typeof rec.qty === 'number' && Number.isFinite(rec.qty) && rec.qty >= 0 ? rec.qty : null;
  const sent: PeerTransfer = { id, at, dir: 'sent', peer: to, asset, qty, outcome };
  const received: PeerTransfer | null = outcome === 'ok' && to !== null && to !== rec.wallet && to !== 'shared'
    ? { id, at, dir: 'received', peer: rec.wallet, asset, qty, outcome } : null;
  return { to, sent, received };
}

function withTransfer(account: AccountView, entry: PeerTransfer): AccountView {
  const peer = { ...(account.peer ?? noPeer()) };
  if (entry.outcome === 'ok') {
    if (entry.dir === 'sent') {
      peer.sent += 1;
      peer.lastSentAt = Math.max(peer.lastSentAt ?? 0, entry.at);
    } else {
      peer.received += 1;
      peer.lastReceivedAt = Math.max(peer.lastReceivedAt ?? 0, entry.at);
    }
  }
  return { ...account, peer, transfers: [...(account.transfers ?? []), entry].slice(-ACCOUNT_TRANSFERS) };
}

/**
 * SSE `send`, for a stream that pushes them. Open sends are kept by id, so a
 * wallet can wait on several at once (one per process), and each reply closes
 * its own. A new send to the same process replaces the one still open there:
 * an actor that died mid-write never emits that write's reply. `aggregate.mjs`
 * ingestSend keys its open sends the same way (wallet and pid, or role without
 * one). A wallet the snapshot has no account for is not created by a send, as
 * in the aggregator.
 */
export function applySend(snapshot: SwarmSnapshot, rec: SendRecord): SwarmSnapshot {
  if (typeof rec?.acct !== 'string' || !Number.isFinite(rec.at) || rec.id === undefined || rec.id === null) return snapshot;
  if (!snapshot.accounts.some((account) => account.wallet === rec.acct)) return snapshot;
  const lane = (open: { pid: string | null; pidRole: string | null }) => open.pid ?? open.pidRole;
  const write = { id: rec.id, t0: rec.at, pid: rec.pid ?? null, pidRole: rec.pidRole ?? null, verb: rec.verb ?? null };
  return updateAccount(snapshot, rec.acct, (account) => ({
    ...account,
    pending: [
      ...(account.pending ?? []).filter((open) => open.id !== write.id && lane(open) !== lane(write)),
      write,
    ].sort((a, b) => a.t0 - b.t0),
  }));
}

/** SSE `halt`: the aggregator's latched halt, shown before the next tick carries it. */
export function applyHalt(snapshot: SwarmSnapshot, rec: Halt): SwarmSnapshot {
  if (!Number.isFinite(rec?.at)) return snapshot;
  return { ...snapshot, fleet: { ...snapshot.fleet, halt: { at: rec.at, reason: rec.reason ?? null, pid: rec.pid ?? null } } };
}

/** SSE `alert`: the aggregator's `ingestAlert`, shown before the next tick carries it. */
export function applyAlert(snapshot: SwarmSnapshot, rec: AlertRecord): SwarmSnapshot {
  if (!Number.isFinite(rec?.at)) return snapshot;
  const node = rec.node ?? null;
  const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
  const nodeStatus = rec.reason === 'node-down'
    ? { up: false, since: finite(rec.since) ? rec.since : rec.at, downMs: null, node }
    : rec.reason === 'node-up'
      ? { up: true, since: rec.at, downMs: finite(rec.downMs) ? rec.downMs : null, node }
      : null;
  return nodeStatus ? { ...snapshot, fleet: { ...snapshot.fleet, nodeStatus } } : snapshot;
}

/** The node outage to show, if any: down now, or `null` while it is up. */
export function nodeDown(snapshot: SwarmSnapshot): { since: number; downMs: number; node: string | null } | null {
  const status = snapshot.fleet.nodeStatus;
  if (!status || status.up || status.since === null || !Number.isFinite(status.since)) return null;
  return { since: status.since, downMs: Math.max(0, snapshot.at - status.since), node: status.node };
}

/**
 * SSE `launch`: the step in progress, before the next tick carries it. The
 * stream counts a launching run as active, so the page does too.
 */
export function applyLaunch(snapshot: SwarmSnapshot, rec: LaunchRecord): SwarmSnapshot {
  if (!Number.isFinite(rec?.at) || typeof rec.step !== 'string') return snapshot;
  if (typeof rec.run === 'string' && rec.run !== snapshot.run) return snapshot;
  return {
    ...snapshot,
    active: true,
    launch: { step: rec.step, note: typeof rec.note === 'string' ? rec.note : null, at: rec.at, done: false },
  };
}

export type StreamFrame =
  | { kind: 'tick'; rec: SwarmTick }
  | { kind: 'launch'; rec: LaunchRecord }
  | { kind: 'acct'; rec: AcctRecord }
  | { kind: 'trade'; rec: TradeRecord }
  | { kind: 'msg'; rec: MsgRecord }
  | { kind: 'send'; rec: SendRecord }
  | { kind: 'halt'; rec: Halt }
  | { kind: 'alert'; rec: AlertRecord };

/**
 * One SSE frame, safe to replay onto a snapshot fetched while it was in the
 * air: a tick no newer than the snapshot is already in it, and the record
 * folds above ignore what the snapshot already holds.
 */
export function applyFrame(snapshot: SwarmSnapshot, frame: StreamFrame): SwarmSnapshot {
  switch (frame.kind) {
    case 'tick': return frame.rec.run === snapshot.run && frame.rec.at > snapshot.at ? applyTick(snapshot, frame.rec) : snapshot;
    case 'acct': return applyAcct(snapshot, frame.rec);
    case 'trade': return applyTrade(snapshot, frame.rec);
    case 'msg': return applyMsg(snapshot, frame.rec);
    case 'send': return applySend(snapshot, frame.rec);
    case 'halt': return applyHalt(snapshot, frame.rec);
    case 'alert': return applyAlert(snapshot, frame.rec);
    case 'launch': return applyLaunch(snapshot, frame.rec);
    default: return snapshot;
  }
}

// Trading -------------------------------------------------------------------

export interface MarketRow {
  key: string;
  venue: string;
  market: string;
  lastPx: number | null;
  lastAt: number | null;
  buyFillsPerMin: number;
  sellFillsPerMin: number;
  maker: number;
  taker: number;
  orders: number;
}

/**
 * Per-venue market summary from the trades the stream holds. Fills/min covers
 * the last `windowMs` before `now`; the maker/taker mix covers every held trade.
 * Spread and depth are not in the event log (they need a book read).
 */
export function marketRows(accounts: AccountView[], now: number, windowMs = 5 * 60_000): MarketRow[] {
  const rows = new Map<string, MarketRow>();
  const minutes = windowMs / 60_000;
  for (const account of accounts) {
    for (const trade of account.trades) {
      const venue = trade.venue ?? 'unknown';
      const market = trade.market ?? 'unknown';
      const key = `${venue}:${market}`;
      const row = rows.get(key) ?? {
        key, venue, market, lastPx: null, lastAt: null, buyFillsPerMin: 0, sellFillsPerMin: 0, maker: 0, taker: 0, orders: 0,
      };
      row.orders += 1;
      if (trade.liq === 'maker') row.maker += 1;
      else if (trade.liq === 'taker') row.taker += 1;
      const filled = Number(trade.filled) > 0;
      if (filled && (row.lastAt === null || trade.at >= row.lastAt)) {
        const fills = trade.fillPx ?? [];
        row.lastPx = fills.length ? fills[fills.length - 1] : trade.px ?? null;
        row.lastAt = trade.at;
      }
      if (filled && trade.at > now - windowMs && trade.at <= now) {
        if (trade.side === 'buy') row.buyFillsPerMin += 1 / minutes;
        else if (trade.side === 'sell') row.sellFillsPerMin += 1 / minutes;
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.venue.localeCompare(b.venue) || a.market.localeCompare(b.market));
}

export const openOrders = (accounts: AccountView[]) => accounts.reduce(
  (sum, account) => sum + (Number.isFinite(account.acct?.openOrders) ? Number(account.acct?.openOrders) : 0), 0,
);

/**
 * `ok` writes the stream saw resolve at `role` in buckets starting at or after
 * `since`, remembered in `counts` (bucket start -> ok). A bucket keeps counting
 * after it leaves the one-hour ring, and a revised bucket replaces its count.
 */
export function okWritesSince(counts: Map<number, number>, snapshot: SwarmSnapshot, role: string, since: number): number {
  const entity = snapshot.roles.find((entry) => entry.pidRole === role);
  for (const row of entity?.series ?? []) if (row.t >= since) counts.set(row.t, row.outcomes.ok ?? 0);
  let total = 0;
  for (const ok of counts.values()) total += ok;
  return total;
}

// Process groups ------------------------------------------------------------

/**
 * How the monitor groups processes. `slot` is the group's categorical colour
 * (`--sw-N`), used for its card, its chart series and the wallet activities it
 * serves. A role no group names lands in `Other`, never nowhere.
 */
export interface GroupDef {
  id: string;
  label: string;
  roles: readonly string[];
  slot: number;
  /** Interchangeable workers: numbered, and compared with each other. */
  workers?: boolean;
  /** Kept out of every figure; shown small. */
  secondary?: boolean;
}

export const GROUPS: readonly GroupDef[] = [
  { id: 'game', label: 'Game authority', roles: ['game'], slot: 1 },
  { id: 'battle', label: 'Battle workers', roles: ['battle.worker'], slot: 2, workers: true },
  { id: 'hunt', label: 'Hunt workers', roles: ['hunt.worker'], slot: 3, workers: true },
  { id: 'venues', label: 'Order book',
    roles: ['venue.internal', 'venue.external', 'pair.internal', 'pair.external'], slot: 4 },
  { id: 'tokens', label: 'Tokens', roles: ['rune', 'quote'], slot: 5 },
  { id: 'admin', label: 'Admin', roles: ['admin'], slot: 0, secondary: true },
];
export const OTHER_GROUP: GroupDef = { id: 'other', label: 'Other', roles: [], slot: 7 };

export const groupOf = (role: string): GroupDef => GROUPS.find((group) => group.roles.includes(role)) ?? OTHER_GROUP;

const MEMBER_LABEL: Record<string, string> = {
  game: 'Authority',
  'venue.internal': 'Internal vault',
  'venue.external': 'External vault',
  'pair.internal': 'Internal pair',
  'pair.external': 'External pair',
  rune: 'Rune token',
  quote: 'Quote token',
};

export interface GroupMember extends ProcessView { label: string }

export interface GroupPoint {
  t: number;
  sentPerS: number;
  p50: number | null;
  p95: number | null;
  p50Censored: boolean;
  p95Censored: boolean;
}

export interface RtSource { pidRole: string; label: string; n: number; censored: number }

/** Display only. `backlog`: writes piling up; `rising`: round trip climbing. */
export type GroupStatus = 'idle' | 'steady' | 'rising' | 'backlog';

export interface GroupView {
  def: GroupDef;
  /** "Battle workers (3)" for a worker group of more than one. */
  title: string;
  members: GroupMember[];
  /** Sums and merges of the members' last-minute figures. */
  sentPerS: number;
  resolvedPerS: number;
  receivedSlotsPerS: number | null;
  inFlight: number;
  outcomes: Record<string, number>;
  errorRate: number | null;
  rejectedRate: number | null;
  /**
   * Percentiles do not add. One role: the aggregator's pooled figure for it.
   * Several roles: the slowest role's p50 and p95, and `rtBasis` says so.
   */
  rt: RoundTrip;
  rtBasis: 'pooled' | 'slowest';
  /**
   * For `slowest`: the role each figure came from, with that role's own
   * sample counts (the group's `rt.n` adds every role's).
   */
  rtSource: { p50: RtSource | null; p95: RtSource | null } | null;
  rtSlopeMsPerMin: number | null;
  status: GroupStatus;
  /** On the fleet series' bucket starts, so every group shares one time axis. */
  series: GroupPoint[];
}

/**
 * Display-only flag: round-trip p50 growing by more than 10% of itself, and at
 * least half a second, per minute. Nothing reads it but a person.
 */
export const rising = (slope: number | null, p50: number | null) => (
  slope !== null && p50 !== null && p50 > 0 && slope > Math.max(0.1 * p50, 500)
);

/** Display-only: at least 10 writes waiting, and more than 30 s of sends. */
export const backlogged = (inFlight: number, sentPerS: number) => inFlight >= 10 && inFlight > sentPerS * 30;

type RtFields = Pick<RoundTrip, 'p50' | 'p95' | 'p50Censored' | 'p95Censored'> & Partial<RoundTrip>;

/** The slowest p50 and the slowest p95 of several round trips, each with its own censoring. */
export function slowestRt(rts: RtFields[]): RoundTrip {
  const worst = (key: 'p50' | 'p95' | 'avg') => rts.reduce<RtFields | null>((best, rt) => {
    const value = rt[key];
    return value !== null && value !== undefined && (best === null || value > (best[key] as number)) ? rt : best;
  }, null);
  const p50 = worst('p50');
  const p95 = worst('p95');
  const avg = worst('avg');
  return {
    avg: avg?.avg ?? null,
    avgCensored: avg?.avgCensored ?? false,
    p50: p50?.p50 ?? null,
    p95: p95?.p95 ?? null,
    p50Censored: p50?.p50Censored ?? false,
    p95Censored: p95?.p95Censored ?? false,
    n: rts.reduce((sum, rt) => sum + (rt.n ?? 0), 0),
    censored: rts.reduce((sum, rt) => sum + (rt.censored ?? 0), 0),
  };
}

interface RtUnit { pidRole: string; rt: RoundTrip; slope: number | null; rows: Map<number, BucketRow> }

/** The unit whose `key` figure is largest (the one `slowestRt` reports). */
function slowestUnit(units: RtUnit[], key: 'p50' | 'p95'): RtSource | null {
  const unit = units.reduce<RtUnit | null>((best, candidate) => {
    const value = candidate.rt[key];
    return value !== null && (best === null || value > (best.rt[key] as number)) ? candidate : best;
  }, null);
  return unit ? { pidRole: unit.pidRole, label: roleLabel(unit.pidRole), n: unit.rt.n, censored: unit.rt.censored } : null;
}

const byT = (series: BucketRow[]) => new Map(series.map((row) => [row.t, row]));

/**
 * Groups the snapshot's processes, in `GROUPS` order with `Other` last; only
 * groups with a member are returned. Members keep the §6.5 role order and
 * workers are numbered by pid. Rates, in-flight and outcomes are the members'
 * sums; round trip comes from the aggregator's per-role figures.
 */
export function buildGroups(snapshot: SwarmSnapshot): GroupView[] {
  const ordered = [...snapshot.processes].sort((a, b) => roleRank(a.pidRole) - roleRank(b.pidRole) || a.pid.localeCompare(b.pid));
  const ticks = snapshot.fleet.series.map((row) => row.t);
  return [...GROUPS, OTHER_GROUP].flatMap((def): GroupView[] => {
    const processes = ordered.filter((process) => groupOf(process.pidRole).id === def.id);
    if (!processes.length) return [];
    const members = processes.map((process) => {
      const peers = processes.filter((other) => other.pidRole === process.pidRole);
      const base = def.workers ? 'Worker' : MEMBER_LABEL[process.pidRole] ?? roleLabel(process.pidRole);
      return { ...process, label: def.workers || peers.length > 1 ? `${base} ${peers.indexOf(process) + 1}` : base };
    });

    const outcomes: Record<string, number> = {};
    let receivedSlotsPerS: number | null = null;
    for (const { current } of members) {
      for (const [outcome, count] of Object.entries(current.outcomes)) outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
      if (current.receivedSlotsPerS !== null) receivedSlotsPerS = (receivedSlotsPerS ?? 0) + current.receivedSlotsPerS;
    }
    const resolved = Object.values(outcomes).reduce((sum, count) => sum + count, 0);
    const ok = outcomes.ok ?? 0;
    const rejected = outcomes.rejected ?? 0;
    const total = (pick: (stats: WindowStats) => number) => members.reduce((sum, member) => sum + pick(member.current), 0);
    const sentPerS = total((stats) => stats.sentPerS);
    const inFlight = total((stats) => stats.inFlight);

    // One round-trip unit per role; a role the snapshot has no entry for falls back to its processes.
    const units: RtUnit[] = [...new Set(members.map((member) => member.pidRole))].flatMap((role) => {
      const entry = snapshot.roles.find((candidate) => candidate.pidRole === role);
      const sources = entry ? [entry] : members.filter((member) => member.pidRole === role);
      return sources.map((source) => ({
        pidRole: role, rt: source.current.rt, slope: source.saturation.rtSlopeMsPerMin, rows: byT(source.series),
      }));
    });
    const pooled = units.length === 1;
    const slopes = units.map((unit) => unit.slope).filter((slope): slope is number => slope !== null);
    const status: GroupStatus = units.some((unit) => rising(unit.slope, unit.rt.p50)) ? 'rising'
      : backlogged(inFlight, sentPerS) ? 'backlog'
        : sentPerS === 0 && inFlight === 0 && resolved === 0 ? 'idle'
          : 'steady';

    const memberRows = members.map((member) => byT(member.series));
    const series = ticks.map((t): GroupPoint => {
      const rts = units.map((unit) => unit.rows.get(t)?.rt).filter((rt): rt is BucketRow['rt'] => Boolean(rt));
      const rt = rts.length === 1 ? rts[0] : slowestRt(rts);
      return {
        t,
        sentPerS: memberRows.reduce((sum, rows) => sum + (rows.get(t)?.sentPerS ?? 0), 0),
        p50: rt.p50,
        p95: rt.p95,
        p50Censored: rt.p50Censored,
        p95Censored: rt.p95Censored,
      };
    });

    return [{
      def,
      title: def.workers && members.length > 1 ? `${def.label} (${members.length})` : def.label,
      members,
      sentPerS,
      resolvedPerS: total((stats) => stats.resolvedPerS),
      receivedSlotsPerS,
      inFlight,
      outcomes,
      errorRate: resolved ? (resolved - ok - rejected) / resolved : null,
      rejectedRate: resolved ? rejected / resolved : null,
      rt: pooled ? units[0].rt : slowestRt(units.map((unit) => unit.rt)),
      rtBasis: pooled ? 'pooled' : 'slowest',
      rtSource: pooled ? null : { p50: slowestUnit(units, 'p50'), p95: slowestUnit(units, 'p95') },
      rtSlopeMsPerMin: slopes.length ? Math.max(...slopes) : null,
      status,
      series,
    }];
  });
}

export type MemberFlag = 'slow' | 'busy' | 'quiet' | null;

/**
 * Whether one of several same-role members stands out: a p50 at least twice
 * the peers' median and a second slower, or a share of the role's writes under
 * half or over twice an even split. Display only.
 */
export function memberFlag(member: ProcessView, members: ProcessView[]): MemberFlag {
  const peers = members.filter((other) => other.pidRole === member.pidRole);
  if (peers.length < 2) return null;
  const p50s = peers.map((peer) => peer.current.rt.p50).filter((p50): p50 is number => p50 !== null).sort((a, b) => a - b);
  const own = member.current.rt.p50;
  if (own !== null && p50s.length >= 2) {
    const median = p50s[Math.floor((p50s.length - 1) / 2)];
    if (own >= 2 * median && own - median >= 1_000) return 'slow';
  }
  const total = peers.reduce((sum, peer) => sum + peer.current.sentPerS, 0);
  if (total >= 0.05 * peers.length) {
    const share = member.current.sentPerS / total;
    if (share > 2 / peers.length) return 'busy';
    if (share < 0.5 / peers.length) return 'quiet';
  }
  return null;
}

// Run status ----------------------------------------------------------------

/** A run id is its start time, `2026-09-16T19-07-52-033Z` (`swarm.mjs`), optionally `dry-` prefixed. */
export function runStartedAt(run: string | null): number | null {
  const match = /^(?:dry-)?(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(run ?? '');
  if (!match) return null;
  const at = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isFinite(at) ? at : null;
}

/** Whether the page has heard from the stream: not yet, its last `/snapshot` answered, or it did not. */
export type Connection = 'connecting' | 'open' | 'unreachable';

/** A live run with no event for longer than this is shown amber. */
export const LIVE_QUIET_MS = 60_000;

/** The one thing the status bar says. */
export type MonitorStatus =
  | { kind: 'connecting' }
  | { kind: 'unreachable' }
  | { kind: 'idle' }
  | { kind: 'launching'; step: string; note: string | null }
  | { kind: 'live'; agoMs: number; quiet: boolean };

/**
 * `active` comes from `stream.mjs`: launching, or written in the last two
 * minutes. A stream started before `launch` records existed has no launch to
 * show, so an active run with no event yet is still starting.
 */
export function monitorStatus(connection: Connection, data: SwarmSnapshot | null, now: number): MonitorStatus {
  if (connection !== 'open') return { kind: connection };
  if (!data || data.active !== true) return { kind: 'idle' };
  if (data.launch && !data.launch.done) return { kind: 'launching', step: data.launch.step, note: data.launch.note };
  if (data.lastEventAt === null) return { kind: 'launching', step: 'starting', note: 'waiting for the first event' };
  const agoMs = Math.max(0, now - data.lastEventAt);
  return { kind: 'live', agoMs, quiet: agoMs > LIVE_QUIET_MS };
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// Wallet activity -----------------------------------------------------------

export interface ActivityDef { id: string; label: string; states: readonly string[]; group: string | null }

/** What a wallet is doing, from its §4.1 state. `group` lends the activity that group's colour. */
export const ACTIVITIES: readonly ActivityDef[] = [
  { id: 'battling', label: 'Battling', states: ['ARENA_SESSION', 'P2E_BATTLE', 'RATED_QUEUE', 'RATED_BATTLE'], group: 'battle' },
  { id: 'hunting', label: 'Hunting', states: ['HUNT', 'HUNT_SETTLING'], group: 'hunt' },
  { id: 'caring', label: 'Playing or questing', states: ['PLAY_WAIT', 'QUEST_WAIT'], group: 'game' },
  { id: 'trading', label: 'Trading', states: ['TRADE'], group: 'venues' },
  { id: 'home', label: 'Home, choosing', states: ['HOME'], group: null },
  { id: 'waiting', label: 'Waiting or blocked', states: ['WAIT', 'BLOCKED'], group: null },
  { id: 'unreported', label: 'No state yet', states: [], group: null },
];

export const activityOf = (state: string | null | undefined): ActivityDef => (
  ACTIVITIES.find((activity) => !!state && activity.states.includes(state)) ?? ACTIVITIES[ACTIVITIES.length - 1]
);

const STATE_LABEL: Record<string, string> = {
  ARENA_SESSION: 'Arena session', P2E_BATTLE: 'P2E battle', RATED_QUEUE: 'Rated queue', RATED_BATTLE: 'Rated battle',
  HUNT: 'Hunt', HUNT_SETTLING: 'Hunt settling', PLAY_WAIT: 'Playing', QUEST_WAIT: 'Questing',
  TRADE: 'Trading', HOME: 'Home', WAIT: 'Waiting', BLOCKED: 'Blocked',
};
export const stateLabel = (state: string | null | undefined) => (state ? STATE_LABEL[state] ?? state : 'No state yet');

/** Wallets per activity, every activity listed (zeros included), in `ACTIVITIES` order. */
export function activityCounts(accounts: AccountView[]): Array<{ activity: ActivityDef; count: number }> {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const { id } = activityOf(account.state);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return ACTIVITIES.map((activity) => ({ activity, count: counts.get(activity.id) ?? 0 }));
}

// Trading headline ----------------------------------------------------------

/** Writes `trader.mjs` decides: venue orders, game market and desk, the bridge, and the quote faucet. */
export const isTradingAction = (action: string | null | undefined) => (
  !!action && /^(order\.|market\.|economy\.shop\.trade$|venue\.send$|withdraw$|rune\.withdraw$|burn$|transfer$|faucet$)/.test(action)
);

export const TRADING_WINDOW_MS = 15 * 60_000;

export interface TradingNow {
  windowMs: number;
  writes: number;
  tradingWrites: number;
  share: number | null;
  ordersPlaced: number;
  fills: number;
}

/**
 * The last `windowMs` before `now`, from what each account holds (its last 200
 * writes and 100 trades, about an hour at the §10.2 rate, so fifteen minutes
 * is whole). Writes count by send time; fills are venue and desk trades that filled.
 */
export function tradingNow(accounts: AccountView[], now: number, windowMs = TRADING_WINDOW_MS): TradingNow {
  const floor = now - windowMs;
  const inside = (at: number) => at > floor && at <= now;
  let writes = 0;
  let tradingWrites = 0;
  let ordersPlaced = 0;
  let fills = 0;
  for (const account of accounts) {
    for (const entry of account.timeline) {
      if (!inside(entry.t0)) continue;
      writes += 1;
      if (isTradingAction(entry.action)) tradingWrites += 1;
      if (entry.action === 'order.place') ordersPlaced += 1;
    }
    for (const trade of account.trades) if (inside(trade.at) && Number(trade.filled) > 0) fills += 1;
  }
  return { windowMs, writes, tradingWrites, share: writes ? tradingWrites / writes : null, ordersPlaced, fills };
}

// Wallet grid ---------------------------------------------------------------

/** A write waiting at least this long is drawn amber on its tile. */
export const LONG_WAIT_MS = 60_000;

const PROFILE_MARK: Record<string, string> = {
  grinder: 'Gr', ranked: 'Ra', hunter: 'Hu', merchant: 'Me', caretaker: 'Ca', collector: 'Co',
};

/** `burner-07` -> `07`; any other name, its first six characters. */
export const walletLabel = (wallet: string) => /^burner-(\d+)$/.exec(wallet)?.[1] ?? wallet.slice(0, 6);

/** Two letters, because caretaker and collector share an initial. */
export const profileMark = (profile: string | null | undefined) => (
  profile ? PROFILE_MARK[profile] ?? profile.slice(0, 2) : ''
);

/** `+42`, `−13`, `+1.2k`, `0`; `—` when unknown. */
export function fmtPnl(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  const abs = Math.abs(rounded);
  const body = abs >= 10_000 ? `${Math.round(abs / 1_000)}k` : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}k` : String(abs);
  return `${rounded > 0 ? '+' : '−'}${body}`;
}

/** `8s`, `72s`, `4m`, `2h`: a wait short enough to fit a tile. */
export function fmtWait(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 100) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 100 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export interface PendingLane {
  id: string;
  verb: string;
  pidRole: string | null;
  /** The process group the write went to, for its colour. */
  group: string;
  waitedMs: number;
  long: boolean;
}

/**
 * A wallet's writes still waiting on a reply at `now`, from the open sends the
 * aggregator lists (oldest first). None when the stream does not list them;
 * nothing is inferred. A send past OPEN_SEND_MS is already a timeout.
 */
export function pendingLanes(account: AccountView, now: number): PendingLane[] {
  return (account.pending ?? [])
    .filter((open) => Number.isFinite(open.t0) && now - open.t0 <= OPEN_SEND_MS)
    .map((open) => {
      const waitedMs = Math.max(0, now - open.t0);
      return {
        id: open.id,
        verb: open.verb ?? 'write',
        pidRole: open.pidRole,
        group: groupOf(open.pidRole ?? 'unknown').id,
        waitedMs,
        long: waitedMs >= LONG_WAIT_MS,
      };
    });
}

export interface MonsterNow {
  /** The companion's status, or the wallet's brain state when the acct row does not carry one. */
  label: string;
  source: 'monster' | 'state';
  /** Time left on a timed status (a quest, a play session). */
  leftMs: number | null;
  level: number | null;
  energy: number | null;
  happiness: number | null;
  name: string | null;
  element: string | null;
}

const finiteOrNull = (value: number | null | undefined) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export function monsterNow(account: AccountView, now: number): MonsterNow {
  const acct = account.acct;
  const activity = typeof acct?.activity === 'string' && acct.activity ? acct.activity : null;
  const until = finiteOrNull(acct?.activityUntil);
  return {
    label: activity ?? stateLabel(account.state),
    source: activity ? 'monster' : 'state',
    leftMs: activity && until !== null && until > now ? until - now : null,
    level: finiteOrNull(acct?.level),
    energy: finiteOrNull(acct?.energy),
    happiness: finiteOrNull(acct?.happiness),
    name: acct?.monsterName ?? null,
    element: acct?.element ?? null,
  };
}

// Money flow ----------------------------------------------------------------

/**
 * The custody lanes, each a pair of opposite flows: `forward` goes left to
 * right, `back` returns. `slot` is the lane's colour in the flows/min chart,
 * an order that passes the palette validator in both themes.
 */
export interface FlowLane {
  id: string;
  from: string;
  to: string;
  forward: FlowName;
  forwardVerb: string;
  back: FlowName | null;
  backVerb: string | null;
  slot: number;
}

export const FLOW_LANES: readonly FlowLane[] = [
  { id: 'game-token', from: 'Game', to: 'Token balance', forward: 'game->token', forwardVerb: 'Rune.Withdraw', back: 'token->game', backVerb: 'Burn', slot: 1 },
  { id: 'game-venue', from: 'Game', to: 'Exchange', forward: 'game->venue', forwardVerb: 'Venue.Send', back: 'venue->game', backVerb: 'Withdraw (internal)', slot: 4 },
  { id: 'token-venue', from: 'Token balance', to: 'Exchange', forward: 'token->venue', forwardVerb: 'Transfer deposit', back: 'venue->token', backVerb: 'Withdraw (external)', slot: 7 },
  { id: 'peer', from: 'Wallet', to: 'Wallet', forward: 'wallet->wallet', forwardVerb: 'Transfer', back: null, backVerb: null, slot: 6 },
];

const emptyFlow = (): FlowRow => ({ msgs: 0, ok: 0, derived: 0, qty: {} });

export function mergeFlowCounts(into: FlowCounts, from: FlowCounts | undefined): FlowCounts {
  for (const [flow, row] of Object.entries(from ?? {}) as Array<[FlowName, FlowRow]>) {
    const total = into[flow] ?? emptyFlow();
    into[flow] = {
      msgs: total.msgs + row.msgs,
      ok: total.ok + row.ok,
      derived: total.derived + row.derived,
      qty: Object.entries(row.qty).reduce((sum, [asset, qty]) => ({ ...sum, [asset]: (sum[asset] ?? 0) + qty }), { ...total.qty }),
    };
  }
  return into;
}

const emptySide = (): MarketSide => ({ orders: 0, maker: 0, taker: 0, qty: 0, filled: 0, fills: 0 });

export function mergeMarketCounts(into: MarketCounts, from: MarketCounts | undefined): MarketCounts {
  for (const [key, row] of Object.entries(from ?? {})) {
    const total = into[key] ?? { venue: row.venue, market: row.market, buy: emptySide(), sell: emptySide() };
    const add = (a: MarketSide, b: MarketSide): MarketSide => ({
      orders: a.orders + b.orders, maker: a.maker + b.maker, taker: a.taker + b.taker,
      qty: a.qty + b.qty, filled: a.filled + b.filled, fills: a.fills + b.fills,
    });
    into[key] = { ...total, buy: add(total.buy, row.buy), sell: add(total.sell, row.sell) };
  }
  return into;
}

/**
 * Money flow and per-market trades over the last `rangeMs` of closed buckets,
 * or the whole log for `null`. `counted` is false for a stream started before
 * the aggregator counted flows: then flows are empty, and markets come from the
 * trades each account holds (its last 100) instead.
 */
export function flowWindow(snapshot: SwarmSnapshot, rangeMs: number | null, now = snapshot.lastEventAt ?? snapshot.at) {
  const { fleet } = snapshot;
  const counted = fleet.flows !== undefined;
  if (!counted) {
    const markets: MarketCounts = {};
    for (const account of snapshot.accounts) {
      for (const trade of account.trades) {
        if (rangeMs !== null && !(trade.at > now - rangeMs)) continue;
        if (trade.side !== 'buy' && trade.side !== 'sell') continue;
        const venue = trade.venue ?? 'unknown';
        const market = trade.market ?? 'unknown';
        const one: MarketCount = { venue, market, buy: emptySide(), sell: emptySide() };
        const filled = Number(trade.filled) > 0 ? Number(trade.filled) : 0;
        one[trade.side] = {
          orders: 1, maker: trade.liq === 'maker' ? 1 : 0, taker: trade.liq === 'taker' ? 1 : 0,
          qty: Number.isFinite(trade.qty) ? Number(trade.qty) : 0, filled, fills: filled > 0 ? 1 : 0,
        };
        mergeMarketCounts(markets, { [`${venue}:${market}`]: one });
      }
    }
    return { counted, flows: {} as FlowCounts, markets };
  }
  if (rangeMs === null) return { counted, flows: fleet.flows ?? {}, markets: fleet.markets ?? {} };
  const flows: FlowCounts = {};
  const markets: MarketCounts = {};
  for (const row of withinRange(fleet.series, rangeMs)) {
    mergeFlowCounts(flows, row.flows);
    mergeMarketCounts(markets, row.markets);
  }
  return { counted, flows, markets };
}

export interface FlowPoint { t: number; lanes: Record<string, number> }

/** Custody writes per minute by lane, per bucket. A bucket without flows is zero, not missing. */
export function flowSeries(rows: BucketRow[], bucketMs: number): FlowPoint[] {
  const perMinute = 60_000 / bucketMs;
  return rows.map((row) => ({
    t: row.t,
    lanes: Object.fromEntries(FLOW_LANES.map((lane) => [
      lane.id,
      ((row.flows?.[lane.forward]?.msgs ?? 0) + (lane.back ? row.flows?.[lane.back]?.msgs ?? 0 : 0)) * perMinute,
    ])),
  }));
}

/** `fire_berry` -> `fire berry`. */
export const assetLabel = (asset: string) => asset.replace(/_/g, ' ');

/** `3 scroll · 120 gold`, largest first; `—` when nothing carried a quantity. */
export function fmtQty(qty: Record<string, number> | undefined): string {
  const entries = Object.entries(qty ?? {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([asset, value]) => `${fmtInt(value)} ${assetLabel(asset)}`).join(' · ') : '—';
}

export interface MarketBalance {
  key: string;
  venue: string;
  market: string;
  buy: MarketSide;
  sell: MarketSide;
  /** Filled at placement over placed, per side; null with nothing placed. */
  buyFillRate: number | null;
  sellFillRate: number | null;
  /** Buy share of the market's orders, 0..1. */
  buyShare: number;
  /** One side has at least four times the other's orders (or all of them). */
  oneSided: 'buy' | 'sell' | null;
}

export function marketBalance(markets: MarketCounts): MarketBalance[] {
  return Object.entries(markets).map(([key, row]) => {
    const total = row.buy.orders + row.sell.orders;
    const lopsided = (a: number, b: number) => total >= 5 && a >= 4 * b;
    return {
      key,
      venue: row.venue,
      market: row.market,
      buy: row.buy,
      sell: row.sell,
      buyFillRate: row.buy.qty > 0 ? row.buy.filled / row.buy.qty : null,
      sellFillRate: row.sell.qty > 0 ? row.sell.filled / row.sell.qty : null,
      buyShare: total ? row.buy.orders / total : 0,
      oneSided: lopsided(row.buy.orders, row.sell.orders) ? 'buy' as const : lopsided(row.sell.orders, row.buy.orders) ? 'sell' as const : null,
    };
  }).filter((row) => row.buy.orders + row.sell.orders > 0)
    .sort((a, b) => a.venue.localeCompare(b.venue) || a.market.localeCompare(b.market));
}

/** A peer send or receipt this recent marks the wallet's tile. */
export const PEER_RECENT_MS = 5 * 60_000;

export function recentPeer(account: AccountView, now: number, windowMs = PEER_RECENT_MS): 'sent' | 'received' | 'both' | null {
  const recent = (at: number | null | undefined) => typeof at === 'number' && at > now - windowMs;
  const sent = recent(account.peer?.lastSentAt);
  const received = recent(account.peer?.lastReceivedAt);
  return sent && received ? 'both' : sent ? 'sent' : received ? 'received' : null;
}
