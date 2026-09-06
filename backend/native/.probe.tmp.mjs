import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const [pid, node] = fs.readFileSync(path.join(ROOT,'live-process.txt'),'utf8').trim().split(/\r?\n/).map(s=>s.trim());
const b = listBurners()[0];
const jwk = JSON.parse(fs.readFileSync(b.file,'utf8'));
console.log('process', pid, '\nburner  ', b.name, b.address, '\n');
const out = await sendMessage({ node, jwk, process: pid, action: 'Faction.Join',
  tags: { Action: 'Faction.Join', Faction: 'Stone Titans' } });
console.log('slot', out.slot);
const r = await fetch(`${node}/${pid}~process@1.0/compute&slot=${out.slot}/results/output/data`);
const text = await r.text();
console.log('reply http', r.status);
console.log(text.slice(0, 600));
