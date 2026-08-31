import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { studioPlugin } from './tools/studio-plugin';

/**
 * Node polyfills, scoped to what actually needs them.
 *
 * The game itself needs none: the HyperBEAM transport is `fetch` and the wallet
 * extension, and this config used to say so with all polyfills removed.
 *
 * The character creator brought them back. It uploads through
 * `@ardrive/turbo-sdk`, which pulls in `arbundles`, which calls Node's
 * `crypto.createHash` — without a polyfill the build fails outright on
 * `"createHash" is not exported by "__vite-browser-external"`.
 *
 * So this is deliberately narrow rather than `protocolImports: true` and the
 * whole Node surface: three modules plus the tiny `process` global expected by
 * arbundles' transitive readable-stream package, because a polyfill stack is a thing
 * that quietly grows and each one is code shipped to every visitor.
 */
export default defineConfig(({ mode }) => {
  // Empty prefix is intentional here: this runs in Node, and the local studio
  // needs the two private generation keys. They are passed only to a dev-server
  // plugin; Vite still exposes only VITE_* variables to browser code.
  const local = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      studioPlugin(process.cwd(), {
        PIXELLAB_API_KEY: local.PIXELLAB_API_KEY,
        RETRO_DIFFUSION_API_KEY: local.RETRO_DIFFUSION_API_KEY,
      }),
      nodePolyfills({
        include: ['crypto', 'buffer', 'stream'],
        globals: { Buffer: true, global: true, process: true },
      }),
    ],
    base: '/',
    // Sourcemaps are 34 MB of a 50 MB bundle, and a Permaweb deploy writes the
    // bundle to Arweave permanently: shipping them means publishing unminified
    // source forever and paying four times over for the privilege, on every
    // deploy. Opt in with BUILD_SOURCEMAP=true when debugging a built bundle.
    build: { target: 'es2022', sourcemap: local.BUILD_SOURCEMAP === 'true' },
  };
});
