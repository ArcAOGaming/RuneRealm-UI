// <define:import.meta.env>
var define_import_meta_env_default = { VITE_GAME_PROCESS: "gkpGbFDjwEqUcj47X6BGMOY1qyDuM7W_9LfLDv_jwUc", VITE_HB_NODE: "https://hyperbeam.tylerw.ai", VITE_GAME_OWNER: "DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8", VITE_RUNE_PROCESS: "LXgcav_zNCPz55uOKIFd2lPxCaKzpfc4gdErwxWLz7c", VITE_MARKET_NODE: "https://hyperbeam.tylerw.ai" };

// src/lib/wallet.ts
var PERMISSIONS = ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "SIGN_TRANSACTION"];
var DB_NAME = "rune-realm-wallet";
var DB_VERSION = 1;
var STORE = "keys";
var LOCAL_KEY = "device-wallet";
var PROVIDER_KEY = "rune-realm.wallet-provider";
var selectedWallet = null;
var selectedProvider = null;
var inBrowser = () => typeof globalThis !== "undefined";
function injectedWallet() {
  if (!inBrowser()) return null;
  return globalThis.arweaveWallet ?? null;
}
function permawebWallet() {
  if (!inBrowser()) return null;
  return globalThis.permawebConnect ?? null;
}
function storage() {
  if (!inBrowser()) return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function providerPreference() {
  let value = null;
  try {
    value = storage()?.getItem(PROVIDER_KEY) ?? null;
  } catch {
    return null;
  }
  return value === "injected" || value === "permaweb" || value === "local" ? value : null;
}
function rememberProvider(provider) {
  const store = storage();
  if (!store) return;
  try {
    if (provider) store.setItem(PROVIDER_KEY, provider);
    else store.removeItem(PROVIDER_KEY);
  } catch {
  }
}
function openWalletDb() {
  return new Promise((resolve, reject) => {
    if (!inBrowser() || !globalThis.indexedDB) {
      reject(new Error("This browser cannot persist a local wallet."));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open wallet storage."));
  });
}
async function readStoredWallet() {
  const db = await openWalletDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(LOCAL_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local wallet."));
    });
  } finally {
    db.close();
  }
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
var importPrivateKey = (jwk) => crypto.subtle.importKey("jwk", jwk, {
  name: "RSA-PSS",
  hash: "SHA-256"
}, false, ["sign"]);
async function signDataItemWithJwk(jwk, input) {
  if (!jwk.n) throw new Error("The wallet has no public key.");
  const { createData } = await import("@dha-team/arbundles");
  const privateKey = await importPrivateKey(jwk);
  const signer = {
    signatureType: 1,
    signatureLength: 512,
    ownerLength: 512,
    publicKey: Buffer.from(base64UrlToBytes(jwk.n)),
    sign: async (message) => {
      const bytes = Uint8Array.from(message);
      return new Uint8Array(await crypto.subtle.sign({
        name: "RSA-PSS",
        saltLength: 32
      }, privateKey, bytes));
    }
  };
  const item = createData(input.data, signer, {
    target: input.target,
    anchor: input.anchor,
    tags: input.tags
  });
  await item.sign(signer);
  return Uint8Array.from(item.getRaw()).buffer;
}
function localWallet(stored) {
  return {
    walletName: "Rune Realm Browser Wallet",
    walletVersion: "1",
    async connect() {
    },
    async disconnect() {
    },
    async getActiveAddress() {
      return stored.address;
    },
    async getActivePublicKey() {
      if (!stored.jwk.n) throw new Error("The wallet has no public key.");
      return stored.jwk.n;
    },
    async getPermissions() {
      return [...PERMISSIONS];
    },
    async signDataItem(input) {
      return signDataItemWithJwk(stored.jwk, input);
    },
    async signature(message, algorithm) {
      const key = await importPrivateKey(stored.jwk);
      return new Uint8Array(await crypto.subtle.sign({
        name: "RSA-PSS",
        saltLength: algorithm.saltLength
      }, key, Uint8Array.from(message)));
    },
    async sign(transaction, options) {
      if (!stored.jwk.n) throw new Error("The wallet has no public key.");
      transaction.setOwner(stored.jwk.n);
      const payload = await transaction.getSignatureData();
      const key = await importPrivateKey(stored.jwk);
      const raw = await crypto.subtle.sign({
        name: "RSA-PSS",
        saltLength: Number(options?.saltLength ?? 32)
      }, key, payload);
      const id = await crypto.subtle.digest("SHA-256", raw);
      return {
        id: bytesToBase64Url(new Uint8Array(id)),
        owner: stored.jwk.n,
        reward: transaction.reward,
        tags: transaction.tags,
        signature: bytesToBase64Url(new Uint8Array(raw))
      };
    }
  };
}
async function waitForInjectedWallet(timeoutMs = 900) {
  const present = injectedWallet();
  if (present || !inBrowser()) return present;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.removeEventListener("arweaveWalletLoaded", finish);
      resolve(injectedWallet());
    };
    globalThis.addEventListener("arweaveWalletLoaded", finish, { once: true });
    globalThis.setTimeout(finish, timeoutMs);
  });
}
async function waitForPermawebWallet(timeoutMs = 900) {
  const present = permawebWallet();
  if (present || !inBrowser()) return present;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.removeEventListener("permawebConnectLoaded", finish);
      resolve(permawebWallet());
    };
    globalThis.addEventListener("permawebConnectLoaded", finish, { once: true });
    globalThis.setTimeout(finish, timeoutMs);
  });
}
function getWallet() {
  return selectedWallet ?? injectedWallet() ?? permawebWallet();
}
function extensionLabel(name) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Wallet extension";
  return /^arconnect(\s|$)/i.test(trimmed) ? "Wander" : trimmed;
}
async function restoreWallet() {
  const preferred = providerPreference();
  if (preferred === "local") {
    const stored = await readStoredWallet().catch(() => null);
    if (!stored) return null;
    selectedWallet = localWallet(stored);
    selectedProvider = "local";
    return { address: stored.address, provider: "local", providerName: "Browser wallet" };
  }
  if (preferred === "permaweb") {
    const wallet2 = await waitForPermawebWallet();
    if (!wallet2) return null;
    const granted2 = await wallet2.getPermissions().catch(() => []);
    if (!granted2.includes("ACCESS_ADDRESS")) return null;
    const address2 = await wallet2.getActiveAddress().catch(() => null);
    if (!address2) return null;
    selectedWallet = wallet2;
    selectedProvider = "permaweb";
    return { address: address2, provider: "permaweb", providerName: "PermawebOS" };
  }
  const wallet = await waitForInjectedWallet();
  if (!wallet || preferred && preferred !== "injected") return null;
  const granted = await wallet.getPermissions().catch(() => []);
  if (!granted.includes("ACCESS_ADDRESS")) return null;
  const address = await wallet.getActiveAddress().catch(() => null);
  if (!address) return null;
  selectedWallet = wallet;
  selectedProvider = "injected";
  rememberProvider("injected");
  return {
    address,
    provider: "injected",
    providerName: extensionLabel(wallet.walletName)
  };
}
async function activeAddress() {
  return (await restoreWallet())?.address ?? null;
}

// src/lib/slot-settle.mjs
var wait = (ms, isCancelled) => new Promise((resolve) => {
  if (ms <= 0 || isCancelled && isCancelled()) {
    resolve();
    return;
  }
  setTimeout(resolve, ms);
});
async function settleHead({
  readHead,
  slot,
  attempts = 40,
  delayMs = 250,
  maxDelayMs = 2e3,
  budgetMs = 3e4,
  isCancelled
}) {
  const target = Number(slot);
  if (!Number.isSafeInteger(target) || target < 0) return null;
  const tries = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const first = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  const cap = Number.isFinite(maxDelayMs) && maxDelayMs > 0 ? Math.max(first, maxDelayMs) : first;
  const deadline = Number.isFinite(budgetMs) && budgetMs > 0 ? Date.now() + budgetMs : Number.POSITIVE_INFINITY;
  let pause = first;
  for (let i = 0; i < tries; i += 1) {
    if (isCancelled && isCancelled()) return null;
    let at = null;
    try {
      at = await readHead();
    } catch {
      at = null;
    }
    if (at !== null && at !== void 0 && Number.isSafeInteger(at) && at >= target) return at;
    const left = deadline - Date.now();
    if (left <= 0 || i + 1 >= tries) break;
    await wait(Math.min(pause, left), isCancelled);
    pause = cap > 0 ? Math.min(cap, Math.max(1, pause) * 2) : 0;
  }
  return null;
}
var observed = /* @__PURE__ */ new Map();
var REPROBE_EVERY = 16;
async function settleHeadIfUseful(key, options) {
  const seen = observed.get(key) || { advances: null, skipped: 0 };
  if (seen.advances === false && seen.skipped < REPROBE_EVERY) {
    seen.skipped += 1;
    observed.set(key, seen);
    return null;
  }
  const at = await settleHead(options);
  observed.set(key, { advances: at !== null, skipped: 0 });
  return at;
}
function resetSettleObservations() {
  observed.clear();
}

