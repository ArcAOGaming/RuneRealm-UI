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
  Button, Panel, SectionTitle, Skeleton, Spinner, TransactionHold, cx,
} from '../ui/primitives';
import {
  Bolt, Check, Coin, Heart, Refresh, Shield, Sword, Trophy, Users, X,
} from '../ui/icons';
import {
  arenaTerms, arenaTierRows, countdown, formatInteger, ratePct,
  BATTLE_BERRIES, ITEM_NAME, shortAddress,
  type ArenaTerms,
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
  const { player, loadingPlayer, catalog } = useGame();

  if ((loadingPlayer && !player) || !catalog) {
    return <Panel className="h-96 p-6"><Skeleton className="h-full" /></Panel>;
  }
  if (!player?.unlocked) return <Navigate to="/" replace />;
  if (!player.monster) return <Navigate to="/companion" replace />;

  if (player.matchmaking) return <MatchmakingWait />;
  if (player.battle && player.battle.status !== 'pending') return <BattleView />;
  if (player.battle?.status === 'pending') return <AwaitingChallenger />;
  if (player.battleFleet && player.activeBattleId === player.battleFleet.battleId) {
    return <FleetBattleRecovery />;
  }
  if (player.activeBattleId) return <MonolithBattleRecovery />;
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
 * **Both lists are part of the arena's rules.** That entry is free, the
 * session size, the energy and happiness gates and the berry-maxing bonus are
 * all stated here in words. Change any of them in `constants.lua` or in the entry
 * handler and these sentences are part of that change.
 */
const ENTRANCE_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-purse"]',
    title: 'Step 1 — fund all four fights',
    body: 'You must hold 40 Gold so the full run cannot strand you halfway through. The gate deducts nothing: each fight stakes its own 10 only when it starts, and unused fights are never charged.',
  },
  {
    target: '[data-tour="arena-cost"]',
    title: 'Step 1 — ready your companion',
    body: 'Opening four battle slots costs 25 energy and 25 happiness once. The before-and-after bars show exactly what will remain. Happiness only comes back from a 15-minute play.',
  },
  {
    target: '[data-tour="arena-berries"]',
    title: 'Step 2 — pick a boost',
    body: 'Optional, and spent now: three matching berries buy +5 to one stat for all four fights. It never touches your companion’s permanent build.',
  },
  {
    target: '[data-tour="arena-enter"]',
    title: 'Step 3 — choose the battle',
    body: 'Continue to choose either a PvE trainer or a live PvP duel. The energy and happiness are taken here once; no Gold moves until you start or post a fight.',
  },
];

const LOBBY_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-session"]',
    title: 'Step 3 — choose a battle',
    body: 'Battles left, this session’s record, your purse, and your player-level PvP Elo. Leaving forfeits whatever is left of the session — the energy and happiness are not refunded, but no Gold is taken for a battle you did not fight.',
  },
  {
    target: '[data-tour="arena-pays"]',
    title: 'How Gold moves',
    body: 'The 40-Gold entry check guaranteed all four fights, but it charged nothing. Each fight now stakes 10 when it starts. A win adds 0–5 Gold from the 20-hour allowance to its pot payout; a loss leaves the 10 in the pot.',
  },
  {
    target: '[data-tour="arena-tiers"]',
    title: 'Four pots, one per difficulty',
    body: 'Every tier stakes the same Gold; what differs is the pot. A win draws a third of the pot it staked into, so a tier people have been LOSING pays more — the losses fed it. Nothing about your own record changes what a win pays.',
  },
  {
    target: '[data-tour="arena-breakeven"]',
    title: 'Break even, and whether a tier is worth it',
    body: 'Break-even is the win rate at which the pot pays back what you stake. Beside it is how often this tier is actually being won. When the second number is above the first, the tier is good value right now — and both move as people play it.',
  },
  {
    target: '[data-tour="arena-open"]',
    title: 'Rated or practice',
    body: 'Find Match pairs you by Elo and companion level, widening fairly for up to five minutes. Only those automatic matches change Elo. Open challenges are unranked duels. Both use one pot of two 10-Gold stakes, winner takes all, and cancelling a waiting search refunds the held stake.',
  },
];

