#!/usr/bin/env node
/**
 * Validate and upload the built Vite bundle to Permaweb, incrementally.
 *
 * This command deliberately does not update an ANT or ArNS record. It uploads
 * whatever is new, writes a Permaweb manifest, writes a deployment receipt, and
 * prints a copyable MANIFEST_ID for an operator to link manually.
 *
 *   node backend/native/deploy-site.mjs --check
 *   node backend/native/deploy-site.mjs
 *   node backend/native/deploy-site.mjs --folder .test-site   # deploy anything
 *   node backend/native/deploy-site.mjs --no-remote-index     # local cache only
 *
 * All of the interesting logic lives in `turbo-incremental.mjs`, which knows
 * nothing about this repo and is written to be upstreamable into the Turbo SDK.
 * This file is the Rune Realm policy around it: which wallet pays, which tags
 * go on, where the receipt lands, and the refusal to spend credits the wallet
 * does not have.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  composeIndex,
  createChainIndex,
  createFileIndex,
  planFolderUpload,
  quoteUpload,
  uploadFolderIncremental,
} from './turbo-incremental.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RECEIPT_DIR = path.join(ROOT, '.deploy');

const APP_NAME = 'Rune-Realm-Permaweb';
const GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net';

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const checkOnly = argv.includes('--check');
const noRemoteIndex = argv.includes('--no-remote-index');

const folderName = flagValue('--folder') || process.env.DEPLOY_FOLDER || 'dist';
const DIST = path.resolve(ROOT, folderName);
// A test deploy must not poison the production index or overwrite the receipt
// that records what is actually live.
const slug = folderName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'dist';
const isProductionFolder = slug === 'dist';
const INDEX_FILE = path.join(RECEIPT_DIR, isProductionFolder ? 'site-index.json' : `site-index.${slug}.json`);
const RECEIPT_FILE = path.join(RECEIPT_DIR, isProductionFolder ? 'site-deployment-state.json' : `site-deployment-state.${slug}.json`);

const isId = (value) => /^[A-Za-z0-9_-]{43}$/.test(value || '');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  throw new Error(`No bundle at ${path.relative(ROOT, DIST)}; run npm run build first`);
}

// Wallet ---------------------------------------------------------------------

function normalizedDeployKey() {
  const configured = (process.env.DEPLOY_KEY || '').trim();
  if (!configured) throw new Error('DEPLOY_KEY is required (base64-encoded Arweave JWK)');

  let jsonText;
  if (configured.startsWith('{')) {
    // The all-in-one redeploy command already has the owner JWK in memory.
    jsonText = configured;
  } else {
    jsonText = Buffer.from(configured.replace(/\s+/g, ''), 'base64').toString('utf8');
  }

  let jwk;
  try {
    jwk = JSON.parse(jsonText);
  } catch {
    throw new Error('DEPLOY_KEY is not a valid base64-encoded JSON keyfile');
  }
  const privateFields = ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'];
  if (jwk?.kty !== 'RSA' || privateFields.some((field) => !jwk[field])) {
    throw new Error('DEPLOY_KEY is not a private RSA Arweave JWK');
  }
  return jwk;
}

/** The address Turbo credits are billed against; the one an operator tops up. */
const addressOf = (jwk) =>
  crypto.createHash('sha256').update(Buffer.from(jwk.n, 'base64url')).digest('base64url');

// Reporting ------------------------------------------------------------------

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const ar = (winc) => (Number(winc) / 1e12).toFixed(6);

function writeGitHubHandoff(manifestId, gatewayUrl, summaryLines) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) fs.appendFileSync(outputFile, `manifest_id=${manifestId}\n`);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, [
      '## Permaweb upload complete',
      '',
      `- Manifest ID: \`${manifestId}\``,
      `- Gateway: ${gatewayUrl}`,
      ...summaryLines.map((line) => `- ${line}`),
      '- ArNS was not changed. Link the manifest manually after verification.',
      '',
    ].join('\n'));
  }
}

// ---------------------------------------------------------------------------

const deployKey = normalizedDeployKey();
const payer = addressOf(deployKey);

const { TurboFactory } = await import('@ardrive/turbo-sdk');
const turbo = TurboFactory.authenticated({ privateKey: deployKey });

const warn = (message) => console.warn(`  warning: ${message}`);
const index = composeIndex([
  createFileIndex(INDEX_FILE, { onWarning: warn }),
  noRemoteIndex ? null : createChainIndex({ owner: payer, appName: APP_NAME, gatewayUrl: GATEWAY }),
], { onWarning: warn });

console.log('Permaweb upload configuration is valid:');
console.log(`  folder      ${path.relative(ROOT, DIST)}${isProductionFolder ? '' : '  (test deploy)'}`);
console.log(`  payer       ${payer}`);
console.log('  mode        incremental upload only (ArNS will not be changed)');

