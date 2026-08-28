// hbclient.mjs — minimal, dependency-free HyperBEAM (httpsig@1.0) client.
//
// Reimplements the server-side encoder found in HyperBEAM at
//   src/preloaded/codec/dev_httpsig_conv.erl   (message -> headers + multipart body)
//   src/preloaded/codec/dev_httpsig.erl        (content-digest, signature base)
//   src/preloaded/codec/dev_httpsig_siginfo.erl(signature / signature-input headers)
//   src/preloaded/codec/dev_structured.erl     (rich types -> TABM + ao-types)
//
// Node >= 18. Uses only node:crypto.

import crypto from 'node:crypto';

const CRLF = '\r\n';
const MAX_HEADER_LENGTH = 4096;
const DERIVED_COMPONENTS = new Set([
  'method', 'target-uri', 'authority', 'scheme',
  'request-target', 'path', 'query', 'query-param'
]);

/* ------------------------------------------------------------------ *
 * base64 helpers                                                      *
 * ------------------------------------------------------------------ */
const b64url = (buf) => Buffer.from(buf).toString('base64url');           // no padding
const b64urlDec = (s) => Buffer.from(s, 'base64url');
const b64std = (buf) => Buffer.from(buf).toString('base64');              // padded
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/* ------------------------------------------------------------------ *
 * Structured Fields (RFC 9651) — only the serialisation we need        *
 * ------------------------------------------------------------------ */
function sfString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function sfBareItem(v) {
  if (v && v.__sf === 'binary') return ':' + b64std(v.value) + ':';
  if (v && v.__sf === 'token') return String(v.value);
  if (v && v.__sf === 'string') return sfString(v.value);
  if (typeof v === 'number') return String(v);
  return sfString(v);
}
const sfBin = (buf) => ({ __sf: 'binary', value: buf });
const sfTok = (s) => ({ __sf: 'token', value: s });
const sfStr = (s) => ({ __sf: 'string', value: s });

function sfParams(params) {
  // params: array of [name, value]
  return params.map(([k, v]) => ';' + k + '=' + sfBareItem(v)).join('');
}
function sfInnerList(items, params) {
  return '(' + items.map((i) => sfBareItem(i)).join(' ') + ')' + sfParams(params || []);
}
function sfDict(entries) {
  // entries: array of [key, serialisedValueString]
  return entries.map(([k, v]) => k + '=' + v).join(', ');
}

/* ------------------------------------------------------------------ *
 * Erlang-compatible ordering: binaries compare byte-wise, shorter      *
 * prefix first.  That is exactly Buffer.compare.                       *
 * ------------------------------------------------------------------ */
function binCmp(a, b) {
  return Buffer.compare(Buffer.from(a, 'binary'), Buffer.from(b, 'binary'));
}
const sortedKeys = (obj) => Object.keys(obj).sort(binCmp);

/* ------------------------------------------------------------------ *
 * hb_escape                                                           *
 * ------------------------------------------------------------------ */
