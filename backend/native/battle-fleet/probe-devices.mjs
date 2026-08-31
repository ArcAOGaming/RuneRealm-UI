/** Ask a HyperBEAM node which devices it will actually resolve.
 *
 * Read-only, free, and unsigned. Nothing here spawns or schedules anything.
 *
 * Why this exists: a spawn whose `device-stack` names a device the node cannot
 * resolve dies at init with
 *
 *     {error,{device_not_loadable,<<"JSON-Iface@1.0">>,
 *                                 <<"device-name-not-resolvable">>}}
 *
 * which reads as "this node has no JSON interface" and is very often not that.
 * Device names are matched byte-for-byte and the registry is all lowercase, so
 * `JSON-Iface@1.0` and `json-iface@1.0` are different devices and only the
 * second one exists. The probe below separates the two cases, because a
 * registered device answers `/~<name>/keys` with 200 and an unresolvable one
 * answers that same 500.
 *
 *   node backend/native/battle-fleet/probe-devices.mjs [node-url] [name...]
 */
import process from 'node:process';
import { httpFailureSummary } from './http-error.mjs';

/** The exact stack a Rust/WASM battle worker is spawned with, plus the two
 * devices that carry it. Deliberately lowercase; see above. */
export const RUST_WORKER_DEVICES = Object.freeze([
  'process@1.0',
  'scheduler@1.0',
  'stack@1.0',
  'json-iface@1.0',
  'wasm-64@1.0',
  'multipass@1.0',
  'patch@1.0',
]);

const UNRESOLVABLE = /device-name-not-resolvable/;

/** Resolve one device name against a node.
 *
 * Returns `{ name, resolvable, status, detail }`. `resolvable` is only false
 * when the node said the name itself is not resolvable; any other failure is
 * reported as unknown (`resolvable: null`) rather than guessed at, because a
 * transport error must never be recorded as "this node lacks the device". */
export async function probeDevice(node, name, { fetchImpl = fetch } = {}) {
  let response;
  let body = '';
  try {
    response = await fetchImpl(`${node}/~${name}/keys`, {
      headers: { accept: 'application/json, text/plain' },
    });
    body = await response.text();
  } catch (error) {
    return { name, resolvable: null, status: 0, detail: error.message };
  }
  if (response.status === 500 && UNRESOLVABLE.test(body)) {
    return { name, resolvable: false, status: 500, detail: 'device-name-not-resolvable' };
  }
  if (response.status >= 500) {
    return { name, resolvable: null, status: response.status, detail: httpFailureSummary(response.status, body) };
  }
  // 200 (a key listing, or the node's own landing page) and 404 (device
  // resolved, `keys` not exported) both mean the NAME resolved, which is the
  // only thing this probe claims to answer.
  return { name, resolvable: true, status: response.status, detail: 'resolved' };
}

export async function probeDevices(node, names = RUST_WORKER_DEVICES, options = {}) {
  const results = [];
  for (const name of names) results.push(await probeDevice(node, name, options));
  return results;
}

/** One line naming every device that is known-missing, or '' when the node can
 * carry the stack. Unknown results are reported separately by the caller. */
export function missingDeviceError(results) {
  const missing = results.filter((entry) => entry.resolvable === false).map((entry) => entry.name);
  return missing.length ? `node cannot resolve ${missing.join(', ')}` : '';
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('probe-devices.mjs')) {
  const node = (process.argv[2] || process.env.HB_NODE || 'https://hyperbeam.tylerw.ai').replace(/\/$/, '');
  const names = process.argv.length > 3 ? process.argv.slice(3) : RUST_WORKER_DEVICES;
  const results = await probeDevices(node, names);
  console.log(`node ${node}`);
  for (const entry of results) {
    const mark = entry.resolvable === true ? 'ok     ' : entry.resolvable === false ? 'MISSING' : 'unknown';
    console.log(`  ${mark} ${entry.name.padEnd(20)} ${entry.status} ${entry.detail.slice(0, 120)}`);
  }
  const missing = missingDeviceError(results);
  if (missing) {
    console.error(`\n${missing}`);
    process.exitCode = 1;
  } else {
    console.log('\nall probed device names resolve on this node');
  }
}
