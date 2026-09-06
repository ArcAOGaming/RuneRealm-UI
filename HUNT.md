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

`Hunt.Settled` is the only one of these that carries its identity in TAGS
rather than in a JSON body, and that is what broke it on a live process. The
game emits `run-id` and `settlement-id`; tag names are lowercased HTTP headers
by the time a handler reads them; and the worker's lookup matched on case
alone, so both read `nil` and every acknowledgement was refused with "Capture
settlement not found". The ledger had already spent the Rune and granted the
companion, so the run sat in `settling` for good — and `Hunt.End` refuses to
leave while settling, which makes it unrecoverable from the worker's side.

Two rules came out of that, and both are enforced:

- **Separators are not part of a tag name.** `hunt.lua`'s `field` normalises
  `-` and `_` away, so `run-id`, `run_id` and `RunId` are one key. The tests
  send the exact spelling the game emits, because the old test sent `RunId` and
  passed against a process that could not read a single live acknowledgement.
- **An id rides two tags.** The settlement id is on `settlement-id` and on
  `reference`, which is what the battle fleet has always done.

`npm run verify:hunt` drives one real signed capture against the live fleet and
fails unless the run comes back out of `settling` with a receipt. It uses a
burner, never the owner wallet — swearing a faction is once per account forever.
Both branches are worth running, because they are different code past the
boundary: `--bid 1` usually breaks, `--bid 3` usually binds and additionally
mints the creature into the collection.

When a route is stranded anyway — a worker replaced, a run that can never reach
a terminal state — `backend/native/clear-hunt-route.mjs` is the door. An
exported row carries no `hunt` field and `Admin.Load` thaws a `Hunt` status, so
loading a player's own current row drops the route and unfreezes the companion
without touching anything else. It refuses to write a row with no companions in
it.

The browser never chooses an encountered faction, level, battle result, or
capture result. A wallet signs search, attacks, capture, and leaving, just as it
already signs arena moves. Cross-process messages are accepted only when this
process's scheduler attests the configured sender.

## Capture economy

- Opening a run costs **two of each berry**. Was five of each — twenty berries
  is a whole day's crate, which put hunting and playing in direct competition
  for the same daily allowance. The game checks the complete offering before
  spending any of it. Retrying the same opening is delivery recovery and never
  charges a second time.
- One attempt after a win.
- Costs **one Scroll and a 1–3 Rune bid**, both spent on success and failure
  alike. The Scroll is the ticket: nothing else in the game consumes one, and
  before this nothing did at all. Both prices are checked before either is
  spent, because the worker retries a refused settlement.
- Wild level is `hunter level - 5` through `hunter level + 5`, floored at zero.
- The chance curve is published in the game catalog. At equal level the three
  choices are **35%, 56% and 74%**. The top bid is likely, never certain. It was
  1–5 at 35/49/60/68/75; the fourth and fifth Rune bought 8 and 7 points on a
  curve flattening towards its cap, so they were the two most expensive and
  least interesting choices on the slider.
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
  with one orbiting stone for each element in the offering. Every number on
  that dialog is summed from the published costs — it read "Twenty berries" as
  a literal until the offering stopped being five of each.
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
