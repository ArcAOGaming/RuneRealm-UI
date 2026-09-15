# Runtime assets

This directory contains only files the shipped application loads. Authoring
sources, generated experiments, rejected work, and candidates belong in the
`RuneRealm-Assets` repository instead.

| Directory | Runtime responsibility |
|---|---|
| `cards/` | Frozen approved shells, seals, move icons and plates used by both card painters |
| `character/` | Player-character base, map, and composited clothing layers |
| `companions/legacy-sprites/` | Transaction-id sheets kept for old player records |
| `effects/battle/` | Normalized attack and healing strips |
| `items/` | Inventory and reward art |
| `monster-index/` | Generated numbered portraits and atlases |
| `scenes/` | Accepted Home, Arena, and Quest scenery |

`npm run scene-assets:sync` copies accepted scenery from
`RuneRealm-Assets/approved/scenes`. `npm run scene-assets:check` fails when the
runtime bundle contains an unapproved file or misses an accepted one.

Card art follows the same boundary. `npm run card-assets:sync` vendors the
frozen files from `RuneRealm-Assets/approved/cards`; `card-art:check` and
`card-assets:check` prevent source layers or stale copies from replacing them.

Names are lowercase kebab-case except legacy player-character styles and
transaction-id sheets. Those names are stored in player data and cannot be
changed without a migration.
