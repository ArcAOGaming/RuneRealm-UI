import { ReactNode, useEffect, useMemo, useState } from 'react';
import { cardBlob } from '../../lib/card/browser';
import {
  advanceStudioBattle, createStudioBattle, simulateMatchup,
  STUDIO_TUNING, StudioTuning,
} from '../../lib/studio-battle';
import { Element, ItemId, Monster, Move } from '../../lib/types';
import { BattleStage } from '../../ui/BattleStage';
import { CardPreview } from '../../ui/CardPreview';
import CompanionAcquisition, { AcquisitionKind } from '../../ui/CompanionAcquisition';
import { Badge, Button, Empty, ErrorNote, Panel, SectionTitle, cx } from '../../ui/primitives';

type StudioMode = 'visualize' | 'create';
type AssetCategory = 'all' | 'background' | 'creature' | 'card' | 'move' | 'item' | 'ui' | 'legacy';
type AssetRow = {
  id: string; path: string; name: string; extension: string; bytes: number;
  source: string; folder: string; family: string;
  category: Exclude<AssetCategory, 'all'>; url: string;
};
type StudioMove = Move & { name: string; pool: string };
type StudioStatus = { localOnly: boolean; pixelLab: boolean; retroDiffusion: boolean };
type StudioKind =
  | 'battle-background' | 'room-background'
  | 'side-scroller-sky' | 'side-scroller-far' | 'side-scroller-mid' | 'side-scroller-ground'
  | 'creature-portrait' | 'creature-sheet' | 'creature-animation'
  | 'move-effect' | 'card-background' | 'card-layer';
type StudioJob = {
  id: string; status: 'pending' | 'approved' | 'rejected';
  provider: 'pixellab' | 'retro-diffusion'; kind: StudioKind;
  name: string; prompt: string; width: number; height: number;
  transparent: boolean; seed: number; createdAt: string;
  stagedPath: string; sourcePath?: string; motionSourcePath?: string;
  rotationPaths?: Record<string, string>;
  framePaths?: string[]; rawFramePaths?: string[];
  approvedPath?: string; approvedSourcePath?: string; approvedRotationPaths?: Record<string, string>; approvedFramePaths?: string[];
  theme?: string; action?: string; motionKey?: string; sourceJobId?: string;
  templateSlots?: Record<string, string>; redoOf?: string;
  revision?: number; sourceWidth?: number; sourceHeight?: number;
  providerMeta?: Record<string, unknown>;
};

