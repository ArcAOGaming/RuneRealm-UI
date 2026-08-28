import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type StudioEnv = {
  PIXELLAB_API_KEY?: string;
  RETRO_DIFFUSION_API_KEY?: string;
};

type StudioRecord = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  provider: 'pixellab' | 'retro-diffusion';
  kind: StudioKind;
  name: string;
  prompt: string;
  width: number;
  height: number;
  transparent: boolean;
  seed: number;
  createdAt: string;
  stagedPath: string;
  approvedPath?: string;
  rejectedAt?: string;
  approvedAt?: string;
  providerMeta?: Record<string, unknown>;
};

type StudioKind =
  | 'battle-background'
  | 'room-background'
  | 'side-scroller-sky'
  | 'side-scroller-far'
  | 'side-scroller-mid'
  | 'side-scroller-ground'
  | 'creature-portrait'
  | 'creature-sheet'
  | 'move-effect'
  | 'card-layer';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
// RuneRealm-Assets is the authoring source of truth. `src/assets` is the
// application's runtime bundle, while Reality and RuneRealm-LUA are separate
// legacy submodules; presenting all three as one library made unrelated icons
// and documentation screenshots look like RuneRealm art.
const SCAN_ROOTS = ['RuneRealm-Assets'];
const OMIT_DIRS = new Set(['.git', 'node_modules', 'dist', '.cache']);

const mime: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

function sendJson(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function loopbackOnly(req: IncomingMessage, res: ServerResponse) {
  const raw = String(req.headers.host ?? '');
  const host = raw.startsWith('[')
    ? raw.slice(1, Math.max(1, raw.indexOf(']')))
    : raw.split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  sendJson(res, 403, { error: 'The asset studio is available only on localhost.' });
  return false;
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(part);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const posix = (file: string) => file.replaceAll('\\', '/');

function inside(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function categoryFor(rel: string) {
  const s = rel.toLowerCase();
  if (/\b(cards?|frame|level|nameplate)\b/.test(s)) return 'card';
  if (/\b(move|moves|effect|effects|attack|fx)\b/.test(s)) return 'move';
  if (/\b(background|scene|arena|room|path|map|parallax)\b/.test(s)) return 'background';
  if (/\b(monster|creature|portrait|sprite|animation|doge|dragon|llama)\b/.test(s)) return 'creature';
  if (/\b(item|berry|berries|gem|scroll|loot)\b/.test(s)) return 'item';
  if (s.startsWith('reality/') || s.startsWith('runerealm-lua/')) return 'legacy';
  return 'ui';
}

function scanAssets(root: string) {
  const rows: Array<Record<string, unknown>> = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && OMIT_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
        const rel = posix(path.relative(root, absolute));
        const parts = rel.split('/');
        const stat = fs.statSync(absolute);
        rows.push({
          id: rel,
          path: rel,
          name: entry.name,
          extension: path.extname(entry.name).slice(1).toLowerCase(),
          bytes: stat.size,
          source: parts[0],
          family: parts.slice(0, Math.min(parts.length - 1, 4)).join('/'),
          category: categoryFor(rel),
          url: `/__studio/file?path=${encodeURIComponent(rel)}`,
        });
      }
    }
  };
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel));
  return rows.sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function studioPaths(root: string) {
  const base = path.join(root, 'RuneRealm-Assets', '_studio');
  return {
    base,
    pending: path.join(base, 'pending'),
    rejected: path.join(base, 'rejected'),
    registry: path.join(base, 'registry.json'),
  };
}

