/** Weave primitives for reading a published LMDB container in place.
 *
 * Nothing here knows what a container is. It knows three things about
 * Arweave: where a transaction's data sits, what its tags say, and how to
 * pull one 256 KiB chunk by absolute offset — while counting every byte that
 * crosses the wire, because the byte count is the whole claim being tested.
 *
 * Offsets are `bigint` throughout. The weave is past 2^53 bytes, so a Number
 * offset is silently wrong, not slow.
 */
import process from 'node:process';

/** An Arweave chunk, and the LMDB page grid a published container aligns to. */
export const CHUNK_SIZE = 262144n; // 4 * 64 KiB
export const PAGE_SIZE = 65536n;

const DEFAULT_GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net';

/** Peers to race for chunk reads, gateway last.
 *
 * The index transaction publishes its own `sources` tag; that list is
 * preferred when a container carries it, and this is the fallback. Several
 * `data-N.arweave.xyz` hosts are unreachable from some networks, so an
 * unreachable source must demote rather than fail the read. */
export const DEFAULT_SOURCES = Object.freeze([DEFAULT_GATEWAY]);

const json = async (url, signal) => {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`GET ${url} -> ${res.status} ${text.slice(0, 160)}`);
  }
  return { body: JSON.parse(text), wire: Buffer.byteLength(text) };
};

/** Where a transaction's data begins in the weave.
 *
 * The gateway reports the offset of the FINAL byte, 1-indexed, so the first
 * byte is `offset - size`. Getting this backwards reads a neighbouring
 * transaction and every page validates as garbage. */
export async function readLocation(id, { gateway = DEFAULT_GATEWAY, signal } = {}) {
  const { body } = await json(`${gateway}/tx/${id}/offset`, signal);
  const size = BigInt(body.size);
  return { start: BigInt(body.offset) - size, size };
}

/** A transaction's tags, decoded. Names and values arrive base64url. */
export async function readTags(id, { gateway = DEFAULT_GATEWAY, signal } = {}) {
  const { body } = await json(`${gateway}/tx/${id}`, signal);
  const tags = {};
  for (const tag of body.tags || []) {
    tags[Buffer.from(tag.name, 'base64url').toString('utf8')] =
      Buffer.from(tag.value, 'base64url').toString('utf8');
  }
  return tags;
}

/** A chunk reader with a retention cache and a byte meter.
 *
 * `stats` is the point of this module: `chunks` counts weave fetches, `hits`
 * counts reads answered from retained chunks, and `wireBytes` is what the
 * network actually moved. A traversal of a 171 GB database is only
 * interesting next to those three numbers. */
export function createChunkSource({
  sources = DEFAULT_SOURCES,
  retain = true,
  signal,
} = {}) {
  const cache = new Map();
  const demoted = new Set();
  const stats = { chunks: 0, hits: 0, wireBytes: 0, ms: 0, sources: {} };

  /** One chunk, addressed by the 1-based absolute offset of its first byte —
   * the same key `~arweave@2.9/chunk=` uses, so a cache here and a chunk
   * store on a node name the same thing. */
  async function chunkAt(firstByte) {
    const key = firstByte.toString();
    if (cache.has(key)) {
      stats.hits += 1;
      return cache.get(key);
    }
    const ordered = sources.filter((s) => !demoted.has(s)).concat(
      sources.filter((s) => demoted.has(s)),
    );
    let lastError;
    for (const source of ordered) {
      const started = Date.now();
      try {
        const res = await fetch(`${source}/chunk/${key}`, {
          headers: { accept: 'application/json' },
          signal,
        });
        const text = await res.text();
        stats.wireBytes += Buffer.byteLength(text);
        stats.ms += Date.now() - started;
        if (res.status !== 200) {
          lastError = new Error(`${source} -> ${res.status} ${text.slice(0, 120)}`);
          continue;
        }
        const bytes = Buffer.from(JSON.parse(text).chunk, 'base64url');
        stats.chunks += 1;
        stats.sources[source] = (stats.sources[source] || 0) + 1;
        if (retain) cache.set(key, bytes);
        return bytes;
      } catch (error) {
        stats.ms += Date.now() - started;
        demoted.add(source);
        lastError = error;
      }
    }
    throw new Error(`unavailable: chunk ${key}: ${lastError && lastError.message}`);
  }

  /** A byte range of a container, sliced from the chunk holding it.
   *
   * Pages align within a published container's chunks, so a range never
   * spans two — a request that would is a bug in the caller, not a second
   * fetch. */
  async function range(start, offset, length) {
    const chunk = offset / CHUNK_SIZE;
    const within = offset - chunk * CHUNK_SIZE;
    if (within + BigInt(length) > CHUNK_SIZE) {
      throw new Error(`invalid-fetch-span: ${offset} +${length}`);
    }
    const bytes = await chunkAt(start + chunk * CHUNK_SIZE + 1n);
    if (Number(within) + length > bytes.length) {
      throw new Error(`unavailable: short_read ${bytes.length}`);
    }
    return bytes.subarray(Number(within), Number(within) + length);
  }

  return { chunkAt, range, stats, cache, reset: () => cache.clear() };
}
