/** lane1-headgap.mjs — sample scheduler head vs computed head once a second. */
import fs from 'node:fs';
const NODE = process.env.NODE_URL || 'https://hyperbeam.tylerw.ai';
const PID = process.env.PID;
const SECONDS = Number(process.env.SECONDS || 300);
const OUT = process.env.OUT || `.test-tmp/headgap-${Date.now()}.jsonl`;
fs.mkdirSync('.test-tmp', { recursive: true });
const sink = fs.createWriteStream(OUT, { flags: 'a' });
const get = async (p) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${NODE}/${PID}~process@1.0/${p}`, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(30000) });
    const b = (await r.text()).trim();
    return { v: /^\d+$/.test(b) ? Number(b) : null, ms: Date.now() - t0, status: r.status };
  } catch (e) { return { v: null, ms: Date.now() - t0, status: 0 }; }
};
console.log(`headgap ${PID} for ${SECONDS}s -> ${OUT}`);
for (let i = 0; i < SECONDS; i++) {
  const t = Date.now();
  const [sched, comp] = await Promise.all([get('slot/current'), get('now/at-slot')]);
  const row = { t, sched: sched.v, schedMs: sched.ms, comp: comp.v, compMs: comp.ms,
    gap: (sched.v != null && comp.v != null) ? sched.v - comp.v : null };
  sink.write(JSON.stringify(row) + '\n');
  if (i % 10 === 0) console.log(`  ${new Date(t).toISOString().slice(11,19)} sched=${row.sched} comp=${row.comp} gap=${row.gap} (schedMs=${row.schedMs} compMs=${row.compMs})`);
  const rest = 1000 - (Date.now() - t);
  if (rest > 0) await new Promise((r) => setTimeout(r, rest));
}
sink.end();
