import { Hono } from 'hono';
import { requireAdmin } from './admin.js';
import type { D1Database, Env } from './app.js';

// src/aiCache.ts
// The AI cloud cache: a shared shelf of "this lyric file already got an answer".
//
// The key is the MD5 of the lyric file the app would otherwise send to the
// model, so two people playing the same lyrics land on the same entry — the
// second one never pays for a generation. Pulling is deliberately open: a user
// who has not filled in an API key still gets a hit, which is the whole point
// of shipping the switch on by default.
//
// Only the payload is stored. No prompt, no lyric text, no credential.

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 200;

const KIND_PATTERN = /^[a-z0-9_-]{1,32}$/;
const KEY_PATTERN = /^[a-f0-9]{32}$/;

export type AiCacheKind = 'theme' | 'director';

export interface AiCacheEntry {
  kind: string;
  key: string;
  payload: unknown;
  songTitle: string;
  provider: string;
  model: string;
  payloadBytes: number;
  hits: number;
  createdAt: string;
  updatedAt: string;
}

type AiCacheRow = {
  kind: string;
  cache_key: string;
  payload_json: string;
  payload_bytes: number;
  song_title: string | null;
  provider: string | null;
  model: string | null;
  hits: number;
  created_at: string;
  updated_at: string;
};

const mapRow = (row: AiCacheRow): AiCacheEntry => {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = null;
  }
  return {
    kind: row.kind,
    key: row.cache_key,
    payload,
    songTitle: row.song_title ?? '',
    provider: row.provider ?? '',
    model: row.model ?? '',
    payloadBytes: Number(row.payload_bytes ?? 0),
    hits: Number(row.hits ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readPayload = (value: unknown): { ok: true; payload: unknown; bytes: number } | { ok: false } => {
  if (value === null || value === undefined) return { ok: false };
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false };
  }
  if (!serialized || serialized.length > MAX_PAYLOAD_BYTES) return { ok: false };
  return { ok: true, payload: value, bytes: serialized.length };
};

const readMetaText = (value: unknown, limit: number): string => (
  typeof value === 'string' ? value.trim().slice(0, limit) : ''
);

/** GET /api/ai-cache/:kind/:key — the pull. Never fails hard; a miss is data. */
const handleGet = async (db: D1Database, kind: string, key: string) => {
  const row = await db
    .prepare('SELECT kind, cache_key, payload_json, payload_bytes, song_title, provider, model, hits, created_at, updated_at FROM ai_cache WHERE kind = ? AND cache_key = ?')
    .bind(kind, key)
    .first<AiCacheRow>();

  if (!row) return { ok: true, hit: false, entry: null };

  await db
    .prepare('UPDATE ai_cache SET hits = hits + 1 WHERE kind = ? AND cache_key = ?')
    .bind(kind, key)
    .run();

  return { ok: true, hit: true, entry: mapRow(row) };
};

/** PUT /api/ai-cache/:kind/:key — the push, after a real generation. */
const handlePut = async (db: D1Database, kind: string, key: string, body: unknown) => {
  const source = (body ?? {}) as { payload?: unknown; songTitle?: unknown; provider?: unknown; model?: unknown };
  const parsed = readPayload(source.payload);
  if (!parsed.ok) return { ok: false, error: 'invalid_payload', stored: false };

  const now = new Date().toISOString();
  const songTitle = readMetaText(source.songTitle, MAX_TITLE_CHARS);
  const provider = readMetaText(source.provider, 64);
  const model = readMetaText(source.model, 128);

  await db
    .prepare(`
      INSERT INTO ai_cache (kind, cache_key, payload_json, payload_bytes, song_title, provider, model, hits, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(kind, cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        payload_bytes = excluded.payload_bytes,
        song_title = excluded.song_title,
        provider = excluded.provider,
        model = excluded.model,
        updated_at = excluded.updated_at
    `)
    .bind(kind, key, JSON.stringify(parsed.payload), parsed.bytes, songTitle, provider, model, now, now)
    .run();

  return { ok: true, stored: true };
};

