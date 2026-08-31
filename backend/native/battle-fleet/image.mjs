/**
 * image.mjs — resolve the Rust worker's `image` id without touching node config.
 *
 * A WASM process definition carries `image: <43 chars>` and `dev_wasm` resolves
 * it through `hb_cache:read` at init, so the bytes must be reachable by that id
 * before the spawn. HyperBEAM's own `dev_wasm:cache_wasm_image/2` does that by
 * reading a file off the NODE's disk and writing it into the node's local
 * cache, which is why the first version of this procedure needed a node
 * operator: `/~cache@1.0/write` is gated on the node's `cache_writers`
 * allow-list and answers 403 to everyone else.
 *
 * An Arweave transaction id is not a substitute, and the reason is subtle
 * enough that it cost a fleet: the node WILL fetch the transaction through
 * `hb_store_gateway`, and it serves the bytes -- but it decodes them into a
 * message whose payload sits under `data`, while `dev_wasm` reads `body`. The
 * spawn then dies at init in `hb_beamr:start(not_found, wasm)`. See
 * `cacheModuleOnNode` below for the measurement and for the route that works.
 *
 * So this file does two separate things:
 *
 *   - publishes the module to Arweave, which is the permanent, independently
 *     verifiable copy of exactly what the fleet runs; and
 *   - caches it on the target NODE as a message with a `body`, which is the id
 *     a process can actually boot from.
 *
 * Both are keyed on the BUILD's sha256 and recorded in `published.json`, so
 * each happens once per distinct binary rather than once per deploy. Change one
 * byte of the worker and both ids change with it, which is the property that
 * makes an image id worth trusting in the first place.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { price, signAndPost } from '../asset.mjs';
import { postSigned, spawnProcess } from '../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUST_DIR = path.resolve(HERE, '..', 'battle-fleet-rust');

export const WASM_PATH = path.join(RUST_DIR, 'dist', 'runerealm-battle-worker.wasm');
export const REGISTRY_PATH = path.join(RUST_DIR, 'published.json');

const IMAGE_ID = /^[A-Za-z0-9_-]{43}$/;

export function wasmDigest(file = WASM_PATH) {
  if (!fs.existsSync(file)) {
    throw new Error(`No canonical WASM at ${file}. Run: npm run build:battle-rust`);
  }
  const bytes = fs.readFileSync(file);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function loadRegistry(file = REGISTRY_PATH) {
  if (!fs.existsSync(file)) return { version: 1, images: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { version: 1, images: {}, ...parsed };
}

function saveRegistry(registry, file = REGISTRY_PATH) {
  // Same-directory atomic rename, matching manifest.mjs: a half-written registry
  // would lose the id of a binary that has already been paid for and published.
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

/**
 * Put the module in the NODE's own cache as a message with a `body` key, and
 * return the id it landed under.
 *
 * An Arweave transaction id does not work here, and the reason is one key name.
 * `dev_wasm:init/3` resolves `image` with `hb_cache:read(Id)` and then reads
 * `body` OF THE RESULT. A message the node pulled from a gateway carries its
 * payload under `data` -- `dev_tx`/`ans104@1.0` decoding puts it there -- so the
 * read succeeds, `body` is `not_found`, and the process dies at init inside
 * `hb_beamr:start(not_found, wasm)` with a bare `function_clause` that names
 * nothing. Measured on hyperbeam.tylerw.ai for our own published module and for
 * the aos module `Do_Uc2Sju...` alike: `/<id>/data` serves the bytes, `/<id>/body`
 * 404s. Publishing to Arweave is still worth doing -- it is the permanent,
 * verifiable copy -- but it cannot be the `image`.
 *
 * `/~cache@1.0/write` is the sanctioned way in and answers 403 to anyone outside
 * the node's `cache_writers`, which is the node's own address and nobody else.
 *
 * What does work, with no privilege at all: schedule the module as a signed
 * message. The scheduler writes the message into the node's main store, and a
 * message posted as `{ body: <bytes> }` is cached with a `body` key -- exactly
 * the shape `dev_wasm` wants. The id is the message's own id, so it is still
 * content-addressed and still changes with the binary.
 *
 * The messages are parked on a dedicated holder process. Nothing ever computes
 * it, so the slots cost only scheduler storage.
 */
