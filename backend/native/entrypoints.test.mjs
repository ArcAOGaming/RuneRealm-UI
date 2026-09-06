// Every backend entry point must at least LINK.
//
// `swarm.mjs` shipped importing a symbol that no longer existed. Its own suite
// was green the whole time, because that suite imports the modules the runner
// uses and never the runner itself -- so `npm run swarm` died on its first line
// with "does not provide an export named 'publicLiveGraph'" while
// `npm run test:swarm` passed. That is the gap this closes.
//
// It does NOT import them. Most of these files are deploy and soak tools that
// do their work at the top level: importing `swarm.mjs` prints a fifty-wallet
// plan, and importing the fuzzer starts seeding. So the graph is resolved with
// esbuild instead, which reports a missing named export, an unresolvable path
// or a syntax error without evaluating a single line. Verified against the real
// defect: removing `export` from `publicLiveGraph` produces
// `No matching export in "live-config.mjs" for import "publicLiveGraph"`.
//
// `packages: 'external'` keeps node_modules out of it -- this is a check on
// OUR module graph, and it must not fail because an optional dependency is
// unavailable in the environment running the tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function modules(dir, prefix = '') {
  return fs.readdirSync(path.join(HERE, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .filter((entry) => !entry.name.endsWith('.test.mjs'))
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => `${prefix}${entry.name}`);
}

const TARGETS = [
  ...modules('.'),
  ...modules('swarm', 'swarm/'),
].map((rel) => path.join(HERE, rel));

async function linkErrors(entry) {
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      logLevel: 'silent',
    });
    return [];
  } catch (error) {
    return (error.errors ?? [{ text: error.message }]).map((e) => e.text);
  }
}

test('every backend module resolves its imports', async () => {
  assert.ok(TARGETS.length > 20, `expected to find modules, found ${TARGETS.length}`);
  const broken = [];
  for (const entry of TARGETS) {
    const errors = await linkErrors(entry);
    if (errors.length) broken.push(`${path.relative(HERE, entry)}: ${errors[0]}`);
  }
  assert.deepEqual(broken, [], `these modules do not link:\n  ${broken.join('\n  ')}`);
});

test('swarm.mjs links, because it is the one that did not', async () => {
  // Named separately so a regression is unmistakable rather than one line in a
  // list of forty.
  assert.deepEqual(await linkErrors(path.join(HERE, 'swarm.mjs')), []);
});
