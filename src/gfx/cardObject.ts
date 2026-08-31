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
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, LinearFilter, Mesh,
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

/** The back of the card: royal velvet, gold inlay and the realm's raised seal. */
function backTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = Math.round(size * RATIO);
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const W = c.width;
    const H = c.height;

    // A black-plum velvet field: almost neutral at the rim, saturated only
    // where the central seal catches the light. It stays dark enough that the
    // gold edge is still the brightest material when the card turns.
    const velvet = ctx.createRadialGradient(W * 0.5, H * 0.43, 8, W * 0.5, H * 0.48, H * 0.72);
    velvet.addColorStop(0, '#3b183f');
    velvet.addColorStop(0.42, '#211127');
    velvet.addColorStop(1, '#090812');
    ctx.fillStyle = velvet;
    ctx.fillRect(0, 0, c.width, c.height);

    // A quiet brocade lattice beneath the metalwork. Clipped well inside the
    // frame so it reads as woven cloth rather than a grid pasted over a card.
    ctx.save();
    ctx.beginPath();
    ctx.rect(27, 27, W - 54, H - 54);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(214,200,162,0.055)';
    for (let x = -H; x < W + H; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + H, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.restore();

    // Deterministic velvet nap. A seeded texture means two copies of the same
    // card do not mysteriously have different backs after every mount.
    let seed = 0x51f15e;
    const random = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 3100; i += 1) {
      const light = random() > 0.48;
      ctx.fillStyle = light ? 'rgba(244,222,255,0.035)' : 'rgba(0,0,0,0.09)';
      const x = random() * W;
      const y = random() * H;
      ctx.fillRect(x, y, random() > 0.82 ? 2 : 1, 1);
    }

    const cutFrame = (inset: number, cut: number) => {
      ctx.beginPath();
      ctx.moveTo(inset + cut, inset);
      ctx.lineTo(W - inset - cut, inset);
      ctx.lineTo(W - inset, inset + cut);
      ctx.lineTo(W - inset, H - inset - cut);
      ctx.lineTo(W - inset - cut, H - inset);
      ctx.lineTo(inset + cut, H - inset);
      ctx.lineTo(inset, H - inset - cut);
      ctx.lineTo(inset, inset + cut);
      ctx.closePath();
    };

    // Three ranks of metal: bright crown gold, a shadowed bronze rail, then a
    // fine inner inlay. The changing values make the frame feel built up, not
    // like one thick yellow rectangle.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    cutFrame(10, 15);
    ctx.strokeStyle = '#ead89c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    cutFrame(17, 11);
    ctx.strokeStyle = '#8f642d';
    ctx.lineWidth = 2;
    ctx.stroke();
    cutFrame(23, 8);
    ctx.strokeStyle = 'rgba(233,210,145,0.72)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const diamond = (x: number, y: number, radius: number, fill: string) => {
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = '#f0dc9c';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // Mirrored filigree at every corner, kept geometric so it belongs beside
    // the card's chamfered rim and the angular Rune Realm mark.
    const corner = (x: number, y: number, sx: 1 | -1, sy: 1 | -1) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.strokeStyle = 'rgba(232,209,143,0.78)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 40); ctx.quadraticCurveTo(10, 9, 42, 0);
      ctx.moveTo(0, 18); ctx.quadraticCurveTo(17, 16, 18, 0);
      ctx.moveTo(9, 32); ctx.quadraticCurveTo(22, 23, 31, 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(22, 20, 7, Math.PI * 0.15, Math.PI * 1.55);
      ctx.strokeStyle = 'rgba(143,100,45,0.88)';
      ctx.stroke();
      diamond(18, 18, 4, '#7f356f');
      ctx.restore();
    };
    corner(25, 25, 1, 1);
    corner(W - 25, 25, -1, 1);
    corner(25, H - 25, 1, -1);
    corner(W - 25, H - 25, -1, -1);

    // A royal crown above the seal. No lettering: the silhouette stays
    // readable even when the card is held small or nearly edge-on.
    const crownX = W / 2;
    const crownY = H * 0.17;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(crownX - 38, crownY + 17);
    ctx.lineTo(crownX - 32, crownY - 15);
    ctx.lineTo(crownX - 12, crownY + 1);
    ctx.lineTo(crownX, crownY - 24);
    ctx.lineTo(crownX + 12, crownY + 1);
    ctx.lineTo(crownX + 32, crownY - 15);
    ctx.lineTo(crownX + 38, crownY + 17);
    ctx.closePath();
    const crownGold = ctx.createLinearGradient(crownX, crownY - 24, crownX, crownY + 23);
    crownGold.addColorStop(0, '#fff0ba');
    crownGold.addColorStop(0.45, '#d5a84e');
    crownGold.addColorStop(1, '#795021');
    ctx.fillStyle = crownGold;
    ctx.fill();
    ctx.strokeStyle = '#f1dda0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#b87c39';
    ctx.fillRect(crownX - 41, crownY + 15, 82, 9);
    ctx.strokeRect(crownX - 41, crownY + 15, 82, 9);
    diamond(crownX, crownY + 19, 4, '#6d2d75');
    ctx.restore();

    // Gold rails lead into a raised octagonal medallion. They make the centre
    // feel mounted into the back rather than printed on top of the brocade.
    const cy = H * 0.51;
    const rail = ctx.createLinearGradient(28, cy, W - 28, cy);
    rail.addColorStop(0, 'rgba(116,75,30,0)');
    rail.addColorStop(0.18, '#9a6b2f');
    rail.addColorStop(0.5, '#f1dda0');
    rail.addColorStop(0.82, '#9a6b2f');
    rail.addColorStop(1, 'rgba(116,75,30,0)');
    ctx.fillStyle = rail;
    ctx.fillRect(28, cy - 2, W - 56, 4);
    diamond(36, cy, 7, '#5c285f');
    diamond(W - 36, cy, 7, '#5c285f');

    const octagon = (radius: number) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = Math.PI / 8 + i * Math.PI / 4;
        const x = W / 2 + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 13;
    ctx.shadowOffsetY = 6;
    octagon(W * 0.3);
    const medallionGold = ctx.createRadialGradient(W * 0.43, cy - W * 0.1, 4, W / 2, cy, W * 0.32);
    medallionGold.addColorStop(0, '#fff0b0');
    medallionGold.addColorStop(0.42, '#d2a44d');
    medallionGold.addColorStop(1, '#62401b');
    ctx.fillStyle = medallionGold;
    ctx.fill();
    ctx.restore();
    octagon(W * 0.265);
    ctx.fillStyle = '#160c1d';
    ctx.fill();
    ctx.strokeStyle = '#f0daa0';
    ctx.lineWidth = 2;
    ctx.stroke();
    octagon(W * 0.225);
    ctx.strokeStyle = 'rgba(143,100,45,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The original carved seal remains the identity at the heart of the more
    // elaborate treatment; it is brighter now because the medallion is metal.
    const sealSize = Math.round(W * 0.43);
    const seal = document.createElement('canvas');
    seal.width = seal.height = sealSize;
    drawMark(seal, { color: 'rgba(246,224,161,0.94)', bind: 'rgba(246,224,161,0.94)' });
    ctx.drawImage(seal, (W - sealSize) / 2, cy - sealSize / 2);

    // A small royal knot balances the crown and gives the back a clear axis.
    const knotY = H * 0.84;
    diamond(W / 2, knotY, 12, '#8b397c');
    diamond(W / 2, knotY, 5, '#e6c76f');
    ctx.strokeStyle = 'rgba(232,209,143,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 48, knotY); ctx.lineTo(W / 2 - 15, knotY);
    ctx.moveTo(W / 2 + 15, knotY); ctx.lineTo(W / 2 + 48, knotY);
    ctx.stroke();
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  return tex;
}

