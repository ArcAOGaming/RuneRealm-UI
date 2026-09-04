#!/usr/bin/env node
/**
 * Synchronise the authored Monster Index into the runtime repository.
 *
 * RuneRealm-Assets remains a separate repository and the source of truth.
 * This command validates its catalog, builds deterministic per-entry Phaser
 * atlases, then vendors only the generated catalog and runtime files needed by
 * a submodule-free CI checkout.
 *
 *   node tools/sync-monster-index.mjs
 *   node tools/sync-monster-index.mjs --check
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng } from '../backend/native/card/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSET_ROOT = path.join(ROOT, 'RuneRealm-Assets', 'monster-index');
const CATALOG_FILE = path.join(ASSET_ROOT, 'catalog.json');
const GENERATED_TS = path.join(ROOT, 'src', 'generated', 'monster-index.ts');
const GENERATED_LUA = path.join(ROOT, 'backend', 'native', 'monster-index.generated.lua');
const VENDORED_ROOT = path.join(ROOT, 'src', 'assets', 'monster-index');
const CHECK = process.argv.includes('--check');

const AFFINITIES = new Set(['fire', 'water', 'air', 'rock', 'normal']);
const STATES = new Set(['planned', 'art-in-progress', 'testing', 'live', 'retired']);
const ASSET_STATES = new Set(['missing', 'planned', 'partial', 'draft', 'fallback', 'approved']);
const RARITIES = new Set(['common', 'uncommon', 'rare', 'legendary']);
const REQUIRED_SLOTS = ['portrait', 'world', 'basicAttack', 'advancedAttack', 'runtimeAtlas'];
const SOURCE_ROW_CLIPS = ['idle', 'emote', 'walk.right', 'walk.left', 'walk.up', 'walk.down'];
const MOVE_NAMES = (() => {
  const source = fs.readFileSync(path.join(ROOT, 'backend', 'native', 'constants.lua'), 'utf8');
  const moveSection = source.split('-- Activities')[0].split('C.MOVE_POOLS = {')[1] ?? '';
  return new Set([...moveSection.matchAll(/\["([^"]+)"\]\s*=\s*{/g)].map((match) => match[1]));
})();

function fail(message) { throw new Error(`Monster Index: ${message}`); }
function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function rel(file) { return path.relative(ROOT, file).replaceAll('\\', '/'); }

function loadCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) {
    fail('RuneRealm-Assets/monster-index/catalog.json is missing. Initialise the asset submodule first.');
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  if (!plainObject(catalog) || catalog.schemaVersion !== 1 || catalog.title !== 'Monster Index') {
    fail('catalog must be a Monster Index schemaVersion 1 object');
  }
  if (!Array.isArray(catalog.entries) || !catalog.entries.length) fail('catalog has no entries');
  if (!Number.isInteger(catalog.nextEntryNo)) fail('nextEntryNo must be an integer');

  const numbers = new Set();
  const keys = new Set();
  const byNo = new Map();
  for (const [index, entry] of catalog.entries.entries()) {
    const where = `entries[${index}]`;
    if (!plainObject(entry) || !Number.isInteger(entry.entryNo) || entry.entryNo < 1) fail(`${where}.entryNo is invalid`);
    if (numbers.has(entry.entryNo)) fail(`entry #${entry.entryNo} is duplicated`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.entryKey ?? '')) fail(`${where}.entryKey is invalid`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.lineKey ?? '')) fail(`${where}.lineKey is invalid`);
    if (keys.has(entry.entryKey)) fail(`entryKey ${entry.entryKey} is duplicated`);
    if (![1, 2, 3].includes(entry.stage)) fail(`${where}.stage must be 1, 2, or 3`);
    if (entry.displayName !== null && (typeof entry.displayName !== 'string' || !entry.displayName.trim())) fail(`${where}.displayName is invalid`);
    if (typeof entry.workingName !== 'string' || !entry.workingName.trim()) fail(`${where}.workingName is invalid`);
    if (!AFFINITIES.has(entry.affinity)) fail(`${where}.affinity is invalid`);
    if (entry.rarity !== undefined && !RARITIES.has(entry.rarity)) fail(`${where}.rarity is invalid`);
    if (entry.provisional !== undefined && typeof entry.provisional !== 'boolean') fail(`${where}.provisional is invalid`);
    if (!plainObject(entry.evolution) || !plainObject(entry.moves)
        || !plainObject(entry.availability) || !plainObject(entry.assets) || !plainObject(entry.plan)) {
      fail(`${where} is missing a required object`);
    }
    if (!STATES.has(entry.availability.state)) fail(`${where}.availability.state is invalid`);
    if (!Number.isInteger(entry.availability.huntWeight) || entry.availability.huntWeight < 0) fail(`${where}.huntWeight is invalid`);
    if (entry.availability.state !== 'live'
        && (entry.availability.starter || entry.availability.huntCatchable || entry.availability.huntWeight > 0)) {
      fail(`${where} cannot enable gameplay channels before it is live`);
    }
    if (!entry.availability.huntCatchable && entry.availability.huntWeight !== 0) {
      fail(`${where} has hunt weight while not catchable`);
    }
    for (const move of [entry.moves.basic, entry.moves.advanced]) {
      if (move !== null && !MOVE_NAMES.has(move)) fail(`${where} references unknown move ${move}`);
    }
    for (const slot of REQUIRED_SLOTS) {
      const asset = entry.assets[slot];
      if (!plainObject(asset) || !ASSET_STATES.has(asset.status)) fail(`${where}.assets.${slot} is invalid`);
      if (asset.path && typeof asset.path !== 'string') fail(`${where}.assets.${slot}.path is invalid`);
      if (asset.notes !== undefined && (typeof asset.notes !== 'string' || asset.notes.length > 1000)) {
        fail(`${where}.assets.${slot}.notes is invalid`);
      }
      if (asset.rows !== undefined) {
        if (slot !== 'world' || !plainObject(asset.rows)) fail(`${where}.assets.${slot}.rows is invalid`);
        const names = Object.keys(asset.rows);
        if (names.length !== SOURCE_ROW_CLIPS.length
            || SOURCE_ROW_CLIPS.some((name) => !Number.isInteger(asset.rows[name]) || asset.rows[name] < 0)
            || names.some((name) => !SOURCE_ROW_CLIPS.includes(name))) {
          fail(`${where}.assets.world.rows must map every semantic world clip to a non-negative row`);
        }
      }
      if (asset.status === 'approved' || asset.status === 'fallback') {
        if (!asset.path) fail(`${where}.assets.${slot} needs a path`);
        const absolute = path.resolve(ASSET_ROOT, ...asset.path.split('/'));
        if (!absolute.startsWith(ASSET_ROOT + path.sep) || !fs.existsSync(absolute)) {
          // Runtime atlases are built below and may not exist on the first sync.
          if (slot !== 'runtimeAtlas') fail(`${where}.assets.${slot} is missing ${asset.path}`);
        }
      }
      if (asset.status === 'partial' || asset.status === 'draft') {
        if (!asset.path) fail(`${where}.assets.${slot} needs a path while ${asset.status}`);
        const absolute = path.resolve(ASSET_ROOT, ...asset.path.split('/'));
        if (!absolute.startsWith(ASSET_ROOT + path.sep) || !fs.existsSync(absolute)) {
          fail(`${where}.assets.${slot} is missing ${asset.path}`);
        }
      }
    }
    numbers.add(entry.entryNo);
    keys.add(entry.entryKey);
    byNo.set(entry.entryNo, entry);
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  sorted.forEach((number, index) => {
    if (number !== index + 1) fail(`entry numbers must be contiguous; expected #${index + 1}, found #${number}`);
  });
  if (catalog.nextEntryNo !== sorted.at(-1) + 1) fail('nextEntryNo must be the number after the last reserved entry');

  const lines = new Map();
  for (const entry of catalog.entries) {
    const forms = lines.get(entry.lineKey) ?? [];
    forms.push(entry);
    lines.set(entry.lineKey, forms);
    for (const linked of [entry.evolution.from, entry.evolution.to]) {
      if (linked !== null && !byNo.has(linked)) fail(`#${entry.entryNo} links to missing #${linked}`);
    }
  }
  for (const [line, forms] of lines) {
    forms.sort((a, b) => a.stage - b.stage);
    if (forms.length !== 3 || forms.some((entry, index) => entry.stage !== index + 1)) {
      fail(`${line} must reserve exactly stages 1, 2, and 3`);
    }
    forms.forEach((entry, index) => {
      const before = forms[index - 1]?.entryNo ?? null;
      const after = forms[index + 1]?.entryNo ?? null;
      if (entry.evolution.from !== before || entry.evolution.to !== after) fail(`${line} has inconsistent evolution links at #${entry.entryNo}`);
    });
  }
  return catalog;
}

function copyRect(source, target, targetWidth, sx, sy, width, height, dx, dy) {
  for (let y = 0; y < height; y++) {
    const from = ((sy + y) * source.width + sx) * 4;
    const to = ((dy + y) * targetWidth + dx) * 4;
    target.set(source.data.subarray(from, from + width * 4), to);
  }
}

function atlasFrame(x, y, w, h) {
  return {
    frame: { x, y, w, h }, rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h },
  };
}

const RUNTIME_CLIPS = [
  'idle', 'emote', 'walk.right', 'walk.left', 'walk.up', 'walk.down',
  'attack.basic', 'attack.advanced',
];

const STANDARD_SHEET = {
  width: 1024, height: 576,
  groups: [
    ['walk.right', 0, 64, 4], ['walk.left', 64, 64, 4],
    ['walk.up', 128, 64, 4], ['walk.down', 192, 64, 4],
    ['idle', 256, 64, 4], ['emote', 320, 64, 4],
    ['attack.basic', 384, 64, 4], ['attack.advanced', 448, 128, 8],
  ],
};

function validateStandardSheet(atlas, entryNo) {
  if (atlas.meta?.size?.w !== STANDARD_SHEET.width || atlas.meta?.size?.h !== STANDARD_SHEET.height) {
    fail(`#${entryNo} monster-sheet-v1 must be 1024x576`);
  }
  for (const [clip, y, size, count] of STANDARD_SHEET.groups) {
    for (let index = 0; index < count; index++) {
      const name = `${clip}.${index}`;
      const frame = atlas.frames?.[name]?.frame;
      if (!frame || frame.x !== index * size || frame.y !== y
          || frame.w !== size || frame.h !== size) {
        fail(`#${entryNo} monster-sheet-v1 frame ${name} is not in the standard position`);
      }
    }
  }
}

/** A delivered canonical sheet is already packed; validate and vendor it byte-for-byte. */
function directRuntimeAtlas(entry) {
  const animationPaths = ['world', 'basicAttack', 'advancedAttack']
    .map((slot) => path.resolve(ASSET_ROOT, ...entry.assets[slot].path.split('/')));
  if (new Set(animationPaths).size !== 1) return null;
  const jsonPath = path.resolve(ASSET_ROOT, ...entry.assets.runtimeAtlas.path.split('/'));
  if (!fs.existsSync(jsonPath) || !fs.existsSync(animationPaths[0])) return null;

  let atlas;
  try { atlas = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch { fail(`#${entry.entryNo} canonical atlas JSON is invalid`); }
  const layout = atlas?.runerealm?.sheetLayout;
  if (!['monster-sheet-v1', 'custom'].includes(layout)
      || atlas.runerealm.entryNo !== entry.entryNo
      || RUNTIME_CLIPS.some((clip) => !Array.isArray(atlas.runerealm.clips?.[clip]?.frames)
        || atlas.runerealm.clips[clip].frames.length < 1)) {
    fail(`#${entry.entryNo} canonical atlas is missing required runtime metadata`);
  }
  if (layout === 'monster-sheet-v1') validateStandardSheet(atlas, entry.entryNo);
  const png = fs.readFileSync(animationPaths[0]);
  const image = decodePng(png);
  if (atlas.meta?.size?.w !== image.width || atlas.meta?.size?.h !== image.height) {
    fail(`#${entry.entryNo} canonical atlas dimensions do not match its JSON`);
  }
  return { png, json: `${JSON.stringify(atlas, null, 2)}\n`, direct: true };
}

function buildRuntimeAtlas(entry) {
  const direct = directRuntimeAtlas(entry);
  if (direct) return direct;

  const worldPath = path.resolve(ASSET_ROOT, ...entry.assets.world.path.split('/'));
  const basicPath = path.resolve(ASSET_ROOT, ...entry.assets.basicAttack.path.split('/'));
  const advancedPath = path.resolve(ASSET_ROOT, ...entry.assets.advancedAttack.path.split('/'));
  const worldBuffer = fs.readFileSync(worldPath);
  const basicBuffer = fs.readFileSync(basicPath);
  const advancedBuffer = fs.readFileSync(advancedPath);
  const world = decodePng(worldBuffer);
  const basic = decodePng(basicBuffer);
  const advanced = decodePng(advancedBuffer);
  const cell = world.width / 4;
  if (!Number.isInteger(cell) || cell < 32 || cell > 256 || world.height < cell * 4 || world.height % cell) {
    fail(`#${entry.entryNo} world sheet must use four square-cell columns and at least four rows`);
  }
  const stripInfo = (image, slot, label, fallbackRow) => {
    const [x, y, width, height] = slot.sourceRect
      ?? (fallbackRow === undefined
        ? [0, 0, image.width, image.height]
        : [0, fallbackRow * cell, cell * 4, cell]);
    if (x + width > image.width || y + height > image.height
        || width % height || width / height < 1 || width / height > 16) {
      fail(`#${entry.entryNo} ${label} must be one horizontal strip of 1-16 square frames`);
    }
    return { image, x, y, width, size: height, count: width / height };
  };
  const sourceRows = entry.assets.world.rows;
  if (sourceRows && SOURCE_ROW_CLIPS.some((name) => sourceRows[name] * cell >= world.height)) {
    fail(`#${entry.entryNo} world row map points outside its world sheet`);
  }
  const sourceWalkRows = sourceRows ?? {
    'walk.right': 0, 'walk.left': 1, 'walk.up': 2, 'walk.down': 3,
  };
  const basicStrip = stripInfo(
    basic, entry.assets.basicAttack, 'basic attack',
    path.resolve(basicPath) === path.resolve(worldPath) ? 4 : undefined,
  );
  const advancedStrip = stripInfo(
    advanced, entry.assets.advancedAttack, 'advanced attack',
    path.resolve(advancedPath) === path.resolve(worldPath) ? 5 : undefined,
  );

  // monster-sheet-v1 always has the same semantic order. Inputs may be in any
  // order, but the resulting full sheet is flat and predictable.
  const walkRows = ['walk.right', 'walk.left', 'walk.up', 'walk.down'];
  const idleY = cell * 4;
  const emoteY = cell * 5;
  const basicY = cell * 6;
  const advancedY = basicY + basicStrip.size;
  const width = Math.max(cell * 4, basicStrip.width, advancedStrip.width);
  const height = advancedY + advancedStrip.size;
  const data = new Uint8Array(width * height * 4);
  walkRows.forEach((clip, targetRow) => {
    copyRect(world, data, width, 0, sourceWalkRows[clip] * cell, cell * 4, cell, 0, targetRow * cell);
  });
  const idleSourceRow = sourceRows?.idle ?? sourceWalkRows['walk.down'];
  const emoteSourceRow = sourceRows?.emote ?? idleSourceRow;
  copyRect(world, data, width, 0, idleSourceRow * cell, cell * 4, cell, 0, idleY);
  copyRect(world, data, width, 0, emoteSourceRow * cell, cell * 4, cell, 0, emoteY);
  copyRect(basicStrip.image, data, width, basicStrip.x, basicStrip.y,
    basicStrip.width, basicStrip.size, 0, basicY);
  copyRect(advancedStrip.image, data, width, advancedStrip.x, advancedStrip.y,
    advancedStrip.width, advancedStrip.size, 0, advancedY);

  const frames = {};
  const clips = {};
  for (const [targetRow, clip] of walkRows.entries()) {
    const names = [];
    for (let column = 0; column < 4; column++) {
      const name = `${clip}.${column}`;
      frames[name] = atlasFrame(column * cell, targetRow * cell, cell, cell);
      names.push(name);
    }
    clips[clip] = { frames: names, frameRate: 8, repeat: -1 };
  }
  const targetFrames = (clipName, y, size, count) => {
    const names = [];
    for (let index = 0; index < count; index++) {
      const name = `${clipName}.${index}`;
      frames[name] = atlasFrame(index * size, y, size, size);
      names.push(name);
    }
    return names;
  };
  const idleNames = targetFrames('idle', idleY, cell, 4);
  const emoteNames = targetFrames('emote', emoteY, cell, 4);
  const basicNames = targetFrames('attack.basic', basicY, basicStrip.size, basicStrip.count);
  const advancedNames = targetFrames('attack.advanced', advancedY, advancedStrip.size, advancedStrip.count);
  clips.idle = { frames: [idleNames[0]], frameRate: 1, repeat: -1 };
  clips.emote = { frames: [...emoteNames, idleNames[0]], frameRate: 6, repeat: 0 };
  clips['attack.basic'] = { frames: basicNames, frameRate: 12, repeat: 0, impactFrame: Math.max(0, Math.floor(basicNames.length / 2)) };
  clips['attack.advanced'] = { frames: advancedNames, frameRate: 14, repeat: 0, impactFrame: Math.max(0, Math.floor(advancedNames.length / 2)) };

  const standard = cell === 64 && basicStrip.size === 64 && basicStrip.count === 4
    && advancedStrip.size === 128 && advancedStrip.count === 8;
  const atlas = {
    frames,
    meta: {
      app: 'Rune Monster Index packer', version: '1', image: 'atlas.png',
      format: 'RGBA8888', size: { w: width, h: height }, scale: '1',
    },
    runerealm: {
      schemaVersion: 1,
      entryNo: entry.entryNo,
      sheetLayout: standard ? 'monster-sheet-v1' : 'custom',
      clips,
      render: {
        origin: { x: 0.5, y: 1 }, worldScale: 1, battleScale: 1,
        shadow: { width: 30, height: 8, offsetY: 1 }, attackReach: 46,
      },
    },
  };
  return {
    png: Buffer.from(encodePng(data, width, height)),
    json: `${JSON.stringify(atlas, null, 2)}\n`, direct: false,
  };
}

function luaString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
}

