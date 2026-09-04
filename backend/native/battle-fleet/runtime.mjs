export const LUA_BATTLE_RUNTIME = 'lua@5.3a';
export const RUST_BATTLE_RUNTIME = 'rust-wasm@1';
export const BATTLE_RUNTIMES = Object.freeze([
  LUA_BATTLE_RUNTIME,
  RUST_BATTLE_RUNTIME,
]);

const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * The fleet's shape when a deploy does not ask for one.
 *
 * Exported because `deploy-workers.mjs` has to know the Rust count BEFORE it
 * can plan the fleet — it resolves the WASM image first — and it used to carry
 * its own `?? 2`. That was the old default, so an unset `BATTLE_FLEET_RUST`
 * built and published a Rust image to Arweave that no worker in the resulting
 * 3-Lua fleet would ever run.
 */
export const DEFAULT_BATTLE_FLEET_LUA = 3;
export const DEFAULT_BATTLE_FLEET_RUST = 0;

function count(value, name, fallback) {
  const parsed = Number(value === undefined ? fallback : value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 64) {
    throw new Error(`${name} must be an integer from 0 to 64.`);
  }
  return parsed;
}

/** Build the deliberately fixed-order mixed fleet. Worker order is also the
 * authority's deterministic round-robin order, so runtime placement is part
 * of the immutable deployment contract. */
export function battleWorkerSpecs(env = process.env) {
  // Three Lua workers, no Rust. The mixed 2+2 default shipped half of every
  // player's battles on a runtime measured at 20 ms a slot against Lua's 5 ms
  // (BATTLE_FLEET.md, "Measured on a local node"). Rust stays in the tree as a
  // working second implementation of the protocol and as the A/B arm; it is
  // opt-in now, by setting BATTLE_FLEET_RUST explicitly, and a deploy that does
  // not ask for it does not get it.
  const lua = count(env.BATTLE_FLEET_LUA, 'BATTLE_FLEET_LUA', DEFAULT_BATTLE_FLEET_LUA);
  const rust = count(env.BATTLE_FLEET_RUST, 'BATTLE_FLEET_RUST', DEFAULT_BATTLE_FLEET_RUST);
  const total = lua + rust;
  if (total < 1 || total > 64) {
    throw new Error('The mixed battle fleet must contain 1 to 64 workers.');
  }
  if (env.BATTLE_FLEET_SIZE !== undefined && Number(env.BATTLE_FLEET_SIZE) !== total) {
    throw new Error('BATTLE_FLEET_SIZE must equal BATTLE_FLEET_LUA + BATTLE_FLEET_RUST.');
  }

  const imageId = String(env.BATTLE_RUST_IMAGE_ID || '').trim();
  if (rust > 0 && !PROCESS_ID.test(imageId)) {
    throw new Error('Set BATTLE_RUST_IMAGE_ID to the 43-character cached Rust/WASM image id.');
  }

  return Object.freeze([
    ...Array.from({ length: lua }, (_, index) => ({
      workerId: `battle-worker-${String(index + 1).padStart(2, '0')}`,
      runtime: LUA_BATTLE_RUNTIME,
    })),
    ...Array.from({ length: rust }, (_, index) => ({
      workerId: `battle-worker-${String(lua + index + 1).padStart(2, '0')}`,
      runtime: RUST_BATTLE_RUNTIME,
      imageId,
    })),
  ]);
}

export function battleFleetComposition(specs) {
  return Object.freeze({
    lua: specs.filter((worker) => worker.runtime === LUA_BATTLE_RUNTIME).length,
    rust: specs.filter((worker) => worker.runtime === RUST_BATTLE_RUNTIME).length,
  });
}
