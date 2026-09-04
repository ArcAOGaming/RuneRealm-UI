/**
 * The Altar Hall, wired to the DOM.
 *
 * The scene draws four altars; this puts a real `<button>` over each one. That
 * is deliberate and it is not the lazy option — a raycaster would give hover and
 * click and nothing else, and the most important choice in the game would be
 * unreachable by keyboard and invisible to a screen reader. The renderer
 * projects each core's world position to CSS pixels every frame and hands them
 * back through `onLayout`; the buttons follow. Tab order is left to right, the
 * hall lights whatever has focus, and Enter swears.
 *
 * If WebGL is unavailable the whole thing renders nothing and `Factions` shows
 * its grid, which carries every fact the hall does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALTAR_ORDER, AltarElement, AltarPoint, Altars as Handle, createAltars,
} from '../gfx/altars';
import { ELEMENT_ICON } from './icons';
import { ELEMENT_LABEL } from '../lib/format';
import { portrait } from './art';
import { cx } from './primitives';

/** What the plaque under each pillar says. */
export type AltarInfo = {
  name: string;
  companion: string;
  entryNo?: number;
  members: number;
  mine: boolean;
};

/**
 * The arrival, in milliseconds.
 *
 * One altar every `STEP`, under the light for `HOLD` of it and stepped back for
 * the rest, so each faction gets a beat of its own and the room fills left to
 * right. Four steps, the release, and then the companions — 7.4s end to end,
 * which is the whole of it inside the eight the sequence is allowed.
 */
const STEP = 1700;
const HOLD = 1150;
/** After the last altar steps back, everything comes up together. */
const RELEASE = ALTAR_ORDER.length * STEP;
/** And only then do the companions walk in — all four, so you see the field. */
const COMPANIONS = RELEASE + 600;

/** Where the arrival has got to. `done` is an ordinary hall again. */
type Arrival = {
  present: AltarElement[];
  spotlight: AltarElement | null;
  companions: boolean;
  done: boolean;
};

const ARRIVED: Arrival = {
  present: ALTAR_ORDER, spotlight: null, companions: true, done: true,
};

