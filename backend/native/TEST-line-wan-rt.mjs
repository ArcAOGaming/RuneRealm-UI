import fs from 'node:fs';
import { sendMessage, transportNode } from './hbclient.mjs';
const NODE = process.env.NODE_URL, PID = process.env.PID;
const jwk = JSON.parse(fs.readFileSync(process.env.HB_WALLET, 'utf8'));
const T = transportNode(NODE);
const OUTFIT = { Hair:{style:'Long',color:'#3b2a1a'}, Hat:{style:'Beanie',color:'#2f4f4f'},
  Shirt:{style:'Shirt',color:'#7a1f1f'}, Pants:{style:'Skirt',color:'#1f2f5a'},
  Gloves:{style:'Gloves',color:'#404040'}, Shoes:{style:'Shoes',color:'#20202a'} };
const N = Number(process.env.N || 10); const ms = [];
for (let i = 0; i < N; i++) {
  const o = JSON.parse(JSON.stringify(OUTFIT)); o.Shirt.color = '#7b' + String(1000+i).padStart(4,'0');
  const t0 = performance.now();
  const post0 = performance.now();
  const sent = await sendMessage({ node: NODE, jwk, process: PID, action: 'Sprite.Update', data: JSON.stringify(o), push: false });
  const post = performance.now() - post0;
  const url = `${T}/${PID}~process@1.0/compute&slot=${sent.slot}/results/output/data`;
  for (;;) {
    const r = await fetch(url, { headers: { 'accept-bundle': 'true' } });
    const b = await r.text();
    if (r.status === 200 && !b.trimStart().startsWith('<')) {
      if (b.includes('"error"')) { console.log('REFUSAL ' + b.slice(0,100)); break; }
      const rec = JSON.parse(b);
      if (rec?.outfit?.Shirt?.color !== o.Shirt.color) { console.log('NOT CHANGED'); break; }
      const t = performance.now() - t0; ms.push(t);
      console.log(`slot ${sent.slot}  ROUND TRIP ${Math.round(t)} ms  (post ${Math.round(post)} ms, not latency)`);
      break;
    }
    await new Promise(s => setTimeout(s, 50));
    if (performance.now() - t0 > 90000) { console.log('deadline'); break; }
  }
}
ms.sort((a,b)=>a-b);
const q=p=>Math.round(ms[Math.min(ms.length-1,Math.floor(ms.length*p))]);
console.log(`\nn=${ms.length}  p50 ${q(.5)}  p95 ${q(.95)}  min ${Math.round(ms[0])}  max ${Math.round(ms[ms.length-1])}`);
