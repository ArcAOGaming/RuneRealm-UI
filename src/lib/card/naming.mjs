/**
 * naming.mjs — the TEST- rule, in one place.
 *
 * Everything this pipeline publishes to a public network is prefixed while the
 * mint is being proven out: the asset title, the process `name` tag, the
 * collection, and the name printed on the card itself. A minted asset is
 * permanent and a collection page is public, so a card that escapes into a
 * marketplace has to announce what it is without anybody having to check a tag.
 *
 * Turning it off is one edit here, and it changes every producer at once —
 * which is the point. Do not spell the prefix out anywhere else.
 */

/** Set to '' to mint under the real names. */
export const NAME_PREFIX = 'TEST-';

/** `TEST-FireFox`. Idempotent, so re-prefixing a stored title is harmless. */
export function label(name) {
  const text = String(name ?? '').trim();
  if (!NAME_PREFIX) return text;
  return text.startsWith(NAME_PREFIX) ? text : NAME_PREFIX + text;
}
