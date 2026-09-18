/**
 * SwarmMonitor layout, live run only, rendered from one stream snapshot.
 *
 * Top to bottom: the status bar (`SwarmMonitor.tsx` renders it above this),
 * the headline (fleet round trip, writes per second against target, wallets
 * active and what they are doing), one card per process GROUP with its members
 * listed inside, the wallet grid, money flow. Everything else (charts, trading,
 * buy vs sell, the account table) is behind one closed "More detail".
 *
 * Round trip — sign a message and have the changed state back — is the first
 * and largest figure in the headline and on every group card. Rates and the
 * send/read phase split are secondary and sit below it.
 *
 * Saturation is DISPLAY ONLY (§10): the status chips, slope, received slots/s
 * and in-flight figures here inform a person; nothing on this page stops or
 * steers a run.
 */
import { ReactNode, useMemo, useState } from 'react';
import { Badge, Panel, cx } from '../../../ui/primitives';
import { BarChart, LineChart, Series, Sparkline } from './charts';
import {
  GroupMember, GroupPoint, GroupStatus, GroupView, MAX_RPS_DEFAULT, MonitorStatus, RANGES, TRADING_WINDOW_MS, activityCounts,
  buildGroups, clockTime, fmtBytes, fmtDuration, fmtInt, fmtMs, fmtPct, fmtRate, memberFlag, nodeDown, runStartedAt,
  shortPid, tradingNow, withinRange,
} from './model';
import type { BucketRow, SwarmSnapshot } from './types';
import { AccountTable, WalletsPanel } from './Accounts';
import { MoneyFlowDetail, MoneyFlowPanel } from './MoneyFlow';
import { TradingPanel } from './Trading';
import { PALETTE_CSS, activityColor, groupColor, swColor } from './palette';

const rateAxis = (value: number) => String(Number(value.toFixed(value >= 10 ? 0 : 2)));

