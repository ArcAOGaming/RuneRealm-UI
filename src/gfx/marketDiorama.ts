import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, Color,
  CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  HemisphereLight, OctahedronGeometry, PerspectiveCamera, PlaneGeometry,
  PointLight, Scene, SRGBColorSpace, TorusGeometry,
  WebGPURenderer,
} from 'three/webgpu';

import {
  ALL_BAYS, BASKET_RIM, BAY_Z, BOARD_THICKNESS, CAMERA, CHAMBER_Y, COUNTER,
  CRATE_LID, MAX_ORDER, RAIL_THICKNESS, ROOM, STATION, UPRIGHT_WIDTH, bayKey,
  fovFor, goldPiles, orderUnits, stockUnits, wobble,
  type GoldPile, type MarketMode, type ShelfBay, type StockUnit, type WallId,
} from './marketShelves';

export type MarketDioramaItem = {
  id: string;
  art?: string;
  element?: string;
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

/** Where the camera currently is, so the overlay can track it without easing it twice. */
export type MarketCamera = { aimX: number; aimY: number; station: number };

export type MarketDiorama = {
  readonly backend: 'webgpu' | 'webgl2';
  setItem(item: MarketDioramaItem): void;
  setQuantity(quantity: number): void;
  setInventory(inventory: MarketDioramaStockItem[]): void;
  setGold(gold: number): void;
  /** Pointer parallax, driven by the wrapper so the overlay and scene agree. */
  setAim(x: number, y: number): void;
  /** Light the shelf the player is pointing at, and the one they picked. */
  setHighlight(hovered: string | null, selected: string | null): void;
  /** Truck the camera between the shop wall and the player's satchel. */
  setMode(mode: MarketMode): void;
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
 *
 * Every position here comes from `marketShelves.ts`, which the pixel overlay
 * projects from as well. Neither half owns the layout, so goods cannot drift
 * off the board they are stocked on.
 */
export async function startMarketDiorama(
  canvas: HTMLCanvasElement,
  initialItem: MarketDioramaItem,
  initialQuantity: number,
  initialInventory: MarketDioramaStockItem[],
  initialGold: number,
  initialMode: MarketMode,
  onCamera?: (camera: MarketCamera) => void,
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
  const camera = new PerspectiveCamera(CAMERA.fov, 1, .1, 40);
  camera.position.set(0, CAMERA.y, CAMERA.z);
  camera.lookAt(CAMERA.lookAt.x, CAMERA.lookAt.y, CAMERA.lookAt.z);

  const chamber = new Group();
  chamber.position.y = CHAMBER_Y;
  scene.add(chamber);
  /* The room has to span both camera stations and the pan between them, or
     trucking over to the satchel shows the edge of the backdrop. */
  const backdropMaterial = new MeshBasicMaterial({ color: 0x38425c, toneMapped: false });
  const backdrop = new Mesh(new PlaneGeometry(ROOM.width, ROOM.height), backdropMaterial);
  backdrop.position.set(ROOM.x, ROOM.y, ROOM.backZ);
  chamber.add(backdrop);
  const floor = new Mesh(
    new PlaneGeometry(ROOM.width, ROOM.floorDepth),
    new MeshBasicMaterial({ color: 0x2a3348, toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ROOM.x, ROOM.floorY, ROOM.backZ + ROOM.floorDepth / 2);
  chamber.add(floor);

  let disposed = false;
  let currentItem = initialItem;
  let currentQuantity = Math.max(1, Math.floor(initialQuantity) || 1);
  let currentInventory = initialInventory;
  let currentGold = Math.max(0, Math.floor(initialGold) || 0);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const edge = new MeshStandardMaterial({ color: 0xe0bd78, roughness: .48, metalness: .3 });
  const iron = new MeshStandardMaterial({ color: 0x5b647f, roughness: .42, metalness: .6 });

  /* One material set per bay, so hovering a shelf can light that shelf's own
     timber rather than a rectangle drawn in front of it. */
  type BayParts = {
    bay: ShelfBay;
    back: MeshBasicMaterial;
    wood: MeshStandardMaterial;
    frame: MeshStandardMaterial;
    tint: Color;
  };
  const bayParts = new Map<string, BayParts>();

  for (const bay of ALL_BAYS) {
    /* Same geometry both sides of the room; the satchel's timber is darker and
       its ironwork warmer, so the player's own rack reads as theirs. */
    const own = bay.wall === 'satchel';
    const back = new MeshBasicMaterial({
      color: own ? 0x1f2536 : 0x242b40, transparent: true, opacity: .72, toneMapped: false,
    });
    const wood = new MeshStandardMaterial({
      color: own ? 0x6d4429 : 0x8b5a38, roughness: .82, metalness: .02, emissive: 0x000000,
    });
    const frame = new MeshStandardMaterial({
      color: own ? 0x7a6448 : 0x5b647f, roughness: .46, metalness: own ? .34 : .6, emissive: 0x000000,
    });

    const panel = new Mesh(new PlaneGeometry(bay.width, bay.height), back);
    panel.position.set(bay.x, bay.y, BAY_Z.back); chamber.add(panel);
    const board = new Mesh(new BoxGeometry(bay.width + .08, BOARD_THICKNESS, BAY_Z.boardDepth), wood);
    board.position.set(bay.x, bay.y - bay.height / 2, BAY_Z.board); chamber.add(board);
    const rail = new Mesh(new BoxGeometry(bay.width + .08, RAIL_THICKNESS, .42), frame);
    rail.position.set(bay.x, bay.y + bay.height / 2, BAY_Z.frame - .01); chamber.add(rail);
    for (const side of [-1, 1]) {
      const upright = new Mesh(new BoxGeometry(UPRIGHT_WIDTH, bay.height + .1, .42), frame);
      upright.position.set(bay.x + side * bay.width / 2, bay.y, BAY_Z.frame); chamber.add(upright);
    }
    bayParts.set(bayKey(bay), { bay, back, wood, frame, tint: new Color(ELEMENT_COLOR.arcane) });
  }

  /* Right quarter: an intentionally empty future shopkeeper table above the
     player's trade staging bench. Only the Gold belongs on the upper table. */
  const shopWood = new MeshStandardMaterial({ color: 0x8b5a38, roughness: .8, metalness: .02 });
  const shopTable = new Mesh(new BoxGeometry(1.75, .26, .92), shopWood);
  shopTable.position.set(COUNTER.x, -.18, -.18); chamber.add(shopTable);
  const shopTableLip = new Mesh(new BoxGeometry(1.82, .055, .98), edge);
  shopTableLip.position.set(COUNTER.x, -.02, -.18); chamber.add(shopTableLip);
  for (const x of [COUNTER.x - .58, COUNTER.x + .58]) {
    const leg = new Mesh(new BoxGeometry(.14, 1.18, .18), iron);
    leg.position.set(x, -.79, -.18); chamber.add(leg);
  }
  /* The counter's top face is COUNTER.surfaceY; the order stands on it. */
  const tradeTable = new Mesh(new BoxGeometry(COUNTER.width, .34, COUNTER.depth), shopWood);
  tradeTable.position.set(COUNTER.x, COUNTER.surfaceY - .2, .24); chamber.add(tradeTable);
  const tradeLip = new Mesh(new BoxGeometry(COUNTER.width + .08, .055, COUNTER.depth + .08), edge);
  tradeLip.position.set(COUNTER.x, COUNTER.surfaceY - .028, .25); chamber.add(tradeLip);

  scene.add(new AmbientLight(0xd4dcf2, 1.28));
  scene.add(new HemisphereLight(0xdce5ff, 0x463522, 1.45));
  const warmLight = new PointLight(0xffdf9a, 30, 10, 1.8);
  warmLight.position.set(-2.6, 2.5, 3.4);
  scene.add(warmLight);
  const itemLight = new PointLight(ELEMENT_COLOR.arcane, 29, 8, 1.9);
  itemLight.position.set(COUNTER.x - .37, .8, 2.4);
  scene.add(itemLight);

  const stockGroup = new Group();
  chamber.add(stockGroup);
  const orderGroup = new Group();
  chamber.add(orderGroup);
  const poofGroup = new Group();
  poofGroup.position.set(COUNTER.x, COUNTER.surfaceY + .2, COUNTER.z);
  chamber.add(poofGroup);
  const goldGroup = new Group();
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

  const goldMetal = () => new MeshStandardMaterial({
    color: 0xf0bd50, emissive: 0x8a5718, emissiveIntensity: .16, roughness: .3, metalness: .86,
  });

  /**
   * One pile of gold. Coins are stacked with a per-coin wobble in offset and
   * spin so a stack reads as coins someone piled rather than a machined
   * cylinder — the seed is the pile's, so the wobble is stable across rebuilds.
   */
  const goldPile = (pile: GoldPile) => {
    const group = new Group();
    if (pile.kind === 'bar') {
      const ingot = new Mesh(new BoxGeometry(.30, .10, .17), goldMetal());
      ingot.position.y = .05;
      const cap = new Mesh(new BoxGeometry(.22, .055, .13), goldMetal());
      cap.position.y = .125;
      group.add(ingot, cap);
      group.rotation.y = wobble(pile.seed * 7) * .16;
      return group;
    }
    const COIN_HEIGHT = .036;
    for (let index = 0; index < pile.coins; index += 1) {
      const coin = new Mesh(new CylinderGeometry(.13, .13, COIN_HEIGHT, 8), goldMetal());
      const lean = wobble(pile.seed * 11 + index) * .022;
      coin.position.set(lean, COIN_HEIGHT * (index + .5), wobble(pile.seed * 13 + index) * .022);
      coin.rotation.y = wobble(pile.seed * 17 + index) * .7;
      coin.rotation.z = wobble(pile.seed * 19 + index) * .05;
      group.add(coin);
    }
    return group;
  };

  const rebuildGold = (gold: number) => {
    disposeGroup(goldGroup);
    for (const pile of goldPiles(gold)) {
      const object = goldPile(pile);
      object.position.set(pile.x, pile.y, pile.z);
      goldGroup.add(object);
    }
  };

  /* Containers are modelled with their ORIGIN AT THEIR BASE: a unit's position
     is the surface it stands on, and `marketShelves` can hand the overlay the
     top of it without either side compensating for a centred box. */
  const basket = () => {
    const group = new Group();
    const body = new Mesh(
      new CylinderGeometry(.36, .29, .4, 6),
      new MeshStandardMaterial({ color: 0x6a3e22, roughness: .9, metalness: .02 }),
    );
    body.rotation.y = Math.PI / 6; body.position.y = .2;
    group.add(body);
    /* The rim is the lip `basketLipEdge` cuts the goods against. */
    const rim = new Mesh(
      new TorusGeometry(BASKET_RIM.radius, .027, 4, 12),
      new MeshStandardMaterial({ color: 0xa87943, roughness: .66, metalness: .14 }),
    );
    rim.rotation.x = Math.PI / 2; rim.position.y = BASKET_RIM.y;
    group.add(rim);
    return group;
  };

  const crate = () => {
    const group = new Group();
    const box = new Mesh(
      new BoxGeometry(.62, .54, .52),
      new MeshStandardMaterial({ color: 0x51301e, roughness: .9, metalness: .02 }),
    );
    box.position.y = .27; group.add(box);
    for (const y of [.05, .49]) {
      const band = new Mesh(new BoxGeometry(.66, .055, .56), edge.clone());
      band.position.y = y; group.add(band);
    }
    /* Left askew on purpose: the gap is what the goods inside are seen through.
       Built from `CRATE_LID`, which `crateLidEdge` also derives the sprite cut
       from — move the lid and the cut moves with it. */
    const lid = new Mesh(
      new BoxGeometry(CRATE_LID.width, CRATE_LID.height, CRATE_LID.depth),
      new MeshStandardMaterial({ color: 0x5d3922, roughness: .88, metalness: .02 }),
    );
    lid.position.set(CRATE_LID.x, CRATE_LID.y, CRATE_LID.z);
    lid.rotation.z = CRATE_LID.tilt;
    lid.rotation.y = CRATE_LID.yaw;
    group.add(lid);
    return group;
  };

  const pallet = () => {
    const group = new Group();
    const base = new Mesh(new BoxGeometry(1.02, .12, .68), edge.clone());
    base.position.y = .06; group.add(base);
    for (const x of [-.27, .27]) {
      const box = new Mesh(
        new BoxGeometry(.48, .62, .52),
        new MeshStandardMaterial({ color: 0x45291b, roughness: .9, metalness: .02 }),
      );
      box.position.set(x, .43, 0); group.add(box);
    }
    return group;
  };

  const buildUnit = (unit: StockUnit, index: number) => {
    const object = unit.kind === 'pallet' ? pallet() : unit.kind === 'crate' ? crate() : basket();
    object.position.set(unit.x, unit.y, unit.z);
    object.scale.setScalar(unit.scale);
    object.rotation.y = (index % 3 - 1) * .045;
    return object;
  };

  const rebuildInventory = () => {
    disposeGroup(stockGroup);
    for (const item of currentInventory) {
      for (const wall of ['shop', 'satchel'] as const) {
        const parts = bayParts.get(`${wall}:${item.id}`);
        if (!parts) continue;
        parts.tint.set(ELEMENT_COLOR[item.element ?? 'arcane'] ?? ELEMENT_COLOR.arcane);
        const count = wall === 'shop' ? item.stock : item.held;
        stockUnits(parts.bay, count).forEach((unit, index) => stockGroup.add(buildUnit(unit, index)));
      }
    }
    applyHighlight();
  };

  const rebuildOrder = (quantity: number) => {
    disposeGroup(orderGroup);
    orderUnits(quantity).units.forEach((unit, index) => orderGroup.add(buildUnit(unit, index)));
  };

  let hoveredBay: string | null = null;
  let selectedBay: string | null = initialItem.id;
  let activeWall: WallId = initialMode === 'buy' ? 'shop' : 'satchel';

  const applyHighlight = () => {
    for (const [key, parts] of bayParts) {
      /* One lit bay at a time: the good is selected on the wall being traded
         against, never on both at once. Hover is per bay, since that is what
         the pointer is actually over. */
      const isSelected = parts.bay.id === selectedBay && parts.bay.wall === activeWall;
      const isHovered = key === hoveredBay;
      const lift = isSelected ? 1 : isHovered ? .4 : 0;
      /* The shelf is the whole highlight now — there is no overlay plate drawn
         over it — so the lit frame has to carry it on its own. The back panel
         still takes almost none: lighting the backing washes out the goods
         standing in front of it. */
      const own = parts.bay.wall === 'satchel';
      parts.back.color.set(own ? 0x1f2536 : 0x242b40).lerp(parts.tint, lift * .2);
      parts.back.opacity = .72 + lift * .08;
      parts.wood.emissive.copy(parts.tint);
      parts.wood.emissiveIntensity = lift * .42;
      parts.frame.emissive.copy(parts.tint);
      parts.frame.emissiveIntensity = lift * .8;
      parts.frame.color.set(own ? 0x7a6448 : 0x5b647f).lerp(parts.tint, lift * .3);
    }
  };

  /**
   * Each quantity change books its OWN swap, at its own moment. A second click
   * arriving mid-flight does not cancel and restart the first one — it queues
   * behind it — so holding the stepper down plays a run of independent moves
   * instead of one animation endlessly starting over.
   */
  const ORDER_SWAP_DELAY = .59;
  const POOF_DELAY = .5;
  let pendingSwaps: Array<{ at: number; to: number }> = [];
  let pendingPoofs: number[] = [];
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

  let aimX = 0; let aimY = 0; let cameraX = 0; let cameraY = 0;
  /* The truck is timed, not per-frame eased: a dropped or throttled frame then
     costs smoothness rather than leaving the camera stranded half way between
     the two stations with the composition wrong. */
  const PAN_SECONDS = .62;
  let station: number = STATION[initialMode];
  let stationFrom = station; let stationTarget: number = station; let stationStart = 0;

  const setMode = (mode: MarketMode) => {
    /* Selection follows the wall being traded against, so switching side moves
       the lit bay across rather than lighting the same good twice. */
    activeWall = mode === 'buy' ? 'shop' : 'satchel';
    applyHighlight();
    const next = STATION[mode];
    if (next === stationTarget) return;
    stationFrom = station; stationTarget = next;
    stationStart = performance.now() / 1000;
    if (reduced) { station = next; render(performance.now()); }
  };
  const setAim = (x: number, y: number) => {
    aimX = Math.max(-1, Math.min(1, x));
    aimY = Math.max(-1, Math.min(1, y));
    if (reduced) render(performance.now());
  };

  const setItem = (next: MarketDioramaItem) => {
    /* Changing which good you are trading does not change how many, so nothing
       flies anywhere: the staged order puffs and comes back as the new item. */
    const swapped = next.id !== currentItem.id;
    currentItem = next;
    selectedBay = next.id;
    pendingSwaps = []; pendingPoofs = []; stockTransition = null;
    disposeGroup(poofGroup); poofStarted = 0;
    const tint = ELEMENT_COLOR[next.element ?? 'arcane'] ?? ELEMENT_COLOR.arcane;
    itemLight.color.set(tint);
    rebuildInventory(); rebuildOrder(currentQuantity);
    if (swapped) spawnPoof(performance.now() / 1000);
    if (reduced) render(performance.now());
  };

  const setHighlight = (hovered: string | null, selected: string | null) => {
    hoveredBay = hovered; selectedBay = selected;
    applyHighlight();
    if (reduced) render(performance.now());
  };

  const setQuantity = (quantity: number) => {
    const next = Math.max(1, Math.min(MAX_ORDER, Math.floor(quantity) || 1));
    if (next === currentQuantity) { rebuildOrder(next); return; }
    const from = currentQuantity; currentQuantity = next;
    const started = performance.now() / 1000;
    const containerChanged = Math.floor(from / 10) !== Math.floor(next / 10);
    if (reduced) {
      rebuildOrder(next); if (containerChanged) spawnPoof(started); render(performance.now()); return;
    }
    pendingSwaps.push({ at: started + ORDER_SWAP_DELAY, to: next });
    if (containerChanged) pendingPoofs.push(started + POOF_DELAY);
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
  let reportedX = Number.NaN; let reportedY = Number.NaN; let reportedStation = Number.NaN;
  const render = (now: number) => {
    const time = now / 1000;
    /* Apply whichever booked swap has come due — the latest one, since an
       earlier swap it overtook would only be replaced a frame later anyway. */
    if (pendingSwaps.length) {
      let due = -1;
      for (let index = 0; index < pendingSwaps.length; index += 1) {
        if (pendingSwaps[index].at <= time) due = index;
      }
      if (due >= 0) {
        rebuildOrder(pendingSwaps[due].to);
        pendingSwaps = pendingSwaps.slice(due + 1);
      }
    }
    if (pendingPoofs.length && pendingPoofs[0] <= time) {
      pendingPoofs.shift();
      spawnPoof(time);
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
    /* Ease toward the pointer in AIM space, not camera space, and hand the
       eased aim to the overlay: it reprojects with the same numbers, so the
       pixel goods sway with the shelves instead of sliding across them. */
    cameraX += (aimX - cameraX) * .07;
    cameraY += (aimY - cameraY) * .07;
    /* The station is a truck, not a turn: eye and look-at move together, so the
       overlay can reproduce it by projecting at the same station. */
    if (station !== stationTarget) {
      const progress = Math.max(0, Math.min(1, (time - stationStart) / PAN_SECONDS));
      const eased = progress < .5 ? 2 * progress * progress : 1 - ((2 - 2 * progress) ** 2) / 2;
      station = progress >= 1 ? stationTarget : stationFrom + (stationTarget - stationFrom) * eased;
    }
    camera.position.x = station + cameraX * CAMERA.swayX;
    camera.position.y = CAMERA.y - cameraY * CAMERA.swayY;
    camera.lookAt(CAMERA.lookAt.x + station, CAMERA.lookAt.y, CAMERA.lookAt.z);
    chamber.rotation.y = cameraX * CAMERA.swayX * CAMERA.yaw;
    itemLight.intensity = 28.5 + (reduced ? 0 : Math.sin(time * .55) * .8);
    renderer.render(scene, camera);
    if (onCamera && (!Number.isFinite(reportedX)
      || Math.abs(cameraX - reportedX) > .002 || Math.abs(cameraY - reportedY) > .002
      || Math.abs(station - reportedStation) > .002)) {
      reportedX = cameraX; reportedY = cameraY; reportedStation = station;
      onCamera({ aimX: cameraX, aimY: cameraY, station });
    }
    if (import.meta.env.DEV) {
      canvas.dataset.marketQuantity = String(currentQuantity);
      canvas.dataset.marketStock = String(currentInventory.find((row) => row.id === currentItem.id)?.stock ?? 0);
      canvas.dataset.marketTransition = pendingSwaps.length ? `pending:${pendingSwaps.length}` : 'settled';
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
    camera.aspect = width / height;
    /* Narrow canvases widen the lens rather than cropping the shelf wall; the
       overlay's projector derives the same number from the same aspect. */
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
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
    setAim,
    setHighlight,
    setMode,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (LIVE.get(canvas) === handle.dispose) LIVE.delete(canvas);
      cancelAnimationFrame(raf); observer.disconnect();
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
