/**
 * The Altar Hall — where you swear.
 *
 * Joining a faction is the only irreversible choice in this game. It decides
 * your companion, its element, the berry it eats and which two of the other
 * three you counter, and it cannot be undone. It was four cards in a grid.
 *
 * So it is a room now: four stone plinths in a shallow arc, each carrying an
 * elemental core, each with a rune ring cut into the floor beneath it. Standing
 * in front of one charges it — the core brightens, its ring spins up, the other
 * three fall back — and swearing lights it for good and puts the rest out.
 *
 * Everything is procedural. No models, no textures, no HDRIs. The plinths are
 * extruded from the same chamfered outline as the Realm Seal
 * (`mark.json`'s bezel), so every worked stone in this game has one silhouette,
 * and the rune cut into each shaft is the element's own icon path from
 * `ui/icons` — the same geometry the badges draw, not a second drawing of it.
 *
 * Deliberately no post-processing. `UnrealBloomPass` streaks a non-finite pixel
 * the full width of the canvas — it is what put a dark cross through the mark
 * on the front door — so the glow here is additive geometry, the way the
 * monolith's is. See DESIGN.md §6.
 *
 * Nothing here is load-bearing: with no WebGL, `createAltars` returns null and
 * the caller falls back to the DOM cards, which carry every fact the hall does.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DoubleSide, ExtrudeGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NoToneMapping, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, PointLight, Points, RepeatWrapping, RingGeometry, Scene, ShaderMaterial,
  Shape, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import mark from './mark.json';
import { ELEMENT_PATH } from '../ui/icons';

export type AltarElement = 'fire' | 'water' | 'air' | 'rock';

/** Matches `--element` in index.css, and the `colors` block in mark.json. */
const HUE: Record<AltarElement, number> = {
  fire: 0xff7a43,
  water: 0x4ab0ff,
  air: 0x7ee2c8,
  rock: 0xc9a25d,
};

const GOLD = 0xd6c8a2;

/** Left to right, and the order the DOM buttons are laid out in. */
export const ALTAR_ORDER: AltarElement[] = ['fire', 'water', 'air', 'rock'];

/**
 * Where each altar is on screen, in CSS pixels inside the canvas box.
 *
 * `x`/`y` is the plaque anchor at the foot of the plinth. `top` and `half`
 * describe the STONE above it — the top of the core and half the plinth's
 * width — so the DOM can put the hit area over the altar itself rather than
 * only over its plaque. Pointing at a two-metre lit object and having nothing
 * happen is the thing this fixes.
 */
export type AltarPoint = {
  element: AltarElement;
  x: number;
  y: number;
  scale: number;
  /** Screen y of a point just above the core: the top of the clickable stone. */
  top: number;
  /** Half the plinth's on-screen width, at the foot. */
  half: number;
};

/**
 * One frame of the arrival sequence: which altars exist yet, and which one the
 * hall is showing off. Null is the hall at rest, with all four standing.
 */
export type AltarIntro = {
  /** The altars that have arrived. Everything else is not in the room at all. */
  present: AltarElement[];
  /** The one under the light. The others that have arrived sit back, unlit. */
  spotlight: AltarElement | null;
};

export type Altars = {
  /** The one being pointed at or focused. Null relaxes the whole hall. */
  setActive(element: AltarElement | null): void;
  /**
   * Drive the arrival. Null ends it: every altar present and back at rest.
   *
   * The hall has to be BUILT for this (`intro: true` below) or the four are
   * already standing when the first frame of the sequence arrives.
   */
  setIntro(state: AltarIntro | null): void;
  /** The one sworn to. Permanent: it stays lit and the rest go dark. */
  setSworn(element: AltarElement | null): void;
  /** The oath lands: a flare and a ring outward from that altar. */
  strike(element: AltarElement): void;
  dispose(): void;
};

// -- shared bits -------------------------------------------------------------

/** mark.json's bezel, as a Shape, normalised to a 1-unit box. */
function bezelShape() {
  const s = new Shape();
  mark.bezel.points.forEach(([x, y], i) => {
    const px = (x - mark.box / 2) / mark.box;
    const py = (mark.box / 2 - y) / mark.box;
    if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
  });
  s.closePath();
  return s;
}

/** One chamfered stone slab: the seal's outline, given thickness. */
function slab(width: number, height: number, shape: Shape) {
  const geo = new ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true,
    bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1,
  });
  // Extrude builds on XY and pushes along +Z; a plinth wants it standing up.
  geo.rotateX(-Math.PI / 2);
  geo.scale(width, 1, width);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/** Granite: speckle and fracture, drawn once and shared by every plinth. */
function graniteTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#14121b';
    ctx.fillRect(0, 0, size, size);
    for (const [n, r, a] of [[2400, 1.5, 0.05], [600, 3.2, 0.035]] as const) {
      for (let i = 0; i < n; i++) {
        const g = Math.random();
        ctx.fillStyle = g > 0.5
          ? `rgba(188,178,204,${a * (0.4 + g)})`
          : `rgba(4,3,8,${a * 2.4})`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, Math.random() * r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.lineCap = 'butt';
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = `rgba(6,4,12,${0.1 + Math.random() * 0.18})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      let x = Math.random() * size;
      let y = Math.random() * size;
      const dir = Math.random() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += Math.cos(dir + (Math.random() - 0.5) * 0.6) * size * 0.1;
        y += Math.sin(dir + (Math.random() - 0.5) * 0.6) * size * 0.1;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The element's rune, cut to a texture.
 *
 * `Path2D` takes the SVG path data straight out of `ui/icons`, so this is
 * literally the badge glyph — mitred, butt-capped, no arcs — rather than a
 * hand-copied approximation of it that would drift the first time either
 * changed.
 */
function glyphTexture(element: AltarElement, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const k = size / 24;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 8;
    ctx.stroke(new Path2D(ELEMENT_PATH[element]));
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** The soft disc every glow in this codebase is made of. */
function haloTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// -- noise, shared by the cores ---------------------------------------------

const NOISE = `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                       dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }
`;

type Core = {
  group: Group;
  /** 0..1 charge, set every frame by the hall. */
  update(t: number, charge: number): void;
};

/**
 * Fire: a flame, not a ball of fire.
 *
 * The first cut of this was a sphere with noise pushed along its normals, which
 * is a boiling ball — it has no up. A flame has one. The silhouette here is a
 * profile: nothing at the very bottom, widest just above the base, drawn to a
 * point at the top. The noise that roughens it scrolls DOWNWARD through its own
 * field, which is what makes the detail climb, and its amplitude grows with
 * height so the body is steady and the tips fray.
 *
 * The tips are cut by that same noise rather than fading out, so the flame ends
 * in tongues instead of on a surface — and embers come off the top of it.
 */
function fireCore(colour: Color): Core {
  const group = new Group();
  const uniforms = {
    uTime: { value: 0 }, uCharge: { value: 0 }, uColour: { value: colour.clone() },
    /**
     * A second clock, running at a rate the charge sets.
     *
     * Scaling `uTime` itself would jump the whole noise field the instant the
     * charge changed — the flame would teleport rather than pick up. This one is
     * integrated frame by frame, so the fire visibly quickens as you come to it
     * and slows as you leave, with no seam.
     */
    uFast: { value: 0 },
  };

  const flame = new Mesh(
    new SphereGeometry(1, 72, 96),
    new ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: DoubleSide,
      blending: AdditiveBlending, toneMapped: false,
      vertexShader: `${NOISE}
        uniform float uTime; uniform float uCharge; uniform float uFast;
        varying float vH; varying float vRough; varying float vGutter;
        void main() {
          vec3 s = normalize(position);
          float h = clamp(s.y * 0.5 + 0.5, 0.0, 1.0);

          // The profile. The smoothstep rounds the foot, so the flame sits on
          // the plinth rather than being cut off square by it.
          float r = pow(1.0 - h, 0.62) * smoothstep(0.0, 0.20, h);

          // Three octaves on three different scroll speeds, none of them a
          // multiple of another, plus a global gutter that leans and starves the
          // whole flame. Two octaves on one clock is a texture scrolling past;
          // this never arrives at the same shape twice.
          float n  = fbm(vec3(s.xz * 2.2, h * 3.2 - uFast * 1.8));
          float n2 = fbm(vec3(s.xz * 5.4, h * 6.4 - uFast * 2.9));
          float n3 = fbm(vec3(s.xz * 11.0 + 4.0, h * 12.0 - uFast * 4.7));
          float gutter = fbm(vec3(7.0, uFast * 1.31, uFast * 0.83));
          vGutter = gutter;
          vRough = n * 0.7 + n2 * 0.5 + n3 * 0.3 + gutter * 0.35;

          // Frayed with height, steady at the root, and starved or fed by the
          // gutter so the body itself surges.
          r *= 1.0 + (n * 0.62 + n2 * 0.34 + n3 * 0.16)
                   * (0.22 + h * 1.7) * (0.6 + uCharge * 0.7)
                   * (0.75 + gutter * 0.9);

          // Tips are pulled up as well as out: fire leans, it does not just
          // wobble. The height it reaches is part of what gutters — and part of
          // what answers you: a charged altar's flame stands up.
          float rise = (0.86 + uCharge * 0.42);
          float y = (h * 1.95 - 0.6) * (0.88 + gutter * 0.34) * rise + n * 0.34 * h;

          // Half as wide as it is tall. At equal width and height the profile
          // reads as a dome sitting on the plinth rather than as a flame.
          vec3 p = vec3(s.x * r * 0.46, y, s.z * r * 0.46) * 0.56;

          // The lean. Two slow, unrelated drifts, growing with height, so the
          // flame is blown about by something rather than standing to attention.
          vec2 lean = vec2(
            fbm(vec3(1.7, uFast * 0.44, 0.0)),
            fbm(vec3(9.3, 0.0, uFast * 0.37))
          );
          p.xz += lean * (0.22 + uCharge * 0.30) * h * h + vec2(n2, n) * 0.06 * h;

          vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColour; uniform float uCharge;
        varying float vH; varying float vRough; varying float vGutter;
        void main() {
          // White at the root, the element's colour through the body, nothing at
          // the tips.
          float heat = clamp(1.15 - vH * 1.45 + vRough * 0.4, 0.0, 1.0);
          vec3 c = mix(uColour * 0.5, uColour, heat);
          c = mix(c, vec3(1.0, 0.93, 0.8), pow(heat, 2.8));

          // A long taper rather than a hard fade: the first cut of this put both
          // the falloff and the noise cut low on the body and all that survived
          // was a disc at the widest point.
          float body = 1.0 - smoothstep(0.20, 1.0, vH);
          // The cut. Above the body the noise decides what is still flame, which
          // is what turns a surface into tongues.
          // The cut moves with the gutter as well: when the flame is starved,
          // more of the top is cut away and it breaks into separate tongues.
          float tongue = smoothstep(-0.52 + vGutter * 0.22, 0.20, vRough - vH * 0.45);
          float a = body * tongue * (0.22 + uCharge * 0.9) * (0.72 + vGutter * 0.6);
          if (a < 0.004) discard;
          gl_FragColor = vec4(c, a);
        }`,
    }),
  );
  group.add(flame);

  // Embers off the top. They exist because a flame that produces nothing reads
  // as a shader; these are what make it burning.
  const EMBERS = 110;
  const eSeed = new Float32Array(EMBERS * 3);
  const ePos = new Float32Array(EMBERS * 3);
  for (let i = 0; i < EMBERS; i++) {
    eSeed[i * 3] = Math.random();                 // phase
    eSeed[i * 3 + 1] = Math.random() * Math.PI * 2; // angle
    eSeed[i * 3 + 2] = 0.4 + Math.random() * 0.9;   // speed
  }
  const eGeo = new BufferGeometry();
  eGeo.setAttribute('position', new BufferAttribute(ePos, 3));
  eGeo.setAttribute('aSeed', new BufferAttribute(eSeed, 3));
  const emberMat = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uPixel: { value: Math.min(2, window.devicePixelRatio || 1) },
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute vec3 aSeed;
      uniform float uTime; uniform float uCharge; uniform float uPixel;
      varying float vLife;
      void main() {
        float life = fract(aSeed.x + uTime * 0.22 * aSeed.z);
        vLife = life;
        // Out of the flame's shoulder, not its centre, and wandering as it goes.
        // Two unrelated frequencies on the wander, so no two embers trace the
        // same arc and none of them traces the same one twice.
        float rise = life * 1.15 * (0.7 + aSeed.z * 0.5);
        float a = aSeed.y + life * 1.6 + sin(uTime * 0.9 + aSeed.y * 6.0) * 0.5;
        float spread = 0.09 + life * 0.34;
        vec3 p = vec3(cos(a) * spread, 0.05 + rise, sin(a) * spread);
        p.x += sin(uTime * 1.7 + aSeed.y * 11.0) * 0.05 * life;
        p.z += cos(uTime * 1.3 + aSeed.x * 17.0) * 0.05 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.9 + aSeed.z * 1.6) * uPixel * (2.2 / -mv.z) * (0.5 + uCharge);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColour; uniform float uCharge;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        // Bright and white as it leaves, cooling to the element's colour, gone.
        vec3 c = mix(vec3(1.0, 0.94, 0.84), uColour, smoothstep(0.0, 0.5, vLife));
        float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * (0.15 + uCharge * 0.85);
        gl_FragColor = vec4(c, a);
      }`,
  });
  group.add(new Points(eGeo, emberMat));

  let last = 0;
  let fast = 0;

  return {
    group,
    update(t, charge) {
      // Integrated, not scaled: see `uFast` above.
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      fast += dt * (0.6 + charge * 1.15);

      uniforms.uTime.value = t;
      uniforms.uFast.value = fast;
      uniforms.uCharge.value = charge;
      emberMat.uniforms.uTime.value = t;
      emberMat.uniforms.uCharge.value = charge;
      // A flame does not spin. It only ever turns a little, on its own axis.
      group.rotation.y = Math.sin(t * 0.11) * 0.35;
      // And it draws itself up as the altar charges.
      group.scale.setScalar(0.94 + charge * 0.16);
    },
  };
}

