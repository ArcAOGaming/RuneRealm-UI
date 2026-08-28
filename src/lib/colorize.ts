/**
 * Recolouring a garment.
 *
 * Every layer in `src/assets/<Category>/` is drawn in exactly five greys —
 * 64, 108, 144, 176 and 200 — with a pure black outline and, on one hair
 * option, a couple of pink accents. That is not a coincidence: the art was cut
 * that way so a garment could be tinted at runtime without a separate sheet per
 * colour. Verified against the shipped PNGs; every one of them uses those five
 * values and nothing between them.
 *
 * So the tint is a five-rung LADDER, not a multiply. The chosen colour lands on
 * the middle rung and the other four are lit or shaded around it, which keeps
 * the artist's shading intact: a shirt tinted red still has a dark fold and a
 * highlight, at the same places and the same relative strength. Multiplying the
 * grey by the colour — the obvious one line, and what `colorUtils.ts` in the
 * parked customiser did — collapses that, because the darkest grey multiplied
 * by a dark colour is very nearly black and the highlight disappears.
 *
 * Two pixels are deliberately never touched:
 *
 *   - anything that is not grey (`|r-g|`, `|g-b|`, `|r-b|` all within
 *     tolerance). The pink in `Hair/Long.png` survives a tint, which is what
 *     makes it a bow rather than part of the hair.
 *   - the black outline. It reads as a line, not as a shade, and tinting it
 *     turns crisp pixel art into a coloured smudge. It falls out for free:
 *     black is 64 away from the nearest rung and the tolerance is 6.
 */

export type RGB = { r: number; g: number; b: number };

/** The five greys the layer art is drawn in, darkest first. */
export const GREY_RAMP = [64, 108, 144, 176, 200] as const;

/**
 * Where each rung sits relative to the chosen colour.
 *
 * The middle rung IS the colour, so the swatch you pick is the colour you get
 * on the largest area of the garment. The parked version used ±0.35/±0.20,
 * which was flat enough that a mid-tone shirt read as one solid shape; this is
 * a little wider so the folds still show at small sizes.
 */
const SHIFT = [-0.46, -0.23, 0, 0.23, 0.46] as const;

/**
 * How far a pixel may sit from a rung and still count as that rung.
 *
 * Six, not one: these are PNGs that have been through more than one editor, and
 * a 143 where the artist meant 144 must not be left grey in the middle of a
 * red shirt. Wide enough to absorb that, far too narrow to catch black.
 */
const TOLERANCE = 6;

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x969696;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Lit (`amount > 0`) or shaded (`amount < 0`), towards white or towards black. */
export function shift(c: RGB, amount: number): RGB {
  if (amount === 0) return c;
  const t = Math.abs(amount);
  const to = amount > 0 ? 255 : 0;
  return {
    r: Math.round(c.r + (to - c.r) * t),
    g: Math.round(c.g + (to - c.g) * t),
    b: Math.round(c.b + (to - c.b) * t),
  };
}

/** The five rungs a colour produces, darkest first. Also drawn as the swatch. */
export function ramp(hex: string): RGB[] {
  const base = hexToRgb(hex);
  return SHIFT.map((amount) => shift(base, amount));
}

/**
 * Relative luminance, 0..1. Used to decide whether a swatch needs a dark or a
 * pale tick drawn on it — a white swatch with a white tick is an empty square.
 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Recolour in place.
 *
 * A 256-entry lookup rather than a search per pixel: a full sheet is 576x60 and
 * the wardrobe recomposites it on every drag of a colour, so this runs at
 * pointer rate. Building the table costs 256 iterations once and turns the
 * inner loop into three comparisons and an array read.
 */
export function recolour(data: Uint8ClampedArray, hex: string): void {
  const rungs = ramp(hex);

  // -1 means "this grey value is not one of the rungs" — leave the pixel alone.
  const lut = new Int32Array(256).fill(-1);
  for (let v = 0; v < 256; v++) {
    let best = -1;
    let distance = 256;
    for (let i = 0; i < GREY_RAMP.length; i++) {
      const d = Math.abs(v - GREY_RAMP[i]);
      if (d < distance) { distance = d; best = i; }
    }
    if (distance <= TOLERANCE && best >= 0) {
      const { r, g, b } = rungs[best];
      lut[v] = (r << 16) | (g << 8) | b;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Not a grey: an accent the artist chose on purpose. Leave it.
    if (Math.abs(r - g) > TOLERANCE) continue;
    if (Math.abs(g - b) > TOLERANCE) continue;
    if (Math.abs(r - b) > TOLERANCE) continue;

    const packed = lut[Math.round((r + g + b) / 3)];
    if (packed < 0) continue;
    data[i] = (packed >> 16) & 255;
    data[i + 1] = (packed >> 8) & 255;
    data[i + 2] = packed & 255;
  }
}
