import { DualTheme, Theme } from "../types";
import { applyStoredAnimationIntensityToDualTheme } from "./themePreferences";
import { sanitizeDualTheme } from "./themeSanitizer";
import { getWebAiProvider } from "./runtimeConfig";
import { resolveFoliaApiUrl } from "./webApi";
import { recordAiThemeAttempt, type AiThemeTrigger } from "../utils/aiThemeDiagnostics";
import { generateThemeWithConfiguredAi, isLocalAiThemeAvailable } from "./aiThemeClient";
import { fingerprintLyricSource, pullAiCloudCache, pushAiCloudCache } from "./aiCloudCache";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
};

/*
 * Cloud cache entries are untrusted input: they came off a server anyone can
 * push to. A shape check runs before they are let anywhere near the player —
 * a malformed payload is treated as a miss rather than an error.
 */
const isThemeShaped = (value: unknown): value is Theme => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const theme = value as Record<string, unknown>;
  return typeof theme.backgroundColor === 'string'
    && typeof theme.primaryColor === 'string';
};

const isDualThemeShaped = (value: unknown): value is DualTheme => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isThemeShaped(record.light) && isThemeShaped(record.dark);
};

export const isMissingAiApiKeyError = (error: unknown) => {
  const message = getErrorMessage(error);
  return /(?:openai_api_key|gemini_api_key|api key)/i.test(message)
    && /(?:not configured|missing|configure)/i.test(message);
};

/**
 * AI 主题生成。每次尝试（成功或失败）都记一条可公开的记录：provider、阶段、HTTP 状态、
 * 截断后的错误原文与耗时 —— 「偶尔生成失败」这类反馈靠它定位，不记提示词、歌词与 Key。
 */
export const generateThemeFromLyrics = async (
  lyricsText: string,
  options?: { isPureMusic?: boolean; songTitle?: string; trigger?: AiThemeTrigger }
): Promise<DualTheme> => {
  const provider = getWebAiProvider();
  const trigger = options?.trigger ?? 'unknown';
  const startedAt = Date.now();
  // HTTP 失败那条在分支里已经记过，catch 只补没走到响应的（网络错误、解析失败），不重复记。
  let recorded = false;

  /*
   * 云缓存的键取的是「喂给模型的那段歌词原文」的 MD5，纯音乐时喂的是标题 ——
   * 所以 policy 里要把这个区别带上，否则纯音乐和同名词曲会互相拿错答案。
   */
  const cacheFingerprint = fingerprintLyricSource(
    'theme',
    lyricsText,
    `pure:${options?.isPureMusic === true}`,
  );

  try {
    /* 先问缓存。命中就不用 Key 了 —— 没填 Key 的人靠这个也能出主题。 */
    const hit = await pullAiCloudCache('theme', cacheFingerprint);
    if (hit.status === 'hit' && isDualThemeShaped(hit.payload)) {
      recorded = true;
      recordAiThemeAttempt({
        provider,
        trigger,
        stage: 'cloud-cache',
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(hit.payload));
    }

    // Check if running in Electron environment
    if ((window as any).electron && typeof (window as any).electron.generateTheme === 'function') {
      const dualTheme = await (window as any).electron.generateTheme(lyricsText, options);
      const theme = sanitizeDualTheme(dualTheme);
      recordAiThemeAttempt({ provider, trigger, stage: 'request', ok: true, durationMs: Date.now() - startedAt });
      void pushAiCloudCache('theme', cacheFingerprint, theme, { songTitle: options?.songTitle });
      return theme;
    }

    /*
     * 设备本地直连：安卓没有 Electron 主进程，也没有部署自带的 generate-theme 端点，
     * 两条路都走不通 —— 这就是「AI 主题」在 App 里一直是灰的的原因。
     * 用户在设置里填了自己的 Key 之后走这条，请求直接从设备发出去（安卓经原生 OkHttp 桥
     * 绕开 CORS）。它自己会记诊断，这里不要再记一条。
     */
    if (isLocalAiThemeAvailable()) {
      const dualTheme = await generateThemeWithConfiguredAi(lyricsText, options);
      void pushAiCloudCache('theme', cacheFingerprint, dualTheme, { songTitle: options?.songTitle });
      return dualTheme;
    }

    const endpoint = resolveFoliaApiUrl(provider === 'openai' ? 'generate-theme_openai' : 'generate-theme');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lyricsText, ...options }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = (errorData as { error?: string }).error || `HTTP ${response.status}`;
      recorded = true;
      recordAiThemeAttempt({
        provider,
        trigger,
        stage: 'web-endpoint',
        ok: false,
        status: response.status,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      throw new Error(message || 'Failed to generate theme');
    }

    const dualTheme = await response.json();
    recordAiThemeAttempt({
      provider,
      trigger,
      stage: 'request',
      ok: true,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    const theme = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme as DualTheme));
    void pushAiCloudCache('theme', cacheFingerprint, theme, { songTitle: options?.songTitle });
    return theme;
  } catch (error) {
    if (!recorded) {
      recordAiThemeAttempt({
        provider,
        trigger,
        stage: 'unknown',
        ok: false,
        error: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
    }
    console.error("Failed to generate theme via API:", error);
    throw error;
  }
};

// The AI connection the web OBS overlay (Dynamic AI mode) generates a theme with. The overlay runs
// in a separate browser context, so it takes an explicit provider instead of reading anything from
// the app; the provider is selected by Docker runtime config or the Vite build fallback.
export interface ObsAiConfig {
  provider: 'gemini' | 'openai';
}

// OBS-overlay variant of generateThemeFromLyrics: keyless (the endpoint uses its own server env
// key), abortable, and with no Electron branch since the overlay is web-only. Used per song by the
// overlay; the caller falls back to the builtin theme if it rejects.
export const generateObsThemeFromLyrics = async (
  lyricsText: string,
  options: { isPureMusic?: boolean; songTitle?: string } | undefined,
  aiConfig: ObsAiConfig,
  signal?: AbortSignal,
): Promise<DualTheme> => {
  const endpoint = resolveFoliaApiUrl(aiConfig.provider === 'openai' ? 'generate-theme_openai' : 'generate-theme');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyricsText, ...(options ?? {}) }),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error || 'Failed to generate theme');
  }

  const dualTheme = await response.json();
  return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme as DualTheme));
};
