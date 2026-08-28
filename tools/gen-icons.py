#!/usr/bin/env python3
"""
Rasterise the Realm Seal.

Everything this writes is derived from `src/gfx/mark.json`, the same file
`src/ui/Mark.tsx` draws from, so the favicon and the wordmark in the header can
never drift apart. Nothing here is hand-tuned per output size.

    python tools/gen-icons.py [--sheet]

Writes:
    public/favicon.svg           the mark itself, vector, what modern browsers use
    public/favicon.png           128px, for the ones that do not
    public/apple-touch-icon.png  180px, opaque (iOS composites alpha onto white)
    public/pwa-192.png           192px install icon
    public/pwa-512.png           512px install icon
    public/pwa-maskable-512.png  512px safe-zone icon for adaptive launchers
    public/og.png                1200x630 social card
    .icons/sheet.png             contact sheet at real sizes, for eyeballing only

The strokes are drawn as polygons rather than with ImageDraw.line: this mark is
carved, which means butt caps and mitred joins, and a pen with round ends would
give that away at every size. Endpoints shared by two strokes are extended by
half the stroke width so the join fills solid instead of notching.
"""

import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = json.load(open(os.path.join(ROOT, "src/gfx/mark.json"), encoding="utf-8"))

C = MARK["colors"]
BOX = MARK["box"]
ALPHA = MARK["alphabet"]

SS = 4  # supersample factor; everything is drawn at SSx and resampled down


# -- stroke geometry --------------------------------------------------------

def _shared(strokes):
    """Endpoints touched by more than one stroke, rounded to avoid float noise."""
    seen = {}
    for x1, y1, x2, y2 in strokes:
        for p in ((round(x1, 3), round(y1, 3)), (round(x2, 3), round(y2, 3))):
            seen[p] = seen.get(p, 0) + 1
    return {p for p, n in seen.items() if n > 1}


def stroke_polys(strokes, weight):
    """Each stroke as a quad. Shared ends grow by w/2 so mitres fill solid."""
    joins = _shared(strokes)
    half = weight / 2.0
    out = []
    for x1, y1, x2, y2 in strokes:
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        ux, uy = dx / length, dy / length
        a = half if (round(x1, 3), round(y1, 3)) in joins else 0.0
        b = half if (round(x2, 3), round(y2, 3)) in joins else 0.0
        ax, ay = x1 - ux * a, y1 - uy * a
        bx, by = x2 + ux * b, y2 + uy * b
        nx, ny = -uy * half, ux * half
        out.append([(ax + nx, ay + ny), (bx + nx, by + ny),
                    (bx - nx, by - ny), (ax - nx, ay - ny)])
    return out


def draw_strokes(draw, strokes, weight, colour, scale):
    for poly in stroke_polys(strokes, weight):
        draw.polygon([(x * scale, y * scale) for x, y in poly], fill=colour)


# -- the seal ---------------------------------------------------------------

