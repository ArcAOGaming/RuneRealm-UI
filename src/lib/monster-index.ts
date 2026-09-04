import { GENERATED_MONSTER_INDEX } from '../generated/monster-index';
import { Affinity, MonsterIndexEntry, MonsterIndexView, Element, Listing, Monster, Player } from './types';

const urls = (value: Record<string, unknown>) => value as Record<string, string>;
const PORTRAITS = urls(import.meta.glob('../assets/monster-index/*/portrait.png', {
  eager: true, query: '?url', import: 'default',
}));
const ATLASES = urls(import.meta.glob('../assets/monster-index/*/atlas.png', {
  eager: true, query: '?url', import: 'default',
}));
const ATLAS_URLS = urls(import.meta.glob('../assets/monster-index/*/atlas.json', {
  eager: true, query: '?url', import: 'default',
}));
const ATLAS_DATA = import.meta.glob('../assets/monster-index/*/atlas.json', {
  eager: true, import: 'default',
}) as Record<string, MonsterIndexAtlas>;

export type MonsterIndexClip = {
  frames: string[];
  frameRate: number;
  repeat: number;
  impactFrame?: number;
};

export type MonsterIndexRender = {
  origin: { x: number; y: number };
  worldScale: number;
  battleScale: number;
  shadow: { width: number; height: number; offsetY: number };
  attackReach: number;
};

export type MonsterIndexAtlas = {
  frames: Record<string, unknown>;
  meta: { image: string; size: { w: number; h: number } };
  runerealm: {
    schemaVersion: number;
    entryNo: number;
    sheetLayout?: string;
    clips: Record<string, MonsterIndexClip>;
    render: MonsterIndexRender;
  };
};

export type MonsterIndexArt = {
  portrait: string;
  atlas: string;
  atlasUrl: string;
  atlasData: MonsterIndexAtlas;
};

/**
 * One immutable species/form definition assembled from the generated catalog
 * and its numbered runtime folder. Owned-monster state stays separate: many
 * instances can point at the same definition without copying animation rules.
 */
export type MonsterDefinition = {
  entryNo: number;
  folder: string;
  entry: MonsterIndexEntry;
  art?: MonsterIndexArt;
};

const authoredEntries = GENERATED_MONSTER_INDEX.entries as unknown as MonsterIndexEntry[];
const AUTHORED_BY_NO = new Map(authoredEntries.map((entry) => [entry.entryNo, entry]));

const assetKey = (entryNo: number, file: string) => {
  const folder = String(entryNo).padStart(3, '0');
  return Object.keys(file === 'portrait.png' ? PORTRAITS : file === 'atlas.png' ? ATLASES : ATLAS_URLS)
    .find((key) => key.endsWith(`/monster-index/${folder}/${file}`));
};

export function authoredMonsterIndex(): MonsterIndexView {
  return {
    schemaVersion: GENERATED_MONSTER_INDEX.schemaVersion,
    catalogHash: GENERATED_MONSTER_INDEX.catalogHash,
    revision: 0,
    nextEntryNo: GENERATED_MONSTER_INDEX.nextEntryNo,
    entries: authoredEntries,
  };
}

/** Join local plans/assets with the contract's mutable names and channel flags. */
export function mergeMonsterIndex(live?: MonsterIndexView | null): MonsterIndexView {
  if (!live?.entries?.length) return authoredMonsterIndex();
  const liveByNo = new Map(live.entries.map((entry) => [entry.entryNo, entry]));
  const entries = authoredEntries.map((authored) => {
    const current = liveByNo.get(authored.entryNo);
    return current ? { ...authored, ...current, assets: authored.assets, plan: authored.plan } : authored;
  });
  return { ...live, entries };
}

export const monsterIndexEntry = (entryNo?: number | null) => (
  entryNo ? AUTHORED_BY_NO.get(entryNo) : undefined
);

export function inferEntryNo(monster: Pick<Monster, 'entryNo' | 'name' | 'elementType'>): number | undefined {
  if (monster.entryNo && AUTHORED_BY_NO.has(monster.entryNo)) return monster.entryNo;
  const found = authoredEntries.find((entry) => (
    entry.stage === 1 && entry.affinity === monster.elementType
      && (entry.displayName === monster.name || entry.name === monster.name)
  ));
  return found?.entryNo;
}

export function monsterIndexArt(entryNo?: number | null): MonsterIndexArt | undefined {
  if (!entryNo) return undefined;
  const portraitKey = assetKey(entryNo, 'portrait.png');
  const atlasKey = assetKey(entryNo, 'atlas.png');
  const atlasUrlKey = assetKey(entryNo, 'atlas.json');
  const folder = String(entryNo).padStart(3, '0');
  const atlasDataKey = Object.keys(ATLAS_DATA).find((key) => key.endsWith(`/monster-index/${folder}/atlas.json`));
  if (!portraitKey || !atlasKey || !atlasUrlKey || !atlasDataKey) return undefined;
  return {
    portrait: PORTRAITS[portraitKey],
    atlas: ATLASES[atlasKey],
    atlasUrl: ATLAS_URLS[atlasUrlKey],
    atlasData: ATLAS_DATA[atlasDataKey],
  };
}

export function monsterDefinition(
  source: number | Pick<Monster, 'entryNo' | 'name' | 'elementType'>,
): MonsterDefinition | undefined {
  const entryNo = typeof source === 'number' ? source : inferEntryNo(source);
  const entry = monsterIndexEntry(entryNo);
  if (!entry) return undefined;
  return {
    entryNo: entry.entryNo,
    folder: String(entry.entryNo).padStart(3, '0'),
    entry,
    art: monsterIndexArt(entry.entryNo),
  };
}

export const isElement = (affinity: Affinity): affinity is Element => affinity !== 'normal';
export const affinityLabel = (affinity: Affinity) => affinity === 'normal'
  ? 'Untyped'
  : affinity[0].toUpperCase() + affinity.slice(1);

/** Current copies only. Historical discovery lives in `player.seenEntries`. */
export function monsterIndexOwnership(
  player?: Player | null,
  listings?: Record<string, Listing> | null,
): Map<number, number> {
  const owned = new Map<number, number>();
  const add = (monster?: Monster | null) => {
    if (!monster) return;
    const entryNo = inferEntryNo(monster);
    if (entryNo) owned.set(entryNo, (owned.get(entryNo) ?? 0) + 1);
  };
  Object.values(player?.monsters ?? {}).forEach(add);
  Object.values(player?.collection ?? {}).forEach(add);
  Object.values(player?.assets ?? {}).forEach((asset) => add(asset.monster));
  Object.values(listings ?? {}).forEach((listing) => {
    if (listing.seller === player?.address) add(listing.monster);
  });
  return owned;
}
