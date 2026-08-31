import assert from 'node:assert/strict';
import test from 'node:test';
import { RUST_WORKER_DEVICES, missingDeviceError, probeDevice } from './probe-devices.mjs';

const page = (title, detail) =>
  `<html><head><title>${title}</title></head><body><pre>${detail}</pre></body></html>`;

const stub = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
});

test('an unresolvable device name is the 500 that names it', async () => {
  const result = await probeDevice('https://node', 'JSON-Iface@1.0', {
    fetchImpl: stub(500, page('500 - Oops.',
      '{error,{device_not_loadable,<<"JSON-Iface@1.0">>,\n  <<"device-name-not-resolvable">>}}')),
  });
  assert.equal(result.resolvable, false);
  assert.equal(result.detail, 'device-name-not-resolvable');
});

test('a registered device answers 200, even with the node landing page', async () => {
  const result = await probeDevice('https://node', 'json-iface@1.0', {
    fetchImpl: stub(200, '<!DOCTYPE html><html lang="en">hyperbuddy</html>'),
  });
  assert.equal(result.resolvable, true);
});

test('a resolved device with no such key answers 404, which is still resolved', async () => {
  const result = await probeDevice('https://node', 'patch@1.0', {
    fetchImpl: stub(404, page('404 - Page not found.', 'not found')),
  });
  assert.equal(result.resolvable, true);
});

test('any other 500 is unknown, never reported as a missing device', async () => {
  const result = await probeDevice('https://node', 'stack@1.0', {
    fetchImpl: stub(500, page('500 - Oops.', 'Error details: {badmap,[]}')),
  });
  assert.equal(result.resolvable, null);
  assert.equal(missingDeviceError([result]), '');
});

test('a transport failure is unknown, not a verdict about the node', async () => {
  const result = await probeDevice('https://node', 'wasm-64@1.0', {
    fetchImpl: async () => { throw new Error('socket hang up'); },
  });
  assert.equal(result.resolvable, null);
  assert.equal(missingDeviceError([result]), '');
});

test('the Rust worker stack is named in lowercase', () => {
  for (const name of RUST_WORKER_DEVICES) {
    assert.equal(name, name.toLowerCase(),
      `${name} must be lowercase; device names are matched byte for byte`);
  }
  for (const required of ['json-iface@1.0', 'wasm-64@1.0', 'multipass@1.0', 'patch@1.0']) {
    assert.ok(RUST_WORKER_DEVICES.includes(required), `${required} must be probed`);
  }
});

test('missingDeviceError names every device the node rejected', () => {
  assert.equal(
    missingDeviceError([
      { name: 'json-iface@1.0', resolvable: false },
      { name: 'patch@1.0', resolvable: true },
      { name: 'wasm-64@1.0', resolvable: false },
    ]),
    'node cannot resolve json-iface@1.0, wasm-64@1.0',
  );
});
