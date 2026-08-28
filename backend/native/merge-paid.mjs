/**
 * merge-paid.mjs — reconcile the owner's paid list against the recovered one,
 * and write the paid.json that deploy.mjs unlocks.
 *
 *   node backend/native/merge-paid.mjs <their-list> [more-lists...]
 *
 * Accepts JSON arrays, JSON objects with an `addresses` key, arrays of
 * `{address: "..."}`, or plain text with one address per line (# comments and
 * blank lines ignored). CSV works too as long as the address is a field.
 *
 * The owner's list wins: anything they name is unlocked. The recovered list is
 * carried in as well, because it is what the live process actually held, and
 * an address there that is missing from their records is far more likely to be
 * a gap in the records than a person who never paid. Both origins are recorded
 * so nothing is silently invented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS = /^[A-Za-z0-9_-]{43}$/;

function extract(text) {
  const found = new Set();
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : (parsed.addresses || Object.keys(parsed));
      for (const entry of list) {
        const value = typeof entry === 'string' ? entry : (entry?.address ?? entry?.Address);
        if (typeof value === 'string' && ADDRESS.test(value.trim())) found.add(value.trim());
      }
      return found;
    } catch {
      // fall through to the scan below
    }
  }
  // Anything else: pull every 43-char base64url token out of the text. That
  // covers csv, tsv, one-per-line, and a chat message someone pasted.
  for (const match of text.matchAll(/[A-Za-z0-9_-]{43}/g)) {
    const value = match[0];
    // Reject a 43-char slice of a longer token.
    const before = text[match.index - 1];
    const after = text[match.index + 43];
    if (before && /[A-Za-z0-9_-]/.test(before)) continue;
    if (after && /[A-Za-z0-9_-]/.test(after)) continue;
    found.add(value);
  }
  return found;
}

const files = process.argv.slice(2);
if (!files.length) {
  // No list supplied: fall through on the recovered one alone. That is a
  // legitimate state — it is what to deploy with until the owner's own records
  // turn up — but say so, because it is not the finished answer.
  console.log('No list given; using the recovered checkpoint list alone.');
  console.log("Add the owner's own records later with:");
  console.log('  node backend/native/merge-paid.mjs <their-list>\n');
}

const origin = new Map();   // address -> Set of sources
const note = (address, source) => {
  if (!origin.has(address)) origin.set(address, new Set());
  origin.get(address).add(source);
};

const recoveredPath = path.join(HERE, 'unlocked-recovered.json');
if (fs.existsSync(recoveredPath)) {
  for (const a of extract(fs.readFileSync(recoveredPath, 'utf8'))) note(a, 'recovered');
} else {
  console.warn('No unlocked-recovered.json — run recover-unlocked.mjs first for a cross-check.\n');
}

for (const file of files) {
  const label = path.basename(file);
  const found = extract(fs.readFileSync(file, 'utf8'));
  console.log(`${label.padEnd(28)} ${String(found.size).padStart(5)} addresses`);
  for (const a of found) note(a, label);
}

const owners = files.map((f) => path.basename(f));
const all = [...origin.keys()].sort();
const onlyRecovered = all.filter((a) => {
  const from = origin.get(a);
  return from.has('recovered') && !owners.some((o) => from.has(o));
});
const onlyOwner = all.filter((a) => !origin.get(a).has('recovered'));
const both = all.length - onlyRecovered.length - onlyOwner.length;

console.log(`
  in both                  ${String(both).padStart(5)}
  only in your list(s)     ${String(onlyOwner.length).padStart(5)}   (unlocked - your records win)
  only in the checkpoint   ${String(onlyRecovered.length).padStart(5)}   (unlocked - the live process held them)
  ---------------------------------
  total to unlock          ${String(all.length).padStart(5)}`);

const out = path.join(HERE, 'paid.json');
fs.writeFileSync(out, JSON.stringify({
  generated: new Date().toISOString(),
  sources: ['unlocked-recovered.json', ...owners],
  addresses: all,
  // Kept so a disagreement can be argued about later rather than re-derived.
  onlyInRecovered: onlyRecovered,
  onlyInProvided: onlyOwner,
}, null, 1) + '\n');
console.log(`\nwrote ${path.relative(process.cwd(), out)}`);
console.log('Deploy with it:  HB_WALLET=key.json node backend/native/deploy.mjs');
