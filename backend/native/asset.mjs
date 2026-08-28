/**
 * asset.mjs — minting an atomic asset the way Bazar reads one.
 *
 * The standard is not a document; it is a tag set, and the only authority on it
 * is `permaweb/bazar` (`src/api/asset-mint.ts`). What follows was written
 * against that source and checked against a live asset on the network,
 * `mJ3BtBG9jHLEBpym5ufKeoPS4cMnsw-av9NbXYhnmuM` — a Dumdumz piece. Read this
 * before changing a tag:
 *
 *   * An asset IS an Arweave transaction. Not a bundled data item, not a
 *     scheduler POST — a base-layer L1 transaction whose DATA is the image and
 *     whose TAGS declare a HyperBEAM process. The asset id, the process id and
 *     the image id are all the same 43 characters. `bundledIn` on the live
 *     asset is null; it was posted straight to the chain.
 *
 *   * Nothing mints the supply. `initial-holder` plus `total-supply: 1` is the
 *     mint. The process is never messaged; the live asset is still at slot 0
 *     and its balances already read `{ <holder>: 1 }`.
 *
 *   * `execution-device: token@1.0` and its friends are native devices that do
 *     not appear in HyperBEAM's published device docs at all — they are newer
 *     than that branch. Do not go looking for a spec; there isn't one.
 *
 *   * Tag names are lowercased and must not repeat. HyperBEAM reads them as
 *     message fields, and a duplicate is the same class of silent poison as the
 *     duplicate `action` tag that cost a day in HYPERBEAM.md section 19.
 *
 * This is why the mint runs on a funded wallet rather than in the page: an L1
 * transaction costs AR, and a process cannot hold AR — a process id is a
 * transaction id, and nobody has its private key. AR sent to one is gone.
 */
import Arweave from 'arweave';

import { label } from '../../src/lib/card/naming.mjs';

const ADDRESS = /^[A-Za-z0-9_-]{43}$/;

export const GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net';

/**
 * Where to READ asset state.
 *
 * These processes are scheduled on Arweave itself, so a node can only serve one
 * if it indexes the chain. `schedule.forward.computer` — the node the game
 * process lives on — answers 500 for every one of them. `hb.arweave.net` serves
 * them; that is not a preference, it is the difference between working and not.
 */
export const ASSET_NODE = process.env.ASSET_NODE || 'https://hb.arweave.net';

/** Universal Data License, the id Bazar writes. */
export const UDL_LICENSE_ID = 'dE0rmDfl9_OWjkDznNEXHaSO_JohJkRolvMzaCroUdw';

const arweave = Arweave.init({
  host: new URL(GATEWAY).hostname,
  port: new URL(GATEWAY).port || 443,
  protocol: new URL(GATEWAY).protocol.replace(':', ''),
});

const assertAddress = (value, what) => {
  if (!ADDRESS.test(String(value ?? ''))) throw new TypeError(`${what}: not an Arweave address`);
  return value;
};

/**
 * Lowercase, reject duplicates, drop empties.
 *
 * Bazar's `normalizeUploadTags`, with one addition: a tag whose value is empty
 * is dropped rather than written. An empty `description` on the live asset
 * would be a field that exists and says nothing, and HyperBEAM would serve it.
 */
export function normalizeTags(tags) {
  const out = {};
  for (const [rawName, value] of Object.entries(tags)) {
    const name = String(rawName).trim().toLowerCase();
    if (!name) throw new TypeError('tag name is empty');
    if (Object.prototype.hasOwnProperty.call(out, name)) throw new TypeError(`duplicate tag: ${name}`);
    if (value === undefined || value === null || value === '') continue;
    out[name] = String(value);
  }
  return out;
}

/** The tag set that makes a transaction a one-unit tradable asset. */
export function mintTags({
  title, description, collection, owner, creator, contentType = 'image/png', udl = true,
}) {
  assertAddress(owner, 'initial-holder');
  assertAddress(creator ?? owner, 'creator');
  return normalizeTags({
    'content-type': contentType,
    'hint-ui-style': 'non-fungible',
    creator: creator ?? owner,
    description: String(description ?? '').trim(),
    implements: 'ANS-110',
    title: label(title),
    device: 'process@1.0',
    type: 'Process',
    'execution-device': 'token@1.0',
    'swap-device': 'arweave-swap@1.0',
    'scheduler-device': 'arweave-scheduler@1.0',
    'scheduler-mode': 'all',
    'initial-holder': owner,
    'total-supply': '1',
    denomination: '0',
    ticker: 'ASSET',
    name: label(title),
    ...(collection ? { 'base-collection': label(collection) } : {}),
    ...(udl
      ? {
        license: UDL_LICENSE_ID,
        currency: 'Arweave',
        derivation: 'Allowed-With-Credit',
        'commercial-use': 'Allowed-With-Credit',
      }
      : {}),
  });
}

/** The collection process: a carrier holding one pointer, to a manifest. */
export function collectionTags(name, manifestId, owner) {
  assertAddress(manifestId, 'manifest id');
  assertAddress(owner, 'collection owner');
  return normalizeTags({
    device: 'process@1.0',
    'execution-device': 'carrier@1.0',
    'scheduler-device': 'arweave-scheduler@1.0',
    'scheduler-mode': 'all',
    'initial-holder': owner,
    'initial-value': manifestId,
    'total-supply': '1',
    denomination: '0',
    ticker: 'COLLECTION',
    type: 'Process',
    name: label(name),
  });
}

