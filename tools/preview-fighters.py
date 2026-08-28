#!/usr/bin/env python
"""Stand two fighters on every background plate, so the floor can be judged.

The fighters occupy the BOTTOM LEFT and BOTTOM RIGHT corners at the same
height and close on each other along one horizontal line. Whether a plate
supports that is the only question that matters about it, and it is
surprisingly hard to answer by looking at an empty plate: a clifftop, a
floating platform, a narrow bridge and a raised oval arena all read as "flat
ground in the lower third", and all of them put a fighter over a hole.

A colour-distance heuristic was tried first and thrown away -- in a dark
interior the bottom corners and the top of the frame are both dark, so "is
this corner sky?" flagged ten good plates out of eighteen. Compositing the
actual sprite at the actual size answers the question directly instead of
approximating it, and costs one contact sheet.

  python tools/preview-fighters.py 'RuneRealm-Assets/_generated/scenes/arena/*.png'

Writes `_fighters.png` next to the plates. Nothing else is touched.
"""
import argparse
import glob as globlib
import pathlib
import sys

from PIL import Image, ImageDraw

# A faction walk sheet: 4 columns x 6 rows of 64x64. Row 0 walks right, row 1
# walks left -- so the left fighter faces in and the right fighter faces back.
SHEET = pathlib.Path("src/assets/sprites/wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ.png")
COLS, ROWS = 4, 6

# Where they stand, as a fraction of plate width, and how far the feet sit above
# the bottom edge in plate pixels. Both are the numbers the scene will use.
INSET = 0.10
FOOT = 2


def fighters(sheet):
    fw, fh = sheet.width // COLS, sheet.height // ROWS
    right = sheet.crop((0, 0, fw, fh))                    # row 0, facing right
    left = sheet.crop((0, fh, fw, 2 * fh))                # row 1, facing left
    return right, left


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--scale", type=float, default=1.0, help="sprite scale on the plate")
    ap.add_argument("--cols", type=int, default=3)
    a = ap.parse_args()

    if not SHEET.exists():
        sys.exit(f"sprite sheet not found: {SHEET}")
    facing_right, facing_left = fighters(Image.open(SHEET).convert("RGBA"))

    paths = []
    for pat in a.files:
        paths += [pathlib.Path(h) for h in sorted(globlib.glob(pat))]
    paths = [p for p in paths if p.is_file() and not p.stem.startswith("_")]
    if not paths:
        sys.exit("nothing to preview")

    plates = []
    for p in paths:
        plate = Image.open(p).convert("RGBA")
        w, h = plate.size
        for sprite, at_left in ((facing_right, True), (facing_left, False)):
            s = sprite
            if a.scale != 1.0:
                s = s.resize((round(s.width * a.scale), round(s.height * a.scale)),
                             Image.NEAREST)
            x = round(w * INSET) if at_left else w - round(w * INSET) - s.width
            plate.alpha_composite(s, (x, h - s.height - FOOT))
        plates.append((p.stem, plate))

    pw, ph = plates[0][1].size
    cols = a.cols
    rows = (len(plates) + cols - 1) // cols
    pad, label = 8, 14
    sheet = Image.new("RGB", (cols * (pw + pad) + pad,
                              rows * (ph + pad + label) + pad), (18, 18, 22))
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(plates):
        x = pad + (i % cols) * (pw + pad)
        y = pad + (i // cols) * (ph + pad + label)
        sheet.paste(im.convert("RGB"), (x, y))
        draw.text((x + 2, y + ph + 2), name, fill=(190, 190, 200))
    dest = paths[0].parent / "_fighters.png"
    sheet.save(dest)
    print(f"{len(plates)} plates -> {dest}")


main()
