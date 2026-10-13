import type { ModRuntimeInfo } from '../types';
import { createAiFetch } from '../../services/aiNativeFetch';
import { isAiConfigured, readAiSettings } from '../../services/aiSettings';
import {
    detectOpenAICompatibleProvider,
    normalizeChatCompletionsUrl,
    resolveOpenAICompatibleModel,
    sendOpenAICompatibleRequest,
} from '../../../shared/openAICompatibleRequest.mjs';
import type {
    FoliumAiCompletionRequest,
    FoliumAiCompletionResult,
    FoliumAiService,
    FoliumAiTarget,
    FoliumContextKind,
} from './contract';

// src/mods/folium/ai.ts
// `folium.ai`: one prompt through the AI service the user configured in the
// host's own AI settings, so a mod never has to hold a credential of its own.
//
// The request goes out from whichever window the mod runs in, through
// createAiFetch. Two reasons it cannot work the way the other services do:
//
//   - The Android build has no Node main process to route through, and a plain
//     fetch from its WebView is stopped by CORS. The native bridge is what
//     makes an AI call possible there at all, so this service has to be
//     reachable on every target rather than being desktop-only.
//   - The host's own AI features already work this way, so a request from a mod
//     behaves like one from the app: same credentials, same endpoint quirks,
//     and Settings → AI stays the single place to configure it.
//
// The credential never leaves this module: read per request, handed straight to
// the transport, and absent from every result, error and log line. A mod can
// ask whether one is configured — it can never read it back.
//
// The three imports above are pure helpers with no side effects (shared request
// plumbing, the AI settings reader, the fetch shim); nothing here reaches for an
// app store, so this service loads in the export window too.

const AI_PERMISSION = 'ai.request';

// Same endpoint the host's own AI features use. The Gemini model is a host
// decision — its settings expose no model field for that provider — so it is
// pinned here rather than left to the caller.
const GEMINI_ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_TEMPERATURE = 0.7;

/** What the host would ask right now, and whether it has the credential to do it. */
const readTarget = (): { target: FoliumAiTarget; configured: boolean } => {
    const settings = readAiSettings();
    const configured = isAiConfigured(settings);
    if (settings.provider === 'openai') {
        const apiUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);
        return {
            target: {
                provider: 'openai',
                model: resolveOpenAICompatibleModel(apiUrl, settings.openaiApiModel),
            },
            configured,
        };
    }
    return { target: { provider: 'gemini', model: GEMINI_MODEL }, configured };
};

/*
 * Errors are prefixed codes, like the rest of Folium (`permission-denied:…`),
 * so the mod recognizes the case and localizes it. Provider detail rides along
 * after the code: a gateway that repeats the Authorization header or the key in
 * an error body must not be able to push a credential into a toast, a log or a
 * panel, so it is stripped first.
 */
