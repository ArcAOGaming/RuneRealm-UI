# Rune Realm UI repository rules

- This repository is frontend-only. Do not add Lua contracts, owner wallets,
  process deployers, recovery data, or node administration code.
- Runtime art is vendored under `src/assets`. Update its manifests in the
  authoring workflow before changing checked-in outputs here.
- `npm test` and `npm run build` must pass from a fresh clone without
  submodules or sibling repositories.
- Keep all private values out of browser configuration. Every `VITE_*` value is
  public in the built bundle.
- During the phase-one split, the local AO and venue clients are compatibility
  shims. Do not expand them; new reusable transport work belongs in `rune-ao`,
  and new orderbook work belongs in `rune-orderbook`.
- Make surgical changes and keep walkthrough copy aligned with any flow or
  layout it teaches.
