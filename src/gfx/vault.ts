/**
 * The vault — the loot box, opened properly.
 *
 * A tier name and a list of rewards is a receipt, not a reward. This is the
 * ceremony: a sealed chest on a rune plinth, the seal cracking, light forcing
 * its way out of the seam, the lid thrown open and the contents blown into the
 * room. It runs for exactly as long as the chain takes to answer, which is the
 * other half of why it exists — the wait is the anticipation instead of a
 * spinner over a dialog.
 *
 * three.js rather than raw WebGL, unlike the aether: that is one fullscreen
 * quad and one shader, this is geometry, metal, shadowed light, bloom and a
 * particle system, and hand-rolling that is a renderer, not an effect.
 *
 * Everything is procedural — no models, no textures, no HDRIs shipped. The
 * chest is rounded boxes and bands, the environment is `RoomEnvironment`, and
 * the mark on the lid is the game's own sigil drawn to a canvas. Nothing here
 * adds a byte of asset to the bundle.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BufferAttribute, BufferGeometry,
  CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, PointLight, Points, RepeatWrapping, RingGeometry, Scene, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, Texture, TextureLoader, TorusGeometry, Vector3, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawMark } from './mark';

/** What each rarity is made of light-wise. Index matches `LOOTBOX_TIER`. */
const RARITY_COLOR = [
  0x9aa3b8, // (unused index 0)
  0x9aa3b8, // Common
  0x4ade80, // Uncommon
  0x38bdf8, // Rare
  0xa855f7, // Epic
  0xfbbf24, // Legendary
];

const GOLD = 0xd6c8a2;

/**
 * What each tier is BUILT of, as opposed to what colour its light is.
 *
 * `RARITY_COLOR` only ever drove the glow, the seal and the beam, so every box
 * in the game was the same purple crate with the same gold straps and the only
 * difference between a Common and a Legendary was the colour of the light
 * coming out of the seam. The prop is the thing on screen for six seconds; it
 * should be the thing that differs.
 *
 * `straps` are x positions, and they are chosen around two fixed obstacles: the
 * seal on the lid spans +/-0.39, and the lock sits on the front at x=0. Nothing
 * belongs between +/-0.42 or the mark gets a bar across it.
 */
const RARITY_BUILD = [
  // (unused index 0)
  { wood: 0x2b2136, metal: GOLD, straps: [-0.62, 0.62], rivets: 4, brackets: true, gem: 0 },
  // Common — a shipping crate. Rough pine, cold iron, no ornament at all.
  { wood: 0x3b3430, metal: 0x8b8f99, straps: [-0.62, 0.62], rivets: 2, brackets: false, gem: 0 },
  // Uncommon — the same crate, kept: warmer timber, bronze, corners protected.
  { wood: 0x40301f, metal: 0xa9793f, straps: [-0.62, 0.62], rivets: 3, brackets: true, gem: 0 },
  // Rare — planed and banded properly. Cold blue timber under bright silver.
  { wood: 0x232a3a, metal: 0xc2ccd8, straps: [-0.86, -0.5, 0.5, 0.86], rivets: 3, brackets: true, gem: 0 },
  // Epic — the arcane purple this whole ceremony was built around, and a stone.
  { wood: 0x2b2136, metal: 0xbda6e2, straps: [-0.86, -0.5, 0.5, 0.86], rivets: 4, brackets: true, gem: 0xb98bff },
  // Legendary — black lacquer and gold. The only one that reads as treasure.
  { wood: 0x1d1610, metal: GOLD, straps: [-0.86, -0.5, 0.5, 0.86], rivets: 4, brackets: true, gem: 0xffd76a },
];

/**
 * A CSS colour derived from one of the above, mixed toward white (`k > 0`) or
 * black (`k < 0`). The texture painters were written with their purples typed
 * in by hand; this is what lets one painter serve six chests.
 */
function tint(hex: number, k: number, alpha = 1) {
  const to = k >= 0 ? 255 : 0;
  const t = Math.abs(k);
  const m = (v: number) => Math.round(v + (to - v) * t);
  return `rgba(${m((hex >> 16) & 255)},${m((hex >> 8) & 255)},${m(hex & 255)},${alpha})`;
}

/** One reward, as the ceremony needs it: a picture and a count. */
export type Spoil = { url: string; amount: number };

export type Vault = {
  /**
   * Break the seal, and throw these out of the chest. Safe to call once;
   * later calls are ignored.
   */
  open(spoils?: Spoil[]): void;
  /** True once the spoils are caught and readable. */
  readonly opened: boolean;
  dispose(): void;
};

type Phase = 'sealed' | 'crack' | 'burst' | 'open';

/**
 * The ceremony is slow on purpose.
 *
 * The first cut of this ran crack-to-settled in 1.5 seconds, and what a player
 * actually saw was a closed chest and then an open one — the opening itself
 * happened inside the time it takes to notice something changed. Every stage
 * here is now long enough to be an event: the chest strains and knocks against
 * its own lid three times before it gives, the lid is thrown with an overshoot
 * you can read, and the blast stays in frame instead of leaving it in 400ms.
 */
const CRACK_MS = 1800;   // seal splitting, chest straining, three knocks
const BURST_MS = 1700;   // lid thrown, blast out and falling back

/**
 * And then the spoils, which is the part that used to be missing.
 *
 * The rewards were listed in HTML under the canvas the moment the lid moved, so
 * the ceremony ended by cutting away from itself: the chest opened onto nothing
 * and the loot turned up somewhere else, in a table, half a second early. The
 * items come out of the chest now — launched on the burst, thrown through the
 * blast, and caught in a fan in front of it — and nothing is shown anywhere
 * else until they have landed.
 */
