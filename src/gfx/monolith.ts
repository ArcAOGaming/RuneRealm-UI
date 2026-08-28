/**
 * The monolith — the seal, cut in stone, on the front door.
 *
 * The old landing page was a 512x271 PNG of a wooden signboard with a CSS bob
 * on it. This is the same mark, extruded: a slab of dark granite with the rune
 * inlaid in bone-gold metal and the bind bar burning in whatever element the
 * viewer belongs to, lit from behind so the chamfers rim.
 *
 * It is built from `mark.json` — the same numbers the header SVG and the
 * favicon come from — so the front door and the browser tab are provably the
 * same object rather than two drawings of it.
 *
 * three.js rather than the aether's raw WebGL, for the same reason the vault
 * is: this is geometry, metal, a real light and bloom, and hand-rolling that is
 * writing a renderer.
 *
 * Nothing here is load-bearing. `createMonolith` returns null when WebGL is
 * unavailable and the caller falls back to the flat SVG mark, which is the
 * whole logo and always was.
 */
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry,
  CanvasTexture, Color, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NoToneMapping, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  PointLight, Points, RepeatWrapping, Scene, ShaderMaterial, Shape, SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import mark from './mark.json';

export type MonolithElement = 'fire' | 'water' | 'air' | 'rock' | 'arcane';

/** Matches `--element` in index.css and the `colors` block in mark.json. */
const ELEMENT: Record<MonolithElement, number> = {
  arcane: 0x967aff,
  fire: 0xff7a43,
  water: 0x4ab0ff,
  air: 0x7ee2c8,
  rock: 0xc9a25d,
};

const GOLD = 0xd6c8a2;
const WHITE = new Color(0xffffff);

/** mark.json is a 0..100 box, y down. The scene is ±1, y up. */
const S = 2 / mark.box;
const toX = (x: number) => (x - mark.box / 2) * S;
const toY = (y: number) => (mark.box / 2 - y) * S;

const DEPTH = 0.19;      // slab thickness
const INLAY = 0.028;     // how far the metal stands proud of the face

export type Monolith = {
  setElement(element: MonolithElement): void;
  /** Strike it: the bind bar flares and the slab rings. Used on connect. */
  strike(): void;
  dispose(): void;
};

