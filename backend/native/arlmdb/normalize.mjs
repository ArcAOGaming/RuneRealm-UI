/** The two AO-Core paths that make a published index self-describing.
 *
 * A container's tags do not say "this holds Arweave offsets". They say how to
 * turn a key into row bits and a row into a message:
 *
 *     normalize-key:    ~base64url@1.0/decode/~bits@1.0/take=77
 *     normalize-result: ~bits@1.0/from=_:77,start:49+integer,length:34+integer
 *
 * That is the whole reason this generalises past Arweave offsets. Publish a
 * container tagged with different paths and the SAME reader serves it, so a
 * Rune Realm index is a publishing job, not a fork of this file.
 *
 * A node resolves these through `hb_ao:resolve/2`. Here they are interpreted
 * directly — only the device steps a container may legally name.
 */

/** A bitstring: whole bytes plus a bit length that may end mid-byte. */
export const bits = (bytes, length = bytes.length * 8) => ({ bytes, length });

/** Take the first `n` bits, zero-padding the tail of the final byte. */
export function take({ bytes, length }, n) {
  if (n > length) throw new Error(`take=${n} exceeds ${length} bits`);
  const out = Buffer.alloc(Math.ceil(n / 8));
  bytes.copy(out, 0, 0, out.length);
  const spare = out.length * 8 - n;
  if (spare > 0) out[out.length - 1] &= 0xff << spare;
  return bits(out, n);
}

/** Widen a bitstring to `n` bits with trailing zeros — the seek target a
 * descent compares against fixed-width rows. */
export function pad({ bytes, length }, n) {
  const out = Buffer.alloc(Math.ceil(n / 8));
  bytes.copy(out, 0, 0, Math.min(bytes.length, out.length));
  if (length < n) {
    const spare = Math.ceil(length / 8) * 8 - length;
    if (spare > 0 && bytes.length) out[Math.ceil(length / 8) - 1] &= 0xff << spare;
  }
  return bits(out, n);
}

/** Whether a row begins with the given bits. The store's `carries/2`. */
export function carries(row, prefix) {
  if (prefix.length > row.length) return false;
  const whole = Math.floor(prefix.length / 8);
  if (Buffer.compare(row.bytes.subarray(0, whole), prefix.bytes.subarray(0, whole)) !== 0) {
    return false;
  }
  const spare = prefix.length % 8;
  if (spare === 0) return true;
  const mask = 0xff << (8 - spare);
  return (row.bytes[whole] & mask) === (prefix.bytes[whole] & mask);
}

/** Read `width` bits starting at `offset`, as an unsigned integer. */
export function readBits({ bytes }, offset, width) {
  let value = 0n;
  for (let i = 0; i < width; i += 1) {
    const bit = offset + i;
    const on = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    value = (value << 1n) | BigInt(on);
  }
  return value;
}

/** `from=` field list: `name:width[+type]`, `_` naming bits to skip. */
function parseFields(spec) {
  return spec.split(',').map((field) => {
    const [head, type = 'binary'] = field.split('+');
    const [name, width] = head.split(':');
    return { name, width: Number(width), type };
  });
}

/** Compile a `normalize-key` path into `(suffix) => bitstring`. */
export function compileKey(path) {
  const steps = String(path).split('/').filter(Boolean);
  const ops = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === '~base64url@1.0' && steps[i + 1] === 'decode') {
      i += 1;
      ops.push((v) => bits(Buffer.from(v.toString('utf8'), 'base64url')));
      continue;
    }
    if (step === '~bits@1.0') continue;
    const m = /^take=(\d+)$/.exec(step);
    if (m) {
      const n = Number(m[1]);
      ops.push((v) => take(v.length === undefined ? bits(v) : v, n));
      continue;
    }
    throw new Error(`unsupported normalize-key step: ${step}`);
  }
  return (suffix) => ops.reduce((v, op) => op(v), Buffer.from(suffix, 'utf8'));
}

/** Compile a `normalize-result` path into `(row) => message`. */
export function compileResult(path) {
  const m = /^~bits@1\.0\/from=(.+)$/.exec(String(path));
  if (!m) throw new Error(`unsupported normalize-result: ${path}`);
  const fields = parseFields(m[1]);
  const width = fields.reduce((sum, f) => sum + f.width, 0);
  return Object.assign(
    (row) => {
      const out = {};
      let offset = 0;
      for (const field of fields) {
        if (field.name !== '_') {
          const raw = readBits(row, offset, field.width);
          out[field.name] = field.type === 'integer' ? raw : raw;
        }
        offset += field.width;
      }
      return out;
    },
    { rowBits: width, fields },
  );
}
