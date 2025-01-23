interface Window {
  arweaveWallet: {
    connect: (
      permissions: Array<
        | "ACCESS_ADDRESS"
        | "ACCESS_PUBLIC_KEY"
        | "ACCESS_ALL_ADDRESSES"
        | "SIGN_TRANSACTION"
        | "ENCRYPT"
        | "DECRYPT"
        | "SIGNATURE"
        | "ACCESS_ARWEAVE_CONFIG"
        | 'DISPATCH'
      >,
      appInfo?: {
        name?: string;
        logo?: string;
      }
    ) => Promise<void>;
    disconnect: () => Promise<void>;
    getActiveAddress: () => Promise<string>;
    getAllAddresses: () => Promise<string[]>;
    getWalletNames: () => Promise<{ [addr: string]: string }>;
    getPermissions: () => Promise<string[]>;
    getArweaveConfig: () => Promise<{
      host: string;
      port: number;
      protocol: string;
    }>;
    sign: (transaction: unknown) => Promise<unknown>;
    encrypt: (
      data: string,
      options: {
        algorithm: string;
        hash: string;
        salt?: string;
      }
    ) => Promise<Uint8Array>;
    decrypt: (
      data: Uint8Array,
      options: {
        algorithm: string;
        hash: string;
        salt?: string;
      }
    ) => Promise<string>;
    signature: (data: Uint8Array, algorithm: string) => Promise<Uint8Array>;
  };
}

declare global {
  var arweaveWallet: Window['arweaveWallet'];
}
