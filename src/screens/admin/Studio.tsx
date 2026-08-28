import { ReactNode, useEffect, useMemo, useState } from 'react';
import { cardBlob } from '../../lib/card/browser';
import {
  advanceStudioBattle, createStudioBattle, simulateMatchup,
  STUDIO_TUNING, StudioTuning,
} from '../../lib/studio-battle';
import { Element, ItemId, Monster, Move } from '../../lib/types';
import { BattleStage } from '../../ui/BattleStage';
import { CardPreview } from '../../ui/CardPreview';
import { Badge, Button, Empty, ErrorNote, Panel, SectionTitle, cx } from '../../ui/primitives';

type StudioMode = 'visualize' | 'create';
type AssetCategory = 'all' | 'background' | 'creature' | 'card' | 'move' | 'item' | 'ui' | 'legacy';
type AssetRow = {
  id: string; path: string; name: string; extension: string; bytes: number;
  source: string; family: string; category: Exclude<AssetCategory, 'all'>; url: string;
};
type StudioMove = Move & { name: string; pool: string };
type StudioStatus = { localOnly: boolean; pixelLab: boolean; retroDiffusion: boolean };
type StudioKind =
  | 'battle-background' | 'room-background'
  | 'side-scroller-sky' | 'side-scroller-far' | 'side-scroller-mid' | 'side-scroller-ground'
  | 'creature-portrait' | 'creature-sheet' | 'move-effect' | 'card-layer';
type StudioJob = {
  id: string; status: 'pending' | 'approved' | 'rejected';
  provider: 'pixellab' | 'retro-diffusion'; kind: StudioKind;
  name: string; prompt: string; width: number; height: number;
  transparent: boolean; seed: number; createdAt: string;
  stagedPath: string; approvedPath?: string; providerMeta?: Record<string, unknown>;
};

const inputClass = cx(
  'w-full rounded-[3px] border border-edge bg-raised px-2.5 py-2 text-sm text-ink',
  'focus:border-element/60 focus:outline-none',
);
const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const CATEGORIES: AssetCategory[] = ['all', 'background', 'creature', 'card', 'move', 'item', 'ui', 'legacy'];
const INVENTORY: ItemId[] = [
  'rune', 'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'ruby', 'emerald', 'topaz', 'diamond', 'scroll', 'legendary_scroll',
];
const FACTION: Record<Element, string> = {
  fire: 'Inferno Blades', water: 'Aqua Guardians', air: 'Sky Nomads', rock: 'Stone Titans',
};
const BERRY: Record<Element, ItemId> = {
  fire: 'fire_berry', water: 'water_berry', air: 'air_berry', rock: 'rock_berry',
};
const SPRITE: Record<Element, string> = {
  fire: 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ',
  water: 'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc',
  air: '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0',
  rock: 'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks',
};

type MonsterDraft = {
  name: string; element: Element; level: number; attack: number;
  defense: number; speed: number; health: number; energy: number;
  happiness: number; exp: number;
};

const DEFAULT_CARD: MonsterDraft = {
  name: 'Ember', element: 'fire', level: 8, attack: 7, defense: 5,
  speed: 6, health: 7, energy: 82, happiness: 91, exp: 340,
};

function monsterFrom(draft: MonsterDraft, choices: string[], moves: StudioMove[]): Monster {
  // Match the live roller's usual four-pool shape: an elemental signature,
  // then boost, heal and neutral. A custom selection replaces only that slot;
  // leaving the other selectors on "automatic" still produces four moves.
  const fallback = [draft.element, 'boost', 'heal', 'normal']
    .map((pool) => moves.find((move) => move.pool === pool))
    .filter(Boolean) as StudioMove[];
  const selected = [0, 1, 2, 3]
    .map((slot) => moves.find((move) => move.name === choices[slot]) ?? fallback[slot])
    .filter(Boolean) as StudioMove[];
  return {
    name: draft.name || 'Unnamed', image: draft.element, sprite: SPRITE[draft.element],
    faction: FACTION[draft.element], elementType: draft.element, berryItem: BERRY[draft.element],
    attack: draft.attack, defense: draft.defense, speed: draft.speed, health: draft.health,
    energy: draft.energy, happiness: draft.happiness, level: draft.level, exp: draft.exp,
    nextLevelExp: Math.max(100, draft.level * 100), totalTimesFed: 0,
    totalTimesPlay: 0, totalTimesQuest: 0,
    moves: Object.fromEntries(selected.map((move) => [move.name, {
      type: move.type, rarity: move.rarity, count: move.count || 1,
      damage: move.damage, attack: move.attack, speed: move.speed,
      defense: move.defense, health: move.health,
    }])),
    status: { type: 'Home', since: Date.now(), until_time: Date.now() }, bornAt: Date.now(),
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error ?? `Studio request failed (${response.status})`);
  return value as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error ?? `Studio request failed (${response.status})`);
  return value as T;
}

