/**
 * The collection-page entrance: owned cards rise as one deck, fan apart,
 * complete one quick orbit, then resolve into their exact DOM cards.
 */
import {
  AmbientLight, BoxGeometry, CanvasTexture, Color, DirectionalLight,
  LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter,
  NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import type { Affinity } from '../lib/types';

export type CollectionCardFace = {
  face: HTMLCanvasElement;
  element: Affinity;
  target: HTMLElement | null;
};

export type CollectionCardEntrance = { dispose(): void };

export type CollectionCardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CollectionCardSwapFace = {
  face: HTMLCanvasElement;
  element: Affinity;
  start: CollectionCardRect;
  target: HTMLElement;
};

export type CollectionCardSwap = { dispose(): void };

const LIVE = new WeakMap<HTMLCanvasElement, () => void>();
const LIVE_SWAPS = new WeakMap<HTMLCanvasElement, () => void>();
const RATIO = 648 / 1065;
const GOLD = 0xd6c8a2;
const HUE: Record<Affinity, number> = {
  fire: 0xff7a43, water: 0x4ab0ff, air: 0x7ee8d6, rock: 0xc7a26b, normal: 0x969fb8,
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - Math.pow(1 - clamp(n), 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createCollectionCardEntrance(
  canvas: HTMLCanvasElement,
  faces: CollectionCardFace[],
  onReveal: () => void,
  onComplete: () => void,
): CollectionCardEntrance | null {
  LIVE.get(canvas)?.();
  if (!faces.length) return null;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(0, 0, 6.4);
  scene.add(new AmbientLight(0xffffff, 1.35));
  const key = new DirectionalLight(0xfff1cc, 2.2);
  key.position.set(-2, 3, 5);
  scene.add(key);

  const cards = faces.map(({ face, element, target }, index) => {
    const texture = new CanvasTexture(face);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = LinearFilter;
    texture.anisotropy = 4;
    const front = new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
    const back = new MeshStandardMaterial({
      color: 0x171321, roughness: 0.82, metalness: 0.1, transparent: true,
    });
    const edge = new MeshStandardMaterial({
      color: new Color(GOLD).lerp(new Color(HUE[element]), 0.12),
      roughness: 0.28, metalness: 0.92, transparent: true,
    });
    const mesh = new Mesh(
      new BoxGeometry(RATIO * 1.46, 1.46, 0.035),
      [edge, edge, edge, edge, front, back],
    );
    scene.add(mesh);
    target?.style.setProperty('--collection-poof-delay', `${Math.min(index * 12, 84)}ms`);
    return { mesh, texture, materials: [front, back, edge], index, target, arrived: false };
  });

  const viewHeightAt = (z: number) => (
    2 * Math.tan((camera.fov * Math.PI) / 360) * (camera.position.z - z)
  );

  const focus = () => {
    const box = canvas.getBoundingClientRect();
    const viewHeight = viewHeightAt(-0.25);
    const visibleTop = Math.max(0, -box.top);
    const visibleBottom = Math.min(box.height, window.innerHeight - box.top);
    const focusY = visibleBottom > visibleTop
      ? (visibleTop + visibleBottom) / 2
      : box.height * 0.34;
    return {
      centreY: ((box.height / 2 - focusY) / Math.max(1, box.height)) * viewHeight,
      viewHeight,
      viewWidth: viewHeight * camera.aspect,
    };
  };

  const ring = (index: number, turn: number) => {
    const count = Math.max(1, cards.length);
    const { centreY, viewHeight, viewWidth } = focus();
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2 + turn * Math.PI * 2;
    const radius = Math.max(0.72, Math.min(2.42, viewWidth * 0.32));
    const yRadius = Math.max(0.42, Math.min(0.78, viewHeight * 0.15));
    return {
      x: Math.cos(angle) * radius,
      y: centreY + Math.sin(angle) * yRadius,
      z: Math.sin(angle) * 0.48 - 0.2,
      angle,
    };
  };

  const stack = (index: number) => {
    const { centreY } = focus();
    const offset = index - (cards.length - 1) / 2;
    return {
      x: offset * 0.018,
      y: centreY + offset * 0.012,
      z: 0.82 - index * 0.018,
      angle: offset * 0.025,
    };
  };

  /** Project a live DOM rectangle onto the camera's z=0 plane. */
  const targetPlacement = (target: HTMLElement | null, index: number) => {
    const canvasBox = canvas.getBoundingClientRect();
    const targetBox = target?.getBoundingClientRect();
    const viewHeight = viewHeightAt(0);
    const worldPerPixel = viewHeight / Math.max(1, canvasBox.height);
    if (!targetBox || targetBox.width <= 0 || targetBox.height <= 0) {
      return {
        x: (index - (cards.length - 1) / 2) * 0.2,
        y: -viewHeight * 0.42,
        z: 0,
        scale: 0.38,
      };
    }
    return {
      x: (targetBox.left + targetBox.width / 2
        - canvasBox.left - canvasBox.width / 2) * worldPerPixel,
      y: -(targetBox.top + targetBox.height / 2
        - canvasBox.top - canvasBox.height / 2) * worldPerPixel,
      z: 0,
      scale: Math.max(0.08, (targetBox.height * worldPerPixel) / 1.46),
    };
  };

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelBudget = 4_000_000;
    const ratio = Math.max(0.5, Math.min(
      window.devicePixelRatio || 1,
      1.75,
      Math.sqrt(pixelBudget / (width * height)),
    ));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const started = performance.now();
  const duration = 1900;
  const liftEnd = 0.2;
  const fanEnd = 0.4;
  const orbitEnd = 0.68;
  let raf = 0;
  let disposed = false;
  let completed = false;
  let revealed = false;

  const frame = (now: number) => {
    if (disposed) return;
    const p = clamp((now - started) / duration);
    if (!revealed && p >= 0.5) {
      revealed = true;
      onReveal();
    }

    cards.forEach((card) => {
      const { mesh, materials, index, target } = card;
      const deck = stack(index);

      if (p <= liftEnd) {
        // One tight deck rises from deep behind the screen and overshoots
        // toward the viewer before it opens.
        const q = ease(p / liftEnd);
        mesh.position.set(deck.x, deck.y, lerp(-5.8, deck.z, q));
        mesh.scale.setScalar(lerp(0.3, 1.1, q));
        mesh.rotation.x = lerp(-0.16, 0, q);
        mesh.rotation.y = lerp(0.28, 0, q);
        mesh.rotation.z = deck.angle;
      } else if (p <= fanEnd) {
        // Fan the deck into its orbital positions while keeping every face
        // readable; the movement, not a long card spin, supplies the flourish.
        const q = ease((p - liftEnd) / (fanEnd - liftEnd));
        const at = ring(index, 0);
        mesh.position.set(
          lerp(deck.x, at.x, q),
          lerp(deck.y, at.y, q),
          lerp(deck.z, at.z, q),
        );
        mesh.scale.setScalar(lerp(1.1, 1, q));
        mesh.rotation.x = Math.sin(at.angle) * 0.08 * q;
        mesh.rotation.y = Math.cos(at.angle) * 0.12 * q;
        mesh.rotation.z = lerp(deck.angle, -Math.cos(at.angle) * 0.14, q);
      } else if (p <= orbitEnd) {
        // Exactly one quick orbit.
        const q = (p - fanEnd) / (orbitEnd - fanEnd);
        const at = ring(index, q);
        mesh.position.set(at.x, at.y, at.z);
        mesh.scale.setScalar(1);
        mesh.rotation.x = Math.sin(at.angle) * 0.09;
        mesh.rotation.y = Math.cos(at.angle) * 0.16;
        mesh.rotation.z = -Math.cos(at.angle) * 0.14;
      } else {
        const q = ease((p - orbitEnd) / (1 - orbitEnd));
        const at = ring(index, 1);
        const end = targetPlacement(target, index);
        mesh.position.set(
          lerp(at.x, end.x, q),
          lerp(at.y, end.y, q),
          lerp(at.z, end.z, q),
        );
        mesh.scale.setScalar(lerp(1, end.scale, q));
        const facing = Math.pow(1 - q, 3);
        mesh.rotation.x = Math.sin(at.angle) * 0.09 * facing;
        mesh.rotation.y = Math.cos(at.angle) * 0.16 * facing;
        mesh.rotation.z = -Math.cos(at.angle) * 0.14 * facing;
        if (!card.arrived && q >= 0.72) {
          card.arrived = true;
          target?.classList.add('is-arriving');
        }
        const opacity = 1 - clamp((q - 0.72) / 0.28);
        materials.forEach((material) => { material.opacity = opacity; });
      }
    });

    renderer.render(scene, camera);
    if (p < 1) raf = requestAnimationFrame(frame);
    else if (!completed) {
      completed = true;
      if (!revealed) onReveal();
      cards.forEach((card) => card.target?.classList.add('is-arriving'));
      onComplete();
    }
  };
  raf = requestAnimationFrame(frame);

  const handle: CollectionCardEntrance = {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf);
      observer.disconnect();
      cards.forEach(({ mesh, texture, materials, target }) => {
        target?.classList.remove('is-arriving');
        target?.style.removeProperty('--collection-poof-delay');
        mesh.geometry.dispose();
        texture.dispose();
        materials.forEach((material) => material.dispose());
        scene.remove(mesh);
      });
      renderer.dispose();
    },
  };
  LIVE.set(canvas, handle.dispose);
  return handle;
}

/**
 * Lift two DOM cards into one temporary Three.js scene and exchange their
 * positions. The DOM targets stay hidden but keep their layout space, so the
 * cards visibly leave two empty sockets until the confirmed state lands.
 */
export function createCollectionCardSwap(
  canvas: HTMLCanvasElement,
  faces: CollectionCardSwapFace[],
  onComplete: () => void,
): CollectionCardSwap | null {
  LIVE_SWAPS.get(canvas)?.();
  if (faces.length !== 2) return null;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(0, 0, 6.4);
  scene.add(new AmbientLight(0xffffff, 1.4));
  const key = new DirectionalLight(0xfff1cc, 2.5);
  key.position.set(-2, 3, 5);
  scene.add(key);

  const cards = faces.map(({ face, element, start, target }, index) => {
    const texture = new CanvasTexture(face);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = LinearFilter;
    texture.anisotropy = 4;
    const front = new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
    const back = new MeshStandardMaterial({
      color: 0x171321, roughness: 0.82, metalness: 0.1, transparent: true,
    });
    const edge = new MeshStandardMaterial({
      color: new Color(GOLD).lerp(new Color(HUE[element]), 0.16),
      roughness: 0.24, metalness: 0.94, transparent: true,
    });
    const mesh = new Mesh(
      new BoxGeometry(RATIO * 1.46, 1.46, 0.045),
      [edge, edge, edge, edge, front, back],
    );
    scene.add(mesh);
    return { mesh, texture, materials: [front, back, edge], start, target, index };
  });

  const viewHeightAt = (z: number) => (
    2 * Math.tan((camera.fov * Math.PI) / 360) * (camera.position.z - z)
  );
  const placement = (rect: CollectionCardRect) => {
    const canvasBox = canvas.getBoundingClientRect();
    const viewHeight = viewHeightAt(0);
    const worldPerPixel = viewHeight / Math.max(1, canvasBox.height);
    return {
      x: (rect.left + rect.width / 2
        - canvasBox.left - canvasBox.width / 2) * worldPerPixel,
      y: -(rect.top + rect.height / 2
        - canvasBox.top - canvasBox.height / 2) * worldPerPixel,
      z: 0,
      scale: Math.max(0.08, (rect.height * worldPerPixel) / 1.46),
    };
  };

  const targetRect = (target: HTMLElement): CollectionCardRect => {
    const rect = target.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const started = performance.now();
  const duration = 980;
  let raf = 0;
  let disposed = false;
  let completed = false;

  const frame = (now: number) => {
    if (disposed) return;
    const p = clamp((now - started) / duration);
    const q = ease(p);
    cards.forEach((card) => {
      const start = placement(card.start);
      const end = placement(targetRect(card.target));
      const arch = Math.sin(q * Math.PI);
      const side = card.index === 0 ? -1 : 1;
      card.mesh.position.set(
        lerp(start.x, end.x, q) + side * arch * 0.42,
        lerp(start.y, end.y, q) + side * arch * 0.34,
        arch * (card.index === 0 ? 1.22 : 0.94),
      );
      card.mesh.scale.setScalar(lerp(start.scale, end.scale, q) * (1 + arch * 0.08));
      card.mesh.rotation.x = side * arch * 0.12;
      card.mesh.rotation.y = side * arch * 0.38;
      card.mesh.rotation.z = side * arch * 0.22;
      // Stay fully present until the DOM card takes over on the completion
      // frame. Fading here creates a visible empty beat in both sockets.
      card.materials.forEach((material) => { material.opacity = 1; });
    });
    renderer.render(scene, camera);
    if (p < 1) raf = requestAnimationFrame(frame);
    else if (!completed) {
      completed = true;
      onComplete();
    }
  };
  raf = requestAnimationFrame(frame);

  const handle: CollectionCardSwap = {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE_SWAPS.get(canvas) === handle.dispose) LIVE_SWAPS.delete(canvas);
      cancelAnimationFrame(raf);
      observer.disconnect();
      cards.forEach(({ mesh, texture, materials }) => {
        mesh.geometry.dispose();
        texture.dispose();
        materials.forEach((material) => material.dispose());
        scene.remove(mesh);
      });
      renderer.dispose();
    },
  };
  LIVE_SWAPS.set(canvas, handle.dispose);
  return handle;
}
