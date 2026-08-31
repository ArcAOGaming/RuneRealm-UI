/**
 * A dev harness for the companion and battle Phaser scenes.
 *
 * The real screens are behind a wallet and an unlocked account, so there is no
 * way to look at the room or the arena from a cold checkout — which means the
 * pixel work they exist to get right could only be verified by playing. This
 * mounts both scenes against fabricated records at `/sandbox.html`.
 *
 * Dev only. It is a root-level entry, so `vite build` does not include it
 * unless it is named in rollupOptions.input, and it is not.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../index.css';
import {
  ActivityReceipt, Battle, Combatant, Element, Monster,
} from '../lib/types';
import RoomStage from '../ui/RoomStage';
import BattleStageImpl from '../ui/BattleStageImpl';
import Arena from '../screens/Arena';
import Companion from '../screens/Companion';
import Collection from '../screens/Collection';
import CompanionAcquisition, { AcquisitionKind } from '../ui/CompanionAcquisition';
import { CaptureChoice } from '../screens/Hunt';
import { Shell } from '../ui/Shell';
import { ToastProvider } from '../ui/Toast';
import { MemoryRouter } from 'react-router-dom';
import { GameContext } from '../state/GameProvider';
import { arenaNames, homeNames, playNames, questRoutes } from './assets';
import PLAYER_SHEET from '../assets/BASE.png?url';

const SPRITES = [
  'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ',
  '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0',
  'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc',
  'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks',
];

const monster = (element: Element, sprite: string, status: string): Monster => ({
  name: 'Doge', image: '', sprite, faction: 'Sky Nomads', elementType: element,
  berryItem: `${element}_berry`, attack: 5, defense: 5, speed: 5, health: 5,
  energy: 80, happiness: 80, level: 4, exp: 10, nextLevelExp: 40,
  totalTimesFed: 0, totalTimesPlay: 0, totalTimesQuest: 0, moves: {},
  status: { type: status as Monster['status']['type'], since: 0, until_time: 0 },
  bornAt: 0,
} as Monster);

const fighter = (side: 'challenger' | 'accepter', element: Element, sprite: string): Combatant => ({
  side, address: side, name: side === 'challenger' ? 'Yours' : 'Theirs', image: '',
  sprite, faction: '', elementType: element, level: 5,
  attack: 6, defense: 6, speed: 6, health: 6,
  healthPoints: 70, maxHealthPoints: 100, shield: 10, maxShield: 20,
  baseAttack: 5, baseDefense: 5, baseSpeed: 5,
  moves: {
    Firenado: { type: 'fire', rarity: 2, count: 4, damage: 5, attack: 0, defense: 0, speed: 1, health: 0 },
    Inferno: { type: 'fire', rarity: 2, count: 2, damage: 7, attack: 0, defense: 0, speed: 0, health: 0 },
    'Flame Shield': { type: 'boost', rarity: 1, count: 3, damage: 0, attack: 0, defense: 3, speed: 0, health: 0 },
    'Phoenix Burst': { type: 'heal', rarity: 2, count: 0, damage: 0, attack: 0, defense: 0, speed: 0, health: 4 },
  },
} as unknown as Combatant);

function App() {
  const [home, setHome] = useState(homeNames()[0] ?? 'house-cottage');
  const [playScene, setPlayScene] = useState(playNames()[0] ?? 'forest');
  const [questRoute, setQuestRoute] = useState('');
  const [arena, setArena] = useState('temple-fire');
  const [element, setElement] = useState<Element>('fire');
  const [sprite, setSprite] = useState(SPRITES[0]);
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState('Home');
  const [feedCount, setFeedCount] = useState(0);
  const [questCount, setQuestCount] = useState(0);
  const [activityReceipt, setActivityReceipt] = useState<ActivityReceipt>();
  const [showPlayer, setShowPlayer] = useState(true);

  const me = fighter('challenger', element, sprite);
  const them = fighter('accepter', element === 'fire' ? 'water' : 'fire', SPRITES[1]);

  // A new turn each time the round advances, alternating who swings, so the
  // sequencing and the strike side can both be checked.
  const battle: Battle = {
    id: arena, kind: 'pvp', status: 'active', round,
    challenger: me, accepter: them, winner: null,
    turns: Array.from({ length: round }, (_, i) => ({
      round: i + 1,
      attacker: i % 2 === 0 ? 'challenger' : 'accepter',
      attackerAddress: '', monsterName: 'Doge', move: 'Gust', moveType: 'air',
      moveRarity: 1, missed: i % 5 === 4, shieldDamage: 3, healthDamage: 8 + i,
      statsChanged: {}, superEffective: i % 3 === 0, notEffective: false,
      attackerState: {} as never, defenderState: {} as never,
    })),
  } as unknown as Battle;

  const sel = 'bg-raised text-ink border border-edge rounded px-2 py-1 text-sm';

  return (
    <div className="min-h-screen bg-void p-6 text-ink" data-element={element}>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-xl font-semibold">Scene sandbox</h1>

        <div className="flex flex-wrap gap-2">
          <select className={sel} value={sprite} onChange={(e) => setSprite(e.target.value)}>
            {SPRITES.map((s, i) => <option key={s} value={s}>sheet {i + 1}</option>)}
          </select>
          <select className={sel} value={element} onChange={(e) => setElement(e.target.value as Element)}>
            {['fire', 'water', 'rock', 'air'].map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['Home', 'Play', 'Quest', 'Battle'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={sel} value={home} onChange={(e) => setHome(e.target.value)} title="Home scene">
            {homeNames().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={sel} value={playScene} onChange={(e) => setPlayScene(e.target.value)} title="Play scene">
            {playNames().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={sel} value={questRoute} onChange={(e) => setQuestRoute(e.target.value)} title="Quest route">
            <option value="">auto rotation</option>
            {questRoutes().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={sel} value={arena} onChange={(e) => setArena(e.target.value)}>
            {arenaNames().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className={sel} onClick={() => setRound((r) => r + 1)}>
            play round {round + 1}
          </button>
          <button className={sel} onClick={() => { setStatus('Home'); setFeedCount((n) => n + 1); }}>
            replay feed {feedCount}
          </button>
          <button className={sel} onClick={() => setShowPlayer((on) => !on)}>
            {showPlayer ? 'hide player' : 'show player'}
          </button>
          <button className={sel} onClick={() => setStatus('Play')}>enter play</button>
          <button className={sel} onClick={() => setStatus('Quest')}>enter quest</button>
          <button
            className={sel}
            onClick={() => {
              setStatus('Home');
              setActivityReceipt({
                id: `play:${Date.now()}`, kind: 'Play', rewards: { happiness: 25 },
              });
            }}
          >
            claim play
          </button>
          <button
            className={sel}
            onClick={() => {
              setStatus('Home');
              setQuestCount((count) => count + 1);
              setActivityReceipt({
                id: `quest:${Date.now()}`, kind: 'Quest', rewards: { exp: 1, lootbox: 2 },
              });
            }}
          >
            claim quest
          </button>
        </div>

        <section>
          <h2 className="eyebrow mb-2">Room — {status}</h2>
          <div className="max-w-2xl">
            <RoomStage
              monster={{
                ...monster(element, sprite, status),
                totalTimesFed: feedCount,
                totalTimesQuest: questCount,
              }}
              playerSpriteUrl={showPlayer ? PLAYER_SHEET : undefined}
              activityReceipt={activityReceipt}
              homeOverride={home}
              playOverride={playScene}
              questOverride={questRoute || undefined}
            />
          </div>
        </section>

        <section>
          <h2 className="eyebrow mb-2">Battle — {arena}</h2>
          <div className="max-w-2xl">
            <BattleStageImpl battle={battle} me={me} them={them} />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The whole Arena screen, inside the real Shell, against a fabricated fight.
 *
 * The battle layout has to fit one viewport with nothing scrolling, and that is
 * a property of the assembled page -- the stage, the two fighter cards, the
 * move grid and the log all competing for the same height. It cannot be checked
 * on the pieces separately, and a real fight needs a wallet, a Rune and an
 * opponent. So the screen is mounted here with a battle handed straight to it.
 */