function Entrance() {
  useTourSteps('arena-entrance', ENTRANCE_TOUR);
  const { player, catalog, run, isPending, writePhase } = useGame();
  const [berry, setBerry] = useState<BerryItemId | undefined>();
  const monster = player!.monster!;
  const busy = monster.status.type !== 'Home';
  const selectedBerry = BATTLE_BERRIES.find((entry) => entry.id === berry);
  const selectedCount = berry ? (player!.inventory[berry] ?? 0) : 0;

  // Every cost and every payout on this screen, from the process. Nothing here
  // is a literal any more: two of the three that were had already drifted from
  // the deployed contract by the time anyone checked.
  const terms = arenaTerms(catalog);
  const gold = player!.gold ?? 0;
  const requiredGold = terms.sessionStake;
  const ready = !busy
    && monster.energy >= terms.energyCost
    && monster.happiness >= terms.happinessCost
    && (!terms.staked || gold >= requiredGold);
  const boostComplete = !selectedBerry || selectedCount >= selectedBerry.cost;

  // The Gold gate is the PROCESS's — `Battle.Begin` refuses a purse that cannot
  // cover every battle in the run. `sessionStake` is derived from the same
  // published stake and battle count, so the client cannot drift to a looser
  // gate and sign a session the process will refuse.
  const blocked =
    busy ? `Your companion is ${monster.status.type === 'Play' ? 'playing' : 'on a quest'}.`
      : monster.energy < terms.energyCost ? 'Not enough energy — feed your companion.'
        : monster.happiness < terms.happinessCost ? 'Not happy enough — send it out to play.'
          : terms.staked && gold < requiredGold
            ? `You need ${requiredGold} Gold to fund all ${terms.battles} fights — ${requiredGold - gold} more. Each fight only charges ${terms.stake} when it starts.`
            : selectedBerry && selectedCount < selectedBerry.cost
              ? `You need ${selectedBerry.cost} ${ITEM_NAME[selectedBerry.id]}.`
              : null;
  const blockedCta =
    busy ? 'Companion is busy'
      : monster.energy < terms.energyCost ? 'Need energy / Feed first'
        : monster.happiness < terms.happinessCost ? 'Need happiness / Play first'
          : terms.staked && gold < requiredGold ? `Need ${requiredGold - gold} more Gold`
            : selectedBerry && selectedCount < selectedBerry.cost ? `Need ${selectedBerry.cost} ${ITEM_NAME[selectedBerry.id]}`
              : null;

  return (
    <div className="arena-entry-screen mx-auto flex h-full min-h-0 w-full max-w-3xl items-center animate-rise">
      <Panel className="arena-entry-panel flex min-h-0 w-full flex-col overflow-hidden p-3 sm:p-4 lg:p-5" glow>
        <header className="arena-entry-hero flex min-w-0 items-center gap-3 border-b border-rune/12 pb-3">
          <ArenaCrest />
          <div className="min-w-0">
            <div className="eyebrow text-element">Arena preparation</div>
            <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">Prepare your arena run</h1>
          </div>
        </header>

        <section data-tour="arena-cost" className={cx(
          'arena-entry-step arena-entry-ready min-w-0 border-b border-rune/12 py-3',
          ready ? 'arena-entry-step--complete' : 'arena-entry-step--blocked',
        )}>
          <ArenaStepNumber value={1} complete={ready} blocked={!ready} />
          <div className="arena-step-content min-w-0">
          <div className="arena-step-heading flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold">Ready</h2>
            <span className="font-mono text-[9px] text-faint">
              {terms.staked ? `${requiredGold} Gold required / ${terms.stake} charged each fight` : '0 Gold entry'}
            </span>
          </div>
          <div className="arena-ready-grid mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <ResourceCost icon={Bolt} label="Energy" have={monster.energy} need={terms.energyCost} tone="energy" />
            <ResourceCost icon={Heart} label="Happiness" have={monster.happiness} need={terms.happinessCost} tone="happy" />
            {terms.staked && (
              <div
                data-tour="arena-purse"
                className={cx(
                  'arena-purse col-span-2 flex min-w-[10.5rem] items-center gap-3 rounded-[3px] border bg-void/25 px-3 py-2 sm:col-span-1',
                  gold >= requiredGold ? 'border-edge/70' : 'border-bad/40 bg-bad/5',
                )}
              >
                <Coin className={cx('h-6 w-6 shrink-0', gold >= requiredGold ? 'text-rune' : 'text-bad')} />
                <div className="min-w-0 flex-1">
                  <div className="eyebrow">Purse</div>
                  <div className={cx('font-mono text-xl font-medium leading-tight tabular-nums', gold >= requiredGold ? 'text-ink' : 'text-bad')}>
                    {formatInteger(gold)}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[8px] text-faint">
                    {gold >= requiredGold ? 'Full run funded' : `${requiredGold - gold} Gold short`}
                  </div>
                </div>
              </div>
            )}
          </div>

          </div>
        </section>

        <section data-tour="arena-berries" className={cx(
          'arena-entry-step arena-entry-boost min-w-0 border-b border-rune/12 py-3',
          boostComplete ? 'arena-entry-step--complete' : 'arena-entry-step--blocked',
        )}>
          <ArenaStepNumber value={2} complete={boostComplete} blocked={!boostComplete} />
          <div className="arena-step-content min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-semibold">Pick a boost</h2>
            <span className="font-mono text-[10px] text-faint">optional / 3 berries = +5</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button" aria-pressed={!berry} onClick={() => setBerry(undefined)}
              title="Enter without a temporary stat boost"
              className={cx(
                'arena-berry-button relative grid min-h-14 place-items-center rounded-[3px] border px-1 py-1.5 transition-colors',
                !berry ? 'border-element/60 bg-element/10 text-element' : 'border-edge/70 text-muted hover:text-ink',
              )}
            >
              <X className="h-4 w-4" />
              <span className="text-[9px] uppercase tracking-wide">None</span>
            </button>
            {BATTLE_BERRIES.map((entry) => {
              const held = player!.inventory[entry.id] ?? 0;
              const selected = berry === entry.id;
              const Icon = BERRY_STAT_ICON[entry.stat];
              const element = entry.id.replace('_berry', '');
              return (
                <button
                  key={entry.id} type="button" aria-pressed={selected}
                  disabled={held < entry.cost} onClick={() => setBerry(entry.id)}
                  title={`${ITEM_NAME[entry.id]}: ${entry.note}. ${held} held.`}
                  data-element={element}
                  className={cx(
                    'arena-berry-button relative grid min-h-14 place-items-center rounded-[3px] border px-1 py-1.5 transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-30',
                    selected ? 'border-element/70 bg-element/10 text-element' : 'border-edge/70 text-muted hover:border-element/45 hover:text-ink',
                  )}
                >
                  <img src={ITEM_ART[entry.id]} alt="" className="h-7 w-7 object-contain [image-rendering:pixelated]" />
                  <span className="flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide">
                    <Icon className="h-2.5 w-2.5" />
                    {STAT_SHORT[entry.stat]}
                  </span>
                  <span className="absolute right-1 top-0.5 font-mono text-[8px] text-faint">×{held}</span>
                </button>
              );
            })}
          </div>
          <div className={cx(
            'mt-2 min-h-4 text-center font-mono text-[10px]',
            selectedBerry
              ? selectedCount >= selectedBerry.cost ? 'text-element' : 'text-bad'
              : 'text-faint',
          )}>
            {selectedBerry ? selectedBerry.note : 'No boost selected'}
          </div>
          </div>
        </section>

        <footer className={cx(
          'arena-entry-step arena-entry-action min-w-0 pt-3',
          blocked ? 'arena-entry-step--blocked' : 'arena-entry-step--active',
        )}>
          <ArenaStepNumber value={3} blocked={!!blocked} />
          <div className="arena-step-content flex min-w-0 flex-col items-stretch gap-2">
          <div className="arena-step-heading flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold">Start battle</h2>
            <span className="font-mono text-[9px] text-faint">PvE trainer or live PvP</span>
          </div>
          {blocked ? (
            <div className="arena-entry-blocked flex min-w-0 flex-1 items-center gap-2 border-l border-warn/55 bg-warn/[.055] px-3 py-2 text-[11px] text-warn">
              <X className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate sm:whitespace-normal">{blocked}</span>
            </div>
          ) : (
            <span className="sr-only">Ready to continue.</span>
          )}
          <Button
            data-tour="arena-enter"
            className="w-full shrink-0" size="lg" variant="primary"
            disabled={!!blocked} busy={isPending('enter')}
            onClick={() => run('enter', () => api.enterArena(berry), 'Four battles are yours.')}
          >
            {blockedCta ?? `Choose PvE or PvP${selectedBerry ? ` / +5 ${STAT_SHORT[selectedBerry.stat]}` : ''}`}
          </Button>
          {writePhase('enter') === 'settling' && (
            <TransactionHold className="min-w-0 flex-1">
              The gate is opening.
            </TransactionHold>
          )}
          <div className="arena-run-count mt-0.5 flex items-center justify-center gap-3 border-t border-rune/10 pt-2">
            <div className="w-24"><BattlePips total={terms.battles} lit={terms.battles} label={`${terms.battles} battles in this run`} /></div>
            <span className="flex items-baseline gap-1.5">
              <strong className="carve font-mono text-xl font-medium tabular-nums text-element">{terms.battles}</strong>
              <span className="eyebrow">fights in this run</span>
            </span>
          </div>
          </div>
        </footer>
      </Panel>
    </div>
  );
}