const fileUrl = (path: string) => `/__studio/file?path=${encodeURIComponent(path)}`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function Studio({ mode }: { mode: StudioMode }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [moves, setMoves] = useState<StudioMove[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [assetData, gameData, jobData, nextStatus] = await Promise.all([
        getJson<{ assets: AssetRow[] }>('/__studio/assets'),
        getJson<{ moves: StudioMove[] }>('/__studio/game-data'),
        getJson<{ jobs: StudioJob[] }>('/__studio/jobs'),
        getJson<StudioStatus>('/__studio/status'),
      ]);
      setAssets(assetData.assets); setMoves(gameData.moves); setJobs(jobData.jobs); setStatus(nextStatus);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  if (error && !assets.length) return <ErrorNote error={error} onRetry={() => void reload()} />;
  if (mode === 'create') {
    return <CreateStudio status={status} jobs={jobs} loading={loading} onReload={reload} />;
  }
  return (
    <div className="space-y-4">
      <StudioIntro assets={assets} moves={moves} jobs={jobs} status={status} />
      <AssetLibrary assets={assets} />
      <CardLab moves={moves} />
      <BattleLab moves={moves} />
    </div>
  );
}

function StudioIntro({ assets, moves, jobs, status }: {
  assets: AssetRow[]; moves: StudioMove[]; jobs: StudioJob[]; status: StudioStatus | null;
}) {
  return (
    <Panel className="overflow-hidden p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="eyebrow text-element">Local design laboratory</div>
          <h2 className="mt-2 text-2xl font-semibold text-ink">See the whole realm before changing it</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Browse every visual file, compose production-card previews, and run deterministic battle
            simulations against editable combat tuning. Generation remains staged until you approve it.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <StudioCount value={assets.length} label="assets" />
          <StudioCount value={moves.length} label="moves" />
          <StudioCount value={jobs.filter((job) => job.status === 'pending').length} label="pending" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="good">localhost only</Badge>
        <Badge tone={status?.pixelLab ? 'good' : 'warn'}>PixelLab {status?.pixelLab ? 'ready' : 'key missing'}</Badge>
        <Badge tone={status?.retroDiffusion ? 'good' : 'warn'}>Retro Diffusion {status?.retroDiffusion ? 'ready' : 'key missing'}</Badge>
      </div>
    </Panel>
  );
}

function StudioCount({ value, label }: { value: number; label: string }) {
  return <div className="min-w-20 rounded-[3px] border border-edge bg-void/45 px-3 py-2"><div className="font-mono text-xl text-ink">{value}</div><div className="text-[10px] uppercase tracking-wide text-faint">{label}</div></div>;
}

function AssetLibrary({ assets }: { assets: AssetRow[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory>('all');
  const [source, setSource] = useState('all');
  const [limit, setLimit] = useState(96);
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const sources = useMemo(() => [...new Set(assets.map((asset) => asset.source))].sort(), [assets]);
  const sourceCounts = useMemo(() => Object.fromEntries(sources.map((value) => [
    value, assets.filter((asset) => asset.source === value).length,
  ])), [assets, sources]);
  const rows = useMemo(() => assets.filter((asset) => {
    const needle = query.trim().toLowerCase();
    return (category === 'all' || asset.category === category)
      && (source === 'all' || asset.source === source)
      && (!needle || asset.path.toLowerCase().includes(needle));
  }), [assets, category, query, source]);

  useEffect(() => { setLimit(96); }, [query, category, source]);

  return (
    <Panel className="p-5">
      <SectionTitle right={<span className="font-mono text-[11px] text-faint">{rows.length} / {assets.length}</span>}>All asset library</SectionTitle>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        This is the complete authoring library from{' '}
        <code className="mx-1 text-ink">RuneRealm-Assets</code>, the single source of truth.
        Runtime bundle copies, public icons, and legacy-project files are intentionally excluded.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {sources.map((value) => <button key={value} type="button" onClick={() => setSource(value)}><Badge tone={source === value ? 'element' : 'plain'}>{value} · {sourceCounts[value]}</Badge></button>)}
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_180px_180px]">
        <Field label="Search"><input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every filename and folder…" /></Field>
        <Field label="Category"><select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as AssetCategory)}>
          {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></Field>
        <Field label="Source"><select className={inputClass} value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="all">all sources</option>
          {sources.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></Field>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 2xl:grid-cols-8">
          {rows.slice(0, limit).map((asset) => (
            <button key={asset.id} type="button" onClick={() => setSelected(asset)}
              className={cx('group min-w-0 overflow-hidden rounded-[3px] border bg-void/50 text-left transition-colors', selected?.id === asset.id ? 'border-element' : 'border-edge hover:border-element/50')}>
              <div className="grid aspect-square place-items-center overflow-hidden bg-[linear-gradient(45deg,#18151d_25%,transparent_25%),linear-gradient(-45deg,#18151d_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18151d_75%),linear-gradient(-45deg,transparent_75%,#18151d_75%)] bg-[length:16px_16px]">
                <img src={asset.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain [image-rendering:pixelated]" />
              </div>
              <div className="px-2 py-1.5" title={asset.path}>
                <div className="truncate text-[10px] text-muted">{asset.name}</div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-faint">{asset.source}</div>
              </div>
            </button>
          ))}
        </div>
        <div>
          {selected ? (
            <div className="sticky top-4 rounded-[3px] border border-edge bg-void/45 p-3">
              <div className="grid min-h-48 place-items-center overflow-hidden bg-raised/30">
                <img src={selected.url} alt={selected.name} className="max-h-80 max-w-full object-contain [image-rendering:pixelated]" />
              </div>
              <div className="mt-3 break-all text-xs font-medium text-ink">{selected.name}</div>
              <div className="mt-1 break-all font-mono text-[10px] leading-relaxed text-faint">{selected.path}</div>
              <div className="mt-2 flex flex-wrap gap-1"><Badge>{selected.category}</Badge><Badge>{selected.extension}</Badge><Badge>{Math.ceil(selected.bytes / 1024)} KB</Badge></div>
            </div>
          ) : <Empty title="Choose an asset">Select any thumbnail for its full preview and exact repository path.</Empty>}
        </div>
      </div>
      {limit < rows.length && <div className="mt-4 text-center"><Button size="sm" onClick={() => setLimit((value) => value + 96)}>Load 96 more</Button></div>}
    </Panel>
  );
}

function CardLab({ moves }: { moves: StudioMove[] }) {
  const [draft, setDraft] = useState(DEFAULT_CARD);
  const [selectedMoves, setSelectedMoves] = useState<string[]>([]);
  const [extended, setExtended] = useState(true);
  const [inventory, setInventory] = useState<Partial<Record<ItemId, number>>>({ rune: 42, fire_berry: 3, ruby: 1 });
  const [downloading, setDownloading] = useState(false);
  const monster = useMemo(() => monsterFrom(draft, selectedMoves, moves), [draft, selectedMoves, moves]);
  const patch = <K extends keyof MonsterDraft>(key: K, value: MonsterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const download = async () => {
    setDownloading(true);
    try {
      const blob = await cardBlob(monster, { extended, inventory, moveUses: 3 });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${monster.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'card'}.png`;
      anchor.click(); URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  return (
    <Panel className="p-5" data-element={draft.element}>
      <SectionTitle right={<Badge tone="element">production renderer</Badge>}>Card laboratory</SectionTitle>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_1fr]">
        <div className="mx-auto w-full max-w-[440px]"><CardPreview monster={monster} inventory={inventory} extended={extended} eager /></div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className={inputClass} value={draft.name} onChange={(event) => patch('name', event.target.value)} /></Field>
            <Field label="Element"><select className={inputClass} value={draft.element} onChange={(event) => patch('element', event.target.value as Element)}>{ELEMENTS.map((element) => <option key={element}>{element}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(['level', 'attack', 'defense', 'speed', 'health'] as const).map((key) => <NumberField key={key} label={key} value={draft[key]} min={1} max={99} onChange={(value) => patch(key, value)} />)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(['energy', 'happiness', 'exp'] as const).map((key) => <NumberField key={key} label={key} value={draft[key]} min={0} max={99999} onChange={(value) => patch(key, value)} />)}
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-faint">Move slots · {moves.length} definitions</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((slot) => <select key={slot} className={inputClass} value={selectedMoves[slot] ?? ''} onChange={(event) => setSelectedMoves((current) => { const next = [...current]; next[slot] = event.target.value; return next; })}><option value="">automatic slot {slot + 1}</option>{moves.map((move) => <option key={`${slot}-${move.name}`} value={move.name}>{move.name} · {move.type} · r{move.rarity}</option>)}</select>)}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-[11px] uppercase tracking-wide text-faint">Extended satchel</span><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={extended} onChange={(event) => setExtended(event.target.checked)} /> show panel</label></div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {INVENTORY.map((item) => <NumberField key={item} label={item.replaceAll('_', ' ')} value={Number(inventory[item] ?? 0)} min={0} max={9999} onChange={(value) => setInventory((current) => ({ ...current, [item]: value }))} />)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" busy={downloading} onClick={() => void download()}>Download preview PNG</Button><Button onClick={() => { setDraft(DEFAULT_CARD); setSelectedMoves([]); }}>Reset card</Button></div>
          <p className="text-xs leading-relaxed text-faint">This is the same shared layout used by the mint worker, so the card you tune here matches the permanent card composition.</p>
        </div>
      </div>
    </Panel>
  );
}

function BattleLab({ moves }: { moves: StudioMove[] }) {
  const [left, setLeft] = useState<MonsterDraft>({ ...DEFAULT_CARD, name: 'Cinder' });
  const [right, setRight] = useState<MonsterDraft>({ ...DEFAULT_CARD, name: 'Torrent', element: 'water', attack: 6, defense: 7, speed: 5 });
  const [tuning, setTuning] = useState<StudioTuning>(STUDIO_TUNING);
  const leftMonster = useMemo(() => monsterFrom(left, [], moves), [left, moves]);
  const rightMonster = useMemo(() => monsterFrom(right, [], moves), [right, moves]);
  const result = useMemo(() => simulateMatchup(leftMonster, rightMonster, tuning, 250), [leftMonster, rightMonster, tuning]);
  const [battle, setBattle] = useState(() => createStudioBattle(leftMonster, rightMonster, tuning));
  useEffect(() => { setBattle(createStudioBattle(leftMonster, rightMonster, tuning)); }, [leftMonster, rightMonster, tuning]);
  const finish = () => setBattle((current) => {
    let next = current;
    while (next.status !== 'ended') next = advanceStudioBattle(next, tuning, 7001 + next.round);
    return next;
  });
  const peak = Math.max(1, ...result.distribution);

  return (
    <Panel className="p-5">
      <SectionTitle right={<Badge tone="element">250 fights per change</Badge>}>Battle & balance laboratory</SectionTitle>
      <div className="grid gap-5 2xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-4">
          <BattleStage battle={battle} me={battle.challenger} them={battle.accepter!} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FighterEditor label="Challenger" value={left} onChange={setLeft} />
            <FighterEditor label="Opponent" value={right} onChange={setRight} />
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={battle.status === 'ended'} onClick={() => setBattle((current) => advanceStudioBattle(current, tuning, Date.now()))}>Play next round</Button><Button disabled={battle.status === 'ended'} onClick={finish}>Resolve battle</Button><Button onClick={() => setBattle(createStudioBattle(leftMonster, rightMonster, tuning))}>Reset</Button><Badge tone={battle.status === 'ended' ? 'good' : 'plain'}>round {battle.round} · {battle.status}{battle.winner ? ` · ${battle.winner} wins` : ''}</Badge></div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ResultStat label={left.name} value={percent(result.challengerWinRate)} />
            <ResultStat label={right.name} value={percent(result.accepterWinRate)} />
            <ResultStat label="avg rounds" value={result.averageRounds.toFixed(1)} />
            <ResultStat label="timeouts" value={percent(result.timeoutRate)} />
          </div>
          <div className="rounded-[3px] border border-edge bg-void/40 p-3">
            <div className="mb-3 text-[11px] uppercase tracking-wide text-faint">Round distribution</div>
            <div className="flex h-28 items-end gap-px" aria-label="Battle length distribution">
              {result.distribution.map((count, index) => <div key={index} className="min-w-0 flex-1 bg-element/70" title={`round ${index + 1}: ${count}`} style={{ height: `${Math.max(2, count / peak * 100)}%` }} />)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TuningField label="attack base" value={tuning.attackBase} step={0.1} min={0} max={5} onChange={(value) => setTuning((current) => ({ ...current, attackBase: value }))} />
            <TuningField label="variance" value={tuning.variance} step={0.01} min={0} max={1} onChange={(value) => setTuning((current) => ({ ...current, variance: value }))} />
            <TuningField label="HP / health" value={tuning.hpPerHealth} step={1} min={1} max={50} onChange={(value) => setTuning((current) => ({ ...current, hpPerHealth: value }))} />
            <TuningField label="shield / defense" value={tuning.shieldPerDefense} step={1} min={0} max={30} onChange={(value) => setTuning((current) => ({ ...current, shieldPerDefense: value }))} />
            <TuningField label="heal / point" value={tuning.healPerPoint} step={0.01} min={0} max={1} onChange={(value) => setTuning((current) => ({ ...current, healPerPoint: value }))} />
            <TuningField label="shield regen divisor" value={tuning.shieldRegen} step={1} min={1} max={100} onChange={(value) => setTuning((current) => ({ ...current, shieldRegen: value }))} />
            <TuningField label="move uses" value={tuning.moveUses} step={1} min={1} max={20} onChange={(value) => setTuning((current) => ({ ...current, moveUses: value }))} />
            <TuningField label="hit chance" value={tuning.baseHitChance} step={0.01} min={0.1} max={1} onChange={(value) => setTuning((current) => ({ ...current, baseHitChance: value }))} />
            <TuningField label="round cap" value={tuning.roundCap} step={1} min={5} max={100} onChange={(value) => setTuning((current) => ({ ...current, roundCap: value }))} />
          </div>
          <Button size="sm" onClick={() => setTuning(STUDIO_TUNING)}>Restore live defaults</Button>
        </div>
      </div>
    </Panel>
  );
}

function FighterEditor({ label, value, onChange }: { label: string; value: MonsterDraft; onChange: (value: MonsterDraft) => void }) {
  return <div className="rounded-[3px] border border-edge bg-void/35 p-3" data-element={value.element}><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-ink">{label}</span><Badge tone="element">{value.element}</Badge></div><div className="grid grid-cols-3 gap-2"><Field label="name"><input className={inputClass} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></Field><Field label="element"><select className={inputClass} value={value.element} onChange={(event) => onChange({ ...value, element: event.target.value as Element })}>{ELEMENTS.map((element) => <option key={element}>{element}</option>)}</select></Field><NumberField label="level" value={value.level} min={1} max={99} onChange={(next) => onChange({ ...value, level: next })} />{(['attack', 'defense', 'speed', 'health'] as const).map((key) => <NumberField key={key} label={key} value={value[key]} min={1} max={99} onChange={(next) => onChange({ ...value, [key]: next })} />)}</div></div>;
}

function CreateStudio({ status, jobs, loading, onReload }: { status: StudioStatus | null; jobs: StudioJob[]; loading: boolean; onReload: () => Promise<void> }) {
  const [form, setForm] = useState({ provider: 'pixellab' as 'pixellab' | 'retro-diffusion', kind: 'battle-background' as StudioKind, name: 'new-arena', prompt: 'pixel art fantasy arena, side view, clear combat floor, no characters, RuneRealm palette', width: 384, height: 216, transparent: false, seed: 7, guidance: 9 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const patch = (next: Partial<typeof form>) => setForm((current) => ({ ...current, ...next }));
  const generate = async () => {
    setBusy('generate'); setError(null);
    try { await postJson('/__studio/generate', form); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const decide = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id); setError(null);
    try { await postJson(`/__studio/${action}`, { id }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const pending = jobs.filter((job) => job.status === 'pending');
  const history = jobs.filter((job) => job.status !== 'pending');

  return <div className="space-y-4">
    <Panel className="p-5"><SectionTitle right={<div className="flex gap-2"><Badge tone="good">server-side keys</Badge><Badge tone="warn">paid generation</Badge></div>}>Create a staged asset</SectionTitle><p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">Every request creates a draft under <code className="text-ink">RuneRealm-Assets/_studio/pending</code>. Nothing enters the live asset set until you inspect and approve it.</p>
      {error !== null && <div className="mb-4"><ErrorNote error={error} /></div>}
      <div className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Provider"><select className={inputClass} value={form.provider} onChange={(event) => patch({ provider: event.target.value as typeof form.provider })}><option value="pixellab">PixelLab {status?.pixelLab ? '· ready' : '· key missing'}</option><option value="retro-diffusion">Retro Diffusion {status?.retroDiffusion ? '· ready' : '· key missing'}</option></select></Field><Field label="Asset type"><select className={inputClass} value={form.kind} onChange={(event) => patch(kindPreset(event.target.value as StudioKind))}>{KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
          <Field label="Filename"><input className={inputClass} value={form.name} onChange={(event) => patch({ name: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><NumberField label="width" value={form.width} min={16} max={2048} onChange={(value) => patch({ width: value })} /><NumberField label="height" value={form.height} min={16} max={2048} onChange={(value) => patch({ height: value })} /><NumberField label="seed" value={form.seed} min={0} max={2147483647} onChange={(value) => patch({ seed: value })} /><NumberField label="guidance" value={form.guidance} min={1} max={20} onChange={(value) => patch({ guidance: value })} /></div>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={form.transparent} onChange={(event) => patch({ transparent: event.target.checked })} /> transparent background</label>
        </div>
        <div className="space-y-3"><Field label="Prompt"><textarea className={cx(inputClass, 'min-h-36 resize-y leading-relaxed')} value={form.prompt} onChange={(event) => patch({ prompt: event.target.value })} /></Field><div className="flex flex-wrap gap-2">{PROMPTS.map((preset) => <Button key={preset.label} size="sm" variant="quiet" onClick={() => patch({ ...kindPreset(preset.kind), provider: preset.provider, name: preset.name, prompt: preset.prompt })}>{preset.label}</Button>)}</div><Button variant="primary" busy={busy === 'generate'} disabled={(form.provider === 'pixellab' && !status?.pixelLab) || (form.provider === 'retro-diffusion' && !status?.retroDiffusion)} onClick={() => void generate()}>Generate one draft</Button></div>
      </div>
    </Panel>
    <Panel className="p-5"><SectionTitle right={<Button size="sm" busy={loading} onClick={() => void onReload()}>Refresh queue</Button>}>Approval queue · {pending.length}</SectionTitle>{pending.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pending.map((job) => <JobCard key={job.id} job={job} busy={busy === job.id} onDecision={decide} />)}</div> : <Empty title="No drafts waiting">Generate an asset above. It will stay here until you approve or reject it.</Empty>}</Panel>
    {history.length > 0 && <Panel className="p-5"><SectionTitle>Recent decisions</SectionTitle><div className="grid gap-2 md:grid-cols-2">{history.slice(0, 20).map((job) => <div key={job.id} className="flex items-center gap-3 rounded-[3px] border border-edge bg-void/30 p-2"><img src={fileUrl(job.status === 'approved' && job.approvedPath ? job.approvedPath : job.stagedPath)} alt="" className="h-14 w-14 object-contain [image-rendering:pixelated]" /><div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{job.name}</div><div className="truncate font-mono text-[10px] text-faint">{job.approvedPath ?? job.stagedPath}</div></div><Badge tone={job.status === 'approved' ? 'good' : 'bad'}>{job.status}</Badge></div>)}</div></Panel>}
  </div>;
}

function JobCard({ job, busy, onDecision }: { job: StudioJob; busy: boolean; onDecision: (id: string, action: 'approve' | 'reject') => Promise<void> }) {
  return <div className="overflow-hidden rounded-[3px] border border-edge bg-void/40"><div className="grid aspect-video place-items-center overflow-hidden bg-raised/30"><img src={fileUrl(job.stagedPath)} alt={job.name} className="max-h-full max-w-full object-contain [image-rendering:pixelated]" /></div><div className="space-y-2 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-sm font-medium text-ink">{job.name}</div><div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{job.kind} · {job.width}×{job.height}</div></div><Badge>{job.provider}</Badge></div><p className="line-clamp-3 text-xs leading-relaxed text-muted">{job.prompt}</p><div className="flex gap-2"><Button size="sm" variant="primary" busy={busy} onClick={() => void onDecision(job.id, 'approve')}>Approve into set</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => void onDecision(job.id, 'reject')}>Reject</Button></div></div></div>;
}

const KIND_OPTIONS: Array<[StudioKind, string]> = [
  ['battle-background', 'Battle background'], ['room-background', 'Home / room'],
  ['side-scroller-sky', 'Side-scroller · sky'], ['side-scroller-far', 'Side-scroller · far'],
  ['side-scroller-mid', 'Side-scroller · middle'], ['side-scroller-ground', 'Side-scroller · ground'],
  ['creature-portrait', 'Animal / creature portrait'], ['creature-sheet', 'Animal animation sheet'],
  ['move-effect', 'Move effect / logo'], ['card-layer', 'Card background / layer'],
];

function kindPreset(kind: StudioKind) {
  const sizes: Record<StudioKind, { width: number; height: number; transparent: boolean }> = {
    'battle-background': { width: 384, height: 216, transparent: false },
    'room-background': { width: 384, height: 192, transparent: false },
    'side-scroller-sky': { width: 384, height: 216, transparent: true },
    'side-scroller-far': { width: 384, height: 216, transparent: true },
    'side-scroller-mid': { width: 384, height: 216, transparent: true },
    'side-scroller-ground': { width: 384, height: 216, transparent: true },
    'creature-portrait': { width: 320, height: 320, transparent: true },
    'creature-sheet': { width: 384, height: 384, transparent: true },
    'move-effect': { width: 128, height: 128, transparent: true },
    'card-layer': { width: 648, height: 1065, transparent: false },
  };
  return { kind, ...sizes[kind] };
}

const PROMPTS: Array<{ label: string; provider: 'pixellab' | 'retro-diffusion'; kind: StudioKind; name: string; prompt: string }> = [
  { label: 'Battle arena', provider: 'retro-diffusion', kind: 'battle-background', name: 'moon-temple', prompt: 'native-resolution pixel art fantasy battle arena, side view, open readable combat floor, moonlit ruined temple, layered depth, no characters, no text, RuneRealm palette' },
  { label: 'Home room', provider: 'retro-diffusion', kind: 'room-background', name: 'keeper-study', prompt: 'native-resolution pixel art fantasy companion home interior, side view, cozy keeper study, readable floor and furniture silhouettes, no characters, no text' },
  { label: 'Path layer', provider: 'pixellab', kind: 'side-scroller-far', name: 'crystal-pass', prompt: 'seamless horizontal pixel art parallax far layer, crystal mountain pass silhouettes, transparent background, no characters, no text' },
  { label: 'Animal sheet', provider: 'pixellab', kind: 'creature-sheet', name: 'ember-fox', prompt: 'pixel art ember fox game sprite sheet on transparent background, consistent character proportions, idle walk attack and hurt poses, evenly spaced grid, south-facing base pose, no text' },
  { label: 'Move effect', provider: 'pixellab', kind: 'move-effect', name: 'rune-burst', prompt: 'pixel art magical rune burst combat effect and readable emblem, centered, transparent background, limited palette, no letters, no border' },
  { label: 'Card layer', provider: 'retro-diffusion', kind: 'card-layer', name: 'obsidian-card', prompt: 'vertical pixel art collectible monster card background, obsidian shrine motif, empty portrait window and clean stat zones, ornate but readable, no characters, no text' },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block truncate text-[10px] uppercase tracking-wide text-faint">{label}</span>{children}</label>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <Field label={label}><input type="number" className={inputClass} value={value} min={min} max={max} onChange={(event) => { const number = Number(event.target.value); if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number))); }} /></Field>;
}

function TuningField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <Field label={label}><input type="number" className={inputClass} value={value} min={min} max={max} step={step} onChange={(event) => { const number = Number(event.target.value); if (Number.isFinite(number)) onChange(number); }} /></Field>;
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[3px] border border-edge bg-void/40 p-3"><div className="truncate text-[10px] uppercase tracking-wide text-faint">{label}</div><div className="mt-1 font-mono text-xl text-ink">{value}</div></div>;
}
