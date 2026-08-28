# Rune Realm — the design system

Everything on screen is **carved**, and **colour always means an element**.
Those two sentences decide almost every question this document answers.

The tokens live in [src/index.css](src/index.css) and are surfaced to Tailwind
in [tailwind.config.js](tailwind.config.js). Read those first; this file is the
argument behind them.

---

## 1. The mark

The old logo was a cartoon wooden signboard, 512×271, shipped as a PNG. It is
gone. In its place is the **Realm Seal**: a carved tablet, chamfered top-right
and bottom-left, holding a rune — a stave piercing a bound gate — with one
horizontal **bind bar** through it.

The seal's geometry lives in exactly one place, [src/gfx/mark.json](src/gfx/mark.json),
and three renderers read it:

| Renderer | File | Used for |
|---|---|---|
| SVG | [src/ui/Mark.tsx](src/ui/Mark.tsx) | header, front door, anywhere in the DOM |
| Canvas 2D | [src/gfx/mark.ts](src/gfx/mark.ts) | textures — the mark cut into the vault's lid |
| Raster + vector | [tools/gen-icons.py](tools/gen-icons.py) | favicons and the social card |
| three.js | [src/gfx/monolith.ts](src/gfx/monolith.ts) | the stone slab on the front door |

Change a number in `mark.json` and run `python tools/gen-icons.py`; everything
else follows. They cannot drift.

**The bind bar is the only part of the mark that carries colour**, and it takes
`--element`. Swearing to fire turns the logo orange — in the header, on the
front door, in the browser tab's rendered SVG. That is not decoration: it is the
same rule every other surface obeys.

The rune is deliberately **symmetrical**. A player's sigil ([src/gfx/sigil.ts](src/gfx/sigil.ts))
is struck asymmetrically off its stave because it is theirs and imperfect; the
seal is the rune those are measured against.

### The wordmark

Not set in a font. `mark.json` carries a small **carved alphabet** — straight
strokes, mitred joins, chamfers instead of curves, not one arc — holding only
the seven letters the name needs. Adding a word means cutting its letters by
hand, which is the intent.

### Regenerating the icons

```bash
python tools/gen-icons.py          # public/favicon.svg, favicon.png, apple-touch-icon.png, og.png
python tools/gen-icons.py --sheet  # ...and .icons/sheet.png, every size at once, for eyeballing
```

---

## 2. Colour

| Group | Tokens | Rule |
|---|---|---|
| Ink | `--void --surface --raised --edge --ink --muted --faint` | Cold near-black with a blue-violet undertone. The chrome has no accent of its own. |
| Chrome | `--rune` (214 200 162) | Bone-gold. Hairlines, rules, the mark. **Never** state, never emphasis. |
| Elements | `--ember --tide --gale --stone --arcane` | The only saturated colour in the system. |
| State | `--good --warn --bad` | Fixed meaning, overrides the element (health is always health-coloured). |

`--element` is set once by a `data-element` attribute on an ancestor. Everything
inside it — buttons, bars, borders, glow, the logo — agrees without being told.
Components take no colour props.

`--rune` is byte-identical to `rune` in `mark.json`. One value, one colour.

---

## 3. Shape

Nothing is drawn with a round pen.

- **Panels** are tablets: one notch, always top-right, `--notch: 14px`, with the
  hairline drawn as an inset overlay because a `clip-path` cannot take a border.
- **The primary button** carries `.chamfer` — the mark's own two corners at
  `--cut: 9px`, so a button and the logo are the same shape at different scales.
  Its glow is a `drop-shadow`, not a `box-shadow`, because a clip-path cuts a
  box-shadow off at the silhouette.
- **Everything else with an edge** is `rounded-[3px]`. The bordered button
  variants stay square: a clip-path would lose their edge along both diagonals.
- **Meters** are cut channels, not pills.
- Only blur blobs keep a circle — they are light, not a surface.

---

## 4. Icons

Hand-built, in [src/ui/icons.tsx](src/ui/icons.tsx). No icon package, and no
emoji anywhere in the product.

Drawn to the same rules as the seal, on a 24 box at 1.6 weight:

- **butt caps, mitred joins** — a round pen is the one thing that gives away a
  drawn mark;
- **straight strokes only**; where a round form is needed it is cut as a hexagon
  or an octagon. `Cog`, `Clock` and `Info` are octagons and read better at 16px
  than the circles they replace;
- **chamfers instead of radii**;
- one angle vocabulary: 90°, 45°, and the seal's own 30/60.

`Spinner` in [src/ui/primitives.tsx](src/ui/primitives.tsx) is an octagonal seal
turning, for the same reason.

Adding an icon means drawing it in this vocabulary. If a glyph needs an arc, it
is the wrong glyph.

---

## 5. Type

