/**
 * CardPreview — the card, drawn from the live record.
 *
 * This is the same layout the worker composites, painted onto a canvas by
 * `lib/card/browser.ts`. That matters more than it looks: a player is about to
 * spend runes on a permanent picture, and a preview built from different code
 * would eventually be a preview of a different picture.
 *
 * The canvas is always 648x1065 and is scaled by CSS, never by redraw. Pixel
 * art resampled by the browser turns to mush, so `image-rendering: pixelated`
 * is load-bearing, not decorative.
 *
 * It paints only when it comes near the viewport, and that is not an
 * optimisation to skip. A 648x1065 canvas is about 2.7 MB of backing store; the
 * leaderboard draws one per row and asks the process for fifty rows. Painting
 * them all on mount is 138 MB of canvas, which browsers answer by dropping
 * contexts — cards further down the page go blank, at random, and the bug looks
 * like the renderer rather than the count.
 */
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { drawCard } from '../lib/card/browser';
import type { BrowserCardOptions } from '../lib/card/browser';
import { cardSize } from '../lib/card/layout.mjs';
import { ItemId, Monster } from '../lib/types';
import { Skeleton, cx } from './primitives';

export function CardPreview({
  monster, className, eager, extended, inventory, authoring,
}: {
  monster: Monster;
  className?: string;
  eager?: boolean;
  /** Widen to 1044 and add the side panel: moves in full, meters, satchel. */
  extended?: boolean;
  /** The satchel, drawn into the panel. Only read when `extended`. */
  inventory?: Partial<Record<ItemId, number>>;
  /** Local-only background/portrait overrides from the asset studio. */
  authoring?: Pick<BrowserCardOptions, 'backgroundAsset' | 'portraitAsset' | 'assetUrls'>;
}) {
  // The panel prints each move's uses, and the engine multiplies the stored
  // count by `moveUses` when a fight starts. Reading it from the published
  // tuning rather than from the record is how the card and the arena agree.
  const { tuning } = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Boolean(eager));
  const [state, setState] = useState<'waiting' | 'drawing' | 'drawn' | 'failed'>(
    eager ? 'drawing' : 'waiting',
  );

  // Redraw on anything the card shows. Depending on the whole object would
  // redraw on every poll, because the provider hands back a fresh object each
  // time even when nothing changed.
  const key = JSON.stringify([
    monster.name, monster.elementType, monster.level,
    monster.attack, monster.speed, monster.defense, monster.health,
    Object.keys(monster.moves ?? {}).sort(),
    authoring,
    // The panel shows these, so they have to redraw it. The plain card does
    // not, and listing them regardless would repaint every poll for nothing.
    extended ? [monster.energy, monster.happiness, monster.exp, inventory, tuning.moveUses] : 0,
  ]);

  useEffect(() => {
    if (visible || !frame.current) return undefined;
    // No IntersectionObserver (or a test environment): paint rather than show
    // an empty box forever.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '300px' });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setState('drawing');
    (async () => {
      if (!canvas.current) return;
      try {
        await drawCard(canvas.current, monster, {
          extended, inventory, moveUses: tuning.moveUses, ...authoring,
        });
        if (!cancelled) setState('drawn');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);

  const size = cardSize({ extended });

  return (
    <div
      ref={frame}
      className={cx('relative', className)}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {visible && (
        <canvas
          ref={canvas}
          aria-label={`${monster.name} card`}
          className={cx(
            'h-full w-full rounded-[3px] transition-opacity duration-200',
            state === 'drawn' ? 'opacity-100' : 'opacity-0',
          )}
          style={{ imageRendering: 'pixelated' }}
        />
      )}
      {state !== 'drawn' && state !== 'failed' && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-[3px]" />
      )}
      {state === 'failed' && (
        <div className="absolute inset-0 grid place-items-center rounded-[3px] border border-edge px-2 text-center text-[11px] text-faint">
          Card art unavailable
        </div>
      )}
    </div>
  );
}