function ArenaPage() {
  const [round, setRound] = useState(3);
  // ?ended=1 shows the decided state, so the outcome swap can be checked
  // without playing a fight to the end.
  const [ended, setEnded] = useState(
    new URLSearchParams(location.search).get('ended') === '1',
  );
  const { me, them, turns } = fakeFight(round, ended);
  const battle = {
    id: 'sandbox', kind: 'house', status: ended ? 'ended' : 'active', round,
    challenger: me, accepter: them,
    // Whoever is still standing, so the outcome panel and the slumped fighter
    // agree — a fixture that declared a winner independently of the fight
    // showed "Victory" over the corpse of the player who won.
    winner: ended ? (me.healthPoints > 0 ? 'challenger' : 'accepter') : null,
    startedAt: 0,
    turns,
  };
  const value = {
    address: 'challenger', connecting: false,
    connect: async () => {}, disconnect: async () => {}, hasWallet: true,
    player: {
      address: 'challenger', exists: true, unlocked: true, faction: 'Sky Nomads',
      monster: monster('fire', SPRITES[0], 'Battle'),
      inventory: { rune: 9 }, lootboxes: [], battlesRemaining: 3,
      wins: 2, losses: 1, questsCompleted: 0, joinedAt: 0, dailyReadyAt: 0,
      assets: {}, battle, sessionWins: 1, sessionLosses: 0,
    },
    loadingPlayer: false, loginError: null, refresh: async () => {},
    factions: [], leaderboard: [], catalog: null,
    tuning: {
      attackBase: 1, variance: 0.15, hpPerHealth: 12, shieldPerDefense: 4,
      healPerPoint: 0.04, shieldRegenShare: 0.2, moveUses: 3, struggleDamage: 2,
      baseHitChance: 0.7, minHitChance: 0.3, maxHitChance: 0.95,
      criticalChance: 0.09, criticalMultiplier: 1.6,
    },
    challenges: [], refreshChallenges: async () => {},
    busy: false, isPending: () => false, run: async () => null,
    processId: 'sandbox', node: 'sandbox',
  };
  return (
    <GameContext.Provider value={value as never}>
      <button
        className="fixed bottom-3 right-3 z-50 rounded border border-edge bg-raised px-3 py-1 text-sm"
        onClick={() => setRound((r) => r + 1)}
      >
        round {round + 1}
      </button>
      <button
        className="fixed bottom-3 right-28 z-50 rounded border border-edge bg-raised px-3 py-1 text-sm"
        onClick={() => setEnded((e) => !e)}
      >
        {ended ? 'un-end' : 'end it'}
      </button>
      {/* The route matters: Shell reads the path to decide whether this page
          owns the viewport, and /arena is one that now does. */}
      <MemoryRouter initialEntries={['/arena']}>
        <Shell><Arena /></Shell>
      </MemoryRouter>
    </GameContext.Provider>
  );
}

