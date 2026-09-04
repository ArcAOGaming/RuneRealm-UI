/** Does module SIZE alone reproduce the live node's slowness?
 *  Same trivial KV contract, padded with an inert long string to the size of
 *  the game bundle. If the padded one is slow and the small one is fast, the
 *  cost is per-slot handling of the module, not anything the handler does. */
import fs from 'node:fs';
import { spawnProcess, postSigned, send } from '../hbclient.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const jwk = JSON.parse(fs.readFileSync(`${ROOT}/arweave-wallet-DA9qhP25.json`, 'utf8'));
const t = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const base = fs.readFileSync(`${ROOT}/backend/native/hbfast/kv.lua`, 'utf8');

// Inert: assigned to a local that nothing reads, so it is bytes in the module
// and nothing else. Not a comment — a minifier or lexer could drop those.
const pads = [
  ['kv small', base],
  ['kv 355KB', `local PAD = [[${'x'.repeat(350_000)}]]\n` + base],
];

for (const [label, lua] of pads) {
  let s = t();
  let pid;
  try { pid = await spawnProcess({ node: NODE, jwk, lua, name: `TEST-pad-${Buffer.byteLength(lua)}`, 'kv-publish': 'hot' }); }
  catch (e) { console.log(`${label.padEnd(10)} spawn FAILED: ${String(e).slice(0, 120)}`); continue; }
  console.log(`${label.padEnd(10)} ${Buffer.byteLength(lua)} B  spawn ${(t()-s).toFixed(0)}ms  ${pid}`);
  for (let i = 0; i < 4; i++) {
    const msg = { target: pid, type: 'Message', subject: 'self', action: 'set', key: `k${i}`, value: '1',
                  'random-seed': String(Math.random()) };
    s = t();
    const r = await postSigned(NODE, `/${pid}~process@1.0/schedule`, msg, jwk);
    const sched = t() - s;
    if (r.status !== 200) { console.log('   schedule', r.status, r.body.toString().slice(0, 200)); break; }
    s = t();
    const c = await send(NODE, `/${pid}~process@1.0/compute&slot=${r.headers.slot}/results/output/data`, 'GET', { accept: 'text/plain' });
    console.log(`   #${i} schedule ${sched.toFixed(0)}ms  compute ${(t()-s).toFixed(0)}ms  ${c.status}`);
  }
}
