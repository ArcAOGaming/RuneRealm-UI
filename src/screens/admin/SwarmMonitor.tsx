/**
 * Test-fleet observatory: the live swarm only.
 *
 * The local event stream is the only data source. No HyperBEAM process key is
 * polled here, so ordinary players and process-to-process traffic can never be
 * mistaken for swarm activity.
 */
import { monitorStatus } from './swarm/model';
import type { Connection } from './swarm/model';
import type { SwarmSnapshot } from './swarm/types';
import { StatusBar, SwarmMonitorView } from './swarm/View';
import { useClock } from './swarm/useClock';
import { useSwarmStream } from './swarm/useSwarmStream';

export default function SwarmMonitor() {
  const stream = useSwarmStream();
  // Whether it is live does not depend on the clock; only "N s ago" does, so only the bar ticks.
  const live = monitorStatus(stream.connection, stream.data, Date.now()).kind === 'live';
  return (
    <div className="space-y-4">
      <TickingStatus connection={stream.connection} data={stream.data} base={stream.base} />
      {live && stream.data && <SwarmMonitorView data={stream.data} live />}
    </div>
  );
}

function TickingStatus({ connection, data, base }: { connection: Connection; data: SwarmSnapshot | null; base: string }) {
  const now = useClock(1_000, true);
  return <StatusBar status={monitorStatus(connection, data, now)} data={data} base={base} now={now} />;
}
