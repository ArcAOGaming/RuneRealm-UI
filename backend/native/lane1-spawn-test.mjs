/** lane1-spawn-test.mjs — spawn a TEST- process with the live game module, for
 *  a clean serial baseline that does not disturb the live authority. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess } from './hbclient.mjs';
import gameModuleSources from './game-bundle.mjs';
import { minifyLua } from './lua-minify.mjs';
import { listBurners } from './burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const NODE = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const burners = await listBurners();
const actor = burners.find((b) => b.name === (process.env.BURNER || 'burner-01')) || burners[0];
const lua = minifyLua(gameModuleSources({ publicAccess: true }));
console.log(`module: ${Buffer.byteLength(lua)} bytes`);
const t = Date.now();
const pid = await spawnProcess({ node: NODE, jwk: actor.jwk, lua, name: 'TEST-lane1-slot-anatomy' });
console.log(`spawn: ${Date.now() - t}ms`);
console.log(pid);
fs.writeFileSync(path.join(ROOT, '.test-tmp', 'lane1-test-pid.txt'), pid);