/**
 * Water: a held drop with a moving surface.
 *
 * Two travelling sine bands crossed with a slow fbm swell, displaced along the
 * normal so the skin genuinely goes in and out rather than shimmering in place.
 * The normal is rebuilt from finite differences of that same field — three
 * samples per vertex — which is the part that actually sells it: without it the
 * fresnel rim stays put on a surface that is visibly moving under it, and the
 * whole thing reads as a texture rather than as water.
 */
function waterCore(colour: Color): Core {
  const group = new Group();
  const uniforms = {
    uTime: { value: 0 }, uCharge: { value: 0 }, uColour: { value: colour.clone() },
    /** A charge-rated clock, integrated frame by frame. See `uFast` in fire. */
    uFast: { value: 0 },
  };

  const WAVE = `
    float wave(vec3 s, float t) {
      // Long swells first and noise last, and only a little of it. Weighted the
      // other way the surface breaks into lumps and the whole thing reads as a
      // veined crystal rather than as water.
      //
      // The three swells run along arbitrary axes, not x, y and z. Aligned to
      // the axes their maxima meet at the corners of the cube they share and
      // the drop comes out as a rounded die.
      vec3 d1 = vec3(0.31, 0.87, 0.38);
      vec3 d2 = vec3(-0.72, 0.31, 0.62);
      vec3 d3 = vec3(0.55, -0.28, -0.79);
      float w = 0.0;
      w += sin(dot(s, d1) * 5.0 - t * 1.6) * 0.42;
      w += sin(dot(s, d2) * 3.6 + t * 1.1) * 0.33;
      w += sin(dot(s, d3) * 6.4 + t * 2.0) * 0.18;
      w += fbm(s * 1.7 + vec3(0.0, t * 0.4, 0.0)) * 0.26;
      return w;
    }
  `;

  const body = new Mesh(
    new SphereGeometry(0.46, 128, 96),
    new ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `${NOISE}${WAVE}
        uniform float uTime; uniform float uCharge; uniform float uFast;
        varying vec3 vN; varying vec3 vP; varying vec3 vL; varying float vW;
        void main() {
          vec3 s = normalize(position);
          // Held to a swell. Pushed further than this the crests sharpen into
          // spikes and the drop turns lumpy — the charge is spent on how FAST
          // the water moves (see uFast, above), not on how far it deforms.
          float amp = 0.040 + uCharge * 0.042;

          float w0 = wave(s, uFast);

          // Two tangents, and the field sampled a short step along each. The
          // cross of those slopes is the surface's real normal after the
          // displacement, which is the only way the highlights ride the waves.
          vec3 t1 = normalize(cross(s, abs(s.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 t2 = cross(s, t1);
          float e = 0.07;
          float w1 = wave(normalize(s + t1 * e), uFast);
          float w2 = wave(normalize(s + t2 * e), uFast);

          // A slow breath, and nothing else: growing the drop with the charge
          // made it read as a balloon rather than as water picking up.
          float swell = 0.46 + sin(uTime * 0.9) * 0.008;
          vec3 p = s * (swell + w0 * amp);
          vec3 n = normalize(s - (t1 * (w1 - w0) + t2 * (w2 - w0)) * (amp * 30.0));

          vW = w0;
          vL = s;
          vN = normalize(normalMatrix * n);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `${NOISE}
        // uFast as well as uTime: the caustics run on the charge-rated clock,
        // and a uniform used in the fragment stage has to be declared in it.
        // Declaring it only in the vertex shader compiles that half and fails
        // this one, and a material whose fragment shader will not compile draws
        // nothing at all — the orb vanished and left only its halo behind.
        uniform vec3 uColour; uniform float uTime; uniform float uCharge;
        uniform float uFast;
        varying vec3 vN; varying vec3 vP; varying vec3 vL; varying float vW;
        void main() {
          vec3 n = normalize(vN);
          float f = pow(1.0 - abs(dot(n, normalize(-vP))), 2.0);

          // Caustics thrown where the surface is steepest, so they gather in the
          // troughs and run as the waves do.
          float c = fbm(vL * 3.4 + vec3(0.0, uFast * 0.5, uFast * 0.22));
          float caustic = smoothstep(0.88, 1.0, 1.0 - abs(c) * 3.0);

          // Crests catch the light; troughs go deep. Both held well back — at
          // full weight the light and dark regions map onto the drop like
          // continents and it reads as a planet.
          float crest = smoothstep(0.05, 0.9, vW);
          // A fresnel alone is a soap bubble: dark through the middle, bright
          // only at the rim. The constant term is the body of the water.
          vec3 col = uColour * (0.72 + f * 0.7 + crest * 0.24)
                   // Weighted toward the rim: unweighted, the caustic net sits
                   // flat on the drop and paints coastlines on it.
                   + vec3(0.82, 0.95, 1.0) * caustic * 0.34 * (0.3 + f * 1.0);

          // Held translucent all the same. Opaque, the waves stop reading as a
          // skin over a volume and start reading as a shell.
          // Mostly body, and only then rim.
          //
          // This was written fresnel-first, and a fresnel-first surface only
          // really exists at its own silhouette. At full charge it looked like
          // an orb; at the resting charge — which is where it actually sits most
          // of the time, on a screen where nothing is selected — it thinned out
          // until all that was left was its halo. The constant terms carry it
          // now, and the charge decides how bright and how fast it is rather
          // than whether it is there at all.
          float a = (0.86 + f * 0.14 + caustic * 0.14 + crest * 0.08)
                  * (0.86 + uCharge * 0.14);
          gl_FragColor = vec4(col * (0.95 + uCharge * 0.4), a);
        }`,
    }),
  );
  group.add(body);

  let last = 0;
  let fast = 0;

  return {
    group,
    update(t, charge) {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      // Slow and heavy at rest, running properly when charged.
      fast += dt * (0.45 + charge * 1.3);

      uniforms.uTime.value = t;
      uniforms.uFast.value = fast;
      uniforms.uCharge.value = charge;
      group.rotation.y = -t * 0.07;
    },
  };
}

/**
 * Air: nothing at the centre, and it gusts.
 *
 * The other three have a body. This one is a vortex around an absence, which is
 * the only honest way to draw it. It was a steady carousel — every mote on its
 * own radius at its own constant speed, which reads as a spinning object rather
 * than as moving air. Air does not spin at a rate. It gusts: two sharp,
 * out-of-step envelopes throw the whole field forward, widen it, and brighten
 * it, and between them it slackens.
 *
 * Nearly white, and only tinted by the element. Air has no colour of its own.
 */
function airCore(colour: Color): Core {
  const group = new Group();
  // Denser than it was. Air is the only core with no body, and at 620 motes
  // spread over the same volume as a flame it read as dust in a beam rather
  // than as a vortex — the one altar of the four that looked like it had
  // failed to load.
  const COUNT = 900;
  const seed = new Float32Array(COUNT * 4);
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = 0.16 + Math.random() * 0.44;       // radius
    seed[i * 4 + 1] = Math.random() * Math.PI * 2;   // phase
    seed[i * 4 + 2] = (Math.random() - 0.5) * 1.5;   // height
    seed[i * 4 + 3] = 0.5 + Math.random();           // how hard it takes a gust
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 4));

  const uniforms = {
    uTime: { value: 0 }, uCharge: { value: 0 },
    uColour: { value: colour.clone() },
    // Point sizes are in device pixels; without this the vortex is half as
    // dense on a retina display as it is on a laptop.
    uPixel: { value: Math.min(2, window.devicePixelRatio || 1) },
  };

  group.add(new Points(geo, new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute vec4 aSeed;
      uniform float uTime; uniform float uCharge; uniform float uPixel;
      varying float vFade; varying float vGust;
      void main() {
        /*
          The gust, done properly.

          The first cut built it from pow(fract(t * k), 7) and added it to the
          angle. Two things were wrong with that. A fract sawtooth snaps back to
          zero at the top, so every cycle ended with a visible jerk — the loop
          you could see. And adding a gust to the ANGLE rubber-bands the motes
          forward and then drags them back, which is not what a gust does.

          A gust is a change in SPEED, so it belongs in the derivative. These two
          terms are the integrals of A*sin(wt): the speed swells and slackens
          smoothly and never reverses, the position is continuous forever, and
          the two periods do not divide into one another, so it does not repeat.
        */
        float w1 = 0.53, w2 = 0.31;
        float A1 = 0.20, A2 = 0.13;
        float surge = A1 * sin(w1 * uTime + aSeed.y)
                    + A2 * sin(w2 * uTime + aSeed.y * 2.3);
        float gust = max(0.0, surge) * (1.4 + uCharge * 1.6);
        vGust = gust;

        float r = aSeed.x * (1.0 - uCharge * 0.2) * (1.0 + gust * 0.3);
        // The surge is held under the base rate so the total speed never crosses
        // zero: a mote that briefly runs backwards reads as a glitch, not as air.
        float a = aSeed.y
                + uTime * (0.34 + uCharge * 0.40) * aSeed.w
                + (A1 / w1) * (1.0 - cos(w1 * uTime + aSeed.y)) * aSeed.w * 0.9
                + (A2 / w2) * (1.0 - cos(w2 * uTime + aSeed.y * 2.3)) * aSeed.w * 0.9;

        // The band still wraps, but a mote fades out before it reaches the top
        // and back in below, so nothing is ever seen teleporting.
        float u = fract((aSeed.z + 0.75) / 1.5 + uTime * 0.055 * aSeed.w);
        float y = u * 1.5 - 0.75;
        float wrap = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u);

        // Pinched at the poles: a column of dots is a column, a lens is a vortex.
        float pinch = 1.0 - pow(abs(y / 0.75), 2.0) * 0.72;
        vec3 p = vec3(cos(a) * r * pinch, y * 0.62, sin(a) * r * pinch);

        vFade = (0.25 + 0.75 * fract(aSeed.y)) * pinch * wrap;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.0 + aSeed.w * 2.0) * uPixel * (2.6 / -mv.z)
                     * (0.85 + uCharge * 0.5 + gust * 0.45);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColour; uniform float uCharge;
      varying float vFade; varying float vGust;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        // White, with the element only tinting it — and whiter still in a gust.
        vec3 c = mix(vec3(1.0), uColour, 0.30 - vGust * 0.10);
        // The floor was 0.10, and at rest that is a scatter of specks over a
        // black room: beside a flame, an orb and a pile of shards, air read as
        // a broken altar rather than as a quiet one. It is still the faintest
        // of the four — it has no body — but it is now visibly a vortex before
        // you point at it.
        float a = smoothstep(0.5, 0.0, d) * vFade
                * (0.34 + uCharge * 0.7 + vGust * 0.28);
        gl_FragColor = vec4(c, a);
      }`,
  })));

  return {
    group,
    update(t, charge) {
      uniforms.uTime.value = t;
      uniforms.uCharge.value = charge;
    },
  };
}