/**
 * A fake fight that behaves like a real one.
 *
 * The stage's job is now sequencing — shields drained before health, the
 * killing blow drawn before the outcome, the turns in the order the process
 * resolved them — and none of that can be checked against turns whose
 * `attackerState` is an empty object. This plays a deterministic fight forward
 * `rounds` rounds and hands back exactly the shape battle.lua would: per-turn
 * shield and health damage split the way `applyDamage` splits it, a snapshot
 * after each swing, and shield regen between rounds.
 *
 * `finish` makes the last swing lethal, which is the case worth staring at:
 * the killing blow can be the only turn of its round or the second of two, and
 * both have to draw the damage before the fight is declared over.
 */
function fakeFight(rounds: number, finish: boolean) {
  const me = fighter('challenger', 'fire', SPRITES[0]);
  const them = fighter('accepter', 'water', SPRITES[1]);
  for (const c of [me, them]) {
    c.healthPoints = 132; c.maxHealthPoints = 132;
    c.shield = 24; c.maxShield = 24;
  }

  const snap = (c: Combatant) => ({
    side: c.side, name: c.name,
    healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
    shield: c.shield, maxShield: c.maxShield,
    attack: c.attack, defense: c.defense, speed: c.speed,
    elementType: c.elementType,
  });

  const turns: unknown[] = [];
  for (let r = 1; r <= rounds; r += 1) {
    // Alternated, so both orders show up and the log and the stage can be
    // checked against each other.
    const order = r % 2 === 1 ? [me, them] : [them, me];
    for (let i = 0; i < order.length; i += 1) {
      const a = order[i];
      const d = a === me ? them : me;
      const lethal = finish && r === rounds && i === order.length - 1;
      const missed = !lethal && (r * 3 + i) % 7 === 0;

      let shieldDamage = 0;
      let healthDamage = 0;
      if (!missed) {
        // Deliberately larger than the shield now and then, so the two-step
        // drain (shield to zero, then the overflow off health) is visible.
        const raw = lethal ? d.shield + d.healthPoints : 8 + ((r * 5 + i * 7) % 17);
        shieldDamage = Math.min(raw, d.shield);
        d.shield -= shieldDamage;
        healthDamage = Math.max(0, raw - shieldDamage);
        d.healthPoints = Math.max(0, d.healthPoints - healthDamage);
      }

      turns.push({
        round: r, attacker: a.side, attackerAddress: '', monsterName: a.name,
        move: i === 0 ? 'Ember' : 'Gust',
        moveType: i === 0 ? 'fire' : 'air',
        moveRarity: 1, missed, shieldDamage, healthDamage,
        statsChanged: {},
        // Every readout the stage has to draw, on a cycle short enough to see
        // all of them: a crit, a super-effective hit, a resisted one, a miss.
        critical: !missed && r % 4 === 1 && i === 0,
        superEffective: !missed && r % 3 === 0,
        notEffective: !missed && r % 5 === 2,
        attackerState: snap(a), defenderState: snap(d),
      });

      if (d.healthPoints <= 0) break;
    }
    for (const c of [me, them]) {
      if (c.healthPoints > 0) c.shield = Math.min(c.maxShield, c.shield + 1);
    }
  }

  return { me, them, turns: turns as never };
}

