/**
 * Three.js ceremony layer for entering and completing Play / Quest.
 *
 * Phaser continues to own the pixel scene. This canvas only draws the magical
 * wipe and the reward objects above it, then parks completely between beats.
 */
import * as THREE from 'three';
import type { ActivityReceipt } from '../lib/types';
import { LOOTBOX_TIER } from '../lib/format';

type ActivityKind = ActivityReceipt['kind'];
type Direction = 'enter' | 'exit';

const INK = 0x070710;
const STONE = 0x555260;
const BONE = 0xd6c8a2;

type TransitionVisual = {
  mode: 'transition';
  kind: ActivityKind;
  direction: Direction;
  started: number;
  duration: number;
  overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  flare: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  label: THREE.Sprite;
  panels: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
};

type RewardVisual = {
  mode: 'reward';
  started: number;
  duration: number;
  overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  title: THREE.Sprite;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  rewards: Array<{ group: THREE.Group; object: THREE.Group; baseY: number }>;
};

type Visual = TransitionVisual | RewardVisual;

type RewardEntry = {
  type: 'happiness' | 'exp' | 'lootbox' | 'return';
  label: string;
  detail: string;
};

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const backOut = (value: number) => {
  const t = clamp01(value) - 1;
  return 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2;
};

function materialOpacity(object: THREE.Sprite, opacity: number) {
  (object.material as THREE.SpriteMaterial).opacity = clamp01(opacity);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      const withMap = material as THREE.Material & { map?: THREE.Texture };
      withMap.map?.dispose();
      material.dispose();
    }
  });
}

/** A small text plate, still rendered inside Three so it travels with the object. */
function textPlate(
  title: string,
  detail: string,
  accent: THREE.Color,
  width = 768,
  height = 160,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const cut = 20;

  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width - cut, 0);
  context.lineTo(width, cut);
  context.lineTo(width, height);
  context.lineTo(cut, height);
  context.lineTo(0, height - cut);
  context.closePath();
  context.fillStyle = 'rgba(7, 7, 16, 0.88)';
  context.fill();
  context.strokeStyle = `#${accent.getHexString()}`;
  context.lineWidth = 4;
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#f2eee2';
  context.font = '700 42px "JetBrains Mono", monospace';
  context.fillText(title, width / 2, detail ? 65 : height / 2);
  if (detail) {
    context.fillStyle = '#d6c8a2';
    context.font = '600 22px "Instrument Sans", sans-serif';
    context.fillText(detail, width / 2, 116);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.Sprite(material);
}

