/**
 * The arena floor, with the readouts embossed over it.
 *
 * React owns the battle record; the scene owns the animation. The bridge is one
 * effect: when `battle.round` advances, hand the scene every round it has not
 * played yet and let it play them. Nothing here re-renders per frame.
 *
 * Two things this file is careful about, both of which used to be wrong:
 *
 *  - **Order of effects.** The reply that carries a round also carries the
 *    post-round vitals, and the effect that syncs those used to run first — so
 *    the bars emptied, and only then did the swing that emptied them play. The
 *    round is queued FIRST, which makes the scene busy synchronously, so the
 *    sync that follows in the same commit is parked instead of applied.
 *  - **Where the overlay sits.** Phaser letterboxes its canvas inside the host
 *    whenever the panel's shape does not match 384x216, and the overlay was
 *    positioned against the PANEL — so the corner plates floated in the black
 *    band above the arena instead of over it, and every head bar was off by the
 *    height of that band. The overlay is now laid over the canvas rect itself.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pct } from '../lib/format';
import { Battle, Combatant, Turn } from '../lib/types';
import { cx } from './primitives';
import { mountGame, Mounted } from '../game/boot';
import { BattleScene, HudFrame, Side, Vitals } from '../game/BattleScene';
import { arenaFor, arenaUrl } from '../game/assets';

const BASE_W = 384;
const BASE_H = 216;

/**
 * The walk sheet a combatant fights with.
 *
 * `Combatant.sprite` is optional on the record — a house opponent has no
 * wallet and may arrive without one — so fall back to the other fighter's, and
 * finally to whatever bundled. A missing sheet must not blank the stage.
 */
const FALLBACK = 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ';

const vitals = (c: Combatant): Vitals => ({
  healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
  shield: c.shield, maxShield: c.maxShield,
  attack: c.attack, defense: c.defense, speed: c.speed,
});

/** Everything the scene's corner panel needs about one fighter. */
const side = (c: Combatant) => ({
  ...vitals(c),
  entryNo: c.entryNo,
  element: c.elementType,
  // A bot opponent is a trainer, not "the house" — it gets a name of its own
  // the day one is rendered, and the panel already has the room for it.
  name: c.name || (c.address === 'bot' ? 'Trainer' : 'Rival'),
  level: c.level,
  baseAttack: c.baseAttack, baseDefense: c.baseDefense, baseSpeed: c.baseSpeed,
});

/** Where the canvas actually is inside the panel, in CSS pixels. */
type Box = { left: number; top: number; width: number; height: number };

