import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry,
  CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  HemisphereLight, OctahedronGeometry, PerspectiveCamera, PlaneGeometry,
  PointLight, Scene, SRGBColorSpace, TorusGeometry,
  WebGPURenderer,
} from 'three/webgpu';

export type MarketDioramaItem = {
  id: string;
  art?: string;
  element?: string;
  berry?: boolean;
};

export type MarketDioramaStockItem = MarketDioramaItem & {
  name: string;
  stock: number;
  stockCap: number;
  bid?: number;
  ask?: number;
  bestBid?: number;
  bestAsk?: number;
  held: number;
};

export type MarketDiorama = {
  readonly backend: 'webgpu' | 'webgl2';
  setItem(item: MarketDioramaItem): void;
  setQuantity(quantity: number): void;
  setInventory(inventory: MarketDioramaStockItem[]): void;
  setGold(gold: number): void;
  dispose(): void;
};

const ELEMENT_COLOR: Record<string, number> = {
  fire: 0xff7040,
  water: 0x4ab0ff,
  air: 0x7de0ca,
  rock: 0xd4aa5c,
  arcane: 0x967aff,
};

const LIVE = new WeakMap<HTMLCanvasElement, () => void>();

/**
 * Pixel market stock-room. WebGPURenderer chooses WebGPU where available and
 * Three's WebGL2 backend otherwise. The canvas intentionally renders below CSS
 * resolution, so the 3D overlay belongs to the pixel background instead of
 * looking like a smooth product visual pasted over it.
 */
