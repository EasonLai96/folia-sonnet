import { Hono } from 'hono';
import { requireAdmin } from './admin.js';
import type { D1Database, Env } from './app.js';

// src/fonts.ts
// The font market: a catalogue of fonts an operator uploads, each with a
// preview image baked at upload time.
//
// Why the preview is stored instead of generated on demand: a CJK font is
// several megabytes. Making every player download it just to draw one sample
// line would cost more traffic than the feature is worth. The panel rasterises
// the preview once, in the operator's browser, and the player only ever fetches
// the font file once the user actually picks it.

const MAX_FONT_BYTES = 40 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const SUPPORTED_FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'];
const SUPPORTED_FONT_MIME = new Set([
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/vnd.ms-opentype',
  'application/octet-stream',
]);

export const FONT_CATEGORIES = [
  { id: 'sans', label: '黑体 / 无衬线' },
  { id: 'serif', label: '宋体 / 衬线' },
  { id: 'handwriting', label: '手写' },
  { id: 'display', label: '艺术 / 标题' },
  { id: 'mono', label: '等宽' },
] as const;

const CATEGORY_LABELS: Record<string, string> = FONT_CATEGORIES.reduce(
  (accumulator, entry) => ({ ...accumulator, [entry.id]: entry.label }),
  {} as Record<string, string>,
);

const normalizeCategory = (value: unknown): string => (
  CATEGORY_LABELS[String(value ?? '').trim()] ? String(value).trim() : 'sans'
);

