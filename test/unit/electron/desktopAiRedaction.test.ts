import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Exercise the actual CJS client and extracted production IPC callbacks, without starting Electron or IO.
const root = process.env.P04_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));
const client = require('./electron/aiTextClient.cjs');
const requestText = require('./electron/ai/requestText.cjs');
const segmentation = require('./shared/lyricSegmentationPrompt.cjs');
const secret = 'synthetic-key +/秘密?=29';
const encoded = encodeURIComponent(secret).toLowerCase();
const formEncoded = new URLSearchParams({ key: secret }).toString().slice(4);
const reflected = `${secret} | ${encoded} | ${formEncoded}`;
const settings = (overrides = {}) => ({
    AI_PROVIDER: 'openai', OPENAI_API_KEY: secret, OPENAI_API_URL: 'https://api.openai.com/v1',
    OPENAI_API_MODEL: 'synthetic-model', ...overrides,
});
const storeOf = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });
const options = (customFetch: (...args: any[]) => any, values = settings()) => ({
    store: storeOf(values), task: 'theme', systemPrompt: 'synthetic system', sourcePrompt: 'synthetic lyrics',
    answerTokens: 8, customFetch,
});
const body = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const inspectError = (error: any): string => JSON.stringify({ name: error.name, message: error.message, stack: error.stack, ...error });
const noSecret = (text: string) => {
    for (const value of [secret, encoded, formEncoded]) expect(text).not.toContain(value);
};
const captureLogs = () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args) => {
        lines.push(args.map((arg) => arg instanceof Error ? inspectError(arg) : String(arg)).join(' '));
    });
    return lines;
};
const failure = async (promise: Promise<any>) => {
    try { await promise; } catch (error) { return error as Error & { cause?: unknown }; }
    throw new Error('Expected the synthetic request to fail');
};
afterEach(() => vi.restoreAllMocks());

// VM evaluates only the registered production callback; all collaborators are pure mocks or real parsers.
const ipcHandler = (name: 'generate-theme' | 'segment-lyrics' | 'ai-test-connection', values: Record<string, unknown>, overrides: Record<string, any> = {}) => {
    const source = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
    const start = source.indexOf(`ipcMain.handle('${name}'`);
    const end = source.indexOf('\n});', start) + '\n});'.length;
    let handler: (...args: any[]) => Promise<any>;
    const context = {
        ipcMain: { handle: (_name: string, callback: any) => { handler = callback; } },
        store: storeOf(values), aiCredentials: { settingsView: storeOf(values) }, console,
        ...requestText, ...segmentation,
        runAiJsonCompletion: client.runAiJsonCompletion, runGeminiThemeCompletion: client.runGeminiThemeCompletion,
        aiProviderLabel: client.aiProviderLabel,
        fetchWithOptionalSystemProxy: async () => body('{}'),
        buildThemeSystemPrompt: () => 's', buildThemeSourcePrompt: () => 'p',
        sanitizeGeneratedDualTheme: (value: any) => value,
        THEME_JSON_SCHEMA: {}, THEME_JSON_SCHEMA_NAME: 'theme', THEME_MAX_OUTPUT_TOKENS: 8,
        getGeminiResponseSchema: () => ({}),
        ...overrides,
    };
    vm.runInNewContext(source.slice(start, end), context);
    return (...args: any[]) => handler!({}, ...args);
};

