import { connect, createDataItemSigner } from "@permaweb/aoconnect";

/**
 * Default configuration for the AO network.
 */
const AO_CONFIG = {
  MU_URL: "https://ur-mu.randao.net",
  GATEWAY_URL: "https://arweave.net",
  MODE: "legacy" as "legacy", // Required by the connect function with literal type
};

/**
 * Compute Units (CU) available for selection.
 */
const computeUnits = [
  "https://ur-cu.randao.net",
  // "https://cu.ao-testnet.xyz",
].filter(Boolean); // Filter out any undefined or empty strings

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
    let timer: NodeJS.Timeout;
    
    // Set up the timeout
    if (ms > 0) {
      timer = setTimeout(() => {
        logMessage("warn", `⏳ Request timed out after ${ms}ms`);
        reject(new Error(`Request timed out after ${ms}ms`));
      }, ms);
    }

    promise
      .then((res) => {
        if (timer) clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        logMessage("error", `Request failed: ${err.message}`, err);
        reject(err);
      });
  });
}

/**
 * Attempts a request with randomized starting CU and fallback logic.
 * If a CU fails, it tries another after 5 seconds.
 */
async function attemptWithFallback(fn, timeout = 30000) { // Increased default timeout to 30s
  if (computeUnits.length === 0) {
    throw new Error("No Compute Units available");
  }

  let lastError: Error | null = null;
  const availableCUs = [...computeUnits];
  
  // Try each CU once in random order
  while (availableCUs.length > 0) {
    const index = Math.floor(Math.random() * availableCUs.length);
    const cuUrl = availableCUs.splice(index, 1)[0];
    
    try {
      logMessage("info", `🔄 Attempting request on CU: ${cuUrl}`);
      const result = await withTimeout(fn(cuUrl), timeout);
      logMessage("info", `✅ Request successful on CU: ${cuUrl}`);
      return result;
    } catch (error) {
      lastError = error;
      logMessage("warn", `❌ Request failed on CU ${cuUrl}: ${error.message}`);
      
      // If we have more CUs to try, log and continue
      if (availableCUs.length > 0) {
        logMessage("info", `🔄 ${availableCUs.length} CUs remaining to try...`);
      }
    }
  }
  
  // If we get here, all CUs failed
  const errorMessage = `🚨 All ${computeUnits.length} Compute Units failed. Last error: ${lastError?.message || 'Unknown error'}`;
  logMessage("error", errorMessage, lastError);
  throw new Error(errorMessage);
}

/**
 * Creates a connection instance using a random CU.
 */
const getConnection = () => {
  const randomCU = computeUnits[Math.floor(Math.random() * computeUnits.length)];
  return connect({ ...AO_CONFIG, CU_URL: randomCU });
};

/**
 * Wrapped methods with automatic persistent fallback logic.
 */
export const message = async (params) => {
  // Extract muUrl if provided in params, otherwise use default
  const { muUrl, ...restParams } = params;
  const config = { 
    ...AO_CONFIG, // This includes MODE: "legacy"
    ...(muUrl ? { MU_URL: muUrl } : {}) // Override MU_URL if provided
  };
  
  return attemptWithFallback((cu) =>
    connect({ ...config, CU_URL: cu }).message({
      ...restParams,
      signer: createDataItemSigner(window.arweaveWallet),
    })
  );
};

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
