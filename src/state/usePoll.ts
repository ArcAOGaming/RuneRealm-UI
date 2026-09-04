/**
 * One polling primitive, for every screen that waits on published state.
 *
 * Every poll in this client used to be a bare `setInterval`. That is a fixed
 * ARRIVAL rate against a variable SERVICE time, and on this node the service
 * time is not close to fixed: a published read settles in about 90 ms when the
 * node is idle and takes 20-45 SECONDS while it works through a write backlog.
 * A 650 ms interval against a 20 s read issues thirty requests for one answer,
 * each holding one of the browser's six connections to the origin, on exactly
 * the screen where the node is busiest. The queue then grows without bound for
 * as long as the screen is open — and the player's next CLICK queues behind all
 * of it, because a write is just another request to the same origin.
 *
 * So this hook does four things a `setInterval` cannot:
 *
 *   - **Single flight.** The next tick is scheduled when the last one FINISHES,
 *     never while it is running. The arrival rate can no longer exceed the
 *     service rate; that is what makes the queue bounded rather than a matter
 *     of how fast the node happens to be today.
 *   - **Backs off.** A tick that fails doubles the delay, up to a ceiling; a
 *     tick that merely takes longer than the interval sets the next delay to
 *     what it actually cost. A slow node is polled slowly.
 *   - **Cancels.** The task is handed an `AbortSignal` that fires on unmount and
 *     on `enabled` going false, so a hung read cannot hold a connection for the
 *     lifetime of the tab.
 *   - **Yields.** It does not run while the tab is hidden, or while `paused()`
 *     is true — which is how a background poll gets out of the way of a write
 *     the player is waiting on.
 *
 * The task is read from a ref, so a caller may pass a fresh closure on every
 * render without restarting the timer. Only `enabled` and the timings restart
 * it, and that is deliberate: restarting on every render is how a poll ends up
 * firing far more often than its interval says.
 */
import { useEffect, useRef } from 'react';

export type PollTask = (signal: AbortSignal) => Promise<unknown>;

export type PollOptions = {
  /** Delay between the end of one tick and the start of the next. */
  intervalMs: number;
  /** Ceiling the backoff may reach. Defaults to eight intervals. */
  maxIntervalMs?: number;
  /** Poll only while true. Going false aborts anything in flight. */
  enabled?: boolean;
  /** Run a tick immediately instead of waiting out the first interval. */
  leading?: boolean;
  /**
   * Checked before every tick. While true the tick is skipped and retried at
   * the same delay — the poll stays armed but issues nothing. Used to keep
   * background reads off the wire while a signed write is in flight.
   */
  paused?: () => boolean;
};

export function usePoll(task: PollTask, options: PollOptions): void {
  const {
    intervalMs, maxIntervalMs = intervalMs * 8,
    enabled = true, leading = false,
  } = options;

  // Seeded, not assigned during render. Writing a ref in the render body is a
  // side effect in a function React is allowed to call speculatively, throw
  // away and call again; under concurrent rendering that publishes a task
  // belonging to a render that was never committed, and the running timer picks
  // it up. The initial values make a `leading` tick correct on first mount, and
  // the effect below — declared before the poll's, so it commits first — keeps
  // them current afterwards without restarting the timer.
  const taskRef = useRef(task);
  const pausedRef = useRef(options.paused);
  useEffect(() => {
    taskRef.current = task;
    pausedRef.current = options.paused;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let running = false;
    let delay = intervalMs;

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try { await cycle(); } finally { running = false; }
    };

    const cycle = async () => {
      // A hidden tab learns nothing worth a connection, and a write in flight
      // wants every connection there is.
      if (document.visibilityState === 'hidden' || pausedRef.current?.()) {
        schedule(delay);
        return;
      }
      controller = new AbortController();
      const started = Date.now();
      try {
        await taskRef.current(controller.signal);
        if (stopped) return;
        // A tick that cost more than the interval sets the pace. Asking again
        // in 650 ms for something that took 20 s is how the queue grew.
        delay = Math.min(maxIntervalMs, Math.max(intervalMs, Date.now() - started));
      } catch {
        if (stopped) return;
        delay = Math.min(maxIntervalMs, Math.max(intervalMs, delay * 2));
      } finally {
        controller = null;
      }
      schedule(delay);
    };

    const schedule = (ms: number) => {
      if (stopped) return;
      timer = setTimeout(() => { void tick(); }, ms);
    };

    // Coming back to the tab should not wait out a backed-off delay — but it
    // must not start a second tick either. `running` is the guard: a fired
    // timeout leaves its handle behind, so clearing it proves nothing about
    // whether the tick it started has finished.
    const onVisible = () => {
      if (stopped || running || document.visibilityState !== 'visible') return;
      delay = intervalMs;
      if (timer !== undefined) clearTimeout(timer);
      schedule(0);
    };
    document.addEventListener('visibilitychange', onVisible);

    if (leading) void tick(); else schedule(delay);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
    };
  }, [enabled, intervalMs, maxIntervalMs, leading]);
}

/** True when a rejection is only "the screen went away". Never a real error. */
export function isAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
}
