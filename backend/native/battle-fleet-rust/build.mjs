/** Reproducible Rust/WASM build for HyperBEAM's current WAMR runtime. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const target = 'wasm32-unknown-unknown';
const source = path.join(HERE, 'target', target, 'release', 'runerealm_battle_worker.wasm');
const outputDirectory = path.join(HERE, 'dist');
const wat = path.join(outputDirectory, 'runerealm-battle-worker.wat');
const output = path.join(outputDirectory, 'runerealm-battle-worker.wasm');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: HERE,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

fs.mkdirSync(outputDirectory, { recursive: true });
run('cargo', ['build', '--locked', '--offline', '--release', '--target', target], {
  env: {
    ...process.env,
    RUSTFLAGS: `${process.env.RUSTFLAGS || ''} -C target-feature=-reference-types`.trim(),
  },
});
// Rust 1.82+ may emit overlong call_indirect LEB encodings rejected by the
// WAMR 2.2.0 build used by deployed HyperBEAM nodes. A WAT round-trip produces
// the canonical encoding without changing the module's semantics.
run('wasm-tools', ['print', source, '-o', wat]);
run('wasm-tools', ['parse', wat, '-o', output]);
fs.rmSync(wat, { force: true });
// No shell for this one. On Windows `process.execPath` is the node.exe under
// "Program Files", and cmd.exe receives that path unquoted, so the build dies
// with `'C:\Program' is not recognized` -- AFTER the module has already been
// written, which reads exactly like a failed build that in fact succeeded.
run(process.execPath, [path.join(HERE, 'verify-wasm.mjs'), output], { shell: false });
process.stdout.write(`${output}\n`);
