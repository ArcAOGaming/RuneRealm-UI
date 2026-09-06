export interface SettleHeadOptions {
  /** Reads the process's computed head, or null when unavailable. */
  readHead: () => Promise<number | null>;
  /** The slot about to be addressed. */
  slot: number;
  /** Head reads, including the first. Default 40. */
  attempts?: number;
  /** Pause after the first miss, in ms. Default 250. */
  delayMs?: number;
  /** Ceiling on one pause, in ms. Each pause doubles up to this. Default 2000. */
  maxDelayMs?: number;
  /** Hard wall-clock bound in ms; 0 means none. Default 30000. */
  budgetMs?: number;
  /** Stop early and return null. */
  isCancelled?: () => boolean;
}

/**
 * Poll until the computed head reaches `slot`. Resolves with the head it saw,
 * or null if it never got there — null means "read the slot anyway", not an
 * error to surface.
 */
export declare function settleHead(options: SettleHeadOptions): Promise<number | null>;
/**
 * `settleHead`, skipped against a process whose head has never once arrived on
 * its own, and re-probed occasionally so the answer can change. `key`
 * identifies the node and process being observed.
 */
export declare function settleHeadIfUseful(
  key: string, options: SettleHeadOptions,
): Promise<number | null>;
export declare function resetSettleObservations(): void;
export default settleHead;