function encodeHeaderValue(v) {
  // hb_escape:encode_header/1 — only \\, CR and LF are escaped.
  const s = Buffer.isBuffer(v) ? v.toString('latin1') : String(v);
  return s.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
function decodeHeaderValue(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === '\\') { out += '\\'; i++; continue; }
      if (n === 'r') { out += '\r'; i++; continue; }
      if (n === 'n') { out += '\n'; i++; continue; }
    }
    out += s[i];
  }
  return out;
}
const URI_SAFE = /^[a-z0-9.\-_/?&]*$/;
function escapeKey(k) {
  if (URI_SAFE.test(k)) return k;
  let out = '';
  for (const byte of Buffer.from(k, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (/[a-z0-9.\-_/?&]/.test(c)) out += c;
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
const IS_ID = (k) => /^[a-zA-Z0-9_-]{43}$/.test(k);

/* ------------------------------------------------------------------ *
 * structured@1.0  ->  TABM                                            *
 * A TABM node is: Buffer (leaf) | { key: TABMnode }  plus `ao-types`.  *
 * ------------------------------------------------------------------ */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v);
}

function toTabm(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Array.isArray(value)) {
    const numbered = {};
    value.forEach((v, i) => { numbered[String(i + 1)] = v; });
    const m = toTabm(numbered);
    const types = parseAoTypes(m['ao-types']);
    types['.'] = 'list';
    m['ao-types'] = Buffer.from(encodeAoTypes(types), 'utf8');
    return m;
  }
  if (isPlainObject(value)) {
    const types = {};
    const out = {};
    for (const key of sortedKeys(value)) {
      if (key === 'commitments' || key === 'priv' || key.startsWith('priv/')) continue;
      const v = value[key];
      if (v === undefined) continue;
      if (typeof v === 'string' || Buffer.isBuffer(v)) {
        out[key] = toTabm(v);
      } else if (Array.isArray(v) || isPlainObject(v)) {
        out[key] = toTabm(v);
      } else if (typeof v === 'number') {
        if (Number.isInteger(v)) { types[key] = 'integer'; out[key] = Buffer.from(String(v)); }
        else { types[key] = 'float'; out[key] = Buffer.from(String(v)); }
      } else if (typeof v === 'boolean' || v === null) {
        types[key] = 'atom';
        out[key] = Buffer.from(v === null ? 'null' : String(v));
      }
    }
    if (Object.keys(types).length) out['ao-types'] = Buffer.from(encodeAoTypes(types), 'utf8');
    return out;
  }
  return Buffer.from(String(value), 'utf8');
}

function encodeAoTypes(types) {
  return sfDict(sortedKeys(types).map((k) => [escapeKey(k), sfString(types[k])]));
}
function parseAoTypes(bin) {
  if (!bin) return {};
  const s = Buffer.isBuffer(bin) ? bin.toString('utf8') : String(bin);
  const out = {};
  for (const part of s.split(',')) {
    const m = part.trim().match(/^([^=]+)="([^"]*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * TABM -> httpsig@1.0  (dev_httpsig_conv:to/3)                        *
 * ------------------------------------------------------------------ */
function inlineKey(msg) {
  const explicit = msg['ao-body-key'];
  if (explicit !== undefined) {
    return { extra: {}, key: Buffer.isBuffer(explicit) ? explicit.toString() : String(explicit) };
  }
  if (Object.prototype.hasOwnProperty.call(msg, 'body')) return { extra: {}, key: 'body' };
  if (Object.prototype.hasOwnProperty.call(msg, 'data')) {
    return { extra: { 'ao-body-key': Buffer.from('data') }, key: 'data' };
  }
  return { extra: {}, key: 'body' };
}

/** group_maps/4 — flatten nested part maps into `parent/child` part names. */
function groupMaps(map, parent, top) {
  const flattened = {};
  for (const key of sortedKeys(map)) {
    const value = map[key];
    const normKey = key; // hb_ao:normalize_key/1 is the identity for binaries
    const flatK = parent === '' ? normKey : parent + '/' + normKey;
    if (isPlainObject(value)) {
      if (Object.keys(value).length === 0) {
        top[flatK] = { 'ao-types': Buffer.from('empty-message') };
      } else {
        top = groupMaps(value, flatK, top);
      }
    } else {
      const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      if (normKey === 'content-disposition' || buf.length > MAX_HEADER_LENGTH) {
        top[flatK] = buf;
      } else {
        flattened[normKey] = buf;
      }
    }
  }
  if (Object.keys(flattened).length === 0) return top;
  if (parent === '') return Object.assign({}, top, flattened);
  top[parent] = flattened;
  return top;
}

/** encode_http_flat_msg/2 — a flat map of binaries into an HTTP header block. */
function encodeFlatMsg(msg) {
  const headerKeys = sortedKeys(msg).filter((k) => k !== 'body' && k !== 'priv');
  const headers = headerKeys
    .map((k) => Buffer.concat([Buffer.from(k + ': '), asBuf(msg[k])]))
    .reduce((acc, b, i) => (i === 0 ? [b] : acc.concat([Buffer.from(CRLF), b])), []);
  const head = Buffer.concat(headers);
  const body = msg.body === undefined ? Buffer.alloc(0) : asBuf(msg.body);
  if (body.length === 0) return head;
  return Buffer.concat([head, Buffer.from(CRLF + CRLF), body]);
}
const asBuf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v)));

