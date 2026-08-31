import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGame } from '../state/GameProvider';
import * as game from '../lib/game';
import {
  QUOTE_PROCESS, RUNE_PROCESS,
  AmmDeposit, AmmPool, AmmSwap, TokenInfo, addLiquidity, claimQuoteFaucet,
  depositRuneToGame, depositToken, exchangeConfigured, formatUnits, parseUnits,
  quoteFromPool, readDeposit, readPool, readSwaps, readTokenBalance, readTokenInfo,
  refundDeposit, removeLiquidity, swap,
} from '../lib/marketplace';
import { EconomyView, Element, GoldMarketItemId, GoldOrderSide, Listing, Monster, Sale } from '../lib/types';
import { ELEMENT_LABEL, ITEM_NAME, shortAddress } from '../lib/format';
import { Badge, Button, Empty, ErrorNote, Panel, Skeleton, cx } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { CardPreview } from '../ui/CardPreview';
import { useToast } from '../ui/Toast';
import { Arrow, ELEMENT_ICON, Exchange, Refresh, Rune, Sparkle, Wallet } from '../ui/icons';
import { MarketForge, MarketForgeMode } from '../ui/MarketForge';
import { economyPreview } from '../lib/economy-preview';

type MarketTab = 'goods' | 'rune' | 'monsters';
type MonsterSort = 'recent' | 'price-low' | 'price-high' | 'level' | 'attack';
type RuneDesk = 'trade' | 'bridge' | 'pool';

const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const EMPTY_DEPOSIT = (address = ''): AmmDeposit => ({ address, base: '0', quote: '0', shares: '0' });
const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-void/35 px-3 ' +
  'font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-element/60';

export default function Marketplace() {
  const [tab, setTab] = useState<MarketTab>('goods');

  return (
    <div className="market-screen animate-rise space-y-4">
      <nav aria-label="Market sections" role="tablist"
           className="market-tabs grid grid-cols-3 gap-1 rounded-[4px] border border-edge bg-surface/75 p-1">
        <MarketTabButton active={tab === 'goods'} onClick={() => setTab('goods')}
                         icon={<Exchange className="h-4 w-4" />}>
          Goods
        </MarketTabButton>
        <MarketTabButton active={tab === 'rune'} onClick={() => setTab('rune')}
                         icon={<Rune className="h-4 w-4" />}>
          Rune
        </MarketTabButton>
        <MarketTabButton active={tab === 'monsters'} onClick={() => setTab('monsters')}
                         icon={<Sparkle className="h-4 w-4" />}>
          Monsters
        </MarketTabButton>
      </nav>

      <div role="tabpanel" className="market-tabpanel">
        {tab === 'goods' ? <GoodsMarket /> : tab === 'rune' ? <RuneExchange /> : <MonsterMarket />}
      </div>
    </div>
  );
}

// Gold goods market ---------------------------------------------------------

const GOLD_ITEMS: GoldMarketItemId[] = [
  'air_berry', 'water_berry', 'fire_berry', 'rock_berry',
  'scroll', 'legendary_scroll', 'rune',
];

