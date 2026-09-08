import fs from 'node:fs';
import { commit } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
const PID = process.env.PID;
const OUT = process.env.OUT;
const jwk = (await listBurners())[0].jwk;
const DATA = JSON.stringify(['Gloves','Long','Beanie','Skirt','Shirt','Shoes']);
const n = Number(process.env.COUNT || 12);
const cmds = [];
for (let i = 0; i < n; i += 1) {
  const msg = { target: PID, type: 'Message', subject: 'self', action: 'Sprite.Update',
    data: DATA, 'random-seed': String(Math.floor(Math.random() * 1e9)) };
  const { headers, body } = commit(msg, jwk, {});
  fs.writeFileSync(`${OUT}/body-${i}.bin`, body ?? Buffer.alloc(0));
  const hs = Object.entries(headers).map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`).join(' ');
  cmds.push(`${hs} -H "accept-bundle: true" --data-binary @${OUT}/body-${i}.bin`);
}
fs.writeFileSync(`${OUT}/args.txt`, cmds.join('\n') + '\n');
console.log('dumped', n, 'bodyBytes', fs.statSync(`${OUT}/body-0.bin`).size);
