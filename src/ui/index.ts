/**
 * The design system, as one entry point.
 *
 * This file exists so that a SECOND product can render in this one's language
 * without keeping its own copy of it. The Realm Codex — the docs site in
 * `RuneRealm-Docs` — consumes exactly this, pinned to a commit, and the moment
 * it instead copies a token, a primitive or a hex value by hand there are two
 * design systems and one of them is quietly out of date.
 *
 * That is not a hypothetical failure: this repository spent a week with an
 * economy document describing an item faucet that had been removed from one
 * verb and left on another, because the description and the rule were two
 * copies of the same fact. A duplicated button is the same bug with a nicer
 * surface.
 *
 * ## What is here, and what is deliberately not
 *
 * Everything exported below depends on React, `gfx/mark.json` and each other —
 * and on nothing else. No game state, no wallet, no process, no router. That
 * is the line: a thing belongs in this file when it is about how the realm
 * LOOKS, and does not belong when it is about what the player currently HAS.
 *
 * So `Panel`, `Button` and the icons are here; `Satchel`, `Worship` and
 * `MonsterCard` are not, because each of them reads a live player. A docs page
 * that wants to show a companion card should render an EXAMPLE through the
 * card geometry, not import a component that expects a real one.
 *
 * The three-dimensional pieces are the same call in reverse. `src/gfx/` is
 * plain TypeScript over three.js with no React and no game state, so a docs
 * sandbox can import a renderer directly and drive it with invented input;
 * the `src/ui/*Stage.tsx` wrappers around them cannot, because they are wired
 * to contexts. Import the renderer, not the wrapper.
 *
 * ## Tokens
 *
 * The colours, the notch, the chamfer and the type stack are CSS custom
 * properties in `src/index.css`, and there is no JavaScript copy of them on
 * purpose — a second copy is the thing this file exists to prevent. A consumer
 * imports that stylesheet:
 *
 * ```ts
 * import 'rune-realm/src/index.css';
 * import { Panel, Button, Mark } from 'rune-realm/src/ui';
 * ```
 *
 * `--element` is set once by a `data-element` attribute on an ancestor and
 * everything inside it agrees without being told. Components take no colour
 * props, here or anywhere.
 */

/* The carved surfaces and controls. `cx` is included because every component
   below composes class names with it and a consumer will want the same. */
export {
  cx, Panel, SectionTitle, Button, Spinner, Bar, Badge, Empty, Skeleton,
  ErrorNote,
} from './primitives';

/* The hand-built glyph set. No icon package and no emoji, drawn on a 24 box at
   1.6 weight with butt caps, mitred joins and chamfers instead of radii — see
   DESIGN.md §4 before adding one. */
export * from './icons';

/* The Realm Seal and the carved alphabet. Both read `gfx/mark.json`, which is
   the single source of the mark's geometry; change a number there and the SVG,
   the canvas texture, the three.js slab and the favicons all follow. */
export { Mark, Lettering, Wordmark } from './Mark';

/* The one motion primitive that is not tied to a screen. */
export { ScrollReveal } from './ScrollReveal';

/* The mark's geometry itself, for a consumer drawing it in a medium none of
   the renderers above cover. */
export { default as markGeometry } from '../gfx/mark.json';
