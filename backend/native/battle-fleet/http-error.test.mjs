import assert from 'node:assert/strict';
import test from 'node:test';

import { httpFailureSummary } from './http-error.mjs';

test('HyperBEAM HTML diagnostics preserve literal Erlang binaries', () => {
  const summary = httpFailureSummary(500, `<html><body><p>Oops.</p>
    <div>Error details: {error,{device_not_loadable,
    <<"JSON-Iface@1.0">>, <<"device-name-not-resolvable">>}}</div></body></html>`);
  assert.equal(summary, '500 Error details: {error,{device_not_loadable, '
    + '<<"JSON-Iface@1.0">>, <<"device-name-not-resolvable">>}}');
});

test('HyperBEAM HTML diagnostics preserve entity-encoded Erlang binaries', () => {
  const summary = httpFailureSummary(500, `<p>Termination type: 'throw'</p>
    <p>Error details: {error,{device_not_loadable,
    &lt;&lt;&quot;WASI@1.0&quot;&gt;&gt;,
    &lt;&lt;&quot;device-name-not-resolvable&quot;&gt;&gt;}}</p>`);
  assert.match(summary, /<<"WASI@1\.0">>/);
  assert.match(summary, /<<"device-name-not-resolvable">>/);
  assert.doesNotMatch(summary, /<p>/);
});

test('plain failures stay readable and scripts are discarded', () => {
  assert.equal(httpFailureSummary(404, 'not found'), '404 not found');
  assert.equal(httpFailureSummary(500,
    '<script>irrelevant()</script><p>Error details: boom &amp; bust</p>'),
  '500 Error details: boom & bust');
});
