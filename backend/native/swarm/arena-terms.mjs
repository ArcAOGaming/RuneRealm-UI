import fs from 'node:fs';
import path from 'node:path';

/**
 * Read the arena prices from the contract source the swarm is about to test.
 *
 * The browser gets these values from the published catalog. The worker bundle
 * is built before any wallet starts and cannot safely make an unsigned catalog
 * request at module load, so its generated client carries the same two integer
 * constants directly from constants.lua. A changed stake therefore changes the
 * bots and the post-run verifier without a second hand-maintained number.
 */
export function readArenaTerms(root) {
  const file = path.join(root, 'backend', 'native', 'constants.lua');
  const source = fs.readFileSync(file, 'utf8');
  const block = source.match(/^C\.ARENA\s*=\s*\{([\s\S]*?)^\}/m)?.[1];
  if (!block) throw new Error(`Cannot find C.ARENA in ${file}`);

  const integer = (name) => {
    const raw = block.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\d+)\\s*,`, 'm'))?.[1];
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`C.ARENA.${name} must be a non-negative integer in ${file}`);
    }
    return value;
  };

  const stake = integer('stake');
  const minEntry = integer('minEntry');
  if (stake <= 0 || minEntry < stake) {
    throw new Error(`C.ARENA must fund at least one battle in ${file}`);
  }
  return Object.freeze({ stake, minEntry });
}
