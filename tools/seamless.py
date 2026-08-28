#!/usr/bin/env python
"""Make a path plate loop: join its left edge to its right edge.

A side-scroller repeats one plate behind the walking companion, so the plate's
right edge butts against its own left edge forever. Generated art never does
that on its own -- there is a hard vertical join where a tree is cut in half
and the ground line steps.

The fix is the standard one and it is exact rather than approximate:

  1. ROLL the image horizontally by half its width. The old outer seam is now
     a seam down the MIDDLE of the picture, and the old middle -- which was
     always continuous -- becomes the new outer edge. The edges now match by
     construction, permanently, whatever happens next.
  2. REPAIR the seam that is now in the middle, where it is interior pixels
     and can be painted over freely.

Step 2 is done here by mirroring a band from one side of the seam across it
and blending in INDEX space, not colour space: each output pixel takes the
whole colour of one source pixel or the other, chosen by a dithered threshold,
so no colour is ever averaged into existence. Cross-fading the two sides would
be easier and would produce a soft grey smear through the middle of a piece of
pixel art -- 200 new colours where the palette had 80.

  python tools/seamless.py 'RuneRealm-Assets/_generated/scenes/path/*.png'
  python tools/seamless.py '...' --check      # report seam error, write nothing

`--check` measures the discontinuity at the wrap: the mean channel difference
between the last column and the first. Under ~8 the loop is invisible in
motion; over ~25 you will see it every cycle.
"""
import argparse
import glob as globlib
import pathlib
import sys

import numpy as np
from PIL import Image

BAND = 0.06        # fraction of width repaired either side of the seam


def wrap_error(a):
    """Mean channel difference across the wrap, 0-255."""
    return float(np.abs(a[:, -1, :3].astype(np.float32)
                        - a[:, 0, :3].astype(np.float32)).mean())


def make_seamless(a, rng):
    h, w = a.shape[:2]
    rolled = np.roll(a, w // 2, axis=1)

    # Repair the seam now sitting at x = w//2. Take the mirror of the band on
    # each side and choose per pixel between the original and the mirror, with
    # the probability of choosing the mirror rising to 0.5 at the seam. A
    # dithered choice, not a blend: every output pixel keeps a colour that was
    # already in the palette.
    band = max(4, int(w * BAND))
    seam = w // 2
    out = rolled.copy()
    for dx in range(-band, band):
        x = seam + dx
        if not 0 <= x < w:
            continue
        mirror_x = seam - dx - 1
        if not 0 <= mirror_x < w:
            continue
        t = 0.5 * (1.0 - abs(dx) / band)          # 0 at the band edge, .5 at the seam
        take = rng.random(h) < t
        out[take, x] = rolled[take, mirror_x]
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", help="directory to write into (default: <dir>/seamless)")
    ap.add_argument("--check", action="store_true", help="report seam error only")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    paths = []
    for pat in a.files:
        paths += [pathlib.Path(x) for x in sorted(globlib.glob(pat))]
    paths = [p for p in paths if p.is_file() and not p.stem.startswith("_")]
    if not paths:
        sys.exit("nothing to process")

    rng = np.random.default_rng(a.seed)
    out = pathlib.Path(a.out) if a.out else paths[0].parent / "seamless"
    if not a.check:
        out.mkdir(parents=True, exist_ok=True)

    for p in paths:
        arr = np.asarray(Image.open(p).convert("RGBA"), dtype=np.uint8)
        before = wrap_error(arr)
        if a.check:
            verdict = "loops" if before < 8 else "visible" if before < 25 else "BAD"
            print(f"  {p.stem:16s} seam {before:6.1f}  {verdict}")
            continue
        fixed = make_seamless(arr, rng)
        after = wrap_error(fixed)
        Image.fromarray(fixed, "RGBA").save(out / f"{p.stem}.png", optimize=True)
        print(f"  {p.stem:16s} seam {before:6.1f} -> {after:5.1f}")

    if not a.check:
        print(f"\nwritten to {out}")


main()
