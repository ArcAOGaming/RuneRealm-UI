# Monster Index

The Monster Index is Rune Realm's numbered creature catalog. Its public label
is **Monster Index**, its Admin tab is **Monster Index**, and a form is displayed as
`Monster #001`.

## Repository boundary

The repositories stay separate:

- `RuneRealm-Assets/monster-index/catalog.json` is the authoring source of truth for
  entry numbers, evolution lines, artist plans, availability, and asset slots.
- `RuneRealm-Assets/monster-index/entries/` holds approved source art and generated
  per-entry atlases. Legacy art is copied into an entry and never removed from
  its original location.
- RuneRealm-UI owns gameplay, the HyperBEAM contract, Phaser consumers, and the
  Admin workspace.
- `npm run monster-index:sync` validates and vendors a deterministic runtime
  snapshot into `src/generated/`, `src/assets/monster-index/`, and
  `backend/native/monster-index.generated.lua`.
- `npm run monster-index:check` fails when the two repositories have drifted. Every
  contract deployment command runs it before creating anything.

The Permaweb workflow intentionally checks out no art submodules. It builds
from the committed generated snapshot, which is why generated runtime files
belong in RuneRealm-UI even though authored art does not.

## Identity

These identifiers are deliberately different:

| Field | Meaning |
|---|---|
| `entryNo` | Permanent numbered evolution form. Never reused or reordered. |
| `entryKey` | Permanent machine key for that form. |
| `lineKey` | The three-form evolution family. |
| `monster.id` | One owned companion inside one player's account. |
| `assetId` | One immutable minted Arweave asset. |

Changing a Monster Index name or art revision does not rewrite player records. A
companion points at `entryNo`, and the client resolves the current catalog row.
An individually named companion carries `nameMode = "custom"` and keeps that
name when the species display name changes.

## Current numbering

- `#001-003` fire dog line (`#001 FireFox` live)
- `#004-006` water dog line (`#004 WaterDoge` live)
- `#007-009` air dog line (`#007 Airbud` live)
- `#010-012` rock dog line (`#010 Rockpup` live)
- `#013-027` first five additional lines: Ashmouse, Brookfrog, Gustfinch,
  Shalemole, and Bristleboar
- `#028-039` four more Fire lines: Coalbug, Sootkit, Sparktail, Wickmoth
- `#040-051` four more Water lines: Reednewt, Shellkip, Silverminnow, Mudcrab
- `#052-063` four more Air lines: Dusthare, Whistlebat, Cloudmoth, Grasskite
- `#064-075` four more Rock lines: Pebbleturtle, Quarryrat, Rubblearm, Cliffgoat
- `#076-087` four more untyped lines: Fieldhare, Barnowl, Marshdeer,
  Burrowbadger
- `#088-090` provisional Rocker line (`#088` and `#089` have partial art)
- `#091-093` provisional legendary Suspicious Fish line (`#091` has partial art)

That is four dog lines plus twenty-five roadmap lines plus two newly supplied
provisional lines, with three forms per line: **93 Monster Index slots**. Only
the four released dog base forms are live. Every other entry is named and
planned but internally disabled:
non-starter, non-catchable, zero Hunt weight, and excluded from completion.

The new Rocker and Suspicious Fish numbers are explicitly marked provisional.
Because neither line is live or deployed, they may be reordered before their
numbers are accepted as permanent identity.

The old Super, Dragon, Mix, Light, and Dark artwork remains legacy/unassigned
concept art. It is not silently treated as a dog evolution.

## Runtime art

The canonical animation asset is one `animations/atlas.png` per monster plus
its small `animations/atlas.json`. The four released dogs use the same
1024x576 `monster-sheet-v1` coordinates and semantic clips:

```text
idle
walk.right
walk.left
walk.up
walk.down
attack.basic
attack.advanced
```

Atlas metadata owns frame rate, looping, impact frame, origin, world/battle
scale, shadow dimensions, and attack reach. The shared layout keeps the current
64px world/basic frames and 128px advanced frames without resampling.

The original Fire sheet used a different row order from the other dogs. The
one-time normalizer corrected that in the canonical sheet; its original inputs
are archived under `sources/original/`. A future nonstandard source may declare
`assets.world.rows`, be normalized once, and then use the same direct-atlas
path. Custom atlas JSON remains available for a monster whose native geometry
cannot reasonably fit the shared sheet.