export default function BattleStageImpl({
  battle, me, them, className, fill, bare, onSettled, onImpact,
}: {
  battle: Battle; me: Combatant; them: Combatant; className?: string;
  /** Take height from the flex parent rather than the 16:9 aspect ratio. */
  fill?: boolean;
  /** Scene only — no corner plates. For the companion screen's glance at it. */
  bare?: boolean;
  /** Fires once the last round has finished PLAYING, not when it resolved. */
  onSettled?: () => void;
  /** Fires the instant a blow connects, for the page's own reaction to it. */
  onImpact?: (side: Side, lethal: boolean) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // One node per fighter, moved by direct style writes from the scene's frame
  // callback. Never through React: a setState 60 times a second to slide a
  // health bar is the thing this rewrite exists to stop doing.
  const trackRefs = useRef<Record<Side, HTMLDivElement | null>>({
    challenger: null, accepter: null,
  });
  const [vits, setVits] = useState<Record<Side, Vitals | null>>({
    challenger: null, accepter: null,
  });
  const mountedRef = useRef<Mounted | null>(null);
  /** The highest round already handed to the scene. */
  const playedTo = useRef(battle.round);
  const playedFor = useRef(battle.id);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * Bumped once the scene has run `create()` and is accepting rounds.
   *
   * The play effect needs it: a round that lands in the tick before the scene
   * exists has nowhere to go, and without a re-render to retry on it would be
   * skipped outright rather than merely delayed.
   */
  const [live, setLive] = useState(0);

  // Held in a ref so the scene's binding never goes stale and re-binding is
  // never a reason to rebuild the whole scene.
  const impactRef = useRef(onImpact);
  impactRef.current = onImpact;

  // Deterministic on the battle id, so both players see the same room and a
  // reload does not teleport the fight somewhere else mid-round.
  const arena = arenaFor(battle.id, me.elementType);

  const scene = useCallback(
    () => mountedRef.current?.scene<BattleScene>(BattleScene.KEY) ?? null,
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    const shell = shellRef.current;
    if (!host || !shell || !arenaUrl(arena)) return undefined;

    const mounted = mountGame(host, BASE_W, BASE_H, [BattleScene], {
      maxZoom: 4,
      onScale: () => setReady(true),
    });
    mounted.game.scene.start(BattleScene.KEY, {
      arena,
      you: me.side,
      left: { ...side(me), sprite: me.sprite || FALLBACK },
      right: { ...side(them), sprite: them.sprite || me.sprite || FALLBACK },
    });
    mountedRef.current = mounted;

    // Where the canvas ended up. Phaser's FIT keeps 384x216, so any panel of a
    // different shape leaves a band on two sides — and the overlay has to know
    // about it or every plate and bar it draws is in the wrong place.
    const measure = () => {
      const canvas = mounted.game.canvas;
      if (!canvas) return;
      const c = canvas.getBoundingClientRect();
      const s = shell.getBoundingClientRect();
      if (!c.width || !c.height) return;
      setBox((prev) => {
        const next = {
          left: c.left - s.left, top: c.top - s.top,
          width: c.width, height: c.height,
        };
        return prev
          && Math.abs(prev.left - next.left) < 0.5
          && Math.abs(prev.top - next.top) < 0.5
          && Math.abs(prev.width - next.width) < 0.5
          && Math.abs(prev.height - next.height) < 0.5
          ? prev : next;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    ro.observe(host);
    if (mounted.game.canvas) ro.observe(mounted.game.canvas);
    measure();

    // Bind once `create()` has run, which is a tick after `start()`.
    let retry = 0;
    let timer = 0;
    const bind = () => {
      const s = mounted.scene<BattleScene>(BattleScene.KEY);
      if (!s) {
        if (retry++ < 50) timer = window.setTimeout(bind, 60);
        return;
      }
      measure();
      setLive((n) => n + 1);
      s.bindHud(
        (frames: HudFrame[]) => {
          for (const fr of frames) {
            const el = trackRefs.current[fr.side];
            if (!el) continue;
            el.style.left = `${fr.xFrac * 100}%`;
            el.style.top = `${fr.yFrac * 100}%`;
          }
        },
        (sd, v) => setVits((prev) => ({ ...prev, [sd]: v })),
        (sd, lethal) => impactRef.current?.(sd, lethal),
      );
    };
    bind();

    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      mountedRef.current = null;
      mounted.destroy();
    };
    // Keyed on the battle ID but deliberately NOT on the round: a new fight
    // deserves fighters back on their marks and neither of them slumped, while
    // rebuilding the scene every round would reload every texture and restart
    // the staging mid-fight.
  }, [battle.id, arena, me.side, me.sprite, me.elementType, them.sprite, them.elementType]);

  /**
   * Play every round that has not been played, in order.
   *
   * DECLARED FIRST, and deliberately: the scene marks itself busy the moment a
   * round is queued, which is what stops the vitals sync below from applying
   * the round's outcome before the round has been drawn.
   *
   * Rounds are caught up rather than skipped. Filtering on `battle.round` alone
   * meant that when two rounds landed between renders — a PvP poll that catches
   * up, a slow frame — the middle one was never drawn, and the fight jumped.
   */
  useLayoutEffect(() => {
    // A new fight starts its numbering over, on a scene rebuilt for it. Nothing
    // of the previous one is replayed.
    if (playedFor.current !== battle.id) {
      playedFor.current = battle.id;
      playedTo.current = battle.round;
      return;
    }
    if (battle.round <= playedTo.current) return;
    const s = scene();
    if (!s) return;

    const from = playedTo.current;
    playedTo.current = battle.round;

    const byRound = new Map<number, Turn[]>();
    for (const t of battle.turns) {
      if (t.round <= from || t.round > battle.round) continue;
      const list = byRound.get(t.round);
      if (list) list.push(t);
      else byRound.set(t.round, [t]);
    }
    // `battle.turns` is the whole fight's log and is trimmed on the process
    // side, so a round with nothing left in it simply has nothing to play.
    for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
      s.playRound(byRound.get(round)!);
    }
  }, [battle.id, battle.round, battle.turns, scene, live]);

  /**
   * Keep the panels honest when nothing animated.
   *
   * A reload lands mid-fight with health already spent, and a PvP poll can
   * replace the whole battle without a round of ours to play. While a round IS
   * playing the scene parks these instead — see `setVitals` there.
   */
  useEffect(() => {
    const s = scene();
    if (!s) return;
    s.setVitals(me.side, vitals(me));
    s.setVitals(them.side, vitals(them));
  }, [me, them, scene]);

  /**
   * The slump, and the all-clear — both AFTER the fight has finished playing.
   *
   * The process decides the whole round at once, so the reply that lands the
   * killing blow also says the battle is over. Reacting to that directly put
   * the victory panel on screen while the winning move was still walking
   * across the arena: you were told you had won, and then watched the swing
   * that did it. The result is known early on purpose — it must not be SHOWN
   * early.
   *
   * A fight loaded already-ended (a reload after the fact) has an empty queue
   * and settles immediately, which is right: there is nothing left to watch.
   */
  useEffect(() => {
    if (battle.status !== 'ended') return undefined;
    let cancelled = false;
    const s = scene();
    const done = () => {
      if (cancelled) return;
      scene()?.finish(battle.winner ?? null);
      onSettled?.();
    };
    if (s) void s.settled().then(done);
    else done();
    return () => { cancelled = true; };
  }, [battle.status, battle.winner, onSettled, scene]);

  if (!arenaUrl(arena)) return null;

  return (
    <div
      ref={shellRef}
      className={cx(
        'relative overflow-hidden',
        // Framed only when it is a card in a page. When it is filling a panel
        // the canvas IS the picture, and a border, a background and a rounded
        // corner just draw a box around whatever letterbox band the panel's
        // shape leaves.
        fill
          ? 'flex min-h-0 flex-col'
          : 'rounded-[3px] border border-rune/12 bg-void/60',
        className,
      )}
    >
      <div
        ref={hostRef}
        className={cx('grid w-full place-items-center', fill && 'min-h-0 flex-1')}
        style={fill ? undefined : { aspectRatio: `${BASE_W} / ${BASE_H}` }}
        aria-label={`${me.name} against ${them.name}`}
        role="img"
      />

      {/* The readouts live in the DOM, over the canvas, not inside it.
          In-scene text is drawn into a 384px-wide buffer and then blown up with
          the rest of the art, so an 8px label reaches the screen as a handful
          of fat pixels — legible only by accident. Out here it renders at the
          display's own resolution and stays sharp at any zoom, while the fight
          underneath keeps its pixel grid.

          Positioned to the CANVAS rect and not the panel, so the plates are
          embossed on the arena art rather than parked in whatever letterbox
          band the panel's shape happens to leave. */}
      <div
        className="pointer-events-none absolute overflow-hidden"
        style={box
          ? { left: box.left, top: box.top, width: box.width, height: box.height }
          : { inset: 0 }}
      >
        {!bare && <Plate at="left" c={me} v={vits[me.side]} you />}
        {!bare && <Plate at="right" c={them} v={vits[them.side]} />}

        {[me, them].map((c) => (
          <div
            key={c.side}
            ref={(el) => { trackRefs.current[c.side] = el; }}
            className="absolute -translate-x-1/2 -translate-y-full"
          >
            <HeadBar v={vits[c.side]} c={c} />
          </div>
        ))}
      </div>

      {!ready && <div className="absolute inset-0 animate-pulse bg-raised/40" />}
    </div>
  );
}

/**
 * The corner readout: who, how hurt, and how far their stats have drifted.
 *
 * Embossed ON the arena — a translucent slab with a light top edge and a dark
 * bottom one, sitting in the art's own corner. It used to be a flat card in the
 * band above the scene, which cost a strip of the only thing on the page worth
 * looking at.
 *
 * The stats are spelled ATK/DEF/SPD rather than A/D/S, and a drift is written
 * as `+2` beside the current value. `statsChanged` is the only status-effect
 * channel the process has, so that green `+2` IS the buff display — nothing
 * here is invented, and a single letter was not enough to say so.
 */
function Plate({
  at, c, v, you,
}: { at: 'left' | 'right'; c: Combatant; v: Vitals | null; you?: boolean }) {
  // Fall back to the record until the scene has reported once, so the panel is
  // never blank on the first frame of a fight.
  const cur = v ?? {
    healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
    shield: c.shield, maxShield: c.maxShield,
    attack: c.attack, defense: c.defense, speed: c.speed,
  };
  const hp = pct(cur.healthPoints, cur.maxHealthPoints);
  const sh = pct(cur.shield, cur.maxShield);

  return (
    <div
      className={cx(
        'absolute top-1.5 w-[38%] max-w-[196px] overflow-hidden rounded-[3px]',
        'bg-void/55 px-2 py-1.5 backdrop-blur-[2px]',
        // The emboss: a lit top edge, a dark base, and a shadow that lifts the
        // slab off the art underneath it.
        'shadow-[0_1px_0_rgb(255_255_255/.10)_inset,0_-1px_0_rgb(0_0_0/.55)_inset,0_2px_10px_rgb(0_0_0/.45)]',
        'ring-1 ring-inset ring-rune/20',
        at === 'left' ? 'left-1.5' : 'right-1.5',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium leading-none drop-shadow-[0_1px_1px_rgb(0_0_0/.9)]">
          {you ? 'You' : c.address === 'bot' ? 'Trainer' : c.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] leading-none text-faint">
          lv{c.level}
        </span>
      </div>

      {/* Shield above health: it is the layer spent first, so it reads as the
          outer skin over the health underneath it. */}
      {cur.maxShield > 0 && (
        <Meter
          className="mt-1.5" fill="bg-tide" value={sh} tall
          label={`${cur.shield}/${cur.maxShield}`}
        />
      )}
      <Meter
        className="mt-1" tall
        fill={hp > 50 ? 'bg-good' : hp > 25 ? 'bg-warn' : 'bg-bad'}
        value={hp}
        label={`${cur.healthPoints}/${cur.maxHealthPoints}`}
      />

      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <Stat k="ATK" now={cur.attack} base={c.baseAttack} />
        <Stat k="DEF" now={cur.defense} base={c.baseDefense} />
        <Stat k="SPD" now={cur.speed} base={c.baseSpeed} />
      </div>
    </div>
  );
}

/**
 * A bar, with its own numbers written inside it.
 *
 * The count used to sit to the right of the bar, which cost the width of
 * `188/188` on every readout and left the bar itself narrow — and on the small
 * bar that follows a fighter around, the number was a third line under it. In
 * here it takes no extra room at all.
 *
 * Black text, because the fill is a bright colour and this has to read as part
 * of the bar rather than as a label near it. It is drawn TWICE, in two
 * complementary clips: black across the filled span and pale across the drained
 * one. A single black label was unreadable at exactly the moment it mattered
 * most — a shield down to 1/24 put the number over the empty track, black on
 * near-black.
 *
 * The width transition is short on purpose. The scene drains the shield and the
 * health as two separate steps 230ms apart, and a 300ms bar would still be
 * moving when the next step started — the two would overlap and read as one
 * simultaneous drop, which is the thing being fixed.
 */
function Meter({
  value, fill, label, className, tall,
}: {
  value: number; fill: string; label: string; className?: string; tall?: boolean;
}) {
  return (
    <div
      className={cx(
        'relative w-full overflow-hidden rounded-[2px] bg-black/70',
        'ring-1 ring-inset ring-black/60',
        tall ? 'h-[13px]' : 'h-[11px]',
        className,
      )}
    >
      <div
        className={cx('h-full transition-[width] duration-200 ease-out', fill)}
        style={{ width: `${value}%` }}
      />
      {/* Both copies are laid out identically and clipped against each other,
          so the digits line up exactly where the fill ends. */}
      <span
        className={cx(
          'absolute inset-0 grid place-items-center font-mono font-bold leading-none',
          'tabular-nums text-black transition-[clip-path] duration-200 ease-out',
          tall ? 'text-[10px]' : 'text-[9px]',
        )}
        style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
      >
        {label}
      </span>
      <span
        className={cx(
          'absolute inset-0 grid place-items-center font-mono font-bold leading-none',
          'tabular-nums text-ink/75 transition-[clip-path] duration-200 ease-out',
          tall ? 'text-[10px]' : 'text-[9px]',
        )}
        style={{ clipPath: `inset(0 0 0 ${value}%)` }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The last change to a number, for as long as it is worth looking at.
 *
 * Returns the delta the moment the value moves and zero again a beat later, so
 * a readout can announce a change without then carrying it around forever.
 */
function useFlash(value: number, ms = 1600) {
  const previous = useRef(value);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const d = value - previous.current;
    previous.current = value;
    if (d === 0) return undefined;
    setDelta(d);
    const timer = window.setTimeout(() => setDelta(0), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);

  return delta;
}

/**
 * One stat: the value it is at now, and — for a moment — what just moved it.
 *
 * It used to print the current value and the drift from base side by side,
 * `ATK 8 +5`, permanently. That reads as a sum, and it is not one: the 8
 * already contains the 5. Both numbers moved together on every rider, so there
 * was no telling from looking at them which was which, and the drift sat there
 * for the rest of the fight long after it was news.
 *
 * So the chip carries one number, and when a rider lands it goes green or red
 * and says `+5` for a second and a half before settling back. The same change
 * is floating off the creature itself at the same time — see `riders` in
 * BattleScene — which is where you are actually looking when it happens.
 *
 * Chips on a light fill with black type, so the stats read as the same kind of
 * thing as the numbers inside the bars above them.
 */
function Stat({ k, now, base }: { k: string; now: number; base: number }) {
  const delta = useFlash(now);
  return (
    <span
      title={now === base
        ? `${k} ${now}`
        : `${k} ${now} — started at ${base}`}
      className={cx(
        'flex items-center justify-center gap-0.5 rounded-[2px] px-1 py-px',
        'font-mono text-[10px] font-bold leading-none tabular-nums text-black',
        'transition-colors duration-200',
        delta > 0 ? 'bg-good' : delta < 0 ? 'bg-bad' : 'bg-ink/80',
      )}
    >
      <span className="opacity-60">{k}</span>
      <span>{now}</span>
      {delta !== 0 && <span>{delta > 0 ? '+' : ''}{delta}</span>}
    </span>
  );
}

/**
 * The bar that sits on a fighter, wherever the fighter is.
 *
 * Narrow, and narrow deliberately: it tracks the sprite exactly — through the
 * walk in, the swing and the walk home — so it has to be small enough that two
 * of them at closest approach do not become one unreadable smear. Both numbers
 * live inside their bars for the same reason.
 */
function HeadBar({ v, c }: { v: Vitals | null; c: Combatant }) {
  const cur = v ?? {
    healthPoints: c.healthPoints, maxHealthPoints: c.maxHealthPoints,
    shield: c.shield, maxShield: c.maxShield,
    attack: 0, defense: 0, speed: 0,
  };
  const hp = pct(cur.healthPoints, cur.maxHealthPoints);
  const sh = pct(cur.shield, cur.maxShield);
  return (
    <div className="w-[66px] space-y-0.5 rounded-[2px] bg-void/70 p-0.5 ring-1 ring-inset ring-rune/15 shadow-[0_2px_6px_rgb(0_0_0/.55)]">
      {cur.maxShield > 0 && (
        <Meter fill="bg-tide" value={sh} label={`${cur.shield}/${cur.maxShield}`} />
      )}
      <Meter
        fill={hp > 50 ? 'bg-good' : hp > 25 ? 'bg-warn' : 'bg-bad'}
        value={hp}
        label={`${cur.healthPoints}/${cur.maxHealthPoints}`}
      />
    </div>
  );
}
