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
  Coin, Refresh, Sword, Trophy, Users, X,
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
 * **Both lists are part of the arena's rules.** That entry is free, the
 * session size, the energy and happiness gates and the berry-maxing bonus are
 * all stated here in words. Change any of them in `constants.lua` or in the entry
 * handler and these sentences are part of that change.
 */
const ENTRANCE_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-purse"]',
    title: 'The arena is played for Gold',
    body: 'Every battle stakes Gold into a pot, and winning is what draws from it. You need at least one battle’s stake to get through the door — a quest pays 15 Gold and costs the same energy and happiness, which is the way back if you are short.',
  },
  {
    target: '[data-tour="arena-cost"]',
    title: 'What a session costs',
    body: 'Entering is four battles and takes no Gold at all — 25 energy and 25 happiness, and happiness only comes back from a 15-minute play. The Gold is charged per battle, so leaving after one costs you nothing you were never charged.',
  },
  {
    target: '[data-tour="arena-pays"]',
    title: 'What a win pays',
    body: 'Two halves. A fixed reward out of one 20-hour allowance shared with quests — which can pay nothing once the day’s is spent — and a share of the pot your stake went into. The pot half is other players’ stakes, so the arena hands back exactly what was put in.',
  },
  {
    target: '[data-tour="arena-berries"]',
    title: 'Berry maxing',
    body: 'Optional, and spent now: three matching berries buy +5 to one stat for all four fights. It never touches your companion’s permanent build.',
  },
  {
    target: '[data-tour="arena-enter"]',
    title: 'Then you are in',
    body: 'The energy and happiness are taken here, once. A session lasts until its four battles are used or you leave the arena.',
  },
];

const LOBBY_TOUR: TourStep[] = [
  {
    target: '[data-tour="arena-session"]',
    title: 'Your session',
    body: 'Battles left, this session’s record, and your purse. Leaving forfeits whatever is left of the session — the energy and happiness are not refunded, but no Gold is taken for a battle you did not fight.',
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
    title: 'Or another player',
    body: 'A duel is one pot of exactly two stakes and the winner takes all of it, no rake. Both stakes are held from the moment the challenge is accepted; withdrawing one nobody took returns yours whole.',
  },
];