function readRegistry(root: string): StudioRecord[] {
  const { registry } = studioPaths(root);
  if (!fs.existsSync(registry)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(registry, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRegistry(root: string, rows: StudioRecord[]) {
  const paths = studioPaths(root);
  fs.mkdirSync(paths.base, { recursive: true });
  fs.writeFileSync(paths.registry, `${JSON.stringify(rows, null, 2)}\n`);
}

function safeError(error: unknown, env: StudioEnv) {
  let message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === 'object') {
    const code = 'code' in cause ? String((cause as { code?: unknown }).code ?? '') : '';
    if (code) message += ` (${code})`;
  }
  for (const secret of [env.PIXELLAB_API_KEY, env.RETRO_DIFFUSION_API_KEY]) {
    if (secret) message = message.replaceAll(secret, '[secret]');
  }
  return message;
}

function slug(value: unknown) {
  const clean = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!clean) throw new Error('Give the asset a filename.');
  return clean;
}

function asInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function assertKind(value: unknown): StudioKind {
  const kinds: StudioKind[] = [
    'battle-background', 'room-background', 'side-scroller-sky',
    'side-scroller-far', 'side-scroller-mid', 'side-scroller-ground',
    'creature-portrait', 'creature-sheet', 'move-effect', 'card-layer',
  ];
  if (!kinds.includes(value as StudioKind)) throw new Error('Unknown asset kind.');
  return value as StudioKind;
}

function destination(root: string, record: StudioRecord) {
  const name = `${slug(record.name)}.png`;
  const layer = record.kind.replace('side-scroller-', '');
  const relative: Record<StudioKind, string> = {
    'battle-background': `RuneRealm-Assets/approved/scenes/arena/${name}`,
    'room-background': `RuneRealm-Assets/approved/scenes/room/${name}`,
    'side-scroller-sky': `RuneRealm-Assets/approved/scenes/path/${slug(record.name)}-${layer}.png`,
    'side-scroller-far': `RuneRealm-Assets/approved/scenes/path/${slug(record.name)}-${layer}.png`,
    'side-scroller-mid': `RuneRealm-Assets/approved/scenes/path/${slug(record.name)}-${layer}.png`,
    'side-scroller-ground': `RuneRealm-Assets/approved/scenes/path/${slug(record.name)}-${layer}.png`,
    'creature-portrait': `RuneRealm-Assets/approved/portraits/${name}`,
    'creature-sheet': `RuneRealm-Assets/approved/animation/${name}`,
    'move-effect': `RuneRealm-Assets/approved/effects/${name}`,
    'card-layer': `RuneRealm-Assets/approved/cards/${name}`,
  };
  return path.join(root, ...relative[record.kind].split('/'));
}

async function generate(
  env: StudioEnv,
  body: Record<string, unknown>,
): Promise<{ png: Buffer; meta: Record<string, unknown> }> {
  const provider = body.provider === 'retro-diffusion' ? 'retro-diffusion' : 'pixellab';
  const prompt = String(body.prompt ?? '').trim();
  if (prompt.length < 8) throw new Error('The prompt is too short.');
  if (prompt.length > 4000) throw new Error('The prompt is too long.');
  const transparent = body.transparent === true;
  const seed = asInt(body.seed, 7, 0, 2_147_483_647);
  const limit = provider === 'pixellab' ? 400 : 2048;
  const floor = provider === 'retro-diffusion' ? 64 : 16;
  const width = asInt(body.width, 384, floor, limit);
  const height = asInt(body.height, 216, floor, limit);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);

  try {
    if (provider === 'pixellab') {
      if (!env.PIXELLAB_API_KEY) throw new Error('PIXELLAB_API_KEY is not configured.');
      const response = await fetch('https://api.pixellab.ai/v1/generate-image-pixflux', {
        method: 'POST', signal: controller.signal,
        headers: {
          authorization: `Bearer ${env.PIXELLAB_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          description: prompt,
          image_size: { width, height },
          no_background: transparent,
          text_guidance_scale: Number(body.guidance) || 9,
          seed,
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) throw new Error(`PixelLab ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
      const encoded = data?.image?.base64;
      if (!encoded) throw new Error('PixelLab returned no image.');
      return {
        png: Buffer.from(encoded, 'base64'),
        meta: { usage: data.usage ?? null, model: 'pixflux' },
      };
    }

    if (!env.RETRO_DIFFUSION_API_KEY) throw new Error('RETRO_DIFFUSION_API_KEY is not configured.');
    const response = await fetch('https://api.retrodiffusion.ai/v1/inferences', {
      method: 'POST', signal: controller.signal,
      headers: {
        'x-rd-token': env.RETRO_DIFFUSION_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt, width, height, num_images: 1,
        prompt_style: 'rd_fast__default', remove_bg: transparent, seed,
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(`Retro Diffusion ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const encoded = data?.base64_images?.[0];
    if (!encoded) throw new Error('Retro Diffusion returned no image.');
    return {
      png: Buffer.from(encoded, 'base64'),
      meta: {
        model: data.model ?? 'rd_fast__default',
        creditCost: data.credit_cost ?? null,
        remainingBalance: data.remaining_balance ?? null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseMoves(root: string) {
  const source = fs.readFileSync(path.join(root, 'backend/native/constants.lua'), 'utf8');
  const start = source.indexOf('C.MOVE_POOLS = {');
  const end = source.indexOf('\n}\n\n-- Activities', start);
  const block = source.slice(start, end);
  const pools: Record<string, Array<Record<string, string | number>>> = {};
  let pool = '';
  for (const line of block.split(/\r?\n/)) {
    const heading = /^\s{2}([a-z]+)\s*=\s*{\s*$/.exec(line);
    if (heading) { pool = heading[1]; pools[pool] = []; continue; }
    const move = /^\s+\["([^"]+)"\]\s*=\s*{\s*(.+)\s*},?\s*$/.exec(line);
    if (!move || !pool) continue;
    const row: Record<string, string | number> = { name: move[1], pool };
    for (const field of move[2].split(',')) {
      const pair = /([a-z]+)\s*=\s*("[^"]*"|-?\d+(?:\.\d+)?)/.exec(field);
      if (pair) row[pair[1]] = pair[2].startsWith('"') ? pair[2].slice(1, -1) : Number(pair[2]);
    }
    pools[pool].push(row);
  }
  return Object.values(pools).flat();
}

export function studioPlugin(root: string, env: StudioEnv): Plugin {
  const workspace = path.resolve(root);

  return {
    name: 'rune-realm-local-asset-studio',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        if (!requestUrl.pathname.startsWith('/__studio/')) return next();
        if (!loopbackOnly(req, res)) return;

        try {
          if (req.method === 'GET' && requestUrl.pathname === '/__studio/status') {
            return sendJson(res, 200, {
              localOnly: true,
              pixelLab: Boolean(env.PIXELLAB_API_KEY),
              retroDiffusion: Boolean(env.RETRO_DIFFUSION_API_KEY),
            });
          }
          if (req.method === 'GET' && requestUrl.pathname === '/__studio/assets') {
            const assets = scanAssets(workspace);
            return sendJson(res, 200, { assets, total: assets.length });
          }
          if (req.method === 'GET' && requestUrl.pathname === '/__studio/game-data') {
            return sendJson(res, 200, { moves: parseMoves(workspace) });
          }
          if (req.method === 'GET' && requestUrl.pathname === '/__studio/jobs') {
            return sendJson(res, 200, { jobs: readRegistry(workspace) });
          }
          if (req.method === 'GET' && requestUrl.pathname === '/__studio/file') {
            const rel = requestUrl.searchParams.get('path') ?? '';
            const absolute = path.resolve(workspace, ...rel.split('/'));
            const ext = path.extname(absolute).toLowerCase();
            if (!inside(workspace, absolute) || !IMAGE_EXT.has(ext) || !fs.existsSync(absolute)) {
              return sendJson(res, 404, { error: 'Asset not found.' });
            }
            res.writeHead(200, {
              'content-type': mime[ext] ?? 'application/octet-stream',
              'cache-control': 'no-store',
            });
            fs.createReadStream(absolute).pipe(res);
            return;
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/generate') {
            const body = await jsonBody(req);
            const kind = assertKind(body.kind);
            const provider = body.provider === 'retro-diffusion' ? 'retro-diffusion' : 'pixellab';
            const name = slug(body.name);
            const prompt = String(body.prompt ?? '').trim();
            const transparent = body.transparent === true;
            const seed = asInt(body.seed, 7, 0, 2_147_483_647);
            const limit = provider === 'pixellab' ? 400 : 2048;
            const floor = provider === 'retro-diffusion' ? 64 : 16;
            const width = asInt(body.width, 384, floor, limit);
            const height = asInt(body.height, 216, floor, limit);
            const result = await generate(env, { ...body, provider, width, height, seed });
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            fs.mkdirSync(dir, { recursive: true });
            const staged = path.join(dir, 'asset.png');
            fs.writeFileSync(staged, result.png);
            const record: StudioRecord = {
              id, status: 'pending', provider, kind, name, prompt, width, height,
              transparent, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, staged)), providerMeta: result.meta,
            };
            const rows = readRegistry(workspace);
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, {
              job: record,
              url: `/__studio/file?path=${encodeURIComponent(record.stagedPath)}`,
            });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/approve') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const record = rows.find((row) => row.id === body.id);
            if (!record || record.status !== 'pending') return sendJson(res, 404, { error: 'Pending asset not found.' });
            const staged = path.resolve(workspace, ...record.stagedPath.split('/'));
            const dest = destination(workspace, record);
            if (!inside(workspace, staged) || !inside(workspace, dest) || !fs.existsSync(staged)) {
              return sendJson(res, 400, { error: 'The staged asset is invalid.' });
            }
            if (fs.existsSync(dest)) return sendJson(res, 409, { error: `Approval would overwrite ${posix(path.relative(workspace, dest))}. Choose another name.` });
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(staged, dest);
            record.status = 'approved';
            record.approvedAt = new Date().toISOString();
            record.approvedPath = posix(path.relative(workspace, dest));
            writeRegistry(workspace, rows);
            return sendJson(res, 200, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/reject') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const record = rows.find((row) => row.id === body.id);
            if (!record || record.status !== 'pending') return sendJson(res, 404, { error: 'Pending asset not found.' });
            const pendingDir = path.dirname(path.resolve(workspace, ...record.stagedPath.split('/')));
            const rejectedDir = path.join(studioPaths(workspace).rejected, record.id);
            if (!inside(workspace, pendingDir) || !fs.existsSync(pendingDir)) {
              return sendJson(res, 400, { error: 'The staged asset is invalid.' });
            }
            fs.mkdirSync(path.dirname(rejectedDir), { recursive: true });
            fs.renameSync(pendingDir, rejectedDir);
            record.status = 'rejected';
            record.rejectedAt = new Date().toISOString();
            record.stagedPath = posix(path.relative(workspace, path.join(rejectedDir, 'asset.png')));
            writeRegistry(workspace, rows);
            return sendJson(res, 200, { job: record });
          }
          return sendJson(res, 404, { error: 'Studio endpoint not found.' });
        } catch (error) {
          return sendJson(res, 500, { error: safeError(error, env) });
        }
      });
    },
  };
}
