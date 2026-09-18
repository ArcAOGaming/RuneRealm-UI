/**
 * `/admin?swarm-preview` in dev: the monitor rendered from the recorded
 * fixture (100 wallets, 11 processes), with no stream and no wallet. Loaded
 * lazily so the 1.4 MB fixture never enters the main bundle.
 *
 * One wallet is given a second waiting write, on the venue, so the stacked
 * chips of the planned per-contract lanes can be seen. The aggregator keeps
 * one lane per wallet today, so no recorded snapshot holds that shape.
 */
import { SwarmMonitorView } from './View';
import fixture from './fixture/snapshot.json';
import type { SwarmSnapshot } from './types';

const PLANNED_LANE_WALLET = 'burner-24';

function withPlannedLane(source: SwarmSnapshot): SwarmSnapshot {
  const venue = source.processes.find((process) => process.pidRole === 'venue.internal');
  if (!venue) return source;
  return {
    ...source,
    accounts: source.accounts.map((account) => (account.wallet !== PLANNED_LANE_WALLET || !account.pending?.length ? account : {
      ...account,
      pending: [...account.pending, {
        id: `${account.wallet}:preview-venue-lane`, t0: source.at - 4_000, pid: venue.pid, pidRole: venue.pidRole, verb: 'order.place',
      }],
    })),
  };
}

const data = withPlannedLane(fixture as unknown as SwarmSnapshot);

export default function SwarmPreview() {
  return <SwarmMonitorView data={data} />;
}
