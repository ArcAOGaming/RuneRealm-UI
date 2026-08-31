/** Inspect and exercise the exact C-string ABI consumed by JSON-Iface@1.0. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2]
  || path.join(HERE, 'dist', 'runerealm-battle-worker.wasm'));
const bytes = fs.readFileSync(file);
const module = new WebAssembly.Module(bytes);
const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name));
for (const name of ['memory', 'malloc', 'free', 'handle']) {
  if (!exports.has(name)) throw new Error(`WASM ABI is missing export ${name}`);
}
const imports = WebAssembly.Module.imports(module);
if (imports.length) {
  throw new Error(`Battle worker must be self-contained; found imports: ${JSON.stringify(imports)}`);
}
const instance = new WebAssembly.Instance(module, {});
const { memory, malloc, handle } = instance.exports;

function cString(value) {
  const encoded = new TextEncoder().encode(`${JSON.stringify(value)}\0`);
  const pointer = malloc(encoded.length);
  new Uint8Array(memory.buffer, pointer, encoded.length).set(encoded);
  return pointer;
}

function readCString(pointer) {
  const view = new Uint8Array(memory.buffer);
  let end = pointer;
  while (end < view.length && view[end] !== 0) end += 1;
  if (end === view.length) throw new Error('handle result was not NUL terminated');
  return new TextDecoder().decode(view.subarray(pointer, end));
}

const owner = 'O'.repeat(43);
const scheduler = 'S'.repeat(43);
const game = 'G'.repeat(43);
const imageId = 'I'.repeat(43);
const env = {
  Process: {
    Owner: owner,
    Image: imageId,
    Scheduler: scheduler,
    'Scheduler-Location': scheduler,
    Tags: [
      ['Battle-Protocol', 'runerealm-battle-fleet/1'],
      ['Battle-Runtime', 'rust-wasm@1'],
      ['Battle-ABI', 'hyperbeam-json-iface-cstr/1'],
      ['Battle-Clock-Mode', 'trusted-game-clock-v1'],
      ['Battle-Enabled', 'true'],
      ['Battle-Game-Process', game],
      ['Battle-Worker-Id', 'battle-worker-03'],
      ['Battle-Worker-Capacity', '32'],
      ['Battle-Worker-Retained', '100'],
      ['Battle-Worker-Pending', '100'],
      ['Battle-Worker-Ticket-TTL', '3600000'],
      ['Battle-Worker-Outcomes', '10000'],
      ['Battle-Worker-Confirmations', '10000'],
    ].map(([name, value]) => ({ name, value })),
  },
};
const message = {
  Id: 'M'.repeat(43), Owner: owner, From: owner, Tags: [
    { name: 'Action', value: 'Fleet.Status' },
  ], Data: '', Target: 'P'.repeat(43), 'Block-Height': 1,
};

function invoke() {
  const resultPointer = handle(cString(message), cString(env));
  const envelope = JSON.parse(readCString(resultPointer));
  if (envelope?.ok !== true || !envelope.response?.Output
      || !Array.isArray(envelope.response.Messages)
      || !Array.isArray(envelope.response.patches)) {
    throw new Error(`Invalid JSON-Iface response envelope: ${JSON.stringify(envelope).slice(0, 500)}`);
  }
  const output = JSON.parse(envelope.response.Output.data);
  if (output.runtime !== 'rust-wasm@1' || output.imageId !== imageId
      || output.abi !== 'hyperbeam-json-iface-cstr/1'
      || output.clockMode !== 'trusted-game-clock-v1') {
    throw new Error(`Fleet.Status ABI identity mismatch: ${JSON.stringify(output)}`);
  }
  // The publish `patch@1.0` actually reads is the trailing PATCH entry in the
  // outbox, and it must be last so real outbox messages keep keys 1..N.
  const outbox = envelope.response.Messages;
  const patch = outbox[outbox.length - 1];
  const patchTags = patch?.Tags || [];
  if (!patchTags.some((tag) => tag.name.toLowerCase() === 'method' && tag.value === 'PATCH')
      || !patchTags.some((tag) => tag.name.toLowerCase() === 'fleetstatus')) {
    throw new Error('Last outbox entry is not a Tags-based PATCH for fleetstatus');
  }
  if (patch.Target !== undefined || patch.Data !== undefined) {
    throw new Error('The outbox PATCH must carry Tags only; dev_patch writes every other key to the process root');
  }
}

const initialBytes = memory.buffer.byteLength;
for (let iteration = 0; iteration < 100; iteration++) invoke();
const growth = memory.buffer.byteLength - initialBytes;
if (growth > 2 * 65536) {
  throw new Error(`100 ABI calls grew linear memory by ${growth} bytes; buffers are not bounded`);
}
process.stdout.write(`verified ${file}: C-string ABI, envelope, status patch, +${growth} memory bytes\n`);
