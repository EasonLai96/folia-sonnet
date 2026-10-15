import { Hono } from 'hono';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './app.js';

// src/admin.ts
// The visual panel's own door: a username/password form backed by a session
// row in the database.
//
// Sessions live in the database rather than in a signed cookie so this works
// unchanged on Cloudflare Workers (no HMAC secret to provision) and on the
// Node standalone build. A row is a token plus an expiry, and the expiry is
// what makes a forgotten logout harmless.

export type AdminEnv = { Bindings: Env };
type AdminContext = Context<AdminEnv>;

export const ADMIN_COOKIE = 'folia_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_RENEW_BELOW_MS = 10 * 60 * 60 * 1000;

export interface AdminSessionRow {
  token: string;
  username: string;
  created_at: string;
  expires_at: string;
}

/** Credentials come from the environment; the defaults are the shipped ones. */
export const readAdminCredentials = (env: Env): { username: string; password: string } => ({
  username: String(env.ADMIN_USERNAME || 'maimai').trim(),
  password: String(env.ADMIN_PASSWORD || '131425++'),
});

const newToken = (): string => {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID().replace(/-/g, '');
  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(24);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
};

const readSessionRow = async (
  db: Env['FOLIA_SYNC_DB'],
  token: string,
): Promise<AdminSessionRow | null> => {
  if (!token) return null;
  const row = await db
    .prepare('SELECT token, username, created_at, expires_at FROM admin_sessions WHERE token = ?')
    .bind(token)
    .first<AdminSessionRow>();
  if (!row?.expires_at) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
};

/** The signed-in username, or null when the cookie is missing or expired. */
export const readAdminSession = async (c: AdminContext): Promise<string | null> => {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) return null;
  const row = await readSessionRow(c.env.FOLIA_SYNC_DB, token);
  return row?.username ?? null;
};

/** Sliding expiry: an open panel keeps its own session alive. */
export const touchAdminSession = async (c: AdminContext): Promise<void> => {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) return;
  const row = await readSessionRow(c.env.FOLIA_SYNC_DB, token);
  if (!row) return;
  const expiresAt = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > SESSION_RENEW_BELOW_MS) return;
  await c.env.FOLIA_SYNC_DB
    .prepare('UPDATE admin_sessions SET expires_at = ? WHERE token = ?')
    .bind(new Date(Date.now() + SESSION_TTL_MS).toISOString(), token)
    .run();
};

/** Gate for every /admin/api/* route: no session, no answer. */
export const requireAdmin: MiddlewareHandler<AdminEnv> = async (c, next: Next) => {
  const username = await readAdminSession(c);
  if (!username) return c.json({ ok: false, error: 'unauthorized' }, 401);
  await next();
};

/** Cheap housekeeping: expired rows are swept whenever the panel is opened. */
export const pruneExpiredSessions = async (db: Env['FOLIA_SYNC_DB']): Promise<void> => {
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();
};

export const createAdminSession = async (db: Env['FOLIA_SYNC_DB'], username: string): Promise<string> => {
  const token = newToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare('INSERT INTO admin_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, username, now, expiresAt)
    .run();
  return token;
};

export const destroyAdminSession = async (db: Env['FOLIA_SYNC_DB'], token: string): Promise<void> => {
  if (!token) return;
  await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
};

const admin = new Hono<AdminEnv>();

admin.post('/login', async (c) => {
  let username = '';
  let password = '';
  const contentType = String(c.req.header('Content-Type') || '');
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ username?: unknown; password?: unknown }>().catch(() => null);
    username = String(body?.username ?? '');
    password = String(body?.password ?? '');
  } else {
    const form = await c.req.parseBody().catch(() => null) as Record<string, unknown> | null;
    username = String(form?.username ?? '');
    password = String(form?.password ?? '');
  }

  const expected = readAdminCredentials(c.env);
  if (username.trim() !== expected.username || password !== expected.password) {
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  const token = await createAdminSession(c.env.FOLIA_SYNC_DB, expected.username);
  setCookie(c, ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    // Marked secure only on https: a hard-coded `true` would silently break
    // the local http build (the browser would refuse to store the cookie).
    secure: c.req.url.startsWith('https://'),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return c.json({ ok: true, username: expected.username });
});

admin.post('/logout', async (c) => {
  const token = getCookie(c, ADMIN_COOKIE);
  await destroyAdminSession(c.env.FOLIA_SYNC_DB, token || '');
  deleteCookie(c, ADMIN_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

admin.get('/session', async (c) => {
  const username = await readAdminSession(c);
  return c.json({ ok: true, signedIn: Boolean(username), username });
});

export default admin;