function CompanionPage() {
  const home = new URLSearchParams(location.search).get('state') === 'home';
  const me = fighter('challenger', 'fire', SPRITES[0]);
  const them = fighter('accepter', 'water', SPRITES[1]);
  const battle = {
    id: 'peek', kind: 'bot', status: 'active', round: 2,
    challenger: me, accepter: them, winner: null, startedAt: 0, turns: [],
  };
  const value = {
    address: 'challenger', connecting: false,
    connect: async () => {}, disconnect: async () => {}, hasWallet: true,
    player: {
      address: 'challenger', exists: true, unlocked: true, faction: 'Sky Nomads',
      monster: monster('fire', SPRITES[0], home ? 'Home' : 'Battle'),
      inventory: {
        rune: 9, fire_berry: 5, water_berry: 5, air_berry: 5, rock_berry: 5,
      },
      lootboxes: [], battlesRemaining: 3,
      wins: 2, losses: 1, questsCompleted: 0, joinedAt: 0, dailyReadyAt: 0,
      assets: {}, ...(home ? {} : { battle }),
    },
    loadingPlayer: false, loginError: null, refresh: async () => {},
    factions: [], leaderboard: [], catalog: null, tuning: {},
    challenges: [], refreshChallenges: async () => {},
    busy: false, isPending: () => false, run: async () => null,
    processId: 'sandbox', node: 'sandbox',
  };
  return (
    <GameContext.Provider value={value as never}>
      <MemoryRouter initialEntries={['/companion']}>
        <Shell><Companion /></Shell>
      </MemoryRouter>
    </GameContext.Provider>
  );
}

