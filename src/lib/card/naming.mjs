/**
 * naming.mjs — the TEST- rule, in one place.
 *
 * Everything this pipeline publishes to a public network is prefixed while the
 * mint is being proven out: the asset title, the process `name` tag, and the
 * collection. A minted asset is permanent and a collection page is public, so
 * those identifiers have to announce what they are without anybody having to
 * inspect the image.
 *
 * Turning it off is one edit here, and it changes every network producer at
 * once — which is the point. Do not spell the prefix out anywhere else in the
 * minting pipeline.
 */

/** Set to '' to mint under the real names. */
export const NAME_PREFIX = 'TEST-';

/** `TEST-FireFox`. Idempotent, so re-prefixing a stored title is harmless. */
export function label(name) {
  const text = String(name ?? '').trim();
  if (!NAME_PREFIX) return text;
  return text.startsWith(NAME_PREFIX) ? text : NAME_PREFIX + text;
}

/** `TEST-FireFox` -> `FireFox`, for in-world presentation. */
export function displayName(name) {
  const text = String(name ?? '').trim();
  if (!NAME_PREFIX || !text.startsWith(NAME_PREFIX)) return text;
  return text.slice(NAME_PREFIX.length).trimStart();
}