/** Granite: speckle and fine fracture, drawn once into a canvas. */
function graniteTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#15131d';
    ctx.fillRect(0, 0, size, size);

    // Mineral speckle. Two passes at different scales, because one grain size
    // reads as noise rather than stone.
    for (const [n, r, a] of [[2600, 1.6, 0.05], [700, 3.4, 0.035]] as const) {
      for (let i = 0; i < n; i++) {
        const g = Math.random();
        ctx.fillStyle = g > 0.5
          ? `rgba(190,180,205,${a * (0.4 + g)})`
          : `rgba(4,3,8,${a * 2.4})`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, Math.random() * r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fractures: a few long, mostly straight splits. Stone breaks in lines.
    ctx.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = `rgba(6,4,12,${0.12 + Math.random() * 0.2})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.6;
      let x = Math.random() * size;
      let y = Math.random() * size;
      const dir = Math.random() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += Math.cos(dir + (Math.random() - 0.5) * 0.7) * size * 0.09;
        y += Math.sin(dir + (Math.random() - 0.5) * 0.7) * size * 0.09;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** One inlay stroke as a bar sitting on the slab face. */
function bar(x1: number, y1: number, x2: number, y2: number, weight: number) {
  const ax = toX(x1), ay = toY(y1), bx = toX(x2), by = toY(y2);
  const w = weight * S;
  // Grown by half a width at each end so mitres meet solid, the same rule the
  // raster generator follows — a rune with gaps at its joins is not carved.
  const len = Math.hypot(bx - ax, by - ay) + w;
  const geo = new BoxGeometry(len, w, INLAY * 2);
  const mesh = new Mesh(geo);
  // Standing a full inlay's depth clear of the face, not flush with it. Set
  // level, the bar's front face and the stone's front face are six thousandths
  // apart, which is inside the depth buffer's resolution at this distance — the
  // rune z-fought the slab and came out as a dark cross laid over a gold one.
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, DEPTH / 2 + INLAY);
  mesh.rotation.z = Math.atan2(by - ay, bx - ax);
  return mesh;
}

/**
 * The monolith currently living on a given canvas, if any.
 *
 * React's StrictMode mounts every effect twice in development. Two renderers
 * then share one canvas — and therefore one GL context — and both keep their
 * animation frames: the mark came out with a dark cross through it, which was
 * two scenes at slightly different depths alternating frames. A canvas holds
 * at most one of these, and claiming it evicts whatever was there.
 */
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

export function createMonolith(
  canvas: HTMLCanvasElement,
  { element = 'arcane' as MonolithElement } = {},
): Monolith | null {
  LIVE.get(canvas)?.();

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The page shows through: the aether is painted behind this canvas, and a
  // black rectangle over it is exactly what the old PNG logo was.
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  // No tone mapping, deliberately.
  //
  // ACES desaturates as it approaches white, and `--element` is already a light
  // colour — 150,122,255 for arcane. Filmic put the bind bar out at a pale grey
  // lavender, which is the one stroke in the mark whose colour has to be read
  // as a faction. Without it, an emissive of 1.0 lands on exactly the hex in
  // index.css, so the stone version of the mark and the SVG version are the
  // same colour rather than nearly.
  //
  // Nothing here has the dynamic range to need it: the brightest thing in the
  // scene is a metal bar lit by a room probe at a third intensity.
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  // A tight near/far pair: everything in this scene lives within a unit of
  // the origin, and 0.1..40 was spending the depth buffer on empty space.
  const camera = new PerspectiveCamera(34, 1, 1.5, 20);
  camera.position.set(0, 0, 4.4);

  // A room environment rather than a shipped HDRI: it costs nothing, and the
  // gold inlay needs something to reflect or it reads as flat paint.
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.06);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.32;

  const rig = new Group();
  // Under one, so the slab does not fill its own frame. The bloom around the
  // stone needs somewhere to go; at full size the glow was being cut off by
  // the edge of the canvas and the mark read as sitting in a box.
  rig.scale.setScalar(0.72);
  scene.add(rig);

  // -- the slab -------------------------------------------------------------

  const shape = new Shape();
  mark.bezel.points.forEach(([x, y], i) => {
    const px = toX(x), py = toY(y);
    if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
  });
  shape.closePath();

  const grain = graniteTexture();
  grain.colorSpace = SRGBColorSpace;
  grain.repeat.set(0.5, 0.5);

  const slabGeo = new ExtrudeGeometry(shape, {
    depth: DEPTH, bevelEnabled: true, bevelThickness: 0.022,
    bevelSize: 0.022, bevelSegments: 2,
  });
  slabGeo.center();
  const slabMat = new MeshStandardMaterial({
    color: 0x1a1724, map: grain, bumpMap: grain, bumpScale: 0.9,
    roughness: 0.82, metalness: 0.08,
  });
  const slab = new Mesh(slabGeo, slabMat);
  rig.add(slab);

  // -- the inlay ------------------------------------------------------------

  /*
    The inlay is stated, not lit — both halves of it.

    As metal it was at the mercy of one room probe and one point light, and the
    result was that the long strokes came out several stops darker than the
    short ones: the stave and the bind bar read as a dark cross laid over the
    rune. Chasing that with light meant chasing it at every screen size and in
    every faction colour.

    So the rune is bone-gold and the bind bar is `--element`, both `toneMapped:
    false`, both exactly the hex in index.css. The mark is the same object in
    the tab, in the header and on this slab, and it is the same colour in all
    three. The stone around it is still fully lit — that is where the material
    is doing work.
  */
  const goldMat = new MeshBasicMaterial({ color: GOLD, toneMapped: false });
  const goldBase = new Color(GOLD);
  for (const [x1, y1, x2, y2] of mark.rune.strokes) {
    const m = bar(x1, y1, x2, y2, mark.rune.weight);
    m.material = goldMat;
    rig.add(m);
  }

  const bindColor = new Color(ELEMENT[element]);
  /*
    Unlit, and explicitly not tone mapped.

    Every lit material in here is at the mercy of one weak room probe and one
    point light, and the bind bar kept coming out a dark slate whatever its
    emissive was set to. It is the single stroke in the mark whose colour has to
    be read as a faction, and the value it has to hit is not a look — it is
    `--element` from index.css, to the hex. So it is stated rather than lit: a
    basic material outputs its colour, `toneMapped: false` keeps the pipeline
    from grading it, and the stone version of the mark matches the SVG one
    exactly. The glow around it is the `ember` quad below.
  */
  const bindMat = new MeshBasicMaterial({ color: bindColor.clone(), toneMapped: false });
  for (const [x1, y1, x2, y2] of mark.bind.strokes) {
    const m = bar(x1, y1, x2, y2, mark.bind.weight);
    m.material = bindMat;
    rig.add(m);
  }

  // -- light ----------------------------------------------------------------

  // Behind the slab, so the chamfers rim and the element bleeds around the
  // silhouette. This is what makes it read as lit rather than painted.
  const back = new PointLight(ELEMENT[element], 13, 8, 2);
  back.position.set(0, -0.2, -1.5);
  scene.add(back);

  // A cold key from high front-left, so the granite has a direction.
  const key = new PointLight(0xbfd0ff, 9, 12, 2);
  key.position.set(-2.4, 2.6, 3.2);
  scene.add(key);

  // -- motes ----------------------------------------------------------------

  // Ash rising off the stone. Additive points, no texture: at this size a
  // sprite sheet would be five hundred bytes of nothing.
  const MOTES = 220;
  const pos = new Float32Array(MOTES * 3);
  const seed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 4.6;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 3.4;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 2.2 - 0.4;
    seed[i] = Math.random();
  }
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute('position', new BufferAttribute(pos, 3));
  moteGeo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  const moteMat = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uTint: { value: bindColor.clone() }, uScale: { value: 1 } },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vFade;
      void main() {
        vec3 p = position;
        float t = uTime * (0.08 + aSeed * 0.12);
        p.y = mod(p.y + t + aSeed * 6.0, 3.4) - 1.7;
        p.x += sin(uTime * 0.3 + aSeed * 20.0) * 0.09;
        vFade = 0.25 + 0.75 * aSeed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.0 + aSeed * 2.4) * uScale * (3.4 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uTint;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vFade * 0.5;
        gl_FragColor = vec4(mix(vec3(0.84, 0.78, 0.64), uTint, 0.45), a);
      }`,
  });
  scene.add(new Points(moteGeo, moteMat));

  // -- the halo ---------------------------------------------------------------

  /*
    This was an `UnrealBloomPass` and it is geometry now.

    The bloom put a dark cross through the mark: a streak the full width and
    height of the canvas, crossing at the brightest thing on screen, which is
    the bind bar. That is the shape a single non-finite pixel makes when a
    separable Gaussian smears it along one axis and then the other, and the
    composite adds it back over the frame. Disabling the pass removed it
    outright; nothing else did.

    A post chain was never earning its cost here anyway. The whole effect is one
    soft disc of light behind one object — so it is one soft disc of light
    behind one object, drawn additively. It costs a quad instead of four
    fullscreen passes and a half-float target, `antialias: true` on the renderer
    starts working again (a composer bypasses it), and the reach of the glow is
    a number rather than a blur radius, which is what actually needed
    controlling: the halo has to stay inside the canvas or the mark looks like
    it is sitting in a box.
  */
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      // Tight core, long tail. A linear falloff reads as a flat disc; this one
      // reads as light.
      g.addColorStop(0.00, 'rgba(255,255,255,1)');
      g.addColorStop(0.30, 'rgba(255,255,255,0.72)');
      g.addColorStop(0.52, 'rgba(255,255,255,0.34)');
      g.addColorStop(0.74, 'rgba(255,255,255,0.11)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  })();

  const haloGeo = new PlaneGeometry(1, 1);

  /** The aura around the whole stone. Sized to stay inside the canvas. */
  const auraMat = new MeshBasicMaterial({
    map: haloTex, color: bindColor.clone(), transparent: true,
    blending: AdditiveBlending, depthWrite: false, opacity: 0.8,
  });
  const aura = new Mesh(haloGeo, auraMat);
  aura.position.z = -0.55;
  // The slab hides the core of it, so the disc is only a little wider than the
  // stone: most of a big one is spent behind the thing it is lighting.
  aura.scale.setScalar(2.4);
  scene.add(aura);

  /** And a hotter, tighter one on the bind bar itself, which is the source. */
  const emberMat = new MeshBasicMaterial({
    map: haloTex, color: bindColor.clone(), transparent: true,
    blending: AdditiveBlending, depthWrite: false, opacity: 0.55,
  });
  const ember = new Mesh(haloGeo, emberMat);
  ember.position.z = 0.22;
  ember.scale.set(1.55, 0.26, 1);
  rig.add(ember);

  // -- interaction ----------------------------------------------------------

  // Parallax, damped. The slab leans toward the pointer rather than tracking
  // it: a mark that snaps to the cursor is a toy, one that leans is heavy.
  let aimX = 0, aimY = 0, leanX = 0, leanY = 0;
  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    aimX = ((e.clientX - (r.left + r.width / 2)) / r.width) * 2;
    aimY = ((e.clientY - (r.top + r.height / 2)) / r.height) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  let struckAt = -1e9;

  const size = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // The slab has to survive a phone: pull the camera back as the box
    // narrows so the mark never crops, which is what a fixed FOV would do.
    camera.position.z = 4.4 * Math.max(1, 1.15 / camera.aspect);
    camera.updateProjectionMatrix();
    moteMat.uniforms.uScale.value = Math.min(2, window.devicePixelRatio || 1);
  };
  const observer = new ResizeObserver(size);
  observer.observe(canvas);
  size();

  // A handle on the scene in dev, so the slab can be inspected without a
  // screenshot and a guess. Mirrors what the aether exposes.
  if (import.meta.env.DEV) {
    (window as any).__monolith = { scene, camera, rig, slab, goldMat, bindMat, back, aura, ember, renderer };
  }

  let raf = 0;
  const t0 = performance.now();
  let disposed = false;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;

    if (!reduced) {
      // A slow sway, never a full turn: this is a standing stone, not a
      // spinning trophy. The two frequencies are deliberately incommensurate
      // so the loop never visibly repeats.
      const swayY = Math.sin(t * 0.31) * 0.30 + Math.sin(t * 0.11) * 0.10;
      const swayX = Math.sin(t * 0.23) * 0.08;

      leanX += (aimX * 0.22 - leanX) * 0.045;
      leanY += (aimY * 0.16 - leanY) * 0.045;

      rig.rotation.y = swayY + leanX;
      rig.rotation.x = swayX + leanY;
      rig.position.y = Math.sin(t * 0.45) * 0.045;

      moteMat.uniforms.uTime.value = t;

      // The bind bar breathes. Shallow — it should read as alive, not as a
      // notification badge.
      const breath = 0.5 + 0.5 * Math.sin(t * 1.1);
      const ring = Math.exp(-(now - struckAt) / 420);
      // Struck, the rune flares to white and falls back to bone.
      goldMat.color.copy(goldBase).lerp(WHITE, Math.min(0.85, ring));
      back.intensity = 11 + breath * 4 + ring * 90;
      auraMat.opacity = 0.72 + breath * 0.14 + ring * 0.28;
      aura.scale.setScalar(2.4 + breath * 0.07 + ring * 0.8);
      emberMat.opacity = 0.55 + breath * 0.18 + ring * 0.45;
      rig.rotation.z = ring * Math.sin((now - struckAt) / 26) * 0.03;
    }

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: Monolith = {
    setElement(next) {
      const c = new Color(ELEMENT[next] ?? ELEMENT.arcane);
      bindMat.color.copy(c);
      back.color.copy(c);
      auraMat.color.copy(c);
      emberMat.color.copy(c);
      (moteMat.uniforms.uTint.value as Color).copy(c);
    },
    strike() { struckAt = performance.now(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      if (import.meta.env.DEV) delete (window as any).__monolith;
      env.texture.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      grain.dispose();
      haloTex.dispose();
      renderer.dispose();
    },
  };

  LIVE.set(canvas, handle.dispose);
  return handle;
}
