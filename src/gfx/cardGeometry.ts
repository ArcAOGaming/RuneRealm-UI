/**
 * cardGeometry.ts — the card as a solid with rounded corners.
 *
 * A `BoxGeometry` is a rectangle, and a trading card is not: a poker card's
 * corners are radiused, and on a 3D card the corner is the part you actually
 * see rounded, because the gold rim traces the silhouette. Rounding the
 * texture alone leaves a square rim around a round picture, which reads as a
 * sticker on a block.
 *
 * The geometry keeps the three groups the card materials expect, in this
 * order, so a caller passes `[faceMat, backMat, edgeMat]`:
 *
 *   0  front cap, +Z, UV 0..1 across the card
 *   1  back cap, -Z, UV mirrored in x so a back texture reads the right way
 *   2  the rim
 *
 * `THREE.ShapeGeometry` hands back UVs in the shape's own coordinates, which
 * for a card centred on the origin run -w/2..w/2 — so every cap's UVs are
 * remapped here. Getting that wrong is the classic symptom: a texture that
 * appears as one enormous stretched pixel.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Shape,
  ShapeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A rounded rectangle centred on the origin. */
function roundedRect(w: number, h: number, r: number): Shape {
  const x = -w / 2;
  const y = -h / 2;
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const s = new Shape();
  s.moveTo(x + radius, y);
  s.lineTo(x + w - radius, y);
  s.quadraticCurveTo(x + w, y, x + w, y + radius);
  s.lineTo(x + w, y + h - radius);
  s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  s.lineTo(x + radius, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  return s;
}

/** Rewrite a cap's UVs from shape space to 0..1, optionally mirrored in x. */
function normaliseUv(geometry: BufferGeometry, w: number, h: number, mirror: boolean) {
  const uv = geometry.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) / w + 0.5;
    const v = uv.getY(i) / h + 0.5;
    uv.setXY(i, mirror ? 1 - u : u, v);
  }
  uv.needsUpdate = true;
}

/**
 * A card `w` by `h` and `t` thick, with corners of radius `r`.
 *
 * `curveSegments` is deliberately low. The corner is a few millimetres of a
 * card that is usually on screen at a couple of hundred pixels, so eight
 * segments is already past the point where more of them change the picture.
 */
export function cardGeometry(
  w: number, h: number, t: number, r: number, curveSegments = 8,
): BufferGeometry {
  const shape = roundedRect(w, h, r);

  // Every part is de-indexed before merging. `ShapeGeometry` is indexed and
  // an extrusion's walls are not, and `mergeGeometries` refuses a mixture —
  // it wants an index on all of them or on none.
  const front = new ShapeGeometry(shape, curveSegments).toNonIndexed();
  normaliseUv(front, w, h, false);
  front.translate(0, 0, t / 2);

  const back = new ShapeGeometry(shape, curveSegments).toNonIndexed();
  normaliseUv(back, w, h, true);
  // Turned to face -Z, which also fixes the winding, rather than scaled
  // negative — a negative scale leaves the normals pointing the wrong way.
  back.rotateY(Math.PI);
  back.translate(0, 0, -t / 2);

  // The walls of an extrusion are its second group; the caps it also builds are
  // thrown away, because the two above carry the card's own UVs.
  const solid = new ExtrudeGeometry(shape, {
    depth: t, bevelEnabled: false, curveSegments,
  });
  solid.translate(0, 0, -t / 2);
  const walls = solid.groups.find((g) => g.materialIndex === 1)
    ?? solid.groups[solid.groups.length - 1];
  const kept = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attr = solid.getAttribute(name) as BufferAttribute | undefined;
    if (!attr) continue;
    const from = walls.start * attr.itemSize;
    const to = (walls.start + walls.count) * attr.itemSize;
    kept.setAttribute(name, new BufferAttribute(
      (attr.array as Float32Array).slice(from, to), attr.itemSize,
    ));
  }
  solid.dispose();

  const merged = mergeGeometries([front, back, kept], true);
  if (!merged) throw new Error('cardGeometry: could not merge');
  front.dispose();
  back.dispose();
  kept.dispose();
  return merged;
}