describe('desktop AI request boundaries', () => {
    it.each(['theme', 'segmentation'])('redacts unlabeled literal/percent/form HTTP reflections for %s', async (task) => {
        const logs = captureLogs();
        const error = await failure(client.runAiJsonCompletion({ ...options(async () => new Response(JSON.stringify({ error: { message: reflected } }), { status: 401 })), task }));
        expect(error.message).toContain('401');
        noSecret(inspectError(error) + logs.join('\n'));
        expect(error.message).toContain('[redacted]');
    });

    it.each(['k', '+', '秘密'])('redacts short key %s in literal, percent, form and mixed copies', async (key) => {
        const logs = captureLogs();
        const percent = Array.from(new TextEncoder().encode(key)).map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
        const formCopy = new URLSearchParams({ key }).toString().slice(4);
        const mixed = Array.from(key).map((character, index) => index % 2 ? encodeURIComponent(character).toLowerCase() : character).join('');
        const error = await failure(client.runAiJsonCompletion(options(async () => new Response(
            JSON.stringify({ error: { message: `reflected ${key} ${percent} ${formCopy} ${mixed}` } }), { status: 401 },
        ), settings({ OPENAI_API_KEY: key }))));
        for (const copy of [key, percent, formCopy, mixed]) expect(error.message + logs.join('\n')).not.toContain(copy);
        expect(error.message).toContain('[redacted]');
    });

    it('also scrubs a fixed JSON diagnostic when a short key happens to occur inside it', async () => {
        captureLogs();
        const error = await failure(client.runAiJsonCompletion(options(async () => new Response('not JSON'), settings({ OPENAI_API_KEY: 'i' }))));
        expect(error.message).not.toContain('i');
        expect(error.message).toContain('[redacted]');
    });

    it('keeps parameter detection private when a one-character key overlaps the rejected knob', async () => {
        const logs = captureLogs();
        let calls = 0;
        const answer = await client.runAiJsonCompletion({ ...options(async (_url, init) => {
            calls += 1;
            const sent = JSON.parse(init.body);
            if (sent.reasoning_effort !== undefined) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: reasoning_effort" } }), { status: 400 });
            if (sent.chat_template_kwargs !== undefined) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: chat_template_kwargs" } }), { status: 400 });
            return body('{}');
        }, settings({ OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://short-key-ladder.test/v1' })), task: 'segmentation' });
        expect(answer).toBe('{}');
        expect(calls).toBeGreaterThan(1);
        expect(logs.join('\n')).not.toContain('chat_template_kwargs');
    });

    it('keeps Gemini ladder evidence private when the key overlaps thinking configuration', async () => {
        const logs = captureLogs();
        let calls = 0;
        const key = 'thinking';
        const result = await client.runAiJsonCompletion(options(async (_url, init) => {
            calls += 1;
            const sent = JSON.parse(init.body);
            if (sent.generationConfig.thinkingConfig) return new Response('Unsupported thinking configuration', { status: 400 });
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
        }, settings({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: key, GEMINI_API_MODEL: 'gemini-synthetic-unknown' })));
        expect(result).toBe('{}');
        expect(calls).toBeGreaterThan(1);
        expect(logs.join('\n')).not.toContain(key);
        const error = await failure(client.runAiJsonCompletion(options(async () => new Response('reflected thinking', { status: 401 }),
            settings({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: key, GEMINI_API_MODEL: 'gemini-synthetic-unknown' }))));
        expect(inspectError(error)).not.toContain(key);
        expect(error.message).toContain('[redacted]');
    });

    it.each(['synthetic-quote"-key', 'synthetic-backslash\\-key'])('redacts JSON-escaped fallback error bodies for %s', async (key) => {
        const logs = captureLogs();
        const jsonCopy = JSON.stringify(key).slice(1, -1);
        const mixedCopy = Array.from(key).map((character, index) => index % 2 && /[a-z]/i.test(character)
            ? `%${character.charCodeAt(0).toString(16)}` : JSON.stringify(character).slice(1, -1)).join('');
        const error = await failure(client.runAiJsonCompletion(options(async () => new Response(
            JSON.stringify({ error: { detail: key } }), { status: 401 },
        ), settings({ OPENAI_API_KEY: key }))));
        expect(error.message).not.toContain(jsonCopy);
        expect(error.message).not.toContain(key);
        expect(error.message).toContain('[redacted]');
        const mixedError = await failure(client.runAiJsonCompletion(options(async () => new Response(mixedCopy, { status: 401 }), settings({ OPENAI_API_KEY: key }))));
        expect(mixedError.message).not.toContain(mixedCopy);
        expect(mixedError.message).toContain('[redacted]');
        expect(logs.join('\n')).not.toContain(jsonCopy);
    });

    it('does not leak V8 malformed-JSON prefixes', async () => {
        captureLogs();
        const error = await failure(client.runAiJsonCompletion(options(async () => new Response(secret + ' malformed JSON'))));
        expect(error.message).not.toContain('synthetic');
        expect(error.message).toBe('AI provider returned invalid JSON');
    });

    it('rebuilds fetch failures without raw stack, cause, or transport fields', async () => {
        captureLogs();
        const raw = Object.assign(new Error(reflected, { cause: new Error(secret) }), { headers: { Authorization: secret } });
        raw.stack = `RAW_STACK_${secret}`;
        const error = await failure(client.runAiJsonCompletion(options(async () => { throw raw; })));
        noSecret(inspectError(error));
        expect(error).not.toBe(raw);
        expect(error.cause).toBeUndefined();
        expect((error as any).headers).toBeUndefined();
        expect(error.stack).not.toContain('RAW_STACK');
    });

    it('preserves AbortError identity without retaining raw cause', async () => {
        captureLogs();
        const raw = new Error(reflected, { cause: secret }); raw.name = 'AbortError';
        const error = await failure(client.runAiJsonCompletion(options(async () => { throw raw; })));
        expect(error.name).toBe('AbortError');
        expect(error.cause).toBeUndefined();
        noSecret(inspectError(error));
    });

    it('snapshots the selected key/settings before await and does not read the other credential', async () => {
        const logs = captureLogs();
        const values = settings({ OPENAI_API_MODEL: secret });
        const reads: string[] = [];
        let entered!: () => void; const pending = new Promise<void>((resolve) => { entered = resolve; });
        let release!: (response: Response) => void;
        let sentKey = '';
        const request = client.runAiJsonCompletion({ ...options(async (_url, init) => {
            sentKey = init.headers.Authorization; entered();
            return new Promise<Response>((resolve) => { release = resolve; });
        }), store: { get: (key: string) => { reads.push(key); return (values as any)[key]; } } });
        await pending;
        values.OPENAI_API_KEY = 'replacement-key'; values.OPENAI_API_MODEL = 'replacement-model';
        release(new Response(JSON.stringify({ error: { message: reflected } }), { status: 401 }));
        const error = await failure(request);
        expect(sentKey).toBe(`Bearer ${secret}`);
        expect(reads.filter((key) => key === 'OPENAI_API_KEY')).toHaveLength(1);
        expect(reads).not.toContain('GEMINI_API_KEY');
        noSecret(inspectError(error) + logs.join('\n'));
    });

    it.each(['gemini', 'anthropic'])('covers %s HTTP reflections and malformed response JSON', async (provider) => {
        const logs = captureLogs();
        const values = provider === 'gemini'
            ? settings({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: secret, GEMINI_API_MODEL: 'synthetic-model' })
            : settings({ OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_MODEL: 'claude-synthetic' });
        const httpError = await failure(client.runAiJsonCompletion(options(async () => new Response(reflected, { status: 401 }), values)));
        noSecret(inspectError(httpError) + logs.join('\n'));
        const parseError = await failure(client.runAiJsonCompletion(options(async () => new Response(secret + ' malformed'), values)));
        expect(parseError.message).toBe('AI provider returned invalid JSON');
    });

    it('redacts SSE provider errors and response-derived refusal diagnostics', async () => {
        captureLogs();
        const streamValues = settings({ OPENAI_API_URL: 'https://api.deepseek.com/v1', OPENAI_API_MODEL: 'deepseek-chat', OPENAI_API_STREAM: true });
        const stream = await failure(client.runAiJsonCompletion(options(async () => new Response(`data: ${JSON.stringify({ error: { message: reflected } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }), streamValues)));
        noSecret(inspectError(stream));
        const refusal = await failure(client.runAiJsonCompletion(options(async () => new Response(JSON.stringify({ choices: [{ message: { refusal: reflected } }] })))));
        noSecret(inspectError(refusal));
    });

    it('sanitizes connection-test text, model fields, parse errors and logs', async () => {
        const logs = captureLogs();
        const input = { provider: 'openai', apiKey: secret, apiUrl: 'https://api.openai.com/v1', model: secret };
        const result = await client.runAiConnectionTest(input, { customFetch: async () => new Response(JSON.stringify({ model: reflected, choices: [{ message: { content: reflected } }] })) });
        expect(result.ok).toBe(true);
        noSecret(JSON.stringify(result) + logs.join('\n'));
        const invalid = await client.runAiConnectionTest(input, { customFetch: async () => new Response(secret + ' malformed') });
        expect(invalid.error).not.toContain('synthetic');
    });

    it('sanitizes before clipping diagnostics without changing successful segmentation content', async () => {
        captureLogs();
        // A credential longer than the diagnostic cutoff must be masked before clipping.
        const key = 'synthetic-' + 'x'.repeat(600);
        const scrub = (text: string) => requestText.redactSecrets(text, key);
        const raw = ' '.repeat(170) + key + ' invalid';
        let error: any;
        try { segmentation.parseSegmentationResponse(raw, ['a'], scrub); } catch (caught) { error = caught; }
        expect(error.message).not.toContain('synthetic-');
        expect(error.message).toContain('[redacted]');
        const success = segmentation.parseSegmentationResponse(JSON.stringify({ lines: [[key]] }), [key], scrub);
        expect(success.boundaries).toEqual([[key]]);
    });

    it('fails closed if the settings/credential provider throws before a key snapshot exists', async () => {
        captureLogs();
        const error = await failure(client.runAiJsonCompletion({ ...options(async () => body('{}')),
            store: { get: () => { throw new Error(reflected, { cause: secret }); } },
        }));
        expect(error.message).toBe('AI settings could not be read');
        noSecret(inspectError(error));
        expect(error.cause).toBeUndefined();
    });

    it('the dedicated Gemini theme API snapshots Gemini even when the default selection is OpenAI', async () => {
        captureLogs();
        let sentKey = '';
        const result = await client.runGeminiThemeCompletion({
            store: storeOf(settings({ GEMINI_API_KEY: secret })), systemPrompt: 's', sourcePrompt: 'p', answerTokens: 8,
            customFetch: async (_url: string, init: any) => {
                sentKey = init.headers['x-goog-api-key'];
                return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"light":{},"dark":{}}' }] } }] }));
            },
        });
        expect(sentKey).toBe(secret);
        expect(result).toEqual({ light: {}, dark: {} });
    });

    it('theme IPC logs and throws only sanitized model-JSON errors', async () => {
        const logs = captureLogs();
        const values = settings();
        const handler = ipcHandler('generate-theme', values, { runAiJsonCompletion: async () => {
            values.OPENAI_API_KEY = 'rotated-key';
            return secret + ' invalid';
        } });
        const error = await failure(handler('lyrics'));
        expect(error.message).toBe('AI provider returned invalid JSON');
        expect(logs.join('\n')).not.toContain('synthetic');
        noSecret(inspectError(error));
    });

    it('connection-test IPC does not log an unexpected raw error outside the client', async () => {
        const logs = captureLogs();
        const values = settings();
        const handler = ipcHandler('ai-test-connection', values, {
            isTrustedMainWindowContents: () => true,
            aiCredentials: { resolveTestApiKey: () => ({ apiKey: secret }) },
            runAiConnectionTest: async () => { throw new Error(reflected, { cause: secret }); },
        });
        const result = await handler({ provider: 'openai', apiKey: secret });
        expect(result.ok).toBe(false);
        noSecret(JSON.stringify(result) + logs.join('\n'));
    });

    it('segmentation IPC scrubs parse diagnostics and raw-response logs before truncation', async () => {
        const logs = captureLogs();
        const key = 'synthetic-' + 'q'.repeat(5000);
        const values = settings({ OPENAI_API_KEY: key });
        const handler = ipcHandler('segment-lyrics', values, { runAiJsonCompletion: async () => {
            values.OPENAI_API_KEY = 'rotated-key';
            return ' '.repeat(170) + key + ' invalid';
        } });
        const error = await failure(handler(['lyrics']));
        expect(error.message).not.toContain('synthetic');
        expect(logs.join('\n')).not.toContain('synthetic');
        expect(logs.join('\n')).toContain('[redacted]');
    });
});