/**
 * One shard: an icosahedron knocked out of shape.
 *
 * `OctahedronGeometry(r, 0)` is eight faces, and eight faces is a die, not a
 * rock. Detail 1 gives eighty, and then every corner is pushed in or out so no
 * two shards are the same solid.
 *
 * The jitter is keyed on the quantised position because `PolyhedronGeometry`
 * builds non-indexed geometry: each corner exists once per face that owns it,
 * and moving those copies independently tears the shard into confetti.
 */
function shardGeometry(radius: number, detail = 1) {
  const geo = new IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let m = moved.get(k);
    if (!m) {
      const f = 1 + (Math.random() - 0.5) * 0.62;
      m = [x * f, y * f, z * f];
      moved.set(k, m);
    }
    pos.setXYZ(i, m[0], m[1], m[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Rock: a core that has been broken and has not finished falling.
 *
 * Irregular shards on their own tilted orbits, drawing in as the altar charges.
 * Nothing here is smooth and nothing here is fast — it is the only core with
 * hard edges, which is the point of it next to the other three.
 */
function rockCore(colour: Color): Core {
  const group = new Group();
  const grain = graniteTexture(256);
  grain.repeat.set(2, 2);

  const inner = new Mesh(
    shardGeometry(0.2, 2),
    new MeshStandardMaterial({
      color: 0x1a1520, emissive: colour.clone(), emissiveIntensity: 0.5,
      bumpMap: grain, bumpScale: 0.4,
      flatShading: true, roughness: 0.85, metalness: 0.1,
    }),
  );
  group.add(inner);

  const shardMat = new MeshStandardMaterial({
    color: 0x241d2c, emissive: colour.clone(), emissiveIntensity: 0.12,
    bumpMap: grain, bumpScale: 0.35,
    flatShading: true, roughness: 0.94, metalness: 0.08,
  });

  /**
   * Each shard on a quasi-periodic path.
   *
   * A single sine per axis is a circle, and a circle is a loop you can watch
   * come round. Three rates that do not divide into one another never do: the
   * shard passes near where it has been without ever repeating it, which is
   * what falling debris actually looks like. The tumble is built the same way,
   * off the same three rates, so the spin never syncs to the orbit either.
   */
  type Shard = {
    mesh: Mesh; r: number;
    w1: number; w2: number; w3: number;
    p1: number; p2: number; p3: number;
    lift: number;
  };
  const shards: Shard[] = [];
  for (let i = 0; i < 15; i++) {
    const size = 0.045 + Math.random() * 0.085;
    // Detail 2 on the bigger pieces only: eighty faces is enough on a chip that
    // is fifteen pixels across, and three hundred is not free fifteen times.
    const m = new Mesh(shardGeometry(size, size > 0.09 ? 2 : 1), shardMat);
    // Squashed on one axis as well as knocked about, so they are slabs and
    // wedges rather than fifteen lumps of the same proportion.
    m.scale.set(1, 0.45 + Math.random() * 0.9, 0.6 + Math.random() * 0.7);
    group.add(m);
    shards.push({
      mesh: m,
      r: 0.30 + Math.random() * 0.26,
      w1: 0.17 + Math.random() * 0.34,
      w2: 0.11 + Math.random() * 0.29,
      w3: 0.07 + Math.random() * 0.23,
      p1: Math.random() * Math.PI * 2,
      p2: Math.random() * Math.PI * 2,
      p3: Math.random() * Math.PI * 2,
      lift: 0.16 + Math.random() * 0.28,
    });
  }

  return {
    group,
    update(t, charge) {
      // The core tumbles on three rates too, for the same reason.
      inner.rotation.set(t * 0.13, t * 0.19, Math.sin(t * 0.07) * 0.4);
      (inner.material as MeshStandardMaterial).emissiveIntensity = 0.12 + charge * 3.2;
      shardMat.emissiveIntensity = 0.03 + charge * 0.6;

      const speed = 0.55 + charge * 0.55;
      for (const s of shards) {
        const r = s.r * (1 - charge * 0.22);
        const a1 = s.p1 + t * s.w1 * speed;
        const a2 = s.p2 + t * s.w2 * speed;
        const a3 = s.p3 + t * s.w3 * speed;
        s.mesh.position.set(
          r * (Math.cos(a1) + 0.34 * Math.cos(a2 * 1.618)) * 0.75,
          s.lift * (Math.sin(a2) + 0.45 * Math.sin(a3 * 0.786)),
          r * (Math.sin(a1) + 0.34 * Math.sin(a3 * 1.324)) * 0.75,
        );
        s.mesh.rotation.set(a1 * 0.9, a2 * 0.7 + a3 * 0.3, a3 * 0.55);
      }
    },
  };
}

const CORE: Record<AltarElement, (c: Color) => Core> = {
  fire: fireCore, water: waterCore, air: airCore, rock: rockCore,
};

// -- the hall ----------------------------------------------------------------

/** One renderer per canvas; StrictMode mounts effects twice. See DESIGN.md §6. */
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

export function createAltars(
  canvas: HTMLCanvasElement,
  {
    sworn = null as AltarElement | null,
    onLayout,
    intro = false,
  }: {
    sworn?: AltarElement | null;
    /** Where each core is on screen, so the DOM can put a real button there. */
    onLayout?: (points: AltarPoint[]) => void;
    /**
     * Build the hall EMPTY, for the arrival sequence.
     *
     * It is a build-time flag and not a call because an altar that can be
     * absent has to own its stone: the plinth materials are shared by all four,
     * so fading one out fades the room. Under `intro` each altar gets its own
     * clone, which is four extra materials on the one path that needs them and
     * nothing at all on the path that does not.
     */
    intro?: boolean;
  } = {},
): Altars | null {
  LIVE.get(canvas)?.();

  let renderer: WebGLRenderer;
  try {
    /*
     * React StrictMode deliberately creates, disposes, and creates this hall
     * again on the same canvas. Browsers return the same WebGL2 context, whose
     * unpack flags can still be `true` after the first renderer uploaded a
     * CanvasTexture. Three creates its empty 3D/array textures before its own
     * state reset, and WebGL forbids FLIP_Y/PREMULTIPLY_ALPHA for texImage3D.
     * Reset those two inherited flags before Three initializes its sentinels.
     */
    const context = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!context) return null;
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
    context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  // No tone mapping: `--element` is already a light colour and ACES walks it
  // toward grey, which is the one thing these four may not do. Same call as the
  // monolith's — see the note there.
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.5, 40);

  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.22;

  const granite = graniteTexture();
  const halo = haloTexture();
  const shape = bezelShape();

  // Geometry shared across all four, built once.
  const footGeo = slab(1.24, 0.16, shape);
  const shaftGeo = slab(0.82, 1.18, shape);
  const capGeo = slab(1.06, 0.13, shape);
  // A bone-gold band under the cap. The chrome's own colour, on every plinth,
  // for the same reason the panels carry a gold hairline: it is the realm's
  // metal, and it is the one thing on these four stones that is not elemental.
  const bandGeo = slab(0.92, 0.022, shape);
  const haloGeo = new PlaneGeometry(1, 1);
  const ringGeo = new RingGeometry(0.62, 0.98, 96, 1);

  const bandMat = new MeshStandardMaterial({
    color: GOLD, metalness: 1, roughness: 0.3, envMapIntensity: 1.4,
  });

  const stoneMat = new MeshStandardMaterial({
    color: 0x1b1824, map: granite, bumpMap: granite, bumpScale: 0.7,
    roughness: 0.86, metalness: 0.06,
  });

  // -- the floor -------------------------------------------------------------

  // A dark ground that fades out rather than ending, so the hall has no walls
  // and no visible edge to the world.
  scene.add(new Mesh(
    new PlaneGeometry(46, 46),
    new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTint: { value: new Color(0x0a0c14) } },
      vertexShader: `
        varying vec2 vUv; varying float vDepth;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uTint; varying vec2 vUv; varying float vDepth;
        void main() {
          // Away from the middle of the room, and — the part that matters —
          // away from the CAMERA.
          //
          // Faded only from its own centre, the floor was still better than
          // eighty per cent opaque by the time it reached the near edge of the
          // frustum, so it ran straight into the bottom of the canvas and
          // stopped on a line.
          //
          // The near fade is in VIEW depth rather than world z. In world terms
          // it has to be retuned every time the camera moves, and the camera
          // moves with the viewport — one narrow window and the ground is cut
          // off again. In view depth the nearest visible floor sits at about
          // four units whatever the shape of the window, and the plinths are
          // always well past six.
          float far  = 1.0 - smoothstep(0.05, 0.55, length(vUv - 0.5) * 2.0);
          float near = smoothstep(3.4, 5.6, vDepth);
          gl_FragColor = vec4(uTint, far * near * 0.92);
        }`,
    }),
  ).rotateX(-Math.PI / 2));

  // -- one altar -------------------------------------------------------------

  type Built = {
    element: AltarElement;
    root: Group;
    core: Core;
    /** Its place in the arc at full spread. Scaled to fit in `size()`. */
    baseX: number;
    coreAt: Vector3;
    /** Where the DOM button goes: the foot of the plinth, not the core. */
    labelAt: Vector3;
    light: PointLight;
    glyphMat: MeshBasicMaterial;
    auraMat: MeshBasicMaterial;
    aura: Mesh;
    ringMat: ShaderMaterial;
    /** The plinth's own stone, when there is an arrival to fade it through. */
    stoneMat: MeshStandardMaterial;
    bandMat: MeshStandardMaterial;
    charge: number;   // eased
    target: number;
    /** 0 the altar is not in the room, 1 it is standing. Eased, like charge. */
    presence: number;
    presenceTarget: number;
    struckAt: number;
  };

  const PLINTH_TOP = 0.16 + 1.18 + 0.13;
  const built: Built[] = [];

  ALTAR_ORDER.forEach((element, i) => {
    const colour = new Color(HUE[element]);
    const root = new Group();

    // A shallow arc: the outer two set back and turned in, so the hall reads as
    // a place you are standing in rather than a shelf of four objects.
    const x = (i - 1.5) * 2.85;
    root.position.set(x, 0, -Math.abs(x) * 0.22);
    root.rotation.y = -x * 0.055;
    scene.add(root);

    // Its own stone only when the altar has to be able to not be there. The
    // clone shares the granite texture, so this is four material objects, not
    // four uploads.
    const stone = intro ? stoneMat.clone() : stoneMat;
    const gold = intro ? bandMat.clone() : bandMat;
    if (intro) {
      // Left transparent for good rather than switched back at the end of the
      // sequence: `transparent` is a program-level flag and flipping it mid-run
      // is a recompile, for a plinth that is already at full opacity.
      stone.transparent = true; stone.opacity = 0;
      gold.transparent = true; gold.opacity = 0;
    }

    const foot = new Mesh(footGeo, stone);
    foot.position.y = 0.08;
    root.add(foot);

    const shaft = new Mesh(shaftGeo, stone);
    shaft.position.y = 0.16 + 1.18 / 2;
    root.add(shaft);

    const cap = new Mesh(capGeo, stone);
    cap.position.y = 0.16 + 1.18 + 0.065;
    root.add(cap);

    const band = new Mesh(bandGeo, gold);
    band.position.y = 0.16 + 1.18 - 0.012;
    root.add(band);

    // The rune, cut into the shaft's face and lit from inside the stone.
    const glyphMat = new MeshBasicMaterial({
      map: glyphTexture(element), transparent: true, depthWrite: false,
      color: colour.clone(), toneMapped: false, opacity: 0.35,
      blending: AdditiveBlending,
    });
    const glyph = new Mesh(new PlaneGeometry(0.46, 0.46), glyphMat);
    glyph.position.set(0, 0.16 + 0.62, 0.42);
    root.add(glyph);

    // The core, floating clear of the cap.
    const core = CORE[element](colour);
    core.group.position.y = PLINTH_TOP + 0.62;
    root.add(core.group);

    // Its halo. Additive geometry rather than a bloom pass — see the file note.
    const auraMat = new MeshBasicMaterial({
      map: halo, color: colour.clone(), transparent: true,
      blending: AdditiveBlending, depthWrite: false, opacity: 0.3,
    });
    const aura = new Mesh(haloGeo, auraMat);
    aura.position.copy(core.group.position);
    aura.scale.setScalar(2.2);
    root.add(aura);

    // The ring cut into the floor. Rune ticks around the band, turning.
    const ringMat = new ShaderMaterial({
      transparent: true, depthWrite: false, side: DoubleSide,
      blending: AdditiveBlending, toneMapped: false,
      uniforms: {
        uTime: { value: 0 }, uCharge: { value: 0 }, uColour: { value: colour.clone() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uCharge; uniform vec3 uColour;
        varying vec2 vUv;
        void main() {
          // RingGeometry lays u around the circumference and v across the band.
          float a = vUv.x;
          float band = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
          // Twenty-four ticks, turning faster as the altar charges. A solid ring
          // reads as a UI element; ticks read as writing.
          float ticks = step(0.62, fract((a + uTime * (0.012 + uCharge * 0.05)) * 24.0));
          // Four longer marks at the quarters, which is what makes it a seal
          // rather than a dial.
          float quarters = step(0.86, fract((a + uTime * (0.012 + uCharge * 0.05)) * 4.0));
          float m = max(ticks * 0.55, quarters);
          gl_FragColor = vec4(uColour, band * m * (0.12 + uCharge * 0.8));
        }`,
    });
    const ring = new Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    root.add(ring);

    const light = new PointLight(HUE[element], 2, 7, 2);
    light.position.set(0, PLINTH_TOP + 0.62, 0.2);
    root.add(light);

    built.push({
      element, root, core, light, glyphMat, auraMat, aura, ringMat, baseX: x,
      stoneMat: stone, bandMat: gold,
      presence: intro ? 0 : 1, presenceTarget: intro ? 0 : 1,
      coreAt: new Vector3(x, PLINTH_TOP + 0.62, -Math.abs(x) * 0.22),
      // Anchored on a flat line rather than on the arc: projecting each
      // plinth's own foot put the outer two names higher up the screen than the
      // inner two, which is correct perspective and reads as broken type.
      labelAt: new Vector3(x, 0.02, 0.5),
      charge: 0, target: 0, struckAt: -1e9,
    });
  });

  // A cold key from high front, so the granite has a direction and the hall is
  // not lit only by the thing the player is choosing between.
  const key = new PointLight(0xbcd0ff, 12, 26, 2);
  key.position.set(-2.5, 5.5, 5);
  scene.add(key);

  // -- state -----------------------------------------------------------------

  let active: AltarElement | null = null;
  let oath: AltarElement | null = sworn;

  /*
    Only what you are standing at is lit.

    The oath used to decide this: land on the screen already sworn and your own
    altar was up and the other three were out — the hall telling you you had
    chosen before you touched anything, and three of the four greyed out for a
    choice you might still want to look at. Being sworn is a STATUS and it is
    carried in words, under the plinth. It buys no light at all.

    So at rest the hall is even, and full charge is reserved for the altar the
    pointer is actually on, whoever you belong to.
  */
  /**
   * The idle charge. Every altar sits here unless it is the one you are on.
   *
   * The others used to fall back to 0.14 when something was hovered, and the
   * charge is not only brightness — rock draws its shards inward with it and
   * air tightens and dims its vortex. So pointing at fire made the earth and the
   * wind move, which is three altars reacting to a fourth being touched.
   *
   * Nothing dims now. The active altar comes up; the rest are exactly where they
   * were, and stay there.
   */
  const IDLE = 0.36;

  /**
   * What an altar sits at once it has been shown off and stepped back.
   *
   * Well under `IDLE`, and that is the point of the sequence: the one under the
   * light is the only lit thing in the room, and the ones behind it read as
   * stone waiting its turn. They all come back to `IDLE` together at the end,
   * which is the moment the choice is handed over.
   *
   * Not near zero, though — that was the first attempt and it emptied the
   * plinths. A core carries no light of its own below about a tenth of a
   * charge, so an altar that had already been shown off went back to being a
   * bare stone box and the room lost the three factions it had just introduced.
   */
  const INTRO_BACK = 0.16;

  /** Non-null while the hall is being introduced. See `setIntro`. */
  let arrival: AltarIntro | null = intro ? { present: [], spotlight: null } : null;

  const retarget = () => {
    for (const a of built) {
      if (!arrival) {
        a.presenceTarget = 1;
        a.target = a.element === active ? 1 : IDLE;
        continue;
      }
      const here = arrival.present.includes(a.element);
      a.presenceTarget = here ? 1 : 0;
      // An altar that has not arrived is not dark, it is absent: charge 0 as
      // well as presence 0, so it does not fade up already glowing.
      a.target = !here ? 0 : arrival.spotlight === a.element ? 1 : INTRO_BACK;
    }
  };
  retarget();
  // Start settled rather than fading up from black on mount — except during an
  // arrival, where starting from nothing is the whole point.
  for (const a of built) a.charge = a.target;

  // -- framing ---------------------------------------------------------------

  let lastLayout = '';

  const project = () => {
    if (!onLayout) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const toScreen = (v: Vector3) => {
      const p = v.clone().project(camera);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
    const points = built.map((a) => {
      const anchor = toScreen(a.labelAt);
      // A little over the core, so the flame/orb/vortex is inside the hit area
      // and not just the stone under it.
      const crown = toScreen(new Vector3(a.coreAt.x, a.coreAt.y + 1.15, a.coreAt.z));
      // The foot's own half-width, projected at the foot's depth. `footGeo` is
      // 1.24 wide; 0.72 gives it a little margin without reaching its neighbour,
      // which stands 2.85 away before the narrow-screen spread closes them up.
      const edge = toScreen(new Vector3(a.coreAt.x + 0.72, 0.08, a.coreAt.z));
      const centre = toScreen(new Vector3(a.coreAt.x, 0.08, a.coreAt.z));
      return {
        element: a.element,
        x: anchor.x,
        y: anchor.y,
        // Perspective scale, so a button over a further altar can shrink with it.
        scale: 1 - (a.coreAt.z * -1) * 0.06,
        top: crown.y,
        half: Math.abs(edge.x - centre.x),
      };
    });
    const key2 = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.top.toFixed(1)},${p.half.toFixed(1)}`).join('|');
    if (key2 === lastLayout) return;
    lastLayout = key2;
    onLayout(points);
  };

  const size = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    /*
      The arc closes up on a narrow viewport.

      With the spread fixed, fitting four plinths across a phone meant standing
      the camera off at three times the distance, and the hall arrived as four
      specks. Pulling them together instead costs a little of the sense of a room
      and keeps the altars at a size worth looking at — and on anything wide the
      factor is 1, so the desktop hall is unchanged.
    */
    const spread = Math.min(1, Math.max(0.5, camera.aspect / 2.1));
    for (const a of built) {
      const x = a.baseX * spread;
      const z = -Math.abs(x) * 0.22;
      a.root.position.set(x, 0, z);
      a.root.rotation.y = -x * 0.055;
      a.coreAt.set(x, PLINTH_TOP + 0.62, z);
      a.labelAt.set(x, 0.02, 0.5);
    }

    /*
      Air.

      The two fits below solve for the content exactly — the outermost plinth,
      and the top of the flame — which frames the hall with its edges touching
      the sides of the screen. This is the gap between the two: everything is
      pushed back by a fifth, so the room has somewhere to be.
    */
    const AIR = 1.2;

    // Solve the distance that fits the hall rather than fixing one, from the
    // outermost plinth as it actually stands after the spread.
    const halfFov = Math.tan((camera.fov * Math.PI) / 360);
    const outer = Math.abs(built[0]?.baseX ?? 3.675) * spread + 0.85;
    const forWidth = (outer * AIR) / halfFov / camera.aspect;
    // Framed on what the altars DO, not on how tall they are: the flame reaches
    // roughly a unit above its core and throws embers half again past that, so
    // fitting the stone alone cut the top off three of the four. It stops short
    // of the very last of the ember travel on purpose — by then they are almost
    // entirely faded, and every unit of headroom is paid for in camera distance.
    /*
      How much room the hall stands in.

      A world height, not a pixel one: growing the canvas does not show more of
      the room, it shows the same amount of room larger. Taking the hall
      full-page grew the canvas by a sixth and the altars came up with it, which
      read as having zoomed in on them.

      2.4 puts the plinth feet around seven tenths of the way down whatever the
      canvas is, which leaves the plaques their room under each pillar and the
      flame its headroom above.
    */
    const forHeight = (2.4 * AIR) / halfFov;
    camera.position.set(0, 1.85, Math.max(forHeight, forWidth));
    camera.lookAt(0, 0.96, 0);
    camera.updateProjectionMatrix();
    lastLayout = '';
    project();
    // Draw one frame here. A resize clears the drawing buffer, and a resize
    // that lands while the loop is parked — a backgrounded tab gets no
    // animation frames — otherwise leaves an empty hall until the tab is looked
    // at again.
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(size);
  observer.observe(canvas);
  size();

  if (import.meta.env.DEV) {
    (window as any).__altars = { scene, camera, renderer, built };
  }

  // -- the loop --------------------------------------------------------------

  let raf = 0;
  let disposed = false;
  const t0 = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;

    for (const a of built) {
      // Eased, not switched. The hall should feel like it is responding to you
      // rather than toggling.
      a.charge += (a.target - a.charge) * (reduced ? 1 : 0.09);
      a.presence += (a.presenceTarget - a.presence) * (reduced ? 1 : 0.085);
      const ring = Math.exp(-(now - a.struckAt) / 520);
      const c = a.charge + ring * 1.6;

      /*
        Arriving.

        The plinth rises the last three quarters of a metre into its place and
        fades in as it comes, so an altar enters the room from under the floor
        rather than being switched on in mid-air. `p` then multiplies everything
        the altar emits — nothing may glow from a stone that is not all the way
        up. Skipped entirely once it is standing, which is every frame of the
        hall's actual life.
      */
      const p = a.presence;
      if (p < 0.999) {
        a.root.visible = p > 0.004;
        a.root.position.y = (p - 1) * 0.75;
        a.stoneMat.opacity = p;
        a.bandMat.opacity = p;
        // The core is the brightest thing on the altar; hold it until the stone
        // under it is most of the way there.
        a.core.group.visible = p > 0.3;
      } else if (a.root.position.y !== 0) {
        a.root.visible = true;
        a.root.position.y = 0;
        a.stoneMat.opacity = 1;
        a.bandMat.opacity = 1;
        a.core.group.visible = true;
      }

      a.core.update(reduced ? 0 : t, a.charge);
      // Each core breathes on its own phase, seeded off its x, so the four
      // never rise and fall together.
      a.core.group.position.y = PLINTH_TOP + 0.62
        + (reduced ? 0 : Math.sin(t * 0.6 + a.coreAt.x) * 0.035);
      a.aura.position.y = a.core.group.position.y;

      a.glyphMat.opacity = (0.12 + a.charge * 0.95 + ring * 1.2) * p;
      a.auraMat.opacity = (0.05 + a.charge * 0.5 + ring * 0.8) * p;
      a.aura.scale.setScalar(1.9 + a.charge * 0.55 + ring * 2.4);
      a.light.intensity = (0.3 + c * 11) * p;
      a.ringMat.uniforms.uTime.value = t;
      // The one mark the oath leaves in the scene: your own circle stays cut
      // into the floor whether or not you are standing at it. It costs the
      // altar no light, so it marks without ranking.
      a.ringMat.uniforms.uCharge.value = Math.min(1.4, c + (a.element === oath ? 0.3 : 0)) * p;
    }

    /*
      The camera does not move.

      It used to breathe — a slow drift on x and y — and that was paid for
      somewhere unexpected: every plaque is a DOM element positioned from a
      projection of its own altar, so a camera that moves is four inline styles
      rewritten sixty times a second. The plaques crawled, and React re-rendered
      the hall on every frame to make them do it.

      The four cores are already moving. The room does not also need to.
    */

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: Altars = {
    setActive(element) {
      active = element;
      retarget();
    },
    setIntro(state) {
      // Only a hall built for it can be introduced; on any other the four are
      // already standing and pretending otherwise would drop them through the
      // floor mid-session.
      if (!intro) return;
      arrival = state;
      retarget();
    },
    setSworn(element) {
      oath = element;
      retarget();
    },
    strike(element) {
      const a = built.find((x) => x.element === element);
      if (a) a.struckAt = performance.now();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      if (import.meta.env.DEV) delete (window as any).__altars;
      cancelAnimationFrame(raf);
      observer.disconnect();
      env.texture.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      granite.dispose();
      halo.dispose();
      renderer.dispose();
    },
  };

  LIVE.set(canvas, handle.dispose);
  return handle;
}
