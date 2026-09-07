/**
 * The move grid and the turn log — the two controls a fight is played through.
 *
 * These were written for the arena and lived inside `screens/Arena.tsx`. Hunt
 * fights the same battle: the same `Battle` record, produced by the same
 * `battle.lua` engine, resolved by the same `Battle.resolveRound`, with the
 * same moves, the same type chart and the same struggle rule. The only things
 * hunt changes are how you get INTO the fight, what happens after it, and who
 * the opponent is.
 *
 * So the fight itself is one implementation, here, and both screens mount it.
 * Hunt used to carry a hand-written four-button grid that showed a name, a
 * count and a raw power number — no badge art, no damage estimate, no stat
 * riders, no matchup, no lit field behind the cells, and no round log at all.
 * Same engine, different game to look at. That is what this file removes.
 *
 * The one thing that is parameterised is HOW a move is submitted: the arena
 * signs `Battle.Attack` against the game process through `GameProvider.run`,
 * hunt signs `Hunt.Attack` against its own worker. Everything else — including
 * which cells are pressable, what a cell says, and how a round is drawn — is
 * shared by construction.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Affinity, Combatant, Move, Tuning, Turn } from '../lib/types';
import { Button, Panel, Spinner, cx } from './primitives';
import {
  Droplet, Flame, Heart, Mountain, Shield, Sword, Wind,
} from './icons';
import { Fighter, attackFloor, matchup, moveDamage, riderPoints } from '../lib/format';
import { MoveBadge, hasMoveBadge } from './MoveBadge';
import { MoveTiles } from './MoveTiles';

/**
 * A move, dressed as its type.
 *
 * Colour and glyph come from the move's own type, so a roster reads as a set of
 * things before it reads as a list of words — which is the point of a four-move
 * hand you pick from under pressure. `boost`, `heal` and `normal` are not
 * elements and get their own three.
 */
export const MOVE_LOOK: Record<
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
 * Neither column scrolls. A roster is three moves, so three cells a side fit
 * the band by construction; an inner scrollbar here only ever meant something
 * was mis-sized.
 *
 * THIS GRID IS THE ROSTER AND ONLY THE ROSTER. Rally and Mend used to sit in a
 * second row underneath, which put what every companion in the realm can do in
 * the same object as what THIS one happens to have rolled — five cells that
 * looked alike, two of which were free and carried once. They are studs on the
 * arena floor now, beside each fighter's own health and shield; see `FreeStuds`
 * in `ui/BattleStageImpl.tsx`.
 */
