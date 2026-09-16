/**
 * Test-fleet observatory.
 *
 * The local event stream is the only data source. No HyperBEAM process key is
 * polled here, so ordinary players and process-to-process traffic can never be
 * mistaken for swarm activity.
 */
import { Badge, Button, Empty, ErrorNote, Panel } from '../../ui/primitives';
import { Refresh, Users } from '../../ui/icons';
import { SwarmMonitorView } from './swarm/View';
import { useSwarmStream } from './swarm/useSwarmStream';

export default function SwarmMonitor() {
  const stream = useSwarmStream(true);
  const replaying = Boolean(stream.run);
  const active = !replaying && stream.data?.active === true;
  const visible = replaying || active;

  const runPicker = stream.runs.length > 0 ? (
    <select className="admin-filter" aria-label="Recorded swarm run"
      value={stream.run ?? ''}
      onChange={(event) => stream.setRun(event.target.value || null)}>
      <option value="">Live swarm</option>
      {stream.runs.map((id) => <option key={id} value={id}>{id}</option>)}
    </select>
  ) : null;

  if (!visible) {
    const streamOffline = stream.error && stream.error !== 'no run yet';
    return (
      <div className="space-y-4">
        {streamOffline && (
          <Panel className="p-5">
            <ErrorNote error={`Swarm stream at ${stream.base}: ${stream.error}`}
              onRetry={() => void stream.reload()} />
          </Panel>
        )}
        <Panel className="p-6">
          <Empty icon={<Users />} title="No active swarm">
            Start the reorganized fleet when you are ready. This tab stays empty until
            its event log begins moving; it does not substitute ordinary game or node traffic.
          </Empty>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {runPicker}
            <Button size="sm" variant="ghost" onClick={() => void stream.reload()}
              icon={<Refresh className="h-4 w-4" />}>Check stream</Button>
          </div>
          <p className="mt-4 text-center text-xs text-faint">
            npm run dev starts the read-only stream on 127.0.0.1:8787.
          </p>
        </Panel>
      </div>
    );
  }

  const toolbar = (
    <>
      <Badge tone={active ? 'good' : 'plain'}>
        {active ? 'fleet live' : `recorded run · ${stream.run}`}
      </Badge>
      {runPicker}
      <Button size="sm" variant="ghost" onClick={() => void stream.reload()}
        icon={<Refresh className="h-4 w-4" />}>Reload</Button>
    </>
  );

  return stream.data
    ? <SwarmMonitorView data={stream.data} toolbar={toolbar} />
    : <Panel className="p-6"><Empty icon={<Users />} title="Loading swarm stream" /></Panel>;
}