const buildRoutes = (options: { admin: boolean }) => {
  const routes = new Hono<{ Bindings: Env }>();
  if (options.admin) routes.use('*', requireAdmin);

  routes.get('/:kind/:key', async (c) => {
    const kind = String(c.req.param('kind') || '').toLowerCase();
    const key = String(c.req.param('key') || '').toLowerCase();
    if (!KIND_PATTERN.test(kind) || !KEY_PATTERN.test(key)) {
      return c.json({ ok: false, error: 'invalid_key' }, 400);
    }
    const result = await handleGet(c.env.FOLIA_SYNC_DB, kind, key);
    return c.json(result);
  });

  routes.put('/:kind/:key', async (c) => {
    const kind = String(c.req.param('kind') || '').toLowerCase();
    const key = String(c.req.param('key') || '').toLowerCase();
    if (!KIND_PATTERN.test(kind) || !KEY_PATTERN.test(key)) {
      return c.json({ ok: false, error: 'invalid_key' }, 400);
    }
    const body = await c.req.json<unknown>().catch(() => null);
    const result = await handlePut(c.env.FOLIA_SYNC_DB, kind, key, body);
    return c.json(result, result.ok ? 200 : 400);
  });

  return routes;
};

/** Public read/write: `/api/ai-cache/...`. */
export const aiCacheRoutes = buildRoutes({ admin: false });

/** Admin list/delete: `/admin/api/ai-cache/...`. */
export const adminCacheRoutes = (() => {
  const routes = buildRoutes({ admin: true });

  routes.get('/', async (c) => {
    const kind = String(c.req.query('kind') || '').trim().toLowerCase();
    const query = String(c.req.query('q') || '').trim().toLowerCase();
    const requested = Number.parseInt(String(c.req.query('limit') || ''), 10);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(MAX_LIST_LIMIT, requested))
      : DEFAULT_LIST_LIMIT;

    const rows = kind && KIND_PATTERN.test(kind)
      ? await c.env.FOLIA_SYNC_DB
        .prepare('SELECT kind, cache_key, payload_json, payload_bytes, song_title, provider, model, hits, created_at, updated_at FROM ai_cache WHERE kind = ? ORDER BY updated_at DESC LIMIT ?')
        .bind(kind, limit)
        .all<AiCacheRow>()
      : await c.env.FOLIA_SYNC_DB
        .prepare('SELECT kind, cache_key, payload_json, payload_bytes, song_title, provider, model, hits, created_at, updated_at FROM ai_cache ORDER BY updated_at DESC LIMIT ?')
        .bind(limit)
        .all<AiCacheRow>();

    let entries = (rows.results ?? []).map(mapRow);
    if (query) {
      entries = entries.filter((entry) => (
        `${entry.key} ${entry.songTitle}`.toLowerCase().includes(query)
      ));
    }
    return c.json({ ok: true, entries, limit });
  });

  routes.delete('/:kind/:key', async (c) => {
    const kind = String(c.req.param('kind') || '').toLowerCase();
    const key = String(c.req.param('key') || '').toLowerCase();
    if (!KIND_PATTERN.test(kind) || !KEY_PATTERN.test(key)) {
      return c.json({ ok: false, error: 'invalid_key' }, 400);
    }
    await c.env.FOLIA_SYNC_DB
      .prepare('DELETE FROM ai_cache WHERE kind = ? AND cache_key = ?')
      .bind(kind, key)
      .run();
    return c.json({ ok: true });
  });

  /* Clear-all is a DELETE on the collection rather than a /clear sub-path:
   * it keeps the router from having to choose between `/clear` and `/:kind`. */
  routes.delete('/', async (c) => {
    const kind = String(c.req.query('kind') || '').trim().toLowerCase();
    if (kind) {
      if (!KIND_PATTERN.test(kind)) return c.json({ ok: false, error: 'invalid_kind' }, 400);
      await c.env.FOLIA_SYNC_DB.prepare('DELETE FROM ai_cache WHERE kind = ?').bind(kind).run();
    } else {
      await c.env.FOLIA_SYNC_DB.prepare('DELETE FROM ai_cache').run();
    }
    return c.json({ ok: true });
  });

  return routes;
})();

/** Panel counters. */
export const readCacheStats = async (db: D1Database) => {
  const row = await db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes, COALESCE(SUM(hits), 0) AS hits FROM ai_cache')
    .first<{ count: number; bytes: number; hits: number }>();
  const kindRows = await db
    .prepare('SELECT kind, COUNT(*) AS count FROM ai_cache GROUP BY kind')
    .all<{ kind: string; count: number }>();
  const kindCounts: Record<string, number> = {};
  (kindRows.results ?? []).forEach((entry) => {
    kindCounts[entry.kind] = Number(entry.count ?? 0);
  });
  return {
    cacheCount: Number(row?.count ?? 0),
    cacheBytes: Number(row?.bytes ?? 0),
    totalHits: Number(row?.hits ?? 0),
    kindCounts,
  };
};
