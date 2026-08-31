/**
 * Incremental folder uploads for Turbo.
 *
 * `turbo.uploadFolder` re-signs and re-pays for every file on every run. For a
 * site that is redeployed often this is pure waste: an Arweave upload is
 * permanent, so paying twice for identical bytes buys nothing. Most build tools
 * content-hash their output, so between two deploys of a real app the only
 * things that actually change are a couple of entry chunks and the manifest.
 *
 * This module uploads by CONTENT instead of by path:
 *
 *   1. hash every file in the folder
 *   2. ask an index which of those already have an Arweave id
 *   3. upload only the rest, recording each id as it lands
 *   4. build the path manifest from remembered ids plus new ones
 *
 * It has no dependencies beyond Node builtins and the `turbo` client handed to
 * it, so it is a drop-in for anywhere `uploadFolder` is used today.
 *
 * ---------------------------------------------------------------------------
 * THE KEY IS THE HASH *AND* THE CONTENT TYPE
 *
 * The obvious key is `sha256(bytes)`, and it is wrong. A data item also carries
 * a `Content-Type` tag, and that is derived from the FILENAME, not the bytes.
 * Key on the hash alone and two byte-identical files with different extensions
 * collapse into one upload, whose content type is whichever file was hashed
 * first. An empty `a.css` and an empty `b.js` become a single `text/css` item,
 * the manifest points both paths at it, and the browser refuses to execute
 * `/b.js` under strict MIME checking. Empty and duplicated files are ordinary
 * in build output, so this is not a corner case; it is a broken deploy with no
 * error anywhere. The index is therefore keyed on both, so those are two
 * entries and each file gets its own correctly tagged item.
 *
 * ---------------------------------------------------------------------------
 * WHAT TAGS DO AND DO NOT DO
 *
 * An earlier version of this file claimed a per-file tag that varies between
 * deploys would "defeat deduplication and double the bill". That is false, and
 * worth recording so nobody re-derives it: reuse is keyed on the content, not
 * on the data item id, so a changed tag changes the id of an upload that never
 * happens. Nothing is re-uploaded and nothing doubles.
 *
 * The real consequence is quieter. A REUSED item is the one uploaded the first
 * time, so it still carries the first deploy's tag values forever. Tag files
 * with `Git-Commit` and after ten deploys every unchanged file still names the
 * first commit. That is stale metadata rather than a broken site, and the fix
 * is to put deploy-varying tags on the manifest — which is rewritten every
 * deploy anyway, and is usually small enough to ride the free tier. Hence
 * `manifestDataItemOpts`. It is a convention, not something to throw over.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE INDEX LIVES
 *
 * An index is anything with `get`/`set`. Three are provided:
 *
 *   createMemoryIndex()  - a Map; dedupes within one run and nothing more
 *   createFileIndex()    - a JSON file; the fast path for a developer machine
 *   createChainIndex()   - a GraphQL sweep over the uploader's own past items,
 *                          which is the only one that survives a fresh CI
 *                          checkout, and the reason every file is tagged with
 *                          its own hash on the way up
 *
 * `composeIndex([...])` layers them: reads fall through in order, writes go to
 * every layer that accepts them. An index is a CACHE, so every read is
 * best-effort — a layer that throws is treated as a miss and the file is
 * uploaded, because a gateway having a bad minute must not fail a deploy.
 *
 * Chain indexing lags an upload by minutes, so two machines deploying the same
 * new file at the same moment can each pay for it. That is the accepted failure
 * mode; it costs a fraction of a cent and never produces a wrong manifest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Tag carrying a file's content hash, and the key the chain index reads. */
export const FILE_HASH_TAG = 'File-SHA256';
export const MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json';

const ID = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const isArweaveId = (value) => ID.test(value || '');
export const isContentHash = (value) => SHA256.test(value || '');

