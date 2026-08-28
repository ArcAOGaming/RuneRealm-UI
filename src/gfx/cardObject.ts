/**
 * The minted card, as an object.
 *
 * This is the one thing in the game a player owns outright and can trade, and
 * it was a flat PNG on a page. It is a physical card now: real thickness, a
 * gold edge that catches the light, a carved back, and a foil layer that only
 * exists at an angle — tilt it and the holo runs across the face, hold it
 * square on and it is just a card, which is exactly how foil behaves.
 *
 * The face is not redrawn here. `lib/card/browser.ts` paints the same 648x1065
 * layout the worker composites, and that canvas is handed straight over as a
 * texture — so the object a player turns over is pixel-for-pixel the file that
 * gets signed. If this drew its own version, the preview would eventually be a
 * preview of a different picture.
 *
 * `NearestFilter` throughout. The card art is pixel art and the whole point of
 * the 2D path is that the browser never resamples it; a 3D path that quietly
 * ran it through a mip chain would undo that at the first tilt.
 */
import {
  AdditiveBlending, BackSide, BoxGeometry, CanvasTexture, Color, LinearFilter, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NearestFilter, NoToneMapping, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, PointLight, Scene, ShaderMaterial, SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawMark } from './mark';

export type CardElement = 'fire' | 'water' | 'air' | 'rock' | 'arcane';

const HUE: Record<CardElement, number> = {
  arcane: 0x967aff,
  fire: 0xff7a43,
  water: 0x4ab0ff,
  air: 0x7ee2c8,
  rock: 0xc9a25d,
};

const GOLD = 0xd6c8a2;

/** Card stock: 648x1065 in the layout, so 0.6085 wide for a height of one. */
const RATIO = 648 / 1065;
const THICK = 0.016;

export type CardObject = {
  /** Repaint the face from a freshly drawn card canvas. */
  setFace(source: HTMLCanvasElement): void;
  setElement(element: CardElement): void;
  /** Turn it over. */
  flip(): void;
  readonly flipped: boolean;
  dispose(): void;
};

/** One renderer per canvas; StrictMode mounts effects twice. See DESIGN.md §6. */
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

