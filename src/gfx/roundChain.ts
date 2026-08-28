/**
 * The fight so far, as a chain of solid blocks receding to the left.
 *
 * The DOM version said what happened; this says how it went. Each round is a
 * pair of stacked bars — yours over theirs — whose HEIGHT is what that blow
 * cost. So a fight you are winning is a chain that leans one way, and you can
 * read the shape of it without reading a single number.
 *
 * Two things it does that a row of divs cannot:
 *
 *   - **Depth carries recency.** The newest round sits nearest the camera and
 *     older ones fall away down the chain, so "what just happened" is the
 *     largest thing on the strip without being given a colour or a label.
 *   - **The victory lands here.** When the fight is decided, the winner's whole
 *     column surges and lights; the loser's collapses. It is the one moment in
 *     the screen where the history stops being a record and becomes the result.
 *
 * Same arrangement as `moveTiles.ts` and for the same reason (DESIGN.md §7):
 * three.js owns objects and light, and the round labels stay in the DOM on top
 * where they are real text. And, as there, the renderer makes its own canvas —
 * a WebGL context belongs to its element for that element's life, and React
 * StrictMode mounts every effect twice.
 */
import * as THREE from 'three';

export type ChainRound = {
  /** 1-based round number, for the DOM labels that sit over this. */
  round: number;
  /** What your blow cost them, 0 if you missed or did not swing. */
  mine: number;
  /** What theirs cost you. */
  theirs: number;
  /** Colour of your move that round, rgb 0-255. */
  mineColour: [number, number, number];
  theirsColour: [number, number, number];
};

export type ChainOutcome = 'won' | 'lost' | null;

export type RoundChain = {
  update(rounds: ChainRound[], outcome: ChainOutcome): void;
  resize(w: number, h: number): void;
  dispose(): void;
};

/**
 * Width of one round's slot, and the gap between them, in CSS pixels.
 *
 * Exported because the DOM draws the labels over these bars and the two must
 * agree exactly — a legend and a number that do not sit on the block they
 * describe are worse than no legend at all.
 */
export const SLOT = 34;
export const GAP = 6;
/** Space kept at the right-hand edge, matched by the DOM overlay's padding. */
export const RIGHT_PAD = 6;

/** The tallest a bar gets, and the damage that reaches it. */
const MAX_BAR = 26;
const FULL_HIT = 22;

export function mountRoundChain(container: HTMLElement): RoundChain | null {
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
  const DIST = 900;
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(-0.4, -1, 0.9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc6ff, 0.4);
  rim.position.set(1, 0.3, 0.4);
  scene.add(rim);

  const geometry = new THREE.BoxGeometry(1, 1, 1);

  type Bar = { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial };
  const bars: Bar[] = [];
  let width = 1;
  let height = 1;
  let raf = 0;
  let rounds: ChainRound[] = [];
  let outcome: ChainOutcome = null;
  const start = performance.now();

  const grow = (n: number) => {
    while (bars.length < n) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.5, metalness: 0.2, transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      bars.push({ mesh, material });
    }
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const t = (performance.now() - start) / 1000;

    grow(rounds.length * 2);
    const mid = height / 2;
    // The chain is right-aligned: the newest round is always in the same place
    // at the right-hand edge, so the eye does not have to re-find it every time
    // one lands.
    const originX = width - SLOT / 2 - RIGHT_PAD;

    rounds.forEach((r, i) => {
      // 0 for the newest, growing with age.
      const age = rounds.length - 1 - i;
      const x = originX - age * (SLOT + GAP);
      // Older rounds fall away from the camera, which is what makes the newest
      // one the biggest thing on the strip without colouring it differently.
      const z = -age * 26;

      ([['mine', r.mine, r.mineColour, -1], ['theirs', r.theirs, r.theirsColour, 1]] as const)
        .forEach(([which, damage, colour, dir], half) => {
          const bar = bars[i * 2 + half];
          if (!bar) return;
          if (x < -SLOT) { bar.mesh.visible = false; return; }
          bar.mesh.visible = true;

          const h = Math.max(3, Math.min(MAX_BAR, (damage / FULL_HIT) * MAX_BAR));
          const won = outcome === (which === 'mine' ? 'won' : 'lost');
          // The decided fight: the winning column surges, the losing one sinks.
          const surge = outcome && won ? 1 + Math.sin(t * 3) * 0.06 : 1;
          const shrink = outcome && !won ? 0.55 : 1;

          bar.mesh.scale.set(SLOT - 6, h * surge * shrink, 12);
      // DOM y runs DOWN and the scene's runs UP, so it is converted here, once.
      //
      // The first attempt did it by flipping the camera's `up` vector, which
      // looks like the same thing and is not: with the camera looking along -Z,
      // negating `up` mirrors X as well, to keep the basis right-handed. The
      // symptom was a chain that drew hard against the left edge while its
      // labels sat against the right, and a move grid quietly rendering its two
      // rosters the wrong way round.
          bar.mesh.position.set(x, height - (mid + dir * (h * 0.5 + 2)), z);

          const [cr, cg, cb] = colour;
          const c = new THREE.Color(cr / 255, cg / 255, cb / 255);
          bar.material.color.copy(c);
          bar.material.emissive.copy(c)
            .multiplyScalar(outcome && won ? 0.45 : age === 0 ? 0.28 : 0.08);
          // Older rounds fade as well as recede, so a long fight does not turn
          // into a wall of equally loud blocks.
          bar.material.opacity = Math.max(0.25, 1 - age * 0.11);
        });
    });

    for (let i = rounds.length * 2; i < bars.length; i += 1) bars[i].mesh.visible = false;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    update(next, result) { rounds = next; outcome = result; },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      camera.fov = 2 * Math.atan(height / (2 * DIST)) * (180 / Math.PI);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.position.set(width / 2, height / 2, DIST);
      camera.lookAt(width / 2, height / 2, 0);
    },
    dispose() {
      cancelAnimationFrame(raf);
      bars.forEach((b) => b.material.dispose());
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** How wide the chain wants to be for `n` rounds, so the panel can reserve it. */
export const chainWidth = (n: number) => n * (SLOT + GAP) + 12;
