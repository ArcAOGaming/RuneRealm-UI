/**
 * The move roster as lit objects, with the real buttons on top.
 *
 * This is the Altar Hall's arrangement at a smaller scale, and for the same
 * reason (DESIGN.md §7): three.js owns objects and light, the DOM owns the
 * controls. The renderer draws eight extruded tiles and reports nothing; the
 * buttons that sit over them are ordinary `<button>`s, so the roster stays
 * keyboard-reachable and its text stays real text at the display's own
 * resolution. A raycaster would have given hover and click and taken the most
 * pressed control in the game away from anyone not using a mouse.
 *
 * Positions come FROM the DOM rather than the other way round: the grid lays
 * itself out in CSS, and each tile is placed at its button's rect projected
 * into the scene. So the 3D never has to agree with flexbox about anything —
 * it follows.
 *
 * Three states, which is the whole point of the layer:
 *   idle   a slow, per-tile out-of-phase float, so a roster at rest breathes
 *   hover  the tile rises, tilts toward the pointer, and its rim lights
 *   spent  it sinks, desaturates and stops moving — dead weight on the board
 *
 * Degrades to nothing. No WebGL and `mount` returns null; the buttons keep
 * their CSS borders and the screen is merely flatter.
 *
 * It makes its own canvas rather than being handed one, and that is not a
 * style choice. React 18 StrictMode runs every effect twice in development —
 * mount, clean up, mount — and a WebGL context belongs to the canvas ELEMENT
 * for that element's life. Disposing the first renderer does not give the
 * element back: the second `new WebGLRenderer({ canvas })` on the same element
 * gets the dead context, throws, and the mount silently returns null. The
 * symptom is a canvas left at its default 300x150 with nothing drawn in it,
 * which is exactly what happened. A fresh element per mount cannot collide.
 */
import * as THREE from 'three';

export type TileSpec = {
  /** Where the button is, in CSS pixels relative to the canvas. */
  x: number; y: number; w: number; h: number;
  /** rgb 0-255, the move type's colour. */
  colour: [number, number, number];
  hovered: boolean;
  pressed: boolean;
  spent: boolean;
  /** Dimmed as a set — the opponent's half of the roster. */
  muted: boolean;
};

export type TileField = {
  update(tiles: TileSpec[]): void;
  resize(w: number, h: number): void;
  dispose(): void;
};

/** Depth of the extrusion, in the scene's units (which are CSS pixels). */
/**
 * Depth of the slab, and how far it is inset inside its button's rect.
 *
 * The inset is what stops a tile fouling its neighbours. Under a perspective
 * camera a tile away from the centre is seen obliquely, so its SIDE face shows
 * and juts outward by roughly `THICKNESS * offset / DIST` — at the edge of a
 * 1000px panel that was ~8px of slab reaching into the next cell, and the
 * outermost tiles were clipped by the canvas as well. Pulling the body in by a
 * few pixels leaves room for the overhang inside the tile's own cell.
 *
 * Three, not more: at this depth and distance the overhang is about 2.3px, and
 * the cells are only ~26px tall — a 5px inset spent nearly a fifth of the tile's
 * height hiding a two-pixel problem, and left the slab visibly smaller than the
 * text sitting on it.
 */
const THICKNESS = 12;
const INSET = 3;

