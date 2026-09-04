import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { isAbort, usePoll } from '../state/usePoll';
import * as huntApi from '../lib/hunt';
import * as gameApi from '../lib/game';
import {
  Element, HuntCaptureReceipt, HuntRoute, HuntRun, HuntTuning, Monster,
} from '../lib/types';
import { BattleStage } from '../ui/BattleStage';
// The wild fight IS the arena fight: same `Battle` record, same engine, same
// moves, same type chart, same struggle rule. So it is the same grid and the
// same round log, not a second implementation — see ui/BattleMoves.tsx.
import { MoveChooser, RoundLog } from '../ui/BattleMoves';
import { useAether } from '../ui/aetherContext';
import { Button, Panel, Spinner, cx } from '../ui/primitives';
import { portrait } from '../ui/art';
import { Map, Rune, Shield, Sparkle, X } from '../ui/icons';
import { useToast } from '../ui/toastContext';
import { useTourSteps, type TourStep } from '../ui/tourContext';
import { SceneWipe, useSceneWipe } from '../ui/SceneWipe';
import { BindingPhase, STRIKE_MS } from '../gfx/bindingPhase';

// Phaser and the 3D capture card arrive only after someone enters Hunt.
const HuntStage = lazy(() => import('../ui/HuntStage'));
const CompanionAcquisition = lazy(() => import('../ui/CompanionAcquisition'));
// three.js, and therefore most of the bundle. It arrives when something is
// actually cornered, not when the entry chunk does.
const RuneField = lazy(() => import('../ui/RuneField'));

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
  const [retrying, setRetrying] = useState<'opening' | null>(null);
  const [outcome, setOutcome] = useState<HuntCaptureReceipt | null>(null);
  /** The finished companion whose card reveal is playing. */
  const [revealing, setRevealing] = useState<Monster | null>(null);
  /**
   * The encounter being bound, and the settlement it will produce.
   *
   * Held here rather than read from `run.encounter`, because the worker clears
   * the encounter the moment it acknowledges the settlement — and the verdict is
   * shown after that. Without this the creature vanishes out of the middle of
   * its own ceremony one frame before it is told what happened to it.
   *
   * The settlement id is carried alongside because the two processes describe
   * the same roll differently: the worker's receipt names the ENCOUNTER, the
   * game ledger's names the SETTLEMENT, and the id is
   * `<runId>-capture-<encounterCount>` by construction on the worker. Matching
   * on it is what stops a receipt from an earlier encounter — which stays
   * published for the rest of the run — from opening as this one's verdict.
   */
  const [bound, setBound] = useState<{ wild: Monster; settlementId: string } | null>(null);
  const seenCapture = useRef<string | null>(null);
  /*
    Every scene change on this panel goes through one cut.

    The trail becoming a fight, the fight becoming a binding, and the trail
    opening in the first place are all the same box swapping its contents, and
    all three used to do it by mounting. `wipe` covers the panel and runs the
    swap underneath, so the change is something that happens rather than
    something that has happened.
  */
  const { token: wipeToken, wipe } = useSceneWipe();
  const opened = useRef(false);

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
    if (next.status === 'defeated' || next.status === 'lost' || next.status === 'settling') {
      // A reload after the final blow has no animation queue to wait for.
      // `settling` is in the list because a reload can land there too: the bid
      // is already signed, and the ceremony has to come back up around it
      // rather than leaving the panel empty.
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
    setBound(null);
    setOutcome(null);
    opened.current = false;
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

  /**
   * The one roll, from whichever process has it.
   *
   * A capture settles in two hops: the worker hands the roll to the game
   * ledger, the ledger pays the Rune and grants the companion, and its
   * acknowledgement puts the worker back to roaming. The first hop is the one
   * that spends anything; the second is bookkeeping. When the second is late —
   * or, as happened on a live process, refused outright — the worker sits in
   * `settling` forever while the player's own record already carries the
   * answer. So the ledger's copy counts too, and the screen resolves on
   * whichever arrives.
   */
  useEffect(() => {
    if (!bound || seenCapture.current === bound.settlementId) return;
    const fromWorker = run?.lastCapture?.encounterId === bound.wild.id
      ? run.lastCapture : null;
    const fromLedger = route?.lastCapture?.settlementId === bound.settlementId
      ? route.lastCapture : null;
    const receipt = fromWorker ?? fromLedger;
    if (!receipt) return;
    seenCapture.current = bound.settlementId;
    setOutcome(receipt);
    void refresh();
  }, [bound, run?.lastCapture, route?.lastCapture, refresh]);

  // While the worker is settling, the ledger's own answer is the thing that
  // arrives first. Nothing else on this screen reads the player record often
  // enough to notice it.
  usePoll(async () => { await refresh(); },
    { intervalMs: 2_000, maxIntervalMs: 8_000, enabled: run?.status === 'settling' });

  // The moment something is cornered, the ceremony's copy of it is taken. It
  // has to outlive `run.encounter`, which the worker clears on acknowledgement.
  useEffect(() => {
    if ((run?.status === 'defeated' || run?.status === 'settling') && run.encounter) {
      const wild = run.encounter;
      setBound((prev) => (prev?.wild.id === wild.id ? prev : {
        wild, settlementId: `${run.runId}-capture-${run.encounterCount}`,
      }));
    } else if (run?.status === 'battle' || run?.status === 'lost') {
      setBound(null);
      setOutcome(null);
    }
  }, [run?.status, run?.encounter, run?.runId, run?.encounterCount]);

  // The first time the worker says the trail is live, it opens rather than
  // appears. Once per run: a poll that answers `roaming` fifty times is not
  // fifty arrivals.
  useEffect(() => {
    if (opened.current || !run || run.status === 'opening') return;
    opened.current = true;
    wipe(() => {});
  }, [run, wipe]);

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


  if (loadingPlayer && !player) {
    return <div className="grid min-h-[50vh] place-items-center"><Spinner className="h-8 w-8 text-element" /></div>;
  }
  if (!route || !companion) return <Navigate to="/companion" replace />;

  const tuning = catalog?.hunt ?? FALLBACK_HUNT;
  /*
    The binding owns the panel from the last blow to the verdict.

    It stays up through `settling` and past it: the worker drops back to
    `roaming` the instant it is acknowledged, and the roll has not been shown
    yet at that point. `outcome` is what keeps it, and the ceremony hands the
    receipt back when the player has read it.
  */
  const binding = !!bound && battleSettled
    && (run?.status === 'defeated' || run?.status === 'settling' || !!outcome);
  const wild = bound?.wild;
  const showWorld = !binding && (!run || run.status === 'opening' || run.status === 'roaming'
    || searching || (run.status === 'battle' && !encounterReady));
  const showBattle = encounterReady && !!run?.battle && (run.status === 'battle'
    || ((run.status === 'defeated' || run.status === 'lost') && !battleSettled));

  return (
    <div className="hunt-screen animate-rise flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-element">The Wild Verge</p>
          <p className="truncate text-sm text-muted">
            {binding && wild
              ? `${wild.name} is cornered`
              : run?.status === 'battle' || run?.status === 'defeated'
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
                onEncounterRevealed={() => wipe(() => setEncounterReady(true))}
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
            /*
              The stage settles after EVERY round, not only the last one — that
              is what keeps the grid up while a blow finishes playing. So the
              cut is spent only when the fight is actually over; wiping on the
              settle itself would flash the panel after every attack.
            */
            onSettled={() => {
              const over = run.status === 'defeated' || run.status === 'lost';
              if (over) wipe(() => setBattleSettled(true));
              else setBattleSettled(true);
            }}
          />
        )}

        {binding && wild && (
          <CaptureCeremony
            hunter={companion} wild={wild} tuning={tuning}
            settling={run?.status === 'settling'}
            receipt={outcome}
            onRun={setRun}
            onFinish={(receipt) => {
              setOutcome(null);
              setBound(null);
              if (receipt.success && receipt.monster) setRevealing(receipt.monster);
            }}
          />
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

        {wipeToken > 0 && (
          <SceneWipe
            key={wipeToken}
            element={(run?.encounter?.elementType ?? companion.elementType) as Element}
          />
        )}
      </Panel>

      {revealing && (
        <Suspense fallback={null}>
          <CompanionAcquisition
            monster={revealing} kind="capture"
            onComplete={() => setRevealing(null)}
          />
        </Suspense>
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

/**
 * The binding — the whole of it, from the choice to the verdict.
 *
 * This used to be three separate screens stacked on one another: a panel with a
 * portrait in a box, then a full-screen spinner captioned "The Runes are
 * binding", then a dialog with the roll in it. Three grounds, three entrances,
 * and the only thing on screen that was actually about Rune was the number
 * printed on a button.
 *
 * It is one ceremony now, and the field behind it IS the bid. Pick three and
 * three runes are turning around the creature; pick five and there are five.
 * Signing tightens the ring and sets them pulsing — which is the honest picture
 * of that moment, because the Rune is spent from the signature onward whatever
 * the roll says. The settlement landing throws them into the creature, and what
 * is left standing there is the answer.
 *
 * `wild` outlives `run.encounter` on purpose. The Hunt worker clears the
 * encounter the instant it acknowledges the settlement, and the verdict is
 * shown after that; the screen holds its own copy so the creature does not
 * vanish out of the middle of its own binding.
 */
export function CaptureCeremony({
  hunter, wild, tuning, settling, receipt, onRun, onFinish,
}: {
  hunter: Monster;
  wild: Monster;
  tuning: HuntTuning;
  /** The worker has the bid and has not answered yet. */
  settling: boolean;
  /** The one roll, once it exists. */
  receipt: HuntCaptureReceipt | null;
  onRun: (run: HuntRun) => void;
  onFinish: (receipt: HuntCaptureReceipt) => void;
}) {
  const { player } = useGame();
  const toast = useToast();
  const route = player!.hunt!;
  const held = player!.inventory.rune ?? 0;
  const max = Math.max(tuning.capture.minRuneBid, Math.min(held, tuning.capture.maxRuneBid));
  const [runes, setRunes] = useState(Math.min(max, tuning.capture.maxRuneBid));
  const [busy, setBusy] = useState<'capture' | 'decline' | null>(null);
  const [retrying, setRetrying] = useState(false);
  /**
   * The verdict, held back until the runes have actually landed.
   *
   * The receipt arrives from the network and the flight takes `STRIKE_MS`. Both
   * timelines have to agree or the screen says "bound" over a ring that is
   * still turning, so the phase leads and the copy follows it.
   */
  const [landed, setLanded] = useState(false);

  const chance = useMemo(() => captureChance(hunter.level, wild.level, runes, tuning),
    [hunter.level, runes, tuning, wild.level]);
  const canCapture = held >= tuning.capture.minRuneBid;
  const bids = Array.from(
    { length: tuning.capture.maxRuneBid - tuning.capture.minRuneBid + 1 },
    (_, index) => tuning.capture.minRuneBid + index,
  );

  useEffect(() => {
    if (!receipt) return undefined;
    const timer = window.setTimeout(() => setLanded(true), STRIKE_MS);
    return () => window.clearTimeout(timer);
  }, [receipt]);

  const committed = busy === 'capture' || settling || !!receipt;
  const phase: BindingPhase = receipt
    ? (landed ? (receipt.success ? 'bound' : 'broken') : 'strike')
    : committed ? 'charging' : 'idle';

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
  const retry = async () => {
    setRetrying(true);
    try { onRun(await huntApi.retrySettlement(route)); }
    catch (error) {
      const latest = await huntApi.readHunt(route).catch(() => null);
      if (latest) onRun(latest);
      toast.error(errorMessage(error));
    } finally { setRetrying(false); }
  };

  // The bid the field is showing. Once the item is signed it is the bid that
  // was signed, never whatever the selector happens to be sitting on.
  const shown = receipt?.runesSpent ?? runes;

  return (
    <div className="capture-ceremony absolute inset-0 z-20 flex flex-col" data-element={wild.elementType}>
      {/* Nothing while it loads: the console below is the screen's real
          content, and a placeholder behind it would be a grey box under a
          choice that is already usable. */}
      <Suspense fallback={null}>
        <RuneField
          portraitUrl={portrait(wild.elementType, wild.level, wild.entryNo)}
          element={wild.elementType}
          runes={shown}
          phase={phase}
          className="pointer-events-none absolute inset-0"
        />
      </Suspense>

      {/* The creature, named, over its own field. */}
      <header className="pointer-events-none relative z-10 px-5 pt-5 text-center">
        <p className="eyebrow text-element">
          {phase === 'bound' ? 'Bound'
            : phase === 'broken' ? 'The binding broke'
              : committed ? 'The runes are binding'
                : 'One chance to bind'}
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{wild.name}</h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[.16em] text-faint">
          level {wild.level}
        </p>
      </header>

      <div className="flex-1" />

      <div className="capture-console relative z-10 p-3 sm:p-4">
        {!committed && (
          <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <fieldset data-tour="hunt-bid" disabled={!canCapture || busy !== null}>
              <legend className="text-[11px] uppercase tracking-[.16em] text-faint">
                Runes to throw
              </legend>
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
                        'group border px-1.5 py-2 text-center backdrop-blur-sm transition-colors',
                        selected
                          ? 'border-element bg-element/15 text-element'
                          : 'border-edge bg-void/60 text-muted hover:border-element/45 hover:text-ink',
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
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Every Rune committed is consumed whether the binding holds or breaks.
                {' '}<b className="font-mono text-muted">{held}</b> held.
              </p>
            </fieldset>

            <div className="flex items-center justify-center gap-4 sm:justify-end">
              <div
                className="grid h-20 w-20 shrink-0 place-items-center rounded-full p-[5px]"
                style={{ background: `conic-gradient(rgb(var(--element)) ${chance * 3.6}deg, rgb(var(--raised)) 0deg)` }}
              >
                <div className="grid h-full w-full place-items-center rounded-full border border-element/20 bg-void text-center">
                  <div>
                    <p className="font-mono text-xl font-semibold text-element">{chance}%</p>
                    <p className="text-[8px] uppercase tracking-[.14em] text-faint">bind</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                {/* No busy spinner: pressing this hands the console straight to
                    the settling copy, and the field itself is what says the
                    write is in flight. */}
                <Button variant="primary"
                        disabled={!canCapture || busy !== null}
                        icon={<Sparkle className="h-4 w-4" />} onClick={() => void capture()}>
                  Bind with {runes} Rune{runes === 1 ? '' : 's'}
                </Button>
                <Button variant="quiet" busy={busy === 'decline'} disabled={busy !== null}
                        onClick={() => void decline()}>Let it go</Button>
              </div>
            </div>
          </div>
        )}

        {committed && !receipt && (
          <div className="mx-auto max-w-md text-center">
            <p className="text-sm text-muted">
              Settling the one capture roll with the game ledger.
            </p>
            <p className="mt-1 text-[11px] text-faint">
              {shown} Rune committed. This crosses two processes and takes a few seconds.
            </p>
            {settling && (
              <Button className="mt-3" size="sm" variant="quiet" busy={retrying}
                      onClick={() => void retry()}>
                Retry delivery
              </Button>
            )}
          </div>
        )}

        {receipt && landed && (
          <div className="mx-auto max-w-md text-center">
            <p className="text-sm text-muted">
              {receipt.success
                ? `${wild.name} answered the runes.`
                : 'The runes went cold before they closed.'}
            </p>
            <p className="mt-1 font-mono text-[11px] text-faint">
              rolled {receipt.roll} against {receipt.chance}% · {receipt.runesSpent} Rune spent
            </p>
            <Button className="mt-3" variant="primary"
                    icon={receipt.success ? <Sparkle className="h-4 w-4" /> : <Map className="h-4 w-4" />}
                    onClick={() => onFinish(receipt)}>
              {receipt.success ? 'See what you bound' : 'Return to the trail'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function captureChance(hunter: number, wild: number, runes: number, tuning: HuntTuning) {
  const c = tuning.capture;
  const chance = c.baseChance + Math.floor((c.runeScale * runes) / (runes + c.runeHalf))
    + (hunter - wild) * c.levelStep;
  return Math.max(c.minChance, Math.min(c.maxChance, chance));
}
