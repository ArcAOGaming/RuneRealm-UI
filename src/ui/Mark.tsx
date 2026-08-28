/**
 * The Realm Seal, the carved wordmark, and the lockup of the two.
 *
 * The old logo was a raster: a cartoon wooden signboard, 512x271, shipped as a
 * PNG and scaled to 28px in the header where none of the woodgrain survived. It
 * also fought everything around it — the rest of this interface is carved stone
 * and bone-gold hairlines, and the one thing speaking for the brand was a
 * bevelled plank.
 *
 * Both halves are geometry now, drawn from `mark.json`, which is also what
 * `tools/gen-icons.py` rasterises the favicons and the social card from. There
 * is exactly one description of the mark in the repo.
 *
 * Two things fall out of that which a PNG could not do. It is crisp at 16px and
 * at 1600. And because the bind bar is stroked in `--element`, the logo takes
 * the player's faction colour like every other surface in the app — swearing to
 * fire turns the mark orange, in the header, on the front door, everywhere.
 */
import { SVGProps, useId } from 'react';
import mark from '../gfx/mark.json';
import { cx } from './primitives';

type Stroke = number[];

const toPath = (strokes: Stroke[]) =>
  strokes.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');

const BEZEL = `M${mark.bezel.points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
const RUNE = toPath(mark.rune.strokes);
const BIND = toPath(mark.bind.strokes);

// -- the seal ---------------------------------------------------------------

type MarkProps = Omit<SVGProps<SVGSVGElement>, 'size'> & {
  size?: number;
  /** Draw the tablet around the rune. Off below ~22px, where it turns to mush. */
  bezel?: boolean;
  /** Bloom the bind bar. The front door uses it; the header does not. */
  glow?: boolean;
};

export function Mark({
  size = 28, bezel = true, glow = false, className, ...rest
}: MarkProps) {
  const id = useId();
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox={`0 0 ${mark.box} ${mark.box}`}
      fill="none"
      aria-hidden
      className={cx('shrink-0 text-rune', className)}
    >
      {glow && (
        <defs>
          <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}

      {bezel && (
        <>
          {/* The face is translucent, so the aether reads through the mark the
              same way it reads through a panel. */}
          <path d={BEZEL} fill="rgb(var(--surface) / 0.85)" />
          <path
            d={BEZEL}
            stroke="currentColor" strokeOpacity={0.5}
            strokeWidth={mark.bezel.weight} strokeLinejoin="miter"
          />
        </>
      )}

      {/* Butt caps and mitred joins throughout: a rune is struck, not written,
          and a round pen is the one thing that would give that away. */}
      <path
        d={RUNE} stroke="currentColor"
        strokeWidth={mark.rune.weight} strokeLinecap="butt" strokeLinejoin="miter"
      />
      <path
        d={BIND} stroke="rgb(var(--element))"
        strokeWidth={mark.bind.weight} strokeLinecap="butt"
        filter={glow ? `url(#${id})` : undefined}
      />
    </svg>
  );
}

// -- the wordmark -----------------------------------------------------------

const A = mark.alphabet;
const GLYPHS = A.glyphs as Record<string, Stroke[]>;

/** Advance width of a string in glyph units, so the viewBox can be exact. */
function measure(text: string) {
  let w = 0;
  for (const ch of text.toUpperCase()) w += ch === ' ' ? A.space : A.advance;
  return w - (A.advance - 60); // trim the trailing sidebearing
}

/**
 * Text set in the carved alphabet.
 *
 * Only the letters of the name are drawn, so anything else falls through as a
 * gap rather than silently rendering wrong — if a new word is ever set in this,
 * the missing glyph has to be cut by hand, which is the intent.
 */
export function Lettering({
  text, height = 24, className, title,
}: {
  text: string;
  /** Height of the glyph box in px. Cap height is 84% of it. */
  height?: number;
  className?: string;
  title?: string;
}) {
  const upper = text.toUpperCase();
  const width = measure(upper);

  let x = 0;
  const parts: string[] = [];
  for (const ch of upper) {
    if (ch === ' ') { x += A.space; continue; }
    const g = GLYPHS[ch];
    if (g) {
      parts.push(
        g.map(([x1, y1, x2, y2]) => `M${x1 + x} ${y1}L${x2 + x} ${y2}`).join(''),
      );
    }
    x += A.advance;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${A.capBottom + A.weight / 2}`}
      width={(width / (A.capBottom + A.weight / 2)) * height}
      height={height}
      fill="none"
      role="img"
      aria-label={title ?? text}
      className={cx('text-rune', className)}
    >
      <path
        d={parts.join('')}
        stroke="currentColor"
        strokeWidth={A.weight}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/**
 * Seal plus name. `row` is the header; `stack` is the front door.
 *
 * The stacked form sets the rule under the name with `.rule-runic`, which fades
 * from the element into bone-gold — the same rule that sits under every screen
 * title, so the front door is built from the same parts as the rest of the app
 * rather than being a poster bolted to the front of it.
 */
export function Wordmark({
  variant = 'row', size = 28, className,
}: {
  variant?: 'row' | 'stack';
  /** Seal size in px. The lettering scales off it. */
  size?: number;
  className?: string;
}) {
  if (variant === 'stack') {
    return (
      <div className={cx('flex flex-col items-center', className)}>
        <Mark size={size} glow />
        <Lettering
          text="Rune Realm" title="Rune Realm"
          height={size * 0.42} className="mt-6"
        />
        <div className="rule-runic mt-4 w-44" />
      </div>
    );
  }

  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <Mark size={size} />
      {/* Held back on phones: at that width the seal is the wordmark. */}
      <Lettering
        text="Rune Realm" title="Rune Realm"
        height={size * 0.4} className="hidden sm:block"
      />
    </span>
  );
}
