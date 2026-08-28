#!/usr/bin/env node
/**
 * Local transport bridge for environments where shell processes cannot open
 * outbound sockets but the browser can reach the configured HyperBEAM node.
 *
 * The swarm workers still build and sign every request. This server only queues
 * the resulting HTTP request for a local browser page to forward, then returns
 * that response to the waiting worker. Private JWKs never enter the browser.
 *
 *   node backend/native/swarm/browser-relay.mjs --target https://node.example
 *
 * Set NODE_URL to the printed relay node and keep the printed relay page open.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const target = String(option('target', '')).replace(/\/$/, '');
const port = Number(option('port', 8793));
if (!/^https:\/\//.test(target)) throw new Error('--target must be an https:// node URL');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('--port must be an integer from 1024 to 65535');
}

const token = randomBytes(18).toString('base64url');
const prefix = `/${token}`;
const queued = [];
const waitingBrowsers = [];
const inFlight = new Map();
let sequence = 0;
let forwarded = 0;
let failed = 0;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendJob(response, job) {
  json(response, 200, {
    id: job.id,
    method: job.method,
    path: job.path,
    headers: job.headers,
    body: job.body.toString('base64'),
  });
}

function dispatch() {
  while (queued.length && waitingBrowsers.length) {
    const job = queued.shift();
    const waiter = waitingBrowsers.shift();
    clearTimeout(waiter.timer);
    sendJob(waiter.response, job);
  }
}

function readBody(request, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`request body exceeds ${limit} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const REQUEST_HEADERS = ['accept', 'accept-bundle', 'content-type'];
function forwardHeaders(headers) {
  return Object.fromEntries(REQUEST_HEADERS.flatMap((name) => (
    headers[name] === undefined ? [] : [[name, String(headers[name])]]
  )));
}

function finishJob(id, payload) {
  const job = inFlight.get(id);
  if (!job) return false;
  inFlight.delete(id);
  clearTimeout(job.timer);
  if (job.response.writableEnded || job.response.destroyed) return true;
  const responseHeaders = {};
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    if (['connection', 'content-length', 'content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) continue;
    responseHeaders[name] = String(value);
  }
  const body = Buffer.from(payload.body ?? '', 'base64');
  responseHeaders['content-length'] = String(body.length);
  job.response.writeHead(Number(payload.status) || 502, responseHeaders);
  job.response.end(body);
  forwarded++;
  if (Number(payload.status) >= 400) failed++;
  return true;
}

function relayPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Rune Realm swarm relay</title>
<style>
body{margin:0;background:#070a12;color:#d8ddeb;font:14px ui-monospace,monospace;display:grid;min-height:100vh;place-items:center}
main{width:min(680px,calc(100% - 40px));border:1px solid #293149;background:#0d1220;padding:28px;box-shadow:0 24px 80px #0008}
h1{margin:0 0 10px;font:600 25px system-ui;color:#f0f2f8}p{color:#929bb2;line-height:1.6}.live{color:#65dca2}.bad{color:#ff7a8d}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#293149;margin-top:22px}.grid div{background:#0a0f1a;padding:16px}
small{display:block;color:#69748d;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}strong{font-size:24px;color:#dcb7ff}
code{display:block;overflow-wrap:anywhere;color:#7f8ca8;font-size:11px;margin-top:20px}
</style></head><body><main><small>Local transport bridge</small><h1>Rune Realm swarm relay</h1>
<p id="state" class="live">Connected. Waiting for signed game traffic…</p>
<div class="grid"><div><small>Forwarded</small><strong id="forwarded">0</strong></div><div><small>Failures</small><strong id="failed">0</strong></div><div><small>In flight</small><strong id="active">0</strong></div></div>
<code>${target}</code></main><script type="module">
const TARGET=${JSON.stringify(target)};let forwarded=0,failed=0,active=0;
const state=document.querySelector('#state'),forwardedEl=document.querySelector('#forwarded'),failedEl=document.querySelector('#failed'),activeEl=document.querySelector('#active');
const b64bytes=(value)=>{const binary=atob(value);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes};
const bytesB64=(buffer)=>{const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)};
const paint=()=>{forwardedEl.textContent=forwarded;failedEl.textContent=failed;activeEl.textContent=active};
async function deliver(job){active++;paint();state.textContent='Forwarding '+job.method+' '+job.path.slice(0,86);state.className='live';
  let result;
  try{const response=await fetch(TARGET+job.path,{method:job.method,headers:job.headers,body:['GET','HEAD'].includes(job.method)?undefined:b64bytes(job.body)});
    result={id:job.id,status:response.status,headers:Object.fromEntries(response.headers.entries()),body:bytesB64(await response.arrayBuffer())};
    forwarded++;if(!response.ok)failed++;
  }catch(error){result={id:job.id,status:599,headers:{'content-type':'text/plain'},body:bytesB64(new TextEncoder().encode(String(error)))};failed++;state.textContent='Browser forward failed: '+error;state.className='bad'}
  await fetch('./__relay/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)});
  active--;paint();if(!failed){state.textContent='Connected. Waiting for signed game traffic…';state.className='live'}
}
async function loop(){for(;;){try{const response=await fetch('./__relay/next',{cache:'no-store'});if(response.status===204)continue;if(!response.ok)throw new Error('relay '+response.status);await deliver(await response.json())}catch(error){state.textContent='Local relay disconnected: '+error;state.className='bad';await new Promise(resolve=>setTimeout(resolve,1000))}}}
paint();loop();
</script></body></html>`;
}

const server = http.createServer(async (request, response) => {
  const raw = request.url ?? '/';
  if (!raw.startsWith(prefix)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const route = raw.slice(prefix.length) || '/';
  try {
    if (request.method === 'GET' && (route === '/' || route === '/relay.html')) {
      const body = relayPage();
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (request.method === 'GET' && route.startsWith('/__relay/next')) {
      if (queued.length) sendJob(response, queued.shift());
      else {
        const waiter = { response, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waitingBrowsers.indexOf(waiter);
          if (index >= 0) waitingBrowsers.splice(index, 1);
          if (!response.writableEnded) response.writeHead(204, { 'cache-control': 'no-store' }).end();
        }, 15_000);
        waitingBrowsers.push(waiter);
      }
      return;
    }
    if (request.method === 'POST' && route === '/__relay/result') {
      const payload = JSON.parse((await readBody(request)).toString('utf8'));
      json(response, finishJob(String(payload.id), payload) ? 200 : 404, { accepted: true });
      return;
    }

    const id = String(++sequence);
    const body = await readBody(request);
    const job = {
      id,
      method: request.method ?? 'GET',
      path: route,
      headers: forwardHeaders(request.headers),
      body,
      response,
      timer: setTimeout(() => {
        const current = inFlight.get(id);
        if (!current) return;
        inFlight.delete(id);
        const queueIndex = queued.indexOf(current);
        if (queueIndex >= 0) queued.splice(queueIndex, 1);
        if (!response.writableEnded) response.writeHead(504).end('Browser relay timed out after 180s');
      }, 180_000),
    };
    inFlight.set(id, job);
    queued.push(job);
    dispatch();
  } catch (error) {
    if (!response.writableEnded) response.writeHead(500).end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${port}${prefix}`;
  console.log(`relay node  ${base}`);
  console.log(`relay page  ${base}/`);
  console.log(`target      ${target}`);
});

const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
