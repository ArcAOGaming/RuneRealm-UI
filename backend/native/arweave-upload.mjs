/**
 * Put a small immutable blob on Arweave, and do not return until a gateway
 * will actually serve it.
 *
 * This exists because `@ardrive/turbo-sdk` does not import on Node 22 in this
 * tree -- `rpc-websockets` `require()`s an ESM-only `uuid@14` and throws
 * `ERR_REQUIRE_ESM` before any of our code runs. That breaks
 * `npm run deploy:site` too. A Turbo upload is just a signed ANS-104 data item
 * POSTed to the upload service, and this repo already signs those correctly in
 * `ans104.mjs` (the same code path the browser's burner wallet uses), so the
 * SDK buys nothing here and costs a dependency that does not load.
 *
 * THE WAIT IS THE POINT. Measured on 2026-09-06 with the real 6,860-byte
 * catalog, from upload to first successful serve:
 *
 *     permagate.io    21.9 s
 *     ar-io.dev       32.9 s
 *     arweave.net    283.7 s      <-- 4.7 minutes
 *
 * A deploy that uploads and then immediately spawns a process pointing at the
 * new id ships a client that reads nothing for the next five minutes. Since
 * what we put here is `catalog` -- which carries `tuning`, the combat numbers
 * the client deliberately does NOT hardcode (see the note above the `levelUp`
 * block in `game.lua`) -- "reads nothing" means the numbers on screen are
 * silently wrong, which is the exact bug that note was written to stop. So this
 * blocks on a real 200 whose bytes match what we sent, and a caller that will
 * not wait gets an error instead of a broken deploy.
 *
 * Uploads under 100 KiB are free: the catalog cost 0 winc.
 */
import crypto from 'node:crypto';
import { signDataItem, jwkToAddress } from './ans104.mjs';

/** Turbo's upload service. A signed data item POSTs straight to it. */
export const UPLOAD_SERVICE = process.env.TURBO_UPLOAD
  || 'https://upload.ardrive.io/v1/tx';

/**
 * Gateways to accept as proof of availability, fastest-first by measurement.
 *
 * `arweave.net` is last deliberately: it is both the slowest to index and the
 * one the client actually reads, so it is the one that has to be true. The
 * others are here to make a failure legible -- if permagate serves the item and
 * arweave.net does not, the upload worked and indexing is lagging, which is a
 * very different problem from a rejected item.
 */
export const GATEWAYS = ['https://arweave.net', 'https://permagate.io', 'https://ar-io.dev'];

/** An ANS-104 data item's id is the base64url SHA-256 of its signature. */
export function dataItemId(item) {
  return crypto.createHash('sha256')
    .update(item.subarray(2, 2 + 512))
    .digest('base64url');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBytes(url, timeoutMs = 30_000) {
  const stop = AbortSignal.timeout(timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: stop });
    const body = Buffer.from(await res.arrayBuffer());
    return { ok: res.status === 200, status: res.status, ms: Date.now() - started, body };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(err?.message ?? err) };
  }
}

/**
 * Is `id` being served, with exactly these bytes, right now?
 *
 * Used to re-check an id we uploaded on some earlier deploy before reusing it.
 * Reusing a recorded id without asking would reintroduce the failure this
 * module exists to prevent — the difference being that a stale id fails
 * silently and forever rather than for the first five minutes.
 *
 * @returns {Promise<{served: boolean, gateway?: string, ms?: number}>}
 */
export async function verifyServed(id, bytes, gateways = GATEWAYS) {
  for (const gateway of gateways) {
    const got = await fetchBytes(`${gateway}/${id}`);
    if (got.ok && got.body?.equals(bytes)) return { served: true, gateway, ms: got.ms };
  }
  return { served: false };
}

/**
 * Sign `bytes` as a data item, upload it, and wait until a gateway serves the
 * SAME bytes back.
 *
 * Byte equality rather than a 200 is the check on purpose: a gateway answers an
 * id it does not have with its own HTML landing page at status 200, which is
 * the trap CLAUDE.md names for published keys and which applies verbatim here.
 * A length check alone would also pass on that page often enough to matter, so
 * this compares content.
 *
 * @returns {Promise<{id: string, bytes: number, winc: string, availableMs: number,
 *   servedBy: string, uploadMs: number, sha256: string}>}
 */
export async function uploadAndVerify({
  jwk,
  bytes,
  tags = [],
  gateways = GATEWAYS,
  budgetMs = 8 * 60_000,
  pollMs = 2_000,
  requireAll = false,
  onProgress = () => {},
}) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('uploadAndVerify: bytes must be a Buffer');
  if (!bytes.length) throw new Error('uploadAndVerify: refusing to upload an empty body');

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const item = await signDataItem(jwk, { data: bytes, tags });
  const id = dataItemId(item);
  onProgress({ phase: 'signed', id, bytes: bytes.length, owner: jwkToAddress(jwk) });

  const startedUpload = Date.now();
  const res = await fetch(UPLOAD_SERVICE, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: item,
  });
  const uploadMs = Date.now() - startedUpload;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upload rejected: ${res.status} ${text.slice(0, 300)}`);
  }
  let receipt = {};
  try { receipt = JSON.parse(text); } catch { /* the service may answer bare */ }
  // Trust our own id over the service's only if the service did not give one;
  // a mismatch means we computed the id wrong and every later read would 404.
  if (receipt.id && receipt.id !== id) {
    throw new Error(`upload service returned id ${receipt.id}, we computed ${id}`);
  }
  onProgress({ phase: 'uploaded', id, uploadMs, winc: receipt.winc ?? '0' });

  const seen = new Map();
  const deadline = Date.now() + budgetMs;
  const done = () => (requireAll ? seen.size === gateways.length : seen.size > 0);
  while (Date.now() < deadline && !done()) {
    for (const gateway of gateways) {
      if (seen.has(gateway)) continue;
      const got = await fetchBytes(`${gateway}/${id}`);
      if (got.ok && got.body?.equals(bytes)) {
        const availableMs = Date.now() - startedUpload;
        seen.set(gateway, availableMs);
        onProgress({ phase: 'available', id, gateway, availableMs, requestMs: got.ms });
      }
    }
    if (done()) break;
    await sleep(pollMs);
  }

  if (!seen.size) {
    throw new Error(
      `${id} was uploaded but no gateway served it within ${Math.round(budgetMs / 1000)}s. `
      + 'The item is on Arweave and this is safe to retry; do NOT deploy a process '
      + 'pointing at an id no gateway will answer.',
    );
  }

  const [servedBy, availableMs] = [...seen.entries()]
    .sort((a, b) => a[1] - b[1])[0];
  return {
    id,
    bytes: bytes.length,
    sha256,
    winc: String(receipt.winc ?? '0'),
    uploadMs,
    availableMs,
    servedBy,
    gateways: Object.fromEntries(seen),
  };
}

export default uploadAndVerify;
