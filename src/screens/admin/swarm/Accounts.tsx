/**
 * Per-account table (§6.5.4) and drawer (§6.5.5). One row per wallet the stream
 * has seen — the list is whatever the run drove, never a fixed roster.
 */
import { ReactNode, useMemo, useState } from 'react';
import { Badge, Button, Panel, SectionTitle, cx } from '../../../ui/primitives';
import { compareSwarmWallets, swarmProfileLabel } from '../../../data/swarm-wallets';
import { LineChart, Sparkline } from './charts';
import { clockTime, fmtInt, fmtMs, roleLabel } from './model';
import type { AccountView, SwarmSnapshot } from './types';

type SortValue = number | string | null;

interface Column {
  key: string;
  label: string;
  title?: string;
  sort?: (account: AccountView) => SortValue;
  render: (account: AccountView) => ReactNode;
  numeric?: boolean;
}

const num = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? null : value);
const cell = (value: number | null | undefined) => fmtInt(num(value));

const COLUMNS: Column[] = [
  {
    key: 'profile', label: 'Profile', sort: (a) => a.profile,
    render: (a) => <span className="text-muted">{swarmProfileLabel(a.profile)}</span>,
  },
  {
    key: 'state', label: 'State', sort: (a) => a.state,
    render: (a) => (
      <span className="block min-w-[7rem]">
        <span className="block text-ink">{a.state ?? '—'}</span>
        {a.reason && <span className="block truncate text-[9px] text-faint">{a.reason}</span>}
      </span>
    ),
  },
  { key: 'level', label: 'Lvl', numeric: true, sort: (a) => num(a.acct?.level), render: (a) => cell(a.acct?.level) },
  {
    key: 'moves', label: 'Moves', title: 'moves / pending offer', numeric: true, sort: (a) => num(a.acct?.moves),
    render: (a) => <>{cell(a.acct?.moves)}{a.acct?.pendingMove ? <span className="text-warn"> +1</span> : null}</>,
  },
  {
    key: 'roster', label: 'Ros/Col', title: 'roster / collection', numeric: true, sort: (a) => num(a.acct?.roster),
    render: (a) => `${cell(a.acct?.roster)}/${cell(a.acct?.collection)}`,
  },
  { key: 'gold', label: 'Gold', numeric: true, sort: (a) => num(a.acct?.gold), render: (a) => cell(a.acct?.gold) },
  { key: 'runes', label: 'Rune', numeric: true, sort: (a) => num(a.acct?.runes), render: (a) => cell(a.acct?.runes) },
  { key: 'scrolls', label: 'Scroll', numeric: true, sort: (a) => num(a.acct?.scrolls), render: (a) => cell(a.acct?.scrolls) },
  {
    key: 'record', label: 'W-L', numeric: true, sort: (a) => num(a.acct?.wins),
    render: (a) => `${cell(a.acct?.wins)}-${cell(a.acct?.losses)}`,
  },
  { key: 'rating', label: 'Rating', numeric: true, sort: (a) => num(a.acct?.rating), render: (a) => cell(a.acct?.rating) },
  { key: 'quests', label: 'Quests', numeric: true, sort: (a) => num(a.acct?.quests), render: (a) => cell(a.acct?.quests) },
  { key: 'captures', label: 'Caps', numeric: true, sort: (a) => num(a.acct?.captures), render: (a) => cell(a.acct?.captures) },
  { key: 'fills', label: 'Fills', numeric: true, sort: (a) => a.fills, render: (a) => cell(a.fills) },
  {
    key: 'pnl', label: 'PnL', title: 'mark-to-market Gold', numeric: true, sort: (a) => num(a.acct?.pnlGold),
    render: (a) => {
      const pnl = num(a.acct?.pnlGold);
      return <span className={cx(pnl !== null && pnl < 0 && 'text-bad')}>{pnl !== null && pnl > 0 ? '+' : ''}{cell(pnl)}</span>;
    },
  },
  {
    key: 'lastRt', label: 'Last RT', title: 'last ok round trip', numeric: true, sort: (a) => a.lastRtMs,
    render: (a) => <span className="text-ink">{fmtMs(a.lastRtMs)}</span>,
  },
  { key: 'msgs', label: 'Msgs', numeric: true, sort: (a) => a.msgs, render: (a) => cell(a.msgs) },
  {
    key: 'errors', label: 'Err', title: 'errors (refused in brackets)', numeric: true, sort: (a) => a.errors,
    render: (a) => (
      <span className={cx(a.errors > 0 && 'text-bad')}>
        {cell(a.errors)}{a.rejected ? <span className="text-faint"> ({a.rejected})</span> : null}
      </span>
    ),
  },
  { key: 'wasted', label: 'Wasted', title: 'tokens wasted', numeric: true, sort: (a) => num(a.acct?.tokensWasted), render: (a) => cell(a.acct?.tokensWasted) },
  {
    key: 'trend', label: 'Level · Gold',
    render: (a) => (
      <span className="inline-flex items-center gap-1">
        <Sparkline label={`${a.wallet} level`} color="rgb(var(--sw-1))" values={a.series.map((p) => p.level)} width={48} />
        <Sparkline label={`${a.wallet} gold`} color="rgb(var(--sw-4))" values={a.series.map((p) => p.gold)} width={48} />
      </span>
    ),
  },
];

