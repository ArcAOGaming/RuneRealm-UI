/**
 * Accounts: the wallet grid, the per-account drawer (§6.5.5) and the full
 * table (§6.5.4), which the page keeps under More detail. One tile and one row per wallet the stream has
 * seen — the list is whatever the run drove, never a fixed roster.
 *
 * Table columns sit under five headings (now, progression, holdings, trading,
 * health) so a row can be read left to right without hunting.
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Panel, SectionTitle, cx } from '../../../ui/primitives';
import { compareSwarmWallets, swarmProfileLabel } from '../../../data/swarm-wallets';
import { LineChart, Sparkline } from './charts';
import { ACTIVITIES, activityOf, assetLabel, clockTime, fmtInt, fmtMs, fmtPx, groupOf, roleLabel, stateLabel } from './model';
import { activityColor, groupColor, swColor } from './palette';
import type { AccountView, SwarmSnapshot } from './types';
import { WalletGrid } from './WalletGrid';

type SortValue = number | string | null;

interface Column {
  key: string;
  label: string;
  title?: string;
  sort?: (account: AccountView) => SortValue;
  render: (account: AccountView, now: number) => ReactNode;
  numeric?: boolean;
}

interface ColumnGroup { label: string; columns: Column[] }

const num = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? null : value);
const cell = (value: number | null | undefined) => fmtInt(num(value));
const lastWrite = (account: AccountView) => account.timeline[account.timeline.length - 1] ?? null;
const activityRank = (state: string | null) => ACTIVITIES.indexOf(activityOf(state));

function ago(ms: number) {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1_000))} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return `${Math.round(ms / 3_600_000)} h ago`;
}

/** A wallet's state, in the colour of what it is doing (the group that activity drives). */
export function StateChip({ state, reason }: { state: string | null; reason?: string | null }) {
  const activity = activityOf(state);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-edge/70 bg-raised/60 px-1.5 py-0.5 font-sans text-[11px] text-ink"
      title={`${activity.label}${reason ? `: ${reason}` : ''}`} data-activity={activity.id}>
      <span className={cx('h-2 w-2 shrink-0 rounded-[2px]', activity.id === 'unreported' && 'border border-edge')}
        style={{ background: activityColor(activity) }} aria-hidden />
      {stateLabel(state)}
    </span>
  );
}

