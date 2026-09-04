/**
 * The aether canvas, and the handle screens use to disturb it.
 *
 * One canvas for the whole app, fixed behind everything, mounted once. Screens
 * do not render their own — they call `useAether().shock(x, y)` when something
 * lands, and set the element through the provider.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { type AetherCtx as Ctx, AetherContext } from './aetherContext';
import { useLocation } from 'react-router-dom';
import { AetherHandle, Element as AetherElement, mountAether } from '../gfx/aether';

export function AetherProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // The public front door owns a richer three.js field. Keeping the global
  // aether alive underneath it spends a second WebGL context on an effect the
  // hero completely covers, and context-constrained browsers can then refuse
  // the scene that actually matters.
  const publicStory = pathname === '/' || pathname === '/lore';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<AetherHandle | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (publicStory) {
      setActive(false);
      return;
    }
    if (!canvasRef.current) return;
    handle.current = mountAether(canvasRef.current);
    setActive(!!handle.current);
    // A handle on the field, in dev only, so the effect can be driven and
    // inspected without playing a whole battle to see one shockwave.
    if (import.meta.env.DEV) {
      (window as any).__aether = handle.current;
    }
    return () => {
      handle.current?.destroy();
      handle.current = null;
      if (import.meta.env.DEV) delete (window as any).__aether;
    };
  }, [publicStory]);

  const shock = useCallback((x: number, y: number) => {
    handle.current?.shock(x, y);
  }, []);

  const shockFrom = useCallback((el: Element | null | undefined) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    handle.current?.shock(r.left + r.width / 2, r.top + r.height / 2);
  }, []);

  const setElement = useCallback((element: AetherElement) => {
    handle.current?.setElement(element);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ shock, shockFrom, setElement, active }),
    [shock, shockFrom, setElement, active],
  );

  return (
    <AetherContext.Provider value={value}>
      {!publicStory && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
        />
      )}
      {children}
    </AetherContext.Provider>
  );
}
