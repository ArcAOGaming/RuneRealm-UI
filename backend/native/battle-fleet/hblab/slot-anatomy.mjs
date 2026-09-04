/**
 * slot-anatomy.mjs -- what are the bytes a slot actually pays for?
 *
 *   node slot-anatomy.mjs <process-id> [slot] [--node http://localhost:8734]
 *
 * `computed_slot_size` in the node's log is the whole computed message, not the
 * published map. On a fresh game process those two numbers were 3.46 MB and
 * 15 KB -- a factor of 228 -- so "shrink a published key" and "make a slot
 * cheaper" are not the same job. This prints every top-level part of the
 * computed message with its size, so the difference stops being a mystery.
 *
 * Both bodies are HyperBEAM multipart: one part per key, named in a
 * `content-disposition: form-data; name="..."` header.
 */
import process from 'node:process';

const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const NODE = (opt('--node', process.env.NODE_URL || 'http://localhost:8734')).replace(/\/$/, '');
const pid = process.argv[2];
const slot = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
if (!pid) throw new Error('usage: node slot-anatomy.mjs <process-id> [slot]');

/** Split a multipart body into named parts, by the boundary the node declared.
 *
 * The boundary is in the content-type header; deriving it from the body's first
 * line instead breaks on any part whose payload happens to start with dashes. */
function parts(buffer, contentType) {
  const found = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!found) return null;
  const sep = Buffer.from(`--${found[1]}`);
  const out = [];
  let at = buffer.indexOf(sep);
  while (at !== -1) {
    const next = buffer.indexOf(sep, at + sep.length);
    if (next === -1) break;
    const chunk = buffer.subarray(at + sep.length, next);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    const head = chunk.subarray(0, headerEnd === -1 ? chunk.length : headerEnd).toString('latin1');
    const name = /name="?([^";\r\n]+)"?/i.exec(head);
    out.push({
      name: name ? name[1] : '(unnamed)',
      bytes: chunk.length,
      body: headerEnd === -1 ? 0 : chunk.length - headerEnd - 4,
    });
    at = next;
  }
  return out;
}

async function anatomy(label, url) {
  const res = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(900000) });
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`\n== ${label} ==`);
  console.log(`${url}\n${res.status} ${res.headers.get('content-type') || ''}`);
  console.log(`total ${buffer.length} bytes (${(buffer.length / 1e6).toFixed(3)} MB)\n`);
  const list = parts(buffer, res.headers.get('content-type'));
  if (!list) {
    console.log('  not multipart; first 300 bytes:');
    console.log(`  ${buffer.subarray(0, 300).toString('utf8').replace(/\n/g, ' ')}`);
    return;
  }
  list.sort((a, b) => b.bytes - a.bytes);
  const shown = list.slice(0, 40);
  for (const part of shown) {
    const share = (100 * part.bytes / buffer.length).toFixed(1);
    console.log(`  ${String(part.bytes).padStart(9)}  ${share.padStart(5)}%  ${part.name}`);
  }
  if (list.length > shown.length) {
    const rest = list.slice(shown.length).reduce((n, p) => n + p.bytes, 0);
    console.log(`  ${String(rest).padStart(9)}  ${(100 * rest / buffer.length).toFixed(1).padStart(5)}%  (${list.length - shown.length} smaller parts)`);
  }
}

await anatomy('published state (/now)', `${NODE}/${pid}~process@1.0/now`);
await anatomy(slot ? `computed slot ${slot}` : 'computed head (/compute)',
  slot ? `${NODE}/${pid}~process@1.0/compute&slot=${slot}` : `${NODE}/${pid}~process@1.0/compute`);
