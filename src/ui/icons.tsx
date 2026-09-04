/**
 * The icon set. Cut, not drawn.
 *
 * Hand-rolled rather than an icon package: the old build pulled in three
 * FontAwesome packages to render a handful of glyphs, and every one of them was
 * a network dependency and a bundle cost for something that is a dozen path
 * elements. That much was already true.
 *
 * What changed is the hand. These were a competent generic outline set — round
 * caps, round joins, circles and arcs — sitting inside an interface whose whole
 * argument is that everything on screen is carved. So they are redrawn to the
 * same rules as the Realm Seal and a player's sigil:
 *
 *   - **Butt caps and mitred joins.** A round pen is the single thing that
 *     gives away a drawn mark, and nothing here is drawn.
 *   - **Straight strokes only.** No arcs, and no circles: where a round form is
 *     needed it is cut as a hexagon or an octagon, the same way the seal's gate
 *     is. `Cog` is an octagon, `Clock` is an octagon, and they read better at
 *     16px than the circles they replace.
 *   - **Chamfers instead of radii**, matching the notch every panel carries.
 *   - **One angle vocabulary** — 90°, 45°, and the seal's own 30/60 — because
 *     picking freely looks like scribble rather than writing.
 *
 * All on a 24 box at 1.6 weight, which is the hairline the rest of the chrome
 * is drawn at.
 */
import { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'butt' as const, strokeLinejoin: 'miter' as const,
  ...props,
});

// The elements ---------------------------------------------------------------
// These four carry more weight than any others: they are the factions, and they
// appear at 14px in a tab and at 32px on a faction card. Each is one closed
// silhouette rather than a cluster of marks, so it survives the small size.

/**
 * The four element glyphs, as path data.
 *
 * Exported rather than inlined because they are cut into the altars as well as
 * drawn in the DOM: `gfx/altars.ts` builds a `Path2D` from each of these and
 * strokes it into a texture, so the rune on a plinth in the hall is the same
 * geometry as the icon in a badge — not a second drawing of the same idea.
 */
export const ELEMENT_PATH: Record<'fire' | 'water' | 'air' | 'rock', string> = {
  /** Fire: a flame faceted like struck flint. */
  fire: 'M12 2.2 16.8 9h-3l2.7 4.6L12 21.8l-4.5-8.2L10.2 9h-3Z',
  /** Water: the drop as a hexagon, which is the seal's own gate shape. */
  water: 'M12 2.4 18 11v4.2L12 21.6 6 15.2V11Z',
  /** Air: three currents, each turned by a hard corner rather than a curl. */
  air: 'M2.8 7.5h10L16 4.3M2.8 12h14l3.2 3.2M2.8 16.5h8l2.6 2.6',
  /** Rock: a ridge line. Two peaks, one shoulder, no curve anywhere. */
  rock: 'M2.2 19.4 9 7.6l3.4 5.8 2.6-3.6 6.8 9.6ZM9 7.6l3.4 5.8',
};

export const Flame = (p: P) => (
  <svg {...base(p)}><path d={ELEMENT_PATH.fire} /></svg>
);
export const Droplet = (p: P) => (
  <svg {...base(p)}><path d={ELEMENT_PATH.water} /></svg>
);
export const Wind = (p: P) => (
  <svg {...base(p)}><path d={ELEMENT_PATH.air} /></svg>
);
export const Mountain = (p: P) => (
  <svg {...base(p)}><path d={ELEMENT_PATH.rock} /></svg>
);
/** Untyped: an ordinary paw, cut as five small facets rather than magic. */
export const Paw = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.2 13.2 12 10.4l3.8 2.8 1.2 4.2-2.2 2.2H9.2L7 17.4Z" />
    <path d="M5.2 7.2 7 5.4l1.8 1.8L7 9ZM9.7 4.8 12 2.8l2.3 2-2.3 2.4ZM15.2 7.2 17 5.4l1.8 1.8L17 9Z" />
  </svg>
);

// Combat ---------------------------------------------------------------------

/**
 * A sword, blade up.
 *
 * Drawn as four closed shapes rather than a stem with crossbars: at 16px in a
 * nav tab, a thin blade over a wide guard reads as a candle, which is what the
 * first cut of this was.
 */
