/** Transparent Three.js berry flight rendered above the Phaser room. */
import * as THREE from 'three';

type Anchor = { x: number; y: number };

type Flight = {
  sprite: THREE.Sprite;
  delay: number;
  wobble: number;
};

export class FeedFx {
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private texture: THREE.Texture;
  private colour: THREE.Color;
  private flights: Flight[] = [];
  private sparks?: THREE.Points;
  private ring?: THREE.Mesh;
  private raf = 0;
  private started = 0;
  private anchor: Anchor = { x: 0.5, y: 0.65 };
  private observer: ResizeObserver;
  private quiet = false;

  constructor(host: HTMLElement, berryUrl: string, rgb: [number, number, number]) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated';
    host.appendChild(this.canvas);

    this.camera.position.z = 5;
    this.colour = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    this.quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.texture = new THREE.TextureLoader().load(berryUrl);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;

    this.observer = new ResizeObserver(() => this.resize(host));
    this.observer.observe(host);
    this.resize(host);
  }

  play(anchor: Anchor) {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.anchor = anchor;
    this.started = performance.now();
    this.buildFlight();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.clear();
    this.texture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private resize(host: HTMLElement) {
    const { clientWidth: w, clientHeight: h } = host;
    if (w && h) this.renderer.setSize(w, h, false);
  }

  private buildFlight() {
    const count = this.quiet ? 1 : 3;
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(i === 0 ? 0.085 : 0.065);
      sprite.visible = false;
      this.scene.add(sprite);
      this.flights.push({ sprite, delay: i * 160, wobble: (i - 1) * 0.08 });
    }

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: this.colour,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 16), ringMaterial);
    this.ring.visible = false;
    this.scene.add(this.ring);

    const positions = new Float32Array(18 * 3);
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      positions[i * 3] = Math.cos(angle);
      positions[i * 3 + 1] = Math.sin(angle);
      positions[i * 3 + 2] = 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: this.colour,
      size: 5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    });
    this.sparks = new THREE.Points(geometry, material);
    this.sparks.visible = false;
    this.scene.add(this.sparks);
  }

  private frame = (now: number) => {
    const elapsed = now - this.started;
    const targetX = this.anchor.x * 2 - 1;
    const targetY = (1 - this.anchor.y) * 2 - 1;
    let active = false;

    for (const { sprite, delay, wobble } of this.flights) {
      const duration = this.quiet ? 500 : 1550;
      const p = THREE.MathUtils.clamp((elapsed - delay) / duration, 0, 1);
      sprite.visible = elapsed >= delay && p < 1;
      if (!sprite.visible) continue;
      active = true;
      const eased = 1 - (1 - p) ** 3;
      sprite.position.set(
        THREE.MathUtils.lerp(1.12, targetX, eased),
        THREE.MathUtils.lerp(-0.18 + wobble, targetY, eased) + Math.sin(p * Math.PI) * (this.quiet ? 0.08 : 0.72),
        Math.sin(p * Math.PI) * 0.8,
      );
      // Keep the berry in the same visual scale as the pixel actors. At the
      // old 0.12-0.22 range, three 45px berry textures overlapped into what
      // looked like one large orange cloud on a wide status card.
      const scale = (0.045 + Math.sin(p * Math.PI) * 0.035)
        * (1 - Math.max(0, (p - 0.82) / 0.18));
      sprite.scale.setScalar(scale);
      (sprite.material as THREE.SpriteMaterial).rotation = p * Math.PI * (wobble < 0 ? -3 : 3);
    }

    const burst = (elapsed - (this.quiet ? 420 : 1700)) / (this.quiet ? 360 : 900);
    if (burst >= 0 && burst < 1 && this.ring && this.sparks) {
      active = true;
      const fade = 1 - burst;
      this.ring.visible = true;
      this.ring.position.set(targetX, targetY, 0);
      this.ring.scale.setScalar(0.5 + burst * 2.2);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.72;

      this.sparks.visible = true;
      this.sparks.position.set(targetX, targetY, 0);
      this.sparks.scale.setScalar(0.04 + burst * 0.33);
      (this.sparks.material as THREE.PointsMaterial).opacity = fade * 0.9;
    }

    this.renderer.render(this.scene, this.camera);
    if (active || elapsed < 3000) this.raf = requestAnimationFrame(this.frame);
    else this.clear();
  };

  private clear() {
    for (const child of [...this.scene.children]) {
      this.scene.remove(child);
      if (child instanceof THREE.Sprite) child.material.dispose();
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.flights = [];
    this.sparks = undefined;
    this.ring = undefined;
    this.renderer.clear();
  }
}

export function mountFeedFx(
  host: HTMLElement,
  berryUrl: string,
  rgb: [number, number, number],
): FeedFx | null {
  try {
    return new FeedFx(host, berryUrl, rgb);
  } catch {
    // WebGL can be disabled by the browser or exhausted by another tab. The
    // Phaser reaction still plays, so feeding never becomes a broken action.
    return null;
  }
}
