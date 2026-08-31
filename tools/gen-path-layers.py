#!/usr/bin/env python
"""Generate a side-scrolling path as PARALLAX LAYERS, not as one wide plate.

The wide-plate approach was wrong and the first eight paths proved it. A
single 2000px image has to loop, so you see the same tree go by every cycle;
worse, a diffusion model draws a path receding to a vanishing point, and a
vanishing point cannot repeat horizontally at all -- rolling one to close the
seam produces a mirrored V at every join.

A side-scroller is not a long picture. It is a few SHORT pictures scrolling at
different speeds, which is why Mario needs no long pictures. Phaser has this
built in: a `TileSprite` repeats its texture forever and you move
`tilePositionX` by (speed * delta) each frame. Four of those, at four speeds,
and the path is infinite, continuous and never has a seam to hide -- because
nothing is ever cut off, it is only offset.

So each biome is four narrow textures:

  sky     opaque,      scrolls slowest   the gradient and clouds behind it all
  far     transparent, slow              hills, distant roofs, silhouettes
  mid     transparent, medium            trees, poles, the things you pass
  ground  opaque strip, fastest          the band the companion walks on

Each is generated small and made horizontally seamless by tools/seamless.py.
Small is the point: at 128-256px the repeat reads as "more bamboo", not as a
loop, because at any moment you only see the layers at four different offsets
and they never line up the same way twice.

  python tools/gen-path-layers.py --biome japan
  python tools/gen-path-layers.py                # every biome

Then tools/preview-scroll.py renders it moving.
"""
import argparse
import base64
import concurrent.futures as futures
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://api.pixellab.ai/v1/generate-image-pixflux"
OUT = pathlib.Path("RuneRealm-Assets/_generated/scenes/quest")
SEED = 7

# Shared by every layer: flat elevation is what makes a texture tile at all.
FLAT = ("pixel art side-scrolling platformer layer, flat side elevation, no "
        "perspective, no vanishing point, deserted, limited palette")

# name -> (width, height, transparent, prompt). Scroll speeds live in
# preview-scroll.py and in the scene, not here -- this file only makes art.
LAYERS = {
    # Sky gets NO platformer wording at all. With the shared tail it came back
    # as a strip of soil and grass -- "platformer layer" and "ground" are the
    # two words a sky must not be given.
    "sky":    (256, 216, False,
               "an empty sky filling the whole image, smooth vertical colour gradient, "
               "a few small flat clouds, no ground, no plants, no buildings, no horizon line, "
               "pixel art background layer, limited palette"),
    "far":    (256, 104, True,
               "flat distant silhouettes along the bottom edge of the image, one solid pale "
               "colour, no detail, empty transparent sky above them, "
               "pixel art parallax layer, limited palette"),
    "mid":    (256, 176, True,  "a row of evenly spaced tall foreground plants and posts, full height, standing on nothing, transparent above and below"),
    "ground": (256, 72,  False, "a horizontal ground strip seen edge on, flat top surface with the earth beneath it, repeating texture, no sky"),
}

BIOMES = {
    "japan":    {"sky": "pale dawn sky, soft pink and blue gradient, thin flat clouds",
                 "far": "distant blue mountains and pagoda roof silhouettes in mist",
                 "mid": "tall green bamboo stalks and slender cherry trees in blossom, stone lanterns between them",
                 "ground": "packed earth path with cut stone edging, moss and scattered pink petals on top"},
    "forest":   {"sky": "soft green morning sky, pale gradient, thin flat clouds",
                 "far": "distant dark conifer treeline silhouette in haze",
                 "mid": "thick oak trunks with ferns at their base, hanging vines",
                 "ground": "packed dirt trail with grass tufts and exposed roots on top, soil beneath"},
    "mountain": {"sky": "cold clear blue sky, pale gradient, wispy flat clouds",
                 "far": "distant snow capped peaks in flat pale blue",
                 "mid": "weathered pines and standing grey boulders",
                 "ground": "grey rock ledge with patches of snow and scree on top, stone beneath"},
    "coast":    {"sky": "warm evening sky over a flat sea horizon, orange and violet gradient",
                 "far": "distant sea stacks and a low sun in flat silhouette",
                 "mid": "palm trunks, dune grass and pieces of driftwood",
                 "ground": "pale beach sand with shells and wet darker sand on top"},
}


def flat_image(raw):
    from PIL import Image
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        return len(im.getcolors(maxcolors=64) or [None] * 65) <= 2
    except Exception:                                       # noqa: BLE001
        return False


def one(key, biome, layer, dest):
    w, h, transparent, shape = LAYERS[layer]
    body = {
        "description": f"{BIOMES[biome][layer]}, {shape}, {FLAT}",
        "image_size": {"width": w, "height": h},
        "no_background": transparent,
        "text_guidance_scale": 9,
        "seed": SEED,
    }
    for attempt in range(12):
        req = urllib.request.Request(
            API, data=json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + key,
                     "Content-Type": "application/json"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=600))
            break
        except urllib.error.HTTPError as e:
            detail = e.read()[:160].decode(errors="replace")
            if e.code == 429 and attempt < 11:
                time.sleep(min(4 + attempt * 3, 25))
                continue
            return f"{biome}/{layer}", f"HTTP {e.code} {detail}"
        except Exception as e:                              # noqa: BLE001
            return f"{biome}/{layer}", str(e)
    else:
        return f"{biome}/{layer}", "no free job slot"

    raw = base64.b64decode(d["image"]["base64"])
    if flat_image(raw):
        return f"{biome}/{layer}", "API returned a blank image"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return f"{biome}/{layer}", None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--biome", choices=list(BIOMES) + ["all"], default="all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()

    key = os.environ.get("PIXELLAB_API_KEY")
    if not key:
        sys.exit("PIXELLAB_API_KEY is not set. `set -a; . ./.env.local; set +a`")

    biomes = list(BIOMES) if a.biome == "all" else [a.biome]
    jobs = []
    for b in biomes:
        for layer in LAYERS:
            dest = OUT / b / f"{layer}.png"
            if dest.exists() and not a.force:
                print(f"  have  {b}/{layer}")
                continue
            jobs.append((key, b, layer, dest))
    if not jobs:
        print("nothing to generate (--force to redo)")
        return

    print(f"generating {len(jobs)} layer(s)...")
    with futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        for name, err in pool.map(lambda j: one(*j), jobs):
            print(f"  {'FAIL  ' if err else 'ok    '}{name}{': ' + err if err else ''}")
    print(f"\nunder {OUT}. Now: python tools/seamless.py '{OUT}/*/*.png' --out <same dir>")


main()
