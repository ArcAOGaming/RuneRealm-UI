/**
 * The four-element toll at the Hunt gate.
 *
 * This is geometry, light and motion rather than a decorative video: four
 * berry stones orbit a portal whose rings answer the player's pointer. The
 * authoritative quantities remain ordinary text beside it, and WebGL failure
 * leaves that usable ledger intact.
 */
import { useEffect, useRef } from 'react';
import {
  AdditiveBlending, AmbientLight, Color, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight,
  Scene, TorusGeometry, WebGLRenderer,
} from 'three';

const ELEMENTS = [
  { color: 0xff6a3d, phase: 0 },
  { color: 0x43a9ff, phase: Math.PI / 2 },
  { color: 0x79e6c7, phase: Math.PI },
  { color: 0xc9a25d, phase: Math.PI * 1.5 },
] as const;

export function HuntOffering({ busy = false }: { busy?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef(busy);
  active.current = busy;

  useEffect(() => {
    const target = canvas.current;
    if (!target) return undefined;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: target, alpha: true, antialias: true });
    } catch {
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.15, 7.2);
    scene.add(new AmbientLight(0xffffff, 0.65));
    const lamp = new PointLight(0xbda2ff, 35, 16);
    lamp.position.set(0, 1.2, 4);
    scene.add(lamp);

    const offering = new Group();
    offering.rotation.x = -0.18;
    scene.add(offering);

    const portal = new Group();
    offering.add(portal);
    [1.18, 1.48, 1.78].forEach((radius, index) => {
      const material = new MeshStandardMaterial({
        color: index === 1 ? 0x8f75d6 : 0x40365c,
        emissive: new Color(index === 1 ? 0x8f75d6 : 0x4d426e),
        emissiveIntensity: index === 1 ? 1.4 : 0.55,
        metalness: 0.9,
        roughness: 0.24,
      });
      const ring = new Mesh(new TorusGeometry(radius, index === 1 ? 0.055 : 0.035, 8, 64), material);
      ring.rotation.z = index * 0.38;
      portal.add(ring);
    });
    const veil = new Mesh(
      new IcosahedronGeometry(0.95, 3),
      new MeshBasicMaterial({
        color: 0x9a7cff, transparent: true, opacity: 0.075,
        blending: AdditiveBlending, depthWrite: false, wireframe: true,
      }),
    );
    veil.scale.z = 0.18;
    portal.add(veil);

    const berries = ELEMENTS.map(({ color, phase }) => {
      const group = new Group();
      const fruit = new Mesh(
        new IcosahedronGeometry(0.34, 2),
        new MeshStandardMaterial({
          color, emissive: new Color(color), emissiveIntensity: 0.35,
          metalness: 0.18, roughness: 0.48, flatShading: true,
        }),
      );
      group.add(fruit);
      const halo = new Mesh(
        new TorusGeometry(0.48, 0.018, 6, 32),
        new MeshBasicMaterial({
          color, transparent: true, opacity: 0.7,
          blending: AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(halo);
      offering.add(group);
      return { group, phase };
    });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let aimX = 0;
    let aimY = 0;
    const point = (event: PointerEvent) => {
      const rect = target.getBoundingClientRect();
      aimX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 0.34;
      aimY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 0.22;
    };
    target.addEventListener('pointermove', point, { passive: true });

    const resize = () => {
      const width = Math.max(1, target.clientWidth);
      const height = Math.max(1, target.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(target);
    resize();

    let raf = 0;
    const started = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const time = reduced ? 0.8 : (now - started) / 1000;
      offering.rotation.y += (aimX - offering.rotation.y) * 0.045;
      offering.rotation.x += (-0.18 + aimY - offering.rotation.x) * 0.045;
      portal.rotation.z = time * (active.current ? 1.15 : 0.28);
      veil.rotation.z = -time * 0.42;
      veil.scale.setScalar(1 + Math.sin(time * 1.8) * 0.045);
      veil.scale.z = 0.18;
      berries.forEach(({ group, phase }, index) => {
        const angle = phase + time * (active.current ? 1.35 : 0.36);
        const radius = 2.35 + Math.sin(time * 0.7 + index) * 0.08;
        group.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.62, 0.35);
        group.rotation.z = -angle + time * 0.3;
        group.scale.setScalar(1 + Math.sin(time * 2.1 + phase) * 0.055);
      });
      lamp.intensity = active.current ? 52 : 35 + Math.sin(time * 1.7) * 4;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      target.removeEventListener('pointermove', point);
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvas} className="h-full w-full" aria-hidden />;
}

export default HuntOffering;
