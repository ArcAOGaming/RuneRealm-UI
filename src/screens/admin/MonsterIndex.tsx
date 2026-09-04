import { useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/game';
import {
  affinityLabel, authoredMonsterIndex, monsterIndexArt, mergeMonsterIndex,
} from '../../lib/monster-index';
import {
  MonsterIndexEntry, MonsterIndexLifecycle, MonsterIndexView,
} from '../../lib/types';
import { GAME_OWNER } from '../../lib/hyperbeam';
import { useGame } from '../../state/gameContext';
import { Badge, Button, Empty, ErrorNote, Panel, SectionTitle, cx } from '../../ui/primitives';
import MonsterQaBench from './MonsterQaBench';

const STATES: MonsterIndexLifecycle[] = ['planned', 'art-in-progress', 'testing', 'live', 'retired'];
const effectiveState = (entry: MonsterIndexEntry) => entry.state ?? entry.availability?.state ?? 'planned';
const effectiveName = (entry: MonsterIndexEntry) => entry.name ?? entry.displayName ?? entry.workingName;
const effectiveStarter = (entry: MonsterIndexEntry) => entry.starter ?? entry.availability?.starter ?? false;
const effectiveCatchable = (entry: MonsterIndexEntry) => entry.huntCatchable ?? entry.availability?.huntCatchable ?? false;
const effectiveWeight = (entry: MonsterIndexEntry) => entry.huntWeight ?? entry.availability?.huntWeight ?? 0;

function assetCount(entry: MonsterIndexEntry) {
  const values = Object.values(entry.assets ?? {});
  return {
    ready: values.filter(({ status }) => status === 'approved' || status === 'fallback').length,
    partial: values.filter(({ status }) => status === 'partial').length,
    total: values.length || 5,
  };
}

export default function MonsterIndexAdmin() {
  const { address } = useGame();
  const [live, setLive] = useState<MonsterIndexView | null>(null);
  const [selectedNo, setSelectedNo] = useState(1);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'catchable' | 'missing'>('all');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      // The authoring console is the one caller that has just changed this key
      // and must see its own edit, so it bypasses the shared constant cache.
      setLive(await api.readMonsterIndex({ fresh: true }));
      setError(null);
    } catch (cause) {
      // A local authoring checkout and an older deployed process still have a
      // complete generated catalog to inspect. The error remains visible so a
      // missing live key is never mistaken for a successful sync.
      setLive(null);
      setError(cause);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const catalog = useMemo(() => mergeMonsterIndex(live ?? authoredMonsterIndex()), [live]);
  const localCatalog = authoredMonsterIndex();
  const catalogDrift = Boolean(live?.catalogHash && localCatalog.catalogHash
    && live.catalogHash !== localCatalog.catalogHash);
  const entries = useMemo(() => catalog.entries.filter((entry) => {
    const search = `${entry.entryNo} ${effectiveName(entry)} ${entry.workingName} ${entry.lineKey} ${entry.affinity}`.toLowerCase();
    if (query && !search.includes(query.toLowerCase())) return false;
    if (filter === 'live' && effectiveState(entry) !== 'live') return false;
    if (filter === 'catchable' && !effectiveCatchable(entry)) return false;
    if (filter === 'missing' && assetCount(entry).ready === assetCount(entry).total) return false;
    return true;
  }), [catalog, filter, query]);
  const selected = catalog.entries.find(({ entryNo }) => entryNo === selectedNo) ?? catalog.entries[0];
  const lines = new Map<string, MonsterIndexEntry[]>();
  catalog.entries.forEach((entry) => lines.set(entry.lineKey, [...(lines.get(entry.lineKey) ?? []), entry]));
  const line = (lines.get(selected.lineKey) ?? []).sort((a, b) => a.stage - b.stage);
  const counts = {
    live: catalog.entries.filter((entry) => effectiveState(entry) === 'live').length,
    catchable: catalog.entries.filter(effectiveCatchable).length,
    planned: catalog.entries.filter((entry) => effectiveState(entry) === 'planned').length,
    partial: catalog.entries.filter((entry) => assetCount(entry).partial > 0).length,
  };

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Monster Index</div>
            <h1 className="mt-2 text-2xl font-semibold">Numbered creature forms</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              Entry numbers and evolution lines are permanent. Names, art revisions, release state,
              and Hunt availability can move without rewriting player-owned companions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="good">{counts.live} live</Badge>
            <Badge tone="element">{counts.catchable} catchable</Badge>
            <Badge tone="warn">{counts.partial} partial forms</Badge>
            <Badge>{counts.planned} planned</Badge>
            <Badge>next #{String(catalog.nextEntryNo).padStart(3, '0')}</Badge>
          </div>
        </div>
      </Panel>

      {error !== null && <ErrorNote error={error} onRetry={reload} />}
      {catalogDrift && <div className="border border-warn/40 bg-warn/[.07] px-4 py-3 text-sm text-ink">
        The deployed contract uses Monster Index catalog <code>{live?.catalogHash}</code>, while this UI was built from <code>{localCatalog.catalogHash}</code>. Sync and redeploy before changing release channels.
      </div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(420px,.9fr)_minmax(0,1.1fr)]">
        <Panel className="min-h-[36rem] overflow-hidden">
          <div className="grid gap-3 border-b border-edge/50 p-4 sm:grid-cols-[1fr_auto]">
            <input className="rounded-[3px] border border-edge bg-raised px-3 py-2 text-sm text-ink"
              placeholder="Search number, name, line, affinity" value={query}
              onChange={(event) => setQuery(event.target.value)} />
            <select className="rounded-[3px] border border-edge bg-raised px-3 py-2 text-sm text-ink"
              value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">All entries</option><option value="live">Live</option>
              <option value="catchable">Catchable</option><option value="missing">Missing assets</option>
            </select>
          </div>
          <div className="max-h-[62rem] overflow-auto">
            {entries.map((entry) => {
              const assets = assetCount(entry);
              const art = monsterIndexArt(entry.entryNo);
              return (
                <button key={entry.entryNo} type="button" onClick={() => setSelectedNo(entry.entryNo)}
                  className={cx(
                    'grid w-full grid-cols-[3.4rem_4rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-edge/40 px-4 py-3 text-left hover:bg-raised/55',
                    selected.entryNo === entry.entryNo && 'bg-raised/75 shadow-[2px_0_0_rgb(var(--element))_inset]',
                  )} data-element={entry.affinity === 'normal' ? undefined : entry.affinity}>
                  <span className="font-mono text-sm text-faint">#{String(entry.entryNo).padStart(3, '0')}</span>
                  <span className="grid h-14 w-14 place-items-center overflow-hidden bg-void/50">
                    {art?.portrait
                      ? <img src={art.portrait} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
                      : <span className="font-mono text-xs text-faint">—</span>}
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm font-medium text-ink">{effectiveName(entry)}</b>
                    <small className="block truncate text-xs text-faint">{entry.lineKey} · stage {entry.stage} · {affinityLabel(entry.affinity)} · {entry.rarity ?? 'common'}</small>
                  </span>
                  <span className="text-right">
                    <Badge tone={effectiveState(entry) === 'live' ? 'good' : 'plain'}>{effectiveState(entry)}</Badge>
                    <small className="mt-1 block font-mono text-[10px] text-faint">
                      {assets.ready}/{assets.total} ready{assets.partial ? ` · ${assets.partial} partial` : ''}
                    </small>
                  </span>
                </button>
              );
            })}
            {!entries.length && <Empty title="No matching entries" />}
          </div>
        </Panel>

        {selected && <MonsterIndexDetail entry={selected} line={line} isOwner={address === GAME_OWNER}
          liveAvailable={Boolean(live) && !catalogDrift} onSaved={(next) => { setLive(next); setError(null); }} />}
      </div>
      {loading && <div className="text-xs text-faint">Reading the deployed Monster Index…</div>}
    </div>
  );
}

