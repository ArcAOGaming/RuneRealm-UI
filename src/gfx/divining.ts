/**
 * The divining seal — what the interface does while it reads you off the chain.
 *
 * A spinner says "software is busy". This says what is actually happening: a
 * seal is turning, and marks are being read out of it one after another. The
 * marks are real sigils — the same `sigilStrokes` geometry the wallet chip
 * draws — so the thing you watch during the wait is literally the thing that
 * appears when the wait ends.
 *
 * Canvas 2D, one draw call per frame, no allocation in the loop. It sits behind
 * a single element on one screen; a shader here would cost more than it earns
 * (the aether is the one place that trade goes the other way).
 */
import { sigilStrokes } from './sigil';

/** Rune gold, from `--rune` in index.css. Fixed across elements, so inlined. */
const RUNE = '214, 200, 162';

/** One mark per cycle, each a different rune. Fixed so the sequence is stable. */
const MARKS = [
  'aH3kQ9', 'ZmR4tP', 'x7Lc2V', 'Ne8sWq', 'B5vJd1', 'Tk0yUf',
];

const CYCLE = 2600;   // ms a single mark is on screen, start to finish
const INSCRIBE = 0.5; // fraction of the cycle spent drawing the mark on
const HOLD = 0.78;    // ...and the point at which it starts fading out

export type DiviningColors = {
  /** The element chroma, as `r, g, b`. */
  element: string;
};

/**
 * Draw one frame.
 *
 * `t` is milliseconds since the animation started, so the whole thing is a pure
 * function of time — pausing and resuming cannot desynchronise the rings.
 */
export function drawDivining(
  canvas: HTMLCanvasElement,
  t: number,
  { element }: DiviningColors,
  { still = false }: { still?: boolean } = {},
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || parseFloat(canvas.style.width) || 160));
  const h = Math.max(1, Math.round(rect.height || parseFloat(canvas.style.height) || 160));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2;
  const time = still ? 0 : t / 1000;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The light the seal sits in. Without it the rings float on flat black and
  // the whole thing reads as a diagram rather than something lit from inside.
  const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 1.6);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, `rgba(${element}, ${0.16 + 0.07 * breath})`);
  glow.addColorStop(0.55, `rgba(${element}, 0.05)`);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Ring one: the ticked rim. Sixty marks, of which every fifth is long — a
  // dial, so the rotation is legible rather than a featureless circle.
  ring(ctx, cx, cy, R * 0.94, 60, time * 0.10, (i) => ({
    length: i % 5 === 0 ? R * 0.075 : R * 0.04,
    width: i % 5 === 0 ? 1.4 : 1,
    color: `rgba(${RUNE}, ${i % 5 === 0 ? 0.6 : 0.28})`,
  }));

  // Ring two: three arcs, turning the other way. Gaps matter more than the
  // strokes — a solid circle would read as a progress ring, which this is not.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-time * 0.32);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `rgba(${RUNE}, 0.45)`;
  for (let i = 0; i < 3; i++) {
    const from = (i * 2 * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.8, from, from + 1.35);
    ctx.stroke();
  }
  ctx.restore();

  // Ring three: twelve short spokes at the inner edge, faster again. Three
  // speeds in three directions is what makes it read as a mechanism.
  ring(ctx, cx, cy, R * 0.66, 12, time * 0.55, () => ({
    length: R * 0.055,
    width: 1.2,
    color: `rgba(${element}, 0.5)`,
  }));

  // The reading sweep: a bright head with a decaying tail, once around every
  // four seconds. This is the part that says "in progress" without a bar.
  if (!still) {
    const head = (time * (Math.PI / 2)) % (Math.PI * 2);
    const steps = 42;
    ctx.lineWidth = 2.2;
    for (let i = 0; i < steps; i++) {
      const a = head - i * 0.03;
      const fade = (1 - i / steps) ** 2.4;
      ctx.strokeStyle = `rgba(${element}, ${0.75 * fade})`;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.87, a - 0.03, a);
      ctx.stroke();
    }
    // The head itself, with a glow, so the eye has something to follow.
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = `rgb(${element})`;
    ctx.fillStyle = `rgb(${element})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(head) * R * 0.87, cy + Math.sin(head) * R * 0.87, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The mark in the middle: inscribed stroke by stroke, held, then let go as
  // the next one is drawn. Reading one account is reading many marks.
  const phase = still ? INSCRIBE : ((t % (CYCLE * MARKS.length)) / CYCLE);
  const index = Math.floor(phase) % MARKS.length;
  const p = phase - Math.floor(phase);

  const progress = Math.min(1, p / INSCRIBE);
  const alpha = p < HOLD ? 1 : 1 - (p - HOLD) / (1 - HOLD);

  const strokes = sigilStrokes(MARKS[index]);
  const shown = Math.max(1, Math.ceil(strokes.length * progress));
  const box = R * 0.62;

  ctx.save();
  ctx.translate(cx - box / 2, cy - box / 2);
  ctx.lineWidth = 2.6;
  ctx.shadowBlur = 18;
  ctx.shadowColor = `rgb(${element})`;
  ctx.strokeStyle = `rgba(${element}, ${alpha})`;
  ctx.beginPath();
  for (let i = 0; i < shown; i++) {
    const s = strokes[i];
    // The stroke currently being cut is drawn part-way, so the inscription is
    // continuous rather than a stack of whole lines appearing.
    const partial = i === shown - 1 ? (strokes.length * progress) % 1 || 1 : 1;
    ctx.moveTo(s.x1 * box, s.y1 * box);
    ctx.lineTo(s.x1 * box + (s.x2 - s.x1) * box * partial,
               s.y1 * box + (s.y2 - s.y1) * box * partial);
  }
  ctx.stroke();
  ctx.restore();

  // Embers lifting off the seal. Deterministic from the index, so they are a
  // fixed constellation moving rather than noise reseeded every frame.
  if (!still) {
    for (let i = 0; i < 14; i++) {
      const seed = i * 0.618;
      const life = ((time * 0.22 + seed) % 1);
      const a = (seed * Math.PI * 2 * 3.7) % (Math.PI * 2);
      const r = R * (0.2 + 0.62 * ((seed * 5.3) % 1));
      const drift = Math.sin(time * 0.8 + i) * R * 0.03;
      const x = cx + Math.cos(a) * r + drift;
      const y = cy + Math.sin(a) * r - life * R * 0.55;
      ctx.fillStyle = `rgba(${element}, ${0.5 * (1 - life) * (1 - life)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + 0.9 * (1 - life), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Evenly spaced radial ticks, rotated. */
function ring(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number, count: number, rotation: number,
  tick: (i: number) => { length: number; width: number; color: string },
) {
  for (let i = 0; i < count; i++) {
    const a = rotation + (i * Math.PI * 2) / count;
    const { length, width, color } = tick(i);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + c * radius, cy + s * radius);
    ctx.lineTo(cx + c * (radius - length), cy + s * (radius - length));
    ctx.stroke();
  }
}
