#!/usr/bin/env python
"""Generate background plates via PixelLab pixflux, at native pixel resolution.

Two families, and the canvas sizes are chosen, not arbitrary:

  arena  384x216  16:9. Upscales EXACTLY 5x to 1920x1080, and halves cleanly to
                  192x108 if it turns out too fine-grained.
  room   384x192  2:1, matching the room panel. Halves to 192x96 -- which is
                  exactly the size of the backdrops it replaces, so a new plate
                  can be compared against the old art on the same grid.

Both are inside pixflux's 400px-per-side ceiling. Generate at the top of that
and downscale later if the pixels want to be chunkier: halving is exact and
free, and upscaling to get detail back is not possible at all.

Nothing here upscales anything. Committed art stays native -- see
RuneRealm-Assets/STYLE.md, "Store native, upscale at draw time".

  python tools/gen-scenes.py                    # everything missing
  python tools/gen-scenes.py --only volcano-rim --force
  python tools/gen-scenes.py --family room --sheet-only

Output goes to a staging dir. Nothing in src/assets/ is touched -- review the
contact sheet, then copy the keepers across.
"""
import argparse
import base64
import concurrent.futures as futures
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://api.pixellab.ai/v1/generate-image-pixflux"
OUT = pathlib.Path("RuneRealm-Assets/_generated/scenes")

# Fixed, per STYLE.md's repeatability rule. Same seed + same prompt = same plate.
SEED = 7

# The shared clause. Everything in it was learned from a batch that came back
# wrong, and the second bullet is the load-bearing one.
#
#   * Emptiness has to be asked for POSITIVELY. "no characters" put a swordsman
#     in the very first test render; diffusion models do not reliably negate.
#     "deserted", "scenery only" and "background plate" describe a thing that
#     exists, and get one.
#   * The floor has to reach BOTH BOTTOM CORNERS, at the same height. The
#     fighters stand in the corners and close on each other along a single
#     line, so a cliff edge, a floating platform, a narrow bridge or a raised
#     oval arena all put one of them over a hole. Fourteen plates from the
#     first two waves died on exactly this and not one of them died on art
#     quality -- "flat ground in the lower third" was not enough, because a
#     clifftop IS flat ground in the lower third.
TAIL = ("pixel art game background plate, side-on view, deserted scenery only, "
        "one unbroken flat floor running edge to edge along the very bottom, "
        "level ground filling both bottom corners at the same height, "
        "detailed background, limited palette")

