/**
 * The activity runes — the tokens turning behind the activity rows.
 *
 * The rows say what a thing costs and what it gives, which is the useful half.
 * This is the other half: one carved token per row, standing in the
 * slot where a flat 16px SVG used to sit. They lean and catch the light, the
 * rune cut into each face burns in the companion's own element, and the one
 * you are about to click leans further and brightens.
 *
 * ONE canvas and ONE context for all of them. A canvas per row is several WebGL
 * contexts on a page that already spends one on the aether and one on whatever
 * ceremony is open, and browsers start dropping the oldest at around sixteen —
 * which shows up as the FIRST thing on the page going black, not the last.
 *
 * The camera is orthographic and measured in CSS pixels, so a token's position
 * is the DOM's: the caller hands over the centre of each row's icon slot and
 * the token stands exactly there, whatever the panel is doing at that width.
 *
 * three.js rather than the aether's raw WebGL, for the reason the monolith is:
 * this is geometry, a material and real lights. Nothing here is load-bearing —
 * `createActivityRunes` returns null when WebGL is unavailable and the caller
 * keeps the flat icons, which is what the rows shipped with.
 */
import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry,
  CanvasTexture, Color, CylinderGeometry, DirectionalLight, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NoToneMapping, OrthographicCamera,
  PlaneGeometry, PMREMGenerator, PointLight, Points, Scene, ShaderMaterial,
  SRGBColorSpace, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type RuneElement = 'fire' | 'water' | 'air' | 'rock' | 'arcane';

/** Matches `--element` in index.css, and `ELEMENT` in gfx/monolith. */
const ELEMENT: Record<RuneElement, number> = {
  arcane: 0x967aff,
  fire: 0xff7a43,
  water: 0x4ab0ff,
  air: 0x7ee2c8,
  rock: 0xc9a25d,
};

/** The stone the tokens are cut from. Darker than a panel, so they read as objects on it. */
const STONE = 0x211d2e;

/** Where a token is, in CSS pixels relative to the canvas, and how wide. */
export type RuneSlot = { x: number; y: number; size: number };

/** What a row is doing. All three default to false. */
export type RuneState = { hover?: boolean; disabled?: boolean; busy?: boolean };

export type ActivityRunes = {
  /** Put the tokens where the DOM says the icon slots are. */
  layout(slots: RuneSlot[]): void;
  setState(index: number, state: RuneState): void;
  setElement(element: RuneElement): void;
  dispose(): void;
};

/**
 * One glyph, struck into a texture.
 *
 * The paths are the icon's own — `GLYPH_PATH` in ui/icons — at the 24x24 box
 * every icon in this app is drawn in, so the rune on the stone is the same
 * geometry as the rune in a badge rather than a second drawing of it.
 */
function glyphTexture(paths: readonly string[], size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const s = size / 24;
    ctx.scale(s, s);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.9;
    // Butt caps and mitre joins, the same as `base()` in ui/icons: every mark
    // in this interface is cut rather than drawn, and a round cap here would
    // be the one soft edge on screen.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (const d of paths) ctx.stroke(new Path2D(d));
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round falloff, for the light a rune sits in. */
function haloTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(c);
}

/**
 * The embers coming off a token.
 *
 * A shader rather than a mesh per mote and a `for` loop in the frame: the
 * whole cloud is one draw call and its motion is a pure function of `uTime`,
 * so a token that is scrolled off screen and back does not restart its own
 * weather. `aSeed` is the only per-mote data — everything else is derived from
 * it, which is why the constellation is stable rather than reseeded.
 */
const EMBER_VERT = `
uniform float uTime;
uniform float uLit;
uniform float uSize;
attribute float aSeed;
varying float vFade;

void main() {
  float life = fract(uTime * 0.34 + aSeed);
  float a = aSeed * 6.2831853;

  vec3 p = position;
  // Out from the rim, up, and drifting: a spark leaving a hot stone, not a
  // particle leaving an emitter.
  p.x += sin(a + uTime * 0.9) * 0.30;
  p.y += life * 2.30;
  p.z += cos(a * 2.1) * 0.25;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.35 + 0.65 * (1.0 - life));
  // Squared falloff, and nothing at all until the token is at least awake.
  vFade = (1.0 - life) * (1.0 - life) * uLit;
}`;

