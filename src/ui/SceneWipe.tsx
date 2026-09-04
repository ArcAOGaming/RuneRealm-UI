/**
 * The cut between two scenes on one panel.
 *
 * A hunt happens entirely inside a single frame: the trail, the fight, the
 * binding and the verdict all replace one another in the same box. Mounting one
 * over another reads as the page breaking, so this covers the panel for a beat
 * and the swap happens underneath.
 *
 * `useSceneWipe` owns the timing rather than the caller, because a wipe whose
 * swap is not synchronised to its own cover is worse than no wipe: the player
 * sees the change and THEN sees something sweep over it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Element } from '../lib/types';

/** Total sweep, and the point in it at which the panel is fully covered. */
export const WIPE_MS = 760;
/** The middle of the keyframes' hold at centre — see .scene-wipe in index.css. */
const WIPE_COVER_MS = 380;

export function SceneWipe({ element }: { element?: Element }) {
  return (
    <div aria-hidden className="scene-wipe" data-element={element}>
      <i /><i /><i />
    </div>
  );
}

export function useSceneWipe() {
  const [token, setToken] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);

  /** Sweep, and run `swap` at the moment the panel is opaque. */
  const wipe = useCallback((swap: () => void) => {
    setToken((n) => n + 1);
    timers.current.push(window.setTimeout(swap, WIPE_COVER_MS));
    timers.current.push(window.setTimeout(() => setToken(0), WIPE_MS + 60));
  }, []);

  return { token, wipe };
}
