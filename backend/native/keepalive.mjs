/**
 * keepalive.mjs — hold the TLS connection open between requests.
 *
 * The node is in Germany and the harness is not: one round trip is 106 ms, and
 * a cold HTTPS request spends three of them before the server has read a byte
 * (TCP, then TLS, then the request itself). Measured against the live node, the
 * same published read is **127 ms on a warm connection and 345 ms on a cold
 * one** — a flat 215 ms of handshake that buys nothing.
 *
 * Node's fetch already pools connections, but its default `keepAliveTimeout` is
 * four seconds, and that is the whole problem here. Measured decay, same URL,
 * one process:
 *
 *     back-to-back      127 ms
 *     after  3s idle    134 ms
 *     after  6s idle    349 ms   <- connection already dropped
 *     after 30s idle    345 ms
 *
 * A swarm of fifty wallets at three actions a second gives each wallet a turn
 * about every seventeen seconds, and every actor is its own worker thread with
 * its own connection pool. So under the default every single request in the
 * soak is a cold one, and the pooling that exists never once applies. At sixty
 * seconds the same probe reads 128 / 126 / 138 / 132 ms out to a 45-second gap.
 *
 * This is a client-side change with no server side: nginx's own
 * `keepalive_timeout` is 75 s, so nothing here asks the node for anything it
 * was not already offering.
 *
 * `undici` is reached through the package rather than Node's internal copy
 * because Node exposes no other way to configure the global dispatcher. It is a
 * transitive dependency, not a declared one, so its absence is survivable and
 * silent by design: the harness then runs exactly as it did before, slower, and
 * says so once rather than failing to start.
 */

/** How long a connection may sit idle before the pool closes it. */
const IDLE_MS = 60_000;

/** Preserve the swarm's historical per-thread pool when no fan-out is given. */
export const DEFAULT_CONNECTIONS = 8;
/** Keep inferred fan-out from turning an accidental lane count into fd pressure. */
export const MAX_INFERRED_CONNECTIONS = 256;

export function connectionsForLanes(lanes) {
  const count = Number(lanes);
  if (!Number.isFinite(count) || count <= 1) return DEFAULT_CONNECTIONS;
  return Math.min(MAX_INFERRED_CONNECTIONS, Math.ceil(count) * 2);
}

export function resolveConnections({ connections, lanes, env = process.env } = {}) {
  const explicit = Number(connections);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const override = Number(env?.HB_CONNECTIONS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return connectionsForLanes(lanes);
}

let applied = null;
let configuredConnections = DEFAULT_CONNECTIONS;

export function connectionLimit() {
  return configuredConnections;
}

/**
 * Install the long-lived connection pool for THIS thread.
 *
 * Per thread, not per process: `globalThis` is not shared across worker
 * threads, so the swarm's parent installing it does nothing for the fifty
 * actors that do the actual work. Each one calls this itself.
 *
 * Idempotent, so a module that is imported by both a tool and its library does
 * not install two pools and quietly halve the benefit.
 */
export async function useKeepAlive({ quiet = true, connections, lanes } = {}) {
  if (applied !== null) return applied;
  configuredConnections = resolveConnections({ connections, lanes });
  try {
    const { Agent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new Agent({
      keepAliveTimeout: IDLE_MS,
      keepAliveMaxTimeout: IDLE_MS * 2,
      // One wallet acts at a time inside a worker, but the parent runner and
      // the tools fan out across several keys at once.
      connections: configuredConnections,
    }));
    applied = true;
  } catch (error) {
    if (!quiet) {
      console.warn(`keep-alive unavailable (${error.message}); `
        + 'every request will pay a fresh TLS handshake');
    }
    applied = false;
  }
  return applied;
}

export default useKeepAlive;
