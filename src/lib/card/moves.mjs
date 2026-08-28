/**
 * moves.mjs — which plate supplies the icon for each move.
 *
 * The forty move plates in `assets/Monsters/cards/5-moves/` are full 648x1065
 * sheets, each carrying ONE badge and its name, pre-positioned into one of the
 * four slots of the moves panel. Every badge measured 78x75 at exactly one of
 * four origins, which is what makes them reusable: crop the badge, drop it in
 * whichever slot the card needs, and draw the name separately.
 *
 * The names on the plates are NOT this game's move names. Sixteen match, and
 * the art carries icons for moves that no longer exist ("Fire Ball", "Rock
 * Barrier", "Taunt Enemy"). The pools in `backend/native/constants.lua` are the
 * specification, so each of the 42 moves is mapped by hand to the badge that
 * fits it, and the plate's own lettering is never composited.
 *
 * Two badges are used twice — Double Damage and Swift Wind — and both reuses
 * are inside a pool that cannot collide on one card. `Battle.rollMoves` draws
 * at most one move per support pool, so two boosts never appear together; the
 * pairs were chosen so the duplicate always spans `normal` and `boost`, the one
 * combination a card can actually show. That is a cosmetic repeat at worst.
 *
 * Adding real art for a move is a one-line change here.
 */

/** Every badge is this size, verified across all forty plates. */
export const ICON_W = 78;
export const ICON_H = 75;

/** The four origins a badge was authored at. */
const SRC = {
  'signature-left': [204, 789],
  'signature-right': [507, 789],
  'regular-left': [204, 891],
  'regular-right': [504, 891],
};

/** move name -> [plate file under 5-moves/, which origin it sits at] */
const PLATE = {
  // fire
  Firenado: ['signature/Fire Nado.png', 'signature-left'],
  Campfire: ['signature/Fire Firecamp.png', 'signature-right'],
  Inferno: ['signature/Fire Inferno.png', 'signature-left'],
  'Flame Shield': ['signature/Fire Shield.png', 'signature-right'],
  'Scorching Ash': ['signature/Fire Ball.png', 'signature-left'],
  'Phoenix Burst': ['signature/Heal Regen Fire.png', 'signature-right'],

  // water. Three of these filenames carry a trailing space before `.png`; it is
  // in the upstream art repo and STYLE.md flags it as a known trap. Keep them
  // byte-exact or the lookup silently falls through to no icon.
  'Tidal Wave': ['signature/Tidal Wave .png', 'signature-left'],
  Whirlpool: ['signature/Whirl Pool .png', 'signature-right'],
  'Ice Spear': ['signature/Ice Spear .png', 'signature-left'],
  'Ocean Mist': ['signature/Ocean Mist.png', 'signature-right'],
  Frostbite: ['signature/Water Ball.png', 'signature-left'],
  'Deep Current': ['signature/Water Heal Water.png', 'signature-right'],

  // air
  Tornado: ['signature/Tornado.png', 'signature-right'],
  'Wind Slash': ['signature/Wind Slash.png', 'signature-left'],
  'Storm Cloud': ['signature/Storm Cloud.png', 'signature-left'],
  Breeze: ['signature/Breeze.png', 'signature-right'],
  'Lightning Bolt': ['signature/Wind Attack Air.png', 'signature-left'],
  'Gale Force': ['signature/Tornado Kick Air.png', 'signature-right'],

  // rock
  'Boulder Crush': ['signature/Boulder Crush.png', 'signature-left'],
  'Stone Wall': ['signature/Stone Wall.png', 'signature-right'],
  'Rock Slide': ['signature/Rock Slide.png', 'signature-left'],
  'Earth Shield': ['signature/Earth Shield.png', 'signature-right'],
  'Seismic Slam': ['signature/Rock Missile Earth.png', 'signature-left'],
  'Granite Barrier': ['signature/Rock Barrier Earth.png', 'signature-right'],

  // boost
  'Power Up': ['regular/Power Up.png', 'regular-left'],
  'Iron Skin': ['regular/Iron Skin.png', 'regular-right'],
  'Swift Wind': ['regular/Swift Wind.png', 'regular-left'],
  'Battle Cry': ['regular/Battle Cry.png', 'regular-right'],
  "Warrior's Resolve": ['regular/Taunt Enemy.png', 'regular-left'],
  'Adrenaline Surge': ['regular/Double Damage.png', 'regular-right'],

  // heal
  Heal: ['regular/Heal.png', 'regular-left'],
  Regenerate: ['regular/Regenerate.png', 'regular-right'],
  'Life Surge': ['regular/Life Surge.png', 'regular-left'],
  Recovery: ['regular/Recovery.png', 'regular-right'],
  'Vital Essence': ['regular/Slow Heal.png', 'regular-right'],
  'Healing Winds': ['regular/Team Shield.png', 'regular-left'],

  // normal
  'Body Slam': ['regular/Burn Effect.png', 'regular-left'],
  'Quick Jab': ['regular/Speed Up.png', 'regular-left'],
  'Heavy Strike': ['regular/Defense Up.png', 'regular-right'],
  'Guard Break': ['regular/Dodge Up.png', 'regular-right'],
  'Frenzy Blows': ['regular/Double Damage.png', 'regular-right'],
  'Momentum Shift': ['regular/Swift Wind.png', 'regular-left'],
};

/**
 * The badge for `name`, or null when the move has no art.
 *
 * Null is not an error: the slot still renders with its name, it just has no
 * icon. An admin-written move, or one added to the pools before its plate
 * exists, must not be able to fail a mint.
 */
export function moveIcon(name) {
  const entry = PLATE[name];
  if (!entry) return null;
  const [file, origin] = entry;
  const [sx, sy] = SRC[origin];
  return { asset: `Monsters/cards/5-moves/${file}`, sx, sy, sw: ICON_W, sh: ICON_H };
}

/** Every plate this module can reference, for the preloader. */
export function allMovePlates() {
  return [...new Set(Object.values(PLATE).map(([file]) => `Monsters/cards/5-moves/${file}`))];
}
