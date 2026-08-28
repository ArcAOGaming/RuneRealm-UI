/**
 * The wait, rendered.
 *
 * "Reading your account from the chain…" over three grey bars was three
 * seconds of nothing, on the one screen every player sees before anything else
 * in the game. This is the seal turning instead — see `gfx/divining.ts` for
 * what it draws and why it draws that.
 *
 * The caption underneath cycles slowly, because the wait has stages and saying
 * so is more honest than one line that stops being true after a second.
 */
import { useEffect, useRef, useState } from 'react';
import { drawDivining } from '../gfx/divining';
import { cx } from './primitives';

const LINES = [
  'Turning the seal',
  'Reading your mark',
  'Counting what you carry',
];

export function Divining({
  size = 168, caption = true, className,
}: { size?: number; caption?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [line, setLine] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // The canvas carries `color: rgb(var(--element))`, so the seal takes the
    // player's chroma without being told which faction they are in — and it
    // works before we know, because `--element` falls back to arcane.
    const element = getComputedStyle(canvas).color
      .replace(/^rgba?\(/, '').replace(/\)$/, '').split(/[\s,]+/).slice(0, 3).join(', ');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      drawDivining(canvas, 0, { element }, { still: true });
      return;
    }

    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      drawDivining(canvas, now - started, { element });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!caption) return;
    const timer = setInterval(() => setLine((n) => (n + 1) % LINES.length), 2600);
    return () => clearInterval(timer);
  }, [caption]);

  return (
    <div className={cx('flex flex-col items-center justify-center gap-4', className)}>
      <canvas
        ref={ref}
        role="img"
        aria-label="Loading"
        style={{ width: size, height: size, color: 'rgb(var(--element))' }}
      />
      {caption && (
        <p key={line} className="animate-rise text-xs tracking-wide text-faint">
          {LINES[line]}…
        </p>
      )}
    </div>
  );
}
