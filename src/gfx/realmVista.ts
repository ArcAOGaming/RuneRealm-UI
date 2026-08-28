/**
 * The first view of the Realm.
 *
 * This is not a map. It is the conflict in one image: an old gate held open by
 * the four elemental currents while the Corporation's measured towers wait at
 * the edge of it. Everything is geometry so the page can lean, orbit and react
 * without pretending a still illustration is a world.
 *
 * Like every graphics layer in the app, it is optional. A caller gets `null`
 * when WebGL is unavailable and keeps a complete HTML page underneath it.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  WebGLRenderer,
} from 'three';
import mark from './mark.json';

const GOLD = 0xd6c8a2;
const ELEMENTS = [0xff7a43, 0x4ab0ff, 0x7ee2c8, 0xc9a25d];
const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

export type RealmVista = { dispose(): void };

function markShape() {
  const shape = new Shape();
  const s = 2 / mark.box;
  const x = (n: number) => (n - mark.box / 2) * s;
  const y = (n: number) => (mark.box / 2 - n) * s;
  mark.bezel.points.forEach(([px, py], i) => {
    if (i === 0) shape.moveTo(x(px), y(py));
    else shape.lineTo(x(px), y(py));
  });
  shape.closePath();
  return shape;
}

function runeBar([x1, y1, x2, y2]: number[], weight: number) {
  const s = 2 / mark.box;
  const ax = (x1 - 50) * s;
  const ay = (50 - y1) * s;
  const bx = (x2 - 50) * s;
  const by = (50 - y2) * s;
  const w = weight * s;
  const bar = new Mesh(new BoxGeometry(Math.hypot(bx - ax, by - ay) + w, w, 0.045));
  bar.position.set((ax + bx) / 2, (ay + by) / 2, 0.14);
  bar.rotation.z = Math.atan2(by - ay, bx - ax);
  return bar;
}

function makeGate() {
  const gate = new Group();
  const slab = new Mesh(
    new ExtrudeGeometry(markShape(), {
      depth: 0.18,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 2,
    }),
    new MeshStandardMaterial({
      color: 0x151722,
      roughness: 0.86,
      metalness: 0.12,
    }),
  );
  slab.geometry.center();
  gate.add(slab);

  const rune = new MeshBasicMaterial({ color: GOLD, toneMapped: false });
  for (const stroke of mark.rune.strokes) {
    const bar = runeBar(stroke, mark.rune.weight);
    bar.material = rune;
    gate.add(bar);
  }

  // The public face of the gate is arcane. The four orbiting currents are what
  // keep changing around it; the seal itself belongs to the whole Realm.
  const bind = new MeshBasicMaterial({ color: 0x967aff, toneMapped: false });
  for (const stroke of mark.bind.strokes) {
    const bar = runeBar(stroke, mark.bind.weight);
    bar.material = bind;
    gate.add(bar);
  }
  gate.scale.setScalar(0.92);
  return gate;
}

function makeMeasuredGrid() {
  const vertices: number[] = [];
  for (let i = -8; i <= 8; i++) {
    vertices.push(-7, -2.15, i * 0.55, 7, -2.15, i * 0.55);
    vertices.push(i * 0.55, -2.15, -7, i * 0.55, -2.15, 7);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
  return new LineSegments(
    geometry,
    new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.085 }),
  );
}

export function createRealmVista(
  canvas: HTMLCanvasElement,
  { showGate = true }: { showGate?: boolean } = {},
): RealmVista | null {
  LIVE.get(canvas)?.();

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 40);
  camera.position.set(0, 0.15, 7.3);

  const world = new Group();
  world.position.set(1.35, 0.05, 0);
  scene.add(world);

  const gate = makeGate();
  gate.rotation.set(-0.08, -0.32, -0.025);
  if (showGate) world.add(gate);

  // A gate should read as a threshold, not a logo pasted into space. The three
  // imperfect rings describe the opening without a solid portal effect.
  const rings = new Group();
  [2.04, 2.23, 2.44].forEach((radius, i) => {
    const ring = new Mesh(
      new TorusGeometry(radius, i === 0 ? 0.014 : 0.008, 5, 120),
      new MeshBasicMaterial({
        color: i === 0 ? 0x967aff : GOLD,
        transparent: true,
        opacity: i === 0 ? 0.38 : 0.15,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    );
    ring.rotation.z = i * 0.52 - 0.3;
    ring.rotation.y = 0.14 + i * 0.04;
    rings.add(ring);
  });
  world.add(rings);

  // Four thin record-slabs orbit the threshold like cards caught in the
  // Realm's current. The actual card art is shown immediately below the hero;
  // here their silhouettes make that collectible system part of the first
  // Three.js impression instead of a separate marketing idea.
  const relicCards: Array<{
    card: Group;
    baseY: number;
    baseZ: number;
    phase: number;
    turn: number;
  }> = [];
  const cardPositions = [
    [-2.62, 1.36, -0.85],
    [-2.88, -0.9, -0.38],
    [2.7, 1.24, -0.62],
    [2.98, -0.86, -0.98],
  ];
  ELEMENTS.forEach((hex, i) => {
    const card = new Group();
    const stockGeometry = new BoxGeometry(0.54, 0.9, 0.035);
    const stock = new Mesh(
      stockGeometry,
      new MeshStandardMaterial({
        color: 0x11131d,
        emissive: hex,
        emissiveIntensity: 0.09,
        roughness: 0.55,
        metalness: 0.32,
      }),
    );
    card.add(stock);
    card.add(new LineSegments(
      new EdgesGeometry(stockGeometry),
      new LineBasicMaterial({ color: hex, transparent: true, opacity: 0.48 }),
    ));
    const core = new Mesh(
      new DodecahedronGeometry(0.075, 0),
      new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.88, toneMapped: false }),
    );
    core.position.z = 0.035;
    card.add(core);
    const [x, y, z] = cardPositions[i];
    card.position.set(x, y, z);
    card.rotation.set(i % 2 ? -0.08 : 0.1, i < 2 ? 0.5 : -0.5, i % 2 ? 0.14 : -0.12);
    world.add(card);
    relicCards.push({ card, baseY: y, baseZ: z, phase: i * 1.7, turn: card.rotation.y });
  });

  const currents: { orbit: Group; stone: Mesh; base: number }[] = [];
  ELEMENTS.forEach((hex, i) => {
    const orbit = new Group();
    orbit.rotation.z = i * Math.PI * 0.5 + 0.35;
    orbit.rotation.x = 0.32 + (i % 2) * 0.18;
    const stone = new Mesh(
      new DodecahedronGeometry(0.17 + (i % 2) * 0.025, 0),
      new MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 0.95,
        roughness: 0.4,
        metalness: 0.25,
      }),
    );
    stone.position.x = 2.32;
    orbit.add(stone);
    const light = new PointLight(hex, 1.5, 3.5, 2);
    light.position.copy(stone.position);
    orbit.add(light);
    world.add(orbit);
    currents.push({ orbit, stone, base: i * 0.91 });
  });

  const key = new PointLight(0xe4e9ff, 11, 13, 2);
  key.position.set(-3, 3.4, 5.2);
  scene.add(key);
  const arcane = new PointLight(0x967aff, 6, 10, 2);
  arcane.position.set(2.4, -1.2, 1.2);
  scene.add(arcane);

  // Corporation towers: perfectly repeated proportions, cold faces, no
  // ornament. Their order is the visual opposite of the gate's broken rings.
  const towers = new Group();
  const towerMaterial = new MeshStandardMaterial({
    color: 0x11141e,
    emissive: 0xdce7ff,
    emissiveIntensity: 0.035,
    roughness: 0.34,
    metalness: 0.76,
  });
  [-3.7, -3.15, -2.62, 2.95, 3.52, 4.04].forEach((x, i) => {
    const height = 2.4 + (i % 3) * 0.75;
    const tower = new Mesh(new BoxGeometry(0.32, height, 0.52), towerMaterial);
    tower.position.set(x, -2.05 + height / 2, -1.9 - (i % 2) * 0.45);
    towers.add(tower);
    const slit = new Mesh(
      new PlaneGeometry(0.11, height * 0.68),
      new MeshBasicMaterial({
        color: 0xdce7ff,
        transparent: true,
        opacity: 0.16,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    slit.position.set(x, tower.position.y + 0.05, tower.position.z + 0.265);
    towers.add(slit);
  });
  world.add(towers);

  const grid = makeMeasuredGrid();
  grid.rotation.x = 0;
  world.add(grid);

  const moteCount = 620;
  const motePositions = new Float32Array(moteCount * 3);
  const moteColors = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    const color = new Color(ELEMENTS[i % ELEMENTS.length]);
    motePositions[i * 3] = (Math.random() - 0.5) * 10;
    motePositions[i * 3 + 1] = (Math.random() - 0.5) * 6;
    motePositions[i * 3 + 2] = (Math.random() - 0.5) * 5 - 0.5;
    moteColors[i * 3] = color.r;
    moteColors[i * 3 + 1] = color.g;
    moteColors[i * 3 + 2] = color.b;
  }
  const moteGeometry = new BufferGeometry();
  moteGeometry.setAttribute('position', new BufferAttribute(motePositions, 3));
  moteGeometry.setAttribute('color', new BufferAttribute(moteColors, 3));
  const motes = new Points(
    moteGeometry,
    new PointsMaterial({
      size: 0.026,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  world.add(motes);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mx = 0;
  let my = 0;
  let frame = 0;
  let disposed = false;
  let visible = document.visibilityState !== 'hidden';
  const started = performance.now();

  const resize = () => {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Keep the gate visible on tall phones, where the copy occupies the lower
    // half and the scene becomes the upper half rather than a right column.
    world.position.x = width < 760 ? 0 : 1.35;
    world.position.y = width < 760 ? 1.05 : 0.05;
    world.scale.setScalar(width < 760 ? 0.72 : 1);
    renderer.render(scene, camera);
  };

  const onPointer = (event: PointerEvent) => {
    mx = (event.clientX / window.innerWidth - 0.5) * 2;
    my = (event.clientY / window.innerHeight - 0.5) * 2;
  };
  const onVisibility = () => {
    visible = document.visibilityState !== 'hidden';
    if (visible && !frame && !disposed) frame = requestAnimationFrame(draw);
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    visible = false;
  };

  const draw = (now: number) => {
    frame = 0;
    if (disposed || !visible) return;
    const t = reduced ? 1.4 : (now - started) / 1000;
    gate.rotation.y += ((-0.32 + mx * 0.12) - gate.rotation.y) * 0.035;
    gate.rotation.x += ((-0.08 - my * 0.08) - gate.rotation.x) * 0.035;
    gate.position.y = Math.sin(t * 0.52) * 0.075;
    rings.rotation.z = t * 0.025;
    rings.rotation.x = Math.sin(t * 0.18) * 0.045;
    rings.scale.setScalar(1 + Math.sin(t * 0.72) * 0.012);
    currents.forEach(({ orbit, stone, base }, i) => {
      orbit.rotation.z = base + t * (i % 2 ? -0.17 : 0.14);
      stone.rotation.x = t * (0.42 + i * 0.035);
      stone.rotation.y = t * (0.34 + i * 0.04);
    });
    relicCards.forEach(({ card, baseY, baseZ, phase, turn }, i) => {
      card.position.y = baseY + Math.sin(t * 0.62 + phase) * 0.11;
      card.position.z = baseZ + Math.cos(t * 0.38 + phase) * 0.08;
      card.rotation.y = turn + Math.sin(t * 0.46 + phase) * 0.18 + mx * (i < 2 ? 0.05 : -0.05);
      card.rotation.z += ((i % 2 ? 0.14 : -0.12) + my * 0.025 - card.rotation.z) * 0.03;
    });
    motes.rotation.y = t * 0.012;
    towers.position.y = Math.sin(t * 0.16) * 0.018;
    renderer.render(scene, camera);
    if (!reduced) frame = requestAnimationFrame(draw);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);
  resize();
  frame = requestAnimationFrame(draw);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    scene.traverse((object: any) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m: any) => m.dispose?.());
      else object.material?.dispose?.();
    });
    renderer.dispose();
    renderer.forceContextLoss();
    LIVE.delete(canvas);
  };

  LIVE.set(canvas, dispose);
  return { dispose };
}
