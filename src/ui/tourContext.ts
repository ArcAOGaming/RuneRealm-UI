/**
 * The guided-tour context, its hook, and the hook a screen uses to own its own
 * walkthrough. Apart from `Tour.tsx` for the same reason as
 * `state/gameContext.ts`: the provider file also exports the overlay, and a
 * screen that only wants to register five sentences should not drag it in.
 *
 * The important half of this file is `useTourSteps`. **A screen's walkthrough
 * lives in that screen's own file**, so changing what the arena charges and
 * forgetting to change the sentence that says what the arena charges are the
 * same diff. A tutorial that describes last month's rules is worse than no
 * tutorial: it is confidently wrong, and the player has no way to tell.
 */
import { createContext, useContext, useEffect } from 'react';

export type TourStep = {
  /**
   * A CSS selector — by convention a `data-tour` attribute on the thing being
   * described. Every step has one: a step with nothing to point at is a
   * paragraph in a box, which is the kind of tutorial this is not.
   */
  target: string;
  title: string;
  body: string;
};

export type TourContextValue = {
  /** Whether a walkthrough is on screen right now. */
  running: boolean;
  /** The key the mounted screen registered, or null if it has no walkthrough. */
  pageKey: string | null;
  /**
   * Whether this screen's walkthrough is still worth advertising.
   *
   * True until it has been finished, and for the first few visits only — the
   * control stays on the page forever either way, it just stops being lit.
   */
  pageFresh: boolean;
  /** Used by `useTourSteps`. Returns its own undo, so it is effect-shaped. */
  register: (key: string, steps: TourStep[]) => () => void;
  /** Run the mounted screen's walkthrough now. */
  start: () => void;
  /** Put it away and remember it has been seen. */
  end: () => void;
  /**
   * Run it ONCE, for somebody who has never seen this screen's walkthrough.
   *
   * The companion screen calls this on arrival, because that is where a new
   * player is put down the moment their oath lands. Nothing else does: a
   * walkthrough that starts itself on every page you open is an obstacle.
   */
  offer: () => void;
};

export const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const context = useContext(TourContext);
  if (!context) throw new Error('useTour must be used inside <TourProvider>');
  return context;
}

/**
 * Declare this screen's walkthrough.
 *
 * `steps` must be a module-level constant. It is an effect dependency, and a
 * fresh array every render re-registers every render.
 */
export function useTourSteps(key: string, steps: TourStep[]): void {
  const { register } = useTour();
  useEffect(() => register(key, steps), [key, steps, register]);
}
