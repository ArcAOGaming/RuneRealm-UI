import { useMemo, useState } from 'react';
import { useGame } from '../state/gameContext';
import { usePoll } from '../state/usePoll';
import * as api from '../lib/game';
import {
  affinityLabel, authoredMonsterIndex, monsterIndexArt, monsterIndexOwnership, mergeMonsterIndex,
} from '../lib/monster-index';
import { MonsterIndexEntry, Listing } from '../lib/types';
import { Badge, Button, Empty, Panel, Skeleton, cx } from '../ui/primitives';
import { Check, Lock, Paw, Refresh } from '../ui/icons';

type Discovery = 'unseen' | 'seen' | 'owned';
type Filter = 'all' | Discovery;

const stateOf = (entry: MonsterIndexEntry) => entry.state ?? entry.availability?.state ?? 'planned';
const nameOf = (entry: MonsterIndexEntry) => entry.name ?? entry.displayName ?? entry.workingName;

export default function MonsterIndex() {
  const { address, player, monsterIndex, loadingPlayer, connect, connecting, refresh } = useGame();
  const [market, setMarket] = useState<Record<string, Listing> | null>(null);
  const [selectedNo, setSelectedNo] = useState<number>();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refreshMarket = async () => {
    setRefreshing(true);
    try {
      setMarket(await api.readMarket().catch(() => null));
      await refresh().catch(() => undefined);
    } finally { setRefreshing(false); }
  };
  // The market only decides whether a form reads as owned, so it is the lowest
  // priority read on the page — single-flight, cancellable, and out of the way
  // of anything the player is waiting on.
  usePoll(async (signal) => {
    const next = await api.readMarket({ signal });
    if (!signal.aborted) setMarket(next);
  }, { intervalMs: 30_000, maxIntervalMs: 120_000, leading: true });

  const catalog = useMemo(() => mergeMonsterIndex(monsterIndex ?? authoredMonsterIndex()), [monsterIndex]);
  const seen = useMemo(() => new Set(player?.seenEntries ?? []), [player?.seenEntries]);
  const owned = useMemo(() => monsterIndexOwnership(player, market), [market, player]);
  const discovery = (entryNo: number): Discovery => owned.has(entryNo)
    ? 'owned' : seen.has(entryNo) ? 'seen' : 'unseen';

  // Every reserved number gets a physical slot. Planned forms remain sealed
  // and do not count toward completion, but the roadmap is visible.
  const available = catalog.entries;
  const entries = available.filter((entry) => {
    const status = discovery(entry.entryNo);
    if (filter !== 'all' && status !== filter) return false;
    if (!query) return true;
    const searchable = status === 'unseen'
      ? `#${entry.entryNo}`
      : `${entry.entryNo} ${nameOf(entry)} ${entry.lineKey} ${entry.affinity}`;
    return searchable.toLowerCase().includes(query.toLowerCase());
  });
  const live = catalog.entries.filter((entry) => stateOf(entry) === 'live');
  const ownedLive = live.filter((entry) => owned.has(entry.entryNo)).length;
  const seenLive = live.filter((entry) => seen.has(entry.entryNo) || owned.has(entry.entryNo)).length;
  const selected = catalog.entries.find((entry) => entry.entryNo === selectedNo);
  const selectedState = selected ? discovery(selected.entryNo) : undefined;
  const completion = live.length ? ownedLive / live.length * 100 : 0;

  if (!address && !loadingPlayer) {
    return <Panel className="mx-auto max-w-xl p-7"><Empty icon={<Paw />} title="Connect to begin your Monster Index">
      Discovery belongs to a keeper, so the Realm needs your wallet before it can remember what you have seen and what you own now.
      <div className="mt-4"><Button variant="primary" busy={connecting} onClick={connect}>Connect wallet</Button></div>
    </Empty></Panel>;
  }
  if (loadingPlayer && !player) {
    return <div className="space-y-4"><Panel className="p-5"><Skeleton className="h-40 w-full" /></Panel><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div></div>;
  }

  return (
    <div className="space-y-5 animate-rise">
      <Panel className="overflow-hidden p-5" glow>
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="eyebrow">Monster Index</div>
            <h1 className="mt-2 text-3xl font-semibold">Own the living catalog</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              The goal is simultaneous stewardship: own one of every live Monster Index entry at the same time.
              Selling your last copy returns that form to seen—not owned.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Tally value={ownedLive} label={`owned / ${live.length}`} tone="owned" />
            <Tally value={seenLive} label="seen" tone="seen" />
            <Tally value={Math.max(0, live.length - seenLive)} label="unknown" tone="unseen" />
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden bg-void/70">
          <div className="h-full bg-element transition-[width] duration-700" style={{ width: `${completion}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
          <span className="font-mono">{completion.toFixed(0)}% currently owned</span>
          <span>Only live entries count toward completion</span>
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input className="rounded-[3px] border border-edge bg-raised px-3 py-2 text-sm text-ink"
            placeholder="Search discovered entries" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex flex-wrap gap-1">{(['all', 'unseen', 'seen', 'owned'] as Filter[]).map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={cx(
              'rounded-[3px] border px-3 py-2 text-xs capitalize',
              filter === value ? 'border-element/60 bg-element/10 text-ink' : 'border-edge text-muted hover:text-ink',
            )}>{value}</button>
          ))}</div>
          <Button size="sm" variant="quiet" busy={refreshing} icon={<Refresh className="h-4 w-4" />} onClick={() => void refreshMarket()}>Refresh</Button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {entries.map((entry) => <EntryTile key={entry.entryNo} entry={entry}
          status={discovery(entry.entryNo)} copies={owned.get(entry.entryNo) ?? 0}
          disabled={stateOf(entry) !== 'live'}
          selected={selectedNo === entry.entryNo} onSelect={() => setSelectedNo(entry.entryNo)} />)}
      </div>
      {!entries.length && <Panel className="p-6"><Empty icon={<Paw />} title="No entries match this view" /></Panel>}

      {selected && <EntryDetail entry={selected} status={selectedState!} disabled={stateOf(selected) !== 'live'} copies={owned.get(selected.entryNo) ?? 0}
        line={catalog.entries.filter((entry) => entry.lineKey === selected.lineKey).sort((a, b) => a.stage - b.stage)}
        seen={seen} owned={owned} />}
    </div>
  );
}

function Tally({ value, label, tone }: { value: number; label: string; tone: Discovery }) {
  return <div className={cx('min-w-20 border px-3 py-2', tone === 'owned' ? 'border-element/45 bg-element/[.08]' : 'border-edge/60 bg-void/35')}>
    <div className="font-mono text-xl text-ink">{value}</div><div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
  </div>;
}

function EntryTile({ entry, status, copies, disabled, selected, onSelect }: {
  entry: MonsterIndexEntry; status: Discovery; copies: number; disabled: boolean; selected: boolean; onSelect: () => void;
}) {
  const art = status !== 'unseen' ? monsterIndexArt(entry.entryNo) : undefined;
  return <button type="button" onClick={onSelect}
    data-element={status === 'owned' && entry.affinity !== 'normal' ? entry.affinity : undefined}
    className={cx(
      'group relative min-h-64 overflow-hidden border bg-surface/70 p-3 text-left transition-all',
      selected ? 'border-element/70 -translate-y-1' : 'border-edge/60 hover:-translate-y-0.5 hover:border-rune/35',
      status === 'unseen' && 'bg-void/55',
    )}>
    <div className="flex items-center justify-between">
      <span className="font-mono text-xs text-faint">#{String(entry.entryNo).padStart(3, '0')}</span>
      <Badge tone={status === 'owned' ? 'good' : status === 'seen' ? 'plain' : 'plain'}>
        {disabled ? 'sealed' : status === 'owned' ? `${copies} owned` : status === 'seen' ? 'seen' : 'unknown'}
      </Badge>
    </div>
    <div className={cx('mt-3 grid h-40 place-items-center overflow-hidden border border-edge/35 bg-void/45', status === 'seen' && 'grayscale')}>
      {art?.portrait ? <img src={art.portrait} alt="" className={cx(
        'h-full w-full object-contain [image-rendering:pixelated] transition-all',
        status === 'seen' ? 'opacity-45' : 'opacity-100 group-hover:scale-105',
      )} /> : <div className="grid place-items-center text-faint/35"><Lock className="h-9 w-9" /><Paw className="mt-2 h-12 w-12" /></div>}
    </div>
    <div className="mt-3">
      <h2 className={cx('truncate text-base font-semibold', status === 'unseen' ? 'text-faint' : 'text-ink')}>
        {status === 'unseen' ? 'Unknown creature' : nameOf(entry)}
      </h2>
      <p className="mt-0.5 text-[11px] text-faint">
        {disabled ? 'Not yet released' : status === 'unseen' ? 'Not yet encountered' : `${affinityLabel(entry.affinity)} · stage ${entry.stage}`}
      </p>
    </div>
  </button>;
}

function EntryDetail({ entry, status, copies, disabled, line, seen, owned }: {
  entry: MonsterIndexEntry; status: Discovery; copies: number; disabled: boolean; line: MonsterIndexEntry[];
  seen: Set<number>; owned: Map<number, number>;
}) {
  if (disabled) return <Panel className="p-6"><div className="eyebrow">Monster #{String(entry.entryNo).padStart(3, '0')}</div>
    <div className="mt-5 grid place-items-center py-8 text-center"><Lock className="h-10 w-10 text-faint" /><h2 className="mt-4 text-xl font-semibold">Entry sealed</h2><p className="mt-2 max-w-md text-sm text-muted">This numbered form is reserved in the Realm roadmap but is not available in the game yet.</p></div></Panel>;
  if (status === 'unseen') return <Panel className="p-6"><div className="eyebrow">Monster #{String(entry.entryNo).padStart(3, '0')}</div>
    <div className="mt-5 grid place-items-center py-8 text-center"><Lock className="h-10 w-10 text-faint" /><h2 className="mt-4 text-xl font-semibold">Entry undiscovered</h2><p className="mt-2 max-w-md text-sm text-muted">Meet this creature in the wild or arena, or bring one into your collection, to reveal its record.</p></div></Panel>;
  const art = monsterIndexArt(entry.entryNo);
  return <Panel className="p-5" data-element={status === 'owned' && entry.affinity !== 'normal' ? entry.affinity : undefined}>
    <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
      <div className={cx('grid min-h-56 place-items-center border border-edge/50 bg-void/40', status === 'seen' && 'grayscale opacity-60')}>
        {art?.portrait && <img src={art.portrait} alt={nameOf(entry)} className="h-56 w-full object-contain [image-rendering:pixelated]" />}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">Monster #{String(entry.entryNo).padStart(3, '0')}</span>
          <Badge tone={status === 'owned' ? 'good' : 'plain'}>{status === 'owned' ? `${copies} currently owned` : 'seen · not owned'}</Badge></div>
        <h2 className="mt-2 text-2xl font-semibold">{nameOf(entry)}</h2>
        <p className="mt-1 text-sm text-faint">{affinityLabel(entry.affinity)} · evolution stage {entry.stage} · {entry.rarity ?? 'common'}</p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">{entry.plan?.appearance}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">{line.map((form) => {
          const formStatus: Discovery = owned.has(form.entryNo) ? 'owned' : seen.has(form.entryNo) ? 'seen' : 'unseen';
          return <div key={form.entryNo} className={cx('border p-2', formStatus === 'owned' ? 'border-element/50 bg-element/[.06]' : 'border-edge/50')}>
            <span className="font-mono text-[10px] text-faint">#{String(form.entryNo).padStart(3, '0')}</span>
            <div className="mt-1 truncate text-xs text-ink">{formStatus === 'unseen' ? '???' : nameOf(form)}</div>
            <div className="text-[10px] text-faint">{formStatus}</div>
          </div>;
        })}</div>
        {status === 'seen' && <p className="mt-4 flex items-center gap-2 border-l-2 border-rune/25 pl-3 text-xs text-faint"><Paw className="h-4 w-4" />Acquire one again to restore this entry to full color and completion.</p>}
        {status === 'owned' && <p className="mt-4 flex items-center gap-2 border-l-2 border-good/40 pl-3 text-xs text-good"><Check className="h-4 w-4" />Counts toward simultaneous Monster Index completion.</p>}
      </div>
    </div>
  </Panel>;
}