// src/lib/hyperbeam.ts
var env = define_import_meta_env_default ?? {};
var HB_NODE = env.VITE_HB_NODE || "https://hyperbeam.tylerw.ai";
var HB_NODES = [
  HB_NODE,
  "https://schedule.forward.computer"
].filter((n, i, a) => a.indexOf(n) === i);
var GAME_PROCESS = env.VITE_GAME_PROCESS || "1ClF-d5Cfe17Gyx-Qg6BeprJT9lkPIxbslfl6smg23Q";
var HUNT_PROCESS = env.VITE_HUNT_PROCESS || "jk4tQMDYN4b0u77wTN1W-kr_Gx84BmR5I5PulwTAlo0";
var HUNT_NODE = env.VITE_HUNT_NODE || "https://hyperbeam.tylerw.ai";
var GAME_OWNER = env.VITE_GAME_OWNER || "DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8";
var AO_TAGS = [
  { name: "data-protocol", value: "ao" },
  { name: "variant", value: "ao.N.1" }
];
var NetworkError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "NetworkError";
  }
};
var AmbiguousWriteError = class extends NetworkError {
  constructor(message, status, cause) {
    super(`${message} The message may already be scheduled; do not retry it.`, status);
    this.cause = cause;
    this.name = "AmbiguousWriteError";
  }
  scheduledUnknown = true;
};
var OutboxDeliveryError = class extends NetworkError {
  accepted = true;
  durable = true;
  slot;
  action;
  completed;
  /**
   * What the push itself answered, and what the confirmation read concluded.
   *
   * Both are diagnostics, never a verdict — `pushStatus` is 500 on this node
   * for every SUCCESSFUL withdrawal (see `deliverSlot`), so a human reading
   * this error should reconcile against published state and not against the
   * code. `confirmed` is null when nothing could confirm and the status was all
   * there was to go on. (`status`, from `NetworkError`, stays unset here: this
   * error is not itself an HTTP failure.)
   */
  pushStatus;
  confirmed;
  constructor({ slot, action, completed, cause, pushStatus = null, confirmed = null }) {
    super(
      `${action} ${completed ? "completed" : "was accepted"} at slot ${slot}, but its required outbox delivery could not be confirmed. Do not retry the game action; reconcile the downstream delivery instead.`
    );
    this.name = "OutboxDeliveryError";
    this.slot = slot;
    this.action = action;
    this.completed = completed;
    this.pushStatus = pushStatus;
    this.confirmed = confirmed;
    if (cause !== void 0) this.cause = cause;
  }
};
var AcceptedWriteError = class extends NetworkError {
  accepted = true;
  durable = true;
  completed = null;
  slot;
  action;
  constructor({ slot, action, cause }) {
    super(
      `${action ?? "The message"} was accepted durably at slot ${slot}, but its reply could not be read. Do not retry the action; reconcile the accepted slot or published state.`
    );
    this.name = "AcceptedWriteError";
    this.slot = slot;
    this.action = action;
    if (cause !== void 0) this.cause = cause;
  }
};
var clean = (node) => node.replace(/\/$/, "");
async function getText(url, signal) {
  const res = await fetch(url, { headers: { accept: "text/plain" }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`read failed: ${res.status}`, res.status);
  return (await res.text()).trim();
}
async function readState(key, opts = {}) {
  const pid = opts.process ?? GAME_PROCESS;
  const nodes = opts.node ? [opts.node] : HB_NODES;
  let first;
  for (const node of nodes) {
    try {
      return await getText(`${clean(node)}/${pid}~process@1.0/now/${key}`, opts.signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      first = first ?? err;
    }
  }
  throw first instanceof Error ? first : new NetworkError("all nodes failed");
}
async function readJSON(key, opts = {}) {
  const text = await readState(key, opts);
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
var transportObserver = null;
function setTransportObserver(fn) {
  transportObserver = fn;
}
function observeTransport(timing) {
  if (!transportObserver) return;
  try {
    transportObserver(timing);
  } catch {
  }
}
var SAFE_SCHEDULE_FALLBACK_STATUSES = /* @__PURE__ */ new Set([404, 429]);
var writeSink = null;
async function sendMessage({
  process: pid = GAME_PROCESS,
  tags: tags2 = [],
  data = "",
  node,
  signal,
  onPhase
}) {
  const tEnter = performance.now();
  const wallet = getWallet();
  if (!wallet) throw new NetworkError("No Arweave wallet connected.");
  const fields = /* @__PURE__ */ new Map();
  const put = (name, value) => {
    if (value === void 0 || value === null) return;
    fields.set(String(name).toLowerCase(), String(value));
  };
  put("type", "Message");
  for (const t of AO_TAGS) put(t.name, t.value);
  for (const t of tags2) put(t.name, t.value);
  put("random-seed", String(Math.floor(Math.random() * 1e9)));
  const action = fields.get("action")?.toLowerCase() ?? null;
  const tSign = performance.now();
  onPhase?.("signing");
  const signed = await wallet.signDataItem({
    data,
    target: pid,
    tags: [...fields].map(([name, value]) => ({ name, value }))
  });
  const body = new Uint8Array(signed);
  const tSigned = performance.now();
  onPhase?.("settling");
  const nodes = node ? [node] : HB_NODES;
  let first;
  for (const candidate of nodes) {
    if (signal?.aborted) throw new DOMException("The scheduling request was aborted.", "AbortError");
    const url = `${clean(candidate)}/${pid}~process@1.0/schedule?codec-device=ans104@1.0`;
    let res;
    const tPost = performance.now();
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/ans104", "accept-bundle": "true" },
        body,
        signal
      });
    } catch (err) {
      throw new AmbiguousWriteError(
        `The scheduling request to ${candidate} ended without a response.`,
        void 0,
        err
      );
    }
    if (!res.ok) {
      let detail = res.headers.get("details") ?? "";
      if (!detail) {
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
        }
      }
      const message = `HyperBEAM ${res.status}: ${detail || res.statusText || "schedule failed"}`;
      if (res.status === 408 || res.status === 409 || res.status >= 500) {
        throw new AmbiguousWriteError(message, res.status);
      }
      const rejected = new NetworkError(message, res.status);
      if (!SAFE_SCHEDULE_FALLBACK_STATUSES.has(res.status)) throw rejected;
      first = first ?? rejected;
      continue;
    }
    const tAccepted = performance.now();
    const rawSlot = res.headers.get("slot");
    const slot = rawSlot === null ? Number.NaN : Number(rawSlot);
    if (!Number.isSafeInteger(slot) || slot < 0) {
      throw new AmbiguousWriteError(
        `HyperBEAM accepted the message but returned an invalid slot (${rawSlot ?? "missing"}).`,
        res.status
      );
    }
    return {
      slot,
      id: res.headers.get("id"),
      node: candidate,
      action,
      // buildMs is measured from the top of this function and sendMs to the
      // accepted response, so a node that had to be failed over is charged
      // here rather than disappearing between the phases.
      timing: {
        buildMs: tSign - tEnter,
        signMs: tSigned - tSign,
        postMs: tAccepted - tPost,
        sendMs: tAccepted - tEnter,
        bytes: body.byteLength
      }
    };
  }
  throw first instanceof Error ? first : new NetworkError("all nodes rejected the write");
}
var OUTBOX_ACTIONS = /* @__PURE__ */ new Set(["rune.withdraw"]);
var PUSH_TIMEOUT_MS = 9e4;
var CONFIRM_TIMEOUT_MS = PUSH_TIMEOUT_MS;
var CONFIRM_INTERVAL_MS = 750;
async function pushSlot(slot, { process: pid = GAME_PROCESS, node = HB_NODE, signal } = {}) {
  try {
    const res = await fetch(`${clean(node)}/${pid}~process@1.0/push&slot=${slot}`, { signal });
    return { responded: true, status: res.status, ok: res.ok };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { responded: false, status: null, ok: false };
  }
}
var inFlightPushes = /* @__PURE__ */ new Set();
function pendingDeliveries() {
  return Promise.allSettled([...inFlightPushes]).then(() => void 0);
}
async function deliverSlot(slot, {
  process: pid = GAME_PROCESS,
  node = HB_NODE,
  timeoutMs = PUSH_TIMEOUT_MS,
  confirm,
  confirmTimeoutMs = CONFIRM_TIMEOUT_MS,
  confirmIntervalMs = CONFIRM_INTERVAL_MS
} = {}) {
  const pushWindow = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PUSH_TIMEOUT_MS;
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), pushWindow);
  const landed = { value: null };
  const outcome = pushSlot(slot, { process: pid, node, signal: controller.signal }).catch(() => ({ responded: false, status: null, ok: false })).then((result) => {
    clearTimeout(guard);
    landed.value = result;
    inFlightPushes.delete(outcome);
    return result;
  });
  inFlightPushes.add(outcome);
  if (!confirm) {
    const result = await outcome;
    return { delivered: result.ok, confirmed: null, status: result.status, responded: result.responded };
  }
  const budget = Number.isFinite(confirmTimeoutMs) && confirmTimeoutMs > 0 ? confirmTimeoutMs : CONFIRM_TIMEOUT_MS;
  const gap = Number.isFinite(confirmIntervalMs) && confirmIntervalMs >= 0 ? confirmIntervalMs : CONFIRM_INTERVAL_MS;
  const deadline = Date.now() + budget;
  let confirmed = false;
  for (; ; ) {
    confirmed = await confirm().catch(() => false);
    if (confirmed) break;
    if (Date.now() + gap >= deadline) break;
    if (gap > 0) await new Promise((resolve) => {
      setTimeout(resolve, gap);
    });
  }
  return {
    delivered: confirmed,
    confirmed,
    status: landed.value?.status ?? null,
    responded: landed.value?.responded ?? false
  };
}
function throwIfCancelled(signal, error) {
  if (signal?.aborted) {
    throw signal.reason ?? error ?? new DOMException("The request was aborted.", "AbortError");
  }
  const name = error?.name;
  if (name === "AbortError" || name === "TimeoutError") throw error;
}
async function abortableDelay(ms, signal) {
  if (ms <= 0) return;
  throwIfCancelled(signal);
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
async function computedSlot(pid, node, signal) {
  try {
    const text = await getText(`${clean(node)}/${pid}~process@1.0/now/at-slot`, signal);
    if (text === null || text.trim() === "") return null;
    const value = Number(text.trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch (err) {
    throwIfCancelled(signal, err);
    return null;
  }
}
async function readSlot(slot, {
  process: pid = GAME_PROCESS,
  node = HB_NODE,
  attempts = 12,
  delayMs = 500,
  maxDelayMs = 4e3,
  timeoutMs = 25e3,
  settleHeadMs = 1200,
  signal,
  onAttempt
} = {}) {
  throwIfCancelled(signal);
  const url = `${clean(node)}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`;
  const pollAttempts = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const baseWaitMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  const capWaitMs = Number.isFinite(maxDelayMs) && maxDelayMs > 0 ? Math.max(baseWaitMs, maxDelayMs) : baseWaitMs;
  const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  let lastError = null;
  let deadline = Number.POSITIVE_INFINITY;
  const remainingMs = () => deadline - Date.now();
  const readReply = async () => {
    onAttempt?.();
    const text = await getText(url, signal);
    if (text === null || text === "") return { found: false };
    try {
      return { found: true, value: JSON.parse(text) };
    } catch {
      return { found: true, value: text };
    }
  };
  const readCachedReply = async () => {
    const cachedAttempts = Math.max(1, Math.min(6, pollAttempts));
    for (let i = 0; i < cachedAttempts; i++) {
      throwIfCancelled(signal);
      try {
        const reply = await readReply();
        if (reply.found) return reply.value;
        lastError = null;
      } catch (err) {
        throwIfCancelled(signal, err);
        lastError = err instanceof Error ? err : new NetworkError(String(err));
      }
      if (i + 1 >= cachedAttempts) break;
      const left = remainingMs();
      if (left <= 0) break;
      const pause = Math.min(baseWaitMs, left);
      if (pause > 0) await abortableDelay(pause, signal);
    }
    throw new NetworkError(
      lastError ? `Could not read the cached reply for slot ${slot}: ${lastError.message}.` : `The process completed slot ${slot}, but its reply is not available.`
    );
  };
  await settleHeadIfUseful(`${clean(node)}|${pid}`, {
    readHead: () => computedSlot(pid, node, signal),
    slot,
    attempts: 4,
    delayMs: 150,
    maxDelayMs: 400,
    budgetMs: Math.min(settleHeadMs, budgetMs > 0 ? budgetMs : settleHeadMs),
    isCancelled: () => signal?.aborted === true
  });
  throwIfCancelled(signal);
  try {
    const reply = await readReply();
    if (reply.found) return reply.value;
    lastError = null;
  } catch (err) {
    throwIfCancelled(signal, err);
    lastError = err instanceof Error ? err : new NetworkError(String(err));
  }
  deadline = budgetMs > 0 ? Date.now() + budgetMs : Number.POSITIVE_INFINITY;
  let waitedMs = 0;
  let nextWaitMs = baseWaitMs;
  for (let i = 0; i < pollAttempts; i++) {
    throwIfCancelled(signal);
    if (i > 0) {
      const left = remainingMs();
      if (left <= 0) break;
      const pause = Math.min(nextWaitMs, left);
      if (pause > 0) {
        await abortableDelay(pause, signal);
        waitedMs += pause;
      }
      nextWaitMs = capWaitMs > 0 ? Math.min(capWaitMs, nextWaitMs * 2) : 0;
    }
    const at = await computedSlot(pid, node, signal);
    if (at !== null && at >= slot) return readCachedReply();
    if (remainingMs() <= 0) break;
  }
  const waited = (waitedMs / 1e3).toFixed(1);
  throw new NetworkError(
    lastError ? `Could not read the reply for slot ${slot} after one compute request and ${waited}s of cached recovery polling: ${lastError.message}. The message was scheduled, so this is a read problem rather than a lost action.` : `No reply for slot ${slot} after one compute request and ${waited}s of cached recovery polling. The message was scheduled and is durable, so do not submit it again.`
  );
}
async function sendProbed(tags2, {
  data = "",
  process: pid = GAME_PROCESS,
  node,
  signal,
  readOptions,
  deliveryOptions,
  requiredOutbox
} = {}, probe) {
  const onPhase = writeSink ?? void 0;
  const sent = await sendMessage({ process: pid, tags: tags2, data, node, signal, onPhase });
  probe.sent = sent;
  let reply;
  let readError;
  const countAttempt = () => {
    probe.attempts++;
  };
  const tRead = performance.now();
  try {
    reply = await readSlot(sent.slot, {
      process: pid,
      node: sent.node,
      signal,
      ...readOptions,
      onAttempt: countAttempt
    });
  } catch (error) {
    readError = error;
  }
  probe.readMs = performance.now() - tRead;
  if (readError !== void 0) {
    try {
      reply = await readSlot(sent.slot, {
        process: pid,
        node: sent.node,
        signal,
        ...readOptions,
        attempts: 6,
        delayMs: 1e3,
        maxDelayMs: 8e3,
        timeoutMs: 3e4,
        onAttempt: countAttempt
      });
      readError = void 0;
    } catch {
    }
    probe.readMs = performance.now() - tRead;
  }
  const handlerRejected = readError === void 0 && reply !== null && typeof reply === "object" && "error" in reply && Boolean(reply.error);
  const explicitlyRequired = requiredOutbox === true || typeof requiredOutbox === "function" && readError === void 0 && requiredOutbox(reply);
  if (sent.action && (OUTBOX_ACTIONS.has(sent.action) || explicitlyRequired) && !handlerRejected) {
    const delivery = await deliverSlot(sent.slot, {
      process: pid,
      node: sent.node,
      ...deliveryOptions
    });
    if (!delivery.delivered) {
      throw new OutboxDeliveryError({
        slot: sent.slot,
        action: sent.action,
        completed: readError === void 0,
        cause: readError,
        pushStatus: delivery.status,
        confirmed: delivery.confirmed
      });
    }
  }
  if (readError !== void 0) {
    throw new AcceptedWriteError({ slot: sent.slot, action: sent.action, cause: readError });
  }
  return reply;
}
async function send(tags2, options = {}) {
  if (!transportObserver) return sendProbed(tags2, options, { attempts: 0 });
  const started = performance.now();
  const probe = { attempts: 0 };
  const report = (ok, error) => {
    const t = probe.sent?.timing;
    observeTransport({
      action: probe.sent?.action ?? null,
      slot: probe.sent?.slot ?? null,
      node: probe.sent?.node ?? options.node ?? HB_NODE,
      buildMs: t?.buildMs ?? 0,
      signMs: t?.signMs ?? 0,
      // With no accepted response there is no phase split to report, so the
      // whole wait is charged to the POST — which is where it was spent.
      postMs: t?.postMs ?? (probe.sent ? 0 : performance.now() - started),
      sendMs: t?.sendMs ?? performance.now() - started,
      readMs: probe.readMs,
      attempts: probe.attempts || void 0,
      bytes: t?.bytes ?? 0,
      ok,
      ...error === void 0 ? {} : {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      }
    });
  };
  try {
    const reply = await sendProbed(tags2, options, probe);
    report(true);
    return reply;
  } catch (error) {
    report(false, error);
    throw error;
  }
}

// src/generated/monster-index.ts
var GENERATED_MONSTER_INDEX = {
  "schemaVersion": 1,
  "catalogHash": "6ac6239de9467c79",
  "title": "Monster Index",
  "nextEntryNo": 94,
  "entries": [
    {
      "entryNo": 1,
      "entryKey": "fire-doge-s1",
      "lineKey": "fire-doge",
      "stage": 1,
      "displayName": "FireFox",
      "workingName": "FireFox",
      "affinity": "fire",
      "starterFaction": "Inferno Blades",
      "evolution": {
        "from": null,
        "to": 2,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "live",
        "starter": true,
        "huntCatchable": true,
        "huntWeight": 100
      },
      "assets": {
        "portrait": {
          "status": "approved",
          "path": "entries/001-fire-doge-s1/portrait/portrait.png"
        },
        "world": {
          "status": "approved",
          "path": "entries/001-fire-doge-s1/animations/atlas.png"
        },
        "basicAttack": {
          "status": "approved",
          "path": "entries/001-fire-doge-s1/animations/atlas.png"
        },
        "advancedAttack": {
          "status": "approved",
          "path": "entries/001-fire-doge-s1/animations/atlas.png"
        },
        "runtimeAtlas": {
          "status": "approved",
          "path": "entries/001-fire-doge-s1/animations/atlas.json"
        }
      },
      "plan": {
        "appearance": "The released compact orange-red canine with pointed ears and a curled flame tail.",
        "basicAttack": "Scorching Ash \u2014 A fast shoulder-and-paw strike using the existing physical motion language.",
        "advancedAttack": "Inferno \u2014 A committed forward flame release with a clear wind-up, impact, and recovery."
      },
      "artRevision": "9fb8b8da049c2efc"
    },
    {
      "entryNo": 2,
      "entryKey": "fire-doge-s2",
      "lineKey": "fire-doge",
      "stage": 2,
      "displayName": "EmberFox",
      "workingName": "EmberFox",
      "affinity": "fire",
      "starterFaction": "Inferno Blades",
      "evolution": {
        "from": 1,
        "to": 3,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A taller lean fox with a broader ember mane, longer legs, and the original curled tail burning more steadily.",
        "basicAttack": "Firenado \u2014 A fast shoulder-and-paw strike using the existing physical motion language.",
        "advancedAttack": "Phoenix Burst \u2014 A committed forward flame release with a clear wind-up, impact, and recovery."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 3,
      "entryKey": "fire-doge-s3",
      "lineKey": "fire-doge",
      "stage": 3,
      "displayName": "PyreFox",
      "workingName": "PyreFox",
      "affinity": "fire",
      "starterFaction": "Inferno Blades",
      "evolution": {
        "from": 2,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A powerful adult fox with a heavy chest, swept flame crest, and a wide tail shaped like a controlled furnace plume.",
        "basicAttack": "Inferno \u2014 A fast shoulder-and-paw strike using the existing physical motion language.",
        "advancedAttack": "Phoenix Burst \u2014 A committed forward flame release with a clear wind-up, impact, and recovery."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 4,
      "entryKey": "water-doge-s1",
      "lineKey": "water-doge",
      "stage": 1,
      "displayName": "WaterDoge",
      "workingName": "WaterDoge",
      "affinity": "water",
      "starterFaction": "Aqua Guardians",
      "evolution": {
        "from": null,
        "to": 5,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "live",
        "starter": true,
        "huntCatchable": true,
        "huntWeight": 100
      },
      "assets": {
        "portrait": {
          "status": "approved",
          "path": "entries/004-water-doge-s1/portrait/portrait.png"
        },
        "world": {
          "status": "approved",
          "path": "entries/004-water-doge-s1/animations/atlas.png"
        },
        "basicAttack": {
          "status": "approved",
          "path": "entries/004-water-doge-s1/animations/atlas.png"
        },
        "advancedAttack": {
          "status": "approved",
          "path": "entries/004-water-doge-s1/animations/atlas.png"
        },
        "runtimeAtlas": {
          "status": "approved",
          "path": "entries/004-water-doge-s1/animations/atlas.json"
        }
      },
      "plan": {
        "appearance": "The released compact blue water dog with pointed ears and a curled current tail.",
        "basicAttack": "Whirlpool \u2014 A short physical rush supported by a low splash.",
        "advancedAttack": "Tidal Wave \u2014 A broad water surge that grows from a compact current and breaks forward."
      },
      "artRevision": "2d2eb82215dc88b3"
    },
    {
      "entryNo": 5,
      "entryKey": "water-doge-s2",
      "lineKey": "water-doge",
      "stage": 2,
      "displayName": "RillDoge",
      "workingName": "RillDoge",
      "affinity": "water",
      "starterFaction": "Aqua Guardians",
      "evolution": {
        "from": 4,
        "to": 6,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A longer-legged river dog with fin-like ear edges, a fuller chest ruff, and a tail shaped by a steady stream.",
        "basicAttack": "Frostbite \u2014 A short physical rush supported by a low splash.",
        "advancedAttack": "Ice Spear \u2014 A broad water surge that grows from a compact current and breaks forward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 6,
      "entryKey": "water-doge-s3",
      "lineKey": "water-doge",
      "stage": 3,
      "displayName": "TideDoge",
      "workingName": "TideDoge",
      "affinity": "water",
      "starterFaction": "Aqua Guardians",
      "evolution": {
        "from": 5,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad adult water hound with a deep-blue coat, pale current markings, and a heavy curling tide tail.",
        "basicAttack": "Deep Current \u2014 A short physical rush supported by a low splash.",
        "advancedAttack": "Tidal Wave \u2014 A broad water surge that grows from a compact current and breaks forward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 7,
      "entryKey": "air-doge-s1",
      "lineKey": "air-doge",
      "stage": 1,
      "displayName": "Airbud",
      "workingName": "Airbud",
      "affinity": "air",
      "starterFaction": "Sky Nomads",
      "evolution": {
        "from": null,
        "to": 8,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "live",
        "starter": true,
        "huntCatchable": true,
        "huntWeight": 100
      },
      "assets": {
        "portrait": {
          "status": "approved",
          "path": "entries/007-air-doge-s1/portrait/portrait.png"
        },
        "world": {
          "status": "approved",
          "path": "entries/007-air-doge-s1/animations/atlas.png"
        },
        "basicAttack": {
          "status": "approved",
          "path": "entries/007-air-doge-s1/animations/atlas.png"
        },
        "advancedAttack": {
          "status": "approved",
          "path": "entries/007-air-doge-s1/animations/atlas.png"
        },
        "runtimeAtlas": {
          "status": "approved",
          "path": "entries/007-air-doge-s1/animations/atlas.json"
        }
      },
      "plan": {
        "appearance": "The released pale-green air dog with wind-swept ears and a curled current tail.",
        "basicAttack": "Wind Slash \u2014 A quick lunge with one readable compressed-air edge.",
        "advancedAttack": "Storm Cloud \u2014 A gathered storm burst released during a fast diving strike."
      },
      "artRevision": "df18fb9bd2ef21fb"
    },
    {
      "entryNo": 8,
      "entryKey": "air-doge-s2",
      "lineKey": "air-doge",
      "stage": 2,
      "displayName": "Breezebud",
      "workingName": "Breezebud",
      "affinity": "air",
      "starterFaction": "Sky Nomads",
      "evolution": {
        "from": 7,
        "to": 9,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A slim adolescent dog with longer swept ears, raised ankle fur, and a tail that trails like a narrow breeze.",
        "basicAttack": "Tornado \u2014 A quick lunge with one readable compressed-air edge.",
        "advancedAttack": "Lightning Bolt \u2014 A gathered storm burst released during a fast diving strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 9,
      "entryKey": "air-doge-s3",
      "lineKey": "air-doge",
      "stage": 3,
      "displayName": "Stormbud",
      "workingName": "Stormbud",
      "affinity": "air",
      "starterFaction": "Sky Nomads",
      "evolution": {
        "from": 8,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A fast adult sky hound with a sharp chest silhouette, banner-like ears, and a storm-current tail.",
        "basicAttack": "Gale Force \u2014 A quick lunge with one readable compressed-air edge.",
        "advancedAttack": "Storm Cloud \u2014 A gathered storm burst released during a fast diving strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 10,
      "entryKey": "rock-doge-s1",
      "lineKey": "rock-doge",
      "stage": 1,
      "displayName": "Rockpup",
      "workingName": "Rockpup",
      "affinity": "rock",
      "starterFaction": "Stone Titans",
      "evolution": {
        "from": null,
        "to": 11,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "live",
        "starter": true,
        "huntCatchable": true,
        "huntWeight": 100
      },
      "assets": {
        "portrait": {
          "status": "approved",
          "path": "entries/010-rock-doge-s1/portrait/portrait.png"
        },
        "world": {
          "status": "approved",
          "path": "entries/010-rock-doge-s1/animations/atlas.png"
        },
        "basicAttack": {
          "status": "approved",
          "path": "entries/010-rock-doge-s1/animations/atlas.png"
        },
        "advancedAttack": {
          "status": "approved",
          "path": "entries/010-rock-doge-s1/animations/atlas.png"
        },
        "runtimeAtlas": {
          "status": "approved",
          "path": "entries/010-rock-doge-s1/animations/atlas.json"
        }
      },
      "plan": {
        "appearance": "The released compact ochre rock dog with heavy paws and a curled stone-current tail.",
        "basicAttack": "Boulder Crush \u2014 A low body check that carries one loose stone into the impact.",
        "advancedAttack": "Rock Slide \u2014 A grounded slam followed by a short controlled rock slide."
      },
      "artRevision": "9fdb30a158cd27fd"
    },
    {
      "entryNo": 11,
      "entryKey": "rock-doge-s2",
      "lineKey": "rock-doge",
      "stage": 2,
      "displayName": "Shalepup",
      "workingName": "Shalepup",
      "affinity": "rock",
      "starterFaction": "Stone Titans",
      "evolution": {
        "from": 10,
        "to": 12,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A stockier young dog with layered shale shoulders, wider paws, and a low balanced stance.",
        "basicAttack": "Earth Shield \u2014 A low body check that carries one loose stone into the impact.",
        "advancedAttack": "Seismic Slam \u2014 A grounded slam followed by a short controlled rock slide."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 12,
      "entryKey": "rock-doge-s3",
      "lineKey": "rock-doge",
      "stage": 3,
      "displayName": "Cragpup",
      "workingName": "Cragpup",
      "affinity": "rock",
      "starterFaction": "Stone Titans",
      "evolution": {
        "from": 11,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large adult rock hound with a broad slab-like back, blunt stone claws, and a heavy curled tail.",
        "basicAttack": "Rock Slide \u2014 A low body check that carries one loose stone into the impact.",
        "advancedAttack": "Stone Barrier \u2014 A grounded slam followed by a short controlled rock slide."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 13,
      "entryKey": "ashmouse-s1",
      "lineKey": "ashmouse",
      "stage": 1,
      "displayName": "Ashmouse",
      "workingName": "Ashmouse",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 14,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "planned"
        },
        "world": {
          "status": "planned"
        },
        "basicAttack": {
          "status": "planned"
        },
        "advancedAttack": {
          "status": "planned"
        },
        "runtimeAtlas": {
          "status": "planned"
        }
      },
      "plan": {
        "appearance": "A soot-gray field mouse with rust paws and a coal-orange tail tip.",
        "basicAttack": "Scorching Ash \u2014 Scrapes the ground and throws a low cone of hot ash.",
        "advancedAttack": "Inferno \u2014 Curls around its tail before releasing a compact wall of flame."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 14,
      "entryKey": "ashmouse-s2",
      "lineKey": "ashmouse",
      "stage": 2,
      "displayName": "Cindervole",
      "workingName": "Cindervole",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 13,
        "to": 15,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A sturdier vole with ember cheek marks, digging forepaws, and a tail glowing along its lower half.",
        "basicAttack": "Firenado \u2014 Scrapes the ground and throws a low cone of hot ash.",
        "advancedAttack": "Phoenix Burst \u2014 Curls around its tail before releasing a compact wall of flame."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 15,
      "entryKey": "ashmouse-s3",
      "lineKey": "ashmouse",
      "stage": 3,
      "displayName": "Pyremouse",
      "workingName": "Pyremouse",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 14,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large quick mouse with a swept ember back, bright whiskers, and a controlled flame tail.",
        "basicAttack": "Inferno \u2014 Scrapes the ground and throws a low cone of hot ash.",
        "advancedAttack": "Phoenix Burst \u2014 Curls around its tail before releasing a compact wall of flame."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 16,
      "entryKey": "brookfrog-s1",
      "lineKey": "brookfrog",
      "stage": 1,
      "displayName": "Brookfrog",
      "workingName": "Brookfrog",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 17,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "planned"
        },
        "world": {
          "status": "planned"
        },
        "basicAttack": {
          "status": "planned"
        },
        "advancedAttack": {
          "status": "planned"
        },
        "runtimeAtlas": {
          "status": "planned"
        }
      },
      "plan": {
        "appearance": "A squat blue-green river frog with a pale belly and ripple markings.",
        "basicAttack": "Whirlpool \u2014 Slaps a puddle into a tight spinning ring around the opponent.",
        "advancedAttack": "Tidal Wave \u2014 Leaps and lands behind a broad curling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 17,
      "entryKey": "brookfrog-s2",
      "lineKey": "brookfrog",
      "stage": 2,
      "displayName": "Rilltoad",
      "workingName": "Rilltoad",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 16,
        "to": 18,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavier toad with reed-dark limbs, a wider mouth, and water pooled across its shoulders.",
        "basicAttack": "Frostbite \u2014 Slaps a puddle into a tight spinning ring around the opponent.",
        "advancedAttack": "Ice Spear \u2014 Leaps and lands behind a broad curling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 18,
      "entryKey": "brookfrog-s3",
      "lineKey": "brookfrog",
      "stage": 3,
      "displayName": "Floodcroak",
      "workingName": "Floodcroak",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 17,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad river toad with powerful rear legs, layered current markings, and a deep resonant throat.",
        "basicAttack": "Deep Current \u2014 Slaps a puddle into a tight spinning ring around the opponent.",
        "advancedAttack": "Tidal Wave \u2014 Leaps and lands behind a broad curling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 19,
      "entryKey": "gustfinch-s1",
      "lineKey": "gustfinch",
      "stage": 1,
      "displayName": "Gustfinch",
      "workingName": "Gustfinch",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 20,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "planned"
        },
        "world": {
          "status": "planned"
        },
        "basicAttack": {
          "status": "planned"
        },
        "advancedAttack": {
          "status": "planned"
        },
        "runtimeAtlas": {
          "status": "planned"
        }
      },
      "plan": {
        "appearance": "A round gray-and-cream finch with long mint flight feathers.",
        "basicAttack": "Wind Slash \u2014 Snaps one wing forward to throw a thin air crescent.",
        "advancedAttack": "Storm Cloud \u2014 Climbs into a compact cloud and dives through wind and pale lightning."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 20,
      "entryKey": "gustfinch-s2",
      "lineKey": "gustfinch",
      "stage": 2,
      "displayName": "Galejay",
      "workingName": "Galejay",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 19,
        "to": 21,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A lean jay with a swept crest, longer tail, and strong contrasting wing bars.",
        "basicAttack": "Tornado \u2014 Snaps one wing forward to throw a thin air crescent.",
        "advancedAttack": "Lightning Bolt \u2014 Climbs into a compact cloud and dives through wind and pale lightning."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 21,
      "entryKey": "gustfinch-s3",
      "lineKey": "gustfinch",
      "stage": 3,
      "displayName": "Stormcrest",
      "workingName": "Stormcrest",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 20,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large sharp-crested bird with broad storm-gray wings and pale gale edges.",
        "basicAttack": "Gale Force \u2014 Snaps one wing forward to throw a thin air crescent.",
        "advancedAttack": "Storm Cloud \u2014 Climbs into a compact cloud and dives through wind and pale lightning."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 22,
      "entryKey": "shalemole-s1",
      "lineKey": "shalemole",
      "stage": 1,
      "displayName": "Shalemole",
      "workingName": "Shalemole",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 23,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "planned"
        },
        "world": {
          "status": "planned"
        },
        "basicAttack": {
          "status": "planned"
        },
        "advancedAttack": {
          "status": "planned"
        },
        "runtimeAtlas": {
          "status": "planned"
        }
      },
      "plan": {
        "appearance": "A low brown mole with a wedge snout, huge claws, and flat shale shoulders.",
        "basicAttack": "Boulder Crush \u2014 Flips a small stone forward and drives it with its forehead.",
        "advancedAttack": "Rock Slide \u2014 Burrows and erupts beneath a falling line of broken slabs."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 23,
      "entryKey": "shalemole-s2",
      "lineKey": "shalemole",
      "stage": 2,
      "displayName": "Flintmole",
      "workingName": "Flintmole",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 22,
        "to": 24,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A longer digging mole with flint foreclaws and overlapping plates down its spine.",
        "basicAttack": "Earth Shield \u2014 Flips a small stone forward and drives it with its forehead.",
        "advancedAttack": "Seismic Slam \u2014 Burrows and erupts beneath a falling line of broken slabs."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 24,
      "entryKey": "shalemole-s3",
      "lineKey": "shalemole",
      "stage": 3,
      "displayName": "Cragburrow",
      "workingName": "Cragburrow",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 23,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavy old burrower with a crag-like back, broad shovel claws, and a reinforced brow.",
        "basicAttack": "Rock Slide \u2014 Flips a small stone forward and drives it with its forehead.",
        "advancedAttack": "Stone Barrier \u2014 Burrows and erupts beneath a falling line of broken slabs."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 25,
      "entryKey": "bristleboar-s1",
      "lineKey": "bristleboar",
      "stage": 1,
      "displayName": "Bristleboar",
      "workingName": "Bristleboar",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 26,
        "atLevel": 10
      },
      "moves": {
        "basic": "Body Slam",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "planned"
        },
        "world": {
          "status": "planned"
        },
        "basicAttack": {
          "status": "planned"
        },
        "advancedAttack": {
          "status": "planned"
        },
        "runtimeAtlas": {
          "status": "planned"
        }
      },
      "plan": {
        "appearance": "An ordinary young brown boar with a tan snout, small tusks, and black hooves.",
        "basicAttack": "Body Slam \u2014 Takes two quick steps and strikes with its shoulder.",
        "advancedAttack": "Heavy Strike \u2014 Scrapes one hoof and performs a long heavy charge with dust only."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 26,
      "entryKey": "bristleboar-s2",
      "lineKey": "bristleboar",
      "stage": 2,
      "displayName": "Tuskboar",
      "workingName": "Tuskboar",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 25,
        "to": 27,
        "atLevel": 20
      },
      "moves": {
        "basic": "Quick Jab",
        "advanced": "Guard Break"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A mature wild boar with a longer bristle ridge, heavier shoulders, and worn ivory tusks.",
        "basicAttack": "Quick Jab \u2014 Takes two quick steps and strikes with its shoulder.",
        "advancedAttack": "Guard Break \u2014 Scrapes one hoof and performs a long heavy charge with dust only."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 27,
      "entryKey": "bristleboar-s3",
      "lineKey": "bristleboar",
      "stage": 3,
      "displayName": "Greatboar",
      "workingName": "Greatboar",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 26,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frenzy Blows",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A massive but entirely natural old boar with a scarred snout, broad hooves, and long curved tusks.",
        "basicAttack": "Frenzy Blows \u2014 Takes two quick steps and strikes with its shoulder.",
        "advancedAttack": "Heavy Strike \u2014 Scrapes one hoof and performs a long heavy charge with dust only."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 28,
      "entryKey": "coalbug-s1",
      "lineKey": "coalbug",
      "stage": 1,
      "displayName": "Coalbug",
      "workingName": "Coalbug",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 29,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A thumb-sized black beetle with ember-red wing cases and short hooked legs.",
        "basicAttack": "Scorching Ash \u2014 Scuttles forward and scatters hot grit from beneath its shell.",
        "advancedAttack": "Inferno \u2014 Locks its feet, opens its wing cases, and releases one focused furnace burst."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 29,
      "entryKey": "coalbug-s2",
      "lineKey": "coalbug",
      "stage": 2,
      "displayName": "Emberbeetle",
      "workingName": "Emberbeetle",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 28,
        "to": 30,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad fire beetle with glowing seams beneath its shell and stronger digging legs.",
        "basicAttack": "Firenado \u2014 Scuttles forward and scatters hot grit from beneath its shell.",
        "advancedAttack": "Phoenix Burst \u2014 Locks its feet, opens its wing cases, and releases one focused furnace burst."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 30,
      "entryKey": "coalbug-s3",
      "lineKey": "coalbug",
      "stage": 3,
      "displayName": "Furnacehorn",
      "workingName": "Furnacehorn",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 29,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavy horned beetle with a furnace-orange chest seam and thick heat-darkened shell.",
        "basicAttack": "Inferno \u2014 Scuttles forward and scatters hot grit from beneath its shell.",
        "advancedAttack": "Phoenix Burst \u2014 Locks its feet, opens its wing cases, and releases one focused furnace burst."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 31,
      "entryKey": "sootkit-s1",
      "lineKey": "sootkit",
      "stage": 1,
      "displayName": "Sootkit",
      "workingName": "Sootkit",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 32,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small charcoal kitten with orange paw tips and a warm tail tuft.",
        "basicAttack": "Scorching Ash \u2014 Darts through a low ash cloud for one quick claw strike.",
        "advancedAttack": "Inferno \u2014 Braces, fans its ruff alight, and releases a forward fire sweep."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 32,
      "entryKey": "sootkit-s2",
      "lineKey": "sootkit",
      "stage": 2,
      "displayName": "Cindercat",
      "workingName": "Cindercat",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 31,
        "to": 33,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A lean young cat with cinder stripes, larger forepaws, and a low ember mane.",
        "basicAttack": "Firenado \u2014 Darts through a low ash cloud for one quick claw strike.",
        "advancedAttack": "Phoenix Burst \u2014 Braces, fans its ruff alight, and releases a forward fire sweep."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 33,
      "entryKey": "sootkit-s3",
      "lineKey": "sootkit",
      "stage": 3,
      "displayName": "Hearthlynx",
      "workingName": "Hearthlynx",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 32,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A compact adult lynx with soot-black ear tufts, a broad ember ruff, and controlled hearth glow.",
        "basicAttack": "Inferno \u2014 Darts through a low ash cloud for one quick claw strike.",
        "advancedAttack": "Phoenix Burst \u2014 Braces, fans its ruff alight, and releases a forward fire sweep."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 34,
      "entryKey": "sparktail-s1",
      "lineKey": "sparktail",
      "stage": 1,
      "displayName": "Sparktail",
      "workingName": "Sparktail",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 35,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small ochre lizard with a bright tail point and simple dark bands.",
        "basicAttack": "Scorching Ash \u2014 Whips its bright tail through loose cinders.",
        "advancedAttack": "Inferno \u2014 Raises its back ridge and drives a narrow blaze straight ahead."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 35,
      "entryKey": "sparktail-s2",
      "lineKey": "sparktail",
      "stage": 2,
      "displayName": "Coalcrest",
      "workingName": "Coalcrest",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 34,
        "to": 36,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A longer lizard with a coal-black head crest and ember scales along its spine.",
        "basicAttack": "Firenado \u2014 Whips its bright tail through loose cinders.",
        "advancedAttack": "Phoenix Burst \u2014 Raises its back ridge and drives a narrow blaze straight ahead."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 36,
      "entryKey": "sparktail-s3",
      "lineKey": "sparktail",
      "stage": 3,
      "displayName": "Blazeback",
      "workingName": "Blazeback",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 35,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad monitor-like lizard with a blazing back ridge and a heavy heat-marked tail.",
        "basicAttack": "Inferno \u2014 Whips its bright tail through loose cinders.",
        "advancedAttack": "Phoenix Burst \u2014 Raises its back ridge and drives a narrow blaze straight ahead."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 37,
      "entryKey": "wickmoth-s1",
      "lineKey": "wickmoth",
      "stage": 1,
      "displayName": "Wickmoth",
      "workingName": "Wickmoth",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 38,
        "atLevel": 10
      },
      "moves": {
        "basic": "Scorching Ash",
        "advanced": "Inferno"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small dark moth with warm orange wing spots and wick-like antennae.",
        "basicAttack": "Scorching Ash \u2014 Beats a brief cloud of warm ash toward the target.",
        "advancedAttack": "Inferno \u2014 Closes its wings to gather heat, then opens them into a wide flame pulse."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 38,
      "entryKey": "wickmoth-s2",
      "lineKey": "wickmoth",
      "stage": 2,
      "displayName": "Lanternwing",
      "workingName": "Lanternwing",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 37,
        "to": 39,
        "atLevel": 20
      },
      "moves": {
        "basic": "Firenado",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A larger moth with lantern-shaped wing marks and a softly glowing abdomen.",
        "basicAttack": "Firenado \u2014 Beats a brief cloud of warm ash toward the target.",
        "advancedAttack": "Phoenix Burst \u2014 Closes its wings to gather heat, then opens them into a wide flame pulse."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 39,
      "entryKey": "wickmoth-s3",
      "lineKey": "wickmoth",
      "stage": 3,
      "displayName": "Pyrewing",
      "workingName": "Pyrewing",
      "affinity": "fire",
      "starterFaction": null,
      "evolution": {
        "from": 38,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Inferno",
        "advanced": "Phoenix Burst"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad night moth with sharp flame patterns, long antennae, and bright controlled wing edges.",
        "basicAttack": "Inferno \u2014 Beats a brief cloud of warm ash toward the target.",
        "advancedAttack": "Phoenix Burst \u2014 Closes its wings to gather heat, then opens them into a wide flame pulse."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 40,
      "entryKey": "reednewt-s1",
      "lineKey": "reednewt",
      "stage": 1,
      "displayName": "Reednewt",
      "workingName": "Reednewt",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 41,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A slim green-blue newt with a pale belly and reed-shaped tail fin.",
        "basicAttack": "Whirlpool \u2014 Flicks a tight ring of water from its tail.",
        "advancedAttack": "Tidal Wave \u2014 Plants its feet and drives a fast current along the ground."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 41,
      "entryKey": "reednewt-s2",
      "lineKey": "reednewt",
      "stage": 2,
      "displayName": "Rillmander",
      "workingName": "Rillmander",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 40,
        "to": 42,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A longer salamander with ripple bands and a taller flexible tail crest.",
        "basicAttack": "Frostbite \u2014 Flicks a tight ring of water from its tail.",
        "advancedAttack": "Ice Spear \u2014 Plants its feet and drives a fast current along the ground."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 42,
      "entryKey": "reednewt-s3",
      "lineKey": "reednewt",
      "stage": 3,
      "displayName": "Rivercrest",
      "workingName": "Rivercrest",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 41,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A strong river salamander with a broad head, deep-blue crest, and powerful swimming tail.",
        "basicAttack": "Deep Current \u2014 Flicks a tight ring of water from its tail.",
        "advancedAttack": "Tidal Wave \u2014 Plants its feet and drives a fast current along the ground."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 43,
      "entryKey": "shellkip-s1",
      "lineKey": "shellkip",
      "stage": 1,
      "displayName": "Shellkip",
      "workingName": "Shellkip",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 44,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A tiny river turtle with a blue-gray shell and wide paddling feet.",
        "basicAttack": "Whirlpool \u2014 Slides forward inside a shallow spinning puddle.",
        "advancedAttack": "Tidal Wave \u2014 Withdraws briefly, then surges out behind a rolling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 44,
      "entryKey": "shellkip-s2",
      "lineKey": "shellkip",
      "stage": 2,
      "displayName": "Brookshell",
      "workingName": "Brookshell",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 43,
        "to": 45,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A young turtle with layered shell channels and stronger webbed limbs.",
        "basicAttack": "Frostbite \u2014 Slides forward inside a shallow spinning puddle.",
        "advancedAttack": "Ice Spear \u2014 Withdraws briefly, then surges out behind a rolling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 45,
      "entryKey": "shellkip-s3",
      "lineKey": "shellkip",
      "stage": 3,
      "displayName": "Riverback",
      "workingName": "Riverback",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 44,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad old river turtle with a deep ridged shell and pale current lines.",
        "basicAttack": "Deep Current \u2014 Slides forward inside a shallow spinning puddle.",
        "advancedAttack": "Tidal Wave \u2014 Withdraws briefly, then surges out behind a rolling wave."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 46,
      "entryKey": "silverminnow-s1",
      "lineKey": "silverminnow",
      "stage": 1,
      "displayName": "Silverminnow",
      "workingName": "Silverminnow",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 47,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small silver fish with blue fins and one dark side stripe.",
        "basicAttack": "Whirlpool \u2014 Snaps its tail and throws a thin water dart.",
        "advancedAttack": "Tidal Wave \u2014 Circles once and releases a fast concentrated torrent."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 47,
      "entryKey": "silverminnow-s2",
      "lineKey": "silverminnow",
      "stage": 2,
      "displayName": "Streamfin",
      "workingName": "Streamfin",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 46,
        "to": 48,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A quick stream fish with longer fins, a split tail, and bright ripple scales.",
        "basicAttack": "Frostbite \u2014 Snaps its tail and throws a thin water dart.",
        "advancedAttack": "Ice Spear \u2014 Circles once and releases a fast concentrated torrent."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 48,
      "entryKey": "silverminnow-s3",
      "lineKey": "silverminnow",
      "stage": 3,
      "displayName": "Torrentfin",
      "workingName": "Torrentfin",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 47,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large narrow river fish with a powerful forked tail and deep-blue fin blades.",
        "basicAttack": "Deep Current \u2014 Snaps its tail and throws a thin water dart.",
        "advancedAttack": "Tidal Wave \u2014 Circles once and releases a fast concentrated torrent."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 49,
      "entryKey": "mudcrab-s1",
      "lineKey": "mudcrab",
      "stage": 1,
      "displayName": "Mudcrab",
      "workingName": "Mudcrab",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 50,
        "atLevel": 10
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small brown-blue crab with uneven claws and mud-dark legs.",
        "basicAttack": "Whirlpool \u2014 Snaps one claw through a small spinning current.",
        "advancedAttack": "Tidal Wave \u2014 Anchors itself and launches a compressed water spear between both claws."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 50,
      "entryKey": "mudcrab-s2",
      "lineKey": "mudcrab",
      "stage": 2,
      "displayName": "Creekclaw",
      "workingName": "Creekclaw",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 49,
        "to": 51,
        "atLevel": 20
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A wider creek crab with one larger claw and ripple marks across its shell.",
        "basicAttack": "Frostbite \u2014 Snaps one claw through a small spinning current.",
        "advancedAttack": "Ice Spear \u2014 Anchors itself and launches a compressed water spear between both claws."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 51,
      "entryKey": "mudcrab-s3",
      "lineKey": "mudcrab",
      "stage": 3,
      "displayName": "Riverclaw",
      "workingName": "Riverclaw",
      "affinity": "water",
      "starterFaction": null,
      "evolution": {
        "from": 50,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavy river crab with two broad claws, a low armored shell, and pale water seams.",
        "basicAttack": "Deep Current \u2014 Snaps one claw through a small spinning current.",
        "advancedAttack": "Tidal Wave \u2014 Anchors itself and launches a compressed water spear between both claws."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 52,
      "entryKey": "dusthare-s1",
      "lineKey": "dusthare",
      "stage": 1,
      "displayName": "Dusthare",
      "workingName": "Dusthare",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 53,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A sandy-gray hare with long mint-tipped ears and light feet.",
        "basicAttack": "Wind Slash \u2014 Cuts past the opponent with one fast air-edged kick.",
        "advancedAttack": "Storm Cloud \u2014 Builds speed in a tight circle and breaks through in a short gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 53,
      "entryKey": "dusthare-s2",
      "lineKey": "dusthare",
      "stage": 2,
      "displayName": "Swiftjack",
      "workingName": "Swiftjack",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 52,
        "to": 54,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A taller jackrabbit with swept ear stripes and a narrow wind-tossed chest ruff.",
        "basicAttack": "Tornado \u2014 Cuts past the opponent with one fast air-edged kick.",
        "advancedAttack": "Lightning Bolt \u2014 Builds speed in a tight circle and breaks through in a short gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 54,
      "entryKey": "dusthare-s3",
      "lineKey": "dusthare",
      "stage": 3,
      "displayName": "Galehare",
      "workingName": "Galehare",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 53,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A long-legged hare with banner ears, pale gale markings, and an exceptionally light stride.",
        "basicAttack": "Gale Force \u2014 Cuts past the opponent with one fast air-edged kick.",
        "advancedAttack": "Storm Cloud \u2014 Builds speed in a tight circle and breaks through in a short gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 55,
      "entryKey": "whistlebat-s1",
      "lineKey": "whistlebat",
      "stage": 1,
      "displayName": "Whistlebat",
      "workingName": "Whistlebat",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 56,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small gray bat with mint ear edges and narrow angular wings.",
        "basicAttack": "Wind Slash \u2014 Snaps its wings to send one narrow pressure wave.",
        "advancedAttack": "Storm Cloud \u2014 Climbs, folds, and drops through a compact storm cloud."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 56,
      "entryKey": "whistlebat-s2",
      "lineKey": "whistlebat",
      "stage": 2,
      "displayName": "Draftbat",
      "workingName": "Draftbat",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 55,
        "to": 57,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A larger cave bat with long ears, stronger wing fingers, and pale draft bands.",
        "basicAttack": "Tornado \u2014 Snaps its wings to send one narrow pressure wave.",
        "advancedAttack": "Lightning Bolt \u2014 Climbs, folds, and drops through a compact storm cloud."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 57,
      "entryKey": "whistlebat-s3",
      "lineKey": "whistlebat",
      "stage": 3,
      "displayName": "Stormbat",
      "workingName": "Stormbat",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 56,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad storm bat with a sharp head silhouette and dark wings edged by moving air.",
        "basicAttack": "Gale Force \u2014 Snaps its wings to send one narrow pressure wave.",
        "advancedAttack": "Storm Cloud \u2014 Climbs, folds, and drops through a compact storm cloud."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 58,
      "entryKey": "cloudmoth-s1",
      "lineKey": "cloudmoth",
      "stage": 1,
      "displayName": "Cloudmoth",
      "workingName": "Cloudmoth",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 59,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A pale gray moth with translucent mint wing patches.",
        "basicAttack": "Wind Slash \u2014 Sheds a small spiral of wing scales carried by a breeze.",
        "advancedAttack": "Storm Cloud \u2014 Raises both wings and releases a wide downward gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 59,
      "entryKey": "cloudmoth-s2",
      "lineKey": "cloudmoth",
      "stage": 2,
      "displayName": "Breezeveil",
      "workingName": "Breezeveil",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 58,
        "to": 60,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A long-winged moth whose trailing edges resemble thin wind-torn cloth.",
        "basicAttack": "Tornado \u2014 Sheds a small spiral of wing scales carried by a breeze.",
        "advancedAttack": "Lightning Bolt \u2014 Raises both wings and releases a wide downward gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 60,
      "entryKey": "cloudmoth-s3",
      "lineKey": "cloudmoth",
      "stage": 3,
      "displayName": "Skyveil",
      "workingName": "Skyveil",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 59,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad high-air moth with layered pale wings and a clean cloudlike silhouette.",
        "basicAttack": "Gale Force \u2014 Sheds a small spiral of wing scales carried by a breeze.",
        "advancedAttack": "Storm Cloud \u2014 Raises both wings and releases a wide downward gale."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 61,
      "entryKey": "grasskite-s1",
      "lineKey": "grasskite",
      "stage": 1,
      "displayName": "Grasskite",
      "workingName": "Grasskite",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 62,
        "atLevel": 10
      },
      "moves": {
        "basic": "Wind Slash",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small grassland kite with brown feathers and mint wing tips.",
        "basicAttack": "Wind Slash \u2014 Sweeps past with one cutting wing edge.",
        "advancedAttack": "Storm Cloud \u2014 Climbs out of frame and returns in a steep storm-backed dive."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 62,
      "entryKey": "grasskite-s2",
      "lineKey": "grasskite",
      "stage": 2,
      "displayName": "Windkite",
      "workingName": "Windkite",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 61,
        "to": 63,
        "atLevel": 20
      },
      "moves": {
        "basic": "Tornado",
        "advanced": "Lightning Bolt"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A lean hunting bird with a forked tail and strong pale flight bars.",
        "basicAttack": "Tornado \u2014 Sweeps past with one cutting wing edge.",
        "advancedAttack": "Lightning Bolt \u2014 Climbs out of frame and returns in a steep storm-backed dive."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 63,
      "entryKey": "grasskite-s3",
      "lineKey": "grasskite",
      "stage": 3,
      "displayName": "Highkite",
      "workingName": "Highkite",
      "affinity": "air",
      "starterFaction": null,
      "evolution": {
        "from": 62,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Gale Force",
        "advanced": "Storm Cloud"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large high-soaring kite with long angled wings and a deeply forked gale tail.",
        "basicAttack": "Gale Force \u2014 Sweeps past with one cutting wing edge.",
        "advancedAttack": "Storm Cloud \u2014 Climbs out of frame and returns in a steep storm-backed dive."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 64,
      "entryKey": "pebbleturtle-s1",
      "lineKey": "pebbleturtle",
      "stage": 1,
      "displayName": "Pebbleturtle",
      "workingName": "Pebbleturtle",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 65,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small tan turtle with a shell made of rounded pebble-like plates.",
        "basicAttack": "Boulder Crush \u2014 Tucks its head and bumps forward behind one rolling pebble.",
        "advancedAttack": "Rock Slide \u2014 Drops its full weight and sends a short rock slide outward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 65,
      "entryKey": "pebbleturtle-s2",
      "lineKey": "pebbleturtle",
      "stage": 2,
      "displayName": "Slateback",
      "workingName": "Slateback",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 64,
        "to": 66,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A sturdy turtle with overlapping slate plates and thick digging feet.",
        "basicAttack": "Earth Shield \u2014 Tucks its head and bumps forward behind one rolling pebble.",
        "advancedAttack": "Seismic Slam \u2014 Drops its full weight and sends a short rock slide outward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 66,
      "entryKey": "pebbleturtle-s3",
      "lineKey": "pebbleturtle",
      "stage": 3,
      "displayName": "Boulderback",
      "workingName": "Boulderback",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 65,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad old tortoise with a boulder-shaped shell and deep load-bearing seams.",
        "basicAttack": "Rock Slide \u2014 Tucks its head and bumps forward behind one rolling pebble.",
        "advancedAttack": "Stone Barrier \u2014 Drops its full weight and sends a short rock slide outward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 67,
      "entryKey": "quarryrat-s1",
      "lineKey": "quarryrat",
      "stage": 1,
      "displayName": "Quarryrat",
      "workingName": "Quarryrat",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 68,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A dusty brown rat with pale stone-colored whiskers and strong front teeth.",
        "basicAttack": "Boulder Crush \u2014 Kicks one sharp chip of stone toward the opponent.",
        "advancedAttack": "Rock Slide \u2014 Gnaws through a weak ledge and drops several rocks in a line."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 68,
      "entryKey": "quarryrat-s2",
      "lineKey": "quarryrat",
      "stage": 2,
      "displayName": "Flintwhisker",
      "workingName": "Flintwhisker",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 67,
        "to": 69,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A larger rat with flint-dark incisors and small shale patches on its shoulders.",
        "basicAttack": "Earth Shield \u2014 Kicks one sharp chip of stone toward the opponent.",
        "advancedAttack": "Seismic Slam \u2014 Gnaws through a weak ledge and drops several rocks in a line."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 69,
      "entryKey": "quarryrat-s3",
      "lineKey": "quarryrat",
      "stage": 3,
      "displayName": "Cragrat",
      "workingName": "Cragrat",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 68,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavy quarry rat with a craggy back ridge, broad paws, and long rigid whiskers.",
        "basicAttack": "Rock Slide \u2014 Kicks one sharp chip of stone toward the opponent.",
        "advancedAttack": "Stone Barrier \u2014 Gnaws through a weak ledge and drops several rocks in a line."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 70,
      "entryKey": "rubblearm-s1",
      "lineKey": "rubblearm",
      "stage": 1,
      "displayName": "Rubblearm",
      "workingName": "Rubblearm",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 71,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small ordinary armadillo with dusty stone-colored bands.",
        "basicAttack": "Boulder Crush \u2014 Rolls into a short low collision.",
        "advancedAttack": "Rock Slide \u2014 Uncoils from a fast roll and slams the ground with its armored back."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 71,
      "entryKey": "rubblearm-s2",
      "lineKey": "rubblearm",
      "stage": 2,
      "displayName": "Shalearm",
      "workingName": "Shalearm",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 70,
        "to": 72,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A stronger armadillo with flatter shale bands and long digging claws.",
        "basicAttack": "Earth Shield \u2014 Rolls into a short low collision.",
        "advancedAttack": "Seismic Slam \u2014 Uncoils from a fast roll and slams the ground with its armored back."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 72,
      "entryKey": "rubblearm-s3",
      "lineKey": "rubblearm",
      "stage": 3,
      "displayName": "Bedrockarm",
      "workingName": "Bedrockarm",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 71,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large low armadillo with thick bedrock-like armor bands and a blunt reinforced tail.",
        "basicAttack": "Rock Slide \u2014 Rolls into a short low collision.",
        "advancedAttack": "Stone Barrier \u2014 Uncoils from a fast roll and slams the ground with its armored back."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 73,
      "entryKey": "cliffgoat-s1",
      "lineKey": "cliffgoat",
      "stage": 1,
      "displayName": "Cliffgoat",
      "workingName": "Cliffgoat",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 74,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small gray-brown mountain goat with blunt horns and dark hooves.",
        "basicAttack": "Boulder Crush \u2014 Takes one planted step into a compact headbutt.",
        "advancedAttack": "Rock Slide \u2014 Charges down an angled stone path and lands with a seismic horn strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 74,
      "entryKey": "cliffgoat-s2",
      "lineKey": "cliffgoat",
      "stage": 2,
      "displayName": "Ridgegoat",
      "workingName": "Ridgegoat",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 73,
        "to": 75,
        "atLevel": 20
      },
      "moves": {
        "basic": "Earth Shield",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A sure-footed goat with longer ridge-striped horns and a heavier neck.",
        "basicAttack": "Earth Shield \u2014 Takes one planted step into a compact headbutt.",
        "advancedAttack": "Seismic Slam \u2014 Charges down an angled stone path and lands with a seismic horn strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 75,
      "entryKey": "cliffgoat-s3",
      "lineKey": "cliffgoat",
      "stage": 3,
      "displayName": "Peakram",
      "workingName": "Peakram",
      "affinity": "rock",
      "starterFaction": null,
      "evolution": {
        "from": 74,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Rock Slide",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A broad adult ram with swept stone-colored horns and a powerful square stance.",
        "basicAttack": "Rock Slide \u2014 Takes one planted step into a compact headbutt.",
        "advancedAttack": "Stone Barrier \u2014 Charges down an angled stone path and lands with a seismic horn strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 76,
      "entryKey": "fieldhare-s1",
      "lineKey": "fieldhare",
      "stage": 1,
      "displayName": "Fieldhare",
      "workingName": "Fieldhare",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 77,
        "atLevel": 10
      },
      "moves": {
        "basic": "Body Slam",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "An ordinary brown field hare with long ears and pale feet.",
        "basicAttack": "Body Slam \u2014 Kicks once and springs immediately back.",
        "advancedAttack": "Heavy Strike \u2014 Builds speed over several bounds and lands a full-body shoulder strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 77,
      "entryKey": "fieldhare-s2",
      "lineKey": "fieldhare",
      "stage": 2,
      "displayName": "Brushhare",
      "workingName": "Brushhare",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 76,
        "to": 78,
        "atLevel": 20
      },
      "moves": {
        "basic": "Quick Jab",
        "advanced": "Guard Break"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A mature hare with darker brush markings, longer legs, and a thicker winter coat.",
        "basicAttack": "Quick Jab \u2014 Kicks once and springs immediately back.",
        "advancedAttack": "Guard Break \u2014 Builds speed over several bounds and lands a full-body shoulder strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 78,
      "entryKey": "fieldhare-s3",
      "lineKey": "fieldhare",
      "stage": 3,
      "displayName": "Greatjack",
      "workingName": "Greatjack",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 77,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frenzy Blows",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large natural jackrabbit with powerful hind legs and weathered ear tips.",
        "basicAttack": "Frenzy Blows \u2014 Kicks once and springs immediately back.",
        "advancedAttack": "Heavy Strike \u2014 Builds speed over several bounds and lands a full-body shoulder strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 79,
      "entryKey": "barnowl-s1",
      "lineKey": "barnowl",
      "stage": 1,
      "displayName": "Barnowl",
      "workingName": "Barnowl",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 80,
        "atLevel": 10
      },
      "moves": {
        "basic": "Body Slam",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "An ordinary small barn owl with a pale face and tan wings.",
        "basicAttack": "Body Slam \u2014 Drops into one quick talon pass.",
        "advancedAttack": "Heavy Strike \u2014 Climbs silently before a longer forceful diving strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 80,
      "entryKey": "barnowl-s2",
      "lineKey": "barnowl",
      "stage": 2,
      "displayName": "Tawnyowl",
      "workingName": "Tawnyowl",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 79,
        "to": 81,
        "atLevel": 20
      },
      "moves": {
        "basic": "Quick Jab",
        "advanced": "Guard Break"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A mature tawny owl with broader barred wings and stronger talons.",
        "basicAttack": "Quick Jab \u2014 Drops into one quick talon pass.",
        "advancedAttack": "Guard Break \u2014 Climbs silently before a longer forceful diving strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 81,
      "entryKey": "barnowl-s3",
      "lineKey": "barnowl",
      "stage": 3,
      "displayName": "Greatowl",
      "workingName": "Greatowl",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 80,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frenzy Blows",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large natural owl with a wide facial disk, heavy wings, and mottled woodland feathers.",
        "basicAttack": "Frenzy Blows \u2014 Drops into one quick talon pass.",
        "advancedAttack": "Heavy Strike \u2014 Climbs silently before a longer forceful diving strike."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 82,
      "entryKey": "marshdeer-s1",
      "lineKey": "marshdeer",
      "stage": 1,
      "displayName": "Marshdeer",
      "workingName": "Marshdeer",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 83,
        "atLevel": 10
      },
      "moves": {
        "basic": "Body Slam",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "An ordinary slim marsh deer with a brown coat and dark lower legs.",
        "basicAttack": "Body Slam \u2014 Steps through a quick forward kick.",
        "advancedAttack": "Heavy Strike \u2014 Lowers its head and commits to a long antler charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 83,
      "entryKey": "marshdeer-s2",
      "lineKey": "marshdeer",
      "stage": 2,
      "displayName": "Reedstag",
      "workingName": "Reedstag",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 82,
        "to": 84,
        "atLevel": 20
      },
      "moves": {
        "basic": "Quick Jab",
        "advanced": "Guard Break"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A young stag with reed-colored flank marks and simple branching antlers.",
        "basicAttack": "Quick Jab \u2014 Steps through a quick forward kick.",
        "advancedAttack": "Guard Break \u2014 Lowers its head and commits to a long antler charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 84,
      "entryKey": "marshdeer-s3",
      "lineKey": "marshdeer",
      "stage": 3,
      "displayName": "Crownstag",
      "workingName": "Crownstag",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 83,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frenzy Blows",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A mature natural stag with a broad chest and large crown-shaped antlers.",
        "basicAttack": "Frenzy Blows \u2014 Steps through a quick forward kick.",
        "advancedAttack": "Heavy Strike \u2014 Lowers its head and commits to a long antler charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 85,
      "entryKey": "burrowbadger-s1",
      "lineKey": "burrowbadger",
      "stage": 1,
      "displayName": "Burrowbadger",
      "workingName": "Burrowbadger",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 86,
        "atLevel": 10
      },
      "moves": {
        "basic": "Body Slam",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "An ordinary black-and-cream badger with broad digging paws.",
        "basicAttack": "Body Slam \u2014 Rushes low and lands one short claw-and-shoulder strike.",
        "advancedAttack": "Heavy Strike \u2014 Plants all four feet, then drives forward in a sustained heavy charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 86,
      "entryKey": "burrowbadger-s2",
      "lineKey": "burrowbadger",
      "stage": 2,
      "displayName": "Bristlebadger",
      "workingName": "Bristlebadger",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 85,
        "to": 87,
        "atLevel": 20
      },
      "moves": {
        "basic": "Quick Jab",
        "advanced": "Guard Break"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A heavier badger with a raised bristle mantle and longer foreclaws.",
        "basicAttack": "Quick Jab \u2014 Rushes low and lands one short claw-and-shoulder strike.",
        "advancedAttack": "Guard Break \u2014 Plants all four feet, then drives forward in a sustained heavy charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 87,
      "entryKey": "burrowbadger-s3",
      "lineKey": "burrowbadger",
      "stage": 3,
      "displayName": "Greatbadger",
      "workingName": "Greatbadger",
      "affinity": "normal",
      "starterFaction": null,
      "evolution": {
        "from": 86,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frenzy Blows",
        "advanced": "Heavy Strike"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A large natural old badger with a scarred muzzle, dense coat, and exceptionally broad shoulders.",
        "basicAttack": "Frenzy Blows \u2014 Rushes low and lands one short claw-and-shoulder strike.",
        "advancedAttack": "Heavy Strike \u2014 Plants all four feet, then drives forward in a sustained heavy charge."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 88,
      "entryKey": "rocker-s1",
      "lineKey": "rocker",
      "stage": 1,
      "displayName": "Rocker",
      "workingName": "Rocker",
      "affinity": "rock",
      "rarity": "common",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 89,
        "atLevel": 10
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Seismic Slam"
      },
      "availability": {
        "state": "art-in-progress",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "partial",
          "path": "entries/088-rocker-s1/sources/rocker-stage-1-partial.webp",
          "notes": "Partial 168x182 WebP source: walking left and right are present; walking up and down are missing."
        },
        "basicAttack": {
          "status": "partial",
          "path": "entries/088-rocker-s1/sources/rocker-stage-1-partial.webp",
          "notes": "The source contains two attack sequences. Basic-versus-advanced assignment and frame bounds remain provisional."
        },
        "advancedAttack": {
          "status": "partial",
          "path": "entries/088-rocker-s1/sources/rocker-stage-1-partial.webp",
          "notes": "The source contains two attack sequences. Basic-versus-advanced assignment and frame bounds remain provisional."
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A small upright rock creature built from uneven dark stone, with slim limbs and bright green mineral or moss-like accents at its joints.",
        "basicAttack": "Boulder Crush \u2014 Use the shorter of the two supplied strikes as a compact close-range stone blow.",
        "advancedAttack": "Seismic Slam \u2014 Use the larger supplied strike as the committed attack, preserving its full wind-up and recovery."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 89,
      "entryKey": "rocker-s2",
      "lineKey": "rocker",
      "stage": 2,
      "displayName": "Rocker II",
      "workingName": "Rocker II",
      "affinity": "rock",
      "rarity": "common",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": 88,
        "to": 90,
        "atLevel": 20
      },
      "moves": {
        "basic": "Boulder Crush",
        "advanced": "Rock Slide"
      },
      "availability": {
        "state": "art-in-progress",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "partial",
          "path": "entries/089-rocker-s2/sources/rocker-stage-2-partial.webp",
          "notes": "Partial 144x192 WebP source: walking in all four directions is present."
        },
        "basicAttack": {
          "status": "missing",
          "notes": "No attack animation was supplied with this partial."
        },
        "advancedAttack": {
          "status": "missing",
          "notes": "No advanced attack animation was supplied with this partial."
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A much broader upright stone brute with heavy slab shoulders, long weight-bearing arms, violet-gray rock plates, and the same bright green growth between stones.",
        "basicAttack": "Boulder Crush \u2014 A heavy forward arm strike that keeps both feet planted before contact.",
        "advancedAttack": "Rock Slide \u2014 It drives both arms down and sends a short controlled wave of broken stone forward."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 90,
      "entryKey": "rocker-s3",
      "lineKey": "rocker",
      "stage": 3,
      "displayName": "Rocker III",
      "workingName": "Rocker III",
      "affinity": "rock",
      "rarity": "common",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": 89,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Seismic Slam",
        "advanced": "Stone Barrier"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A provisional final Rocker form: a towering but readable stone guardian that extends the stage-two slab shoulders and green mineral seams without changing its upright silhouette.",
        "basicAttack": "Seismic Slam \u2014 A full-weight two-arm impact with a clear ground contact frame.",
        "advancedAttack": "Stone Barrier \u2014 It braces behind raised stone plates before releasing the stored force in one forward break."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 91,
      "entryKey": "suspicious-fish-s1",
      "lineKey": "suspicious-fish",
      "stage": 1,
      "displayName": "Suspicious Fish",
      "workingName": "Suspicious Fish",
      "affinity": "water",
      "rarity": "legendary",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": null,
        "to": 92,
        "atLevel": 10
      },
      "moves": {
        "basic": "Deep Current",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "art-in-progress",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "partial",
          "path": "entries/091-suspicious-fish-s1/sources/suspicious-fish-partial.webp",
          "notes": "Partial 672x640 WebP source: walking in all four directions is present."
        },
        "basicAttack": {
          "status": "partial",
          "path": "entries/091-suspicious-fish-s1/sources/suspicious-fish-partial.webp",
          "notes": "Directional left/right attack animation is present; exact clip bounds still need review."
        },
        "advancedAttack": {
          "status": "partial",
          "path": "entries/091-suspicious-fish-s1/sources/suspicious-fish-partial.webp",
          "notes": "Two larger attack sequences are present. Their gameplay move assignments and exact clip bounds remain provisional."
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A legendary upright deep-water fish creature with a narrow hunched body, long hanging arms, a heavy tail, dark teal skin, and a cold luminous mark centered high on its head.",
        "basicAttack": "Deep Current \u2014 Use the directional strike pair as a fast close-range current attack with native left and right versions.",
        "advancedAttack": "Tidal Wave \u2014 Preserve both supplied large attack sequences as candidate legendary move variants until their final names and gameplay roles are chosen."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 92,
      "entryKey": "suspicious-fish-s2",
      "lineKey": "suspicious-fish",
      "stage": 2,
      "displayName": "Suspicious Fish II",
      "workingName": "Suspicious Fish II",
      "affinity": "water",
      "rarity": "legendary",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": 91,
        "to": 93,
        "atLevel": 20
      },
      "moves": {
        "basic": "Whirlpool",
        "advanced": "Ice Spear"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A provisional second legendary form that lengthens the Suspicious Fish silhouette, strengthens its tail and shoulders, and adds restrained luminous deep-water markings.",
        "basicAttack": "Whirlpool \u2014 A circling tail-and-arm motion that gathers water close to the body.",
        "advancedAttack": "Ice Spear \u2014 It condenses the gathered water into a single narrow deep-water projectile."
      },
      "artRevision": "planned"
    },
    {
      "entryNo": 93,
      "entryKey": "suspicious-fish-s3",
      "lineKey": "suspicious-fish",
      "stage": 3,
      "displayName": "Suspicious Fish III",
      "workingName": "Suspicious Fish III",
      "affinity": "water",
      "rarity": "legendary",
      "provisional": true,
      "starterFaction": null,
      "evolution": {
        "from": 92,
        "to": null,
        "atLevel": null
      },
      "moves": {
        "basic": "Frostbite",
        "advanced": "Tidal Wave"
      },
      "availability": {
        "state": "planned",
        "starter": false,
        "huntCatchable": false,
        "huntWeight": 0
      },
      "assets": {
        "portrait": {
          "status": "missing"
        },
        "world": {
          "status": "missing"
        },
        "basicAttack": {
          "status": "missing"
        },
        "advancedAttack": {
          "status": "missing"
        },
        "runtimeAtlas": {
          "status": "missing"
        }
      },
      "plan": {
        "appearance": "A provisional final legendary form: a large abyssal guardian with a longer tail, broader fin-like shoulders, and one unmistakable luminous head mark while retaining the original creature's unsettling restraint.",
        "basicAttack": "Frostbite \u2014 A quick directional lunge followed by a cold close-range burst.",
        "advancedAttack": "Tidal Wave \u2014 A full-body legendary attack that drives a dense abyssal surge across the field."
      },
      "artRevision": "planned"
    }
  ]
};

// src/lib/monster-catalog.ts
var authoredEntries = GENERATED_MONSTER_INDEX.entries;
var AUTHORED_BY_NO = new Map(authoredEntries.map((entry) => [entry.entryNo, entry]));
function authoredMonsterIndex() {
  return {
    schemaVersion: GENERATED_MONSTER_INDEX.schemaVersion,
    catalogHash: GENERATED_MONSTER_INDEX.catalogHash,
    revision: 0,
    nextEntryNo: GENERATED_MONSTER_INDEX.nextEntryNo,
    entries: authoredEntries
  };
}
function mergeMonsterIndex(live) {
  if (!live) return authoredMonsterIndex();
  const liveByNo = new Map((live.entries ?? []).map((entry) => [entry.entryNo, entry]));
  const overrides = live.overrides ?? {};
  if (!liveByNo.size && !Object.keys(overrides).length) {
    return { ...authoredMonsterIndex(), ...live, entries: authoredEntries };
  }
  const entries = authoredEntries.map((authored) => {
    const current = liveByNo.get(authored.entryNo);
    const patch = overrides[String(authored.entryNo)];
    if (!current && !patch) return authored;
    return {
      ...authored,
      ...current,
      ...patch,
      assets: authored.assets,
      plan: authored.plan
    };
  });
  return { ...live, entries };
}

// src/lib/types.ts
var GameError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "GameError";
  }
};

// src/lib/game.ts
function unwrap(reply) {
  if (reply && typeof reply === "object" && "error" in reply && reply.error) {
    throw new GameError(String(reply.error));
  }
  return reply;
}
var constantKey = (opts) => `${opts.process ?? GAME_PROCESS} ${opts.node ?? HB_NODE}`;
function readConstant(cache, opts, read) {
  const key = constantKey(opts);
  if (opts.fresh) cache.delete(key);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = read().catch(() => null);
  cache.set(key, pending);
  return pending;
}
var where = (opts) => ({ process: opts.process, node: opts.node });
var catalogCache = /* @__PURE__ */ new Map();
var monsterIndexCache = /* @__PURE__ */ new Map();
var flatMovesFrom = null;
var flatMoves = null;
var flatEntriesFrom = null;
var flatEntries = {};
function flattenPools(catalog) {
  const pools = catalog?.movePools;
  if (!pools || typeof pools !== "object") return null;
  const index = {};
  for (const pool of Object.values(pools)) {
    if (!pool || typeof pool !== "object") continue;
    for (const [name, def] of Object.entries(pool)) {
      if (def && typeof def === "object") index[name] = { ...def, name };
    }
  }
  return Object.keys(index).length > 0 ? index : null;
}
function moveIndex() {
  return readCatalog().then((catalog) => {
    if (!catalog) return null;
    if (catalog !== flatMovesFrom) {
      flatMovesFrom = catalog;
      flatMoves = flattenPools(catalog);
    }
    return flatMoves;
  }).catch(() => null);
}
function flattenMonsterIndex(view) {
  return Object.fromEntries(
    mergeMonsterIndex(view).entries.map((entry) => [entry.entryNo, entry])
  );
}
function monsterIndexLookup() {
  return readMonsterIndex().then((view) => {
    if (view !== flatEntriesFrom) {
      flatEntriesFrom = view;
      flatEntries = flattenMonsterIndex(view);
    }
    return flatEntries;
  }).catch(() => flattenMonsterIndex(null));
}
function joinMoves(value, index, depth = 0) {
  if (depth > 12 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) joinMoves(item, index, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "moves" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const [name, stored] of Object.entries(child)) {
        const def = index[name];
        if (!def || !stored || typeof stored !== "object") continue;
        child[name] = { ...def, ...stored, name };
      }
      continue;
    }
    joinMoves(child, index, depth + 1);
  }
}
function joinMonsterIndex(value, index, depth = 0) {
  if (depth > 12 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) joinMonsterIndex(item, index, depth + 1);
    return;
  }
  const row = value;
  const entryNo = Number(row.entryNo ?? 0);
  const entry = Number.isInteger(entryNo) ? index[entryNo] : void 0;
  if (entry) {
    if (row.nameMode !== "custom") row.name = entry.name ?? entry.workingName ?? row.name;
    row.entryKey = entry.entryKey;
    row.evolutionStage = entry.stage;
    if ("elementType" in row) row.elementType = entry.affinity;
    if ("element" in row) row.element = entry.affinity;
  }
  for (const child of Object.values(row)) joinMonsterIndex(child, index, depth + 1);
}
async function joined(value) {
  if (!value || typeof value !== "object") return value;
  const [moves, entries] = await Promise.all([moveIndex(), monsterIndexLookup()]);
  if (moves) joinMoves(value, moves);
  if (entries) joinMonsterIndex(value, entries);
  return value;
}
var readGameJSON = (key, opts) => readJSON(key, opts).then(joined);
var adminSnapshotCache = null;
var adminSnapshotInFlight = null;
var economyActionSeq = 0;
var economyActionId = (kind) => `${kind}-${Date.now().toString(36)}-${(++economyActionSeq).toString(36)}`;
var LEGACY_ADMIN_PROCESSES = /* @__PURE__ */ new Set([
  "jTrUI4aKamj3KAGsiOtzEOjkVFcDcQ8XL1OA5SxBGHw"
]);
var adminSnapshotMode = LEGACY_ADMIN_PROCESSES.has(GAME_PROCESS) ? "legacy" : "modern";
function rememberAdminSnapshot(value) {
  if (!value || typeof value !== "object" || !("adminSnapshot" in value)) return;
  const snapshot = value.adminSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !("players" in snapshot)) return;
  adminSnapshotCache = snapshot;
}
var write = async (tags2, data, options = {}) => {
  const action = tags2.Action ?? "";
  const mutatesAdminState = action.startsWith("Admin.") && action !== "Admin.Snapshot" && action !== "Admin.Export";
  if (mutatesAdminState) adminSnapshotCache = null;
  const value = await joined(unwrap(await send(
    Object.entries(tags2).map(([name, value2]) => ({ name, value: value2 })),
    { data, ...options }
  )));
  rememberAdminSnapshot(value);
  return value;
};
var fleetRoutes = /* @__PURE__ */ new Map();
var fleetPlayers = /* @__PURE__ */ new Map();
var battleFleetConfigPromise = null;
var FLEET_PROTOCOL = "runerealm-battle-fleet/1";
var PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;
var OPAQUE_ID = /^[A-Za-z0-9_-]{1,192}$/;
function clearFleetRoutes(address, exceptBattleId) {
  for (const [battleId, cached] of fleetPlayers) {
    if (cached.address === address && battleId !== exceptBattleId) {
      fleetPlayers.delete(battleId);
      fleetRoutes.delete(battleId);
    }
  }
}
function validateFleetRoute(player, config) {
  const route = player.battleFleet;
  if (!route || !config?.enabled || config.protocol !== FLEET_PROTOCOL || route.protocol !== FLEET_PROTOCOL || player.activeBattleId !== route.battleId || !OPAQUE_ID.test(route.battleId) || !OPAQUE_ID.test(route.reservationId) || !OPAQUE_ID.test(route.assignmentId) || !OPAQUE_ID.test(route.ticket) || !OPAQUE_ID.test(route.workerId) || !PROCESS_ID.test(route.workerProcessId) || !["opening", "battling", "cancel-pending"].includes(route.status) || !Array.isArray(config.workers)) return null;
  const worker = config.workers.find((candidate) => candidate.workerId === route.workerId && candidate.workerProcessId === route.workerProcessId);
  if (!worker) return null;
  const configuredNode = (config.node || HB_NODE).replace(/\/$/, "");
  const routedNode = (route.node || configuredNode).replace(/\/$/, "");
  if (!/^https?:\/\//.test(configuredNode) || routedNode !== configuredNode) return null;
  return { ...route, node: configuredNode };
}
function validateFleetBattle(battle, route, playerAddress) {
  if (!battle || battle.id !== route.battleId || battle.protocol !== FLEET_PROTOCOL || battle.workerId !== route.workerId || battle.kind !== "bot" || battle.status !== "battling" && battle.status !== "ended" || !Number.isSafeInteger(battle.round) || battle.round < 0 || !Array.isArray(battle.turns) || !battle.challenger || battle.challenger.address !== playerAddress || battle.challenger.side !== "challenger" || !battle.challenger.moves || typeof battle.challenger.moves !== "object" || !battle.accepter || battle.accepter.side !== "accepter" || !battle.accepter.moves || typeof battle.accepter.moves !== "object") return false;
  return true;
}
function rememberFleetRoute(player, route) {
  clearFleetRoutes(player.address, route.battleId);
  fleetRoutes.set(route.battleId, route);
  fleetPlayers.set(route.battleId, player);
}
function withActiveCompanion(player) {
  if (!player || player.monster || !player.activeId) return player;
  const active = player.monsters?.[player.activeId];
  return active ? { ...player, monster: active } : player;
}
var readAuthorityPlayer = async (address, opts = {}) => withActiveCompanion(await readGameJSON(`player-${address}`, opts));
async function hydrateFleetPlayer(player, signal) {
  if (!player.battleFleet) {
    clearFleetRoutes(player.address);
    return player;
  }
  const config = await fleetConfig();
  const route = validateFleetRoute(player, config);
  if (!route) {
    clearFleetRoutes(player.address);
    return { ...player, battle: void 0, battleFleetHydration: "invalid" };
  }
  const routed = { ...player, battleFleet: route };
  rememberFleetRoute(routed, route);
  let battle = null;
  let unavailable = false;
  try {
    battle = await readFleetBattle(route, signal);
  } catch {
    unavailable = true;
  }
  if (!battle) {
    const waiting = {
      ...routed,
      battle: void 0,
      battleFleetHydration: unavailable ? "unavailable" : "opening"
    };
    fleetPlayers.set(route.battleId, waiting);
    return waiting;
  }
  if (!validateFleetBattle(battle, route, player.address)) {
    clearFleetRoutes(player.address);
    return { ...routed, battle: void 0, battleFleetHydration: "invalid" };
  }
  if (battle.status === "ended") {
    const latest = await readAuthorityPlayer(player.address, { signal }).catch(() => null);
    if (latest && (latest.activeBattleId !== route.battleId || latest.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(player.address);
      return latest;
    }
  }
  const hydrated = { ...routed, battle, battleFleetHydration: "ready" };
  fleetPlayers.set(route.battleId, hydrated);
  return hydrated;
}
var readPlayer = async (address, opts = {}) => {
  const player = await readAuthorityPlayer(address, opts);
  return player ? hydrateFleetPlayer(player, opts.signal) : null;
};
var readAccess = (opts = {}) => LEGACY_ADMIN_PROCESSES.has(GAME_PROCESS) ? Promise.resolve({ publicAccess: false }) : readJSON("access", opts);
var readFactions = (opts = {}) => readJSON("factions", opts);
var readLeaderboard = (opts = {}) => readGameJSON("leaderboard", opts);
var readBattle = (opts = {}) => readGameJSON("battle", opts);
var readBattleFleet = () => readJSON("battlefleet");
async function fleetConfig() {
  const pending = battleFleetConfigPromise ?? readBattleFleet().catch(() => null);
  battleFleetConfigPromise = pending;
  const config = await pending;
  const valid = config?.enabled === true && config.protocol === FLEET_PROTOCOL && Array.isArray(config.workers) && config.workers.length > 0;
  if (!valid && battleFleetConfigPromise === pending) {
    battleFleetConfigPromise = null;
  }
  return valid ? config : null;
}
var fleetActionId = (prefix) => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${random}`;
};
async function readFleetBattle(route, signal) {
  return readGameJSON(`battle-${route.battleId}`, {
    process: route.workerProcessId,
    node: route.node || HB_NODE,
    signal
  });
}
async function waitForFleetBattle(route, playerAddress, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [battle, authority] = await Promise.all([
      readFleetBattle(route).catch(() => null),
      readAuthorityPlayer(playerAddress).catch(() => null)
    ]);
    if (battle) {
      if (!validateFleetBattle(battle, route, playerAddress)) {
        throw new GameError("The assigned worker published an invalid battle route.");
      }
      return battle;
    }
    if (authority && (authority.activeBattleId !== route.battleId || authority.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(playerAddress);
      throw new GameError("The battle worker rejected this reservation and the session credit was restored. It is safe to try another battle.");
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1e3, 100 + attempt * 50)));
    }
  }
  throw new GameError("The assigned battle worker has not published this battle yet. The reservation is durable; refresh instead of starting another battle.");
}
var readCatalog = (opts = {}) => readConstant(catalogCache, opts, () => readJSON("catalog", where(opts)));
var readMonsterIndex = (opts = {}) => readConstant(
  monsterIndexCache,
  opts,
  () => readJSON("monsterindex", where(opts))
);
var readChallenges = (opts = {}) => readJSON("challenges", opts);
async function readPlayerCount() {
  const users = await readState("users");
  return Number(users ?? 0);
}
var login = () => write({ Action: "User.Login" });
var stats = () => write({ Action: "Stats" });
var listFactions = () => write({ Action: "Faction.List" });
var joinFaction = (faction) => write({ Action: "Faction.Join", Faction: faction });
var adopt = () => write({ Action: "Monster.Adopt" });
var feed = (item, monsterId) => write({
  Action: "Monster.Feed",
  ...item ? { Item: item } : {},
  ...monsterId ? { MonsterId: monsterId } : {}
});
var startPlay = (monsterId, item) => write({
  Action: "Monster.Play",
  ...monsterId ? { MonsterId: monsterId } : {},
  ...item ? { Item: item } : {}
});
var startQuest = (monsterId) => write({ Action: "Monster.Quest", ...monsterId ? { MonsterId: monsterId } : {} });
var claim = (monsterId) => write({ Action: "Monster.Claim", ...monsterId ? { MonsterId: monsterId } : {} });
var levelUp = (points) => write({
  Action: "Monster.LevelUp",
  AttackPoints: String(points.attack),
  DefensePoints: String(points.defense),
  SpeedPoints: String(points.speed),
  HealthPoints: String(points.health)
});
var learnMove = (move, replace) => write({
  Action: "Monster.LearnMove",
  Move: move,
  ...replace ? { Replace: replace } : {}
});
var claimDaily = () => write({ Action: "Daily.Claim" });
var openLootbox = (rarity) => write({
  Action: "Lootbox.Open",
  ...rarity ? { Rarity: String(rarity) } : {}
});
var beginHunt = (monsterId) => write({ Action: "Hunt.Begin", MonsterId: monsterId }, void 0, {
  requiredOutbox: true
});
var enterArena = (berry) => write({ Action: "Battle.Begin", ...berry ? { Item: berry } : {} });
async function leaveArena() {
  const pending = await write({ Action: "Battle.Leave" }, void 0, {
    // This action can emit a fleet cancellation. Delivery cannot depend on a
    // fallible pre-read or even on reading this slot's reply: the write may be
    // durably accepted and cancel-pending while its correlated read times out.
    // A monolith leave has an empty outbox, so its rare extra push is harmless.
    requiredOutbox: true
  });
  const route = pending.battleFleet;
  if (!route || route.status !== "cancel-pending") return pending;
  for (let attempt = 0; attempt < 20; attempt++) {
    const settled = await readAuthorityPlayer(pending.address).catch(() => null);
    if (settled && (settled.activeBattleId !== route.battleId || settled.battleFleet?.reservationId !== route.reservationId)) {
      clearFleetRoutes(pending.address);
      return settled;
    }
    if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 50));
  }
  return { ...pending, battle: void 0, battleFleetHydration: "cancel-pending" };
}
async function startBotBattle(difficulty = 1) {
  const config = await fleetConfig();
  if (!config?.enabled) {
    return write({ Action: "Battle.Start", Difficulty: String(difficulty) });
  }
  const authorityPlayer = await write({
    Action: "Battle.Start",
    Difficulty: String(difficulty),
    StartId: fleetActionId("start")
  }, void 0, { requiredOutbox: true });
  const route = validateFleetRoute(authorityPlayer, config);
  if (!route) throw new GameError("Fleet-enabled Battle.Start returned an invalid worker route.");
  rememberFleetRoute(authorityPlayer, route);
  const battle = await waitForFleetBattle(route, authorityPlayer.address);
  const rendered = { ...authorityPlayer, battle };
  fleetPlayers.set(route.battleId, rendered);
  return rendered;
}
var challenge = (target = "OPEN") => write({ Action: "Battle.Challenge", Opponent: target });
var acceptChallenge = (battleId) => write({ Action: "Battle.Accept", BattleId: battleId });
var attackMonolith = (battleId, move, round) => write({
  Action: "Battle.Attack",
  BattleId: battleId,
  Move: move,
  // The round this click was made in. Without it a message sent for round N
  // that arrives after round N resolved is silently applied to round N+1 —
  // so a double-click picks your next move for you, and which of the two
  // choices survives is scheduler order rather than click order.
  ...round === void 0 ? {} : { Round: String(round) }
});
async function attack(battleId, move, round, actionId2 = fleetActionId("attack")) {
  let route = fleetRoutes.get(battleId);
  if (!route) {
    const address2 = await activeAddress();
    if (address2) await readPlayer(address2);
    route = fleetRoutes.get(battleId);
  }
  if (!route) return attackMonolith(battleId, move, round);
  const claimedRound = round ?? fleetPlayers.get(battleId)?.battle?.round ?? 0;
  let battle = null;
  try {
    battle = unwrap(await send([
      { name: "Action", value: "Battle.Attack" },
      { name: "BattleId", value: battleId },
      { name: "Move", value: move },
      { name: "Ticket", value: route.ticket },
      { name: "ActionId", value: actionId2 },
      { name: "Round", value: String(claimedRound) }
    ], {
      process: route.workerProcessId,
      node: route.node || HB_NODE,
      // Ordinary rounds have no outbox. Only terminal settlement is pushed.
      requiredOutbox: (reply) => !!reply && typeof reply === "object" && !("error" in reply) && reply.status === "ended"
    }));
  } catch (error) {
    if (error instanceof AcceptedWriteError) {
      const published = await readFleetBattle(route).catch(() => null);
      const cachedAddress = fleetPlayers.get(battleId)?.address ?? await activeAddress();
      if (cachedAddress && validateFleetBattle(published, route, cachedAddress) && published.status === "ended") {
        const delivery = await deliverSlot(error.slot, {
          process: route.workerProcessId,
          node: route.node || HB_NODE
        });
        if (!delivery.delivered) {
          throw new OutboxDeliveryError({
            slot: error.slot,
            action: "battle.attack",
            completed: true,
            cause: error,
            pushStatus: delivery.status,
            confirmed: delivery.confirmed
          });
        }
        battle = published;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
  if (!battle) throw new GameError("The battle worker returned no battle state.");
  const cached = fleetPlayers.get(battleId);
  if (battle.status !== "ended" && cached) {
    const rendered = { ...cached, battle };
    fleetPlayers.set(battleId, rendered);
    return rendered;
  }
  const address = cached?.address ?? await activeAddress();
  if (address) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const settled = await readPlayer(address).catch(() => null);
      if (settled && settled.activeBattleId !== battleId) {
        fleetRoutes.delete(battleId);
        fleetPlayers.delete(battleId);
        return { ...settled, battle, result: battle.winner === "challenger" ? "win" : "loss" };
      }
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 50));
    }
  }
  throw new GameError("The battle ended, but account settlement is not published yet. Refresh; do not replay the terminal attack.");
}
var listChallenges = () => write({ Action: "Battle.OpenChallenges" });
var battleInfo = (battleId) => write({ Action: "Battle.Info", BattleId: battleId });
var readMintVault = () => readState("mintvault");
var readAssetRegistry = () => readJSON("assets");
async function readAssetCount() {
  return Number(await readState("assetcount") ?? 0);
}
async function readMintCost() {
  const cost = await readState("mintcost");
  return Number(cost ?? 0);
}
var mint = () => write({ Action: "Monster.Mint" });
var depositAsset = (assetId) => write({ Action: "Monster.Deposit", AssetId: assetId });
var spriteUpdate = (outfit) => write({ Action: "Sprite.Update" }, JSON.stringify(outfit));
var storeMonster = (monsterId) => write({ Action: "Monster.Store", ...monsterId ? { MonsterId: monsterId } : {} });
var retrieveMonster = (monsterId) => write({ Action: "Monster.Retrieve", MonsterId: monsterId });
var setActiveMonster = (monsterId) => write({ Action: "Monster.SetActive", MonsterId: monsterId });
var transferMonster = (monsterId, recipient) => write({ Action: "Monster.Transfer", MonsterId: monsterId, Recipient: recipient });
var readMarket = (opts = {}) => readGameJSON("market", opts);
var readMarketHistory = (opts = {}) => readJSON("markethistory", opts);
var readMarketStats = (opts = {}) => readJSON("marketstats", opts);
var EMPTY_BOOK = {
  orders: [],
  fills: [],
  market: {},
  desks: {},
  rejected: {}
};
var readEconomy = async (opts = {}) => {
  const [flow, book] = await Promise.all([
    readJSON("economy", opts),
    readJSON("economybook", opts).catch(() => null)
  ]);
  if (!flow) return null;
  return { ...EMPTY_BOOK, ...flow, ...book ?? {} };
};
var orderTags = (options = {}) => ({
  ...options.tif ? { Tif: options.tif } : {},
  ...options.stp ? { Stp: options.stp } : {},
  ...options.expiresIn ? { ExpiresIn: String(Math.floor(options.expiresIn)) } : {}
});
var placeGoldOrder = (side, item, price, quantity, options = {}) => write({
  Action: "Economy.Order.Place",
  Side: side,
  Item: item,
  ActionId: economyActionId("order"),
  Price: String(Math.max(1, Math.floor(price))),
  Quantity: String(Math.max(1, Math.floor(quantity))),
  ...orderTags(options)
});
var amendGoldOrder = (orderId, changes, options = {}) => write({
  Action: "Economy.Order.Amend",
  OrderId: orderId,
  ActionId: economyActionId("amend"),
  ...changes.price !== void 0 ? { Price: String(Math.max(1, Math.floor(changes.price))) } : {},
  ...changes.quantity !== void 0 ? { Quantity: String(Math.max(1, Math.floor(changes.quantity))) } : {},
  ...orderTags(options)
});
var cancelGoldOrder = (orderId) => write({
  Action: "Economy.Order.Cancel",
  OrderId: orderId,
  ActionId: economyActionId("cancel")
});
var cancelGoldOrders = (filter = {}) => write({
  Action: "Economy.Order.CancelAll",
  ActionId: economyActionId("cancelall"),
  ...filter.item ? { Item: filter.item } : {},
  ...filter.orderIds?.length ? { OrderIds: filter.orderIds.join(",") } : {}
});
var maintainGoldOrders = (limit = 25) => write({ Action: "Economy.Order.Maintain", Limit: String(Math.max(1, Math.floor(limit))) });
function ownOrders(player, economy, address) {
  if (player?.openOrders) return player.openOrders;
  if (!economy || !address) return [];
  const now = Date.now();
  return economy.orders.filter((order) => order.account === address && order.expiresAt > now).slice().sort((a, b) => b.createdAt - a.createdAt).map((order) => ({
    id: order.id,
    item: order.item,
    side: order.side,
    price: order.price,
    quantity: order.quantity,
    remaining: order.remaining,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt
  }));
}
var OWN_FILL_LIMIT = 20;
function ownFills(player, economy, address) {
  if (player?.recentFills) return player.recentFills.slice(0, OWN_FILL_LIMIT);
  if (!economy || !address) return [];
  return economy.fills.filter((fill) => fill.buyer === address || fill.seller === address).slice().sort((a, b) => b.filledAt - a.filledAt).slice(0, OWN_FILL_LIMIT).map((fill) => ({
    id: fill.id,
    item: fill.item,
    side: fill.buyer === address ? "buy" : "sell",
    price: fill.price,
    quantity: fill.quantity,
    gross: fill.gross,
    fee: fill.fee,
    filledAt: fill.filledAt,
    role: fill.maker === address ? "maker" : "taker"
  }));
}
var tradeGameShop = (side, item, quantity) => write({
  Action: "Economy.Shop.Trade",
  Side: side,
  Item: item,
  ActionId: economyActionId("shop"),
  Quantity: String(Math.max(1, Math.floor(quantity)))
});
var setPassRecovery = (recovery) => write({ Action: "Pass.SetRecovery", Recovery: recovery });
var claimPromisedPass = (claimId) => write({ Action: "Pass.ClaimPromise", ClaimId: claimId });
var recoverPassAccount = (account, newController) => write({ Action: "Pass.Recover", Account: account, NewController: newController });
var bondPassRune = () => write({ Action: "Pass.Bond" });
var beginPassUnbond = () => write({ Action: "Pass.BeginUnbond" });
var completePassUnbond = () => write({ Action: "Pass.CompleteUnbond" });
var listMonster = (monsterId, price) => write({
  Action: "Market.List",
  MonsterId: monsterId,
  Price: String(Math.max(1, Math.floor(price)))
});
var cancelListing = (listingId) => write({ Action: "Market.Cancel", ListingId: listingId });
var buyListing = (listingId) => write({ Action: "Market.Buy", ListingId: listingId });
async function withdrawRune(amount) {
  const value = Math.max(1, Math.floor(amount));
  const [address, token] = await Promise.all([activeAddress(), runeTokenProcess()]);
  const baseline = address && token ? await tokenBalance(token, address) : null;
  const goal = baseline === null ? null : baseline + BigInt(value);
  return write({
    Action: "Rune.Withdraw",
    Amount: String(value)
  }, void 0, goal === null ? {} : {
    deliveryOptions: {
      confirm: async () => {
        const held = await tokenBalance(token, address);
        return held !== null && held >= goal;
      }
    }
  });
}
var runeTokenId = null;
async function runeTokenProcess() {
  if (runeTokenId) return runeTokenId;
  const value = await readState("runetoken").catch(() => null);
  const id = (value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  runeTokenId = id;
  return id;
}
async function tokenBalance(token, address) {
  let text;
  try {
    text = await readState(`balance-${address}`, { process: token, node: HB_NODE });
  } catch {
    return null;
  }
  if (text === null || text === "") return 0n;
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}
var readWithdrawals = () => write({ Action: "Rune.Withdrawals" });
var readCheckins = () => readJSON("checkins");
var readMetrics = () => readJSON("metrics");
var adminUnlock = (addresses) => write(
  { Action: "Admin.Unlock" },
  JSON.stringify({ addresses })
);
var adminLock = (address) => write({ Action: "Admin.Lock", PlayerId: address });
var adminGrant = (address, opts) => write({
  Action: "Admin.Grant",
  PlayerId: address,
  ...opts.item ? { Item: opts.item, Amount: String(opts.amount ?? 1) } : {},
  ...opts.lootboxes ? { Lootboxes: String(opts.lootboxes), Rarity: String(opts.rarity ?? 1) } : {}
});
var adminSetStats = (address, patch) => write({ Action: "Admin.SetStats", PlayerId: address }, JSON.stringify(patch));
var adminRemove = (address) => write({ Action: "Admin.RemoveUser", PlayerId: address });
var adminUpdateMonsterIndex = async (entryNo, patch) => {
  const view = await write(
    { Action: "Admin.MonsterIndex.Update", EntryNo: String(Math.max(1, Math.floor(entryNo))) },
    JSON.stringify(patch)
  );
  monsterIndexCache.delete(constantKey({}));
  return view;
};
var legacyItems = [
  "rune",
  "fire_berry",
  "water_berry",
  "air_berry",
  "rock_berry",
  "scroll"
];
var legacyFactions = [
  { name: "Inferno Blades", element: "fire" },
  { name: "Aqua Guardians", element: "water" },
  { name: "Sky Nomads", element: "air" },
  { name: "Stone Titans", element: "rock" }
];
function legacySnapshot(exported) {
  const now = Date.now();
  const today = Math.floor(now / 864e5);
  const rows = Array.isArray(exported.players) ? exported.players : [];
  const players = rows.map((player) => {
    const monster = player.monster;
    return {
      address: player.address,
      unlocked: Boolean(player.unlocked),
      faction: player.faction,
      name: monster?.name,
      element: monster?.elementType,
      level: monster?.level ?? 0,
      exp: monster?.exp ?? 0,
      energy: monster?.energy ?? 0,
      happiness: monster?.happiness ?? 0,
      status: monster?.status?.type ?? "No companion",
      inventory: player.inventory ?? {},
      gold: player.gold ?? 0,
      lootboxes: Array.isArray(player.lootboxes) ? player.lootboxes : [],
      wins: player.wins ?? 0,
      losses: player.losses ?? 0,
      questsCompleted: player.questsCompleted ?? 0,
      battlesRemaining: player.battlesRemaining ?? 0,
      activeBattleId: player.activeBattleId,
      dailyStreak: player.dailyStreak ?? 0,
      bestStreak: player.bestStreak ?? 0,
      offerings: player.offerings ?? 0,
      lastDaily: player.lastDaily ?? 0,
      joinedAt: player.joinedAt ?? 0,
      lastActiveAt: player.lastActiveAt ?? 0,
      lastAction: player.lastAction,
      assets: Object.keys(player.assets ?? {}).length,
      passOrigin: player.pass?.origin,
      accountId: player.pass?.accountId,
      recoveryCooldownUntil: player.pass?.recoveryCooldownUntil ?? 0,
      runeBond: player.pass?.bond ?? 0
    };
  });
  const battles = [...new Set(players.flatMap((player) => player.activeBattleId ? [player.activeBattleId] : []))].map((id) => ({
    id,
    kind: "pvp",
    status: "battling",
    round: 0,
    startedAt: 0
  }));
  const factions = legacyFactions.map(({ name, element }) => {
    const members = players.filter((player) => player.faction === name);
    const companions = members.filter((player) => player.name);
    return {
      name,
      element,
      members: members.length,
      companions: companions.length,
      averageLevel: companions.length ? companions.reduce((sum, player) => sum + player.level, 0) / companions.length : 0,
      wins: members.reduce((sum, player) => sum + player.wins, 0),
      losses: members.reduce((sum, player) => sum + player.losses, 0),
      quests: members.reduce((sum, player) => sum + player.questsCompleted, 0),
      runes: members.reduce((sum, player) => sum + Number(player.inventory.rune ?? 0), 0),
      offerings: members.reduce((sum, player) => sum + player.offerings, 0),
      worshipersToday: members.filter((player) => Math.floor((player.lastDaily ?? 0) / 864e5) === today).length,
      feeds: 0,
      plays: 0
    };
  });
  const items = Object.fromEntries(legacyItems.map((item) => [
    item,
    players.reduce((sum, player) => sum + Number(player.inventory[item] ?? 0), 0)
  ]));
  const lootboxes = players.reduce((sum, player) => sum + player.lootboxes.reduce((subtotal, value) => subtotal + Number(value ?? 0), 0), 0);
  return {
    generatedAt: now,
    players,
    battles,
    factions,
    stats: {
      // `total` remains authoritative if the legacy process has more than its
      // maximum 50-row export page. The visible directory is deliberately the
      // single signed page; a full modern snapshot arrives after redeploy.
      players: Number(exported.total ?? players.length),
      unlocked: players.filter((player) => player.unlocked).length,
      monsters: players.filter((player) => player.name).length,
      activeBattles: battles.length,
      completedBattles: players.reduce((sum, player) => sum + player.wins, 0),
      wins: players.reduce((sum, player) => sum + player.wins, 0),
      losses: players.reduce((sum, player) => sum + player.losses, 0),
      quests: players.reduce((sum, player) => sum + player.questsCompleted, 0),
      runes: Number(items.rune ?? 0),
      lootboxes,
      offerings: players.reduce((sum, player) => sum + player.offerings, 0),
      activeToday: players.filter((player) => Math.floor(player.lastActiveAt / 864e5) === today).length,
      items,
      mintedAssets: players.reduce((sum, player) => sum + player.assets, 0)
    },
    metrics: exported.metrics ?? { since: now, totals: {}, daily: {} },
    audit: Array.isArray(exported.audit) ? exported.audit : []
  };
}
function legacyAdminSnapshot() {
  return write({
    Action: "Admin.Export",
    Offset: "0",
    Limit: "50"
  }).then(legacySnapshot);
}
var usesLegacyAdminApi = () => adminSnapshotMode === "legacy";
function adminSnapshot({ force = false } = {}) {
  if (!force && adminSnapshotCache) return Promise.resolve(adminSnapshotCache);
  if (adminSnapshotInFlight) return adminSnapshotInFlight;
  if (force) adminSnapshotCache = null;
  const request = adminSnapshotMode === "legacy" ? legacyAdminSnapshot() : write({ Action: "Admin.Snapshot" }).catch((error) => {
    if (!/unknown action ['"]?Admin\.Snapshot/i.test(String(error))) throw error;
    adminSnapshotMode = "legacy";
    return legacyAdminSnapshot();
  });
  adminSnapshotInFlight = request.then((snapshot) => {
    adminSnapshotCache = snapshot;
    return snapshot;
  }).finally(() => {
    adminSnapshotInFlight = null;
  });
  return adminSnapshotInFlight;
}
var adminAdjustInventory = (address, item, delta) => write({
  Action: "Admin.AdjustInventory",
  PlayerId: address,
  Item: item,
  Delta: String(delta)
});
var adminUpdatePlayer = (address, patch) => write(
  { Action: "Admin.UpdatePlayer", PlayerId: address },
  JSON.stringify(patch)
);
var adminReleaseBattle = (address) => write({
  Action: "Admin.ReleaseBattle",
  PlayerId: address
});
var adminPreviewEconomyPolicy = (path, value) => write(
  { Action: "Admin.Economy.Preview" },
  JSON.stringify({ path, value })
);
var adminProposeEconomyPolicy = (path, value, reason) => write(
  { Action: "Admin.Economy.Propose" },
  JSON.stringify({ path, value, reason })
);
var adminApplyEconomyPolicy = (changeId) => write({
  Action: "Admin.Economy.Apply",
  ChangeId: changeId
});
var adminEmergencyPauseEconomy = (reason) => write({
  Action: "Admin.Economy.EmergencyPause",
  Reason: reason
});
var adminPauseEconomyDesk = (item, side, reason) => write({
  Action: "Admin.Economy.PauseDesk",
  Item: item,
  Side: side,
  Reason: reason
});
var adminObserveRuneSupply = (totalSupply, reason) => write({
  Action: "Admin.Economy.ObserveRuneSupply",
  TotalSupply: String(Math.max(0, Math.floor(totalSupply))),
  Reason: reason
});
var adminReleaseGold = (item, amount, reason) => write({
  Action: "Admin.Economy.ReleaseGold",
  Item: item,
  Amount: String(Math.max(1, Math.floor(amount))),
  Reason: reason
});
var adminObserveGoldPolicy = (reason) => write({ Action: "Admin.Economy.ObserveGold", Reason: reason });
var adminConfigureGenesisPasses = (configuration) => write(
  { Action: "Admin.Pass.ConfigureGenesis" },
  JSON.stringify(configuration)
);
var adminAdjustAll = (opts) => write({
  Action: "Admin.AdjustAll",
  ...opts.energy !== void 0 ? { Energy: String(opts.energy) } : {},
  ...opts.happiness !== void 0 ? { Happiness: String(opts.happiness) } : {},
  ...opts.attack ? { Attack: String(opts.attack) } : {},
  ...opts.defense ? { Defense: String(opts.defense) } : {},
  ...opts.speed ? { Speed: String(opts.speed) } : {},
  ...opts.health ? { Health: String(opts.health) } : {},
  ...opts.rerollMoves ? { RerollMoves: "true" } : {}
});

// src/lib/hunt.ts
function unwrap2(reply) {
  if (reply && typeof reply === "object" && "error" in reply && reply.error) {
    throw new GameError(String(reply.error));
  }
  return reply;
}
var actionId = (kind) => {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `${kind}_${random}`;
};
var tags = (route, extra = {}) => [
  { name: "RunId", value: route.runId },
  { name: "Ticket", value: route.ticket },
  ...Object.entries(extra).map(([name, value]) => ({ name, value }))
];
var write2 = async (route, action, extra = {}, requiredOutbox = false) => unwrap2(await send([
  { name: "Action", value: action },
  ...tags(route, extra)
], {
  process: route.processId,
  node: route.node || HB_NODE,
  requiredOutbox
}));
var readHunt = (route, signal) => readJSON(`hunt-run-${route.runId}`, {
  process: route.processId,
  node: route.node || HB_NODE,
  signal
}).then(joined);
var search = (route) => write2(route, "Hunt.Search", { ActionId: actionId("search") });
var attack2 = (route, move, round) => write2(route, "Hunt.Attack", {
  Move: move,
  Round: String(round),
  ActionId: actionId("attack")
}, (reply) => !!reply && !reply.error && reply.status === "lost");
var declineCapture = (route) => write2(route, "Hunt.Decline");
var capture = (route, runes) => write2(route, "Hunt.Capture", {
  Runes: String(runes),
  ActionId: actionId("capture")
}, true);
var retrySettlement = (route) => write2(route, "Hunt.RetrySettlement", {}, true);
var end = (route) => write2(route, "Hunt.End", {}, true);

// src/lib/marketplace-config.ts
var MARKET_DEFAULTS = {
  rune: "LXgcav_zNCPz55uOKIFd2lPxCaKzpfc4gdErwxWLz7c",
  quote: "yoNoxm-GUbQiefsgOaWfln2Xb6wVW60fsqp1t4LoGck",
  node: "https://hyperbeam.tylerw.ai"
};

// src/lib/marketplace.ts
var env2 = define_import_meta_env_default ?? {};
var ID = /^[A-Za-z0-9_-]{43}$/;
var RUNE_PROCESS = env2.VITE_RUNE_PROCESS || MARKET_DEFAULTS.rune;
var QUOTE_PROCESS = env2.VITE_QUOTE_PROCESS || MARKET_DEFAULTS.quote;
var MARKET_NODE = env2.VITE_MARKET_NODE || MARKET_DEFAULTS.node || void 0;
var exchangeConfigured = () => [RUNE_PROCESS, QUOTE_PROCESS].every((value) => ID.test(value));
function unwrap3(reply) {
  if (reply && typeof reply === "object" && "error" in reply && reply.error) {
    throw new Error(String(reply.error));
  }
  return reply;
}
var OUTBOX_EXCHANGE_ACTIONS = /* @__PURE__ */ new Set(["Transfer", "Burn"]);
var write3 = async (process, tags2) => {
  if (!ID.test(process)) throw new Error("This external exchange process has not been deployed yet.");
  return unwrap3(await send(
    Object.entries(tags2).map(([name, value]) => ({ name, value })),
    {
      process,
      node: MARKET_NODE,
      requiredOutbox: OUTBOX_EXCHANGE_ACTIONS.has(tags2.Action)
    }
  ));
};
var readMarketJSON = (process, key) => {
  if (!ID.test(process)) return Promise.resolve(null);
  return readJSON(key, { process, node: MARKET_NODE });
};
var readTokenInfo = (token) => readMarketJSON(token, "tokeninfo");
async function readTokenBalance(token, address) {
  if (!ID.test(token) || !ID.test(address)) return "0";
  const direct = await readState(`balance-${address}`, { process: token, node: MARKET_NODE });
  if (direct !== null && /^\d+$/.test(direct)) return direct;
  const balances = await readMarketJSON(token, "balances");
  return balances?.[address] ?? "0";
}
var claimQuoteFaucet = () => write3(QUOTE_PROCESS, { Action: "Faucet" });
var depositRuneToGame = (quantity) => write3(RUNE_PROCESS, { Action: "Burn", Quantity: quantity });
function parseUnits(value, denomination) {
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Enter a positive number.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > denomination) {
    throw new Error(`This token supports at most ${denomination} decimal places.`);
  }
  const atomic = BigInt(whole) * 10n ** BigInt(denomination) + BigInt((fraction + "0".repeat(denomination)).slice(0, denomination) || "0");
  if (atomic <= 0n) throw new Error("Amount must be greater than zero.");
  return atomic.toString();
}
function formatUnits(value, denomination, maxFraction = 6) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  if (denomination === 0) return amount.toString();
  const scale = 10n ** BigInt(denomination);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(denomination, "0").slice(0, Math.max(0, maxFraction)).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export {
  AcceptedWriteError,
  AmbiguousWriteError,
  GAME_PROCESS,
  MARKET_NODE,
  OutboxDeliveryError,
  QUOTE_PROCESS,
  RUNE_PROCESS,
  acceptChallenge,
  adminAdjustAll,
  adminAdjustInventory,
  adminApplyEconomyPolicy,
  adminConfigureGenesisPasses,
  adminEmergencyPauseEconomy,
  adminGrant,
  adminLock,
  adminObserveGoldPolicy,
  adminObserveRuneSupply,
  adminPauseEconomyDesk,
  adminPreviewEconomyPolicy,
  adminProposeEconomyPolicy,
  adminReleaseBattle,
  adminReleaseGold,
  adminRemove,
  adminSetStats,
  adminSnapshot,
  adminUnlock,
  adminUpdateMonsterIndex,
  adminUpdatePlayer,
  adopt,
  amendGoldOrder,
  attack,
  battleInfo,
  beginHunt,
  beginPassUnbond,
  bondPassRune,
  buyListing,
  cancelGoldOrder,
  cancelGoldOrders,
  cancelListing,
  challenge,
  claim,
  claimDaily,
  claimPromisedPass,
  claimQuoteFaucet,
  completePassUnbond,
  depositAsset,
  depositRuneToGame,
  enterArena,
  exchangeConfigured,
  feed,
  formatUnits,
  attack2 as huntAttack,
  capture as huntCapture,
  declineCapture as huntDeclineCapture,
  end as huntEnd,
  retrySettlement as huntRetrySettlement,
  search as huntSearch,
  joinFaction,
  joined,
  learnMove,
  leaveArena,
  levelUp,
  listChallenges,
  listFactions,
  listMonster,
  login,
  maintainGoldOrders,
  mint,
  openLootbox,
  ownFills,
  ownOrders,
  parseUnits,
  placeGoldOrder,
  deliverSlot as rawDeliverSlot,
  pendingDeliveries as rawPendingDeliveries,
  readJSON as rawReadJSON,
  readSlot as rawReadSlot,
  readState as rawReadState,
  send as rawSend,
  sendMessage as rawSendMessage,
  readAccess,
  readAssetCount,
  readAssetRegistry,
  readBattle,
  readBattleFleet,
  readCatalog,
  readChallenges,
  readCheckins,
  readEconomy,
  readFactions,
  readHunt,
  readLeaderboard,
  readMarket,
  readMarketHistory,
  readMarketStats,
  readMetrics,
  readMintCost,
  readMintVault,
  readMonsterIndex,
  readPlayer,
  readPlayerCount,
  readTokenBalance,
  readTokenInfo,
  readWithdrawals,
  recoverPassAccount,
  resetSettleObservations,
  retrieveMonster,
  setActiveMonster,
  setPassRecovery,
  setTransportObserver,
  spriteUpdate,
  startBotBattle,
  startPlay,
  startQuest,
  stats,
  storeMonster,
  tradeGameShop,
  transferMonster,
  usesLegacyAdminApi,
  withdrawRune
};
