/**
 * analyze-slots.mjs -- attribute slot cost and heap growth to a handler.
 *
 *   node analyze-slots.mjs soak-<stamp>-slots.json
 *
 * `computed_slot_size` is `erlang:external_size` of the whole process state
 * message, and dev_lua keeps the live Luerl state in that message's `priv`
 * (see `snapshot/3` in dev_lua.erl -- the interpreter heap is only serialized
 * to a cache entry every `process_snapshot_slots`, but it rides in the message
 * every slot). So the size column is a direct read of the interpreter heap, and
 * the delta between consecutive slots is what that one message KEPT.
 *
 * That makes this a better instrument than the offline heap probe for the
 * ranking question: it needs no bundle surgery, it runs on the real device
 * stack, and the node stamps the handler name on the line for free.
 */
import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const median = (values) => {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return NaN;
  const o = [...clean].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};
const fmt = (n, w) => (Number.isFinite(n) ? n.toFixed(0) : '-').padStart(w);

for (const arm of [...new Set(rows.map((r) => r.arm))]) {
  // Every line, not one per slot. The node computes the same slot more than
  // once -- a fresh `compute` walks back over slots it has already done, and
  // each replay pays the full price -- so the work the node actually did is the
  // sum over LINES. De-duplicating to one line per slot hides that entirely,
  // and picking an arbitrary representative invents differences that are not
  // there: it reported `User.Info` at 514 ms against `User.Login` at 13 ms on
  // the same process, and `H["User.Login"] = H["User.Info"]` -- they are one
  // function. All medians below are over lines.
  const all = rows.filter((x) => x.arm === arm).sort((a, b) => a.slot - b.slot);
  if (all.length < 4) continue;

  // One line per slot, for anything that needs a before/after pair. The first
  // computation is the real one; a replay recomputes the same transition.
  const bySlot = new Map();
  for (const r of all) if (!bySlot.has(r.slot)) bySlot.set(r.slot, r);
  const slots = [...bySlot.values()].sort((a, b) => a.slot - b.slot);

  console.log(`\n=== ${arm} — ${slots.length} slots, ${slots[0].slot}..${slots[slots.length - 1].slot}, `
    + `${all.length} computations (${(all.length / slots.length).toFixed(2)}x replay) ===\n`);

  // Heap kept per message, attributed to the handler that ran in that slot.
  const kept = new Map();
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].slot !== slots[i - 1].slot + 1) continue;
    const key = slots[i].action;
    if (!kept.has(key)) kept.set(key, []);
    kept.get(key).push(slots[i].size - slots[i - 1].size);
  }

  console.log(`${'action'.padEnd(24)} ${'n'.padStart(5)} ${'prep'.padStart(6)} ${'exec'.padStart(6)} `
    + `${'store'.padStart(6)} ${'total'.padStart(6)} ${'heap kept/msg'.padStart(14)}`);
  const actions = [...new Set(all.map((s) => s.action))]
    .map((action) => {
      const hit = all.filter((s) => s.action === action);
      return {
        action,
        n: hit.length,
        prep: median(hit.map((h) => h.prep)),
        exec: median(hit.map((h) => h.exec)),
        store: median(hit.map((h) => h.store)),
        total: median(hit.map((h) => h.prep + h.exec + h.store)),
        keptMedian: median(kept.get(action) || []),
      };
    })
    .sort((a, b) => (b.keptMedian || 0) - (a.keptMedian || 0));
  for (const a of actions) {
    if (a.n < 3) continue;
    console.log(`${a.action.padEnd(24)} ${String(a.n).padStart(5)} ${fmt(a.prep, 6)} ${fmt(a.exec, 6)} `
      + `${fmt(a.store, 6)} ${fmt(a.total, 6)} ${fmt(a.keptMedian, 14)}`);
  }

  // Does slot cost track the heap? Deciles across the run answer it directly.
  console.log(`\n${'decile'.padEnd(8)} ${'slots'.padStart(12)} ${'prep'.padStart(6)} ${'exec'.padStart(6)} `
    + `${'store'.padStart(6)} ${'total'.padStart(6)} ${'heap MB'.padStart(9)}`);
  const step = Math.max(1, Math.floor(all.length / 10));
  for (let i = 0; i + step <= all.length; i += step) {
    const chunk = all.slice(i, i + step);
    console.log(`${String(1 + i / step).padEnd(8)} `
      + `${`${chunk[0].slot}..${chunk[chunk.length - 1].slot}`.padStart(12)} `
      + `${fmt(median(chunk.map((c) => c.prep)), 6)} ${fmt(median(chunk.map((c) => c.exec)), 6)} `
      + `${fmt(median(chunk.map((c) => c.store)), 6)} `
      + `${fmt(median(chunk.map((c) => c.prep + c.exec + c.store)), 6)} `
      + `${(median(chunk.map((c) => c.size)) / 1e6).toFixed(2).padStart(9)}`);
  }
}