const SPOIL_STAGGER = 110;  // ms between items leaving the chest
const SPOIL_FLY = 820;      // ballistic, out of the chest and over the top
const SPOIL_CATCH = 660;    // pulled out of the arc into its place in the fan
const SPOIL_HOLD = 1500;    // held, legible, before the ceremony stands down

/**
 * A texture drawn on the spot.
 *
 * The chest was flat-shaded boxes, which is what "low resolution" actually
 * looked like — there was nothing on the surfaces for the eye to resolve. All
 * of this is drawn into a canvas at load: no files, no fetch, no bundle cost.
 */
function makeTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  repeat: [number, number],
  srgb = true,
) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, size);
  const tex = new CanvasTexture(c);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  return tex;
}

/** Planked, grained hardwood, dark enough to sit in the game's palette. */
function drawWood(ctx: CanvasRenderingContext2D, s: number, mono = false, tone = 0x2b2136) {
  ctx.fillStyle = mono ? '#808080' : tint(tone, 0);
  ctx.fillRect(0, 0, s, s);

  // Grain: long strokes that wander, drawn light and dark so the surface has
  // depth rather than a single scratched direction.
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * s;
    const light = Math.random() > 0.5;
    ctx.strokeStyle = mono
      ? `rgba(255,255,255,${light ? 0.09 : 0.04})`
      : light ? tint(tone, 0.5, 0.09) : tint(tone, -0.75, 0.35);
    ctx.lineWidth = 0.6 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(-4, y);
    const wobble = 3 + Math.random() * 9;
    for (let x = 0; x <= s; x += 16) {
      ctx.lineTo(x, y + Math.sin((x / s) * Math.PI * (1 + Math.random() * 3)) * wobble);
    }
    ctx.stroke();
  }

  // Plank seams, which is what tells you it is built rather than moulded.
  for (const y of [0.22, 0.5, 0.78]) {
    ctx.strokeStyle = mono ? 'rgba(0,0,0,0.55)' : tint(tone, -0.85, 0.85);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y * s);
    ctx.lineTo(s, y * s);
    ctx.stroke();
    ctx.strokeStyle = mono ? 'rgba(255,255,255,0.3)' : tint(tone, 0.42, 0.14);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y * s + 2.5);
    ctx.lineTo(s, y * s + 2.5);
    ctx.stroke();
  }
}

