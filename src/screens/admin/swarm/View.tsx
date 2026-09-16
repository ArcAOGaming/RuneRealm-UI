/**
 * SwarmMonitor layout (REDESIGN.md §6.5), rendered from one stream snapshot.
 *
 * Round trip — sign a message and have the changed state back — is the first
 * and largest figure in the KPI strip and on every process card. Sent/received
 * rates and the send/read phase split are secondary and sit below it.
 *
 * Saturation is DISPLAY ONLY (§10): the slope, received slots/s and in-flight
 * figures here inform a person; nothing on this page stops or steers a run.
 */
import { ReactNode, useMemo, useState } from 'react';
import { Badge, Panel, SectionTitle, cx } from '../../../ui/primitives';
import { BarChart, LineChart, Series } from './charts';
import {
  LabelledProcess, MAX_RPS_DEFAULT, ROLE_ORDER, fmtInt, fmtMs, fmtPct, fmtRate, orderProcesses, orderRoles,
  roleLabel, shortPid, withinRange,
} from './model';
import type { BucketRow, SwarmSnapshot, WindowStats } from './types';
import { AccountsPanel } from './Accounts';
import { TradingPanel } from './Trading';

/**
 * Categorical slots, dark steps by default because the app is dark; light steps
 * when a light theme is stamped. Both sets pass the palette validator (adjacent
 * CVD ΔE ≥ 8.4, contrast ≥ 3:1 on `--surface`).
 */
const PALETTE_CSS = `
.swarm-monitor {
  --sw-1: 57 135 229; --sw-2: 217 89 38; --sw-3: 25 158 112; --sw-4: 201 133 0;
  --sw-5: 213 81 129; --sw-6: 0 131 0; --sw-7: 144 133 233; --sw-8: 230 103 103;
}
:root[data-theme="light"] .swarm-monitor {
  --sw-1: 42 120 214; --sw-2: 235 104 52; --sw-3: 27 175 122; --sw-4: 237 161 0;
  --sw-5: 232 123 164; --sw-6: 0 131 0; --sw-7: 74 58 167; --sw-8: 227 73 72;
}
`;

export const swColor = (slot: number) => `rgb(var(--sw-${slot}))`;

/** Colour follows the role, never its position in a filtered list. */
export const roleColor = (role: string) => {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role);
  return index >= 0 && index < 8 ? swColor(index + 1) : 'rgb(var(--muted))';
};

const RANGES: Array<{ id: string; label: string; ms: number | null }> = [
  { id: '5m', label: '5 min', ms: 5 * 60_000 },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1h', label: '1 hour', ms: 60 * 60_000 },
  { id: 'all', label: 'All', ms: null },
];

const rtSeries: Series<BucketRow>[] = [
  {
    key: 'p50', label: 'p50', color: swColor(1), value: (row) => row.rt.p50,
    describe: (row) => fmtMs(row.rt.p50, row.rt.p50Censored),
  },
  {
    key: 'p95', label: 'p95', color: swColor(2), value: (row) => row.rt.p95,
    describe: (row) => fmtMs(row.rt.p95, row.rt.p95Censored),
  },
  { key: 'avg', label: 'avg', color: swColor(3), value: (row) => row.rt.avg, thin: true },
];

const sentReceived: Series<BucketRow>[] = [
  { key: 'sent', label: 'sent msg/s', color: swColor(1), value: (row) => row.sentPerS },
  { key: 'received', label: 'received slots/s', color: swColor(2), value: (row) => row.receivedSlotsPerS },
];

const msAxis = (value: number) => fmtMs(value);
const rateAxis = (value: number) => String(Number(value.toFixed(value >= 10 ? 0 : 2)));

export function SwarmMonitorView({ data, toolbar }: { data: SwarmSnapshot; toolbar?: ReactNode }) {
  const [rangeId, setRangeId] = useState('15m');
  const range = RANGES.find((entry) => entry.id === rangeId) ?? RANGES[1];
  const processes = useMemo(() => orderProcesses(data.processes), [data.processes]);

  return (
    <div className="swarm-monitor space-y-4" data-run={data.run ?? ''}>
      <style>{PALETTE_CSS}</style>
      <KpiStrip data={data} />

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Chart range">
        <span className="eyebrow mr-1">Range</span>
        {RANGES.map((entry) => (
          <button key={entry.id} type="button" onClick={() => setRangeId(entry.id)}
            aria-pressed={entry.id === rangeId}
            className={cx(
              'rounded-[3px] border px-2.5 py-1 font-mono text-[11px]',
              entry.id === rangeId ? 'border-arcane/60 bg-arcane/10 text-ink' : 'border-edge text-muted hover:text-ink',
            )}>
            {entry.label}
          </button>
        ))}
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      <section aria-label="Processes">
        <SectionTitle right={<span className="font-mono text-[10px] text-faint">{processes.length} processes · round trip leads</span>}>
          Per process
        </SectionTitle>
        {processes.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {processes.map((process) => (
              <ProcessCard key={process.pid} process={process} rangeMs={range.ms} />
            ))}
          </div>
        ) : (
          <Panel className="p-5 text-sm text-muted">No writes in this run yet.</Panel>
        )}
      </section>

      <FleetTotals data={data} rangeMs={range.ms} />
      <AccountsPanel data={data} />
      <TradingPanel data={data} />
    </div>
  );
}

