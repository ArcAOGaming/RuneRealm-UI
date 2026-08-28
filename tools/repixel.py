#!/usr/bin/env python
"""Find the native pixel grid of an upscaled image, and cut it back down to it.

Pixel art in this repo is shipped PRE-UPSCALED -- `src/assets/backgrounds/`
holds 227x128 art saved as 1816x1024 files. That is wrong twice over. It is
~40x the bytes it needs to be, and more importantly it throws away the one
thing the art has to tell the renderer: how big an art pixel is. Once the grid
is baked into the file, nothing downstream can land one art pixel on a whole
number of screen pixels, because nothing downstream knows what an art pixel is
any more. The scale stops being computed and starts being hoped about.

So the rule this tool enforces: **store art at native resolution, upscale at
draw time, by an integer, with nearest-neighbour.** Phaser's `pixelArt: true`
plus an integer camera zoom does exactly that for free, and cannot drift.

Most of the backgrounds have a second problem on top. They were upscaled with a
SMOOTH filter (or round-tripped through lossy WebP), so they hold 13k-220k
colours where the clean ones hold 248. Those are already not pixel art before
any renderer touches them, and no amount of drawing code recovers that -- but
this tool can, because a smooth upscale still leaves the original grid intact
underneath. Point-sampling the blocks pulls the original back out.

  python tools/repixel.py audit  'src/assets/backgrounds/*.png'
  python tools/repixel.py native 'src/assets/backgrounds/*.png' --out src/assets/backgrounds/native
  python tools/repixel.py palette 'src/assets/backgrounds/*.png' --out RuneRealm-Assets/palette.gpl

`audit` writes nothing. `native` only overwrites if `--out` IS the input
directory, and copies the originals to `<out>/_pre-repixel/` when it does.

HOW THE GRID IS FOUND, and why it is not the obvious way. The obvious measures
-- reconstruction error, or edge-frequency analysis -- both report a HARMONIC
of the true scale as readily as the scale itself: if 8 is right then 16, 24 and
32 all score well too, and on smooth low-contrast art they score better. Two
things fix that:

  1. Only exact divisors of BOTH dimensions are candidates. 1816 is 8x227 and
     227 is prime, so the scale can only be 1, 2, 4 or 8. Every harmonic is
     gone before anything is measured.
  2. The measure is intra-block deviation, not error. At the true scale every
     pixel inside a block is the same source pixel, so the deviation is zero;
     at twice the true scale a block spans four source pixels and the deviation
     jumps to the level of image detail. It cannot be fooled upward.
"""
import argparse
import collections
import glob as globlib
import pathlib
import shutil
import sys
from math import gcd

import numpy as np
from PIL import Image

# Intra-block colour deviation, averaged over the image, 0-255 per channel.
# These are not guesses -- measured across src/assets/backgrounds/: files that
# were upscaled cleanly score exactly 0.00 at their own scale, ones upscaled
# with a smooth filter score 0.41-0.79, one resampled off the grid scores 2.91,
# and the lossy one scores 5.18 at every scale.
EXACT = 0.02          # at or under this, the upscale was nearest-neighbour
RECOVERABLE = 1.5     # at or under this, the grid survives and can be pulled out

# More colours than this and the file was not authored as pixel art, or was
# resampled until it stopped being pixel art.
PIXEL_ART_COLOURS = 512

MAX_SCALE = 16


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def fourcc(path):
    """WebP files are named .png throughout this repo. Report what they are."""
    head = pathlib.Path(path).read_bytes()[:16]
    if head[:8] == bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]):
        return "PNG"
    if head[:4] == b"RIFF":
        tag = head[12:16].decode("latin1")
        return {"VP8L": "WebP/lossless", "VP8 ": "WebP/LOSSY",
                "VP8X": "WebP/ext"}.get(tag, "WebP/" + tag)
    return "?"


def candidates(w, h):
    """Every scale that could possibly be the upscale factor: divisors of both."""
    g = gcd(w, h)
    return [s for s in range(1, MAX_SCALE + 1) if g % s == 0]


