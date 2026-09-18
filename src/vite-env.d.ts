/// <reference types="vite/client" />

// Process ids, nodes and the owner are not env. They come from
// `src/lib/graph.json`, generated from backend/native/deployment-state.json.
interface ImportMetaEnv {
  readonly VITE_ASSET_NODE?: string;
  readonly VITE_ARWEAVE_GATEWAY?: string;
  readonly VITE_SWARM_STREAM_URL?: string;
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
