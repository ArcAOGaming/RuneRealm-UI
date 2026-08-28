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
import { Battle, Combatant, Move, Tuning, Turn } from '../lib/types';
import {
  Button, Panel, SectionTitle, Skeleton, Spinner, cx,
} from '../ui/primitives';
import {
  Droplet, Flame, Heart, Mountain, Refresh, Shield, Sword, Trophy, Users, Wind, X,
} from '../ui/icons';
import { countdown, matchup, moveDamage, shortAddress } from '../lib/format';
import { BattleStage } from '../ui/BattleStage';
import { MoveBadge, hasMoveBadge } from '../ui/MoveBadge';
import { MoveTiles, TYPE_RGB } from '../ui/MoveTiles';
import {
  ChainRound, GAP, RIGHT_PAD, RoundChain, SLOT, mountRoundChain,
} from '../gfx/roundChain';
import { useAether } from '../ui/Aether';

/** How often to check whether the other player has done something. */
const PVP_POLL_MS = 2500;

export default function Arena() {
  const { player, loadingPlayer } = useGame();

  if (loadingPlayer && !player) return <Panel className="h-96 p-6"><Skeleton className="h-full" /></Panel>;
  if (!player?.unlocked) return <Navigate to="/" replace />;
  if (!player.monster) return <Navigate to="/companion" replace />;

  if (player.battle && player.battle.status !== 'pending') return <BattleView />;
  if (player.battle?.status === 'pending') return <AwaitingChallenger />;
  if (player.monster.status.type === 'Battle') return <Lobby />;
  return <Entrance />;
}

// Entering ------------------------------------------------------------------