function GoodsMarket() {
  const { address, player, connect, connecting, run, isPending, refresh } = useGame();
  const [economy, setEconomy] = useState<EconomyView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [item, setItem] = useState<GoldMarketItemId>('fire_berry');
  const [side, setSide] = useState<GoldOrderSide>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [shopQuantity, setShopQuantity] = useState('1');

  const load = useCallback(async () => {
    setError(null);
    try {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('economy-preview')) {
        setEconomy(economyPreview()); return;
      }
      setEconomy(await game.readEconomy());
    }
    catch (caught) { setError(caught); setEconomy(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submitOrder = async () => {
    const unit = Math.floor(Number(price));
    const count = Math.floor(Number(quantity));
    if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(count) || count <= 0) {
      setError(new Error('Price and quantity must be positive whole numbers.'));
      return;
    }
    const result = await run('gold-order', () => game.placeGoldOrder(side, item, unit, count),
      `${side === 'buy' ? 'Bid' : 'Ask'} entered for ${formatInteger(count)} ${ITEM_NAME[item]}.`);
    if (result) { setPrice(''); await Promise.all([load(), refresh()]); }
  };

  const shopTrade = async (tradeSide: GoldOrderSide) => {
    const count = Math.floor(Number(shopQuantity));
    if (!Number.isSafeInteger(count) || count <= 0) {
      setError(new Error('Quantity must be a positive whole number.'));
      return;
    }
    const result = await run(`npc-${tradeSide}`, () => game.tradeGameShop(tradeSide, item, count),
      `${tradeSide === 'buy' ? 'Bought from' : 'Sold to'} the Realm Exchange.`);
    if (result) await Promise.all([load(), refresh()]);
  };

  const cancel = async (orderId: string) => {
    const result = await run(`gold-cancel-${orderId}`, () => game.cancelGoldOrder(orderId),
      'Order cancelled and remaining escrow returned.');
    if (result) await Promise.all([load(), refresh()]);
  };

  if (!economy && !error) return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>;
  if (!economy) return <ErrorNote error={error} onRetry={() => void load()} />;
  const book = economy.market[item];
  const desk = economy.desks[item];
  const ownOrders = economy.orders.filter((order) => order.account === address);
  const held = player?.inventory?.[item] ?? 0;

  return (
    <div className="space-y-4">
      {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}
      <Panel className="p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_auto] md:items-end">
          <label><span className="eyebrow mb-1.5 block">Asset</span>
            <select className={inputClass} value={item}
                    onChange={(event) => setItem(event.target.value as GoldMarketItemId)}>
              {GOLD_ITEMS.map((id) => <option key={id} value={id}>{ITEM_NAME[id]}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[3px] border border-rune/10 bg-rune/10 p-px sm:grid-cols-3">
            <MarketMetric label="Your Gold" value={formatInteger(player?.gold ?? 0)} detail="internal only" />
            <MarketMetric label="You hold" value={formatInteger(held)} detail={ITEM_NAME[item]} />
            <MarketMetric label="Accounting" value={economy.invariants.ok ? 'Exact' : 'Paused'} detail={economy.mode} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-rune/10 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="eyebrow">Player-to-player</div><h2 className="mt-1 text-xl font-semibold">Gold order book</h2></div>
              <Badge tone="plain">2% seller fee · 1 Gold order cost</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">Limit orders settle atomically against player escrow. The game does not set these prices.</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-rune/10 p-px">
            <MarketMetric label="Best bid" value={book?.bestBid ? formatInteger(book.bestBid) : '--'} detail="Gold each" />
            <MarketMetric label="Best ask" value={book?.bestAsk ? formatInteger(book.bestAsk) : '--'} detail="Gold each" />
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-2">
              <Button variant={side === 'buy' ? 'primary' : 'quiet'} onClick={() => setSide('buy')}>Place bid</Button>
              <Button variant={side === 'sell' ? 'primary' : 'quiet'} onClick={() => setSide('sell')}>Place ask</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="eyebrow mb-1.5 block">Unit price / Gold</span><input className={inputClass} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
              <label><span className="eyebrow mb-1.5 block">Quantity</span><input className={inputClass} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            </div>
            {!address ? <Button className="w-full" variant="primary" busy={connecting} onClick={connect}>Connect to trade</Button>
              : <Button className="w-full" variant="primary" busy={isPending('gold-order')} onClick={() => void submitOrder()}>Place {side === 'buy' ? 'bid' : 'ask'}</Button>}
          </div>
          <div className="border-t border-rune/10">
            <div className="grid grid-cols-2 gap-px bg-rune/10 p-px">
              <DepthList label="Bids" rows={book?.depth.bids ?? []} />
              <DepthList label="Asks" rows={book?.depth.asks ?? []} />
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-rune/10 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="eyebrow">Finite NPC counterparty</div><h2 className="mt-1 text-xl font-semibold">Realm Exchange</h2></div>
              <Badge tone="warn">NPC · not a price guarantee</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">Inventory comes only from players. Gold comes only from this desk's named reserve. Either side pauses independently when a rail is reached.</p>
          </div>
          {desk ? <>
            <div className="grid grid-cols-2 gap-px bg-rune/10 p-px sm:grid-cols-4">
              <MarketMetric label="NPC buys at" value={desk.bid ? formatInteger(desk.bid) : '--'} detail={desk.pause.sell ?? 'Gold each'} />
              <MarketMetric label="NPC sells at" value={desk.ask ? formatInteger(desk.ask) : '--'} detail={desk.pause.buy ?? 'Gold each'} />
              <MarketMetric label="Stock" value={`${formatInteger(desk.stock)} / ${formatInteger(desk.stockCap)}`} detail={`band ${desk.band ?? '--'}`} />
              <MarketMetric label="Gold reserve" value={formatInteger(desk.goldReserve)} detail={`~${formatInteger(desk.projectedExhaustion)} units`} />
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              <label><span className="eyebrow mb-1.5 block">Quantity</span><input className={inputClass} inputMode="numeric" value={shopQuantity} onChange={(event) => setShopQuantity(event.target.value)} /></label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button busy={isPending('npc-sell')} disabled={Boolean(desk.pause.sell) || held < Number(shopQuantity || 0)} onClick={() => void shopTrade('sell')}>Sell to NPC</Button>
                <Button variant="primary" busy={isPending('npc-buy')} disabled={Boolean(desk.pause.buy)} onClick={() => void shopTrade('buy')}>Buy from NPC</Button>
              </div>
              {(desk.pause.sell || desk.pause.buy) && <div className="space-y-1 border-t border-rune/10 pt-3 text-xs text-faint">
                {desk.pause.sell && <p><b className="text-warn">NPC buy paused:</b> {desk.pause.sell}</p>}
                {desk.pause.buy && <p><b className="text-warn">NPC sell paused:</b> {desk.pause.buy}</p>}
              </div>}
            </div>
          </> : <Empty title="No NPC desk">{ITEM_NAME[item]} is P2P-only. Legendary Scroll intentionally has no NPC quote.</Empty>}
        </Panel>
      </div>

      {ownOrders.length > 0 && <Panel className="overflow-hidden">
        <div className="border-b border-rune/10 px-4 py-3"><div className="eyebrow">Your open Gold orders</div></div>
        <div className="divide-y divide-rune/10">{ownOrders.map((order) => <div key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3">
          <span className="text-sm"><b>{order.side === 'buy' ? 'Bid' : 'Ask'}</b> · {ITEM_NAME[order.item]}</span>
          <span className="font-mono text-[11px]">{order.remaining}/{order.quantity} @ {formatInteger(order.price)} Gold</span>
          <Button size="sm" variant="quiet" busy={isPending(`gold-cancel-${order.id}`)} onClick={() => void cancel(order.id)}>Cancel</Button>
        </div>)}</div>
      </Panel>}
    </div>
  );
}

function DepthList({ label, rows }: { label: string; rows: Array<{ price: number; quantity: number }> }) {
  return <div className="bg-surface p-3"><div className="eyebrow mb-2">{label}</div>{rows.length
    ? <div className="space-y-1">{rows.slice(0, 5).map((row, index) => <div key={`${row.price}-${index}`} className="flex justify-between gap-3 font-mono text-xs"><span>{formatInteger(row.price)}</span><span className="text-faint">× {formatInteger(row.quantity)}</span></div>)}</div>
    : <p className="text-xs text-faint">No depth</p>}</div>;
}

function MarketTabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
            className={cx(
              'market-tab flex min-h-12 items-center justify-center gap-2 rounded-[3px] px-3 transition-colors',
              active ? 'bg-element text-void' : 'text-muted hover:bg-raised hover:text-ink',
            )}>
      <span className={cx('shrink-0', active ? 'text-void' : 'text-element')}>{icon}</span>
      <span className="text-sm font-semibold">{children}</span>
    </button>
  );
}

// Monster market ------------------------------------------------------------

function MonsterMarket() {
  const { address, player, connect, connecting, run, isPending } = useGame();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [stats, setStats] = useState<{ listings: number; sales: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [element, setElement] = useState<Element | 'all'>('all');
  const [sort, setSort] = useState<MonsterSort>('recent');
  const [listingOpen, setListingOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [selected, setSelected] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [market, sales, marketStats] = await Promise.all([
        game.readMarket(), game.readMarketHistory().catch(() => []), game.readMarketStats().catch(() => null),
      ]);
      const rows = Object.values(market ?? {});
      setListings(rows);
      setHistory(sales ?? []);
      setStats(marketStats ?? { listings: rows.length, sales: sales?.length ?? 0 });
    } catch (caught) {
      setError(caught);
      setListings([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const owned = useMemo(() => Object.values(player?.collection ?? {}), [player?.collection]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (listings ?? []).filter((listing) => {
      const monster = listing.monster;
      if (element !== 'all' && monster.elementType !== element) return false;
      return !needle || [monster.name, monster.faction, listing.seller]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
    }).sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'level') return b.monster.level - a.monster.level || b.listedAt - a.listedAt;
      if (sort === 'attack') return b.monster.attack - a.monster.attack || b.monster.level - a.monster.level;
      return b.listedAt - a.listedAt;
    });
  }, [element, listings, query, sort]);

  const floor = listings?.length ? Math.min(...listings.map((listing) => listing.price)) : 0;
  const totalVolume = history.reduce((sum, sale) => sum + sale.price, 0);
  const average = history.length ? Math.round(totalVolume / history.length) : 0;
  const saleSeries = [...history].reverse().map((sale) => sale.price);

  const cancel = async (listing: Listing) => {
    const result = await run(`cancel-${listing.id}`, () => game.cancelListing(listing.id),
      `${listing.monster.name} returned to your collection.`);
    if (result) { setSelected(null); await load(); }
  };

  const buy = async (listing: Listing) => {
    const result = await run(`buy-${listing.id}`, () => game.buyListing(listing.id),
      `${listing.monster.name} joined your collection.`);
    if (result) { setSelected(null); await load(); }
  };

  return (
    <div className="market-monsters space-y-4">
      <Panel className="p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(13rem,1fr)_auto_auto] lg:items-center">
          <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)}
                 aria-label="Search monster listings" placeholder="Search monster, faction, or trainer" />
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={element === 'all'} onClick={() => setElement('all')}>All</FilterChip>
            {ELEMENTS.map((value) => (
              <FilterChip key={value} element={value} active={element === value}
                          onClick={() => setElement(value)}>{ELEMENT_LABEL[value]}</FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select className={cx(inputClass, 'min-w-0 flex-1 lg:w-44')} value={sort}
                    onChange={(event) => setSort(event.target.value as MonsterSort)} aria-label="Sort monster listings">
              <option value="recent">Recently listed</option>
              <option value="price-low">Lowest price</option>
              <option value="price-high">Highest price</option>
              <option value="level">Highest level</option>
              <option value="attack">Highest attack</option>
            </select>
            <Button size="sm" title="Refresh market" onClick={() => void load()}
                    icon={<Refresh className="h-4 w-4" />}>Refresh</Button>
            <Button size="sm" variant="quiet" onClick={() => setStatsOpen(true)}>Stats</Button>
            <Button size="sm" variant="primary" busy={!address && connecting}
                    disabled={Boolean(address) && !owned.length}
                    onClick={() => address ? setListingOpen(true) : connect()}>
              {address ? `Sell (${owned.length})` : 'Connect to sell'}
            </Button>
          </div>
        </div>
      </Panel>

      <div className="market-monsters-scroll space-y-4">
        {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}
        {listings === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-[470px]" />)}
          </div>
        ) : shown.length === 0 ? (
          <Panel>
            <Empty icon={<Sparkle />} title={listings.length ? 'No matching monsters' : 'No monsters listed'}
                   action={address && owned.length ? <Button variant="primary" onClick={() => setListingOpen(true)}>List yours</Button> : undefined}>
              {listings.length ? 'Change the filters.' : 'List a monster from your collection.'}
            </Empty>
          </Panel>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((listing) => (
              <MonsterListingCard key={listing.id} listing={listing} address={address}
                                  busy={isPending(`buy-${listing.id}`) || isPending(`cancel-${listing.id}`)}
                                  onInspect={() => setSelected(listing)}
                                  onTrade={() => listing.seller === address ? void cancel(listing) : setSelected(listing)} />
            ))}
          </div>
        )}

      </div>

      {statsOpen && (
        <Dialog title="Monster market stats" onClose={() => setStatsOpen(false)}>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rune/10 bg-rune/10 p-px sm:grid-cols-4">
            <MonsterStat label="Listings" value={formatInteger(stats?.listings ?? listings?.length ?? 0)} title="Live listings in contract escrow" />
            <MonsterStat label="Floor" value={floor ? `${formatInteger(floor)} Rune` : '--'} title="Lowest current ask" />
            <MonsterStat label="Volume" value={`${formatInteger(totalVolume)} Rune`} title={`${stats?.sales ?? history.length} completed trades`} />
            <MonsterStat label="Average" value={average ? `${formatInteger(average)} Rune` : '--'} title="Average recorded sale" />
          </div>
          <LineChart values={saleSeries} empty="No completed sales." suffix=" Rune" className="mt-4 h-52" />
          {history.length > 0 && (
            <div className="mt-4 max-h-52 divide-y divide-rune/10 overflow-y-auto rounded-[3px] border border-rune/10">
              {history.slice(0, 12).map((sale) => <SaleRow key={`${sale.id}-${sale.soldAt}`} sale={sale} />)}
            </div>
          )}
        </Dialog>
      )}

      {listingOpen && (
        <ListMonsterDialog monsters={owned} busy={isPending('market-list')} onClose={() => setListingOpen(false)}
          onSubmit={async (monsterId, price) => {
            const monster = owned.find((candidate) => candidate.id === monsterId);
            const result = await run('market-list', () => game.listMonster(monsterId, price),
              `${monster?.name ?? 'Monster'} listed for ${formatInteger(price)} Rune.`);
            if (result) { setListingOpen(false); await load(); }
          }} />
      )}

      {selected && (
        <MonsterTradeDialog listing={selected} address={address} runeBalance={player?.inventory?.rune ?? 0}
          busy={isPending(`buy-${selected.id}`) || isPending(`cancel-${selected.id}`)}
          onClose={() => setSelected(null)} onBuy={() => void buy(selected)}
          onCancel={() => void cancel(selected)} onConnect={connect} connecting={connecting} />
      )}
    </div>
  );
}

function MonsterListingCard({ listing, address, busy, onInspect, onTrade }: {
  listing: Listing; address: string | null; busy: boolean; onInspect: () => void; onTrade: () => void;
}) {
  const monster = listing.monster;
  const Icon = ELEMENT_ICON[monster.elementType];
  const mine = listing.seller === address;
  return (
    <Panel data-element={monster.elementType} className="market-monster-card group overflow-hidden">
      <button type="button" onClick={onInspect} className="relative block w-full overflow-hidden bg-void/45 text-left">
        <CardPreview monster={monster} className="mx-auto w-full max-w-[19rem] transition-transform duration-500 group-hover:scale-[1.018]" />
        <span className="absolute left-3 top-3 flex gap-1.5">
          <Badge tone="element"><Icon className="h-3 w-3" />{ELEMENT_LABEL[monster.elementType]}</Badge>
          <Badge tone="plain">Lvl {monster.level}</Badge>
        </span>
        <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-void to-transparent" />
      </button>
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="truncate text-lg font-semibold">{monster.name}</h3><p className="mt-0.5 truncate text-xs text-faint">{monster.faction}</p></div>
          <div className="shrink-0 text-right"><div className="font-mono text-lg text-rune">{formatInteger(listing.price)}</div><div className="eyebrow">Rune</div></div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden border-y border-rune/10 bg-rune/10 py-px text-center">
          <StatCell label="ATK" value={monster.attack} /><StatCell label="DEF" value={monster.defense} />
          <StatCell label="SPD" value={monster.speed} /><StatCell label="HP" value={monster.health} />
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Trainer</div><code className="text-[11px] text-faint">{shortAddress(listing.seller, 6)}</code>
            <div className="mt-0.5 text-[10px] text-faint">Listed {relativeTime(listing.listedAt)}</div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="quiet" onClick={onInspect}>Details</Button>
            <Button size="sm" variant={mine ? 'ghost' : 'primary'} busy={busy} onClick={onTrade}>{mine ? 'Cancel' : 'Buy'}</Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return <div className="bg-surface px-1 py-2.5"><div className="font-mono text-sm">{value}</div><div className="mt-0.5 text-[8px] uppercase tracking-[0.16em] text-faint">{label}</div></div>;
}

function SaleRow({ sale }: { sale: Sale }) {
  const Icon = ELEMENT_ICON[sale.element];
  return (
    <div data-element={sale.element} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-element/35 bg-element/10 text-element"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0"><b className="block truncate text-sm">{sale.name}</b><span className="text-[11px] text-faint">Level {sale.level} / {relativeTime(sale.soldAt)}</span></span>
      </div>
      <div className="hidden items-center gap-2 font-mono text-[11px] text-faint sm:flex">
        {shortAddress(sale.seller, 4)} <Arrow className="h-3 w-3" /> {shortAddress(sale.buyer, 4)}
      </div>
      <div className="text-right font-mono text-sm text-rune">{formatInteger(sale.price)} Rune</div>
    </div>
  );
}

function ListMonsterDialog({ monsters, busy, onClose, onSubmit }: {
  monsters: Monster[]; busy: boolean; onClose: () => void; onSubmit: (monsterId: string, price: number) => Promise<void>;
}) {
  const [monsterId, setMonsterId] = useState(monsters[0]?.id ?? '');
  const [price, setPrice] = useState('');
  const [validation, setValidation] = useState('');
  const selected = monsters.find((monster) => monster.id === monsterId);
  const submit = () => {
    const amount = Number(price);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      setValidation('Enter a whole Rune price between 1 and 1,000,000.');
      return;
    }
    setValidation('');
    void onSubmit(monsterId, amount);
  };
  return (
    <Dialog title="List a collection monster" onClose={onClose} busy={busy} element={selected?.elementType}>
      {selected && <CardPreview monster={selected} eager className="mx-auto mt-4 w-36" />}
      <div className="mt-4 space-y-3">
        <label className="block"><span className="eyebrow mb-1.5 block">Monster</span>
          <select className={inputClass} value={monsterId} onChange={(event) => setMonsterId(event.target.value)}>
            {monsters.map((monster) => <option key={monster.id} value={monster.id}>{monster.name} / level {monster.level}</option>)}
          </select>
        </label>
        <label className="block"><span className="eyebrow mb-1.5 block">Price in Rune</span>
          <input className={inputClass} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="250" />
        </label>
        {validation && <p className="text-xs text-bad">{validation}</p>}
        <div className="flex justify-end gap-2 pt-1"><Button onClick={onClose} disabled={busy}>Keep it</Button><Button variant="primary" busy={busy} disabled={!monsterId} onClick={submit}>List monster</Button></div>
      </div>
    </Dialog>
  );
}

function MonsterTradeDialog({ listing, address, runeBalance, busy, connecting, onClose, onBuy, onCancel, onConnect }: {
  listing: Listing; address: string | null; runeBalance: number; busy: boolean; connecting: boolean;
  onClose: () => void; onBuy: () => void; onCancel: () => void; onConnect: () => void;
}) {
  const monster = listing.monster;
  const mine = address === listing.seller;
  const affordable = runeBalance >= listing.price;
  return (
    <Dialog title={monster.name} onClose={onClose} busy={busy} element={monster.elementType} className="max-w-2xl">
      <div className="mt-4 grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <CardPreview monster={monster} eager className="mx-auto w-48 sm:w-full" />
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge tone="element">{ELEMENT_LABEL[monster.elementType]}</Badge><Badge tone="plain">Level {monster.level}</Badge></div>
          <p className="mt-3 text-sm text-muted">{monster.faction}</p>
          <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden bg-rune/10 p-px text-center">
            <StatCell label="ATK" value={monster.attack} /><StatCell label="DEF" value={monster.defense} />
            <StatCell label="SPD" value={monster.speed} /><StatCell label="HP" value={monster.health} />
          </div>
          <div className="mt-4 rounded-[3px] border border-rune/15 bg-void/35 p-4">
            <div className="flex items-end justify-between"><span className="text-xs text-faint">Asking price</span><span className="font-mono text-2xl text-rune">{formatInteger(listing.price)} Rune</span></div>
            {address && !mine && <div className="mt-2 flex justify-between text-xs text-faint"><span>Your game balance</span><span className={cx('font-mono', affordable ? 'text-good' : 'text-bad')}>{formatInteger(runeBalance)} Rune</span></div>}
          </div>
          {!address ? (
            <Button className="mt-4 w-full" variant="primary" busy={connecting} onClick={onConnect}>Connect to buy</Button>
          ) : mine ? (
            <Button className="mt-4 w-full" busy={busy} onClick={onCancel}>Cancel listing</Button>
          ) : (
            <Button className="mt-4 w-full" variant="primary" busy={busy} disabled={!affordable} onClick={onBuy}>
              {affordable ? `Buy ${monster.name}` : `Need ${formatInteger(listing.price - runeBalance)} more Rune`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// Rune exchange -------------------------------------------------------------

function RuneExchange() {
  const { address, player, connect, connecting, run: runGame, isPending, refresh: refreshGame } = useGame();
  const toast = useToast();
  const [desk, setDesk] = useState<RuneDesk>('trade');
  const [statsOpen, setStatsOpen] = useState(false);
  const [pool, setPool] = useState<AmmPool | null>(null);
  const [deposit, setDeposit] = useState<AmmDeposit>(() => EMPTY_DEPOSIT());
  const [quoteInfo, setQuoteInfo] = useState<TokenInfo | null>(null);
  const [balances, setBalances] = useState({ base: '0', quote: '0' });
  const [swaps, setSwaps] = useState<AmmSwap[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  const [baseIn, setBaseIn] = useState(true);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [lpBase, setLpBase] = useState('');
  const [lpQuote, setLpQuote] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    if (!exchangeConfigured()) return;
    try {
      const [nextPool, nextDeposit, relicInfo, runeBalance, relicBalance, recent] = await Promise.all([
        readPool(), address ? readDeposit(address) : null,
        readTokenInfo(QUOTE_PROCESS),
        address ? readTokenBalance(RUNE_PROCESS, address) : '0',
        address ? readTokenBalance(QUOTE_PROCESS, address) : '0',
        readSwaps().catch(() => []),
      ]);
      setPool(nextPool);
      setDeposit(nextDeposit ?? EMPTY_DEPOSIT(address ?? ''));
      setQuoteInfo(relicInfo);
      setBalances({ base: runeBalance, quote: relicBalance });
      setSwaps(recent ?? []);
    } catch (caught) { setError(caught); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null);
    try { await action(); toast.success(success); await refresh(); }
    catch (caught) { setError(caught); toast.error(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(''); }
  };

  if (!exchangeConfigured()) {
    return <Panel><Empty icon={<Exchange />} title="The Rune desk needs its three process ids">Configure Rune, TEST-RELIC, and the AMM process before enabling bridge or pool actions.</Empty></Panel>;
  }
  if (!pool && !error) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div>;
  if (!pool) return <ErrorNote error={error} onRetry={() => void refresh()} />;

  const inputToken = baseIn ? pool.baseToken : pool.quoteToken;
  const inputDenom = baseIn ? pool.baseDenomination : pool.quoteDenomination;
  const outputDenom = baseIn ? pool.quoteDenomination : pool.baseDenomination;
  const inputTicker = baseIn ? pool.baseTicker : pool.quoteTicker;
  const outputTicker = baseIn ? pool.quoteTicker : pool.baseTicker;
  const inputBalance = baseIn ? balances.base : balances.quote;
  const credited = baseIn ? deposit.base : deposit.quote;
  const parsed = tryParseUnits(amount, inputDenom);
  const quoted = parsed.value ? quoteFromPool(pool, inputToken, parsed.value) : '0';
  const slip = Math.max(0, Math.min(50, Number(slippage) || 0));
  const minimum = (BigInt(quoted) * BigInt(Math.floor((100 - slip) * 100)) / 10_000n).toString();
  const pairLive = pool.configured && BigInt(pool.reserveBase) > 0n && BigInt(pool.reserveQuote) > 0n;
  const gameRune = player?.inventory?.rune ?? 0;
  const priceSeries = swapPrices(swaps, pool);
  const forgeMode: MarketForgeMode = desk === 'trade' ? 'trade' : desk === 'bridge' ? 'bridge' : 'pool';
  const bridgeParsed = tryParseUnits(bridgeAmount, pool.baseDenomination);

  const needWallet = (action: () => void) => { if (!address) connect(); else action(); };
  const doWithdraw = async () => {
    const value = Number(bridgeAmount);
    if (!Number.isSafeInteger(value) || value <= 0) { setError(new Error('Enter a positive whole Rune amount.')); return; }
    const result = await runGame('rune-withdraw', () => game.withdrawRune(value), `${formatInteger(value)} Rune is moving to your wallet.`);
    if (result) { setBridgeAmount(''); window.setTimeout(() => void refresh(), 1200); }
  };
  const doGameDeposit = () => {
    if (!bridgeParsed.value) { setError(new Error(bridgeParsed.error || 'Enter a positive Rune amount.')); return; }
    void run('game-deposit', async () => {
      await depositRuneToGame(bridgeParsed.value!);
      window.setTimeout(() => void refreshGame(), 1200);
    }, `${bridgeAmount} Rune burned into your game balance.`).then(() => setBridgeAmount(''));
  };

  return (
    <div className="market-rune space-y-3">
      {error !== null && <ErrorNote error={error} onRetry={() => void refresh()} />}

      <div className="market-rune-workspace grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(25rem,1fr)]">
        <div className="market-rune-actions min-h-0">
          <Panel className="market-rune-action-panel h-full overflow-hidden">
            <div className="grid grid-cols-4 gap-px border-b border-rune/10 bg-rune/10 p-px">
              <DeskButton active={desk === 'trade'} onClick={() => setDesk('trade')} label="Trade" />
              <DeskButton active={desk === 'bridge'} onClick={() => setDesk('bridge')} label="Move Rune" />
              <DeskButton active={desk === 'pool'} onClick={() => setDesk('pool')} label="Pair" />
              <DeskButton active={false} onClick={() => setStatsOpen(true)} label="Stats" />
            </div>

            <div className="market-rune-action-content p-4 sm:p-5">
              {desk === 'trade' && (
                <div>
                  <DeskHeading title={`${pool.baseTicker} / ${pool.quoteTicker}`}
                    right={<Badge tone={pairLive ? 'good' : 'warn'}>{pairLive ? 'Ready' : 'Unfunded'}</Badge>} />
                  <div className="market-trade-form space-y-3">
                    <TokenInput label="You send" ticker={inputTicker} value={amount} onChange={setAmount}
                                balance={formatToken(inputBalance, inputDenom)}
                                onMax={() => setAmount(formatUnits(inputBalance, inputDenom, inputDenom))} />
                    <button type="button" aria-label="Reverse trading pair" onClick={() => { setBaseIn((value) => !value); setAmount(''); }}
                            className="market-swap-direction mx-auto grid h-10 w-10 place-items-center rounded-[3px] border border-edge bg-raised text-element transition-transform hover:rotate-180 hover:border-element/60">
                      <Exchange className="h-4 w-4" />
                    </button>
                    <TokenOutput ticker={outputTicker} amount={formatToken(quoted, outputDenom)}
                                 caption={parsed.error || (pairLive ? 'Live pool estimate' : 'Seed the pool before trading')} />
                    <div className="market-price-protection flex items-center justify-between gap-3 rounded-[3px] border border-edge/60 bg-void/25 p-3 text-xs text-faint">
                      <span>Price protection</span>
                      <label className="flex items-center gap-2">Slippage
                        <input className="h-8 w-16 rounded-[3px] border border-edge bg-surface px-2 font-mono text-ink"
                               inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} />%
                      </label>
                    </div>
                    {!address ? (
                      <Button className="w-full" variant="primary" busy={connecting} onClick={connect} icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button busy={busy === 'swap-deposit'} disabled={!parsed.value || BigInt(parsed.value) > BigInt(inputBalance)}
                          onClick={() => parsed.value && void run('swap-deposit', () => depositToken(inputToken, parsed.value!), `${inputTicker} sent to your credited pool balance.`)}>
                          1 / Deposit {inputTicker}
                        </Button>
                        <Button variant="primary" busy={busy === 'swap'} disabled={!parsed.value || BigInt(credited) < BigInt(parsed.value) || !pairLive || pool.paused}
                          onClick={() => parsed.value && void run('swap', () => swap(inputToken, parsed.value!, minimum, Date.now() + 10 * 60_000), `Trade submitted for about ${formatToken(quoted, outputDenom)} ${outputTicker}.`)}>
                          2 / Execute trade
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {desk === 'bridge' && (
                <div>
                  <DeskHeading title="Move Rune" right={<Badge tone="plain">Whole Rune only</Badge>} />
                  <TokenInput label="Amount to move" ticker="Rune" value={bridgeAmount} onChange={setBridgeAmount} />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <BridgeCard title="Withdraw to wallet" from={`${formatInteger(gameRune)} game Rune`} to={`${formatToken(balances.base, pool.baseDenomination)} wallet ${pool.baseTicker}`}>
                      <Button className="mt-4 w-full" variant="primary" busy={isPending('rune-withdraw')}
                              disabled={!address || !bridgeAmount || Number(bridgeAmount) > gameRune} onClick={() => needWallet(() => void doWithdraw())}>Game to wallet</Button>
                    </BridgeCard>
                    <BridgeCard title="Deposit to game" from={`${formatToken(balances.base, pool.baseDenomination)} wallet ${pool.baseTicker}`} to={`${formatInteger(gameRune)} game Rune`}>
                      <Button className="mt-4 w-full" busy={busy === 'game-deposit'}
                              disabled={!address || !bridgeParsed.value || BigInt(bridgeParsed.value ?? '0') > BigInt(balances.base)} onClick={() => needWallet(doGameDeposit)}>Wallet to game</Button>
                    </BridgeCard>
                  </div>
                </div>
              )}

              {desk === 'pool' && (
                <div>
                  <DeskHeading title={pairLive ? 'Add liquidity' : 'Create pool'} right={<Badge tone={pairLive ? 'good' : 'warn'}>{pairLive ? 'Paired' : 'Not funded'}</Badge>} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TokenInput label="Rune side" ticker={pool.baseTicker} value={lpBase} onChange={setLpBase} balance={formatToken(balances.base, pool.baseDenomination)} />
                    <TokenInput label="Relic side" ticker={pool.quoteTicker} value={lpQuote} onChange={setLpQuote} balance={formatToken(balances.quote, pool.quoteDenomination)} />
                  </div>
                  {!address ? (
                    <Button className="mt-4 w-full" variant="primary" busy={connecting} onClick={connect}>Connect to pair tokens</Button>
                  ) : (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <Button busy={busy === 'lp-base'} onClick={() => {
                        const value = tryParseUnits(lpBase, pool.baseDenomination);
                        if (!value.value) return setError(new Error(value.error));
                        void run('lp-base', () => depositToken(pool.baseToken, value.value!), 'Rune side deposited.');
                      }}>Deposit Rune</Button>
                      <Button busy={busy === 'lp-quote'} onClick={() => {
                        const value = tryParseUnits(lpQuote, pool.quoteDenomination);
                        if (!value.value) return setError(new Error(value.error));
                        void run('lp-quote', () => depositToken(pool.quoteToken, value.value!), `${pool.quoteTicker} side deposited.`);
                      }}>Deposit {pool.quoteTicker}</Button>
                      <Button variant="primary" busy={busy === 'lp-add'} onClick={() => {
                        const base = tryParseUnits(lpBase, pool.baseDenomination);
                        const quote = tryParseUnits(lpQuote, pool.quoteDenomination);
                        if (!base.value || !quote.value) return setError(new Error(base.error || quote.error));
                        void run('lp-add', () => addLiquidity(base.value!, quote.value!), pairLive ? 'Liquidity shares minted.' : 'Rune pair seeded and liquidity shares minted.');
                      }}>{pairLive ? 'Add liquidity' : 'Create pool'}</Button>
                    </div>
                  )}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <CreditedBalance label="Rune credited" value={formatToken(deposit.base, pool.baseDenomination)}
                      action={BigInt(deposit.base) > 0n ? <Button size="sm" variant="quiet" onClick={() => void run('refund-base', () => refundDeposit(pool.baseToken, deposit.base), 'Rune deposit refunded.')}>Refund</Button> : undefined} />
                    <CreditedBalance label={`${pool.quoteTicker} credited`} value={formatToken(deposit.quote, pool.quoteDenomination)}
                      action={BigInt(deposit.quote) > 0n ? <Button size="sm" variant="quiet" onClick={() => void run('refund-quote', () => refundDeposit(pool.quoteToken, deposit.quote), `${pool.quoteTicker} deposit refunded.`)}>Refund</Button> : undefined} />
                  </div>
                  {BigInt(deposit.shares) > 0n && (
                    <div className="mt-3 flex items-center justify-between rounded-[3px] border border-good/20 bg-good/[0.05] p-3">
                      <span className="text-xs text-muted">Your position <b className="font-mono text-good">{formatIntegerString(deposit.shares)} shares</b></span>
                      <Button size="sm" busy={busy === 'lp-remove'} onClick={() => void run('lp-remove', () => removeLiquidity(deposit.shares), 'Liquidity returned to your wallet.')}>Remove all</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <aside className="market-rune-aside grid gap-4">
          <MarketForge mode={forgeMode} reversed={!baseIn} active={Boolean(busy) || isPending('rune-withdraw')}
                       className="min-h-[240px] overflow-hidden rounded-[4px] border border-rune/15" />
          <Panel className="market-rune-price p-4 sm:p-5">
            <DeskHeading title={`${pool.quoteTicker} / Rune`}
              right={<Button size="sm" variant="quiet" onClick={() => void refresh()} icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>} />
            <LineChart values={priceSeries} empty="No pool trades." suffix={` ${pool.quoteTicker}`} className="h-48" />
          </Panel>
          <div className="market-rune-side-stack grid gap-4">
            <Panel className="market-rune-faucet p-4 sm:p-5">
              <DeskHeading title={`Mint ${quoteInfo?.Name ?? pool.quoteTicker}`} right={<Sparkle className="h-5 w-5 text-element" />} />
              <div className="rounded-[3px] border border-element/20 bg-element/[0.06] p-3 text-center">
                <div className="font-mono text-2xl text-element">{formatToken(balances.quote, pool.quoteDenomination)}</div><div className="eyebrow mt-1">Wallet {pool.quoteTicker}</div>
              </div>
              {quoteInfo?.FaucetAmount && (
                <Button className="mt-3 w-full" variant="primary" busy={busy === 'faucet'}
                  onClick={() => needWallet(() => void run('faucet', claimQuoteFaucet, `${formatToken(quoteInfo.FaucetAmount!, pool.quoteDenomination)} ${pool.quoteTicker} minted.`))}
                  icon={<Sparkle className="h-4 w-4" />}>
                  Mint {formatToken(quoteInfo.FaucetAmount, pool.quoteDenomination)} {pool.quoteTicker}
                </Button>
              )}
            </Panel>

            <Panel className="market-rune-trades flex min-h-0 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-rune/10 px-4 py-3"><div className="eyebrow">Recent pool trades</div></div>
              {swaps.length ? <div className="market-swap-list min-h-0 flex-1 divide-y divide-rune/10 overflow-y-auto">{[...swaps].reverse().slice(0, 6).map((record) => <SwapRow key={record.id} swap={record} pool={pool} />)}</div>
                : <div className="grid min-h-0 flex-1 place-items-center px-4 py-5 text-center text-xs text-faint">No trades settled yet.</div>}
            </Panel>
          </div>
        </aside>
      </div>

      {statsOpen && (
        <Dialog title="Rune market stats" onClose={() => setStatsOpen(false)}>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rune/10 bg-rune/10 p-px sm:grid-cols-4">
            <MarketMetric label="Pair" value={`${pool.baseTicker} / ${pool.quoteTicker}`} detail={pool.paused ? 'paused' : pairLive ? 'live' : 'unfunded'} />
            <MarketMetric label="Game" value={formatInteger(gameRune)} detail="Rune" />
            <MarketMetric label="Wallet Rune" value={formatToken(balances.base, pool.baseDenomination)} detail={pool.baseTicker} />
            <MarketMetric label={`Wallet ${pool.quoteTicker}`} value={formatToken(balances.quote, pool.quoteDenomination)} detail={pool.quoteTicker} />
            <MarketMetric label="Rune reserve" value={formatToken(pool.reserveBase, pool.baseDenomination)} detail={pool.baseTicker} />
            <MarketMetric label={`${pool.quoteTicker} reserve`} value={formatToken(pool.reserveQuote, pool.quoteDenomination)} detail="pool" />
            <MarketMetric label="Trades" value={formatInteger(pool.swaps)} detail={`${(pool.feeBps / 100).toFixed(2)}% fee`} />
            <MarketMetric label="LP shares" value={formatIntegerString(deposit.shares)} detail={BigInt(deposit.shares) ? 'active' : 'none'} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

function DeskButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('min-h-12 bg-surface px-2 py-2 text-center text-sm font-semibold transition-colors', active ? 'bg-element/10 text-element' : 'text-muted hover:bg-raised hover:text-ink')}>
      {label}
    </button>
  );
}

function DeskHeading({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="market-desk-heading mb-4 flex items-start justify-between gap-4"><h3 className="text-lg font-semibold">{title}</h3>{right}</div>;
}

function TokenInput({ label, ticker, value, onChange, balance, onMax }: {
  label: string; ticker: string; value: string; onChange: (value: string) => void; balance?: string; onMax?: () => void;
}) {
  return (
    <label className="market-token-input block rounded-[3px] border border-edge bg-void/30 p-3.5 focus-within:border-element/55">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs text-faint"><span>{label}</span>
        {balance !== undefined && <button type="button" onClick={onMax} className="font-mono hover:text-element">Wallet {balance}{onMax ? ' / max' : ''}</button>}
      </span>
      <span className="flex items-center gap-3">
        <input className="min-w-0 flex-1 bg-transparent font-mono text-2xl text-ink outline-none placeholder:text-faint" inputMode="decimal" placeholder="0" value={value} onChange={(event) => onChange(event.target.value)} />
        <Badge tone="element"><Rune className="h-3 w-3" />{ticker}</Badge>
      </span>
    </label>
  );
}

function TokenOutput({ ticker, amount, caption }: { ticker: string; amount: string; caption: string }) {
  return <div className="market-token-output rounded-[3px] border border-element/25 bg-element/[0.055] p-4"><div className="flex items-end justify-between gap-3"><span className="text-xs text-faint">You receive</span><span className="font-mono text-xl text-element">{amount} {ticker}</span></div><p className="mt-1 text-right text-[10px] text-faint">{caption}</p></div>;
}

function BridgeCard({ title, from, to, children }: { title: string; from: string; to: string; children: React.ReactNode }) {
  return <div className="rounded-[3px] border border-edge bg-void/25 p-4"><h4 className="text-sm font-semibold">{title}</h4><div className="mt-3 flex items-center gap-2 text-[11px] text-faint"><span className="min-w-0 truncate">{from}</span><Arrow className="h-3.5 w-3.5 shrink-0 text-element" /><span className="min-w-0 truncate">{to}</span></div>{children}</div>;
}

function CreditedBalance({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-[3px] border border-edge/70 bg-void/20 p-3"><div><div className="text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div><div className="mt-1 font-mono text-sm">{value}</div></div>{action}</div>;
}

function SwapRow({ swap: record, pool }: { swap: AmmSwap; pool: AmmPool }) {
  const baseInput = record.inputToken === pool.baseToken;
  const inputTicker = baseInput ? pool.baseTicker : pool.quoteTicker;
  const outputTicker = baseInput ? pool.quoteTicker : pool.baseTicker;
  const inputDenom = baseInput ? pool.baseDenomination : pool.quoteDenomination;
  const outputDenom = baseInput ? pool.quoteDenomination : pool.baseDenomination;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs"><span className="font-mono">{formatToken(record.input, inputDenom)} {inputTicker}</span><Arrow className="h-3.5 w-3.5 text-element" /><span className="font-mono text-element">{formatToken(record.output, outputDenom)} {outputTicker}</span></div>
      <div className="mt-1 flex justify-between text-[9px] text-faint"><span>{shortAddress(record.trader, 4)}</span><span>{relativeTime(record.timestamp)}</span></div>
    </div>
  );
}

// Shared market pieces -------------------------------------------------------

function MarketMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="market-metric min-w-0 bg-surface px-2.5 py-2">
      <div className="truncate text-[8px] uppercase tracking-[0.13em] text-faint">{label}</div>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 truncate font-mono text-sm text-ink" title={value}>{value}</span>
        <span className="shrink-0 truncate text-[8px] uppercase tracking-[0.1em] text-faint">{detail}</span>
      </div>
    </div>
  );
}

function MonsterStat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <div className="min-w-0 bg-surface px-2.5 py-1.5 text-right" title={title}>
      <div className="truncate text-[8px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, element, children }: { active: boolean; onClick: () => void; element?: Element; children: React.ReactNode }) {
  return <button type="button" data-element={element} onClick={onClick} className={cx('filter-chip min-h-11 min-w-11 rounded-[3px] border px-2.5 py-1.5 text-xs transition-colors lg:min-h-0 lg:min-w-0', active ? 'border-element/60 bg-element/10 text-element' : 'border-edge text-faint hover:text-ink')}>{children}</button>;
}

function LineChart({ values, empty, suffix, className }: { values: number[]; empty: string; suffix?: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const frame = host.current;
    if (!element || !frame || values.length === 0) return undefined;
    const draw = () => {
      const rect = frame.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.max(1, Math.round(rect.width * dpr));
      element.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const width = rect.width; const height = rect.height;
      const pad = { left: 4, right: 4, top: 12, bottom: 12 };
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(214,200,162,.10)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) { const y = (height / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      const min = Math.min(...values); const max = Math.max(...values); const range = max - min || Math.max(1, max * 0.08);
      const points = values.map((value, index) => ({
        x: values.length === 1 ? width / 2 : pad.left + (index / (values.length - 1)) * (width - pad.left - pad.right),
        y: pad.top + ((max - value + (max === min ? range / 2 : 0)) / range) * (height - pad.top - pad.bottom),
      }));
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(150,122,255,.32)'); gradient.addColorStop(1, 'rgba(150,122,255,0)');
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.lineTo(points[points.length - 1].x, height); ctx.lineTo(points[0].x, height); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = 'rgba(214,200,162,.95)'; ctx.lineWidth = 1.6; ctx.stroke();
      const last = points[points.length - 1]; ctx.fillStyle = 'rgb(150,122,255)'; ctx.fillRect(last.x - 3, last.y - 3, 6, 6);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(frame); return () => observer.disconnect();
  }, [values]);
  const latest = values.at(-1);
  const change = values.length > 1 ? latest! - values[0] : 0;
  return (
    <div ref={host} className={cx('market-chart relative overflow-hidden rounded-[3px] border border-rune/10 bg-void/30', className)}>
      {values.length ? <>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute left-3 top-3"><div className="font-mono text-lg">{compactNumber(latest!)}{suffix}</div>{values.length > 1 && <div className={cx('mt-0.5 font-mono text-[10px]', change >= 0 ? 'text-good' : 'text-bad')}>{change >= 0 ? '+' : ''}{compactNumber(change)}</div>}</div>
        <div className="pointer-events-none absolute bottom-2 right-3 text-[9px] uppercase tracking-[0.14em] text-faint">{values.length} points</div>
      </> : <div className="grid h-full place-items-center px-6 text-center text-xs text-faint">{empty}</div>}
    </div>
  );
}

function tryParseUnits(value: string, denomination: number): { value: string | null; error: string } {
  if (!value.trim()) return { value: null, error: '' };
  try { return { value: parseUnits(value, denomination), error: '' }; }
  catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : String(caught) }; }
}

function swapPrices(records: AmmSwap[], pool: AmmPool): number[] {
  return records.map((record) => {
    const baseInput = record.inputToken === pool.baseToken;
    const base = Number(formatUnits(baseInput ? record.input : record.output, pool.baseDenomination, pool.baseDenomination));
    const quote = Number(formatUnits(baseInput ? record.output : record.input, pool.quoteDenomination, pool.quoteDenomination));
    return base > 0 ? quote / base : 0;
  }).filter((value) => Number.isFinite(value) && value > 0);
}

function formatToken(value: string | bigint, denomination: number): string { return formatUnits(value, denomination, 4); }
function formatInteger(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value); }
function formatIntegerString(value: string): string { try { return BigInt(value || '0').toLocaleString('en-US'); } catch { return value; } }
function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 4 }).format(value);
}
function relativeTime(timestamp: number): string {
  if (!timestamp) return 'recently';
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - normalized) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24); if (days < 30) return `${days}d ago`;
  return new Date(normalized).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