| Role | Face | Notes |
|---|---|---|
| Display | Bricolage Grotesque, `wdth 88` | Headings only. |
| Body | Instrument Sans | Dense, screen-native, gets out of the way. |
| Mono | JetBrains Mono | Every address and every number, which is most of this interface. |
| Wordmark | the carved alphabet | Not a font — see §1. |

`.eyebrow` is the structural device of the whole interface: it names what a
group of numbers **is**, and it is the only place tracking opens up.

`.carve` engraves — one dark edge above, one pale edge below, a single pixel
each. For numbers that should feel struck into the surface. Never body copy.

---

## 6. The graphics layer

Six scenes across four techniques, each chosen against the others:

| | What | Why not the others |
|---|---|---|
| [gfx/aether.ts](src/gfx/aether.ts) | The ambient field behind everything. Raw WebGL2, one quad, one fragment shader. | One quad and one shader; a library for that costs more in bundle than the rest of the app. |
| [gfx/sigil.ts](src/gfx/sigil.ts) | A rune drawn from a wallet address. Canvas 2D. | Small, several on screen, crisp hairlines at 24px matter more than shading. |
| [gfx/monolith.ts](src/gfx/monolith.ts) | The seal cut in stone, on the front door. three.js. | Geometry, granite, a real light. |
| [gfx/vault.ts](src/gfx/vault.ts) | The loot box ceremony. three.js. | Geometry, metal, shadowed light and a particle system — hand-rolling that is writing a renderer. |
| [gfx/altars.ts](src/gfx/altars.ts) | The Altar Hall. three.js. | Four shader cores, carved stone and a rune ring each. |
| [gfx/cardObject.ts](src/gfx/cardObject.ts) | The minted card, held. three.js. | Thickness, a gold rim and angle-dependent foil. |

Rules that came out of building them, the hard way:

- **One renderer per canvas.** React's StrictMode mounts every effect twice in
  development, and two renderers sharing a GL context render as garbage — the
  mark came out with a dark cross through it for an hour. Both three.js modules
  now hold a `LIVE` WeakMap keyed on the canvas and evict whatever was there.
- **The inlay is stated, not lit.** Bone-gold and `--element` are `toneMapped:
  false` basic materials, so the stone mark is the same hex as the SVG one. Lit
  metal put the long strokes several stops darker than the short ones.
- **No post-processing on the monolith.** `UnrealBloomPass` streaked a
  non-finite pixel the full width and height of the canvas. The glow is an
  additive quad now: cheaper, artifact-free, and its reach is a number rather
  than a blur radius — which is what needed controlling, since the halo has to
  stay inside the canvas or the mark looks like it is sitting in a box.
- **three.js loads after paint.** It is ~550kB. The front door paints its HTML
  story first and lazily adds the Realm Vista; without WebGL the complete page
  remains, with the flat mark as its visual anchor.
- **Never gate an overlay's opacity on `requestAnimationFrame`.** A
  backgrounded tab gets no animation frames, so the familiar
  `useState(false)` + `rAF(() => setShown(true))` fade opens the overlay at zero
  and leaves it there. The entry fade is the `animate-fade` CSS keyframe.
- **Size every canvas in CSS.** `setSize(w, h, false)` writes the width and
  height ATTRIBUTES and deliberately leaves the style alone; with no CSS size
  the element lays out at its attribute size, which was just derived from its
  own `clientWidth`. The Altar Hall's canvas grew every frame until it was
  ninety thousand pixels wide.
- **Draw one frame inside `resize()`.** A resize clears the drawing buffer, and
  one that lands while the loop is parked leaves an empty canvas until the tab
  is looked at again.
- **No post-processing anywhere. The glow is always additive geometry.** Two
  independent failures, on the same ordinary Windows laptop, and neither of them
  raised so much as a warning:
  `EffectComposer.setSize` multiplies by its pixel ratio and does not round, so
  a display at 140% scaling (`devicePixelRatio` 1.4) gets a render target
  1919.4 × 894.6 — and a framebuffer with fractional dimensions is incomplete.
  Sized in whole pixels it still drew nothing, which leaves `samples: 4` on a
  `HalfFloatType` target; multisampled half-float renderbuffers are not
  universal. A pass that produces an empty frame on some machines and not others
  is the worst way for anything to fail, and the effect was never worth it.
- **A phase machine reads its clock per phase.** The vault computed `since = now
  - mark` once at the top of the frame and then ran four separate `if`s. On the
  frame the crack finished it set `mark = now` and fell straight into the burst
  block, which measured itself against the crack's elapsed time — always over
  `BURST_MS`. Every opening skipped its own burst in a single frame.
- **Each scene owns its canvas.** `createVault` creates the element and removes
  it on dispose. Being handed one meant StrictMode's second mount attached a new
  renderer to a context the first had already torn down, and it drew nothing.
  A registry does not help: the eviction and the re-creation are the same event.
