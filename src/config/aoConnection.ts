import { connect, createDataItemSigner } from "@permaweb/aoconnect";

/**
 * Default configuration for the AO network.
 */
const AO_CONFIG = {
  MU_URL: "https://ur-mu.randao.net",
  CU_URL: "https://ur-cu.randao.net", // Primary CU
  GATEWAY_URL: "https://arweave.net",
};

/**
 * If true, only use the default CU, even if it fails.
 */
const USE_ONLY_DEFAULT_CU = true;

/**
 * Backup Compute Units (CU) in case of failure.
 */
const backupCUs = [
  "https://cu1.randao.net",
  "https://cu2.randao.net",
  "https://ao-testnet.xyz"
  //"https://ar.randao.net/ao/cu",
];

/**
 * Logs messages with timestamps.
 */
function logMessage(level, message, error = null) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${message}`);
  if (error) console.error(error);
}

/**
 * Adds a timeout to a promise to avoid hanging requests.
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logMessage("warn", `⏳ Request timed out after ${ms}ms`);
      reject(new Error("Request timed out"));
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Attempts a request with fallback logic.
 * Always starts with the default CU, and only falls back if it fails.
 */
async function attemptWithFallback(fn, timeout = 15000) {
  if (USE_ONLY_DEFAULT_CU) {
    logMessage("warn", `🔒 Backup CUs disabled. Only using default.`);
    try {
      return await withTimeout(fn(AO_CONFIG.CU_URL), timeout);
    } catch (error) {
      logMessage("error", `❌ Default CU failed, but backups are disabled.`, error);
      throw new Error("🚨 Default CU failed and backups are disabled.");
    }
  }

  // If backups are allowed, attempt them in order
  const cuList = [AO_CONFIG.CU_URL, ...backupCUs];
  for (const cuUrl of cuList) {
    try {
      logMessage("info", `🔄 Trying CU: ${cuUrl}`);
      return await withTimeout(fn(cuUrl), timeout);
    } catch (error) {
      logMessage("warn", `❌ CU Failed: ${cuUrl}`, error);
    }
  }

  throw new Error("🚨 All Compute Units (CUs) failed after retries.");
}


/**
 * Creates a connection instance using the default CU.
 */
const getConnection = () => connect(AO_CONFIG);

/**
 * Wrapped methods with automatic persistent fallback logic.
 */
export const message = async (params) =>
  attemptWithFallback((cu) =>
    connect({ ...AO_CONFIG, CU_URL: cu }).message({
      ...params,
      signer: createDataItemSigner(window.arweaveWallet),
    })
  );

export const result = async (params) =>
  attemptWithFallback((cu) =>
    connect({ ...AO_CONFIG, CU_URL: cu }).result({
      ...params,
    })
  );

export const dryrun = async (params) =>
  attemptWithFallback((cu) =>
    connect({ ...AO_CONFIG, CU_URL: cu }).dryrun({
      ...params,
      signer: createDataItemSigner(window.arweaveWallet),
    })
  );

// Export other methods normally
export const { spawn, monitor, unmonitor } = getConnection();
export { createDataItemSigner };
export default getConnection();
