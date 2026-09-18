/**
 * One square tile per wallet, in wallet order, so a tile stays where it is
 * while the run moves and burner-51 is always in the same place.
 *
 * A tile answers four questions at once: what the wallet's companion is doing
 * (its status, level, energy and happiness), what the wallet's brain is doing
 * (its state, open orders), which writes are still waiting on a reply and for
 * how long, and whether it is up or down in Gold. Its tint is the wallet's
 * activity, in the colour of the process group that activity drives.
 *
 * Tiles shrink with the grid: container queries shorten verbs below 96 px,
 * drop the personality and brain-state line below 72 px, and below 56 px (a
 * phone) a tile is its number, its tint, a green or red PnL bar and a dot for a
 * waiting write.
 */
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { cx } from '../../../ui/primitives';
import { compareSwarmWallets, swarmProfileLabel } from '../../../data/swarm-wallets';
import {
  ACTIVITIES, LONG_WAIT_MS, PEER_RECENT_MS, activityOf, fmtInt, fmtPnl, fmtWait, monsterNow, pendingLanes, profileMark,
  recentPeer, roleLabel, stateLabel, walletLabel,
} from './model';
import { activityColor, activityTint, groupColor, swColor } from './palette';
import type { AccountView, SwarmSnapshot } from './types';
import { useClock } from './useClock';

/** Energy and happiness below this cannot enter the arena (25 each). */
const LOW_METER = 25;

export const TILE_CSS = `
.wallet-tile { container-type: inline-size; }
.wallet-tile .wt-sm, .wallet-tile .wt-verb-short { display: none; }
@container (max-width: 95px) {
  .wallet-tile .wt-verb-full { display: none; }
  .wallet-tile .wt-verb-short { display: inline; }
}
@container (max-width: 71px) {
  .wallet-tile .wt-lg { display: none; }
}
@container (max-width: 55px) {
  .wallet-tile .wt-md { display: none; }
  .wallet-tile .wt-sm { display: flex; }
}
@keyframes wt-pulse {
  from { box-shadow: inset 0 0 0 2px var(--wt-pulse); }
  to { box-shadow: inset 0 0 0 2px transparent; }
}
.wallet-tile .wt-pulse { animation: wt-pulse 1.6s ease-out 1 both; }
@media (prefers-reduced-motion: reduce) { .wallet-tile .wt-pulse { animation: none; } }
`;

