/**
 * The one description of what the game module is made of.
 *
 * `deploy.mjs` used to build this list inline, and `lua-minify.test.mjs`
 * re-declared it by hand so it could assert the assembled module stays under
 * the scheduler's size cliff. Those two copies had already drifted -- the test
 * was missing the `PUBLIC_ACCESS` line and the fleet bootstrap globals -- which
 * means the ceiling was being measured against a bundle that does not ship.
 *
 * The rule this file exists to enforce: the only thing allowed to differ
 * between what the test measures and what the scheduler receives is
 * `minifyLua`, which deletes comments and layout and nothing else.
 *
 * This module has no side effects on import. `deploy.mjs` cannot be imported
 * for its list -- it reads a wallet and calls `process.exit` at load -- so the
 * list lives here and `deploy.mjs` imports it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every `.lua` file the game module is built from, in bundle order, relative to
 * `backend/native/`. The glue lines between them are not here; they are in
 * `gameModuleSources` below, which is the thing to call. This list is for tests
 * that want to check each file individually.
 */
export const GAME_BUNDLE_FILES = [
  'json.lua',
  'constants.lua',
  'monster-index.generated.lua',
  'jsonenc.lua',
  'battle.lua',
  'economy.lua',
  'battle-fleet/authority.lua',
  'game.lua',
];

/**
 * The assembled, UNMINIFIED game module source.
 *
 * @param {object} [options]
 * @param {boolean} [options.publicAccess] emit `C.PUBLIC_ACCESS = true`
 * @param {string}  [options.hyperAos] path to a full hyper-aos runtime to
 *   bundle instead of `json.lua`; only its basename is used, and it is read
 *   from `backend/native/`, which is what `deploy.mjs` has always done.
 */
export function gameModuleSources({ publicAccess = false, hyperAos = null } = {}) {
  const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
  return [
    // `json.lua` alone, not all of hyper-aos: this process defines its own
    // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
    // full runtime instead -- it registers `.json` the same way.
    read(hyperAos ? path.basename(hyperAos) : 'json.lua'),
    'local C = (function()',     read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    `C.PUBLIC_ACCESS = ${publicAccess ? 'true' : 'false'}`,
    'local jsonx = (function()', read('jsonenc.lua'),   'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()',      read('battle.lua'),    'end)()',
    'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
    'BattleFleetBootstrapConfig = { enabled = true }',
    'BattleFleetConfig = nil',
    'BattleFleetAuthority = (function()',
    read('battle-fleet/authority.lua'),
    'end)()',
    read('game.lua'),
  ].join('\n');
}

export default gameModuleSources;