function Entrance() {
  const { player, run, isPending } = useGame();
  const monster = player!.monster!;
  const runes = player!.inventory.rune ?? 0;
  const busy = monster.status.type !== 'Home';

  const blocked =
    busy ? `Your companion is ${monster.status.type === 'Play' ? 'playing' : 'on a quest'}.`
      : runes < 1 ? 'You need a Rune to enter.'
        : monster.energy < 25 ? 'Not enough energy — feed your companion.'
          : monster.happiness < 25 ? 'Not happy enough — send it out to play.'
            : null;

  return (
    <div className="mx-auto max-w-lg animate-rise">
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

        {blocked && <p className="mt-4 text-[13px] text-warn">{blocked}</p>}

        <Button
          className="mt-6" size="lg" variant="primary"
          disabled={!!blocked} busy={isPending('enter')}
          onClick={() => run('enter', api.enterArena, 'Four battles are yours.')}
        >
          Spend 1 Rune
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
          </div>
          <Button
            variant="quiet" busy={isPending('leave')}
            onClick={() => run('leave', api.leaveArena, 'Back home.')}
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
            onClick={() => run('leave', api.leaveArena, 'Challenge withdrawn.')}
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

  // When a round lands, shake the cards and hit the field behind them.
  //
  // Not on first render: entering a fight should not jolt the page. The
  // shockwave is fired from whichever fighter actually took the hit, so the
  // background ripples outward from the impact rather than from nowhere.
  const lastRound = useRef(battle.round);
  const stageRef = useRef<HTMLDivElement>(null);
  const { shockFrom } = useAether();

  useEffect(() => {
    if (battle.round === lastRound.current) return;
    lastRound.current = battle.round;

    shockFrom(stageRef.current ?? undefined);
  }, [battle.round, battle.turns, shockFrom]);

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
    <div className="battle-screen animate-rise mx-auto flex w-full max-w-5xl flex-col gap-2 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_var(--battle-bottom)]">
      {/* The kind badge and the round counter are gone. Neither changes while
          you are in a fight, the round number is the first thing on the newest
          timeline block anyway, and between them they cost a whole row of a
          screen that now has to hold the fight without scrolling. */}
      <Panel
        ref={stageRef}
        className="battle-stage relative mx-auto flex h-full min-h-0 max-w-full flex-col overflow-hidden p-0"
        style={{ aspectRatio: '384 / 216' }}
      >
        <BattleStage battle={battle} me={me} them={them} fill onSettled={onSettled} className="min-h-0 flex-1 border-0" />
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
            <RoundTimeline
              turns={battle.turns} youAre={me.side}
              // Only once the fight has finished PLAYING — the surge is the
              // victory, and it must not arrive before the blow that earned it.
              outcome={reveal ? (iWon ? 'won' : 'lost') : null}
            />
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

  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
            <span className="text-bad">{moveDamage(move, attack, tuning)}</span>
          )}
          {riders.map(([k, v]) => (
            <span key={k} className={v > 0 ? 'text-good' : 'text-warn'}>
              {v > 0 ? '+' : ''}{v}{k[0]}
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
                onClick={() => run('leave', api.leaveArena, 'Back home.')}>
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
 * The fight so far, drawn as solid blocks — see gfx/roundChain.ts.
 *
 * This replaced a vertical scrolling log of sentences, and then the row of
 * flat cards that replaced that. A log answers "what just happened"; blocks
 * answer "how is it going", which is the question you actually have when
 * choosing the next move — whether their damage is climbing, whether the last
 * three rounds went your way.
 *
 * The renderer draws the bars and this draws the round numbers over them, in
 * the DOM, where they stay real text.
 */
function RoundTimeline({
  turns, youAre, outcome,
}: {
  turns: Turn[];
  youAre: 'challenger' | 'accepter';
  outcome: 'won' | 'lost' | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chainRef = useRef<RoundChain | null>(null);

  const rounds = useMemo<ChainRound[]>(() => {
    const byRound = new Map<number, Turn[]>();
    for (const t of turns) {
      const list = byRound.get(t.round);
      if (list) list.push(t);
      else byRound.set(t.round, [t]);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, list]) => {
        const mine = list.find((t) => t.attacker === youAre);
        const theirs = list.find((t) => t.attacker !== youAre);
        const cost = (t?: Turn) =>
          (t && !t.missed ? t.healthDamage + t.shieldDamage : 0);
        return {
          round,
          mine: cost(mine),
          theirs: cost(theirs),
          mineColour: TYPE_RGB[mine?.moveType ?? 'normal'] ?? TYPE_RGB.normal,
          theirsColour: TYPE_RGB[theirs?.moveType ?? 'normal'] ?? TYPE_RGB.normal,
        };
      });
  }, [turns, youAre]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const chain = mountRoundChain(host);
    // No WebGL and the numbers below carry the history on their own.
    if (!chain) return undefined;
    chainRef.current = chain;

    const measure = () => {
      const r = host.getBoundingClientRect();
      chain.resize(r.width, r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => {
      ro.disconnect();
      chainRef.current = null;
      chain.dispose();
    };
  }, []);

  useEffect(() => {
    chainRef.current?.update(rounds, outcome);
  }, [rounds, outcome]);

  return (
    <Panel className="battle-timeline relative flex min-h-0 flex-col overflow-hidden p-1.5">
      {/* A key, on the left, outside the chain.
          Without it the strip is two rows of coloured blocks and no way to know
          which row is whose — which is exactly how it read: rectangles. The
          bars carry the shape of the fight; these two words say what the shape
          is OF. */}
      <div className="pointer-events-none absolute inset-y-1.5 left-1.5 flex w-8 flex-col justify-between">
        <span className="text-[8px] font-semibold uppercase leading-none tracking-wider text-good">You</span>
        <span className="font-mono text-[8px] leading-none text-faint">dmg</span>
        <span className="text-[8px] font-semibold uppercase leading-none tracking-wider text-bad">Them</span>
      </div>

      <div ref={hostRef} className="relative ml-9 min-h-[48px] flex-1">
        {/* The damage each side dealt, printed ON its own bar. Same slot width
            and gap as the renderer uses, so a number always sits over the block
            it belongs to. */}
        <div
          className="pointer-events-none absolute inset-0 flex items-stretch justify-end"
          style={{ gap: GAP, paddingRight: RIGHT_PAD }}
        >
          {rounds.map((r) => (
            <span
              key={r.round}
              className="flex flex-col items-center justify-between py-px"
              style={{ width: SLOT }}
            >
              <span className="font-mono text-[9px] font-semibold leading-none text-ink">
                {r.mine || '·'}
              </span>
              <span className="font-mono text-[8px] leading-none text-faint">R{r.round}</span>
              <span className="font-mono text-[9px] font-semibold leading-none text-ink">
                {r.theirs || '·'}
              </span>
            </span>
          ))}
        </div>

        {rounds.length === 0 && (
          <p className="absolute inset-0 flex items-center text-[11px] text-faint">
            Nothing has happened yet.
          </p>
        )}
      </div>
    </Panel>
  );
}
