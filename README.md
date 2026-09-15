# Rune Realm UI

The standalone browser frontend for Rune Realm.

```bash
npm ci
npm test
npm run build
npm run dev
```

The runtime artwork used by Vite is checked in under `src/assets`. The build
does not need the private authoring repository: `npm run check:assets` verifies
the frozen card SHA-256 manifest and the curated scene, companion, effect, and
Monster Index files that are loaded through dynamic globs.

## Phase-one boundary

This repository owns the React, Phaser, WebGL, PWA, and browser-facing game
experience. It deliberately contains no Lua contracts, process deployers,
recovery snapshots, or load harnesses.

The first split freezes two temporary compatibility seams:

- `src/lib/hyperbeam.ts`, `wallet.ts`, and `slot-settle.mjs` remain here until
  the unreleased `rune-ao` package has a product-neutral API.
- `src/lib/venue.ts` and the market screen remain here until
  `rune-orderbook` exports the complete trading floor rather than its initial
  read-only overview.

Those files are not the long-term canonical copies. The super-repository pins
the extraction candidates and will switch this app only after parity tests pass.
Deployment also remains orchestrated by the super-repository during this phase.

Configuration is browser-only and uses the `VITE_*` variables documented in
`.env.example`. Never put a private key in a `VITE_*` variable.