function encodeBodyPart(partName, part, inlKey) {
  const disposition =
    partName === inlKey ? 'inline' : `form-data;name="${partName}"`;
  if (isPlainObject(part)) {
    return encodeFlatMsg(Object.assign({}, part, {
      'content-disposition': Buffer.from(disposition)
    }));
  }
  return Buffer.concat([
    Buffer.from('content-disposition: ' + disposition + CRLF + CRLF),
    asBuf(part)
  ]);
}

/**
 * Encode a TABM into { headers: {k: string}, body: Buffer|null }.
 * Mirrors do_to/3 exactly, including the content-digest.
 */
function tabmToHttp(tabm) {
  const stripped = {};
  for (const k of Object.keys(tabm)) {
    if (['commitments', 'signature', 'signature-input', 'priv'].includes(k)) continue;
    stripped[IS_ID(k) ? escapeKey(k) : k] = tabm[k];
  }
  const { extra, key: inlKey } = inlineKey(stripped);

  const headers = {};
  const bodyMap = {};
  for (const [k, v] of Object.entries(extra)) headers[k] = v;

  for (const key of sortedKeys(stripped)) {
    const value = stripped[key];
    if (key === 'body') { bodyMap['body'] = value; continue; }
    if (key === inlKey) { bodyMap[inlKey] = value; continue; }
    if (isPlainObject(value)) { bodyMap[key] = value; continue; }
    const buf = asBuf(value);
    if (buf.length <= MAX_HEADER_LENGTH) headers[key] = buf;
    else bodyMap[key] = buf;
  }

  const grouped = groupMaps(bodyMap, '', {});
  const gKeys = sortedKeys(grouped);

  let body = null;
  if (gKeys.length === 0) {
    body = null;
  } else if (gKeys.length === 1 && gKeys[0] === inlKey && Buffer.isBuffer(grouped[inlKey])) {
    body = grouped[inlKey];
  } else {
    const parts = gKeys.map((k) => {
      const v = grouped[k];
      if (isPlainObject(v) && Object.keys(v).length === 1 &&
          Object.prototype.hasOwnProperty.call(v, 'body')) {
        return encodeBodyPart(k + '/body', v, 'body');
      }
      return encodeBodyPart(k, v, inlKey);
    });
    const joined = parts.reduce(
      (acc, p, i) => (i === 0 ? [p] : acc.concat([Buffer.from(CRLF), p])), []);
    const boundary = b64url(sha256(Buffer.concat(joined)));
    const withMarkers = parts.reduce(
      (acc, p, i) => acc.concat(
        i === 0 ? [] : [Buffer.from(CRLF)],
        [Buffer.from('--' + boundary + CRLF), p]
      ), []);
    body = Buffer.concat([
      Buffer.concat(withMarkers),
      Buffer.from(CRLF + '--' + boundary + '--')
    ]);
    headers['content-type'] = Buffer.from(`multipart/form-data; boundary="${boundary}"`);
  }

  const outHeaders = {};
  for (const k of Object.keys(headers)) outHeaders[k] = encodeHeaderValue(headers[k]);
  if (body && body.length) {
    outHeaders['content-digest'] = 'sha-256=:' + b64std(sha256(body)) + ':';
  }
  return { headers: outHeaders, body };
}

/* ------------------------------------------------------------------ *
 * Signature base (dev_httpsig:signature_base/3)                        *
 * ------------------------------------------------------------------ */
function addDerivedSpecifiers(keys) {
  return keys.map((k) => {
    const bare = k.startsWith('@') ? k.slice(1) : k;
    return DERIVED_COMPONENTS.has(bare) ? '@' + bare : bare;
  });
}

