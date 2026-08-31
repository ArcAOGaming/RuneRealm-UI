import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cx } from './primitives';

export type MarketForgeMode = 'trade' | 'bridge' | 'pool';

const COLOR = {
  rune: 0xd6c8a2,
  relic: 0x967aff,
  bridge: 0x4ab0ff,
  void: 0x070910,
};

/**
 * A small live exchange model. The geometry is deliberately abstract: two
 * token seals, the route between them, and the AMM ring that bends the route.
 * It explains the current operation without pretending to be contract state.
 */
export function MarketForge({
  mode, reversed = false, active = false, className,
}: {
  mode: MarketForgeMode;
  reversed?: boolean;
  active?: boolean;
  className?: string;
}) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mount.current;
    if (!host || typeof WebGLRenderingContext === 'undefined') return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
    camera.position.set(0, 0.15, 7.8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return undefined;
    }
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xd9e2ff, 1.25));
    const key = new THREE.PointLight(COLOR.rune, 32, 12);
    key.position.set(-2.8, 2.2, 3.5);
    scene.add(key);
    const fill = new THREE.PointLight(mode === 'bridge' ? COLOR.bridge : COLOR.relic, 28, 12);
    fill.position.set(3, -1.6, 3.2);
    scene.add(fill);

    const root = new THREE.Group();
    root.rotation.x = -0.06;
    scene.add(root);

    const token = (x: number, color: number, sides: number) => {
      const group = new THREE.Group();
      group.position.x = x;
      const face = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.92, 0.22, sides, 1, false),
        new THREE.MeshStandardMaterial({
          color: COLOR.void, metalness: 0.82, roughness: 0.26,
          emissive: color, emissiveIntensity: 0.18,
        }),
      );
      face.rotation.x = Math.PI / 2;
      group.add(face);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.045, 8, sides),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      rim.position.z = 0.13;
      group.add(rim);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.29, 0),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.65,
          metalness: 0.45, roughness: 0.2,
        }),
      );
      core.position.z = 0.22;
      core.rotation.z = Math.PI / 4;
      group.add(core);
      root.add(group);
      return group;
    };

    const leftColor = reversed && mode === 'trade' ? COLOR.relic : COLOR.rune;
    const rightColor = reversed && mode === 'trade' ? COLOR.rune : mode === 'bridge' ? COLOR.bridge : COLOR.relic;
    const left = token(-2.05, leftColor, 8);
    const right = token(2.05, rightColor, 6);

    const poolRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({
        color: mode === 'bridge' ? COLOR.bridge : COLOR.relic,
        transparent: true, opacity: mode === 'bridge' ? 0.34 : 0.78,
      }),
    );
    poolRing.position.z = 0.12;
    root.add(poolRing);
    const poolCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 1),
      new THREE.MeshStandardMaterial({
        color: COLOR.void, emissive: mode === 'bridge' ? COLOR.bridge : COLOR.relic,
        emissiveIntensity: 0.48, metalness: 0.7, roughness: 0.3,
      }),
    );
    root.add(poolCore);

    const routePoints = [
      new THREE.Vector3(-1.12, 0, 0), new THREE.Vector3(-0.62, 0.32, 0),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.62, -0.32, 0),
      new THREE.Vector3(1.12, 0, 0),
    ];
    const route = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(routePoints).getPoints(40)),
      new THREE.LineBasicMaterial({ color: COLOR.rune, transparent: true, opacity: 0.38 }),
    );
    root.add(route);

    const motes = Array.from({ length: 18 }, (_, index) => {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(index % 4 === 0 ? 0.055 : 0.035, 0),
        new THREE.MeshBasicMaterial({ color: index % 2 ? rightColor : leftColor, transparent: true, opacity: 0.92 }),
      );
      root.add(mesh);
      return mesh;
    });
    const curve = new THREE.CatmullRomCurve3(routePoints);

    const dustCount = 90;
    const dustPosition = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      dustPosition[i * 3] = (Math.random() - 0.5) * 6.4;
      dustPosition[i * 3 + 1] = (Math.random() - 0.5) * 3.1;
      dustPosition[i * 3 + 2] = (Math.random() - 0.5) * 2 - 0.7;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPosition, 3));
    const dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({ color: COLOR.rune, size: 0.022, transparent: true, opacity: 0.32 }),
    );
    scene.add(dust);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const clock = new THREE.Clock();
    let frame = 0;
    const paint = () => {
      const time = clock.getElapsedTime();
      const pace = active ? 1.8 : 0.72;
      left.rotation.y = Math.sin(time * 0.55) * 0.13;
      right.rotation.y = -Math.sin(time * 0.55 + 0.8) * 0.13;
      left.rotation.z = time * 0.08;
      right.rotation.z = -time * 0.07;
      poolRing.rotation.z = time * pace;
      poolRing.rotation.x = Math.sin(time * 0.6) * 0.22;
      poolCore.rotation.x = time * 0.35;
      poolCore.rotation.y = time * 0.48;
      dust.rotation.z = time * 0.012;
      motes.forEach((mote, index) => {
        const direction = reversed && mode === 'trade' ? -1 : 1;
        let progress = (time * 0.13 * pace + index / motes.length) % 1;
        if (direction < 0) progress = 1 - progress;
        const point = curve.getPoint(progress);
        mote.position.copy(point);
        mote.position.y += Math.sin(time * 2 + index) * 0.035;
        const pulse = 0.75 + Math.sin(time * 3 + index) * 0.25;
        mote.scale.setScalar(pulse);
      });
      renderer.render(scene, camera);
      if (!reduced) frame = requestAnimationFrame(paint);
    };
    paint();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active, mode, reversed]);

  const title = mode === 'trade' ? 'Constant-product swap route'
    : mode === 'bridge' ? 'Rune bridge route' : 'Liquidity pairing route';

  return (
    <div className={cx('market-forge relative overflow-hidden', className)}>
      <div className="market-forge-fallback absolute inset-0" aria-hidden="true" />
      <div ref={mount} className="absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between">
        <span className="eyebrow text-rune/70">{title}</span>
        <span className={cx('h-1.5 w-1.5 rotate-45 bg-good', active && 'animate-pulse')} />
      </div>
    </div>
  );
}
