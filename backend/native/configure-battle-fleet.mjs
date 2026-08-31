/** One-time clean-test sealing of a verified worker manifest into the game. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { battleFleetConfigMatches, loadBattleFleetManifest } from './battle-fleet-config.mjs';
import { sendMessage } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const enabled = /^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || '');
if (!enabled) throw new Error('Set BATTLE_FLEET_ENABLED=1 to seal a battle fleet.');

const node = (process.env.NODE_URL || 'https://schedule.forward.computer').replace(/\/$/, '');
const gameProcess = process.env.BATTLE_GAME_PROCESS || '';
const manifestPath = process.env.BATTLE_FLEET_MANIFEST || '';
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
if (!/^[A-Za-z0-9_-]{43}$/.test(gameProcess)) {
  throw new Error('Set BATTLE_GAME_PROCESS to the clean-test game process id.');
}
if (!manifestPath) throw new Error('Set BATTLE_FLEET_MANIFEST to the verified worker manifest.');
if (!fs.existsSync(walletPath)) throw new Error(`No keyfile at ${walletPath}`);
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const rawManifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
if (rawManifest.gameProcess !== gameProcess) {
  throw new Error(`Worker manifest targets ${rawManifest.gameProcess || '(missing gameProcess)'}, not ${gameProcess}`);
}
const config = loadBattleFleetManifest(manifestPath, { expectedNode: node });
const data = JSON.stringify(config);

const { slot } = await sendMessage({
  node, jwk, process: gameProcess,
  action: 'Admin.ConfigureBattleFleet',
  data,
});
console.log(`configure scheduled at game slot ${slot}`);

async function readConfigureReply() {
  const numericSlot = Number(slot);
  if (!Number.isSafeInteger(numericSlot) || numericSlot < 0) {
    throw new Error(`Configure returned invalid slot ${slot}`);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const head = await fetch(`${node}/${gameProcess}~process@1.0/now/at-slot`, {
      headers: { accept: 'text/plain' },
    }).catch(() => null);
    const at = head?.ok ? Number((await head.text()).trim()) : Number.NaN;
    if (Number.isSafeInteger(at) && at >= numericSlot) {
      const response = await fetch(
        `${node}/${gameProcess}~process@1.0/compute&slot=${numericSlot}/results/output/data`,
        { headers: { accept: 'application/json, text/plain' } },
      );
      if (response.ok) {
        const text = (await response.text()).trim();
        if (text && !/^<!doctype|^<html/i.test(text)) return JSON.parse(text);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Could not read correlated configure reply for slot ${slot}`);
}

const configureReply = await readConfigureReply();
if (configureReply?.error) throw new Error(`Battle fleet seal rejected: ${configureReply.error}`);
if (configureReply?.configured !== true) {
  throw new Error(`Unexpected configure reply: ${JSON.stringify(configureReply)}`);
}

let observed;
for (let attempt = 0; attempt < 60; attempt++) {
  const response = await fetch(`${node}/${gameProcess}~process@1.0/now/battlefleet`, {
    headers: { accept: 'application/json, text/plain' },
  }).catch(() => null);
  if (response?.ok) {
    const text = (await response.text()).trim();
    try {
      const value = JSON.parse(text);
      if (battleFleetConfigMatches(value, config)) {
        observed = value;
        break;
      }
    } catch { /* the key is not ready yet */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!observed) throw new Error('Game did not publish the exact sealed battle fleet within 60 seconds.');
console.log(`${configureReply.duplicate ? 'verified existing' : 'sealed'} ${observed.workers.length} immutable worker route(s) into ${gameProcess}`);