function compare(a: SortValue, b: SortValue) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

export function AccountsPanel({ data }: { data: SwarmSnapshot }) {
  const [sortKey, setSortKey] = useState('wallet');
  const [descending, setDescending] = useState(false);
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);

  const profiles = useMemo(() => [...new Set(data.accounts.map((a) => a.profile).filter((p): p is string => !!p))].sort(), [data.accounts]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const column = COLUMNS.find((entry) => entry.key === sortKey);
    const filtered = data.accounts.filter((account) => (
      (profile === 'all' || account.profile === profile)
      && (!needle || [account.wallet, account.state, account.reason].some((value) => value?.toLowerCase().includes(needle)))
    ));
    return filtered.sort((a, b) => {
      const order = column?.sort ? compare(column.sort(a), column.sort(b)) : compareSwarmWallets(a.wallet, b.wallet);
      const tie = order || compareSwarmWallets(a.wallet, b.wallet);
      return descending && order ? -tie : tie;
    });
  }, [data.accounts, descending, profile, query, sortKey]);

  const chosen = selected ? data.accounts.find((account) => account.wallet === selected) ?? null : null;
  const sortBy = (key: string) => {
    if (key === sortKey) setDescending((value) => !value);
    else { setSortKey(key); setDescending(key !== 'wallet'); }
  };
  const arrow = (key: string) => (key === sortKey ? (descending ? ' ↓' : ' ↑') : '');

  return (
    <section className="space-y-3" aria-label="Accounts">
      <Panel className="min-w-0 overflow-hidden" data-card="accounts">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge/60 p-4">
          <div>
            <div className="eyebrow">Accounts</div>
            <div className="mt-1 text-sm text-muted" data-account-count={data.accounts.length}>
              {rows.length} of {data.accounts.length} wallets in this run
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={profile} onChange={(event) => setProfile(event.target.value)} className="admin-filter" aria-label="Profile">
              <option value="all">All profiles</option>
              {profiles.map((entry) => <option key={entry} value={entry}>{swarmProfileLabel(entry)}</option>)}
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Wallet or state"
              aria-label="Search accounts"
              className="w-40 rounded-[3px] border border-edge bg-raised px-2.5 py-1.5 font-mono text-xs text-ink focus:border-element/60 focus:outline-none" />
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
            <thead className="sticky top-0 z-[2] bg-surface">
              <tr className="border-b border-edge/60 text-[10px] uppercase tracking-wider text-faint">
                <th className="sticky left-0 z-[3] bg-surface px-3 py-2">
                  <button type="button" onClick={() => sortBy('wallet')}>Wallet{arrow('wallet')}</button>
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={cx('px-2 py-2', column.numeric && 'text-right')} title={column.title}>
                    {column.sort
                      ? <button type="button" onClick={() => sortBy(column.key)}>{column.label}{arrow(column.key)}</button>
                      : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
                <tr key={account.wallet} data-account={account.wallet}
                  className={cx('cursor-pointer border-b border-edge/30 hover:bg-raised/60', selected === account.wallet && 'bg-arcane/10')}
                  onClick={() => setSelected(account.wallet === selected ? null : account.wallet)}>
                  <td className="sticky left-0 z-[1] bg-surface px-3 py-1.5">
                    <button type="button" className="text-ink" aria-expanded={selected === account.wallet}>{account.wallet}</button>
                  </td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className={cx('px-2 py-1.5 text-muted', column.numeric && 'text-right tabular-nums')}>
                      {column.render(account)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="p-6 text-center text-sm text-muted">No accounts match.</div>}
        </div>
      </Panel>
      {chosen && <AccountDrawer account={chosen} onClose={() => setSelected(null)} />}
    </section>
  );
}