const EMBER_FRAG = `
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

/** `count` motes on a ring just outside the band, each with its own seed. */
function emberCloud(count: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Golden-angle placement: evenly spread without ever lining up, and
    // deterministic, so the tokens are different constellations rather than
    // copies of one.
    const a = i * 2.39996;
    const r = 0.55 + ((i * 0.37) % 1) * 0.5;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r * 0.5 - 0.9;
    pos[i * 3 + 2] = 0.1;
    seed[i] = (i * 0.6180339) % 1;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  return geo;
}

/**
 * The runes currently living on a given canvas, if any.
 *
 * StrictMode mounts every effect twice in development, and two renderers on
 * one canvas is two scenes alternating frames — see the same guard in
 * gfx/monolith for what that looks like.
 */
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

/** One token: the stone, the rune cut into it, and the light it sits in. */
type Token = {
  group: Group;
  stone: MeshStandardMaterial;
  /** The metal band round the rim, which is what carries the element. */
  band: MeshStandardMaterial;
  glyph: MeshStandardMaterial;
  halo: MeshBasicMaterial;
  haloMesh: Mesh;
  lamp: PointLight;
  /** The eight chips that orbit the token, and the group that turns them. */
  ring: Group;
  ringMat: MeshStandardMaterial;
  embers: ShaderMaterial;
  emberGeo: BufferGeometry;
  texture: CanvasTexture;
  state: Required<RuneState>;
  /** 0..1, eased, so hover and release are a lean rather than a snap. */
  lit: number;
  spin: number;
  /** Deterministic per-token offset, so the three never sway in lockstep. */
  phase: number;
  /** Where the DOM last said this token stands, in canvas pixels. */
  x: number;
  y: number;
  radius: number;
  leanX: number;
  leanY: number;
};

export function createActivityRunes(
  canvas: HTMLCanvasElement,
  { glyphs, element = 'arcane' as RuneElement }: {
    /** One entry per row: the SVG path data for that row's icon. */
    glyphs: readonly (readonly string[])[];
    element?: RuneElement;
  },
): ActivityRunes | null {
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
  // Same reason as the monolith: `--element` is already a light colour, and
  // ACES would desaturate the one hue on screen that has to read as a faction.
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();

  // Pixel units. The frustum is rebuilt on every resize; y runs DOWN, so a
  // slot's `getBoundingClientRect` offset can be used without flipping it.
  const camera = new OrthographicCamera(0, 1, 0, -1, -400, 400);
  camera.position.z = 200;

  // Lit from the side rather than the front. Head-on, an eight-sided prism is
  // a circle: the facets only exist as long as one of them is catching more
  // light than its neighbour, and that is the whole reason it is not a disc.
  scene.add(new AmbientLight(0xffffff, 0.35));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-1, -0.75, 0.55);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.5);
  fill.position.set(0.9, 0.6, 0.4);
  scene.add(fill);

  // A room probe rather than a shipped HDRI: it costs nothing to build and the
  // band and the inlay are metal — without something to reflect they are flat
  // paint the colour of the element, which is what the first cut looked like.
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.5;

  const colour = new Color(ELEMENT[element] ?? ELEMENT.arcane);
  const halo = haloTexture();

  // One geometry set, shared. Built at unit radius and scaled per slot, so a
  // layout change is a scale rather than three rebuilt meshes.
  // Lying down: the flat face toward the camera, one edge level. An octagon
  // turned a sixteenth is the same shape the primary buttons are chamfered to.
  const lay = (g: CylinderGeometry) => {
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 8);
    return g;
  };
  // Two solids, not one. A single tapered prism reads as a lozenge at 36px;
  // a narrower plug standing proud of a wider band gives the silhouette a
  // step, and a step is what makes it read as cut rather than moulded.
  const stoneGeo = lay(new CylinderGeometry(0.9, 0.82, 0.5, 8));
  const bandGeo = lay(new CylinderGeometry(1.02, 0.96, 0.3, 8));
  const faceGeo = new PlaneGeometry(1.34, 1.34);
  const haloGeo = new PlaneGeometry(3.2, 3.2);
  // The orbiting chips. Cut to the same proportions as the tick marks on the
  // divining seal, because they are the same idea: a mechanism turning, read
  // by its gaps rather than by its strokes.
  const chipGeo = new BoxGeometry(0.40, 0.15, 0.15);

  const tokens: Token[] = glyphs.map((paths, i) => {
    const group = new Group();

    const stone = new MeshStandardMaterial({
      color: STONE, roughness: 0.55, metalness: 0.3, flatShading: true,
    });
    const body = new Mesh(stoneGeo, stone);
    body.position.z = 0.06;
    group.add(body);

    // The band. Dark metal that takes the element as a tint and the room as a
    // reflection, so the rim catches light as the token leans — which is the
    // whole reason it leans.
    const band = new MeshStandardMaterial({
      color: 0x2a2438, roughness: 0.28, metalness: 0.95, flatShading: true,
      emissive: colour.clone(), emissiveIntensity: 0.12,
    });
    group.add(new Mesh(bandGeo, band));

    // The rune, as inlaid metal rather than a decal: the same white strokes
    // masking a metal surface that glows in the element, so it picks up a
    // specular as it turns instead of being the same flat colour at every
    // angle. Additive got bright and stayed bright; this gets bright at the
    // angle where a real inlay would.
    const texture = glyphTexture(paths);
    const glyph = new MeshStandardMaterial({
      map: texture, alphaMap: texture, transparent: true, depthWrite: false,
      color: 0xf6eee8, metalness: 0.85, roughness: 0.32,
      emissive: colour.clone(), emissiveMap: texture, emissiveIntensity: 1.1,
    });
    const face = new Mesh(faceGeo, glyph);
    face.position.z = 0.33;
    group.add(face);

    // The light behind the stone. Additive and behind, so it rims the token
    // rather than washing the rune out from the front.
    const haloMat = new MeshBasicMaterial({
      map: halo, transparent: true, depthWrite: false,
      blending: AdditiveBlending, color: colour.clone(), opacity: 0.12,
    });
    const haloMesh = new Mesh(haloGeo, haloMat);
    haloMesh.position.z = -0.4;
    group.add(haloMesh);

    // A real light too, so the stone's own facets pick up the element and the
    // token is lit BY the rune rather than merely near it.
    const lamp = new PointLight(colour.getHex(), 0, 0);
    lamp.position.set(0, 0, 1.6);
    group.add(lamp);

    // The ring. It lives OUTSIDE the token's own sway — a mechanism the stone
    // sits inside rather than a decoration bolted to its face — so it is added
    // to the group but counter-rotated in the frame, and it only comes up as
    // the token wakes.
    const ring = new Group();
    const ringMat = new MeshStandardMaterial({
      color: 0x3a3350, roughness: 0.25, metalness: 1,
      emissive: colour.clone(), emissiveIntensity: 0.5,
      // No depth write: eight small transparent chips that write depth punch
      // holes in each other and in the halo behind them as they cross.
      transparent: true, opacity: 0, depthWrite: false,
    });
    for (let c = 0; c < 8; c++) {
      const chip = new Mesh(chipGeo, ringMat);
      const a = (c * Math.PI * 2) / 8;
      chip.position.set(Math.cos(a) * 1.32, Math.sin(a) * 1.32, 0.02);
      chip.rotation.z = a;
      ring.add(chip);
    }
    group.add(ring);

    const emberGeo = emberCloud(14);
    const embers = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: 0 },
        uSize: { value: 3 },
        uTint: { value: colour.clone() },
      },
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    group.add(new Points(emberGeo, embers));

    scene.add(group);
    return {
      group, stone, band, glyph, halo: haloMat, haloMesh, lamp,
      ring, ringMat, embers, emberGeo, texture,
      state: { hover: false, disabled: false, busy: false },
      lit: 0, spin: 0, phase: i * 1.37,
      x: 0, y: 0, radius: 1, leanX: 0, leanY: 0,
    };
  });

  const size = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(size);
  observer.observe(canvas);
  size();

  // Where the pointer is, in the canvas's own pixel space. Each token leans
  // toward it rather than tracking it: a stone that snaps to the cursor is a
  // toy, one that leans is heavy — the same rule the monolith follows.
  let aimX = 0;
  let aimY = 0;
  let pointerIn = false;
  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const scale = r.width / Math.max(1, canvas.clientWidth);
    aimX = (e.clientX - r.left) / scale;
    aimY = (e.clientY - r.top) / scale;
    pointerIn = true;
  };
  const onLeave = () => { pointerIn = false; };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });

  let raf = 0;
  let disposed = false;
  const t0 = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;

    for (const token of tokens) {
      const { state } = token;
      // One target for everything the token does, eased toward. Hover and
      // release are then the same movement in two directions, which is what
      // makes a lean read as weight rather than as a state change.
      const target = state.disabled ? 0 : state.busy ? 1 : state.hover ? 0.85 : 0.28;
      token.lit += (target - token.lit) * 0.12;

      if (reduced) {
        token.group.rotation.set(0, 0, 0);
        token.ring.rotation.z = 0;
      } else {
        // Busy spins it; everything else sways. A token that completed a turn
        // would spend a third of it edge-on, with the rune invisible — the
        // point of the face is that it can be read.
        token.spin += state.busy ? 0.13 : 0;

        // The lean. Clamped hard, and eased, so a pointer crossing the panel
        // tips the tokens in sequence like a row of set stones rather
        // than swinging them at it.
        let leanX = 0;
        let leanY = 0;
        if (pointerIn && !state.disabled) {
          const r = Math.max(1, token.radius);
          leanX = Math.max(-1, Math.min(1, (aimX - token.x) / (r * 7)));
          leanY = Math.max(-1, Math.min(1, (aimY - token.y) / (r * 7)));
        }
        token.leanX += (leanX - token.leanX) * 0.07;
        token.leanY += (leanY - token.leanY) * 0.07;

        const sway = 0.18 + token.lit * 0.32;
        token.group.rotation.y = token.spin
          + Math.sin(t * 0.62 + token.phase) * sway
          + token.leanX * 0.45;
        token.group.rotation.x = Math.sin(t * 0.44 + token.phase * 2) * sway * 0.42
          + token.leanY * 0.3;

        // The ring turns the other way, and slowly. Two speeds in two
        // directions is what makes the pair read as a mechanism instead of as
        // one object with a halo — see the three rings of the divining seal.
        token.ring.rotation.z = -t * 0.42 - token.phase;
      }

      const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.3 + token.phase);
      // Kept off full: an inlay at full emissive clips to white and the rune
      // stops being a cut line in stone and becomes a lamp in the shape of one.
      token.glyph.opacity = state.disabled ? 0.35 : 1;
      token.glyph.emissiveIntensity = state.disabled ? 0.12 : 0.7 + token.lit * 0.85;
      token.band.emissiveIntensity = state.disabled ? 0 : 0.08 + token.lit * 0.3;
      token.halo.opacity = state.disabled ? 0 : 0.07 + token.lit * (0.18 + breath * 0.1);
      token.haloMesh.scale.setScalar(1 + token.lit * 0.16);
      token.lamp.intensity = state.disabled ? 0 : token.lit * 16;
      token.stone.emissiveIntensity = token.lit * 0.25;

      // The ring is the reward for looking at one. It is nothing at rest and
      // most of the way in on hover, which is the difference between a panel
      // with three ornaments on it and a panel that answers you.
      const woken = Math.max(0, (token.lit - 0.3) / 0.7);
      token.ringMat.opacity = state.disabled ? 0 : woken * 0.9;
      token.ringMat.emissiveIntensity = 0.5 + woken * 1.6;
      token.ring.scale.setScalar(1.14 - woken * 0.14);

      // A stone at rest still smoulders; a stone you are about to strike
      // throws sparks.
      token.embers.uniforms.uTime.value = reduced ? 0 : t;
      token.embers.uniforms.uLit.value = state.disabled ? 0 : 0.16 + woken * 0.84;

      // The token itself rises as it wakes. Small — two pixels at this size —
      // but it is the difference between hovering a picture and hovering a
      // thing.
      token.group.position.y = -token.y + token.lit * token.radius * 0.08;
    }

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: ActivityRunes = {
    layout(slots) {
      slots.forEach((slot, i) => {
        const token = tokens[i];
        if (!token) return;
        // Radius, not diameter: the geometry is built at unit radius.
        const r = Math.max(1, slot.size / 2);
        token.x = slot.x;
        token.y = slot.y;
        token.radius = r;
        token.group.position.set(slot.x, -slot.y, 0);
        token.group.scale.setScalar(r);
        token.lamp.distance = r * 6;
        // Point size is in device pixels and the group scale does not reach it,
        // so the embers have to be told how big this token ended up.
        token.embers.uniforms.uSize.value = r * 0.42 * Math.min(2, window.devicePixelRatio || 1);
      });
    },
    setState(index, next) {
      const token = tokens[index];
      if (!token) return;
      token.state = {
        hover: Boolean(next.hover),
        disabled: Boolean(next.disabled),
        busy: Boolean(next.busy),
      };
      if (!token.state.busy) token.spin = 0;
    },
    setElement(next) {
      const c = new Color(ELEMENT[next] ?? ELEMENT.arcane);
      for (const token of tokens) {
        token.glyph.emissive.copy(c);
        token.band.emissive.copy(c);
        token.ringMat.emissive.copy(c);
        token.halo.color.copy(c);
        token.lamp.color.copy(c);
        token.stone.emissive.copy(c);
        (token.embers.uniforms.uTint.value as Color).copy(c);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
      for (const token of tokens) {
        token.stone.dispose();
        token.band.dispose();
        token.glyph.dispose();
        token.halo.dispose();
        token.ringMat.dispose();
        token.embers.dispose();
        token.emberGeo.dispose();
        token.texture.dispose();
      }
      stoneGeo.dispose();
      bandGeo.dispose();
      chipGeo.dispose();
      faceGeo.dispose();
      haloGeo.dispose();
      halo.dispose();
      env.texture.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  handle.setElement(element);
  LIVE.set(canvas, handle.dispose);
  return handle;
}
