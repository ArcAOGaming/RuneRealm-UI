#!/usr/bin/env python
"""Generate an asset family via the Retro Diffusion cloud API.

Gotchas learned the hard way, do not re-discover:
  * The background param is `remove_bg`. `remove_background` is silently
    ACCEPTED and silently IGNORED -- you get an opaque RGB image back.
  * Minimum canvas is 64x64. 48x48 returns a bare `inference_failed`.
  * Auth header is `X-RD-Token`, not Authorization/Bearer.
Credits: 1 per image on rd_fast. Check with GET /v1/inferences/credits.
"""
import base64, json, os, pathlib, sys, urllib.request, urllib.error

KEY  = os.environ["RETRO_DIFFUSION_API_KEY"]
OUT  = pathlib.Path("RuneRealm-Assets/_generated/berries_rd")
SIZE = 64
SEED = 7

TAIL = ("single color black outline, basic shading, light from upper left, "
        "game item icon, centered, plain background")
SUBJECTS = {
    "fire":  "a single round berry ringed with flame, deep red and orange",
    "water": "a single round berry beaded with water droplets, deep blue and cyan",
    "rock":  "a single round berry with a cracked grey stone rind, grey and brown",
    "air":   "a single round berry trailing white wind wisps, pale green and white",
}

OUT.mkdir(parents=True, exist_ok=True)
for element, subject in SUBJECTS.items():
    body = {"prompt": f"{subject}, {element} element, {TAIL}",
            "width": SIZE, "height": SIZE, "num_images": 1,
            "remove_bg": True, "seed": SEED}
    req = urllib.request.Request(
        "https://api.retrodiffusion.ai/v1/inferences",
        data=json.dumps(body).encode(),
        headers={"X-RD-Token": KEY, "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        print(f"  FAIL {element}: {e.code} {e.read()[:200].decode()}"); continue
    (OUT / f"berry-{element}.png").write_bytes(base64.b64decode(d["base64_images"][0]))
    print(f"  ok {element:6s} model={d['model']} cost={d['credit_cost']} "
          f"balance={d['remaining_balance']:.2f}")
