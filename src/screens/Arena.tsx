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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import { Battle, BerryItemId, Combatant, Move, Tuning, Turn } from '../lib/types';
import {
  Button, Panel, SectionTitle, Skeleton, Spinner, cx,
} from '../ui/primitives';
import {
  Droplet, Flame, Heart, Mountain, Refresh, Shield, Sword, Trophy, Users, Wind, X,
} from '../ui/icons';
import {
  BATTLE_BERRIES, countdown, ITEM_NAME, matchup, moveDamage, shortAddress,
} from '../lib/format';
import { BattleStage } from '../ui/BattleStage';
import { MoveBadge, hasMoveBadge } from '../ui/MoveBadge';
import { MoveTiles } from '../ui/MoveTiles';
import { useAether } from '../ui/Aether';
import { ITEM_ART } from '../ui/art';

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

function Entrance() {
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

        <div className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-3 text-left">
          <Cost label="Rune" have={runes} need={1} />
          <Cost label="Energy" have={monster.energy} need={25} />
          <Cost label="Happiness" have={monster.happiness} need={25} />
        </div>

        <div className="mt-6 border-t border-rune/12 pt-5 text-left">
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
  const { player, run, isPending, busy, address, challenges, refreshChallenges } = useGame();
  const [difficulty, setDifficulty] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Free, unsigned, and safe on a timer — this is published state.
  useEffect(() => {
    void refreshChallenges();
    const timer = setInterval(() => { void refreshChallenges(); }, 10_000);
    return () => clearInterval(timer);
  }, [refreshChallenges]);

  const open = (challenges ?? []).filter((c) => c.challenger !== address);
  const remaining = player!.battlesRemaining;

  return (
    <div className="animate-rise space-y-4">
      <Panel className="p-5">
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
        <Panel className="p-5">
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

        <Panel className="p-5">
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

  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refresh(); } finally { inFlight = false; }
    }, PVP_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

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

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const published = await api.readBattle().catch(() => null);
        if (cancelled || !published || published.id !== battleId) return;
        if (published.status !== 'pending') {
          setTaken(true);
          clearInterval(timer);
          void refresh();
        }
      } finally {
        inFlight = false;
      }
    }, PVP_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [battleId, refresh]);

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
  const { player, address, tuning, refresh } = useGame();

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
              battle={battle} me={me} them={them}
              // Every move is locked once the fight is decided, but the grid
              // stays in place while the last blow plays — swapping it for the
              // outcome mid-swing is the jump this avoids.
              disabled={waiting || over} waiting={waiting} tuning={tuning}
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

  useEffect(() => {
    if (!waiting || kind !== 'pvp') return;
    let cancelled = false;
    // One read at a time. A published read settles in about 90ms when the node
    // is idle but takes 20-45 SECONDS while it works through a write backlog,
    // and an unguarded 2.5s interval queues those without bound — each one
    // holding a connection, on exactly the screen where the node is busiest.
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const published = await api.readBattle().catch(() => null);
        if (cancelled || !published || published.id !== id) return;
        if (published.round > round || published.status === 'ended') {
          setBattle(published);
          if (published.status === 'ended') void refresh();
        }
      } finally {
        inFlight = false;
      }
    }, PVP_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [waiting, kind, id, round, setBattle, refresh]);
}

/**
 * A move, dressed as its type.
 *
 * Colour and glyph come from the move's own type, so a roster reads as a set of
 * things before it reads as a list of words — which is the point of a four-move
 * hand you pick from under pressure. `boost`, `heal` and `normal` are not
 * elements and get their own three.
 */
const MOVE_LOOK: Record<
  string,
  { Icon: (p: { className?: string }) => JSX.Element; tint: string; ring: string }
> = {
  fire: { Icon: Flame, tint: 'text-ember', ring: 'border-ember/45 bg-ember/10' },
  water: { Icon: Droplet, tint: 'text-tide', ring: 'border-tide/45 bg-tide/10' },
  air: { Icon: Wind, tint: 'text-gale', ring: 'border-gale/45 bg-gale/10' },
  rock: { Icon: Mountain, tint: 'text-stone', ring: 'border-stone/45 bg-stone/10' },
  boost: { Icon: Shield, tint: 'text-arcane', ring: 'border-arcane/45 bg-arcane/10' },
  heal: { Icon: Heart, tint: 'text-good', ring: 'border-good/45 bg-good/10' },
  normal: { Icon: Sword, tint: 'text-muted', ring: 'border-edge bg-raised/40' },
};