export async function cacheModuleOnNode({
  node, jwk, bytes, sha256, registry = loadRegistry(), log = console.log,
}) {
  // Keyed by node, because a process only exists on the scheduler that spawned
  // it. A single global holder id worked right up until the first second node,
  // where scheduling to a process that node has never heard of answers a bare
  // `500` that says nothing about the cause.
  registry.holders = registry.holders || {};
  let holder = registry.holders[node];
  if (!IMAGE_ID.test(holder || '')) {
    holder = await spawnProcess({
      node, jwk, name: 'TEST-RuneRealm Module Cache',
      // No `module`, so the process has no source and is never computed. It
      // exists to give scheduled blobs somewhere to be addressed from.
      'runerealm-purpose': 'battle-fleet module cache',
    });
    registry.holders[node] = holder;
    saveRegistry(registry);
    log(`  spawned module cache process ${holder} on ${node}`);
  }

  const response = await postSigned(node, `/${holder}~process@1.0/schedule`, {
    target: holder,
    type: 'Message',
    subject: 'self',
    action: 'Module.Blob',
    'build-sha256': sha256,
    body: bytes,
  }, jwk);
  if (response.status !== 200) {
    throw new Error(`Caching the module on ${node} failed: ${response.status}`);
  }
  const slot = response.headers.slot;
  if (slot === undefined) throw new Error('The scheduler accepted the module but returned no slot');

  // The scheduler returns a slot, not an id. Walk slot -> assignment -> message:
  // the assignment's `body` link IS the message id, and that is the `image`.
  const readJson = async (suffix) => {
    const result = await fetch(`${node}/${suffix}`, { headers: { accept: 'application/json' } });
    const text = await result.text();
    if (!result.ok || /^<!doctype|^<html/i.test(text.trim())) {
      throw new Error(`${suffix} did not answer with a message: ${result.status}`);
    }
    return JSON.parse(text);
  };
  const schedule = await readJson(`${holder}~process@1.0/schedule?from=${slot}&to=${slot}`);
  const assignments = await readJson(schedule['assignments+link']);
  const assignment = await readJson(assignments[`${slot}+link`]);
  const id = assignment['body+link'];
  if (!IMAGE_ID.test(id || '')) {
    throw new Error(`Assignment ${slot} named no message id: ${JSON.stringify(assignment).slice(0, 300)}`);
  }
  return { id, slot, holder };
}

