/**
 * gc-shape.mjs -- does the Luerl collect pay per TABLE or per BYTE?
 *
 *   node gc-shape.mjs [node-url]        # default http://localhost:8734
 *
 * This decides whether a hot/cold split of the player record is worth building.
 * `SLOT_LATENCY_INVESTIGATION.md` shows a full `collectgarbage("collect")` at
 * the end of every `compute`, over a heap that grows 5,326 bytes per wallet, is
 * the dominant term in a slot. If the collect's cost tracks the NUMBER of live
 * tables, then keeping a cold player record as one encoded string instead of
 * ~30 nested tables cuts the sweep by whatever that ratio is, at identical
 * bytes. If it tracks bytes, the shape does not matter and only deleting data
 * helps.
 *
 * Two heaps of the SAME total payload, one held as nested tables and one as
 * strings, collected the same number of times. Nothing here touches a process
 * or a slot -- it POSTs to the free unsigned `~lua@5.3a` device.
 *
 * Timing is the HTTP round trip: `os.clock` is a stub on Luerl and `os.time`
 * has one-second resolution. Each size is measured twice, with and without the
 * collections, so building the heap is subtracted rather than estimated.
 */
import process from 'node:process';

const NODE = (process.argv[2] || 'http://localhost:8734').replace(/\/$/, '');
const REPS = 3;

/**
 * `records` records of ~`FIELD_BYTES` of payload each.
 *
 * `tables` shape mirrors a player record: a handful of nested tables plus a
 * roster of moves. `strings` holds the identical payload as one string per
 * record -- one heap object each, whatever its length.
 */
const script = (records, shape, reps) => `
function gcshape(base, req)
  local blob = string.rep("x", 40)
  local keep = {}
  for i = 1, ${records} do
${shape === 'tables' ? `
    keep[i] = {
      address = blob, faction = blob, joinedAt = i, wins = i, losses = i,
      inventory = { rune = i, air_berry = i, water_berry = i, fire_berry = i },
      monster = {
        name = blob, image = blob, sprite = blob, level = i, exp = i,
        status = { type = blob, since = i, until_time = i },
        moves = {
          one = { type = blob, damage = i, attack = i, speed = i },
          two = { type = blob, damage = i, attack = i, speed = i },
          three = { type = blob, damage = i, attack = i, speed = i },
          four = { type = blob, damage = i, attack = i, speed = i },
        },
      },
      lootboxes = { i, i, i },
      collection = {},
    }
` : `
    -- The same payload, encoded. One heap object per record.
    keep[i] = blob .. blob .. blob .. blob .. blob .. blob .. blob .. blob
      .. blob .. blob .. blob .. blob .. blob .. blob .. blob .. tostring(i)
`}
  end
  for _ = 1, ${reps} do collectgarbage("collect") end
  return "kept=" .. tostring(#keep)
end
`;

async function timeOne(records, shape, reps) {
  const t0 = Date.now();
  const res = await fetch(`${NODE}/~lua@5.3a/gcshape`, {
    method: 'POST',
    headers: { 'content-type': 'application/lua' },
    body: script(records, shape, reps),
    signal: AbortSignal.timeout(600000),
  });
  const body = (await res.text()).trim();
  return { ms: Date.now() - t0, ok: res.ok, body: body.slice(0, 80) };
}

console.log(`node ${NODE}\n`);
console.log(`${'records'.padStart(8)} ${'shape'.padStart(8)} ${'build'.padStart(9)} `
  + `${`+${REPS} collects`.padStart(13)} ${'per collect'.padStart(12)}`);

for (const records of [500, 1000, 2000, 4000, 8000]) {
  for (const shape of ['tables', 'strings']) {
    let base;
    let withGc;
    try {
      base = await timeOne(records, shape, 0);
      withGc = await timeOne(records, shape, REPS);
    } catch (err) {
      // A request the node gives up on IS the result for that row: it means the
      // collect at this size takes longer than the node will hold a connection.
      console.log(`${String(records).padStart(8)} ${shape.padStart(8)}  node dropped the connection `
        + `(${err.cause?.code || err.message})`);
      continue;
    }
    if (!base.ok || !withGc.ok) {
      console.log(`${String(records).padStart(8)} ${shape.padStart(8)}  failed: ${(base.ok ? withGc : base).body}`);
      continue;
    }
    console.log(`${String(records).padStart(8)} ${shape.padStart(8)} ${`${base.ms}ms`.padStart(9)} `
      + `${`${withGc.ms}ms`.padStart(13)} ${`${((withGc.ms - base.ms) / REPS).toFixed(1)}ms`.padStart(12)}`);
  }
}