/** Hammered, slightly pitted metal. Flat metal reads as plastic. */
function drawGold(ctx: CanvasRenderingContext2D, s: number, mono = false, tone = GOLD) {
  ctx.fillStyle = mono ? '#8c8c8c' : tint(tone, 0);
  ctx.fillRect(0, 0, s, s);

  for (let i = 0; i < 900; i++) {
    const r = 2 + Math.random() * 9;
    const light = Math.random() > 0.5;
    ctx.fillStyle = mono
      ? `rgba(${light ? '255,255,255' : '0,0,0'},${0.05 + Math.random() * 0.09})`
      : light ? tint(tone, 0.7, 0.16) : tint(tone, -0.6, 0.16);
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // A scored line down the middle of every strap: the one straight edge on an
  // otherwise beaten surface, which is what makes the beating read.
  ctx.strokeStyle = mono ? 'rgba(0,0,0,0.5)' : tint(tone, -0.68, 0.5);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(s / 2, 0);
  ctx.lineTo(s / 2, s);
  ctx.stroke();
}

/**
 * The vault makes its own canvas.
 *
 * It used to be handed one, and that is the root of a whole family of bugs.
 * React's StrictMode mounts every effect twice in development: the first vault
 * is built, disposed, and a second built on the SAME canvas — which means the
 * same GL context, already torn down by the first one's `renderer.dispose()`.
 * The second renderer comes up attached to a poisoned context and draws
 * nothing at all, which is what "it flickers and shows nothing" was.
 *
 * Guarding it with a registry only papered over it, because the eviction and
 * the re-creation are the same event. Owning the element instead settles it:
 * every instance gets a private canvas and a private context, and disposing one
 * takes its canvas out of the document with it. Nothing is shared, so there is
 * nothing to fight over.
 *
 * The caller passes the box it should fill.
 */
export function createVault(
  host: HTMLElement,
  { rarity, onReveal, onDone }: {
    rarity: number;
    /** The spoils are caught and legible. */
    onReveal?: () => void;
    /** The whole ceremony is over and the overlay can stand down. */
    onDone?: () => void;
  },
): Vault {
  const tint = new Color(RARITY_COLOR[rarity] ?? RARITY_COLOR[1]);

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  // Framed on the chest's own centre, not on its lid: aiming higher than the
  // subject is what left it sitting in the bottom third of the panel.
  camera.position.set(0, 1.35, 5.2);

  // Reflections without an HDRI: the standard room, baked once into a PMREM.
  // Metal with nothing to reflect reads as flat plastic, and gold especially.
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;

  // Lights ------------------------------------------------------------------

  // Inside the chest, low, so the light that escapes reads as coming from the
  // contents. It sits close to the gold, which is why its settled intensity is
  // small — at 16 it turned the bands into white bars.
  const key = new PointLight(tint.getHex(), 0, 20, 2);
  key.position.set(0, 0.35, 0);
  scene.add(key);

  const rim = new PointLight(0xffffff, 7, 20, 2);
  rim.position.set(-3.2, 3.4, 3.4);
  scene.add(rim);

  const fill = new PointLight(tint.getHex(), 4, 24, 2);
  fill.position.set(3.4, 1.2, 2.6);
  scene.add(fill);

  // The chest ---------------------------------------------------------------

  const vault = new Group();
  scene.add(vault);

  const build = RARITY_BUILD[rarity] ?? RARITY_BUILD[0];

  const woodTex = makeTexture(512, (c, n) => drawWood(c, n, false, build.wood), [2, 1]);
  const woodBump = makeTexture(512, (c, n) => drawWood(c, n, true), [2, 1], false);
  const goldTex = makeTexture(256, (c, n) => drawGold(c, n, false, build.metal), [1, 2]);
  const goldBump = makeTexture(256, (c, n) => drawGold(c, n, true), [1, 2], false);

  const woodMat = new MeshStandardMaterial({
    map: woodTex, bumpMap: woodBump, bumpScale: 1.4,
    roughnessMap: woodBump, roughness: 0.85, metalness: 0.1,
  });
  const goldMat = new MeshStandardMaterial({
    map: goldTex, bumpMap: goldBump, bumpScale: 0.6,
    // White, not the tier's metal: the map is ALREADY painted in it, and
    // multiplying the two squared every colour — iron came out near-black and
    // only gold survived, which is how five tiers ended up looking like one.
    color: 0xffffff, roughnessMap: goldBump, roughness: 0.42, metalness: 1,
    envMapIntensity: 0.8,
  });
  const glowMat = new MeshStandardMaterial({
    color: 0x000000, emissive: tint, emissiveIntensity: 0, roughness: 1,
  });

  const body = new Mesh(new RoundedBoxGeometry(2.05, 1.0, 1.3, 4, 0.08), woodMat);
  body.position.y = 0.0;
  vault.add(body);

  // What is inside, seen once the lid is off: a slab of light sitting in the
  // chest's mouth. Cheaper and better-looking than modelling contents nobody
  // sees for more than a second.
  const glow = new Mesh(new RoundedBoxGeometry(1.8, 0.9, 1.05, 2, 0.06), glowMat);
  glow.position.y = 0.06;
  vault.add(glow);

  /*
    The straps, and the one number that matters here: SEAM.

    The body's top face is at y=0.50 and the lid's underside at y=0.44 — the
    lid's skirt covers the body's top 0.06, so the joint you actually SEE from
    outside is at 0.44. Both straps were solid boxes taller than the piece they
    wrapped: the body's ran to 0.53 and the lid's down to 0.41, so each one
    carried on past the joint and into the other's half. Closed, they
    interpenetrated and z-fought along the seam; open, the body's strap stood up
    as a tab inside the chest's mouth and the lid's hung down under the lid as a
    tongue. A strap wraps the outside of a box. It has no business on the inside
    of one.

    So each stops flush at SEAM and is proud only where a strap should be — 0.03
    past the front, the back, and the far end of its own piece.
  */
  const SEAM = 0.44;
  const bodyBottom = -0.53;    // 0.03 below the body: the strap passes under it
  const lidTop = 0.91;         // 0.03 above the lid: and over the top of it

  const rivet = new SphereGeometry(0.035, 12, 8);
  const rivetYs = [-0.36, -0.12, 0.12, 0.36].slice(0, build.rivets);
  for (const x of build.straps) {
    const band = new Mesh(
      new RoundedBoxGeometry(0.16, SEAM - bodyBottom, 1.36, 3, 0.03),
      goldMat,
    );
    band.position.set(x, (SEAM + bodyBottom) / 2, 0);
    vault.add(band);
    // Rivets. A few beads of geometry each, and the chest stops being boxes.
    for (const y of rivetYs) {
      const head = new Mesh(rivet, goldMat);
      head.position.set(x, y, 0.68);
      vault.add(head);
    }
  }

  // Corner brackets, front two only — the back is never seen. Both sit BELOW
  // the seam for the same reason the straps stop at it: the upper pair used to
  // be centred at 0.46 and reach to 0.52, so a fitting bolted to the body stood
  // across the lid's edge and read as a tab stuck to nothing once it opened.
  if (build.brackets) {
    for (const x of [-0.98, 0.98]) {
      for (const y of [-0.46, SEAM - 0.07]) {
        const bracket = new Mesh(new RoundedBoxGeometry(0.12, 0.12, 0.12, 2, 0.03), goldMat);
        bracket.position.set(x, y, 0.63);
        vault.add(bracket);
      }
    }
  }

  // The lid, hinged at the back edge rather than spun about its middle.
  const hinge = new Group();
  hinge.position.set(0, 0.5, -0.65);
  vault.add(hinge);

  const lid = new Mesh(new RoundedBoxGeometry(2.05, 0.44, 1.3, 4, 0.08), woodMat);
  lid.position.set(0, 0.16, 0.65);
  hinge.add(lid);

  // The lid's half of each strap. Local y is offset by the hinge's own 0.5, so
  // the world span [SEAM, lidTop] is written here as [-0.06, 0.41].
  for (const x of build.straps) {
    const band = new Mesh(
      new RoundedBoxGeometry(0.16, lidTop - SEAM, 1.36, 2, 0.03),
      goldMat,
    );
    band.position.set(x, (lidTop + SEAM) / 2 - 0.5, 0.65);
    hinge.add(band);
  }

  // The staple the shackle hooks over. It belongs to the LID, which is why the
  // lock has something to hold and why the shackle is what gives, not this.
  const staple = new Mesh(new RoundedBoxGeometry(0.15, 0.11, 0.07, 2, 0.02), goldMat);
  staple.position.set(0, 0.03, 1.35);
  hinge.add(staple);

  // The seal: the realm's own mark, cut into the lid and lit from beneath.
  const sealCanvas = document.createElement('canvas');
  sealCanvas.width = sealCanvas.height = 256;
  // The Realm Seal, not a player's sigil. This chest belongs to the realm, and
  // the mark cut into its lid is the same one in the header and the browser tab.
  drawMark(sealCanvas, { color: '#ffffff' });
  const sealTex = new CanvasTexture(sealCanvas);
  sealTex.colorSpace = SRGBColorSpace;

  const seal = new Mesh(
    new RoundedBoxGeometry(0.78, 0.02, 0.78, 1, 0.01),
    new MeshStandardMaterial({
      map: sealTex, transparent: true, emissive: tint, emissiveMap: sealTex,
      emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.6,
    }),
  );
  seal.position.set(0, 0.39, 0.65);
  hinge.add(seal);

  // The lock ----------------------------------------------------------------
  //
  // It straddles the joint: a plate bolted to the body, a shackle arcing up out
  // of it and over the staple on the lid. It is the answer to a question the
  // ceremony was asking without ever showing it — the chest knocks three times
  // against something, and until now there was nothing there to knock against.
  //
  // Its own material, cloned, for one reason: the pieces have to fade out after
  // they are thrown, and `goldMat` is shared with every strap on the chest.
  const lockMat = goldMat.clone();
  lockMat.transparent = true;

  const lockGroup = new Group();
  lockGroup.position.set(0, 0.29, 0.71);
  vault.add(lockGroup);

  const lockPlate = new Mesh(new RoundedBoxGeometry(0.34, 0.30, 0.10, 2, 0.035), lockMat);
  lockGroup.add(lockPlate);

  const keyholeMat = new MeshStandardMaterial({
    color: 0x0a0710, roughness: 0.6, metalness: 0.3, transparent: true,
  });
  const keyhole = new Mesh(new CylinderGeometry(0.038, 0.038, 0.12, 12), keyholeMat);
  keyhole.rotation.x = Math.PI / 2;
  keyhole.position.set(0, -0.02, 0.02);
  lockGroup.add(keyhole);

  /*
    The shackle, in two quarter-arcs rather than one half-ring.

    A torus arc runs counter-clockwise from +X, so a quarter is the upper-right
    of the ring: one end at the plate, the other at top dead centre. The second
    copy rotated a quarter turn is its mirror. They meet at the top, which is
    exactly where a shackle gives — so breaking it is letting the two halves go,
    not swapping a whole part for a broken one.
  */
  const shackleGeo = new TorusGeometry(0.13, 0.028, 8, 20, Math.PI / 2);
  const shackleR = new Mesh(shackleGeo, lockMat);
  const shackleL = new Mesh(shackleGeo, lockMat);
  shackleL.rotation.z = Math.PI / 2;
  // A group, because the strain is a stretch of the WHOLE arc from where it
  // enters the plate. The left half is rotated a quarter turn, so its own local
  // Y no longer points up — scaling the halves individually would pull one of
  // them sideways.
  const shackle = new Group();
  shackle.position.set(0, 0.15, 0);
  shackle.add(shackleR, shackleL);
  lockGroup.add(shackle);

  // A stone in the plate, for the tiers that have earned one.
  const gem = build.gem
    ? new Mesh(
      new OctahedronGeometry(0.09, 0),
      new MeshStandardMaterial({
        color: build.gem, emissive: build.gem, emissiveIntensity: 0.5,
        roughness: 0.15, metalness: 0.2, transparent: true,
      }),
    )
    : null;
  if (gem) {
    gem.position.set(0, 0.075, 0.055);
    gem.rotation.z = Math.PI / 4;
    lockGroup.add(gem);
  }

  /*
    What the lock does when it stops being a lock.

    Each piece carries its own velocity and spin in the lock group's frame and
    is integrated under gravity from the instant the lid gives. Nothing is
    reparented: the group rides the chest's slow drift, which is the frame the
    pieces left from, so they keep travelling in a straight line relative to the
    thing that threw them.
  */
  type Shard = { mesh: Mesh; vel: Vector3; spin: Vector3 };
  const shards: Shard[] = [
    { mesh: shackleR, vel: new Vector3(1.9, 2.3, 1.0), spin: new Vector3(5, 3, 11) },
    { mesh: shackleL, vel: new Vector3(-1.8, 2.1, 1.2), spin: new Vector3(-6, -4, -9) },
    { mesh: lockPlate, vel: new Vector3(0.25, 0.7, 1.9), spin: new Vector3(4, 7, 3) },
    { mesh: keyhole, vel: new Vector3(0.25, 0.7, 1.9), spin: new Vector3(4, 7, 3) },
    ...(gem ? [{ mesh: gem, vel: new Vector3(-0.6, 2.7, 1.5), spin: new Vector3(9, 9, 9) }] : []),
  ];
  const shardHome = shards.map((sh) => sh.mesh.position.clone());
  let brokenAt = -1;

  // The plinth --------------------------------------------------------------

  const plinth = new Mesh(
    new CylinderGeometry(1.55, 1.75, 0.34, 64),
    new MeshStandardMaterial({ color: 0x14121c, roughness: 0.75, metalness: 0.4 }),
  );
  plinth.position.y = -0.68;
  vault.add(plinth);

  const ring = new Mesh(
    new RingGeometry(1.05, 1.42, 96),
    new ShaderMaterial({
      transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: tint }, uPower: { value: 0.35 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; uniform float uPower;
        varying vec2 vUv;
        void main() {
          // Twenty four ticks around the ring, with a light travelling through
          // them — the plinth is a mechanism, and it is running.
          float ticks = smoothstep(0.6, 0.78, fract(vUv.x * 24.0)) * 0.5;
          float sweep = pow(fract(vUv.x - uTime * 0.12), 6.0);
          float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          float a = (ticks * 0.5 + sweep * 1.6) * edge * uPower;
          gl_FragColor = vec4(uColor * a * 2.2, a);
        }`,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.5;
  vault.add(ring);

  // The beam ----------------------------------------------------------------

  const beam = new Mesh(
    new CylinderGeometry(0.42, 1.15, 6, 48, 1, true),
    new ShaderMaterial({
      transparent: true, blending: AdditiveBlending, depthWrite: false, side: BackSide,
      uniforms: { uColor: { value: tint }, uPower: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uPower;
        varying vec2 vUv;
        void main() {
          float fade = pow(vUv.y, 1.6) * smoothstep(0.0, 0.25, 1.0 - vUv.y);
          float a = fade * uPower;
          gl_FragColor = vec4(uColor * a * 3.0, a);
        }`,
    }),
  );
  beam.position.y = 3.0;
  beam.visible = false;
  vault.add(beam);

  // Motes and the burst -----------------------------------------------------

  const COUNT = 4200;
  const seeds = new Float32Array(COUNT * 3);
  const offsets = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
    offsets[i] = Math.random();
  }
  const dust = new BufferGeometry();
  // Position is unused — every particle's place comes from its seed on the GPU,
  // so the CPU never touches this buffer again after setup.
  dust.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3));
  dust.setAttribute('aSeed', new BufferAttribute(seeds, 3));
  dust.setAttribute('aOffset', new BufferAttribute(offsets, 1));

  const dustMat = new ShaderMaterial({
    transparent: true, blending: AdditiveBlending, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uBurst: { value: 0 }, uColor: { value: tint }, uScale: { value: 1 },
    },
    vertexShader: `
      attribute vec3 aSeed;
      attribute float aOffset;
      uniform float uTime; uniform float uBurst; uniform float uScale;
      varying float vFade;
      void main() {
        // Before the chest opens: motes circling it, rising slowly, recycling.
        float radius = 0.95 + aSeed.z * 1.7;
        float spin = 0.06 + aSeed.y * 0.18;
        float angle = uTime * spin + aOffset * 6.28318;
        float climb = 0.015 + aSeed.z * 0.04;
        float rise = -0.85 + fract(aSeed.x + uTime * climb) * 2.1;
        vec3 idle = vec3(cos(angle) * radius, rise, sin(angle) * radius);

        // After: thrown out of the chest mouth on a ballistic arc.
        vec3 dir = normalize(aSeed * 2.0 - 1.0 + vec3(0.0, 0.9, 0.0));
        float speed = 1.5 + aSeed.x * 3.1;
        vec3 blast = vec3(0.0, 0.45, 0.0)
          + dir * speed * uBurst
          - vec3(0.0, 2.2 * uBurst * uBurst, 0.0);

        float b = smoothstep(0.0, 0.06, uBurst);
        vec3 pos = mix(idle, blast, b);

        vFade = mix(0.16 + 0.26 * aSeed.y, max(0.0, 1.0 - uBurst * 0.62), b);

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uScale * (7.0 + aSeed.x * 22.0) * (1.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d)) * vFade;
        gl_FragColor = vec4(uColor * a * 2.4, a);
      }`,
  });
  const dustPoints = new Points(dust, dustMat);
  scene.add(dustPoints);

  // The shockwave the lid leaves behind.
  const wave = new Mesh(
    new RingGeometry(0.8, 1.0, 96),
    new ShaderMaterial({
      transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      uniforms: { uColor: { value: tint }, uPower: { value: 0 } },
      vertexShader: `
        void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uPower;
        void main() { gl_FragColor = vec4(uColor * uPower * 2.0, uPower); }`,
    }),
  );
  wave.rotation.x = -Math.PI / 2;
  wave.position.y = 0.3;
  wave.visible = false;
  scene.add(wave);

  // The flash. One frame of white at the instant the lid gives, then gone —
  // this is the thing that makes an opening read as a burst rather than an
  // animation, and it was missing entirely.
  const flash = new Mesh(
    new SphereGeometry(0.7, 24, 16),
    new MeshBasicMaterial({
      color: tint, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0,
    }),
  );
  flash.position.y = 0.35;
  flash.visible = false;
  scene.add(flash);

  // The spoils --------------------------------------------------------------

  /**
   * The rewards, as objects in the room rather than rows in a table.
   *
   * Each one is a billboard of its own art with its count struck underneath,
   * held in a group so the two move as one thing. They start inside the chest
   * at zero scale, are launched on the burst with a real velocity, fall under
   * gravity while they tumble, and are then pulled out of that arc into a fan
   * facing the camera. The blend is a smoothstep across `SPOIL_CATCH`, so the
   * hand-off from physics to arrangement has no seam in it.
   */
  const spoils = new Group();
  scene.add(spoils);

  const spoilLoader = new TextureLoader();
  const spoilTextures: Texture[] = [];

  /** The soft disc behind each item, so it reads as lit rather than pasted. */
  const haloTex = makeTexture(128, (c, n) => {
    const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, n, n);
  }, [1, 1]);
  const haloGeo = new PlaneGeometry(1.5, 1.5);
  const itemGeo = new PlaneGeometry(0.78, 0.78);
  const labelGeo = new PlaneGeometry(0.72, 0.24);

  /** `x12`, drawn to a texture. Mono, because every number in this app is. */
  function countTexture(amount: number) {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.font = '600 42px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0a0a10';
      ctx.fillText(`x${amount}`, 96, 35);          // a shadow, for contrast
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`x${amount}`, 96, 33);
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }

  type Flying = {
    root: Group;
    vel: Vector3;
    rest: Vector3;
    spin: number;
    launchAt: number;
  };
  const flying: Flying[] = [];
  const GRAVITY = 7.4;
  const ORIGIN = new Vector3(0, 0.42, 0);

  /** Where each item ends up: a shallow fan, centred, tilted like a hand. */
  function restPlace(i: number, n: number) {
    const offset = i - (n - 1) / 2;
    return new Vector3(offset * 0.94, 1.16 - Math.abs(offset) * 0.12, 1.2);
  }

  function launchSpoils(list: Spoil[], at: number) {
    const n = Math.min(list.length, 6);   // more than six is a wall, not a haul
    for (let i = 0; i < n; i++) {
      const { url, amount } = list[i];
      const root = new Group();
      root.scale.setScalar(0);
      root.position.copy(ORIGIN);
      spoils.add(root);

      const halo = new Mesh(haloGeo, new MeshBasicMaterial({
        map: haloTex, color: tint, transparent: true, opacity: 0.55,
        blending: AdditiveBlending, depthWrite: false,
      }));
      halo.position.z = -0.02;
      root.add(halo);

      const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      const item = new Mesh(itemGeo, mat);
      root.add(item);
      // Art loads from the bundle, so this is a cache hit in practice — but the
      // item is launched either way and simply fades in when it arrives. A
      // ceremony that waits on a decode is a ceremony with a stall in it.
      spoilLoader.load(url, (tex) => {
        tex.colorSpace = SRGBColorSpace;
        spoilTextures.push(tex);
        mat.map = tex;
        mat.opacity = 1;
        mat.needsUpdate = true;
      });

      const countTex = countTexture(amount);
      spoilTextures.push(countTex);
      const label = new Mesh(labelGeo, new MeshBasicMaterial({
        map: countTex, transparent: true, depthWrite: false,
      }));
      label.position.set(0, -0.5, 0.01);
      root.add(label);

      // Fanned outward from the middle, so two items do not launch along the
      // same line and cross. The randomness is small on purpose: this should
      // look thrown, not scattered.
      const side = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);
      flying.push({
        root,
        vel: new Vector3(
          side * 1.5 + (Math.random() - 0.5) * 0.4,
          4.6 + Math.random() * 0.8,
          1.0 + Math.random() * 0.5,
        ),
        rest: restPlace(i, n),
        spin: (Math.random() - 0.5) * 7,
        launchAt: at + i * SPOIL_STAGGER,
      });
    }
  }

  /** Advance every item in flight. Returns true once they are all at rest. */
  function stepSpoils(now: number) {
    let settled = flying.length > 0;
    for (const f of flying) {
      const age = (now - f.launchAt) / 1000;
      if (age < 0) { settled = false; continue; }

      // Ballistic, from the chest's mouth.
      const bx = ORIGIN.x + f.vel.x * age;
      const by = ORIGIN.y + f.vel.y * age - 0.5 * GRAVITY * age * age;
      const bz = ORIGIN.z + f.vel.z * age;

      // ...then caught. Smoothstep so neither end of the blend has a kink.
      const c = Math.min(1, Math.max(0, (age * 1000 - SPOIL_FLY) / SPOIL_CATCH));
      const k = c * c * (3 - 2 * c);
      if (k < 1) settled = false;

      f.root.position.set(
        bx + (f.rest.x - bx) * k,
        by + (f.rest.y - by) * k,
        bz + (f.rest.z - bz) * k,
      );

      // Out of the chest fast, then held. The pop is the only place in this
      // scene with an overshoot, and it is what makes them read as thrown.
      const pop = Math.min(1, age * 1000 / 190);
      f.root.scale.setScalar((1 - (1 - pop) ** 3) * (1 + (1 - k) * 0.12));

      // Always facing the camera, tumbling only until it is caught.
      f.root.lookAt(camera.position);
      f.root.rotateZ(f.spin * age * (1 - k));

      if (k >= 1) {
        // A shallow, out-of-phase bob once it is placed, so a row of items is
        // alive without any two of them moving together.
        f.root.position.y = f.rest.y + Math.sin(now / 620 + f.spin) * 0.035;
      }
    }
    return settled;
  }

  // Composition -------------------------------------------------------------

  /*
    No post-processing. The glow is geometry.

    This was an `EffectComposer` with an `UnrealBloomPass`, and on the machine
    this was found on it rendered NOTHING — a black overlay, every time, which
    is what "it flickers and shows nothing" turned out to be. Two separate
    reasons, either of which is enough:

      - `EffectComposer.setSize` multiplies by its pixel ratio and does not
        round, so on a display whose ratio is not a whole number (Windows at
        140% scaling gives 1.4) the render target came out 1919.4 by 894.6, and
        a framebuffer with fractional dimensions is incomplete.

      - Even sized in whole pixels it still drew nothing here, which leaves the
        multisampled half-float target: `samples: 4` on a `HalfFloatType`
        renderbuffer is not something every driver will give you.

    Neither throws. Neither logs. The pass simply produces an empty frame, on
    some machines and not others, which is the worst way for a thing to fail.

    So the vault does what the monolith and the hall already do: renders
    straight to the canvas, and buys its glow with additive quads it can see and
    control. See DESIGN.md §6.
  */
  const halo = makeTexture(256, (c, n) => {
    const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.26, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, n, n);
  }, [1, 1]);

  /** The bloom, as an object: a soft disc over the chest's mouth. */
  const gloamMat = new MeshBasicMaterial({
    map: halo, color: tint, transparent: true,
    blending: AdditiveBlending, depthWrite: false, opacity: 0,
  });
  const gloam = new Mesh(new PlaneGeometry(4.6, 4.6), gloamMat);
  gloam.position.set(0, 0.45, 0.2);
  scene.add(gloam);

  const resize = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    // This used to be framed for a fixed 248px panel. It owns the viewport now,
    // so the distance is solved rather than set: pull back until both the stage
    // height (the chest, the lid at full swing) and the stage width (the fan of
    // spoils) fit, whichever is binding. A phone held upright is width-bound; a
    // desktop is height-bound, and a fixed distance was wrong for both.
    const halfFov = Math.tan((camera.fov * Math.PI) / 360);
    camera.position.z = Math.max(2.2 / halfFov, 1.7 / halfFov / camera.aspect);
    camera.lookAt(0, 0.42, 0);
    camera.updateProjectionMatrix();
    dustMat.uniforms.uScale.value = Math.min(2, h / 220);
    // The fan is as wide as three items. On a portrait phone that is wider than
    // the frustum, so the whole group shrinks rather than the outer rewards
    // sliding off the sides of the screen. Shifting it back up by the same
    // factor keeps the launch point on the chest's mouth: scaling the group
    // scales its origin too, and without this the spoils leave from a point
    // inside the chest on a narrow screen.
    const fan = Math.min(1, Math.max(0.5, camera.aspect / 1.3));
    spoils.scale.setScalar(fan);
    spoils.position.y = ORIGIN.y * (1 - fan);
    // Resizing clears the drawing buffer, so draw one frame right here. Without
    // it, a resize that lands while the loop is parked — a backgrounded tab
    // stops getting animation frames — leaves an empty canvas until the tab is
    // looked at again, and the ceremony reads as having vanished.
    renderer.render(scene, camera);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  // The ceremony ------------------------------------------------------------

  let phase: Phase = 'sealed';
  let mark = 0;          // ms at which the current phase began
  let revealed = false;
  let finished = false;
  let raf = 0;
  let burstAt = 0;       // ms the lid gave, which is when the spoils leave
  let settledAt = -1;    // ms the last spoil came to rest; -1 until it does
  let pending: Spoil[] = [];
  const start = performance.now();

  const ringMat = ring.material as ShaderMaterial;
  const beamMat = beam.material as ShaderMaterial;
  const waveMat = wave.material as ShaderMaterial;
  const sealMat = seal.material as MeshStandardMaterial;

  // A handle on the ceremony in dev, so it can be driven and inspected without
  // spending a real loot box to see one frame of it. Mirrors `__aether` and
  // `__monolith`.
  if (import.meta.env.DEV) {
    (window as any).__vault = { scene, camera, renderer, vault, phase: () => phase };
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - start) / 1000;
    /*
      `since` is read per phase, not once per frame.

      It used to be computed once at the top, and the phase blocks below are
      four separate `if`s rather than a chain — so on the frame the crack
      finished, it set `mark = now` and then fell straight into the burst block,
      which measured its own progress against the crack's elapsed time. That is
      always over BURST_MS, so the burst completed in the same frame it began.

      Every single opening skipped it. The lid never swung, the blast never
      happened, and the ceremony went from a straining chest to a settled one
      between two frames — which looked like a flicker onto nothing.
    */
    const elapsed = () => now - mark;

    ringMat.uniforms.uTime.value = t;
    dustMat.uniforms.uTime.value = t;

    // The lock, once it is debris. Ballistic and tumbling, faded out over the
    // last third of its flight so nothing has to be caught and hidden on an
    // exact frame.
    if (brokenAt >= 0) {
      const dt = (now - brokenAt) / 1000;
      for (let i = 0; i < shards.length; i++) {
        const sh = shards[i];
        const home = shardHome[i];
        sh.mesh.position.set(
          home.x + sh.vel.x * dt,
          home.y + sh.vel.y * dt - 4.6 * dt * dt,
          home.z + sh.vel.z * dt,
        );
        sh.mesh.rotation.x += sh.spin.x * 0.016;
        sh.mesh.rotation.y += sh.spin.y * 0.016;
        sh.mesh.rotation.z += sh.spin.z * 0.016;
      }
      const gone = Math.max(0, Math.min(1, (dt - 0.55) / 0.5));
      lockMat.opacity = 1 - gone;
      keyholeMat.opacity = 1 - gone;
      if (gem) (gem.material as MeshStandardMaterial).opacity = 1 - gone;
      if (gone >= 1) { lockGroup.visible = false; brokenAt = -1; }
    }

    // A slow drift, always. A prop that is perfectly still looks like a
    // screenshot of a prop.
    vault.rotation.y = Math.sin(t * 0.24) * 0.16;
    vault.position.y = Math.sin(t * 0.9) * 0.015;

    if (phase === 'sealed') {
      // The sealed chest breathes on the wall clock, not on how long it has
      // been waiting: it is the same whether the reply takes a second or ten.
      const breath = 0.5 + 0.5 * Math.sin(t * 2.2);
      sealMat.emissiveIntensity = 0.45 + breath * 0.5;
      glowMat.emissiveIntensity = 0.15 + breath * 0.1;
      key.intensity = 2 + breath * 1.5;
      ringMat.uniforms.uPower.value = 0.35 + breath * 0.15;
    }

    if (phase === 'crack') {
      const since = elapsed();
      const p = Math.min(1, since / CRACK_MS);

      // Three knocks: the lid is forced up against its own lock and drops
      // back, harder each time. Whatever is inside is trying to get out, and
      // saying that with motion beats saying it with a brightening glow.
      const knock = Math.max(0, Math.sin(p * Math.PI * 3.4)) ** 3;
      const strain = p * p;

      sealMat.emissiveIntensity = 0.8 + strain * 9 + knock * 6;
      glowMat.emissiveIntensity = 0.3 + strain * 5 + knock * 4;
      key.intensity = 3 + strain * 40 + knock * 30;
      ringMat.uniforms.uPower.value = 0.4 + p * 1.4;
      gloamMat.opacity = 0.05 + strain * 0.22 + knock * 0.3;

      // The shudder rides the knocks rather than running constantly, so the
      // chest reads as being struck from inside instead of vibrating.
      const shake = (strain * 0.02) + knock * 0.05;
      vault.position.x = (Math.random() - 0.5) * shake;
      vault.position.y += (Math.random() - 0.5) * shake;
      vault.rotation.z = (Math.random() - 0.5) * shake * 0.5;

      // The lid actually lifts on each knock — a real gap, real light out of
      // it — and slams shut again.
      hinge.rotation.x = -(0.02 + knock * 0.19);

      // And the lock is what it lifts against. The shackle stretches out of its
      // plate on every knock and the whole assembly judders; three times, harder
      // each time, and then it is not there any more.
      shackle.scale.y = 1 + knock * 0.5;
      lockGroup.position.y = 0.29 + knock * 0.02;
      lockGroup.rotation.z = (Math.random() - 0.5) * knock * 0.14;

      beam.visible = true;
      beamMat.uniforms.uPower.value = strain * 0.28 + knock * 0.3;
      beam.scale.set(0.2 + p * 0.25, 0.3 + knock * 0.35, 0.2 + p * 0.25);

      if (p >= 1) {
        phase = 'burst';
        mark = now;
        burstAt = now;
        // The shackle gives at the same instant the hinge does, because it is
        // the thing that was holding it.
        brokenAt = now;
        shackle.scale.y = 1;
        lockGroup.rotation.z = 0;
        lockGroup.position.y = 0.29;
        // A beat after the lid gives, not with it: the spoils have to come out
        // through an opening, and launching them on the same frame as the
        // hinge has them passing through the lid.
        launchSpoils(pending, now + 170);
      }
    }

    if (phase === 'burst') {
      const since = elapsed();
      const p = Math.min(1, since / BURST_MS);

      // The lid is thrown in the first fifth of the phase and then swings past
      // its rest angle and settles back — a hinge with mass. A plain ease-out
      // over the whole burst was why the opening had no moment in it.
      const throwP = Math.min(1, since / 340);
      const swing = 1 - (1 - throwP) ** 4;
      const overshoot = Math.sin(Math.max(0, p - 0.2) * 9) * Math.exp(-(p - 0.2) * 6) * 0.22;
      hinge.rotation.x = -(swing * 1.95 + Math.max(0, overshoot));

      // The blast: out fast, then gravity brings the tail of it back down
      // through frame. It travels for the full phase now instead of clearing
      // the camera in four hundred milliseconds.
      dustMat.uniforms.uBurst.value = p * 1.05;

      const impact = Math.exp(-since / 190);            // the hit, decaying
      flash.visible = since < 420;
      (flash.material as MeshBasicMaterial).opacity = impact * 0.9;
      flash.scale.setScalar(0.6 + (1 - impact) * 3.4);

      key.intensity = 16 + impact * 90;
      glowMat.emissiveIntensity = 2.5 + impact * 9;
      gloamMat.opacity = 0.3 + impact * 0.85;
      vault.position.x = 0;
      vault.rotation.z = 0;
      beamMat.uniforms.uPower.value = 0.3 + Math.sin(Math.min(1, p * 1.6) * Math.PI) * 0.7;
      beam.scale.set(0.45 + p * 0.55, 0.55 + p * 0.5, 0.45 + p * 0.55);

      // The ring the lid leaves, out and gone inside the first half second.
      const waveP = Math.min(1, since / 620);
      wave.visible = waveP < 1;
      wave.scale.setScalar(0.4 + (1 - (1 - waveP) ** 3) * 6.5);
      waveMat.uniforms.uPower.value = (1 - waveP) ** 2 * 0.9;

      if (p >= 1) { phase = 'open'; mark = now; wave.visible = false; flash.visible = false; }
    }

    if (phase === 'open') {
      const since = elapsed();
      // Settled: the chest stands open, the light steady, motes drifting back
      // down. Nothing more happens — the rewards are the subject now.
      // The light has to come most of the way down: the rewards are listed
      // under this canvas, and a scene still blazing makes them unreadable.
      const settle = Math.min(1, since / 1200);
      dustMat.uniforms.uBurst.value = 1.05 + settle * 0.7;
      key.intensity = 12 - settle * 9.5;
      beamMat.uniforms.uPower.value = 0.5 - settle * 0.4;
      gloamMat.opacity = 0.34 - settle * 0.26;
      ringMat.uniforms.uPower.value = 1.2 - settle * 0.8;
      sealMat.emissiveIntensity = 3 - settle * 2.4;
      glowMat.emissiveIntensity = 2.5 - settle * 1.9;
    }

    // The spoils outlive the burst — they are still being caught while the
    // scene settles — so they are stepped outside the phase blocks. Nothing
    // outside this canvas is told the haul is readable until they have landed,
    // which is the whole reason the reveal used to feel cut short.
    if (phase === 'burst' || phase === 'open') {
      const settled = flying.length ? stepSpoils(now) : now - burstAt > 700;
      if (settled && settledAt < 0) settledAt = now;
      if (settledAt >= 0 && !revealed) { revealed = true; onReveal?.(); }
      if (settledAt >= 0 && !finished && now - settledAt >= SPOIL_HOLD) {
        finished = true;
        onDone?.();
      }
    }

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  let disposed = false;

  const handle: Vault = {
    open(list) {
      if (phase !== 'sealed') return;
      pending = list ?? [];
      phase = 'crack';
      mark = performance.now();
    },
    get opened() { return revealed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (import.meta.env.DEV) delete (window as any).__vault;
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
      sealTex.dispose();
      halo.dispose();
      haloTex.dispose();
      spoilTextures.forEach((t) => t.dispose());
      renderer.dispose();
      // The canvas goes with it. That is the whole point of owning it.
      canvas.remove();
    },
  };

  return handle;
}
