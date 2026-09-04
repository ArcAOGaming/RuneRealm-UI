/**
 * The arena.
 *
 * Combat is TURN-BASED, and that is the load-bearing decision here. One signed
 * message is one full round: your swing and the opponent's answer resolve
 * together and come back in the same reply, along with the whole new battle.
 *
 * The alternative — a ticking fight the client polls — does not work on this
 * platform, and the Dumverse port proved it the expensive way. A poll is an
 * unsigned READ, a read schedules nothing, and a process that is never
 * scheduled never advances: their countdown ran to zero and the enemy simply
 * never swung. So there is no clock here, no polling loop against the process,
 * no ready handshake and nothing to babysit.
 *
 * The two places a poll IS correct are both PvP, where the OTHER player's
 * message is what advances things: waiting for somebody to take your challenge,
 * and waiting for them to move. Both read published state, so both are free and
 * neither prompts the wallet.
 *
 * The battle is held in local state seeded from `player.battle`, which the
 * process puts on every reply including login. That is what makes a reload
 * mid-fight survivable — before, a refresh dropped the battle, bounced the
 * player to the lobby, and the only way out was a forfeit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { usePoll } from '../state/usePoll';
import * as api from '../lib/game';
import { Battle, BerryItemId } from '../lib/types';
import {
  Button, Panel, SectionTitle, Skeleton, Spinner, cx,
} from '../ui/primitives';
import {
  Refresh, Sword, Trophy, Users, X,
} from '../ui/icons';
import {
  BATTLE_BERRIES, countdown, ITEM_NAME, shortAddress,
} from '../lib/format';
import { BattleStage } from '../ui/BattleStage';
// The move grid and the round log are shared with Hunt, which fights the exact
// same battle through the exact same engine — see ui/BattleMoves.tsx.
import { MoveChooser, RoundLog } from '../ui/BattleMoves';
import { useAether } from '../ui/aetherContext';
import { ITEM_ART } from '../ui/art';
import { useTourSteps, type TourStep } from '../ui/tourContext';

/** How often to check whether the other player has done something. */
const PVP_POLL_MS = 2500;

export default function Arena() {
  const { player, loadingPlayer } = useGame();

  if (loadingPlayer && !player) return <Panel className="h-96 p-6"><Skeleton className="h-full" /></Panel>;
  if (!player?.unlocked) return <Navigate to="/" replace />;
  if (!player.monster) return <Navigate to="/companion" replace />;

  if (player.battle && player.battle.status !== 'pending') return <BattleView />;
  if (player.battle?.status === 'pending') return <AwaitingChallenger />;
  if (player.battleFleet && player.activeBattleId === player.battleFleet.battleId) {
    return <FleetBattleRecovery />;
  }
  if (player.monster.status.type === 'Battle') return <Lobby />;
  return <Entrance />;
}

// Entering ------------------------------------------------------------------

/**
 * The two walkthroughs this screen has, and why it is two.
 *
 * Before you pay, the questions are what it costs and what berry maxing does.
 * Once you are in a session they are completely different questions — how many
 * fights are left, who you can fight, and what leaving does to the ones you
 * paid for. The tour drops steps whose target is not on screen, so both lists
 * could be one; they are kept apart because a five-step list where three are
 * always missing is not a thing anybody can read and check.
 *
 * **Both lists are part of the arena's rules.** The Rune price, the session
 * size, the energy and happiness gates and the berry-maxing bonus are all
 * stated here in words. Change any of them in `constants.lua` or in the entry
 * handler and these sentences are part of that change.
 */
const ENTRANCE_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-cost"]',
    title: 'What it costs',
    body: 'One Rune buys a session of four battles — the fights inside it are free. Your companion also needs 25 energy and 25 happiness to be let in.',
  },
  {
    target: '[data-tour="arena-berries"]',
    title: 'Berry maxing',
    body: 'Optional, and spent now: three matching berries buy +5 to one stat for all four fights. It never touches your companion’s permanent build.',
  },
  {
    target: '[data-tour="arena-enter"]',
    title: 'Then you are in',
    body: 'The Rune is taken here, once. A session lasts until its four battles are used or you leave the arena.',
  },
];

const LOBBY_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-session"]',
    title: 'Your session',
    body: 'Battles left, and this session’s record. Leaving forfeits whatever is left of it — the Rune is not refunded.',
  },
  {
    target: '[data-tour="arena-trainer"]',
    title: 'Fight a trainer',
    body: 'An opponent built to match your level, from a random faction. A harder one gets a bigger stat budget and is worth more.',
  },
  {
    target: '[data-tour="arena-open"]',
    title: 'Or another player',
    body: 'Post a challenge and wait, or take one that is already open. Both sides spend a battle from their own session.',
  },
];