/** The back of the card: stone, with the realm's seal struck into it. */
function backTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = Math.round(size * RATIO);
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#15131d';
    ctx.fillRect(0, 0, c.width, c.height);
    // Grain, so the back is stone rather than a swatch.
    for (let i = 0; i < 2600; i++) {
      const g = Math.random();
      ctx.fillStyle = g > 0.5
        ? `rgba(190,180,205,${0.05 * (0.4 + g)})`
        : 'rgba(4,3,8,0.12)';
      ctx.beginPath();
      ctx.arc(Math.random() * c.width, Math.random() * c.height, Math.random() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // A hairline inset frame, the same gold as every panel edge in the app.
    ctx.strokeStyle = 'rgba(214,200,162,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  }

  // The seal, centred, cut into the stone.
  const sealSize = Math.round(c.width * 0.52);
  const seal = document.createElement('canvas');
  seal.width = seal.height = sealSize;
  drawMark(seal, { color: 'rgba(214,200,162,0.62)', bind: 'rgba(214,200,162,0.62)' });
  ctx?.drawImage(seal, (c.width - sealSize) / 2, (c.height - sealSize) / 2);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  return tex;
}

export function createCardObject(
  canvas: HTMLCanvasElement,
  { face, element = 'arcane' as CardElement }: {
    /** The painted card, from `lib/card/browser`. */
    face: HTMLCanvasElement;
    element?: CardElement;
  },
): CardObject | null {
  LIVE.get(canvas)?.();

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.5, 20);

  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.03);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.5;

  const tint = new Color(HUE[element]);

  // -- the card ---------------------------------------------------------------

  const faceTex = new CanvasTexture(face);
  faceTex.colorSpace = SRGBColorSpace;
  faceTex.magFilter = NearestFilter;
  faceTex.minFilter = LinearFilter;   // minified, a mip chain is the right call
  faceTex.anisotropy = 8;

  const backTex = backTexture();

  const faceMat = new MeshBasicMaterial({ map: faceTex, toneMapped: false });
  const backMat = new MeshStandardMaterial({
    map: backTex, roughness: 0.82, metalness: 0.06,
  });
  const edgeMat = new MeshStandardMaterial({
    color: GOLD, metalness: 1, roughness: 0.28, envMapIntensity: 1.6,
  });

  // BoxGeometry lays its faces out right, left, top, bottom, front, back — so
  // the card is one mesh with the painted face on +Z and gold on the rim,
  // rather than three meshes that can drift out of alignment.
  const card = new Mesh(
    new BoxGeometry(RATIO, 1, THICK),
    [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat],
  );
  scene.add(card);

  /**
   * The foil.
   *
   * A separate quad a hair proud of the face, additive, whose brightness is a
   * function of how far off square you are holding the card. At rest it
   * contributes almost nothing; tilted, a band of colour runs diagonally across
   * the face and shifts as the angle does. That angular dependence is the whole
   * effect — a rainbow that is always on is a gradient, not foil.
   */
  const foilMat = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uTilt: { value: 0 }, uTint: { value: tint.clone() } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vView; varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uTilt; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vView; varying vec3 vN;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vView)));
        // Off-square is where foil lives. Square on, this is near zero.
        float edgeOn = pow(1.0 - facing, 1.4);

        // The diffraction band: a diagonal ramp across the card, swept by the
        // viewing angle so it travels when the card turns rather than when a
        // clock ticks.
        float band = (vUv.x * 1.4 + vUv.y * 2.2) + (vView.x * 3.2 + vView.y * 2.0);
        vec3 holo = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band));

        // A single hard specular sweep on top, which is what actually reads as
        // a laminated surface.
        float sweep = smoothstep(0.48, 0.5, abs(fract(band * 0.5) - 0.5));

        vec3 c = mix(holo, uTint, 0.25);
        float a = (edgeOn * 0.5 + sweep * edgeOn * 0.55) * (0.25 + uTilt * 0.9);
        gl_FragColor = vec4(c, a);
      }`,
  });
  const foil = new Mesh(new PlaneGeometry(RATIO, 1), foilMat);
  foil.position.z = THICK / 2 + 0.0012;
  card.add(foil);

  // A soft element-coloured wash behind the card, so it is sitting in light
  // rather than floating on a page.
  const glow = new Mesh(
    new PlaneGeometry(RATIO * 2.6, 2.4),
    new MeshBasicMaterial({
      color: tint.clone(), transparent: true, opacity: 0.16,
      blending: AdditiveBlending, depthWrite: false, side: BackSide,
    }),
  );
  glow.position.z = -0.5;
  glow.rotation.y = Math.PI;
  scene.add(glow);

  const key = new PointLight(0xffffff, 14, 12, 2);
  key.position.set(-1.6, 2.0, 2.6);
  scene.add(key);

  const rim = new PointLight(HUE[element], 8, 10, 2);
  rim.position.set(1.8, -1.2, 1.4);
  scene.add(rim);

  // -- interaction ------------------------------------------------------------

  let aimX = 0, aimY = 0;      // -1..1, where the pointer is over the card
  let tiltX = 0, tiltY = 0;    // eased
  let faceUp = true;
  let spin = 0;                // eased toward 0 or π
  let dragging = false;
  let dragFrom = 0;
  let dragSpin = 0;

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: ((e.clientY - r.top) / r.height) * 2 - 1,
    };
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (dragging) {
      dragSpin = (p.x - dragFrom) * 2.6;
      return;
    }
    aimX = p.x;
    aimY = p.y;
  };
  const onLeave = () => { aimX = 0; aimY = 0; };
  const onDown = (e: PointerEvent) => {
    dragging = true;
    dragFrom = local(e).x;
    dragSpin = 0;
    canvas.setPointerCapture(e.pointerId);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    // A flick past a third of a turn flips it; anything less falls back.
    if (Math.abs(dragSpin) > 1.05) faceUp = !faceUp;
    dragSpin = 0;
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const size = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit the card's full height plus the room a tilt needs, and its width if
    // the box is narrower than it is tall.
    const halfFov = Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, 0, Math.max(0.60 / halfFov, (0.40 / halfFov) / camera.aspect));
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(size);
  observer.observe(canvas);
  size();

  if (import.meta.env.DEV) (window as any).__card = { scene, camera, card, renderer };

  let raf = 0;
  let disposed = false;
  const t0 = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;

    const target = faceUp ? 0 : Math.PI;
    spin += (target + dragSpin - spin) * (reduced ? 1 : 0.12);

    // Held, not tracked: the card leans toward the pointer and lags it, which
    // is the difference between an object with mass and a cursor-follower.
    tiltX += (aimY * 0.30 - tiltX) * (reduced ? 1 : 0.08);
    tiltY += (aimX * 0.42 - tiltY) * (reduced ? 1 : 0.08);

    card.rotation.x = tiltX + (reduced ? 0 : Math.sin(t * 0.5) * 0.02);
    card.rotation.y = spin + tiltY;
    card.position.y = reduced ? 0 : Math.sin(t * 0.7) * 0.012;

    foilMat.uniforms.uTime.value = t;
    foilMat.uniforms.uTilt.value = Math.min(1, Math.hypot(tiltX, tiltY) * 2.4);

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: CardObject = {
    setFace(source) {
      // The same canvas, repainted: swapping textures on every stat change
      // would leak one per repaint on a screen that repaints on every poll.
      faceTex.image = source;
      faceTex.needsUpdate = true;
    },
    setElement(next) {
      const c = new Color(HUE[next] ?? HUE.arcane);
      (glow.material as MeshBasicMaterial).color.copy(c);
      (foilMat.uniforms.uTint.value as Color).copy(c);
      rim.color.copy(c);
    },
    flip() { faceUp = !faceUp; },
    get flipped() { return !faceUp; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      if (import.meta.env.DEV) delete (window as any).__card;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      env.texture.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      faceTex.dispose();
      backTex.dispose();
      renderer.dispose();
    },
  };

  LIVE.set(canvas, handle.dispose);
  return handle;
}
