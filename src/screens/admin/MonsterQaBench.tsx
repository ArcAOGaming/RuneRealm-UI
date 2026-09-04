import { useEffect, useMemo, useRef, useState } from 'react';
import { monsterIndexArt } from '../../lib/monster-index';
import {
  Battle, Catalog, Combatant, CombatantState, Monster, MonsterIndexEntry, Move, Turn,
} from '../../lib/types';
import { useGame } from '../../state/gameContext';
import { mountGame, Mounted } from '../../game/boot';
import { MonsterMotion } from '../../game/MonsterRig';
import { MonsterPreviewScene } from '../../game/MonsterPreviewScene';
import { CardPreview } from '../../ui/CardPreview';
import RoomStage from '../../ui/RoomStage';
import HuntStage from '../../ui/HuntStage';
import BattleStageImpl from '../../ui/BattleStageImpl';
import { Badge, Empty, Panel, SectionTitle, cx } from '../../ui/primitives';

type Context = 'home' | 'play' | 'quest' | 'hunt' | 'battle';
const CONTEXTS: Context[] = ['home', 'play', 'quest', 'hunt', 'battle'];

const effectiveName = (entry: MonsterIndexEntry) => (
  entry.name ?? entry.displayName ?? entry.workingName
);

function moveDefinition(catalog: Catalog | null, entry: MonsterIndexEntry, name: string): Move {
  for (const pool of Object.values(catalog?.movePools ?? {})) {
    const move = pool?.[name];
    if (move) return { ...move, name, count: move.count ?? 2 };
  }
  return {
    name, type: entry.affinity, rarity: 1, count: 2, damage: 4,
    attack: 0, speed: 0, defense: 0, health: 0,
  };
}

function qaMonster(entry: MonsterIndexEntry, catalog: Catalog | null): Monster {
  const names = [entry.moves?.basic ?? entry.basicMove, entry.moves?.advanced ?? entry.advancedMove]
    .filter((name): name is string => Boolean(name));
  const moves = Object.fromEntries(names.map((name) => [name, moveDefinition(catalog, entry, name)]));
  const elementArt = entry.affinity === 'rock' ? 'Earth'
    : entry.affinity === 'normal' ? 'Normal'
      : entry.affinity[0].toUpperCase() + entry.affinity.slice(1);
  return {
    id: `admin-preview-${entry.entryNo}`,
    entryNo: entry.entryNo,
    entryKey: entry.entryKey,
    evolutionStage: entry.stage,
    nameMode: 'species',
    name: effectiveName(entry),
    image: entry.entryKey,
    sprite: '',
    holographic: true,
    background: elementArt,
    border: elementArt,
    faction: entry.starterFaction ?? 'Wild',
    elementType: entry.affinity,
    berryItem: entry.affinity === 'normal' ? undefined : `${entry.affinity}_berry`,
    careMode: entry.affinity === 'normal' ? 'any-berry' : 'element-berry',
    attack: 6 + entry.stage,
    defense: 6 + entry.stage,
    speed: 6 + entry.stage,
    health: 6 + entry.stage,
    energy: 80,
    happiness: 80,
    level: Math.max(1, entry.stage * 10),
    exp: 0,
    nextLevelExp: 100,
    totalTimesFed: 0,
    totalTimesPlay: 0,
    totalTimesQuest: 0,
    moves,
    status: { type: 'Home', since: 0, until_time: 0 },
    bornAt: 0,
  };
}

export default function MonsterQaBench({ entry }: { entry: MonsterIndexEntry }) {
  const { catalog } = useGame();
  const art = monsterIndexArt(entry.entryNo);
  const monster = useMemo(() => qaMonster(entry, catalog), [catalog, entry]);
  const [context, setContext] = useState<Context>('home');
  useEffect(() => setContext('home'), [entry.entryNo]);

  if (!art) return <PartialAssetBench entry={entry} />;

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionTitle>Runtime QA bench</SectionTitle>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-faint">
            These previews use the vendored portrait, atlas JSON, card renderer, and production Phaser rig.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="good">runtime ready</Badge>
          <Badge>{art.atlasData.runerealm.sheetLayout ?? 'custom atlas'}</Badge>
          <Badge>{art.atlasData.meta.size.w}×{art.atlasData.meta.size.h}</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <RigPlayer entry={entry} />
        <div>
          <div className="mb-2 text-xs font-medium text-ink">Production card</div>
          <CardPreview monster={monster} eager className="mx-auto w-full max-w-[220px]" />
        </div>
      </div>

      <details className="mt-4 border border-edge/60 bg-void/30 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted">Full normalized animation sheet</summary>
        <div className="mt-3 overflow-auto bg-black/40 p-2">
          <img src={art.atlas} alt={`${monster.name} complete animation atlas`}
            className="max-w-none [image-rendering:pixelated]" />
        </div>
      </details>

      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Production scene checks</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {CONTEXTS.map((value) => <button key={value} type="button" onClick={() => setContext(value)}
              className={cx('border px-2 py-1 text-[11px] uppercase tracking-wide',
                context === value ? 'border-element/60 bg-element/10 text-element' : 'border-edge text-faint')}>
              {value}
            </button>)}
          </div>
        </div>
        <div className="mt-3">
          <ContextPreview context={context} monster={monster} entry={entry} />
        </div>
      </div>
    </Panel>
  );
}

