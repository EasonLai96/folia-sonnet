'use strict';

// Display/log/IPC boundaries for desktop AI requests. Never retain a transport's raw error fields.
const MAX_ERROR_BODY_CHARS = 16 * 1024;
const REDACTED = '[redacted]';
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Accept literal, JSON-string escaped, mixed percent (case-insensitive hex), and form copies of the exact key.
const credentialPattern = (credential) => Array.from(credential).map((character) => {
    try {
        let encoded = encodeURIComponent(character);
        if (encoded === character) encoded = `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
        const percent = encoded.replace(/[a-f]/gi, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
        const jsonEscaped = escapePattern(JSON.stringify(character).slice(1, -1));
        return `(?:${jsonEscaped}|${escapePattern(character)}|${percent}${character === ' ' ? '|\\+' : ''})`;
    } catch {
        return escapePattern(character);
    }
}).join('');

const redactSecrets = (value, apiKey) => {
    const text = String(value ?? '');
    const spans = [];
    const collect = (pattern, labeled = false) => {
        for (const match of text.matchAll(pattern)) {
            const quoted = labeled && /^["']/.test(match[2]);
            const start = match.index + (labeled ? match[1].length + (quoted ? 1 : 0) : 0);
            const end = match.index + match[0].length - (quoted ? 1 : 0);
            // Idempotence matters for short keys which also occur inside the replacement marker.
            const marker = text.lastIndexOf(REDACTED, start);
            if (marker >= 0 && start >= marker && end <= marker + REDACTED.length) continue;
            spans.push({ start, end });
        }
    };
    if (apiKey) collect(new RegExp(credentialPattern(String(apiKey)), 'g'));
    collect(/(\b(?:bearer|basic)(?:\s+|%20|\+))([^\s"'`,;}&]+)/gi, true);
    collect(/((?:[?&]|%3f|%26)(?:key|api[_-]?key|(?:access|refresh|id)[_-]?token|token|auth(?:orization)?|password|secret)(?:=|%3d))((?:(?!%26|%23)[^&#\s"'`])+)/gi, true);
    collect(/(["']?\b(?:x[_-](?:goog[_-])?api[_-]key|api[_-]?key|(?:proxy[_-])?authorization|auth|(?:access|refresh|id)[_-]?token|token|password|secret|cookie|set[_-]cookie)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:(?:bearer|basic)\s+)?[^\s"',;}&]+)/gi, true);
    const merged = [];
    for (const span of spans.sort((a, b) => a.start - b.start || b.end - a.end)) {
        const previous = merged[merged.length - 1];
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else merged.push({ ...span });
    }
    let offset = 0;
    const parts = [];
    for (const span of merged) {
        parts.push(text.slice(offset, span.start), REDACTED);
        offset = span.end;
    }
    parts.push(text.slice(offset));
    return parts.join('');
};

const redactUrl = (rawUrl) => {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid url]';
    }
};

// SyntaxError messages can expose only a prefix of a secret; exact-key replacement cannot fix that.
const sanitizeAiError = (error, apiKey) => {
    const name = error && error.name;
    const message = redactSecrets(name === 'SyntaxError' ? 'AI provider returned invalid JSON'
        : error && typeof error.message === 'string' ? error.message : String(error ?? ''), apiKey);
    const safe = new Error(message);
    safe.name = name === 'AbortError' || name === 'TimeoutError' ? name : 'Error';
    // Even newly captured stacks can contain a credential in a configured path or function name.
    safe.stack = redactSecrets(safe.stack, apiKey);
    return safe;
};

const describeFetchFailure = (error, timeoutMs, label) => {
    if (error && error.name === 'TimeoutError') {
        const timedOut = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
        timedOut.name = 'TimeoutError';
        return timedOut;
    }
    // Cancellation remains distinguishable from a timeout; the public boundary rebuilds the error.
    return error instanceof Error || error?.name === 'AbortError' ? error : new Error(String(error));
};

// Capture before the first await. Only the selected provider's credential is read/decrypted, once.
const snapshotAiSettings = (store, requestedProvider) => {
    try {
        const provider = requestedProvider || store.get('AI_PROVIDER') || 'gemini';
        const values = { AI_PROVIDER: provider };
        for (const key of ['AI_PROVIDER_PRESET', 'OPENAI_API_URL', 'OPENAI_API_MODEL', 'OPENAI_API_TEMPERATURE',
            'OPENAI_API_STREAM', 'GEMINI_API_URL', 'GEMINI_API_MODEL']) values[key] = store.get(key);
        const credentialKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
        const apiKey = store.get(credentialKey);
        values[credentialKey] = apiKey;
        return { get: (key) => values[key], apiKey };
    } catch {
        // Credential providers may throw before a key has been captured; no safe exact-key context exists yet.
        throw new Error('AI settings could not be read');
    }
};

module.exports = { MAX_ERROR_BODY_CHARS, describeFetchFailure, redactSecrets, redactUrl, sanitizeAiError, snapshotAiSettings };
