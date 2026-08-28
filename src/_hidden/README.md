# Parked features

Neither of these is deleted and neither is broken by choice — both depend on
legacynet processes that no longer answer, so they are out of the build until
they are ported. `tsconfig.json` excludes this directory, so nothing in here is
compiled and nothing in here can break `npm run build`.

## `sprite-customiser/`

The character creator. It writes the finished sprite to Arweave with the Turbo
SDK, then sends `UpdateSprite` to the old PremPass process, which forwarded a
`Reality.UpdateSpriteTxId` to the open-world process. The last two hops are dead.

To bring it back:

1. Add a `Sprite.Update` handler to `backend/native/game.lua` that stores a
   `spriteTxId` on the player. There is nothing to forward to any more, so it is
   a one-line write.
2. Restore `@ardrive/turbo-sdk` to `package.json` for the upload.
3. Rewrite the calls in `SpriteCustomizer.tsx` against `src/lib/game.ts` — the
   old ones go through `aoHelpers.ts`, which is gone.
4. Add the route to `src/main.tsx` and a tab to `src/ui/Shell.tsx`.

The pure-canvas parts (`spriteColorizer`, `colorMapping`, `LayerToImage`, the
preview components) have no network dependency and should still work as-is.

## The open world

Not parked here — it is the `Reality` git submodule, untouched at the repo root.
It talked to the legacynet Reality process `4trQXXADjEPc8yVsGhyfmfv5EpY8dh9gBW3BujzMyB8`
and needs its own port before the `/reality` route is worth restoring. The
Phaser and `@permaweb/aoconnect` dependencies it needs were removed from the
root `package.json`; the submodule has its own.