export class ActivityFx {
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 20);
  private element: THREE.Color;
  private observer: ResizeObserver;
  private quiet: boolean;
  private previewScale: number;
  private aspect = 2;
  private visual: Visual | null = null;
  private raf = 0;

  constructor(host: HTMLElement, rgb: [number, number, number]) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    host.appendChild(this.canvas);

    this.element = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    this.quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The dev scene harness can stretch a beat long enough to inspect a still
    // frame. This branch is compiled away from production builds.
    this.previewScale = import.meta.env.DEV
      && new URLSearchParams(window.location.search).has('slowFx') ? 6 : 1;
    this.camera.position.z = 6;
    this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(-2, 3, 5);
    this.scene.add(key);
    const elemental = new THREE.PointLight(this.element, 2.2, 7);
    elemental.position.set(1.5, 0.5, 3);
    this.scene.add(elemental);

    this.observer = new ResizeObserver(() => this.resize(host));
    this.observer.observe(host);
    this.resize(host);
  }

  enter(kind: ActivityKind) {
    this.startTransition(kind, 'enter');
  }

  exit(kind: ActivityKind) {
    this.startTransition(kind, 'exit');
  }

  reveal(receipt: ActivityReceipt) {
    cancelAnimationFrame(this.raf);
    this.clear();

    const overlayMaterial = new THREE.MeshBasicMaterial({
      color: INK, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.4), overlayMaterial);
    overlay.position.z = -2;
    this.root.add(overlay);

    const title = textPlate(
      `${receipt.kind.toUpperCase()} COMPLETE`,
      'REWARDS EARNED',
      this.element,
    );
    title.scale.set(1.18, 0.245, 1);
    title.position.set(0, 0.68, 1);
    this.root.add(title);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: this.element,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.28, 48), ringMaterial);
    ring.position.z = -0.4;
    this.root.add(ring);

    const particles = this.makeParticles(42);
    particles.visible = !this.quiet;
    this.root.add(particles);

    const entries = this.rewardEntries(receipt);
    const rewards = entries.map((entry, index) => {
      const group = this.makeReward(entry);
      const spread = entries.length === 1 ? 0 : entries.length === 2 ? 0.56 : 0.48;
      const x = (index - (entries.length - 1) / 2) * spread * 2;
      const baseY = entries.length > 2 && index % 2 ? -0.03 : 0.02;
      group.group.position.set(x, baseY, 0.4);
      group.group.scale.setScalar(0.001);
      this.root.add(group.group);
      return { ...group, baseY };
    });

    this.visual = {
      mode: 'reward',
      started: performance.now(),
      duration: (this.quiet ? 1800 : 3800) * this.previewScale,
      overlay,
      title,
      ring,
      particles,
      rewards,
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private startTransition(kind: ActivityKind, direction: Direction) {
    cancelAnimationFrame(this.raf);
    this.clear();

    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 2.4),
      new THREE.MeshBasicMaterial({
        color: INK, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }),
    );
    overlay.position.z = -2;
    this.root.add(overlay);

    const flare = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.19, kind === 'Quest' ? 8 : 48),
      new THREE.MeshBasicMaterial({
        color: this.element,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        toneMapped: false,
      }),
    );
    flare.position.z = 0;
    this.root.add(flare);

    const particles = this.makeParticles(kind === 'Quest' ? 34 : 28);
    particles.visible = !this.quiet;
    this.root.add(particles);

    const label = textPlate(
      direction === 'enter'
        ? (kind === 'Quest' ? 'QUEST BEGINS' : 'TIME TO PLAY')
        : 'RETURNING HOME',
      direction === 'exit'
        ? 'HOME AWAITS'
        : kind === 'Quest' ? 'THE ROAD OPENS' : 'FOLLOW THE SPARK',
      this.element,
    );
    label.scale.set(1.04, 0.215, 1);
    label.position.set(0, 0.02, 1);
    this.root.add(label);

    const panels: TransitionVisual['panels'] = [];
    const rings: TransitionVisual['rings'] = [];
    if (kind === 'Quest') {
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(2.25, 2.3),
          new THREE.MeshBasicMaterial({
            color: side < 0 ? 0x0a0a13 : 0x0e0e19,
            transparent: true,
            opacity: 0.98,
            depthTest: false,
            depthWrite: false,
          }),
        );
        panel.userData.side = side;
        panel.position.set(side * 3.25, 0, -1);
        this.root.add(panel);
        panels.push(panel);

        const edge = new THREE.Mesh(
          new THREE.PlaneGeometry(0.025, 2.3),
          new THREE.MeshBasicMaterial({
            color: this.element,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            toneMapped: false,
          }),
        );
        edge.userData.side = side;
        edge.userData.edge = true;
        edge.position.set(-side * 1.11, 0, 0);
        panel.add(edge);
      }
    } else {
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.16 + i * 0.08, 0.18 + i * 0.08, 32),
          new THREE.MeshBasicMaterial({
            color: i === 1 ? BONE : this.element,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            toneMapped: false,
          }),
        );
        ring.rotation.z = i * 0.45;
        this.root.add(ring);
        rings.push(ring);
      }
    }

    this.visual = {
      mode: 'transition',
      kind,
      direction,
      started: performance.now(),
      duration: (this.quiet ? 420 : 1150) * this.previewScale,
      overlay,
      flare,
      particles,
      label,
      panels,
      rings,
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  private rewardEntries(receipt: ActivityReceipt): RewardEntry[] {
    const entries: RewardEntry[] = [];
    const { happiness, exp, lootbox } = receipt.rewards;
    if (typeof happiness === 'number' && happiness > 0) {
      entries.push({ type: 'happiness', label: `+${happiness} HAPPINESS`, detail: 'BOND RESTORED' });
    }
    if (typeof exp === 'number' && exp > 0) {
      entries.push({ type: 'exp', label: `+${exp} EXP`, detail: 'EXPERIENCE' });
    }
    if (typeof lootbox === 'number' && lootbox > 0) {
      const tier = LOOTBOX_TIER[lootbox] ?? `Tier ${lootbox}`;
      entries.push({ type: 'lootbox', label: `${tier.toUpperCase()} BOX`, detail: `TIER ${lootbox} LOOT` });
    }
    if (!entries.length) {
      entries.push({ type: 'return', label: 'HOME SAFE', detail: `${receipt.kind.toUpperCase()} COMPLETE` });
    }
    return entries;
  }

  private makeReward(entry: RewardEntry) {
    const group = new THREE.Group();
    const object = entry.type === 'happiness' ? this.makeHeart()
      : entry.type === 'lootbox' ? this.makeChest()
        : this.makeCrystal(entry.type === 'return');
    object.position.y = 0.13;
    group.add(object);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.23, 0.25, entry.type === 'lootbox' ? 8 : 32),
      new THREE.MeshBasicMaterial({
        color: this.element,
        transparent: true,
        opacity: entry.type === 'lootbox' ? 0.24 : 0.48,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        toneMapped: false,
      }),
    );
    halo.position.set(0, 0.13, -0.3);
    group.add(halo);

    const plate = textPlate(entry.label, entry.detail, this.element, 640, 144);
    plate.scale.set(0.72, 0.162, 1);
    plate.position.set(0, -0.38, 0.8);
    materialOpacity(plate, 1);
    group.add(plate);
    return { group, object, baseY: 0 };
  }

  private makeHeart() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.38);
    shape.lineTo(-0.38, -0.02);
    shape.lineTo(-0.36, 0.2);
    shape.lineTo(-0.22, 0.36);
    shape.lineTo(-0.08, 0.36);
    shape.lineTo(0, 0.18);
    shape.lineTo(0.08, 0.36);
    shape.lineTo(0.22, 0.36);
    shape.lineTo(0.36, 0.2);
    shape.lineTo(0.38, -0.02);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.025,
      bevelThickness: 0.025,
    });
    geometry.center();
    const material = new THREE.MeshStandardMaterial({
      color: this.element,
      emissive: this.element,
      emissiveIntensity: 0.12,
      metalness: 0.15,
      roughness: 0.32,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -0.12;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  private makeCrystal(home = false) {
    const group = new THREE.Group();
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.25, 0),
      new THREE.MeshStandardMaterial({
        color: home ? BONE : this.element,
        emissive: this.element,
        emissiveIntensity: home ? 0.08 : 0.16,
        metalness: 0.5,
        roughness: 0.2,
        flatShading: true,
      }),
    );
    crystal.scale.y = 1.25;
    group.add(crystal);
    return group;
  }

  private makeChest() {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({
      color: STONE,
      emissive: 0x101018,
      emissiveIntensity: 0.18,
      metalness: 0.14,
      roughness: 0.7,
      flatShading: true,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: this.element,
      emissive: this.element,
      emissiveIntensity: 0.12,
      metalness: 0.72,
      roughness: 0.26,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.28), stone);
    base.position.y = -0.05;
    group.add(base);
    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.13, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x242430, toneMapped: false }),
    );
    inset.position.set(0, -0.05, 0.151);
    group.add(inset);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.12, 0.3), stone.clone());
    lid.position.y = 0.14;
    lid.rotation.x = -0.08;
    group.add(lid);
    for (const x of [-0.16, 0.16]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.38, 0.32), metal.clone());
      band.position.set(x, 0.035, 0);
      group.add(band);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.045), metal);
    lock.position.set(0, 0.03, 0.165);
    group.add(lock);
    return group;
  }

  private makeParticles(count: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.17;
      const radius = 0.28 + ((i * 37) % count) / count * 0.72;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius * 0.62;
      positions[i * 3 + 2] = ((i % 5) - 2) * 0.04;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: this.element,
      size: 5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      toneMapped: false,
    });
    return new THREE.Points(geometry, material);
  }

  private frame = (now: number) => {
    const visual = this.visual;
    if (!visual) return;
    const progress = clamp01((now - visual.started) / visual.duration);
    if (visual.mode === 'transition') this.updateTransition(visual, progress, now);
    else this.updateReward(visual, progress, now);
    this.renderer.render(this.scene, this.camera);

    if (progress < 1) this.raf = requestAnimationFrame(this.frame);
    else this.clear();
  };

  private updateTransition(visual: TransitionVisual, progress: number, now: number) {
    const entering = visual.direction === 'enter';
    const pulse = Math.sin(progress * Math.PI);
    const cover = entering
      ? 1 - smooth(progress / 0.82)
      : progress < 0.38
        ? smooth(progress / 0.38)
        : 1 - smooth((progress - 0.38) / 0.62);

    visual.overlay.material.opacity = this.quiet
      ? (entering ? 0.32 * (1 - progress) : 0.28 * pulse)
      : (visual.kind === 'Quest' ? cover * 0.54 : (entering ? (1 - progress) * 0.56 : pulse * 0.48));

    const labelIn = smooth(progress / 0.18);
    const labelOut = 1 - smooth((progress - 0.58) / 0.32);
    materialOpacity(visual.label, labelIn * labelOut);
    visual.label.position.y = this.quiet ? 0.02 : 0.02 + (1 - labelIn) * 0.09;

    visual.flare.visible = !this.quiet;
    visual.flare.scale.setScalar(0.45 + progress * 5.2);
    visual.flare.rotation.z = now * 0.0004 * (visual.kind === 'Quest' ? -1 : 1);
    visual.flare.material.opacity = pulse * 0.72;

    visual.particles.scale.setScalar(0.25 + progress * 2.1);
    visual.particles.rotation.z = now * 0.00025;
    visual.particles.material.opacity = pulse * 0.82;

    if (!this.quiet) {
      for (const panel of visual.panels) {
        const side = panel.userData.side as number;
        panel.position.x = side * THREE.MathUtils.lerp(3.25, 1.11, cover);
      }
      visual.rings.forEach((ring, index) => {
        const delay = index * 0.08;
        const local = clamp01((progress - delay) / (1 - delay));
        ring.scale.setScalar(0.3 + local * (2.6 + index * 0.45));
        ring.rotation.z += (index % 2 ? -1 : 1) * 0.018;
        ring.material.opacity = Math.sin(local * Math.PI) * (0.64 - index * 0.1);
      });
    }
  }

  private updateReward(visual: RewardVisual, progress: number, now: number) {
    const reveal = smooth(progress / 0.19);
    const hold = 1 - smooth((progress - 0.78) / 0.22);
    visual.overlay.material.opacity = (1 - reveal) * 0.7 + hold * 0.1;
    materialOpacity(visual.title, reveal * hold);
    visual.title.position.y = 0.68 + (1 - reveal) * 0.08;

    visual.ring.scale.setScalar(0.3 + progress * 5.2);
    visual.ring.rotation.z = now * -0.00035;
    visual.ring.material.opacity = Math.sin(progress * Math.PI) * 0.68;
    visual.particles.scale.setScalar(0.25 + progress * 2.2);
    visual.particles.rotation.z = now * 0.00032;
    visual.particles.material.opacity = Math.sin(progress * Math.PI) * 0.92;

    visual.rewards.forEach((reward, index) => {
      const delay = 0.11 + index * 0.055;
      const local = smooth((progress - delay) / 0.18);
      const pop = this.quiet ? local : backOut(local);
      reward.group.scale.setScalar(Math.max(0.001, pop * hold));
      reward.group.position.y = reward.baseY
        + (this.quiet ? 0 : Math.sin(now * 0.0025 + index * 1.7) * 0.018);
      if (!this.quiet) {
        reward.object.rotation.y = Math.sin(now * 0.0011 + index * 1.4) * 0.32;
        reward.object.rotation.x = Math.sin(now * 0.0013 + index) * 0.08;
      }
    });
  }

  private resize(host: HTMLElement) {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    this.aspect = width / height;
    this.camera.left = -this.aspect;
    this.camera.right = this.aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.visual) this.renderer.render(this.scene, this.camera);
    else this.renderer.clear();
  }

  private clear() {
    cancelAnimationFrame(this.raf);
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      disposeObject(child);
    }
    this.visual = null;
    this.renderer.clear();
  }
}

export function mountActivityFx(
  host: HTMLElement,
  rgb: [number, number, number],
): ActivityFx | null {
  try {
    return new ActivityFx(host, rgb);
  } catch {
    // Activity state and Phaser scenes remain complete without WebGL. The
    // ceremony is enhancement, never the only record of a reward.
    return null;
  }
}