export const Sword = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.2 15 7.4v5.4H9V7.4Z" />
    <path d="M6.2 12.8h11.6v2.2H6.2Z" />
    <path d="M10.6 15h2.8v4.4h-2.8Z" />
    <path d="M9.2 19.4h5.6v2.2H9.2Z" />
  </svg>
);
export const Shield = (p: P) => (
  <svg {...base(p)}><path d="M12 2.4 19.8 5.4v6.4L12 21.6 4.2 11.8V5.4Z" /></svg>
);
export const Bolt = (p: P) => (
  <svg {...base(p)}><path d="M13.6 2 5.6 13.2H11l-.6 8.8 8.2-11.6H13Z" /></svg>
);
/** Life. A heart cut with facets, since a heart is the one round thing here. */
export const Heart = (p: P) => (
  <svg {...base(p)}><path d="M12 21.4 4.4 12.6V7.8L7.6 4.6 12 8.2l4.4-3.6 3.2 3.2v4.8Z" /></svg>
);

// The realm ------------------------------------------------------------------

/**
 * A rune. The currency, and the mark for anything the realm itself issues.
 *
 * A stave with two branches and a bind — the same vocabulary a player's sigil
 * is struck from, held to three strokes so it reads at 14px in the header.
 */
/**
 * The rune's own path data.
 *
 * Exported like `ELEMENT_PATH`, and for the same reason: Runes are a loot drop
 * and there is no picture of one, so the vault strokes this into a texture and
 * throws the glyph itself out of the chest. Better the mark than nothing.
 */
export const RUNE_PATH = 'M12 2.6v18.8M12 7.4 6.6 11.6M12 7.4l5.4 4.2M7.8 16.4h8.4';

export const Rune = (p: P) => (
  <svg {...base(p)}><path d={RUNE_PATH} /></svg>
);
/** Two assets crossing through a cut exchange gate. */
export const Exchange = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7h15M14.5 3.5 18 7l-3.5 3.5" />
    <path d="M21 17H6M9.5 13.5 6 17l3.5 3.5" />
  </svg>
);
/** Worship, minting, anything the realm grants: a four-pointed star, cut. */
/**
 * The three activity glyphs, as path data.
 *
 * Exported for the same reason `ELEMENT_PATH` is: `gfx/activityRunes` cuts
 * these into the faces of the tokens turning behind the activity rows, so the
 * rune on the stone and the rune in the row are one drawing, not two.
 */
export const GLYPH_PATH = {
  /** A berry on the branch. One hex and one leaf, so it holds at 16px. */
  berry: [
    'M12 9 16.4 11.4v4.8L12 18.6l-4.4-2.4v-4.8Z',
    'M12 9V5.2',
    'M12 5.2 16.8 3.6 15.2 8Z',
  ],
  sparkle: ['M12 2.2 13.6 10.4 21.8 12l-8.2 1.6L12 21.8l-1.6-8.2L2.2 12l8.2-1.6Z'],
  /** A carved tablet with a route cut into it. Quests, and the world map. */
  map: [
    'M3 6 9 3.6l6 2.4 6-2.4v14.4L15 20.4 9 18 3 20.4Z',
    'M9 3.6V18M15 6v14.4',
  ],
} as const;

const glyph = (paths: readonly string[]) => (p: P) => (
  <svg {...base(p)}>{paths.map((d) => <path key={d} d={d} />)}</svg>
);