function signatureBase(encHeaders, committed, params) {
  const lines = committed.map((name) => {
    const v = encHeaders[name];
    if (v === undefined) {
      throw new Error('missing_key_for_signature_component_line: ' + name);
    }
    return `"${name}": ${v}`;
  });
  const paramsLine = sfInnerList(
    addDerivedSpecifiers(committed).map((k) => sfStr(k)),
    params
  );
  return Buffer.from(lines.join('\n') + '\n"@signature-params": ' + paramsLine, 'utf8');
}

/** the RFC-9421 params, in the order HyperBEAM emits them */
function commitmentParams({ alg, bundle, created, expires, keyid, nonce, tag }) {
  const out = [];
  if (alg !== undefined) out.push(['alg', sfStr(alg)]);
  if (bundle !== undefined) out.push(['bundle', sfStr(bundle)]);
  if (created !== undefined) out.push(['created', created]);
  if (expires !== undefined) out.push(['expires', expires]);
  if (keyid !== undefined) out.push(['keyid', sfStr(keyid)]);
  if (nonce !== undefined) out.push(['nonce', sfStr(nonce)]);
  if (tag !== undefined) out.push(['tag', sfStr(tag)]);
  return out;
}

/* ------------------------------------------------------------------ *
 * RSA-PSS-SHA512 with an Arweave JWK                                   *
 * ------------------------------------------------------------------ */
function jwkToPrivateKey(jwk) {
  return crypto.createPrivateKey({ key: { ...jwk, kty: 'RSA' }, format: 'jwk' });
}
function pubKeyBuf(jwk) { return b64urlDec(jwk.n); }              // raw modulus
export function ownerToAddress(nB64url) { return b64url(sha256(b64urlDec(nB64url))); }
export function jwkToAddress(jwk) { return ownerToAddress(jwk.n); }

function rsaPssSign(jwk, data) {
  return crypto.sign('sha512', data, {
    key: jwkToPrivateKey(jwk),
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 64 // SHA-512 digest length; ar_wallet/rsa_pss uses saltLen == hashLen
  });
}
function rsaPssVerify(modulusBuf, data, sig) {
  const jwk = { kty: 'RSA', n: b64url(modulusBuf), e: 'AQAB' };
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return crypto.verify('sha512', data, {
    key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 64
  }, sig);
}

/* ------------------------------------------------------------------ *
 * Nested (sub-message) commitments.                                    *
 *                                                                      *
 * A HyperBEAM node, on decoding a request, gives every *unsigned*       *
 * sub-message an implicit `hmac-sha256` commitment keyed `constant:ao`. *
 * Those commitments are then part of the message, and re-encoding the   *
 * message emits them as extra multipart parts named                     *
 *   <path>/commitments/<id>   and   <path>/commitments/<id>/committed   *
 * which changes the body bytes -- and therefore the content-digest.     *
 * A client that does not pre-compute them can never produce a           *
 * verifiable multipart message.                                         *
 * ------------------------------------------------------------------ */

/** wire (httpsig) committed-key list -> AO-Core message key list */
function wireToMessageKeys(wire, bodyKeys, headers) {
  let out = [];
  for (const k of wire) {
    if (k === 'content-digest') out.push(...bodyKeys);
    else out.push(k);
  }
  if (headers['ao-body-key'] !== undefined) {
    const abk = String(headers['ao-body-key']);
    out = out.flatMap((k) => (k === 'body' ? [abk] : [k])).filter((k) => k !== 'ao-body-key');
  }
  if (/^multipart\//.test(String(headers['content-type'] || ''))) {
    out = out.filter((k) => k !== 'content-type');
  }
  return out;
}

function isListTabm(sub) {
  const t = parseAoTypes(sub['ao-types']);
  return t['.'] === 'list';
}