function luaValue(value, indent = '') {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return luaString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{ ${value.map((item) => luaValue(item, indent)).join(', ')} }`;
  const next = `${indent}  `;
  const rows = Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => {
    const luaKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
    return `${next}${luaKey} = ${luaValue(item, next)}`;
  });
  return `{\n${rows.join(',\n')}\n${indent}}`;
}

function compactEntry(entry, artRevision) {
  const assetReady = REQUIRED_SLOTS.every((slot) => (
    entry.assets[slot].status === 'approved' || entry.assets[slot].status === 'fallback'
  ));
  return {
    entryNo: entry.entryNo,
    entryKey: entry.entryKey,
    lineKey: entry.lineKey,
    stage: entry.stage,
    name: entry.displayName,
    workingName: entry.workingName,
    affinity: entry.affinity,
    ...(entry.rarity && entry.rarity !== 'common' ? { rarity: entry.rarity } : {}),
    ...(entry.provisional === true ? { provisional: true } : {}),
    starterFaction: entry.starterFaction ?? null,
    evolvesFrom: entry.evolution.from,
    evolvesTo: entry.evolution.to,
    evolvesAtLevel: entry.evolution.atLevel,
    basicMove: entry.moves.basic,
    advancedMove: entry.moves.advanced,
    state: entry.availability.state,
    starter: entry.availability.starter,
    huntCatchable: entry.availability.huntCatchable,
    huntWeight: entry.availability.huntWeight,
    assetReady,
    artRevision,
  };
}

function sameFile(file, expected) {
  if (!fs.existsSync(file)) return false;
  const actual = fs.readFileSync(file);
  const wanted = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  return actual.equals(wanted);
}

function put(file, value, drift) {
  if (sameFile(file, value)) return;
  drift.push(rel(file));
  if (CHECK) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

const catalog = loadCatalog();
const drift = [];
const revisions = new Map();

for (const entry of catalog.entries) {
  const packable = ['portrait', 'world', 'basicAttack', 'advancedAttack'].every((slot) => (
    (entry.assets[slot].status === 'approved' || entry.assets[slot].status === 'fallback')
      && entry.assets[slot].path
      && fs.existsSync(path.resolve(ASSET_ROOT, ...entry.assets[slot].path.split('/')))
  ));
  if (!packable) {
    revisions.set(entry.entryNo, 'planned');
    continue;
  }
  const built = buildRuntimeAtlas(entry);
  const entryDir = path.join(ASSET_ROOT, 'entries', `${String(entry.entryNo).padStart(3, '0')}-${entry.entryKey}`);
  const authoredRuntime = path.join(entryDir, 'runtime');
  const authoredPng = path.join(authoredRuntime, 'atlas.png');
  const authoredJson = path.join(authoredRuntime, 'atlas.json');
  if (!built.direct) {
    put(authoredPng, built.png, drift);
    put(authoredJson, built.json, drift);
    entry.assets.runtimeAtlas = {
      status: 'approved',
      path: path.relative(ASSET_ROOT, authoredJson).replaceAll('\\', '/'),
    };
  }

  const vendored = path.join(VENDORED_ROOT, String(entry.entryNo).padStart(3, '0'));
  put(path.join(vendored, 'atlas.png'), built.png, drift);
  put(path.join(vendored, 'atlas.json'), built.json, drift);
  const portrait = fs.readFileSync(path.resolve(ASSET_ROOT, ...entry.assets.portrait.path.split('/')));
  put(path.join(vendored, 'portrait.png'), portrait, drift);
  revisions.set(entry.entryNo, sha(Buffer.concat([portrait, built.png, Buffer.from(built.json)])).slice(0, 16));
}

const canonicalCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
put(CATALOG_FILE, canonicalCatalog, drift);
const catalogHash = sha(canonicalCatalog).slice(0, 16);

const compact = catalog.entries.map((entry) => compactEntry(entry, revisions.get(entry.entryNo) ?? 'planned'));
const lua = [
  '-- Generated by tools/sync-monster-index.mjs from RuneRealm-Assets/monster-index/catalog.json.',
  '-- Do not hand-edit. Run `npm run monster-index:sync`.',
  `C.MONSTER_INDEX_SCHEMA_VERSION = ${catalog.schemaVersion}`,
  `C.MONSTER_INDEX_CATALOG_HASH = ${luaString(catalogHash)}`,
  `C.MONSTER_INDEX_NEXT_NO = ${catalog.nextEntryNo}`,
  `C.MONSTER_INDEX = ${luaValue(compact)}`,
  'C.MONSTER_INDEX_BY_NO = {}',
  'C.MONSTER_INDEX_BY_KEY = {}',
  'for _, entry in ipairs(C.MONSTER_INDEX) do',
  '  C.MONSTER_INDEX_BY_NO[entry.entryNo] = entry',
  '  C.MONSTER_INDEX_BY_KEY[entry.entryKey] = entry',
  'end',
  '',
].join('\n');
put(GENERATED_LUA, lua, drift);

const ts = [
  '/** Generated by tools/sync-monster-index.mjs. Do not hand-edit. */',
  `export const GENERATED_MONSTER_INDEX = ${JSON.stringify({
    schemaVersion: catalog.schemaVersion,
    catalogHash,
    title: catalog.title,
    nextEntryNo: catalog.nextEntryNo,
    entries: catalog.entries.map((entry) => ({ ...entry, artRevision: revisions.get(entry.entryNo) ?? 'planned' })),
  }, null, 2)} as const;`,
  '',
].join('\n');
put(GENERATED_TS, ts, drift);

if (drift.length) {
  if (CHECK) {
    console.error('Monster Index generated files are out of date:');
    drift.forEach((file) => console.error(`  ${file}`));
    console.error('Run: npm run monster-index:sync');
    process.exit(1);
  }
  console.log(`Monster Index synced: ${catalog.entries.length} entries, ${drift.length} file(s) updated.`);
} else {
  console.log(`Monster Index is current: ${catalog.entries.length} entries.`);
}
