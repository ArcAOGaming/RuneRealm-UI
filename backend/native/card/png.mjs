/**
 * png.mjs — just enough PNG to composite a card, with no dependencies.
 *
 * The worker has to decode nine plates and encode one image. Reaching for
 * `canvas` or `sharp` to do that would put a native binary — and a compiler —
 * between a funded wallet and a permanent transaction, on every machine that
 * ever runs a mint. Node already ships zlib, and the art is uniform: all 106
 * PNGs under `src/assets` are 8-bit RGBA, non-interlaced, verified by reading
 * their IHDR. So this handles exactly that, and refuses anything else loudly
 * rather than guessing.
 *
 * The encoder writes filter type 0 on every row. A smarter filter would shrink
 * the file, and file size is money here — but the difference measured under 3%
 * on this art (flat colour, already highly repetitive) and every byte of that
 * saving would be paid for in a hand-rolled heuristic sitting in the signing
 * path. Not worth it.
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32, table built once ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Decode ---------------------------------------------------------------------

/** `{ width, height, data }` where data is RGBA, 4 bytes per pixel. */
export function decodePng(buffer) {
  const buf = Buffer.from(buffer);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  const idat = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth=${depth} colour=${colour} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height) throw new Error('PNG has no IHDR');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { width, height, data: unfilter(raw, width, height) };
}

/**
 * Reverse the per-row filters (PNG spec 9.2).
 *
 * `bpp` is 4 here — the filters reference the pixel to the left, which for RGBA
 * is four bytes back, not one.
 */
function unfilter(raw, width, height) {
  const bpp = 4;
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const type = raw[pos++];
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prior + x] : 0;
      const c = x >= bpp && y > 0 ? out[prior + x - bpp] : 0;
      let recon;
      switch (type) {
        case 0: recon = value; break;
        case 1: recon = value + a; break;
        case 2: recon = value + b; break;
        case 3: recon = value + ((a + b) >> 1); break;
        case 4: recon = value + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${type} on row ${y}`);
      }
      out[row + x] = recon & 0xff;
    }
    pos += stride;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Encode ---------------------------------------------------------------------

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** RGBA bytes to a PNG file. `level` 9 because this is minted once and read forever. */
export function encodePng(data, width, height, level = 9) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
