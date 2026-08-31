/**
 * A companion, rendered read-only.
 *
 * The Companion screen keeps its own hero card because that one is interactive
 * — it carries the level-up button and belongs to the player looking at it.
 * This is the other case: SOMEONE ELSE'S companion, drawn from a record that
 * was read rather than signed for. The leaderboard uses it to open a row into
 * the monster behind the name, and the owner tools use it to show what a wallet
 * actually holds, before and after an admin action.
 *
 * Both are only possible because the process publishes every player under their
 * own address, so a card on screen costs one unsigned GET — see `readPlayer` in
 * lib/game.ts.
 *
 * `CoreStat`, `StatusBadge` and `MoveList` live here rather than in
 * Companion.tsx because they are shared with it. The move rendering in
 * particular is not cosmetic: the stored `count` is per battle and the engine
 * multiplies it by `moveUses`, and damage is a function of the companion's
 * attack and the published tuning. Two copies of that arithmetic is two chances
 * to print a number the engine does not agree with.
 */
import { useMemo } from 'react';
import { useGame } from '../state/GameProvider';
import { Monster, Move, Player, Tuning } from '../lib/types';
import { Badge, Bar, Panel, cx } from './primitives';
import { Bolt, Clock, ELEMENT_ICON, Heart, Shield, Sword } from './icons';
import { ELEMENT_LABEL, maxHealth, moveDamage, shortAddress } from '../lib/format';
import { CardPreview } from './CardPreview';
import { Sigil } from './Sigil';

