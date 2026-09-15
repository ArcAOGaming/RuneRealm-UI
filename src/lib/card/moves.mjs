/**
 * moves.mjs — which plate supplies the icon for each move.
 *
 * The forty source move plates are full 648x1065
 * sheets, each carrying ONE badge and its name, pre-positioned into one of the
 * four slots of the moves panel. Every badge measured 78x75 at exactly one of
 * four origins. The explicit freeze command crops each once into its committed
 * 78x75 runtime icon; normal rendering never reads the source plate or origin.
 *
 * The names on the plates are NOT this game's move names. Sixteen match, and
 * the art carries icons for moves that no longer exist ("Fire Ball", "Rock
 * Barrier", "Taunt Enemy"). The pools in `backend/native/constants.lua` are the
 * specification, so each of the 42 moves is mapped by hand to the badge that
 * fits it, and the plate's own lettering is never composited.
 *
 * Forty plates against forty-two moves, so two badges are used twice — Double
 * Damage (Adrenal Rush and Frenzy Blows) and Swift Wind (Swift Wind and
 * Momentum Shift).
 *
 * Both reuses CAN now land on one card, and the note that used to be here said
 * they could not. It argued that `Battle.rollMoves` drew at most one move per
 * support pool so a boost and a neutral never met — which was already only half
 * true, and is not true at all since `normal`, `boost` and `heal` merged into
 * one `neutral` pool with no per-pool quota. Any two neutral moves can be drawn
 * together now.
 *
 * It stays a cosmetic repeat: a card shows three moves, both members of a pair
 * have to be drawn, and the badge is an icon rather than an identifier. The fix
 * is two more plates, not a remapping — every one of the forty is already
 * spoken for, and the only pairs that genuinely cannot collide are two moves
 * from different ELEMENT pools, which would mean giving a neutral move a badge
 * drawn for an element it has nothing to do with.
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

/** move name -> [stable icon/source key, source-only crop origin] */
const PLATE = {
  // fire
  Firenado: ['fire-nado', 'signature-left'],
  Campfire: ['fire-firecamp', 'signature-right'],
  Inferno: ['fire-inferno', 'signature-left'],
  'Flame Shield': ['fire-shield', 'signature-right'],
  'Scorching Ash': ['fire-ball', 'signature-left'],
  'Phoenix Burst': ['heal-regen-fire', 'signature-right'],

  // water. The old authoring filenames carried trailing spaces; normalized
  // runtime keys keep that historical accident out of every lookup.
  'Tidal Wave': ['tidal-wave', 'signature-left'],
  Whirlpool: ['whirl-pool', 'signature-right'],
  'Ice Spear': ['ice-spear', 'signature-left'],
  'Ocean Mist': ['ocean-mist', 'signature-right'],
  Frostbite: ['water-ball', 'signature-left'],
  'Deep Current': ['water-heal-water', 'signature-right'],

  // air
  Tornado: ['tornado', 'signature-right'],
  'Wind Slash': ['wind-slash', 'signature-left'],
  'Storm Cloud': ['storm-cloud', 'signature-left'],
  Breeze: ['breeze', 'signature-right'],
  'Lightning Bolt': ['wind-attack-air', 'signature-left'],
  'Gale Force': ['tornado-kick-air', 'signature-right'],

  // rock
  'Boulder Crush': ['boulder-crush', 'signature-left'],
  'Stone Wall': ['stone-wall', 'signature-right'],
  'Rock Slide': ['rock-slide', 'signature-left'],
  'Earth Shield': ['earth-shield', 'signature-right'],
  'Seismic Slam': ['rock-missile-earth', 'signature-left'],
  'Stone Barrier': ['rock-barrier-earth', 'signature-right'],

  // boost
  'Power Up': ['power-up', 'regular-left'],
  'Iron Skin': ['iron-skin', 'regular-right'],
  'Swift Wind': ['swift-wind', 'regular-left'],
  'Battle Cry': ['battle-cry', 'regular-right'],
  "Iron Will": ['taunt-enemy', 'regular-left'],
  'Adrenal Rush': ['double-damage', 'regular-right'],

  // heal
  Heal: ['heal', 'regular-left'],
  Regenerate: ['regenerate', 'regular-right'],
  'Life Surge': ['life-surge', 'regular-left'],
  Recovery: ['recovery', 'regular-right'],
  'Vital Essence': ['slow-heal', 'regular-right'],
  'Healing Winds': ['team-shield', 'regular-left'],

  // normal
  'Body Slam': ['burn-effect', 'regular-left'],
  'Quick Jab': ['speed-up', 'regular-left'],
  'Heavy Strike': ['defense-up', 'regular-right'],
  'Guard Break': ['dodge-up', 'regular-right'],
  'Frenzy Blows': ['double-damage', 'regular-right'],
  'Momentum Shift': ['swift-wind', 'regular-left'],
};

/**
 * The badge for `name`, or null when the move has no art.
 *
 * Null is not an error: the slot still renders with its name, it just has no
 * icon. An admin-written move, or one added to the pools before its plate
 * exists, must not be able to fail a mint.
 */
/**
 * Moves that were renamed, and the badge their old name still has to find.
 *
 * A monster rolled before the rename keeps the string it was rolled with —
 * the 168 recovered players in `legacy-players.json` among them — and the
 * card is drawn from that record, not from the pools. Without this the badge
 * silently disappears from those cards while the name still prints, which
 * looks like a rendering fault rather than a rename. Records are history and
 * are not rewritten; this is how history stays legible.
 */
const RENAMED = {
  "Warrior's Resolve": 'Iron Will',
  'Adrenaline Surge': 'Adrenal Rush',
  'Granite Barrier': 'Stone Barrier',
};

export function moveIcon(name) {
  const entry = PLATE[name] ?? PLATE[RENAMED[name]];
  if (!entry) return null;
  const [file] = entry;
  return { asset: `cards/move-icons/${file}.png`, sw: ICON_W, sh: ICON_H };
}

/** Every plate this module can reference, for the preloader. */
export function allMovePlates() {
  return [...new Set(Object.values(PLATE).map(([file]) => `cards/move-icons/${file}.png`))];
}

/** Source-only crop map used by the explicit card-art freezing command. */
export function allMoveSourceCrops() {
  const crops = new Map();
  for (const [file, origin] of Object.values(PLATE)) {
    if (crops.has(file)) continue;
    const [sx, sy] = SRC[origin];
    crops.set(file, { file, sx, sy, sw: ICON_W, sh: ICON_H });
  }
  return [...crops.values()];
}