export function mountMoveTiles(container: HTMLElement): TileField | null {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  container.prepend(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();

  /**
   * A perspective camera placed so that, at z=0, one scene unit is one CSS
   * pixel.
   *
   * It was orthographic first, and orthographic was wrong here. Every tile
   * projected identically, so the extrusion only ever showed as a flat band on
   * whichever side the light happened to be — the layer read as coloured
   * rectangles and the depth had to be argued for rather than seen. With a
   * camera at a real distance the tiles nearest the edges of the panel turn
   * slightly away from it and the eight of them sit in one space instead of
   * eight separate ones.
   *
   * The distance is derived, not chosen: put the camera `d` away and set the
   * vertical field of view so the frustum is exactly `height` tall at z=0, and
   * a DOM rect can still be used as a position without conversion.
   *
   * `DIST` is deliberately long. A near camera gives dramatic depth and makes
   * the tiles at the panel's edges lean hard enough that their side faces reach
   * into the next cell; far enough away, the perspective is a hint rather than
   * a fisheye and every tile stays inside its own rect.
   */
  const DIST = 2600;
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  camera.position.z = DIST;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(-0.5, -1.1, 0.65);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc6ff, 0.35);
  rim.position.set(0.8, 0.4, 0.5);
  scene.add(rim);

  /**
   * One unit box, scaled per tile.
   *
   * It was a bevelled extrusion first, and the bevel could not survive the
   * scaling. The shape is authored 1x1 and then stretched to the tile's rect,
   * so a `0.03` bevel became 7px across a 250px-wide tile and 1px down its
   * 40px height — an elliptical, lopsided chamfer that grew with the cell. The
   * corner radius had exactly the same problem. Uniform depth and honest square
   * edges read better than a bevel that is a different size on every side.
   *
   * Depth is applied as an explicit Z scale rather than baked into the
   * geometry, so it stays constant while width and height vary.
   */
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  type Tile = { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial };
  const pool: Tile[] = [];
  let width = 1;
  let height = 1;
  let raf = 0;
  let latest: TileSpec[] = [];
  const start = performance.now();

  const grow = (n: number) => {
    while (pool.length < n) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.55, metalness: 0.15, transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      pool.push({ mesh, material });
    }
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const t = (performance.now() - start) / 1000;

    grow(latest.length);
    pool.forEach((tile, i) => {
      const spec = latest[i];
      if (!spec) { tile.mesh.visible = false; return; }
      tile.mesh.visible = true;

      // Out of phase per tile, so eight tiles breathing together do not read
      // as one slab pulsing.
      const phase = i * 1.7;
      const float = spec.spent ? 0 : Math.sin(t * 1.1 + phase) * 1.2;

      // Lift moves the tile TOWARD the camera, which also magnifies it —
      // 34px at the old distance grew a tile by enough to overlap the one
      // above it. Kept modest, and the longer DIST does the rest.
      const lift = spec.pressed ? -6 : spec.hovered ? 16 : 0;
      const cx = spec.x + spec.w / 2;
      const cy = spec.y + spec.h / 2;

      tile.mesh.scale.set(
        Math.max(4, spec.w - INSET * 2),
        Math.max(4, spec.h - INSET * 2),
        THICKNESS,
      );
      // DOM y runs DOWN and the scene's runs UP, so it is converted here, once.
      //
      // The first attempt did it by flipping the camera's `up` vector, which
      // looks like the same thing and is not: with the camera looking along -Z,
      // negating `up` mirrors X as well, to keep the basis right-handed. The
      // symptom was a chain that drew hard against the left edge while its
      // labels sat against the right, and a move grid quietly rendering its two
      // rosters the wrong way round.
      tile.mesh.position.set(cx, height - cy, lift + float - (spec.spent ? 8 : 0));

      // A standing tilt, not only a hover one.
      //
      // The camera is orthographic and looks straight down -Z, so a tile facing
      // it square shows only its front face and the extrusion is invisible —
      // the whole layer read as flat coloured rectangles, which is exactly what
      // it looked like. A few degrees off-axis puts a lit edge under every tile
      // and the depth is legible at rest. Hover deepens it rather than
      // introducing it.
      //
      // Kept small on purpose: past a few degrees the text sitting on top stops
      // looking attached to the tile and starts looking like it is floating
      // over a moving object.
      const tilt = spec.hovered ? 0.13 : 0.07;
      const yaw = (spec.hovered ? 0.09 : 0.04) * (spec.x > width / 2 ? -1 : 1);
      tile.mesh.rotation.set(tilt, yaw, 0);

      const [r, g, b] = spec.colour;
      const colour = new THREE.Color(r / 255, g / 255, b / 255);
      if (spec.spent) {
        // Dead weight: drained of its colour rather than merely darker, so a
        // spent move cannot be mistaken for a dim one.
        const grey = colour.getHSL({ h: 0, s: 0, l: 0 }).l;
        colour.setRGB(grey, grey, grey);
      }
      tile.material.color.copy(colour);
      tile.material.emissive.copy(colour).multiplyScalar(spec.hovered ? 0.5 : 0.12);
      tile.material.opacity = spec.spent ? 0.20 : spec.muted ? 0.42 : 0.82;
    });

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    update(tiles) { latest = tiles; },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);

      // Frame the panel exactly. `2 * atan(h / 2d)` is the field of view whose
      // frustum is `h` tall at distance `d`, so a tile of `spec.h` scene units
      // covers `spec.h` CSS pixels — the same contract the orthographic version
      // had, kept through the change.
      camera.fov = 2 * Math.atan(height / (2 * DIST)) * (180 / Math.PI);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      // Y runs DOWN to match the DOM, and the camera looks at the panel's
      // centre rather than the origin. Flipping at the call site instead is the
      // kind of conversion that ends up applied twice.
      camera.position.set(width / 2, height / 2, DIST);
      camera.lookAt(width / 2, height / 2, 0);
    },
    dispose() {
      cancelAnimationFrame(raf);
      pool.forEach((t) => t.material.dispose());
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