const CONTENT_TYPES = {
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.xml': 'application/xml',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

/** Best-effort content type from a file extension. Override via `contentTypeFor`. */
export function defaultContentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * The index key. Both halves matter, and the second half is why.
 *
 * Keying on the hash alone lets one stored id answer for two files whose bytes
 * match but whose content types differ, and the map physically cannot hold both
 * — the second file overwrites the first and then finds no entry of its own. A
 * content type is part of the identity of an uploaded item, so it is part of
 * the key. `|` cannot occur in a media type, so it is a safe separator.
 */
export const entryKey = (sha256, contentType) => `${sha256}|${contentType}`;

const KEY = /^[0-9a-f]{64}\|[^|]+$/;
export const isEntryKey = (value) => KEY.test(value || '');

// Hashing --------------------------------------------------------------------

/**
 * Every file under `folderPath`, hashed, sorted by relative path.
 *
 * `fingerprint` identifies the tree as a whole: two builds with the same
 * fingerprint are the same deployment, whatever their timestamps say.
 */
export function hashFolder(folderPath, { contentTypeFor = defaultContentTypeFor } = {}) {
  const root = path.resolve(folderPath);
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      // A symlink would be followed into content outside the folder and
      // published permanently, so refuse rather than guess at the intent.
      if (entry.isSymbolicLink()) throw new Error(`folder contains a symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: path.relative(root, absolute).split(path.sep).join('/'),
          absolute,
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          contentType: contentTypeFor(absolute),
        });
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const digest = crypto.createHash('sha256');
  for (const file of files) digest.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);

  return {
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    fingerprint: digest.digest('hex'),
  };
}

// Indexes --------------------------------------------------------------------

/** Dedupes identical files within a single run. The floor every layer sits on. */
export function createMemoryIndex(seed = {}) {
  const map = new Map(
    Object.entries(seed).filter(([key, id]) => isEntryKey(key) && isArweaveId(id)),
  );
  return {
    name: 'memory',
    writable: true,
    get: (key) => map.get(key),
    set: (key, id) => { map.set(key, id); },
    entries: () => Object.fromEntries(map),
  };
}

/**
 * A JSON file of hash -> { id, contentType }.
 *
 * Written after every upload rather than at the end of the run, because an
 * upload that is paid for but forgotten is money burnt and a deploy killed
 * part-way through is the normal case. That only holds if the write is atomic:
 * a torn `writeFileSync` leaves JSON that will not parse, and the recovery path
 * below throws the WHOLE index away. So write a temp file and rename it, which
 * is atomic on every platform this runs on.
 */
export function createFileIndex(filePath, { onWarning = () => {} } = {}) {
  const file = path.resolve(filePath);
  let map = new Map();

  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      // v1 files were keyed on the bare hash and carried no content type, so
      // they cannot be trusted to answer for a given file any more. Dropping
      // them costs one chain sweep, which recovers the same ids correctly.
      for (const [key, id] of Object.entries(parsed?.files ?? {})) {
        if (isEntryKey(key) && isArweaveId(id)) map.set(key, id);
      }
    } catch {
      onWarning(`${file} is unreadable; rebuilding the index`);
      map = new Map();
    }
  }

  let sequence = 0;
  let deferred = 0;
  let dirty = false;

  const flush = () => {
    if (deferred > 0) { dirty = true; return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sorted = Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
    // A unique temp name per write. Windows fails the rename with EPERM when
    // the same temp path is recreated and renamed in quick succession — the
    // previous handle has not been released yet — and a bulk recovery does
    // exactly that, once per recovered file.
    const temp = `${file}.${process.pid}.${sequence++}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ version: 2, files: sorted }, null, 2)}\n`);
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    dirty = false;
  };

  return {
    name: `file:${path.basename(file)}`,
    writable: true,
    get: (key) => map.get(key),
    set: (key, id) => { map.set(key, id); flush(); },
    /**
     * Collapse a burst of writes into one.
     *
     * Rewriting the whole file per entry is the right trade for an upload —
     * bytes that are paid for must not be forgotten — but wrong for a bulk
     * recovery, where every entry is re-derivable from the chain and the cost
     * is N full rewrites of a file that grows with the site.
     */
    batch(work) {
      deferred += 1;
      try {
        return work();
      } finally {
        deferred -= 1;
        if (deferred === 0 && dirty) flush();
      }
    },
    entries: () => Object.fromEntries(map),
  };
}

/**
 * Rebuilds the index by sweeping the uploader's own past items over GraphQL.
 *
 * Read-only, and resolved in bulk: `resolve` is called once with every hash the
 * run still needs, filtering server-side on the hash tag so a long deployment
 * history costs nothing. Requires that past uploads were tagged with
 * `FILE_HASH_TAG`, which this module always does.
 *
 * The `Content-Type` tag is read back and stored alongside the id, so a hit on
 * bytes that were first uploaded under a different extension is correctly
 * rejected by the caller rather than silently mis-typing a file.
 */
export function createChainIndex({
  owner,
  appName,
  gatewayUrl = 'https://arweave.net',
  hashTag = FILE_HASH_TAG,
  maxPages = 20,
  pageSize = 100,
  fetchImpl = fetch,
  timeoutMs = 30_000,
} = {}) {
  if (!isArweaveId(owner)) throw new Error('createChainIndex requires an owner address');
  const map = new Map();
  const first = Number(pageSize);
  if (!Number.isInteger(first) || first < 1 || first > 100) {
    throw new Error(`pageSize must be an integer between 1 and 100, got ${pageSize}`);
  }

  const tagFilter = appName
    ? `tags:[{name:"App-Name",values:[${JSON.stringify(appName)}]},`
      + `{name:${JSON.stringify(hashTag)},values:$hashes}]`
    : `tags:[{name:${JSON.stringify(hashTag)},values:$hashes}]`;

  async function resolve(keys) {
    const wanted = new Set([...keys].filter(isEntryKey));
    if (wanted.size === 0) return {};
    const found = {};
    let cursor = null;

    // Query by hash, because that is the tag the items actually carry, then
    // pair each answer with the content type it was uploaded under to rebuild
    // the full key. Bytes uploaded under one extension therefore never answer
    // for the same bytes under another.
    const values = [...new Set([...wanted].map((key) => key.split('|')[0]))];
    for (let page = 0; page < maxPages && Object.keys(found).length < wanted.size; page += 1) {
      const query = `query($owner:String!,$hashes:[String!]!,$after:String){
        transactions(owners:[$owner] ${tagFilter} sort:HEIGHT_DESC first:${first} after:$after){
          pageInfo{hasNextPage}
          edges{cursor node{id owner{address} tags{name value}}}
        }
      }`;
      const response = await fetchImpl(`${gatewayUrl}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { owner, hashes: values, after: cursor } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`GraphQL ${response.status} from ${gatewayUrl}`);
      const body = await response.json();
      const result = body?.data?.transactions;
      if (!result) throw new Error(`GraphQL returned no transactions: ${JSON.stringify(body?.errors ?? body)}`);

      // A gateway is not a trusted party. It applies the owner filter itself,
      // so verify the answer rather than believing it: an id from someone
      // else's wallet would otherwise land in a permanent manifest and be
      // cached locally forever. Everything else here is shape-defensiveness —
      // a degraded node returning a partial payload must not throw a TypeError
      // out of what is only a cache lookup.
      const edges = Array.isArray(result.edges) ? result.edges : [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node || !isArweaveId(node.id)) continue;
        if (edge.cursor) cursor = edge.cursor;
        if (node.owner?.address && node.owner.address !== owner) continue;
        const tags = Array.isArray(node.tags) ? node.tags : [];
        const hash = tags.find((tag) => tag?.name === hashTag)?.value;
        const contentType = tags.find((tag) => tag?.name === 'Content-Type')?.value ?? null;
        // Newest first, and any upload of these exact bytes is equally valid,
        // so the first sighting wins and there is nothing to reconcile.
        if (!isContentHash(hash) || !contentType) continue;
        const key = entryKey(hash, contentType);
        if (wanted.has(key) && !found[key]) {
          found[key] = node.id;
          map.set(key, node.id);
        }
      }
      // Without at least one usable cursor the next request would be identical
      // to this one, so stop instead of re-issuing it until maxPages runs out.
      if (!result.pageInfo?.hasNextPage || edges.length === 0 || !cursor) break;
    }
    return found;
  }

  return {
    name: `chain:${gatewayUrl}`,
    writable: false,
    get: (key) => map.get(key),
    set: () => {},
    resolve,
    entries: () => Object.fromEntries(map),
  };
}