export async function startMarketDiorama(
  canvas: HTMLCanvasElement,
  initialItem: MarketDioramaItem,
  initialQuantity: number,
  initialInventory: MarketDioramaStockItem[],
  initialGold: number,
): Promise<MarketDiorama | null> {
  LIVE.get(canvas)?.();

  const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  try { await renderer.init(); }
  catch {
    renderer.dispose();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x05070d, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' as const : 'webgl2' as const;
  canvas.dataset.marketBackend = backend;
  const scene = new Scene();
  const camera = new PerspectiveCamera(31, 1, .1, 40);
  camera.position.set(0, .68, 7.25);
  camera.lookAt(0, -.34, 0);

  const chamber = new Group();
  chamber.position.y = -.18;
  scene.add(chamber);
  const backdropMaterial = new MeshBasicMaterial({ color: 0x38425c, toneMapped: false });
  const backdrop = new Mesh(new PlaneGeometry(9.2, 7), backdropMaterial);
  backdrop.position.set(0, -.42, -2.35);
  chamber.add(backdrop);

  let disposed = false;
  let currentItem = initialItem;
  let currentQuantity = Math.max(1, Math.floor(initialQuantity) || 1);
  let currentInventory = initialInventory;
  let currentGold = Math.max(0, Math.floor(initialGold) || 0);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const wood = new MeshStandardMaterial({ color: 0x8b5a38, roughness: .8, metalness: .02 });
  const edge = new MeshStandardMaterial({ color: 0xe0bd78, roughness: .48, metalness: .3 });
  const iron = new MeshStandardMaterial({ color: 0x5b647f, roughness: .42, metalness: .6 });

  type Bay = { x: number; y: number; width: number; height: number };
  const shelfBays: Record<string, Bay> = {
    scroll: { x: -2.08, y: 1.6, width: 2.42, height: .7 },
    rune: { x: .47, y: 1.6, width: 2.42, height: .7 },
    fire_berry: { x: -2.08, y: .45, width: 2.42, height: 1.5 },
    water_berry: { x: .47, y: .45, width: 2.42, height: 1.5 },
    air_berry: { x: -2.08, y: -1.25, width: 2.42, height: 1.5 },
    rock_berry: { x: .47, y: -1.25, width: 2.42, height: 1.5 },
  };

  const bayBack = new MeshBasicMaterial({ color: 0x242b40, transparent: true, opacity: .72, toneMapped: false });
  for (const bay of Object.values(shelfBays)) {
    const back = new Mesh(new PlaneGeometry(bay.width, bay.height), bayBack);
    back.position.set(bay.x, bay.y, -1.52); chamber.add(back);
    const shelf = new Mesh(new BoxGeometry(bay.width + .08, .09, .55), wood);
    shelf.position.set(bay.x, bay.y - bay.height / 2, -1.18); chamber.add(shelf);
    const top = new Mesh(new BoxGeometry(bay.width + .08, .055, .42), iron);
    top.position.set(bay.x, bay.y + bay.height / 2, -1.27); chamber.add(top);
    for (const side of [-1, 1]) {
      const upright = new Mesh(new BoxGeometry(.085, bay.height + .1, .42), iron);
      upright.position.set(bay.x + side * bay.width / 2, bay.y, -1.26); chamber.add(upright);
    }
  }

  /* Right quarter: an intentionally empty future shopkeeper table above the
     player's trade staging bench. Only the Gold belongs on the upper table. */
  const shopTable = new Mesh(new BoxGeometry(1.75, .26, .92), wood);
  shopTable.position.set(2.62, -.18, -.18); chamber.add(shopTable);
  const shopTableLip = new Mesh(new BoxGeometry(1.82, .055, .98), edge);
  shopTableLip.position.set(2.62, -.02, -.18); chamber.add(shopTableLip);
  for (const x of [2.04, 3.2]) {
    const leg = new Mesh(new BoxGeometry(.14, 1.18, .18), iron);
    leg.position.set(x, -.79, -.18); chamber.add(leg);
  }
  const tradeTable = new Mesh(new BoxGeometry(1.82, .34, 1.08), wood);
  tradeTable.position.set(2.62, -1.58, .24); chamber.add(tradeTable);
  const tradeLip = new Mesh(new BoxGeometry(1.9, .055, 1.16), edge);
  tradeLip.position.set(2.62, -1.38, .25); chamber.add(tradeLip);

  scene.add(new AmbientLight(0xd4dcf2, 1.28));
  scene.add(new HemisphereLight(0xdce5ff, 0x463522, 1.45));
  const warmLight = new PointLight(0xffdf9a, 30, 10, 1.8);
  warmLight.position.set(-2.6, 2.5, 3.4);
  scene.add(warmLight);
  const itemLight = new PointLight(ELEMENT_COLOR.arcane, 29, 8, 1.9);
  itemLight.position.set(2.25, .8, 2.4);
  scene.add(itemLight);

  const stockGroup = new Group();
  chamber.add(stockGroup);
  const orderGroup = new Group();
  orderGroup.position.set(2.62, -1.25, .92);
  chamber.add(orderGroup);
  const poofGroup = new Group();
  poofGroup.position.copy(orderGroup.position);
  chamber.add(poofGroup);
  const goldGroup = new Group();
  goldGroup.position.set(2.62, .03, .12);
  chamber.add(goldGroup);

  const disposeGroup = (group: Group) => {
    for (const child of [...group.children]) {
      child.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as MeshBasicMaterial | MeshStandardMaterial | undefined;
        material?.dispose?.();
      });
      group.remove(child);
    }
  };

  const rebuildGold = (gold: number) => {
    disposeGroup(goldGroup);
    const visibleCoins = Math.min(18, Math.ceil(Math.max(0, gold) / 10));
    for (let index = 0; index < visibleCoins; index += 1) {
      const coin = new Mesh(
        new CylinderGeometry(.13, .13, .034, 8),
        new MeshStandardMaterial({ color: 0xf0bd50, emissive: 0x8a5718, emissiveIntensity: .16, roughness: .3, metalness: .86 }),
      );
      coin.position.set(-.52 + (index % 6) * .21, Math.floor(index / 6) * .043, -.17 + (index % 3) * .17);
      coin.rotation.y = (index % 3) * .2;
      goldGroup.add(coin);
    }
  };

  const basket = () => {
    const group = new Group();
    const body = new Mesh(
      new CylinderGeometry(.36, .29, .4, 6),
      new MeshStandardMaterial({ color: 0x6a3e22, roughness: .9, metalness: .02 }),
    );
    body.rotation.y = Math.PI / 6;
    group.add(body);
    const rim = new Mesh(
      new TorusGeometry(.32, .027, 4, 12),
      new MeshStandardMaterial({ color: 0xa87943, roughness: .66, metalness: .14 }),
    );
    rim.rotation.x = Math.PI / 2; rim.position.y = .2;
    group.add(rim);
    return group;
  };

  const crate = () => {
    const group = new Group();
    group.add(new Mesh(
      new BoxGeometry(.62, .54, .52),
      new MeshStandardMaterial({ color: 0x51301e, roughness: .9, metalness: .02 }),
    ));
    for (const y of [-.22, .22]) {
      const band = new Mesh(new BoxGeometry(.66, .055, .56), edge);
      band.position.y = y; group.add(band);
    }
    return group;
  };

  const pallet = () => {
    const group = new Group();
    const base = new Mesh(new BoxGeometry(1.02, .12, .68), edge);
    base.position.y = -.33; group.add(base);
    for (const x of [-.27, .27]) {
      const box = new Mesh(
        new BoxGeometry(.48, .62, .52),
        new MeshStandardMaterial({ color: 0x45291b, roughness: .9, metalness: .02 }),
      );
      box.position.x = x; group.add(box);
    }
    return group;
  };

  const rebuildInventory = () => {
    disposeGroup(stockGroup);
    for (const item of currentInventory) {
      const bay = shelfBays[item.id];
      if (!bay) continue;
      const units: Array<'pallet' | 'crate' | 'basket'> = [];
      let remainder = Math.max(0, item.stock);
      const pallets = Math.floor(remainder / 1000); remainder %= 1000;
      const crates = Math.floor(remainder / 100); remainder %= 100;
      const baskets = Math.floor(remainder / 10); remainder %= 10;
      for (let index = 0; index < pallets; index += 1) units.push('pallet');
      for (let index = 0; index < crates; index += 1) units.push('crate');
      for (let index = 0; index < baskets; index += 1) units.push('basket');

      const columns = 5;
      units.slice(0, 10).forEach((kind, index) => {
        const object = kind === 'pallet' ? pallet() : kind === 'crate' ? crate() : basket();
        const row = Math.floor(index / columns);
        const column = index % columns;
        const used = Math.min(columns, units.length - row * columns);
        object.position.set(
          bay.x + (column - (used - 1) / 2) * .34,
          bay.y - bay.height / 2 + .22 + row * .35,
          -.78 + (column % 2) * .025,
        );
        const scale = kind === 'pallet'
          ? (item.berry ? .68 : .6)
          : kind === 'crate' ? (item.berry ? .61 : .54) : (item.berry ? .45 : .4);
        object.scale.setScalar(scale);
        object.rotation.y = (index % 3 - 1) * .045;
        stockGroup.add(object);
      });
    }
  };

  const rebuildOrder = (quantity: number) => {
    disposeGroup(orderGroup);
    if (!currentItem.berry) return;
    const baskets = Math.min(10, Math.floor(quantity / 10));
    for (let index = 0; index < baskets; index += 1) {
      const object = basket();
      const columns = Math.min(5, baskets);
      object.position.set((index % columns - (columns - 1) / 2) * .68, Math.floor(index / columns) * .5, 0);
      object.scale.setScalar(.82);
      orderGroup.add(object);
    }
  };

  let orderTransition: { start: number; from: number; to: number; swapped: boolean; basketChanged: boolean } | null = null;
  let stockTransition: { start: number; swapped: boolean } | null = null;
  let poofStarted = 0;

  const spawnPoof = (started: number) => {
    disposeGroup(poofGroup); poofStarted = started;
    for (let index = 0; index < 12; index += 1) {
      const tint = index % 2 ? 0xd6c8a2 : (ELEMENT_COLOR[currentItem.element ?? 'arcane'] ?? ELEMENT_COLOR.arcane);
      const mote = new Mesh(
        new OctahedronGeometry(index % 3 ? .026 : .041, 0),
        new MeshBasicMaterial({ color: tint, transparent: true, opacity: .62 }),
      );
      const angle = (index / 12) * Math.PI * 2;
      mote.userData.velocity = { x: Math.cos(angle) * (.32 + (index % 3) * .08), y: Math.sin(angle) * .2 + .18 };
      mote.position.set(0, .2, .45); poofGroup.add(mote);
    }
  };

  let aimX = 0; let aimY = 0; let cameraX = 0; let cameraY = .68;
  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    aimX = ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 2;
    aimY = ((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * 2;
    if (reduced) render(performance.now());
  };
  const onLeave = () => { aimX = 0; aimY = 0; };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  const setItem = (next: MarketDioramaItem) => {
    currentItem = next;
    orderTransition = null; stockTransition = null;
    disposeGroup(poofGroup); poofStarted = 0;
    const tint = ELEMENT_COLOR[next.element ?? 'arcane'] ?? ELEMENT_COLOR.arcane;
    itemLight.color.set(tint);
    rebuildInventory(); rebuildOrder(currentQuantity);
    if (reduced) render(performance.now());
  };

  const setQuantity = (quantity: number) => {
    const next = Math.max(1, Math.min(100, Math.floor(quantity) || 1));
    if (!currentItem.berry) { currentQuantity = next; rebuildOrder(next); return; }
    if (next === currentQuantity) { rebuildOrder(next); return; }
    if (orderTransition) { orderTransition = null; rebuildOrder(currentQuantity); }
    const from = currentQuantity; currentQuantity = next;
    const started = performance.now() / 1000;
    const basketChanged = Math.floor(from / 10) !== Math.floor(next / 10);
    if (reduced) {
      rebuildOrder(next); if (basketChanged) spawnPoof(started); render(performance.now()); return;
    }
    orderTransition = { start: started, from, to: next, swapped: false, basketChanged };
  };

  const setInventory = (inventory: MarketDioramaStockItem[]) => {
    const before = currentInventory.find((row) => row.id === currentItem.id)?.stock ?? 0;
    const after = inventory.find((row) => row.id === currentItem.id)?.stock ?? 0;
    currentInventory = inventory;
    const delta = after - before;
    if (!delta || reduced) { rebuildInventory(); if (reduced) render(performance.now()); return; }
    if (stockTransition) { stockTransition = null; rebuildInventory(); }
    stockTransition = { start: performance.now() / 1000, swapped: false };
  };

  const setGold = (gold: number) => {
    currentGold = Math.max(0, Math.floor(gold) || 0);
    rebuildGold(currentGold);
    if (reduced) render(performance.now());
  };

  let raf = 0; let lastPaint = 0;
  const render = (now: number) => {
    const time = now / 1000;
    if (orderTransition) {
      const progress = Math.max(0, Math.min(1, (time - orderTransition.start) / .92));
      if (orderTransition.basketChanged && !poofStarted && progress >= .55) spawnPoof(time);
      if (!orderTransition.swapped && progress >= .64) { rebuildOrder(orderTransition.to); orderTransition.swapped = true; }
      if (progress >= 1) orderTransition = null;
    }
    if (stockTransition) {
      const progress = Math.max(0, Math.min(1, (time - stockTransition.start) / .92));
      if (!stockTransition.swapped && progress >= .64) { rebuildInventory(); stockTransition.swapped = true; }
      if (progress >= 1) stockTransition = null;
    }
    if (poofStarted) {
      const progress = (time - poofStarted) / .52;
      if (progress >= 1) { disposeGroup(poofGroup); poofStarted = 0; }
      else for (const child of poofGroup.children) {
        const mote = child as Mesh;
        const velocity = mote.userData.velocity as { x: number; y: number };
        mote.position.x = velocity.x * progress; mote.position.y = .2 + velocity.y * progress;
        mote.scale.setScalar(.65 + progress * 1.6);
        (mote.material as MeshBasicMaterial).opacity = .62 * (1 - progress);
      }
    }
    cameraX += (aimX * .07 - cameraX) * .07;
    cameraY += (.68 - aimY * .035 - cameraY) * .07;
    camera.position.x = cameraX; camera.position.y = cameraY;
    camera.lookAt(0, -.34, 0);
    chamber.rotation.y = cameraX * .016;
    itemLight.intensity = 28.5 + (reduced ? 0 : Math.sin(time * .55) * .8);
    renderer.render(scene, camera);
    if (import.meta.env.DEV) {
      canvas.dataset.marketQuantity = String(currentQuantity);
      canvas.dataset.marketStock = String(currentInventory.find((row) => row.id === currentItem.id)?.stock ?? 0);
      canvas.dataset.marketTransition = orderTransition ? `${orderTransition.from}->${orderTransition.to}` : 'settled';
      canvas.dataset.marketFlights = '0';
    }
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - lastPaint < 45) return;
    lastPaint = now; render(now);
  };

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth); const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(Math.ceil(width), Math.ceil(height), false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(() => { resize(); if (reduced) render(performance.now()); });
  observer.observe(canvas); resize();

  setItem(initialItem);
  setInventory(initialInventory);
  rebuildInventory(); rebuildOrder(currentQuantity); rebuildGold(currentGold);
  render(performance.now());
  if (!reduced) raf = requestAnimationFrame(frame);

  const handle: MarketDiorama = {
    backend,
    setItem,
    setQuantity,
    setInventory,
    setGold,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf); observer.disconnect();
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
      scene.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as MeshBasicMaterial | MeshStandardMaterial | undefined;
        material?.dispose?.();
      });
      renderer.dispose();
    },
  };
  LIVE.set(canvas, handle.dispose);
  return handle;
}
