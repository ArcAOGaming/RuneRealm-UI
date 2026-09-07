/**
 * Build the game's `catalog` from the sources about to be deployed, put it on
 * Arweave, and return an id only once a gateway has served those exact bytes
 * back.
 *
 *   node backend/native/catalog-ref.mjs            # build, upload, print the id
 *   node backend/native/catalog-ref.mjs --dry-run  # build and print bytes only
 *
 * `deploy.mjs` calls `catalogRef()` before it spawns, and passes the id to
 * `gameModuleSources({ catalogRef })`, which injects it as `C.CATALOG_REF`.
 * The process then publishes 43 bytes where it used to publish ~6.9 KB -- and
 * every `~lua@5.3a` slot pays for the whole published map five times over
 * regardless of what the message did, so those bytes were charged against
 * every action forever.
 *
 * WHY IT IS BUILT BY RUNNING THE MODULE, not by re-deriving the table in JS:
 * the catalog is assembled inside `compute` out of `C.ITEMS`, `C.ACTIVITIES`,
 * `C.HUNT`, `C.ELEMENTS`, `Battle.TUNING`, `C.EFFECTIVENESS` and `C.MOVE_POOLS`.
 * A second implementation here would be a second thing to keep in step, and
 * the failure mode is silent: the client would join move definitions against a
 * catalog the engine does not actually use, which is the class of bug the
 * `tuning` note in `game.lua` exists to prevent. So this runs the real module
 * in ao-loader and publishes whatever the real publication path produced.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import AoLoader from '@permaweb/ao-loader';
import { gameModuleSources } from './game-bundle.mjs';
import { uploadAndVerify, verifyServed } from './arweave-upload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm');
const PROCESS_ID = 'local-catalog-build'.padEnd(43, '_');
const OWNER = 'local-catalog-owner'.padEnd(43, '_');

/**
 * The exact bytes `game.lua` would have published under `catalog`.
 *
 * One `compute` call against an empty base is enough: the catalog block is
 * gated on `result.catalog == nil`, so the first message through any process
 * writes it, and it is built from constants that no message can change.
 */
export async function buildCatalogBytes({ publicAccess = false } = {}) {
  if (!fs.existsSync(WASM)) {
    throw new Error(`ao-loader module missing: ${WASM}\n`
      + 'The Reality submodule supplies it; run `git submodule update --init`.');
  }
  const source = [
    'package.loaded[".json"] = require("json")',
    'Owner = nil',
    gameModuleSources({ publicAccess }),
    // A bare message with no action: dispatch finds no handler, nothing mutates,
    // and the publication block at the end of `compute` still runs. `catalog`
    // is already a JSON string by then -- the block encodes it -- so it comes
    // back out as text and is uploaded verbatim.
    'local st = compute({}, { body = { Tags = {} } }, {})',
    'return st.catalog',
  ].join('\n');

  // AOS.wasm DETERMINISES THE CLOCK, PROCESS-WIDE, AND DOES NOT PUT IT BACK.
  //
  // Booting the emscripten module replaces `process.hrtime` with `() => TIME++`
  // -- a counter, so that a process's own execution is reproducible. That is
  // correct for a runner whose whole job is the VM, and it was harmless while
  // ao-loader only ever ran in test scripts. It is not harmless here: this
  // function is called by `deploy.mjs` BEFORE it signs anything, and
  // `hbclient.mjs` times the signing phases with `process.hrtime.bigint()`,
  // which the shim does not have. The failure is a `TypeError` from inside the
  // signer on a deploy that has already uploaded to Arweave.
  //
  // So the clock is borrowed and given back. Restoring only `hrtime` is
  // deliberate rather than lazy -- it is what the shim actually takes, and a
  // blanket snapshot of `process` would paper over the next thing it takes
  // instead of failing loudly enough to be found.
  const realHrtime = process.hrtime;
  let result;
  try {
    const handle = await AoLoader(fs.readFileSync(WASM), {
      format: 'wasm32-unknown-emscripten',
      computeLimit: 18_000_000_000_000,
      memoryLimit: 512 * 1024 * 1024,
    });
    result = await handle(null, {
      Id: 'eval-catalog-build', Target: PROCESS_ID, Owner: OWNER, From: OWNER,
      Tags: [{ name: 'Action', value: 'Eval' }], Data: source,
      'Block-Height': '1', Timestamp: '1700000000000',
      Module: 'local-aos-module'.padEnd(43, '_'), Cron: false,
    }, {
      Process: { Id: PROCESS_ID, Owner: OWNER, Tags: [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Process' },
      ] },
    });
  } finally {
    process.hrtime = realHrtime;
  }
  if (result.Error) throw new Error(`catalog build failed: ${result.Error}`);

  const data = result.Output?.data;
  const text = typeof data === 'string' ? data : data?.output;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('catalog build produced no output; the publication block did not run');
  }
  // Prove it is the catalog and not an error string or the aos prompt, before
  // anything permanent happens to it.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`catalog build did not return JSON: ${text.slice(0, 200)}`);
  }
  for (const key of ['movePools', 'tuning', 'items', 'elements', 'effectiveness']) {
    if (parsed[key] === undefined) {
      throw new Error(`catalog is missing "${key}"; refusing to publish it`);
    }
  }
  return Buffer.from(text, 'utf8');
}

