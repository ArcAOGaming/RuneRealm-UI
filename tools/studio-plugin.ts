import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { decodePng, encodePng } from '../backend/native/card/png.mjs';

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
  sourcePath?: string;
  motionSourcePath?: string;
  rotationPaths?: Record<string, string>;
  framePaths?: string[];
  rawFramePaths?: string[];
  approvedPath?: string;
  approvedSourcePath?: string;
  approvedRotationPaths?: Record<string, string>;
  approvedFramePaths?: string[];
  rejectedAt?: string;
  approvedAt?: string;
  theme?: string;
  action?: string;
  motionKey?: string;
  sourceJobId?: string;
  templateSlots?: Record<string, string>;
  redoOf?: string;
  revision?: number;
  sourceWidth?: number;
  sourceHeight?: number;
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
  | 'creature-animation'
  | 'move-effect'
  | 'card-background'
  | 'card-layer';

const TEMPLATE_MOTION_KEYS = [
  'walk-right', 'walk-left', 'walk-up', 'walk-down',
  'attack-basic', 'attack-advanced',
] as const;

const MOTION_DIRECTIONS: Record<(typeof TEMPLATE_MOTION_KEYS)[number], 'east' | 'west' | 'north' | 'south'> = {
  'walk-right': 'east',
  'walk-left': 'west',
  'walk-up': 'north',
  'walk-down': 'south',
  'attack-basic': 'east',
  'attack-advanced': 'east',
};

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
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const rawOrigin = String(req.headers.origin ?? '');
  let originIsLoopback = true;
  if (rawOrigin) {
    try {
      const originHost = new URL(rawOrigin).hostname;
      originIsLoopback = originHost === 'localhost' || originHost === '127.0.0.1' || originHost === '::1';
    } catch {
      originIsLoopback = false;
    }
  }
  if (loopback && originIsLoopback) return true;
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
          folder: parts.slice(0, -1).join('/'),
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
    'creature-portrait', 'creature-sheet', 'creature-animation',
    'move-effect', 'card-background', 'card-layer',
  ];
  if (!kinds.includes(value as StudioKind)) throw new Error('Unknown asset kind.');
  return value as StudioKind;
}

function destination(root: string, record: StudioRecord) {
  const name = `${slug(record.name)}.png`;
  const layer = record.kind.replace('side-scroller-', '');
  const relative: Record<StudioKind, string> = {
    'battle-background': `RuneRealm-Assets/approved/scenes/arena/${name}`,
    'room-background': `RuneRealm-Assets/approved/scenes/home/${name}`,
    'side-scroller-sky': `RuneRealm-Assets/approved/scenes/quest/${slug(record.name)}/sky.png`,
    'side-scroller-far': `RuneRealm-Assets/approved/scenes/quest/${slug(record.name)}/far.png`,
    'side-scroller-mid': `RuneRealm-Assets/approved/scenes/quest/${slug(record.name)}/mid.png`,
    'side-scroller-ground': `RuneRealm-Assets/approved/scenes/quest/${slug(record.name)}/ground.png`,
    'creature-portrait': `RuneRealm-Assets/approved/portraits/${name}`,
    'creature-sheet': `RuneRealm-Assets/approved/animation/${name}`,
    'creature-animation': `RuneRealm-Assets/approved/animation/${slug(record.name)}/sheet.png`,
    'move-effect': `RuneRealm-Assets/approved/effects/${name}`,
    'card-background': `RuneRealm-Assets/approved/cards/backgrounds/${name}`,
    'card-layer': `RuneRealm-Assets/approved/cards/${name}`,
  };
  return path.join(root, ...relative[record.kind].split('/'));
}

function imageData(value: unknown) {
  const encoded = String(value ?? '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!encoded) throw new Error('The provider returned an empty image.');
  return Buffer.from(encoded, 'base64');
}

function nearestScale(png: Buffer, factor: number) {
  const source = decodePng(png);
  const width = source.width * factor;
  const height = source.height * factor;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / factor);
      const src = (sy * source.width + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = source.data[src];
      data[dst + 1] = source.data[src + 1];
      data[dst + 2] = source.data[src + 2];
      data[dst + 3] = source.data[src + 3];
    }
  }
  return Buffer.from(encodePng(data, width, height));
}

type AlphaStats = {
  transparentPct: number;
  partialPct: number;
  contentBbox: [number, number, number, number] | null;
};

function alphaStats(png: Buffer): AlphaStats {
  const source = decodePng(png);
  let transparent = 0;
  let partial = 0;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    if (alpha === 0) {
      transparent++;
      continue;
    }
    if (alpha < 255) partial++;
    const pixel = offset / 4;
    const x = pixel % source.width;
    const y = Math.floor(pixel / source.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const count = source.width * source.height;
  return {
    transparentPct: Number((transparent / count * 100).toFixed(1)),
    partialPct: Number((partial / count * 100).toFixed(1)),
    contentBbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
  };
}

/**
 * PixelLab occasionally returns a perfectly flat matte even when
 * `no_background` is requested. Remove only a dominant, edge-connected matte;
 * interior pixels with the same colour are deliberately preserved.
 */
function removeFlatEdgeMatte(png: Buffer) {
  const source = decodePng(png);
  const pixels = source.width * source.height;
  let alreadyTransparent = false;
  for (let offset = 3; offset < source.data.length; offset += 4) {
    if (source.data[offset] < 255) { alreadyTransparent = true; break; }
  }
  if (alreadyTransparent) return { png, removed: false, matteColor: undefined as string | undefined };

  const perimeter = new Map<string, number>();
  const sample = (x: number, y: number) => {
    const offset = (y * source.width + x) * 4;
    const key = `${source.data[offset]},${source.data[offset + 1]},${source.data[offset + 2]}`;
    perimeter.set(key, (perimeter.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < source.width; x++) { sample(x, 0); sample(x, source.height - 1); }
  for (let y = 1; y < source.height - 1; y++) { sample(0, y); sample(source.width - 1, y); }
  const dominant = [...perimeter.entries()].sort((a, b) => b[1] - a[1])[0];
  const perimeterCount = source.width * 2 + Math.max(0, source.height - 2) * 2;
  if (!dominant || dominant[1] / perimeterCount < 0.6) {
    return { png, removed: false, matteColor: undefined as string | undefined };
  }
  const matte = dominant[0].split(',').map(Number);
  const data = new Uint8Array(source.data);
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  let removed = 0;
  const thresholdSquared = 24 * 24;
  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const offset = pixel * 4;
    const dr = data[offset] - matte[0];
    const dg = data[offset + 1] - matte[1];
    const db = data[offset + 2] - matte[2];
    if (dr * dr + dg * dg + db * db > thresholdSquared) return;
    data[offset + 3] = 0;
    queue[tail++] = pixel;
    removed++;
  };
  for (let x = 0; x < source.width; x++) { visit(x); visit((source.height - 1) * source.width + x); }
  for (let y = 1; y < source.height - 1; y++) { visit(y * source.width); visit(y * source.width + source.width - 1); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % source.width;
    const y = Math.floor(pixel / source.width);
    if (x > 0) visit(pixel - 1);
    if (x + 1 < source.width) visit(pixel + 1);
    if (y > 0) visit(pixel - source.width);
    if (y + 1 < source.height) visit(pixel + source.width);
  }
  if (removed / pixels < 0.05) {
    return { png, removed: false, matteColor: undefined as string | undefined };
  }
  return {
    png: Buffer.from(encodePng(data, source.width, source.height)),
    removed: true,
    matteColor: dominant[0],
  };
}

function fitPortrait(png: Buffer, width = 320, height = 448) {
  const source = decodePng(png);
  const stats = alphaStats(png);
  if (!stats.contentBbox) throw new Error('The portrait has no visible pixels after background cleanup.');
  const [minX, minY, maxX, maxY] = stats.contentBbox;
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const scale = Math.min(248 / contentWidth, 280 / contentHeight, 2.25);
  const fittedWidth = Math.max(1, Math.round(contentWidth * scale));
  const fittedHeight = Math.max(1, Math.round(contentHeight * scale));
  const dx = Math.floor((width - fittedWidth) / 2);
  const dy = Math.max(12, 424 - fittedHeight);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < fittedHeight; y++) {
    const sy = minY + Math.min(contentHeight - 1, Math.floor(y * contentHeight / fittedHeight));
    for (let x = 0; x < fittedWidth; x++) {
      const sx = minX + Math.min(contentWidth - 1, Math.floor(x * contentWidth / fittedWidth));
      const src = (sy * source.width + sx) * 4;
      const dst = ((dy + y) * width + dx + x) * 4;
      data[dst] = source.data[src];
      data[dst + 1] = source.data[src + 1];
      data[dst + 2] = source.data[src + 2];
      data[dst + 3] = source.data[src + 3];
    }
  }
  const output = Buffer.from(encodePng(data, width, height));
  return { png: output, stats: alphaStats(output) };
}

function cropTopLeft(png: Buffer, width: number, height: number) {
  const source = decodePng(png);
  if (source.width < width || source.height < height) {
    throw new Error(`Source ${source.width}x${source.height} is smaller than the ${width}x${height} crop.`);
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = y * source.width * 4;
    const dst = y * width * 4;
    data.set(source.data.subarray(src, src + width * 4), dst);
  }
  return Buffer.from(encodePng(data, width, height));
}

function cropRegion(png: Buffer, x: number, y: number, width: number, height: number) {
  const source = decodePng(png);
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > source.width || y + height > source.height) {
    throw new Error(`Crop ${x},${y} ${width}x${height} is outside source ${source.width}x${source.height}.`);
  }
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const src = ((y + row) * source.width + x) * 4;
    const dst = row * width * 4;
    data.set(source.data.subarray(src, src + width * 4), dst);
  }
  return Buffer.from(encodePng(data, width, height));
}

