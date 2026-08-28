/**
 * A wallet's sigil, rendered.
 *
 * `inscribe` draws it stroke by stroke rather than showing it whole. That is
 * used at the moment a wallet first connects — the one place the metaphor is
 * literal, because that IS when the mark is made.
 */
import { useEffect, useRef } from 'react';
import { drawSigil } from '../gfx/sigil';
import { cx } from './primitives';

export function Sigil({
  address,
  size = 24,
  weight = 1.5,
  inscribe = false,
  plate = false,
  className,
  title,
}: {
  address: string;
  size?: number;
  weight?: number;
  /** Draw it on, stroke by stroke, once. */
  inscribe?: boolean;
  /**
   * Set it in a carved tile — the mark's own chamfered silhouette, a gold
   * hairline, a dark face.
   *
   * Loose strokes on a page read as an ornament. On a plate they read as a
   * token that belongs to somebody, which is what an address is, and it is what
   * makes the leaderboard a roster of people rather than a table of base64.
   */
  plate?: boolean;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!inscribe || reduced) {
      drawSigil(canvas, address, { weight });
      return;
    }

    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / 700);
      drawSigil(canvas, address, { weight, progress: p });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [address, weight, inscribe]);

  const mark = (
    <canvas
      ref={ref}
      role="img"
      aria-label={title ?? `Sigil for ${address.slice(0, 6)}`}
      style={{ width: size, height: size }}
      className={cx('shrink-0', className)}
    />
  );

  if (!plate) return mark;

  return (
    <span
      title={title ?? `The mark of ${address.slice(0, 6)}`}
      // Square with a 3px radius rather than chamfered: a clip-path cannot
      // take a border, and at this size the plate IS its border.
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-[3px]',
        'border border-rune/25 bg-void/60',
        className,
      )}
      style={{ width: size + 14, height: size + 14 }}
    >
      {mark}
    </span>
  );
}
