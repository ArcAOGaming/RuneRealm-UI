import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { isAbort, usePoll } from '../state/usePoll';
import * as huntApi from '../lib/hunt';
import * as gameApi from '../lib/game';
import { HuntCaptureReceipt, HuntRoute, HuntRun, HuntTuning, Monster } from '../lib/types';
import { BattleStage } from '../ui/BattleStage';
// The wild fight IS the arena fight: same `Battle` record, same engine, same
// moves, same type chart, same struggle rule. So it is the same grid and the
// same round log, not a second implementation — see ui/BattleMoves.tsx.
import { MoveChooser, RoundLog } from '../ui/BattleMoves';
import { useAether } from '../ui/aetherContext';
import { Button, Panel, Spinner, cx } from '../ui/primitives';
import { portrait } from '../ui/art';
import { Map, Rune, Satchel, Shield, Sparkle, X } from '../ui/icons';
import { useToast } from '../ui/toastContext';
import { useTourSteps, type TourStep } from '../ui/tourContext';

// Phaser and the 3D capture card arrive only after someone enters Hunt.
const HuntStage = lazy(() => import('../ui/HuntStage'));
const CompanionAcquisition = lazy(() => import('../ui/CompanionAcquisition'));

const FALLBACK_HUNT: HuntTuning = {
  protocol: 'runerealm-hunt/1', levelRange: 5, searchCooldown: 3000,
  entry: {
    berries: { fire_berry: 5, water_berry: 5, air_berry: 5, rock_berry: 5 },
  },
  capture: {
    minRuneBid: 1, maxRuneBid: 5,
    minChance: 5, maxChance: 95, baseChance: 15,
    runeScale: 120, runeHalf: 5, levelStep: 3,
  },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The hunt's walkthrough.
 *
 * A hunt is the one place in the game where Rune leaves your satchel and may
 * not come back, so every sentence here is about what is already spent. The
 * offering was paid on the way in; a bid is consumed whether or not the binding
 * holds; leaving does not refund either.
 *
 * The bid step only exists while something is cornered — the tour drops steps
 * whose target is not on screen, so one list covers roaming and capture and the
 * player is only told about bidding at the moment they are being asked to bid.
 *
 * **These sentences are the capture rules in words.** The bid range and what a
 * failed binding costs live in `C.CAPTURE`; change either and this list is part
 * of the change.
 */
const HUNT_TOUR: TourStep[] = [
  {
    target: '[data-tour="hunt-stage"]',
    title: 'The Wild Verge',
    body: 'Your companion walks the trail until something breaks cover. Searching and fighting are free — the offering you paid on the way in covers the whole run.',
  },
  {
    target: '[data-tour="hunt-tally"]',
    title: 'What the run has cost',
    body: 'Encounters so far, and the Rune you have left. Rune is only spent when you try to bind something.',
  },
  {
    target: '[data-tour="hunt-bid"]',
    title: 'Binding costs whether it works',
    body: 'One to five Rune, thrown once. Every Rune committed is consumed even if the binding breaks, and level advantage still matters at five.',
  },
  {
    target: '[data-tour="hunt-leave"]',
    title: 'Leaving',
    body: 'You keep everything you bound. The offering is not refunded, so there is no reason to leave a run early.',
  },
];

export default function Hunt() {
  useTourSteps('hunt', HUNT_TOUR);
  const { player, loadingPlayer, catalog, refresh } = useGame();
  const route = player?.hunt;
  const companion = route && (player?.monsters?.[route.monsterId] ?? player?.monster);
  const toast = useToast();
  const navigate = useNavigate();
  const [run, setRun] = useState<HuntRun | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(0);
  const [encounterReady, setEncounterReady] = useState(false);
  const [battleSettled, setBattleSettled] = useState(false);
  const [travel, setTravel] = useState({ travelled: 0, target: 1 });
  const [ending, setEnding] = useState(false);
  const [retrying, setRetrying] = useState<'opening' | 'settlement' | null>(null);
  const [outcome, setOutcome] = useState<HuntCaptureReceipt | null>(null);
  const seenCapture = useRef<string | null>(null);

  /**
   * Fold one published run into the screen.
   *
   * Shared by the one-shot load below and the poll, because they used to be two
   * effects that could both be reading the same key at the same time — the
   * route loader on 650 ms and the settlement watcher on its own 650 ms.
   */
  const applyRun = useCallback((next: HuntRun | null) => {
    if (!next) return;
    setRun(next);
    if (next.status === 'defeated' || next.status === 'lost') {
      // A reload after the final blow has no animation queue to wait for.
      setEncounterReady(true);
      setBattleSettled(true);
    }
  }, []);

  // A different run is a different screen. Clearing the old one is also what
  // arms the poll below, which is the only thing that reads a run in.
  useEffect(() => {
    setRun(null);
    setEncounterReady(false);
    setBattleSettled(false);
  }, [route?.runId, route?.processId]);

  /*
    The two states the client has to wait through, on one poll.

    `opening` is the game authority handing the run to the Hunt worker;
    `settling` is capture crossing Hunt -> game ledger -> Hunt acknowledgement.
    Both used to be a bare 650 ms `setTimeout` chain per state, with no ceiling
    and nothing cancelling the read. At the node's real service time — tens of
    seconds while it works through a write backlog — that asks for the same key
    far faster than it can be answered, and every unanswered ask is holding one
    of six connections on the screen where the player is waiting.

    `usePoll` schedules the next read from the END of the last one and lets the
    delay grow to what the node actually costs, so the ask rate can never
    outrun the answer rate.
  */
  const waiting = !!route && (!run || run.status === 'opening' || run.status === 'settling');
  usePoll(async (signal) => {
    if (!route) return;
    try {
      applyRun(await huntApi.readHunt(route, signal));
    } catch (error) {
      if (!isAbort(error)) throw error;
    }
  }, { intervalMs: 650, maxIntervalMs: 8_000, enabled: waiting, leading: true });

  useEffect(() => {
    const receipt = run?.lastCapture;
    if (!receipt || receipt.encounterId === seenCapture.current) return;
    seenCapture.current = receipt.encounterId;
    setOutcome(receipt);
    void refresh();
  }, [run?.lastCapture, refresh]);

  const findEncounter = useCallback(async () => {
    if (!route || searching || run?.status !== 'roaming') return;
    setSearching(true);
    setEncounterReady(false);
    try {
      const next = await huntApi.search(route);
      setRun(next);
    } catch (error) {
      toast.error(errorMessage(error));
      setSearchFailed((n) => n + 1);
    } finally {
      setSearching(false);
    }
  }, [route, run?.status, searching, toast]);

  const endHunt = useCallback(async () => {
    if (!route || ending) return;
    setEnding(true);
    try {
      await huntApi.end(route);
      await refresh();
      navigate('/companion', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
      setEnding(false);
    }
  }, [ending, navigate, refresh, route, toast]);

  const retryOpen = useCallback(async () => {
    if (!route || retrying) return;
    setRetrying('opening');
    try {
      await gameApi.beginHunt(route.monsterId);
      toast.success('The trail is opening again.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRetrying(null);
    }
  }, [retrying, route, toast]);

  const retrySettlement = useCallback(async () => {
    if (!route || retrying) return;
    setRetrying('settlement');
    try {
      setRun(await huntApi.retrySettlement(route));
    } catch (error) {
      const latest = await huntApi.readHunt(route).catch(() => null);
      if (latest) setRun(latest);
      toast.error(errorMessage(error));
    } finally {
      setRetrying(null);
    }
  }, [retrying, route, toast]);

  if (loadingPlayer && !player) {
    return <div className="grid min-h-[50vh] place-items-center"><Spinner className="h-8 w-8 text-element" /></div>;
  }
  if (!route || !companion) return <Navigate to="/companion" replace />;

  const tuning = catalog?.hunt ?? FALLBACK_HUNT;
  const showWorld = !run || run.status === 'opening' || run.status === 'roaming'
    || searching || (run.status === 'battle' && !encounterReady);
  const showBattle = encounterReady && !!run?.battle && (run.status === 'battle'
    || ((run.status === 'defeated' || run.status === 'lost') && !battleSettled));

  return (
    <div className="hunt-screen animate-rise flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-element">The Wild Verge</p>
          <p className="truncate text-sm text-muted">
            {run?.status === 'battle' || run?.status === 'defeated'
              ? `${run.encounter?.name ?? 'Something'} broke from cover`
              : searching ? 'Something is moving in the brush…'
                : `${companion.name} is following your trail`}
          </p>
        </div>
        <div data-tour="hunt-tally" className="hidden items-center gap-3 text-[11px] text-faint sm:flex">
          <span><b className="font-mono text-ink">{run?.encounterCount ?? 0}</b> encounters</span>
          <span><b className="font-mono text-ink">{player?.inventory.rune ?? 0}</b> runes</span>
        </div>
        <Button data-tour="hunt-leave" variant="quiet" size="sm" busy={ending}
                disabled={!run || run.status === 'opening' || run.status === 'settling'}
                onClick={() => void endHunt()} icon={<X className="h-3.5 w-3.5" />}>
          Leave hunt
        </Button>
      </div>

      <Panel data-tour="hunt-stage" className="relative min-h-0 flex-1 overflow-hidden p-0" data-element={companion.elementType}>
        {showWorld && (
          <>
            <Suspense fallback={<div className="h-full animate-pulse bg-raised/40" />}>
              <HuntStage
                playerSpriteTxId={player?.spriteTxId}
                companion={companion}
                wild={run?.status === 'battle' && !encounterReady ? run.encounter : undefined}
                searchFailedToken={searchFailed}
                onTrailReady={() => void findEncounter()}
                onEncounterRevealed={() => setEncounterReady(true)}
                onTravel={(travelled, target) => setTravel({ travelled, target })}
              />
            </Suspense>
            <div className="pointer-events-none absolute left-3 top-3 w-56 rounded-[3px] border border-rune/20 bg-void/78 px-3 py-2 backdrop-blur-sm">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[.16em] text-faint">
                <span>Follow the trail</span><span>{Math.min(99, Math.floor((travel.travelled / travel.target) * 100))}%</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden bg-raised">
                <div className="h-full bg-element transition-[width] duration-150"
                     style={{ width: `${Math.min(100, (travel.travelled / travel.target) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted">WASD, arrows, or the field pad</p>
            </div>
            {searching && (
              <div className="absolute inset-0 grid place-items-center bg-void/30 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-[3px] border border-element/30 bg-void/85 px-4 py-3 text-sm">
                  <Spinner className="h-4 w-4 text-element" /> Reading the tracks…
                </div>
              </div>
            )}
          </>
        )}

        {(!run || run.status === 'opening') && (
          <div className="absolute inset-0 grid place-items-center bg-void/72 px-5 backdrop-blur-[2px]">
            <div className="max-w-sm text-center">
              <Spinner className="mx-auto h-7 w-7 text-element" />
              <p className="mt-4 text-sm font-semibold">Opening the Wild Verge</p>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                The game is handing this run to the Hunt process. If the trail stays closed,
                retrying re-delivers the same run without creating another one.
              </p>
              <Button className="mt-4" size="sm" variant="quiet" busy={retrying === 'opening'}
                      onClick={() => void retryOpen()}>Retry opening</Button>
            </div>
          </div>
        )}

        {showBattle && run?.battle && (
          <HuntBattle
            run={run}
            route={route}
            onRun={(next) => { setBattleSettled(false); setRun(next); }}
            onSettled={() => setBattleSettled(true)}
          />
        )}

        {run?.status === 'defeated' && battleSettled && run.encounter && (
          <CaptureChoice
            hunter={companion} wild={run.encounter} tuning={tuning}
            onRun={setRun}
          />
        )}

        {run?.status === 'settling' && (
          <div className="absolute inset-0 grid place-items-center bg-void/85 backdrop-blur-sm">
            <div className="text-center">
              <Spinner className="mx-auto h-8 w-8 text-element" />
              <p className="mt-4 text-sm font-semibold">The Runes are binding</p>
              <Button className="mt-4" size="sm" variant="quiet" busy={retrying === 'settlement'}
                      onClick={() => void retrySettlement()}>Retry delivery</Button>
              <p className="mt-1 text-xs text-faint">Settling the one capture roll with the game ledger…</p>
            </div>
          </div>
        )}

        {run?.status === 'lost' && battleSettled && (
          <div className="absolute inset-0 grid place-items-center bg-void/88 px-5 backdrop-blur-sm">
            <div className="max-w-md text-center">
              <Shield className="mx-auto h-10 w-10 text-bad" />
              <p className="eyebrow mt-4 text-bad">Driven from the Verge</p>
              <h1 className="mt-2 text-2xl font-semibold">The wild won this meeting</h1>
              <p className="mt-2 text-sm text-muted">Your companion will return home. Recover before following another trail.</p>
              <Button className="mt-5" variant="primary" busy={ending}
                      onClick={() => void endHunt()}>Return home</Button>
            </div>
          </div>
        )}
      </Panel>

      {outcome?.success && outcome.monster && (
        <Suspense fallback={null}>
          <CompanionAcquisition monster={outcome.monster} kind="capture" onComplete={() => setOutcome(null)} />
        </Suspense>
      )}
      {outcome && !outcome.success && (
        <CaptureFailed receipt={outcome} onClose={() => setOutcome(null)} />
      )}
    </div>
  );
}

/**
 * The wild fight.
 *
 * The only thing here that is not the arena is the message the move is signed
 * into: `Hunt.Attack` against the run's own worker rather than `Battle.Attack`
 * against the game process. The grid, the round log, the stage, the impact
 * shock and the rule that the grid stays up until the last blow has finished
 * playing are all the arena's, imported.
 */
function HuntBattle({
  run, route, onRun, onSettled,
}: {
  run: HuntRun;
  route: HuntRoute;
  onRun: (run: HuntRun) => void;
  onSettled: () => void;
}) {
  const { tuning } = useGame();
  const toast = useToast();
  const [attacking, setAttacking] = useState<string | null>(null);
  const battle = run.battle!;
  const me = battle.challenger;
  const them = battle.accepter!;
  const over = battle.status === 'ended';

  // Hit the field behind the arena when a blow CONNECTS — the scene calls this
  // at the frame of impact, not when the reply lands.
  const stageRef = useRef<HTMLDivElement>(null);
  const { shockFrom } = useAether();
  const onImpact = useCallback(() => {
    shockFrom(stageRef.current ?? undefined);
  }, [shockFrom]);

  const attack = async (name: string) => {
    setAttacking(name);
    try {
      // The round is sent so a click made for this round cannot land on the
      // next one, exactly as the arena does.
      onRun(await huntApi.attack(route, name, battle.round));
    } catch (error) {
      const latest = await huntApi.readHunt(route).catch(() => null);
      if (latest) onRun(latest);
      toast.error(errorMessage(error));
    } finally {
      setAttacking(null);
    }
  };

  return (
    <div className="battle-screen absolute inset-0 flex min-h-0 flex-col gap-1.5 bg-void p-1.5 lg:grid lg:grid-rows-[minmax(0,1fr)_var(--battle-bottom)]">
      <Panel
        ref={stageRef}
        className="battle-stage relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <BattleStage
          battle={battle} me={me} them={them} fill
          onSettled={onSettled} onImpact={onImpact}
          className="min-h-0 flex-1 border-0"
        />
      </Panel>
      <div className="battle-bottom grid min-h-0 gap-2 lg:grid-rows-[minmax(0,1fr)_auto]">
        <MoveChooser
          me={me} them={them}
          // Locked once the fight is decided, but kept in place while the last
          // blow plays — swapping it out mid-swing is the jump this avoids.
          disabled={over} busy={attacking !== null} tuning={tuning}
          isPending={(name) => attacking === name}
          onMove={(name) => void attack(name)}
        />
        <RoundLog turns={battle.turns} youAre={me.side} />
      </div>
    </div>
  );
}

export function CaptureChoice({
  hunter, wild, tuning, onRun,
}: {
  hunter: Monster; wild: Monster; tuning: HuntTuning;
  onRun: (run: HuntRun) => void;
}) {
  const { player } = useGame();
  const toast = useToast();
  const route = player!.hunt!;
  const held = player!.inventory.rune ?? 0;
  const max = Math.max(tuning.capture.minRuneBid, Math.min(held, tuning.capture.maxRuneBid));
  const [runes, setRunes] = useState(Math.min(max, Math.max(1, 5)));
  const [busy, setBusy] = useState<'capture' | 'decline' | null>(null);
  const chance = useMemo(() => captureChance(hunter.level, wild.level, runes, tuning),
    [hunter.level, runes, tuning, wild.level]);
  const canCapture = held >= tuning.capture.minRuneBid;
  const bids = Array.from(
    { length: tuning.capture.maxRuneBid - tuning.capture.minRuneBid + 1 },
    (_, index) => tuning.capture.minRuneBid + index,
  );

  const capture = async () => {
    setBusy('capture');
    try { onRun(await huntApi.capture(route, runes)); }
    catch (error) { toast.error(errorMessage(error)); setBusy(null); }
  };
  const decline = async () => {
    setBusy('decline');
    try { onRun(await huntApi.declineCapture(route)); }
    catch (error) { toast.error(errorMessage(error)); setBusy(null); }
  };

  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-void/90 p-4 backdrop-blur-sm">
      <Panel className="grid w-full max-w-3xl gap-5 p-5 sm:grid-cols-[190px_1fr]" glow data-element={wild.elementType}>
        <div className="relative overflow-hidden border border-element/25 bg-raised/50">
          <img src={portrait(wild.elementType, wild.level, wild.entryNo)} alt={wild.name}
               data-pixel className="aspect-square h-full w-full object-contain p-4" />
          <span className="absolute bottom-2 left-2 bg-void/80 px-2 py-1 font-mono text-[11px]">level {wild.level}</span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow text-element">One chance to bind</p>
            <span className="border border-good/35 bg-good/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.12em] text-good">
              defeated
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Capture {wild.name}?</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The binding consumes every Rune committed, whether it holds or breaks.
            Choose one to five Runes. Five is likely, never guaranteed, and level advantage still matters.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <fieldset data-tour="hunt-bid" disabled={!canCapture || busy !== null}>
              <legend className="text-xs text-faint">Runes to throw</legend>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {bids.map((bid) => {
                  const available = held >= bid;
                  const selected = runes === bid;
                  const bidChance = captureChance(hunter.level, wild.level, bid, tuning);
                  return (
                    <button
                      key={bid}
                      type="button"
                      aria-pressed={selected}
                      disabled={!available || busy !== null}
                      onClick={() => setRunes(bid)}
                      className={cx(
                        'group border px-1.5 py-2 text-center transition-colors',
                        selected
                          ? 'border-element bg-element/15 text-element'
                          : 'border-edge bg-raised/55 text-muted hover:border-element/45 hover:text-ink',
                        !available && 'opacity-35',
                      )}
                    >
                      <span className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
                        <Rune className="h-3.5 w-3.5" />{bid}
                      </span>
                      <span className="mt-1 block font-mono text-[9px] text-faint group-aria-pressed:text-element/75">
                        {bidChance}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full p-[5px]"
                 style={{ background: `conic-gradient(rgb(var(--element)) ${chance * 3.6}deg, rgb(var(--raised)) 0deg)` }}>
              <div className="grid h-full w-full place-items-center rounded-full border border-element/20 bg-void text-center shadow-[inset_0_0_28px_rgb(var(--element)/.12)]">
                <div>
                  <p className="font-mono text-2xl font-semibold text-element">{chance}%</p>
                  <p className="text-[9px] uppercase tracking-[.14em] text-faint">bind chance</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
            <span className={cx('flex items-center gap-1.5', held < runes && 'text-bad')}>
              <Rune className="h-4 w-4" /> {runes} Runes <b className="font-mono text-faint">({held} held)</b>
            </span>
          </div>
          {!canCapture && (
            <p className="mt-3 text-xs text-bad">
              You need at least one Rune to attempt capture.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" busy={busy === 'capture'} disabled={!canCapture || busy !== null}
                    icon={<Sparkle className="h-4 w-4" />} onClick={() => void capture()}>
              Bind with {runes} Rune{runes === 1 ? '' : 's'} · {chance}%
            </Button>
            <Button variant="quiet" busy={busy === 'decline'} disabled={busy !== null}
                    onClick={() => void decline()}>Let it go</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function captureChance(hunter: number, wild: number, runes: number, tuning: HuntTuning) {
  const c = tuning.capture;
  const chance = c.baseChance + Math.floor((c.runeScale * runes) / (runes + c.runeHalf))
    + (hunter - wild) * c.levelStep;
  return Math.max(c.minChance, Math.min(c.maxChance, chance));
}

function CaptureFailed({ receipt, onClose }: { receipt: HuntCaptureReceipt; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-void/92 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <Panel className="max-w-md p-7 text-center" glow>
        <Satchel className="mx-auto h-10 w-10 text-bad" />
        <p className="eyebrow mt-4 text-bad">The binding broke</p>
        <h1 className="mt-2 text-2xl font-semibold">The binding broke</h1>
        <p className="mt-3 text-sm text-muted">
          You rolled <b className="font-mono text-ink">{receipt.roll}</b> against a{' '}
          <b className="font-mono text-ink">{receipt.chance}%</b> chance. The{' '}
          {receipt.runesSpent} committed Runes are spent.
        </p>
        <Button className="mt-6" variant="primary" icon={<Map className="h-4 w-4" />} onClick={onClose}>
          Return to the trail
        </Button>
      </Panel>
    </div>
  );
}