/**
 * Layers indexes: reads fall through in order, writes go to every writable one.
 *
 * Every read is best-effort. An index is a cache, so a layer that throws — a
 * gateway 503, an unreadable file — must be indistinguishable from a miss, and
 * cost one re-upload rather than the whole deploy.
 */
export function composeIndex(layers, { onWarning = () => {} } = {}) {
  const list = layers.filter(Boolean);
  if (list.length === 0) return createMemoryIndex();
  return {
    name: `composed(${list.map((layer) => layer.name).join(', ')})`,
    writable: list.some((layer) => layer.writable),
    get(key) {
      for (const layer of list) {
        try {
          const id = layer.get(key);
          if (isArweaveId(id)) return id;
        } catch (error) {
          onWarning(`index layer ${layer.name} failed to read: ${error.message}`);
        }
      }
      return undefined;
    },
    set(key, id) {
      for (const layer of list) {
        if (!layer.writable) continue;
        try {
          layer.set(key, id);
        } catch (error) {
          onWarning(`index layer ${layer.name} failed to record ${id}: ${error.message}`);
        }
      }
    },
    async resolve(keys) {
      const found = {};
      const remaining = new Set(keys);
      for (const layer of list) {
        if (remaining.size === 0) break;
        if (typeof layer.resolve !== 'function') continue;
        let batch;
        try {
          batch = await layer.resolve(remaining);
        } catch (error) {
          onWarning(`index layer ${layer.name} failed to resolve: ${error.message}`);
          continue;
        }
        for (const [key, id] of Object.entries(batch ?? {})) {
          if (!isArweaveId(id)) continue;
          found[key] = id;
          remaining.delete(key);
        }
      }
      // An entry recovered from a read-only layer is worth caching in the
      // writable ones, so the next run skips the network entirely. This is a
      // burst — one write per recovered file — so let a layer that can batch
      // collapse it into a single flush.
      const writeAll = () => {
        for (const [key, id] of Object.entries(found)) this.set(key, id);
      };
      const batcher = list.find((layer) => layer.writable && typeof layer.batch === 'function');
      if (batcher) batcher.batch(writeAll);
      else writeAll();
      return found;
    },
    entries: () => Object.assign({}, ...[...list].reverse().map((layer) => layer.entries?.() ?? {})),
  };
}