function RigPlayer({ entry }: { entry: MonsterIndexEntry }) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const art = monsterIndexArt(entry.entryNo)!;
  const initial = art.atlasData.runerealm.clips.idle ? 'idle'
    : Object.keys(art.atlasData.runerealm.clips)[0];
  const [motion, setMotion] = useState<MonsterMotion>(initial);
  const [motions, setMotions] = useState<MonsterMotion[]>(Object.keys(art.atlasData.runerealm.clips));
  const [state, setState] = useState('holding');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!host.current) return undefined;
    setMotion(initial); setMotions(Object.keys(art.atlasData.runerealm.clips));
    setState('holding'); setPaused(false);
    const handle = mountGame(host.current, 256, 192, [MonsterPreviewScene], { maxZoom: 3 });
    mounted.current = handle;
    handle.game.scene.start(MonsterPreviewScene.KEY, {
      entryNo: entry.entryNo,
      onReady: setMotions,
      onComplete: (completed: MonsterMotion) => setState(`${completed} complete`),
    });
    return () => { mounted.current = null; handle.destroy(); };
  }, [art.atlas, entry.entryNo, initial]);

  const scene = () => mounted.current?.scene<MonsterPreviewScene>(MonsterPreviewScene.KEY);
  const run = (mode: 'once' | 'times' | 'loop') => {
    scene()?.show(motion, mode);
    setPaused(false);
    setState(mode === 'times' ? `${motion} ×3` : `${motion} · ${mode}`);
  };
  const choose = (next: MonsterMotion) => {
    setMotion(next);
    scene()?.show(next, art.atlasData.runerealm.clips[next]?.repeat === -1 ? 'loop' : 'once');
    setState(next);
  };

  return <div>
    <div ref={host} className="overflow-hidden border border-edge/60 bg-void" style={{ aspectRatio: '4 / 3' }} />
    <div className="mt-3 flex flex-wrap gap-1">
      {motions.map((value) => {
        const clip = art.atlasData.runerealm.clips[value];
        return <button key={value} type="button" onClick={() => choose(value)} title={`${clip.frames.length} frames at ${clip.frameRate} fps`}
          className={cx('border px-2 py-1 font-mono text-[10px]',
            motion === value ? 'border-element/60 bg-element/10 text-element' : 'border-edge text-faint')}>
          {value} · {clip.frames.length}f
        </button>;
      })}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => run('once')} className="border border-edge px-2 py-1 text-xs text-muted">Once</button>
      <button type="button" onClick={() => run('times')} className="border border-edge px-2 py-1 text-xs text-muted">×3</button>
      <button type="button" onClick={() => run('loop')} className="border border-edge px-2 py-1 text-xs text-muted">Loop</button>
      <button type="button" onClick={() => {
        if (paused) scene()?.resume(); else scene()?.pause();
        setPaused(!paused); setState(paused ? `${motion} resumed` : `${motion} paused`);
      }} className="border border-edge px-2 py-1 text-xs text-muted">{paused ? 'Resume' : 'Pause'}</button>
      <button type="button" onClick={() => { scene()?.stop(); setPaused(false); setState('holding'); }}
        className="border border-edge px-2 py-1 text-xs text-muted">Stop</button>
      <span className="ml-auto font-mono text-[10px] text-faint">{state}</span>
    </div>
  </div>;
}

function PartialAssetBench({ entry }: { entry: MonsterIndexEntry }) {
  const sources = Object.entries(entry.assets ?? {}).reduce<Array<{
    path: string; slots: string[]; notes: string[]; status: 'partial' | 'draft';
  }>>((all, [slot, asset]) => {
    if (!asset.path || (asset.status !== 'partial' && asset.status !== 'draft')) return all;
    const existing = all.find((source) => source.path === asset.path);
    if (existing) {
      existing.slots.push(slot);
      if (asset.notes && !existing.notes.includes(asset.notes)) existing.notes.push(asset.notes);
    } else {
      all.push({ path: asset.path, slots: [slot], notes: asset.notes ? [asset.notes] : [], status: asset.status });
    }
    return all;
  }, []);
  return <Panel className="p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><SectionTitle>Partial source inspection</SectionTitle>
        <p className="mt-2 text-xs text-faint">Runtime scenes and cards stay disabled until a portrait and valid atlas pair exist.</p></div>
      <Badge tone="warn">not runtime ready</Badge>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {sources.map((source) => {
        const workspacePath = `RuneRealm-Assets/monster-index/${source.path}`;
        const url = `/__studio/file?path=${encodeURIComponent(workspacePath)}`;
        return <div key={source.path} className="border border-edge/60 bg-void/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">{source.slots.map((slot) => <Badge key={slot}>{slot}</Badge>)}</div>
            <Badge tone="warn">{source.status}</Badge>
          </div>
          {import.meta.env.DEV && <div className="mt-3 grid min-h-48 place-items-center overflow-auto bg-black/40 p-2">
            <img src={url} alt={`${effectiveName(entry)} partial source sheet`} className="max-h-80 max-w-full [image-rendering:pixelated]" />
          </div>}
          <code className="mt-2 block break-all text-[10px] text-faint">{workspacePath}</code>
          {source.notes.map((note) => <p key={note} className="mt-2 text-xs leading-relaxed text-muted">{note}</p>)}
        </div>;
      })}
      {!sources.length && <Empty title="No viewable source yet">Add a partial or draft asset path to inspect it here.</Empty>}
    </div>
  </Panel>;
}