/**
 * What a move's stat riders are called.
 *
 * `+1s` meant nothing on a cell you read under pressure — it could as easily
 * have been seconds or shield. Three letters fit, so three letters it is, and
 * the full word goes in the cell's hover text.
 */
const STAT_SHORT = {
  attack: 'atk', defense: 'def', speed: 'spd', health: 'hp',
} as const;

const STAT_WORD = {
  attack: 'attack', defense: 'defense', speed: 'speed', health: 'health',
} as const;

/**
 * Both rosters, side by side, with nothing explaining them.
 *
 * The headings are gone. "Your move", "what you are up against" and "one move
 * is one full round" were three lines of caption over eight buttons that say
 * what they are, on a screen with no height to spare — and which side is which
 * is already obvious from which one you can press.
 *
 * Neither column scrolls. Four moves is the whole roster, so eight cells fit
 * the band by construction; an inner scrollbar here only ever meant something
 * was mis-sized.
 */
function MoveChooser({
  battle, me, them, disabled, waiting, tuning,
}: {
  battle: Battle; me: Combatant; them: Combatant;
  disabled: boolean; waiting: boolean; tuning: Tuning;
}) {
  const { run, isPending, busy } = useGame();
  const mine = useMemo(
    () => Object.entries(me.moves ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [me.moves],
  );
  const theirs = useMemo(
    () => Object.entries(them.moves ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [them.moves],
  );
  const anyLeft = mine.some(([, m]) => (m.count ?? 0) > 0);

  const swing = useCallback(
    // The round is sent so a click made for this round cannot land on the next
    // one — a double-click used to pick your following move for you.
    (name: string) => run(`attack:${name}`, () => api.attack(battle.id, name, battle.round)),
    [run, battle.id, battle.round],
  );

  return (
    <Panel className="battle-moves min-h-0 p-2">
      {/* One lit field behind both rosters — see gfx/moveTiles.ts. The buttons
          are real buttons on top of it; the objects are only ever underneath. */}
      <MoveTiles className="grid min-h-0 grid-cols-1 items-stretch gap-x-3 gap-y-2 sm:grid-cols-2">
      {anyLeft ? (
        <div className="grid min-h-0 grid-cols-2 gap-1.5">
          {mine.map(([name, move]) => (
            <MoveButton
              key={name} name={name} move={move}
              attack={me.attack} tuning={tuning}
              against={them.elementType}
              busy={isPending(`attack:${name}`)}
              disabled={disabled || (move.count ?? 0) <= 0 || busy}
              onClick={() => swing(name)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-[11px] leading-tight text-muted">
            Every move is spent. All that is left is to struggle.
          </p>
          <Button
            size="sm" variant="danger"
            disabled={disabled || busy}
            busy={isPending('attack:struggle')}
            onClick={() => swing('struggle')}
          >
            Struggle
          </Button>
        </div>
      )}

      {/* Theirs. Dimmed as a set and not focusable, so "you cannot press these"
          is carried by how they look rather than by a caption. */}
      <div className="grid min-h-0 grid-cols-2 gap-1.5 border-l border-edge/40 pl-3 opacity-55">
        {theirs.map(([name, move]) => (
          <MoveButton
            key={name} name={name} move={move}
            attack={them.attack} tuning={tuning}
            against={me.elementType}
            busy={false} disabled readOnly
            onClick={() => {}}
          />
        ))}
      </div>

        {waiting && (
          <div className="col-span-full flex justify-end">
            <WaitingOnOpponent battle={battle} />
          </div>
        )}
      </MoveTiles>
    </Panel>
  );
}

function MoveButton({
  name, move, attack, tuning, against, busy, disabled, readOnly, onClick,
}: {
  name: string; move: Move; attack: number; tuning: Tuning;
  against: Combatant['elementType'];
  busy: boolean; disabled: boolean; readOnly?: boolean; onClick: () => void;
}) {
  const spent = (move.count ?? 0) <= 0;
  const match = matchup(move.type, against);
  const look = MOVE_LOOK[move.type] ?? MOVE_LOOK.normal;
  const { Icon } = look;
  const riders = (['attack', 'defense', 'speed', 'health'] as const)
    .map((k) => [k, move[k]] as const)
    .filter(([, v]) => v !== 0);
  const hit = move.damage > 0 ? moveDamage(move, attack, tuning) : 0;

  /**
   * What the numbers on this cell actually DO, spelled out.
   *
   * Every rider on every move in the game applies to whoever USED it — there is
   * no move anywhere that debuffs an opponent — and two of the four do
   * something other than what their name suggests:
   *
   *  - `defense` also moves your SHIELD, by `shieldPerDefense` points per
   *    point, immediately. So `-2 def` is not two of anything coming off your
   *    health; it is eight points of shield gone now.
   *  - `health` is a percentage of YOUR OWN pool, not a flat number — four
   *    percent of max HP per point. A cost can bring you to one HP and never
   *    below it.
   *
   * None of that fits on a cell you read under pressure, so the cell keeps the
   * short forms and the sentence lives here, on hover.
   */
  const healPct = (v: number) => Math.abs(Math.round(v * tuning.healPerPoint * 100));
  const explain = [
    move.damage > 0
      ? `${move.damage} power x (${tuning.attackBase} + ${attack} attack) = about ${hit} damage, before type and luck`
      : null,
    ...riders.map(([k, v]) => {
      const sign = v > 0 ? '+' : '';
      if (k === 'defense') {
        const shield = Math.abs(v) * tuning.shieldPerDefense;
        return `${sign}${v} defense to you, and ${v > 0 ? '+' : '-'}${shield} shield right now`;
      }
      if (k === 'health') {
        return v > 0
          ? `heals you ${healPct(v)}% of your max health`
          : `costs you ${healPct(v)}% of your max health (never fatal)`;
      }
      return `${sign}${v} ${STAT_WORD[k]} to you, for the rest of the fight`;
    }),
    match ? match.label : null,
    `${move.count ?? 0} uses left`,
  ].filter(Boolean).join('\n');

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={explain}
      // The opponent's roster is information, not a control: it must not be
      // reachable by keyboard as if it were pressable.
      tabIndex={readOnly ? -1 : undefined}
      aria-disabled={readOnly || undefined}
      // Read by MoveTiles to place and light the object underneath. Written as
      // attributes rather than held in state because hover must not re-render
      // eight buttons on every pointer move.
      data-move-tile=""
      data-type={move.type}
      data-spent={spent ? '1' : '0'}
      data-muted={readOnly ? '1' : '0'}
      className={cx(
        'relative flex items-center gap-1.5 rounded-[3px] border px-1.5 py-1 text-left',
        'transition-[transform,opacity] duration-150 disabled:cursor-default',
        // The border is the fallback when there is no WebGL; MoveTiles clears
        // it once the lit objects are behind these.
        spent
          ? 'border-edge/30 opacity-40'
          : readOnly
            ? `${look.ring} bg-transparent`
            : `${look.ring} bg-transparent active:translate-y-px`,
      )}
    >
      {/* The move's own badge, out of the card art, when there is one. The
          type glyph is the fallback for a move whose plate was never drawn —
          see ui/MoveBadge.tsx. */}
      {hasMoveBadge(name) ? (
        <MoveBadge name={name} size={20} className={spent ? 'opacity-70' : undefined} />
      ) : (
        <Icon className={cx('h-4 w-4 shrink-0', spent ? 'text-faint' : look.tint)} />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight">
          {name}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] leading-tight">
          {move.damage > 0 && (
            <span className="text-bad">
              {hit}<span className="ml-0.5 text-[8px] uppercase text-bad/70">dmg</span>
            </span>
          )}
          {riders.map(([k, v]) => (
            <span key={k} className={v > 0 ? 'text-good' : 'text-warn'}>
              {v > 0 ? '+' : ''}{v}
              <span className="ml-0.5 text-[8px] uppercase opacity-70">{STAT_SHORT[k]}</span>
            </span>
          ))}
        </span>
      </span>

      {/* Uses, and under them the matchup. Both are facts about this move
          against THIS opponent, and stacking them puts the two things you
          check last in one place at the edge of the cell rather than leaving
          "weak" adrift in a row of stat riders it has nothing to do with. */}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cx(
          'rounded-[2px] bg-black/70 px-1 py-px font-mono text-[10px]',
          'font-semibold leading-none text-white/90 tabular-nums',
        )}>
          {busy ? <Spinner className="h-3 w-3" /> : `x${move.count ?? 0}`}
        </span>
        {/* `matchup` returns null when neutral, so having a value IS the news.
            Its own label is a sentence — too long for a cell this size. */}
        {match && (
          <span
            className={cx(
              'rounded-[2px] bg-black/60 px-1 py-px text-[9px] font-semibold leading-none',
              match.multiplier > 1 ? 'text-good' : 'text-warn',
            )}
            title={match.label}
          >
            {match.multiplier > 1 ? 'strong' : 'weak'}
          </span>
        )}
      </span>
    </button>
  );
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
// Turn log ------------------------------------------------------------------

/**
 * The fight so far, as a list of what happened, in the order it happened.
 *
 * What was here before was a WebGL bar chart: two rows of coloured rectangles,
 * one per round, sized by damage. It answered "how is it going" in the
 * abstract and answered nothing anyone actually asked — there was no way to
 * tell what a block WAS, and the two-word key on its left did not help.
 *
 * This is the same information as words and numbers, and it is the exact same
 * sequence the arena above plays: one card per round, and inside it one line
 * per turn in resolution order, so the top line is whoever the process gave
 * the first swing to. If the fight shows you moving first, this says you moved
 * first, because both are reading the same `turns` array.
 *
 * Newest on the right, scrolled to the end, so the round you just watched is
 * the one under your eye when you pick the next move.
 */
function RoundLog({
  turns, youAre,
}: { turns: Turn[]; youAre: 'challenger' | 'accepter' }) {
  const rounds = useMemo(() => {
    const byRound = new Map<number, Turn[]>();
    for (const t of turns) {
      const list = byRound.get(t.round);
      if (list) list.push(t);
      else byRound.set(t.round, [t]);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, list]) => ({ round, list }));
  }, [turns]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [rounds.length]);

  return (
    <Panel className="battle-timeline flex min-h-0 flex-col overflow-hidden p-1.5">
      <div className="mb-1 flex shrink-0 items-baseline justify-between gap-2 px-0.5">
        <span className="eyebrow leading-none">Rounds, in order</span>
        <span className="text-[9px] leading-none text-faint">
          top line moved first
        </span>
      </div>

      {rounds.length === 0 ? (
        <p className="flex flex-1 items-center px-0.5 text-[11px] text-faint">
          Nothing has happened yet. Pick a move.
        </p>
      ) : (
        <div
          ref={scroller}
          className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5"
        >
          {rounds.map(({ round, list }, i) => (
            <div
              key={round}
              className={cx(
                'flex w-[136px] shrink-0 flex-col gap-0.5 rounded-[3px] border px-1.5 py-1',
                i === rounds.length - 1
                  ? 'border-element/45 bg-element/5'
                  : 'border-edge/50 bg-void/25',
              )}
            >
              <span className="font-mono text-[9px] leading-none text-faint">
                R{round}
              </span>
              {list.map((t, n) => (
                <TurnLine
                  key={`${t.attacker}-${n}`}
                  turn={t} order={n + 1} mine={t.attacker === youAre}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * One swing.
 *
 * `1` and `2` down the left edge are the order the process resolved them in,
 * spelled out rather than implied, because "who went first" is the single
 * thing about a round that a player checks and the old chart could not say.
 */
function TurnLine({
  turn, order, mine,
}: { turn: Turn; order: number; mine: boolean }) {
  const look = MOVE_LOOK[turn.moveType] ?? MOVE_LOOK.normal;
  const { Icon } = look;
  const damage = turn.shieldDamage + turn.healthDamage;
  const supportive = turn.moveType === 'heal' || turn.moveType === 'boost';

  return (
    <div
      className="flex items-center gap-1 leading-none"
      title={`${mine ? 'You' : 'They'} used ${turn.move}`}
    >
      <span className="w-2 shrink-0 font-mono text-[8px] text-faint">{order}</span>
      <span className={cx(
        'w-[22px] shrink-0 text-[9px] font-semibold uppercase tracking-wide',
        mine ? 'text-good' : 'text-bad',
      )}>
        {mine ? 'You' : 'Foe'}
      </span>
      <Icon className={cx('h-2.5 w-2.5 shrink-0', look.tint)} />
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
        {turn.move}
      </span>
      <span className="flex shrink-0 items-baseline gap-0.5 font-mono text-[10px] tabular-nums">
        {/* A crit is marked before the number, not folded into its colour: the
            number alone cannot say whether a big hit was a good roll or a good
            matchup, and those are two different reasons to change your move. */}
        {turn.critical && !turn.missed && (
          <span className="rounded-[2px] bg-warn/20 px-0.5 text-[8px] font-bold uppercase leading-none text-warn">
            crit
          </span>
        )}
        {turn.missed ? (
          <span className="text-faint">miss</span>
        ) : supportive ? (
          <span className="text-good">buff</span>
        ) : (
          <span className={cx(
            turn.critical ? 'text-warn'
              : turn.superEffective ? 'text-ember'
                : turn.notEffective ? 'text-faint' : 'text-ink',
          )}>
            &minus;{damage}
          </span>
        )}
      </span>
    </div>
  );
}