def seal(px, element="arcane", bezel=True, bg=None):
    """The mark at `px` square. `bg` fills the tile opaque; None keeps alpha."""
    s = px * SS
    img = Image.new("RGBA", (s, s), (tuple(bg) + (255,)) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    k = s / BOX

    if bezel:
        pts = MARK["bezel"]["points"]
        d.polygon([(x * k, y * k) for x, y in pts], fill=tuple(C["surface"]) + (235,))
        closed = pts + [pts[0]]
        edge = [[closed[i][0], closed[i][1], closed[i + 1][0], closed[i + 1][1]]
                for i in range(len(closed) - 1)]
        draw_strokes(d, edge, MARK["bezel"]["weight"], tuple(C["rune"]) + (150,), k)

    draw_strokes(d, MARK["rune"]["strokes"], MARK["rune"]["weight"],
                 tuple(C["rune"]) + (255,), k)
    draw_strokes(d, MARK["bind"]["strokes"], MARK["bind"]["weight"],
                 tuple(C[element]) + (255,), k)

    return img.resize((px, px), Image.LANCZOS)


# -- the carved wordmark ----------------------------------------------------

def lettering_strokes(text):
    """Strokes for a string, laid out on the shared advance, in glyph units."""
    strokes, x = [], 0.0
    for ch in text.upper():
        if ch == " ":
            x += ALPHA["space"]
            continue
        for x1, y1, x2, y2 in ALPHA["glyphs"].get(ch, []):
            strokes.append([x1 + x, y1, x2 + x, y2])
        x += ALPHA["advance"]
    width = x - (ALPHA["advance"] - 60) if strokes else 0
    return strokes, width


def lettering(text, box_px, colour):
    """`box_px` is the height of the 0..100 glyph box, not the cap height."""
    strokes, width = lettering_strokes(text)
    k = (box_px * SS) / BOX
    w = int(width * k) + SS
    h = int((ALPHA["capBottom"] + ALPHA["weight"] / 2) * k) + SS
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_strokes(ImageDraw.Draw(img, "RGBA"), strokes, ALPHA["weight"],
                 tuple(colour) + (255,), k)
    return img.resize((max(1, w // SS), max(1, h // SS)), Image.LANCZOS)


# -- vector -----------------------------------------------------------------

def hexcolour(name):
    return "#%02x%02x%02x" % tuple(C[name])


def favicon_svg(element="arcane"):
    """The same mark as SVG. Hand-assembled here so it stays byte-small."""
    def path(strokes):
        return "".join("M%s %sL%s %s" % tuple(s) for s in strokes)

    bez = "M" + "L".join("%s %s" % (x, y) for x, y in MARK["bezel"]["points"]) + "Z"
    return "".join([
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (BOX, BOX),
        '<path d="%s" fill="%s" stroke="%s" stroke-opacity=".5" stroke-width="%s"'
        ' stroke-linejoin="miter"/>'
        % (bez, hexcolour("void"), hexcolour("rune"), MARK["bezel"]["weight"]),
        '<path d="%s" fill="none" stroke="%s" stroke-width="%s"'
        ' stroke-linecap="butt" stroke-linejoin="miter"/>'
        % (path(MARK["rune"]["strokes"]), hexcolour("rune"), MARK["rune"]["weight"]),
        '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="butt"/>'
        % (path(MARK["bind"]["strokes"]), hexcolour(element), MARK["bind"]["weight"]),
        "</svg>",
    ])


# -- the social card --------------------------------------------------------

def og_card(w=1200, h=630):
    img = Image.new("RGB", (w, h), tuple(C["void"]))
    d = ImageDraw.Draw(img, "RGBA")

    # A ground glow in the element colour, so the card is lit the way the app is.
    for i in range(180, 0, -1):
        t = i / 180.0
        r = int(620 * t)
        d.ellipse([w // 2 - r, h + 140 - r // 3, w // 2 + r, h + 140 + r // 3],
                  fill=tuple(C["arcane"]) + (max(1, int(10 * (1 - t))),))

    mk = seal(200)
    img.paste(mk, (w // 2 - 100, 104), mk)

    word = lettering("Rune Realm", 92, C["rune"])
    img.paste(word, (w // 2 - word.width // 2, 350), word)

    # The rule under the name: element into bone-gold into nothing — the same
    # gradient `.rule-runic` draws under every screen title.
    y, half = 486, 300
    for i in range(half * 2):
        t = i / (half * 2)
        col = C["arcane"] if t < 0.3 else C["rune"]
        a = int(170 * (1 - t) ** 1.5)
        d.rectangle([w // 2 - half + i, y, w // 2 - half + i, y + 1],
                    fill=tuple(col) + (a,))

    return img


# -- outputs ----------------------------------------------------------------

def main():
    pub = os.path.join(ROOT, "public")
    os.makedirs(pub, exist_ok=True)

    with open(os.path.join(pub, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(favicon_svg())

    seal(128).save(os.path.join(pub, "favicon.png"))
    # iOS composites alpha onto white, which would put a bone-gold rune on a
    # white card. The touch icon is opaque on the void.
    seal(180, bg=C["void"]).save(os.path.join(pub, "apple-touch-icon.png"))
    seal(192, bg=C["void"]).save(os.path.join(pub, "pwa-192.png"))
    seal(512, bg=C["void"]).save(os.path.join(pub, "pwa-512.png"))

    # Adaptive launchers may crop icons into circles, shields, or squircles.
    # Keep the whole seal inside the maskable safe zone on the same void field.
    maskable = Image.new("RGBA", (512, 512), tuple(C["void"]) + (255,))
    maskable_mark = seal(384, bg=C["void"])
    maskable.paste(maskable_mark, (64, 64))
    maskable.save(os.path.join(pub, "pwa-maskable-512.png"))
    og_card().save(os.path.join(pub, "og.png"))

    if "--sheet" in sys.argv:
        out = os.path.join(ROOT, ".icons")
        os.makedirs(out, exist_ok=True)
        sheet = Image.new("RGB", (860, 300), tuple(C["void"]))
        x = 24
        for px in (16, 24, 32, 48, 64, 128):
            mk = seal(px)
            sheet.paste(mk, (x, 24 + (128 - px) // 2), mk)
            x += px + 22
        for i, el in enumerate(("ember", "tide", "gale", "stone")):
            mk = seal(72, element=el)
            sheet.paste(mk, (24 + i * 92, 178), mk)
        word = lettering("Rune Realm", 56, C["rune"])
        sheet.paste(word, (400, 196), word)
        sheet.save(os.path.join(out, "sheet.png"))
        print("wrote .icons/sheet.png")

    print("wrote public/favicon.svg, favicon.png, apple-touch-icon.png, pwa icons, og.png")


if __name__ == "__main__":
    main()
