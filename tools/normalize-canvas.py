#!/usr/bin/env python
"""Pad pixel-art PNGs onto a uniform canvas without resampling.

Content is never scaled or cropped -- only transparent padding is added, so
every pixel survives byte-identical. Enforces the canvas rule in
RuneRealm-Assets/STYLE.md: one family, one canvas.

  python tools/normalize-canvas.py --size 48x48 --align center src/assets/art/berry-*.png
  python tools/normalize-canvas.py --size 320x448 --align bottom src/assets/art/dragon-*.png

Originals are copied to <dir>/_pre-normalize/ before anything is written.
"""
import argparse, pathlib, shutil, sys
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--size", required=True, help="WxH target canvas, e.g. 48x48")
ap.add_argument("--align", default="center", choices=["center", "bottom"],
                help="center for item icons; bottom for characters (feet on baseline)")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("files", nargs="+")
a = ap.parse_args()

TW, TH = (int(v) for v in a.size.lower().split("x"))
paths = [pathlib.Path(p) for p in a.files if pathlib.Path(p).is_file()]
if not paths:
    sys.exit("no matching files")

fail = []
for p in paths:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    if (w, h) == (TW, TH):
        print(f"  skip  {p.name:22s} already {TW}x{TH}")
        continue
    if w > TW or h > TH:
        fail.append(f"{p.name} is {w}x{h}, larger than target {TW}x{TH}")
        continue

    x = (TW - w) // 2
    y = TH - h if a.align == "bottom" else (TH - h) // 2

    print(f"  pad   {p.name:22s} {w}x{h} -> {TW}x{TH}  at ({x},{y})")
    if a.dry_run:
        continue

    backup = p.parent / "_pre-normalize"
    backup.mkdir(exist_ok=True)
    if not (backup / p.name).exists():
        shutil.copy2(p, backup / p.name)

    canvas = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
    canvas.paste(im, (x, y))          # paste, not alpha_composite -- no blending
    canvas.save(p, "PNG", optimize=True)

if fail:
    print("\nERROR -- content larger than target canvas, nothing written for:")
    for f in fail:
        print("  " + f)
    sys.exit(1)
print("\ndone" + (" (dry run)" if a.dry_run else ""))
