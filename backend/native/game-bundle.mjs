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
  'orderbook.lua',
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
 * @param {string}  [options.catalogRef] Arweave id of an already-uploaded
 *   catalog. When given, `game.lua` publishes the 43-byte id as `catalogref`
 *   instead of ~6.9 KB of `catalog` -- bytes every slot pays for five times
 *   over. Omit it and the module behaves exactly as it always has, which is
 *   what the test suites and local runners depend on. Get one from
 *   `catalog-ref.mjs`, which only returns an id a gateway has actually served.
 */
export function gameModuleSources({
  publicAccess = false, hyperAos = null, catalogRef = null,
} = {}) {
  const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
  // Interpolated into Lua source, so it is checked rather than trusted: an
  // Arweave id is exactly 43 base64url characters and nothing else can appear
  // between the quotes.
  if (catalogRef !== null && !/^[A-Za-z0-9_-]{43}$/.test(catalogRef)) {
    throw new Error(`catalogRef is not an Arweave id: ${JSON.stringify(catalogRef)}`);
  }
  return [
    // `json.lua` alone, not all of hyper-aos: this process defines its own
    // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
    // full runtime instead -- it registers `.json` the same way.
    read(hyperAos ? path.basename(hyperAos) : 'json.lua'),
    'local C = (function()',     read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    `C.PUBLIC_ACCESS = ${publicAccess ? 'true' : 'false'}`,
    ...(catalogRef ? [`C.CATALOG_REF = "${catalogRef}"`] : []),
    'local jsonx = (function()', read('jsonenc.lua'),   'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()',      read('battle.lua'),    'end)()',
    'local OrderBook = (function()', read('orderbook.lua'), 'end)()',
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