/** `live`: the stream is feeding the page, so waits on the wallet grid count up by the second. */
export function SwarmMonitorView({ data, live = false }: { data: SwarmSnapshot; live?: boolean }) {
  const groups = useMemo(() => buildGroups(data), [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (wallet: string) => setSelected((current) => (current === wallet ? null : wallet));
  return (
    <div className="swarm-monitor space-y-4" data-run={data.run ?? ''}>
      <style>{PALETTE_CSS}</style>
      <HeadlinePanel data={data} />
      <GroupsSection data={data} groups={groups} />
      <WalletsPanel data={data} live={live} selected={selected} onSelect={toggle} onClose={() => setSelected(null)} />
      <MoneyFlowPanel data={data} />
      <details data-more-detail className="group/more">
        <summary className="cursor-pointer list-none select-none rounded-[3px] border border-edge/60 px-4 py-2.5 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="mr-1.5 inline-block text-faint transition-transform group-open/more:rotate-90">›</span>
          More detail
          <span className="ml-2 text-[11px] text-faint">charts over time, trading, buy vs sell, the account table</span>
        </summary>
        <div className="mt-4 space-y-4">
          <ChartsPanel data={data} groups={groups} />
          <TradingNowStrip data={data} />
          <MoneyFlowDetail data={data} />
          <TradingPanel data={data} />
          <AccountTable data={data} selected={selected} onSelect={toggle} />
        </div>
      </details>
    </div>
  );
}

// Status --------------------------------------------------------------------

export const SWARM_COMMAND = 'npm run swarm:keep -- --for 12h';

/** Exactly one state; while live, also the run's clock and any node outage or halt. */
export function StatusBar({ status, data, base, now }: {
  status: MonitorStatus; data: SwarmSnapshot | null; base?: string; now: number;
}) {
  const tone = status.kind === 'unreachable' ? 'text-bad'
    : status.kind === 'live' ? (status.quiet ? 'text-warn' : 'text-good')
      : status.kind === 'launching' ? 'text-ink' : 'text-muted';
  const moving = status.kind === 'connecting' || status.kind === 'launching' || (status.kind === 'live' && !status.quiet);
  return (
    <Panel data-card="status" data-status={status.kind}
      className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-5">
      <span data-figure="status" data-quiet={status.kind === 'live' && status.quiet ? 'true' : undefined}
        title={status.kind === 'unreachable' ? base : undefined}
        className={cx('inline-flex min-w-0 items-center gap-2 text-sm font-medium', tone)}>
        <span className={cx('h-2 w-2 shrink-0 rounded-full bg-current', moving && 'motion-safe:animate-pulse')} aria-hidden />
        <StatusText status={status} />
      </span>
      {status.kind === 'live' && data && <RunFacts data={data} now={now} />}
    </Panel>
  );
}

function StatusText({ status }: { status: MonitorStatus }) {
  switch (status.kind) {
    case 'connecting': return <span>Connecting…</span>;
    case 'unreachable': return <span>Stream not reachable — retrying</span>;
    case 'idle': return <span>No swarm running — start it with <code className="text-ink">{SWARM_COMMAND}</code></span>;
    case 'launching': return <span className="min-w-0">Launching: {status.step}{status.note ? ` — ${status.note}` : ''}</span>;
    case 'live': return <span>Live · last event {Math.round(status.agoMs / 1_000)}s ago</span>;
    default: return null;
  }
}

function RunFacts({ data, now }: { data: SwarmSnapshot; now: number }) {
  const halt = data.fleet.halt;
  const down = nodeDown({ ...data, at: Math.max(data.at, now) });
  const started = runStartedAt(data.run) ?? data.from;
  const endsAt = typeof data.endsAt === 'number' && Number.isFinite(data.endsAt) ? data.endsAt : null;
  return (
    <div className="min-w-0 text-xs text-muted">
      {down && (
        <span data-figure="node-down" className="mr-3 font-medium text-bad" title={down.node ?? undefined}>
          Node down since {clockTime(down.since)}, {fmtDuration(down.downMs)} so far
        </span>
      )}
      {halt && (
        <span data-figure="halt" className="mr-3 text-bad">
          halted {clockTime(halt.at)}: {halt.reason ?? 'no reason given'}{halt.pid ? ` (${shortPid(halt.pid)})` : ''}
        </span>
      )}
      <span>
        <span className="text-ink">{fmtDuration(started === null ? null : data.at - started)}</span> elapsed
        {endsAt !== null && (
          <span data-figure="remaining" className="text-faint" title={`planned end ${clockTime(endsAt)}`}>
            , <span className="text-ink">{fmtDuration(Math.max(0, endsAt - data.at))}</span> remaining
          </span>
        )}
      </span>
    </div>
  );
}

// Headline ------------------------------------------------------------------

function HeadlinePanel({ data }: { data: SwarmSnapshot }) {
  const { fleet } = data;
  const current = fleet.current;
  const target = fleet.targetMsgPerS;
  return (
    <Panel className="min-w-0">
      <div data-card="fleet" className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="text-xs text-muted">Fleet round trip, last minute</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div data-figure="round-trip" className="font-mono text-5xl font-semibold tracking-tight text-ink">
              {fmtMs(current.rt.p50, current.rt.p50Censored)}
              <span className="ml-2 align-middle text-xs font-normal text-faint">p50</span>
            </div>
            <div className="font-mono text-2xl text-muted" data-figure="round-trip-p95">
              {fmtMs(current.rt.p95, current.rt.p95Censored)}<span className="ml-1.5 text-xs text-faint">p95</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-faint">
            {fmtInt(current.rt.n)} ok writes{current.rt.censored ? `, plus ${fmtInt(current.rt.censored)} still waiting and counted at their wait so far` : ''}.
            {(current.rt.p50Censored || current.rt.p95Censored) && <span className="text-warn"> ≥ marks a lower bound.</span>}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Writes per second" figure="sent" value={fmtRate(current.sentPerS)} note={`target ${fmtRate(target, 1)}`}>
            <Meter value={current.sentPerS} max={target} label="Writes per second against target" />
          </Stat>
          <Stat label="Wallets active" figure="active" value={`${fmtInt(fleet.activeAccounts)}/${fmtInt(fleet.accounts)}`}
            note="sent in the last minute" />
        </div>
      </div>
      <ActivityStrip data={data} />
    </Panel>
  );
}

function Stat({ label, value, note, figure, children }: {
  label: string; value: string; note: string; figure: string; children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted">{label}</div>
      <div data-figure={figure} className="mt-0.5 truncate font-mono text-2xl text-ink">{value}</div>
      {children}
      <div className="mt-0.5 truncate text-[11px] text-faint">{note}</div>
    </div>
  );
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}
      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-raised">
      <div className="h-full rounded-[1px] bg-ink/70" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The fleet's wallets as one bar split by what they are doing; the wallet grid below shows each one. */
function ActivityStrip({ data }: { data: SwarmSnapshot }) {
  const counts = activityCounts(data.accounts);
  const total = data.accounts.length;
  return (
    <div data-card="activity" className="border-t border-edge/60 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">What wallets are doing</h3>
        <span className="text-[11px] text-faint">by current state; each wallet is a tile in the grid below</span>
      </div>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-[2px] bg-raised" role="img"
        aria-label={counts.filter((entry) => entry.count).map((entry) => `${entry.count} ${entry.activity.label.toLowerCase()}`).join(', ')}>
        {total > 0 && counts.filter((entry) => entry.count > 0).map(({ activity, count }) => (
          <span key={activity.id} data-activity-segment={activity.id} title={`${count} ${activity.label.toLowerCase()}`}
            className="h-full border-r-2 border-surface last:border-r-0"
            style={{ width: `${(100 * count) / total}%`, background: activityColor(activity) }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {counts.filter((entry) => entry.count > 0 || entry.activity.id !== 'unreported').map(({ activity, count }) => (
          <li key={activity.id} data-activity-count={activity.id}
            className={cx('inline-flex items-center gap-1.5 text-xs', count ? 'text-muted' : 'text-faint')}>
            <span className={cx('h-2.5 w-2.5 rounded-[2px]', activity.id === 'unreported' && 'border border-edge')}
              style={{ background: activityColor(activity) }} aria-hidden />
            <span className={cx('font-mono', count ? 'text-ink' : 'text-faint')}>{count}</span>
            {activity.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TradingNowStrip({ data }: { data: SwarmSnapshot }) {
  const trading = tradingNow(data.accounts, data.lastEventAt ?? data.at);
  const minutes = Math.round(TRADING_WINDOW_MS / 60_000);
  return (
    <Panel data-card="trading-now" className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
      <h3 className="text-sm font-medium text-ink">Trading, last {minutes} min</h3>
      <Inline figure="orders" value={fmtInt(trading.ordersPlaced)} label="orders placed" />
      <Inline figure="fills" value={fmtInt(trading.fills)} label="fills, venue and desk" />
      <Inline figure="trading-share" value={trading.share === null ? '—' : `${Math.round(100 * trading.share)}%`}
        label={`of ${fmtInt(trading.writes)} writes were trading`} />
      <Inline figure="fills-per-min" value={fmtRate(data.fleet.current.fillsPerMin, 1)} label="fills/min in the last minute" />
    </Panel>
  );
}

function Inline({ value, label, figure }: { value: string; label: string; figure: string }) {
  return (
    <span className="text-xs text-muted">
      <span data-figure={figure} className="mr-1.5 font-mono text-base text-ink">{value}</span>{label}
    </span>
  );
}

// Process groups ------------------------------------------------------------

function GroupsSection({ data, groups }: { data: SwarmSnapshot; groups: GroupView[] }) {
  const main = groups.filter((group) => !group.def.secondary);
  const adminProcesses = groups.find((group) => group.def.secondary)?.members ?? [];
  const admin = data.fleet.admin;
  return (
    <section aria-label="Processes" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-medium text-ink">Processes</h2>
        <span className="text-[11px] text-faint">last minute; status chips are display only</span>
      </div>
      {main.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {main.map((group) => <GroupCard key={group.def.id} group={group} />)}
          {(admin || adminProcesses.length > 0) && (
            <Panel data-card="admin" className="min-w-0 self-start px-4 py-3 text-xs text-muted">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink">Admin</span>
                <span className="text-faint">launch writes, kept out of every figure</span>
              </div>
              <div className="mt-1 font-mono" data-figure="admin">
                admin {fmtInt(admin?.msgs ?? 0)} kept out
                {admin?.outcomes && Object.keys(admin.outcomes).length > 0 && (
                  <span className="text-faint">
                    {' '}({Object.entries(admin.outcomes).map(([outcome, count]) => `${count} ${outcome}`).join(', ')})
                  </span>
                )}
              </div>
              {adminProcesses.map((process) => (
                <code key={process.pid} className="mt-1 block truncate text-[10px] text-faint" title={process.pid}>{shortPid(process.pid)}</code>
              ))}
            </Panel>
          )}
        </div>
      ) : (
        <Panel className="p-5 text-sm text-muted">No writes in this run yet.</Panel>
      )}
    </section>
  );
}

const STATUS_CHIP: Record<GroupStatus, { tone: 'good' | 'warn' | 'plain'; label: string; title: string }> = {
  steady: { tone: 'good', label: 'steady', title: 'Round trip is not climbing and writes are not piling up.' },
  rising: { tone: 'warn', label: 'rising', title: 'Round-trip p50 is growing by more than 10% of itself (and 0.5 s) per minute.' },
  backlog: { tone: 'warn', label: 'backlog', title: 'At least 10 writes are waiting, more than 30 seconds of sends.' },
  idle: { tone: 'plain', label: 'idle', title: 'No writes sent or resolved in the last minute.' },
};

const FLAG_COPY = {
  slow: 'slow',
  busy: 'busy',
  quiet: 'quiet',
} as const;

function GroupCard({ group }: { group: GroupView }) {
  const color = groupColor(group.def.id);
  const chip = STATUS_CHIP[group.status];
  const errors = Object.entries(group.outcomes)
    .filter(([outcome]) => outcome !== 'ok' && outcome !== 'rejected')
    .reduce((sum, [, count]) => sum + count, 0);
  const refused = group.outcomes.rejected ?? 0;
  const roles = new Set(group.members.map((member) => member.pidRole)).size;
  const source = group.rtBasis === 'slowest' ? group.rtSource : null;
  const recent = (series: BucketRow[]) => withinRange(series, 10 * 60_000);
  const sparkMax = Math.max(0, ...group.members.flatMap((member) => recent(member.series).map((row) => row.sentPerS)));

  return (
    <Panel className="relative min-w-0 overflow-hidden py-4 pl-5 pr-4" data-card="group" data-group={group.def.id}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <h3 data-identity className="truncate text-sm font-medium text-ink">{group.title}</h3>
        <span title={chip.title}><Badge tone={chip.tone}>{chip.label}</Badge></span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div data-figure="round-trip" className="font-mono text-3xl font-semibold tracking-tight text-ink">
          {fmtMs(group.rt.p50, group.rt.p50Censored)}
          <span className="ml-1.5 text-[11px] font-normal text-faint">p50</span>
        </div>
        <div className="font-mono text-sm text-muted" data-figure="round-trip-p95">
          {fmtMs(group.rt.p95, group.rt.p95Censored)} <span className="text-[11px] text-faint">p95</span>
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-faint" data-rt-source={source?.p50?.pidRole}>
        {source?.p50 ? (
          <>
            slowest of {roles} contracts: <span className="text-muted">{source.p50.label}</span>, {fmtInt(source.p50.n)} ok
            {source.p50.censored ? `, ${fmtInt(source.p50.censored)} waiting` : ''}
            {source.p95 && source.p95.pidRole !== source.p50.pidRole ? `; p95 from ${source.p95.label}` : ''}
          </>
        ) : (
          <>{fmtInt(group.rt.n)} ok{group.rt.censored ? `, ${fmtInt(group.rt.censored)} waiting` : ''}</>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-5 gap-2 font-mono text-xs" data-figure="totals">
        <Fact label="received/s" value={fmtRate(group.receivedSlotsPerS)}
          title="Messages the group's processes received per second: player writes plus process-to-process traffic." />
        <Fact label="writes/s" value={fmtRate(group.sentPerS)} title="Player writes sent to the group per second." />
        <Fact label="in flight" value={fmtInt(group.inFlight)} tone={group.status === 'backlog' ? 'warn' : undefined} />
        <Fact label="errors" value={errors ? fmtPct(group.errorRate) : '0'} tone={errors ? 'bad' : undefined} />
        <Fact label="refused" value={refused ? fmtPct(group.rejectedRate) : '0'} tone={refused ? 'warn' : undefined} />
      </dl>

      <div aria-hidden className={cx(MEMBER_COLUMNS, 'mt-3 border-t border-edge/50 pt-2 text-[10px] text-faint')}>
        <span>{group.def.workers ? 'worker' : 'contract'}</span>
        <span>10 min</span>
        <span className="text-right">writes/s</span>
        <span className="text-right">p50</span>
      </div>
      <ul className="mt-1 space-y-1" aria-label={`${group.def.label} members`}>
        {group.members.map((member) => (
          <MemberRow key={member.pid} member={member} flag={memberFlag(member, group.members)}
            color={color} sparkMax={sparkMax} rows={recent(member.series)} />
        ))}
      </ul>

      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer select-none text-faint hover:text-muted">Details</summary>
        <div className="mt-2 space-y-2">
          {group.members.map((member) => (
            <div key={member.pid} className="min-w-0 border-t border-edge/30 pt-1.5 font-mono text-[10px] text-muted">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink">{member.label}</span>
                <span className="text-faint">{member.published
                  ? `published ${fmtBytes(member.published.bytes)} at ${clockTime(member.published.at)}`
                  : 'published bytes not sampled yet'}</span>
              </div>
              <code className="block break-all text-faint">{member.pid}</code>
              <div className="mt-0.5 flex flex-wrap gap-x-3">
                <span>recv {fmtRate(member.current.receivedSlotsPerS)} slots/s</span>
                <span>reads {fmtRate(member.current.readsPerS)}/s</span>
                <span>slope {slopeText(member.saturation.rtSlopeMsPerMin)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-faint">
                <span>POST {fmtMs(member.current.phases.postP50)}</span>
                <span>read {fmtMs(member.current.phases.readP50)}</span>
                <span>push {fmtMs(member.current.phases.pushP50)}</span>
              </div>
            </div>
          ))}
          <div className="text-[10px] text-faint">Phases are p50 components of the round trip, not latency on their own.</div>
        </div>
      </details>
    </Panel>
  );
}

const MEMBER_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_56px_3.5rem_4rem] items-center gap-2';

const slopeText = (slope: number | null) => (slope === null ? '—' : `${slope > 0 ? '+' : ''}${fmtInt(slope)} ms/min`);

function MemberRow({ member, flag, color, sparkMax, rows }: {
  member: GroupMember; flag: ReturnType<typeof memberFlag>; color: string; sparkMax: number; rows: BucketRow[];
}) {
  return (
    <li className={cx(MEMBER_COLUMNS, 'font-mono text-[11px]')}
      data-member={member.pid} data-flag={flag ?? undefined}>
      <span className="min-w-0 truncate">
        <span className="text-ink">{member.label}</span>
        <span className="ml-1.5 text-[10px] text-faint" title={member.pid}>{shortPid(member.pid)}</span>
        {flag && <span className="ml-1.5 rounded-[2px] bg-warn/15 px-1 text-[10px] text-warn">{FLAG_COPY[flag]}</span>}
      </span>
      <Sparkline values={rows.map((row) => row.sentPerS)} color={color} max={sparkMax} width={56} height={16}
        label={`${member.label} writes per second, last 10 minutes`} />
      <span className="text-right text-muted" title="writes/s">{fmtRate(member.current.sentPerS)}</span>
      <span className={cx('text-right', flag === 'slow' ? 'text-warn' : 'text-ink')} title="round trip p50">
        {fmtMs(member.current.rt.p50, member.current.rt.p50Censored)}
      </span>
    </li>
  );
}

function Fact({ label, value, tone, title }: { label: string; value: string; tone?: 'bad' | 'warn'; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dd className={cx('truncate', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</dd>
      <dt className="truncate font-sans text-[10px] text-faint">{label}</dt>
    </div>
  );
}

// Over time -----------------------------------------------------------------

interface GroupRow { t: number; groups: Record<string, GroupPoint> }

function ChartsPanel({ data, groups }: { data: SwarmSnapshot; groups: GroupView[] }) {
  const [rangeId, setRangeId] = useState('15m');
  const range = RANGES.find((entry) => entry.id === rangeId) ?? RANGES[1];
  const fleetRows = withinRange(data.fleet.series, range.ms);
  const shown = groups.filter((group) => !group.def.secondary);
  const floor = fleetRows.length ? fleetRows[0].t : Infinity;
  const rows: GroupRow[] = fleetRows.map((row) => ({ t: row.t, groups: {} }));
  const byT = new Map(rows.map((row) => [row.t, row]));
  for (const group of shown) {
    for (const point of group.series) {
      if (point.t < floor) continue;
      const row = byT.get(point.t);
      if (row) row.groups[group.def.id] = point;
    }
  }
  const writes: Series<GroupRow>[] = shown.map((group) => ({
    key: group.def.id, label: group.def.label, color: groupColor(group.def.id),
    value: (row) => row.groups[group.def.id]?.sentPerS ?? null,
  }));
  const roundTrips: Series<GroupRow>[] = shown.map((group) => ({
    key: group.def.id, label: group.def.label, color: groupColor(group.def.id),
    value: (row) => row.groups[group.def.id]?.p50 ?? null,
    describe: (row) => fmtMs(row.groups[group.def.id]?.p50, row.groups[group.def.id]?.p50Censored),
  }));

  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="charts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">Over time</h2>
        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Chart range">
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
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Group colours">
        {shown.map((group) => (
          <li key={group.def.id} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: groupColor(group.def.id) }} aria-hidden />
            {group.def.label}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <figure className="min-w-0">
          <figcaption className="mb-1 text-xs text-muted">
            Writes per second, stacked by group <span className="text-faint">· dashed line is the {fmtRate(data.fleet.targetMsgPerS, 1)}/s target</span>
          </figcaption>
          <BarChart title="Writes per second by process group" rows={rows} series={writes} stacked legend={false}
            format={rateAxis} height={170} reference={{ value: data.fleet.targetMsgPerS, label: 'target' }} />
        </figure>
        <figure className="min-w-0">
          <figcaption className="mb-1 text-xs text-muted">
            Round trip p50 by group <span className="text-faint">· slowest contract for venues and tokens</span>
          </figcaption>
          <LineChart title="Round trip p50 by process group" rows={rows} series={roundTrips} legend={false}
            format={(value) => fmtMs(value)} height={170} />
        </figure>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs text-faint hover:text-muted">Transport: in flight and HTTP requests</summary>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <figure className="min-w-0">
            <figcaption className="mb-1 text-xs text-muted">Writes waiting at each bucket end</figcaption>
            <LineChart title="Writes in flight" rows={fleetRows} format={rateAxis} height={120}
              series={[{ key: 'inFlight', label: 'in flight', color: swColor(1), value: (row) => row.inFlight }]} />
          </figure>
          <figure className="min-w-0">
            <figcaption className="mb-1 text-xs text-muted">HTTP requests per second (POST attempts and reads)</figcaption>
            <LineChart title="HTTP requests per second" rows={fleetRows} format={rateAxis} height={120}
              reference={{ value: MAX_RPS_DEFAULT, label: `--max-rps default ${MAX_RPS_DEFAULT}` }}
              series={[{ key: 'reqPerS', label: 'req/s', color: swColor(1), value: (row) => row.reqPerS }]} />
          </figure>
        </div>
      </details>
    </Panel>
  );
}