export function CoreStat({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div>
      <div className="eyebrow flex items-center gap-1.5">{icon}{label}</div>
      <div className="mt-0.5 font-mono text-xl tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function StatusBadge({ monster }: { monster: Monster }) {
  const kind = monster.status.type;
  if (kind === 'Home') return <Badge tone="plain">At home</Badge>;
  if (kind === 'Battle') return <Badge tone="warn"><Sword className="h-3 w-3" />In the arena</Badge>;
  if (kind === 'Hunt') return <Badge tone="element"><Clock className="h-3 w-3" />On the hunt</Badge>;
  return <Badge tone="element"><Clock className="h-3 w-3" />{kind === 'Play' ? 'Playing' : 'On a quest'}</Badge>;
}

export function MoveList({ monster }: { monster: Monster }) {
  const { tuning } = useGame();
  const entries = useMemo(
    () => Object.entries(monster.moves ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [monster.moves],
  );
  if (!entries.length) return <p className="text-[13px] text-faint">No moves rolled.</p>;
  return (
    <div className="space-y-2">
      {entries.map(([name, move]) => (
        <MoveRow key={name} name={name} move={move} attack={monster.attack} tuning={tuning} />
      ))}
    </div>
  );
}

function MoveRow({
  name, move, attack, tuning,
}: { name: string; move: Move; attack: number; tuning: Tuning }) {
  const riders = (['attack', 'defense', 'speed', 'health'] as const)
    .map((k) => [k, move[k]] as const)
    .filter(([, v]) => v !== 0);

  return (
    <div className="rounded-[3px] border border-edge/60 bg-void/25 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{name}</span>
        {/* The stored count is per battle; the engine multiplies it by
            `moveUses` when the fight starts. Showing the printed number here
            and the multiplied one in the arena made the same move look like two
            different moves. */}
        <span className="shrink-0 font-mono text-[11px] text-faint">
          &times;{move.count * tuning.moveUses}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="uppercase tracking-wide text-faint">{move.type}</span>
        {move.damage > 0 && (
          <span className="text-bad">{moveDamage(move, attack, tuning)} dmg</span>
        )}
        {riders.map(([k, v]) => (
          <span key={k} className={v > 0 ? 'text-good' : 'text-warn'}>
            {v > 0 ? '+' : ''}{v} {k}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The whole card: who the trainer is, what the companion is, and what it can
 * do. `bare` drops the panel chrome, for a card already sitting inside one — an
 * expanded leaderboard row, say.
 */
export function MonsterCard({
  player, bare, className,
}: { player: Player; bare?: boolean; className?: string }) {
  const { tuning } = useGame();
  const monster = player.monster;

  /**
   * The record. On the companion screen it sits under the card beside the move
   * list; on a leaderboard row it goes BESIDE the card, because with the
   * stats, meters, moves and badges all stripped there is nothing else in that
   * column — and a record placed underneath left a tall empty rectangle next
   * to a tall card.
   */
  const record = monster && (
    <div>
      <div className="eyebrow mb-2">Record</div>
      {/* One column beside a card, two under one. The leaderboard runs three
          cards to a row, which leaves about 150px next to the card — enough
          for "Played 266" or for two columns, not both, and two columns there
          wrapped every other label onto its own line. */}
      <div className={cx('grid gap-x-5 gap-y-2 text-[13px] text-faint', bare ? 'grid-cols-1' : 'grid-cols-2')}>
        <span>Wins <b className="font-mono text-good">{player.wins}</b></span>
        <span>Losses <b className="font-mono text-muted">{player.losses}</b></span>
        <span>Fed <b className="font-mono text-muted">{monster.totalTimesFed}</b></span>
        <span>Played <b className="font-mono text-muted">{monster.totalTimesPlay}</b></span>
        <span>Quests <b className="font-mono text-muted">{monster.totalTimesQuest}</b></span>
        {/* Only where the satchel is actually known. The leaderboard hands
            this component a companion and a win/loss record, not a whole
            account, and printing "Runes 0" for every trainer on the board
            would be a made-up number rather than a missing one. */}
        {player.inventory?.rune !== undefined && (
          <span>Runes <b className="font-mono text-muted">{player.inventory.rune}</b></span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2.5 border-t border-rune/12 pt-3">
        <Sigil address={player.address} size={24} weight={1.7} className="text-rune/70" />
        <code className="font-mono text-[11px] text-faint">
          {shortAddress(player.address, 8)}
        </code>
      </div>
    </div>
  );

  const body = !monster ? (
    <div className="flex items-center gap-3 text-[13px] text-faint">
      <Sigil address={player.address} size={26} weight={1.7} className="text-rune/70" />
      <span>
        {player.faction
          ? `Swore to ${player.faction}, but has not adopted a companion.`
          : 'No faction and no companion yet.'}
      </span>
    </div>
  ) : (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* The whole card, composited by the same builder that mints it —
            not a portrait crop. The level, element and moves are already drawn
            on it, so the badges that used to sit over the thumbnail are gone
            rather than repeated. */}
        <div className="shrink-0 self-center sm:self-start">
          <CardPreview monster={monster} className="w-[168px]" />
        </div>

        <div className="min-w-0 flex-1">
          {/* The element is a badge on the card already, and "At home" is a
              state you can only act on from your own screen — on a row you are
              scrolling past it is noise. The name goes too on `bare`: the
              leaderboard row prints it directly above this, so it was the same
              word twice, four lines apart. */}
          {!bare && (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{monster.name}</h3>
              {(() => {
                const Icon = ELEMENT_ICON[monster.elementType];
                return (
                  <Badge tone="element">
                    {Icon && <Icon className="h-3 w-3" />}{ELEMENT_LABEL[monster.elementType]}
                  </Badge>
                );
              })()}
              <StatusBadge monster={monster} />
            </div>
          )}
          {/* The evolution tiers are gone with the art they named: two of the
              three were unreleased families. */}
          <p className={cx('text-[13px] text-faint', !bare && 'mt-1')}>{monster.faction}</p>

          {/* The four stats are printed on the card itself, under their own
              icons. Repeating them beside it was the same four numbers twice
              in one row. `bare` is the leaderboard; the companion screen keeps
              them because it also shows the HP the engine derives from health,
              which the card has no room for. */}
          {!bare && (
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
              <CoreStat icon={<Sword className="h-3.5 w-3.5" />} label="Attack" value={monster.attack} />
              <CoreStat icon={<Shield className="h-3.5 w-3.5" />} label="Defense" value={monster.defense} />
              <CoreStat icon={<Bolt className="h-3.5 w-3.5" />} label="Speed" value={monster.speed} />
              {/* HP comes from the engine's own constant, published in the
                  catalog — never a number typed in here. */}
              <CoreStat icon={<Heart className="h-3.5 w-3.5" />} label="Health" value={monster.health}
                        sub={`${maxHealth(monster.health, tuning)} HP`} />
            </div>
          )}

          {/* Energy, happiness and experience are things you ACT on — feed it,
              play with it, level it up — and none of those actions exist on a
              stranger's row. On the leaderboard they are three meters that
              cannot be moved, so `bare` drops them; the companion screen keeps
              them, where they are the whole point. */}
          {!bare && (
            <div className="mt-4 space-y-2.5">
              <Bar tone="energy" size="sm" name={`${monster.name} energy`}
                   value={monster.energy} max={100} label="Energy"
                   right={`${monster.energy}/100`} />
              <Bar tone="happy" size="sm" name={`${monster.name} happiness`}
                   value={monster.happiness} max={100} label="Happiness"
                   right={`${monster.happiness}/100`} />
              <Bar tone="exp" size="sm" name={`${monster.name} experience`}
                   value={monster.exp} max={monster.nextLevelExp} label="Experience"
                   right={`${monster.exp}/${monster.nextLevelExp}`} />
            </div>
          )}

          {bare && <div className="mt-4">{record}</div>}
        </div>
      </div>

      {/* No move list on the leaderboard. The card already shows all four with
          their icons, and what a stranger's Guard Break does for +2 attack is
          detail for the companion screen, not for a row you are scrolling
          past. */}
      {!bare && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="eyebrow mb-2">Moves</div>
            <MoveList monster={monster} />
          </div>
          {record}
        </div>
      )}
    </>
  );

  const element = monster?.elementType;
  if (bare) return <div data-element={element} className={className}>{body}</div>;
  return <Panel data-element={element} className={cx('p-5', className)}>{body}</Panel>;
}
