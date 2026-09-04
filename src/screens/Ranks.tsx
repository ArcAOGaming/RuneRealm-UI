/**
 * Standings.
 *
 * Served entirely from published state — the process writes the whole board on
 * every message — so this screen costs nothing and never prompts the wallet.
 *
 * Every companion is drawn as a card, and the cards are already here: the board
 * carries each trainer's whole monster, moves included, in the same blob the
 * provider was polling anyway. The first version of this screen read
 * `player-<address>` when a row was clicked open, which is one request per
 * trainer, each able to sit behind a write backlog for tens of seconds — fifty
 * of those to fill one screen. Nothing on this page fetches anything now.
 *
 * The top three are ranked in metal and the rest are numbered, because a
 * leaderboard whose first three places look like the fortieth is a table with
 * extra steps.
 */
import { useMemo, useState } from 'react';
import { useGame } from '../state/gameContext';
import { Badge, Panel, SectionTitle, Skeleton, cx } from '../ui/primitives';
import { ELEMENT_ICON, Sword, Trophy } from '../ui/icons';
import { ELEMENT_LABEL, shortAddress } from '../lib/format';
import { Sigil } from '../ui/Sigil';
import { Element, LeaderboardRow, Player } from '../lib/types';
import { MonsterCard } from '../ui/MonsterCard';

type Sort = 'level' | 'wins' | 'quests';

/**
 * The three metals, and nothing else in the palette moves for them.
 *
 * This is the one deliberate exception to "all chroma belongs to an element":
 * first, second and third are not elemental facts and colouring them by
 * element would say the wrong thing. They are hex rather than tokens for the
 * same reason — gold is gold, not a themeable role.
 */
const MEDAL: Record<number, { name: string; hex: string }> = {
  1: { name: 'Gold', hex: '#e8b93b' },
  2: { name: 'Silver', hex: '#b9c2cc' },
  3: { name: 'Bronze', hex: '#c9793f' },
};

/**
 * A board row, shaped as the partial player the card wants.
 *
 * Deliberately NOT given an inventory: a leaderboard row knows a companion and
 * a win/loss record and nothing about anybody's satchel, and the card hides the
 * fields it is not given rather than printing a zero for them.
 */
const asPlayer = (r: LeaderboardRow): Player => ({
  address: r.address,
  unlocked: true,
  faction: r.faction,
  monster: r.monster,
  inventory: {},
  gold: 0,
  lootboxes: [],
  battlesRemaining: 0,
  wins: r.wins,
  losses: r.losses,
  questsCompleted: r.quests,
  joinedAt: 0,
  dailyReadyAt: 0,
});