ARENA = {
    # The four element temples. One family: the architecture clause is shared
    # almost word for word and only the element varies, so they read as four
    # rooms in one building rather than four unrelated scenes -- the same rule
    # STYLE.md sets for the item families.
    "temple-fire":   "the interior of a grand fire temple, scorched black basalt floor, rows of burning bronze braziers, channels of lava behind iron grates, a great flame emblem carved on the back wall, red and gold light",
    "temple-water":  "the interior of a grand water temple, wet blue marble floor, rows of carved columns, shallow reflecting channels, water sheeting down the back wall around a wave emblem, blue and green light",
    "temple-rock":   "the interior of a grand rock temple, rough granite floor, rows of massive unpolished stone columns, amber crystals growing from the walls, a great mountain emblem carved on the back wall, ochre and brown light",
    "temple-air":    "the interior of a grand air temple, pale marble floor, rows of slender columns in an open colonnade, banners streaming in the wind, sky and cloud beyond the arches, a great spiral emblem on the back wall, white and pale blue light",

    # Kept from waves one and two.
    "forge-hall":    "a vast underground forge hall, iron floor plates, channels of molten metal, huge stone furnaces and chains behind",
    "canyon-floor":  "a desert canyon floor, banded red and ochre rock walls either side, scattered boulders, hot bright sky",
    "quarry":        "an abandoned stone quarry, cut granite blocks, dust haze, wooden scaffolds and rubble behind",
    "moonlit-ruins": "a ruined temple courtyard at night, cracked flagstones, toppled columns, full moon, cool blue light",
    "mushroom-grove":"a forest glade of giant glowing mushrooms, mossy level floor, dark trunks behind, dappled green light",
    "ashen-field":   "a battlefield the morning after, pale ash covering flat level ground, broken banners and spears leaning, low sun breaking through drifting fog",
    "crystal-cave":  "an underground cavern arena, smooth rock floor, huge glowing violet crystals, stalactites",
    "storm-plateau": "a high moorland plateau in a thunderstorm, wet flat grass filling the foreground lit by a lightning flash, heavy dark clouds, rain",
    "autumn-glade":  "a golden autumn forest clearing, fallen leaves on level ground, birch and maple trunks, low warm sun",
    "sunken-temple": "a flooded temple hall, one unbroken flat tiled floor under ankle deep clear water spanning the full width, rows of broken marble pillars behind, shafts of light",
    "ember-shrine":  "the inside of a fire temple, flat basalt floor, braziers burning in a row, carved flame reliefs on the walls, red gloom",
    "waterfall-basin":"a flat wet rock shelf at the foot of a tall waterfall, level stone across the foreground, spray and mist, mossy cliffs behind",
    "badlands":      "a flat cracked clay pan in eroded badlands, level ground across the foreground, banded rock spires behind, dusty orange light",
    "dojo":          "the inside of a wooden training hall, flat polished plank floor, paper screens and racked weapons on the back wall, warm light",
    "night-market":  "a flat cobbled market square at night, level cobbles across the foreground, shuttered stalls and strung paper lanterns behind",
    "sakura-court":  "a flat stone courtyard under cherry blossom, level flagstones across the foreground, petals falling, blossoming trees and a low wall behind",
    "swamp-walk":    "a flat wooden boardwalk over a swamp, level planks across the full width, cypress trunks and hanging moss behind, green mist",
    "throne-hall":   "a ruined throne hall, flat cracked marble floor across the whole foreground, a broken throne and shattered columns behind, dusty light",

    # Backfill for the fourteen that were cut. Enclosed spaces on purpose: a
    # hall, a pit or a street cannot compose itself into a cliff edge.
    "ice-cavern":    "the inside of an ice cavern, flat frozen floor across the full width, blue ice walls and frozen columns behind, cold glow",
    "ruined-street": "a ruined city street, flat cobbles running the full width, gutted stone buildings and broken arches either side, smoke and grey light",
    "catacombs":     "the inside of a stone catacomb, flat slab floor across the full width, arched burial niches and skulls in the walls behind, candlelight",
    "bamboo-grove":  "a flat packed earth path through a bamboo grove, level ground across the whole foreground, dense green bamboo walls either side, soft light",

    # Japanese wave. dojo, sakura-court, bamboo-grove and night-market all
    # landed, so the setting is doing the work -- these lean into it.
    "zen-garden":    "a raked gravel zen garden, flat level gravel across the whole foreground, moss boulders and clipped pines behind a low wall, stone lanterns, soft grey light",
    "torii-shore":   "a flat stone jetty at the edge of a still lake, level slabs across the whole foreground, a great red torii gate standing in the water behind, mountains and mist",
    "pagoda-court":  "a flat flagstone courtyard before a tall wooden pagoda, level stone across the whole foreground, red lacquered beams and lanterns behind, evening sky",
    "onsen":         "the inside of a wooden bath house, flat slatted floor across the whole foreground, a steaming stone hot spring pool and bamboo pipes behind, warm steam and lamplight",
    "castle-keep":   "the inside of a Japanese castle keep, flat tatami mat floor across the whole foreground, gold painted screens and dark timber columns behind, low warm light",
    "shrine-steps":  "a flat stone landing at the top of shrine steps, level slabs across the whole foreground, a vermilion shrine gate and rope with paper streamers behind, cedar trees",
    "koi-pond":      "a flat wooden deck beside a koi pond, level planks across the whole foreground, maples, a stone bridge and drifting koi behind, autumn light",
    "snow-village":  "a flat snow covered street in a mountain village, level packed snow across the whole foreground, wooden eaves heavy with snow and glowing paper lanterns behind, night",
}

