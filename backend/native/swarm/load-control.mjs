/**
 * Global dispatch controls for the live swarm.
 *
 * Concurrency bounds how many requests may be in flight. The token bucket
 * separately bounds how quickly new requests enter HyperBEAM; without both, a
 * low concurrency value can still refill a sequential process faster than it
 * computes and grow an unbounded queue.
 */

export const SAFE_CONCURRENCY = 3;
export const SAFE_ACTIONS_PER_SECOND = 1;
export const DEFAULT_BURST = 1;

export function responseOutcomeCounts({
  successfulDurations = [], failedDurations = [], failedCount = failedDurations.length,
} = {}) {
  return {
    attempted: successfulDurations.length + failedCount,
    succeeded: successfulDurations.length,
    failed: failedCount,
    timedFailures: failedDurations.length,
  };
}

export function settledValuesOrThrow(results, context = 'operation') {
  const values = [];
  for (const entry of results ?? []) {
    if (!entry) continue;
    if (entry.status === 'rejected') {
      if (entry.reason instanceof Error) throw entry.reason;
      throw new Error(`${context} failed: ${String(entry.reason)}`);
    }
    values.push(entry.value);
  }
  return values;
}

export function settledRejections(results, context = 'operation') {
  const rejected = [];
  for (let index = 0; index < (results?.length ?? 0); index++) {
    const entry = results[index];
    if (entry?.status !== 'rejected') continue;
    rejected.push({
      index,
      error: entry.reason instanceof Error
        ? entry.reason
        : new Error(`${context} failed: ${String(entry.reason)}`),
    });
  }
  return rejected;
}

export function inspectTerminations(results, recordFailure = () => {}) {
  const failures = settledRejections(results, 'worker termination');
  for (const { index, error } of failures) recordFailure(error, index);
  return {
    fatal: failures.length > 0,
    firstError: failures[0]?.error ?? null,
    failureCount: failures.length,
  };
}

function finitePositive(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a number greater than zero`);
  }
  return parsed;
}

export function resolveLoadPolicy({
  mode = 'soak',
  walletCount,
  concurrency,
  actionsPerSecond,
  burst,
} = {}) {
  if (mode !== 'soak' && mode !== 'stress') {
    throw new Error('--mode must be either soak or stress');
  }
  if (!Number.isSafeInteger(walletCount) || walletCount < 1 || walletCount > 50) {
    throw new Error('walletCount must be an integer from 1 to 50');
  }

  const resolvedConcurrency = concurrency === undefined
    ? mode === 'stress' ? walletCount : Math.min(SAFE_CONCURRENCY, walletCount)
    : Number(concurrency);
  if (!Number.isSafeInteger(resolvedConcurrency)
      || resolvedConcurrency < 1 || resolvedConcurrency > 50) {
    throw new Error('--concurrency must be an integer from 1 to 50');
  }

  const resolvedRate = actionsPerSecond === undefined
    ? mode === 'stress' ? null : SAFE_ACTIONS_PER_SECOND
    : finitePositive(actionsPerSecond, '--actions-per-second');
  const resolvedBurst = burst === undefined ? DEFAULT_BURST : Number(burst);
  if (!Number.isSafeInteger(resolvedBurst) || resolvedBurst < 1 || resolvedBurst > 50) {
    throw new Error('--burst must be an integer from 1 to 50');
  }

  return {
    mode,
    concurrency: resolvedConcurrency,
    actionsPerSecond: resolvedRate,
    burst: resolvedBurst,
  };
}

export function createTokenBucket({
  actionsPerSecond,
  burst = DEFAULT_BURST,
  now = () => Date.now(),
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  const rate = finitePositive(actionsPerSecond, 'actionsPerSecond');
  if (!Number.isSafeInteger(burst) || burst < 1) {
    throw new Error('burst must be a positive integer');
  }

  let tokens = burst;
  let checkpoint = now();

  return async function acquire({ deadline = null } = {}) {
    const requestedAt = now();
    if (deadline !== null && requestedAt >= deadline) return null;
    if (requestedAt > checkpoint) {
      tokens = Math.min(burst, tokens + ((requestedAt - checkpoint) * rate) / 1_000);
      checkpoint = requestedAt;
    }

    let waitMs = 0;
    if (tokens >= 1) {
      if (deadline !== null && requestedAt >= deadline) return null;
      tokens -= 1;
    } else {
      const missing = 1 - tokens;
      const readyAt = checkpoint + (missing * 1_000) / rate;
      // `checkpoint` may already be in the future because another concurrent
      // caller reserved the preceding token. Include that debt so simultaneous
      // callers wake on successive token times rather than as one burst.
      waitMs = Math.max(0, readyAt - requestedAt);
      // Do not reserve arrivals that cannot begin inside a timed gameplay
      // window. In particular, a whole cycle may call acquire concurrently;
      // refusing future reservations here prevents cleanup from sitting behind
      // token debt for work that will never be allowed to run.
      if (deadline !== null && requestedAt + waitMs >= deadline) return null;
      checkpoint = readyAt;
      tokens = 0;
    }

    if (waitMs > 0) await sleep(waitMs);
    return waitMs;
  };
}

export function createGatedDispatcher({ concurrency, acquire = async () => 0 } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  let active = 0;
  const waiting = [];
  const withConcurrency = async (fn) => {
    if (active < concurrency) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };

  return async function dispatch(fn, {
    shouldStart = () => true,
    deadline = null,
  } = {}) {
    if (!shouldStart()) return { started: false };
    return withConcurrency(async () => {
      // Reserve the rate token only after concurrency is available. A token
      // reserved before a long in-flight action can mature while queued, then
      // let several calls burst through together when that action releases.
      if (!shouldStart()) return { started: false };
      const permit = await acquire({ deadline });
      // The deadline or stop flag may change while rate-limited. Check again at
      // the exact point the worker is called.
      if (permit === null) return { started: false };
      if (!shouldStart()) return { started: false };
      return { started: true, value: await fn() };
    });
  };
}