- **Read the console before theorising about a shader.** A `ShaderMaterial`
  whose fragment stage fails to compile draws nothing at all, and three prints
  the exact line and the exact reason. An hour went into "the water orb is
  invisible" — sampling pixels, swapping materials, checking depth and frustum —
  when the log said `'uFast' : undeclared identifier`: the uniform had been
  added to the vertex shader and used in the fragment one. Declare a uniform in
  every stage that reads it.
- **Everything degrades honestly.** No WebGL, reduced motion or a lost context,
  and you get the flat mark and a plain dark background. Nothing in the
  graphics layer is load-bearing.

---

## 7. The renderers, and what each screen gets

| Screen | What it is | File |
|---|---|---|
| Front door | The Realm Vista — an old gate, four orbiting currents and the Corporation's measured towers | [gfx/realmVista.ts](src/gfx/realmVista.ts) |
| Factions | The Altar Hall — four elemental cores on carved plinths | [gfx/altars.ts](src/gfx/altars.ts) |
| Companion → Hold the card | The minted card as an object, with foil and a carved back | [gfx/cardObject.ts](src/gfx/cardObject.ts) |
| Loot box | The chest ceremony, full viewport, spoils thrown out of it | [gfx/vault.ts](src/gfx/vault.ts) |
| Everywhere | The ambient aether field | [gfx/aether.ts](src/gfx/aether.ts) |
| Everywhere | A player's own rune, drawn from their address | [gfx/sigil.ts](src/gfx/sigil.ts) |

### The Altar Hall

Joining is the only irreversible choice in the game and it was four cards in a
grid. It is a room now. Four things hold it together:

- **The plinths are the mark.** Every stone is extruded from `mark.json`'s bezel
  outline, so a plinth, a panel and the logo are one silhouette at three scales.
- **The runes are the icons.** `Path2D` takes the element glyph straight out of
  `ui/icons`, so the rune cut into a shaft is the same geometry as the badge —
  not a second drawing that drifts.
- **The buttons are real buttons.** The renderer projects each core to CSS
  pixels and hands them back; the DOM puts a `<button>` there. A raycaster would
  have given hover and click and left the most important choice in the game
  unreachable by keyboard.
- **Swearing is two steps.** The first click stands you at an altar and raises
  its card; the second opens the oath. Nobody signs the irreversible action on
  one stray click at a pretty object.

The cards below carry what the choice actually decides and nothing else: the
companion, named and shown, and the members. The type matchups and the average
levels moved off (they belong on a page about factions, not on the one where you
swear), and the perks line — "Increased speed stats", "Boost to air-type attack
power" — was deleted from the process as well as the screen. Nothing in the
engine ever read it. A faction picks your starter and your group. That is all it
has ever done.

### The player's rune

Every wallet draws a unique deterministic sigil (`gfx/sigil.ts`). It used to
appear at 20px in a corner. It is now on every leaderboard row, in every faction
member list, and on the companion screen — on a plate, which is what turns loose
strokes into a token that belongs to somebody. A board of 43-character addresses
is a table; a board of marks is a roster.

`<Sigil plate>` is the presentation to reach for anywhere a person is named.

---

## 8. Still to build

### The arena — Phaser, not three.js

The fight is 2D: pixel sprite sheets exchanging blows. Phaser gives sprite state
machines, tween chains, particle emitters, camera shake and a pixel-art pipeline
as first-class things; three.js would mean billboarding sprites into a 3D scene
to fake what Phaser does natively. ~300kB gzipped on a lazy route.

**The split to hold:** Phaser owns the fight. three.js owns objects and light —
altars, cards, the vault, the seal.

### Other places considered

### The companion's room in 3D — `ui/Room.tsx`

Today: a 192×96 pixel backdrop with a sprite walking left and right in front of
it. Keep the sprite exactly as it is — a billboarded plane, `NearestFilter`,
never smoothed — and put it in a real box: perspective walls, a shadow-catching
floor so the contact shadow is cast rather than drawn as an ellipse, an element
light from below, drifting dust, and a shallow depth of field so the backdrop
sits behind. Parallax on pointer.

*Risk:* the pixel art must stay pixel-exact. Snap the camera so one sprite pixel
lands on a whole number of screen pixels.

### The leaderboard as a sigil constellation — `screens/Ranks.tsx`

The marks are on the rows now. The next step is depth: render the ladder as a
field of extruded sigils, yours lit and centred, rank mapped to distance,
faction to colour, and a drawn line to everyone you have beaten. Scrolling the
list flies the camera.

*Reuses:* `gfx/sigil.ts` geometry, extruded.

---

Considered and rejected: a 3D worship/daily ceremony (the vault already carries
that beat), and animating the header seal — chrome should not move, it is the
one still thing on the page.
