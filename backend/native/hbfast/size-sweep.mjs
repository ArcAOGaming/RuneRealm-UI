/** Is the live node's cost in module bytes a slope or a cliff?
 *  A cliff means "get under N bytes" is a complete fix. A slope means every
 *  byte deleted pays, and the node still needs fixing. */
import fs from 'node:fs';
import { spawnProcess, postSigned, send } from '../hbclient.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const jwk = JSON.parse(fs.readFileSync(`${ROOT}/arweave-wallet-DA9qhP25.json`, 'utf8'));
const t = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const base = fs.readFileSync(`${ROOT}/backend/native/hbfast/kv.lua`, 'utf8');
const sizes = (process.env.SIZES || '0,25000,50000,100000,200000,350000').split(',').map(Number);

console.log(`node ${NODE}\n`);
console.log('| module B | spawn ms | schedule p50 | compute p50 | total p50 |');
console.log('|---|---|---|---|---|');
for (const pad of sizes) {
  const lua = pad ? `local PAD = [[${'x'.repeat(pad)}]]\n` + base : base;
  const bytes = Buffer.byteLength(lua);
  let s = t();
  let pid;
  try { pid = await spawnProcess({ node: NODE, jwk, lua, name: `TEST-sweep-${bytes}`, 'kv-publish': 'hot' }); }
  catch (e) { console.log(`| ${bytes} | SPAWN FAILED | | | |`); continue; }
  const spawnMs = t() - s;
  const sc = [], co = [];
  for (let i = 0; i < 3; i++) {
    const msg = { target: pid, type: 'Message', subject: 'self', action: 'set', key: `k${i}`, value: '1',
                  'random-seed': String(Math.random()) };
    s = t();
    const r = await postSigned(NODE, `/${pid}~process@1.0/schedule`, msg, jwk);
    if (r.status !== 200) break;
    sc.push(t() - s);
    s = t();
    await send(NODE, `/${pid}~process@1.0/compute&slot=${r.headers.slot}/results/output/data`, 'GET', { accept: 'text/plain' });
    co.push(t() - s);
  }
  if (!sc.length) { console.log(`| ${bytes} | ${spawnMs.toFixed(0)} | rejected | | |`); continue; }
  console.log(`| ${bytes} | ${spawnMs.toFixed(0)} | ${med(sc).toFixed(0)} | ${med(co).toFixed(0)} | ${(med(sc)+med(co)).toFixed(0)} |`);
}
