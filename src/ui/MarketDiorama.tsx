import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type {
  MarketDiorama as DioramaHandle, MarketDioramaItem, MarketDioramaStockItem,
} from '../gfx/marketDiorama';
import { cx } from './primitives';
import { Rune } from './icons';

const BAY: Record<string, { x: number; y: number; height: number; label: string }> = {
  scroll: { x: 8, y: 4, height: 19, label: 'Scroll' },
  rune: { x: 39, y: 4, height: 19, label: 'Rune' },
  fire_berry: { x: 8, y: 24, height: 33, label: 'Fire' },
  water_berry: { x: 39, y: 24, height: 33, label: 'Water' },
  air_berry: { x: 8, y: 58, height: 33, label: 'Air' },
  rock_berry: { x: 39, y: 58, height: 33, label: 'Rock' },
};

type PixelFlight = { id: number; art: string; direction: 'in' | 'out'; offset: number };
type StockFlight = { id: number; art: string; direction: 'to-counter' | 'to-shelf'; offset: number; targetX: number; targetY: number };

function packageUnits(stock: number): Array<10 | 100 | 1000> {
  const units: Array<10 | 100 | 1000> = [];
  let remainder = Math.max(0, Math.floor(stock));
  for (let index = 0; index < Math.floor(remainder / 1000); index += 1) units.push(1000);
  remainder %= 1000;
  for (let index = 0; index < Math.floor(remainder / 100); index += 1) units.push(100);
  remainder %= 100;
  for (let index = 0; index < Math.floor(remainder / 10); index += 1) units.push(10);
  return units;
}

function shelfSlot(index: number, total: number) {
  const columns = 5;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const used = Math.min(columns, total - row * columns);
  return {
    left: 50 + (column - (used - 1) / 2) * 13,
    top: 70 - row * 26,
  };
}