export const Sparkle = glyph(GLYPH_PATH.sparkle);
/** A loot box. A banded chest, which is what actually opens on screen. */
export const Gift = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.4 9.2 5.8 4.8h12.4l2.4 4.4v11H3.4Z" />
    <path d="M3.4 13.2h17.2M12 9.2v11M9.6 13.2h4.8v3.2H9.6Z" />
  </svg>
);
export const Map = glyph(GLYPH_PATH.map);
export const Berry = glyph(GLYPH_PATH.berry);
/** A carried pouch: a flap, a body, and the strap it hangs from. */
export const Satchel = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.2 9.4h15.6v10.4H4.2Z" />
    <path d="M4.2 9.4 6.6 5.4h10.8l2.4 4M8.6 5.4v4M15.4 5.4v4M10.4 13.2h3.2v2.4h-3.2Z" />
  </svg>
);
export const Users = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 4.6 11.8 6.2v3.2L9 11 6.2 9.4V6.2Z" />
    <path d="M2.6 20.4v-2.6L9 14.4l6.4 3.4v2.6Z" />
    <path d="M15.6 5.4 17.8 6.6v2.6l-2.2 1.2M17.8 20.4v-2.4l-2.6-1.6" />
  </svg>
);
/** Ranks. A chalice, faceted, on a cut foot. */
export const Trophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3.6h10v4.8L14.2 13H9.8L7 8.4Z" />
    <path d="M7 5.6H4.2v2.2L7 10.4M17 5.6h2.8v2.2L17 10.4" />
    <path d="M12 13v3.8M8.8 20.4l.8-3.6h4.8l.8 3.6Z" />
  </svg>
);

// Chrome ---------------------------------------------------------------------

export const Wallet = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6.6h15.6L21 9v9.4H3Z" /><path d="M3 10.4h18" />
    <path d="M16.2 13.4h2.4v2.4h-2.4Z" fill="currentColor" stroke="none" />
  </svg>
);
/** Settings. An octagon with eight teeth — no arc in it anywhere. */
export const Cog = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.4 8.2h5.2l3.2 3.2v1.2l-3.2 3.2H9.4l-3.2-3.2v-1.2Z" />
    <path d="M12 2.4v3.4M12 18.2v3.4M2.4 12h3.4M18.2 12h3.4M5.2 5.2 7.6 7.6M16.4 16.4l2.4 2.4M18.8 5.2l-2.4 2.4M7.6 16.4l-2.4 2.4" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}><path d="m4.4 12.4 5 5 10.2-11" /></svg>
);
export const X = (p: P) => (
  <svg {...base(p)}><path d="m5 5 14 14M19 5 5 19" /></svg>
);
export const Arrow = (p: P) => (
  <svg {...base(p)}><path d="M3.6 12h15M12.6 6l6 6-6 6" /></svg>
);
/** An octagonal dial. Cheaper to read at 14px than a circle, and on-theme. */
export const Clock = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.4 3.2h5.2l4.2 4.2v5.2l-4.2 4.2H9.4l-4.2-4.2V7.4Z" transform="translate(0 1.4)" />
    <path d="M12 8v4.6l3.2 1.8" />
  </svg>
);
export const Lock = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.6 10h14.8v10.4H4.6Z" /><path d="M8 10V7.4L10.4 5h3.2L16 7.4V10" />
  </svg>
);
export const Info = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.4 3.2h5.2l4.2 4.2v5.2l-4.2 4.2H9.4l-4.2-4.2V7.4Z" transform="translate(0 1.4)" />
    <path d="M12 11.4v5" />
    <path d="M11.1 7.2h1.8V9h-1.8Z" fill="currentColor" stroke="none" />
  </svg>
);
/**
 * Being shown around. An octagonal bezel with a struck needle in it — a
 * compass rose cut to the same rules as `Cog` and `Clock`, so the walkthrough's
 * control does not arrive as the one round object in the header.
 */
export const Compass = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.4 3.2h5.2l4.2 4.2v5.2l-4.2 4.2H9.4l-4.2-4.2V7.4Z" transform="translate(0 1.4)" />
    {/* The needle takes most of the interior. A small one is correct at 96px
        and a smudge at 16, which is the size this is actually used at. */}
    <path d="m16.6 7.4-2.8 6.4-6.4 2.8 2.8-6.4Z" />
  </svg>
);

/** Retry. An octagon with a bite out of it, and the arrowhead struck on. */
export const Refresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.4 8.6V4.2h-4.4" />
    <path d="M19.4 4.2 15 8.6M19.4 12v3.2L16.2 19H8.4L5 15.4V8.6L8.4 5h6" />
  </svg>
);

import { Affinity } from '../lib/types';

export const ELEMENT_ICON: Record<Affinity, (p: P) => JSX.Element> = {
  fire: Flame, water: Droplet, air: Wind, rock: Mountain, normal: Paw,
};