function flattenOnWhite(png: Buffer) {
  const source = decodePng(png);
  const data = new Uint8Array(source.data.length);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3] / 255;
    data[offset] = Math.round(source.data[offset] * alpha + 255 * (1 - alpha));
    data[offset + 1] = Math.round(source.data[offset + 1] * alpha + 255 * (1 - alpha));
    data[offset + 2] = Math.round(source.data[offset + 2] * alpha + 255 * (1 - alpha));
    data[offset + 3] = 255;
  }
  return Buffer.from(encodePng(data, source.width, source.height));
}

const RETRO_ROTATION_DIRECTIONS = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
] as const;

function retroRotationFrames(png: Buffer, cellSize = 80) {
  const source = decodePng(png);
  if (source.width % cellSize || source.height % cellSize) {
    throw new Error(`Retro Diffusion returned a ${source.width}x${source.height} rotation sheet that is not aligned to ${cellSize}px cells.`);
  }
  const columns = source.width / cellSize;
  const rows = source.height / cellSize;
  // The current provider format is a clockwise 3x3 compass with its center
  // intentionally blank. Normalize it to south -> clockwise so the rest of
  // the studio never mistakes that blank cell for a character frame.
  const positions = columns === 3 && rows === 3
    ? [[1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]
    : Array.from({ length: 8 }, (_, index) => [index % columns, Math.floor(index / columns)]);
  if (positions.some(([, y]) => y >= rows)) {
    throw new Error(`Retro Diffusion returned only ${columns * rows} rotation cells; expected 8.`);
  }
  const frames = positions.map(([x, y]) => (
    removeFlatEdgeMatte(cropRegion(png, x * cellSize, y * cellSize, cellSize, cellSize)).png
  ));
  return { frames, columns, rows, layout: columns === 3 && rows === 3 ? '3x3-compass' : 'row-major' };
}

function animationStrip(frames: Buffer[]) {
  const images = frames.map((frame) => decodePng(frame));
  const width = Math.max(...images.map((frame) => frame.width));
  const height = Math.max(...images.map((frame) => frame.height));
  const data = new Uint8Array(width * images.length * height * 4);
  images.forEach((frame, index) => {
    const ox = index * width + Math.floor((width - frame.width) / 2);
    const oy = height - frame.height;
    for (let y = 0; y < frame.height; y++) {
      const src = y * frame.width * 4;
      const dst = ((y + oy) * width * images.length + ox) * 4;
      data.set(frame.data.subarray(src, src + frame.width * 4), dst);
    }
  });
  return Buffer.from(encodePng(data, width * images.length, height));
}

function templateSheet(slotFrames: Buffer[][], cell = 64) {
  const columns = 4;
  const rows = TEMPLATE_MOTION_KEYS.length;
  const data = new Uint8Array(cell * columns * cell * rows * 4);
  slotFrames.forEach((frames, row) => {
    if (frames.length < columns) throw new Error(`${TEMPLATE_MOTION_KEYS[row]} needs at least four frames.`);
    const indexes = [0, 1, 2, 3].map((step) => Math.round(step * (frames.length - 1) / 3));
    const images = indexes.map((index) => decodePng(frames[index]));
    const width = images[0].width;
    const height = images[0].height;
    if (images.some((image) => image.width !== width || image.height !== height)) {
      throw new Error(`${TEMPLATE_MOTION_KEYS[row]} frames do not share one canvas size.`);
    }
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (const image of images) {
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] === 0) continue;
        const pixel = offset / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) throw new Error(`${TEMPLATE_MOTION_KEYS[row]} has no visible pixels.`);
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const inset = Math.max(3, Math.round(cell * 0.047));
    const scale = Math.min((cell - inset * 2) / contentWidth, (cell - inset * 2) / contentHeight);
    const fittedWidth = Math.max(1, Math.round(contentWidth * scale));
    const fittedHeight = Math.max(1, Math.round(contentHeight * scale));
    const dx = Math.floor((cell - fittedWidth) / 2);
    const dy = cell - inset - fittedHeight;
    images.forEach((image, column) => {
      for (let y = 0; y < fittedHeight; y++) {
        const sy = minY + Math.min(contentHeight - 1, Math.floor(y * contentHeight / fittedHeight));
        for (let x = 0; x < fittedWidth; x++) {
          const sx = minX + Math.min(contentWidth - 1, Math.floor(x * contentWidth / fittedWidth));
          const src = (sy * width + sx) * 4;
          const targetWidth = cell * columns;
          const dstX = column * cell + dx + x;
          const dstY = row * cell + dy + y;
          const dst = (dstY * targetWidth + dstX) * 4;
          data[dst] = image.data[src];
          data[dst + 1] = image.data[src + 1];
          data[dst + 2] = image.data[src + 2];
          data[dst + 3] = image.data[src + 3];
        }
      }
    });
  });
  return Buffer.from(encodePng(data, cell * columns, cell * rows));
}

