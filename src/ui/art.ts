/**
 * Local art.
 *
 * The process publishes an Arweave transaction id for each companion, but those
 * ids point at SPRITE ATLASES — 384x576 sheets of walk-cycle frames. Rendering
 * one in a 64px box shows a tiny character in the top-left corner and empty
 * space everywhere else, which is exactly how the old faction cards looked.
 *
 * The real portrait art is in the `Monsters` submodule. The files this build
 * uses are copied into `src/assets/art/` under names that say what they are, so
 * the build does not depend on a submodule being checked out — and so the two
 * files whose names carry a trailing space stop being a trap.
 *
 * Bundling them also means no gateway round trip and no broken image when
 * arweave.net is slow.
 *
 * ONE FAMILY, on purpose. `src/assets/Monsters/portraits/` holds five — doge,
 * super, dragon, mix and ledgendary — and only doge has shipped. This file used
 * to pick between three of them by level, under the names hatchling / ascended
 * / dragon, which is how creatures that do not exist in the game ended up on
 * the companion screen, the leaderboard and the arena. `ascended` was the Super
 * family and `dragon` was the Dragon family; both are unreleased designs.
 *
 * So `portrait()` ignores level. When a family ships, this is where it goes
 * back — and `lib/card/layout.mjs` is where the minted card learns about it.
 *
 * To refresh them, re-copy from `src/assets/Monsters/` — `doge-<element>.png`
 * is `portraits/doge/level-1/Doge <Element>.png`, cropped to 320x448.
 */
import { Affinity, Element, ItemId } from '../lib/types';
import { monsterIndexArt } from '../lib/monster-index';

// `hatchling-*.png` IS the doge family, cropped. The other eight files in that
// directory are the unreleased Super and Dragon art and are deliberately not
// imported: an unused import here is one `portrait()` call away from putting a
// creature that does not exist back on screen.
import dogeAir from '../assets/art/hatchling-air.png';
import dogeWater from '../assets/art/hatchling-water.png';
import dogeFire from '../assets/art/hatchling-fire.png';
import dogeRock from '../assets/art/hatchling-rock.png';

import berryAir from '../assets/art/berry-air.png';
import berryWater from '../assets/art/berry-water.png';
import berryFire from '../assets/art/berry-fire.png';
import berryRock from '../assets/art/berry-rock.png';

import scrollArt from '../assets/art/scroll.png';

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
};