/** The Collection with one active companion and several switchable cards. */
function CollectionPage() {
  const make = (
    id: string,
    name: string,
    element: Element,
    sprite: string,
    status: Monster['status']['type'] = 'Home',
  ): Monster => ({
    ...monster(element, sprite, status),
    id,
    name,
    level: Number(id.replace(/\D/g, '')) || 1,
    status: {
      type: status,
      since: Date.now() - 60_000,
      until_time: status === 'Home' ? Date.now() : Date.now() + 2_700_000,
    },
  });
  const lead = make('m1', 'Ember', 'fire', SPRITES[0]);
  const collection = {
    m2: make('m2', 'Ripple', 'water', SPRITES[1]),
    m3: make('m3', 'Pebble', 'rock', SPRITES[3]),
    m4: make('m4', 'Zephyr', 'air', SPRITES[2]),
    m5: make('m5', 'Cinder', 'fire', SPRITES[0]),
    m6: make('m6', 'Marina', 'water', SPRITES[1]),
    m7: make('m7', 'Boulder', 'rock', SPRITES[3]),
  };
  const [sandboxPlayer, setSandboxPlayer] = useState({
    address: 'challenger', exists: true, unlocked: true, faction: 'Sky Nomads',
    activeId: lead.id, monster: lead,
    monsters: { [lead.id]: lead },
    collection: collection as Record<string, Monster>, rosterMax: 1,
    inventory: {
      rune: 9, air_berry: 6, water_berry: 6, fire_berry: 6, rock_berry: 6,
    },
    lootboxes: [], battlesRemaining: 0,
    wins: 2, losses: 1, questsCompleted: 7, joinedAt: 0, dailyReadyAt: 0,
    assets: {},
  });
  const run = async (key: string) => {
    const id = key.startsWith('collection-switch:') ? key.slice('collection-switch:'.length) : '';
    const nextMonster = sandboxPlayer.collection[id as keyof typeof sandboxPlayer.collection];
    if (!nextMonster || !sandboxPlayer.monster) return null;
    const current = sandboxPlayer.monster;
    const nextCollection = { ...sandboxPlayer.collection } as Record<string, Monster>;
    delete nextCollection[id];
    nextCollection[current.id] = current;
    const next = {
      ...sandboxPlayer,
      activeId: nextMonster.id,
      monster: nextMonster,
      monsters: { [nextMonster.id]: nextMonster },
      collection: nextCollection,
    };
    setSandboxPlayer(next);
    return next;
  };
  const value = {
    address: 'challenger', connecting: false,
    connect: async () => {}, disconnect: async () => {}, hasWallet: true,
    player: sandboxPlayer,
    loadingPlayer: false, loginError: null, refresh: async () => {},
    factions: [], leaderboard: [], catalog: {
      hunt: {
        protocol: 'runerealm-hunt/1', levelRange: 5, searchCooldown: 3000,
        entry: { berries: {
          fire_berry: 5, water_berry: 5, air_berry: 5, rock_berry: 5,
        } },
        capture: {
          minRuneBid: 1, maxRuneBid: 5, minChance: 5, maxChance: 95,
          baseChance: 15, runeScale: 120, runeHalf: 5, levelStep: 3,
        },
      },
    }, tuning: {},
    challenges: [], refreshChallenges: async () => {},
    busy: false, isPending: () => false, run,
    processId: 'sandbox', node: 'sandbox',
  };
  return (
    <GameContext.Provider value={value as never}>
      <MemoryRouter initialEntries={['/collection']}>
        <Shell><Collection /></Shell>
      </MemoryRouter>
    </GameContext.Provider>
  );
}

