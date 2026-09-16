/**
 * Trading panel (§6.5.6), from the `trade` records the stream holds.
 *
 * Every fill here is fleet against fleet by construction; it is shown so the
 * volume is not mistaken for outside liquidity. Spread and touch depth are not
 * in the event log — they need a book read — so this panel does not guess them.
 */
import { Panel, SectionTitle } from '../../../ui/primitives';
import { OPEN_ORDER_CAP, clockTime, fmtInt, fmtRate, marketRows, openOrders } from './model';
import type { SwarmSnapshot } from './types';

export function TradingPanel({ data }: { data: SwarmSnapshot }) {
  const rows = marketRows(data.accounts, data.at);
  const open = openOrders(data.accounts);
  const maker = rows.reduce((sum, row) => sum + row.maker, 0);
  const taker = rows.reduce((sum, row) => sum + row.taker, 0);
  const share = maker + taker ? Math.round((100 * maker) / (maker + taker)) : null;
  return (
    <Panel className="min-w-0 p-4 sm:p-5" data-card="trading">
      <SectionTitle right={<span className="font-mono text-[10px] text-faint">100% fleet-vs-fleet by construction</span>}>
        Trading
      </SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 sm:grid-cols-3">
        <div className="bg-surface/95 p-3">
          <div className="text-[10px] uppercase tracking-wider text-faint">Open orders</div>
          <div className="mt-1 font-mono text-xl text-ink">{fmtInt(open)}<span className="text-sm text-faint"> / {fmtInt(OPEN_ORDER_CAP)}</span></div>
        </div>
        <div className="bg-surface/95 p-3">
          <div className="text-[10px] uppercase tracking-wider text-faint">Maker share</div>
          <div className="mt-1 font-mono text-xl text-ink">{share === null ? '—' : `${share}%`}</div>
        </div>
        <div className="bg-surface/95 p-3">
          <div className="text-[10px] uppercase tracking-wider text-faint">Orders held</div>
          <div className="mt-1 font-mono text-xl text-ink">{fmtInt(maker + taker)}</div>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left font-mono text-[11px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className="py-1 pr-3">Venue</th><th className="pr-3">Market</th><th className="pr-3 text-right">Last px</th>
              <th className="pr-3 text-right">Buy fills/min</th><th className="pr-3 text-right">Sell fills/min</th>
              <th className="pr-3 text-right">Maker</th><th className="text-right">Taker</th>
            </tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.key} className="border-t border-edge/30">
                <td className="py-1.5 pr-3 text-muted">{row.venue}</td>
                <td className="pr-3 text-ink">{row.market}</td>
                <td className="pr-3 text-right text-ink" title={row.lastAt ? clockTime(row.lastAt) : undefined}>{fmtInt(row.lastPx)}</td>
                <td className="pr-3 text-right text-muted">{fmtRate(row.buyFillsPerMin, 1)}</td>
                <td className="pr-3 text-right text-muted">{fmtRate(row.sellFillsPerMin, 1)}</td>
                <td className="pr-3 text-right text-muted">{fmtInt(row.maker)}</td>
                <td className="text-right text-muted">{fmtInt(row.taker)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No trades in this run yet.</p>
      )}
      <p className="mt-3 text-[10px] text-faint">
        Fills/min covers the last 5 minutes; maker/taker covers the trades held per account. Spread and depth
        need a book read and are not in the event stream.
      </p>
    </Panel>
  );
}