// Planning -------------------------------------------------------------------

/**
 * What a run would do, without doing it.
 *
 * Separated out so a caller can quote the cost, check a balance and refuse
 * before a single byte is signed — the difference between a deploy that fails
 * in the first second and one that fails half way through with files orphaned
 * and no manifest.
 */
export async function planFolderUpload({ folderPath, index, contentTypeFor, resolve = true }) {
  const bundle = hashFolder(folderPath, contentTypeFor ? { contentTypeFor } : {});
  const store = index ?? createMemoryIndex();

  if (resolve && typeof store.resolve === 'function') {
    const unknown = new Set(
      bundle.files
        .map((file) => entryKey(file.sha256, file.contentType))
        .filter((key) => !isArweaveId(store.get(key))),
    );
    if (unknown.size > 0) await store.resolve(unknown);
  }

  // Two files with identical bytes share one upload only when they also share a
  // content type; otherwise each needs its own item, correctly tagged.
  const pending = [];
  const claimed = new Set();
  let reusedFiles = 0;
  let reusedBytes = 0;

  for (const file of bundle.files) {
    const key = entryKey(file.sha256, file.contentType);
    if (isArweaveId(store.get(key)) || claimed.has(key)) {
      reusedFiles += 1;
      reusedBytes += file.bytes;
      continue;
    }
    claimed.add(key);
    pending.push(file);
  }

  return {
    bundle,
    index: store,
    pending,
    pendingBytes: pending.reduce((sum, file) => sum + file.bytes, 0),
    reusedFiles,
    reusedBytes,
  };
}

/** Total winc Turbo would charge for the pending files. Free-tier items quote 0. */
export async function quoteUpload({ turbo, pending }) {
  if (pending.length === 0) return 0n;
  const costs = await turbo.getUploadCosts({ bytes: pending.map((file) => file.bytes) });
  return costs.reduce((sum, cost) => sum + BigInt(cost.winc ?? '0'), 0n);
}

// Uploading ------------------------------------------------------------------

/**
 * Upload a folder, skipping anything already on Arweave.
 *
 * Mirrors `turbo.uploadFolder`'s shape — same `manifestOptions`, same
 * `dataItemOpts`, same response fields — plus `index`, `manifestDataItemOpts`
 * and a `plan` describing what was reused.
 */
