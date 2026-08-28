#!/usr/bin/env python
"""Key a flat background out of a generated layer.

`no_background: true` is a request, not a guarantee. Asked for a transparent
bamboo strip, PixelLab returned a 100%-opaque image with the bamboo sitting on
flat white -- which, composited over a sky, hides the sky completely. The
`far` layer in the same batch DID come back transparent, so it is not a
setting that is wrong, it is a coin flip.

Keying it afterwards is reliable in a way that asking is not. The background
is a single flat colour, so a flood fill inward from the edges finds exactly
it and nothing else: an interior pixel of the same white -- a highlight on a
lantern -- is never reached, because the fill cannot cross the subject to get
there. A global "delete every white pixel" would punch holes in the art.

  python tools/key-background.py 'RuneRealm-Assets/_generated/paths/*/mid.png'
"""
import argparse
import collections
import glob as globlib
import pathlib
import sys

import numpy as np
from PIL import Image


def key(arr, tol):
    h, w = arr.shape[:2]
    rgb = arr[..., :3].astype(np.int16)

    # The background colour is whatever the corners agree on.
    corners = [tuple(rgb[0, 0]), tuple(rgb[0, w - 1]),
               tuple(rgb[h - 1, 0]), tuple(rgb[h - 1, w - 1])]
    bg = np.array(collections.Counter(corners).most_common(1)[0][0], dtype=np.int16)

    near = (np.abs(rgb - bg).max(axis=2) <= tol)

    # Flood fill inward from every edge pixel that matches. Iterative dilation
    # masked by `near` -- reaches the whole connected background and stops at
    # the subject's outline.
    reach = np.zeros((h, w), bool)
    reach[0, :] |= near[0, :]
    reach[-1, :] |= near[-1, :]
    reach[:, 0] |= near[:, 0]
    reach[:, -1] |= near[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= near
        if grown.sum() == reach.sum():
            break
        reach = grown

    out = arr.copy()
    out[reach, 3] = 0
    return out, reach.mean()


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--tol", type=int, default=12, help="per-channel tolerance")
    a = ap.parse_args()

    paths = []
    for pat in a.files:
        paths += [pathlib.Path(x) for x in sorted(globlib.glob(pat))]
    paths = [p for p in paths if p.is_file()]
    if not paths:
        sys.exit("nothing to key")

    for p in paths:
        arr = np.asarray(Image.open(p).convert("RGBA"), dtype=np.uint8)
        before = (arr[..., 3] > 8).mean()
        out, removed = key(arr, a.tol)
        after = (out[..., 3] > 8).mean()
        Image.fromarray(out, "RGBA").save(p, optimize=True)
        print(f"  {p.parent.name}/{p.stem:8s} opaque {before*100:5.1f}% -> "
              f"{after*100:5.1f}%  ({removed*100:.0f}% keyed out)")


main()
