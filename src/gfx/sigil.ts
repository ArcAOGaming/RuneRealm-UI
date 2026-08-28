/**
 * The sigil — a rune drawn from a wallet address.
 *
 * This is the one thing in the interface meant to be remembered, and it comes
 * straight out of the subject: on this chain your address IS your identity, so
 * the interface turns it into a mark rather than showing you 43 characters of
 * base64 and calling that a name.
 *
 * It is deterministic — the same address always draws the same rune — and it is
 * built the way a rune is built rather than the way a hash-avatar is: a stave
 * down the middle, then branches struck off it at angles, then a small number
 * of bind marks. The address decides how many, where, and at what angle. No
 * curves, no gradients, no per-pixel noise: everything is a stroke, because
 * everything here is carved.
 *
 * Canvas 2D rather than WebGL: these are small, there are several on screen at
 * once, and crisp hairlines at 24px matter more than shading.
 */

/** FNV-1a, so the bits are well mixed before anything reads them. */
function hashBytes(input: string): Uint32Array {
  const out = new Uint32Array(8);
  for (let seed = 0; seed < 8; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out[seed] = h >>> 0;
  }
  return out;
}

/** A small deterministic PRNG seeded from the hash. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export type SigilOptions = {
  /** Stroke colour. Defaults to the current text colour. */
  color?: string;
  /** Stroke width in CSS pixels at 1x. */
  weight?: number;
  /**
   * 0 to 1. Below 1 the rune is drawn partially, from the stave outwards — the
   * inscription in progress.
   */
  progress?: number;
};

type Stroke = { x1: number; y1: number; x2: number; y2: number };

/**
 * The strokes of one address's rune, in a 0..1 box.
 *
 * Split out from drawing so the same geometry can be measured, animated, or
 * rendered somewhere other than a canvas.
 */
export function sigilStrokes(address: string): Stroke[] {
  const h = hashBytes(address || 'unclaimed');
  const rand = rng(h[0] ^ h[4]);
  const strokes: Stroke[] = [];

  // The stave: one vertical spine, always present. It is what makes a set of
  // marks read as a single rune rather than as scattered lines.
  const top = 0.12;
  const bottom = 0.88;
  strokes.push({ x1: 0.5, y1: top, x2: 0.5, y2: bottom });

  // Branches struck off the stave. Three to five, alternating sides more often
  // than not, at angles drawn from a fixed set — runes use a small vocabulary
  // of angles, and picking freely from 360° looks like scribble, not writing.
  const ANGLES = [-60, -45, -30, 30, 45, 60];
  const count = 3 + (h[1] % 3);
  let side = h[2] & 1 ? 1 : -1;

  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const y = top + (bottom - top) * t;
    // Mostly alternate, occasionally repeat — perfect alternation reads as a
    // pattern rather than a glyph.
    if (rand() > 0.28) side = -side;
    const angle = (ANGLES[Math.floor(rand() * ANGLES.length)] * Math.PI) / 180;
    const len = 0.20 + rand() * 0.16;
    strokes.push({
      x1: 0.5,
      y1: y,
      x2: 0.5 + Math.cos(angle) * len * side,
      y2: y + Math.sin(angle) * len,
    });
  }

  // Bind marks: short crossbars over the stave. Zero to two, because a rune
  // with a crossbar on every branch stops looking carved and starts looking
  // like a circuit diagram.
  const binds = h[3] % 3;
  for (let i = 0; i < binds; i++) {
    const y = top + (bottom - top) * (0.25 + rand() * 0.5);
    const w = 0.10 + rand() * 0.10;
    strokes.push({ x1: 0.5 - w, y1: y, x2: 0.5 + w, y2: y });
  }

  // A foot or a crown, but never both: one asymmetry is character, two is noise.
  if (h[5] & 1) {
    const w = 0.12 + rand() * 0.08;
    const atTop = (h[6] & 1) === 1;
    const y = atTop ? top : bottom;
    strokes.push({ x1: 0.5 - w, y1: y, x2: 0.5 + w, y2: y + (atTop ? 0.07 : -0.07) });
  }

  return strokes;
}

/** Draw a sigil into a canvas, sized to the canvas's CSS box. */
export function drawSigil(
  canvas: HTMLCanvasElement,
  address: string,
  { color, weight = 1.5, progress = 1 }: SigilOptions = {},
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  // A canvas that is not laid out yet measures 0x0, and drawing into a 1x1
  // fails silently — which looks exactly like a broken sigil. Fall back to the
  // declared size so it draws something correct either way.
  const w = Math.max(1, Math.round(rect.width || parseFloat(canvas.style.width) || 24));
  const h = Math.max(1, Math.round(rect.height || parseFloat(canvas.style.height) || 24));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const strokes = sigilStrokes(address);
  const shown = Math.max(1, Math.ceil(strokes.length * Math.max(0, Math.min(1, progress))));

  ctx.strokeStyle = color ?? getComputedStyle(canvas).color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const pad = weight * 2;
  const sx = (v: number) => pad + v * (w - pad * 2);
  const sy = (v: number) => pad + v * (h - pad * 2);

  ctx.beginPath();
  for (let i = 0; i < shown; i++) {
    const s = strokes[i];
    ctx.moveTo(sx(s.x1), sy(s.y1));
    ctx.lineTo(sx(s.x2), sy(s.y2));
  }
  ctx.stroke();
}
