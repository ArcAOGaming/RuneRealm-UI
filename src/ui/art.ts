/**
 * Local art.
 *
 * The process publishes an Arweave transaction id for each companion, but those
 * ids point at SPRITE ATLASES — 384x576 sheets of walk-cycle frames. Rendering
 * one in a 64px box shows a tiny character in the top-left corner and empty
 * space everywhere else, which is exactly how the old faction cards looked.
 *
 * Authored portraits live in RuneRealm-Assets. The files this build uses are
 * vendored under stable runtime names, so source filenames and old submodules
 * cannot leak into application lookups.
 *
 * Bundling them also means no gateway round trip and no broken image when
 * arweave.net is slow.
 *
 * ONE FAMILY, on purpose. Several legacy families exist, and only doge has
 * shipped. This file used
 * to pick between three of them by level, under the names hatchling / ascended
 * / dragon, which is how creatures that do not exist in the game ended up on
 * the companion screen, the leaderboard and the arena. `ascended` was the Super
 * family and `dragon` was the Dragon family; both are unreleased designs.
 *
 * So `portrait()` ignores level. When a family ships, this is where it goes
 * back — and `lib/card/layout.mjs` is where the minted card learns about it.
 *
 * Numbered entries resolve through the Monster Index; these four plates are the
 * fallback for records from before numbered entries.
 */
import { Affinity, Element, ItemId } from '../lib/types';
import { monsterIndexArt } from '../lib/monster-index';

// These are the four released dog plates only. Unreleased families stay in the
// authoring repository instead of sharing the runtime directory.
import dogeAir from '../assets/cards/portraits/air.png';
import dogeWater from '../assets/cards/portraits/water.png';
import dogeFire from '../assets/cards/portraits/fire.png';
import dogeRock from '../assets/cards/portraits/rock.png';

import berryAir from '../assets/items/berry-air.png';
import berryWater from '../assets/items/berry-water.png';
import berryFire from '../assets/items/berry-fire.png';
import berryRock from '../assets/items/berry-rock.png';

import runeArt from '../assets/items/rune.png';
import scrollArt from '../assets/items/scroll.png';

const PORTRAITS: Record<Element, string> = {
  air: dogeAir, water: dogeWater, fire: dogeFire, rock: dogeRock,
};

/**
 * The companion's portrait.
 *
 * `level` is accepted and ignored. It used to select an evolution tier, and the
 * two upper tiers were art for monsters this game does not have — see the note
 * at the top. The parameter stays so every call site keeps working and so the
 * day a second family ships is a one-line change here rather than a hunt.
 */
export function portrait(element: Affinity, _level = 0, entryNo?: number): string {
  const entryPortrait = monsterIndexArt(entryNo)?.portrait;
  if (entryPortrait) return entryPortrait;
  return element !== 'normal' ? PORTRAITS[element] : PORTRAITS.fire;
}

export const ITEM_ART: Partial<Record<ItemId, string>> = {
  air_berry: berryAir,
  water_berry: berryWater,
  fire_berry: berryFire,
  rock_berry: berryRock,
  scroll: scrollArt,
  /* The Rune had no art, so the shop drew it with the UI's Rune glyph — which
     is an interface icon, not a good, and so it never stacked into crates on
     the shelf the way every other item does. */
  rune: runeArt,
};
