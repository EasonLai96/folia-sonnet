import { DualTheme, Theme } from "../types";
import { applyStoredAnimationIntensityToDualTheme } from "./themePreferences";
import { sanitizeDualTheme } from "./themeSanitizer";
import { getWebAiProvider } from "./runtimeConfig";
import { resolveFoliaApiUrl } from "./webApi";
import { recordAiThemeAttempt, type AiThemeTrigger } from "../utils/aiThemeDiagnostics";
import { generateThemeWithConfiguredAi, isLocalAiThemeAvailable } from "./aiThemeClient";
import { pullAiCloudCache, pushAiCloudCache } from "./aiCloudCache";
import {
    STAGE_CACHE_KIND,
    buildStagePolicy,
    fingerprintStage,
    normalizeStagePayload,
    notifyCloudCacheHit,
    requestStage,
    resolveStageLyricSource,
    type StageLyricLine,
} from "./aiStage";
import { readDirectorSettings } from "./lyricDirector/state";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
};

/*
 * 云端缓存条目的形状校验放在 services/aiStage.ts —— 缓存是任何人都能推的，
 * 先校验再用，形状不对就跟没命中一样。
 */

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
  options?: {
    isPureMusic?: boolean;
    songTitle?: string;
    artist?: string;
    album?: string | null;
    trigger?: AiThemeTrigger;
    lines?: readonly StageLyricLine[];
  }
): Promise<DualTheme> => {
  const provider = getWebAiProvider();
  const trigger = options?.trigger ?? 'unknown';
  const startedAt = Date.now();
  // HTTP 失败那条在分支里已经记过，catch 只补没走到响应的（网络错误、解析失败），不重复记。
  let recorded = false;

  const directorSettings = readDirectorSettings();
  const blockedModes = directorSettings.blockedModes ?? [];
  /*
   * 歌词正文优先用调用方给的歌词行，没有才退回 `lyricsText` 字符串 ——
   * 两处必须拼出同一段文字，否则与导演链路的指纹对不上，一次请求省下的
   * 那次模型调用就没了。
   */
  const lyricLines = options?.lines ?? [];
  const resolved = resolveStageLyricSource({
      lines: lyricLines as { fullText?: string }[],
      isPureMusic: options?.isPureMusic === true,
      songTitle: options?.songTitle ?? '',
  });
  const cacheFingerprint = fingerprintStage(
    resolved.lyricSource,
    buildStagePolicy({
      isPureMusic: resolved.isPureMusic,
      hint: directorSettings.userHint,
      blocked: blockedModes,
    }),
  );

  try {
    /*
     * 先问缓存 —— 命中就不用调模型了，没填 Key 的人靠这个也能出主题。
     *
     * 这里自己拉一次、不直接进 requestStage，是因为「桌面版走 Electron 主进程」
     * 这条路拿不到合并 prompt：它只能出主题，出不了动画决策，也就没法复用
     * requestStage 内部的统一编排。
     */
    const hit = await pullAiCloudCache(STAGE_CACHE_KIND, cacheFingerprint);
    const cachedTheme = hit.status === 'hit'
      ? normalizeStagePayload(hit.payload, blockedModes)?.theme ?? null
      : null;
    if (cachedTheme) {
      recorded = true;
      recordAiThemeAttempt({
        provider,
        trigger,
        stage: 'cloud-cache',
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      notifyCloudCacheHit();
      return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(cachedTheme));
    }

    // Check if running in Electron environment
    if ((window as any).electron && typeof (window as any).electron.generateTheme === 'function') {
      const dualTheme = await (window as any).electron.generateTheme(lyricsText, options);
      const theme = sanitizeDualTheme(dualTheme);
      recordAiThemeAttempt({ provider, trigger, stage: 'request', ok: true, durationMs: Date.now() - startedAt });
      void pushAiCloudCache(STAGE_CACHE_KIND, cacheFingerprint, { theme }, { songTitle: options?.songTitle });
      return theme;
    }

    /*
     * 设备本地直连：安卓没有 Electron 主进程，也没有部署自带的 generate-theme 端点，
     * 两条路都走不通 —— 这就是「AI 主题」在 App 里一直是灰的的原因。
     *
     * 用户在设置里填了自己的 Key 之后走这条，请求直接从设备发出去（安卓经原生
     * OkHttp 桥绕开 CORS）。主题与歌词动画合成一次请求（services/aiStage.ts）：
     * 一次往返两份答案，另一半留给动画导演，切一首歌只烧一次调用。
     */
    if (isLocalAiThemeAvailable()) {
      const stage = await requestStage({
        song: {
          title: options?.songTitle ?? '',
          artist: options?.artist ?? '',
          album: options?.album ?? null,
        },
        lines: lyricLines as { fullText?: string }[],
        isPureMusic: resolved.isPureMusic,
        songTitle: options?.songTitle,
        require: 'theme',
      });
      if (!stage.theme) throw new Error('AI 没有返回可用的主题。');
      recorded = true;
      recordAiThemeAttempt({
        provider,
        trigger,
        stage: stage.source === 'cloud' ? 'cloud-cache' : 'request',
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return applyStoredAnimationIntensityToDualTheme(stage.theme);
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
    /*
     * 存进去的是「未经动画强度处理」的原始那份，取出来时才叠加。
     * 存已处理的、取时再处理一遍，强度会被叠乘，越用越偏。
     */
    const theme = sanitizeDualTheme(dualTheme as DualTheme);
    void pushAiCloudCache(STAGE_CACHE_KIND, cacheFingerprint, { theme }, { songTitle: options?.songTitle });
    return applyStoredAnimationIntensityToDualTheme(theme);
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