const GROUPED_COLUMNS: ColumnGroup[] = [
  {
    label: 'Now',
    columns: [
      {
        key: 'profile', label: 'Profile', sort: (a) => a.profile,
        render: (a) => <span className="font-sans text-muted">{swarmProfileLabel(a.profile)}</span>,
      },
      { key: 'state', label: 'Doing', sort: (a) => activityRank(a.state), render: (a) => <StateChip state={a.state} reason={a.reason} /> },
      {
        key: 'last', label: 'Last write', title: 'last write, its round trip, and when it resolved', sort: (a) => a.lastAt,
        render: (a, now) => {
          const entry = lastWrite(a);
          if (!entry) return <span className="text-faint">—</span>;
          return (
            <span className="inline-flex min-w-[11rem] items-baseline gap-1.5">
              <span className="text-ink">{entry.action ?? '—'}</span>
              {entry.outcome === 'ok'
                ? <span className="text-muted">{fmtMs(entry.rtMs)}</span>
                : <span className={entry.outcome === 'rejected' ? 'text-warn' : 'text-bad'}>{entry.outcome}</span>}
              {a.lastAt ? <span className="text-[10px] text-faint">{ago(now - a.lastAt)}</span> : null}
            </span>
          );
        },
      },
    ],
  },
  {
    label: 'Progression',
    columns: [
      {
        key: 'level', label: 'Lvl', title: 'level (+1: a move offer is pending)', numeric: true, sort: (a) => num(a.acct?.level),
        render: (a) => <>{cell(a.acct?.level)}{a.acct?.pendingMove ? <span className="text-warn"> +1</span> : null}</>,
      },
      { key: 'moves', label: 'Moves', numeric: true, sort: (a) => num(a.acct?.moves), render: (a) => cell(a.acct?.moves) },
      {
        key: 'record', label: 'W-L', numeric: true, sort: (a) => num(a.acct?.wins),
        render: (a) => `${cell(a.acct?.wins)}-${cell(a.acct?.losses)}`,
      },
      { key: 'rating', label: 'Rating', numeric: true, sort: (a) => num(a.acct?.rating), render: (a) => cell(a.acct?.rating) },
      { key: 'quests', label: 'Quests', numeric: true, sort: (a) => num(a.acct?.quests), render: (a) => cell(a.acct?.quests) },
      { key: 'captures', label: 'Caps', title: 'captures', numeric: true, sort: (a) => num(a.acct?.captures), render: (a) => cell(a.acct?.captures) },
      {
        key: 'roster', label: 'Ros/Col', title: 'roster / collection', numeric: true, sort: (a) => num(a.acct?.roster),
        render: (a) => `${cell(a.acct?.roster)}/${cell(a.acct?.collection)}`,
      },
      {
        key: 'trend', label: 'Level, gold',
        render: (a) => (
          <span className="inline-flex items-center gap-1">
            <Sparkline label={`${a.wallet} level`} color={swColor(1)} values={a.series.map((p) => p.level)} width={44} />
            <Sparkline label={`${a.wallet} gold`} color={swColor(4)} values={a.series.map((p) => p.gold)} width={44} />
          </span>
        ),
      },
    ],
  },
  {
    label: 'Holdings',
    columns: [
      { key: 'gold', label: 'Gold', numeric: true, sort: (a) => num(a.acct?.gold), render: (a) => cell(a.acct?.gold) },
      { key: 'runes', label: 'Rune', numeric: true, sort: (a) => num(a.acct?.runes), render: (a) => cell(a.acct?.runes) },
      { key: 'scrolls', label: 'Scroll', numeric: true, sort: (a) => num(a.acct?.scrolls), render: (a) => cell(a.acct?.scrolls) },
    ],
  },
  {
    label: 'Trading',
    columns: [
      {
        key: 'trades', label: 'Trades', title: 'trade records held for this wallet (last 100)', numeric: true,
        sort: (a) => a.trades.length, render: (a) => cell(a.trades.length),
      },
      { key: 'fills', label: 'Fills', numeric: true, sort: (a) => a.fills, render: (a) => cell(a.fills) },
      { key: 'open', label: 'Open', title: 'open orders', numeric: true, sort: (a) => num(a.acct?.openOrders), render: (a) => cell(a.acct?.openOrders) },
      {
        key: 'pnl', label: 'PnL', title: 'mark-to-market Gold', numeric: true, sort: (a) => num(a.acct?.pnlGold),
        render: (a) => {
          const pnl = num(a.acct?.pnlGold);
          return <span className={cx(pnl !== null && pnl < 0 && 'text-bad')}>{pnl !== null && pnl > 0 ? '+' : ''}{cell(pnl)}</span>;
        },
      },
    ],
  },
  {
    label: 'Health',
    columns: [
      {
        key: 'lastRt', label: 'Last RT', title: 'last ok round trip', numeric: true, sort: (a) => a.lastRtMs,
        render: (a) => <span className="text-ink">{fmtMs(a.lastRtMs)}</span>,
      },
      { key: 'msgs', label: 'Msgs', numeric: true, sort: (a) => a.msgs, render: (a) => cell(a.msgs) },
      {
        key: 'errors', label: 'Err', title: 'errors (refused in brackets)', numeric: true, sort: (a) => a.errors,
        render: (a) => (
          <span className={cx(a.errors > 0 && 'text-bad')}>
            {cell(a.errors)}{a.rejected ? <span className="text-warn"> ({a.rejected})</span> : null}
          </span>
        ),
      },
      {
        key: 'wasted', label: 'Wasted', title: 'tokens wasted', numeric: true,
        sort: (a) => num(a.acct?.tokensWasted), render: (a) => cell(a.acct?.tokensWasted),
      },
    ],
  },
];

const COLUMNS = GROUPED_COLUMNS.flatMap((group) => group.columns);
const GROUP_START = new Set(GROUPED_COLUMNS.map((group) => group.columns[0].key));
/** Text columns read best A to Z on first click; numbers, largest first. */
const ASCENDING_FIRST = new Set(['wallet', 'profile', 'state']);

