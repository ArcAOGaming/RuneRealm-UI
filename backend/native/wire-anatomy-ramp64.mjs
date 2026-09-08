// The same ramp with a deliberately chosen connection pool.
//
// This file used to reach past `keepalive.mjs` and call `setGlobalDispatcher`
// itself, because the pool size was hardcoded at 8 and there was no other way
// to A/B it. `keepalive.mjs` now takes the size — from `HB_CONNECTIONS`, or
// inferred at 2 per lane — so this is a one-line alias kept for the scripts and
// notes that already reference it by name.
process.env.HB_CONNECTIONS = String(Number(process.env.CONNS || 64));
console.log(`pool connections=${process.env.HB_CONNECTIONS}`);
await import('./concurrency-ramp.mjs');
