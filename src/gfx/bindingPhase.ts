/**
 * The binding's vocabulary, with no three.js behind it.
 *
 * The Hunt screen has to name a phase and know how long the strike takes, and
 * it is on the eager route — importing those from `gfx/runeBinding` pulled the
 * whole of three.js into the entry chunk, which is 1.6 MB of renderer
 * downloaded by someone reading the landing page. The renderer stays behind a
 * `lazy()` boundary; these four lines are what crosses it.
 */
export type BindingPhase = 'idle' | 'charging' | 'strike' | 'bound' | 'broken';

/** The flight, from the ring to the creature. The verdict is shown when it lands. */
export const STRIKE_MS = 620;

/** How long the verdict itself takes to play out in the field. */
export const VERDICT_MS = 900;
