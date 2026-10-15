import { Hono } from 'hono';
import { requireAdmin } from './admin.js';
import { createD1FontBlobStore, toBodyBuffer, type FontBlobStore } from './fontBlobs.js';
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
//
// The bytes themselves do not go through D1 on the Node build — see
// src/fontBlobs.ts for why and for the two implementations.

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

/* 运行时注入（Node 走文件、Workers 走 D1）；没有注入就按 Workers 处理。 */
const blobsOf = (env: Env): FontBlobStore => (
    env.FONT_BLOBS ?? createD1FontBlobStore(env.FOLIA_SYNC_DB)
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
    const entry = await blobsOf(c.env).read(id, 'file').catch((error: unknown) => {
      console.error('[Fonts] failed to read font bytes:', error);
      return null;
    });
    if (!entry) return c.json({ ok: false, error: 'not_found' }, 404);
    return new Response(toBodyBuffer(entry.bytes), {
      status: 200,
      headers: {
        'Content-Type': entry.mime || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  routes.get('/:id/preview', async (c) => {
    const id = String(c.req.param('id') || '');
    const entry = await blobsOf(c.env).read(id, 'preview').catch((error: unknown) => {
      console.error('[Fonts] failed to read font preview:', error);
      return null;
    });
    if (!entry) return c.json({ ok: false, error: 'not_found' }, 404);
    return new Response(toBodyBuffer(entry.bytes), {
      status: 200,
      headers: {
        'Content-Type': entry.mime || 'image/png',
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

    /*
     * 字节与元数据分两处写：字节进 FONT_BLOBS（文件 / D1），元数据进 font_market。
     *
     * 顺序上先落字节再落元数据 —— 反过来的话，元数据先进去、字节写失败，库里就
     * 会留一条点开是 404 的条目，而页面上看不出任何异常。
     */
    const blobs = blobsOf(c.env);
    await blobs.write(id, 'file', fontBytes, mimeType);
    await blobs.write(id, 'preview', previewBytes, String(preview.type || 'image/png'));

    await c.env.FOLIA_SYNC_DB
      .prepare(`
        INSERT INTO font_market (id, name, family, category, license, file_name, mime_type, file_size, enabled, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
      `)
      .bind(id, name, `FoliaMarket_${id}`, category, license, file.name, mimeType, fontBytes.byteLength, now, now)
      .run();

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
    await c.env.FOLIA_SYNC_DB
      .prepare('DELETE FROM font_market WHERE id = ?')
      .bind(id)
      .run();
    // 字节也一起清掉，否则删了条目、文件还留在磁盘上，日积月累全是孤儿。
    await blobsOf(c.env).remove(id).catch(() => undefined);
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