function Entrance() {
  useTourSteps('arena-entrance', ENTRANCE_TOUR);
  const { player, catalog, arenaTiers, run, isPending } = useGame();
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

  // The Gold gate is the PROCESS's — `Battle.Begin` refuses a purse that cannot
  // cover one battle. This mirrors it so the button is honest, and it must keep
  // mirroring it: a client-side gate that is stricter blocks a fight the
  // process would have allowed, and a looser one signs a message that fails.
  const blocked =
    busy ? `Your companion is ${monster.status.type === 'Play' ? 'playing' : 'on a quest'}.`
      : monster.energy < terms.energyCost ? 'Not enough energy — feed your companion.'
        : monster.happiness < terms.happinessCost ? 'Not happy enough — send it out to play.'
          : terms.staked && gold < terms.minEntry
            ? `You need ${terms.minEntry} Gold to enter — a battle stakes ${terms.stake}. A quest pays 15 and costs the same energy and happiness.`
            : selectedBerry && selectedCount < selectedBerry.cost
              ? `You need ${selectedBerry.cost} ${ITEM_NAME[selectedBerry.id]}.`
              : null;

  // What the four pots would pay a win right now, so the entrance can name a
  // real range rather than a promise. The pot moves between reading this and
  // settling, which is exactly why the result screen shows the pot AT settle.
  const rows = arenaTierRows(terms, arenaTiers);
  const payouts = rows.map((row) => row.payout).filter((n) => n > 0);
  const bestPayout = payouts.length ? Math.max(...payouts) : 0;
  const leanPayout = payouts.length ? Math.min(...payouts) : 0;

  return (
    /* `my-auto` centres it in the fitted viewport. The arena owns the whole
       screen height (see `fitted` in Shell), and a content-sized panel in a
       flex column sits at the very top of it with a third of a screen of empty
       void underneath — which reads as a page that failed to finish loading
       rather than as one thing to decide. Inert below `lg`, where the page
       scrolls like any other. */
    <div className="mx-auto max-w-2xl animate-rise lg:my-auto">
      <Panel className="p-8 text-center" glow>
        <Sword className="mx-auto h-9 w-9 text-element" />
        <h1 className="mt-4 text-xl font-semibold">Enter the arena</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          {terms.staked
            ? <>A session is {terms.battles} battles and each one stakes{' '}
              {terms.stake} Gold. Win and you draw from the pot it went into.</>
            : <>A session is {terms.battles} battles, and entering costs no Rune.
              Fight a trainer, or challenge another player.</>}
        </p>

        {/* The purse first, because it is now the thing that decides whether
            you are getting in at all. */}
        {terms.staked && (
          <div
            data-tour="arena-purse"
            className={cx(
              'mx-auto mt-5 flex max-w-sm items-center justify-between gap-4 rounded-[3px] border px-4 py-3 text-left',
              gold >= terms.minEntry ? 'border-edge/70 bg-void/25' : 'border-bad/40 bg-bad/5',
            )}
          >
            <div className="flex items-center gap-2.5">
              <Coin className={cx('h-6 w-6 shrink-0', gold >= terms.minEntry ? 'text-rune' : 'text-bad')} />
              <div>
                <div className="eyebrow">Your purse</div>
                <div className={cx(
                  'font-mono text-lg leading-tight tabular-nums',
                  gold >= terms.minEntry ? 'text-ink' : 'text-bad',
                )}>
                  {formatInteger(gold)}
                </div>
              </div>
            </div>
            <div className="text-right text-[11px] leading-relaxed text-faint">
              {terms.stake} a battle
              <br />
              {gold >= terms.sessionStake
                ? `${terms.battles} covered`
                : `${Math.floor(gold / Math.max(1, terms.stake))} covered`}
            </div>
          </div>
        )}

        <div data-tour="arena-cost" className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-3 text-left">
          <Cost label="Energy" have={monster.energy} need={terms.energyCost} />
          <Cost label="Happiness" have={monster.happiness} need={terms.happinessCost} />
        </div>

        {/* What a session actually pays, as a ledger rather than a sentence.
            Two of these lines are the two economic layers and they are kept
            visibly apart on purpose: the top one is the only thing that ISSUES
            Gold and it is capped, and the bottom one is other players' stakes
            being handed back. Reading them as one number is how "the arena
            pays" became a faucet every previous time. */}
        <div data-tour="arena-pays" className="mt-6 border-t border-rune/12 pt-5 text-left">
          <SectionTitle right={<span className="text-[11px] text-faint">per battle</span>}>
            What it pays
          </SectionTitle>
          <dl className="-mt-1 divide-y divide-edge/40 text-[13px]">
            <Line
              term="A win"
              value={terms.staked
                ? <><span className="text-good">+{terms.winGold}</span> Gold, plus a share of the pot</>
                : <><span className="text-good">+{terms.winGold}</span> Gold</>}
              note="+2 experience"
            />
            <Line
              term="A loss"
              value={terms.staked
                ? <span className="text-muted">Your stake stays in the pot</span>
                : <span className="text-muted">Nothing</span>}
              note="+1 experience"
            />
            {terms.staked && (
              <Line
                term="The pot right now"
                value={bestPayout > 0
                  ? <><span className="text-good">{leanPayout}–{bestPayout}</span> Gold, depending on the tier</>
                  : <span className="text-faint">Empty — the first stakes fill it</span>}
                note={`a win draws ${terms.drainNum}/${terms.drainDen} of it`}
              />
            )}
          </dl>
          <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
            The fixed half comes out of one 20-hour allowance shared with quests,
            so it pays nothing once the day’s is spent.
            {terms.staked && ' The pot half is other players’ stakes — the arena hands back exactly what was put into it, and never more.'}
          </p>
        </div>

        <div data-tour="arena-berries" className="mt-6 border-t border-rune/12 pt-5 text-left">
          <SectionTitle right={<span className="text-[11px] text-faint">optional · eat 3</span>}>
            Berry maxing
          </SectionTitle>
          <p className="-mt-1 text-[12px] leading-relaxed text-faint">
            Eat three matching berries now for a strong +5 stat boost across all {terms.battles} fights.
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
          Enter the arena{selectedBerry ? ` + ${selectedBerry.cost}× ${ITEM_NAME[selectedBerry.id]}` : ''}
        </Button>
        {terms.staked && !blocked && (
          <p className="mt-2 text-[11px] text-faint">
            Entering takes no Gold. The {terms.stake} is charged when a battle starts.
          </p>
        )}
      </Panel>
    </div>
  );
}

