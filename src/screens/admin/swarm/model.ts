/**
 * Pure view logic for the SwarmMonitor: folding live SSE frames into a
 * snapshot, ordering processes, and the few summaries the aggregator does not
 * publish (the trading panel). No React, no fetch, no clock.
 */
import type {
  AccountView, AcctRecord, Brake, BucketRow, ProcessView, SwarmSnapshot, SwarmTick, TradeRecord,
} from './types';

/** `aggregate.mjs` RING_BUCKETS: one hour of 5 s buckets for a live run. */
export const RING_BUCKETS = 720;
const ACCOUNT_TRADES = 100;
const ACCOUNT_SERIES = 360;
const ACCOUNT_SERIES_MS = 10_000;

/**
 * Default `--max-rps` fuse (REDESIGN.md §3.4). The event stream does not carry
 * the supervisor's configured value, so the fleet chart draws this reference.
 */
export const MAX_RPS_DEFAULT = 20;
/** Global open-order cap, `constants.lua` (100 accounts × 4 per REDESIGN.md §5). */
export const OPEN_ORDER_CAP = 2_000;

export const ROLE_ORDER = [
  'game', 'rune', 'quote', 'venue.internal', 'venue.external', 'battle.worker', 'hunt.worker', 'admin', 'unknown',
] as const;

const ROLE_LABEL: Record<string, string> = {
  game: 'Game authority',
  rune: 'Rune token',
  quote: 'Quote token',
  'venue.internal': 'Venue internal',
  'venue.external': 'Venue external',
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

export interface LabelledProcess extends ProcessView { label: string }

/** Cards in the §6.5 order; workers of one role are numbered by pid. */
export function orderProcesses(processes: ProcessView[]): LabelledProcess[] {
  const sorted = [...processes].sort((a, b) => roleRank(a.pidRole) - roleRank(b.pidRole) || a.pid.localeCompare(b.pid));
  return sorted.map((process) => {
    const peers = sorted.filter((other) => other.pidRole === process.pidRole);
    const label = peers.length > 1
      ? `${roleLabel(process.pidRole)} ${peers.indexOf(process) + 1}`
      : roleLabel(process.pidRole);
    return { ...process, label };
  });
}

export const orderRoles = <T extends { pidRole: string }>(roles: T[]) => (
  [...roles].sort((a, b) => roleRank(a.pidRole) - roleRank(b.pidRole))
);

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

export const shortPid = (pid: string) => (pid.length > 14 ? `${pid.slice(0, 6)}…${pid.slice(-4)}` : pid);

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Series --------------------------------------------------------------------

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
  sentPerS: 0,
  resolvedPerS: 0,
  rt: { avg: null, p50: null, p95: null, p50Censored: false, p95Censored: false, n: 0, censored: 0 },
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

/** SSE `acct`: the same bookkeeping as the aggregator's `ingestAcct`. */
export function applyAcct(snapshot: SwarmSnapshot, rec: AcctRecord): SwarmSnapshot {
  if (typeof rec?.wallet !== 'string' || !Number.isFinite(rec.at)) return snapshot;
  const acct = stripKind(rec) as AcctRecord;
  return updateAccount(snapshot, rec.wallet, (account) => {
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

/** SSE `trade`. */
export function applyTrade(snapshot: SwarmSnapshot, rec: TradeRecord): SwarmSnapshot {
  if (typeof rec?.wallet !== 'string' || !Number.isFinite(rec.at)) return snapshot;
  const trade = stripKind(rec) as TradeRecord;
  const filled = Number(rec.filled) > 0;
  return updateAccount(snapshot, rec.wallet, (account) => ({
    ...account,
    fills: account.fills + (filled ? 1 : 0),
    trades: [...account.trades, trade].slice(-ACCOUNT_TRADES),
  }));
}

/** SSE `brake`. */
export function applyBrake(snapshot: SwarmSnapshot, rec: Brake): SwarmSnapshot {
  if (!Number.isFinite(rec?.at)) return snapshot;
  const brake: Brake = { at: rec.at, mul: Number.isFinite(rec.mul) ? rec.mul : null, reason: rec.reason ?? null };
  return { ...snapshot, fleet: { ...snapshot.fleet, brake } };
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

/** `ok` writes the stream saw resolve at `role` in buckets starting at or after `since`. */
export function okWritesSince(snapshot: SwarmSnapshot, role: string, since: number): number {
  const entity = snapshot.roles.find((entry) => entry.pidRole === role);
  if (!entity) return 0;
  return entity.series.filter((row) => row.t >= since).reduce((sum, row) => sum + (row.outcomes.ok ?? 0), 0);
}
