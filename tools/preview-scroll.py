#!/usr/bin/env python
"""Render a layered path actually scrolling, as an animated GIF.

Proof that the layer approach works, and the thing to look at before wiring it
into a scene. Each layer is drawn as a repeating strip at its own speed -- the
same arithmetic a Phaser TileSprite does when you advance `tilePositionX` --
so what comes out here is what the scene will look like.

The speeds are the whole trick. Nothing is ever cut off or joined; the layers
are simply offset by different amounts, so a 256px texture never reads as a
256px loop. The sky barely moves, the far hills crawl, the trees pass, the
ground runs. Four small textures, an infinite path.

  python tools/preview-scroll.py --biome japan
  python tools/preview-scroll.py --biome japan --frames 48 --step 3
"""
import argparse
import pathlib
import sys

from PIL import Image

# Layer -> (scroll speed relative to the ground, z order). Ground is 1.0 and
# everything else is a fraction of it: that is what parallax IS.
SPEED = {"sky": 0.05, "far": 0.20, "mid": 1.0, "ground": 1.0}

# THREE layers, not four. The scenery strip comes back from the model with its
# own ground line baked in -- ask for bamboo "standing on nothing" and you get
# bamboo standing on soil anyway -- so a separate ground layer just draws a
# second horizon underneath the first. Let the scenery carry its own floor and
# the stack is sky, distance, and the strip the companion walks on.
ORDER = ["sky", "far", "mid"]

W, H = 384, 216

# How far above the bottom the distance layer's base sits. It has to land just
# ABOVE the scenery strip's ground line so the hills read as behind the trees;
# any higher and they detach into a band across the top of the sky.
FAR_LIFT = 28


def tiled(img, offset, w):
    """One row of `img` repeated across `w` px, starting `offset` px in."""
    out = Image.new("RGBA", (w, img.height), (0, 0, 0, 0))
    start = -(offset % img.width)
    x = start
    while x < w:
        out.alpha_composite(img, (x, 0))
        x += img.width
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--biome", default="japan")
    ap.add_argument("--frames", type=int, default=32)
    ap.add_argument("--step", type=int, default=4, help="ground px moved per frame")
    ap.add_argument("--scale", type=int, default=2, help="integer upscale for viewing")
    a = ap.parse_args()

    src = pathlib.Path("RuneRealm-Assets/_generated/paths") / a.biome
    layers = {}
    for name in ORDER:
        p = src / f"{name}.png"
        if not p.exists():
            sys.exit(f"missing layer: {p}")
        layers[name] = Image.open(p).convert("RGBA")

    walk = layers["mid"]
    frames = []
    for i in range(a.frames):
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        for name in ORDER:
            img = layers[name]
            off = int(i * a.step * SPEED[name])
            row = tiled(img, off, W)
            if name == "sky":
                y = 0                    # fills the frame, everything sits on it
            elif name == "mid":
                y = H - img.height       # its baked ground line IS the floor
            else:
                # The distance meets the walking floor, so its bottom edge sits
                # on the scenery strip's ground line rather than on the canvas.
                y = H - FAR_LIFT - img.height
            canvas.alpha_composite(row, (0, y))
        if a.scale != 1:
            canvas = canvas.resize((W * a.scale, H * a.scale), Image.NEAREST)
        frames.append(canvas.convert("P", palette=Image.ADAPTIVE))

    dest = src / "_scroll.gif"
    frames[0].save(dest, save_all=True, append_images=frames[1:],
                   duration=60, loop=0, optimize=False)
    still = src / "_still.png"
    frames[0].convert("RGB").save(still)
    print(f"{a.frames} frames -> {dest}")
    print(f"first frame  -> {still}")


main()