/** The post-victory binding desk, without playing a whole encounter to reach it. */
function CapturePage() {
  const hunter = { ...monster('fire', SPRITES[0], 'Hunt'), id: 'm1', name: 'FireFox', level: 8 };
  const wild = { ...monster('water', SPRITES[1], 'Home'), id: 'h1-e1', name: 'WaterDoge', level: 8 };
  const tuning = {
    protocol: 'runerealm-hunt/1' as const, levelRange: 5, searchCooldown: 3000,
    entry: { berries: {
      fire_berry: 5, water_berry: 5, air_berry: 5, rock_berry: 5,
    } },
    capture: {
      minRuneBid: 1, maxRuneBid: 5, minChance: 5, maxChance: 95,
      baseChance: 15, runeScale: 120, runeHalf: 5, levelStep: 3,
    },
  };
  const value = {
    address: 'challenger', connecting: false,
    connect: async () => {}, disconnect: async () => {}, hasWallet: true,
    player: {
      address: 'challenger', exists: true, unlocked: true, faction: 'Inferno Blades',
      activeId: hunter.id, monster: hunter, monsters: { [hunter.id]: hunter },
      hunt: {
        protocol: 'runerealm-hunt/1', status: 'roaming', runId: 'h1', ticket: 'ticket-h1',
        playerId: 'challenger', monsterId: hunter.id, processId: 'sandbox'.padEnd(43, '_'),
        openedAt: Date.now(),
      },
      inventory: { rune: 5 }, lootboxes: [], battlesRemaining: 0,
      wins: 0, losses: 0, questsCompleted: 0, joinedAt: 0, dailyReadyAt: 0, assets: {},
    },
    loadingPlayer: false, loginError: null, refresh: async () => {},
    factions: [], leaderboard: [], catalog: { hunt: tuning }, tuning: {},
    challenges: [], refreshChallenges: async () => {},
    busy: false, isPending: () => false, run: async () => null,
    processId: 'sandbox', node: 'sandbox',
  };
  return (
    <ToastProvider>
      <GameContext.Provider value={value as never}>
        <div className="relative min-h-screen bg-void" data-element="water">
          <CaptureChoice hunter={hunter} wild={wild} tuning={tuning} onRun={() => {}} />
        </div>
      </GameContext.Provider>
    </ToastProvider>
  );
}

/**
 * The acquisition ceremony without a wallet or a write.
 *
 * `?page=acquisition&element=water&kind=capture` lets every elemental variant
 * and both pieces of reusable copy be reviewed without issuing companions just
 * to reach the reveal. Production still mounts it only from a finished reply.
 */
function AcquisitionPage() {
  const query = new URLSearchParams(location.search);
  const requested = query.get('element');
  const element: Element = ['fire', 'water', 'air', 'rock'].includes(requested ?? '')
    ? requested as Element : 'fire';
  const kind: AcquisitionKind = query.get('kind') === 'capture' ? 'capture' : 'adoption';
  const sprite = SPRITES[['fire', 'air', 'water', 'rock'].indexOf(element)];
  const names: Record<Element, string> = {
    fire: 'FireFox', water: 'WaterDoge', air: 'Airbud', rock: 'Rockpup',
  };
  const creature: Monster = {
    ...monster(element, sprite, 'Home'),
    name: names[element],
    elementType: element,
    moves: fighter('challenger', element, sprite).moves,
  };
  const [show, setShow] = useState(true);

  return (
    <div className="grid min-h-screen place-items-center bg-void" data-element={element}>
      {!show && (
        <button
          className="rounded border border-element/50 bg-raised px-4 py-2 text-sm text-ink"
          onClick={() => setShow(true)}
        >
          Replay {kind}
        </button>
      )}
      {show && (
        <CompanionAcquisition monster={creature} kind={kind} onComplete={() => setShow(false)} />
      )}
    </div>
  );
}

const page = new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')!).render(
  page === 'arena' ? <ArenaPage />
    : page === 'companion' ? <CompanionPage />
      : page === 'collection' || page === 'party' ? <CollectionPage />
      : page === 'capture' ? <CapturePage />
      : page === 'acquisition' ? <AcquisitionPage />
        : <App />,
);