export function MoveChooser({
  me, them, disabled, busy, tuning, isPending, onMove, footer,
}: {
  me: Combatant; them: Combatant;
  disabled: boolean; busy: boolean; tuning: Tuning;
  /** Whether the signature for this move name is currently in flight. */
  isPending: (name: string) => boolean;
  /**
   * Submit one move as one full round.
   *
   * The caller owns the round number it sends with it — the arena and the hunt
   * worker both refuse a move tagged for a round that already resolved, which
   * is what stops a double-click choosing your following move for you.
   */
  onMove: (name: string) => void;
  /** Anything that belongs under the two rosters, such as a PvP wait notice. */
  footer?: React.ReactNode;
}) {
  /**
   * Rarest first, matching the card.
   *
   * Both orders are stable for the whole fight -- a roster does not change
   * mid-battle and neither term of the comparison does either -- so this costs
   * nothing in muscle memory and buys the same reading the card gives: the cell
   * you look at first is the move worth looking at first. `byRarity` is shared
   * so the two sides cannot drift.
   */
  const byRarity = ([aName, a]: [string, Move], [bName, b]: [string, Move]) =>
    (a.rarity ?? 3) - (b.rarity ?? 3) || aName.localeCompare(bName);
  const mine = useMemo(
    () => Object.entries(me.moves ?? {}).sort(byRarity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.moves],
  );
  const theirs = useMemo(
    () => Object.entries(them.moves ?? {}).sort(byRarity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [them.moves],
  );
  const anyLeft = mine.some(([, m]) => (m.count ?? 0) > 0);

  return (
    <Panel className="battle-moves min-h-0 p-2" data-tour="battle-moves">
      {/* One lit field behind both rosters — see gfx/moveTiles.ts. The buttons
          are real buttons on top of it; the objects are only ever underneath. */}
      <MoveTiles className="grid min-h-0 grid-cols-1 items-stretch gap-x-3 gap-y-2 sm:grid-cols-2">
      <div className="grid min-h-0 gap-1.5">
        <div className="grid min-h-0 grid-cols-3 gap-1.5">
          {mine.map(([name, move]) => (
            <MoveButton
              key={name} name={name} move={move}
              fighter={me} tuning={tuning}
              against={them.elementType}
              busy={isPending(name)}
              disabled={disabled || (move.count ?? 0) <= 0 || busy}
              onClick={() => onMove(name)}
            />
          ))}
        </div>
        {/* Rally and Mend are NOT here any more — they are studs on the arena
            floor, under each fighter's own readout (see `FreeStuds` in
            BattleStageImpl). They were five cells that looked alike, two of
            which were free, carried once per battle and belonged to every
            companion in the realm rather than to this one; nothing about that
            was legible from a grid position. On the plate they sit beside the
            health and the shield they spend, on the fighter they belong to, and
            the opponent's pair is readable at a glance for the same reason
            their roster is.

            Struggle stays, because it IS a roster fact: it is the move you have
            when the three above are spent, and it is legal at no other time. */}
        {!anyLeft && (
          <Button
            className="w-full" size="sm" variant="danger"
            disabled={disabled || busy}
            busy={isPending('struggle')}
            onClick={() => onMove('struggle')}
          >
            Every move is spent — struggle
          </Button>
        )}
      </div>

      {/* Theirs. Dimmed as a set and not focusable, so "you cannot press these"
          is carried by how they look rather than by a caption. */}
      <div className="grid min-h-0 gap-1.5 border-l border-edge/40 pl-3 opacity-55">
        <div className="grid min-h-0 grid-cols-3 gap-1.5">
          {theirs.map(([name, move]) => (
            <MoveButton
              key={name} name={name} move={move}
              fighter={them} tuning={tuning}
              against={me.elementType}
              busy={false} disabled readOnly
              onClick={() => {}}
            />
          ))}
        </div>
      </div>

        {footer && <div className="col-span-full flex justify-end">{footer}</div>}
      </MoveTiles>
    </Panel>
  );
}

/**
 * One move, with everything a decision needs on it.
 *
 * Exported because the battle grid is not the only place a move has to be read
 * carefully: the relearn offer on the companion screen is a choice between
 * three of these, and it has to show the same damage estimate and the same
 * rider values the fight will. Two components would be two sets of numbers, and
 * the numbers are the entire point.
 *
 * `fighter` is the loose `Fighter` rather than a `Combatant` for that reason —
 * a companion sitting at home has no health points or shield, and the two
 * things this reads it for (the damage estimate and the rider scale) are sized
 * against its four stats, which it does have.
 */
/**
 * What the numbers on a move actually DO, spelled out.
 *
 * Exported and shared, because a move is now read in three places — the grid,
 * the relearn offer, and the free-action studs on the arena floor — and the
 * numbers are the entire point. Two implementations would be two sets of them.
 *
 * Every rider on every move in the game applies to whoever USED it — there is
 * no move anywhere that debuffs an opponent — and two of the four do something
 * other than what their name suggests:
 *
 *  - `defense` also moves your SHIELD, by `shieldPerDefense` points per point,
 *    immediately. So `-2 def` is not two of anything coming off your health; it
 *    is eight points of shield gone now.
 *  - `health` is a percentage of YOUR OWN pool, not a flat number — four
 *    percent of max HP per point. A cost can bring you to one HP and never
 *    below it.
 *
 * None of that fits on a control you read under pressure, so the control keeps
 * the short forms and the sentence lives here, on hover.
 */
export function moveExplain({ move, fighter, tuning, against, free }: {
  move: Move; fighter: Fighter; tuning: Tuning;
  against?: Affinity | null; free?: boolean;
}) {
  const spent = (move.count ?? 0) <= 0;
  const match = matchup(move.type, against);
  const hit = move.damage > 0 ? moveDamage(move, fighter, tuning) : 0;
  const riders = (['attack', 'defense', 'speed', 'health'] as const)
    .map((k) => [k, k === 'health' ? move[k] : riderPoints(move[k], fighter, tuning)] as const)
    .filter(([, v]) => v !== 0);
  const healPct = (v: number) => Math.abs(Math.round(v * tuning.healPerPoint * 100));
  return [
    move.damage > 0
      ? `${move.damage} power x (${Math.floor(attackFloor(fighter, tuning))} + ${fighter.attack} attack) = about ${hit} damage, before type and luck`
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
    free
      ? (spent
        ? 'Free action — already spent this battle'
        : 'Free action — once per battle, and it costs no move slot')
      : `${move.count ?? 0} uses left`,
  ].filter(Boolean).join('\n');
}

export function MoveButton({
  name, move, fighter, tuning, against, busy, disabled, readOnly, free, onClick,
}: {
  // The whole fighter, not its attack stat: the engine sizes a damage floor
  // against all four of its stats — see `attackFloor` in lib/format.ts.
  name: string; move: Move; fighter: Fighter; tuning: Tuning;
  against?: Affinity | null;
  busy: boolean; disabled: boolean; readOnly?: boolean;
  /** Rally or Mend: no slot, one charge, and the badge says so instead of a count. */
  free?: boolean;
  onClick: () => void;
}) {
  const spent = (move.count ?? 0) <= 0;
  const match = matchup(move.type, against);
  const look = MOVE_LOOK[move.type] ?? MOVE_LOOK.normal;
  const { Icon } = look;
  /**
   * Riders, in the points this fighter will actually get.
   *
   * A move's printed `+5 speed` is NOT five points and has not been since
   * riders were scaled: the engine multiplies it against a quarter of the
   * fighter's stat budget. Printing the raw number here would put a figure on
   * screen that the player then watches their own stat line disagree with —
   * exactly the class of bug `moveDamage` exists to have fixed, when this cell
   * printed `damage * 5` against an engine multiplying by the attack stat.
   *
   * `health` is left alone: it is not a stat rider at all, it is a share of the
   * user's own HP pool, and the hover text below converts it.
   */
  const riders = (['attack', 'defense', 'speed', 'health'] as const)
    .map((k) => [k, k === 'health' ? move[k] : riderPoints(move[k], fighter, tuning)] as const)
    .filter(([, v]) => v !== 0);
  const hit = move.damage > 0 ? moveDamage(move, fighter, tuning) : 0;

  const explain = moveExplain({ move, fighter, tuning, against, free });

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
          {busy
            ? <Spinner className="h-3 w-3" />
            : free ? (spent ? 'used' : 'free') : `x${move.count ?? 0}`}
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
export function RoundLog({
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
    <Panel className="battle-timeline flex min-h-0 flex-col overflow-hidden p-1.5" data-tour="battle-log">
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
