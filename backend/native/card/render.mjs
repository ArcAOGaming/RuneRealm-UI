/**
 * render.mjs — the worker's painter.
 *
 * Takes the ops from `src/lib/card/layout.mjs` and turns them into a PNG. The
 * browser paints the same ops onto a canvas for the preview; keeping the layout
 * in one module and the painting in two is the whole point, because the picture
 * a player approves and the picture that gets signed have to be the same
 * picture.
 *
 * Compositing is straight (non-premultiplied) source-over, integer maths, no
 * resampling anywhere: a blit copies whole pixels and text is axis-aligned
 * rectangles. That is not a shortcut, it is the art spec — pixel art that gets
 * resampled turns to mush, and this output is permanent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetsFor, cardPlan } from '../../../src/lib/card/layout.mjs';
import { decodePng, encodePng } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSET_ROOT = path.join(HERE, '..', '..', '..', 'src', 'assets');

/**
 * Decoded plates, kept for the life of the process.
 *
 * A mint run composites one card per queued monster and they share almost every
 * plate; decoding a 648x1065 RGBA image is ~2.7 MB of inflate each time. Ten
 * cards without this cache is ten times the work for the same nine plates.
 */
const cache = new Map();

export function loadAsset(rel) {
  let image = cache.get(rel);
  if (!image) {
    const file = path.join(ASSET_ROOT, ...rel.split('/'));
    image = decodePng(fs.readFileSync(file));
    cache.set(rel, image);
  }
  return image;
}

/** src over dst, both straight-alpha RGBA. */
function blend(dst, di, sr, sg, sb, sa) {
  if (sa === 0) return;
  if (sa === 255) {
    dst[di] = sr; dst[di + 1] = sg; dst[di + 2] = sb; dst[di + 3] = 255;
    return;
  }
  const da = dst[di + 3];
  const inv = 255 - sa;
  const outA = sa + ((da * inv + 127) / 255 | 0);
  if (outA === 0) {
    dst[di] = dst[di + 1] = dst[di + 2] = dst[di + 3] = 0;
    return;
  }
  // Weight each source by its own alpha, the destination by what is left of it.
  const mix = (s, d) => ((s * sa * 255 + d * da * inv + (outA * 255) / 2) / (outA * 255)) | 0;
  dst[di] = mix(sr, dst[di]);
  dst[di + 1] = mix(sg, dst[di + 1]);
  dst[di + 2] = mix(sb, dst[di + 2]);
  dst[di + 3] = outA;
}

function drawImage(canvas, w, h, image, op) {
  const sx = op.sx ?? 0;
  const sy = op.sy ?? 0;
  const sw = op.sw ?? image.width;
  const sh = op.sh ?? image.height;
  for (let y = 0; y < sh; y++) {
    const ty = (op.dy ?? 0) + y;
    if (ty < 0 || ty >= h) continue;
    if (sy + y < 0 || sy + y >= image.height) continue;
    const srcRow = (sy + y) * image.width;
    for (let x = 0; x < sw; x++) {
      const tx = (op.dx ?? 0) + x;
      if (tx < 0 || tx >= w) continue;
      if (sx + x < 0 || sx + x >= image.width) continue;
      const si = (srcRow + sx + x) * 4;
      blend(canvas, (ty * w + tx) * 4,
        image.data[si], image.data[si + 1], image.data[si + 2], image.data[si + 3]);
    }
  }
}

function fillRect(canvas, w, h, [x, y, rw, rh], [r, g, b, a]) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(w, x + rw);
  const y1 = Math.min(h, y + rh);
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) blend(canvas, (ty * w + tx) * 4, r, g, b, a);
  }
}

/**
 * Paint one monster's card. Returns `{ width, height, data }`.
 *
 * The size comes from the plan rather than from a constant: an extended card
 * is 1065 wide and a painter holding 648 would clip the whole side panel off
 * without erroring.
 */
export function renderCardRgba(monster, opts) {
  const { width, height, ops } = cardPlan(monster, opts);
  for (const asset of assetsFor(ops)) loadAsset(asset);   // fail before drawing
  const data = new Uint8Array(width * height * 4);
  for (const op of ops) {
    if (op.op === 'image') drawImage(data, width, height, loadAsset(op.asset), op);
    else if (op.op === 'rects') {
      for (const rect of op.rects) fillRect(data, width, height, rect, op.color);
    }
  }
  return { width, height, data };
}

/** Paint one monster's card and encode it. This is what gets signed. */
export function renderCardPng(monster, opts) {
  const { width, height, data } = renderCardRgba(monster, opts);
  return encodePng(data, width, height);
}