const inputClass = cx(
  'w-full rounded-[3px] border border-edge bg-raised px-2.5 py-2 text-sm text-ink',
  'focus:border-element/60 focus:outline-none',
);
const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const CATEGORIES: AssetCategory[] = ['all', 'background', 'creature', 'card', 'move', 'item', 'ui', 'legacy'];
const INVENTORY: ItemId[] = [
  'rune', 'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'scroll',
];
const FACTION: Record<Element, string> = {
  fire: 'Inferno Blades', water: 'Aqua Guardians', air: 'Sky Nomads', rock: 'Stone Titans',
};
const COMPANION: Record<Element, string> = {
  fire: 'FireFox', water: 'WaterDoge', air: 'Airbud', rock: 'Rockpup',
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

type MotionDraft = {
  sourceJobId: string;
  name: string;
  action: string;
  motionKey: string;
  frameCount: number;
  seed: number;
};

const TEMPLATE_MOTIONS = [
  {
    key: 'walk-right', label: 'Walk right', direction: 'east', row: 1, seedOffset: 11,
    action: 'Four-frame seamless quadruped walking cycle in the supplied east-facing pose; alternate paws clearly, subtle body bob, tail counter-sway, and return exactly to the first pose; preserve the supplied facing, silhouette, markings, palette, scale, and fixed camera; no turn toward the viewer, scenery, or new props',
  },
  {
    key: 'walk-left', label: 'Walk left', direction: 'west', row: 2, seedOffset: 12,
    action: 'Four-frame seamless quadruped walking cycle in the supplied west-facing pose; alternate paws clearly, subtle body bob, tail counter-sway, and return exactly to the first pose; preserve the supplied facing, silhouette, markings, palette, scale, and fixed camera; no turn toward the viewer, scenery, or new props',
  },
  {
    key: 'walk-up', label: 'Walk up', direction: 'north', row: 3, seedOffset: 13,
    action: 'Four-frame seamless quadruped walking cycle in the supplied north-facing back pose; alternate paws clearly, ears and tail remain identifiable, and return exactly to the first pose; preserve the supplied back-facing silhouette, markings, palette, scale, and fixed camera; no turn toward the viewer, scenery, or new props',
  },
  {
    key: 'walk-down', label: 'Walk down', direction: 'south', row: 4, seedOffset: 14,
    action: 'Four-frame seamless quadruped walking cycle in the supplied south-facing front pose; alternate paws clearly, subtle body bob, and return exactly to the first pose; preserve the supplied front-facing silhouette, markings, palette, scale, and fixed camera; no sideways turn, scenery, or new props',
  },
  {
    key: 'attack-basic', label: 'Basic attack', direction: 'east', row: 5, seedOffset: 15,
    action: 'Four-frame basic attack in the supplied east-facing pose: brace, make one quick readable paw swipe and short forward lunge, then recover exactly to the first pose; preserve the supplied facing, silhouette, markings, palette, scale, and fixed camera; no scenery, projectile, impact text, or new props',
  },
  {
    key: 'attack-advanced', label: 'Advanced attack', direction: 'east', row: 6, seedOffset: 16,
    action: 'Four-frame advanced signature attack in the supplied east-facing pose: brace, gather one compact theme-colored current close to the body, release one readable forward burst, then recover exactly to the first pose; preserve the supplied facing, silhouette, markings, palette, scale, and fixed camera; no scenery, text, camera shake, or new props',
  },
] as const;

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
  const art = { fire: 'Fire', water: 'Water', air: 'Air', rock: 'Earth' }[draft.element];
  return {
    // A studio preview is never a companion the process issued.
    id: 'studio-draft',
    name: draft.name || 'Unnamed', image: draft.element, sprite: SPRITE[draft.element],
    holographic: true, background: art, border: art,
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

const fileUrl = (path: string, version?: unknown) => `/__studio/file?path=${encodeURIComponent(path)}${version ? `&v=${encodeURIComponent(String(version))}` : ''}`;
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
    return <CreateStudio status={status} jobs={jobs} moves={moves} loading={loading} onReload={reload} />;
  }
  return (
    <div className="space-y-4">
      <StudioIntro assets={assets} moves={moves} jobs={jobs} status={status} />
      <AssetLibrary assets={assets} loading={loading} onReload={reload} />
      <CardLab moves={moves} jobs={jobs} />
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

function AssetLibrary({ assets, loading, onReload }: {
  assets: AssetRow[]; loading: boolean; onReload: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory>('all');
  const [folder, setFolder] = useState('RuneRealm-Assets');
  const [limit, setLimit] = useState(96);
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const categoryCounts = useMemo(() => Object.fromEntries(CATEGORIES.map((value) => [
    value, value === 'all' ? assets.length : assets.filter((asset) => asset.category === value).length,
  ])), [assets]);
  const eligible = useMemo(() => assets.filter((asset) => {
    const needle = query.trim().toLowerCase();
    return (category === 'all' || asset.category === category)
      && (!needle || asset.path.toLowerCase().includes(needle));
  }), [assets, category, query]);
  const underFolder = (asset: AssetRow, value: string) => (
    asset.folder === value || asset.folder.startsWith(`${value}/`)
  );
  const childFolders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of eligible) {
      if (!underFolder(asset, folder) || asset.folder === folder) continue;
      const remainder = asset.folder.slice(folder.length + 1);
      const child = `${folder}/${remainder.split('/')[0]}`;
      counts.set(child, (counts.get(child) ?? 0) + 1);
    }
    return [...counts.entries()].map(([path, count]) => ({
      path, count, name: path.slice(path.lastIndexOf('/') + 1),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, folder]);
  const rows = useMemo(() => {
    const searching = Boolean(query.trim());
    return eligible.filter((asset) => searching ? underFolder(asset, folder) : asset.folder === folder);
  }, [eligible, folder, query]);
  const folderTotal = useMemo(() => (
    assets.filter((asset) => underFolder(asset, folder)).length
  ), [assets, folder]);
  const breadcrumb = useMemo(() => folder.split('/').map((name, index, parts) => ({
    name, path: parts.slice(0, index + 1).join('/'),
  })), [folder]);

  const openFolder = (path: string) => {
    setFolder(path);
    setSelected(null);
  };

  useEffect(() => { setLimit(96); }, [query, category, folder]);
  useEffect(() => {
    if (selected && !eligible.some((asset) => asset.id === selected.id && underFolder(asset, folder))) {
      setSelected(null);
    }
  }, [eligible, folder, selected]);
  useEffect(() => {
    if (folder !== 'RuneRealm-Assets' && !assets.some((asset) => underFolder(asset, folder))) {
      setFolder('RuneRealm-Assets');
      setSelected(null);
    }
  }, [assets, folder]);

  return (
    <Panel className="p-5">
      <SectionTitle right={<div className="flex items-center gap-2"><span className="font-mono text-[11px] text-faint">{folderTotal} in folder · {assets.length} total</span><Button size="sm" busy={loading} onClick={() => void onReload()}>Refresh files</Button></div>}>Asset folders</SectionTitle>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Browse the exact on-disk structure under <code className="mx-1 text-ink">RuneRealm-Assets</code>.
        Folder counts include their descendants; a search looks through the open folder and everything below it.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CATEGORIES.map((value) => <button key={value} type="button" onClick={() => setCategory(value)}>
          <Badge tone={category === value ? 'element' : 'plain'}>{value} · {categoryCounts[value]}</Badge>
        </button>)}
      </div>
      <Field label="Search this folder">
        <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames and nested folders…" />
      </Field>
      <div className="mt-3 flex min-h-9 flex-wrap items-center gap-1.5 rounded-[3px] border border-edge bg-void/45 px-2 py-1.5" aria-label="Current asset folder">
        {breadcrumb.map((part, index) => <span key={part.path} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-faint">/</span>}
          <button type="button" onClick={() => openFolder(part.path)} className={cx('rounded px-1.5 py-1 font-mono text-[11px] transition-colors hover:bg-raised hover:text-ink', index === breadcrumb.length - 1 ? 'text-element' : 'text-muted')}>{part.name}</button>
        </span>)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {childFolders.length > 0 && <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Folders · {childFolders.length}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-6">
              {childFolders.map((child) => <button key={child.path} type="button" onClick={() => openFolder(child.path)}
                className="min-w-0 rounded-[3px] border border-edge bg-void/50 p-3 text-left transition-colors hover:border-element/50 hover:bg-raised/60">
                <div className="flex items-center justify-between gap-2">
                  <span aria-hidden="true" className="text-lg leading-none text-element">▰</span>
                  <span className="font-mono text-[10px] text-faint">{child.count}</span>
                </div>
                <div className="mt-2 truncate text-xs font-medium text-ink" title={child.path}>{child.name}</div>
                <div className="mt-1 truncate font-mono text-[9px] text-faint">{child.path.replace('RuneRealm-Assets/', '')}</div>
              </button>)}
            </div>
          </div>}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
              <span>{query.trim() ? 'Matching files in this folder tree' : 'Files in this folder'} · {rows.length}</span>
              {query && <button type="button" className="normal-case tracking-normal text-element hover:text-ink" onClick={() => setQuery('')}>Clear search</button>}
            </div>
            {rows.length > 0 ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 2xl:grid-cols-8">
              {rows.slice(0, limit).map((asset) => (
                <button key={asset.id} type="button" onClick={() => setSelected(asset)}
                  className={cx('group min-w-0 overflow-hidden rounded-[3px] border bg-void/50 text-left transition-colors', selected?.id === asset.id ? 'border-element' : 'border-edge hover:border-element/50')}>
                  <div className="grid aspect-square place-items-center overflow-hidden bg-[linear-gradient(45deg,#18151d_25%,transparent_25%),linear-gradient(-45deg,#18151d_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18151d_75%),linear-gradient(-45deg,transparent_75%,#18151d_75%)] bg-[length:16px_16px]">
                    <img src={asset.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain [image-rendering:pixelated]" />
                  </div>
                  <div className="px-2 py-1.5" title={asset.path}>
                    <div className="truncate text-[10px] text-muted">{asset.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[9px] text-faint">{asset.folder.replace('RuneRealm-Assets/', '')}</div>
                  </div>
                </button>
              ))}
            </div> : <Empty title="No files here">{childFolders.length ? 'Open a folder to see its files.' : 'No assets match this folder and filter.'}</Empty>}
            {limit < rows.length && <div className="mt-4 text-center"><Button size="sm" onClick={() => setLimit((value) => value + 96)}>Load 96 more</Button></div>}
          </div>
        </div>
        <div>
          {selected ? (
            <div className="sticky top-4 rounded-[3px] border border-edge bg-void/45 p-3">
              <div className="grid min-h-48 place-items-center overflow-hidden bg-raised/30">
                <img src={selected.url} alt={selected.name} className="max-h-80 max-w-full object-contain [image-rendering:pixelated]" />
              </div>
              <div className="mt-3 break-all text-xs font-medium text-ink">{selected.name}</div>
              <div className="mt-1 break-all font-mono text-[10px] leading-relaxed text-faint">{selected.path}</div>
              <div className="mt-2 flex flex-wrap gap-1"><Badge>{selected.category}</Badge><Badge>{selected.extension}</Badge><Badge>{Math.ceil(selected.bytes / 1024)} KB</Badge><Badge>{selected.folder.replace('RuneRealm-Assets/', '')}</Badge></div>
            </div>
          ) : <Empty title="Choose an asset">Select any thumbnail for its full preview and exact repository path.</Empty>}
        </div>
      </div>
    </Panel>
  );
}

function CardLab({ moves, jobs }: { moves: StudioMove[]; jobs: StudioJob[] }) {
  const [draft, setDraft] = useState(DEFAULT_CARD);
  const [selectedMoves, setSelectedMoves] = useState<string[]>([]);
  const [extended, setExtended] = useState(true);
  const [inventory, setInventory] = useState<Partial<Record<ItemId, number>>>({ rune: 42, fire_berry: 6, scroll: 1 });
  const [downloading, setDownloading] = useState(false);
  const [backgroundId, setBackgroundId] = useState('');
  const [portraitId, setPortraitId] = useState('');
  const [acquisitionKind, setAcquisitionKind] = useState<AcquisitionKind>('adoption');
  const [revealing, setRevealing] = useState(false);
  const monster = useMemo(() => monsterFrom(draft, selectedMoves, moves), [draft, selectedMoves, moves]);
  const backgrounds = jobs.filter((job) => job.kind === 'card-background' && job.status !== 'rejected');
  const portraits = jobs.filter((job) => job.kind === 'creature-portrait' && job.status !== 'rejected');
  const background = backgrounds.find((job) => job.id === backgroundId);
  const portrait = portraits.find((job) => job.id === portraitId);
  const backgroundPath = background && (background.approvedPath ?? background.stagedPath);
  const portraitPath = portrait && (
    portrait.status === 'approved' && typeof portrait.providerMeta?.approvedCardPreviewPath === 'string'
      ? portrait.providerMeta.approvedCardPreviewPath
      : typeof portrait.providerMeta?.cardPreviewPath === 'string'
        ? portrait.providerMeta.cardPreviewPath
        : portrait.approvedPath ?? portrait.stagedPath
  );
  const authoring = {
    backgroundAsset: backgroundPath,
    portraitAsset: portraitPath,
    assetUrls: Object.fromEntries([
      backgroundPath && [backgroundPath, fileUrl(backgroundPath, background?.providerMeta?.locallyReprocessedAt ?? background?.createdAt)],
      portraitPath && [portraitPath, fileUrl(portraitPath, portrait?.providerMeta?.locallyReprocessedAt ?? portrait?.createdAt)],
    ].filter(Boolean) as Array<[string, string]>),
  };
  const performancePortraitUrl = portraitPath ? authoring.assetUrls[portraitPath] : undefined;
  const patch = <K extends keyof MonsterDraft>(key: K, value: MonsterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const download = async () => {
    setDownloading(true);
    try {
      const blob = await cardBlob(monster, { extended, inventory, moveUses: 3, ...authoring });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${monster.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'card'}.png`;
      anchor.click(); URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  return (
    <>
    <Panel className="p-5" data-element={draft.element}>
      <SectionTitle right={<Badge tone="element">production renderer</Badge>}>Card laboratory</SectionTitle>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_1fr]">
        <div className="mx-auto w-full max-w-[440px]"><CardPreview monster={monster} inventory={inventory} extended={extended} authoring={authoring} eager /></div>
        <div className="space-y-4">
          <div className="rounded-[3px] border border-edge bg-void/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-3"><span className="text-[11px] uppercase tracking-wide text-faint">Independent art layers</span><Badge tone="element">background · portrait · frame</Badge></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Card background · ${backgrounds.length} drafts`}><select className={inputClass} value={backgroundId} onChange={(event) => setBackgroundId(event.target.value)}><option value="">element default</option>{backgrounds.map((job) => <option key={job.id} value={job.id}>{job.name} · {job.theme ?? 'untyped'} · {job.provider} · {job.status}</option>)}</select></Field>
              <Field label={`Monster portrait · ${portraits.length} drafts`}><select className={inputClass} value={portraitId} onChange={(event) => setPortraitId(event.target.value)}><option value="">released doge</option>{portraits.map((job) => <option key={job.id} value={job.id}>{job.name} · {job.theme ?? 'untyped'} · {job.provider} · {job.status}</option>)}</select></Field>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">Element still controls the frame, type badge, level coin, and move styling. Scenery and creature art can now be reviewed independently.</p>
          </div>
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
          <div className="rounded-[3px] border border-element/35 bg-element/[.055] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="eyebrow text-element">Acquisition sequence builder</div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                  Run the complete entrance, advanced strike, layer tornado and 3D-card reveal
                  against this draft. Stats, moves and staged card art above flow straight into it.
                </p>
              </div>
              <Badge tone="element">real animation assets</Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Companion bloodline">
                <select
                  className={inputClass}
                  value={draft.element}
                  onChange={(event) => {
                    const element = event.target.value as Element;
                    setDraft((current) => ({ ...current, element, name: COMPANION[element] }));
                  }}
                >
                  {ELEMENTS.map((element) => (
                    <option key={element} value={element}>{COMPANION[element]} · {element}</option>
                  ))}
                </select>
              </Field>
              <Field label="Acquisition event">
                <select
                  className={inputClass}
                  value={acquisitionKind}
                  onChange={(event) => setAcquisitionKind(event.target.value as AcquisitionKind)}
                >
                  <option value="adoption">Faction adoption</option>
                  <option value="capture">Monster capture</option>
                </select>
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge>LV {monster.level}</Badge>
              <Badge>ATK {monster.attack}</Badge>
              <Badge>DEF {monster.defense}</Badge>
              <Badge>SPD {monster.speed}</Badge>
              <Badge>HP {monster.health}</Badge>
              {backgroundPath && <Badge tone="element">draft background</Badge>}
              {portraitPath && <Badge tone="element">draft portrait</Badge>}
            </div>
            <Button
              className="mt-4"
              variant="primary"
              size="lg"
              onClick={() => setRevealing(true)}
            >
              Run full animation
            </Button>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" busy={downloading} onClick={() => void download()}>Download preview PNG</Button><Button onClick={() => { setDraft(DEFAULT_CARD); setSelectedMoves([]); setBackgroundId(''); setPortraitId(''); }}>Reset card</Button></div>
          <p className="text-xs leading-relaxed text-faint">This is the same shared layout used by the mint worker, so the card you tune here matches the permanent card composition.</p>
        </div>
      </div>
    </Panel>
    {revealing && (
      <CompanionAcquisition
        monster={monster}
        kind={acquisitionKind}
        cardOptions={authoring}
        performancePortraitUrl={performancePortraitUrl}
        onComplete={() => setRevealing(false)}
      />
    )}
    </>
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
            <TuningField label="shield regen (share, untouched rounds)" value={tuning.shieldRegenShare} step={0.05} min={0} max={1} onChange={(value) => setTuning((current) => ({ ...current, shieldRegenShare: value }))} />
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

function CreateStudio({ status, jobs, moves, loading, onReload }: {
  status: StudioStatus | null; jobs: StudioJob[]; moves: StudioMove[];
  loading: boolean; onReload: () => Promise<void>;
}) {
  const [form, setForm] = useState({ provider: 'retro-diffusion' as 'pixellab' | 'retro-diffusion', kind: 'card-background' as StudioKind, name: 'light-observatory-rd', theme: 'light', prompt: CARD_BACKGROUND_PROMPT, width: 216, height: 355, transparent: false, seed: 1101, guidance: 9, variations: 1, redoOf: '', revision: 1 });
  const [rig, setRig] = useState({
    name: 'lumen-lynx-rig-96', theme: 'light', prompt: LUMEN_RIG_PROMPT,
    nativeSize: 96, seed: 3111, templateId: 'dog',
  });
  const [retroCharacter, setRetroCharacter] = useState({
    name: 'lumen-lynx-rd-battle-64', theme: 'light',
    prompt: RETRO_LUMEN_BATTLE_PROMPT, seed: 4111,
  });
  const [retroRotation, setRetroRotation] = useState({ sourceJobId: '', seed: 5211 });
  const [retroMotion, setRetroMotion] = useState<MotionDraft>({
    sourceJobId: '', name: '', action: TEMPLATE_MOTIONS[0].action,
    motionKey: TEMPLATE_MOTIONS[0].key, frameCount: 8, seed: 5311,
  });
  const [motion, setMotion] = useState<MotionDraft>({
    sourceJobId: '', name: '', action: TEMPLATE_MOTIONS[0].action,
    motionKey: TEMPLATE_MOTIONS[0].key, frameCount: 4, seed: 7,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const patch = (next: Partial<typeof form>) => setForm((current) => ({ ...current, ...next }));
  const generate = async () => {
    setBusy('generate'); setError(null);
    try {
      for (let index = 0; index < form.variations; index++) {
        await postJson('/__studio/generate', {
          ...form,
          name: form.variations > 1 ? `${form.name}-${index + 1}` : form.name,
          seed: form.seed + index,
        });
      }
      await onReload();
    }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const animate = async (recoverOnly = false) => {
    setBusy(recoverOnly ? 'recover-animation' : 'animate'); setError(null);
    try { await postJson('/__studio/animate', { ...motion, recoverOnly }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const createRig = async () => {
    setBusy('create-rig'); setError(null);
    try { await postJson('/__studio/create-rig', rig); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const createRetroCharacter = async () => {
    setBusy('create-retro-character'); setError(null);
    try { await postJson('/__studio/create-retro-character', retroCharacter); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const createRetroAnchor = async () => {
    setBusy('create-retro-anchor'); setError(null);
    try { await postJson('/__studio/create-retro-anchor', retroCharacter); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const createRetroRotation = async () => {
    setBusy('create-retro-rotation'); setError(null);
    try { await postJson('/__studio/create-retro-rotation', retroRotation); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const createRetroMotion = async () => {
    setBusy('create-retro-motion'); setError(null);
    try { await postJson('/__studio/create-retro-motion', retroMotion); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const revise = (job: StudioJob) => {
    patch({
      provider: job.provider, kind: job.kind, name: job.name, theme: job.theme ?? '',
      prompt: job.prompt, width: job.sourceWidth ?? job.width,
      height: job.sourceHeight ?? job.height, transparent: job.transparent,
      seed: job.seed + 1, variations: 1, redoOf: job.id, revision: (job.revision ?? 1) + 1,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reviseRig = (job: StudioJob) => {
    setRig({
      name: job.name,
      theme: job.theme ?? 'light',
      prompt: job.prompt,
      nativeSize: Number(job.providerMeta?.nativeSpriteSize) || 96,
      seed: job.seed + 1,
      templateId: String(job.providerMeta?.templateId ?? 'dog'),
    });
    document.getElementById('directional-rig')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const reviseRetroCharacter = (job: StudioJob) => {
    setRetroCharacter({
      name: job.name,
      theme: job.theme ?? 'light',
      prompt: job.prompt,
      seed: job.seed + 1,
    });
    document.getElementById('retro-character')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const decide = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id); setError(null);
    try { await postJson(`/__studio/${action}`, { id }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const reprocess = async (id: string) => {
    setBusy(id); setError(null);
    try { await postJson('/__studio/reprocess', { id }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const reprocessRetroRotation = async (id: string) => {
    setBusy(id); setError(null);
    try { await postJson('/__studio/reprocess-retro-rotation', { id }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const reprocessRetroAnchor = async (id: string) => {
    setBusy(id); setError(null);
    try { await postJson('/__studio/reprocess-retro-anchor', { id }); await onReload(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const pending = jobs.filter((job) => job.status === 'pending');
  const history = jobs.filter((job) => job.status !== 'pending');
  const portraits = jobs.filter((job) => job.kind === 'creature-portrait' && job.status !== 'rejected');
  const retroAnchors = portraits.filter((job) => job.providerMeta?.retroNativeAnchor === true);
  const retroRiggedAnchors = retroAnchors.filter((job) => job.rotationPaths && Object.keys(job.rotationPaths).length >= 4);
  const riggedPortraits = portraits.filter((job) => (
    job.providerMeta?.managedDirectionalRig === true
    && job.rotationPaths && Object.keys(job.rotationPaths).length >= 4
  ));
  const selectedPortrait = riggedPortraits.find((job) => job.id === motion.sourceJobId);
  const slotJobs = Object.fromEntries(TEMPLATE_MOTIONS.map((slot) => [slot.key, jobs.find((job) => (
    job.kind === 'creature-animation' && job.status !== 'rejected'
    && job.sourceJobId === motion.sourceJobId && job.motionKey === slot.key
  ))])) as Record<string, StudioJob | undefined>;
  const readySlots = TEMPLATE_MOTIONS.filter((slot) => slotJobs[slot.key]).length;
  const selectMotionSlot = (source: StudioJob, slot: (typeof TEMPLATE_MOTIONS)[number]) => {
    const existing = jobs.find((job) => (
      job.kind === 'creature-animation' && job.status !== 'rejected'
      && job.sourceJobId === source.id && job.motionKey === slot.key
    ));
    setMotion({
      sourceJobId: source.id,
      name: existing?.name ?? `${source.name}-${slot.key}`,
      action: existing?.action ?? slot.action,
      motionKey: slot.key,
      frameCount: 4,
      seed: existing ? existing.seed + 1 : source.seed + slot.seedOffset,
    });
  };
  const selectPortrait = (source: StudioJob | undefined) => {
    if (!source) {
      setMotion((current) => ({ ...current, sourceJobId: '', name: '' }));
      return;
    }
    const firstMissing = TEMPLATE_MOTIONS.find((slot) => !jobs.some((job) => (
      job.kind === 'creature-animation' && job.status !== 'rejected'
      && job.sourceJobId === source.id && job.motionKey === slot.key
    ))) ?? TEMPLATE_MOTIONS[0];
    selectMotionSlot(source, firstMissing);
  };
  const buildTemplate = async () => {
    if (!selectedPortrait) return;
    setBusy('build-template'); setError(null);
    try {
      await postJson('/__studio/build-template', {
        sourceJobId: selectedPortrait.id,
        name: `${selectedPortrait.name}-animation-template`,
      });
      await onReload();
    } catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const redoMotion = (animation: StudioJob) => setMotion({
    sourceJobId: animation.sourceJobId ?? '', name: animation.name,
    action: animation.action ?? animation.prompt,
    motionKey: animation.motionKey ?? 'extra',
    frameCount: animation.framePaths?.length ?? 8, seed: animation.seed + 1,
  });

  return <div className="space-y-4">
    <PipelineBoard jobs={jobs} />
    <Panel className="p-5">
      <SectionTitle right={<div className="flex gap-2"><Badge tone="good">server-side keys</Badge><Badge tone="warn">paid generation</Badge></div>}>1 · Create a staged still</SectionTitle>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">Every request creates a recoverable draft under <code className="text-ink">RuneRealm-Assets/_studio/pending</code>. Card backgrounds are generated at 216×355 and enlarged exactly 3× with nearest-neighbor pixels; creature sources remain available for motion generation.</p>
      {error !== null && <div className="mb-4"><ErrorNote error={error} /></div>}
      <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Provider"><select className={inputClass} value={form.provider} onChange={(event) => { const provider = event.target.value as typeof form.provider; patch({ provider, ...(form.kind === 'card-background' ? { width: 216, height: provider === 'pixellab' ? 356 : 355 } : {}) }); }}><option value="pixellab">PixelLab {status?.pixelLab ? '· ready' : '· key missing'}</option><option value="retro-diffusion">Retro Diffusion {status?.retroDiffusion ? '· ready' : '· key missing'}</option></select></Field><Field label="Asset type"><select className={inputClass} value={form.kind} onChange={(event) => { const kind = event.target.value as StudioKind; patch({ ...kindPreset(kind), ...(kind === 'card-background' && form.provider === 'pixellab' ? { height: 356 } : {}), redoOf: '', revision: 1 }); }}>{KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Filename"><input className={inputClass} value={form.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="Theme / family"><input className={inputClass} value={form.theme} onChange={(event) => patch({ theme: event.target.value })} placeholder="light, dark, fire…" /></Field></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><NumberField label="source width" value={form.width} min={16} max={400} onChange={(value) => patch({ width: value })} /><NumberField label="source height" value={form.height} min={16} max={400} onChange={(value) => patch({ height: value })} /><NumberField label="seed" value={form.seed} min={0} max={2147483647} onChange={(value) => patch({ seed: value })} /><NumberField label="guidance" value={form.guidance} min={1} max={20} onChange={(value) => patch({ guidance: value })} /><NumberField label="variations" value={form.variations} min={1} max={4} onChange={(value) => patch({ variations: value })} /></div>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={form.transparent} onChange={(event) => patch({ transparent: event.target.checked })} /> transparent background</label>
          {form.redoOf && <div className="rounded-[3px] border border-element/30 bg-element/[.05] px-3 py-2 text-xs text-muted">Revision {form.revision} of <span className="font-mono text-ink">{form.redoOf.slice(-18)}</span>; change one prompt detail or seed, then generate.</div>}
        </div>
        <div className="space-y-3"><Field label="Prompt"><textarea className={cx(inputClass, 'min-h-36 resize-y leading-relaxed')} value={form.prompt} onChange={(event) => patch({ prompt: event.target.value })} /></Field><div className="flex flex-wrap gap-2">{PROMPTS.map((preset) => <Button key={preset.label} size="sm" variant="quiet" onClick={() => patch({ ...kindPreset(preset.kind), ...(preset.kind === 'card-background' && preset.provider === 'pixellab' ? { height: 356 } : {}), provider: preset.provider, name: preset.name, theme: preset.theme, prompt: preset.prompt, seed: preset.seed, guidance: preset.guidance ?? 9, variations: 1, redoOf: '', revision: 1 })}>{preset.label}</Button>)}</div><Button variant="primary" busy={busy === 'generate'} disabled={(form.provider === 'pixellab' && !status?.pixelLab) || (form.provider === 'retro-diffusion' && !status?.retroDiffusion)} onClick={() => void generate()}>Generate {form.variations === 1 ? 'draft' : `${form.variations} drafts`}</Button></div>
      </div>
    </Panel>
    <Panel id="retro-character" className="p-5">
      <SectionTitle right={<div className="flex flex-wrap gap-2"><Badge tone={status?.retroDiffusion ? 'good' : 'warn'}>RetroDiffusion battle sprites</Badge><Badge tone="element">true 64px cells</Badge><Badge tone="plain">4 directions · 56 frames</Badge><Badge tone="warn">about $0.07</Badge></div>}>2 · Create a complete RetroDiffusion monster</SectionTitle>
      <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">This is now the recommended character test. One native-resolution request creates four directional rows with 3-frame idle, 6-frame walk, 2-frame jump, and 3-frame attack sequences. The untouched 64×64 anchor and full sheet are staged together for review.</p>
      <div className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Character name"><input className={inputClass} value={retroCharacter.name} onChange={(event) => setRetroCharacter((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Theme / family"><input className={inputClass} value={retroCharacter.theme} onChange={(event) => setRetroCharacter((current) => ({ ...current, theme: event.target.value }))} /></Field></div>
          <NumberField label="seed" value={retroCharacter.seed} min={0} max={2147483647} onChange={(value) => setRetroCharacter((current) => ({ ...current, seed: value }))} />
          <div className="rounded-[3px] border border-element/25 bg-element/[.045] p-3 text-xs leading-relaxed text-muted"><span className="font-medium text-ink">Native-size gate:</span> the provider receives 64×64 and returns an unscaled PNG sheet. No portrait upscaling, PixelLab skeleton, or local frame interpolation is involved.</div>
        </div>
        <div className="space-y-3">
          <Field label="Character identity prompt"><textarea className={cx(inputClass, 'min-h-40 resize-y leading-relaxed')} value={retroCharacter.prompt} onChange={(event) => setRetroCharacter((current) => ({ ...current, prompt: event.target.value }))} /></Field>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="quiet" onClick={() => setRetroCharacter({ name: 'lumen-lynx-rd-battle-64', theme: 'light', prompt: RETRO_LUMEN_BATTLE_PROMPT, seed: 4111 })}>Light · Lumen Lynx</Button><Button size="sm" variant="quiet" onClick={() => setRetroCharacter({ name: 'umbra-marten-rd-battle-64', theme: 'dark', prompt: RETRO_UMBRA_BATTLE_PROMPT, seed: 4211 })}>Dark · Umbra Marten</Button></div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" busy={busy === 'create-retro-anchor'} disabled={!status?.retroDiffusion || !retroCharacter.name.trim() || retroCharacter.prompt.trim().length < 20} onClick={() => void createRetroAnchor()}>Generate 64px RD Pro anchor · $0.18</Button><Button variant="quiet" busy={busy === 'create-retro-character'} disabled={!status?.retroDiffusion || !retroCharacter.name.trim() || retroCharacter.prompt.trim().length < 20} onClick={() => void createRetroCharacter()}>Test fixed battle sheet · $0.07</Button></div>
          <p className="text-[11px] leading-relaxed text-faint">Use the RD Pro anchor gate first for animal anatomy. The fixed battle-sheet route is cheaper and directionally complete, but current tests show it strongly favors upright humanoid characters.</p>
          <div className="grid gap-2 rounded-[3px] border border-edge bg-void/35 p-3 sm:grid-cols-[1fr_130px_auto] sm:items-end"><Field label="RD Pro anchor for rotation"><select className={inputClass} value={retroRotation.sourceJobId} onChange={(event) => setRetroRotation((current) => ({ ...current, sourceJobId: event.target.value }))}><option value="">choose a 64px anchor</option>{retroAnchors.map((job) => <option key={job.id} value={job.id}>{job.name} · {job.theme ?? 'untyped'} · {job.status}</option>)}</select></Field><NumberField label="rotation seed" value={retroRotation.seed} min={0} max={2147483647} onChange={(value) => setRetroRotation((current) => ({ ...current, seed: value }))} /><Button busy={busy === 'create-retro-rotation'} disabled={!status?.retroDiffusion || !retroRotation.sourceJobId} onClick={() => void createRetroRotation()}>Generate 8 directions · $0.25</Button></div>
          <div className="space-y-2 rounded-[3px] border border-edge bg-void/35 p-3"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_150px_1fr_120px]"><Field label="Rotated anchor for motion"><select className={inputClass} value={retroMotion.sourceJobId} onChange={(event) => { const source = retroRiggedAnchors.find((job) => job.id === event.target.value); setRetroMotion((current) => ({ ...current, sourceJobId: event.target.value, name: source ? `${source.name}-${current.motionKey}` : '', seed: source ? source.seed + 211 : current.seed })); }}><option value="">choose an 8-direction anchor</option>{retroRiggedAnchors.map((job) => <option key={job.id} value={job.id}>{job.name} · {job.theme ?? 'untyped'}</option>)}</select></Field><Field label="Motion slot"><select className={inputClass} value={retroMotion.motionKey} onChange={(event) => { const slot = TEMPLATE_MOTIONS.find((item) => item.key === event.target.value) ?? TEMPLATE_MOTIONS[0]; const source = retroRiggedAnchors.find((job) => job.id === retroMotion.sourceJobId); setRetroMotion((current) => ({ ...current, motionKey: slot.key, action: slot.action, name: source ? `${source.name}-${slot.key}` : '', frameCount: slot.key.startsWith('walk-') ? 8 : 6, seed: current.seed + 1 })); }}>{TEMPLATE_MOTIONS.map((slot) => <option key={slot.key} value={slot.key}>{slot.label}</option>)}</select></Field><Field label="Motion name"><input className={inputClass} value={retroMotion.name} onChange={(event) => setRetroMotion((current) => ({ ...current, name: event.target.value }))} /></Field><NumberField label="motion seed" value={retroMotion.seed} min={0} max={2147483647} onChange={(value) => setRetroMotion((current) => ({ ...current, seed: value }))} /></div><Field label="Retro motion contract"><textarea className={cx(inputClass, 'min-h-24 resize-y leading-relaxed')} value={retroMotion.action} onChange={(event) => setRetroMotion((current) => ({ ...current, action: event.target.value }))} /></Field><Button busy={busy === 'create-retro-motion'} disabled={!status?.retroDiffusion || !retroMotion.sourceJobId || !retroMotion.name.trim()} onClick={() => void createRetroMotion()}>Generate selected motion · $0.14</Button></div>
        </div>
      </div>
    </Panel>
    <Panel id="directional-rig" className="p-5">
      <SectionTitle right={<div className="flex flex-wrap gap-2"><Badge tone={status?.pixelLab ? 'good' : 'warn'}>PixelLab character v3</Badge><Badge tone="element">96px native</Badge><Badge tone="warn">experimental alternative</Badge></div>}>Alternative · PixelLab directional rig</SectionTitle>
      <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">Start from a compact native sprite, not a large portrait. The default 96px cell is 1.5× the released dogs’ 64px cells while keeping their chunky outline, limited palette, and readable proportions. Review south, east, north, and west before spending on animation.</p>
      <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Rig name"><input className={inputClass} value={rig.name} onChange={(event) => setRig((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Theme / family"><input className={inputClass} value={rig.theme} onChange={(event) => setRig((current) => ({ ...current, theme: event.target.value }))} /></Field></div>
          <div className="grid grid-cols-3 gap-3"><NumberField label="native cell size" value={rig.nativeSize} min={64} max={128} onChange={(value) => setRig((current) => ({ ...current, nativeSize: value }))} /><NumberField label="seed" value={rig.seed} min={0} max={2147483647} onChange={(value) => setRig((current) => ({ ...current, seed: value }))} /><Field label="motion skeleton"><select className={inputClass} value={rig.templateId} onChange={(event) => setRig((current) => ({ ...current, templateId: event.target.value }))}><option value="dog">dog · released feel</option><option value="cat">cat · feline gait</option><option value="lion">lion · heavier</option></select></Field></div>
          <div className="rounded-[3px] border border-element/25 bg-element/[.045] p-3 text-xs leading-relaxed text-muted"><span className="font-medium text-ink">Turnaround gate:</span> every rig is saved with all eight PixelLab rotations and stays pending. Only managed rigs appear in the animation source picker.</div>
        </div>
        <div className="space-y-3">
          <Field label="Directional identity contract"><textarea className={cx(inputClass, 'min-h-44 resize-y leading-relaxed')} value={rig.prompt} onChange={(event) => setRig((current) => ({ ...current, prompt: event.target.value }))} /></Field>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="quiet" onClick={() => setRig({ name: 'lumen-lynx-rig-96-dog-v2', theme: 'light', prompt: LUMEN_RIG_PROMPT, nativeSize: 96, seed: 3113, templateId: 'dog' })}>Light · Lumen Lynx</Button><Button size="sm" variant="quiet" onClick={() => setRig({ name: 'umbra-marten-rig-96-dog', theme: 'dark', prompt: UMBRA_RIG_PROMPT, nativeSize: 96, seed: 3211, templateId: 'dog' })}>Dark · Umbra Marten</Button></div>
          <Button variant="primary" busy={busy === 'create-rig'} disabled={!status?.pixelLab || !rig.name.trim() || rig.prompt.trim().length < 20} onClick={() => void createRig()}>Generate directional turnaround</Button>
        </div>
      </div>
    </Panel>
    <Panel className="p-5">
      <SectionTitle right={<div className="flex flex-wrap gap-2"><Badge tone={status?.pixelLab ? 'good' : 'warn'}>PixelLab motion v3</Badge><Badge tone="element">matching cardinal source</Badge><Badge tone="plain">4 columns × 6 rows</Badge></div>}>Alternative · PixelLab rig → animation template</SectionTitle>
      <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">Each slot starts from the rig rotation that matches its movement: east for right, west for left, north for up, south for down, and east for attacks. PixelLab keeps the fluid v3 motion; the source pose now controls the facing. The final sheet uses the rig’s native cell size.</p>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <Field label="Verified directional rig"><select className={inputClass} value={motion.sourceJobId} onChange={(event) => selectPortrait(riggedPortraits.find((job) => job.id === event.target.value))}><option value="">choose a managed rig</option>{riggedPortraits.map((job) => <option key={job.id} value={job.id}>{job.name} · {Number(job.providerMeta?.nativeSpriteSize) || 96}px · {job.status}</option>)}</select></Field>
          {selectedPortrait ? <div className="rounded-[3px] border border-edge bg-void/40 p-3"><RigTurnaroundPreview job={selectedPortrait} compact /><div className="mt-3 flex items-center justify-between"><span className="text-xs text-ink">Template completeness</span><Badge tone={readySlots === TEMPLATE_MOTIONS.length ? 'good' : 'warn'}>{readySlots} / {TEMPLATE_MOTIONS.length}</Badge></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full bg-element transition-[width]" style={{ width: `${readySlots / TEMPLATE_MOTIONS.length * 100}%` }} /></div></div> : <Empty title="Choose a directional rig">Create and inspect a four-direction turnaround first. Legacy portrait-only drafts are intentionally excluded.</Empty>}
          <Button variant="primary" busy={busy === 'build-template'} disabled={!selectedPortrait || readySlots !== TEMPLATE_MOTIONS.length} onClick={() => void buildTemplate()}>Build production sheet locally</Button>
          <p className="text-[11px] leading-relaxed text-faint">Building the final sheet is local and free. Generating or redoing an individual motion is a paid PixelLab call.</p>
        </div>
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{TEMPLATE_MOTIONS.map((slot) => { const existing = slotJobs[slot.key]; const selected = motion.motionKey === slot.key; return <button type="button" key={slot.key} disabled={!selectedPortrait} onClick={() => selectedPortrait && selectMotionSlot(selectedPortrait, slot)} className={cx('rounded-[3px] border p-3 text-left transition-colors disabled:opacity-40', selected ? 'border-element/60 bg-element/10' : 'border-edge bg-void/35 hover:border-edge-strong')}><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-medium text-ink">{slot.label}</div><div className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">row {slot.row} · {slot.direction} source</div></div><Badge tone={existing ? existing.status === 'approved' ? 'good' : 'warn' : 'plain'}>{existing ? existing.status : 'missing'}</Badge></div>{existing && <div className="mt-2 h-16"><JobThumb job={existing} /></div>}</button>; })}</div>
          <div className="grid gap-3 lg:grid-cols-[1fr_190px_160px]">
            <Field label="Animation name"><input className={inputClass} value={motion.name} onChange={(event) => setMotion((current) => ({ ...current, name: event.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-2"><NumberField label="frames" value={motion.frameCount} min={4} max={16} onChange={(value) => setMotion((current) => ({ ...current, frameCount: value }))} /><NumberField label="seed" value={motion.seed} min={0} max={2147483647} onChange={(value) => setMotion((current) => ({ ...current, seed: value }))} /></div>
            <div className="space-y-1.5"><Button variant="primary" busy={busy === 'animate'} disabled={!status?.pixelLab || !selectedPortrait || !selectedPortrait.providerMeta?.characterId || !TEMPLATE_MOTIONS.some((slot) => slot.key === motion.motionKey) || !motion.name.trim()} onClick={() => void animate()}>{slotJobs[motion.motionKey] ? 'Redo slot' : 'Generate slot'}</Button><Button size="sm" variant="quiet" busy={busy === 'recover-animation'} disabled={!status?.pixelLab || !selectedPortrait || !motion.name.trim()} onClick={() => void animate(true)}>Check timed-out job</Button></div>
          </div>
          <Field label="Motion contract"><textarea className={cx(inputClass, 'min-h-28 resize-y leading-relaxed')} value={motion.action} onChange={(event) => setMotion((current) => ({ ...current, action: event.target.value }))} /></Field>
          <div className="rounded-[3px] border border-edge bg-void/35 px-3 py-2 text-[11px] leading-relaxed text-faint">Extra idle, hit, and celebration clips remain available after the six directional production rows are verified; they are excluded here so they cannot fall back to the old portrait-led path.</div>
        </div>
      </div>
    </Panel>
    <Panel className="p-5"><SectionTitle right={<Button size="sm" busy={loading} onClick={() => void onReload()}>Refresh queue</Button>}>3 · Review in place & decide · {pending.length}</SectionTitle>{pending.length ? <ReviewQueue jobs={jobs} moves={moves} busy={busy} onDecision={decide} onReprocess={reprocess} onReprocessRetroAnchor={reprocessRetroAnchor} onReprocessRetroRotation={reprocessRetroRotation} onRevise={revise} onReviseRig={reviseRig} onReviseRetro={reviseRetroCharacter} onAnimate={selectPortrait} onRedoMotion={redoMotion} /> : <Empty title="No drafts waiting">Generate an asset above. It will stay here until you approve or reject it.</Empty>}</Panel>
    {history.length > 0 && <Panel className="p-5"><SectionTitle>Recent decisions</SectionTitle><div className="grid gap-2 md:grid-cols-2">{history.slice(0, 20).map((job) => <div key={job.id} className="flex items-center gap-3 rounded-[3px] border border-edge bg-void/30 p-2"><JobThumb job={job} className="h-14 w-14" /><div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{job.name}</div><div className="truncate font-mono text-[10px] text-faint">{job.approvedPath ?? job.stagedPath}</div></div><Badge tone={job.status === 'approved' ? 'good' : 'bad'}>{job.status}</Badge></div>)}</div></Panel>}
  </div>;
}

type ReviewQueueProps = {
  jobs: StudioJob[]; moves: StudioMove[]; busy: string | null;
  onDecision: (id: string, action: 'approve' | 'reject') => Promise<void>;
  onReprocess: (id: string) => Promise<void>;
  onReprocessRetroAnchor: (id: string) => Promise<void>;
  onReprocessRetroRotation: (id: string) => Promise<void>;
  onRevise: (job: StudioJob) => void;
  onReviseRig: (job: StudioJob) => void;
  onReviseRetro: (job: StudioJob) => void;
  onAnimate: (job: StudioJob) => void;
  onRedoMotion: (job: StudioJob) => void;
};

function ReviewQueue({ jobs, moves, busy, onDecision, onReprocess, onReprocessRetroAnchor, onReprocessRetroRotation, onRevise, onReviseRig, onReviseRetro, onAnimate, onRedoMotion }: ReviewQueueProps) {
  const pending = jobs.filter((job) => job.status === 'pending');
  const portraits = jobs.filter((job) => job.kind === 'creature-portrait' && job.status !== 'rejected');
  const linkedIds = new Set<string>();
  const motionOrder = new Map<string, number>(TEMPLATE_MOTIONS.map((motion, index) => [motion.key, index]));
  const families = portraits.map((portrait) => {
    const children = pending.filter((job) => job.sourceJobId === portrait.id);
    const portraitDrafts = pending.filter((job) => job.id === portrait.id);
    const familyJobs = [...portraitDrafts, ...children].sort((left, right) => {
      const rank = (job: StudioJob) => job.kind === 'creature-portrait' ? -1
        : job.kind === 'creature-sheet' ? TEMPLATE_MOTIONS.length + 2
          : motionOrder.get(job.motionKey ?? '') ?? TEMPLATE_MOTIONS.length + 1;
      return rank(left) - rank(right) || left.createdAt.localeCompare(right.createdAt);
    });
    familyJobs.forEach((job) => linkedIds.add(job.id));
    const completedSlots = new Set(jobs.filter((job) => (
      job.sourceJobId === portrait.id && job.kind === 'creature-animation'
      && job.status !== 'rejected' && motionOrder.has(job.motionKey ?? '')
    )).map((job) => job.motionKey)).size;
    const hasTemplate = jobs.some((job) => job.sourceJobId === portrait.id && job.kind === 'creature-sheet' && job.status !== 'rejected');
    const hasRetroRotation = jobs.some((job) => job.sourceJobId === portrait.id && job.providerMeta?.retroRotationSheet === true && job.status !== 'rejected');
    return { portrait, familyJobs, completedSlots, hasTemplate, hasRetroRotation };
  }).filter((family) => family.familyJobs.length > 0);
  const otherJobs = pending.filter((job) => !linkedIds.has(job.id));
  const card = (job: StudioJob) => <JobCard key={job.id} job={job} moves={moves} busy={busy === job.id} onDecision={onDecision} onReprocess={onReprocess} onReprocessRetroAnchor={onReprocessRetroAnchor} onReprocessRetroRotation={onReprocessRetroRotation} onRevise={onRevise} onReviseRig={onReviseRig} onReviseRetro={onReviseRetro} onAnimate={onAnimate} onRedoMotion={onRedoMotion} />;

  return <div className="space-y-5">
    {families.map(({ portrait, familyJobs, completedSlots, hasTemplate, hasRetroRotation }) => <section key={portrait.id} className="overflow-hidden rounded-[4px] border border-element/35 bg-element/[.035]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-element/20 bg-element/[.055] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-12 shrink-0 rounded-[3px] border border-edge bg-void/60 p-1"><JobThumb job={portrait} /></div>
          <div className="min-w-0"><div className="truncate text-sm font-medium text-ink">{portrait.name}</div><div className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-faint">monster family · portrait + motions + template</div></div>
        </div>
        <div className="flex flex-wrap gap-1.5"><Badge tone={portrait.theme === 'light' ? 'warn' : portrait.theme === 'dark' ? 'element' : 'plain'}>{portrait.theme ?? 'untyped'}</Badge>{portrait.providerMeta?.managedDirectionalRig === true && <Badge tone="element">{Number(portrait.providerMeta?.nativeSpriteSize) || 96}px managed rig</Badge>}{portrait.providerMeta?.retroBattleSprites === true ? <><Badge tone="element">64px native</Badge><Badge tone="good">4 directions · 56 frames</Badge><Badge tone="good">idle · walk · jump · attack</Badge></> : portrait.providerMeta?.retroNativeAnchor === true ? <><Badge tone="element">64px RD Pro anchor</Badge><Badge tone={hasRetroRotation ? 'good' : 'warn'}>{hasRetroRotation ? '8 directions ready' : 'rotation pending'}</Badge><Badge tone={completedSlots === TEMPLATE_MOTIONS.length ? 'good' : 'warn'}>{completedSlots} / {TEMPLATE_MOTIONS.length} motions</Badge></> : <><Badge tone={completedSlots === TEMPLATE_MOTIONS.length ? 'good' : 'warn'}>{completedSlots} / {TEMPLATE_MOTIONS.length} motions</Badge><Badge tone={hasTemplate ? 'good' : 'plain'}>{hasTemplate ? 'template ready' : 'template pending'}</Badge></>}</div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-2">{familyJobs.map(card)}</div>
    </section>)}
    {otherJobs.length > 0 && <section className="space-y-3">
      <div className="flex items-center justify-between"><div><div className="text-sm font-medium text-ink">Other staged assets</div><div className="text-[10px] uppercase tracking-[.12em] text-faint">backgrounds, move art, rooms, and unlinked drafts</div></div><Badge>{otherJobs.length}</Badge></div>
      <div className="grid gap-4 xl:grid-cols-2">{otherJobs.map(card)}</div>
    </section>}
  </div>;
}

function PipelineBoard({ jobs }: { jobs: StudioJob[] }) {
  const groups = [
    { label: 'Card backgrounds', kinds: ['card-background'], target: 4 },
    { label: 'Monster portraits', kinds: ['creature-portrait'], target: 2 },
    { label: 'Motion clips', kinds: ['creature-animation'], target: 12 },
    { label: 'Animation templates', kinds: ['creature-sheet'], target: 2 },
    { label: 'Approved assets', kinds: [], target: 0 },
  ];
  return <Panel className="p-5"><SectionTitle right={<Badge tone="element">draft → inspect → revise → approve</Badge>}>Content production pipeline</SectionTitle><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{groups.map((group) => { const rows = group.kinds.length ? jobs.filter((job) => group.kinds.includes(job.kind) && job.status !== 'rejected') : jobs.filter((job) => job.status === 'approved'); const pending = rows.filter((job) => job.status === 'pending').length; const approved = rows.filter((job) => job.status === 'approved').length; return <div key={group.label} className="rounded-[3px] border border-edge bg-void/40 p-3"><div className="text-xs font-medium text-ink">{group.label}</div><div className="mt-2 flex items-baseline gap-2"><span className="font-mono text-2xl text-ink">{rows.length}</span>{group.target > 0 && <span className="text-[10px] uppercase tracking-wide text-faint">/ {group.target} session target</span>}</div><div className="mt-1 text-[10px] text-faint">{pending} pending · {approved} approved</div></div>; })}</div></Panel>;
}

function JobThumb({ job, className = 'h-full w-full' }: { job: StudioJob; className?: string }) {
  const frames = job.status === 'approved' && job.approvedFramePaths?.length ? job.approvedFramePaths : job.framePaths;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!frames?.length) return undefined;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % frames.length), 125);
    return () => window.clearInterval(timer);
  }, [frames]);
  const path = frames?.[index] ?? (job.status === 'approved' && job.approvedPath ? job.approvedPath : job.stagedPath);
  return <img src={fileUrl(path, job.providerMeta?.locallyReprocessedAt ?? job.createdAt)} alt={job.name} className={cx(className, 'object-contain [image-rendering:pixelated]')} />;
}

const CONTEXT_KINDS = new Set<StudioKind>([
  'battle-background', 'room-background',
  'side-scroller-sky', 'side-scroller-far', 'side-scroller-mid', 'side-scroller-ground',
  'creature-portrait', 'creature-animation', 'creature-sheet',
  'move-effect', 'card-background', 'card-layer',
]);

const jobAssetPath = (job: StudioJob) => (
  job.status === 'approved' && job.approvedPath ? job.approvedPath : job.stagedPath
);

function ReleasedSprite({ element, flip = false, size = 80, className }: {
  element: Element; flip?: boolean; size?: number; className?: string;
}) {
  return <div aria-label={`${element} monster`} className={cx('absolute [image-rendering:pixelated]', className)} style={{
    width: size, height: size,
    backgroundImage: `url(${fileUrl(`src/assets/sprites/${SPRITE[element]}.png`)})`,
    backgroundPosition: `0 -${size * 4}px`, backgroundRepeat: 'no-repeat',
    backgroundSize: `${size * 4}px ${size * 6}px`,
    transform: flip ? 'scaleX(-1)' : undefined,
  }} />;
}

function ContextLabel({ children }: { children: ReactNode }) {
  return <div className="absolute bottom-2 left-2 z-20 rounded-[2px] border border-edge bg-void/80 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-muted backdrop-blur-sm">{children}</div>;
}

function CardDraftContext({ job, moves }: { job: StudioJob; moves: StudioMove[] }) {
  const base = monsterFrom({ ...DEFAULT_CARD, name: job.kind === 'creature-portrait' ? job.name : 'Ember' }, [], moves);
  const asset = `studio/${job.id}/asset.png`;
  const visualPath = job.kind === 'creature-portrait'
    ? job.status === 'approved' && typeof job.providerMeta?.approvedCardPreviewPath === 'string'
      ? job.providerMeta.approvedCardPreviewPath
      : typeof job.providerMeta?.cardPreviewPath === 'string'
        ? job.providerMeta.cardPreviewPath : jobAssetPath(job)
    : jobAssetPath(job);
  const url = fileUrl(visualPath, job.providerMeta?.locallyReprocessedAt ?? job.createdAt);
  const isMove = job.kind === 'move-effect';
  const monster: Monster = isMove ? {
    ...base,
    name: 'MOVE TEST',
    moves: {
      'Draft Move': {
        type: base.elementType, rarity: 1, count: 1,
        damage: 3, attack: 0, speed: 0, defense: 0, health: 0,
      },
    },
  } : base;
  const authoring = {
    backgroundAsset: job.kind === 'card-background' || job.kind === 'card-layer' ? asset : undefined,
    portraitAsset: job.kind === 'creature-portrait' ? asset : undefined,
    assetUrls: { [asset]: url },
  };

  return <div className="relative flex h-72 w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(116,79,148,.16),transparent_62%)] p-3">
    <div className="relative h-full">
      <CardPreview monster={monster} authoring={authoring} eager className="h-full" />
      {isMove && <img src={url} alt={`${job.name} placed in the first move slot`} className="pointer-events-none absolute object-contain [image-rendering:pixelated]" style={{ left: '31.48%', top: '74.08%', width: '12.04%', height: '7.04%' }} />}
    </div>
    <ContextLabel>{isMove ? 'move slot placement' : job.kind === 'creature-portrait' ? 'monster card placement' : 'complete card placement'}</ContextLabel>
  </div>;
}

function TemplateDraftContext({ job }: { job: StudioJob }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % 4), 170);
    return () => window.clearInterval(timer);
  }, []);
  const url = fileUrl(jobAssetPath(job), job.createdAt);
  return <div className="relative grid h-72 w-full grid-cols-3 gap-2 bg-[radial-gradient(circle_at_center,rgba(116,79,148,.16),transparent_62%)] p-4">
    {TEMPLATE_MOTIONS.map((slot, row) => <div key={slot.key} className="grid place-items-center rounded-[3px] border border-edge bg-void/45 p-2"><div className="h-20 w-20 [image-rendering:pixelated]" style={{ backgroundImage: `url(${url})`, backgroundRepeat: 'no-repeat', backgroundSize: '400% 600%', backgroundPosition: `${frame / 3 * 100}% ${row / 5 * 100}%` }} /><div className="mt-1 text-[9px] uppercase tracking-wide text-muted">{slot.label}</div></div>)}
    <ContextLabel>runtime sheet · six synchronized rows</ContextLabel>
  </div>;
}

function WideDraftContext({ job }: { job: StudioJob }) {
  const url = fileUrl(jobAssetPath(job), job.providerMeta?.locallyReprocessedAt ?? job.createdAt);
  const isBattle = job.kind === 'battle-background';
  const isRoom = job.kind === 'room-background';
  const isMotion = job.kind === 'creature-animation';
  const combatMotion = isMotion && /attack|strike|recoil|impact|hit/i.test(job.action ?? job.prompt);
  const fallback = combatMotion
    ? fileUrl('src/assets/scenes/arena/moonlit-ruins.png')
    : fileUrl('src/assets/scenes/home/house-cottage.png');
  const ratio = isRoom || (isMotion && !combatMotion) ? '384 / 192' : '384 / 216';
  const backdrop = isBattle || isRoom ? url : fallback;
  const pathLayer = job.kind.startsWith('side-scroller-');

  return <div className="relative w-full overflow-hidden bg-[#11101a]" style={{ aspectRatio: ratio }}>
    {pathLayer && <div className="absolute inset-0 bg-[linear-gradient(#272044,#8c6182_58%,#35263d)]" />}
    {!pathLayer && <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]" />}
    {pathLayer && <img src={url} alt={`${job.name} path layer`} className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]" />}

    {isMotion ? <JobThumb job={job} className="absolute bottom-[3%] left-[7%] z-10 h-[72%] w-[42%] object-contain" />
      : <ReleasedSprite element="fire" size={80} className="bottom-[3%] left-[8%] z-10" />}
    {(isBattle || combatMotion) && <ReleasedSprite element="water" flip size={80} className="bottom-[3%] right-[8%] z-10" />}
    {(isRoom || (isMotion && !combatMotion)) && <div className="absolute bottom-[4%] left-[8%] right-[8%] h-[8%] rounded-[50%] bg-black/25 blur-[1px]" />}
    <ContextLabel>{isBattle ? 'battle floor · two fighters' : isRoom ? 'home floor · resident monster' : pathLayer ? 'side-scroller layer · player scale' : combatMotion ? 'combat motion · opponent scale' : 'home motion · resident scale'}</ContextLabel>
  </div>;
}

function DraftContextPreview({ job, moves }: { job: StudioJob; moves: StudioMove[] }) {
  if (job.kind === 'card-background' || job.kind === 'card-layer' || job.kind === 'creature-portrait' || job.kind === 'move-effect') {
    return <CardDraftContext job={job} moves={moves} />;
  }
  if (job.kind === 'creature-sheet' && job.providerMeta?.retroRotationSheet === true) return <RetroRotationDraftContext job={job} />;
  if (job.kind === 'creature-sheet' && job.providerMeta?.retroBattleSprites === true) return <RetroBattleDraftContext job={job} />;
  if (job.kind === 'creature-sheet') return <TemplateDraftContext job={job} />;
  return <WideDraftContext job={job} />;
}

function RetroRotationDraftContext({ job }: { job: StudioJob }) {
  const frames = job.status === 'approved' && job.approvedFramePaths?.length
    ? job.approvedFramePaths : job.framePaths ?? [];
  return <div className="relative grid h-72 w-full grid-cols-4 gap-2 bg-[radial-gradient(circle_at_center,rgba(116,79,148,.16),transparent_62%)] p-4">
    {frames.slice(0, 8).map((frame, index) => <div key={frame} className="grid min-w-0 place-items-center rounded-[3px] border border-edge bg-void/45 p-1">
      <img src={fileUrl(frame, job.providerMeta?.locallyReprocessedAt ?? job.createdAt)} alt={`${job.name} rotation ${index + 1}`} className="h-20 w-20 object-contain [image-rendering:pixelated]" />
      <div className="text-center text-[9px] uppercase tracking-wide text-muted">rotation {index + 1}</div>
    </div>)}
    <ContextLabel>Retro 80px · eight 45° rotations</ContextLabel>
  </div>;
}

function RetroBattleDraftContext({ job }: { job: StudioJob }) {
  const frames = job.status === 'approved' && job.approvedFramePaths?.length
    ? job.approvedFramePaths : job.framePaths ?? [];
  const columns = Math.max(1, Number(job.providerMeta?.gridColumns) || 14);
  const rows = Math.min(4, Math.max(1, Number(job.providerMeta?.gridRows) || 4));
  const [step, setStep] = useState(0);
  const directionLabels = ['down · front', 'right · east', 'up · back', 'left · west'];
  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => (value + 1) % columns), 170);
    return () => window.clearInterval(timer);
  }, [columns]);
  const action = step < 3 ? 'idle' : step < 9 ? 'walk' : step < 11 ? 'jump' : 'attack';
  return <div className="relative grid h-72 w-full grid-cols-2 gap-2 bg-[radial-gradient(circle_at_center,rgba(116,79,148,.16),transparent_62%)] p-4 sm:grid-cols-4">
    {Array.from({ length: rows }, (_, row) => {
      const framePath = frames[row * columns + step];
      return <div key={row} className="grid min-w-0 place-items-center rounded-[3px] border border-edge bg-void/45 p-2">
        {framePath ? <img src={fileUrl(framePath, job.createdAt)} alt={`${job.name} facing ${directionLabels[row] ?? `row ${row + 1}`}`} className="h-24 w-24 object-contain [image-rendering:pixelated]" /> : <span className="text-xs text-faint">missing</span>}
        <div className="mt-1 text-center text-[9px] uppercase tracking-wide text-muted">{directionLabels[row] ?? `direction row ${row + 1}`}</div>
      </div>;
    })}
    <ContextLabel>Retro 64px · {action} · frame {step + 1}/{columns}</ContextLabel>
  </div>;
}

const CARDINAL_ROTATIONS = [
  ['south', 'down'], ['east', 'right'], ['north', 'up'], ['west', 'left'],
] as const;
const ALL_ROTATIONS = [
  ['south', 'down'], ['south-east', 'down-right'], ['east', 'right'], ['north-east', 'up-right'],
  ['north', 'up'], ['north-west', 'up-left'], ['west', 'left'], ['south-west', 'down-left'],
] as const;

function RigTurnaroundPreview({ job, compact = false }: { job: StudioJob; compact?: boolean }) {
  const rotations = job.status === 'approved' && job.approvedRotationPaths
    ? job.approvedRotationPaths : job.rotationPaths ?? {};
  return <div className={cx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-4')}>
    {(compact ? CARDINAL_ROTATIONS : ALL_ROTATIONS).map(([direction, label]) => <div key={direction} className="rounded-[3px] border border-edge bg-void/55 p-2">
      <div className={cx('grid place-items-center', compact ? 'h-24' : 'h-28')}>
        {rotations[direction] ? <img src={fileUrl(rotations[direction], job.createdAt)} alt={`${job.name} facing ${label}`} className="h-full w-full object-contain [image-rendering:pixelated]" /> : <span className="text-xs text-faint">missing</span>}
      </div>
      <div className="mt-1 text-center text-[9px] uppercase tracking-wide text-muted">{label} · {direction}</div>
    </div>)}
  </div>;
}

function JobCard({ job, moves, busy, onDecision, onReprocess, onReprocessRetroAnchor, onReprocessRetroRotation, onRevise, onReviseRig, onReviseRetro, onAnimate, onRedoMotion }: {
  job: StudioJob; moves: StudioMove[]; busy: boolean;
  onDecision: (id: string, action: 'approve' | 'reject') => Promise<void>;
  onReprocess: (id: string) => Promise<void>;
  onReprocessRetroAnchor: (id: string) => Promise<void>;
  onReprocessRetroRotation: (id: string) => Promise<void>;
  onRevise: (job: StudioJob) => void;
  onReviseRig: (job: StudioJob) => void;
  onReviseRetro: (job: StudioJob) => void;
  onAnimate: (job: StudioJob) => void;
  onRedoMotion: (job: StudioJob) => void;
}) {
  const hasContext = CONTEXT_KINDS.has(job.kind);
  const hasRig = job.kind === 'creature-portrait' && Boolean(job.rotationPaths && Object.keys(job.rotationPaths).length >= 4);
  const isRetroCharacter = job.kind === 'creature-portrait' && (job.providerMeta?.retroBattleSprites === true || job.providerMeta?.retroNativeAnchor === true);
  const isRetroSheet = job.kind === 'creature-sheet' && (job.providerMeta?.retroBattleSprites === true || job.providerMeta?.retroRotationSheet === true);
  const alpha = Number(job.providerMeta?.sourceTransparentPct);
  const hasAlphaQa = Number.isFinite(alpha);
  const [view, setView] = useState<'context' | 'raw' | 'rig'>(hasRig ? 'rig' : hasContext ? 'context' : 'raw');
  useEffect(() => { if (hasRig) setView('rig'); }, [hasRig]);
  return <div className="overflow-hidden rounded-[3px] border border-edge bg-void/40">
    <div className="relative grid min-h-64 place-items-center overflow-hidden bg-raised/30">
      {view === 'rig' && hasRig ? <div className="w-full p-3"><RigTurnaroundPreview job={job} /></div> : view === 'context' && hasContext ? <DraftContextPreview job={job} moves={moves} /> : <div className="grid h-72 w-full place-items-center p-3">{isRetroSheet ? <img src={fileUrl(jobAssetPath(job), job.createdAt)} alt={`${job.name} raw spritesheet`} className="max-h-full max-w-full object-contain [image-rendering:pixelated]" /> : <JobThumb job={job} />}</div>}
      {hasContext && <div className="absolute right-2 top-2 z-30 flex rounded-[3px] border border-edge bg-void/85 p-0.5 backdrop-blur-sm">
        {hasRig && <button type="button" onClick={() => setView('rig')} className={cx('rounded-[2px] px-2 py-1 text-[9px] uppercase tracking-wide', view === 'rig' ? 'bg-element/20 text-element' : 'text-muted hover:text-ink')}>Turnaround</button>}
        <button type="button" onClick={() => setView('context')} className={cx('rounded-[2px] px-2 py-1 text-[9px] uppercase tracking-wide', view === 'context' ? 'bg-element/20 text-element' : 'text-muted hover:text-ink')}>In place</button>
        <button type="button" onClick={() => setView('raw')} className={cx('rounded-[2px] px-2 py-1 text-[9px] uppercase tracking-wide', view === 'raw' ? 'bg-element/20 text-element' : 'text-muted hover:text-ink')}>Raw art</button>
      </div>}
    </div>
    <div className="space-y-2 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-sm font-medium text-ink">{job.name}</div><div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{job.kind} · {job.width}×{job.height}{job.framePaths?.length ? ` · ${job.framePaths.length} frames` : ''}</div></div><Badge>{job.provider}</Badge></div><div className="flex flex-wrap gap-1">{job.theme && <Badge tone={job.theme === 'light' ? 'warn' : job.theme === 'dark' ? 'element' : 'plain'}>{job.theme}</Badge>}<Badge>seed {job.seed}</Badge>{job.revision && <Badge>rev {job.revision}</Badge>}{job.motionKey && <Badge tone="element">{job.motionKey}</Badge>}{hasRig && <Badge tone="element">{Number(job.providerMeta?.rotationSpriteSize ?? job.providerMeta?.nativeSpriteSize) || 96}px native rig</Badge>}{hasRig && <Badge>8 rotations</Badge>}{isRetroCharacter && <Badge tone="element">64px native anchor</Badge>}{job.providerMeta?.retroRotationSheet === true ? <Badge tone="good">Retro rotation sheet</Badge> : job.providerMeta?.retroBattleSprites === true ? <Badge tone="good">Retro battle sheet</Badge> : job.kind === 'creature-sheet' && <Badge tone="good">runtime template</Badge>}{job.sourceWidth && (job.sourceWidth !== job.width || job.sourceHeight !== job.height) && <Badge>{job.sourceWidth}×{job.sourceHeight} source</Badge>}{hasAlphaQa && <Badge tone={alpha >= 5 ? 'good' : 'bad'}>{alpha.toFixed(1)}% source alpha</Badge>}{job.providerMeta?.matteRemoved === true && <Badge tone="warn">matte removed</Badge>}</div><p className="line-clamp-3 text-xs leading-relaxed text-muted">{job.prompt}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" busy={busy} onClick={() => void onDecision(job.id, 'approve')}>Approve</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => void onDecision(job.id, 'reject')}>Reject</Button>{job.kind === 'creature-animation' ? <Button size="sm" variant="quiet" disabled={busy} onClick={() => onRedoMotion(job)}>Redo motion</Button> : job.kind !== 'creature-sheet' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => isRetroCharacter ? onReviseRetro(job) : hasRig ? onReviseRig(job) : onRevise(job)}>{isRetroCharacter ? 'Redo Retro character' : hasRig ? 'Redo rig' : 'Revise'}</Button>}{job.providerMeta?.retroNativeAnchor === true && typeof job.providerMeta?.cardPreviewPath !== 'string' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void onReprocessRetroAnchor(job.id)}>Build card preview locally</Button>}{job.kind === 'creature-portrait' && !hasRig && !isRetroCharacter && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void onReprocess(job.id)}>Refit locally</Button>}{job.providerMeta?.retroRotationSheet === true && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void onReprocessRetroRotation(job.id)}>Remap compass locally</Button>}{hasRig && job.providerMeta?.managedDirectionalRig === true && <Button size="sm" variant="quiet" disabled={busy} onClick={() => onAnimate(job)}>Animate from rig</Button>}</div></div>
  </div>;
}

const KIND_OPTIONS: Array<[StudioKind, string]> = [
  ['card-background', 'Card · scenery background'],
  ['creature-portrait', 'Monster · portrait source'],
  ['battle-background', 'Battle background'], ['room-background', 'Home / room'],
  ['side-scroller-sky', 'Side-scroller · sky'], ['side-scroller-far', 'Side-scroller · far'],
  ['side-scroller-mid', 'Side-scroller · middle'], ['side-scroller-ground', 'Side-scroller · ground'],
  ['creature-sheet', 'Legacy sprite sheet'], ['move-effect', 'Move effect / logo'],
];

function kindPreset(kind: StudioKind) {
  const sizes: Record<StudioKind, { width: number; height: number; transparent: boolean }> = {
    'battle-background': { width: 384, height: 216, transparent: false },
    'room-background': { width: 384, height: 192, transparent: false },
    'side-scroller-sky': { width: 384, height: 216, transparent: true },
    'side-scroller-far': { width: 384, height: 216, transparent: true },
    'side-scroller-mid': { width: 384, height: 216, transparent: true },
    'side-scroller-ground': { width: 384, height: 216, transparent: true },
    'creature-portrait': { width: 256, height: 256, transparent: true },
    'creature-sheet': { width: 384, height: 384, transparent: true },
    'creature-animation': { width: 256, height: 256, transparent: true },
    'move-effect': { width: 128, height: 128, transparent: true },
    'card-background': { width: 216, height: 355, transparent: false },
    'card-layer': { width: 216, height: 355, transparent: false },
  };
  return { kind, ...sizes[kind] };
}

const promptSpec = (...lines: string[]) => lines.join('\n');

const CARD_BACKGROUND_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native pixel-art monster-card scenery plate, 216x355 portrait',
  'Production gate: completely unoccupied architecture; zero living, animal, statue-like, face-like, or character-shaped forms anywhere in the image',
  'Scene: luminous observatory carved from pale stone, radiant circular lens high in the architecture',
  'Composition: environment only; quiet empty central 42% reserved for a separately composited creature; ornament and contrast concentrated at the outer edges; low floor line',
  'Style: crisp native-resolution RPG pixel art, single-pixel clusters, hard edges, two-step shading, strong dark accents, no smoothing',
  'Palette: ivory, warm gold, restrained violet, charcoal accents',
  'Constraints: the center must be genuinely empty scenery; no frame, card border, UI, labels, letters, numbers, watermark',
  'Avoid: creature, animal, person, silhouette, statue, face, eyes, character-shaped shadow, central pedestal, false text',
);

const SUN_GARDEN_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native pixel-art monster-card scenery plate, 216x355 portrait',
  'Scene: secluded sun garden with white-stone terraces, a few golden leaves, and thin shafts of revelation light',
  'Composition: environment only; open empty central 42% with a simple readable floor; foliage and masonry frame the outer edges without forming a card border',
  'Style: crisp native-resolution RPG pixel art, deliberate clusters, hard one-pixel edges, two-step shading, no smoothing',
  'Palette: warm ivory, amber, soft lavender, deep plum accents',
  'Constraints: empty center for a separately composited monster; no frame, UI, text, watermark',
  'Avoid: any creature, person, silhouette, statue, face, character-shaped plant, central object, gradients, false lettering',
);

const SEALED_ARCHIVE_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native pixel-art monster-card scenery plate, 216x355 portrait',
  'Production gate: completely unoccupied archive; zero living, skeletal, statue-like, face-like, or character-shaped forms anywhere in the image',
  'Scene: sealed underground archive of black stone shelves, preserved violet runes, and a deep quiet alcove',
  'Composition: environment only; empty central 42% and simple floor reserved for a separately composited creature; shelves and rune detail stay near the sides',
  'Style: crisp native-resolution RPG pixel art, compact clusters, hard edges, two-step shading, no smoothing',
  'Palette: black, plum, indigo, muted silver, restrained violet light',
  'Constraints: Dark means keeping and preservation, not evil; no frame, UI, text, watermark',
  'Avoid: creature, person, silhouette, statue, skull, face, eyes, character-shaped shadow, central altar, false lettering',
);

const MOONWELL_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native pixel-art monster-card scenery plate, 216x355 portrait',
  'Scene: sheltered moonwell below arching roots and dark stone, thin violet reflections and carefully kept old masonry',
  'Composition: environment only; central 42% is a flat empty clearing; roots and stones stay edge-weighted and never form a character silhouette',
  'Style: crisp native-resolution RPG pixel art, controlled clusters, hard one-pixel edges, two-step shading, no smoothing',
  'Palette: black, indigo, violet, cold silver, one restrained pale reflection',
  'Constraints: Dark means concealment and keeping, not corruption; no frame, UI, text, watermark',
  'Avoid: creature, person, silhouette, statue, face, eyes, central object, skulls, evil symbols, false lettering',
);

const LUMEN_LYNX_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: original game-creature identity anchor, transparent 256x256 square',
  'Identity: Lumen Lynx, an adventurous revelation-cat with an oversized starburst forelock, two long split ear-tufts, powerful prism-shaped front paws, a thick comet-curved tail, and a sharp diamond chest ruff',
  'Signature markings: one broken gold sun-ring across the shoulders, three asymmetric violet-gold constellation spots, and bright gold paw tips; markings must remain bold at card scale',
  'Composition: full body in a low three-quarter top-down RPG view, body aimed toward the lower-right and head turned toward the viewer, all paws visible; creature fills roughly 75% width and 65% height',
  'Style: premium native-resolution monster-collecting RPG pixel art, memorable heroic silhouette, one-color dark outline, deliberate clusters, expressive face, three-step shading',
  'Lighting and palette: upper-left light; luminous ivory fur, saturated warm gold markings, deep violet accents and outline',
  'Constraints: exactly one creature; feet touch transparent pixels only; real transparent background; Light means revelation, not holiness; no text or watermark',
  'Avoid: scenery, floor, ground, platform, pedestal, base, cast shadow, halo, wings, armor, props, extra limbs, cropped ears or tail, glow haze, anti-aliasing',
);

const UMBRA_MARTEN_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: original game-creature identity anchor, transparent 256x256 square',
  'Identity: Umbra Marten, a clever keeper-cat with huge rounded listening ears, a swept mask-like brow, heavy mitten paws, a jagged shoulder mantle made only of fur, and one thick S-curved plume tail',
  'Signature markings: three bold violet lock-runes embedded asymmetrically in the shoulder fur, a cold-silver muzzle stripe, and luminous violet paw pads; markings must remain bold at card scale',
  'Composition: full body in a low three-quarter top-down RPG view, body aimed toward the lower-right and head turned toward the viewer, all paws visible; creature fills roughly 75% width and 65% height',
  'Style: premium native-resolution monster-collecting RPG pixel art, memorable cunning silhouette, one-color near-black outline, deliberate clusters, expressive face, three-step shading',
  'Lighting and palette: upper-left light; near-black brown fur, rich indigo shadows, saturated violet markings, cold silver highlights',
  'Constraints: exactly one creature; feet touch transparent pixels only; real transparent background; Dark means concealment and preservation, not evil; no text or watermark',
  'Avoid: scenery, floor, ground, platform, pedestal, base, cast shadow, horns, armor, props, skulls, extra limbs, cropped ears or tail, smoke haze, anti-aliasing',
);

const LUMEN_RIG_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native 96px four-direction RPG battle sprite',
  'Subject: compact quadruped revelation cat with a star-shaped forelock, split ear tufts, large paws, and one thick comet-curved tail',
  'Pose identity: straight neck and forward-pointing muzzle aligned with the spine; attentive gaze follows the body rather than looking back over the shoulder',
  'Signature markings: one broken gold shoulder ring, two asymmetric violet gem spots, and broad gold paw tips; keep every marking identical in every rotation',
  'Style: match the released Rune Realm dog sprites in look and feel; chunky 16-bit pixel clusters, bold one-pixel dark outline, flat 8-to-12-color palette, one highlight step, one shadow step, simple readable face',
  'Proportions: oversized head, paws, ears, and tail; short legs and compact body; bold silhouette readable at actual sprite scale',
  'Palette: warm ivory fur, saturated gold, restrained violet, deep plum outline',
  'Constraints: exactly four legs, consistent anatomy and scale in all rotations, no tiny jewelry, gradients, painterly texture, antialiasing, scenery, text, or watermark',
);

const UMBRA_RIG_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: native 96px four-direction RPG battle sprite',
  'Subject: compact quadruped keeper cat with huge rounded listening ears, heavy mitten paws, a jagged fur shoulder mantle, and one thick S-curved plume tail',
  'Signature markings: three broad violet lock markings in the shoulder fur and one cold-silver muzzle stripe; keep every marking identical in every rotation',
  'Style: match the released Rune Realm dog sprites in look and feel; chunky 16-bit pixel clusters, bold one-pixel near-black outline, flat 8-to-12-color palette, one highlight step, one shadow step, simple readable face',
  'Proportions: oversized head, ears, paws, and tail; short legs and compact body; clever bold silhouette readable at actual sprite scale',
  'Palette: near-black brown, deep indigo, saturated violet, restrained cold silver',
  'Constraints: exactly four legs, consistent anatomy and scale in all rotations, no tiny jewelry, gradients, painterly texture, antialiasing, scenery, skulls, text, or watermark',
);

const RETRO_LUMEN_BATTLE_PROMPT = [
  'A small stocky lynx cat walking naturally on four paws, with a horizontal back and long low feline torso. Never upright, never humanoid, no hands, no clothing.',
  'Oversized feline head, short legs, broad paws, split ear tufts, star-shaped forelock, and one thick curved tail.',
  'Warm ivory fur, one broad broken gold shoulder marking, two large violet spots, gold paw tips, and deep plum outline. Simple bold silhouette and limited colors.',
].join(' ');

const RETRO_UMBRA_BATTLE_PROMPT = [
  'A small stocky pine marten cat walking naturally on four paws, with a horizontal back and long low animal torso. Never upright, never humanoid, no hands, no clothing.',
  'Oversized feline head, short legs, huge rounded ears, broad paws, jagged shoulder fur, and one thick S-curved tail.',
  'Near-black brown fur, three broad violet shoulder markings, one cold-silver muzzle stripe, violet paw pads, and a near-black outline. Simple bold silhouette and limited colors.',
].join(' ');

const REVELATION_ARENA_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: side-view pixel-art battle background, 384x216 landscape',
  'Scene: pale-stone revelation court beneath a broken observatory lens, distant violet sky and restrained gold light',
  'Composition: uninterrupted level combat floor across the bottom 28%; clear standing zones near 15% and 85% width; quiet center for attacks; layered depth above the floor',
  'Style: native-resolution RPG pixel art, hard edges, deliberate clusters, two-step shading, no smoothing',
  'Constraints: background only; no fighters, characters, silhouettes, UI, text, foreground obstruction, watermark',
);

const KEEPER_ARENA_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: side-view pixel-art battle background, 384x216 landscape',
  'Scene: preserved keeper vault of dark stone, sealed shelves and thin violet ward lines, solemn rather than evil',
  'Composition: uninterrupted level combat floor across the bottom 28%; clear standing zones near 15% and 85% width; quiet center for attacks; layered depth above the floor',
  'Style: native-resolution RPG pixel art, hard edges, deliberate clusters, two-step shading, no smoothing',
  'Constraints: background only; no fighters, characters, silhouettes, skulls, UI, text, foreground obstruction, watermark',
);

const LIGHT_HOME_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: side-view pixel-art companion home, 384x192 landscape',
  'Scene: calm keeper study with pale stone, low bookshelves, a warm brass lamp, and one observatory window',
  'Composition: readable furniture silhouettes along walls; continuous empty walking band across the bottom 30%; center floor open for a roaming monster',
  'Style: native-resolution cozy RPG pixel art, hard edges, compact clusters, two-step shading, no smoothing',
  'Constraints: room only; no monster, person, silhouette, UI, letters, numbers, watermark',
);

const DARK_HOME_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: side-view pixel-art companion home, 384x192 landscape',
  'Scene: sheltered moon-den with dark timber, carefully stored jars, folded textiles, and a narrow violet-lit window',
  'Composition: readable furniture along walls; continuous empty walking band across the bottom 30%; center floor open for a roaming monster',
  'Style: native-resolution cozy RPG pixel art, hard edges, compact clusters, two-step shading, no smoothing',
  'Constraints: Dark means sheltered and kept, not sinister; room only; no monster, silhouette, skulls, UI, text, watermark',
);

const LIGHT_MOVE_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: pixel-art card move icon, transparent 128x128 square',
  'Subject: one compact revelation sigil, a broken ring opening into three outward gold rays',
  'Composition: single centered emblem with a bold silhouette, generous transparent padding, readable when reduced into a 78x75 card slot',
  'Style: native-resolution game UI pixel art, hard edges, one dark outline, two-step shading',
  'Palette: warm gold, ivory center, restrained violet shadow',
  'Constraints: real transparency; one emblem only; no text, letters, numbers, border, card frame, watermark',
);

const DARK_MOVE_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: pixel-art card move icon, transparent 128x128 square',
  'Subject: one compact keeper seal, three nested violet arcs closing around a small silver shard',
  'Composition: single centered emblem with a bold silhouette, generous transparent padding, readable when reduced into a 78x75 card slot',
  'Style: native-resolution game UI pixel art, hard edges, one dark outline, two-step shading',
  'Palette: indigo, muted violet, cold silver, black outline',
  'Constraints: Dark means protection and keeping; real transparency; one emblem only; no text, letters, numbers, border, skulls, watermark',
);

const PATH_PROMPT = promptSpec(
  'Use case: stylized-concept',
  'Asset type: seamless transparent pixel-art far parallax layer, 384x216 landscape',
  'Scene: distant crystal-pass ridgeline with sparse angular crystal silhouettes',
  'Composition: horizontal band concentrated below the middle; transparent sky; left and right edges tile seamlessly; no central focal object',
  'Style: native-resolution RPG pixel art, limited clusters, hard edges, no smoothing',
  'Constraints: transparent background; scenery layer only; no character, UI, text, watermark',
);

type PromptPreset = {
  label: string; provider: 'pixellab' | 'retro-diffusion'; kind: StudioKind;
  name: string; theme: string; seed: number; guidance?: number; prompt: string;
};

const PROMPTS: PromptPreset[] = [
  { label: 'Card · Light observatory · RD', provider: 'retro-diffusion', kind: 'card-background', name: 'light-observatory-rd', theme: 'light', seed: 1101, prompt: CARD_BACKGROUND_PROMPT },
  { label: 'Card · Light sun garden · PL', provider: 'pixellab', kind: 'card-background', name: 'light-sun-garden-pl', theme: 'light', seed: 1102, prompt: SUN_GARDEN_PROMPT },
  { label: 'Card · Dark archive · RD', provider: 'retro-diffusion', kind: 'card-background', name: 'dark-sealed-archive-rd', theme: 'dark', seed: 1201, prompt: SEALED_ARCHIVE_PROMPT },
  { label: 'Card · Dark moonwell · PL', provider: 'pixellab', kind: 'card-background', name: 'dark-moonwell-pl', theme: 'dark', seed: 1202, prompt: MOONWELL_PROMPT },
  { label: 'Monster · Lumen Lynx v2 · PL', provider: 'pixellab', kind: 'creature-portrait', name: 'lumen-lynx-v2-pl', theme: 'light', seed: 2111, guidance: 11, prompt: LUMEN_LYNX_PROMPT },
  { label: 'Monster · Lumen Lynx v2 · RD', provider: 'retro-diffusion', kind: 'creature-portrait', name: 'lumen-lynx-v2-rd', theme: 'light', seed: 2111, guidance: 11, prompt: LUMEN_LYNX_PROMPT },
  { label: 'Monster · Umbra Marten v2 · PL', provider: 'pixellab', kind: 'creature-portrait', name: 'umbra-marten-v2-pl', theme: 'dark', seed: 2211, guidance: 11, prompt: UMBRA_MARTEN_PROMPT },
  { label: 'Monster · Umbra Marten v2 · RD', provider: 'retro-diffusion', kind: 'creature-portrait', name: 'umbra-marten-v2-rd', theme: 'dark', seed: 2211, guidance: 11, prompt: UMBRA_MARTEN_PROMPT },
  { label: 'Arena · Revelation court · RD', provider: 'retro-diffusion', kind: 'battle-background', name: 'revelation-court-rd', theme: 'light', seed: 3101, prompt: REVELATION_ARENA_PROMPT },
  { label: 'Arena · Keeper vault · RD', provider: 'retro-diffusion', kind: 'battle-background', name: 'keeper-vault-rd', theme: 'dark', seed: 3201, prompt: KEEPER_ARENA_PROMPT },
  { label: 'Home · Keeper study · RD', provider: 'retro-diffusion', kind: 'room-background', name: 'light-keeper-study-rd', theme: 'light', seed: 4101, prompt: LIGHT_HOME_PROMPT },
  { label: 'Home · Moon den · RD', provider: 'retro-diffusion', kind: 'room-background', name: 'dark-moon-den-rd', theme: 'dark', seed: 4201, prompt: DARK_HOME_PROMPT },
  { label: 'Move · Revelation sigil · PL', provider: 'pixellab', kind: 'move-effect', name: 'revelation-sigil-pl', theme: 'light', seed: 5101, guidance: 10, prompt: LIGHT_MOVE_PROMPT },
  { label: 'Move · Keeper seal · PL', provider: 'pixellab', kind: 'move-effect', name: 'keeper-seal-pl', theme: 'dark', seed: 5201, guidance: 10, prompt: DARK_MOVE_PROMPT },
  { label: 'Path · Crystal pass · PL', provider: 'pixellab', kind: 'side-scroller-far', name: 'crystal-pass-pl', theme: 'neutral', seed: 6101, prompt: PATH_PROMPT },
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
