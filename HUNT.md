# Hunt mode

Hunt is a separate authoritative game mode with the game process kept as the
owner of companions and inventory.

```text
browser -> game: Hunt.Begin
game    -> Hunt: Hunt.Open        (chosen companion snapshot; game locks it)
browser -> Hunt: Search / Attack  (encounter and combat live here)
browser -> Hunt: Capture          (one deterministic roll)
Hunt    -> game: Hunt.Settle      (spend Rune bid; create companion)
game    -> Hunt: Hunt.Settled     (idempotent acknowledgement)
browser -> Hunt: Hunt.End
Hunt    -> game: Hunt.Released    (companion returns Home)
```

Opening and capture settlement are explicitly retryable delivery steps. A
retry re-emits the same run or already-fixed capture result; it cannot roll a
second time, spend twice, or allocate a second Hunt id.

The browser never chooses an encountered faction, level, battle result, or
capture result. A wallet signs search, attacks, capture, and leaving, just as it
already signs arena moves. Cross-process messages are accepted only when this
process's scheduler attests the configured sender.

## Capture economy

- Opening a run costs **five Fire, five Water, five Air and five Rock Berries**.
  The game checks the complete offering before spending any of it. Retrying the
  same opening is delivery recovery and never charges a second time.
- One attempt after a win.
- Costs a **1–5 Rune** bid on both success and failure.
- Wild level is `hunter level - 5` through `hunter level + 5`, floored at zero.
- The chance curve is published in the game catalog. At equal level the five
  choices are **35%, 49%, 60%, 68%, and 75%**. Five Rune is likely, not certain.
- Level advantage changes the chance by three points per level.
- Chance is clamped to 5–95%; it is never certain.

A successful capture creates the exact defeated creature in the player's
collection, then uses `CompanionAcquisition` for the capture-card reveal. This
is the in-game mint. It deliberately does not auto-publish an Arweave asset:
the existing funded mint worker charges its separate mint fee and removes the
active companion from the game. A captured collection companion can be brought
into the roster and sent through the existing `Monster.Mint` pipeline if
Arweave publishing is enabled again; the current build intentionally keeps new
companions in-game.

## Presentation stack

- The entry confirmation is `HuntOffering`: a pointer-reactive Three.js gate
  with one orbiting stone for each five-berry element offering.
- Roaming, companion following, encounter reveals and wild combat are Phaser
  scenes. The binding UI is not rendered until that battle reports `defeated`.
- A successful binding finishes in `CompanionAcquisition`, whose assembled card
  becomes a lit, rotating Three.js object the player can hold.

The text ledger remains authoritative and usable if WebGL is unavailable; the
renderers make the rite feel physical without becoming the thing that decides
whether the player paid or won.

## World seam for Tiled

`src/game/HuntScene.ts` owns movement, four-direction animation, follower trail,
depth sorting, encounter distance, and the jump/lunge reveal. Its `drawWorld()`
method is intentionally the only placeholder-world implementation. Replace it
with a Tiled tilemap preload/create path while keeping the player, companion,
and encounter APIs intact. Recommended Tiled layers are:

1. `ground` (floor terrain)
2. `water` / animated tiles
3. `collision` (hidden object or tile layer)
4. `props-low` (below actors)
5. `props-y` (depth sorted by object base)
6. `canopy` / weather (above actors)
7. named `player-spawn` and encounter-region objects

## Deploy

Deploy or redeploy the game first, then:

```powershell
npm.cmd run test:hunt
npm.cmd run deploy:hunt
```

The deployer spawns `hunt.lua`, calls `Admin.SetHuntProcess` on the game,
verifies `/now/huntconfig`, writes `hunt-process.txt`, and updates
`VITE_HUNT_PROCESS` / `VITE_HUNT_NODE`. Rebuild the site after wiring. Use
`--no-env` for a throwaway process that must not move the client configuration.
