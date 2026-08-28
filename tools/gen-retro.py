#!/usr/bin/env python
"""Run the SAME prompts through Retro Diffusion, for a head-to-head with PixelLab.

The prompts are imported from tools/gen-scenes.py rather than copied, so the
comparison stays honest: both engines get a byte-identical string, and the
only variable is the engine. A copied prompt list would drift the first time
one side was tuned and quietly turn the bake-off into a comparison of prompts.

Retro Diffusion facts worth not rediscovering (see RuneRealm-Assets/STYLE.md):
  * Auth header is `X-RD-Token`. Not Authorization, not Bearer.
  * Transparency is `remove_bg`. `remove_background` is accepted and IGNORED.
  * Minimum canvas is 64x64; 48x48 fails with a bare `inference_failed`.
  * The response field is `base64_images`, a list.
  * `credits` in the balance endpoint is a monthly free allowance that a
    384x216 render does NOT draw on -- it bills `balance` instead, about
    $0.03 an image. So "credits: 50" sitting still does not mean it is free.

  python tools/gen-retro.py --scenes zen-garden temple-fire sakura-court
  python tools/gen-retro.py --compare        # build the side-by-side sheet

Output goes to RuneRealm-Assets/_generated/bakeoff/rd/.
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

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "gen_scenes", pathlib.Path(__file__).parent / "gen-scenes.py")
gs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gs)

API = "https://api.retrodiffusion.ai/v1/inferences"
OUT = pathlib.Path("RuneRealm-Assets/_generated/bakeoff")
PIXELLAB = pathlib.Path("RuneRealm-Assets/_generated/scenes")


def find(scene):
    """The prompt, tail and canvas for a scene name, whichever family it is in."""
    for family, (prompts, w, h, tail) in gs.FAMILIES.items():
        if scene in prompts:
            return family, f"{prompts[scene]}, {tail}", w, h
    return None, None, None, None


def one(key, scene, prompt, w, h, dest):
    body = {"prompt": prompt, "width": w, "height": h, "num_images": 1,
            "prompt_style": "rd_fast__default"}
    req = urllib.request.Request(
        API, data=json.dumps(body).encode(),
        headers={"X-RD-Token": key, "Content-Type": "application/json"})
    started = time.time()
    try:
        d = json.load(urllib.request.urlopen(req, timeout=600))
    except urllib.error.HTTPError as e:
        return scene, None, f"HTTP {e.code} {e.read()[:160].decode(errors='replace')}"
    except Exception as e:                                  # noqa: BLE001
        return scene, None, str(e)
    imgs = d.get("base64_images") or []
    if not imgs:
        return scene, None, f"no image in reply ({list(d)})"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(base64.b64decode(imgs[0]))
    return scene, time.time() - started, (
        f"{d.get('credit_cost')} credit, ${d.get('remaining_balance', 0):.2f} left")


def compare():
    """Side-by-side sheet: PixelLab left, Retro Diffusion right, same prompt."""
    from PIL import Image, ImageDraw
    rd = sorted((OUT / "rd").glob("*.png"))
    if not rd:
        sys.exit("nothing generated yet")
    rows = []
    for r in rd:
        family, _, w, h = find(r.stem)
        pl = PIXELLAB / (family or "arena") / f"{r.stem}.png"
        if pl.exists():
            rows.append((r.stem, Image.open(pl).convert("RGB"),
                         Image.open(r).convert("RGB")))
    if not rows:
        sys.exit("no matching PixelLab plates to compare against")
    w, h = rows[0][1].size
    pad, label, head = 8, 14, 18
    sheet = Image.new("RGB", (w * 2 + pad * 3, head + len(rows) * (h + pad + label) + pad),
                      (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 4), "PixelLab pixflux", fill=(150, 220, 150))
    d.text((pad * 2 + w, 4), "Retro Diffusion rd_fast", fill=(220, 180, 140))
    for i, (name, a, b) in enumerate(rows):
        y = head + i * (h + pad + label)
        sheet.paste(a.resize((w, h), Image.NEAREST), (pad, y))
        sheet.paste(b.resize((w, h), Image.NEAREST), (pad * 2 + w, y))
        d.text((pad + 2, y + h + 2), name, fill=(190, 190, 200))
    dest = OUT / "_compare.png"
    sheet.save(dest)
    print(f"{len(rows)} pairs -> {dest}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", nargs="*", help="scene names from gen-scenes.py")
    ap.add_argument("--compare", action="store_true", help="build the side-by-side sheet")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()

    if a.compare and not a.scenes:
        compare()
        return

    key = os.environ.get("RETRO_DIFFUSION_API_KEY")
    if not key:
        sys.exit("RETRO_DIFFUSION_API_KEY is not set. `set -a; . ./.env.local; set +a`")

    jobs = []
    for scene in a.scenes or []:
        family, prompt, w, h = find(scene)
        if not prompt:
            print(f"  !! unknown scene: {scene}")
            continue
        dest = OUT / "rd" / f"{scene}.png"
        if dest.exists() and not a.force:
            print(f"  have  {scene}")
            continue
        jobs.append((key, scene, prompt, w, h, dest))
    if not jobs:
        print("nothing to generate")
    else:
        print(f"generating {len(jobs)} via Retro Diffusion (~$0.03 each)...")
        with futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
            for scene, secs, note in pool.map(lambda j: one(*j), jobs):
                print(f"  {'FAIL  ' if secs is None else 'ok    '}{scene:16s} "
                      f"{note if secs is None else f'{secs:5.1f}s  {note}'}")
    compare()


if __name__ == "__main__":
    main()