const redact = (text: string): string => String(text)
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[redacted]')
    .replace(/([?&](?:key|api[_-]?key|token|access_token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/("?(?:api[_-]?key|authorization|token)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi, '$1[redacted]');

const readErrorDetail = async (response: Response): Promise<string> => {
    const rawText = await response.text().catch(() => '');
    try {
        const parsed = JSON.parse(rawText) as { error?: unknown; message?: unknown } | null;
        const error = parsed?.error;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
            return (error as { message: string }).message;
        }
        if (typeof parsed?.message === 'string') return parsed.message;
    } catch {
        // Not JSON: report the body as-is.
    }
    return rawText.trim();
};

const failWithResponse = async (response: Response): Promise<never> => {
    const detail = redact(await readErrorDetail(response)).slice(0, 300);
    throw new Error(`ai-http-error:${response.status}${detail ? ` ${detail}` : ''}`);
};

const describeUnexpected = (error: unknown): Error => {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (name === 'TimeoutError' || name === 'AbortError' || /abort/i.test(message)) {
        return new Error('ai-aborted');
    }
    return new Error(`ai-request-failed: ${redact(message).slice(0, 300)}`);
};

/** The model's answer out of an OpenAI-compatible response body. */
const extractText = (payload: unknown): string => {
    const choice = (payload as { choices?: { message?: unknown }[] } | null)?.choices?.[0];
    const message = choice?.message as { content?: unknown; refusal?: unknown } | undefined;
    if (!message) return '';
    if (typeof message.refusal === 'string' && message.refusal.trim()) {
        throw new Error(`ai-refused: ${redact(message.refusal).slice(0, 300)}`);
    }
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => (part && typeof part === 'object' ? String((part as { text?: unknown }).text ?? '') : ''))
            .join('');
    }
    return '';
};

const runOpenAi = async (request: FoliumAiCompletionRequest, send: typeof fetch): Promise<string> => {
    const settings = readAiSettings();
    const apiKey = settings.openaiApiKey.trim();
    if (!apiKey) throw new Error('ai-not-configured');

    const apiUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);
    const model = resolveOpenAICompatibleModel(apiUrl, settings.openaiApiModel);
    const requested = Number(request.temperature);
    const configured = Number.parseFloat(settings.openaiApiTemperature);
    const temperature = Number.isFinite(requested)
        ? Math.min(2, Math.max(0, requested))
        : Number.isFinite(configured) ? configured : DEFAULT_TEMPERATURE;

    const response = await sendOpenAICompatibleRequest({
        apiUrl,
        provider: detectOpenAICompatibleProvider(apiUrl),
        body: {
            model,
            messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.prompt },
            ],
            temperature,
            ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
            // Only OpenAI itself takes json_schema; the long tail of compatible
            // endpoints rejects it outright, so everyone gets plain JSON mode.
            ...(request.json === false ? {} : { response_format: { type: 'json_object' } }),
        },
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            signal: request.signal,
        },
        fetchImpl: send,
    });

    if (!response.ok) return failWithResponse(response);
    const payload = await response.json().catch(() => {
        throw new Error('ai-bad-response (not JSON)');
    });
    const text = extractText(payload);
    if (!text.trim()) throw new Error('ai-empty-response');
    return text;
};

const runGemini = async (request: FoliumAiCompletionRequest, send: typeof fetch): Promise<string> => {
    const apiKey = readAiSettings().geminiApiKey.trim();
    if (!apiKey) throw new Error('ai-not-configured');

    const response = await send(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ parts: [{ text: request.prompt }] }],
            generationConfig: {
                ...(request.json === false ? {} : { responseMimeType: 'application/json' }),
                ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
            },
        }),
        signal: request.signal,
    });

    if (!response.ok) return failWithResponse(response);
    const data = await response.json().catch(() => {
        throw new Error('ai-bad-response (not JSON)');
    });
    const parts = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)
        ?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
        ? parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('')
        : '';
    if (!text.trim()) throw new Error('ai-empty-response');
    return text;
};

export const createFoliumAiService = (mod: ModRuntimeInfo, context: FoliumContextKind): FoliumAiService => Object.freeze({
    isConfigured: () => isAiConfigured(readAiSettings()),
    describe: () => {
        const { target, configured } = readTarget();
        return configured ? target : null;
    },
    complete: async (request: FoliumAiCompletionRequest): Promise<FoliumAiCompletionResult> => {
        if (!mod.permissions.includes(AI_PERMISSION)) {
            throw new Error(`permission-denied:${AI_PERMISSION}`);
        }
        if (context !== 'main') throw new Error(`ai-unavailable-in-${context}-context`);
        if (!request || typeof request.system !== 'string' || typeof request.prompt !== 'string') {
            throw new Error('ai-complete requires { system: string, prompt: string }');
        }
        const { target, configured } = readTarget();
        if (!configured) throw new Error('ai-not-configured');

        const send = createAiFetch();
        try {
            const text = target.provider === 'openai'
                ? await runOpenAi(request, send)
                : await runGemini(request, send);
            return { text, target };
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('ai-')) throw error;
            throw describeUnexpected(error);
        }
    },
});
