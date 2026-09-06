/**
 * The authored monster catalog, and how a published overlay joins onto it.
 *
 * Split out of `monster-index.ts` because that module loads ART through
 * `import.meta.glob`, which only exists under Vite. Anything importing it drags
 * the globs along, and the swarm client is bundled with esbuild and run under
 * plain Node — where the first call is `(intermediate value).glob is not a
 * function` and the whole orchestration suite dies. `lib/game.ts` needs the
 * catalog join and nothing else, so the join lives here with no asset imports.
 *
 * `monster-index.ts` re-exports everything below, so existing callers are
 * unchanged and there is exactly one implementation.
 */
import { GENERATED_MONSTER_INDEX } from '../generated/monster-index';
import { MonsterIndexCatalog, MonsterIndexEntry, MonsterIndexView } from './types';

export const authoredEntries = GENERATED_MONSTER_INDEX.entries as unknown as MonsterIndexEntry[];
export const AUTHORED_BY_NO = new Map(authoredEntries.map((entry) => [entry.entryNo, entry]));

export function authoredMonsterIndex(): MonsterIndexCatalog {
  return {
    schemaVersion: GENERATED_MONSTER_INDEX.schemaVersion,
    catalogHash: GENERATED_MONSTER_INDEX.catalogHash,
    revision: 0,
    nextEntryNo: GENERATED_MONSTER_INDEX.nextEntryNo,
    entries: authoredEntries,
  };
}

/**
 * Join local plans/assets with the contract's mutable names and channel flags.
 *
 * Two shapes arrive here. The published `monsterindex` key carries only
 * `overrides` — a sparse map of the six fields an admin may patch — because the
 * full `entries` array is a verbatim copy of the catalog this bundle already
 * ships, and publishing it cost 32 KB on a map every message pays for five
 * times. `Monster.Index` and any process deployed before that change still
 * reply with `entries`, so both are honoured and the authored catalog is the
 * base either way.
 */
export function mergeMonsterIndex(live?: MonsterIndexView | null): MonsterIndexCatalog {
  if (!live) return authoredMonsterIndex();
  const liveByNo = new Map((live.entries ?? []).map((entry) => [entry.entryNo, entry]));
  const overrides = live.overrides ?? {};
  if (!liveByNo.size && !Object.keys(overrides).length) {
    // Nothing mutable on the wire: the authored catalog IS the answer, but keep
    // the live revision/hash so a caller can still tell one publish from another.
    return { ...authoredMonsterIndex(), ...live, entries: authoredEntries };
  }
  const entries = authoredEntries.map((authored) => {
    const current = liveByNo.get(authored.entryNo);
    const patch = overrides[String(authored.entryNo)];
    if (!current && !patch) return authored;
    return {
      ...authored, ...current, ...patch,
      assets: authored.assets, plan: authored.plan,
    };
  });
  return { ...live, entries };
}
