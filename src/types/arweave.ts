export type ArweavePermissionType = 
    | "ACCESS_ADDRESS"
    | "ACCESS_PUBLIC_KEY"
    | "ACCESS_ALL_ADDRESSES"
    | "SIGN_TRANSACTION"
    | "ENCRYPT"
    | "DECRYPT"
    | "SIGNATURE"
    | "ACCESS_ARWEAVE_CONFIG"
    | "DISPATCH";

export interface ArweaveWallet {
    connect: (permissions: ArweavePermissionType[], appInfo?: {
        name?: string;
        logo?: string;
    }) => Promise<void>;
    disconnect: () => Promise<void>;
    getActiveAddress: () => Promise<string>;
    getAllAddresses: () => Promise<string[]>;
    getWalletNames: () => Promise<{ [addr: string]: string }>;
    getPermissions: () => Promise<ArweavePermissionType[]>;
    getArweaveConfig: () => Promise<any>;
    signature: (data: Uint8Array, algorithm: string) => Promise<Uint8Array>;
    sign: (tx: any, options?: any) => Promise<any>;
    encrypt: (data: Uint8Array, algorithm: string) => Promise<Uint8Array>;
    decrypt: (data: Uint8Array, algorithm: string) => Promise<Uint8Array>;
}

declare global {
    interface Window {
        arweaveWallet: ArweaveWallet;
    }
}

export const REQUIRED_PERMISSIONS: ArweavePermissionType[] = [
    "ACCESS_ADDRESS",
    "ACCESS_PUBLIC_KEY",
    "SIGN_TRANSACTION",
    "SIGNATURE",
    "DISPATCH"
];
