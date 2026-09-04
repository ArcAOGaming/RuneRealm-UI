/**
 * The aether context and its hook, apart from `Aether.tsx`.
 *
 * Same reason as `state/gameContext.ts`. This one failed silently rather than
 * loudly — `useAether` returns inert no-ops when the context is missing, so a
 * mismatched identity after an edit just stopped the canvas reacting.
 */
import { createContext, useContext } from 'react';

export type AetherCtx = {
  /** Ripple the field outward from a point in viewport pixels. */
  shock: (x: number, y: number) => void;
  /** Ripple from an element's centre. Cheaper to call from a handler. */
  shockFrom: (el: Element | null | undefined) => void;
  setElement: (element: import('../gfx/aether').Element) => void;
  /** False when WebGL2 is unavailable — screens can skip decorative extras. */
  active: boolean;
};

export const AetherContext = createContext<AetherCtx | null>(null);

export function useAether(): AetherCtx {
  return useContext(AetherContext) ?? {
    shock: () => {},
    shockFrom: () => {},
    setElement: () => {},
    active: false,
  };
}