def block_deviation(arr, s):
    """How much an sxs block varies internally, averaged over the image.

    Alpha-weighted, because a sprite sheet is mostly transparent padding and
    padding is uniform at every scale -- unweighted, a sheet scores 0.0 for any
    s and the detector happily reports the ceiling.
    """
    if s == 1:
        return 0.0
    h, w = arr.shape[:2]
    a = arr[: h // s * s, : w // s * s]
    rgb = a[..., :3].astype(np.float32).reshape(h // s, s, w // s, s, 3)
    alpha = a[..., 3].astype(np.float32).reshape(h // s, s, w // s, s)
    dev = rgb.std(axis=(1, 3)).mean(axis=-1)     # deviation, per block
    weight = alpha.mean(axis=(1, 3))             # opacity, per block
    total = weight.sum()
    return float((dev * weight).sum() / total) if total > 0 else 0.0


def native_grid(arr):
    """(scale, native_w, native_h, deviation) for the largest scale that holds."""
    h, w = arr.shape[:2]
    best = (1, w, h, 0.0)
    for s in candidates(w, h):
        if w // s < 8 or h // s < 8:
            break
        d = block_deviation(arr, s)
        if d <= RECOVERABLE:
            best = (s, w // s, h // s, d)
    return best


def downsample(arr, s):
    """One sample per block, taken from the block's CENTRE.

    A single sample, never a mean: a mean re-introduces the intermediate
    colours the block seams were smeared with, which is the exact thing being
    undone. On a clean upscale every pixel in the block is identical and the
    choice does not matter -- but on a smooth one the corner is the most
    contaminated pixel in the block and the centre is the least. Measured on
    the four smooth backgrounds, moving from corner to centre halves the colour
    count that survives (3004 -> 1477 on 19.png) at no cost to the clean ones.
    """
    return arr[s // 2::s, s // 2::s]


def _far_enough(a, b, spacing):
    """Whether two colours are far enough apart to both earn a palette slot.

    Weighted toward green the way perception is, and compared in gamma space
    on purpose -- unlike the smear in `snap_to`, which happened in linear
    light, this is a question about what a person can tell apart on a screen.
    """
    dr, dg, db = (a[0] - b[0]), (a[1] - b[1]), (a[2] - b[2])
    return (2 * dr * dr + 4 * dg * dg + 3 * db * db) >= spacing * spacing * 9


def read_palette(path):
    """The RGB triples out of a GIMP .gpl."""
    rows = []
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
            rows.append([int(p) for p in parts[:3]])
    if not rows:
        sys.exit("no colours in " + path)
    return np.array(rows, dtype=np.float32)


def snap_to(arr, palette):
    """Move every opaque pixel to its nearest entry in a fixed palette.

    Distance is in linear RGB, not sRGB. The smear happened in linear light, so
    that is where the nearest true colour is; matching in gamma space pulls
    dark pixels toward mid-greys and visibly lifts the shadows.
    """
    out = arr.copy()
    opaque = out[..., 3] > 0
    px = out[opaque][:, :3].astype(np.float32)

    def lin(c):
        return np.where(c <= 10.31475, c / 3294.6, ((c / 255 + 0.055) / 1.055) ** 2.4)

    d = ((lin(px)[:, None, :] - lin(palette)[None, :, :]) ** 2).sum(axis=2)
    out[opaque] = np.concatenate(
        [palette[d.argmin(axis=1)].astype(np.uint8), out[opaque][:, 3:]], axis=1)
    return out


def snap_self(arr, n):
    """Quantise onto a palette chosen from the image itself, by median cut.

    Cutting a smooth upscale down to its grid recovers the SHAPE exactly but
    not the COLOURS -- the filter smeared each block toward its neighbours, so
    even the centre sample is a few units off, and 227x128 of "a few units off"
    is 1,477 colours where the clean files hold 250.

    Median cut and not "keep the N most frequent": the smear here is pervasive,
    not a fringe. Measured on 19.png, the 64 most common colours cover only 62%
    of the pixels, so snapping to them would move a third of the image a long
    way. Median cut picks colours that REPRESENT the distribution rather than
    ones that merely recur, and lands 1,477 -> 127 with the art intact.

    Per-file, never global: these are separate scenes with separate palettes,
    and a desert snapped to a forest's 96 colours is worse than the smear.
    """
    rgb = Image.fromarray(arr[..., :3], "RGB")
    q = np.asarray(
        rgb.quantize(colors=n, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB"),
        dtype=np.uint8)
    return np.dstack([q, arr[..., 3]])


def colours(arr):
    """Distinct RGBA values, counting every transparent pixel as one colour."""
    flat = np.ascontiguousarray(arr.reshape(-1, 4)).copy()
    flat[flat[:, 3] == 0] = 0
    return len(np.unique(flat.view(np.dtype((np.void, 4)))))


def expand(patterns):
    out = []
    for pat in patterns:
        hits = sorted(globlib.glob(pat))
        if not hits:
            print("  !! no match: " + pat, file=sys.stderr)
        out += [pathlib.Path(h) for h in hits if pathlib.Path(h).is_file()]
    return out


def verdict(scale, dev, ncol, container):
    """What to do with this file.

    The two ways to score 1x are opposites and must not be reported the same
    way. Art AUTHORED at its native size is 1x with a handful of colours -- the
    sprite sheets are 256x384 in 12 colours, and there is nothing wrong with
    them. Art RESAMPLED off its grid is also 1x, but carries thousands. The
    colour count is what tells them apart, and reporting the first as broken
    would send someone to regenerate every finished asset in the repo.
    """
    if "LOSSY" in container:
        return "REGENERATE  lossy compression, grid is gone"
    if scale == 1:
        if ncol <= PIXEL_ART_COLOURS:
            return "NATIVE      already on its grid, nothing to do"
        return "REGENERATE  no grid and no palette -- resampled off it"
    if dev <= EXACT:
        return f"CLEAN       true {scale}x, just needs cutting down"
    if ncol > PIXEL_ART_COLOURS:
        return f"RECOVER     smooth {scale}x, grid survives underneath"
    return f"RECOVER     soft {scale}x"


def cmd_audit(a):
    paths = expand(a.files)
    if not paths:
        sys.exit("nothing to audit")
    head = ("file", "stored", "native", "up", "colours", "dev", "container")
    print(f"{head[0]:34s} {head[1]:>11s} {head[2]:>10s} {head[3]:>4s} "
          f"{head[4]:>8s} {head[5]:>6s}  {head[6]:14s} verdict")
    print("-" * 122)
    tally = collections.Counter()
    for p in paths:
        arr = load(p)
        h, w = arr.shape[:2]
        s, nw, nh, dev = native_grid(arr)
        ncol = colours(arr)
        cont = fourcc(p)
        v = verdict(s, dev, ncol, cont)
        tally[v.split()[0]] += 1
        print(f"{p.name:34s} {f'{w}x{h}':>11s} {f'{nw}x{nh}':>10s} {s:3d}x "
              f"{ncol:8d} {dev:6.2f}  {cont:14s} {v}")
    print("-" * 122)
    print("  ".join(f"{k}: {n}" for k, n in tally.most_common()))
    if tally["REGENERATE"]:
        print("\nREGENERATE means the grid cannot be recovered from this file. "
              "Re-author at native\nresolution -- see RuneRealm-Assets/STYLE.md.")


def cmd_native(a):
    paths = expand(a.files)
    if not paths:
        sys.exit("nothing to convert")
    # --snap self picks each file's own palette; --snap <file.gpl> forces a
    # shared one. Default is self: see snap_self on why global is wrong here.
    palette = None
    if a.snap and a.snap != "self":
        palette = read_palette(a.snap)
    out = pathlib.Path(a.out)
    # Only when --out would land on top of the inputs. Writing to a separate
    # directory leaves the originals exactly where they were, and a backup of
    # files nothing touched is 1.7MB of noise in `git status`.
    in_place = any(p.parent.resolve() == out.resolve() for p in paths)
    backup = out / "_pre-repixel"
    if not a.dry_run:
        out.mkdir(parents=True, exist_ok=True)
        if in_place:
            backup.mkdir(parents=True, exist_ok=True)

    skipped = 0
    for p in paths:
        arr = load(p)
        h, w = arr.shape[:2]
        s, nw, nh, dev = native_grid(arr)
        if s == 1:
            print(f"  skip  {p.name:28s} no grid -- regenerate, do not rescale")
            skipped += 1
            continue
        small = downsample(arr, s)
        before = colours(small)
        if a.snap and dev > EXACT:
            # Only the ones that need it. A clean file is already on a palette
            # of its own, so snapping it is a no-op at best and, against a
            # trimmed palette, a quiet degradation of art that was fine.
            small = snap_to(small, palette) if palette is not None                 else snap_self(small, a.colours)
        after = colours(small)
        moved = "" if after == before else f" -> {after} snapped"
        saved = 100 - round(100 * (nw * nh) / (w * h))
        verb = "would write" if a.dry_run else "write      "
        print(f"  {verb} {p.name:28s} {w}x{h} -> {nw}x{nh}  "
              f"({s}x, dev {dev:.2f}, {before} colours{moved}, -{saved}% px)")
        if a.dry_run:
            continue
        if in_place:
            shutil.copy2(p, backup / p.name)
        # Always PNG out. A lossless WebP named .png is a trap the next person
        # falls into; a lossy one silently undoes what this tool just did.
        Image.fromarray(small, "RGBA").save(out / (p.stem + ".png"), optimize=True)

    if skipped:
        print(f"\n{skipped} file(s) skipped. Run `audit` for why.")


def cmd_palette(a):
    """Lock a palette from art already on its native grid. STYLE.md's open TODO."""
    paths = expand(a.files)
    if not paths:
        sys.exit("nothing to sample")
    counts = collections.Counter()
    used = 0
    for p in paths:
        arr = load(p)
        s, nw, nh, dev = native_grid(arr)
        if dev > EXACT:
            # A smooth upscale's seam colours are artefacts, not palette
            # entries, and there are thousands of them -- sampling one would
            # swamp the real palette with mud. Run `native` on it first.
            print(f"  skip  {p.name} (dev {dev:.2f}, not on its grid)")
            continue
        small = downsample(arr, s)
        # dev 0.00 is necessary and NOT sufficient: a file that was resampled
        # off its grid entirely scores 1x with a deviation of zero, because a
        # 1x1 block cannot vary. Those are the ones carrying 200,000 colours,
        # and letting six of them in put 437,000 colours into a palette that
        # should have seen 3,000.
        if colours(small) > PIXEL_ART_COLOURS:
            print(f"  skip  {p.name} ({colours(small)} colours, not pixel art)")
            continue
        opaque = small.reshape(-1, 4)
        counts.update(map(tuple, opaque[opaque[:, 3] > 200][:, :3].tolist()))
        used += 1

    if not used:
        sys.exit("no clean art to sample -- run `native` first")
    # Greedy by frequency, but skipping anything already covered. Taking the
    # top N outright puts #0f1524 and #101524 in the same palette -- one unit
    # apart, indistinguishable, and between them a wasted pair of slots. Each
    # scene contributes ~250 colours of its own, so without this the palette is
    # mostly one biome's gradients at sub-JND spacing.
    picked = []
    for colour, _ in counts.most_common():
        if len(picked) >= a.size:
            break
        if all(_far_enough(colour, seen, a.spacing) for seen in picked):
            picked.append(colour)
    # Sorted by luma so the file reads as a ramp rather than a histogram.
    picked.sort(key=lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    lines = ["GIMP Palette", "Name: RuneRealm", "Columns: 16",
             f"# {len(picked)} of {len(counts)} colours, from {used} files", "#"]
    lines += [f"{r:3d} {g:3d} {b:3d}\t#{r:02x}{g:02x}{b:02x}" for r, g, b in picked]
    text = "\n".join(lines) + "\n"
    print(f"{len(counts)} distinct colours across {used} files; "
          f"keeping the {len(picked)} most used")
    if a.dry_run:
        print(text)
        return
    pathlib.Path(a.out).write_text(text, encoding="utf-8")
    print("wrote " + a.out)


ap = argparse.ArgumentParser(
    description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest="cmd", required=True)

s_audit = sub.add_parser("audit", help="report each file's native grid; writes nothing")
s_audit.add_argument("files", nargs="+")
s_audit.set_defaults(fn=cmd_audit)

s_native = sub.add_parser("native", help="cut each file back down to its native grid")
s_native.add_argument("files", nargs="+")
s_native.add_argument("--out", required=True)
s_native.add_argument("--snap", nargs="?", const="self", metavar="self|PALETTE.GPL",
                      help="re-quantise recovered files; 'self' (default) picks "
                           "each file's own palette by median cut")
s_native.add_argument("--colours", type=int, default=128,
                      help="palette size for --snap self (default 128)")
s_native.add_argument("--dry-run", action="store_true")
s_native.set_defaults(fn=cmd_native)

s_pal = sub.add_parser("palette", help="extract a locked palette.gpl from clean art")
s_pal.add_argument("files", nargs="+")
s_pal.add_argument("--out", default="RuneRealm-Assets/palette.gpl")
s_pal.add_argument("--size", type=int, default=64)
s_pal.add_argument("--spacing", type=float, default=6.0,
                   help="minimum perceptual gap between entries (default 6)")
s_pal.add_argument("--dry-run", action="store_true")
s_pal.set_defaults(fn=cmd_palette)

args = ap.parse_args()
args.fn(args)
