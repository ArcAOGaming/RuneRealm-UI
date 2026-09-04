/** Ask a HyperBEAM node whether it can stream a published index yet.
 *
 *   node backend/native/arlmdb/probe.mjs [node-url]
 *
 * Read-only, free, unsigned. Nothing here spawns or schedules anything.
 *
 * The capability is a STORE, not a device, so `/~<name>/keys` cannot see it —
 * `probe-devices.mjs` will report nothing either way. What is observable is
 * the node's own store list at `/~meta@1.0/info/store`, and three things in it
 * decide the verdict:
 *
 *   - a store whose `store-module` is `hb_store_arlmdb`, with the `root` of
 *     the container it serves;
 *   - that store sitting in the `index-store` list of the `hb_store_arweave`
 *     store, which is what makes offsets resolve through it;
 *   - `remote-index` being FALSE on that arweave store. While it is true the
 *     node asks a gateway's index node for offsets, which is the dependency
 *     the whole change exists to remove, so a node with both is still on the
 *     gateway path.
 *
 * Accept must be JSON. A HyperBEAM node answers an unresolvable key with its
 * own HTML landing page at status 200, so an unchecked read hands a screenful
 * of markup to JSON.parse — see the repo rules on published key names.
 */
import process from 'node:process';

const DEFAULT_NODE = process.env.HB_NODE || process.env.NODE_URL
  || 'https://hyperbeam.tylerw.ai';
const MAX_STORES = 16;

const clean = (url) => String(url).replace(/\/+$/, '');

/** Resolve one node path as JSON, or `null` when the node does not serve it.
 *
 * An HTML body at 200 is treated as "key absent", never as content. */
async function readKey(node, path, signal) {
  let res;
  let text;
  try {
    res = await fetch(`${clean(node)}/${path}`, {
      headers: { accept: 'application/json' },
      signal,
    });
    text = await res.text();
  } catch (error) {
    return { error: error.message };
  }
  if (res.status === 404) return null;
  if (!/^application\/json/.test(res.headers.get('content-type') || '')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Walk a store list at `base`, following `index-store` and `local-store`
 * sub-lists one level down. Returns flat entries carrying their path. */
async function walkStores(node, base, signal, depth = 0) {
  const found = [];
  for (let i = 1; i <= MAX_STORES; i += 1) {
    const path = `${base}/${i}`;
    const entry = await readKey(node, path, signal);
    if (!entry || entry.error || entry.body === 'not_found') break;
    found.push({ path, ...entry });
    if (depth < 2) {
      for (const nested of ['index-store', 'local-store']) {
        if (`${nested}+link` in entry || nested in entry) {
          found.push(...await walkStores(node, `${path}/${nested}`, signal, depth + 1));
        }
      }
    }
  }
  return found;
}

/** The full capability report for one node. */
export async function probeNode(node = DEFAULT_NODE, { signal } = {}) {
  const stores = await walkStores(node, '~meta@1.0/info/store', signal);
  const arlmdb = stores.filter((s) => s['store-module'] === 'hb_store_arlmdb');
  const arweave = stores.filter((s) => s['store-module'] === 'hb_store_arweave');
  const remoteIndex = arweave.map((s) => String(s['remote-index'] ?? 'unset'));
  const wiredIn = arlmdb.some((s) => s.path.includes('/index-store/'));
  return {
    node: clean(node),
    reachable: stores.length > 0,
    stores,
    arlmdb,
    roots: arlmdb.map((s) => s.root).filter(Boolean),
    wiredIn,
    remoteIndex,
    gatewayIndexed: remoteIndex.includes('true'),
    capable: arlmdb.length > 0,
  };
}

const label = (s) => `${s.path.replace('~meta@1.0/info/store', 'store')}  ${s['store-module']}`
  + (s.name ? `  name=${s.name}` : '')
  + (s.root ? `  root=${s.root}` : '')
  + (s['remote-index'] !== undefined ? `  remote-index=${s['remote-index']}` : '');

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('probe.mjs')) {
  const node = process.argv[2] || DEFAULT_NODE;
  const report = await probeNode(node);
  console.log(`node ${report.node}`);
  if (!report.reachable) {
    console.log('  unreachable, or it does not publish a store list');
    process.exit(2);
  }
  for (const store of report.stores) console.log(`  ${label(store)}`);
  console.log('');
  if (!report.capable) {
    console.log('VERDICT: not yet — no hb_store_arlmdb in the store list.');
    console.log(report.gatewayIndexed
      ? '  Offsets still come from a gateway index node (remote-index=true).'
      : '  Offsets come from the stores above, not from a published container.');
    console.log('  The client-side reader (read.mjs) works regardless; it needs no node.');
    process.exit(1);
  }
  console.log('VERDICT: capable.');
  console.log(`  container root: ${report.roots.join(', ') || 'unnamed'}`);
  console.log(`  wired into an index-store list: ${report.wiredIn ? 'yes' : 'NO — offsets will not resolve through it'}`);
  console.log(`  gateway index still on: ${report.gatewayIndexed ? 'yes' : 'no'}`);
}
