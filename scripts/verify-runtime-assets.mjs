import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'src', 'assets');
const fail = (message) => { throw new Error(message); };
const files = (directory, extension = null) => fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
  .map((entry) => entry.name).sort();
const requireFile = (relative) => {
  const absolute = path.join(ASSETS, ...relative.split('/'));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`missing runtime asset: ${relative}`);
  return absolute;
};

const cardRoot = path.join(ASSETS, 'cards');
const cardManifest = JSON.parse(fs.readFileSync(path.join(cardRoot, 'manifest.json'), 'utf8'));
if (cardManifest.schemaVersion !== 1 || !cardManifest.files) fail('invalid card asset manifest');
for (const [relative, expected] of Object.entries(cardManifest.files)) {
  const absolute = requireFile(`cards/${relative}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  if (actual !== expected) fail(`card asset hash mismatch: ${relative}`);
}
const manifestedCards = Object.keys(cardManifest.files).sort();
const checkedCards = [];
for (const directory of ['backgrounds', 'move-icons', 'portraits', 'seals', 'shells']) {
  for (const name of files(path.join(cardRoot, directory), '.png')) checkedCards.push(`${directory}/${name}`);
}
checkedCards.push('side-panel.png');
checkedCards.sort();
if (JSON.stringify(checkedCards) !== JSON.stringify(manifestedCards)) {
  fail('card runtime files do not exactly match cards/manifest.json');
}

const arena = files(path.join(ASSETS, 'scenes', 'arena'), '.png');
if (arena.length !== 21) fail(`expected 21 curated arena scenes, found ${arena.length}`);
requireFile('scenes/home/cottage.png');
for (const route of ['frostpeak-pass', 'sunset-coast', 'verdant-forest']) {
  for (const layer of ['sky', 'far', 'mid']) requireFile(`scenes/quest/${route}/${layer}.png`);
}
for (const entry of ['001', '004', '007', '010']) {
  requireFile(`monster-index/${entry}/portrait.png`);
  requireFile(`monster-index/${entry}/atlas.png`);
  requireFile(`monster-index/${entry}/atlas.json`);
}
const legacySheets = files(path.join(ASSETS, 'companions', 'legacy-sprites'), '.png');
if (legacySheets.length !== 4) fail(`expected 4 legacy companion sheets, found ${legacySheets.length}`);
for (const effect of ['medium-heal', 'special-air', 'special-fire', 'special-rock', 'special-water']) {
  requireFile(`effects/battle/${effect}.png`);
}

console.log(`runtime assets verified: ${manifestedCards.length} card files, ${arena.length} arenas, 3 quest routes, 4 live monster entries`);
