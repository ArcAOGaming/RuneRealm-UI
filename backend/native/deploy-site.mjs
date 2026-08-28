#!/usr/bin/env node
/**
 * Validate and publish the already-built Vite bundle through an ANT record.
 *
 * The permaweb-deploy CLI expects DEPLOY_KEY to be a base64-encoded JWK. This
 * wrapper validates that contract without printing key material, fingerprints
 * the exact dist/ tree, and saves a machine-readable deployment receipt.
 *
 *   node backend/native/deploy-site.mjs --check
 *   node backend/native/deploy-site.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIST = path.resolve(ROOT, process.env.DEPLOY_FOLDER || 'dist');
const RECEIPT_DIR = path.join(ROOT, '.deploy');
const ANT_PROCESS = (process.env.DEPLOY_ANT_PROCESS || '').trim();
const UNDERNAME = (process.env.DEPLOY_UNDERNAME || 'premium').trim();
const ARNS_NAME = (process.env.DEPLOY_ARNS_NAME || '').trim().toLowerCase();
const checkOnly = process.argv.includes('--check');
const isId = (value) => /^[A-Za-z0-9_-]{43}$/.test(value || '');

if (!isId(ANT_PROCESS)) {
  throw new Error('DEPLOY_ANT_PROCESS must be a 43-character ANT process id');
}
if (!/^(@|[a-z0-9][a-z0-9-]{0,60})$/.test(UNDERNAME)) {
  throw new Error('DEPLOY_UNDERNAME must be @ or a lowercase ArNS undername');
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  throw new Error(`No production bundle at ${path.relative(ROOT, DIST)}; run npm run build first`);
}

function normalizedDeployKey() {
  const configured = (process.env.DEPLOY_KEY || '').trim();
  if (!configured) throw new Error('DEPLOY_KEY is required (base64-encoded Arweave JWK)');
  let jsonText;
  let encoded;
  if (configured.startsWith('{')) {
    // Convenient for the serialized redeploy command, which already has the
    // owner JWK in memory. The underlying CLI still receives its documented
    // base64 format.
    jsonText = configured;
    encoded = Buffer.from(configured, 'utf8').toString('base64');
  } else {
    encoded = configured.replace(/\s+/g, '');
    jsonText = Buffer.from(encoded, 'base64').toString('utf8');
  }
  let jwk;
  try {
    jwk = JSON.parse(jsonText);
  } catch {
    throw new Error('DEPLOY_KEY is not a valid base64-encoded JSON keyfile');
  }
  if (jwk?.kty !== 'RSA' || !jwk.n || !jwk.e || !jwk.d) {
    throw new Error('DEPLOY_KEY is not a private RSA Arweave JWK');
  }
  return encoded;
}

function bundleReceipt() {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`dist contains a symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        rows.push({
          path: path.relative(DIST, absolute).replaceAll('\\', '/'),
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  walk(DIST);
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const digest = crypto.createHash('sha256');
  for (const row of rows) digest.update(`${row.path}\0${row.bytes}\0${row.sha256}\n`);
  return {
    fileCount: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    sha256: digest.digest('hex'),
  };
}

const deployKey = normalizedDeployKey();
const bundle = bundleReceipt();
const publicUrl = ARNS_NAME
  ? `https://${UNDERNAME === '@' ? ARNS_NAME : `${UNDERNAME}_${ARNS_NAME}`}.ar.io/`
  : null;

console.log('Permaweb release configuration is valid:');
console.log(`  bundle     ${bundle.fileCount} files, ${(bundle.totalBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`  fingerprint ${bundle.sha256}`);
console.log(`  ANT        configured (id is not printed)`);
console.log(`  undername  ${UNDERNAME}`);
if (publicUrl) console.log(`  URL        ${publicUrl}`);
if (checkOnly) process.exit(0);

const cli = path.join(ROOT, 'node_modules', 'permaweb-deploy', 'dist', 'index.js');
let output = '';
const child = spawn(process.execPath, [
  cli,
  '--deploy-folder', DIST,
  '--ant-process', ANT_PROCESS,
  '--undername', UNDERNAME,
], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DEPLOY_KEY: deployKey },
});
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (exitCode !== 0) throw new Error(`permaweb-deploy exited ${exitCode}`);

const match = /Deployed TxId \[([A-Za-z0-9_-]{43})\] to ANT \[([A-Za-z0-9_-]{43})\] using undername \[([^\]]+)\]/.exec(output);
if (!match) throw new Error('Deployment completed without a parseable transaction receipt');
const [, transactionId, antProcess, undername] = match;
if (antProcess !== ANT_PROCESS || undername !== UNDERNAME) {
  throw new Error('Deployment receipt does not match the requested ANT record');
}

const receipt = {
  version: 1,
  deployedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  transactionId,
  antProcess,
  undername,
  arnsName: ARNS_NAME || null,
  publicUrl,
  bundle,
};
fs.mkdirSync(RECEIPT_DIR, { recursive: true });
const receiptFile = path.join(RECEIPT_DIR, 'site-deployment-state.json');
fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Deployment receipt saved to ${path.relative(ROOT, receiptFile)}`);
console.log(`Manifest gateway: https://arweave.net/${transactionId}`);
if (publicUrl) console.log(`ArNS gateway:      ${publicUrl}`);