`src/lib/monster-index.ts` is the single numbered-entry and asset resolver in
the browser. `src/game/MonsterRig.ts` turns that resolved definition into the
reusable Phaser object used by Room, Play, Quest, Hunt, Battle, and the
acquisition ceremony. A scene requests semantic motions such as `walk.left` or
`attack.advanced`; it does not repeat sheet rows, frame sizes, anchors, scale,
or timing. Cards resolve the portrait through the same permanent `entryNo` and
vendored `monster-index/NNN/portrait.png` convention, so renaming a species does
not change either animation or card asset identity.

Playback is deliberately scene-friendly:

```ts
rig.once(sprite, namespace, 'attack.basic');
rig.playTimes(sprite, namespace, 'emote', 3);
rig.loop(sprite, namespace, 'walk.left');
rig.pause(sprite);
rig.resume(sprite);
rig.stop(sprite, 'idle');
```

The generic `play` call can also override frame rate, delay, repeat delay,
yoyo, start frame, time scale, and completion behavior without changing the
shared atlas definition.

The Admin Monster Index detail includes the runtime QA bench. It discovers
every clip named by the selected atlas, runs it through the production
`MonsterRig` once, three times, continuously, paused, resumed, or stopped, and
renders the same monster through the production card, Home, Play, Quest, Hunt,
and Battle components. The full normalized sheet is inspectable alongside the
entry's exact asset paths. Entries without a runtime atlas instead show their
partial source sheet and all recorded coverage notes; they are never passed to
runtime scenes prematurely.

## Contract authority

The game publishes `/now/monsterindex`. The compact view contains identity,
evolution links, move mappings, release state, starter/Hunt channels, Hunt
weight, readiness, and art revision. Long artist briefs and filesystem paths
remain outside the process.

`Admin.MonsterIndex.Update` can change the display name, lifecycle, art revision,
starter flag, Hunt flag, and Hunt weight. Entry number, key, line, stage,
affinity, and evolution topology require a tested deployment. Sparse overrides
are exported and restored across redeploys.

Hunt workers receive the effective catchable pool in the attested `Hunt.Open`
message. They perform weighted selection but cannot invent an entry or restore
one the game disabled. Capture returns `entryNo`; the game rebuilds canonical
identity itself before adding the companion.

Evolution changes only `entryNo` and catalog-controlled presentation. Instance
id, ownership, level, experience, stats, care history, energy, happiness, and
status remain. A target form must be live and asset-ready. High-level creatures
therefore wait safely when a later form is still planned.

## Player discovery and completion

The player-facing `/monster-index` has three states:

1. **Unseen** — numbered, but the name, affinity and portrait are sealed.
2. **Seen, not owned** — the record is revealed in grayscale.
3. **Currently owned** — full color with the current copy count.

`seenEntries` is a permanent per-player set. Current ownership is deliberately
not stored as a historical achievement: the client derives it from the active
slot, collection, unsold listings, and companion assets still held by the
account. Selling the last copy therefore returns the entry to gray while
keeping it seen. Completion means owning at least one of every live entry at
the same time.

All 93 reserved numbers appear as slots. Planned entries use a separate sealed
availability treatment, remain hidden internally, and do not enlarge the live
completion denominator.

Hunt workers accumulate sightings during a run and return them through the
existing settlement/release boundaries, so discovery adds no per-search hop.
Arena starts mark opponents, and the battle fleet returns its opponent entry on
the existing terminal settlement. Owning or receiving a companion always marks
its entry seen.

## Content workflow

1. Reserve the next three contiguous entry numbers in the asset catalog.
2. Write the appearance and two attack plans before generating art.
3. In Admin -> Create, assign the Monster Index number and asset slot.
4. Generate and review each source independently.
5. Approve into the numbered entry folder.
6. Run `npm run monster-index:sync` and inspect the generated atlas in Admin -> Monster Index.
7. Run `npm run monster-index:check`, Hunt tests, Lua tests, and the production build.
8. Deploy the contract snapshot, then use the owner control to move a complete
   entry from testing to live and optionally enable it in Hunt.
