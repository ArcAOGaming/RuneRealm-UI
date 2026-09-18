/**
 * Money flow: where value moved between the game authority, the exchange
 * (both venues), wallets' token balances and other wallets, and per market
 * whether both sides are trading.
 *
 * Each lane is a pair of opposite flows, so a lane that only ever goes one way
 * (deposits that never come back, sells nobody buys) is visible at a glance.
 * Counts are writes the fleet sent; quantity is whole units from writes that
 * landed. A log written before flow fields existed is read from verb names and
 * has no quantities; the panel says so rather than showing zeros.
 */
import { useState } from 'react';
import { Panel, cx } from '../../../ui/primitives';
import { BarChart, Series } from './charts';
import {
  FLOW_LANES, FlowPoint, MarketBalance, RANGES, assetLabel, flowSeries, flowWindow, fmtInt, fmtPct, fmtQty, fmtRate,
  marketBalance, withinRange,
} from './model';
import { swColor } from './palette';
import type { FlowCounts, FlowName, SwarmSnapshot } from './types';

const perMinAxis = (value: number) => String(Number(value.toFixed(value >= 10 ? 0 : 1)));

export function MoneyFlowPanel({ data }: { data: SwarmSnapshot }) {
  const [rangeId, setRangeId] = useState('15m');
  const range = RANGES.find((entry) => entry.id === rangeId) ?? RANGES[1];
  const { counted, flows } = flowWindow(data, range.ms);
  const derived = Object.values(flows).reduce((sum, row) => sum + (row?.derived ?? 0), 0);
  const peak = Math.max(1, ...Object.values(flows).map((row) => row?.msgs ?? 0));

  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="money-flow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">Money flow</h2>
          <p className="text-[11px] text-faint">writes sent, how many landed, and whole units moved by asset</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Money flow range">
          {RANGES.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setRangeId(entry.id)} aria-pressed={entry.id === rangeId}
              className={cx(
                'rounded-[3px] border px-2.5 py-1 font-mono text-[11px]',
                entry.id === rangeId ? 'border-arcane/60 bg-arcane/10 text-ink' : 'border-edge text-muted hover:text-ink',
              )}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {!counted && (
        <p data-figure="flow-uncounted" className="mt-3 rounded-[3px] border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          This stream started before it counted money flow. Restart the swarm to count it from the whole
          log; buy vs sell under More detail comes from the trades each wallet holds.
        </p>
      )}
      {counted && derived > 0 && (
        <p data-figure="flow-derived" className="mt-3 text-[11px] text-faint">
          {fmtInt(derived)} of these writes were read from verb names (logged before flow fields), so they carry no quantity,
          and peer sends cannot be told apart from deposits.
        </p>
      )}

      {counted && (
        <ul className="mt-3 divide-y divide-edge/40 border-y border-edge/40" aria-label="Custody lanes">
          {FLOW_LANES.map((lane) => (
            <li key={lane.id} data-lane={lane.id}
              className="grid gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem] sm:items-center">
              <Node label={lane.from} slot={lane.slot} />
              <div className="min-w-0 space-y-1.5">
                <Arrow flow={lane.forward} verb={lane.forwardVerb} dir="right" flows={flows} peak={peak} slot={lane.slot} />
                {lane.back && lane.backVerb && (
                  <Arrow flow={lane.back} verb={lane.backVerb} dir="left" flows={flows} peak={peak} slot={lane.slot} />
                )}
              </div>
              <Node label={lane.to} slot={lane.slot} end />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Under More detail: custody writes per minute and buy vs sell, over the last 15 minutes. */
export function MoneyFlowDetail({ data }: { data: SwarmSnapshot }) {
  const range = RANGES.find((entry) => entry.id === '15m') ?? RANGES[1];
  const { counted, markets } = flowWindow(data, range.ms);
  const rows = flowSeries(withinRange(data.fleet.series, range.ms), data.bucketMs);
  const series: Series<FlowPoint>[] = FLOW_LANES.map((lane) => ({
    key: lane.id,
    label: lane.back ? `${lane.from} ⇄ ${lane.to}` : `${lane.from} → ${lane.to}`,
    color: swColor(lane.slot),
    value: (row) => row.lanes[lane.id] ?? 0,
  }));
  const balance = marketBalance(markets);

  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="money-flow-detail">
      <h2 className="text-sm font-medium text-ink">Money flow, last {range.label}</h2>
      {counted && (
        <figure className="mt-3 min-w-0">
          <figcaption className="mb-1 text-xs text-muted">Custody writes per minute, stacked by lane</figcaption>
          <BarChart title="Custody writes per minute by lane" rows={rows} series={series} stacked format={perMinAxis} height={120} />
        </figure>
      )}

      <div className="mt-4" data-card="buy-sell">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-ink">Buy vs sell</h3>
          <span className="text-[11px] text-faint">orders placed (maker/taker) and units filled at placement, each side</span>
        </div>
        {balance.length ? (
          <ul className="mt-2 space-y-2.5" aria-label="Buy and sell by market">
            {balance.map((row) => <MarketStrip key={row.key} row={row} />)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No trades in this window.</p>
        )}
      </div>
    </Panel>
  );
}

function Node({ label, slot, end = false }: { label: string; slot: number; end?: boolean }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs text-ink', end && 'sm:justify-end')}>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: swColor(slot) }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function Arrow({ flow, verb, dir, flows, peak, slot }: {
  flow: FlowName; verb: string; dir: 'left' | 'right'; flows: FlowCounts; peak: number; slot: number;
}) {
  const row = flows[flow];
  const msgs = row?.msgs ?? 0;
  const width = msgs ? Math.max(2, (100 * msgs) / peak) : 0;
  return (
    <div data-flow={flow} data-msgs={msgs} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
        <span aria-hidden className="text-faint">{dir === 'right' ? '→' : '←'}</span>
        <span className="font-sans text-muted">{verb}</span>
        <span data-figure="flow-msgs" className={msgs ? 'text-ink' : 'text-faint'}>{fmtInt(msgs)}</span>
        <span className="text-faint">{msgs ? `sent, ${fmtInt(row?.ok ?? 0)} landed` : 'sent'}</span>
        <span data-figure="flow-qty" className="min-w-0 truncate text-muted">{msgs ? fmtQty(row?.qty) : ''}</span>
      </div>
      <div className={cx('mt-0.5 flex h-1.5 w-full rounded-[1px] bg-raised', dir === 'left' && 'justify-end')} aria-hidden>
        <span className="h-full rounded-[1px]" style={{ width: `${width}%`, background: swColor(slot) }} />
      </div>
    </div>
  );
}

function Side({ label, side, rate, align }: {
  label: string; side: MarketBalance['buy']; rate: number | null; align: 'left' | 'right';
}) {
  return (
    <div className={cx('min-w-0 font-mono text-[11px]', align === 'right' && 'text-right')} data-side={label}>
      <div>
        <span className="font-sans text-muted">{label}</span>{' '}
        <span className={side.orders ? 'text-ink' : 'text-faint'}>{fmtInt(side.orders)}</span>
        <span className="text-faint"> ({fmtInt(side.maker)}m/{fmtInt(side.taker)}t)</span>
      </div>
      <div className="text-faint">
        filled <span className="text-muted">{fmtInt(side.filled)}</span>/{fmtInt(side.qty)} · {rate === null ? '—' : fmtPct(rate)}
      </div>
    </div>
  );
}

function MarketStrip({ row }: { row: MarketBalance }) {
  const buyPct = Math.round(100 * row.buyShare);
  return (
    <li data-market={row.key} data-one-sided={row.oneSided ?? undefined} className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="text-ink">{assetLabel(row.market)}</span>
        <span className="text-[10px] text-faint">{row.venue}</span>
        {row.oneSided && (
          <span className="rounded-[2px] bg-warn/15 px-1 text-[10px] text-warn">
            {row.oneSided === 'sell' ? 'sellers, few buyers' : 'buyers, few sellers'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3">
        <Side label="buy" side={row.buy} rate={row.buyFillRate} align="left" />
        <Side label="sell" side={row.sell} rate={row.sellFillRate} align="right" />
      </div>
      <div className="mt-1 flex h-2 w-full overflow-hidden rounded-[2px] bg-raised" role="img"
        aria-label={`${assetLabel(row.market)}: ${row.buy.orders} buy orders, ${row.sell.orders} sell orders`}>
        <span className="h-full border-r-2 border-surface bg-ink/70" style={{ width: `${buyPct}%` }} title={`buy ${buyPct}%`} />
        <span className="h-full bg-muted/35" style={{ width: `${100 - buyPct}%` }} title={`sell ${100 - buyPct}%`} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-faint">
        <span>{fmtRate(row.buyShare * 100, 0)}% of orders</span>
        <span>{fmtRate((1 - row.buyShare) * 100, 0)}%</span>
      </div>
    </li>
  );
}
