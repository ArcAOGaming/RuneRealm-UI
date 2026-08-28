import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Bundle the exact game client used by the React app for Node worker threads.
 * The worker supplies an Arweave wallet shim; no game verb is reimplemented.
 */
export async function buildSwarmClient({ root, pid, node, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'client.mjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'lib', 'game.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    // The shipped client now includes an optional browser-local wallet. Its
    // signer imports arbundles only when that provider is selected; swarm
    // workers always inject their own ANS-104 signer instead. Leaving the
    // unreachable dynamic import external keeps Node-only crypto adapters out
    // of this browser-shaped worker bundle.
    external: ['@dha-team/arbundles'],
    define: {
      // wallet.ts intentionally detects `window`. A worker is browser-shaped
      // through installWalletShim(), so point that lookup at the worker global.
      window: 'globalThis',
      'import.meta.env': JSON.stringify({
        VITE_GAME_PROCESS: pid,
        VITE_HB_NODE: node,
      }),
    },
    logLevel: 'warning',
  });
  return { file: outfile, url: pathToFileURL(outfile).href };
}