const outcomeTone = (outcome: string) => (outcome === 'ok' ? 'good' : outcome === 'rejected' ? 'warn' : 'bad');

export function AccountDrawer({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const progress = account.series.map((point) => ({ t: point.at, level: point.level, gold: point.gold }));
  const messages = [...account.timeline].reverse().slice(0, 50);
  const states = [...account.states].reverse().slice(0, 25);
  const trades = [...account.trades].reverse().slice(0, 30);
  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="account-drawer" data-wallet={account.wallet}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg text-ink">{account.wallet}</h3>
            <Badge tone="element">{swarmProfileLabel(account.profile)}</Badge>
            {account.state && <Badge tone="plain">{account.state}</Badge>}
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
            series={[{ key: 'level', label: 'level', color: 'rgb(var(--sw-1))', value: (row) => row.level }]} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">Gold</div>
          <LineChart title={`${account.wallet} gold`} rows={progress} height={110} format={(v) => v.toFixed(0)}
            series={[{ key: 'gold', label: 'gold', color: 'rgb(var(--sw-1))', value: (row) => row.gold }]} />
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
                  <td className="pr-2 text-muted">{entry.pidRole ? roleLabel(entry.pidRole) : '—'}</td>
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
                <span className="min-w-0 truncate text-muted">{entry.from ?? '—'} → <span className="text-ink">{entry.to ?? '—'}</span></span>
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
              <th className="pr-2">TIF · liq</th><th className="pr-2 text-right">Px</th><th className="pr-2 text-right">Qty</th><th className="text-right">Filled</th>
            </tr></thead>
            <tbody>{trades.map((trade, index) => (
              <tr key={`${trade.orderId ?? trade.at}-${index}`} className="border-t border-edge/30">
                <td className="py-1 pr-2 text-faint">{clockTime(trade.at)}</td>
                <td className="pr-2 text-muted">{trade.venue ?? '—'}</td>
                <td className="pr-2 text-ink">{trade.market ?? '—'}</td>
                <td className="pr-2 text-muted">{trade.side ?? '—'}</td>
                <td className="pr-2 text-muted">{trade.tif ?? '—'} · {trade.liq ?? '—'}</td>
                <td className="pr-2 text-right text-ink">{fmtInt(trade.px)}</td>
                <td className="pr-2 text-right text-muted">{fmtInt(trade.qty)}</td>
                <td className="text-right text-ink">{fmtInt(trade.filled)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!trades.length && <p className="py-3 text-xs text-faint">No trades from this wallet.</p>}
        </div>
      </div>
    </Panel>
  );
}