export async function uploadFolderIncremental({
  turbo,
  folderPath,
  index,
  manifestOptions = {},
  dataItemOpts = {},
  manifestDataItemOpts = {},
  contentTypeFor,
  maxConcurrentUploads = 5,
  signal,
  throwOnFailure = true,
  onProgress = () => {},
}) {
  if (!turbo) throw new Error('uploadFolderIncremental requires an authenticated turbo client');

  const {
    indexFile = 'index.html',
    fallbackFile,
    disableManifest = false,
  } = manifestOptions;

  const plan = await planFolderUpload({ folderPath, index, contentTypeFor });
  const store = plan.index;
  onProgress({ phase: 'planned', ...summarize(plan) });

  const fileResponses = [];
  const errors = [];
  const queue = plan.pending.map((file, position) => ({ file, position: position + 1 }));
  const total = queue.length;

  const uploadOne = async ({ file, position }) => {
    const response = await turbo.uploadFile({
      file: file.absolute,
      signal,
      dataItemOpts: {
        ...dataItemOpts,
        tags: [
          ...(dataItemOpts.tags ?? []).filter(
            (tag) => tag.name !== 'Content-Type' && tag.name !== FILE_HASH_TAG,
          ),
          { name: 'Content-Type', value: file.contentType },
          { name: FILE_HASH_TAG, value: file.sha256 },
        ],
      },
    });
    if (!isArweaveId(response?.id)) throw new Error(`${file.path}: upload returned no valid id`);
    // Recorded only after the bytes have landed, and before anything else can
    // fail, so a killed run never loses a file it has already paid for and
    // never records one it has not.
    store.set(entryKey(file.sha256, file.contentType), response.id);
    fileResponses.push(response);
    onProgress({ phase: 'uploaded', file: file.path, id: response.id, position, total });
    return response;
  };

  const workers = Array.from({ length: Math.max(1, Math.min(maxConcurrentUploads, total)) },
    async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          await uploadOne(job);
        } catch (error) {
          if (throwOnFailure) throw error;
          errors.push(error);
          onProgress({ phase: 'failed', file: job.file.path, error });
        }
      }
    });
  await Promise.all(workers);

  if (disableManifest) {
    return { fileResponses, errors, plan: summarize(plan), index: store };
  }

  const paths = {};
  const missing = [];
  for (const file of plan.bundle.files) {
    const id = store.get(entryKey(file.sha256, file.contentType));
    if (isArweaveId(id)) paths[file.path] = { id };
    else missing.push(file.path);
  }
  if (missing.length > 0) {
    // A manifest with holes in it is worse than no manifest: it publishes a
    // site that 404s on exactly the files this run failed to upload.
    throw new Error(`cannot build manifest, ${missing.length} file(s) have no id: ${missing.slice(0, 5).join(', ')}`);
  }

  const fallbackId = paths[fallbackFile ?? indexFile]?.id;
  const manifest = {
    manifest: 'arweave/paths',
    version: '0.2.0',
    ...(paths[indexFile] ? { index: { path: indexFile } } : {}),
    ...(fallbackId ? { fallback: { id: fallbackId } } : {}),
    paths,
  };

  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  onProgress({ phase: 'manifest', pathCount: Object.keys(paths).length, bytes: body.length });

  const manifestResponse = await turbo.uploadFile({
    fileStreamFactory: () => body,
    fileSizeFactory: () => body.length,
    signal,
    dataItemOpts: {
      ...manifestDataItemOpts,
      tags: [
        ...(manifestDataItemOpts.tags ?? []).filter((tag) => tag.name !== 'Content-Type'),
        { name: 'Content-Type', value: MANIFEST_CONTENT_TYPE },
      ],
    },
  });
  if (!isArweaveId(manifestResponse?.id)) {
    throw new Error('manifest upload returned no valid id');
  }

  const spentWinc = [...fileResponses, manifestResponse]
    .reduce((sum, response) => sum + BigInt(response.winc ?? '0'), 0n);

  return {
    fileResponses,
    manifestResponse,
    manifest,
    errors,
    index: store,
    plan: { ...summarize(plan), spentWinc: spentWinc.toString() },
  };
}

function summarize(plan) {
  return {
    fingerprint: plan.bundle.fingerprint,
    fileCount: plan.bundle.fileCount,
    totalBytes: plan.bundle.totalBytes,
    uploadedFiles: plan.pending.length,
    uploadedBytes: plan.pendingBytes,
    reusedFiles: plan.reusedFiles,
    reusedBytes: plan.reusedBytes,
  };
}
