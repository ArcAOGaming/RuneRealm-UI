/**
 * The binding — the rune field a defeated wild creature stands in.
 *
 * This is the one place in the game where the number on a button IS the thing
 * on screen. A capture bid is one to three Rune, every one of them consumed
 * whether the binding holds or breaks, and the old screen said so in a
 * sentence beside five radio buttons. Here the bid is the field: choose three
 * and three carved runes are turning around the creature, choose five and
 * there are five. Nothing has to be read to know what has been committed.
 *
 * The four phases are the four states the transaction is actually in, and they
 * are not decoration either:
 *
 * - `idle`      — nothing is signed. The runes turn, and the count follows the
 *                 selector immediately, because it is still a choice.
 * - `charging`  — the item is signed and in flight. The ring tightens and
 *                 speeds up and the runes pulse; the count is now fixed,
 *                 because the bid is spent whatever the roll says.
 * - `strike`    — the settlement came back. The runes fly into the creature.
 * - `bound` / `broken` — what the roll was. The creature takes the light, or
 *                 the runes rebound cold and fall.
 *
 * Built the way `gfx/activityRunes.ts` is built, and for the same reasons: one
 * canvas, one context, real geometry with real lights, and `null` rather than a
 * throw when WebGL is unavailable — the caller keeps a flat portrait and the
 * screen still works. The difference is the camera. This one is a perspective
 * camera and the ring is tilted, so a rune genuinely passes BEHIND the creature
 * and comes back around the front. On an orthographic camera an orbit is an
 * ellipse drawn on glass, and the whole point is that the creature is standing
 * inside something.
 */
import {
  AdditiveBlending, AmbientLight, BufferAttribute,
  BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NearestFilter, NoToneMapping, PerspectiveCamera, PlaneGeometry, PointLight,
  Points, RingGeometry, Scene, ShaderMaterial, SRGBColorSpace, SphereGeometry,
  Texture, TextureLoader, WebGLRenderer,
} from 'three';
import { RUNE_PATH } from '../ui/icons';
import { BindingPhase, STRIKE_MS, VERDICT_MS } from './bindingPhase';

export type { BindingPhase };
export { STRIKE_MS, VERDICT_MS };

export type BindingElement = 'fire' | 'water' | 'air' | 'rock' | 'normal' | 'arcane';

/** Matches `--element` in index.css, and `ELEMENT` in gfx/activityRunes. */
const ELEMENT: Record<BindingElement, number> = {
  arcane: 0x967aff,
  fire: 0xff7a43,
  water: 0x4ab0ff,
  air: 0x7ee2c8,
  rock: 0xc9a25d,
  normal: 0x8b94ad,
};

/** The stone a rune is cut from. Darker than a panel, so it reads as an object. */
const STONE = 0x211d2e;

export type RuneBinding = {
  /** How many runes are committed. Ignored once the phase leaves `idle`. */
  setRunes(count: number): void;
  setPhase(phase: BindingPhase): void;
  setElement(element: BindingElement): void;
  /** The creature at the centre. Swapped without rebuilding the field. */
  setPortrait(url: string): void;
  dispose(): void;
};

/** One rune, struck into a texture at the 24x24 box every icon is drawn in. */
function runeTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const s = size / 24;
    ctx.scale(s, s);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.1;
    // Cut, not drawn: butt caps and mitre joins, the same as `base()` in
    // ui/icons. A round cap here would be the one soft edge in the field.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke(new Path2D(RUNE_PATH));
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round falloff, for the light a rune sits in and the flash it makes. */
function haloTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.24)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The dust the field hangs in.
 *
 * One draw call whose motion is a pure function of `uTime`, so the field does
 * not restart its own weather when the tab comes back. `uLit` is the only thing
 * a phase changes: still air while a choice is being made, a rising current
 * once the item is signed.
 */
