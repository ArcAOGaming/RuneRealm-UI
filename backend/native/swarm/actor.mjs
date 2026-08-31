import { Worker } from 'node:worker_threads';
import { structuredErrorFields } from './error-fields.mjs';

const defaultWorkerFactory = (url, options) => new Worker(url, options);

export class ActorRetirementError extends Error {
  constructor(wallet, cause, originalError) {
    super(`${wallet} worker termination could not be confirmed; the actor is permanently `
      + 'retired and the run cannot safely continue.');
    this.name = 'ActorRetirementError';
    this.fatalRetirement = true;
    this.terminationConfirmed = false;
    this.cause = cause;
    this.originalError = originalError;
    if (Number.isFinite(originalError?.durationMs)) {
      this.durationMs = originalError.durationMs;
    }
  }
}

/**
 * One isolated wallet worker.
 *
 * A timed-out call is not merely forgotten: the worker may still be inside a
 * signed network write. The actor is retired, and its call remains in flight
 * from the dispatcher's perspective until worker termination completes. That
 * prevents the limiter from lending the same capacity to a new write while an
 * untracked late write is still alive.
 */
export class Actor {
  constructor({
    profile,
    burner,
    clientFile,
    runId,
    seed,
    timeoutMs,
    peers,
    workerFactory = defaultWorkerFactory,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    terminationTimeoutMs = 10_000,
  }) {
    this.profile = profile;
    this.burner = burner;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.terminationTimeoutMs = terminationTimeoutMs;
    this.retiredError = null;
    this.retirement = null;
    this.worker = workerFactory(new URL('./worker.mjs', import.meta.url), {
      workerData: {
        profile,
        walletFile: burner.file,
        address: burner.address,
        clientFile,
        runId,
        seed,
        peers,
      },
    });
    this.ready = new Promise((resolve, reject) => {
      let timeout;
      this.rejectReady = (error) => {
        this.clearTimer(timeout);
        reject(error);
      };
      timeout = this.setTimer(() => {
        const error = new Error(`${profile.wallet} worker did not start`);
        void this.retire(error).catch(() => undefined);
        this.rejectReady(error);
      }, 30_000);
      this.worker.on('message', (message) => {
        if (message.type === 'ready') {
          this.clearTimer(timeout);
          resolve(message);
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.clearTimer(pending.timeout);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else {
          const error = new Error(message.error.message);
          Object.assign(error, structuredErrorFields(message.error));
          pending.reject(error);
        }
      });
      this.worker.once('error', this.rejectReady);
    });
    this.worker.on('error', (error) => {
      if (!this.retirement) void this.retire(error).catch(() => undefined);
    });
    this.worker.on('exit', (code) => {
      // Deliberate retirement waits for terminate() before rejecting calls.
      // Any unexpected exit has already stopped the worker, so it is safe to
      // retire and reject immediately, including an unexplained zero exit.
      if (!this.retirement) {
        const error = new Error(`${profile.wallet} worker exited ${code}`);
        this.rejectReady(error);
        this.retiredError = error;
        this.retirement = Promise.resolve().then(() => this.rejectPending(error));
      }
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      this.clearTimer(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  retire(error) {
    if (this.retirement) return this.retirement;
    this.retiredError = error;
    // Defer terminate() itself by a microtask so `this.retirement` is visible
    // before a worker can synchronously emit its deliberate exit event.
    const termination = Promise.resolve().then(() => this.worker.terminate());
    let confirmationTimer;
    const confirmationExpired = new Promise((_, reject) => {
      confirmationTimer = this.setTimer(() => {
        reject(new Error(`worker did not terminate within ${this.terminationTimeoutMs}ms`));
      }, this.terminationTimeoutMs);
    });
    this.retirement = Promise.race([termination, confirmationExpired])
      .then(() => {
        this.clearTimer(confirmationTimer);
        this.rejectPending(error);
      })
      .catch((cause) => {
        this.clearTimer(confirmationTimer);
        const fatal = new ActorRetirementError(this.profile.wallet, cause, error);
        this.retiredError = fatal;
        this.rejectReady(fatal);
        this.rejectPending(fatal);
        throw fatal;
      });
    return this.retirement;
  }

  async call(command, payload) {
    try {
      await this.ready;
    } catch (error) {
      throw this.retiredError ?? error;
    }
    if (this.retiredError) throw this.retiredError;
    const id = `${this.profile.wallet}:${++this.sequence}`;
    const startedAt = this.now();
    return new Promise((resolve, reject) => {
      const timeout = this.setTimer(() => {
        this.clearTimer(timeout);
        const error = new Error(`${this.profile.wallet} ${command} timed out after ${this.timeoutMs}ms`);
        error.durationMs = this.now() - startedAt;
        // Do not reject until termination has stopped any signed fetch running
        // in the worker. The dispatch slot remains occupied until then.
        void this.retire(error).catch(() => undefined);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.worker.postMessage({ id, command, payload });
      } catch (error) {
        void this.retire(error instanceof Error ? error : new Error(String(error)))
          .catch(() => undefined);
      }
    });
  }

  terminate() {
    return this.retire(this.retiredError ?? new Error(`${this.profile.wallet} worker terminated`));
  }
}