function prepareStill(kind: StudioKind, png: Buffer, transparent = false) {
  const source = decodePng(png);
  if (kind === 'card-background') {
    if (source.width !== 216 || (source.height !== 355 && source.height !== 356)) {
      throw new Error(`Card backgrounds must be generated at 216x355 or PixelLab-compatible 216x356; received ${source.width}x${source.height}.`);
    }
    const normalized = source.height === 356 ? cropTopLeft(png, 216, 355) : png;
    return { png: nearestScale(normalized, 3), width: 648, height: 1065 };
  }
  if (kind === 'creature-portrait') {
    const cleaned = transparent ? removeFlatEdgeMatte(png) : { png, removed: false, matteColor: undefined };
    const fitted = fitPortrait(cleaned.png, 320, 448);
    const sourceStats = alphaStats(cleaned.png);
    return {
      png: fitted.png,
      motionPng: cleaned.png,
      width: 320,
      height: 448,
      processing: {
        matteRemoved: cleaned.removed,
        matteColor: cleaned.matteColor ?? null,
        sourceTransparentPct: sourceStats.transparentPct,
        sourcePartialAlphaPct: sourceStats.partialPct,
        sourceContentBbox: sourceStats.contentBbox,
        fittedContentBbox: fitted.stats.contentBbox,
      },
    };
  }
  return { png, width: source.width, height: source.height };
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function pixelLabRequest(env: StudioEnv, endpoint: string, init?: RequestInit) {
  if (!env.PIXELLAB_API_KEY) throw new Error('PIXELLAB_API_KEY is not configured.');
  const response = await fetch(`https://api.pixellab.ai/v2${endpoint}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.PIXELLAB_API_KEY}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const value = await response.json() as any;
  if (!response.ok) {
    throw new Error(`PixelLab ${endpoint} ${response.status}: ${JSON.stringify(value).slice(0, 500)}`);
  }
  return value;
}

async function waitForPixelLabJob(env: StudioEnv, jobId: string) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (attempt) await wait(3_000);
    const job = await pixelLabRequest(env, `/background-jobs/${encodeURIComponent(jobId)}`);
    if (job?.status === 'failed') {
      throw new Error(`PixelLab job failed: ${JSON.stringify(job?.last_response ?? job).slice(0, 500)}`);
    }
    if (job?.status === 'completed') return job;
  }
  throw new Error('PixelLab background job timed out.');
}

async function downloadPixelLabPng(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PixelLab image download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  try {
    decodePng(buffer);
  } catch {
    throw new Error('PixelLab returned a managed sprite in a non-PNG format.');
  }
  return buffer;
}

async function waitForCharacterDetail(env: StudioEnv, characterId: string, ready: (detail: any) => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (attempt) await wait(1_000);
    const detail = await pixelLabRequest(env, `/characters/${encodeURIComponent(characterId)}`);
    if (detail?.status === 'failed') throw new Error('PixelLab managed character failed.');
    if (ready(detail)) return detail;
  }
  throw new Error('PixelLab finished processing but its managed character files are not ready.');
}

async function createManagedCharacter(
  env: StudioEnv,
  description: string,
  name: string,
  nativeSize: number,
  seed: number,
  templateId: string,
) {
  const accepted = await pixelLabRequest(env, '/create-character-v3', {
    method: 'POST',
    body: JSON.stringify({
      description,
      name,
      image_size: { width: nativeSize, height: nativeSize },
      view: 'low top-down',
      template_id: templateId,
      seed,
      no_background: true,
      outline: 'single color black outline',
      detail: 'medium detail',
      enhance_prompt: false,
    }),
  });
  const jobId = String(accepted?.background_job_id ?? '');
  const characterId = String(accepted?.character_id ?? '');
  if (!jobId || !characterId) throw new Error('PixelLab returned no managed character identifiers.');
  const completed = await waitForPixelLabJob(env, jobId);
  const detail = await waitForCharacterDetail(env, characterId, (value) => {
    const rotations = value?.rotation_urls ?? {};
    return ['south', 'east', 'north', 'west'].every((direction) => typeof rotations[direction] === 'string');
  });
  const urls = detail.rotation_urls as Record<string, string | null>;
  const entries = await Promise.all(Object.entries(urls).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string' && entry[1].length > 0
  )).map(async ([direction, url]) => [direction, await downloadPixelLabPng(url)] as const));
  return {
    rotations: Object.fromEntries(entries) as Record<string, Buffer>,
    meta: {
      model: 'create-character-v3', backgroundJobId: jobId, characterId,
      usage: completed?.usage ?? accepted?.usage ?? null,
      nativeSpriteSize: nativeSize, templateId, view: 'low top-down',
      managedDirectionalRig: true,
    },
  };
}

async function animateManagedCharacter(
  env: StudioEnv,
  characterId: string,
  name: string,
  motionKey: (typeof TEMPLATE_MOTION_KEYS)[number],
  action: string,
  frameCount: number,
  seed: number,
  recoverOnly = false,
) {
  const direction = MOTION_DIRECTIONS[motionKey];
  const walkTemplate = motionKey.startsWith('walk-');
  const expectedFrames = walkTemplate ? 4 : frameCount;
  const safeSlug = (value: unknown) => {
    const text = String(value ?? '').trim();
    return text ? slug(text) : '';
  };
  const remotePrefix = `${slug(name)}-${seed}-`;
  const groupMatches = (group: any, exactName?: string) => {
    const names = [safeSlug(group?.display_name), safeSlug(group?.animation_type)];
    const templateMatches = walkTemplate && [
      group?.animation_type, group?.template_animation_id, group?.template_id,
    ].some((value) => safeSlug(value) === 'walk-4-frames');
    const nameMatches = templateMatches || (exactName
      ? names.includes(safeSlug(exactName))
      : names.some((candidate) => candidate.startsWith(remotePrefix)));
    return nameMatches && group?.directions?.some((entry: any) => (
      entry?.direction === direction && Array.isArray(entry?.frames)
      && entry.frames.length >= expectedFrames
    ));
  };

  // Recover a provider-complete group if local staging previously failed after submission.
  let detail = await pixelLabRequest(env, `/characters/${encodeURIComponent(characterId)}`);
  let group = (Array.isArray(detail?.animations) ? detail.animations : []).find((candidate: any) => groupMatches(candidate));
  let remoteName = String(group?.display_name ?? group?.animation_type ?? '');
  let jobId = '';
  let completed: any = null;
  let accepted: any = null;
  const recoveredProviderResult = Boolean(group);

  if (!group) {
    if (recoverOnly) {
      throw new Error(`PixelLab has not published the completed ${direction} frames yet. No new generation was submitted.`);
    }
    remoteName = `${name}-${seed}-${crypto.randomBytes(3).toString('hex')}`;
    accepted = await pixelLabRequest(env, '/characters/animations', {
      method: 'POST',
      body: JSON.stringify(walkTemplate ? {
        character_id: characterId,
        animation_name: remoteName,
        template_animation_id: 'walk-4-frames',
        directions: [direction],
      } : {
        character_id: characterId,
        animation_name: remoteName,
        action_description: action,
        mode: 'v3',
        frame_count: frameCount,
        keep_first_frame: false,
        directions: [direction],
        seed,
        enhance_prompt: false,
      }),
    });
    jobId = String(accepted?.background_job_ids?.[0] ?? '');
    if (!jobId) throw new Error('PixelLab returned no managed animation job id.');
    completed = await waitForPixelLabJob(env, jobId);
    detail = await waitForCharacterDetail(env, characterId, (value) => {
      const groups = Array.isArray(value?.animations) ? value.animations : [];
      return groups.some((candidate: any) => groupMatches(candidate, remoteName));
    });
    group = detail.animations.find((candidate: any) => groupMatches(candidate, remoteName));
  }

  const directionRow = group?.directions?.find((entry: any) => entry?.direction === direction);
  const urls = Array.isArray(directionRow?.frames) ? directionRow.frames.slice(0, expectedFrames) : [];
  if (urls.length < expectedFrames) throw new Error(`PixelLab stored fewer than ${expectedFrames} ${direction} frames.`);
  const frames = await Promise.all(urls.map((url: string) => downloadPixelLabPng(url)));
  return {
    frames,
    meta: {
      model: walkTemplate ? 'managed-character-walk-template' : 'managed-character-animation-v3',
      backgroundJobId: jobId, characterId, remoteAnimationName: remoteName,
      templateAnimationId: walkTemplate ? 'walk-4-frames' : null,
      animationGroupId: group?.animation_group_id ?? null, direction,
      requestedFrameCount: expectedFrames,
      recoveredProviderResult,
      usage: completed?.usage ?? accepted?.usage ?? null,
    },
  };
}

async function animateCreature(
  env: StudioEnv,
  firstFrame: Buffer,
  action: string,
  frameCount: number,
  seed: number,
) {
  if (!env.PIXELLAB_API_KEY) throw new Error('PIXELLAB_API_KEY is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8 * 60_000);
  try {
    const submitted = await fetch('https://api.pixellab.ai/v2/animate-with-text-v3', {
      method: 'POST', signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.PIXELLAB_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action,
        first_frame: { type: 'base64', base64: firstFrame.toString('base64') },
        frame_count: frameCount,
        no_background: true,
        enhance_prompt: true,
        seed,
      }),
    });
    const accepted = await submitted.json() as any;
    if (!submitted.ok) {
      throw new Error(`PixelLab animation ${submitted.status}: ${JSON.stringify(accepted).slice(0, 400)}`);
    }
    const jobId = accepted?.background_job_id;
    if (!jobId) throw new Error('PixelLab returned no animation job id.');

    for (let attempt = 0; attempt < 160; attempt++) {
      if (attempt) await wait(3_000);
      const response = await fetch(`https://api.pixellab.ai/v2/background-jobs/${encodeURIComponent(jobId)}`, {
        signal: controller.signal,
        headers: { authorization: `Bearer ${env.PIXELLAB_API_KEY}` },
      });
      const job = await response.json() as any;
      if (!response.ok) {
        throw new Error(`PixelLab job ${response.status}: ${JSON.stringify(job).slice(0, 400)}`);
      }
      if (job?.status === 'failed') {
        throw new Error(`PixelLab animation failed: ${JSON.stringify(job?.last_response ?? job).slice(0, 400)}`);
      }
      if (job?.status === 'completed') {
        const output = job?.last_response ?? job?.result ?? {};
        const images = Array.isArray(output?.images) ? output.images : [];
        const frames = images.map((entry: any) => imageData(entry?.base64 ?? entry));
        if (!frames.length) throw new Error('PixelLab completed the job without animation frames.');
        return { frames, meta: { model: 'animate-with-text-v3', backgroundJobId: jobId, usage: output?.usage ?? job?.usage ?? null } };
      }
    }
    throw new Error('PixelLab animation timed out.');
  } finally {
    clearTimeout(timer);
  }
}