const DUST_VERT = `
uniform float uTime;
uniform float uLit;
uniform float uSize;
attribute float aSeed;
varying float vFade;

void main() {
  float life = fract(uTime * (0.06 + uLit * 0.16) + aSeed);
  float a = aSeed * 6.2831853;
  vec3 p = position;
  p.y += life * 6.0 - 3.0;
  p.x += sin(a + uTime * 0.35) * 0.30;
  p.z += cos(a * 1.7 + uTime * 0.28) * 0.30;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + 0.6 * uLit) * (12.0 / max(1.0, -mv.z));
  // Fades in and out rather than popping at the ends of its own life.
  vFade = sin(life * 3.14159265) * (0.25 + uLit * 0.75);
}`;

const DUST_FRAG = `
precision mediump float;
uniform vec3 uTint;
varying float vFade;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float core = 1.0 - smoothstep(0.0, 0.25, r);
  gl_FragColor = vec4(uTint * core, core * vFade);
}`;

function dustCloud(count: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Golden-angle placement: evenly spread, never lined up, deterministic.
    const a = i * 2.39996;
    const r = 1.2 + ((i * 0.37) % 1) * 4.4;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = ((i * 0.61803) % 1) * 6 - 3;
    pos[i * 3 + 2] = Math.sin(a) * r * 0.8;
    seed[i] = (i * 0.6180339) % 1;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  return geo;
}

/**
 * The field currently living on a given canvas, if any.
 *
 * StrictMode mounts every effect twice in development, and two renderers on one
 * canvas is two scenes alternating frames — the same guard as gfx/monolith.
 */
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

type Rune = {
  group: Group;
  stone: MeshStandardMaterial;
  band: MeshStandardMaterial;
  glyph: MeshStandardMaterial;
  halo: MeshBasicMaterial;
  lamp: PointLight;
  /** Where on the ring this rune is being asked to stand, and where it is. */
  slot: number;
  angle: number;
  /** 0 while retired, 1 while committed. Eased, so a bid change is a fade. */
  present: number;
  want: number;
  spin: number;
  phase: number;
  /** Set at the top of `strike`: where the flight started, and how late it is. */
  from: { x: number; y: number; z: number };
  delay: number;
  /** Where a rebound threw it, for `broken`. */
  fling: { x: number; y: number; z: number };
};

const MAX_RUNES = 5;

