/**
 * The dye picker.
 *
 * The parked customiser did this with a 60-stop rainbow bar you dragged a round
 * handle along. It looked like a stock colour input, it could not be operated
 * from a keyboard, and picking the same colour twice was luck — the handle
 * snapped to whichever of the sixty stops your pixel landed on.
 *
 * This is a grid instead, and the grid is the point: hues across, tone down. A
 * column is one hue getting darker, a row is one tone all the way round the
 * wheel, so "the same blue but darker" is one square down rather than a hunt.
 * Every square is a real button, so tab and arrow keys work for free.
 *
 * Under it, the five rungs the chosen colour actually paints — see
 * `lib/colorize.ts`. A dye is not a flat fill, and showing the ladder means the
 * darkest fold is visible before it is on the character.
 */
import { hsl } from '../../lib/sprites';
import { luminance, ramp, rgbToHex } from '../../lib/colorize';
import { cx } from '../primitives';

/**
 * Thirteen hues, unevenly spaced on purpose.
 *
 * An even split of the wheel spends a third of the picker on greens nobody can
 * tell apart and gives the whole orange-through-yellow range two columns. These
 * are spaced by how far apart they LOOK.
 */
const HUES = [0, 18, 34, 48, 74, 128, 162, 188, 210, 232, 262, 296, 330];

/** Light to dark. Saturation drops at both ends, where it reads as garish. */
const TONES = [
  { s: 0.40, l: 0.76 },
  { s: 0.54, l: 0.62 },
  { s: 0.62, l: 0.47 },
  { s: 0.56, l: 0.34 },
  { s: 0.46, l: 0.22 },
];

/**
 * The bottom row: bone and leather.
 *
 * Half neutral, half the warm browns that hair, boots and gloves actually want
 * and that a saturated wheel does not contain — a brown is a dark desaturated
 * orange, and by the time the grid is desaturated enough to hold one it is grey.
 */
const NEUTRALS = [
  '#f4f1e8', '#cfcabd', '#9d9a92', '#6e6b65', '#46443f', '#26241f', '#12110f',
  '#e8cba8', '#c09565', '#8b5a2b', '#5c3a1e', '#3a2414', '#1d1410',
];

const GRID: string[][] = [
  ...TONES.map((t) => HUES.map((h) => hsl(h, t.s, t.l))),
  NEUTRALS,
];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function Swatches({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const rungs = ramp(value);

  return (
    <div className={cx(
      'flex h-full min-h-0 flex-col gap-2',
      disabled && 'pointer-events-none opacity-35',
    )}>
      {/*
        The grid is the screen's shock absorber.

        Everything else on this page has a height it needs — the character, the
        garment tiles, the publish bar — and this is the one block that can give
        some back. So its rows are fractions of whatever is left rather than
        squares: on a tall window the swatches come out square, on a short one
        they flatten to letterboxes and stay perfectly usable. It is the reason
        the page fits without a scrollbar on a laptop.
      */}
      <div
        className="dye-grid grid min-h-[84px] flex-1 gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${HUES.length}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${GRID.length}, minmax(0, 1fr))`,
        }}
        role="group"
        aria-label="Dye colour"
      >
        {GRID.flat().map((hex, i) => {
          const active = same(hex, value);
          return (
            <button
              key={`${hex}-${i}`}
              type="button"
              onClick={() => onChange(hex)}
              aria-label={hex}
              aria-pressed={active}
              title={hex}
              className={cx(
                'dye-swatch relative h-full w-full rounded-[2px] transition-transform',
                'hover:z-10 hover:scale-[1.18]',
                active && 'z-10 scale-[1.18]',
              )}
              style={{
                background: hex,
                // The ring is drawn as a shadow rather than a border so the
                // square does not change size when it is picked — a grid that
                // reflows under the cursor is a grid you keep missing.
                boxShadow: active
                  ? '0 0 0 2px rgb(var(--void)), 0 0 0 3.5px rgb(var(--element))'
                  : 'inset 0 0 0 1px rgb(0 0 0 / 0.35)',
              }}
            >
              {active && (
                <span
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ color: luminance(hex) > 0.55 ? '#000' : '#fff' }}
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none"
                       stroke="currentColor" strokeWidth="3.4"
                       strokeLinecap="butt" strokeLinejoin="miter">
                    <path d="M5 12.5 10 17.5 19 7" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {/* The ladder. Left is the deepest fold, right is the highlight; the
            middle rung is exactly the colour above. */}
        <div className="flex h-5 overflow-hidden rounded-[2px] border border-edge/80">
          {rungs.map((c, i) => (
            <div key={i} className="w-[13px]" style={{ background: rgbToHex(c) }} />
          ))}
        </div>

        <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
          {value}
        </span>

        {/* The way out of the grid, for anyone who has a hex in mind. It is the
            platform's picker and it looks like it; that is honest — everything
            else here is ours, and this one square is not. */}
        <label
          className="relative ml-auto flex h-11 cursor-pointer items-center gap-1.5 rounded-[2px]
                     border border-edge px-2 text-[11px] text-muted
                     hover:border-element/60 hover:text-ink lg:h-5"
          title="Any colour"
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-[1px]"
            style={{
              background:
                'conic-gradient(from 210deg, #ff5e69, #ffbe4a, #4ad295, #4ab0ff, #967aff, #ff5e69)',
            }}
          />
          Custom
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Pick any colour"
          />
        </label>
      </div>
    </div>
  );
}