async function retroDiffusionImage(result: any, signal: AbortSignal) {
  const encoded = Array.isArray(result?.base64_images) ? result.base64_images[0] : undefined;
  if (encoded) return imageData(encoded);
  const url = Array.isArray(result?.output_urls) ? result.output_urls[0] : undefined;
  if (!url) throw new Error('Retro Diffusion completed without an image or download URL.');
  const response = await fetch(String(url), { signal });
  if (!response.ok) throw new Error(`Retro Diffusion output download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateRetroPromptAnimation(
  env: StudioEnv,
  prompt: string,
  seed: number,
  promptStyle: string,
  size: number,
  referenceImages: string[] = [],
  inputImage?: string,
  framesDuration?: number,
) {
  if (!env.RETRO_DIFFUSION_API_KEY) throw new Error('RETRO_DIFFUSION_API_KEY is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const submitted = await fetch('https://api.retrodiffusion.ai/v1/inferences', {
      method: 'POST', signal: controller.signal,
      headers: {
        'x-rd-token': env.RETRO_DIFFUSION_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        prompt_style: promptStyle,
        width: size,
        height: size,
        num_images: 1,
        seed,
        return_spritesheet: true,
        upscale_output_factor: 1,
        bypass_prompt_expansion: true,
        ...(referenceImages.length ? { reference_images: referenceImages } : {}),
        ...(inputImage ? { input_image: inputImage } : {}),
        ...(framesDuration ? { frames_duration: framesDuration } : {}),
        async: true,
      }),
    });
    const accepted = await submitted.json() as any;
    if (!submitted.ok) {
      throw new Error(`Retro Diffusion ${promptStyle} ${submitted.status}: ${JSON.stringify(accepted).slice(0, 500)}`);
    }
    const taskId = String(accepted?.task_id ?? '');
    if (!taskId) {
      const png = await retroDiffusionImage(accepted, controller.signal);
      decodePng(png);
      return { png, meta: accepted };
    }

    for (let attempt = 0; attempt < 240; attempt++) {
      if (attempt) await wait(2_000);
      const response = await fetch(`https://api.retrodiffusion.ai/v1/inferences/tasks/${encodeURIComponent(taskId)}`, {
        signal: controller.signal,
        headers: { 'x-rd-token': env.RETRO_DIFFUSION_API_KEY },
      });
      const task = await response.json() as any;
      if (!response.ok) {
        throw new Error(`Retro Diffusion task ${response.status}: ${JSON.stringify(task).slice(0, 500)}`);
      }
      if (task?.status === 'failed') {
        throw new Error(`Retro Diffusion ${promptStyle} failed: ${JSON.stringify(task?.error ?? task).slice(0, 500)}`);
      }
      if (task?.status === 'succeeded') {
        const result = task.result ?? task;
        const png = await retroDiffusionImage(result, controller.signal);
        decodePng(png);
        return {
          png,
          meta: {
            model: result?.model ?? 'rd_animation',
            promptStyle,
            taskId,
            balanceCost: result?.balance_cost ?? null,
            remainingBalance: result?.remaining_balance ?? null,
          },
        };
      }
    }
    throw new Error(`Retro Diffusion ${promptStyle} job timed out. Use the same seed to recover it before submitting again.`);
  } finally {
    clearTimeout(timer);
  }
}