/**
 * Ids we have already uploaded, keyed by the SHA-256 of the bytes.
 *
 * Content-addressed rather than "did constants.lua change": the catalog is
 * built out of six tables across three files, a redeploy that touches none of
 * them produces the same bytes, and hashing the OUTPUT cannot be fooled by an
 * edit that turns out not to reach the catalog. Committed, because the whole
 * value is that a fresh clone and CI reuse the same ids instead of putting
 * another identical copy on Arweave and waiting five minutes for it.
 */
export const REF_LEDGER = path.join(HERE, 'catalog-refs.json');

const readLedger = () => {
  try {
    return JSON.parse(fs.readFileSync(REF_LEDGER, 'utf8'));
  } catch {
    return {};
  }
};

/**
 * Build, reuse or upload, and do not return an id a gateway will not serve.
 *
 * A recorded id is RE-CHECKED before it is reused. Trusting the ledger blind
 * would swap this module's five-minute window of unreadability for a permanent
 * one, and the symptom is the same either way: a client that quietly has no
 * `tuning`. One HTTP request is a cheap way not to find that out in production.
 */
export async function catalogRef({
  jwk, publicAccess = false, onProgress = () => {}, reuse = true, ...rest
} = {}) {
  const bytes = await buildCatalogBytes({ publicAccess });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  if (reuse) {
    const known = readLedger()[sha256];
    if (known?.id) {
      const check = await verifyServed(known.id, bytes);
      if (check.served) {
        onProgress({ phase: 'reused', id: known.id, gateway: check.gateway, sha256 });
        return {
          ...known, id: known.id, bytes: bytes.length, sha256,
          reused: true, servedBy: check.gateway, availableMs: 0, uploadMs: 0,
        };
      }
      onProgress({ phase: 'stale', id: known.id, sha256 });
    }
  }

  const receipt = await uploadAndVerify({
    jwk,
    bytes,
    tags: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'App-Name', value: 'RuneRealm' },
      // TEST- while the rebuild is unreleased: this is permanent and public,
      // and anything that escapes into a wallet or an explorer during this
      // phase has to say it is not the real thing. See CLAUDE.md.
      { name: 'Name', value: 'TEST-RuneRealm-Catalog' },
      { name: 'Type', value: 'catalog' },
      // Self-describing, so the ledger can be rebuilt from Arweave by tag
      // query if it is ever lost, and so an id can be audited without trusting
      // a local file.
      { name: 'Catalog-SHA256', value: sha256 },
    ],
    onProgress,
    ...rest,
  });

  const ledger = readLedger();
  ledger[sha256] = {
    id: receipt.id,
    bytes: receipt.bytes,
    uploadedAt: new Date().toISOString(),
    servedBy: receipt.servedBy,
    availableMs: receipt.availableMs,
  };
  fs.writeFileSync(REF_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  return { ...receipt, sha256, reused: false };
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')
  || process.argv[1]?.endsWith('catalog-ref.mjs')) {
  const dry = process.argv.includes('--dry-run');
  const bytes = await buildCatalogBytes({ publicAccess: process.argv.includes('--free') });
  console.log(`catalog  ${bytes.length} bytes`);
  if (dry) {
    console.log(bytes.toString('utf8').slice(0, 240) + '...');
    process.exit(0);
  }
  const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const receipt = await catalogRef({
    jwk,
    publicAccess: process.argv.includes('--free'),
    onProgress: (e) => console.log(`  ${e.phase.padEnd(10)} ${JSON.stringify(e)}`),
  });
  console.log(`\ncatalogRef ${receipt.id}`);
  console.log(`  ${receipt.bytes} bytes, ${receipt.winc ?? '0'} winc, `
    + `served by ${receipt.servedBy} after ${receipt.availableMs} ms`);
}

export default catalogRef;