export function MarketDiorama({ item, quantity, inventory, gold, selected, onSelect, className }: {
  item: MarketDioramaItem; quantity: number; gold: number;
  inventory: MarketDioramaStockItem[]; selected: string; onSelect: (id: string) => void; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<DioramaHandle | null>(null);
  const latest = useRef(item);
  const latestQuantity = useRef(quantity);
  const latestInventory = useRef(inventory);
  const latestGold = useRef(gold);
  const [visualQuantity, setVisualQuantity] = useState(quantity);
  const [pixelFlights, setPixelFlights] = useState<PixelFlight[]>([]);
  const [stockFlights, setStockFlights] = useState<StockFlight[]>([]);
  const previousQuantity = useRef(quantity);
  const previousInventory = useRef(inventory);
  const flightSequence = useRef(0);
  latest.current = item;
  latestQuantity.current = quantity;
  latestInventory.current = inventory;
  latestGold.current = gold;
  const inventoryKey = inventory.map((row) => `${row.id}:${row.stock}`).join('|');

  useEffect(() => {
    const target = canvas.current;
    if (!target) return undefined;
    let cancelled = false;
    void import('../gfx/marketDiorama').then(({ startMarketDiorama }) =>
      startMarketDiorama(target, latest.current, latestQuantity.current, latestInventory.current, latestGold.current)).then((next) => {
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
  }, []);

  useEffect(() => { handle.current?.setItem(item); }, [item.id, item.art, item.element, item.berry]);
  useEffect(() => { handle.current?.setQuantity(quantity); }, [quantity]);
  useEffect(() => { handle.current?.setInventory(inventory); }, [inventoryKey]);
  useEffect(() => { handle.current?.setGold(gold); }, [gold]);

  useEffect(() => {
    const before = new Map(previousInventory.current.map((row) => [row.id, row.stock]));
    previousInventory.current = inventory;
    const transfers: StockFlight[] = [];
    for (const row of inventory) {
      const previous = before.get(row.id) ?? row.stock;
      const delta = row.stock - previous;
      const bay = BAY[row.id];
      if (!delta || !row.art || !bay) continue;
      const direction: StockFlight['direction'] = delta < 0 ? 'to-counter' : 'to-shelf';
      for (let index = 0; index < Math.min(12, Math.abs(delta)); index += 1) {
        transfers.push({ id: ++flightSequence.current, art: row.art, direction, offset: index, targetX: bay.x + 13, targetY: bay.y + 10 });
      }
    }
    if (!transfers.length) return undefined;
    setStockFlights(transfers);
    const clear = window.setTimeout(() => setStockFlights([]), 980);
    return () => window.clearTimeout(clear);
  }, [inventoryKey]);

  useEffect(() => {
    const before = previousQuantity.current;
    previousQuantity.current = quantity;
    if (!item.berry || !item.art || before === quantity) {
      setVisualQuantity(quantity); setPixelFlights([]); return undefined;
    }
    const direction: PixelFlight['direction'] = quantity > before ? 'in' : 'out';
    const total = Math.min(14, Math.abs(quantity - before));
    const nextFlights = Array.from({ length: total }, (_, index) => ({
      id: ++flightSequence.current,
      art: item.art!,
      direction,
      offset: index,
    }));
    setPixelFlights(nextFlights);
    const settle = window.setTimeout(() => setVisualQuantity(quantity), 560);
    const clear = window.setTimeout(() => setPixelFlights([]), 960);
    return () => { window.clearTimeout(settle); window.clearTimeout(clear); };
  }, [quantity, item.id, item.art, item.berry]);

  const looseOrder = item.berry ? visualQuantity % 10 : 0;
  const orderBaskets = item.berry ? Math.floor(visualQuantity / 10) : 0;

  return (
    <div className={cx('market-diorama', className)}>
      <canvas ref={canvas} className="h-full w-full" aria-hidden="true" />
      <div className="market-pixel-inventory absolute inset-0">
        {inventory.map((row) => {
          const bay = BAY[row.id];
          if (!bay) return null;
          const loose = row.stock % 10;
          const packages = packageUnits(row.stock);
          return (
            <button key={row.id} type="button" aria-pressed={selected === row.id}
                    aria-label={`${row.name}: ${row.stock} of ${row.stockCap} in stock. Realm buys at ${row.bid ?? '--'} and sells at ${row.ask ?? '--'} Gold.`}
                    data-element={row.element} onClick={() => onSelect(row.id)}
                    className={cx('market-pixel-bay', selected === row.id && 'is-selected')}
                    style={{ left: `${bay.x}%`, top: `${bay.y}%`, height: `${bay.height}%` }}>
              <span className="market-pixel-bay-mark">
                {row.art ? <img src={row.art} alt="" /> : <Rune />}
                <i>{row.name || bay.label}</i>
              </span>
              <span className="market-pixel-bay-data">
                <b>{row.stock}/{row.stockCap}</b>
                <small>Buy {row.ask ? `${row.ask}g` : '--'} &middot; Sell {row.bid ? `${row.bid}g` : '--'}</small>
                <small>P2P {row.bestBid ?? '--'} / {row.bestAsk ?? '--'} &middot; held {row.held}</small>
              </span>
              {packages.slice(0, 10).map((amount, index) => {
                const point = shelfSlot(index, Math.min(10, packages.length));
                return (
                  <span key={`pack-${index}`} className={cx('market-container-decal', `is-${amount}`)}
                        style={{ left: `${point.left}%`, top: `${point.top}%` }}>
                    {row.art ? <img src={row.art} alt="" /> : <Rune />}
                    <b>{amount}</b>
                  </span>
                );
              })}
              {row.art && Array.from({ length: loose }, (_, index) => (
                <img key={index} src={row.art} alt="" className="market-pixel-stock-unit"
                     style={{ left: `${43 + (index % 5) * 6}%`, top: `${73 - Math.floor(index / 5) * 13}%` }} />
              ))}
            </button>
          );
        })}
        {item.art && Array.from({ length: looseOrder }, (_, index) => (
          <img key={`order-${index}`} src={item.art} alt="" className="market-pixel-order-unit"
               style={{ left: `${82 + (index % 5) * 2.2}%`, top: `${76 - Math.floor(index / 5) * 2.5}%` }} />
        ))}
        {item.berry && Array.from({ length: Math.min(10, orderBaskets) }, (_, index) => (
          <span key={`order-basket-${index}`} className="market-container-decal market-order-basket-decal"
                style={{ left: `${82 + (index % 3) * 3.6}%`, top: `${76 - Math.floor(index / 3) * 5}%` }}>
            {item.art ? <img src={item.art} alt="" /> : <Rune />}
            <b>10</b>
          </span>
        ))}
        {!item.berry && item.art && <img src={item.art} alt="" className="market-pixel-order-unit" style={{ left: '85%', top: '76%', width: '34px' }} />}
        {pixelFlights.map((flight) => (
          <img key={flight.id} src={flight.art} alt=""
               className={cx('market-pixel-flight', flight.direction === 'in' ? 'is-in' : 'is-out')}
               style={{ left: `${79 + (flight.offset % 5) * 3.2}%`, animationDelay: `${flight.offset * 45}ms` }} />
        ))}
        {stockFlights.map((flight) => (
          <img key={flight.id} src={flight.art} alt=""
               className={cx('market-stock-flight', flight.direction === 'to-counter' ? 'is-to-counter' : 'is-to-shelf')}
               style={{
                 left: flight.direction === 'to-counter' ? `${flight.targetX}%` : `${80 + (flight.offset % 4) * 3}%`,
                 top: flight.direction === 'to-counter' ? `${flight.targetY}%` : '76%',
                 animationDelay: `${flight.offset * 38}ms`,
                 '--stock-target-x': `${flight.targetX}%`,
                 '--stock-target-y': `${flight.targetY}%`,
               } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