const generateRetroBattleSprites = (env: StudioEnv, prompt: string, seed: number) => (
  generateRetroPromptAnimation(env, prompt, seed, 'rd_animation__battle_sprites', 64)
);

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
  const limit = provider === 'pixellab' ? 400 : 384;
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
        png: imageData(encoded),
        meta: { usage: data.usage ?? null, model: 'pixflux' },
      };
    }

    if (!env.RETRO_DIFFUSION_API_KEY) throw new Error('RETRO_DIFFUSION_API_KEY is not configured.');
    const requestedRetroStyle = String(body.promptStyle ?? 'rd_fast__default');
    const retroStyle = ['rd_fast__default', 'rd_pro__simple'].includes(requestedRetroStyle)
      ? requestedRetroStyle : 'rd_fast__default';
    const response = await fetch('https://api.retrodiffusion.ai/v1/inferences', {
      method: 'POST', signal: controller.signal,
      headers: {
        'x-rd-token': env.RETRO_DIFFUSION_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt, width, height, num_images: 1,
        prompt_style: retroStyle, remove_bg: transparent, seed,
        upscale_output_factor: 1,
        bypass_prompt_expansion: retroStyle === 'rd_pro__simple',
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(`Retro Diffusion ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const png = await retroDiffusionImage(data, controller.signal);
    decodePng(png);
    return {
      png,
      meta: {
        model: data.model ?? retroStyle,
        promptStyle: retroStyle,
        balanceCost: data.balance_cost ?? null,
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
            if (kind === 'creature-animation') {
              return sendJson(res, 400, { error: 'Create animation from an approved creature draft.' });
            }
            const provider = body.provider === 'retro-diffusion' ? 'retro-diffusion' : 'pixellab';
            const name = slug(body.name);
            const prompt = String(body.prompt ?? '').trim();
            const transparent = body.transparent === true;
            const seed = asInt(body.seed, 7, 0, 2_147_483_647);
            const limit = provider === 'pixellab' ? 400 : 384;
            const floor = provider === 'retro-diffusion' ? 64 : 16;
            const width = asInt(body.width, 384, floor, limit);
            const height = asInt(body.height, 216, floor, limit);
            const cardHeight = provider === 'pixellab' ? 356 : 355;
            if (kind === 'card-background' && (width !== 216 || height !== cardHeight)) {
              return sendJson(res, 400, { error: `Card-background source size for ${provider} is fixed at 216x${cardHeight}; it is normalized locally to 216x355 and scaled exactly to 648x1065.` });
            }
            if (kind === 'creature-portrait' && (width > 256 || height > 256)) {
              return sendJson(res, 400, { error: 'Creature sources must be at most 256x256 so PixelLab motion v3 can animate them.' });
            }
            const duplicate = readRegistry(workspace).find((row) => (
              row.status !== 'rejected'
              && row.provider === provider && row.kind === kind && row.name === name
              && row.seed === seed && row.prompt === prompt
              && row.sourceWidth === width && row.sourceHeight === height
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact request is already ${duplicate.status}: ${duplicate.id}. Change the seed, prompt, or filename before spending another provider credit.`,
              });
            }
            const result = await generate(env, { ...body, provider, width, height, seed });
            const prepared = prepareStill(kind, result.png, transparent);
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            fs.mkdirSync(dir, { recursive: true });
            const staged = path.join(dir, 'asset.png');
            const source = path.join(dir, 'source.png');
            fs.writeFileSync(source, result.png);
            fs.writeFileSync(staged, prepared.png);
            const motionSource = 'motionPng' in prepared && prepared.motionPng
              ? path.join(dir, 'motion-source.png') : undefined;
            if (motionSource && 'motionPng' in prepared && prepared.motionPng) {
              fs.writeFileSync(motionSource, prepared.motionPng);
            }
            const theme = String(body.theme ?? '').trim().slice(0, 40) || undefined;
            const redoOf = String(body.redoOf ?? '').trim() || undefined;
            const record: StudioRecord = {
              id, status: 'pending', provider, kind, name, prompt,
              width: prepared.width, height: prepared.height,
              sourceWidth: width, sourceHeight: height,
              transparent, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, staged)),
              sourcePath: posix(path.relative(workspace, source)),
              motionSourcePath: motionSource ? posix(path.relative(workspace, motionSource)) : undefined,
              theme, redoOf,
              revision: asInt(body.revision, redoOf ? 2 : 1, 1, 999),
              providerMeta: {
                ...result.meta,
                ...('processing' in prepared ? prepared.processing : {}),
              },
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
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/reprocess') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const record = rows.find((row) => row.id === body.id);
            if (!record || record.status !== 'pending' || record.kind !== 'creature-portrait') {
              return sendJson(res, 404, { error: 'Pending creature portrait not found.' });
            }
            const source = path.resolve(workspace, ...String(record.sourcePath ?? '').split('/'));
            const staged = path.resolve(workspace, ...record.stagedPath.split('/'));
            if (!inside(workspace, source) || !inside(workspace, staged) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: 'The portrait source image is unavailable.' });
            }
            const prepared = prepareStill(record.kind, fs.readFileSync(source), record.transparent);
            fs.writeFileSync(staged, prepared.png);
            if ('motionPng' in prepared && prepared.motionPng) {
              const motionSource = path.join(path.dirname(staged), 'motion-source.png');
              fs.writeFileSync(motionSource, prepared.motionPng);
              record.motionSourcePath = posix(path.relative(workspace, motionSource));
            }
            record.width = prepared.width;
            record.height = prepared.height;
            record.providerMeta = {
              ...(record.providerMeta ?? {}),
              ...('processing' in prepared ? prepared.processing : {}),
              locallyReprocessedAt: new Date().toISOString(),
            };
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(path.dirname(staged), 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 200, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/create-retro-anchor') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const name = slug(body.name ?? 'new-retro-monster-anchor');
            const theme = String(body.theme ?? '').trim().slice(0, 40) || undefined;
            const prompt = String(body.prompt ?? '').trim();
            const seed = asInt(body.seed, 7, 0, 2_147_483_647);
            if (prompt.length < 20 || prompt.length > 2_000) {
              return sendJson(res, 400, { error: 'Describe the RetroDiffusion monster in 20 to 2,000 characters.' });
            }
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.provider === 'retro-diffusion'
              && row.kind === 'creature-portrait' && row.name === name
              && row.prompt === prompt && row.seed === seed
              && row.providerMeta?.retroNativeAnchor === true
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact RetroDiffusion anchor is already ${duplicate.status}: ${duplicate.id}. Change its seed, prompt, or name before spending again.`,
              });
            }
            const generated = await generate(env, {
              provider: 'retro-diffusion', prompt, width: 64, height: 64,
              transparent: true, seed, promptStyle: 'rd_pro__simple',
            });
            const cleaned = removeFlatEdgeMatte(generated.png);
            const image = decodePng(cleaned.png);
            if (image.width !== 64 || image.height !== 64) {
              throw new Error(`Retro Diffusion returned ${image.width}x${image.height}; expected a native 64x64 anchor.`);
            }
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            fs.mkdirSync(dir, { recursive: true });
            const asset = path.join(dir, 'asset.png');
            const source = path.join(dir, 'source.png');
            const cardPreview = path.join(dir, 'card-preview.png');
            fs.writeFileSync(asset, cleaned.png);
            fs.writeFileSync(source, cleaned.png);
            fs.writeFileSync(cardPreview, fitPortrait(cleaned.png, 320, 448).png);
            const stats = alphaStats(cleaned.png);
            const record: StudioRecord = {
              id, status: 'pending', provider: 'retro-diffusion', kind: 'creature-portrait',
              name, prompt, width: 64, height: 64, sourceWidth: 64, sourceHeight: 64,
              transparent: true, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, asset)),
              sourcePath: posix(path.relative(workspace, source)),
              motionSourcePath: posix(path.relative(workspace, source)),
              theme, revision: 1,
              providerMeta: {
                ...generated.meta,
                retroNativeAnchor: true,
                nativeSpriteSize: 64,
                sourceTransparentPct: stats.transparentPct,
                sourcePartialAlphaPct: stats.partialPct,
                sourceContentBbox: stats.contentBbox,
                matteRemoved: cleaned.removed,
                cardPreviewPath: posix(path.relative(workspace, cardPreview)),
              },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/create-retro-rotation') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const sourceJobId = String(body.sourceJobId ?? '');
            const portrait = rows.find((row) => (
              row.id === sourceJobId && row.kind === 'creature-portrait'
              && row.status !== 'rejected' && row.providerMeta?.retroNativeAnchor === true
            ));
            if (!portrait) return sendJson(res, 404, { error: 'RetroDiffusion native anchor not found.' });
            const seed = asInt(body.seed, portrait.seed + 100, 0, 2_147_483_647);
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.kind === 'creature-sheet'
              && row.sourceJobId === portrait.id && row.seed === seed
              && row.providerMeta?.retroRotationSheet === true
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact RetroDiffusion rotation is already ${duplicate.status}: ${duplicate.id}. Change its seed before spending again.`,
              });
            }
            const sourceRel = portrait.status === 'approved' && portrait.approvedSourcePath
              ? portrait.approvedSourcePath : portrait.sourcePath ?? portrait.stagedPath;
            const source = path.resolve(workspace, ...sourceRel.split('/'));
            if (!inside(workspace, source) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: 'The RetroDiffusion anchor source is unavailable.' });
            }
            const reference = flattenOnWhite(fs.readFileSync(source)).toString('base64');
            const generated = await generateRetroPromptAnimation(
              env, portrait.prompt, seed, 'rd_animation__8_dir_rotation', 80, [reference],
            );
            const sheetImage = decodePng(generated.png);
            const cellSize = 80;
            const rotation = retroRotationFrames(generated.png, cellSize);
            const frames = rotation.frames;
            const name = `${portrait.name}-8-direction-rotation`;
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            const frameDir = path.join(dir, 'frames');
            fs.mkdirSync(frameDir, { recursive: true });
            const asset = path.join(dir, 'asset.png');
            const sourceSheet = path.join(dir, 'source.png');
            fs.writeFileSync(asset, generated.png);
            fs.writeFileSync(sourceSheet, generated.png);
            const framePaths = frames.map((frame, index) => {
              const file = path.join(frameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame);
              return posix(path.relative(workspace, file));
            });
            const portraitAsset = path.resolve(workspace, ...portrait.stagedPath.split('/'));
            const portraitRotationDir = path.join(path.dirname(portraitAsset), 'rotations');
            fs.mkdirSync(portraitRotationDir, { recursive: true });
            portrait.rotationPaths = Object.fromEntries(RETRO_ROTATION_DIRECTIONS.map((direction, index) => {
              const file = path.join(portraitRotationDir, `${direction}.png`);
              fs.writeFileSync(file, frames[index]);
              return [direction, posix(path.relative(workspace, file))];
            }));
            portrait.providerMeta = {
              ...(portrait.providerMeta ?? {}),
              retroRotationSourceJobId: id,
              rigDirections: [...RETRO_ROTATION_DIRECTIONS],
              rotationSpriteSize: cellSize,
              rotationLayout: rotation.layout,
            };
            const record: StudioRecord = {
              id, status: 'pending', provider: 'retro-diffusion', kind: 'creature-sheet',
              name, prompt: portrait.prompt, width: sheetImage.width, height: sheetImage.height,
              sourceWidth: sheetImage.width, sourceHeight: sheetImage.height,
              transparent: true, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, asset)),
              sourcePath: posix(path.relative(workspace, sourceSheet)),
              framePaths, sourceJobId: portrait.id, theme: portrait.theme, revision: 1,
              providerMeta: {
                ...generated.meta,
                retroRotationSheet: true,
                referenceSourceJobId: portrait.id,
                nativeSpriteSize: cellSize,
                frameCount: 8,
                gridColumns: rotation.columns,
                gridRows: rotation.rows,
                rotationLayout: rotation.layout,
              },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(path.dirname(portraitAsset), 'request.json'), `${JSON.stringify(portrait, null, 2)}\n`);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/reprocess-retro-anchor') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const record = rows.find((row) => (
              row.id === body.id && row.status === 'pending'
              && row.kind === 'creature-portrait' && row.providerMeta?.retroNativeAnchor === true
            ));
            if (!record) return sendJson(res, 404, { error: 'Pending RetroDiffusion native anchor not found.' });
            const source = path.resolve(workspace, ...String(record.sourcePath ?? record.stagedPath).split('/'));
            const staged = path.resolve(workspace, ...record.stagedPath.split('/'));
            if (!inside(workspace, source) || !inside(workspace, staged) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: 'The native anchor source is unavailable.' });
            }
            const sourcePng = fs.readFileSync(source);
            const image = decodePng(sourcePng);
            if (image.width !== 64 || image.height !== 64) {
              return sendJson(res, 400, { error: `Native anchor must remain 64x64; received ${image.width}x${image.height}.` });
            }
            const cardPreview = path.join(path.dirname(staged), 'card-preview.png');
            fs.writeFileSync(cardPreview, fitPortrait(sourcePng, 320, 448).png);
            record.providerMeta = {
              ...(record.providerMeta ?? {}),
              cardPreviewPath: posix(path.relative(workspace, cardPreview)),
              locallyReprocessedAt: new Date().toISOString(),
            };
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(path.dirname(staged), 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 200, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/reprocess-retro-rotation') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const record = rows.find((row) => (
              row.id === body.id && row.status === 'pending'
              && row.kind === 'creature-sheet' && row.providerMeta?.retroRotationSheet === true
            ));
            if (!record) return sendJson(res, 404, { error: 'Pending RetroDiffusion rotation sheet not found.' });
            const portrait = rows.find((row) => row.id === record.sourceJobId && row.kind === 'creature-portrait' && row.status !== 'rejected');
            if (!portrait) return sendJson(res, 404, { error: 'The rotation sheet parent anchor is unavailable.' });
            const source = path.resolve(workspace, ...String(record.sourcePath ?? record.stagedPath).split('/'));
            if (!inside(workspace, source) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: 'The provider rotation sheet is unavailable.' });
            }
            const sheet = fs.readFileSync(source);
            const rotation = retroRotationFrames(sheet, 80);
            const staged = path.resolve(workspace, ...record.stagedPath.split('/'));
            const frameDir = path.join(path.dirname(staged), 'frames');
            fs.mkdirSync(frameDir, { recursive: true });
            record.framePaths = rotation.frames.map((frame, index) => {
              const file = path.join(frameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame);
              return posix(path.relative(workspace, file));
            });
            record.providerMeta = {
              ...(record.providerMeta ?? {}),
              gridColumns: rotation.columns,
              gridRows: rotation.rows,
              rotationLayout: rotation.layout,
              locallyReprocessedAt: new Date().toISOString(),
            };
            const portraitAsset = path.resolve(workspace, ...portrait.stagedPath.split('/'));
            const portraitRotationDir = path.join(path.dirname(portraitAsset), 'rotations');
            fs.mkdirSync(portraitRotationDir, { recursive: true });
            portrait.rotationPaths = Object.fromEntries(RETRO_ROTATION_DIRECTIONS.map((direction, index) => {
              const file = path.join(portraitRotationDir, `${direction}.png`);
              fs.writeFileSync(file, rotation.frames[index]);
              return [direction, posix(path.relative(workspace, file))];
            }));
            portrait.providerMeta = {
              ...(portrait.providerMeta ?? {}),
              retroRotationSourceJobId: record.id,
              rigDirections: [...RETRO_ROTATION_DIRECTIONS],
              rotationSpriteSize: 80,
              rotationLayout: rotation.layout,
            };
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(path.dirname(staged), 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            fs.writeFileSync(path.join(path.dirname(portraitAsset), 'request.json'), `${JSON.stringify(portrait, null, 2)}\n`);
            return sendJson(res, 200, { job: record, portrait });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/create-retro-motion') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const sourceJobId = String(body.sourceJobId ?? '');
            const portrait = rows.find((row) => (
              row.id === sourceJobId && row.kind === 'creature-portrait'
              && row.status !== 'rejected' && row.providerMeta?.retroNativeAnchor === true
              && row.rotationPaths && Object.keys(row.rotationPaths).length >= 4
            ));
            if (!portrait) return sendJson(res, 404, { error: 'RetroDiffusion anchor with named rotations not found.' });
            const requestedMotion = slug(body.motionKey ?? 'walk-right');
            const allowed = TEMPLATE_MOTION_KEYS.includes(requestedMotion as (typeof TEMPLATE_MOTION_KEYS)[number]);
            if (!allowed) return sendJson(res, 400, { error: 'Choose one of the six production motion slots.' });
            const motionKey = requestedMotion as (typeof TEMPLATE_MOTION_KEYS)[number];
            const direction = MOTION_DIRECTIONS[motionKey];
            const sourceRel = portrait.rotationPaths?.[direction];
            if (!sourceRel) return sendJson(res, 400, { error: `The ${direction} rotation is unavailable.` });
            const source = path.resolve(workspace, ...sourceRel.split('/'));
            if (!inside(workspace, source) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: `The ${direction} rotation file is unavailable.` });
            }
            const action = String(body.action ?? '').trim();
            if (action.length < 3 || action.length > 500) {
              return sendJson(res, 400, { error: 'Describe the RetroDiffusion motion in 3 to 500 characters.' });
            }
            const seed = asInt(body.seed, portrait.seed + 200, 0, 2_147_483_647);
            const name = slug(body.name ?? `${portrait.name}-${motionKey}`);
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.kind === 'creature-animation'
              && row.provider === 'retro-diffusion' && row.sourceJobId === portrait.id
              && row.motionKey === motionKey && row.seed === seed && row.action === action
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact RetroDiffusion motion is already ${duplicate.status}: ${duplicate.id}. Change its seed or motion before spending again.`,
              });
            }
            const walkMotion = motionKey.startsWith('walk-');
            const frameCount = walkMotion ? 8 : 6;
            const promptStyle = walkMotion
              ? 'rd_advanced_animation__walking' : 'rd_advanced_animation__attack';
            const sourcePng = fs.readFileSync(source);
            const sourceImage = decodePng(sourcePng);
            const size = sourceImage.width;
            if (size !== sourceImage.height || size < 32 || size > 256) {
              throw new Error(`RetroDiffusion motion source must be a 32-256px square; received ${sourceImage.width}x${sourceImage.height}.`);
            }
            const generated = await generateRetroPromptAnimation(
              env, action, seed, promptStyle, size, [], sourcePng.toString('base64'), frameCount,
            );
            const providerSheet = decodePng(generated.png);
            if (providerSheet.width % size || providerSheet.height % size) {
              throw new Error(`Retro Diffusion returned a ${providerSheet.width}x${providerSheet.height} animation sheet that is not aligned to ${size}px cells.`);
            }
            const columns = providerSheet.width / size;
            const gridRows = providerSheet.height / size;
            if (columns * gridRows < frameCount) {
              throw new Error(`Retro Diffusion returned only ${columns * gridRows} motion cells; expected ${frameCount}.`);
            }
            const frames = Array.from({ length: frameCount }, (_, index) => (
              removeFlatEdgeMatte(cropRegion(
                generated.png,
                index % columns * size,
                Math.floor(index / columns) * size,
                size,
                size,
              )).png
            ));
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            const frameDir = path.join(dir, 'frames');
            fs.mkdirSync(frameDir, { recursive: true });
            const sourceSheet = path.join(dir, 'source.png');
            const sheet = path.join(dir, 'sheet.png');
            fs.writeFileSync(sourceSheet, generated.png);
            fs.writeFileSync(sheet, animationStrip(frames));
            const framePaths = frames.map((frame, index) => {
              const file = path.join(frameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame);
              return posix(path.relative(workspace, file));
            });
            const record: StudioRecord = {
              id, status: 'pending', provider: 'retro-diffusion', kind: 'creature-animation',
              name, prompt: action, action, motionKey, sourceJobId: portrait.id,
              width: size, height: size, sourceWidth: providerSheet.width, sourceHeight: providerSheet.height,
              transparent: true, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, sheet)),
              sourcePath: posix(path.relative(workspace, sourceSheet)),
              framePaths, theme: portrait.theme, revision: 1,
              providerMeta: {
                ...generated.meta,
                retroAdvancedMotion: true,
                direction,
                nativeSpriteSize: size,
                requestedFrameCount: frameCount,
                gridColumns: columns,
                gridRows,
                sourceTransparentPct: Math.min(...frames.map((frame) => alphaStats(frame).transparentPct)),
              },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/create-retro-character') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const name = slug(body.name ?? 'new-retro-monster');
            const theme = String(body.theme ?? '').trim().slice(0, 40) || undefined;
            const prompt = String(body.prompt ?? '').trim();
            const seed = asInt(body.seed, 7, 0, 2_147_483_647);
            if (prompt.length < 20 || prompt.length > 2_000) {
              return sendJson(res, 400, { error: 'Describe the RetroDiffusion monster in 20 to 2,000 characters.' });
            }
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.provider === 'retro-diffusion'
              && row.kind === 'creature-portrait' && row.name === name
              && row.prompt === prompt && row.seed === seed
              && row.providerMeta?.promptStyle === 'rd_animation__battle_sprites'
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact RetroDiffusion character is already ${duplicate.status}: ${duplicate.id}. Change its seed, prompt, or name before spending again.`,
              });
            }

            const generated = await generateRetroBattleSprites(env, prompt, seed);
            const sheetImage = decodePng(generated.png);
            const cellSize = 64;
            if (sheetImage.width % cellSize || sheetImage.height % cellSize) {
              throw new Error(`Retro Diffusion returned a ${sheetImage.width}x${sheetImage.height} sheet that is not aligned to 64px cells.`);
            }
            const columns = sheetImage.width / cellSize;
            const gridRows = sheetImage.height / cellSize;
            const frameCount = columns * gridRows;
            if (frameCount < 56) {
              throw new Error(`Retro Diffusion returned only ${frameCount} battle-sprite cells; expected 56.`);
            }
            const frames = Array.from({ length: 56 }, (_, index) => cropRegion(
              generated.png,
              index % columns * cellSize,
              Math.floor(index / columns) * cellSize,
              cellSize,
              cellSize,
            ));
            const anchor = frames.find((frame) => alphaStats(frame).contentBbox) ?? frames[0];
            const createdAt = new Date().toISOString();
            const familyId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const portraitDir = path.join(studioPaths(workspace).pending, familyId);
            fs.mkdirSync(portraitDir, { recursive: true });
            const portraitAsset = path.join(portraitDir, 'asset.png');
            const portraitSource = path.join(portraitDir, 'source.png');
            fs.writeFileSync(portraitAsset, anchor);
            fs.writeFileSync(portraitSource, anchor);

            const sharedMeta = {
              ...generated.meta,
              nativeSpriteSize: cellSize,
              retroBattleSprites: true,
              paidGeneration: true,
              directions: 4,
              actions: ['idle', 'walk', 'jump', 'attack'],
              actionFrameCounts: { idle: 3, walk: 6, jump: 2, attack: 3 },
              frameCount: 56,
              gridColumns: columns,
              gridRows,
              providerSheetWidth: sheetImage.width,
              providerSheetHeight: sheetImage.height,
            };
            const portrait: StudioRecord = {
              id: familyId, status: 'pending', provider: 'retro-diffusion', kind: 'creature-portrait',
              name, prompt, width: cellSize, height: cellSize,
              sourceWidth: cellSize, sourceHeight: cellSize,
              transparent: true, seed, createdAt,
              stagedPath: posix(path.relative(workspace, portraitAsset)),
              sourcePath: posix(path.relative(workspace, portraitSource)),
              motionSourcePath: posix(path.relative(workspace, portraitSource)),
              theme, revision: 1,
              providerMeta: sharedMeta,
            };

            const sheetId = `${Date.now() + 1}-${crypto.randomBytes(4).toString('hex')}-${name}-battle-sprites`;
            const sheetDir = path.join(studioPaths(workspace).pending, sheetId);
            const frameDir = path.join(sheetDir, 'frames');
            fs.mkdirSync(frameDir, { recursive: true });
            const sheetAsset = path.join(sheetDir, 'asset.png');
            const sheetSource = path.join(sheetDir, 'source.png');
            fs.writeFileSync(sheetAsset, generated.png);
            fs.writeFileSync(sheetSource, generated.png);
            const framePaths = frames.map((frame, index) => {
              const file = path.join(frameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame);
              return posix(path.relative(workspace, file));
            });
            const sheet: StudioRecord = {
              id: sheetId, status: 'pending', provider: 'retro-diffusion', kind: 'creature-sheet',
              name: `${name}-battle-sprites`, prompt,
              width: sheetImage.width, height: sheetImage.height,
              sourceWidth: sheetImage.width, sourceHeight: sheetImage.height,
              transparent: true, seed, createdAt, sourceJobId: familyId,
              stagedPath: posix(path.relative(workspace, sheetAsset)),
              sourcePath: posix(path.relative(workspace, sheetSource)),
              framePaths, theme, revision: 1,
              providerMeta: sharedMeta,
            };

            rows.unshift(sheet, portrait);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(portraitDir, 'request.json'), `${JSON.stringify(portrait, null, 2)}\n`);
            fs.writeFileSync(path.join(sheetDir, 'request.json'), `${JSON.stringify(sheet, null, 2)}\n`);
            return sendJson(res, 201, { portrait, sheet });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/create-rig') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const name = slug(body.name ?? 'new-directional-monster');
            const theme = String(body.theme ?? '').trim();
            const prompt = String(body.prompt ?? '').trim();
            const seed = asInt(body.seed, 7, 0, 2_147_483_647);
            const nativeSize = asInt(body.nativeSize, 96, 64, 128);
            const requestedTemplate = String(body.templateId ?? 'dog').trim().toLowerCase();
            const templateId = ['bear', 'cat', 'dog', 'horse', 'lion'].includes(requestedTemplate)
              ? requestedTemplate : 'dog';
            if (prompt.length < 20 || prompt.length > 2_000) {
              return sendJson(res, 400, { error: 'Describe the managed creature in 20 to 2,000 characters.' });
            }
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.kind === 'creature-portrait'
              && row.name === name && row.prompt === prompt && row.seed === seed
              && row.providerMeta?.managedDirectionalRig === true
              && row.providerMeta?.nativeSpriteSize === nativeSize
              && row.providerMeta?.templateId === templateId
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact directional rig is already ${duplicate.status}: ${duplicate.id}. Change its seed, prompt, or name before spending again.`,
              });
            }
            const generated = await createManagedCharacter(env, prompt, name, nativeSize, seed, templateId);
            const south = generated.rotations.south;
            if (!south) throw new Error('PixelLab completed the rig without a south-facing frame.');
            const prepared = prepareStill('creature-portrait', south, true);
            const sourceSize = decodePng(south);
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            const rotationDir = path.join(dir, 'rotations');
            fs.mkdirSync(rotationDir, { recursive: true });
            const asset = path.join(dir, 'asset.png');
            const source = path.join(dir, 'source.png');
            const motionSource = path.join(dir, 'motion-source.png');
            fs.writeFileSync(asset, prepared.png);
            fs.writeFileSync(source, south);
            fs.writeFileSync(motionSource, 'motionPng' in prepared && prepared.motionPng ? prepared.motionPng : south);
            const rotationPaths = Object.fromEntries(Object.entries(generated.rotations).map(([direction, png]) => {
              const file = path.join(rotationDir, `${direction}.png`);
              fs.writeFileSync(file, png);
              return [direction, posix(path.relative(workspace, file))];
            }));
            const record: StudioRecord = {
              id, status: 'pending', provider: 'pixellab', kind: 'creature-portrait',
              name, prompt, width: prepared.width, height: prepared.height,
              sourceWidth: sourceSize.width, sourceHeight: sourceSize.height,
              transparent: true, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, asset)),
              sourcePath: posix(path.relative(workspace, source)),
              motionSourcePath: posix(path.relative(workspace, motionSource)),
              rotationPaths, theme, revision: 1,
              providerMeta: {
                ...generated.meta,
                ...('processing' in prepared ? prepared.processing : {}),
                rigDirections: Object.keys(rotationPaths),
                rigCanvasWidth: sourceSize.width,
                rigCanvasHeight: sourceSize.height,
              },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/animate') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const sourceJobId = String(body.sourceJobId ?? '');
            const portrait = rows.find((row) => row.id === sourceJobId && row.kind === 'creature-portrait');
            if (!portrait) return sendJson(res, 404, { error: 'Creature portrait draft not found.' });
            const action = String(body.action ?? '').trim();
            if (action.length < 3 || action.length > 500) {
              return sendJson(res, 400, { error: 'Describe the motion in 3 to 500 characters.' });
            }
            const name = slug(body.name ?? `${portrait.name}-${action}`);
            const motionKey = slug(body.motionKey ?? 'extra');
            const rawFrames = asInt(body.frameCount, 8, 4, 16);
            const frameCount = rawFrames % 2 === 0 ? rawFrames : Math.min(16, rawFrames + 1);
            const seed = asInt(body.seed, portrait.seed, 0, 2_147_483_647);
            const recoverOnly = body.recoverOnly === true;
            const duplicate = rows.find((row) => (
              row.status !== 'rejected' && row.kind === 'creature-animation'
              && row.sourceJobId === sourceJobId && row.motionKey === motionKey
              && row.name === name && row.action === action && row.seed === seed
              && (row.providerMeta?.requestedFrameCount === frameCount
                || row.framePaths?.length === frameCount
                || row.framePaths?.length === frameCount + 1)
            ));
            if (duplicate) {
              return sendJson(res, 409, {
                error: `This exact animation request is already ${duplicate.status}: ${duplicate.id}. Change the seed, motion, or name before spending another provider credit.`,
              });
            }
            const sourceRel = portrait.motionSourcePath
              ?? (portrait.status === 'approved' && portrait.approvedSourcePath
                ? portrait.approvedSourcePath
                : portrait.sourcePath ?? portrait.stagedPath);
            const source = path.resolve(workspace, ...sourceRel.split('/'));
            if (!inside(workspace, source) || !fs.existsSync(source)) {
              return sendJson(res, 400, { error: 'The portrait source image is unavailable.' });
            }
            const characterId = typeof portrait.providerMeta?.characterId === 'string'
              ? portrait.providerMeta.characterId : '';
            const managedMotionKey = TEMPLATE_MOTION_KEYS.includes(motionKey as (typeof TEMPLATE_MOTION_KEYS)[number])
              ? motionKey as (typeof TEMPLATE_MOTION_KEYS)[number] : undefined;
            const generated = characterId && managedMotionKey
              ? await animateManagedCharacter(env, characterId, name, managedMotionKey, action, frameCount, seed, recoverOnly)
              : await animateCreature(env, fs.readFileSync(source), action, frameCount, seed);
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            const frameDir = path.join(dir, 'frames');
            const rawFrameDir = path.join(dir, 'raw-frames');
            fs.mkdirSync(frameDir, { recursive: true });
            fs.mkdirSync(rawFrameDir, { recursive: true });
            const cleanedFrames = generated.frames.map((frame) => removeFlatEdgeMatte(frame));
            const rawFramePaths = generated.frames.map((frame, index) => {
              const file = path.join(rawFrameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame);
              return posix(path.relative(workspace, file));
            });
            const framePaths = cleanedFrames.map((frame, index) => {
              const file = path.join(frameDir, `frame-${String(index + 1).padStart(3, '0')}.png`);
              fs.writeFileSync(file, frame.png);
              return posix(path.relative(workspace, file));
            });
            const sheet = path.join(dir, 'sheet.png');
            fs.writeFileSync(sheet, animationStrip(cleanedFrames.map((frame) => frame.png)));
            const first = decodePng(cleanedFrames[0].png);
            const record: StudioRecord = {
              id, status: 'pending', provider: 'pixellab', kind: 'creature-animation',
              name, prompt: action, action, motionKey, sourceJobId,
              width: first.width, height: first.height,
              transparent: true, seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, sheet)), framePaths, rawFramePaths,
              theme: portrait.theme, revision: 1, providerMeta: {
                ...generated.meta,
                requestedFrameCount: frameCount,
                matteRemovedFrames: cleanedFrames.filter((frame) => frame.removed).length,
                sourceTransparentPct: Math.min(...cleanedFrames.map((frame) => alphaStats(frame.png).transparentPct)),
              },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
          }
          if (req.method === 'POST' && requestUrl.pathname === '/__studio/build-template') {
            const body = await jsonBody(req);
            const rows = readRegistry(workspace);
            const sourceJobId = String(body.sourceJobId ?? '');
            const portrait = rows.find((row) => row.id === sourceJobId && row.kind === 'creature-portrait' && row.status !== 'rejected');
            if (!portrait) return sendJson(res, 404, { error: 'Creature portrait draft not found.' });
            const slots = Object.fromEntries(TEMPLATE_MOTION_KEYS.map((motionKey) => {
              const animation = rows.find((row) => (
                row.kind === 'creature-animation' && row.status !== 'rejected'
                && row.sourceJobId === sourceJobId && row.motionKey === motionKey
              ));
              return [motionKey, animation];
            })) as Record<(typeof TEMPLATE_MOTION_KEYS)[number], StudioRecord | undefined>;
            const missing = TEMPLATE_MOTION_KEYS.filter((motionKey) => !slots[motionKey]);
            if (missing.length) {
              return sendJson(res, 400, { error: `Complete these animation slots first: ${missing.join(', ')}.` });
            }
            const templateSlots = Object.fromEntries(TEMPLATE_MOTION_KEYS.map((motionKey) => [motionKey, slots[motionKey]!.id]));
            const duplicate = rows.find((row) => (
              row.kind === 'creature-sheet' && row.status !== 'rejected'
              && row.sourceJobId === sourceJobId
              && JSON.stringify(row.templateSlots) === JSON.stringify(templateSlots)
            ));
            if (duplicate) {
              return sendJson(res, 409, { error: `This exact template is already ${duplicate.status}: ${duplicate.id}.` });
            }
            const slotFrames = TEMPLATE_MOTION_KEYS.map((motionKey) => {
              const animation = slots[motionKey]!;
              const paths = animation.status === 'approved' && animation.approvedFramePaths?.length
                ? animation.approvedFramePaths : animation.framePaths ?? [];
              return paths.map((framePath) => {
                const absolute = path.resolve(workspace, ...framePath.split('/'));
                if (!inside(workspace, absolute) || !fs.existsSync(absolute)) {
                  throw new Error(`Animation frame is unavailable: ${framePath}`);
                }
                return fs.readFileSync(absolute);
              });
            });
            const name = slug(body.name ?? `${portrait.name}-animation-template`);
            const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
            const dir = path.join(studioPaths(workspace).pending, id);
            fs.mkdirSync(dir, { recursive: true });
            const sheet = path.join(dir, 'sheet.png');
            const cellSize = asInt(portrait.providerMeta?.nativeSpriteSize, 64, 64, 128);
            fs.writeFileSync(sheet, templateSheet(slotFrames, cellSize));
            const record: StudioRecord = {
              id, status: 'pending', provider: 'pixellab', kind: 'creature-sheet',
              name, prompt: 'Locally assembled 4x6 runtime animation template.',
              sourceJobId, templateSlots, width: cellSize * 4, height: cellSize * 6,
              transparent: true, seed: portrait.seed, createdAt: new Date().toISOString(),
              stagedPath: posix(path.relative(workspace, sheet)), theme: portrait.theme,
              revision: 1, providerMeta: { model: 'local-template-assembly', paidGeneration: false, cellSize },
            };
            rows.unshift(record);
            writeRegistry(workspace, rows);
            fs.writeFileSync(path.join(dir, 'request.json'), `${JSON.stringify(record, null, 2)}\n`);
            return sendJson(res, 201, { job: record });
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

            const sourceCopy = record.sourcePath ? {
              source: path.resolve(workspace, ...record.sourcePath.split('/')),
              target: path.join(path.dirname(dest), '_sources', path.basename(dest)),
            } : undefined;
            const cardPreviewRel = typeof record.providerMeta?.cardPreviewPath === 'string'
              ? record.providerMeta.cardPreviewPath : undefined;
            const cardPreviewCopy = cardPreviewRel ? {
              source: path.resolve(workspace, ...cardPreviewRel.split('/')),
              target: path.join(path.dirname(dest), '_previews', path.basename(dest)),
            } : undefined;
            if (sourceCopy && (!inside(workspace, sourceCopy.source) || !fs.existsSync(sourceCopy.source))) {
              return sendJson(res, 400, { error: `Source image is unavailable: ${record.sourcePath}` });
            }
            if (cardPreviewCopy && (!inside(workspace, cardPreviewCopy.source) || !fs.existsSync(cardPreviewCopy.source))) {
              return sendJson(res, 400, { error: `Card preview image is unavailable: ${cardPreviewRel}` });
            }

            const approvedFrameDir = record.kind === 'creature-sheet'
              ? path.join(path.dirname(dest), '_frames', slug(record.name))
              : path.join(path.dirname(dest), 'frames');
            const frameCopies = record.framePaths?.length
              ? record.framePaths.map((framePath) => {
                  const source = path.resolve(workspace, ...framePath.split('/'));
                  return { framePath, source, target: path.join(approvedFrameDir, path.basename(source)) };
                })
              : [];
            const rotationCopies = record.kind === 'creature-portrait' && record.rotationPaths
              ? Object.entries(record.rotationPaths).map(([direction, rotationPath]) => {
                  const source = path.resolve(workspace, ...rotationPath.split('/'));
                  return { direction, rotationPath, source, target: path.join(path.dirname(dest), '_rotations', `${direction}.png`) };
                })
              : [];
            const missingFrame = frameCopies.find(({ source }) => !inside(workspace, source) || !fs.existsSync(source));
            if (missingFrame) {
              return sendJson(res, 400, { error: `Animation frame is unavailable: ${missingFrame.framePath}` });
            }
            const missingRotation = rotationCopies.find(({ source }) => !inside(workspace, source) || !fs.existsSync(source));
            if (missingRotation) {
              return sendJson(res, 400, { error: `Character rotation is unavailable: ${missingRotation.rotationPath}` });
            }

            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(staged, dest);
            if (sourceCopy) {
              fs.mkdirSync(path.dirname(sourceCopy.target), { recursive: true });
              fs.copyFileSync(sourceCopy.source, sourceCopy.target);
              record.approvedSourcePath = posix(path.relative(workspace, sourceCopy.target));
            }
            if (cardPreviewCopy) {
              fs.mkdirSync(path.dirname(cardPreviewCopy.target), { recursive: true });
              fs.copyFileSync(cardPreviewCopy.source, cardPreviewCopy.target);
              record.providerMeta = {
                ...(record.providerMeta ?? {}),
                approvedCardPreviewPath: posix(path.relative(workspace, cardPreviewCopy.target)),
              };
            }
            if (frameCopies.length) {
              fs.mkdirSync(path.dirname(frameCopies[0].target), { recursive: true });
              record.approvedFramePaths = frameCopies.map(({ source, target }) => {
                fs.copyFileSync(source, target);
                return posix(path.relative(workspace, target));
              });
            }
            if (rotationCopies.length) {
              fs.mkdirSync(path.dirname(rotationCopies[0].target), { recursive: true });
              record.approvedRotationPaths = Object.fromEntries(rotationCopies.map(({ direction, source, target }) => {
                fs.copyFileSync(source, target);
                return [direction, posix(path.relative(workspace, target))];
              }));
            }
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
            if (record.sourcePath) record.sourcePath = posix(path.relative(workspace, path.join(rejectedDir, path.basename(record.sourcePath))));
            if (record.motionSourcePath) record.motionSourcePath = posix(path.relative(workspace, path.join(rejectedDir, path.basename(record.motionSourcePath))));
            if (typeof record.providerMeta?.cardPreviewPath === 'string') {
              record.providerMeta = {
                ...(record.providerMeta ?? {}),
                cardPreviewPath: posix(path.relative(workspace, path.join(rejectedDir, 'card-preview.png'))),
              };
            }
            if (record.framePaths?.length) record.framePaths = record.framePaths.map((frame) => posix(path.relative(workspace, path.join(rejectedDir, 'frames', path.basename(frame)))));
            if (record.rawFramePaths?.length) record.rawFramePaths = record.rawFramePaths.map((frame) => posix(path.relative(workspace, path.join(rejectedDir, 'raw-frames', path.basename(frame)))));
            if (record.rotationPaths) record.rotationPaths = Object.fromEntries(Object.entries(record.rotationPaths).map(([direction]) => [
              direction, posix(path.relative(workspace, path.join(rejectedDir, 'rotations', `${direction}.png`))),
            ]));
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