/** Prove the node serves exactly these bytes as the `body` of that id. */
export async function verifyCachedModule(id, { node, sha256, timeoutMs = 120000 }) {
  const response = await fetch(`${node}/${id}/body`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { ok: false, reason: `status ${response.status}` };
  const served = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash('sha256').update(served).digest('hex');
  if (digest !== sha256) return { ok: false, reason: `sha256 ${digest} != built ${sha256}` };
  return { ok: true, bytes: served.length };
}

/**
 * Prove the NODE can serve exactly these bytes under this id.
 *
 * The gateway having the transaction is not the question; `dev_wasm` reads
 * through the node, so the node is what has to answer. Both halves matter: a
 * 200 that is the Hyperbuddy landing page is HYPERBEAM.md's HTML-at-200 trap,
 * and a 200 of the wrong bytes would spawn four workers running something other
 * than what was audited.
 */
export async function verifyImageOnNode(id, { node, sha256, timeoutMs = 60000 }) {
  const response = await fetch(`${node}/${id}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { ok: false, reason: `status ${response.status}` };
  const type = response.headers.get('content-type') || '';
  if (!type.includes('wasm')) return { ok: false, reason: `content-type ${type || '(none)'}` };
  const served = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash('sha256').update(served).digest('hex');
  if (digest !== sha256) {
    return { ok: false, reason: `sha256 ${digest} != built ${sha256}`, bytes: served.length };
  }
  return { ok: true, bytes: served.length };
}

// Polls the node for an ARWEAVE id, which is no longer on the deploy path: the
// bootable id comes from `cacheModuleOnNode` and is verified by
// `verifyCachedModule`. Kept because confirming a gateway id has propagated is
// still worth doing by hand after an `--archive` publish.
async function waitForNode(id, { node, sha256, attempts = 40, delayMs = 15000, log }) {
  let last = '(no answer)';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await verifyImageOnNode(id, { node, sha256 });
      if (result.ok) return result;
      last = result.reason;
    } catch (error) {
      last = error.message;
    }
    log?.(`  waiting for ${node} to resolve ${id}: ${last}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${node} never served ${id} as the built WASM: ${last}`);
}

/**
 * The `image` id for the current build on this node, doing each permanent step
 * only once.
 *
 * `BATTLE_RUST_IMAGE_ID` still wins when set, because pinning a known-good
 * image is a legitimate deploy choice -- but it is verified to serve the built
 * bytes like any other, so a stale pin fails the deploy instead of silently
 * spawning last week's worker.
 */
export async function resolveRustImageId({
  node, jwk, env = process.env, publish = true, log = console.log,
} = {}) {
  const { bytes, sha256 } = wasmDigest();
  const registry = loadRegistry();
  const record = registry.images[sha256] || {};
  const pinned = String(env.BATTLE_RUST_IMAGE_ID || '').trim();
  if (pinned && !IMAGE_ID.test(pinned)) {
    throw new Error('BATTLE_RUST_IMAGE_ID must be a 43-character id.');
  }

  // The archival copy, and opt-in. No spawn depends on it, it costs real AR per
  // distinct binary, and during an iteration loop that is a charge per rebuild
  // for a copy nothing reads. Ask for it when a build is worth keeping:
  // `BATTLE_RUST_ARCHIVE=1`, or `publish:battle-image -- --post --archive`.
  const archive = /^(1|true|yes)$/i.test(env.BATTLE_RUST_ARCHIVE || '');
  if (!record.id && archive && publish && jwk) {
    log(`publishing worker image to Arweave: ${bytes.length} bytes, ${await price(bytes.length)} winston`);
    const posted = await signAndPost(jwk, {
      data: bytes,
      // Lowercased by the gateway and must not repeat: a duplicate tag name is
      // the same silent poison as the duplicate `action` tag in HYPERBEAM.md.
      tags: {
        'Content-Type': 'application/wasm',
        // TEST- per CLAUDE.md: permanent, public, and the rebuild is unreleased.
        Name: 'TEST-RuneRealm-Battle-Worker',
        Title: 'TEST-RuneRealm-Battle-Worker',
        Description: 'RuneRealm bot-battle worker, rust-wasm@1, JSON-Iface C-string ABI',
        'Battle-Protocol': 'runerealm-battle-fleet/1',
        'Battle-Runtime': 'rust-wasm@1',
        'Battle-ABI': 'hyperbeam-json-iface-cstr/1',
        'Build-Sha256': sha256,
      },
      // Recorded before the post returns, so a crash mid-flight never loses the
      // id of a transaction that has already been paid for.
      onSigned: (txId) => log(`  signed ${txId}`),
    });
    const arweaveId = typeof posted === 'string' ? posted : posted?.id;
    if (!IMAGE_ID.test(arweaveId || '')) throw new Error(`Publishing returned no usable id: ${arweaveId}`);
    record.id = arweaveId;
    record.bytes = bytes.length;
    record.publishedAt = new Date().toISOString();
    registry.images[sha256] = record;
    saveRegistry(registry);
    log(`  published ${arweaveId} and recorded it in published.json`);
  }

  // The bootable id, per node: the cache belongs to the node, so the id does too.
  record.cached = record.cached || {};
  let imageId = pinned || record.cached[node];
  if (imageId) {
    const check = await verifyCachedModule(imageId, { node, sha256 });
    if (!check.ok) {
      if (pinned) throw new Error(`${node} does not serve ${imageId} as this build: ${check.reason}`);
      log(`  cached ${imageId} no longer serves this build (${check.reason}); re-caching`);
      imageId = null;
    }
  }
  if (!imageId) {
    if (!publish) {
      throw new Error(`This build (sha256 ${sha256}) is not cached on ${node}. `
        + 'Run with publishing enabled, or set BATTLE_RUST_IMAGE_ID.');
    }
    if (!jwk) throw new Error('Caching the worker image needs a keyfile to sign with.');
    const cached = await cacheModuleOnNode({ node, jwk, bytes, sha256, registry, log });
    const check = await verifyCachedModule(cached.id, { node, sha256 });
    if (!check.ok) throw new Error(`${node} did not serve the cached module: ${check.reason}`);
    imageId = cached.id;
    record.cached[node] = imageId;
    registry.images[sha256] = record;
    saveRegistry(registry);
    log(`  cached on ${node} as ${imageId} (holder ${cached.holder} slot ${cached.slot})`);
  }
  log(`image ${imageId} verified on ${node} (${bytes.length} bytes, sha256 matches build)`);
  return { imageId, sha256, bytes: bytes.length, arweaveId: record.id };
}

// `pathToFileURL` rather than a `file://${argv[1]}` template: on Windows the
// template loses a slash and the guard never fires, so the CLI would exit 0
// having done nothing and look like it had succeeded (HANDOFF.md S9b).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const node = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
  const keyfile = process.env.HB_WALLET
    || path.resolve(HERE, '..', '..', '..', 'arweave-wallet-DA9qhP25.json');
  const publish = process.argv.includes('--post');
  if (process.argv.includes('--archive')) process.env.BATTLE_RUST_ARCHIVE = '1';
  const { sha256 } = wasmDigest();
  const known = loadRegistry().images[sha256];
  console.log(`build sha256 ${sha256}`);
  console.log(`arweave      ${known?.id || '(this build has never been published)'}`);
  console.log(`cached on    ${known?.cached?.[node] || '(not cached on this node)'}`);
  if (!known?.cached?.[node] && !publish) {
    console.log('\nDry run. Re-run with --post to publish and cache this build.');
    process.exit(0);
  }
  const { imageId } = await resolveRustImageId({
    node,
    jwk: publish && fs.existsSync(keyfile) ? JSON.parse(fs.readFileSync(keyfile, 'utf8')) : null,
    publish,
  });
  console.log(`\nBATTLE_RUST_IMAGE_ID = ${imageId}`);
}
