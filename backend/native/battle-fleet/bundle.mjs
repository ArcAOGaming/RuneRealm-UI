import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.dirname(HERE);
const readNative = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');
const readHere = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');
const luaString = (value) => JSON.stringify(String(value));

export function buildWorkerSource({
  gameProcess,
  workerId,
  capacity = 32,
  maxRetained = 100,
  maxPending = maxRetained,
  maxTicketTtl = 60 * 60 * 1000,
  maxOutcomes = 10000,
  maxConfirmations = maxOutcomes,
  enabled = false,
}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(gameProcess || '')) {
    throw new Error('gameProcess must be a 43-character process id');
  }
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(workerId || '')) {
    throw new Error('workerId must contain only letters, numbers, _ or -');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
    throw new Error('capacity must be an integer between 1 and 10000');
  }
  if (!Number.isInteger(maxRetained) || maxRetained < 1 || maxRetained > 10000) {
    throw new Error('maxRetained must be an integer between 1 and 10000');
  }
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 10000) {
    throw new Error('maxPending must be an integer between 1 and 10000');
  }
  if (!Number.isInteger(maxTicketTtl) || maxTicketTtl < 60000
      || maxTicketTtl > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('maxTicketTtl must be an integer between one minute and seven days');
  }
  if (!Number.isInteger(maxOutcomes) || maxOutcomes < 1 || maxOutcomes > 100000) {
    throw new Error('maxOutcomes must be an integer between 1 and 100000');
  }
  if (!Number.isInteger(maxConfirmations) || maxConfirmations < 1
      || maxConfirmations > 100000) {
    throw new Error('maxConfirmations must be an integer between 1 and 100000');
  }

  return [
    readNative('json.lua'),
    'local C = (function()', readNative('constants.lua'), 'end)()',
    'local jsonx = (function()', readNative('jsonenc.lua'), 'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()', readNative('battle.lua'), 'end)()',
    'BattleFleetConfig = {',
    `  enabled = ${enabled ? 'true' : 'false'},`,
    `  gameProcess = ${luaString(gameProcess)},`,
    `  workerId = ${luaString(workerId)},`,
    `  capacity = ${capacity},`,
    `  maxRetained = ${maxRetained},`,
    `  maxPending = ${maxPending},`,
    `  maxTicketTtl = ${maxTicketTtl},`,
    `  maxOutcomes = ${maxOutcomes},`,
    `  maxConfirmations = ${maxConfirmations},`,
    '}',
    readHere('worker.lua'),
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gameProcess = process.env.BATTLE_GAME_PROCESS || '';
  const source = buildWorkerSource({
    gameProcess,
    workerId: process.env.BATTLE_WORKER_ID || 'battle-worker-01',
    capacity: Number(process.env.BATTLE_WORKER_CAPACITY || 32),
    maxRetained: Number(process.env.BATTLE_WORKER_RETAINED || 100),
    maxPending: Number(process.env.BATTLE_WORKER_PENDING
      || process.env.BATTLE_WORKER_RETAINED || 100),
    maxTicketTtl: Number(process.env.BATTLE_WORKER_TICKET_TTL || 60 * 60 * 1000),
    maxOutcomes: Number(process.env.BATTLE_WORKER_OUTCOMES || 10000),
    maxConfirmations: Number(process.env.BATTLE_WORKER_CONFIRMATIONS
      || process.env.BATTLE_WORKER_OUTCOMES || 10000),
    enabled: /^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || ''),
  });
  process.stdout.write(source);
}
