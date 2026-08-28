/**
 * The character, stood still and looked at.
 *
 * One large view with the four facings under it, all animating together — the
 * parked customiser had these as two separate modes you toggled between, which
 * meant checking that the back of a coat lined up with the front was a click
 * and a re-render rather than a glance.
 *
 * ONE rAF loop drives all five canvases. Five loops, or a timer each, is how
 * the old preview ended up with the walk cycle in the big view a frame or two
 * out of step with the small ones — five clocks cannot stay in phase, and a
 * character whose four copies are all mid-stride differently reads as broken
 * art rather than as a preview.
 *
 * Every frame redraws from the live sheet rather than from a snapshot, so a
 * dye change appears on the next frame with nothing to invalidate.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  animationFrames, blitFrame, FACINGS, SPRITE_CROP, type Facing,
} from '../../lib/sprites';
import { cx } from '../primitives';

const FRAME_MS = 160;
const STRIP_SCALE = 2;

/** Width of one facing tile, and the height its block costs including a gap. */
const STRIP_W = 58;
const STRIP_BLOCK = 104;

/** Padding the stage keeps around the character, top and bottom. */
const GUTTER = 36;

const LABEL: Record<Facing, string> = {
  down: 'Front', left: 'Left', right: 'Right', up: 'Back',
};

export function Portrait({
  sheet, ready, facing, onFacing, walking,
}: {
  sheet: HTMLCanvasElement | null;
  ready: boolean;
  facing: Facing;
  onFacing: (f: Facing) => void;
  walking: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const stripRefs = useRef<Partial<Record<Facing, HTMLCanvasElement | null>>>({});

  /**
   * How many screen pixels one sprite pixel gets.
   *
   * Derived from the stage rather than fixed at 4 or 5, because the stage is no
   * longer a shape of its own — it is whatever height is left after the rest of
   * the screen has been laid out, so a constant scale either overflows a short
   * window or leaves a tall one mostly empty. WHOLE numbers only: a pixel-art
   * sprite at 4.3x has some pixels three screen pixels wide and some four, and
   * the seam runs right down the character's face.
   */
  const [scale, setScale] = useState(4);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const byHeight = Math.floor((el.clientHeight - STRIP_BLOCK - GUTTER) / SPRITE_CROP.h);
      const byWidth = Math.floor((el.clientWidth - 32) / SPRITE_CROP.w);
      setScale(Math.max(2, Math.min(7, byHeight, byWidth)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Read through refs so the loop is started once and never restarted: it is
  // the same five canvases whatever the outfit, and tearing the loop down on
  // every dye change is what makes a preview stutter while a colour is dragged.
  const live = useRef({ sheet, ready, facing, walking, scale });
  live.current = { sheet, ready, facing, walking, scale };

  useEffect(() => {
    let raf = 0;

    const paint = (
      view: HTMLCanvasElement | null | undefined,
      s: HTMLCanvasElement, name: string, at: number,
    ) => {
      if (!view) return;
      const ctx = view.getContext('2d');
      if (!ctx) return;
      view.width = SPRITE_CROP.w * at;
      view.height = SPRITE_CROP.h * at;
      ctx.clearRect(0, 0, view.width, view.height);
      blitFrame(s, ctx, name, 0, 0, at, SPRITE_CROP);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { sheet: s, ready: ok, facing: f, walking: w, scale: at } = live.current;
      if (!s || !ok) return;

      const step = Math.floor(now / FRAME_MS);
      const main = animationFrames(f, w);
      paint(mainRef.current, s, main[step % main.length], at);

      for (const dir of FACINGS) {
        const names = animationFrames(dir, w);
        paint(stripRefs.current[dir], s, names[step % names.length], STRIP_SCALE);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col items-center justify-center gap-4 overflow-hidden px-4"
    >
      {/* The plinth: element light from below and a contact shadow, so the
          character is standing on something rather than floating on a panel. */}
      <div className="relative flex items-end justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-24 -bottom-6 h-32"
          style={{
            background:
              'radial-gradient(46% 100% at 50% 100%, rgb(var(--element) / 0.32), transparent 72%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-0.5 left-1/2 h-2 w-24 -translate-x-1/2 rounded-[50%]"
          style={{ background: 'rgb(0 0 0 / 0.55)', filter: 'blur(3px)' }}
        />
        <canvas
          ref={mainRef}
          role="img"
          aria-label="Your character"
          className={cx('relative [image-rendering:pixelated]', !ready && 'opacity-0')}
          style={{
            width: SPRITE_CROP.w * scale,
            height: SPRITE_CROP.h * scale,
            filter: 'drop-shadow(0 8px 16px rgb(0 0 0 / 0.55))',
          }}
        />
      </div>

      {/* All four sides at once. Clicking one is what the facing buttons used
          to be — the thing you want to see IS the control. */}
      <div className="flex shrink-0 gap-1.5">
        {FACINGS.map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => onFacing(dir)}
            aria-pressed={dir === facing}
            style={{ width: STRIP_W }}
            className={cx(
              'facing-button group relative overflow-hidden rounded-[3px] border px-1 pb-1 pt-1.5 transition-colors',
              dir === facing
                ? 'border-element/70 bg-element/10'
                : 'border-edge/70 bg-void/40 hover:border-element/40',
            )}
          >
            <canvas
              ref={(el) => { stripRefs.current[dir] = el; }}
              aria-hidden
              className="mx-auto block w-full [image-rendering:pixelated]"
              style={{ aspectRatio: `${SPRITE_CROP.w} / ${SPRITE_CROP.h}` }}
            />
            <span
              className={cx(
                'mt-0.5 block text-center text-[10px] uppercase tracking-[0.12em]',
                dir === facing ? 'text-element' : 'text-faint group-hover:text-muted',
              )}
            >
              {LABEL[dir]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