/** Attach the implicit `constant:ao` hmac commitment to a TABM sub-message. */
function hmacCommit(subTabm) {
  const bare = { ...subTabm };
  delete bare.commitments;
  const { headers } = tabmToHttp(bare);
  const wire = sortedKeys(headers).filter((k) => k !== 'signature' && k !== 'signature-input');
  const params = commitmentParams({ alg: 'hmac-sha256', keyid: 'constant:ao' });
  const base = signatureBase(headers, wire, params);
  const mac = crypto.createHmac('sha256', 'constant:ao').update(base).digest();
  const id = b64url(mac);
  const rawInputs = sortedKeys(bare);
  const bodyKeys = rawInputs.filter((k) => headers[k] === undefined && headers[k + '+link'] === undefined);
  const committed = wireToMessageKeys(wire, bodyKeys, headers);
  return {
    ...subTabm,
    commitments: {
      [id]: {
        'commitment-device': Buffer.from('httpsig@1.0'),
        committed: toTabm(committed),
        keyid: Buffer.from('constant:ao'),
        signature: Buffer.from(id),
        type: Buffer.from('hmac-sha256')
      }
    }
  };
}

/** Recursively give every unsigned sub-message its implicit hmac commitment. */
function withNestedHmacs(tabm) {
  if (!isPlainObject(tabm)) return tabm;
  const out = {};
  for (const [k, v] of Object.entries(tabm)) {
    if (k === 'commitments') { out[k] = v; continue; }
    if (isPlainObject(v)) {
      const inner = withNestedHmacs(v);
      out[k] = (isListTabm(v) || v.commitments) ? inner : hmacCommit(inner);
    } else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Commit: message -> fully-signed { headers, body }                    *
 * ------------------------------------------------------------------ */
export function commit(msg, jwk, opts = {}) {
  const { bundle = 'true', nestedHmacs = true, ...params0 } = opts;
  const tabm = nestedHmacs ? withNestedHmacs(toTabm(msg)) : toTabm(msg);
  const { headers, body } = tabmToHttp(tabm);

  // default committed set == every encoded header, sorted (Erlang flat-map order)
  const committed = sortedKeys(headers).filter(
    (k) => k !== 'signature' && k !== 'signature-input'
  );

  const keyid = 'publickey:' + b64std(pubKeyBuf(jwk));
  const params = commitmentParams({ alg: 'rsa-pss-sha512', bundle, keyid, ...params0 });
  const base = signatureBase(headers, committed, params);
  const sig = rsaPssSign(jwk, base);
  const name = 'comm-' + b64url(sha256(sig)).toLowerCase();

  const outHeaders = { ...headers };
  outHeaders['signature'] = sfDict([[name, ':' + b64std(sig) + ':']]);
  outHeaders['signature-input'] = sfDict([[name, sfInnerList(
    addDerivedSpecifiers(committed).map((k) => sfStr(k)), params)]]);

  return { headers: outHeaders, body, signatureBase: base, committed, sigName: name };
}

/* ------------------------------------------------------------------ *
 * Verification of an inbound (node-signed) message — used as an oracle *
 * ------------------------------------------------------------------ */
export function verifyHeaders(headersObj, bodyBuf) {
  const headers = {};
  for (const [k, v] of Object.entries(headersObj)) headers[k.toLowerCase()] = v;
  const sigHdr = headers['signature'];
  const sigInHdr = headers['signature-input'];
  if (!sigHdr || !sigInHdr) return { ok: false, reason: 'no signature headers' };

  const enc = { ...headers };
  delete enc['signature']; delete enc['signature-input'];
  if (bodyBuf && bodyBuf.length) {
    enc['content-digest'] = 'sha-256=:' + b64std(sha256(bodyBuf)) + ':';
  }

  const results = [];
  for (const [name, inner] of splitSfDict(sigInHdr)) {
    const sigEntry = splitSfDict(sigHdr).find(([n]) => n === name);
    if (!sigEntry) continue;
    const sig = Buffer.from(sigEntry[1].replace(/^:|:$/g, ''), 'base64');
    const m = inner.match(/^\(([^)]*)\)(.*)$/);
    const committed = (m[1].match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
    const params = [];
    const paramRe = /;([a-z0-9_.\-*]+)=(?:"((?:[^"\\]|\\.)*)"|([^;]+))/g;
    let pm;
    while ((pm = paramRe.exec(m[2])) !== null) {
      params.push([pm[1], pm[2] !== undefined
        ? sfStr(pm[2].replace(/\\(.)/g, '$1'))
        : (/^-?\d+$/.test(pm[3]) ? Number(pm[3]) : sfStr(pm[3]))]);
    }
    const alg = params.find(([k]) => k === 'alg');
    const keyidP = params.find(([k]) => k === 'keyid');
    const bare = committed.map((k) => (k.startsWith('@') ? k.slice(1) : k));
    const base = signatureBase(enc, bare, params);
    if (!alg || alg[1].value !== 'rsa-pss-sha512') {
      results.push({ name, alg: alg && alg[1].value, ok: null, base });
      continue;
    }
    const modulus = Buffer.from(String(keyidP[1].value).replace(/^publickey:/, ''), 'base64');
    results.push({
      name, alg: 'rsa-pss-sha512',
      ok: rsaPssVerify(modulus, base, sig),
      address: b64url(sha256(modulus)),
      base
    });
  }
  return results;
}