const plan = await planFolderUpload({ folderPath: DIST, index });
console.log(`  bundle      ${plan.bundle.fileCount} files, ${mib(plan.bundle.totalBytes)}`);
console.log(`  fingerprint ${plan.bundle.fingerprint}`);
console.log(`  reusing     ${plan.reusedFiles} files already on Arweave (${mib(plan.reusedBytes)})`);
console.log(`  uploading   ${plan.pending.length} files (${mib(plan.pendingBytes)})`);

// Preflight ------------------------------------------------------------------
//
// The old --check validated the keyfile and hashed the bundle but never asked
// Turbo anything, so CI could pass every test, spend twenty minutes building,
// and then die part-way through the upload with files orphaned and no manifest.
// That is exactly what happened on 2026-08-30. Ask first.

const quotedWinc = await quoteUpload({ turbo, pending: plan.pending });
const balance = await turbo.getBalance();
const availableWinc = BigInt(balance.winc ?? '0');

console.log(`  quote       ${quotedWinc} winc (~${ar(quotedWinc)} AR of credit)`);
console.log(`  credits     ${availableWinc} winc (~${ar(availableWinc)} AR of credit)`);

if (quotedWinc > availableWinc) {
  const short = quotedWinc - availableWinc;
  throw new Error(
    `Insufficient Turbo credits: need ${quotedWinc} winc, have ${availableWinc}, short ${short} `
    + `(~${ar(short)} AR). Top up ${payer} at https://turbo.ar.io, or convert AR held by that `
    + 'wallet with turbo.topUpWithTokens().',
  );
}

if (checkOnly) {
  console.log('');
  console.log('Preflight OK — the wallet can pay for this deploy.');
  process.exit(0);
}

// Upload ---------------------------------------------------------------------

const gitCommit = process.env.GITHUB_SHA || null;

const result = await uploadFolderIncremental({
  turbo,
  folderPath: DIST,
  index,
  signal: AbortSignal.timeout(20 * 60 * 1000),
  manifestOptions: {
    indexFile: 'index.html',
    // Route unknown paths back into the Vite SPA.
    fallbackFile: 'index.html',
  },
  // Per-file tags must be identical for identical bytes or every id moves and
  // the next deploy pays for the whole bundle again. Git-Commit goes on the
  // manifest instead, which is rewritten every deploy regardless.
  dataItemOpts: { tags: [{ name: 'App-Name', value: APP_NAME }] },
  manifestDataItemOpts: {
    tags: [
      { name: 'App-Name', value: APP_NAME },
      { name: 'Bundle-SHA256', value: plan.bundle.fingerprint },
      ...(gitCommit ? [{ name: 'Git-Commit', value: gitCommit }] : []),
    ],
  },
  onProgress: (event) => {
    if (event.phase === 'uploaded') {
      console.log(`  [${event.position}/${event.total}] ${event.id}  ${event.file}`);
    } else if (event.phase === 'manifest') {
      console.log(`Uploading manifest (${event.pathCount} paths, ${event.bytes} bytes)...`);
    }
  },
});

const manifestId = result.manifestResponse?.id;
if (!isId(manifestId)) throw new Error('Upload completed without a valid 43-character manifest id');

// Receipt --------------------------------------------------------------------

const gatewayUrl = `${GATEWAY}/${manifestId}/`;
const receipt = {
  version: 3,
  mode: 'incremental-upload-only',
  deployedAt: new Date().toISOString(),
  commit: gitCommit,
  payer,
  folder: path.relative(ROOT, DIST).replaceAll('\\', '/'),
  manifestId,
  // Compatibility with tooling that read the v1 receipt field.
  transactionId: manifestId,
  gatewayUrl,
  arnsUpdated: false,
  bundle: {
    fileCount: result.plan.fileCount,
    totalBytes: result.plan.totalBytes,
    sha256: result.plan.fingerprint,
  },
  uploadedFiles: result.plan.uploadedFiles,
  uploadedBytes: result.plan.uploadedBytes,
  reusedFiles: result.plan.reusedFiles,
  reusedBytes: result.plan.reusedBytes,
  wincSpent: result.plan.spentWinc,
};
fs.mkdirSync(RECEIPT_DIR, { recursive: true });
fs.writeFileSync(RECEIPT_FILE, `${JSON.stringify(receipt, null, 2)}\n`);

if (isProductionFolder) {
  writeGitHubHandoff(manifestId, gatewayUrl, [
    `Uploaded ${result.plan.uploadedFiles} files (${mib(result.plan.uploadedBytes)}); reused ${result.plan.reusedFiles}`,
    `Spent ${result.plan.spentWinc} winc`,
  ]);
}

console.log('');
console.log('=== PERMAWEB UPLOAD COMPLETE ===');
console.log(`MANIFEST_ID=${manifestId}`);
console.log(`GATEWAY_URL=${gatewayUrl}`);
console.log(`UPLOADED=${result.plan.uploadedFiles} REUSED=${result.plan.reusedFiles}`);
console.log(`SPENT_WINC=${result.plan.spentWinc}`);
console.log('ARNS_UPDATE=manual');
console.log(`RECEIPT=${path.relative(ROOT, RECEIPT_FILE)}`);