export function createCardObject(
  canvas: HTMLCanvasElement,
  { face, element = 'arcane' as CardElement, introSpin = false }: {
    /** The painted card, from `lib/card/browser`. */
    face: HTMLCanvasElement;
    element?: CardElement;
    /** Begin with several physical turns and ease down into the held pose. */
    introSpin?: boolean;
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
        // Off-square is where foil lives. It now wakes at a smaller angle so a
        // normal hand tilt shows it clearly, while square-on still stays clean.
        float angleReveal = smoothstep(0.006, 0.11, 1.0 - facing);

        // The diffraction band: a diagonal ramp across the card, swept by the
        // viewing angle so it travels when the card turns rather than when a
        // clock ticks.
        float band = (vUv.x * 1.4 + vUv.y * 2.2) + (vView.x * 3.2 + vView.y * 2.0);
        vec3 holo = 0.52 + 0.58 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band));

        // A broad diffraction ribbon plus a hard white laminate streak. The old
        // effect only had the hairline and disappeared against bright card art.
        float ribbon = 1.0 - smoothstep(0.13, 0.38, abs(fract(band * 0.32) - 0.5));
        float sweep = 1.0 - smoothstep(0.018, 0.075, abs(fract(band * 0.52) - 0.5));

        vec3 c = mix(holo, uTint, 0.12);
        c = mix(c, vec3(1.0), sweep * 0.34);
        float a = angleReveal * (0.22 + ribbon * 0.42 + sweep * 0.72)
          * (0.68 + uTilt * 0.72);
        gl_FragColor = vec4(c, a);
      }`,
  });
  const foil = new Mesh(new PlaneGeometry(RATIO, 1), foilMat);
  foil.position.z = THICK / 2 + 0.0012;
  card.add(foil);

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
  // Four turns land face-up. Because this rotates the mesh, the gold edge,
  // foil and royal back all flash past during the acquisition handoff.
  let spin = introSpin && !reduced ? Math.PI * 8 : 0;
  let spinningIn = introSpin && !reduced;
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
    if (spinningIn) {
      // Exponential drag: quick off the impact, visibly heavy for the last
      // half-turn, then handed back to the normal pointer interaction.
      spin += (target - spin) * 0.045;
      if (Math.abs(target - spin) < 0.018) {
        spin = target;
        spinningIn = false;
      }
    } else {
      spin += (target + dragSpin - spin) * (reduced ? 1 : 0.12);
    }

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
