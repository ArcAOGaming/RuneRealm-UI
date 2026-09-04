/** An LMDB 1.0 container, read in place from the weave.
 *
 * A faithful JS port of HyperBEAM's `hb_store_arlmdb` (commit c0d8146). The
 * point of porting rather than waiting for the node is that this proves the
 * ability is not node-gated: the same traversal runs in a browser, so a dApp
 * can read a published database with no backend at all.
 *
 * Container invariants, all enforced loudly — a shape outside the contract is
 * an error, never a miss:
 *
 *   - 64 KiB pages, meta on pages 0 and 1, higher txn id wins.
 *   - the main DB is MDB_DUPSORT|MDB_DUPFIXED with a depth-1 root holding one
 *     F_SUBDATA node keyed <<0>>, whose data is the sub-DB record.
 *   - the sub-DB's leaves are P_LEAF2: no slot array, row I at 24 + I*pad.
 */
import { readLocation, readTags, createChunkSource, PAGE_SIZE } from './weave.mjs';
import { compileKey, compileResult, bits, pad, carries } from './normalize.mjs';

const PAGE_HDR = 24;
const MDB_MAGIC = 0xbeefc0de;
const MDB_VERSION = 3;
const MAIN_DB_FLAGS = 0x14; // MDB_DUPSORT | MDB_DUPFIXED
const P_BRANCH = 0x01;
const P_LEAF = 0x02;
const P_LEAF2 = 0x20;
const F_SUBDATA = 0x02;

const parseDb = (b) => ({
  pad: b.readUInt32LE(0),
  flags: b.readUInt16LE(4),
  depth: b.readUInt16LE(6),
  entries: b.readBigUInt64LE(32),
  root: Number(b.readBigUInt64LE(40)),
});

function parseMeta(page) {
  const magic = page.readUInt32LE(PAGE_HDR);
  const version = page.readUInt32LE(PAGE_HDR + 4);
  if (magic !== MDB_MAGIC || version !== MDB_VERSION) {
    throw new Error(`invalid-meta: magic ${magic.toString(16)} version ${version}`);
  }
  const at = PAGE_HDR + 8 + 16;
  return {
    db0: parseDb(page.subarray(at, at + 48)),
    db1: parseDb(page.subarray(at + 48, at + 96)),
    lastPage: Number(page.readBigUInt64LE(at + 96)),
    txn: page.readBigUInt64LE(at + 104),
  };
}

/** Page header -> {flags, count}. `lower >> 1` is the slot count. */
const parsePage = (page) => ({
  flags: page.readUInt16LE(18),
  count: page.readUInt16LE(20) >> 1,
});

/** The node at a slot. Slot offsets are relative to the end of the header. */
function nodeAt(page, slot) {
  const offset = PAGE_HDR + page.readUInt16LE(PAGE_HDR + slot * 2);
  const ksize = page.readUInt16LE(offset + 6);
  return {
    lo: page.readUInt16LE(offset),
    hi: page.readUInt16LE(offset + 2),
    flags: page.readUInt16LE(offset + 4),
    ksize,
    key: page.subarray(offset + 8, offset + 8 + ksize),
    offset,
  };
}

const nodeData = (page, node) =>
  page.subarray(node.offset + 8 + node.ksize + (node.ksize & 1));

const child = (node) => node.lo | (node.hi << 16) | node.flags * 2 ** 32;

/** Open a container: locate it, read its tags, validate its meta, and
 * descend to the sub-database that holds the rows. */