export function WalletGrid({ data, selected, onSelect, live = false }: {
  data: SwarmSnapshot; selected: string | null; onSelect: (wallet: string) => void; live?: boolean;
}) {
  // Waits count up by the second while the stream feeds a live run; otherwise they stop at the snapshot.
  const clock = useClock(1_000, live);
  const now = live ? Math.max(data.at, clock) : data.at;
  const accounts = [...data.accounts].sort((a, b) => compareSwarmWallets(a.wallet, b.wallet));
  const listsPending = data.accounts.some((account) => Array.isArray(account.pending));
  const unreported = data.accounts.some((account) => activityOf(account.state).id === 'unreported');
  const hasActivity = data.accounts.some((account) => typeof account.acct?.activity === 'string');
  const waiting = accounts.reduce((sum, account) => sum + pendingLanes(account, now).length, 0);

  return (
    <div className="min-w-0 p-4 sm:p-5" data-card="wallet-grid">
      <style>{TILE_CSS}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-ink">Wallets</h2>
        <span className="text-[11px] text-faint">
          {listsPending ? `${fmtInt(waiting)} writes waiting on a reply` : 'this stream does not list waiting writes yet'}
          {' '}· select a tile for its messages and trades
        </span>
      </div>

      {/* Swatches only: the counts are in the header's activity strip. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Tile colours">
        {ACTIVITIES.filter((activity) => activity.id !== 'unreported' || unreported).map((activity) => (
          <li key={activity.id} className="inline-flex items-center gap-1.5" data-legend={activity.id}>
            <span className="h-2.5 w-2.5 rounded-[2px] border" aria-hidden
              style={{ background: activityTint(activity, TINT_ALPHA * 1.6), borderColor: activityColor(activity) }} />
            {activity.label}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 hidden text-[11px] leading-relaxed text-faint sm:block">
        Each tile: wallet and Gold PnL; the companion&apos;s status{hasActivity ? '' : ' (the wallet state until the swarm is restarted with companion status)'} and
        level; energy over happiness, red under {LOW_METER}. Chips are writes waiting on a reply, dotted by process group, amber
        after {Math.round(LONG_WAIT_MS / 1_000)} s. {PEER_MARK.sent} or {PEER_MARK.received}: a token sent to or received from
        another wallet in the last {Math.round(PEER_RECENT_MS / 60_000)} min. Hover a tile for its full summary.
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint sm:hidden">
        Each tile is a wallet, tinted by what it is doing. The bar along its foot is green when it is up in Gold, red when
        down. A dot is a write waiting on a reply, amber after {Math.round(LONG_WAIT_MS / 1_000)} s. Tap a tile for the rest.
      </p>

      <div className="mx-auto mt-3 grid w-full grid-cols-10 gap-[2px] sm:gap-1 lg:w-4/5" data-grid="wallets">
        {accounts.map((account) => (
          <WalletTile key={account.wallet} account={account} now={now}
            selected={selected === account.wallet} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

/** A recent peer token send or receipt, in the colour the money-flow panel gives wallet to wallet. */
const PEER_MARK = { sent: '↗', received: '↙', both: '⇅' } as const;
const PEER_SLOT = 6;

/** A tile's wash: strong enough that battle orange and trading amber still read apart at phone size. */
const TINT_ALPHA = 0.22;

function Meter({ value, color, label }: { value: number | null; color: string; label: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="block h-[3px] w-full overflow-hidden rounded-[1px] bg-edge/70" title={`${label} ${value ?? '—'}`}>
      <span className={cx('block h-full', value !== null && value < LOW_METER ? 'bg-bad' : color)} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function WalletTile({ account, now, selected, onSelect }: {
  account: AccountView; now: number; selected: boolean; onSelect: (wallet: string) => void;
}) {
  const activity = activityOf(account.state);
  const color = activityColor(activity);
  const monster = monsterNow(account, now);
  const lanes = pendingLanes(account, now);
  const pnl = account.acct?.pnlGold ?? null;
  const pnlSign = pnl === null || !Number.isFinite(pnl) ? 'none' : Math.round(pnl) > 0 ? 'up' : Math.round(pnl) < 0 ? 'down' : 'flat';
  const orders = account.acct?.openOrders ?? 0;
  const pulse = useResolvedPulse(account.lastAt);
  const longest = lanes.reduce((max, lane) => Math.max(max, lane.waitedMs), 0);
  const label = walletLabel(account.wallet);
  const peer = recentPeer(account, now);

  const summary = [
    `${account.wallet} (${swarmProfileLabel(account.profile)})`,
    `${stateLabel(account.state)}${account.reason ? `: ${account.reason}` : ''}`,
    monster.source === 'monster'
      ? `${monster.name ?? 'Companion'}${monster.element ? ` (${monster.element})` : ''}: ${monster.label}, level ${monster.level ?? '—'}`
      : `Level ${monster.level ?? '—'}`,
    `Energy ${monster.energy ?? '—'}, happiness ${monster.happiness ?? '—'}`,
    `PnL ${fmtPnl(pnl)} Gold${orders ? `, ${orders} open orders` : ''}`,
    ...(peer ? [`Peer token ${peer === 'both' ? 'sent and received' : peer} in the last ${Math.round(PEER_RECENT_MS / 60_000)} min`
      + ` (${account.peer?.sent ?? 0} sent, ${account.peer?.received ?? 0} received this run)`] : []),
    ...lanes.map((lane) => `Waiting ${fmtWait(lane.waitedMs)} on ${lane.verb} (${lane.pidRole ? roleLabel(lane.pidRole) : 'unknown process'})`),
  ].join('\n');

  return (
    <button type="button" onClick={() => onSelect(account.wallet)} title={summary} aria-label={summary.replace(/\n/g, '. ')}
      aria-pressed={selected} data-tile={account.wallet} data-activity={activity.id} data-pending={lanes.length} data-peer={peer ?? undefined}
      className={cx(
        'wallet-tile relative aspect-square min-w-0 overflow-hidden rounded-[3px] border text-left',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-arcane',
        selected ? 'ring-2 ring-ink/80' : 'hover:brightness-110',
      )}
      style={{ background: activityTint(activity, activity.group ? TINT_ALPHA : 0.08), borderColor: activityTint(activity, 0.45) }}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      {pulse > 0 && (
        <span key={pulse} aria-hidden className="wt-pulse pointer-events-none absolute inset-0 rounded-[3px]"
          style={{ '--wt-pulse': color } as CSSProperties} />
      )}

      <span className="wt-md flex h-full min-w-0 flex-col gap-[3px] py-1 pl-[6px] pr-1 font-mono leading-none">
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="text-[11px] font-semibold text-ink">{label}</span>
          <span className="wt-lg font-sans text-[9px] text-faint">{profileMark(account.profile)}</span>
          {peer && <span aria-hidden data-peer-mark className="text-[10px] font-semibold" style={{ color: swColor(PEER_SLOT) }}>{PEER_MARK[peer]}</span>}
          <span data-pnl={pnlSign} className={cx(
            'ml-auto truncate text-[10px]',
            pnlSign === 'up' ? 'text-good' : pnlSign === 'down' ? 'text-bad' : 'text-faint',
          )}>{fmtPnl(pnl)}</span>
        </span>

        <span className="flex min-w-0 items-baseline gap-1 text-[10px]" data-monster={monster.source}>
          <span className="truncate font-sans text-ink">{monster.label}</span>
          {monster.leftMs !== null && <span className="wt-lg shrink-0 text-faint">{fmtWait(monster.leftMs)}</span>}
          <span className="ml-auto shrink-0 text-muted">L{monster.level ?? '—'}</span>
        </span>

        <span className="flex flex-col gap-[2px]">
          <Meter value={monster.energy} color="bg-ink/70" label="energy" />
          <Meter value={monster.happiness} color="bg-muted/60" label="happiness" />
        </span>

        {/* Two waiting writes need the room; the brain state is still in the summary. */}
        {(monster.source === 'monster' || orders > 0) && lanes.length < 2 && (
          <span className={cx('flex min-w-0 items-baseline gap-1 text-[9px] text-muted', orders === 0 && 'wt-lg')} data-doing>
            {monster.source === 'monster' && <span className="wt-lg truncate font-sans">{stateLabel(account.state)}</span>}
            {orders > 0 && <span className="ml-auto shrink-0" data-orders={orders}>{orders} ord</span>}
          </span>
        )}

        {lanes.length > 0 && (
          <span className="mt-auto flex min-w-0 flex-col gap-[2px]">
            {lanes.map((lane) => (
              <span key={lane.id} data-lane={lane.pidRole ?? 'unknown'} data-long={lane.long ? 'true' : undefined}
                className={cx(
                  'flex min-w-0 items-center gap-1 rounded-[2px] px-[3px] py-[2px] text-[9px]',
                  lane.long ? 'bg-warn/20 text-warn' : 'bg-surface/80 text-muted',
                )}>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: groupColor(lane.group) }} />
                <span className="wt-verb-full min-w-0 truncate">{lane.verb}</span>
                <span className="wt-verb-short min-w-0 truncate">{lane.verb.split('.').pop()}</span>
                <span className="ml-auto shrink-0">{fmtWait(lane.waitedMs)}</span>
              </span>
            ))}
          </span>
        )}
      </span>

      <span className="wt-sm absolute inset-0 items-center justify-center font-mono text-[9px] font-semibold text-ink">
        {label}
        {peer && (
          <span aria-hidden data-peer-mark className="absolute left-[5px] top-[3px] h-1.5 w-1.5 rounded-full" style={{ background: swColor(PEER_SLOT) }} />
        )}
        {lanes.length > 0 && (
          <span aria-hidden className={cx('absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full', longest >= LONG_WAIT_MS ? 'bg-warn' : 'bg-ink/60')} />
        )}
        {(pnlSign === 'up' || pnlSign === 'down') && (
          <span aria-hidden data-pnl-bar={pnlSign}
            className={cx('absolute inset-x-0 bottom-0 h-[2px]', pnlSign === 'up' ? 'bg-good' : 'bg-bad')} />
        )}
      </span>
    </button>
  );
}

/**
 * Counts the times a wallet's last reply has moved on since the tile mounted, so
 * each new reply replays the pulse once, as it lands, rather than on the next tick.
 */
function useResolvedPulse(lastAt: number | null): number {
  const [pulses, setPulses] = useState(0);
  const seen = useRef(lastAt);
  useEffect(() => {
    if (lastAt === seen.current) return;
    const moved = lastAt !== null && (seen.current === null || lastAt > seen.current);
    seen.current = lastAt;
    if (moved) setPulses((count) => count + 1);
  }, [lastAt]);
  return pulses;
}
