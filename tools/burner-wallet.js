/**
 * burner-wallet.js — a wallet extension, in a script tag.
 *
 * TESTING ONLY. This is never imported by the app; it is pasted into a page's
 * console (or injected by a browser-automation tool) so the real UI can be
 * driven end to end without a wallet extension and without ever touching a
 * wallet that holds anything.
 *
 *   await installBurner(<jwk object from .burners/burner-01.json>)
 *
 * It implements the one method the app actually calls — `signDataItem` — by
 * building a real ANS-104 data item and signing it with WebCrypto. The bytes it
 * produces are the same bytes Wander would produce, so what this exercises is
 * the real write path, not a mock of it.
 *
 * The Node twin of this file is `backend/native/ans104.mjs`; the two must agree.
 */
(function () {
  const enc = new TextEncoder();
  const b64urlDec = (s) => {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  const b64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const concat = (...parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  const sha = async (algo, bytes) =>
    new Uint8Array(await crypto.subtle.digest(algo, bytes));

  // Arweave's deep hash, over a nested list of byte arrays.
  async function deepHash(value) {
    if (Array.isArray(value)) {
      let acc = await sha('SHA-384', enc.encode(`list${value.length}`));
      for (const chunk of value) {
        acc = await sha('SHA-384', concat(acc, await deepHash(chunk)));
      }
      return acc;
    }
    const data = value instanceof Uint8Array ? value : new Uint8Array(value);
    const tag = await sha('SHA-384', enc.encode(`blob${data.length}`));
    return sha('SHA-384', concat(tag, await sha('SHA-384', data)));
  }

  // Avro: zigzag varint, then length-prefixed utf8 for each name and value.
  function zigzag(n) {
    let v = (n << 1) ^ (n >> 31);
    const bytes = [];
    v >>>= 0;
    while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
    bytes.push(v);
    return new Uint8Array(bytes);
  }
  function avroString(s) {
    const body = enc.encode(s);
    return concat(zigzag(body.length), body);
  }
  function encodeTags(tags) {
    if (!tags || !tags.length) return new Uint8Array(0);
    const parts = [zigzag(tags.length)];
    for (const { name, value } of tags) {
      parts.push(avroString(String(name)), avroString(String(value)));
    }
    parts.push(new Uint8Array([0]));
    return concat(...parts);
  }

  function u64le(n) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
    return out;
  }

  window.installBurner = async function installBurner(jwk) {
    const key = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, kty: 'RSA', alg: 'PS256', ext: true, key_ops: ['sign'] },
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const owner = b64urlDec(jwk.n);
    const address = b64url(await sha('SHA-256', owner));

    window.arweaveWallet = {
      async connect() {},
      async disconnect() {},
      async getActiveAddress() { return address; },
      async getPermissions() {
        return ['ACCESS_ADDRESS', 'ACCESS_PUBLIC_KEY', 'SIGN_TRANSACTION'];
      },
      async signDataItem(item) {
        const target = item.target ? b64urlDec(item.target) : new Uint8Array(0);
        const anchor = new Uint8Array(0);
        const tagBytes = encodeTags(item.tags ?? []);
        const data = enc.encode(item.data ?? '');

        const digest = await deepHash([
          enc.encode('dataitem'), enc.encode('1'), enc.encode('1'),
          owner, target, anchor, tagBytes, data,
        ]);
        const signature = new Uint8Array(await crypto.subtle.sign(
          { name: 'RSA-PSS', saltLength: 32 }, key, digest,
        ));

        return concat(
          new Uint8Array([1, 0]),
          signature,
          owner,
          target.length ? concat(new Uint8Array([1]), target) : new Uint8Array([0]),
          anchor.length ? concat(new Uint8Array([1]), anchor) : new Uint8Array([0]),
          u64le(item.tags?.length ?? 0),
          u64le(tagBytes.length),
          tagBytes,
          data,
        ).buffer;
      },
    };

    // The app reconnects on this event, which is how it notices the swap
    // without a reload.
    window.dispatchEvent(new CustomEvent('walletSwitch', { detail: { address } }));
    return address;
  };
})();
