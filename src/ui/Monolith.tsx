/**
 * The seal in stone, on the front door.
 *
 * Wraps `gfx/monolith`. If WebGL is not available — or the context is refused,
 * which is routine on a machine that already has too many of them — this falls
 * back to the flat SVG mark. The fallback is the real logo, not a placeholder:
 * nothing on this page depends on the 3D version existing.
 */
import { useEffect, useRef } from 'react';
import { createMonolith, Monolith as Handle, MonolithElement } from '../gfx/monolith';
import { Mark } from './Mark';
import { cx } from './primitives';

export function Monolith({
  element = 'arcane', size = 360, className,
}: {
  element?: MonolithElement;
  /**
   * Width of the stage in px. The canvas is square and the slab occupies a bit
   * under half of it — the rest is room for the glow, which is the whole reason
   * this is bigger than the mark it draws.
   */
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<Handle | null>(null);
  const fallback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    handle.current = createMonolith(canvasRef.current, { element });
    // Only reveal the flat mark if the scene genuinely failed. Rendering both
    // and hiding one in CSS would ship two logos on every page.
    if (!handle.current && fallback.current) fallback.current.hidden = false;
    return () => {
      handle.current?.dispose();
      handle.current = null;
    };
    // Built once. `element` is applied live below rather than rebuilding the
    // scene, which would drop the sway back to zero on every faction change.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swearing to a faction strikes the seal: the bind bar flares, the slab rings
  // and settles into the new colour. It is the same event the aether crossfade
  // and the whole page's `--element` are responding to.
  const first = useRef(true);
  useEffect(() => {
    handle.current?.setElement(element);
    if (first.current) { first.current = false; return; }
    handle.current?.strike();
  }, [element]);

  return (
    <div
      className={cx('relative mx-auto aspect-square select-none', className)}
      style={{ width: size, maxWidth: '100%' }}
      role="img"
      aria-label="Rune Realm"
    >
      {/*
        Square, and feathered at the edges.
        A composer with a bloom pass writes opaque alpha whatever the renderer
        clears to, so the canvas is a hard-edged rectangle of glow sitting on
        top of the aether — which is the same rectangle problem the PNG had.
        The mask fades it into the page instead, and being square keeps the
        falloff circular rather than a stretched ellipse.
      */}
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{
          maskImage: 'radial-gradient(circle closest-side, #000 62%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(circle closest-side, #000 62%, transparent 100%)',
        }}
      />
      <div
        ref={fallback}
        hidden
        className="absolute inset-0 flex items-center justify-center"
      >
        <Mark size={size * 0.42} glow />
      </div>
    </div>
  );
}

/**
 * Default export as well as named, so `Landing` can `lazy()` it.
 *
 * three.js is ~600kB of the bundle and the front door is the first thing anyone
 * loads. Imported eagerly it went into the entry chunk and every visitor paid
 * for the renderer before the page had drawn. Split off, the SVG mark is on
 * screen immediately and the stone version replaces it when it arrives — which
 * is the same fallback the no-WebGL path uses, so there is only one story here.
 */
export default Monolith;
