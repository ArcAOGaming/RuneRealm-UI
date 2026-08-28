/**
 * The Realm Seal, drawn to a canvas.
 *
 * `mark.json` is the geometry; `ui/Mark.tsx` turns it into SVG for the DOM and
 * `tools/gen-icons.py` into PNG for the browser tab. This is the third
 * consumer: anywhere the mark has to end up in a texture — cut into the vault's
 * lid, struck onto a card, burned into a shader — the pixels come from here
 * rather than from an image file.
 *
 * Strokes are drawn with butt caps and mitred joins, the same as everywhere
 * else. A rune is struck, not written, and a round pen gives that away.
 */
import mark from './mark.json';

export type MarkOptions = {
  /** Stroke colour for the rune and the bezel. */
  color?: string;
  /** Stroke colour for the bind bar. Defaults to `color`. */
  bind?: string;
  /** Draw the tablet around the rune. */
  bezel?: boolean;
  /** Fill behind the bezel, if any. */
  face?: string;
  /** 0..1. Below 1 the mark is struck partially, stave outwards. */
  progress?: number;
};

/** Every stroke of the mark in one list, in the 0..100 box, rune before bind. */
export function markStrokes(): number[][] {
  return [...mark.rune.strokes, ...mark.bind.strokes];
}

/** Draw the mark into a canvas, filling its backing-store box. */
export function drawMark(
  canvas: HTMLCanvasElement,
  { color = '#d6c8a2', bind, bezel = false, face, progress = 1 }: MarkOptions = {},
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const k = Math.min(w, h) / mark.box;
  const ox = (w - mark.box * k) / 2;
  const oy = (h - mark.box * k) / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, ox, oy);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 8;

  if (bezel) {
    ctx.beginPath();
    mark.bezel.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    if (face) { ctx.fillStyle = face; ctx.fill(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = mark.bezel.weight;
    ctx.stroke();
  }

  const run = (strokes: number[][], stroke: string, weight: number, from: number, total: number) => {
    const shown = Math.max(0, Math.min(strokes.length, Math.ceil(total * progress) - from));
    if (shown <= 0) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = weight;
    ctx.beginPath();
    for (let i = 0; i < shown; i++) {
      const [x1, y1, x2, y2] = strokes[i];
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  // The bind bar is struck last, so a partial progress reads as the rune being
  // cut and only then bound — which is the order it would actually be made in.
  const total = mark.rune.strokes.length + mark.bind.strokes.length;
  run(mark.rune.strokes, color, mark.rune.weight, 0, total);
  run(mark.bind.strokes, bind ?? color, mark.bind.weight, mark.rune.strokes.length, total);

  ctx.restore();
}
