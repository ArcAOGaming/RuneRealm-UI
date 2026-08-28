/**
 * diagnose-spawn.mjs — find out why a node refuses to spawn.
 *
 *   node tools/diagnose-spawn.mjs <wallet.json> <node-url> [--control]
 *
 * `deploy.mjs` reports `spawn failed 404: not_found`, which is what HyperBEAM
 * says for almost anything it could not resolve — the route, the scheduler, the
 * device, the module. This makes the same signed request and prints EVERYTHING
 * the node sent back, then tries the alternatives, so the answer comes from the
 * node rather than from a guess.
 *
 * It spawns with a three-line Lua module rather than the 199 KB game bundle, so
 * a success costs nothing and tells us the pipeline works. Spawning is free.
 *
 * `--control` runs the same probe against schedule.forward.computer afterwards,
 * which is known to work — so a difference in the two outputs IS the diagnosis.
 */
import fs from 'node:fs';
import { spawnProcess, nodeAddress, jwkToAddress, postSigned } from '../backend/native/hbclient.mjs';

const [walletPath, nodeUrl] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const withControl = process.argv.includes('--control');

if (!walletPath || !nodeUrl) {
  console.error('usage: node tools/diagnose-spawn.mjs <wallet.json> <node-url> [--control]');
  process.exit(1);
}
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const me = jwkToAddress(jwk);

const TINY_LUA = 'function compute(base, req, opts)\n' +
  '  base.results = { output = { data = "ok" } }\n' +
  '  return base\n' +
  'end\n';

const show = (label, res) => {
  console.log(`\n  ${label}`);
  console.log(`    status  ${res.status}`);
  const interesting = ['details', 'process', 'slot', 'ao-result', 'body', 'status'];
  for (const k of Object.keys(res.headers || {})) {
    if (interesting.includes(k) || /error|reason|detail/i.test(k)) {
      console.log(`    ${k}: ${String(res.headers[k]).slice(0, 200)}`);
    }
  }
  const body = res.body ? res.body.toString() : '';
  const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`    body    ${plain.slice(0, 400) || '(empty)'}`);
};

async function probe(node) {
  console.log(`\n${'='.repeat(66)}\n${node}\n${'='.repeat(66)}`);
  console.log(`  signer  ${me}`);

  let sched;
  try {
    sched = await nodeAddress(node);
    console.log(`  scheduler address  ${sched}`);
  } catch (e) {
    console.log(`  scheduler address  FAILED: ${e.message}`);
    return;
  }

  // Does the node itself believe that address is reachable? This is the lookup
  // a spawn does server-side, and it is the one that caches a NEGATIVE result:
  // if the node asked before the Scheduler-Location record existed, it may
  // still be answering from that miss until it is restarted.
  for (const p of [
    `/~scheduler@1.0/status`,
    `/${sched}/scheduler-location`,
  ]) {
    try {
      const r = await fetch(`${node}${p}`, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(20000) });
      const t = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`  GET ${p} -> ${r.status}  ${t.slice(0, 120)}`);
    } catch (e) {
      console.log(`  GET ${p} -> ${e.message}`);
    }
  }

  // The real thing, with a tiny module.
  const proc = {
    device: 'process@1.0',
    type: 'Process',
    'scheduler-device': 'scheduler@1.0',
    'execution-device': 'lua@5.3a',
    'scheduler-location': sched,
    authority: [me, sched],
    'random-seed': String(Math.floor(Math.random() * 1e9)),
    module: { 'content-type': 'application/lua', body: TINY_LUA },
  };

  for (const path of ['/schedule', '/~scheduler@1.0/schedule', '/~process@1.0/schedule']) {
    try {
      const res = await postSigned(node, path, proc, jwk);
      show(`POST ${path}`, res);
      if (res.status === 200 && res.headers['process']) {
        console.log(`\n  SPAWNED ${res.headers['process']} via ${path}`);
        return res.headers['process'];
      }
    } catch (e) {
      console.log(`\n  POST ${path} threw: ${e.message}`);
    }
  }

  // And once more with no module at all: if a bare process spawns but one
  // carrying Lua does not, the module is the problem, not the scheduler.
  try {
    const bare = { ...proc };
    delete bare.module;
    const res = await postSigned(node, '/schedule', bare, jwk);
    show('POST /schedule  (no module)', res);
  } catch (e) {
    console.log(`\n  bare spawn threw: ${e.message}`);
  }
  return null;
}

await probe(nodeUrl);
if (withControl) await probe('https://schedule.forward.computer');

console.log('\nA 200 with a `process` header is a working spawn. If the tiny module');
console.log('spawns and the game bundle does not, it is a size or content limit. If');
console.log('nothing spawns here but the control node does, compare the two bodies');
console.log('above — the difference is the answer.');