function MonsterIndexDetail({ entry, line, isOwner, liveAvailable, onSaved }: {
  entry: MonsterIndexEntry;
  line: MonsterIndexEntry[];
  isOwner: boolean;
  liveAvailable: boolean;
  onSaved: (value: MonsterIndexView) => void;
}) {
  const [name, setName] = useState(effectiveName(entry));
  const [state, setState] = useState(effectiveState(entry));
  const [starter, setStarter] = useState(effectiveStarter(entry));
  const [catchable, setCatchable] = useState(effectiveCatchable(entry));
  const [weight, setWeight] = useState(String(effectiveWeight(entry)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setName(effectiveName(entry)); setState(effectiveState(entry));
    setStarter(effectiveStarter(entry)); setCatchable(effectiveCatchable(entry));
    setWeight(String(effectiveWeight(entry))); setError(null);
  }, [entry.entryNo, entry.name, entry.state, entry.huntCatchable, entry.huntWeight, entry.starter]);

  const assets = assetCount(entry);
  const save = async () => {
    setBusy(true);
    try {
      const nextWeight = catchable ? Math.max(1, Math.floor(Number(weight) || 1)) : 0;
      const next = await api.adminUpdateMonsterIndex(entry.entryNo, {
        name, state, starter, huntCatchable: catchable, huntWeight: nextWeight,
      });
      onSaved(next); setError(null);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-element={entry.affinity === 'normal' ? undefined : entry.affinity}>
      <Panel className="p-5" glow>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Monster #{String(entry.entryNo).padStart(3, '0')}</div>
            <h2 className="mt-2 text-2xl font-semibold">{effectiveName(entry)}</h2>
            <p className="mt-1 text-sm text-faint">{entry.entryKey} · {affinityLabel(entry.affinity)} · stage {entry.stage}</p>
          </div>
          <div className="flex gap-2"><Badge>{assets.ready}/{assets.total} assets</Badge>
            <Badge tone={entry.rarity === 'legendary' ? 'warn' : 'plain'}>{entry.rarity ?? 'common'}</Badge>
            {entry.provisional && <Badge tone="warn">provisional number</Badge>}
            {effectiveStarter(entry) && <Badge tone="warn">starter</Badge>}
            {effectiveCatchable(entry) && <Badge tone="good">Hunt</Badge>}</div>
        </div>

        <div className="mt-5">
          <div className="space-y-4">
            <section><SectionTitle>Evolution line</SectionTitle>
              <div className="mt-2 grid grid-cols-3 gap-2">{line.map((form) => (
                <div key={form.entryNo} className={cx('border border-edge/60 p-2', form.entryNo === entry.entryNo && 'border-element/60 bg-element/[.06]')}>
                  <span className="font-mono text-xs text-faint">#{String(form.entryNo).padStart(3, '0')}</span>
                  <b className="mt-1 block truncate text-xs">{effectiveName(form)}</b>
                  <small className="text-[10px] text-faint">stage {form.stage} · {effectiveState(form)}</small>
                </div>
              ))}</div>
            </section>
            <section><SectionTitle>Artist plan</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted">{entry.plan?.appearance ?? 'No appearance plan yet.'}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Plan label={entry.moves?.basic ?? entry.basicMove ?? 'Basic attack'} body={entry.plan?.basicAttack ?? 'Not designed.'} />
                <Plan label={entry.moves?.advanced ?? entry.advancedMove ?? 'Advanced attack'} body={entry.plan?.advancedAttack ?? 'Not designed.'} />
              </div>
            </section>
          </div>
        </div>
      </Panel>

      <MonsterQaBench entry={entry} />

      <Panel className="p-5">
        <SectionTitle>Asset readiness</SectionTitle>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(entry.assets ?? {}).map(([slot, asset]) => (
            <div key={slot} className="border border-edge/60 p-3">
              <div className="text-xs font-medium text-ink">{slot}</div>
              <Badge tone={asset.status === 'approved' ? 'good' : asset.status === 'fallback' || asset.status === 'partial' ? 'warn' : 'plain'}>{asset.status}</Badge>
              {asset.path && <code className="mt-2 block break-all text-[9px] leading-relaxed text-faint">{asset.path}</code>}
              {asset.notes && <p className="mt-2 text-[10px] leading-relaxed text-faint">{asset.notes}</p>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <SectionTitle>Contract controls</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Display name<input className="mt-1 w-full border border-edge bg-raised px-3 py-2 text-sm text-ink" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="text-xs text-muted">Lifecycle<select className="mt-1 w-full border border-edge bg-raised px-3 py-2 text-sm text-ink" value={state} onChange={(event) => setState(event.target.value as MonsterIndexLifecycle)}>{STATES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={starter} onChange={(event) => setStarter(event.target.checked)} />Starter channel</label>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={catchable} onChange={(event) => { setCatchable(event.target.checked); if (!event.target.checked) setWeight('0'); }} />Catchable in Hunt</label>
          <label className="text-xs text-muted">Hunt weight<input type="number" min={0} max={100000} disabled={!catchable} className="mt-1 w-full border border-edge bg-raised px-3 py-2 font-mono text-sm text-ink" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
        </div>
        {error !== null && <div className="mt-3"><ErrorNote error={error} /></div>}
        <div className="mt-4 flex items-center gap-3">
          <Button busy={busy} disabled={!isOwner || !liveAvailable || !name.trim()} onClick={() => void save()}>Save entry</Button>
          <span className="text-xs text-faint">{!liveAvailable ? 'Deploy the Monster Index contract update before editing live flags.' : !isOwner ? 'Connect the owner wallet to edit.' : 'Entry number, line, stage, and affinity are immutable.'}</span>
        </div>
      </Panel>
    </div>
  );
}

function Plan({ label, body }: { label: string; body: string }) {
  return <div className="border-l-2 border-element/50 pl-3"><div className="text-xs font-medium text-ink">{label}</div><p className="mt-1 text-xs leading-relaxed text-faint">{body}</p></div>;
}