// KPI strip -----------------------------------------------------------------

function KpiStrip({ data }: { data: SwarmSnapshot }) {
  const { fleet } = data;
  const current = fleet.current;
  const brake = fleet.brake;
  return (
    <Panel className="p-4 sm:p-5" data-card="fleet">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="eyebrow">Fleet round trip · last minute</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div data-figure="round-trip" className="font-mono text-5xl font-semibold text-ink">
              {fmtMs(current.rt.p50, current.rt.p50Censored)}
              <span className="ml-2 align-middle text-xs font-normal text-faint">p50</span>
            </div>
            <div className="font-mono text-2xl text-ink" data-figure="round-trip-p95">
              {fmtMs(current.rt.p95, current.rt.p95Censored)}<span className="ml-1.5 text-xs text-faint">p95</span>
            </div>
            <div className="font-mono text-2xl text-muted" data-figure="round-trip-avg">
              {fmtMs(current.rt.avg)}<span className="ml-1.5 text-xs text-faint">avg</span>
            </div>
          </div>
          <RtNote rt={current.rt} />
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 sm:grid-cols-3">
          <Tile label="Sent msg/s" figure="sent" value={`${fmtRate(current.sentPerS)}`}
            note={`target ${fmtRate(fleet.targetMsgPerS, 1)}`} />
          <Tile label="Errors" figure="errors" value={fmtPct(current.errorRate)}
            note={`refused ${fmtPct(current.rejectedRate)}`} tone={current.errorRate ? 'bad' : undefined} />
          <Tile label="Active accounts" figure="active" value={`${fmtInt(fleet.activeAccounts)}/${fmtInt(fleet.accounts)}`}
            note="sent in the last minute" />
          <Tile label="Fills/min" figure="fills" value={fmtRate(current.fillsPerMin, 1)} note="trade records with a fill" />
          <Tile label="Tokens wasted/min" figure="wasted" value={fmtRate(current.tokensWastedPerMin, 1)} note="bank full, lane busy" />
          <Tile label="Brake" figure="brake" value={brake?.mul ? `×${fmtRate(brake.mul, 1)}` : 'off'}
            note={brake?.reason ?? 'hard halts only'} tone={brake?.mul && brake.mul > 1 ? 'warn' : undefined} />
        </div>
      </div>
    </Panel>
  );
}

function RtNote({ rt }: { rt: WindowStats['rt'] }) {
  return (
    <p className="mt-2 text-xs text-faint">
      {rt.n} ok writes{rt.censored ? ` + ${rt.censored} still waiting (counted at their wait so far)` : ''}.
      {(rt.p50Censored || rt.p95Censored) && <span className="text-warn"> ≥ marks a lower bound.</span>}
      {' '}Refused writes never count.
    </p>
  );
}