const STAT_SHORT = {
  attack: 'ATK', defense: 'DEF', speed: 'SPD', health: 'HP',
} as const;

const BERRY_STAT_ICON = {
  attack: Sword, defense: Shield, speed: Bolt, health: Heart,
} as const;

function ArenaCrest() {
  return (
    <div className="arena-crest relative grid h-14 w-14 shrink-0 place-items-center" aria-hidden>
      <Sword className="relative z-[1] h-6 w-6 text-element" />
    </div>
  );
}

function ArenaStepNumber({
  value, complete, blocked,
}: { value: number; complete?: boolean; blocked?: boolean }) {
  return (
    <div className="arena-step-number relative flex min-h-12 items-start justify-center self-stretch border-r border-rune/12 pr-3 pt-0.5" aria-hidden>
      <span className={cx(
        'carve font-mono text-5xl font-medium leading-none tabular-nums',
        blocked ? 'text-bad' : complete ? 'text-good' : 'text-element',
      )}>{value}</span>
      {complete && <Check className="arena-step-check absolute h-8 w-8 text-good" />}
    </div>
  );
}

function ArenaGoldRules({ terms }: { terms: ArenaTerms }) {
  return (
    <div data-tour="arena-pays" className="arena-lobby-gold-rules mt-2 border-t border-rune/10 pt-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Gold rules</h2>
        <span className="text-[9px] text-faint">{terms.stake} charged only when each fight starts</span>
      </div>
      <div className="arena-gold-rules grid grid-cols-4 gap-1.5">
        <GoldRule icon={Coin} label="Entry" value="0" note="Gold charged" />
        <GoldRule icon={Sword} label="Stake" value={`${terms.stake}`} note="Gold / battle" />
        <GoldRule icon={Trophy} label="Win" value={`0–${terms.winGold}`} note="Gold + pot" good />
        <GoldRule icon={Shield} label="Loss" value={terms.staked ? `−${terms.stake}` : '0'} note="to pot / +1 XP" />
      </div>
    </div>
  );
}

function GoldRule({
  icon: Icon, label, value, note, good,
}: {
  icon: (props: { className?: string }) => JSX.Element;
  label: string; value: string; note: string; good?: boolean;
}) {
  return (
    <div className={cx(
      'arena-gold-rule min-w-0 rounded-[3px] border bg-void/25 px-2 py-2.5 text-center',
      good ? 'border-good/30' : 'border-edge/60',
    )}>
      <Icon className={cx('mx-auto h-5 w-5', good ? 'text-good' : label === 'Entry' || label === 'Stake' ? 'text-rune' : 'text-muted')} />
      <div className="mt-1 truncate font-mono text-[8px] uppercase tracking-wide text-faint">{label}</div>
      <div className={cx('mt-0.5 truncate font-mono text-lg font-medium leading-tight tabular-nums', good ? 'text-good' : 'text-ink')}>{value}</div>
      <div className="mt-0.5 truncate text-[9px] text-faint">{note}</div>
    </div>
  );
}