/** Repoint a collection at a new manifest. Sent TO the collection process. */
export function collectionUpdateTags(name, manifestId) {
  assertAddress(manifestId, 'manifest id');
  return normalizeTags({
    action: 'set',
    value: manifestId,
    type: 'Collection-Update',
    name: label(name),
  });
}

/**
 * Move an asset. This is also how it is burned back into the game: there is no
 * burn action in the standard — the write API is transfer, make-offer,
 * cancel-order and register-interest — so returning a monster means handing
 * custody to an address the game controls.
 */
export function transferTags(recipient, quantity = '1') {
  assertAddress(recipient, 'transfer recipient');
  return normalizeTags({ action: 'transfer', recipient, quantity: String(quantity) });
}

/** The JSON a collection's `initial-value` points at. */
export function collectionManifest({ name, description, assets }) {
  return {
    version: 2,
    name: label(name),
    description: String(description ?? '').trim() || 'A Rune Realm collection.',
    kind: 'arweave-native-token-assets',
    assetCount: assets.length,
    assets,
  };
}

// The chain ------------------------------------------------------------------

export const jwkToAddress = (jwk) => arweave.wallets.jwkToAddress(jwk);

/** Winston the network wants for `bytes` of data. */
export async function price(bytes) {
  const res = await fetch(`${GATEWAY}/price/${Math.max(0, Math.floor(bytes))}`);
  if (!res.ok) throw new Error(`price ${res.status}`);
  return BigInt(await res.text());
}

/**
 * What the network wants for a 0-byte transaction sent TO `address`.
 *
 * This is `/price/0/<target>`, and it is the whole wallet-generation story in
 * one number: an address that has never received anything quotes the premium,
 * and one that has quotes dust. It is how the worker decides whether an asset
 * still needs seeding.
 */
export async function targetPrice(address) {
  const res = await fetch(`${GATEWAY}/price/0/${assertAddress(address, 'target price')}`);
  if (!res.ok) throw new Error(`price ${res.status}`);
  return BigInt((await res.text()).trim());
}

export async function balance(address) {
  const res = await fetch(`${GATEWAY}/wallet/${assertAddress(address, 'balance')}/balance`);
  if (!res.ok) throw new Error(`balance ${res.status}`);
  return BigInt(await res.text());
}

/**
 * Sign and publish one transaction.
 *
 * `data` may be a Buffer (an image, a manifest) or empty (a transfer, a
 * collection update). Chunked upload is used whenever the data spans more than
 * one chunk; below that a single POST is both sufficient and faster.
 *
 * Returns the id, which for a mint is simultaneously the asset, the process and
 * the image.
 */
export async function signAndPost(jwk, { data, tags, target, quantity, onSigned }) {
  const attributes = {};
  if (data !== undefined && data !== null) attributes.data = data;
  if (target) attributes.target = assertAddress(target, 'target');
  if (quantity !== undefined) attributes.quantity = String(quantity);

  const tx = await arweave.createTransaction(attributes, jwk);
  for (const [name, value] of Object.entries(tags)) tx.addTag(name, value);
  await arweave.transactions.sign(tx, jwk);
  if (!ADDRESS.test(tx.id)) throw new Error('wallet returned an unsigned transaction');

  // The id exists the moment it is signed, before anything is on the network.
  // A caller that records it HERE can survive a crash mid-post: reposting a
  // signed transaction earns a 208, while signing a replacement would mint the
  // same monster a second time. Bazar persists the signed item for the same
  // reason and calls its id authoritative even when the post is never seen.
  if (onSigned) await onSigned(tx.id);

  const chunks = tx.chunks?.chunks;
  if (Array.isArray(chunks) && chunks.length > 1) {
    const uploader = await arweave.transactions.getUploader(tx);
    while (!uploader.isComplete) await uploader.uploadChunk();
  } else {
    const res = await arweave.transactions.post(tx);
    // 208 is "already known", which a retry of a signed transaction earns and
    // which must never be treated as a failure — signing a replacement would
    // mint the same monster twice.
    if (res.status !== 200 && res.status !== 208) {
      throw new Error(`post ${res.status}: ${JSON.stringify(res.data ?? '')}`);
    }
  }
  return tx.id;
}

// Reading an asset back ------------------------------------------------------

/**
 * Who holds `assetId`, straight from the asset's own process.
 *
 * This is the only ownership truth. GraphQL finds candidates; it does not know
 * who owns anything, because a transfer is a message the process applies.
 */
export async function assetBalances(assetId) {
  assertAddress(assetId, 'asset id');
  const res = await fetch(`${ASSET_NODE}/${assetId}~process@1.0/now/balances`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`balances ${res.status}`);
  const body = await res.json();
  const balances = {};
  for (const [key, value] of Object.entries(body)) {
    if (ADDRESS.test(key)) balances[key] = Number(value);
  }
  return balances;
}

/** The single holder of a one-unit asset, or null while it is still settling. */
export async function assetHolder(assetId) {
  const balances = await assetBalances(assetId);
  const holders = Object.entries(balances).filter(([, n]) => n > 0);
  return holders.length === 1 ? holders[0][0] : null;
}

/** Has the transaction made it into a block yet? */
export async function confirmations(txId) {
  const res = await fetch(`${GATEWAY}/tx/${txId}/status`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = await res.json();
  return Number(body?.number_of_confirmations ?? 0);
}
