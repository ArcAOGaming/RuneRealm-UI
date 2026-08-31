/**
 * PARKED FEATURE: normal deployments do not create or update a companion
 * collection. Retained for a future explicit product decision; invoke only via
 * the deliberately named `npm run parked:collection` command.
 *
 * collection.mjs — the Bazar collection, created and kept up to date.
 *
 * A collection is not a list the marketplace maintains for you; it is two
 * things you publish. An immutable JSON manifest naming every asset, and a
 * `carrier@1.0` process whose entire job is to hold one pointer at the current
 * manifest. Adding assets means publishing a NEW manifest and sending the
 * carrier a signed `set` — the old manifest stays on chain forever, which is
 * the point: a collection's history is auditable.
 *
 * Two consequences worth knowing before running this:
 *
 *   * Every append rewrites the whole manifest. Dumdumz's is 1,984 ids in 91 KB
 *     and costs about a cent to republish. That is cheap per append and
 *     quadratic over a collection's life, so the worker appends in BATCHES
 *     rather than once per mint.
 *
 *   * The asset's own `base-collection` tag is just a name, and it is written
 *     at mint time. An asset therefore claims membership on its own; the
 *     manifest is what makes the collection page show it. Both have to say the
 *     same thing, so both go through `label()` in card/naming.mjs.
 *
 * State lives in `mint-collection.json` next to this file. It is the only
 * record of which collection this deployment owns, and it is not recoverable
 * from the chain without knowing the process id — so it is worth keeping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectionManifest, collectionTags, collectionUpdateTags, jwkToAddress, signAndPost,
} from './asset.mjs';
import { label } from '../../src/lib/card/naming.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_FILE = process.env.MINT_COLLECTION || path.join(HERE, 'mint-collection.json');

export const DEFAULT_NAME = 'Rune Realm Companions';
export const DEFAULT_DESCRIPTION =
  'Companions raised in Rune Realm and pulled out of the game as one-unit assets. '
  + 'Each card is composited from the creature the process actually holds — its element, '
  + 'level, stats and moves at the moment it was minted.';

export function loadCollection() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

export function saveCollection(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/**
 * Publish a new, empty collection: manifest first, then the carrier pointing at
 * it.
 *
 * That order is not cosmetic. The carrier's `initial-value` must name a
 * manifest that already exists, so a failure between the two leaves an orphan
 * manifest — harmless, a few hundred bytes — rather than a collection process
 * pointing at nothing, which cannot be repaired because `initial-value` is a
 * spawn tag.
 */
export async function createCollection(jwk, {
  name = DEFAULT_NAME, description = DEFAULT_DESCRIPTION,
} = {}) {
  const owner = await jwkToAddress(jwk);
  const manifest = collectionManifest({ name, description, assets: [] });
  const manifestId = await signAndPost(jwk, {
    data: Buffer.from(JSON.stringify(manifest)),
    tags: {
      'content-type': 'application/json',
      type: 'Collection-Manifest',
      name: label(name),
    },
  });

  const processId = await signAndPost(jwk, {
    // Bazar writes this exact string as the collection process's body. It is
    // never read; the process's value is in its tags.
    data: Buffer.from('Rune Realm collection process'),
    tags: collectionTags(name, manifestId, owner),
  });

  return saveCollection({
    processId, manifestId, name, description, owner, assets: [], createdAt: Date.now(),
  });
}

/**
 * Add asset ids and repoint the carrier.
 *
 * Ids already present are dropped rather than duplicated — a worker that
 * crashed after minting but before appending will re-offer the same id on its
 * next pass, and a manifest with a repeated entry shows the same card twice on
 * the collection page forever.
 */
export async function appendAssets(jwk, ids) {
  const state = loadCollection();
  if (!state) throw new Error(`no collection yet: run \`node ${path.basename(HERE)}/collection.mjs create\``);

  const fresh = ids.filter((id) => id && !state.assets.includes(id));
  if (!fresh.length) return state;

  const assets = [...state.assets, ...fresh];

  // Reuse the manifest from a previous attempt at the SAME asset list.
  //
  // The manifest has to exist before the carrier can be pointed at it, so a
  // failure on the carrier update leaves a perfectly good manifest already
  // paid for. Three retries during development uploaded three identical
  // manifests and burned 0.009 AR proving it — and note that a 391-byte
  // manifest costs exactly what a 106 KB card costs, because Arweave has a
  // floor price. Small does not mean cheap; only fewer transactions do.
  const pending = state.pendingManifest;
  const sameList = pending && pending.assets.length === assets.length
    && pending.assets.every((id, i) => id === assets[i]);

  const manifestId = sameList ? pending.manifestId : await signAndPost(jwk, {
    data: Buffer.from(JSON.stringify(
      collectionManifest({ name: state.name, description: state.description, assets }),
    )),
    tags: {
      'content-type': 'application/json',
      type: 'Collection-Manifest',
      name: label(state.name),
    },
  });
  if (!sameList) saveCollection({ ...state, pendingManifest: { manifestId, assets } });

  // ONE WINSTON, not zero. Bazar's uploader does exactly this for any targeted
  // transaction:
  //
  //   request.target ? { data, target: request.target, quantity: '1' } : { data }
  //
  // A transaction with a target, no data and no quantity is a no-op, and every
  // Arweave node rejects it with a bare `400 Transaction verification failed`
  // that names nothing. That single winston is what makes it a real transfer.
  //
  // It also means the FIRST update to a new collection pays Arweave's
  // wallet-creation fee — about 0.22 AR, because the collection process has
  // never held any — and every update after it costs dust. That is not a bug to
  // route around; it is the price of the address existing, paid once.
  await signAndPost(jwk, {
    target: state.processId,
    quantity: '1',
    tags: collectionUpdateTags(state.name, manifestId),
  });

  return saveCollection({
    ...state, manifestId, assets, updatedAt: Date.now(), pendingManifest: undefined,
  });
}

// CLI ------------------------------------------------------------------------

// `import.meta.url` is `file:///C:/...` on Windows, and hand-building that from
// argv[1] loses a slash — so the guard never fired, the CLI exited 0 having done
// nothing, and `collection.mjs create` looked like it had succeeded silently.
// pathToFileURL is the only comparison that holds on both platforms.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  const walletPath = process.env.HB_WALLET
    || path.join(HERE, '..', '..', 'arweave-wallet-DA9qhP25.json');
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

  if (command === 'create') {
    const state = await createCollection(jwk, { name: rest[0] || DEFAULT_NAME });
    console.log(`collection ${state.processId}\nmanifest   ${state.manifestId}`);
    console.log(`https://bazar.arweave.net/#/collection/${state.processId}`);
  } else if (command === 'append') {
    const state = await appendAssets(jwk, rest);
    console.log(`${state.assets.length} assets, manifest ${state.manifestId}`);
  } else if (command === 'show') {
    console.log(JSON.stringify(loadCollection(), null, 2));
  } else {
    console.log('usage: collection.mjs create [name] | append <id...> | show');
    process.exit(1);
  }
}