# A house is a stage, not a photograph of a room. The companion walks the full
# width of the floor, so the floor has to BE the full width and nothing may
# stand on it -- the first room wave put an armchair and a stove in the walking
# lane, which is why almost all of it was cut. Everything the room is made of
# goes against the back wall, behind the lane.
ROOM_TAIL = ("pixel art game background plate, interior seen straight on from "
             "across the room, deserted, a wide clear empty floor band running "
             "edge to edge along the bottom third with nothing standing on it, "
             "all furniture against the back wall behind, detailed background, "
             "limited palette")

ROOM = {
    "house-cottage":  "a snug wooden cottage, plank floor, a stone hearth with a low fire, a dresser and hanging herbs along the back wall, a shuttered window, warm light",
    "house-arcane":   "a stone wizard tower study, flagstone floor, tall bookshelves and a glowing orb on a stand along the back wall, an arched window, candlelight",
    "house-cabin":    "a log cabin in deep winter, plank floor, a big stone fireplace and stacked firewood along the back wall, frost on a small window, warm orange light",
    "house-burrow":   "an earthen burrow dug under a tree, packed earth floor, roots and hanging lanterns along the back wall, shelves cut into the soil, cosy amber light",
    "house-workshop": "a craftsman workshop, plank floor, a long workbench with tools and racked jars along the back wall, a wide window, cool daylight",
    "house-manor":    "a grand manor hall, polished parquet floor, tall panelled walls with portraits and a wide staircase along the back, chandeliers, rich warm light",
}

# Paths are SIDE-SCROLLERS. The companion walks and the plate repeats behind
# it, so what matters is a continuous ground line at a constant height and a
# left edge that can meet the right edge -- see tools/seamless.py, which does
# the joining. Kept shallow on purpose: a walking lane, not a vista.
PATH_TAIL = ("pixel art side-scrolling platformer background, flat side "
             "elevation with no perspective and no vanishing point, deserted "
             "scenery only, a solid ground band of constant height running "
             "edge to edge along the bottom, scenery standing in flat layers "
             "behind it, distant background layer, limited palette")

PATH = {
    "path-forest":   "a woodland trail, packed dirt path, tall trees and ferns crowding both sides, shafts of green light",
    "path-meadow":   "a grass track across open meadow, wildflowers and long grass either side, distant hills, bright summer sky",
    "path-mountain": "a stone mountain trail, bare rock and scree either side, pines, snow peaks behind, cold clear light",
    "path-coast":    "a sandy coastal path, dune grass and driftwood either side, the sea and a low sun behind",
    "path-desert":   "a dusty desert track, cracked earth, cactus and bleached rocks either side, mesas behind, hot pale sky",
    "path-town":     "a cobbled street at night, shuttered shopfronts and strung lanterns either side, warm pools of lamplight",
    "path-swamp":    "a boardwalk trail through a swamp, planks over dark water, cypress and hanging moss either side, green mist",
    "path-ruins":    "a broken flagstone road through ancient ruins, toppled columns and arches either side, dusty gold light",
}

FAMILIES = {
    "arena": (ARENA, 384, 216, TAIL),
    "room":  (ROOM, 384, 192, ROOM_TAIL),
    "path":  (PATH, 400, 200, PATH_TAIL),
}


def generate(key, prompt, w, h, dest, guidance, tail):
    body = {
        "description": f"{prompt}, {tail}",
        "image_size": {"width": w, "height": h},
        "no_background": False,
        "text_guidance_scale": guidance,
        "seed": SEED,
    }
    started = time.time()
    # The account has a concurrent-job cap, and going over it returns 429
    # IMMEDIATELY rather than queueing -- so a wide pool does not run faster,
    # it just converts most of the batch into instant failures. A 429 costs no
    # generation, so retrying is free; backing off and waiting for a slot is
    # what actually gets the batch done.
    for attempt in range(12):
        req = urllib.request.Request(
            API, data=json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + key,
                     "Content-Type": "application/json"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=600))
            break
        except urllib.error.HTTPError as e:
            detail = e.read()[:200].decode(errors="replace")
            if e.code == 429 and attempt < 11:
                time.sleep(min(4 + attempt * 3, 25))
                continue
            return dest, None, f"HTTP {e.code} {detail}"
        except Exception as e:                              # noqa: BLE001
            return dest, None, str(e)
    else:
        return dest, None, "gave up waiting for a free job slot"
    raw = base64.b64decode(d["image"]["base64"])
    # A failed generation comes back as HTTP 200 with a flat grey image rather
    # than an error -- two of the first eight paths did exactly that, and the
    # only symptom downstream was a blank panel. One colour is never a real
    # plate, so refuse it here where it is still obvious what happened.
    if flat(raw):
        return dest, None, "API returned a blank image (generation failed)"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    used = d.get("usage", {}).get("generations", "?")
    return dest, time.time() - started, f"{used} gen"