function compare(a: SortValue, b: SortValue) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

/**
 * The wallet grid and the drawer of the wallet picked on it or in the table.
 * `live`: the stream is feeding a live run, so waits on the grid count up by the second.
 */
export function WalletsPanel({ data, live = false, selected, onSelect, onClose }: {
  data: SwarmSnapshot; live?: boolean; selected: string | null; onSelect: (wallet: string) => void; onClose: () => void;
}) {
  const chosen = selected ? data.accounts.find((account) => account.wallet === selected) ?? null : null;
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) drawer.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <section className="space-y-3" aria-label="Wallets">
      <Panel className="min-w-0">
        <WalletGrid data={data} live={live} selected={selected} onSelect={onSelect} />
      </Panel>
      <div ref={drawer} className="scroll-mt-4">
        {chosen && <AccountDrawer account={chosen} onClose={onClose} />}
      </div>
    </section>
  );
}

/** Every wallet as a sortable, filterable row; picking one opens its drawer under the grid. */
export function AccountTable({ data, selected, onSelect }: {
  data: SwarmSnapshot; selected: string | null; onSelect: (wallet: string) => void;
}) {
  const [sortKey, setSortKey] = useState('wallet');
  const [descending, setDescending] = useState(false);
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState('all');
  const [activity, setActivity] = useState('all');
  const now = data.lastEventAt ?? data.at;

  const profiles = useMemo(() => [...new Set(data.accounts.map((a) => a.profile).filter((p): p is string => !!p))].sort(), [data.accounts]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const column = COLUMNS.find((entry) => entry.key === sortKey);
    const filtered = data.accounts.filter((account) => (
      (profile === 'all' || account.profile === profile)
      && (activity === 'all' || activityOf(account.state).id === activity)
      && (!needle || [account.wallet, account.state, account.reason, lastWrite(account)?.action]
        .some((value) => value?.toLowerCase().includes(needle)))
    ));
    return filtered.sort((a, b) => {
      const order = column?.sort ? compare(column.sort(a), column.sort(b)) : compareSwarmWallets(a.wallet, b.wallet);
      const tie = order || compareSwarmWallets(a.wallet, b.wallet);
      return descending && order ? -tie : tie;
    });
  }, [activity, data.accounts, descending, profile, query, sortKey]);

  const sortBy = (key: string) => {
    if (key === sortKey) setDescending((value) => !value);
    else { setSortKey(key); setDescending(!ASCENDING_FIRST.has(key)); }
  };
  const arrow = (key: string) => (key === sortKey ? (descending ? ' ↓' : ' ↑') : '');
  const divider = (key: string) => GROUP_START.has(key) && 'border-l border-edge/50';

  return (
    <Panel className="min-w-0 overflow-hidden" data-card="accounts">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-4">
        <h2 className="text-sm font-medium text-ink">Account table</h2>
        <span className="text-xs text-muted" data-account-count={data.accounts.length}>
          {rows.length} of {data.accounts.length} wallets, sortable, with holdings and health
        </span>
      </div>
      <div className="flex flex-wrap items-end justify-end gap-3 border-y border-edge/60 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <select value={activity} onChange={(event) => setActivity(event.target.value)} className="admin-filter" aria-label="Activity">
            <option value="all">All activities</option>
            {ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select value={profile} onChange={(event) => setProfile(event.target.value)} className="admin-filter" aria-label="Profile">
            <option value="all">All profiles</option>
            {profiles.map((entry) => <option key={entry} value={entry}>{swarmProfileLabel(entry)}</option>)}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Wallet, state or action"
            aria-label="Search accounts"
            className="w-44 rounded-[3px] border border-edge bg-raised px-2.5 py-1.5 font-mono text-xs text-ink focus:border-element/60 focus:outline-none" />
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
          <thead className="sticky top-0 z-[2] bg-surface">
            <tr>
              <th className="sticky left-0 z-[3] bg-surface px-3 pt-2" aria-hidden />
              {GROUPED_COLUMNS.map((group) => (
                <th key={group.label} colSpan={group.columns.length} scope="colgroup"
                  className="border-l border-edge/50 px-2 pt-2 font-sans text-[11px] font-medium text-muted">
                  {group.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-edge/60 text-[10px] text-faint">
              <th className="sticky left-0 z-[3] bg-surface px-3 py-1.5 font-normal">
                <button type="button" className="hover:text-ink" onClick={() => sortBy('wallet')}>Wallet{arrow('wallet')}</button>
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} title={column.title}
                  className={cx('px-2 py-1.5 font-normal', column.numeric && 'text-right', divider(column.key))}>
                  {column.sort
                    ? <button type="button" className="hover:text-ink" onClick={() => sortBy(column.key)}>{column.label}{arrow(column.key)}</button>
                    : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((account) => (
              <tr key={account.wallet} data-account={account.wallet}
                className={cx('cursor-pointer border-b border-edge/30 hover:bg-raised/60', selected === account.wallet && 'bg-arcane/10')}
                onClick={() => onSelect(account.wallet)}>
                <td className="sticky left-0 z-[1] bg-surface px-3 py-1.5">
                  <button type="button" className="text-ink" aria-expanded={selected === account.wallet}>{account.wallet}</button>
                </td>
                {COLUMNS.map((column) => (
                  <td key={column.key} className={cx('px-2 py-1.5 text-muted', column.numeric && 'text-right tabular-nums', divider(column.key))}>
                    {column.render(account, now)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-6 text-center text-sm text-muted">No accounts match.</div>}
      </div>
    </Panel>
  );
}

const outcomeTone = (outcome: string) => (outcome === 'ok' ? 'good' : outcome === 'rejected' ? 'warn' : 'bad');

export function AccountDrawer({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const progress = account.series.map((point) => ({ t: point.at, level: point.level, gold: point.gold }));
  const messages = [...account.timeline].reverse().slice(0, 50);
  const states = [...account.states].reverse().slice(0, 25);
  const trades = [...account.trades].reverse().slice(0, 30);
  const transfers = [...(account.transfers ?? [])].reverse();
  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="account-drawer" data-wallet={account.wallet}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg text-ink">{account.wallet}</h3>
            <Badge tone="element">{swarmProfileLabel(account.profile)}</Badge>
            <StateChip state={account.state} reason={account.reason} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-faint">
            last round trip <span className="text-ink">{fmtMs(account.lastRtMs)}</span>
            {' · '}{account.ok} ok · {account.rejected} refused · {account.errors} errors
            {account.lastAt ? ` · last seen ${clockTime(account.lastAt)}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">Level</div>
          <LineChart title={`${account.wallet} level`} rows={progress} height={110} format={(v) => v.toFixed(0)}
            series={[{ key: 'level', label: 'level', color: swColor(1), value: (row) => row.level }]} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">Gold</div>
          <LineChart title={`${account.wallet} gold`} rows={progress} height={110} format={(v) => v.toFixed(0)}
            series={[{ key: 'gold', label: 'gold', color: swColor(4), value: (row) => row.gold }]} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <SectionTitle>Messages</SectionTitle>
          <div className="max-h-80 overflow-auto">
            <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className="py-1 pr-2">Sent</th><th className="pr-2">Action</th><th className="pr-2">Process</th>
                <th className="pr-2 text-right">Round trip</th><th>Outcome</th>
              </tr></thead>
              <tbody>{messages.map((entry, index) => (
                <tr key={`${entry.t0}-${index}`} className="border-t border-edge/30">
                  <td className="py-1 pr-2 text-faint">{clockTime(entry.t0)}</td>
                  <td className="pr-2 text-ink">{entry.action ?? '—'}</td>
                  <td className="pr-2 text-muted">
                    {entry.pidRole ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-[2px]" style={{ background: groupColor(groupOf(entry.pidRole).id) }} aria-hidden />
                        {roleLabel(entry.pidRole)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="pr-2 text-right text-ink">{entry.outcome === 'ok' ? fmtMs(entry.rtMs) : '—'}</td>
                  <td><Badge tone={outcomeTone(entry.outcome)}>{entry.outcome}{entry.late ? ' · late' : ''}</Badge></td>
                </tr>
              ))}</tbody>
            </table>
            {!messages.length && <p className="py-3 text-xs text-faint">No messages yet.</p>}
          </div>
        </div>
        <div className="min-w-0">
          <SectionTitle>States</SectionTitle>
          <ol className="max-h-80 space-y-1 overflow-auto font-mono text-[11px]">
            {states.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-2 border-t border-edge/30 pt-1">
                <span className="shrink-0 text-faint">{clockTime(entry.at)}</span>
                <span className="min-w-0 truncate text-muted">{stateLabel(entry.from)} → <span className="text-ink">{stateLabel(entry.to)}</span></span>
                {entry.reason && <span className="ml-auto shrink-0 truncate text-faint">{entry.reason}</span>}
              </li>
            ))}
            {!states.length && <li className="py-3 text-xs text-faint">No state changes yet.</li>}
          </ol>
        </div>
      </div>

      <div className="mt-4 min-w-0">
        <SectionTitle>Trades</SectionTitle>
        <div className="max-h-72 overflow-auto">
          <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className="py-1 pr-2">At</th><th className="pr-2">Venue</th><th className="pr-2">Market</th><th className="pr-2">Side</th>
              <th className="pr-2">TIF · liq</th><th className="pr-2 text-right" title="whole units of the quote asset">Px</th><th className="pr-2 text-right">Qty</th><th className="text-right">Filled</th>
            </tr></thead>
            <tbody>{trades.map((trade, index) => (
              <tr key={`${trade.orderId ?? trade.at}-${index}`} className="border-t border-edge/30">
                <td className="py-1 pr-2 text-faint">{clockTime(trade.at)}</td>
                <td className="pr-2 text-muted">{trade.venue ?? '—'}</td>
                <td className="pr-2 text-ink">{trade.market ?? '—'}</td>
                <td className="pr-2 text-muted">{trade.side ?? '—'}</td>
                <td className="pr-2 text-muted">{trade.tif ?? '—'} · {trade.liq ?? '—'}</td>
                <td className="pr-2 text-right text-ink">{fmtPx(trade.px)}</td>
                <td className="pr-2 text-right text-muted">{fmtInt(trade.qty)}</td>
                <td className="text-right text-ink">{fmtInt(trade.filled)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!trades.length && <p className="py-3 text-xs text-faint">No trades from this wallet.</p>}
        </div>
      </div>

      <div className="mt-4 min-w-0" data-section="peer-transfers">
        <SectionTitle>Peer transfers</SectionTitle>
        <p className="mb-1 font-mono text-[11px] text-faint">
          {account.peer
            ? <>{fmtInt(account.peer.sent)} sent · {fmtInt(account.peer.received)} received this run, token sends straight to another wallet</>
            : 'This stream does not count peer transfers yet.'}
        </p>
        <div className="max-h-60 overflow-auto">
          <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className="py-1 pr-2">At</th><th className="pr-2">Way</th><th className="pr-2">Wallet</th>
              <th className="pr-2 text-right">Qty</th><th className="pr-2">Asset</th><th>Outcome</th>
            </tr></thead>
            <tbody>{transfers.map((entry, index) => (
              <tr key={`${entry.id}-${entry.dir}-${index}`} className="border-t border-edge/30" data-transfer={entry.dir}>
                <td className="py-1 pr-2 text-faint">{clockTime(entry.at)}</td>
                <td className="pr-2 text-muted">{entry.dir === 'sent' ? 'sent to' : 'from'}</td>
                <td className="pr-2 text-ink">{entry.peer ?? '—'}</td>
                <td className="pr-2 text-right text-ink">{fmtInt(entry.qty)}</td>
                <td className="pr-2 text-muted">{entry.asset ? assetLabel(entry.asset) : '—'}</td>
                <td><Badge tone={outcomeTone(entry.outcome)}>{entry.outcome}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
          {account.peer && !transfers.length && <p className="py-3 text-xs text-faint">No peer transfers for this wallet.</p>}
        </div>
      </div>
    </Panel>
  );
}