function Entrance() {
  useTourSteps('arena-entrance', ENTRANCE_TOUR);
  const { player, run, isPending } = useGame();
  const [berry, setBerry] = useState<BerryItemId | undefined>();
  const monster = player!.monster!;
  const runes = player!.inventory.rune ?? 0;
  const busy = monster.status.type !== 'Home';
  const selectedBerry = BATTLE_BERRIES.find((entry) => entry.id === berry);
  const selectedCount = berry ? (player!.inventory[berry] ?? 0) : 0;

  const blocked =
    busy ? `Your companion is ${monster.status.type === 'Play' ? 'playing' : 'on a quest'}.`
      : runes < 1 ? 'You need a Rune to enter.'
        : monster.energy < 25 ? 'Not enough energy — feed your companion.'
          : monster.happiness < 25 ? 'Not happy enough — send it out to play.'
            : selectedBerry && selectedCount < selectedBerry.cost
              ? `You need ${selectedBerry.cost} ${ITEM_NAME[selectedBerry.id]}.`
              : null;

  return (
    <div className="mx-auto max-w-2xl animate-rise">
      <Panel className="p-8 text-center" glow>
        <Sword className="mx-auto h-9 w-9 text-element" />
        <h1 className="mt-4 text-xl font-semibold">Enter the arena</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          One Rune buys a session of four battles. Fights inside a session are
          free — fight a trainer, or challenge another player.
        </p>

        <div data-tour="arena-cost" className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-3 text-left">
          <Cost label="Rune" have={runes} need={1} />
          <Cost label="Energy" have={monster.energy} need={25} />
          <Cost label="Happiness" have={monster.happiness} need={25} />
        </div>

        <div data-tour="arena-berries" className="mt-6 border-t border-rune/12 pt-5 text-left">
          <SectionTitle right={<span className="text-[11px] text-faint">optional · eat 3</span>}>
            Berry maxing
          </SectionTitle>
          <p className="-mt-1 text-[12px] leading-relaxed text-faint">
            Eat three matching berries now for a strong +5 stat boost across all four fights.
            Your companion's permanent build never changes.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <button
              type="button" aria-pressed={!berry} onClick={() => setBerry(undefined)}
              className={cx(
                'min-h-20 rounded-[3px] border px-2 py-2 text-center text-[12px] transition-colors',
                !berry ? 'border-element/60 bg-element/10 text-element' : 'border-edge/70 text-muted hover:text-ink',
              )}
            >
              <span className="mx-auto grid h-9 w-9 place-items-center"><X className="h-4 w-4" /></span>
              No berries
            </button>
            {BATTLE_BERRIES.map((entry) => {
              const held = player!.inventory[entry.id] ?? 0;
              const selected = berry === entry.id;
              return (
                <button
                  key={entry.id} type="button" aria-pressed={selected}
                  disabled={held < entry.cost} onClick={() => setBerry(entry.id)}
                  title={entry.note}
                  className={cx(
                    'relative min-h-20 rounded-[3px] border px-2 py-2 text-center transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-35',
                    selected ? 'border-element/60 bg-element/10 text-element' : 'border-edge/70 text-muted hover:text-ink',
                  )}
                >
                  <img src={ITEM_ART[entry.id]} alt="" className="mx-auto h-9 w-9 object-contain [image-rendering:pixelated]" />
                  <span className="mt-1 block truncate text-[11px]">{ITEM_NAME[entry.id].replace(' Berry', '')}</span>
                  <span className="absolute right-1.5 top-1 font-mono text-[9px] text-faint">×{held}</span>
                </button>
              );
            })}
          </div>
          {selectedBerry && (
            <p className={cx('mt-2 text-center text-[12px]', selectedCount >= selectedBerry.cost ? 'text-muted' : 'text-bad')}>
              Eat {selectedBerry.cost}× {ITEM_NAME[selectedBerry.id]} · {selectedBerry.note}
            </p>
          )}
        </div>

        {blocked && <p className="mt-4 text-[13px] text-warn">{blocked}</p>}

        <Button
          data-tour="arena-enter"
          className="mt-6" size="lg" variant="primary"
          disabled={!!blocked} busy={isPending('enter')}
          onClick={() => run('enter', () => api.enterArena(berry), 'Four battles are yours.')}
        >
          Spend 1 Rune{selectedBerry ? ` + ${selectedBerry.cost}× ${ITEM_NAME[selectedBerry.id]}` : ''}
        </Button>
      </Panel>
    </div>
  );
}