function Tile({ label, value, note, figure, tone }: {
  label: string; value: string; note: string; figure: string; tone?: 'bad' | 'warn';
}) {
  return (
    <div className="min-w-0 bg-surface/95 p-3">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div data-figure={figure} className={cx('mt-1 truncate font-mono text-xl', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-faint">{note}</div>
    </div>
  );
}

// Process cards -------------------------------------------------------------

/**
 * Display-only flag: round-trip p50 growing by more than 10% of itself, and at
 * least half a second, per minute. Nothing reads it but a person.
 */
const rising = (slope: number | null, p50: number | null) => (
  slope !== null && p50 !== null && p50 > 0 && slope > Math.max(0.1 * p50, 500)
);

function ProcessCard({ process, rangeMs }: { process: LabelledProcess; rangeMs: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const { current, saturation } = process;
  const rows = withinRange(process.series, rangeMs);
  const errorCount = Object.entries(current.outcomes)
    .filter(([outcome]) => outcome !== 'ok' && outcome !== 'rejected')
    .reduce((sum, [, count]) => sum + count, 0);
  const slope = saturation.rtSlopeMsPerMin;
  return (
    <Panel className={cx('min-w-0 p-4', expanded && 'md:col-span-2 xl:col-span-3')}
      data-card="process" data-pid={process.pid} data-role={process.pidRole}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: roleColor(process.pidRole) }} />
            <span className="truncate text-sm font-medium text-ink">{process.label}</span>
          </div>
          <code className="mt-0.5 block truncate text-[10px] text-faint" title={process.pid}>{shortPid(process.pid)}</code>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {errorCount > 0 && <Badge tone="bad">{errorCount} err · {fmtPct(current.errorRate)}</Badge>}
          {(current.outcomes.rejected ?? 0) > 0 && <Badge tone="warn">{current.outcomes.rejected} refused</Badge>}
          {!errorCount && !current.outcomes.rejected && <Badge tone="plain">no errors</Badge>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div data-figure="round-trip" className="font-mono text-3xl font-semibold text-ink">
          {fmtMs(current.rt.p50, current.rt.p50Censored)}
          <span className="ml-1.5 text-[10px] font-normal text-faint">rt p50</span>
        </div>
        <div className="font-mono text-sm text-muted" data-figure="round-trip-spread">
          p95 {fmtMs(current.rt.p95, current.rt.p95Censored)} · avg {fmtMs(current.rt.avg)}
        </div>
      </div>
      <div className="mt-1 font-mono text-[10px] text-faint">
        {current.rt.n} ok{current.rt.censored ? ` + ${current.rt.censored} waiting` : ''} · last minute
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]" data-figure="secondary">
        <Fact label="sent/s" value={fmtRate(current.sentPerS)} />
        <Fact label="resolved/s" value={fmtRate(current.resolvedPerS)} />
        <Fact label="reads/s" value={fmtRate(current.readsPerS)} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge/50 pt-2 font-mono text-[10px] text-muted"
        aria-label="Saturation (display only)">
        <span className="eyebrow !text-[9px]">saturation</span>
        <span>slope {slope === null ? '—' : `${slope > 0 ? '+' : ''}${fmtInt(slope)} ms/min`}</span>
        <span>recv {fmtRate(saturation.receivedSlotsPerS)} slots/s</span>
        <span>recv−sent {fmtRate(current.receivedMinusSentPerS)}</span>
        <span>in flight {fmtInt(saturation.inFlight)}</span>
        {rising(slope, current.rt.p50) && <Badge tone="warn">rising</Badge>}
      </div>

      <div className="mt-3 space-y-2">
        <LineChart title={`${process.label} round trip`} rows={rows} series={rtSeries} format={msAxis}
          height={expanded ? 200 : 130} />
        <BarChart title={`${process.label} sent vs received`} rows={rows} series={sentReceived} format={rateAxis}
          height={expanded ? 130 : 90} />
      </div>

      <details className="mt-2 text-[11px]" open={expanded}>
        <summary className="cursor-pointer select-none text-faint">Phases (p50, last minute)</summary>
        <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
          <Fact label="sign" value={fmtMs(current.phases.signP50)} />
          <Fact label="POST" value={fmtMs(current.phases.postP50)} />
          <Fact label="read" value={fmtMs(current.phases.readP50)} />
          <Fact label="push" value={fmtMs(current.phases.pushP50)} />
        </div>
      </details>

      <button type="button" onClick={() => setExpanded((value) => !value)}
        className="mt-2 font-mono text-[10px] text-faint hover:text-ink">
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-ink">{value}</div>
      <div className="truncate text-[9px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

// Fleet totals --------------------------------------------------------------

type RoleRow = { t: number } & Record<string, number>;

function FleetTotals({ data, rangeMs }: { data: SwarmSnapshot; rangeMs: number | null }) {
  const fleetRows = withinRange(data.fleet.series, rangeMs);
  const roles = orderRoles(data.roles);
  const byRole = roles.map((role) => ({ role: role.pidRole, rows: new Map(role.series.map((row) => [row.t, row.sentPerS])) }));
  const roleRows = fleetRows.map((row) => {
    const out: RoleRow = { t: row.t };
    for (const { role, rows } of byRole) out[role] = rows.get(row.t) ?? 0;
    return out;
  });
  const stackSeries: Series<RoleRow>[] = roles.map((role) => ({
    key: role.pidRole, label: roleLabel(role.pidRole), color: roleColor(role.pidRole), value: (row) => row[role.pidRole] ?? null,
  }));
  const states = Object.entries(data.fleet.states).sort((a, b) => b[1] - a[1]);

  return (
    <Panel className="p-4 sm:p-5" data-card="fleet-totals">
      <SectionTitle right={<span className="font-mono text-[10px] text-faint">target {fmtRate(data.fleet.targetMsgPerS, 1)} msg/s over every contract</span>}>
        Fleet totals
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 lg:col-span-2">
          <div className="mb-1 text-xs text-muted">Sent msg/s by process role</div>
          <BarChart title="Sent messages per second by role" rows={roleRows} series={stackSeries} stacked format={rateAxis} height={150} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">In flight (writes waiting at bucket end)</div>
          <LineChart title="Writes in flight" rows={fleetRows} format={rateAxis} height={120}
            series={[{ key: 'inFlight', label: 'in flight', color: swColor(1), value: (row) => row.inFlight }]} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">HTTP req/s (POST attempts + reads)</div>
          <LineChart title="HTTP requests per second" rows={fleetRows} format={rateAxis} height={120}
            reference={{ value: MAX_RPS_DEFAULT, label: `--max-rps default ${MAX_RPS_DEFAULT}` }}
            series={[{ key: 'reqPerS', label: 'req/s', color: swColor(1), value: (row) => row.reqPerS }]} />
        </div>
      </div>
      {states.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-1.5">Accounts per state</div>
          <div className="flex flex-wrap gap-1.5">
            {states.map(([state, count]) => (
              <span key={state} className="rounded-[3px] border border-edge px-2 py-0.5 font-mono text-[10px] text-muted">
                {state} <span className="text-ink">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