export function createRuneBinding(
  canvas: HTMLCanvasElement,
  { portraitUrl, element = 'arcane' as BindingElement, runes = 1 }: {
    portraitUrl: string;
    element?: BindingElement;
    runes?: number;
  },
): RuneBinding | null {
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
  // `--element` is already a light colour and ACES would desaturate the one hue
  // on screen that has to read as a faction. Same call as the monolith's.
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 60);
  // Tilted DOWN at the field rather than level with it. The console owns the
  // bottom of the screen and the creature's name owns the top, so the ceremony
  // has to sit in the band between them — not centred in a viewport it does not
  // have all of.
  camera.position.set(0, 0.5, 8.4);
  camera.lookAt(0, -0.42, 0);

  scene.add(new AmbientLight(0xffffff, 0.5));
  const key = new DirectionalLight(0xffffff, 1.9);
  key.position.set(-1.2, 1.4, 2.2);
  scene.add(key);
  const rim = new DirectionalLight(0xffffff, 0.7);
  rim.position.set(1.4, -0.6, -1.8);
  scene.add(rim);

  let colour = new Color(ELEMENT[element] ?? ELEMENT.arcane);
  const halo = haloTexture();
  const glyphTex = runeTexture();

  // -- the creature -----------------------------------------------------------
  //
  // Pixel art, so NEAREST both ways and no mipmaps: a linear-filtered sprite at
  // this size is a smear, and every other surface in this app that shows one
  // says so with `data-pixel`.
  const loader = new TextureLoader();
  const creatureMat = new MeshBasicMaterial({
    transparent: true, depthWrite: false, opacity: 0,
  });
  let creatureTex: Texture | null = null;
  const applyPortrait = (url: string) => {
    loader.load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.magFilter = NearestFilter;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
      creatureTex?.dispose();
      creatureTex = tex;
      creatureMat.map = tex;
      creatureMat.needsUpdate = true;
      // 320x448 portraits: keep the aspect rather than squaring the creature.
      const image = tex.image as { width?: number; height?: number } | undefined;
      const w = image?.width || 320;
      const h = image?.height || 448;
      creature.scale.set((w / h) * 3.5, 3.5, 1);
    });
  };
  const creature = new Mesh(new PlaneGeometry(1, 1), creatureMat);
  creature.position.set(0, 0.1, 0);
  scene.add(creature);
  applyPortrait(portraitUrl);

  // The light the creature stands in, and the one that takes it at the end.
  const creatureLamp = new PointLight(colour.getHex(), 0, 9);
  creatureLamp.position.set(0, 0.2, 1.4);
  scene.add(creatureLamp);

  // -- the seal ---------------------------------------------------------------
  //
  // Two rings on the floor, counter-turning. A seal drawn as one ring is a
  // circle; two at different speeds is a mechanism, which is the same rule the
  // divining glass and the activity tokens follow.
  const sealMatOuter = new MeshBasicMaterial({
    color: colour.clone(), transparent: true, opacity: 0.16,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
  });
  const sealMatInner = new MeshBasicMaterial({
    color: colour.clone(), transparent: true, opacity: 0.22,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
  });
  const seal = new Group();
  // Nearly edge-on. A seal read from above is a circle in the middle of the
  // screen; foreshortened, it is a floor the creature is standing on — which is
  // the only thing it is there to say.
  seal.rotation.x = -Math.PI / 2 + 0.26;
  seal.position.y = -1.72;
  const outerRing = new Mesh(new RingGeometry(1.92, 1.98, 64, 1), sealMatOuter);
  const innerRing = new Mesh(new RingGeometry(1.24, 1.28, 48, 1), sealMatInner);
  const ticks = new Group();
  const tickGeo = new PlaneGeometry(0.05, 0.2);
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    const tick = new Mesh(tickGeo, sealMatInner);
    tick.position.set(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0);
    tick.rotation.z = a + Math.PI / 2;
    ticks.add(tick);
  }
  seal.add(outerRing, innerRing, ticks);
  scene.add(seal);

  // -- the flash --------------------------------------------------------------
  //
  // What the runes make when they arrive, and what a bound creature becomes.
  const flashMat = new MeshBasicMaterial({
    map: halo, transparent: true, depthWrite: false,
    blending: AdditiveBlending, color: colour.clone(), opacity: 0,
  });
  const flash = new Mesh(new PlaneGeometry(7, 7), flashMat);
  flash.position.set(0, 0.1, 0.6);
  scene.add(flash);

  // A shell that expands out of the creature on a verdict: light leaving on a
  // bind, cold shrapnel on a break.
  const shellMat = new MeshBasicMaterial({
    color: colour.clone(), transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false, wireframe: true,
  });
  const shell = new Mesh(new SphereGeometry(1, 10, 6), shellMat);
  shell.position.copy(creature.position);
  scene.add(shell);

  // -- the runes --------------------------------------------------------------
  //
  // Two solids, not one: a narrower plug standing proud of a wider band gives
  // the silhouette a step, and a step is what makes a token read as cut rather
  // than moulded. Built lying down, flat face to the camera.
  const lay = (g: CylinderGeometry) => {
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 8);
    return g;
  };
  const stoneGeo = lay(new CylinderGeometry(0.30, 0.27, 0.16, 8));
  const bandGeo = lay(new CylinderGeometry(0.34, 0.32, 0.10, 8));
  const faceGeo = new PlaneGeometry(0.36, 0.36);
  const haloGeo = new PlaneGeometry(1.5, 1.5);

  const runeList: Rune[] = Array.from({ length: MAX_RUNES }, (_, i) => {
    const group = new Group();
    const stone = new MeshStandardMaterial({
      color: STONE, roughness: 0.5, metalness: 0.35, flatShading: true,
      emissive: colour.clone(), emissiveIntensity: 0,
      transparent: true, opacity: 1,
    });
    const body = new Mesh(stoneGeo, stone);
    body.position.z = 0.02;
    group.add(body);

    const band = new MeshStandardMaterial({
      color: 0x2a2438, roughness: 0.26, metalness: 0.95, flatShading: true,
      emissive: colour.clone(), emissiveIntensity: 0.15,
      transparent: true, opacity: 1,
    });
    group.add(new Mesh(bandGeo, band));

    // Inlaid metal rather than a decal, so the rune picks up a specular as the
    // stone turns instead of being the same flat colour at every angle.
    const glyph = new MeshStandardMaterial({
      map: glyphTex, alphaMap: glyphTex, transparent: true, depthWrite: false,
      color: 0xf6eee8, metalness: 0.85, roughness: 0.3,
      emissive: colour.clone(), emissiveMap: glyphTex, emissiveIntensity: 1.1,
    });
    const face = new Mesh(faceGeo, glyph);
    face.position.z = 0.1;
    group.add(face);

    const haloMat = new MeshBasicMaterial({
      map: halo, transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: colour.clone(), opacity: 0.12,
    });
    const haloMesh = new Mesh(haloGeo, haloMat);
    haloMesh.position.z = -0.16;
    group.add(haloMesh);

    const lamp = new PointLight(colour.getHex(), 0, 3.4);
    group.add(lamp);

    group.scale.setScalar(0);
    scene.add(group);
    return {
      group, stone, band, glyph, halo: haloMat, lamp,
      slot: i, angle: (i * Math.PI * 2) / MAX_RUNES,
      present: 0, want: 0, spin: 0, phase: i * 1.31,
      from: { x: 0, y: 0, z: 0 }, delay: 0,
      fling: { x: 0, y: 0, z: 0 },
    };
  });

  // -- the dust ---------------------------------------------------------------
  const dustGeo = dustCloud(reduced ? 0 : 90);
  const dustMat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uLit: { value: 0 }, uSize: { value: 2.4 },
      uTint: { value: colour.clone() },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  scene.add(new Points(dustGeo, dustMat));

  // -- state ------------------------------------------------------------------

  let committed = Math.max(1, Math.min(MAX_RUNES, Math.round(runes)));
  let phase: BindingPhase = 'idle';
  /** Seconds since the current phase began. Every timeline reads this. */
  let sincePhase = 0;
  /** Eased 0..1: how wound up the field is. `charging` drives it to 1. */
  let charge = 0;
  let orbit = 0;
  let verdictFlash = 0;

  const layout = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back on a narrow screen. The field is 5.4 units across and a phone
    // in portrait would otherwise crop the runes off both sides at the moment
    // their COUNT is the thing being read.
    camera.position.z = 8.4 + Math.max(0, (1.05 - camera.aspect)) * 4.6;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(layout);
  observer.observe(canvas);
  layout();

  /** Where slot `i` of `n` stands on the ring, in the ring's own plane. */
  const slotAngle = (i: number, n: number) => (i * Math.PI * 2) / Math.max(1, n);

  const applyCommitted = () => {
    let live = 0;
    for (const rune of runeList) {
      const committedHere = rune.slot < committed;
      rune.want = committedHere ? 1 : 0;
      if (committedHere) {
        rune.angle = slotAngle(live, committed);
        live += 1;
      }
    }
  };
  applyCommitted();
  // Present from the first frame rather than growing in on mount: the field is
  // what the screen opens on, and five runes fading up under a heading that
  // already says five is a loading state pretending to be a flourish.
  for (const rune of runeList) rune.present = rune.want;

  let raf = 0;
  let disposed = false;
  let last = performance.now();
  let clock = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    sincePhase += dt;

    const charging = phase === 'charging';
    const flying = phase === 'strike';
    const done = phase === 'bound' || phase === 'broken';

    charge += ((charging || flying ? 1 : 0) - charge) * Math.min(1, dt * 5);

    // The ring turns slowly while it is still a choice and hard once the bid is
    // spent. Everything else in the field is downstream of this one number.
    const speed = reduced ? 0 : 0.45 + charge * 2.9;
    orbit += dt * speed;

    const radius = 2.55 - charge * 0.5;
    const strikeT = flying ? Math.min(1, (sincePhase * 1000) / STRIKE_MS) : 0;

    for (const rune of runeList) {
      rune.present += (rune.want - rune.present) * Math.min(1, dt * 9);

      const a = rune.angle + orbit;
      // The ring is tilted, so a rune passes genuinely behind the creature and
      // comes back around the front. `y` is the tilt; `z` is the depth that
      // makes it read as an orbit rather than as an ellipse drawn on glass.
      const ox = Math.cos(a) * radius;
      const oz = Math.sin(a) * radius * 0.86;
      const oy = 0.1 + Math.sin(a) * radius * 0.30
        + (reduced ? 0 : Math.sin(clock * 1.6 + rune.phase) * 0.09);

      if (flying) {
        // Eased in, so the flight starts as a release and lands as a hit.
        const e = strikeT * strikeT * (3 - 2 * strikeT);
        const k = Math.max(0, Math.min(1, (e - rune.delay) / Math.max(0.001, 1 - rune.delay)));
        rune.group.position.set(
          rune.from.x * (1 - k), 0.1 + (rune.from.y - 0.1) * (1 - k), rune.from.z * (1 - k),
        );
        rune.group.scale.setScalar(rune.present * (1 - k * 0.75));
      } else if (done) {
        if (phase === 'broken') {
          // Thrown back out and tumbling: the bid was spent and nothing was
          // bought, and the runes have to be seen leaving.
          const t = Math.min(1.4, sincePhase);
          rune.group.position.set(
            rune.fling.x * t, 0.1 + rune.fling.y * t - 1.9 * t * t, rune.fling.z * t,
          );
          rune.group.rotation.x += dt * 5.5;
          rune.group.scale.setScalar(rune.present * Math.max(0, 1 - t / 1.3));
        } else {
          rune.group.scale.setScalar(0);
        }
      } else {
        rune.group.position.set(ox, oy, oz);
        rune.group.scale.setScalar(rune.present * 0.9);
        rune.from = { x: ox, y: oy, z: oz };
        // Stagger by ring position so the five arrive as a volley rather than
        // as one thick object.
        rune.delay = (rune.slot / MAX_RUNES) * 0.34;
        const fa = a + Math.PI;
        rune.fling = {
          x: Math.cos(fa) * 3.4, y: 1.7 + rune.slot * 0.22, z: Math.sin(fa) * 2.6,
        };
      }

      if (!reduced && !done) {
        rune.spin += dt * (0.7 + charge * 5.2);
        rune.group.rotation.y = rune.spin;
        rune.group.rotation.x = Math.sin(clock * 0.8 + rune.phase) * 0.22;
      }

      // The pulse. Nothing while it is a choice; a heartbeat once it is signed,
      // fast enough to read as "working" and slow enough not to strobe.
      const beat = charging && !reduced
        ? 0.5 + 0.5 * Math.sin(clock * 7.4 + rune.phase)
        : 0;
      const heat = 0.55 + charge * 0.5 + beat * 0.85 + (flying ? strikeT * 2.4 : 0);
      rune.glyph.emissiveIntensity = heat;
      rune.band.emissiveIntensity = 0.1 + charge * 0.4 + beat * 0.3;
      rune.stone.emissiveIntensity = charge * 0.3 + beat * 0.25;
      rune.halo.opacity = rune.present * (0.1 + charge * 0.22 + beat * 0.3);
      rune.lamp.intensity = rune.present * (0.9 + charge * 2.2 + beat * 2.6);
      // Cold once it has failed: a spent rune is not a lit one.
      if (phase === 'broken') {
        const fade = Math.max(0, 1 - sincePhase / 1.1);
        rune.glyph.emissiveIntensity = fade * 0.5;
        rune.band.emissiveIntensity = fade * 0.1;
        rune.lamp.intensity = fade * 0.6;
        rune.halo.opacity = 0;
      }
    }

    // The seal answers the ring: it turns the other way, and it brightens with
    // the charge rather than on its own schedule.
    if (!reduced) {
      outerRing.rotation.z -= dt * (0.16 + charge * 0.7);
      ticks.rotation.z += dt * (0.24 + charge * 1.1);
    }
    sealMatOuter.opacity = 0.1 + charge * 0.18;
    sealMatInner.opacity = 0.14 + charge * 0.26;

    // The creature. Present from the first frame, breathing, and taking the
    // light only at the end.
    creatureMat.opacity = Math.min(1, creatureMat.opacity + dt * 2.4);
    creature.position.y = 0.1 + (reduced ? 0 : Math.sin(clock * 1.1) * 0.06);
    creatureLamp.intensity = 1.4 + charge * 2.4;

    if (phase === 'bound') {
      // Struck, then held: the flash is what the runes made, the shell is the
      // binding closing over it.
      const t = Math.min(1, sincePhase / (VERDICT_MS / 1000));
      verdictFlash = Math.max(0, 1 - t) ** 2;
      shellMat.opacity = Math.max(0, 0.9 - t) * 0.8;
      shell.scale.setScalar(0.6 + t * 3.4);
      creatureLamp.intensity = 2 + verdictFlash * 26;
      sealMatInner.opacity = 0.22 + verdictFlash * 0.7;
    } else if (phase === 'broken') {
      const t = Math.min(1, sincePhase / (VERDICT_MS / 1000));
      verdictFlash = Math.max(0, 0.55 - t) ** 2;
      shellMat.opacity = 0;
      creatureLamp.intensity = Math.max(0.3, 1.4 - t * 1.2);
      sealMatOuter.opacity = Math.max(0, 0.14 - t * 0.14);
      sealMatInner.opacity = Math.max(0, 0.2 - t * 0.2);
    } else {
      verdictFlash = flying ? strikeT ** 3 : 0;
      shellMat.opacity = 0;
    }
    flashMat.opacity = verdictFlash * 0.85;
    flash.scale.setScalar(0.5 + verdictFlash * 1.6);

    dustMat.uniforms.uTime.value = reduced ? 0 : clock;
    dustMat.uniforms.uLit.value = charge;

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: RuneBinding = {
    setRunes(count) {
      // Only while it is still a choice. Once the item is signed the bid is
      // spent, and a field that could still change would be lying about that.
      if (phase !== 'idle') return;
      const next = Math.max(1, Math.min(MAX_RUNES, Math.round(count)));
      if (next === committed) return;
      committed = next;
      applyCommitted();
    },
    setPhase(next) {
      if (next === phase) return;
      phase = next;
      sincePhase = 0;
    },
    setElement(next) {
      colour = new Color(ELEMENT[next] ?? ELEMENT.arcane);
      for (const rune of runeList) {
        rune.stone.emissive.copy(colour);
        rune.band.emissive.copy(colour);
        rune.glyph.emissive.copy(colour);
        rune.halo.color.copy(colour);
        rune.lamp.color.copy(colour);
      }
      sealMatOuter.color.copy(colour);
      sealMatInner.color.copy(colour);
      flashMat.color.copy(colour);
      shellMat.color.copy(colour);
      creatureLamp.color.copy(colour);
      (dustMat.uniforms.uTint.value as Color).copy(colour);
    },
    setPortrait(url) { applyPortrait(url); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf);
      observer.disconnect();
      for (const rune of runeList) {
        rune.stone.dispose();
        rune.band.dispose();
        rune.glyph.dispose();
        rune.halo.dispose();
      }
      stoneGeo.dispose();
      bandGeo.dispose();
      faceGeo.dispose();
      haloGeo.dispose();
      tickGeo.dispose();
      outerRing.geometry.dispose();
      innerRing.geometry.dispose();
      shell.geometry.dispose();
      flash.geometry.dispose();
      creature.geometry.dispose();
      sealMatOuter.dispose();
      sealMatInner.dispose();
      shellMat.dispose();
      flashMat.dispose();
      creatureMat.dispose();
      creatureTex?.dispose();
      glyphTex.dispose();
      halo.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      renderer.dispose();
    },
  };

  handle.setElement(element);
  LIVE.set(canvas, handle.dispose);
  return handle;
}
