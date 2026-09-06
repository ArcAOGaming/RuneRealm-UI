import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import type {
  MarketDiorama as DioramaHandle, MarketDioramaItem, MarketDioramaStockItem,
} from '../gfx/marketDiorama';
import {
  ALL_BAYS, BAY_Z, COUNTER, EXCHANGE, STATION, bayKey, boardTop, goldPiles,
  looseUnits, makeProjector, orderUnits, spriteClip, stockUnits,
  type MarketMode, type Projector, type ScreenRect, type ShelfBay, type StockUnit,
} from '../gfx/marketShelves';
import { cx } from './primitives';
import { Rune } from './icons';

/**
 * A good in transit between a shelf and the counter, both ends projected from
 * the same geometry the shelves are built from. Goods never appear from off
 * screen or fall out of the bottom: they come off the shelf they were stocked
 * on and go back to it, which is the only journey they actually make.
 */
type Flight = {
  id: number;
  art: string;
  /** Which change spawned it, so one kind replacing itself leaves the other alone. */
  source: 'order' | 'stock';
  direction: 'to-counter' | 'to-shelf';
  offset: number;
  from: { left: number; top: number };
  to: { left: number; top: number };
  size: number;
};

/** Sits goods on the surface their world point names, bottom edge down. */
function surfaceStyle(left: number, top: number, size: number, sink = 1): CSSProperties {
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${size}px`,
    transform: `translate(-50%, ${-100 * sink}%)`,
  };
}

/**
 * One container's goods and its count, each at its own projected point.
 *
 * The cuts are what make a sprite belong to its container: the overlay is drawn
 * over the canvas and can never be occluded by the 3D, so a berry with its
 * bottom third removed at the basket's rim reads as a berry behind the lip, and
 * a slanted top cut reads as the crate's askew lid lying across it.
 */
function UnitGoods({ unit, art, project, size, className }: {
  unit: StockUnit; art: string; project: Projector;
  size: { width: number; height: number }; className?: string;
}) {
  const badge = project.point(unit.badge.x, unit.badge.y, unit.badge.z);
  return (
    <>
      {unit.sprites.map((sprite, index) => {
        const point = project.point(sprite.x, sprite.y, sprite.z);
        if (!point.visible) return null;
        return (
          <img key={index} src={art} alt=""
               className={cx('market-unit-good', className)}
               style={{
                 left: `${point.left}%`,
                 top: `${point.top}%`,
                 width: `${point.unit * sprite.size}px`,
                 clipPath: spriteClip(sprite, project, size.width, size.height),
               }} />
        );
      })}
      {badge.visible && (
        <b className={cx('market-unit-count', className)}
           style={{
             left: `${badge.left}%`,
             top: `${badge.top}%`,
             fontSize: `${Math.max(7, Math.min(20, badge.unit * unit.badge.size))}px`,
           }}>{unit.amount}</b>
      )}
    </>
  );
}

export function MarketDiorama({ item, quantity, inventory, gold, selected, mode, onSelect, className }: {
  item: MarketDioramaItem; quantity: number; gold: number; mode: MarketMode;
  inventory: MarketDioramaStockItem[]; selected: string; onSelect: (id: string) => void; className?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<DioramaHandle | null>(null);
  const latest = useRef(item);
  const latestQuantity = useRef(quantity);
  const latestInventory = useRef(inventory);
  const latestGold = useRef(gold);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  /* The station the scene has trucked to. It changes only while the camera is
     moving between buy and sell, so re-projecting on it costs a handful of
     renders per switch and keeps the pixels welded to the shelves throughout. */
  const [station, setStation] = useState<number>(STATION[mode]);
  const latestMode = useRef(mode);
  latestMode.current = mode;
  const [visualQuantity, setVisualQuantity] = useState(quantity);
  const [flights, setFlights] = useState<Flight[]>([]);
  const previousQuantity = useRef(quantity);
  const previousInventory = useRef(inventory);
  const flightSequence = useRef(0);
  /* Timers are owned by the batch that booked them, not by the effect run that
     happened to be last. Cancelling them on every re-run is what made a second
     stepper click restart the first click's animation instead of letting it
     finish alongside. Only unmount clears them. */
  const timers = useRef<number[]>([]);
  const later = (run: () => void, delay: number) => {
    timers.current.push(window.setTimeout(run, delay));
  };
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); timers.current = []; }, []);
  latest.current = item;
  latestQuantity.current = quantity;
  latestInventory.current = inventory;
  latestGold.current = gold;
  const inventoryKey = inventory.map((row) => `${row.id}:${row.stock}`).join('|');

  /* One projector for the resting camera. The parallax sway is a near-uniform
     translation at the shelf plane, so it rides on the layer as a transform
     instead of re-projecting every sprite on every frame. */
  const project = useMemo(
    () => makeProjector(size.width || 1, size.height || 1, 0, 0, station),
    [size.width, size.height, station],
  );

  const onCamera = useCallback(({ aimX, aimY, station: at }: { aimX: number; aimY: number; station: number }) => {
    setStation((current) => (Math.abs(current - at) > .002 ? at : current));
    const element = layer.current;
    const box = wrapper.current;
    if (!element || !box) return;
    const width = box.clientWidth; const height = box.clientHeight;
    if (!width || !height) return;
    const rest = makeProjector(width, height, 0, 0, at).point(at, .2, BAY_Z.frame);
    const live = makeProjector(width, height, aimX, aimY, at).point(at, .2, BAY_Z.frame);
    element.style.setProperty('--market-sway-x', `${(live.left - rest.left) / 100 * width}px`);
    element.style.setProperty('--market-sway-y', `${(live.top - rest.top) / 100 * height}px`);
  }, []);

  useEffect(() => {
    const box = wrapper.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(() => {
      setSize({ width: box.clientWidth, height: box.clientHeight });
    });
    observer.observe(box);
    setSize({ width: box.clientWidth, height: box.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return undefined;
    let cancelled = false;
    void import('../gfx/marketDiorama').then(({ startMarketDiorama }) =>
      startMarketDiorama(target, latest.current, latestQuantity.current, latestInventory.current,
        latestGold.current, latestMode.current, onCamera)).then((next) => {
        if (!next) return;
        if (cancelled) { next.dispose(); return; }
        handle.current = next;
        next.setQuantity(latestQuantity.current);
        next.setInventory(latestInventory.current);
        next.setGold(latestGold.current);
      });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [onCamera]);

  useEffect(() => { handle.current?.setItem(item); }, [item.id, item.art, item.element]);
  useEffect(() => { handle.current?.setQuantity(quantity); }, [quantity]);
  useEffect(() => { handle.current?.setInventory(inventory); }, [inventoryKey]);
  useEffect(() => { handle.current?.setGold(gold); }, [gold]);
  useEffect(() => { handle.current?.setHighlight(hovered, selected); }, [hovered, selected]);
  useEffect(() => { handle.current?.setMode(mode); }, [mode]);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = wrapper.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    handle.current?.setAim(
      ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 2,
      ((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * 2,
    );
  };
  const onPointerLeave = () => { handle.current?.setAim(0, 0); setHovered(null); };

  /* Goods leaving or arriving fly between the counter and the bay they belong
     to. Both ends are projected, so a flight lands on the board rather than at
     a percentage that happened to look close. */
  const counterPoint = project.point(COUNTER.x, COUNTER.surfaceY + .3, COUNTER.z);

  /* Buying reads the shop's wall, selling reads your own. The other wall's
     goods stay on their shelves — only its cards stand down, so half a price
     card never hangs off the edge of the frame. */
  const activeWall = mode === 'buy' ? 'shop' : 'satchel';

  /** The point on a bay's board that goods leave from and return to. */
  const shelfPoint = (bay: ShelfBay | undefined) => (bay
    ? project.point(bay.x, boardTop(bay) + .3, BAY_Z.board)
    : counterPoint);

  useEffect(() => {
    const before = new Map(previousInventory.current.map((row) => [row.id, [row.stock, row.held] as const]));
    previousInventory.current = inventory;
    if (!size.width) return undefined;
    const transfers: Flight[] = [];
    for (const row of inventory) {
      if (!row.art) continue;
      const [wasStock, wasHeld] = before.get(row.id) ?? [row.stock, row.held];
      /* A settled trade moves goods between the shop's shelf and the player's
         satchel, so animate each wall off its own count. */
      for (const [wall, delta] of [['shop', row.stock - wasStock], ['satchel', row.held - wasHeld]] as const) {
        if (!delta) continue;
        const bay = ALL_BAYS.find((entry) => entry.id === row.id && entry.wall === wall);
        if (!bay) continue;
        const shelf = shelfPoint(bay);
        const toShelf = delta > 0;
        for (let index = 0; index < Math.min(12, Math.abs(delta)); index += 1) {
          transfers.push({
            id: ++flightSequence.current,
            art: row.art,
            source: 'stock',
            direction: toShelf ? 'to-shelf' : 'to-counter',
            offset: index,
            from: toShelf ? counterPoint : shelf,
            to: toShelf ? shelf : counterPoint,
            size: shelf.unit * .26,
          });
        }
      }
    }
    if (!transfers.length) return undefined;
    setFlights((current) => [...current, ...transfers]);
    later(() => setFlights((current) => current.filter((flight) => !transfers.some((row) => row.id === flight.id))), 980);
    return undefined;
  }, [inventoryKey, project, size.width]);

  useEffect(() => {
    const before = previousQuantity.current;
    previousQuantity.current = quantity;
    if (!item.art || before === quantity || !size.width) {
      setVisualQuantity(quantity); return undefined;
    }
    /* Staging an order takes the goods OFF the shelf you are trading against
       and puts them on the counter; taking them off the order walks them back.
       Nothing drops in from above or falls through the floor. */
    const rising = quantity > before;
    const bay = ALL_BAYS.find((entry) => entry.id === item.id && entry.wall === activeWall);
    const shelf = shelfPoint(bay);
    const total = Math.min(14, Math.abs(quantity - before));
    const next: Flight[] = Array.from({ length: total }, (_, index) => ({
      id: ++flightSequence.current,
      art: item.art!,
      source: 'order' as const,
      direction: rising ? 'to-counter' as const : 'to-shelf' as const,
      offset: index,
      from: rising ? shelf : counterPoint,
      to: rising ? counterPoint : shelf,
      size: counterPoint.unit * .26,
    }));
    setFlights((current) => [...current, ...next]);
    later(() => setVisualQuantity(quantity), 560);
    later(() => setFlights((current) => current.filter((flight) => !next.some((row) => row.id === flight.id))), 960);
    return undefined;
  }, [quantity, item.id, item.art, activeWall, project, size.width]);

  /* Every good is packaged the same way: a scroll or a Rune stacks into crates
     exactly as a berry does, so the counter says how many of anything. */
  const order = orderUnits(visualQuantity);
  const ready = size.width > 0 && size.height > 0;

  return (
    <div ref={wrapper} className={cx('market-diorama', className)}
         onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <canvas ref={canvas} className="h-full w-full" aria-hidden="true" />
      <div ref={layer} className="market-pixel-inventory absolute inset-0">
        {ready && ALL_BAYS.map((bay) => {
          const row = inventory.find((entry) => entry.id === bay.id);
          if (!row) return null;
          const rect: ScreenRect = project.bay(bay);
          const key = bayKey(bay);
          const own = bay.wall === 'satchel';
          const offstage = bay.wall !== activeWall;
          const isSelected = selected === row.id && !offstage;
          return (
            <button key={key} type="button" aria-pressed={isSelected}
                    aria-label={own
                      ? `Your ${row.name}: ${row.held} held.`
                      : `${row.name}: ${row.stock} of ${row.stockCap} in stock. Realm buys at ${row.bid ?? '--'} and sells at ${row.ask ?? '--'} Gold.`}
                    data-element={row.element} onClick={() => onSelect(row.id)}
                    onPointerEnter={() => setHovered(key)}
                    onFocus={() => setHovered(key)}
                    onBlur={() => setHovered((current) => (current === key ? null : current))}
                    tabIndex={offstage ? -1 : undefined}
                    className={cx('market-pixel-bay', own && 'is-satchel', offstage && 'is-offstage')}
                    style={{
                      left: `${rect.left}%`, top: `${rect.top}%`,
                      width: `${rect.width}%`, height: `${rect.height}%`,
                      /* The card sizes itself off the shelf it is pinned inside,
                         so a short bay gets a small one and nothing overflows. */
                      '--bay-h': `${rect.height / 100 * size.height}px`,
                    } as CSSProperties}>
              <span className="market-pixel-bay-card">
                <span className="market-pixel-bay-art">
                  {row.art ? <img src={row.art} alt="" /> : <Rune />}
                </span>
                {/* The one number the side being traded needs. Counts are what
                    the shelves themselves show, and the P2P book belongs in the
                    trade ticket. */}
                <span className="market-pixel-bay-lines">
                  <i>{row.name || bay.label}</i>
                  {mode === 'buy'
                    ? <small>Buy <b>{row.ask ? `${row.ask}g` : '--'}</b></small>
                    : <small>Sell <b>{row.bid ? `${row.bid}g` : '--'}</b></small>}
                </span>
              </span>
            </button>
          );
        })}

        {/* Goods, drawn on the container or board their world point names. They
            sit above the shelf plate but pass their clicks through to it, so
            the shelf stays the thing being interacted with. The satchel wall is
            stocked from what the player holds, the shop wall from what it has. */}
        {ready && ALL_BAYS.map((bay) => {
          const row = inventory.find((entry) => entry.id === bay.id);
          if (!row?.art) return null;
          const art = row.art;
          const count = bay.wall === 'satchel' ? row.held : row.stock;
          return (
            <div key={`goods-${bayKey(bay)}`} data-element={row.element}
                 className={cx('market-shelf-goods', bay.wall !== activeWall && 'is-offstage')}>
              {stockUnits(bay, count).map((unit, index) => (
                <UnitGoods key={`unit-${index}`} unit={unit} art={art} project={project} size={size} />
              ))}
              {looseUnits(bay, count).map((loose, index) => {
                const point = project.point(loose.x, loose.y, loose.z);
                if (!point.visible) return null;
                return (
                  <img key={`loose-${index}`} src={art} alt="" className="market-pixel-stock-unit"
                       style={surfaceStyle(point.left, point.top, point.unit * loose.sprite)} />
                );
              })}
            </div>
          );
        })}

        {/* Gold is grouped like stock is, so the bars and stacks say how much
            they are rather than leaving the player to count coins. */}
        {ready && goldPiles(gold).map((pile, index) => {
          if (!pile.badge) return null;
          const point = project.point(pile.badge.x, pile.badge.y, pile.badge.z);
          if (!point.visible) return null;
          return (
            <b key={`gold-${index}`} className="market-unit-count is-gold"
               style={{
                 left: `${point.left}%`,
                 top: `${point.top}%`,
                 fontSize: `${Math.max(7, Math.min(16, point.unit * pile.badge.size))}px`,
               }}>{pile.amount}</b>
          );
        })}

        {/* The exchange: the upper table always holds the Gold and the lower one
            the goods. Which one the player gives and which they get is the only
            thing the side of the trade changes, so the plates swap over. */}
        {ready && (['gold', 'goods'] as const).map((table) => {
          const anchor = EXCHANGE[table];
          const point = project.point(anchor.x, anchor.y, anchor.z);
          if (!point.visible) return null;
          const gives = mode === 'buy' ? 'gold' : 'goods';
          return (
            <span key={`plate-${table}`}
                  className={cx('market-exchange-plate', table === gives ? 'is-give' : 'is-get')}
                  style={{ left: `${point.left}%`, top: `${point.top}%`, '--plate-unit': `${point.unit}px` } as CSSProperties}>
              <i>{table === gives ? 'You give' : 'You get'}</i>
              <b>{table === 'gold' ? 'Gold' : 'Items'}</b>
            </span>
          );
        })}

        {/* The player's own order, standing on the counter. Keyed by item so a
            change of good remounts the sprites and they fade back in under the
            scene's puff, instead of the art cutting over in place. */}
        <div key={`order-${item.id}`} className="market-order-swap">
        {ready && item.art && order.units.map((unit, index) => (
          <UnitGoods key={`order-unit-${index}`} unit={unit} art={item.art!} project={project}
                     size={size} className="is-order" />
        ))}
        {ready && item.art && order.loose.map((loose, index) => {
          const point = project.point(loose.x, loose.y, loose.z);
          return (
            <img key={`order-loose-${index}`} src={item.art} alt="" className="market-pixel-order-unit"
                 style={surfaceStyle(point.left, point.top, point.unit * loose.sprite)} />
          );
        })}
        </div>

        {flights.map((flight) => (
          <img key={flight.id} src={flight.art} alt=""
               data-flight={import.meta.env.DEV ? `${flight.source}:${flight.id}` : undefined}
               className={cx('market-pixel-flight', `is-${flight.direction}`)}
               style={{
                 left: `${flight.to.left}%`,
                 top: `${flight.to.top}%`,
                 width: `${flight.size}px`,
                 animationDelay: `${flight.offset * 42}ms`,
                 '--fly-x': `${(flight.from.left - flight.to.left) / 100 * size.width}px`,
                 '--fly-y': `${(flight.from.top - flight.to.top) / 100 * size.height}px`,
                 '--fly-spread': `${((flight.offset + flight.id) % 5 - 2) * 9}px`,
               } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
