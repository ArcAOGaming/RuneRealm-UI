/**
 * The lit backing for a move grid.
 *
 * Wraps its children, watches every `[data-move-tile]` button inside itself,
 * and hands their rects to the three.js field behind them. The buttons keep
 * their own hit testing, focus and text; this only draws what is underneath.
 *
 * Rects are read in a `ResizeObserver` and on pointer moves, never on a timer:
 * the grid only changes shape when the panel does, and re-measuring eight
 * elements every frame is a layout thrash for an answer that did not change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mountMoveTiles, TileField, TileSpec } from '../gfx/moveTiles';
import { cx } from './primitives';

/** The rgb behind each move type, matching the tokens in index.css. */
export const TYPE_RGB: Record<string, [number, number, number]> = {
  fire: [255, 122, 67],
  water: [74, 176, 255],
  air: [126, 226, 200],
  rock: [201, 162, 93],
  boost: [167, 139, 250],
  heal: [70, 192, 122],
  normal: [138, 143, 156],
};

export function MoveTiles({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<TileField | null>(null);
  const [live, setLive] = useState(false);

  const sync = useCallback(() => {
    const host = hostRef.current;
    const field = fieldRef.current;
    if (!host || !field) return;
    const base = host.getBoundingClientRect();

    const tiles: TileSpec[] = [];
    host.querySelectorAll<HTMLElement>('[data-move-tile]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const type = el.dataset.type ?? 'normal';
      tiles.push({
        x: r.left - base.left,
        y: r.top - base.top,
        w: r.width,
        h: r.height,
        colour: TYPE_RGB[type] ?? TYPE_RGB.normal,
        hovered: el.dataset.hovered === '1',
        pressed: el.dataset.pressed === '1',
        spent: el.dataset.spent === '1',
        muted: el.dataset.muted === '1',
      });
    });
    field.update(tiles);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const field = mountMoveTiles(host);
    // No WebGL: the buttons keep their CSS borders and the panel is flatter.
    // Nothing here is load-bearing — DESIGN.md's rule for the graphics layer.
    if (!field) return undefined;
    fieldRef.current = field;
    setLive(true);

    const measure = () => {
      const r = host.getBoundingClientRect();
      field.resize(r.width, r.height);
      sync();
    };
    // Once immediately as well as on observation: the layout is already
    // settled by the time an effect runs, and waiting only for the observer
    // left a frame of nothing.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);

    return () => {
      ro.disconnect();
      fieldRef.current = null;
      field.dispose();
    };
  }, [sync]);

  // Pointer state is written onto the buttons as data attributes and read back
  // in `sync`, so hover does not re-render React — eight buttons re-rendering
  // on every pointer move to move a highlight is the cost this avoids.
  const mark = useCallback((e: React.PointerEvent, key: string, on: boolean) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-move-tile]');
    if (!el) return;
    el.dataset[key] = on ? '1' : '0';
    sync();
  }, [sync]);

  return (
    <div
      ref={hostRef}
      className="relative min-h-0"
      onPointerOver={(e) => mark(e, 'hovered', true)}
      onPointerOut={(e) => mark(e, 'hovered', false)}
      onPointerDown={(e) => mark(e, 'pressed', true)}
      onPointerUp={(e) => mark(e, 'pressed', false)}
      onPointerCancel={(e) => mark(e, 'pressed', false)}
    >
      {/* The canvas is created and removed by the renderer itself — see
          gfx/moveTiles.ts on why it must not be a React-owned element. */}
      {/* `className` lands HERE, on the element that actually holds the
          buttons. Putting the caller's grid on the outer wrapper left the
          children one level deeper than the columns and stacked both rosters
          down the left. `live` clears the buttons' own borders once the lit
          objects are behind them, so the two are never drawn at once. */}
      <div
        className={cx(
          'relative',
          className,
          live && '[&_[data-move-tile]]:border-transparent',
        )}
      >
        {children}
      </div>
    </div>
  );
}
