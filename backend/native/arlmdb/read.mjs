/** Resolve Arweave data item IDs through the published offset index, and
 * report what the traversal actually cost.
 *
 *   node backend/native/arlmdb/read.mjs <id> [id...] [--json] [--cold]
 *   node backend/native/arlmdb/read.mjs --golden          # the commit's vectors
 *   node backend/native/arlmdb/read.mjs --verify <id>     # cross-check vs GraphQL
 *
 * The numbers are the point. A lookup answers from a 171 GB database that is
 * never downloaded, so every line prints the chunks fetched and the bytes that
 * crossed the wire beside the answer. `--cold` clears the retention cache
 * between lookups, which is the honest worst case; the default keeps chunks,
 * which is what a warm node or a browser session actually sees.
 *
 * Wire bytes run ~1.37x the useful bytes: an Arweave peer serves `/chunk/` as
 * JSON with the payload base64url-encoded. A node reading ranges directly
 * moves the useful figure, not the wire figure.
 */
import process from 'node:process';
import { openContainer } from './container.mjs';
import { createChunkSource } from './weave.mjs';
import { OFFSET_INDEX, GOLDEN, MISSES } from './vectors.mjs';

const KB = (n) => `${(n / 1024).toFixed(0)} KB`;

/** Resolve a batch of IDs against a container, timing and metering each. */
export async function resolveIds(ids, { root = OFFSET_INDEX, cold = false, chunks } = {}) {
  const source = chunks || createChunkSource();
  const opened = Date.now();
  const container = await openContainer(root, { chunks: source });
  const openStats = { ...source.stats };
  const results = [];
  for (const id of ids) {
    if (cold) source.reset();
    const before = { ...source.stats };
    const started = Date.now();
    const row = await container.read(`${container.tags.prefix}${id}`);
    results.push({
      id,
      found: row !== null,
      start: row ? row.start : null,
      length: row ? row.length : null,
      ms: Date.now() - started,
      chunks: source.stats.chunks - before.chunks,
      cached: source.stats.hits - before.hits,
      wireBytes: source.stats.wireBytes - before.wireBytes,
    });
  }
  return {
    container,
    results,
    openMs: opened && openStats.ms,
    stats: source.stats,
  };
}

/** An independent opinion on a resolved row.
 *
 * GraphQL reports the item's PAYLOAD size; the index reports the whole ANS-104
 * item, headers included. So a correct row has `length > size`, by a header
 * that is normally one to a few kilobytes. This does not verify the offset —
 * only Arweave's own Merkle proofs on the chunk do that — but a length that
 * fails this cannot be the right row. */
export async function crossCheck(ids, { gateway = 'https://arweave.net' } = {}) {
  const query = `{transactions(ids:${JSON.stringify(ids)}){edges{node{id data{size}}}}}`;
  const res = await fetch(`${gateway}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  const sizes = {};
  for (const edge of body?.data?.transactions?.edges || []) {
    sizes[edge.node.id] = BigInt(edge.node.data.size);
  }
  return sizes;
}

if (process.argv[1]?.endsWith('read.mjs')) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  let ids = argv.filter((a) => !a.startsWith('--'));
  if (flags.has('--golden')) ids = [...GOLDEN.map((g) => g.id), ...MISSES];
  if (ids.length === 0) {
    console.error('usage: read.mjs <data-item-id> [...] [--json] [--cold] [--verify]');
    console.error('       read.mjs --golden');
    process.exit(64);
  }

  const { container, results, stats } = await resolveIds(ids, { cold: flags.has('--cold') });
  const sizes = flags.has('--verify') ? await crossCheck(ids) : {};

  if (flags.has('--json')) {
    console.log(JSON.stringify({
      root: container.root,
      rows: container.rows.toString(),
      sizeBytes: container.size.toString(),
      results: results.map((r) => ({
        ...r,
        start: r.start?.toString() ?? null,
        length: r.length?.toString() ?? null,
      })),
      stats,
    }, null, 2));
  } else {
    console.log(`container ${container.root}`);
    console.log(`  ${(Number(container.size) / 1e9).toFixed(1)} GB, ${container.rows} rows`
      + `, ${container.rowWidth}-byte rows, depth ${container.depth}`);
    console.log(`  prefix ${container.tags.prefix}`);
    console.log('');
    for (const r of results) {
      const answer = r.found ? `start=${r.start} length=${r.length}` : 'not indexed';
      const check = r.found && sizes[r.id] !== undefined
        ? `  payload=${sizes[r.id]} header=${r.length - sizes[r.id]}`
        : '';
      console.log(`${r.id}  ${answer}${check}`);
      console.log(`    ${r.ms} ms  ${r.chunks} chunk${r.chunks === 1 ? '' : 's'} fetched`
        + `, ${r.cached} cached, ${KB(r.wireBytes)} over the wire`);
    }
    console.log('');
    console.log(`total: ${stats.chunks} chunks, ${stats.hits} cache hits`
      + `, ${(stats.wireBytes / 1024 / 1024).toFixed(2)} MB wire`
      + ` — to traverse ${(Number(container.size) / 1e9).toFixed(0)} GB`);
  }

  const wrong = results.filter((r) => {
    const golden = GOLDEN.find((g) => g.id === r.id);
    if (golden) return !r.found || r.start !== golden.start || r.length !== golden.length;
    return MISSES.includes(r.id) ? r.found : false;
  });
  if (wrong.length) {
    console.error(`\nFAIL: ${wrong.length} known vector(s) disagreed`);
    process.exit(1);
  }
}
