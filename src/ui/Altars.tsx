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
  members: number;
  mine: boolean;
};

export function AltarHall({
  info, sworn = null, selected, onSelect, hint, onLive, className,
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
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<Handle | null>(null);
  const [points, setPoints] = useState<AltarPoint[]>([]);
  const [live, setLive] = useState(false);
  const [hover, setHover] = useState<AltarElement | null>(null);

  const layout = useCallback((next: AltarPoint[]) => setPoints(next), []);

  useEffect(() => {
    if (!canvasRef.current) return;
    handle.current = createAltars(canvasRef.current, { sworn, onLayout: layout });
    setLive(Boolean(handle.current));
    onLive?.(Boolean(handle.current));
    return () => {
      handle.current?.dispose();
      handle.current = null;
    };
    // Built once. `sworn` and the lit altar are pushed in below rather than
    // rebuilding the hall, which would restart every core from cold.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // What the hall is lighting: whatever the pointer is on, else whatever has
  // been chosen. Falling back to `selected` is what keeps an altar lit while
  // you read its card instead of going dark the moment the mouse leaves.
  useEffect(() => {
    handle.current?.setActive(hover ?? selected);
  }, [hover, selected]);

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

      {hint && (
        <p className="eyebrow pointer-events-none absolute inset-x-0 top-3 text-center">
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
            const isOn = (hover ?? selected) === element;
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
                // Hidden until the first projection lands, so four buttons do
                // not flash in the top-left corner on mount.
                style={p
                  ? { left: p.x, top: p.y, opacity: 1 }
                  : { left: '50%', top: '50%', opacity: 0 }}
                className={cx(
                  'altar-choice absolute -translate-x-1/2 transition-opacity duration-300',
                  'flex w-[176px] flex-col items-center',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-element',
                )}
              >
                {/* The companion, standing under its own pillar — the one place
                    it can be unambiguous about which monster belongs to which
                    stone. It overlaps the plaque a little on purpose, so the two
                    read as one object rather than as a picture above a box. */}
                <img
                  src={portrait(element)}
                  alt=""
                  loading="lazy"
                  className={cx(
                    'altar-choice-creature relative z-10 -mb-3 h-14 w-14 object-contain transition-all duration-300',
                    isOn ? 'scale-110 opacity-100' : 'opacity-70',
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
