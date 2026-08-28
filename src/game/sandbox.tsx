/**
 * A dev harness for the two Phaser scenes.
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
import { Battle, Combatant, Element, Monster } from '../lib/types';
import RoomStage from '../ui/RoomStage';
import BattleStageImpl from '../ui/BattleStageImpl';
import Arena from '../screens/Arena';
import Companion from '../screens/Companion';
import { Shell } from '../ui/Shell';
import { MemoryRouter } from 'react-router-dom';
import { GameContext } from '../state/GameProvider';
import { arenaNames, roomNames } from './assets';

const SPRITES = [
  'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ',
  '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0',
  'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc',
  'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks',
];

const monster = (element: Element, sprite: string, status: string): Monster => ({
  name: 'Doge', image: '', sprite, faction: 'Sky Nomads', elementType: element,
  berryItem: 'air_berry', attack: 5, defense: 5, speed: 5, health: 5,
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
  const [room, setRoom] = useState(roomNames()[0] ?? 'house-cottage');
  const [arena, setArena] = useState('temple-fire');
  const [element, setElement] = useState<Element>('fire');
  const [sprite, setSprite] = useState(SPRITES[0]);
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState('Home');

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
          <select className={sel} value={room} onChange={(e) => setRoom(e.target.value)}>
            {roomNames().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={sel} value={arena} onChange={(e) => setArena(e.target.value)}>
            {arenaNames().map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className={sel} onClick={() => setRound((r) => r + 1)}>
            play round {round + 1}
          </button>
        </div>

        <section>
          <h2 className="eyebrow mb-2">Room — {status}</h2>
          <div className="max-w-2xl">
            <RoomStage monster={monster(element, sprite, status)} />
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
  const me = fighter('challenger', 'fire', SPRITES[0]);
  const them = fighter('accepter', 'water', SPRITES[1]);
  const battle = {
    id: 'sandbox', kind: 'house', status: ended ? 'ended' : 'active', round,
    challenger: me, accepter: them, winner: ended ? 'challenger' : null,
    startedAt: 0,
    turns: Array.from({ length: round }, (_, i) => ({
      round: i + 1,
      attacker: i % 2 === 0 ? 'challenger' : 'accepter',
      attackerAddress: '', monsterName: 'Doge', move: 'Ember', moveType: 'fire',
      moveRarity: 1, missed: false, shieldDamage: 2, healthDamage: 7 + i,
      statsChanged: {}, superEffective: i % 3 === 0, notEffective: false,
      attackerState: {}, defenderState: {},
    })),
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
      healPerPoint: 0.04, shieldRegen: 20, moveUses: 3, struggleDamage: 2,
      baseHitChance: 0.7, minHitChance: 0.3, maxHitChance: 0.95,
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

function CompanionPage() {
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
      monster: monster('fire', SPRITES[0], 'Battle'),
      inventory: { rune: 9 }, lootboxes: [], battlesRemaining: 3,
      wins: 2, losses: 1, questsCompleted: 0, joinedAt: 0, dailyReadyAt: 0,
      assets: {}, battle,
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

const page = new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')!).render(
  page === 'arena' ? <ArenaPage />
    : page === 'companion' ? <CompanionPage />
      : <App />,
);
