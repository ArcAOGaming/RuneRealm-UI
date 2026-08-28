/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HyperBEAM node that hosts the game process. */
  readonly VITE_HB_NODE?: string;
  /** The game process id, from `live-process.txt` after a deploy. */
  readonly VITE_GAME_PROCESS?: string;
  /** Public wallet address that owns the game process. */
  readonly VITE_GAME_OWNER?: string;
  readonly VITE_MARKET_PROCESS?: string;
  readonly VITE_AMM_PROCESS?: string;
  readonly VITE_RUNE_PROCESS?: string;
  readonly VITE_QUOTE_PROCESS?: string;
  readonly VITE_MARKET_NODE?: string;
  readonly VITE_COLLECTION_PROCESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}

/**
 * The wallet extension injects this. Only the calls actually used are declared,
 * so a typo in a method name is a compile error rather than a runtime one.
 */
interface Window {
  arweaveWallet?: {
    connect(permissions: string[], appInfo?: object): Promise<void>;
    disconnect(): Promise<void>;
    getActiveAddress(): Promise<string>;
    getActivePublicKey?(): Promise<string>;
    getPermissions(): Promise<string[]>;
    signDataItem(item: {
      data: string | Uint8Array;
      target?: string;
      anchor?: string;
      tags?: Array<{ name: string; value: string }>;
    }): Promise<ArrayBuffer>;
    signature?(
      message: Uint8Array,
      algorithm: { name: 'RSA-PSS'; saltLength: number },
    ): Promise<Uint8Array>;
    sign?(transaction: unknown, options?: object): Promise<{
      id: string; owner: string; reward?: string; tags?: any[]; signature: string;
    }>;
    walletName?: string;
    walletVersion?: string;
  };
}