function Cost({ label, have, need }: { label: string; have: number; need: number }) {
  const ok = have >= need;
  return (
    <div className={cx('rounded-[3px] border p-2.5', ok ? 'border-edge/70' : 'border-bad/40 bg-bad/5')}>
      <div className="eyebrow">{label}</div>
      <div className={cx('mt-0.5 font-mono text-sm tabular-nums', ok ? 'text-ink' : 'text-bad')}>
        {have}<span className="text-faint">/{need}</span>
      </div>
    </div>
  );
}

// Lobby ---------------------------------------------------------------------

function Lobby() {
  useTourSteps('arena-lobby', LOBBY_TOUR);
  const { player, run, isPending, busy, address, challenges, refreshChallenges } = useGame();
  const [difficulty, setDifficulty] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Free and unsigned, but not free of a CONNECTION: a bare interval issued a
  // new read every ten seconds whether or not the last one had answered, and
  // on a slow node those stack up on the screen a player is about to click a
  // battle button on. One at a time, next one scheduled from the end of the
  // last, and nothing at all while a write is in flight.
  usePoll((signal) => refreshChallenges(signal), {
    intervalMs: 10_000, maxIntervalMs: 60_000, leading: true,
    paused: () => busy,
  });

  const open = (challenges ?? []).filter((c) => c.challenger !== address);
  const remaining = player!.battlesRemaining;

  return (
    <div className="animate-rise space-y-4">
      <Panel data-tour="arena-session" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">The arena</h1>
            <p className="mt-1 text-sm text-muted">
              {remaining} battle{remaining === 1 ? '' : 's'} left this session ·
              {' '}<span className="text-good">{player!.sessionWins ?? 0}W</span>
              {' '}<span className="text-muted">{player!.sessionLosses ?? 0}L</span>
            </p>
            {player!.arenaBoost && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
                <img src={ITEM_ART[player!.arenaBoost.item]} alt="" className="h-4 w-4 object-contain [image-rendering:pixelated]" />
                {player!.arenaBoost.cost}× {ITEM_NAME[player!.arenaBoost.item]} · +{player!.arenaBoost.amount} {player!.arenaBoost.stat}
              </p>
            )}
          </div>
          <Button
            variant="quiet" busy={isPending('leave')}
            onClick={() => run('leave', api.leaveArena)}
          >
            Leave the arena
          </Button>
        </div>
      </Panel>

      <div className="arena-lobby-grid grid gap-4 lg:grid-cols-2">
        <Panel data-tour="arena-trainer" className="p-5">
          <SectionTitle>Fight a trainer</SectionTitle>
          <p className="text-[13px] leading-relaxed text-muted">
            An opponent is generated to match your level, from a random faction.
            Harder opponents get a bigger stat budget.
          </p>

          <div className="mt-4 flex gap-2">
            {[
              { value: 0.75, label: 'Easy' },
              { value: 1, label: 'Even' },
              { value: 1.4, label: 'Hard' },
              { value: 2, label: 'Brutal' },
            ].map((d) => (
              <button
                key={d.value}
                onClick={() => setDifficulty(d.value)}
                aria-pressed={difficulty === d.value}
                className={cx(
                  'difficulty-button min-h-11 flex-1 rounded-[3px] border px-2 py-2 text-[13px] transition-colors lg:min-h-0',
                  difficulty === d.value
                    ? 'border-element/60 bg-element/10 text-element'
                    : 'border-edge/70 text-muted hover:text-ink',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <Button
            className="mt-4 w-full" variant="primary" size="lg"
            disabled={remaining <= 0 || busy}
            busy={isPending('bot')}
            onClick={() => run('bot', () => api.startBotBattle(difficulty))}
            icon={<Sword className="h-4 w-4" />}
          >
            {remaining <= 0 ? 'No battles left' : 'Begin'}
          </Button>
        </Panel>

        <Panel data-tour="arena-open" className="p-5">
          <SectionTitle right={
            <Button
              size="sm" variant="quiet" busy={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await refreshChallenges();
                setRefreshing(false);
              }}
              icon={<Refresh className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
          }>
            Challenge a trainer
          </SectionTitle>

          <Button
            className="w-full" variant="ghost"
            disabled={remaining <= 0 || busy}
            busy={isPending('challenge')}
            onClick={() => run('challenge', () => api.challenge('OPEN'),
              'Challenge posted. Waiting for a taker.')}
            icon={<Users className="h-4 w-4" />}
          >
            Post an open challenge
          </Button>

          <div className="mt-4">
            {challenges === null ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : open.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-faint">
                Nobody is waiting. Post one and someone will find it.
              </p>
            ) : (
              <div className="space-y-2">
                {open.map((c) => (
                  <div key={c.id} data-element={c.element}
                       className="flex items-center justify-between gap-3 rounded-[3px] border border-edge/60 bg-void/25 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {c.monsterName}{' '}
                        <span className="font-mono text-xs text-faint">lvl {c.level}</span>
                      </div>
                      <div className="font-mono text-[11px] text-faint">
                        {shortAddress(c.challenger, 5)}
                      </div>
                    </div>
                    <Button
                      size="sm" variant="primary"
                      disabled={remaining <= 0 || busy}
                      busy={isPending(`accept:${c.id}`)}
                      onClick={() => run(`accept:${c.id}`, () => api.acceptChallenge(c.id))}
                    >
                      Accept
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * The authority route is durable before the worker's published battle exists,
 * and it can also outlive a temporarily unavailable worker cache. Never turn
 * either state into a second-battle lobby. These are unsigned cache refreshes;
 * cancellation remains the only signed escape hatch and refunds only after a
 * trusted worker acknowledgement.
 */
function FleetBattleRecovery() {
  const { player, refresh, run, isPending, busy } = useGame();
  const route = player!.battleFleet!;
  const hydration = player!.battleFleetHydration;
  const cancelling = route.status === 'cancel-pending' || hydration === 'cancel-pending';

  usePoll(() => refresh(), { intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000 });

  const detail = cancelling
    ? 'Cancellation was delivered. Waiting for the assigned worker to confirm it before restoring your session credit.'
    : hydration === 'invalid'
      ? 'The published worker route did not pass validation. No round will be signed to it.'
      : hydration === 'unavailable'
        ? 'The assigned worker cache is temporarily unavailable. Your reservation remains on the game authority.'
        : 'The assigned worker is opening your battle. This page is reading its published cache only.';

  return (
    <div className="mx-auto max-w-lg animate-rise">
      <Panel className="p-8 text-center" glow>
        <Spinner className="mx-auto h-8 w-8 text-element" />
        <h1 className="mt-4 text-lg font-semibold">
          {cancelling ? 'Cancelling battle' : 'Restoring battle'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{detail}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="quiet" onClick={() => void refresh()} icon={<Refresh className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
          <Button
            variant="ghost" disabled={busy} busy={isPending('leave')}
            onClick={() => run('leave', api.leaveArena)}
          >
            {cancelling ? 'Retry cancellation' : 'Cancel battle'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/**
 * A posted challenge nobody has taken yet.
 *
 * This polls, because the thing it is waiting for is another player's message.
 * It reads published state, so waiting is free; the one signed call is the
 * single `refresh()` at the moment somebody actually accepts.
 */
function AwaitingChallenger() {
  const { player, run, isPending, refresh } = useGame();
  const battleId = player!.battle!.id;
  const [taken, setTaken] = useState(false);

  usePoll(async (signal) => {
    const published = await api.readBattle({ signal });
    if (signal.aborted || !published || published.id !== battleId) return;
    if (published.status !== 'pending') {
      setTaken(true);
      void refresh();
    }
  }, { intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000, enabled: !taken });

  return (
    <div className="mx-auto max-w-lg animate-rise">
      <Panel className="p-8 text-center" glow>
        <Spinner className="mx-auto h-8 w-8 text-element" />
        <h1 className="mt-4 text-lg font-semibold">
          {taken ? 'Someone took it' : 'Waiting for a challenger'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          {taken
            ? 'Opening the fight…'
            : 'Your challenge is posted. Anyone in the arena can take it — the fight begins the moment somebody does. Closing this page loses nothing; the challenge is on-chain.'}
        </p>
        {!taken && (
          <Button
            className="mt-6" variant="quiet"
            busy={isPending('leave')}
            onClick={() => run('leave', api.leaveArena)}
          >
            Withdraw
          </Button>
        )}
      </Panel>
    </div>
  );
}

// The fight -----------------------------------------------------------------

function BattleView() {
  const { player, address, tuning, refresh, run, isPending, busy } = useGame();

  // Local, seeded from the player record. A PvP poll can advance this without a
  // signed round trip; every action of your own replaces it wholesale.
  const [battle, setBattle] = useState<Battle>(player!.battle!);
  const fromPlayer = player?.battle;
  useEffect(() => {
    if (fromPlayer) setBattle(fromPlayer);
  }, [fromPlayer]);

  const iAmChallenger = battle.challenger.address === address;
  const me = iAmChallenger ? battle.challenger : battle.accepter;
  const them = iAmChallenger ? battle.accepter : battle.challenger;
  const over = battle.status === 'ended';

  /**
   * Whether the fight has finished being WATCHED, not merely decided.
   *
   * `over` is true the moment the reply lands, which is before the blow that
   * ended it has been drawn. The stage tells us when it has actually finished
   * playing; until then the move grid stays up and the outcome waits. A stage
   * that never mounts (no WebGL, or a fight restored on load) settles at once.
   */
  const [settled, setSettled] = useState(false);
  const onSettled = useCallback(() => setSettled(true), []);
  useEffect(() => { if (!over) setSettled(false); }, [over]);
  const reveal = over && settled;
  const waiting = !!player!.waitingForOpponent && !over;

  usePvpWatch(battle, waiting, setBattle, refresh);

  // Hit the field behind the arena when a blow CONNECTS.
  //
  // This used to hang off `battle.round` advancing, which is the moment the
  // reply lands — so the page rippled while the attacker was still walking
  // across the floor, and again for a round in which nothing hit. The scene
  // calls this at the frame of impact instead, once per landed blow.
  const stageRef = useRef<HTMLDivElement>(null);
  const { shockFrom } = useAether();
  const onImpact = useCallback(() => {
    shockFrom(stageRef.current ?? undefined);
  }, [shockFrom]);

  // A battling PvP fight always has both sides; guard anyway rather than assert,
  // because a missing side must not take the page down.
  if (!me || !them) {
    return (
      <Panel className="p-8 text-center">
        <Spinner className="mx-auto h-7 w-7 text-element" />
        <p className="mt-3 text-sm text-muted">Setting up the fight…</p>
      </Panel>
    );
  }

  const iWon = over && (
    (iAmChallenger && battle.winner === 'challenger') ||
    (!iAmChallenger && battle.winner === 'accepter')
  );

  return (
    <div className="battle-screen animate-rise mx-auto flex w-full flex-col gap-1.5 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_var(--battle-bottom)]">
      {/* The kind badge and the round counter are gone. Neither changes while
          you are in a fight, the round number is the first thing on the newest
          timeline block anyway, and between them they cost a whole row of a
          screen that now has to hold the fight without scrolling. */}
      {/* Every pixel the row will give it.
          The screen used to be capped at max-w-5xl and the panel pinned to a
          16:9 box inside that, so the arena was 1024 wide on a 1472-wide page
          and the rest was margin. Now the panel takes the whole row and Phaser
          fits the 384x216 buffer into it — the picture is as large as the
          shorter of the two dimensions allows, and because the panel carries no
          frame of its own, whatever is left over reads as page rather than as a
          black border. The readouts are positioned against the CANVAS, so they
          stay on the art wherever it lands. */}
      <Panel
        ref={stageRef}
        className="battle-stage relative flex aspect-[384/216] h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none lg:aspect-auto"
      >
        <BattleStage
          battle={battle} me={me} them={them} fill
          onSettled={onSettled} onImpact={onImpact}
          className="min-h-0 flex-1 border-0"
        />
      </Panel>

      {/* One box of a fixed height holding either the controls or the result.
          They SWAP; nothing resizes. Letting the outcome be its own grid row
          made it push the arena smaller the instant a fight ended — the moment
          you least want the thing you are looking at to jump. */}
      <div className="battle-bottom grid min-h-0 gap-2 lg:grid-rows-[minmax(0,1fr)_auto]">
        {reveal ? (
          <Outcome won={!!iWon} battle={battle} className="row-span-full" />
        ) : (
          <>
            <MoveChooser
              me={me} them={them}
              // Every move is locked once the fight is decided, but the grid
              // stays in place while the last blow plays — swapping it for the
              // outcome mid-swing is the jump this avoids.
              disabled={waiting || over} busy={busy} tuning={tuning}
              isPending={(name) => isPending(`attack:${name}`)}
              // The round is sent so a click made for this round cannot land on
              // the next one — a double-click used to pick your following move
              // for you.
              onMove={(name) => run(
                `attack:${name}`, () => api.attack(battle.id, name, battle.round),
              )}
              footer={waiting ? <WaitingOnOpponent battle={battle} /> : undefined}
            />
            <RoundLog turns={battle.turns} youAre={me.side} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Waiting on the other player.
 *
 * A fight used to stall here forever if they simply closed the tab: their half
 * of the round never arrived, and the only exit was forfeiting — handing the
 * win and the paid session to someone who stopped playing. After the deadline
 * the round can be forced through, with the absent player hesitating.
 */
function WaitingOnOpponent({ battle }: { battle: Battle }) {
  const { player, run, isPending, busy } = useGame();
  const canForceAt = player?.canForceAt ?? 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const forceable = canForceAt > 0 && now >= canForceAt;

  if (forceable) {
    return (
      <Button
        size="sm" variant="ghost" disabled={busy}
        busy={isPending('force')}
        // The move name is ignored once you have already committed this round —
        // the process uses your existing commitment, so the client never has to
        // remember a choice it is deliberately not shown.
        onClick={() => run('force', () => api.attack(battle.id, 'continue'))}
      >
        They have gone quiet — play the round anyway
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-[13px] text-muted">
      <Spinner className="h-3.5 w-3.5" />
      Waiting for their move
      {canForceAt > 0 && (
        <span className="text-faint">
          · can continue without them in {countdown(canForceAt - now)}
        </span>
      )}
    </span>
  );
}

/**
 * While the opponent has yet to move, poll the published battle.
 *
 * `/now/battle` returns whichever battle the process last computed, so the id is
 * checked before anything is believed — with two fights running, the other one
 * lands here constantly. The new battle is applied locally, so a round landing
 * costs no signature; only the end of the fight triggers one `refresh()`, to
 * pick up the win, the loot and the session count.
 */
function usePvpWatch(
  battle: Battle,
  waiting: boolean,
  setBattle: (b: Battle) => void,
  refresh: () => Promise<void>,
) {
  const { id, round, kind } = battle;

  // One read at a time, and the next one scheduled from the end of the last. A
  // published read settles in about 90ms when the node is idle but takes 20-45
  // SECONDS while it works through a write backlog, so a fixed 2.5s interval is
  // an arrival rate an order of magnitude above the service rate — an unbounded
  // queue, each entry holding one of six connections, on exactly the screen
  // where the node is busiest. The read is also aborted the moment the round
  // moves on or the screen unmounts.
  usePoll(async (signal) => {
    const published = await api.readBattle({ signal });
    if (signal.aborted || !published || published.id !== id) return;
    if (published.round > round || published.status === 'ended') {
      setBattle(published);
      if (published.status === 'ended') void refresh();
    }
  }, {
    intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000,
    enabled: waiting && kind === 'pvp',
  });
}


function Outcome({
  won, battle, className,
}: { won: boolean; battle: Battle; className?: string }) {
  const { player, run, isPending, busy } = useGame();
  const remaining = player!.battlesRemaining;

  return (
    <Panel className={cx(
      'battle-outcome flex min-h-0 items-center justify-center gap-5 px-6 py-3 text-center',
      won && 'shadow-glow', className,
    )}>
      {won ? <Trophy className="h-8 w-8 shrink-0 text-good" />
           : <X className="h-8 w-8 shrink-0 text-muted" />}
      <div className="min-w-0 text-left">
      <h2 className="text-xl font-semibold">
        {won ? 'Victory' : 'Defeated'}
      </h2>
      <p className="mt-0.5 text-[13px] text-muted">
        {won
          ? `${battle.round} rounds. +2 experience and a loot box.`
          : `${battle.round} rounds. +1 experience for the trouble.`}
      </p>

      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
        {remaining > 0 ? (
          <Button
            variant="primary" busy={isPending('bot')} disabled={busy}
            onClick={() => run('bot', () => api.startBotBattle(1))}
            icon={<Sword className="h-4 w-4" />}
          >
            Next battle ({remaining} left)
          </Button>
        ) : (
          <p className="text-[13px] text-faint">Session over. Spend another Rune to keep going.</p>
        )}
        <Button variant="quiet" busy={isPending('leave')} disabled={busy}
                onClick={() => run('leave', api.leaveArena)}>
          Leave the arena
        </Button>
        <Link
          to="/companion"
          className="inline-flex h-10 items-center rounded-[3px] px-4 text-sm text-muted transition-colors hover:text-ink"
        >
          Your companion
        </Link>
      </div>
    </Panel>
  );
}
