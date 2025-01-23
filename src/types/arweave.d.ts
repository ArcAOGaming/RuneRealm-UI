declare global {
    type ArweavePermissionType = 
        | "ACCESS_ADDRESS"
        | "ACCESS_PUBLIC_KEY"
        | "ACCESS_ALL_ADDRESSES"
        | "SIGN_TRANSACTION"
        | "ENCRYPT"
        | "DECRYPT"
        | "SIGNATURE"
        | "ACCESS_ARWEAVE_CONFIG"
        | "DISPATCH";

    interface ArweaveWallet {
        connect(permissions: ArweavePermissionType[], appInfo?: {
            name?: string;
            logo?: string;
        }): Promise<void>;
        disconnect(): Promise<void>;
        getActiveAddress(): Promise<string>;
        getAllAddresses(): Promise<string[]>;
        getWalletNames(): Promise<{ [addr: string]: string }>;
        signature(data: Uint8Array, algorithm: string): Promise<Uint8Array>;
        sign(tx: any, options?: any): Promise<any>;
    }

    interface Window {
        arweaveWallet: ArweaveWallet;
    }
}

// Export types for use in other files
export type { ArweaveWallet, ArweavePermissionType };