/** One row of the payout ledger: what it is, what it pays, and the aside. */
function Line({ term, value, note }: {
  term: string; value: React.ReactNode; note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 text-right">
        <span className="tabular-nums">{value}</span>
        {note && <span className="ml-2 text-[11px] text-faint">{note}</span>}
      </dd>
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
  const {
    player, catalog, arenaTiers, refreshArenaTiers,
    run, isPending, busy, address, challenges, refreshChallenges,
  } = useGame();
  const terms = arenaTerms(catalog);
  const rows = arenaTierRows(terms, arenaTiers);
  // The tier is chosen by KEY and the difficulty is sent from the row, so the
  // client never invents a number the process would bucket somewhere else.
  const [tierKey, setTierKey] = useState(() => rows[1]?.key ?? rows[0]?.key ?? 'even');
  const [refreshing, setRefreshing] = useState(false);

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
          <div className="flex items-center gap-4">
            {terms.staked && (
              <div className="text-right">
                <div className="eyebrow">Purse</div>
                <div className={cx(
                  'flex items-center justify-end gap-1.5 font-mono text-base leading-tight tabular-nums',
                  canAfford ? 'text-ink' : 'text-bad',
                )}>
                  <Coin className={cx('h-4 w-4', canAfford ? 'text-rune' : 'text-bad')} />
                  {formatInteger(gold)}
                </div>
                <div className="text-[11px] text-faint">{terms.stake} a battle</div>
              </div>
            )}
            <Button
              variant="quiet" busy={isPending('leave')}
              onClick={() => run('leave', api.leaveArena)}
            >
              Leave the arena
            </Button>
          </div>
        </div>
      </Panel>

      <div className="arena-lobby-grid grid gap-4 lg:grid-cols-2">
        <Panel data-tour="arena-tiers" className="p-5">
          <SectionTitle right={terms.staked
            ? <span className="text-[11px] text-faint">{terms.stake} Gold a battle</span>
            : undefined}>
            Fight a trainer
          </SectionTitle>
          <p className="text-[13px] leading-relaxed text-muted">
            {terms.staked
              ? <>An opponent built to match your level. Every tier stakes the same;
                what differs is the pot, and a win draws {terms.drainNum}/{terms.drainDen} of
                whichever one it staked into.</>
              : <>An opponent is generated to match your level, from a random faction.
                Harder opponents get a bigger stat budget.</>}
          </p>

          {terms.staked ? (
            <TierTable rows={rows} value={tierKey} onPick={setTierKey} terms={terms} />
          ) : (
            <div className="mt-4 flex gap-2">
              {rows.map((row) => (
                <button
                  key={row.key}
                  onClick={() => setTierKey(row.key)}
                  aria-pressed={tierKey === row.key}
                  className={cx(
                    'difficulty-button min-h-11 flex-1 rounded-[3px] border px-2 py-2 text-[13px] transition-colors lg:min-h-0',
                    tierKey === row.key
                      ? 'border-element/60 bg-element/10 text-element'
                      : 'border-edge/70 text-muted hover:text-ink',
                  )}
                >
                  {row.label}
                </button>
              ))}
            </div>
          )}

          <Button
            className="mt-4 w-full" variant="primary" size="lg"
            disabled={remaining <= 0 || busy || !canAfford}
            busy={isPending('bot')}
            onClick={() => run('bot', () => api.startBotBattle(chosen?.difficulty ?? 1))}
            icon={<Sword className="h-4 w-4" />}
          >
            {remaining <= 0 ? 'No battles left'
              : !canAfford ? `Need ${terms.stake} Gold`
                : terms.staked
                  ? `Stake ${terms.stake} on ${chosen?.label ?? 'Even'}`
                  : 'Begin'}
          </Button>
          {terms.staked && chosen && canAfford && remaining > 0 && (
            <p className="mt-2 text-center text-[11px] text-faint">
              A win here pays {chosen.payout} Gold from the pot, plus the {terms.winGold}
              {' '}reward. A loss leaves your stake in it.
            </p>
          )}
        </Panel>

        <Panel data-tour="arena-open" className="p-5">
          <SectionTitle right={
            <Button
              size="sm" variant="quiet" busy={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await Promise.all([refreshChallenges(), refreshArenaTiers()]);
                setRefreshing(false);
              }}
              icon={<Refresh className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
          }>
            Challenge a player
          </SectionTitle>

          {terms.staked && (
            <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-faint">
              A duel is one pot of exactly two stakes — {terms.stake} each — and the
              winner takes all {terms.stake * 2}, no rake. Yours is held from the
              moment you post; withdrawing a challenge nobody took returns it whole.
            </p>
          )}

          <Button
            className="w-full" variant="ghost"
            disabled={remaining <= 0 || busy || !canAfford}
            busy={isPending('challenge')}
            onClick={() => run('challenge', () => api.challenge('OPEN'),
              'Challenge posted. Waiting for a taker.')}
            icon={<Users className="h-4 w-4" />}
          >
            {!canAfford ? `Need ${terms.stake} Gold`
              : terms.staked ? `Post a challenge · ${terms.stake} Gold` : 'Post an open challenge'}
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
                      disabled={remaining <= 0 || busy || !canAfford}
                      busy={isPending(`accept:${c.id}`)}
                      onClick={() => run(`accept:${c.id}`, () => api.acceptChallenge(c.id))}
                    >
                      {terms.staked ? `Take · ${terms.stake}` : 'Accept'}
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
 * The four pots, as the thing you pick a fight out of.
 *
 * This replaced a row of four difficulty buttons, and the reason it is a table
 * rather than four prettier buttons is that a tier is no longer a preference —
 * it is a price, and the four numbers on each row are what makes it one.
 *
 * All four are DERIVED here from what the process published (`pot`, `wins`,
 * `attempts`) and none of them is published as a number. See the note on
 * `arenaTierMath`: a derived value read a slot late is a figure nobody could
 * have been paid, and a payout the contract advertised is a promise the design
 * deliberately does not make.
 *
 * The last column is the one worth reading and the one most easily
 * misunderstood, so it says both halves rather than a verdict: **break even**
 * is the win rate at which the pot returns your stake, and **players win** is
 * how often the tier is actually being won. At equilibrium the two converge, so
 * the GAP between them is the signal — a tier people have been losing has a
 * fat pot, a low break-even, and is worth attacking right now.
 *
 * Nothing here feeds a payout. A player who dumps games to drag "players win"
 * down gains nothing, because a win still draws from what is in the pot and a
 * pot only holds what somebody staked.
 */
function TierTable({ rows, value, onPick, terms }: {
  rows: ReturnType<typeof arenaTierRows>;
  value: string;
  onPick: (key: string) => void;
  terms: ArenaTerms;
}) {
  return (
    <div data-tour="arena-breakeven" className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[19rem] border-collapse text-[12px]">
        <thead>
          <tr className="text-faint">
            <th className="pb-1.5 text-left font-normal">Tier</th>
            <th className="pb-1.5 text-right font-normal">Pot</th>
            <th className="pb-1.5 text-right font-normal">A win pays</th>
            <th className="pb-1.5 text-right font-normal">Break even</th>
            <th className="pb-1.5 text-right font-normal">Players win</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.key === value;
            // Positive edge means the tier is currently being won MORE often
            // than the pot needs to pay its stake back — the pot is fat. It is
            // a fact about right now, not a prediction about this player.
            const good = row.edge !== undefined && row.edge > 0;
            return (
              <tr
                key={row.key}
                onClick={() => onPick(row.key)}
                aria-selected={selected}
                className={cx(
                  'cursor-pointer border-t border-edge/40 transition-colors',
                  selected ? 'bg-element/10 text-element' : 'text-muted hover:text-ink',
                )}
              >
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={(event) => { event.stopPropagation(); onPick(row.key); }}
                    className="text-left text-[13px]"
                  >
                    {row.label}
                  </button>
                </td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums">
                  {formatInteger(row.pot)}
                </td>
                <td className={cx('py-2 pl-2 text-right font-mono tabular-nums',
                  row.payout > terms.stake && 'text-good')}>
                  {formatInteger(row.payout)}
                </td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums">
                  {ratePct(row.breakEven)}
                </td>
                <td className={cx('py-2 pl-2 text-right font-mono tabular-nums',
                  row.winRate === undefined ? 'text-faint' : good ? 'text-good' : 'text-warn')}>
                  {ratePct(row.winRate)}
                  {row.attempts > 0 && row.winRate === undefined && (
                    <span className="ml-1 text-[9px] uppercase text-faint">new</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Break even is the win rate at which the pot returns your {terms.stake}.
        When more players are winning a tier than that, its pot is fat and the
        tier is worth attacking. Your own record never changes what a win pays.
      </p>
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
    <div className="mx-auto max-w-lg animate-rise lg:my-auto">
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
  const { player, address, tuning, catalog, refresh, run, isPending, busy } = useGame();
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
  const fresh = receipt && receipt.won === won ? receipt : undefined;
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
                : `your ${fresh.stake} stays in the ${tierLabel(terms, fresh.tier)} pot`}
              {won && base === 0 && ' · the 20-hour reward allowance is spent'}
              {won && base > 0 && ` · ${base} from the reward allowance`}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[12px] text-faint">Settling the stake…</p>
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