export default function Ranks({ embedded = false }: { embedded?: boolean }) {
  const { leaderboard, factions, address } = useGame();
  const [sort, setSort] = useState<Sort>('level');
  const [filter, setFilter] = useState<Element | 'all'>('all');

  const rows = useMemo(() => {
    if (!leaderboard) return null;
    const filtered = filter === 'all'
      ? leaderboard
      : leaderboard.filter((r) => r.element === filter);
    return [...filtered].sort((a, b) => {
      if (sort === 'wins') return b.wins - a.wins || b.level - a.level;
      if (sort === 'quests') return b.quests - a.quests || b.level - a.level;
      return b.level - a.level || b.wins - a.wins;
    });
  }, [leaderboard, sort, filter]);

  const podium = rows?.slice(0, 3) ?? [];
  const rest = rows?.slice(3) ?? [];

  return (
    <div className={cx('space-y-4', !embedded && 'animate-rise')}>
      <header>
        {embedded && <p className="eyebrow mb-2">The realm at a glance</p>}
        <h1 className={cx('font-semibold tracking-tight', embedded ? 'text-3xl' : 'text-2xl')}>
          {embedded ? 'Faction standings' : 'Standings'}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Every companion in the realm, ranked — stats, bars and moves and all.
        </p>
      </header>

      {factions && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {factions.map((f) => (
            <Panel key={f.name} data-element={f.element} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{f.name}</span>
                {(() => { const I = ELEMENT_ICON[f.element]; return <I className="h-4 w-4 shrink-0 text-element" />; })()}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl tabular-nums">{f.monsterCount}</span>
                <span className="text-xs text-faint">companions</span>
              </div>
              <div className="mt-1 text-[11px] text-faint">
                avg level {f.averageLevel.toFixed(1)} · {f.totalTimesQuest} quests
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
          {(['fire', 'water', 'air', 'rock'] as Element[]).map((e) => (
            <FilterChip key={e} element={e} active={filter === e} onClick={() => setFilter(e)}>
              {ELEMENT_LABEL[e]}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="eyebrow mr-1">Rank by</span>
          {(['level', 'wins', 'quests'] as Sort[]).map((s) => (
            <button
              key={s} onClick={() => setSort(s)}
              className={cx(
                'sort-chip min-h-11 rounded-[3px] px-2 py-1 text-[11px] uppercase tracking-wide transition-colors lg:min-h-0',
                sort === s ? 'bg-raised text-ink' : 'text-faint hover:text-muted',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </Panel>

      {!rows ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className="p-5"><Skeleton className="h-56 w-full" /></Panel>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Panel className="p-10">
          <p className="text-center text-[13px] text-faint">Nobody here yet.</p>
        </Panel>
      ) : (
        <>
          {/* The podium is one row of three. It used to give the winner the
              full width and pair second with third, which said the standing
              through the shape of the page — but a full-width card holding one
              small companion card and a six-line record was mostly empty
              space. First place is still marked, by its medal and its glow. */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {podium.map((r, i) => (
              <RankCard key={r.address} row={r} rank={i + 1} you={r.address === address} />
            ))}
          </div>

          {rest.length > 0 && (
            <>
              <SectionTitle right={
                <span className="font-mono text-xs text-faint">{rest.length} more</span>
              }>
                The field
              </SectionTitle>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rest.map((r, i) => (
                  <RankCard key={r.address} row={r} rank={i + 4} you={r.address === address} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One trainer: the standing, then the companion that earned it. */
function RankCard({ row, rank, you }: { row: LeaderboardRow; rank: number; you: boolean }) {
  const medal = MEDAL[rank];
  const Icon = ELEMENT_ICON[row.element];

  return (
    <Panel
      data-element={row.element}
      glow={rank === 1}
      className={cx('relative overflow-hidden p-5', you && 'ring-1 ring-element/40')}
      style={medal ? { borderColor: `${medal.hex}55` } : undefined}
    >
      {medal && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-[0.13] blur-3xl"
          style={{ background: medal.hex }}
        />
      )}

      <div className="relative mb-4 flex flex-wrap items-center gap-3">
        <RankChip rank={rank} />
        {/* The trainer's mark.
            An address is 43 characters of base64 and nobody remembers one, so
            the board used to be a column of `iQuZaC…6txQCk`. The sigil is drawn
            from that same address and is unique to it — it is the closest thing
            this game has to a face, and it belongs at the top of the row rather
            than at 20px in a corner. */}
        <Sigil
          address={row.address}
          size={30}
          weight={1.9}
          plate
          title={`The mark of ${shortAddress(row.address, 6)}`}
          className={you ? 'text-element' : 'text-rune/75'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-element" />
            <span className="truncate text-sm font-medium">{row.name}</span>
            {you && <Badge tone="element">You</Badge>}
          </div>
          <div className="font-mono text-[11px] text-faint">{shortAddress(row.address, 6)}</div>
        </div>
        {/* Their own row, full width. Sharing a line with the name worked at
            one card per row and does not at three: the tallies held their size
            and the name gave way, so the board showed "R." and "F." where the
            trainers' names should be. */}
        <div className="flex w-full items-center justify-between gap-3 text-[11px] text-faint">
          <Tally label="Level" value={row.level} />
          <Tally label="Wins" value={row.wins} tone="text-good" />
          <Tally label="Losses" value={row.losses} />
          <Tally label="Quests" value={row.quests} />
        </div>
      </div>

      {row.monster ? (
        <MonsterCard player={asPlayer(row)} bare />
      ) : (
        // A process deployed before the board carried companions. Say so rather
        // than rendering an empty card and letting it read as a broken one.
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Sword className="h-3.5 w-3.5" />
          This process publishes standings without companion detail.
        </p>
      )}
    </Panel>
  );
}

function RankChip({ rank }: { rank: number }) {
  const medal = MEDAL[rank];
  if (!medal) {
    return (
      <span className={cx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px]',
        'border border-edge bg-void/40 font-mono text-sm tabular-nums text-muted',
      )}>
        {rank}
      </span>
    );
  }
  return (
    <span
      title={`${medal.name} — ${rank === 1 ? 'first' : rank === 2 ? 'second' : 'third'}`}
      className={cx(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] border px-2.5',
        'font-mono text-sm tabular-nums',
      )}
      style={{ borderColor: `${medal.hex}66`, background: `${medal.hex}14`, color: medal.hex }}
    >
      <Trophy className="h-3.5 w-3.5" />
      {rank}
    </span>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div className={cx('font-mono text-sm tabular-nums', tone ?? 'text-muted')}>{value}</div>
    </div>
  );
}

function FilterChip({
  children, active, element, onClick,
}: { children: React.ReactNode; active: boolean; element?: Element; onClick: () => void }) {
  return (
    <button
      data-element={element}
      onClick={onClick}
      className={cx(
        'filter-chip min-h-11 min-w-11 rounded-[3px] border px-3 py-1 text-[12px] transition-colors lg:min-h-0 lg:min-w-0',
        active
          ? 'border-element/60 bg-element/10 text-element'
          : 'border-edge/70 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
