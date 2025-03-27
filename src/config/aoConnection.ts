import { connect, createDataItemSigner } from "@permaweb/aoconnect";

/**
 * Default configuration for the AO network.
 */
const AO_CONFIG = {
  MU_URL: "https://ur-mu.randao.net",
  GATEWAY_URL: "https://arweave.net",
};

/**
 * Compute Units (CU) available for selection.
 */
const computeUnits = [
  "https://cu-lb.randao.net",
  //"https://cu2.randao.net",
  //"https://cu3.randao.net",
  //"https://cu4.randao.net",
  //"https://cu5.randao.net",
  //"https://cu6.randao.net:444",
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
 * Attempts a request with randomized starting CU and fallback logic.
 * If a CU fails, it tries another after 5 seconds.
 */
async function attemptWithFallback(fn, timeout = 15000) {
  let availableCUs = [...computeUnits];
  while (availableCUs.length > 0) {
    // Randomly select a CU
    const index = Math.floor(Math.random() * availableCUs.length);
    const cuUrl = availableCUs.splice(index, 1)[0];
    
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
 * Creates a connection instance using a random CU.
 */
const getConnection = () => {
  const randomCU = computeUnits[Math.floor(Math.random() * computeUnits.length)];
  return connect({ ...AO_CONFIG, CU_URL: randomCU });
};

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