export async function openContainer(root, { chunks = createChunkSource(), gateway } = {}) {
  const [{ start, size }, tags] = await Promise.all([
    readLocation(root, { gateway }),
    readTags(root, { gateway }),
  ]);
  if (tags.device !== 'lmdb@1.0') {
    throw new Error(`unsupported-container-device: ${tags.device}`);
  }
  for (const required of ['prefix', 'normalize-key', 'normalize-result']) {
    if (!(required in tags)) throw new Error(`missing-tags: ${required}`);
  }
  if (size < 2n * PAGE_SIZE) throw new Error(`invalid-container-size: ${size}`);

  const page = (n) => chunks.range(start, BigInt(n) * PAGE_SIZE, Number(PAGE_SIZE));
  const first = await chunks.range(start, 0n, Number(2n * PAGE_SIZE));
  const meta0 = parseMeta(first.subarray(0, Number(PAGE_SIZE)));
  const meta1 = parseMeta(first.subarray(Number(PAGE_SIZE)));
  const meta = meta0.txn >= meta1.txn ? meta0 : meta1;

  if (meta.db0.pad !== Number(PAGE_SIZE)) {
    throw new Error(`invalid-page-size: ${meta.db0.pad}`);
  }
  if (meta.db1.flags !== MAIN_DB_FLAGS) {
    throw new Error(`invalid-main-flags: ${meta.db1.flags}`);
  }
  if (BigInt(meta.lastPage + 1) * PAGE_SIZE > size) {
    throw new Error(`invalid-last-page: ${meta.lastPage}`);
  }
  if (meta.db1.depth !== 1) throw new Error(`invalid-main-depth: ${meta.db1.depth}`);

  const mainRoot = await page(meta.db1.root);
  const mainHeader = parsePage(mainRoot);
  if (mainHeader.flags !== P_LEAF || mainHeader.count !== 1) {
    throw new Error(
      `invalid-main-page: flags ${mainHeader.flags} count ${mainHeader.count}`,
    );
  }
  const mainNode = nodeAt(mainRoot, 0);
  if (!(mainNode.ksize === 1 && mainNode.key[0] === 0)) {
    throw new Error(`invalid-main-key: ${mainNode.key.toString('hex')}`);
  }
  if ((mainNode.flags & F_SUBDATA) === 0) {
    throw new Error(`invalid-main-node-flags: ${mainNode.flags}`);
  }
  const subDb = parseDb(nodeData(mainRoot, mainNode).subarray(0, 48));
  const rowWidth = subDb.pad;
  if (!(rowWidth > 0 && PAGE_HDR + rowWidth <= Number(PAGE_SIZE))) {
    throw new Error(`invalid-row-width: ${rowWidth}`);
  }

  const toSeek = compileKey(tags['normalize-key']);
  const toResult = compileResult(tags['normalize-result']);
  const rowBits = rowWidth * 8;
  const row = (leaf, slot) =>
    bits(leaf.subarray(PAGE_HDR + slot * rowWidth, PAGE_HDR + (slot + 1) * rowWidth));

  /** Descend to the leaf holding the first row at-or-after `target`,
   * carrying down the nearest next-node key as that leaf's successor. */
  async function descend(target) {
    let pgno = subDb.root;
    let depth = subDb.depth;
    let next = null;
    for (;;) {
      if (depth <= 0) throw new Error(`invalid-depth: ${pgno}`);
      const current = await page(pgno);
      const { flags, count } = parsePage(current);
      if (flags === P_BRANCH) {
        let slot = 0;
        for (let i = 1; i < count; i += 1) {
          if (Buffer.compare(nodeAt(current, i).key, target.bytes) <= 0) slot = i;
          else break;
        }
        if (slot + 1 < count) next = bits(nodeAt(current, slot + 1).key);
        pgno = child(nodeAt(current, slot));
        depth -= 1;
        continue;
      }
      if (flags !== (P_LEAF | P_LEAF2)) throw new Error(`invalid-page-flags: ${flags}`);
      if (PAGE_HDR + count * rowWidth > Number(PAGE_SIZE)) {
        throw new Error(`invalid-leaf-count: ${count}`);
      }
      let low = 0;
      let high = count;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (Buffer.compare(row(current, mid).bytes, target.bytes) < 0) low = mid + 1;
        else high = mid;
      }
      return { leaf: current, slot: low, count, next };
    }
  }

  /** One key. `null` for a proven miss — a row at-or-after the seek that
   * diverges within the seek bits means the index does not hold it. */
  async function read(key) {
    const prefix = tags.prefix;
    if (!key.startsWith(prefix)) return null;
    const seek = toSeek(key.slice(prefix.length));
    const target = pad(seek, rowBits);
    const { leaf, slot, count, next } = await descend(target);
    const found = slot < count ? row(leaf, slot) : next;
    if (!found) return null;
    return carries(found, seek) ? toResult(found) : null;
  }

  /** A bounded ascending run of rows sharing the key's bits. */
  async function list(key, { limit = 1000 } = {}) {
    const prefix = tags.prefix;
    if (!key.startsWith(prefix)) return null;
    const seek = toSeek(key.slice(prefix.length));
    let target = pad(seek, rowBits);
    const rows = [];
    for (;;) {
      const { leaf, slot, count, next } = await descend(target);
      let i = slot;
      let ended = false;
      while (i < count && rows.length < limit) {
        const candidate = row(leaf, i);
        if (!carries(candidate, seek)) { ended = true; break; }
        rows.push(toResult(candidate));
        i += 1;
      }
      if (ended || rows.length >= limit || !next || !carries(next, seek)) break;
      target = next;
    }
    return rows;
  }

  return {
    root,
    start,
    size,
    tags,
    meta,
    subDb,
    rowWidth,
    rows: subDb.entries,
    depth: subDb.depth,
    chunks,
    read,
    list,
  };
}