export function AltarHall({
  info, sworn = null, selected, onSelect, hint, onLive, intro = false, onIntroDone, className,
}: {
  /**
   * One plaque per element.
   *
   * This used to be four cards in a grid under the hall, which lined nothing up
   * with anything: four altars over two rows of two. The plaque belongs to its
   * own pillar, under its own companion, or there is no way to tell at a glance
   * which monster is whose.
   */
  info: Partial<Record<AltarElement, AltarInfo>>;
  sworn?: AltarElement | null;
  selected: AltarElement | null;
  /** Opens that faction's detail. Swearing happens there, not here. */
  onSelect: (element: AltarElement) => void;
  /** One quiet line at the foot of the hall, when there is something to do. */
  hint?: string;
  /** Told whether the hall actually rendered, so the page can fall back. */
  onLive?: (live: boolean) => void;
  /**
   * Play the arrival: an empty room that fills one altar at a time.
   *
   * Read ONCE, on mount, because the hall is built empty or it is not built
   * empty — see `createAltars`. Flipping it later does nothing.
   */
  intro?: boolean;
  /** The hall is finished introducing itself and the choice is the player's. */
  onIntroDone?: () => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<Handle | null>(null);
  const [points, setPoints] = useState<AltarPoint[]>([]);
  const [live, setLive] = useState(false);
  const [hover, setHover] = useState<AltarElement | null>(null);

  const layout = useCallback((next: AltarPoint[]) => setPoints(next), []);

  /*
    Whether this hall is playing the arrival is decided once, at mount, and the
    ref is what the build effect reads. A prop would be re-read on every render
    and the hall is built exactly once — the two cannot disagree if only one of
    them is allowed to answer.

    Somebody who has asked their system not to animate gets the room as it ends:
    four altars, four companions, nothing moving.
  */
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const playing = useRef(intro && !reduced).current;
  const [arrival, setArrival] = useState<Arrival>(
    playing ? { present: [], spotlight: null, companions: false, done: false } : ARRIVED,
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    handle.current = createAltars(canvasRef.current, { sworn, onLayout: layout, intro: playing });
    setLive(Boolean(handle.current));
    onLive?.(Boolean(handle.current));
    return () => {
      handle.current?.dispose();
      handle.current = null;
    };
    // Built once. `sworn` and the lit altar are pushed in below rather than
    // rebuilding the hall, which would restart every core from cold.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    The arrival itself: one schedule, laid out up front.

    Every beat is an absolute offset from the same start rather than a chain of
    timeouts each waiting on the last, so the sequence cannot drift and the
    cleanup is one loop. It runs on the clock and not on the render: what the
    hall is doing is pushed straight into the handle, and React is told at the
    same time only because the plaques and the companions live in the DOM.
  */
  const timersRef = useRef<number[]>([]);

  /**
   * End it now.
   *
   * Anybody who touches the screen during the arrival has stopped watching it,
   * and a seven-second cutscene you cannot get out of is worse than no cutscene
   * — so the first click or keypress lands the room and hands over the choice.
   */
  const skip = useCallback(() => {
    if (timersRef.current.length === 0) return;
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    setArrival(ARRIVED);
    handle.current?.setIntro(null);
    onIntroDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const at: [number, Arrival][] = [];
    ALTAR_ORDER.forEach((element, i) => {
      const present = ALTAR_ORDER.slice(0, i + 1);
      at.push([i * STEP, { present, spotlight: element, companions: false, done: false }]);
      at.push([i * STEP + HOLD, { present, spotlight: null, companions: false, done: false }]);
    });
    at.push([RELEASE, { ...ARRIVED, companions: false, done: true }]);
    at.push([COMPANIONS, ARRIVED]);

    const timers = timersRef.current = at.map(([ms, state]) => window.setTimeout(() => {
      setArrival(state);
      // The hall is driven from here, not from an effect on `arrival`: the
      // spotlight's flare is an event, and an effect would re-fire it on any
      // unrelated re-render that happened to land on the same state.
      handle.current?.setIntro(state.done ? null : {
        present: state.present, spotlight: state.spotlight,
      });
      if (state.spotlight) handle.current?.strike(state.spotlight);
      if (state === ARRIVED) { timersRef.current = []; onIntroDone?.(); }
    }, ms));
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // What the hall is lighting: whatever the pointer is on, else whatever has
  // been chosen. Falling back to `selected` is what keeps an altar lit while
  // you read its card instead of going dark the moment the mouse leaves.
  //
  // Nothing until the arrival is over: the sequence owns the light while it
  // runs, and a pointer resting where an altar is about to appear must not take
  // it over mid-introduction.
  useEffect(() => {
    if (!arrival.done) return;
    handle.current?.setActive(hover ?? selected);
  }, [hover, selected, arrival.done]);

  // The strike is the oath landing, not the fact of having taken one. Firing it
  // on mount flashed the altar of anyone who had already sworn every time they
  // opened the page, which reads as the hall making the choice for them.
  const firstSworn = useRef(true);
  useEffect(() => {
    handle.current?.setSworn(sworn);
    if (firstSworn.current) { firstSworn.current = false; return; }
    if (sworn) handle.current?.strike(sworn);
  }, [sworn]);

  return (
    <div
      className={cx(
        // Out of the content column entirely. Inside `max-w-6xl` the hall was a
        // viewport cut into the page and cropped on all four sides; it has to be
        // the room, not a window onto one.
        'full-bleed relative overflow-hidden',
        // The whole screen, header included — the caller pulls this up behind
        // the nav, so the room carries on under it rather than starting below
        // it on a seam. `dvh` and not `vh`: on a phone `vh` is the tallest the
        // viewport ever gets, so a `100vh` hall sits with its foot under the
        // browser chrome until you scroll.
        'h-[100dvh] min-h-[520px]',
        className,
      )}
      // The arrival is a thing you are shown, not a thing you are held in.
      onPointerDown={arrival.done ? undefined : skip}
      onKeyDownCapture={arrival.done ? undefined : skip}
    >
      {/*
        Sized in CSS, always.
        `setSize(w, h, false)` writes the canvas's width/height ATTRIBUTES and
        deliberately leaves its style alone. With no CSS size the element then
        lays out at its attribute size, which is the size it was just given from
        its own `clientWidth` — and the canvas grew every frame until it was
        ninety thousand pixels wide and the hall had left the building.

        No mask on it, deliberately. One went on to stop the canvas reading as a
        box, and it was solving a problem that does not exist: the renderer
        clears to alpha zero, so everywhere the hall is not lit the page shows
        straight through and there is no edge to hide. What the mask did instead
        was eat the bottoms of the plinths — its ellipse started falling off at
        about three quarters of the height, which is exactly where the stone
        meets the floor. The floor fades in the shader; the page fades it again
        below. That is enough.
      */}
      {/* Full height, no reserved band. The plaques stand over the near floor,
          which the shader has already faded to nothing by the time it gets
          there — so the space under the plinths is theirs, and the canvas does
          not have to give up a strip of the screen to hand it over. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/*
        The floor has to end somewhere and it must not end on a line.

        It is an opaque plane and the camera looks down at it, so the near edge
        of it runs straight into the bottom of the canvas and stops dead. This
        sits over that seam — note it is anchored ABOVE the foot of the wrapper,
        because that is where the canvas ends, not at the bottom of the box.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
        style={{ background: 'linear-gradient(to bottom, transparent, rgb(var(--void)))' }}
      />

      {/* Not while the room is still filling: the line tells you to choose an
          altar, and for seven seconds there is nothing yet to choose. */}
      {hint && arrival.done && (
        <p className="eyebrow pointer-events-none absolute inset-x-0 top-3 text-center animate-rise">
          {hint}
        </p>
      )}

      {live && (
        <div className="absolute inset-0">
          {ALTAR_ORDER.map((element) => {
            const p = points.find((q) => q.element === element);
            const Icon = ELEMENT_ICON[element];
            const plaque = info[element];
            const isSworn = sworn === element;
            // Standing at an altar during the arrival is the sequence's doing,
            // not the pointer's.
            const isOn = arrival.done
              ? (hover ?? selected) === element
              : arrival.spotlight === element;
            /** Arrived. Before that the plaque is not on the screen at all. */
            const here = arrival.present.includes(element);
            /** Shown off and stepped back, waiting for the rest to arrive. */
            const waiting = here && !arrival.done && arrival.spotlight !== element;
            return (
              <button
                key={element}
                type="button"
                // Each button carries its own element, so `text-element`
                // resolves to that faction's colour rather than the page's.
                data-element={element}
                aria-pressed={selected === element}
                onPointerEnter={() => setHover(element)}
                onPointerLeave={() => setHover((h) => (h === element ? null : h))}
                onFocus={() => setHover(element)}
                onBlur={() => setHover((h) => (h === element ? null : h))}
                onClick={() => onSelect(element)}
                // Nothing is choosable while the hall is still introducing
                // itself — including by keyboard, which is why it is `disabled`
                // and not a pointer-events class.
                disabled={!arrival.done}
                // Hidden until the first projection lands, so four buttons do
                // not flash in the top-left corner on mount. And hidden again,
                // per altar, until that altar has risen: the plaque belongs to
                // the stone and must not stand over an empty floor.
                style={p && here
                  ? { left: p.x, top: p.y, opacity: 1 }
                  : { left: p ? p.x : '50%', top: p ? p.y : '50%', opacity: 0 }}
                className={cx(
                  'altar-choice absolute -translate-x-1/2 duration-300',
                  'transition-[opacity,filter,transform]',
                  'flex w-[176px] flex-col items-center',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-element',
                  // Stepped back: the plaque goes with its altar, grey and a
                  // little smaller, until the whole room comes up together.
                  waiting && 'scale-[0.94] opacity-45 grayscale',
                )}
              >
                {/*
                  The stone itself, made clickable.

                  The plaque used to be the whole button, so the altar — the lit
                  two-metre object the screen is built around, and the thing
                  everybody pointed at first — did nothing at all. This reaches
                  UP from the plaque to just above the core and out to the
                  plinth's own width, both measured by projecting the real
                  geometry each frame, so hovering or clicking the altar is
                  hovering or clicking its faction.

                  It is a child of the same button rather than a second one:
                  one control, one focus stop, one thing for a screen reader.
                */}
                <span
                  aria-hidden
                  className="altar-choice-stone absolute bottom-full left-1/2 -translate-x-1/2"
                  style={p && here
                    ? { width: Math.max(64, p.half * 2), height: Math.max(0, p.y - p.top) }
                    : { width: 0, height: 0 }}
                />

                {/* The companion, standing under its own pillar — the one place
                    it can be unambiguous about which monster belongs to which
                    stone. It overlaps the plaque a little on purpose, so the two
                    read as one object rather than as a picture above a box. */}
                {/* The companions come last and come together — four altars
                    first, then who is standing on them, so the arrival ends on
                    what you would actually be raising. `visibility` and not a
                    mount, so the images are already decoded when they land. */}
                <img
                  src={portrait(element, 0, plaque?.entryNo)}
                  alt=""
                  loading="eager"
                  className={cx(
                    'altar-choice-creature relative z-10 -mb-3 h-14 w-14 object-contain',
                    'transition-all duration-500',
                    !arrival.companions
                      ? 'invisible translate-y-3 scale-75 opacity-0'
                      : isOn ? 'scale-110 opacity-100' : 'opacity-70',
                  )}
                />

                <span
                  className={cx(
                    'altar-choice-plaque w-full rounded-[3px] border px-2.5 pb-1.5 pt-3.5 backdrop-blur-sm transition-colors',
                    isOn
                      ? 'border-element/50 bg-void/80'
                      : 'border-edge/60 bg-void/50',
                  )}
                >
                  <span
                    className={cx(
                      'altar-choice-name flex items-center justify-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors',
                      isOn || isSworn ? 'text-ink' : 'text-muted',
                    )}
                  >
                    <Icon
                      className={cx(
                        'h-3.5 w-3.5 shrink-0 transition-colors',
                        isOn || isSworn ? 'text-element' : 'text-faint',
                      )}
                    />
                    <span className="altar-choice-title-full">
                      {plaque?.name ?? ELEMENT_LABEL[element]}
                    </span>
                    <span className="altar-choice-title-mobile" aria-hidden>
                      {ELEMENT_LABEL[element]}
                    </span>
                  </span>

                  {plaque && (
                    <span className="altar-choice-detail mt-0.5 block whitespace-nowrap text-[11px] text-faint">
                      <span className="text-muted">{plaque.companion}</span>
                      {' · '}
                      {plaque.members} member{plaque.members === 1 ? '' : 's'}
                    </span>
                  )}

                  <span
                    className={cx(
                      'eyebrow mt-1 block transition-colors',
                      isSworn ? 'text-element' : 'text-faint/70',
                    )}
                  >
                    <span className="altar-choice-status-full">
                      {isSworn ? 'Sworn' : ELEMENT_LABEL[element]}
                    </span>
                    <span className="altar-choice-status-mobile" aria-hidden>
                      {isSworn ? 'Sworn' : plaque?.companion ?? 'Open'}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AltarHall;