function splitSfDict(str) {
  // members are `key=value`, value may contain quoted strings / (...) groups
  const out = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) { cur += c; if (c === '\\') { cur += str[++i]; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => {
    const t = s.trim();
    const i = t.indexOf('=');
    return [t.slice(0, i), t.slice(i + 1)];
  });
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing                                                        *
 * ------------------------------------------------------------------ */
async function send(node, path, method, headers, body) {
  const url = node.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(url, {
    method,
    headers: { ...headers, 'accept-bundle': 'true' },
    body: body && body.length ? body : undefined,
    redirect: 'follow'
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const h = {};
  res.headers.forEach((v, k) => { h[k] = v; });
  return { status: res.status, headers: h, body: buf, url };
}

function hbError(res) {
  const t = res.body.toString();
  const m = t.match(/Error details:([\s\S]*?)<\/pre>/);
  const dec = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  if (m) return dec(m[1]).replace(/\s+/g, ' ').trim();
  return res.headers['details'] || t.slice(0, 400);
}

/** POST a signed message. Returns { status, headers, body }. */
export async function postSigned(node, path, msg, jwk, opts = {}) {
  const { headers, body, signatureBase: base, committed } = commit(msg, jwk, opts);
  const res = await send(node, path, 'POST', headers, body);
  res.request = { headers, body, base, committed };
  return res;
}

/** Look up a node's own scheduler address. */
export async function nodeAddress(node) {
  const r = await send(node, '/~meta@1.0/info/address', 'GET', { accept: 'text/plain' });
  return r.body.toString().trim();
}

/**
 * Spawn a native `lua@5.3a` process@1.0 on `node`.
 * Returns the process id.
 */
export async function spawnProcess({ node, jwk, lua, scheduler, authority, ...fields }) {
  const sched = scheduler || (await nodeAddress(node));
  const me = jwkToAddress(jwk);
  const proc = {
    device: 'process@1.0',
    type: 'Process',
    'scheduler-device': 'scheduler@1.0',
    'execution-device': 'lua@5.3a',
    'scheduler-location': sched,
    authority: authority || [me, sched],
    'random-seed': String(Math.floor(Math.random() * 1e9)),
    ...(lua ? { module: { 'content-type': 'application/lua', body: lua } } : {}),
    ...fields
  };
  // Where a spawn is POSTed depends on the node's build, and the failure looks
  // nothing like the cause: `permaweb/edge` answers the bare `/schedule` with a
  // flat `404 not_found`, which reads as "this node is broken" rather than
  // "that route moved". Measured, on the same signed payload:
  //
  //   hyperbeam.tylerw.ai (edge)   /schedule 404,  ~scheduler@1.0/schedule 200
  //   schedule.forward.computer    /schedule 200
  //
  // So try the device-qualified path first — it is the more explicit form and
  // the one the newer build wants — and fall back to the bare route for nodes
  // that predate the change. Only a 404 is worth retrying elsewhere: any other
  // status is the node objecting to the message, and re-sending it to a
  // different path would just bury the real reason.
  const paths = ['/~scheduler@1.0/schedule', '/schedule'];
  const tried = [];
  for (const path of paths) {
    const res = await postSigned(node, path, proc, jwk);
    if (res.status === 200) {
      const id = res.headers['process'];
      if (!id) {
        throw new Error(`spawn via ${path} returned no process header: ${JSON.stringify(res.headers)}`);
      }
      return id;
    }
    tried.push(`${path} -> ${res.status} ${hbError(res)}`);
    if (res.status !== 404) break;
  }
  throw new Error(`spawn failed on ${node}:\n  ${tried.join('\n  ')}`);
}

/** The schedule route a node was last seen to accept. See `sendMessage`. */
const SCHEDULE_ROUTE = new Map();

/** Schedule a signed message against an existing process. Returns its slot. */
export async function sendMessage({ node, jwk, process: pid, action, tags = {}, data, path }) {
  // Fields become HTTP headers, and header names are case-insensitive. So
  // `action` and `Action` are distinct object keys but the SAME header, and
  // sending both produces a duplicate that the node rejects with a bare
  // `400 Message is not valid.` naming nothing. Fold to lowercase and dedupe;
  // later entries win, so callers can still override a default.
  const fields = new Map();
  const put = (k, v) => {
    if (v === undefined || v === null) return;
    fields.set(String(k).toLowerCase(), typeof v === 'string' ? v : String(v));
  };

  put('target', pid);
  put('type', 'Message');
  // Without `subject`, dev_scheduler tries to schedule the request body instead
  // of the message. Same bare 400.
  put('subject', 'self');
  if (action) put('action', action);
  for (const [k, v] of Object.entries(tags)) put(k, v);
  if (data !== undefined) put('data', data);
  put('random-seed', String(Math.floor(Math.random() * 1e9)));

  const msg = Object.fromEntries(fields);

  // Same story as `spawnProcess`: the schedule route moved between node builds
  // and a miss is a flat `404 not_found` rather than anything about routing.
  // An explicit `path` is always honoured as given; otherwise try the known
  // spellings, newest first, and only move on for a 404.
  //
  // The winner is remembered per node, because this runs hundreds of times in a
  // deploy — 17 Admin.Load batches, then a message per paid-list chunk — and
  // paying a failed round trip before each of them would be slower than the
  // deploy itself.
  const candidates = path
    ? [path]
    : [`/${pid}~process@1.0/schedule`, `/${pid}~scheduler@1.0/schedule`, `/${pid}/schedule`];
  const known = SCHEDULE_ROUTE.get(node);
  const ordered = known && !path
    ? [known, ...candidates.filter((p) => p !== known)]
    : candidates;

  const tried = [];
  for (const candidate of ordered) {
    const res = await postSigned(node, candidate, msg, jwk);
    if (res.status === 200) {
      if (!path) SCHEDULE_ROUTE.set(node, candidate);
      return { slot: res.headers['slot'], headers: res.headers };
    }
    tried.push(`${candidate} -> ${res.status} ${hbError(res)}`);
    if (res.status !== 404) break;
  }
  throw new Error(`send failed on ${node}:\n  ${tried.join('\n  ')}`);
}


/** Plain unsigned GET of process state. `path` defaults to `now`. */
export async function readState({ node, process: pid, path = 'now' }) {
  const p = pid ? `/${pid}~process@1.0/${path.replace(/^\//, '')}` : '/' + path.replace(/^\//, '');
  const res = await send(node, p, 'GET', { accept: 'text/plain' });
  return {
    status: res.status,
    value: res.body.toString(),
    headers: res.headers
  };
}

export { toTabm, tabmToHttp, signatureBase, b64url, sha256, sfStr, sfInnerList, sfDict, hbError, send };
