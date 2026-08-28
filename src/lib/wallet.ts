/**
 * Wallet providers used by the browser client.
 *
 * Rune Realm only needs the ArConnect-compatible surface exposed by Wander
 * and PermawebOS: identify an address,
 * sign ANS-104 data items, and (for asset deposits) sign a base-layer
 * transaction. Keeping that surface here means the game transport does not
 * care whether the signer lives in an extension or in this browser.
 *
 * The local wallet is a real RSA-4096 Arweave JWK. It is stored in IndexedDB,
 * not a cookie: cookies are limited to roughly 4 KB, are sent with HTTP
 * requests, and are the wrong place for private key material. IndexedDB keeps
 * it origin-scoped and out of request headers. It is still an automatically
 * signing hot wallet, so the chooser describes it as a play wallet and offers
 * a recovery-key download as soon as it is created.
 */

export type WalletProviderId = 'injected' | 'permaweb' | 'local';

export type DataItemInput = {
  data: string | Uint8Array;
  target?: string;
  anchor?: string;
  tags?: Array<{ name: string; value: string }>;
};

type SignedTransaction = {
  id: string;
  owner: string;
  reward?: string;
  tags?: any[];
  signature: string;
};

export type ArweaveWallet = {
  walletName?: string;
  walletVersion?: string;
  connect(permissions: string[], appInfo?: object): Promise<void>;
  disconnect(): Promise<void>;
  getActiveAddress(): Promise<string>;
  getActivePublicKey?(): Promise<string>;
  getPermissions(): Promise<string[]>;
  signDataItem(item: DataItemInput): Promise<ArrayBuffer>;
  signature?(
    message: Uint8Array,
    algorithm: { name: 'RSA-PSS'; saltLength: number },
  ): Promise<Uint8Array>;
  sign?(transaction: any, options?: object): Promise<SignedTransaction>;
};

export type WalletConnection = {
  address: string;
  provider: WalletProviderId;
  providerName: string;
  /** True only on the first creation of a browser-local key. */
  created?: boolean;
};

export type WalletAvailability = {
  injected: { available: boolean; name: string };
  permaweb: { available: boolean; name: string };
  local: { available: boolean; address: string | null };
};

export const PERMISSIONS = ['ACCESS_ADDRESS', 'ACCESS_PUBLIC_KEY', 'SIGN_TRANSACTION'];

const DB_NAME = 'rune-realm-wallet';
const DB_VERSION = 1;
const STORE = 'keys';
const LOCAL_KEY = 'device-wallet';
const PROVIDER_KEY = 'rune-realm.wallet-provider';

type StoredWallet = { jwk: JsonWebKey; address: string; createdAt: number };

let selectedWallet: ArweaveWallet | null = null;
let selectedProvider: WalletProviderId | null = null;

const inBrowser = () => typeof window !== 'undefined';

function injectedWallet(): ArweaveWallet | null {
  if (!inBrowser()) return null;
  return window.arweaveWallet ?? null;
}

/** PermawebOS deliberately uses its own namespace so it can coexist with Wander. */
function permawebWallet(): ArweaveWallet | null {
  if (!inBrowser()) return null;
  return (window as Window & { permawebConnect?: ArweaveWallet }).permawebConnect ?? null;
}

function providerPreference(): WalletProviderId | null {
  if (!inBrowser()) return null;
  const value = window.localStorage.getItem(PROVIDER_KEY);
  return value === 'injected' || value === 'permaweb' || value === 'local' ? value : null;
}

function rememberProvider(provider: WalletProviderId | null) {
  if (!inBrowser()) return;
  if (provider) window.localStorage.setItem(PROVIDER_KEY, provider);
  else window.localStorage.removeItem(PROVIDER_KEY);
}

function openWalletDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!inBrowser() || !window.indexedDB) {
      reject(new Error('This browser cannot persist a local wallet.'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open wallet storage.'));
  });
}

async function readStoredWallet(): Promise<StoredWallet | null> {
  const db = await openWalletDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(LOCAL_KEY);
      request.onsuccess = () => resolve((request.result as StoredWallet | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read the local wallet.'));
    });
  } finally {
    db.close();
  }
}