def flat(raw):
    """Whether the returned PNG is a single flat colour."""
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        return len(im.getcolors(maxcolors=64) or [None] * 65) <= 2
    except Exception:                                       # noqa: BLE001
        return False


def sheet(family, w, h):
    """One contact sheet per family, at 2x, for reviewing the batch at a glance."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("  (no Pillow -- skipping contact sheet)")
        return
    files = sorted((OUT / family).glob("*.png"))
    files = [f for f in files if f.name != "_sheet.png"]
    if not files:
        return
    cols = 3
    rows = (len(files) + cols - 1) // cols
    pad, label = 8, 14
    sw, sh = w, h                                  # 1x; these are already large
    canvas = Image.new("RGB", (cols * (sw + pad) + pad,
                               rows * (sh + pad + label) + pad), (18, 18, 22))
    draw = ImageDraw.Draw(canvas)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB")
        if im.size != (sw, sh):
            im = im.resize((sw, sh), Image.NEAREST)
        x = pad + (i % cols) * (sw + pad)
        y = pad + (i // cols) * (sh + pad + label)
        canvas.paste(im, (x, y))
        draw.text((x + 2, y + sh + 2), f.stem, fill=(190, 190, 200))
    dest = OUT / family / "_sheet.png"
    canvas.save(dest)
    print(f"  contact sheet -> {dest}  ({len(files)} plates)")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--family", choices=list(FAMILIES) + ["all"], default="all")
    ap.add_argument("--only", help="one scene name")
    ap.add_argument("--force", action="store_true", help="regenerate existing files")
    ap.add_argument("--guidance", type=float, default=9.0,
                    help="text_guidance_scale; higher follows the prompt harder")
    ap.add_argument("--workers", type=int, default=3,
                    help="parallel requests; the account caps concurrent jobs")
    ap.add_argument("--sheet-only", action="store_true", help="rebuild contact sheets")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    names = list(FAMILIES) if a.family == "all" else [a.family]

    if a.sheet_only:
        for f in names:
            sheet(f, *FAMILIES[f][1:3])
        return

    key = os.environ.get("PIXELLAB_API_KEY")
    if not key and not a.dry_run:
        sys.exit("PIXELLAB_API_KEY is not set. `set -a; . ./.env.local; set +a`")

    jobs = []
    for family in names:
        prompts, w, h, tail = FAMILIES[family]
        for name, prompt in prompts.items():
            if a.only and name != a.only:
                continue
            dest = OUT / family / f"{name}.png"
            if dest.exists() and not a.force:
                print(f"  have  {family}/{name}")
                continue
            jobs.append((key, prompt, w, h, dest, a.guidance, tail))

    if not jobs:
        print("nothing to generate (--force to redo existing)")
    if a.dry_run:
        for j in jobs:
            print(f"  would generate {j[4]}  {j[2]}x{j[3]}")
        print(f"\n{len(jobs)} image(s), 1 generation each.")
        return

    print(f"generating {len(jobs)} plate(s), {a.workers} at a time...")
    ok = 0
    with futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        for dest, secs, note in pool.map(lambda j: generate(*j), jobs):
            if secs is None:
                print(f"  FAIL  {dest.parent.name}/{dest.stem}: {note}")
            else:
                ok += 1
                print(f"  ok    {dest.parent.name}/{dest.stem:16s} {secs:5.1f}s  {note}")
    print(f"\n{ok}/{len(jobs)} written under {OUT}")
    for f in names:
        sheet(f, *FAMILIES[f][1:3])


if __name__ == "__main__":
    main()
