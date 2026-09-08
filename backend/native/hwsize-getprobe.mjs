/** hwsize-getprobe: N cheap GETs, so beam CPU per HTTP request can be priced. */
const NODE = process.env.NODE_URL || 'http://49.12.125.122:10000';
const URLS = (process.env.URLS || '/~meta@1.0/info/address').split(',');
const N = Number(process.env.N || 300);
const CONC = Number(process.env.CONC || 4);
const { Agent, setGlobalDispatcher } = await import('undici');
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60000, connections: CONC * 2 }));
const t0 = Date.now();
let done = 0, bytes = 0, bad = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (done < N) {
    done += 1;
    const u = URLS[done % URLS.length];
    const r = await fetch(NODE + u, { headers: { accept: 'text/plain' } }).catch(() => null);
    if (!r?.ok) { bad += 1; continue; }
    bytes += (await r.arrayBuffer()).byteLength;
  }
}));
const t1 = Date.now();
console.log(JSON.stringify({ urls: URLS, n: N, conc: CONC, startedEpochMs: t0, endedEpochMs: t1,
  wallMs: t1 - t0, reqPerSec: +(N / ((t1 - t0) / 1000)).toFixed(1), bytes, bad }));