function ResourceCost({
  icon: Icon, label, have, need, tone,
}: {
  icon: (props: { className?: string }) => JSX.Element;
  label: string; have: number; need: number; tone: 'energy' | 'happy';
}) {
  const ok = have >= need;
  const max = Math.max(100, have, need);
  const after = Math.max(0, have - need);
  const paid = Math.min(have, need);
  const fill = tone === 'energy' ? 'bg-warn' : 'bg-[rgb(236,110,180)]';
  return (
    <div
      className={cx('arena-resource-cost rounded-[3px] border bg-void/20 px-3 py-2.5', ok ? 'border-edge/70' : 'border-bad/40 bg-bad/5')}
      aria-label={`${label}: ${have} available, ${need} spent on entry, ${after} remaining`}
    >
      <div className="flex items-center gap-2">
        <Icon className={cx('h-5 w-5 shrink-0', ok ? tone === 'energy' ? 'text-warn' : 'text-[rgb(236,110,180)]' : 'text-bad')} />
        <span className="eyebrow min-w-0 flex-1 truncate">{label}</span>
        <span className={cx('font-mono text-base font-medium tabular-nums', ok ? 'text-ink' : 'text-bad')}>
          {have}<span className="px-1 text-faint">→</span>{after}
        </span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-[2px] bg-raised">
        <span className={cx('absolute inset-y-0 left-0 opacity-45', fill)} style={{ width: `${(after / max) * 100}%` }} />
        <span
          className={cx('absolute inset-y-0 opacity-90', ok ? fill : 'bg-bad')}
          style={{ left: `${(after / max) * 100}%`, width: `${(paid / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

function BattlePips({ total, lit, label }: { total: number; lit: number; label: string }) {
  const shown = Math.min(total, 8);
  return (
    <span className="flex items-center gap-1" role="img" aria-label={label} title={label}>
      {Array.from({ length: shown }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={cx(
            'h-1.5 min-w-2 flex-1 skew-x-[-18deg] border',
            index < lit ? 'border-element/60 bg-element/65' : 'border-edge/70 bg-raised/60',
          )}
        />
      ))}
    </span>
  );
}

// Lobby ---------------------------------------------------------------------

function Lobby() {
  useTourSteps('arena-lobby', LOBBY_TOUR);
  const {
    player, catalog, arenaTiers, refreshArenaTiers,
    run, isPending, writePhase, busy, address, challenges, refreshChallenges,
  } = useGame();
  const terms = arenaTerms(catalog);
  const rows = arenaTierRows(terms, arenaTiers);
  // The tier is chosen by KEY and the difficulty is sent from the row, so the
  // client never invents a number the process would bucket somewhere else.
  const [tierKey, setTierKey] = useState(() => rows[1]?.key ?? rows[0]?.key ?? 'even');
  const [refreshing, setRefreshing] = useState(false);
  const [pane, setPane] = useState<'trainers' | 'duels'>('trainers');

  // Free and unsigned, but not free of a CONNECTION: a bare interval issued a
  // new read every ten seconds whether or not the last one had answered, and
  // on a slow node those stack up on the screen a player is about to click a
  // battle button on. One at a time, next one scheduled from the end of the
  // last, and nothing at all while a write is in flight.
  //
  // The pots ride along with it. They move on every battle anybody in the realm
  // fights, and this screen quotes a payout off them — a stale pot misprices
  // exactly the decision the player is here to make.
  usePoll(async (signal) => {
    await refreshChallenges(signal);
    await refreshArenaTiers(signal);
  }, {
    intervalMs: 10_000, maxIntervalMs: 60_000, leading: true,
    paused: () => busy,
  });

  const open = (challenges ?? []).filter((c) => c.challenger !== address);
  const remaining = player!.battlesRemaining;
  const gold = player!.gold ?? 0;
  const chosen = rows.find((row) => row.key === tierKey) ?? rows[0];
  const canAfford = !terms.staked || gold >= terms.stake;
  const rating = Math.round(player!.rating ?? terms.ratingStart);
  const ratedMatches = Math.max(0, Math.round(player!.ratedMatches ?? 0));
  const provisional = ratedMatches < terms.ratingProvisionalGames;

  return (
    <div className="arena-lobby-screen mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-2 animate-rise">
      <Panel data-tour="arena-session" className="arena-session-hud shrink-0 px-3 py-2.5 sm:px-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <div
            className="arena-rating-plate grid h-10 min-w-14 place-items-center border border-element/35 bg-element/[.07] px-1.5 text-element"
            aria-label={`PvP rating ${rating}`}
            title={`Player-level rated PvP Elo. ${provisional ? `${terms.ratingProvisionalGames - ratedMatches} provisional matches remain.` : 'Established rating.'}`}
          >
            <span className="font-mono text-[7px] uppercase tracking-[.16em] text-faint">{provisional ? 'PROV' : 'ELO'}</span>
            <span className="flex items-center gap-1 font-mono text-base font-medium leading-none tabular-nums text-element">
              <Trophy className="h-3 w-3" />{rating}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">3 / Battle</h1>
              {player!.arenaBoost && (
                <span className="arena-session-boost flex shrink-0 items-center gap-1 rounded-[2px] border border-element/35 bg-element/[.07] px-1.5 py-0.5 font-mono text-[9px] uppercase text-element"
                      title={`${player!.arenaBoost.cost}× ${ITEM_NAME[player!.arenaBoost.item]} for this session`}>
                  <img src={ITEM_ART[player!.arenaBoost.item]} alt="" className="h-3.5 w-3.5 object-contain [image-rendering:pixelated]" />
                  <span className="arena-session-boost-label">+{player!.arenaBoost.amount} {STAT_SHORT[player!.arenaBoost.stat]}</span>
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 sm:gap-3">
              <div className="w-16 sm:w-32">
                <BattlePips total={terms.battles} lit={remaining} label={`${remaining} battles remaining`} />
              </div>
              <span className="arena-session-fraction font-mono text-[10px] text-faint">{remaining}/{terms.battles}</span>
              <span
                className="whitespace-nowrap font-mono text-[10px] tabular-nums"
                aria-label={`This run: ${player!.sessionWins ?? 0} wins and ${player!.sessionLosses ?? 0} losses`}
                title="This four-fight run's record. Stored on the player account."
              >
                <span className="text-good">{player!.sessionWins ?? 0}W</span>
                <span className="mx-1 text-rune/30">/</span>
                <span className="text-muted">{player!.sessionLosses ?? 0}L</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            {terms.staked && (
              <div className="text-right">
                <div className="eyebrow">Purse</div>
                <div className={cx(
                  'flex items-center justify-end gap-1 font-mono text-sm leading-tight tabular-nums',
                  canAfford ? 'text-ink' : 'text-bad',
                )}>
                  <Coin className={cx('h-3.5 w-3.5', canAfford ? 'text-rune' : 'text-bad')} />
                  {formatInteger(gold)}
                </div>
              </div>
            )}
            <Button
              className="px-2 sm:px-3" size="sm" variant="quiet" busy={isPending('leave')}
              onClick={() => run('leave', api.leaveArena)} title="Leave the arena and forfeit unused battles"
            >
              Leave
            </Button>
          </div>
        </div>
        <ArenaGoldRules terms={terms} />
      </Panel>

      <div className="arena-lobby-tabs grid shrink-0 grid-cols-2 gap-1 lg:hidden" role="tablist" aria-label="Arena opponents">
        <button
          type="button" role="tab" aria-selected={pane === 'trainers'}
          onClick={() => setPane('trainers')}
          className={cx('rounded-[3px] border px-3 py-2 text-[12px]', pane === 'trainers' ? 'border-element/55 bg-element/10 text-element' : 'border-edge/70 text-muted')}
        >
          <span data-tour="arena-tiers" className="flex items-center justify-center gap-2">
            <span data-tour="arena-breakeven" className="flex items-center gap-2">
              <Sword className="h-3.5 w-3.5" /> PvE / Trainers
            </span>
          </span>
        </button>
        <button
          type="button" role="tab" aria-selected={pane === 'duels'}
          onClick={() => setPane('duels')} data-tour="arena-open"
          className={cx('rounded-[3px] border px-3 py-2 text-[12px]', pane === 'duels' ? 'border-element/55 bg-element/10 text-element' : 'border-edge/70 text-muted')}
        >
          <span className="flex items-center justify-center gap-2">
            <Users className="h-3.5 w-3.5" /> PvP / Rated
            {open.length > 0 && <span className="font-mono text-[9px]">{open.length}</span>}
          </span>
        </button>
      </div>

      <div className="arena-lobby-grid grid min-h-0 flex-1 gap-2 lg:grid-cols-2">
        <Panel data-tour="arena-tiers" className={cx(
          'arena-lobby-panel min-h-0 flex-col overflow-hidden p-3 sm:p-4 lg:flex',
          pane === 'trainers' ? 'flex' : 'hidden',
        )}>
          <SectionTitle right={terms.staked
            ? <span className="flex items-center gap-1 font-mono text-[10px] text-faint"><Coin className="h-3 w-3 text-rune" />{terms.stake} stake</span>
            : undefined}>
            PvE trainer
          </SectionTitle>

          {terms.staked ? (
            <TierTable rows={rows} value={tierKey} onPick={setTierKey} terms={terms} />
          ) : (
            <div className="grid flex-1 grid-cols-2 gap-2">
              {rows.map((row, index) => (
                <button
                  key={row.key} onClick={() => setTierKey(row.key)} aria-pressed={tierKey === row.key}
                  className={cx(
                    'difficulty-button grid min-h-11 place-items-center rounded-[3px] border px-2 py-2 text-[13px] transition-colors',
                    tierKey === row.key ? 'border-element/60 bg-element/10 text-element' : 'border-edge/70 text-muted hover:text-ink',
                  )}
                >
                  <DifficultyMarks level={index + 1} />
                  {row.label}
                </button>
              ))}
            </div>
          )}

          {writePhase('bot') === 'settling' && (
            <TransactionHold className="mb-2 mt-auto">Trainer incoming.</TransactionHold>
          )}
          <Button
            className="mt-2 w-full shrink-0" variant="primary" size="lg"
            disabled={remaining <= 0 || busy || !canAfford} busy={isPending('bot')}
            onClick={() => run('bot', () => api.startBotBattle(chosen?.difficulty ?? 1))}
            icon={<Sword className="h-4 w-4" />}
          >
            {remaining <= 0 ? 'No battles left'
              : !canAfford ? `Need ${terms.stake} Gold`
                : terms.staked ? `Fight ${chosen?.label ?? 'Even'} / stake ${terms.stake}` : 'Begin fight'}
          </Button>
        </Panel>

        <Panel data-tour="arena-open" className={cx(
          'arena-lobby-panel min-h-0 flex-col overflow-hidden p-3 sm:p-4 lg:flex',
          pane === 'duels' ? 'flex' : 'hidden',
        )}>
          <SectionTitle right={
            <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-element">
              <Trophy className="h-3 w-3" /> {rating} Elo
              {provisional && <span className="text-faint">/ provisional</span>}
            </span>
          }>
            Rated duel
          </SectionTitle>

          {terms.staked && <>
            <DuelPot stake={terms.stake} />
            <p className="duel-payout-note mt-1 text-center font-mono text-[9px] text-faint">
              Winner: {terms.stake * 2} pot + 0–{terms.winGold} daily reward
            </p>
          </>}

          <Button
            className="mt-2 w-full shrink-0" variant="primary"
            disabled={remaining <= 0 || busy || !canAfford} busy={isPending('matchmake')}
            onClick={() => run('matchmake', api.findRatedMatch)}
            icon={<Trophy className="h-4 w-4" />}
          >
            {!canAfford ? `Need ${terms.stake} Gold`
              : terms.staked ? `Find rated match / stake ${terms.stake}` : 'Find rated match'}
          </Button>
          <div className="arena-match-rules mt-1.5 grid grid-cols-3 gap-1 font-mono text-[8px] uppercase tracking-wide text-faint" aria-label="Rated matchmaking rules">
            <span className="rounded-[2px] border border-element/20 bg-element/[.04] px-1.5 py-1 text-center">Elo + level</span>
            <span className="rounded-[2px] border border-element/20 bg-element/[.04] px-1.5 py-1 text-center">widens fairly</span>
            <span className="rounded-[2px] border border-element/20 bg-element/[.04] px-1.5 py-1 text-center">5 min max</span>
          </div>

          {writePhase('matchmake') === 'settling' && (
            <TransactionHold className="mt-2 shrink-0">Searching the rated queue.</TransactionHold>
          )}

          <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-rune/12 pt-2">
            <div className="mb-1.5 flex shrink-0 items-center justify-between">
              <span className="eyebrow">Open duels / no Elo</span>
              <span className="flex items-center gap-1">
                <Button
                  className="h-7 min-h-0 px-2 text-[9px]" size="sm" variant="ghost"
                  disabled={remaining <= 0 || busy || !canAfford} busy={isPending('challenge')}
                  onClick={() => run('challenge', () => api.challenge('OPEN'), 'Unranked challenge posted.')}
                >
                  Post / {terms.stake}
                </Button>
                <Button
                  className="h-7 min-h-0 px-1.5" size="sm" variant="quiet" busy={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    await Promise.all([refreshChallenges(), refreshArenaTiers()]);
                    setRefreshing(false);
                  }}
                  icon={<Refresh className="h-3 w-3" />} title="Refresh unranked challenges"
                  aria-label="Refresh unranked challenges"
                />
                <span className="min-w-3 text-right font-mono text-[9px] text-faint">{challenges === null ? '…' : open.length}</span>
              </span>
            </div>
            {writePhase('challenge') === 'settling' && (
              <TransactionHold className="mb-1.5 shrink-0">Posting unranked challenge.</TransactionHold>
            )}
            {challenges === null ? (
              <div className="space-y-1.5 py-1">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : open.length === 0 ? (
              <div className="grid min-h-0 flex-1 place-items-center text-center">
                <div>
                  <Users className="mx-auto h-6 w-6 text-faint" />
                  <p className="mt-1 text-[11px] text-faint">The board is clear.</p>
                </div>
              </div>
            ) : (
              <div className="arena-challenge-list min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {open.map((c) => (
                  <div key={c.id} data-element={c.element}
                       className="flex items-center justify-between gap-3 rounded-[3px] border border-edge/60 bg-void/25 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium">
                        {c.monsterName}{' '}
                        <span className="font-mono text-[10px] text-faint">L{c.level}</span>{' '}
                        <span className="font-mono text-[10px] text-element">{Math.round(c.rating ?? terms.ratingStart)} Elo</span>
                      </div>
                      <div className="font-mono text-[9px] text-faint">{shortAddress(c.challenger, 5)}</div>
                    </div>
                    <Button
                      className="px-2.5" size="sm" variant="primary"
                      disabled={remaining <= 0 || busy || !canAfford} busy={isPending(`accept:${c.id}`)}
                      onClick={() => run(`accept:${c.id}`, () => api.acceptChallenge(c.id))}
                    >
                      {terms.staked ? `Take / ${terms.stake}` : 'Accept'}
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
 * The four pots, drawn as selectable odds tracks rather than a data table.
 *
 * The filled track is the realm's measured win rate. The bone notch is the
 * break-even rate for the live pot. Fill past the notch means the pot is paying
 * better than the realm has needed to win it; the signed percentage at the end
 * makes the same comparison available without relying on colour or position.
 * All values remain derived from one published tier snapshot.
 */
function TierTable({ rows, value, onPick, terms }: {
  rows: ReturnType<typeof arenaTierRows>;
  value: string;
  onPick: (key: string) => void;
  terms: ArenaTerms;
}) {
  const maxPayout = Math.max(1, ...rows.map((row) => row.payout));
  return (
    <div data-tour="arena-breakeven" className="arena-tier-board flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-end gap-3 font-mono text-[8px] uppercase tracking-wide text-faint" aria-hidden>
        <span className="flex items-center gap-1"><i className="block h-1.5 w-3 bg-good/60" /> Realm wins</span>
        <span className="flex items-center gap-1"><i className="block h-3 w-px bg-rune" /> Break-even</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-4 gap-1.5" role="radiogroup" aria-label="Trainer difficulty and live pot odds">
        {rows.map((row, index) => {
          const selected = row.key === value;
          const good = row.edge !== undefined && row.edge > 0;
          const edgePoints = row.edge === undefined ? undefined : Math.round(row.edge * 100);
          const breakEven = Math.max(0, Math.min(100, (row.breakEven ?? 0) * 100));
          const realmWins = Math.max(0, Math.min(100, (row.winRate ?? 0) * 100));
          const payoutScale = Math.max(4, (row.payout / maxPayout) * 100);
          return (
            <button
              key={row.key} type="button" role="radio" aria-checked={selected}
              onClick={() => onPick(row.key)}
              title={`${row.label}: ${row.pot} Gold in the pot, a win currently draws ${row.payout} from it plus 0–${terms.winGold} from the daily reward allowance. Break-even ${ratePct(row.breakEven)}; realm win rate ${ratePct(row.winRate)}.`}
              className={cx(
                'arena-tier-option grid min-h-0 grid-cols-[4.4rem_minmax(0,1fr)_3.4rem] items-center gap-2 rounded-[3px] border px-2.5 py-1.5 text-left transition-colors',
                selected ? 'border-element/60 bg-element/[.09]' : 'border-edge/60 bg-void/20 hover:border-element/35 hover:bg-raised/35',
              )}
            >
              <span className="min-w-0">
                <DifficultyMarks level={index + 1} />
                <span className={cx('mt-0.5 block truncate text-[12px] font-medium', selected ? 'text-element' : 'text-ink')}>{row.label}</span>
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2 font-mono text-[9px] tabular-nums">
                  <span className="text-faint">pot {formatInteger(row.pot)}</span>
                  <span className={row.payout > terms.stake ? 'text-good' : 'text-muted'}>pot +{formatInteger(row.payout)}</span>
                </span>
                <span className="arena-tier-track relative mt-1 block h-2 overflow-visible rounded-[2px] bg-raised">
                  <span className="absolute inset-y-0 left-0 bg-element/20" style={{ width: `${payoutScale}%` }} />
                  {row.winRate !== undefined && (
                    <span className={cx('absolute inset-y-0 left-0', good ? 'bg-good/65' : 'bg-warn/55')} style={{ width: `${realmWins}%` }} />
                  )}
                  {row.breakEven !== undefined && (
                    <span className="absolute -inset-y-1 w-px bg-rune" style={{ left: `${breakEven}%` }} />
                  )}
                </span>
                <span className="arena-tier-rates mt-1 flex justify-between font-mono text-[8px] tabular-nums text-faint">
                  <span>BE {ratePct(row.breakEven)}</span>
                  <span>Realm {ratePct(row.winRate)}</span>
                </span>
              </span>
              <span className={cx(
                'justify-self-end rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] tabular-nums',
                edgePoints === undefined ? 'border-edge/60 text-faint'
                  : good ? 'border-good/35 bg-good/[.07] text-good' : 'border-warn/35 bg-warn/[.07] text-warn',
              )}>
                {edgePoints === undefined ? 'NEW' : `${edgePoints > 0 ? '+' : ''}${edgePoints}%`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DifficultyMarks({ level }: { level: number }) {
  return (
    <span className="difficulty-marks flex gap-0.5" aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <i key={index} className={cx('block h-1 w-2 skew-x-[-22deg]', index < level ? 'bg-element/75' : 'bg-edge/60')} />
      ))}
    </span>
  );
}

function DuelPot({ stake }: { stake: number }) {
  return (
    <div className="duel-pot grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[3px] border border-edge/60 bg-void/25 px-3 py-2" aria-label={`Each player stakes ${stake} Gold. Winner takes ${stake * 2} Gold.`}>
      <span className="text-center">
        <span className="eyebrow block">You</span>
        <span className="mt-0.5 flex items-center justify-center gap-1 font-mono text-sm tabular-nums"><Coin className="h-3.5 w-3.5 text-rune" />{stake}</span>
      </span>
      <span className="relative grid h-9 w-14 place-items-center border-x border-rune/15" aria-hidden>
        <Sword className="h-5 w-5 rotate-45 text-element/70" />
        <span className="absolute -bottom-1 bg-surface px-1 font-mono text-[8px] text-good">{stake * 2} POT</span>
      </span>
      <span className="text-center">
        <span className="eyebrow block">Rival</span>
        <span className="mt-0.5 flex items-center justify-center gap-1 font-mono text-sm tabular-nums"><Coin className="h-3.5 w-3.5 text-rune" />{stake}</span>
      </span>
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
    <div className="mx-auto max-w-lg animate-rise lg:my-auto">
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
 * The authority can publish the player's new battle id one read before that
 * battle's dedicated cache row is available. Stay in recovery and keep reading
 * the player; falling through to Lobby would stop the only poll that can attach
 * the fight and strand a successfully matched player on the opponent picker.
 */
function MonolithBattleRecovery() {
  const { player, refresh } = useGame();
  usePoll(() => refresh(), { intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000 });

  return (
    <div className="mx-auto max-w-lg animate-rise lg:my-auto">
      <Panel className="p-8 text-center" glow>
        <Spinner className="mx-auto h-8 w-8 text-element" />
        <h1 className="mt-4 text-lg font-semibold">Restoring battle</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Your match is secured. Its battle cache is catching up; no second fight can start while this one is attached.
        </p>
        <div className="mt-6 flex justify-center">
          <Button variant="quiet" onClick={() => void refresh()} icon={<Refresh className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
        </div>
        <span className="sr-only">Battle {player!.activeBattleId}</span>
      </Panel>
    </div>
  );
}

/**
 * A compact, published-player wait state. No public queue or placeholder battle
 * is polled: the opponent's Matchmake transaction updates this player's normal
 * published record with the real battle, and the next free refresh opens it.
 */
function MatchmakingWait() {
  const { player, catalog, refresh, run, isPending } = useGame();
  const terms = arenaTerms(catalog);
  const search = player!.matchmaking!;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  usePoll(() => refresh(), { intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000 });

  const elapsed = Math.max(0, now - search.joinedAt);
  const remaining = Math.max(0, search.expiresAt - now);
  const expired = remaining <= 0;
  const bands = terms.matchmakingBands;
  const band = bands.reduce(
    (current, next) => elapsed >= next.afterMs ? next : current,
    bands[0] ?? { afterMs: 0, rating: 100, level: 1 },
  );
  const progress = Math.min(100, (elapsed / terms.matchmakingMaxWaitMs) * 100);

  return (
    <div className="arena-matchmaking mx-auto flex h-full min-h-0 w-full max-w-lg items-center animate-rise">
      <Panel className="w-full overflow-hidden p-5 text-center sm:p-7" glow>
        <div className="arena-matchmaking-icon relative mx-auto grid h-16 w-16 place-items-center">
          <span className={cx(
            'absolute inset-0 border border-element/25 bg-element/[.05]',
            !expired && 'matchmaking-radar',
          )} aria-hidden />
          {expired
            ? <X className="relative h-7 w-7 text-muted" />
            : <Trophy className="relative h-7 w-7 text-element" />}
        </div>
        <div className="mt-3 eyebrow text-element">Rated matchmaking</div>
        <h1 className="mt-1 text-xl font-semibold">
          {expired ? 'No fair match found' : 'Finding a fair fight'}
        </h1>

        <div className="mx-auto mt-3 grid max-w-sm grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <MatchRange label="Elo" value={`±${band.rating}`} current={search.rating} />
          <div className="grid place-items-center font-mono text-lg text-rune/35" aria-hidden>+</div>
          <MatchRange label="Level" value={`±${band.level}`} current={search.level} />
        </div>

        <div className="mx-auto mt-4 max-w-sm">
          <div className="flex items-baseline justify-between font-mono tabular-nums">
            <span className="text-[9px] uppercase tracking-wider text-faint">Search window</span>
            <strong className={cx('text-2xl font-medium', expired ? 'text-muted' : 'text-element')}>
              {expired ? '0:00' : countdown(remaining)}
            </strong>
          </div>
          <div className="relative mt-2 h-2 overflow-hidden rounded-[2px] bg-raised">
            <span className="absolute inset-y-0 left-0 bg-element/75 transition-[width] duration-1000" style={{ width: `${progress}%` }} />
            {bands.slice(1).map((step) => (
              <i
                key={step.afterMs} aria-hidden
                className="absolute inset-y-0 w-px bg-rune/45"
                style={{ left: `${(step.afterMs / terms.matchmakingMaxWaitMs) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-faint">
            <span>Closest Elo</span><span className="text-rune/30">/</span>
            <span>Closest level</span><span className="text-rune/30">/</span>
            <span>Longest wait</span>
          </div>
        </div>

        <p className="arena-matchmaking-copy mx-auto mt-4 max-w-sm text-[12px] leading-relaxed text-muted">
          {expired
            ? `Your search is no longer eligible. Refund the full ${search.stake} Gold stake, then try again or choose a trainer.`
            : `${search.stake} Gold is safely held. The range widens each minute; only this automatic match changes Elo.`}
        </p>
        <Button
          className="mt-5 w-full" variant={expired ? 'primary' : 'quiet'}
          busy={isPending('cancel-matchmaking')}
          onClick={() => run('cancel-matchmaking', api.cancelRatedMatch)}
        >
          {expired ? `Refund ${search.stake} Gold` : 'Cancel & refund'}
        </Button>
      </Panel>
    </div>
  );
}

function MatchRange({ label, value, current }: { label: string; value: string; current: number }) {
  return (
    <div className="rounded-[3px] border border-element/25 bg-element/[.055] px-3 py-2.5">
      <span className="eyebrow block">{label}</span>
      <strong className="mt-0.5 block font-mono text-xl font-medium tabular-nums text-element">{value}</strong>
      <span className="mt-0.5 block font-mono text-[9px] tabular-nums text-faint">yours {current}</span>
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
    const published = await api.readBattle(battleId, { signal });
    if (signal.aborted || !published || published.id !== battleId) return;
    if (published.status !== 'pending') {
      setTaken(true);
      void refresh();
    }
  }, { intervalMs: PVP_POLL_MS, maxIntervalMs: 20_000, enabled: !taken });

  return (
    <div className="mx-auto max-w-lg animate-rise lg:my-auto">
      <Panel className="p-8 text-center" glow>
        <Spinner className="mx-auto h-8 w-8 text-element" />
        <h1 className="mt-4 text-lg font-semibold">
          {taken ? 'Someone took it' : 'Waiting for a rival'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          {taken
            ? 'Opening the fight…'
            : 'Your unranked challenge is posted. Anyone in the arena can take it. Elo will not change, but the Gold stake and battle rewards are real. Withdrawing refunds the full stake.'}
        </p>
        {!taken && (
          <Button
            className="mt-6" variant="quiet"
            busy={isPending('withdraw-challenge')}
            onClick={() => run('withdraw-challenge', () => api.withdrawChallenge(battleId))}
          >
            Withdraw & refund
          </Button>
        )}
      </Panel>
    </div>
  );
}

/**
 * The fight itself, which teaches two rules nothing else on the screen states.
 *
 * A companion carries THREE moves, and every companion in the realm can Rally
 * and Mend once a battle without spending a slot on either. Neither of those is
 * discoverable from the grid: five cells that look alike do not say which two
 * are free, and a player who never presses them simply plays a worse game.
 *
 * It lives here rather than in `LOBBY_TOUR` because a step whose target is
 * missing is silently dropped, and the move grid does not exist until a fight
 * does — a lobby step pointing at it would never once have been shown.
 */
const BATTLE_TOUR: TourStep[] = [
  {
    target: '[data-tour="battle-moves"]',
    title: 'Your three moves',
    body: 'What this companion rolled, each with a limited number of uses. When all three are spent you can still struggle, and a button appears here saying so.',
  },
  {
    target: '[data-tour="battle-free"]',
    title: 'And two every companion has',
    body: 'Rally and Mend, on your readout rather than in the grid, because they are charges rather than moves: once each per battle, no move slot, and every companion in the realm carries both. Rally buys attack and speed with health; Mend buys health and shield with speed. The dot is the charge — your opponent’s pair is drawn the same way on their side, so you can see whether they still have a heal in hand before you commit.',
  },
  {
    target: '[data-tour="battle-log"]',
    title: 'What just happened',
    body: 'Every swing, in order: what landed, what missed, and which buffs are still running. A move’s stat riders last the rest of the fight, so a Rally in round one is still working in round eight.',
  },
];

// The fight -----------------------------------------------------------------

function BattleView() {
  const {
    player, address, tuning, catalog, refresh, run, isPending, writePhase, busy,
  } = useGame();
  useTourSteps('arena-battle', BATTLE_TOUR);

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
  const anticipatingMove = [
    ...Object.keys(me.moves ?? {}),
    ...Object.keys(catalog?.freeActions ?? {}),
  ].find((name) => writePhase(`attack:${name}`) === 'settling')
    ?? (writePhase('force') === 'settling' ? 'continue' : null);

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
          anticipatingMove={anticipatingMove}
          // Rally and Mend, on the floor under each fighter's readout rather
          // than in the move grid. They are not in `movePools` -- deliberately,
          // so one cannot be smuggled into a stored roster -- so the catalog is
          // the only way the client knows they exist.
          free={catalog?.freeActions ? {
            actions: catalog.freeActions,
            tuning,
            disabled: waiting || over,
            busy,
            isPending: (name) => isPending(`attack:${name}`),
            onMove: (name) => { void run(
              `attack:${name}`, () => api.attack(battle.id, name, battle.round),
            ); },
          } : undefined}
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
    const published = await api.readBattle(id, { signal });
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


/**
 * What actually happened, from the process rather than from the lobby.
 *
 * The lobby quoted a payout off a pot that has since moved — every fight
 * anybody in the realm settled in between changed it — so a result screen that
 * repeated the advertised number would show a figure this player could not have
 * been paid. `player.arenaLast` is the process's own receipt: the pot AS IT
 * STOOD at settle, what was drawn from it, and what the capped allowance added.
 * It is the one number about a settlement that is not derivable from published
 * state a moment later, which is why the contract carries it at all.
 *
 * Both halves can honestly be zero. The allowance is shared with quests and
 * runs out; a pot only ever holds what players staked. Saying so is the point —
 * a silent "+0" reads as a broken faucet, which is exactly how the daily
 * worship looked for months.
 */
function Outcome({
  won, battle, className,
}: { won: boolean; battle: Battle; className?: string }) {
  const { player, catalog, run, isPending, busy } = useGame();
  const terms = arenaTerms(catalog);
  const remaining = player!.battlesRemaining;
  const receipt = player!.arenaLast;
  const gold = player!.gold ?? 0;

  // Only trust a receipt that belongs to THIS fight. It is overwritten on every
  // settle, so a stale one from the previous battle would otherwise be printed
  // against this result — and the reply that ends a fight lands before the
  // refresh that carries the receipt, so "not here yet" is a real state.
  const fresh = receipt?.battleId === battle.id ? receipt : undefined;
  const drew = fresh ? Math.max(0, fresh.paid) : 0;
  const base = fresh ? Math.max(0, fresh.base) : 0;
  const total = drew + base;

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
          {battle.round} rounds. {won ? '+2 experience.' : '+1 experience for the trouble.'}
        </p>

        {/* The money, spelled out in its two layers because they come from two
            different places and only one of them issues anything. */}
        {fresh ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
            {total > 0 ? (
              <span className="flex items-baseline gap-1 font-mono tabular-nums text-good">
                <Coin className="h-3.5 w-3.5 translate-y-0.5 text-rune" />
                +{total} Gold
              </span>
            ) : (
              <span className="font-mono text-muted">+0 Gold</span>
            )}
            <span className="text-faint">
              {won
                ? drew > 0
                  ? `${drew} from the ${tierLabel(terms, fresh.tier)} pot, which held ${fresh.pot}`
                  : `the ${tierLabel(terms, fresh.tier)} pot was empty`
                : fresh.tier === 'pvp'
                  ? `your ${fresh.stake} Gold stake went to the winner`
                  : `your ${fresh.stake} stays in the ${tierLabel(terms, fresh.tier)} pot`}
              {won && base === 0 && ' · the 20-hour reward allowance is spent'}
              {won && base > 0 && ` · ${base} from the reward allowance`}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[12px] text-faint">Settling the stake…</p>
        )}
        {fresh?.tier === 'pvp' && fresh.ratingAfter !== undefined && (
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-faint">
            <Trophy className="h-3 w-3 text-element" />
            Elo <span className="text-ink">{fresh.ratingAfter}</span>
            {fresh.ratingChange !== undefined && (
              <span className={fresh.ratingChange >= 0 ? 'text-good' : 'text-bad'}>
                {fresh.ratingChange >= 0 ? '+' : ''}{fresh.ratingChange}
              </span>
            )}
          </p>
        )}
        {fresh?.tier === 'pvp' && battle.arena?.rated !== true && (
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <Shield className="h-3 w-3 text-muted" /> Unranked duel / Elo unchanged
          </p>
        )}
        {terms.staked && (
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-faint">
            Purse {formatInteger(gold)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
        {remaining > 0 ? (
          <Button
            variant="primary" busy={isPending('bot')}
            disabled={busy || (terms.staked && gold < terms.stake)}
            onClick={() => run('bot', () => api.startBotBattle(1))}
            icon={<Sword className="h-4 w-4" />}
          >
            {terms.staked && gold < terms.stake
              ? `Need ${terms.stake} Gold`
              : `Next battle (${remaining} left)`}
          </Button>
        ) : (
          <p className="text-[13px] text-faint">
            Session over. Feed and play your companion to enter again.
          </p>
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

/**
 * The tier's own name, joined from the catalog rather than title-cased here.
 *
 * `'pvp'` is not a tier and has no row: a duel's pot is the two stakes and
 * nothing else, so it is named for what it is.
 */
function tierLabel(terms: ArenaTerms, key: string) {
  if (key === 'pvp') return 'duel';
  return terms.tiers.find((tier) => tier.key === key)?.label ?? key;
}
