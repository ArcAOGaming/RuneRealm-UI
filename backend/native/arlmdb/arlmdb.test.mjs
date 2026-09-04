/** node --test backend/native/arlmdb/arlmdb.test.mjs
 *
 * Two halves, deliberately separated.
 *
 * The OFFLINE half tests the bit surgery — the part that is easy to get subtly
 * wrong and impossible to notice, because a wrong bit offset still returns a
 * plausible integer. It needs no network and must always pass.
 *
 * The LIVE half reads the real 171 GB container on the weave and asserts the
 * exact answers HyperBEAM's own eunit tests assert. It skips, rather than
 * fails, when the weave is unreachable: an offline laptop is not a broken
 * reader. Set ARLMDB_REQUIRE_LIVE=1 in CI to turn a skip into a failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { bits, take, pad, carries, readBits, compileKey, compileResult } from './normalize.mjs';
import { openContainer } from './container.mjs';
import { createChunkSource } from './weave.mjs';
import { OFFSET_INDEX, GOLDEN, MISSES, OLD_CONTAINER, RUNE_REALM } from './vectors.mjs';

/* ------------------------------------------------------------------ *
 * Offline: the self-describing tag paths                              *
 * ------------------------------------------------------------------ */

test('take() masks the spare bits of the final byte', () => {
  const source = bits(Buffer.from([0xff, 0xff]));
  assert.deepEqual([...take(source, 13).bytes], [0xff, 0xf8]);
  assert.equal(take(source, 13).length, 13);
});

test('carries() compares a partial trailing byte, not a whole one', () => {
  const row = bits(Buffer.from([0b10101010, 0b11000000]));
  assert.ok(carries(row, bits(Buffer.from([0b10101010, 0b11000000]), 10)));
  assert.ok(!carries(row, bits(Buffer.from([0b10101010, 0b10000000]), 10)));
  // Divergence beyond the prefix is not divergence.
  assert.ok(carries(row, bits(Buffer.from([0b10101010]), 8)));
});

test('readBits() reads an unaligned field as an unsigned integer', () => {
  // 0b0000_0001 0b0110_0000 -> bits 7..10 are 0b1011 = 11.
  const row = bits(Buffer.from([0x01, 0x60]));
  assert.equal(readBits(row, 7, 4), 11n);
});

test('the index tag paths compile to the documented row shape', () => {
  const toSeek = compileKey('~base64url@1.0/decode/~bits@1.0/take=77');
  const toResult = compileResult('~bits@1.0/from=_:77,start:49+integer,length:34+integer');
  assert.equal(toResult.rowBits, 160, '77 + 49 + 34 bits is a 20-byte row');

  const seek = toSeek(GOLDEN[0].id);
  assert.equal(seek.length, 77);
  // The first 9 whole bytes of the seek are the first 9 bytes of the raw ID.
  const raw = Buffer.from(GOLDEN[0].id, 'base64url');
  assert.deepEqual([...seek.bytes.subarray(0, 9)], [...raw.subarray(0, 9)]);
});

test('normalize-result reads start and length out of a synthetic row', () => {
  const toResult = compileResult('~bits@1.0/from=_:77,start:49+integer,length:34+integer');
  // Build a 160-bit row whose start is 381852134215637 and length is 3947.
  const value = (0n << 49n) | 381852134215637n;
  let acc = (0n << 77n) | value;
  acc = (acc << 34n) | 3947n;
  const row = bits(Buffer.from(acc.toString(16).padStart(40, '0'), 'hex'));
  const out = toResult(row);
  assert.equal(out.start, 381852134215637n);
  assert.equal(out.length, 3947n);
});

test('pad() widens a seek to the row width without disturbing its bits', () => {
  const seek = take(bits(Buffer.from([0xab, 0xcd, 0xef])), 20);
  const target = pad(seek, 160);
  assert.equal(target.bytes.length, 20);
  assert.ok(carries(target, seek));
  assert.deepEqual([...target.bytes.subarray(3)], new Array(17).fill(0));
});

test('compileKey refuses a step it does not implement', () => {
  assert.throws(() => compileKey('~bits@1.0/rotate=3'), /unsupported normalize-key step/);
});

/* ------------------------------------------------------------------ *
 * Live: the real container on the weave                               *
 * ------------------------------------------------------------------ */

const REQUIRE_LIVE = process.env.ARLMDB_REQUIRE_LIVE === '1';
let container;
let chunks;

async function live() {
  if (container !== undefined) return container;
  chunks = createChunkSource();
  try {
    container = await openContainer(OFFSET_INDEX, { chunks });
  } catch (error) {
    if (REQUIRE_LIVE) throw error;
    container = null;
    process.stderr.write(`\n  (live tests skipped: ${error.message})\n`);
  }
  return container;
}

test('the published index opens and matches its own tags', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  assert.equal(c.tags.device, 'lmdb@1.0');
  assert.equal(c.tags.prefix, '~arweave@2.9/offset=');
  assert.equal(c.rowWidth, 20, 'a 77+49+34 bit row is 20 bytes wide');
  assert.equal(c.rows, 8560638056n);
  assert.ok(c.size > 170_000_000_000n, 'the container is ~171 GB');
});

test("opening it costs one chunk, not 171 GB", async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  // Meta pages, the main root and the sub-root are defragmented into the
  // first chunk, so a container opens for a single fetch.
  assert.ok(chunks.stats.chunks <= 2, `opened in ${chunks.stats.chunks} chunks`);
});

for (const golden of GOLDEN) {
  test(`${golden.id} resolves to the offset HyperBEAM asserts`, async (t) => {
    const c = await live();
    if (!c) return t.skip('weave unreachable');
    const row = await c.read(`${c.tags.prefix}${golden.id}`);
    assert.ok(row, 'the index holds this data item');
    assert.equal(row.start, golden.start);
    assert.equal(row.length, golden.length);
  });
}

test('an L1 transaction is a proven miss, not an error', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  for (const id of MISSES) {
    assert.equal(await c.read(`${c.tags.prefix}${id}`), null);
  }
});

test('a key outside the prefix falls through instead of being served', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  assert.equal(await c.read('player-DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8'), null);
});

test('a lookup reads a bounded number of chunks, not a scan', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  const before = { ...chunks.stats };
  await c.read(`${c.tags.prefix}${GOLDEN[0].id}`);
  const fetched = chunks.stats.chunks - before.chunks;
  assert.ok(fetched <= 3, `one lookup fetched ${fetched} chunks`);
});

test('a container in another format is refused loudly, never served empty', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  await assert.rejects(
    openContainer(OLD_CONTAINER, { chunks: createChunkSource() }),
    /unsupported-container-device|invalid-main-flags|invalid-meta|missing-tags/,
  );
});

test("Rune Realm's own legacynet processes are in the index", async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  for (const item of RUNE_REALM.filter((i) => i.indexed)) {
    const row = await c.read(`${c.tags.prefix}${item.id}`);
    assert.ok(row, `${item.label} (${item.id}) should resolve`);
    assert.ok(row.length > 0n);
  }
});

test('items newer than the snapshot are absent — the known gap', async (t) => {
  const c = await live();
  if (!c) return t.skip('weave unreachable');
  for (const item of RUNE_REALM.filter((i) => !i.indexed)) {
    const row = await c.read(`${c.tags.prefix}${item.id}`);
    assert.equal(row, null,
      `${item.label} resolved — the snapshot has moved, update vectors.mjs`);
  }
});