function ContextPreview({ context, monster, entry }: {
  context: Context; monster: Monster; entry: MonsterIndexEntry;
}) {
  if (context === 'battle') return <BattleQa monster={monster} entry={entry} />;
  if (context === 'hunt') return <div className="h-[420px] border border-edge/60">
    <HuntStage companion={{ ...monster, status: { type: 'Hunt', since: 0, until_time: 0 } }}
      searchFailedToken={0} onTrailReady={() => {}} onEncounterRevealed={() => {}} onTravel={() => {}} />
  </div>;
  const type = context === 'play' ? 'Play' : context === 'quest' ? 'Quest' : 'Home';
  return <RoomStage monster={{ ...monster, status: { type, since: 0, until_time: 0 } }} />;
}

function combatant(monster: Monster, side: 'challenger' | 'accepter'): Combatant {
  const stat = 6 + (monster.evolutionStage ?? 1);
  return {
    side,
    address: side === 'challenger' ? 'admin-preview' : 'bot',
    name: side === 'challenger' ? monster.name : 'Mirror rig',
    image: monster.image,
    sprite: monster.sprite,
    faction: monster.faction,
    entryNo: monster.entryNo,
    elementType: monster.elementType,
    level: monster.level,
    attack: stat, defense: stat, speed: stat, health: stat,
    healthPoints: 84, maxHealthPoints: 84,
    shield: 16, maxShield: 16,
    baseAttack: stat, baseDefense: stat, baseSpeed: stat,
    moves: monster.moves,
  };
}

const combatantState = (fighter: Combatant, healthPoints = fighter.healthPoints): CombatantState => ({
  side: fighter.side,
  name: fighter.name,
  healthPoints,
  maxHealthPoints: fighter.maxHealthPoints,
  shield: fighter.shield,
  maxShield: fighter.maxShield,
  attack: fighter.attack,
  defense: fighter.defense,
  speed: fighter.speed,
  elementType: fighter.elementType,
});

function BattleQa({ monster, entry }: { monster: Monster; entry: MonsterIndexEntry }) {
  const [round, setRound] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reset, setReset] = useState(0);
  useEffect(() => { setRound(0); setTurns([]); setReset((value) => value + 1); }, [entry.entryNo]);
  const me = useMemo(() => combatant(monster, 'challenger'), [monster]);
  const them = useMemo(() => combatant(monster, 'accepter'), [monster]);
  const battle: Battle = {
    id: `admin-rig-${entry.entryNo}-${reset}`,
    kind: 'bot', status: 'battling', round, turns, startedAt: 0,
    challenger: me, accepter: them,
  };
  const play = (advanced: boolean) => {
    const moveName = advanced
      ? entry.moves?.advanced ?? entry.advancedMove ?? 'Advanced attack'
      : entry.moves?.basic ?? entry.basicMove ?? 'Basic attack';
    const move = monster.moves[moveName] ?? moveDefinition(null, entry, moveName);
    const nextRound = round + 1;
    const turn: Turn = {
      round: nextRound,
      attacker: 'challenger',
      attackerAddress: me.address,
      monsterName: me.name,
      move: moveName,
      moveType: move.type,
      moveRarity: move.rarity,
      missed: false,
      shieldDamage: 4,
      healthDamage: 8,
      statsChanged: {},
      superEffective: false,
      notEffective: false,
      attackerState: combatantState(me),
      defenderState: { ...combatantState(them, Math.max(1, them.healthPoints - nextRound * 8)), shield: 12 },
    };
    setTurns((current) => [...current, turn]);
    setRound(nextRound);
  };
  return <div>
    <BattleStageImpl key={battle.id} battle={battle} me={me} them={them} bare />
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={() => play(false)} className="border border-edge px-3 py-1.5 text-xs text-muted">Play basic attack</button>
      <button type="button" onClick={() => play(true)} className="border border-edge px-3 py-1.5 text-xs text-muted">Play advanced attack</button>
      <button type="button" onClick={() => { setRound(0); setTurns([]); setReset((value) => value + 1); }}
        className="border border-edge px-3 py-1.5 text-xs text-muted">Reset stage</button>
    </div>
  </div>;
}
