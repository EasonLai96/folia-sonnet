// src/services/aiSettings.ts
// 移动端（Capacitor）没有 Electron 主进程，AI 凭据只能存在渲染层。
// 桌面版走的是主进程 store；这里用 localStorage 提供同一组字段，
// 让共享的请求逻辑（shared/lyricSegmentationService.mjs 等）可以照常复用。

import { normalizeChatCompletionsUrl, resolveOpenAICompatibleModel } from '../../shared/openAICompatibleRequest.mjs';
import {
    GEMINI_DEFAULT_MODEL,
    resolveGeminiGenerateContentUrl as resolveGeminiUrl,
} from '../../shared/geminiEndpoint.mjs';

export type AiProviderId = 'gemini' | 'openai' | 'deepseek';

/*
 * DeepSeek is just an OpenAI-compatible endpoint, but it is offered as a
 * provider of its own so the form only asks for a key: the URL is fixed here
 * and the model falls back to the flash one when the field is left blank.
 */
export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';

export interface AiSettings {
    provider: AiProviderId;
    geminiApiKey: string;
    /**
     * Gemini 的 API 请求地址，留空走默认（官方域名的反向代理）。
     *
     * 官方域名在不少网络里连不上，所以这个地址是可改的；模型不跟着变 ——
     * 设置里没有 Gemini 的模型字段，端点里的模型名由宿主决定（见 GEMINI_DEFAULT_MODEL）。
     */
    geminiApiUrl: string;
    openaiApiUrl: string;
    openaiApiKey: string;
    openaiApiModel: string;
    openaiApiTemperature: string;
    openaiApiStream: boolean;
    /** DeepSeek only needs the credential — URL and model are resolved. */
    deepseekApiKey: string;
}

const STORAGE_KEY = 'foliaAiProviderSettings';
export const AI_SETTINGS_CHANGED_EVENT = 'folia-ai-settings-changed';

export const DEFAULT_AI_SETTINGS: AiSettings = {
    provider: 'gemini',
    geminiApiKey: '',
    // 留空 = 用默认地址。写成常量反而会让「用户清空输入框」和「用默认」变成两回事。
    geminiApiUrl: '',
    openaiApiUrl: '',
    openaiApiKey: '',
    openaiApiModel: '',
    openaiApiTemperature: '0.7',
    openaiApiStream: false,
    deepseekApiKey: '',
};

export const isOpenAiCompatibleProvider = (value: AiProviderId): boolean => (
    value === 'openai' || value === 'deepseek'
);

const normalizeProvider = (value: unknown): AiProviderId => (
    value === 'openai' || value === 'deepseek' ? value : 'gemini'
);

const asText = (value: unknown, fallback = ''): string => (
    typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value)
);

export const readAiSettings = (): AiSettings => {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_AI_SETTINGS };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_AI_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<AiSettings> | null;
        if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AI_SETTINGS };
        return {
            provider: normalizeProvider(parsed.provider),
            geminiApiKey: asText(parsed.geminiApiKey),
            geminiApiUrl: asText(parsed.geminiApiUrl),
            openaiApiUrl: asText(parsed.openaiApiUrl),
            openaiApiKey: asText(parsed.openaiApiKey),
            openaiApiModel: asText(parsed.openaiApiModel),
            openaiApiTemperature: asText(parsed.openaiApiTemperature, DEFAULT_AI_SETTINGS.openaiApiTemperature),
            openaiApiStream: parsed.openaiApiStream === true,
            deepseekApiKey: asText(parsed.deepseekApiKey),
        };
    } catch {
        return { ...DEFAULT_AI_SETTINGS };
    }
};

export const writeAiSettings = (patch: Partial<AiSettings>): AiSettings => {
    const next: AiSettings = { ...readAiSettings(), ...patch };
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Quota or private mode: keep the in-memory value for this session.
        }
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AI_SETTINGS_CHANGED_EVENT, { detail: next }));
    }
    return next;
};

/** 当前配置能不能真的发请求：选中的 provider 必须有对应凭据。 */
export const isAiConfigured = (settings: AiSettings = readAiSettings()): boolean => {
    if (settings.provider === 'openai') return Boolean(settings.openaiApiKey.trim());
    if (settings.provider === 'deepseek') return Boolean(settings.deepseekApiKey.trim());
    return Boolean(settings.geminiApiKey.trim());
};

/** 实际要打的那个 chat/completions 地址：DeepSeek 的地址是写死的。 */
export const resolveAiChatCompletionsUrl = (settings: AiSettings = readAiSettings()): string => (
    settings.provider === 'deepseek'
        ? normalizeChatCompletionsUrl(DEEPSEEK_API_BASE)
        : normalizeChatCompletionsUrl(settings.openaiApiUrl)
);

/**
 * 实际要打的那条 generateContent 端点。
 *
 * 拼地址的规则在 shared/geminiEndpoint.mjs 里（渲染进程与主进程共用一份），
 * 这里只负责把当前设置喂进去 —— 别在任何调用点自己拼一次，那会让「填了地址却没生效」
 * 变成最难查的一类问题：一半功能走新地址、另一半还打官方域名。
 */
export const resolveGeminiGenerateContentUrl = (settings: AiSettings = readAiSettings()): string => (
    resolveGeminiUrl(settings.geminiApiUrl, GEMINI_DEFAULT_MODEL)
);

/** 实际要用的模型：DeepSeek 留空时回落到 flash。 */
export const resolveAiModel = (settings: AiSettings = readAiSettings()): string => {
    const apiUrl = resolveAiChatCompletionsUrl(settings);
    if (settings.provider === 'deepseek') {
        return settings.openaiApiModel.trim() || DEEPSEEK_DEFAULT_MODEL;
    }
    return resolveOpenAICompatibleModel(apiUrl, settings.openaiApiModel);
};

/** 当前 provider 对应的密钥（DeepSeek 与 OpenAI 分开存，互不覆盖）。 */
export const resolveAiApiKey = (settings: AiSettings = readAiSettings()): string => (
    settings.provider === 'deepseek'
        ? settings.deepseekApiKey.trim()
        : settings.openaiApiKey.trim()
);

/** 共享的歌词分词服务读的是 env 形状，这里把表单字段映射过去。 */
export const buildAiEnv = (settings: AiSettings = readAiSettings()): Record<string, string | undefined> => ({
    // The shared transports only know "gemini" and "openai"; DeepSeek is the
    // latter with its own endpoint, so it is announced as openai downstream.
    AI_PROVIDER: settings.provider === 'deepseek' ? 'openai' : settings.provider,
    GEMINI_API_KEY: settings.geminiApiKey.trim() || undefined,
    /*
     * 共享的分词服务（shared/lyricSegmentationService.mjs）读的是 env：它不在渲染层，
     * 拿不到 localStorage。留空它也走默认地址，与这条设置「留空 = 默认」的语义一致。
     */
    GEMINI_API_URL: settings.geminiApiUrl.trim() || undefined,
    OPENAI_API_URL: isOpenAiCompatibleProvider(settings.provider)
        ? resolveAiChatCompletionsUrl(settings)
        : undefined,
    OPENAI_API_KEY: isOpenAiCompatibleProvider(settings.provider)
        ? (resolveAiApiKey(settings) || undefined)
        : undefined,
    OPENAI_API_MODEL: isOpenAiCompatibleProvider(settings.provider)
        ? resolveAiModel(settings)
        : undefined,
    OPENAI_API_TEMPERATURE: settings.openaiApiTemperature,
});