export interface FontMarketEntry {
  id: string;
  name: string;
  family: string;
  category: string;
  categoryLabel: string;
  license: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
  previewUrl: string;
  enabled: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

type FontRow = {
  id: string;
  name: string;
  family: string;
  category: string;
  license: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number;
  enabled: number;
  sort: number;
  created_at: string;
  updated_at: string;
};

const mapRow = (row: FontRow): FontMarketEntry => ({
  id: row.id,
  name: row.name,
  family: row.family,
  category: row.category,
  categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
  license: row.license ?? '',
  fileName: row.file_name ?? '',
  mimeType: row.mime_type ?? '',
  fileSize: Number(row.file_size ?? 0),
  fileUrl: `/api/fonts/${encodeURIComponent(row.id)}/file`,
  previewUrl: `/api/fonts/${encodeURIComponent(row.id)}/preview`,
  enabled: Number(row.enabled ?? 0) === 1,
  sort: Number(row.sort ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const SELECT_FONTS = `
  SELECT id, name, family, category, license, file_name, mime_type, file_size, enabled, sort, created_at, updated_at
  FROM font_market
`;

const listFonts = async (db: D1Database, onlyEnabled: boolean) => {
  const query = onlyEnabled
    ? `${SELECT_FONTS} WHERE enabled = 1 ORDER BY sort ASC, created_at DESC`
    : `${SELECT_FONTS} ORDER BY sort ASC, created_at DESC`;
  const rows = await db.prepare(query).all<FontRow>();
  return (rows.results ?? []).map(mapRow);
};

const toBindable = (bytes: Uint8Array): unknown => (
  typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes
);

const toBytes = (value: unknown): Uint8Array | null => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
};

/*
 * hono 的 `c.body()` 只收 `string | ArrayBuffer | ReadableStream`，
 * `Uint8Array` 不在其中（TS 里 `Uint8Array<ArrayBufferLike>` 与 `ArrayBuffer`
 * 并不兼容）。这里切出一份精确范围的 ArrayBuffer —— 不能直接拿
 * `bytes.buffer`：那可能是整块共享内存，长度比这段数据大。
 */
const toBodyBuffer = (bytes: Uint8Array): ArrayBuffer => (
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
);

const stripExtension = (name: string): string => {
  const trimmed = String(name ?? '').trim();
  const matched = SUPPORTED_FONT_EXTENSIONS.find((extension) => trimmed.toLowerCase().endsWith(extension));
  return matched ? trimmed.slice(0, -matched.length) : trimmed;
};

const newFontId = (fileName: string): string => {
  const base = stripExtension(fileName)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return `${Date.now().toString(36)}_${base || 'font'}`;
};

const readUploadedFile = async (value: unknown, maxBytes: number): Promise<File | null> => {
  if (!value) return null;
  if (typeof value === 'string') return null;
  const candidate = value as { name?: unknown; size?: unknown; type?: unknown; arrayBuffer?: unknown };
  if (typeof candidate.arrayBuffer !== 'function') return null;
  const size = Number(candidate.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) return null;
  return value as File;
};

const readFontFile = async (value: unknown): Promise<File | null> => {
  const file = await readUploadedFile(value, MAX_FONT_BYTES);
  if (!file) return null;
  const lowerName = String(file.name || '').toLowerCase();
  const extensionOk = SUPPORTED_FONT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const mimeOk = SUPPORTED_FONT_MIME.has(String(file.type || '').toLowerCase());
  return extensionOk || mimeOk ? file : null;
};

/** Public: `GET /api/fonts`, `GET /api/fonts/:id/file`, `GET /api/fonts/:id/preview`. */
export const fontRoutes = (() => {
  const routes = new Hono<{ Bindings: Env }>();

  routes.get('/', async (c) => c.json({ ok: true, fonts: await listFonts(c.env.FOLIA_SYNC_DB, true) }));

  routes.get('/:id/file', async (c) => {
    const id = String(c.req.param('id') || '');
    const row = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT mime_type, data FROM font_files WHERE font_id = ?')
      .bind(id)
      .first<{ mime_type: string | null; data: unknown }>();
    const bytes = toBytes(row?.data);
    if (!bytes) return c.json({ ok: false, error: 'not_found' }, 404);
    return new Response(toBodyBuffer(bytes), {
      status: 200,
      headers: {
        'Content-Type': row?.mime_type || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  routes.get('/:id/preview', async (c) => {
    const id = String(c.req.param('id') || '');
    const row = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT mime, data FROM font_previews WHERE font_id = ?')
      .bind(id)
      .first<{ mime: string | null; data: unknown }>();
    const bytes = toBytes(row?.data);
    if (!bytes) return c.json({ ok: false, error: 'not_found' }, 404);
    return new Response(toBodyBuffer(bytes), {
      status: 200,
      headers: {
        'Content-Type': row?.mime || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  return routes;
})();

/** Admin: list / upload / patch / delete, mounted under `/admin/api/fonts`. */
export const adminFontRoutes = (() => {
  const routes = new Hono<{ Bindings: Env }>();
  routes.use('*', requireAdmin);

  routes.get('/', async (c) => c.json({ ok: true, fonts: await listFonts(c.env.FOLIA_SYNC_DB, false) }));

  routes.post('/', async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const record = (body ?? {}) as Record<string, unknown>;
    const file = await readFontFile(record.file);
    if (!file) return c.json({ ok: false, error: 'invalid_font_file' }, 400);
    const preview = await readUploadedFile(record.preview, MAX_PREVIEW_BYTES);
    if (!preview) return c.json({ ok: false, error: 'missing_preview' }, 400);

    const id = newFontId(file.name);
    const name = String(record.name ?? '').trim() || stripExtension(file.name) || '未命名字体';
    const category = normalizeCategory(record.category);
    const license = String(record.license ?? '').trim().slice(0, 200);
    const now = new Date().toISOString();
    const fontBytes = new Uint8Array(await file.arrayBuffer());
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    const mimeType = String(file.type || '').trim() || 'font/ttf';

    await c.env.FOLIA_SYNC_DB.batch([
      c.env.FOLIA_SYNC_DB
        .prepare(`
          INSERT INTO font_market (id, name, family, category, license, file_name, mime_type, file_size, enabled, sort, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
        `)
        .bind(id, name, `FoliaMarket_${id}`, category, license, file.name, mimeType, fontBytes.byteLength, now, now),
      c.env.FOLIA_SYNC_DB
        .prepare('INSERT INTO font_files (font_id, data) VALUES (?, ?)')
        .bind(id, toBindable(fontBytes)),
      c.env.FOLIA_SYNC_DB
        .prepare('INSERT INTO font_previews (font_id, mime, data) VALUES (?, ?, ?)')
        .bind(id, String(preview.type || 'image/png'), toBindable(previewBytes)),
    ]);

    return c.json({ ok: true, font: mapRow({
      id,
      name,
      family: `FoliaMarket_${id}`,
      category,
      license,
      file_name: file.name,
      mime_type: mimeType,
      file_size: fontBytes.byteLength,
      enabled: 1,
      sort: 0,
      created_at: now,
      updated_at: now,
    }) });
  });

  routes.patch('/:id', async (c) => {
    const id = String(c.req.param('id') || '');
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ ok: false, error: 'invalid_body' }, 400);
    const now = new Date().toISOString();
    const assignments: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (typeof body.name === 'string' && body.name.trim()) {
      assignments.push('name = ?');
      values.push(body.name.trim().slice(0, 120));
    }
    if (typeof body.category === 'string') {
      assignments.push('category = ?');
      values.push(normalizeCategory(body.category));
    }
    if (typeof body.license === 'string') {
      assignments.push('license = ?');
      values.push(body.license.trim().slice(0, 200));
    }
    if (typeof body.enabled === 'boolean') {
      assignments.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (typeof body.sort === 'number' && Number.isFinite(body.sort)) {
      assignments.push('sort = ?');
      values.push(Math.trunc(body.sort));
    }

    values.push(id);
    await c.env.FOLIA_SYNC_DB
      .prepare(`UPDATE font_market SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT id, name, family, category, license, file_name, mime_type, file_size, enabled, sort, created_at, updated_at FROM font_market WHERE id = ?')
      .bind(id)
      .first<FontRow>();
    return c.json({ ok: true, font: row ? mapRow(row) : null });
  });

  routes.delete('/:id', async (c) => {
    const id = String(c.req.param('id') || '');
    await c.env.FOLIA_SYNC_DB.batch([
      c.env.FOLIA_SYNC_DB.prepare('DELETE FROM font_market WHERE id = ?').bind(id),
      c.env.FOLIA_SYNC_DB.prepare('DELETE FROM font_files WHERE font_id = ?').bind(id),
      c.env.FOLIA_SYNC_DB.prepare('DELETE FROM font_previews WHERE font_id = ?').bind(id),
    ]);
    return c.json({ ok: true });
  });

  return routes;
})();

/** Panel counters. */
export const readFontStats = async (db: D1Database) => {
  const row = await db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS bytes FROM font_market')
    .first<{ count: number; bytes: number }>();
  return {
    fontCount: Number(row?.count ?? 0),
    fontBytes: Number(row?.bytes ?? 0),
  };
};
