#!/usr/bin/env python
"""Generate a berry set via PixelLab bitforge, style-matched to an existing sprite.

Style ref must be EXACTLY the target canvas (the API rejects a mismatch), which
is why tools/normalize-canvas.py runs first. Output goes to a staging dir --
nothing in src/assets/art/ is touched. Compare, then copy the ones you like.
"""
import base64, json, os, pathlib, sys, urllib.request, urllib.error

KEY   = os.environ["PIXELLAB_API_KEY"]
SIZE  = 48
REF   = pathlib.Path("src/assets/art/berry-fire.png")     # normalised 48x48
OUT   = pathlib.Path("RuneRealm-Assets/_generated/berries")

# Trailing clause is copied verbatim from RuneRealm-Assets/STYLE.md.
TAIL = ("single color black outline, basic shading, light from upper left, "
        "transparent background")
SUBJECTS = {
    "fire":  "a small round berry wreathed in flame, deep red and orange",
    "water": "a small round berry beaded with water, deep blue and cyan",
    "rock":  "a small round berry with a rough stone rind, brown and grey",
    "air":   "a small round berry trailing wind wisps, pale green and white",
}
SEED = 7  # fixed -- STYLE.md repeatability rule

OUT.mkdir(parents=True, exist_ok=True)
ref_b64 = base64.b64encode(REF.read_bytes()).decode()

for element, subject in SUBJECTS.items():
    body = {
        "description": f"{subject}, {element} element, {TAIL}",
        "image_size": {"width": SIZE, "height": SIZE},
        "style_image": {"type": "base64", "base64": ref_b64},
        "seed": SEED,
    }
    req = urllib.request.Request(
        "https://api.pixellab.ai/v1/generate-image-bitforge",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    )
    try:
        d = json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        print(f"  FAIL  {element}: HTTP {e.code} {e.read()[:200].decode()}")
        continue
    dest = OUT / f"berry-{element}.png"
    dest.write_bytes(base64.b64decode(d["image"]["base64"]))
    print(f"  ok    {dest}  ({d['usage']['generations']} gen)")