async function storeWallet(wallet: StoredWallet): Promise<void> {
  const db = await openWalletDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(wallet, LOCAL_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the local wallet.'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the local wallet was cancelled.'));
    });
  } finally {
    db.close();
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function addressFor(jwk: JsonWebKey): Promise<string> {
  if (!jwk.n) throw new Error('The wallet has no public key.');
  const digest = await crypto.subtle.digest('SHA-256', base64UrlToBytes(jwk.n));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function generateStoredWallet(): Promise<StoredWallet> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure browser cryptography is unavailable on this device.');
  }
  const pair = await crypto.subtle.generateKey({
    name: 'RSA-PSS',
    modulusLength: 4096,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const wallet = { jwk, address: await addressFor(jwk), createdAt: Date.now() };
  await storeWallet(wallet);
  return wallet;
}

const importPrivateKey = (jwk: JsonWebKey) => crypto.subtle.importKey('jwk', jwk, {
  name: 'RSA-PSS', hash: 'SHA-256',
}, false, ['sign']);

/** Create the exact ANS-104 bytes HyperBEAM accepts from a browser-held JWK. */
export async function signDataItemWithJwk(
  jwk: JsonWebKey,
  input: DataItemInput,
): Promise<ArrayBuffer> {
  if (!jwk.n) throw new Error('The wallet has no public key.');
  const { createData } = await import('@dha-team/arbundles');
  const privateKey = await importPrivateKey(jwk);
  // A structural arbundles Signer backed directly by WebCrypto. Avoiding the
  // package's PEM adapter matters in browsers: that adapter brings in Node's
  // ASN.1/crypto path even though WebCrypto can sign the bytes itself.
  const signer = {
    signatureType: 1,
    signatureLength: 512,
    ownerLength: 512,
    publicKey: Buffer.from(base64UrlToBytes(jwk.n)),
    sign: async (message: Uint8Array) => {
      const bytes = Uint8Array.from(message);
      return new Uint8Array(await crypto.subtle.sign({
        name: 'RSA-PSS', saltLength: 32,
      }, privateKey, bytes));
    },
  };
  const item = createData(input.data, signer, {
    target: input.target,
    anchor: input.anchor,
    tags: input.tags,
  });
  await item.sign(signer);
  // Copy into a plain ArrayBuffer. A Buffer's backing store can be larger than
  // its visible slice, which would append unrelated bytes to the item.
  return Uint8Array.from(item.getRaw()).buffer;
}

/** A small ArConnect-compatible adapter around a persisted JWK. */
function localWallet(stored: StoredWallet): ArweaveWallet {
  return {
    walletName: 'Rune Realm Browser Wallet',
    walletVersion: '1',
    async connect() {},
    async disconnect() {},
    async getActiveAddress() { return stored.address; },
    async getActivePublicKey() {
      if (!stored.jwk.n) throw new Error('The wallet has no public key.');
      return stored.jwk.n;
    },
    async getPermissions() { return [...PERMISSIONS]; },
    async signDataItem(input) { return signDataItemWithJwk(stored.jwk, input); },
    async signature(message, algorithm) {
      const key = await importPrivateKey(stored.jwk);
      return new Uint8Array(await crypto.subtle.sign({
        name: 'RSA-PSS', saltLength: algorithm.saltLength,
      }, key, Uint8Array.from(message)));
    },
    async sign(transaction, options) {
      if (!stored.jwk.n) throw new Error('The wallet has no public key.');
      transaction.setOwner(stored.jwk.n);
      const payload = await transaction.getSignatureData();
      const key = await importPrivateKey(stored.jwk);
      const raw = await crypto.subtle.sign({
        name: 'RSA-PSS',
        saltLength: Number((options as { saltLength?: number } | undefined)?.saltLength ?? 32),
      }, key, payload);
      const id = await crypto.subtle.digest('SHA-256', raw);
      return {
        id: bytesToBase64Url(new Uint8Array(id)),
        owner: stored.jwk.n,
        reward: transaction.reward,
        tags: transaction.tags,
        signature: bytesToBase64Url(new Uint8Array(raw)),
      };
    },
  };
}

async function waitForInjectedWallet(timeoutMs = 900): Promise<ArweaveWallet | null> {
  const present = injectedWallet();
  if (present || !inBrowser()) return present;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('arweaveWalletLoaded', finish);
      resolve(injectedWallet());
    };
    window.addEventListener('arweaveWalletLoaded', finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

async function waitForPermawebWallet(timeoutMs = 900): Promise<ArweaveWallet | null> {
  const present = permawebWallet();
  if (present || !inBrowser()) return present;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('permawebConnectLoaded', finish);
      resolve(permawebWallet());
    };
    window.addEventListener('permawebConnectLoaded', finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

export function getWallet(): ArweaveWallet | null {
  return selectedWallet ?? injectedWallet() ?? permawebWallet();
}

export function getSelectedProvider(): WalletProviderId | null {
  return selectedProvider;
}

export async function walletAvailability(): Promise<WalletAvailability> {
  const [extension, permaweb, stored] = await Promise.all([
    waitForInjectedWallet(250),
    waitForPermawebWallet(250),
    readStoredWallet().catch(() => null),
  ]);
  return {
    injected: {
      available: !!extension,
      name: extension?.walletName || 'Arweave wallet extension',
    },
    permaweb: {
      available: !!permaweb,
      name: 'PermawebOS',
    },
    local: { available: !!stored, address: stored?.address ?? null },
  };
}

export async function connectWallet(provider: WalletProviderId): Promise<WalletConnection> {
  if (provider === 'local') {
    let stored = await readStoredWallet();
    const created = !stored;
    if (!stored) stored = await generateStoredWallet();
    selectedWallet = localWallet(stored);
    selectedProvider = 'local';
    rememberProvider('local');
    return {
      address: stored.address,
      provider: 'local',
      providerName: 'Browser wallet',
      created,
    };
  }

  if (provider === 'permaweb') {
    const wallet = await waitForPermawebWallet();
    if (!wallet) throw new Error('PermawebOS was not detected in this browser.');
    const granted = await wallet.getPermissions().catch(() => [] as string[]);
    if (!PERMISSIONS.every((permission) => granted.includes(permission))) {
      await wallet.connect(PERMISSIONS, { name: 'Rune Realm' });
    }
    const address = await wallet.getActiveAddress();
    selectedWallet = wallet;
    selectedProvider = 'permaweb';
    rememberProvider('permaweb');
    return {
      address,
      provider: 'permaweb',
      providerName: 'PermawebOS',
    };
  }

  const wallet = await waitForInjectedWallet();
  if (!wallet) throw new Error('No Arweave wallet extension was detected.');
  const granted = await wallet.getPermissions().catch(() => [] as string[]);
  if (!PERMISSIONS.every((permission) => granted.includes(permission))) {
    await wallet.connect(PERMISSIONS, { name: 'Rune Realm' });
  }
  const address = await wallet.getActiveAddress();
  selectedWallet = wallet;
  selectedProvider = 'injected';
  rememberProvider('injected');
  return {
    address,
    provider: 'injected',
    providerName: wallet.walletName || 'Wallet extension',
  };
}

/** Restore only a provider the player previously chose (or an already-granted extension). */
export async function restoreWallet(): Promise<WalletConnection | null> {
  const preferred = providerPreference();
  if (preferred === 'local') {
    const stored = await readStoredWallet().catch(() => null);
    if (!stored) return null;
    selectedWallet = localWallet(stored);
    selectedProvider = 'local';
    return { address: stored.address, provider: 'local', providerName: 'Browser wallet' };
  }

  if (preferred === 'permaweb') {
    const wallet = await waitForPermawebWallet();
    if (!wallet) return null;
    const granted = await wallet.getPermissions().catch(() => [] as string[]);
    if (!granted.includes('ACCESS_ADDRESS')) return null;
    const address = await wallet.getActiveAddress().catch(() => null);
    if (!address) return null;
    selectedWallet = wallet;
    selectedProvider = 'permaweb';
    return { address, provider: 'permaweb', providerName: 'PermawebOS' };
  }

  const wallet = await waitForInjectedWallet();
  if (!wallet || (preferred && preferred !== 'injected')) return null;
  const granted = await wallet.getPermissions().catch(() => [] as string[]);
  if (!granted.includes('ACCESS_ADDRESS')) return null;
  const address = await wallet.getActiveAddress().catch(() => null);
  if (!address) return null;
  selectedWallet = wallet;
  selectedProvider = 'injected';
  rememberProvider('injected');
  return {
    address,
    provider: 'injected',
    providerName: wallet.walletName || 'Wallet extension',
  };
}

export async function activeAddress(): Promise<string | null> {
  return (await restoreWallet())?.address ?? null;
}

export async function disconnectWallet(): Promise<void> {
  const wallet = selectedWallet;
  const provider = selectedProvider;
  selectedWallet = null;
  selectedProvider = null;
  rememberProvider(null);
  // Disconnecting a device wallet means ending the session, not destroying
  // the only copy of its key. The saved identity remains selectable next time.
  if (provider === 'injected' || provider === 'permaweb') {
    await wallet?.disconnect().catch(() => {});
  }
}

export async function downloadLocalWallet(): Promise<string> {
  const stored = await readStoredWallet();
  if (!stored) throw new Error('No browser wallet has been created yet.');
  const blob = new Blob([`${JSON.stringify(stored.jwk, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `arweave-keyfile-${stored.address}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return stored.address;
}
