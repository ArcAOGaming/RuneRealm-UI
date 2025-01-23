import { connect, createDataItemSigner } from "@permaweb/aoconnect";

// Default URLs
const DEFAULT_CONFIG = {
  MU_URL: "https://mu.ao-testnet.xyz",
  CU_URL: "https://cu.ao-testnet.xyz",
  GATEWAY_URL: "https://arweave.net",
};

// Allow for environment variable overrides
export const AO_CONFIG = {
  MU_URL: process.env.REACT_APP_MU_URL || DEFAULT_CONFIG.MU_URL,
  CU_URL: process.env.REACT_APP_CU_URL || DEFAULT_CONFIG.CU_URL,
  GATEWAY_URL: process.env.REACT_APP_GATEWAY_URL || DEFAULT_CONFIG.GATEWAY_URL,
};

// Create a single connection instance
const connection = connect(AO_CONFIG);

// Export individual methods
export const {
  result,
  results,
  message,
  spawn,
  monitor,
  unmonitor,
  dryrun,
} = connection;

// Export createDataItemSigner
export { createDataItemSigner };

// Export the full connection if needed
export default connection;
