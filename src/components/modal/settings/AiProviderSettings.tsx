import React, { useState, useSyncExternalStore } from 'react';
import { Check, Cloud, ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readAiSettings,
    writeAiSettings,
    type AiProviderId,
} from '../../../services/aiSettings';
import { GEMINI_DEFAULT_API_BASE } from '../../../../shared/geminiEndpoint.mjs';
import { resolveAiCloudCacheUrl } from '../../../services/aiCloudCache';
import { STAGE_CACHE_KIND } from '../../../services/aiStage';
import {
    getFoliaCloudSettingsVersion,
    readFoliaCloudSettings,
    subscribeFoliaCloudSettings,
    updateFoliaCloudSettings,
} from '../../../services/foliaCloud';
import { createAiFetch } from '../../../services/aiNativeFetch';
import {
    getDirectorStateVersion,
    readDirectorSettings,
    subscribeDirectorState,
    updateDirectorSettings,
} from '../../../services/lyricDirector/state';
import { listDirectorModes } from '../../../services/lyricDirector/catalog';
import {
    testConfiguredAiConnection,
    type AiConnectionTestResult,
} from '../../../services/aiThemeClient';

// src/components/modal/settings/AiProviderSettings.tsx
// 安卓/网页版没有 Electron 主进程，AI 凭据由用户自己填并保存在本机 —— 这是「AI 主题」在
// App 里能用的前提（generateThemeFromLyrics 的第三条路，见 services/aiThemeClient.ts）。
// 桌面版沿用主进程的 AI 设置，这里不参与。

type AiProviderSettingsProps = {
    settingsCardClass: string;
    isDaylight: boolean;
};

type TestState = 'idle' | 'running' | 'done';

/*
 * A probe key the cache can be asked about. It is a well-known MD5, never
 * written to, so "connected" only ever means "the endpoint answered".
 */
const CLOUD_CACHE_PROBE_KEY = '00000000000000000000000000000000';

/*
 * 选完供应商，下一步就是去拿 Key。
 *
 * 各家开放平台的入口都不好找，而且改过好几次 —— 与其让用户自己去搜，不如把链接
 * 直接摆在选项下面。
 */
const PROVIDER_CONSOLE_URLS: Record<AiProviderId, string> = {
    gemini: 'https://aistudio.google.com/apikey',
    deepseek: 'https://platform.deepseek.com/api_keys',
    openai: 'https://platform.openai.com/api-keys',
};

const providerLabelOf = (provider: AiProviderId, t: (key: string) => string): string => (
    provider === 'deepseek'
        ? 'DeepSeek'
        : provider === 'openai'
            ? t('options.otherCompatibleApi')
            : 'Google Gemini'
);

const AiProviderSettings: React.FC<AiProviderSettingsProps> = ({ settingsCardClass, isDaylight }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState(() => readAiSettings());
    const [testState, setTestState] = useState<TestState>('idle');
    const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
    // The cloud cache switch lives next to the credential because that is what
    // it substitutes for — but it works with the credential left empty.
    useSyncExternalStore(subscribeFoliaCloudSettings, getFoliaCloudSettingsVersion);
    const cloudCache = readFoliaCloudSettings();
    const [cacheProbe, setCacheProbe] = useState<{ state: TestState; ok: boolean; text: string }>({
        state: 'idle',
        ok: false,
        text: '',
    });
    // The director's own switches live in its own persistence, and the panel tab
    // can change them while this card is open — this is only the redraw trigger,
    // the values are read during render.
    useSyncExternalStore(subscribeDirectorState, getDirectorStateVersion);
    const directorSettings = readDirectorSettings();

    // 即改即存：没有「保存」按钮，避免用户填完忘了提交。
    const update = (patch: Parameters<typeof writeAiSettings>[0]) => {
        setSettings(writeAiSettings(patch));
        setTestState('idle');
        setTestResult(null);
    };

    const runTest = async () => {
        if (testState === 'running') return;
        setTestState('running');
        setTestResult(null);
        const result = await testConfiguredAiConnection();
        setTestResult(result);
        setTestState('done');
    };

    const runCacheProbe = async () => {
        setCacheProbe({ state: 'running', ok: false, text: '' });
        const startedAt = Date.now();
        try {
            const response = await createAiFetch()(
                resolveAiCloudCacheUrl(STAGE_CACHE_KIND, CLOUD_CACHE_PROBE_KEY),
                { method: 'GET', headers: { Accept: 'application/json' } },
            );
            if (!response.ok) {
                setCacheProbe({
                    state: 'done',
                    ok: false,
                    text: `${t('options.cloudCacheProbeFailed')} HTTP ${response.status}`,
                });
                return;
            }
            await response.json().catch(() => null);
            setCacheProbe({
                state: 'done',
                ok: true,
                text: `${t('options.cloudCacheProbeOk')} · ${Date.now() - startedAt} ms`,
            });
        } catch (error) {
            setCacheProbe({
                state: 'done',
                ok: false,
                text: `${t('options.cloudCacheProbeFailed')} ${String((error as Error)?.message ?? error)}`,
            });
        }
    };

    const fieldClass = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors';
    const ghostButtonClass = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-default';
    const rowDividerClass = isDaylight ? 'border-black/5' : 'border-white/5';

    /* The two switches the AI lyric animation director answers to. They sit
     * under the credential because that is what gates them: no key configured,
     * nothing is ever decided. */
    const renderDirectorToggle = (
        label: string,
        description: string,
        active: boolean,
        onChange: (next: boolean) => void,
    ) => (
        <div className="flex items-center justify-between gap-4 text-left">
            <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                <div className="text-xs opacity-50 max-w-[380px]" style={{ color: 'var(--text-secondary)' }}>
                    {description}
                </div>
            </div>
            <button
                type="button"
                onClick={() => onChange(!active)}
                aria-pressed={active}
                aria-label={label}
                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${active
                    ? 'bg-[rgba(114,119,134,1)]'
                    : (isDaylight ? 'bg-black/15' : 'bg-white/15')}`}
            >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
        </div>
    );

    const toggleBlockedMode = (mode: string) => {
        const current = readDirectorSettings().blockedModes;
        const next = current.includes(mode)
            ? current.filter((entry) => entry !== mode)
            : [...current, mode];
        updateDirectorSettings({ blockedModes: next });
    };

    const renderProviderOption = (id: AiProviderId, label: string) => {
        const selected = settings.provider === id;
        return (
            <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ provider: id })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${selected
                    ? 'bg-white/15 text-[var(--text-primary)]'
                    : 'opacity-55 hover:opacity-85 text-[var(--text-primary)]'}`}
            >
                {label}
            </button>
        );
    };

    return (
        <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
            <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-b ${rowDividerClass}`}>
                <div className="space-y-1 text-left min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        <Sparkles size={15} className="opacity-70" aria-hidden="true" />
                        {t('ui.aiTheme')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.aiThemeDesc')}
                    </div>
                </div>
                <div className={`flex rounded-xl border p-1 shrink-0 ${isDaylight ? 'bg-black/[0.05] border-black/10' : 'bg-white/5 border-white/5'}`}>
                    {renderProviderOption('gemini', 'Google Gemini')}
                    {renderProviderOption('deepseek', 'DeepSeek')}
                    {renderProviderOption('openai', t('options.otherCompatibleApi'))}
                </div>
            </div>

            <div className="px-4 pb-3 text-left">
                <a
                    href={PROVIDER_CONSOLE_URLS[settings.provider]}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {t('options.openProviderConsole', { provider: providerLabelOf(settings.provider, t) })}
                    <ExternalLink size={11} aria-hidden="true" />
                </a>
            </div>

            <div className={`p-4 space-y-3 border-b ${rowDividerClass}`}>
                {settings.provider === 'deepseek' ? (
                    /* DeepSeek is an OpenAI-compatible endpoint with a fixed
                     * address and a known flash model, so the whole form is
                     * one field: the key. */
                    <label className="block space-y-1 text-left">
                        <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.deepseekApiKey')}
                        </span>
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={settings.deepseekApiKey}
                            onChange={(event) => update({ deepseekApiKey: event.target.value })}
                            placeholder="sk-..."
                            className={fieldClass}
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <span className="block text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.deepseekApiKeyDesc')}
                        </span>
                    </label>
                ) : settings.provider === 'gemini' ? (
                    <>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.geminiApiKey')}
                            </span>
                            <input
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.geminiApiKey}
                                onChange={(event) => update({ geminiApiKey: event.target.value })}
                                placeholder="AIza..."
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.geminiApiUrl')}
                            </span>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.geminiApiUrl}
                                onChange={(event) => update({ geminiApiUrl: event.target.value })}
                                placeholder={GEMINI_DEFAULT_API_BASE}
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <span className="block text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.geminiApiUrlDesc')}
                            </span>
                        </label>
                    </>
                ) : (
                    <>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiUrl')}
                            </span>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiUrl}
                                onChange={(event) => update({ openaiApiUrl: event.target.value })}
                                placeholder="https://api.openai.com/v1 or https://api.deepseek.com"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiModel')}
                            </span>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiModel}
                                onChange={(event) => update({ openaiApiModel: event.target.value })}
                                placeholder="gpt-5.6-luna / deepseek-v4-flash"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <span className="block text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiModelDesc')}
                            </span>
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiTemperature')}
                            </span>
                            <input
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                value={settings.openaiApiTemperature}
                                onChange={(event) => update({ openaiApiTemperature: event.target.value })}
                                placeholder="0.7"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiKey')}
                            </span>
                            <input
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiKey}
                                onChange={(event) => update({ openaiApiKey: event.target.value })}
                                placeholder="sk-..."
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                    </>
                )}

                <div className="flex flex-wrap items-center gap-3 text-left">
                    <button
                        type="button"
                        onClick={() => void runTest()}
                        disabled={testState === 'running'}
                        className={ghostButtonClass}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {testState === 'running'
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Sparkles size={13} />}
                        {testState === 'running' ? t('options.aiTestRunning') : t('options.aiTestConnection')}
                    </button>
                    {testState === 'done' && testResult && (
                        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            {testResult.ok
                                ? <Check size={12} className="text-green-400" />
                                : <X size={12} className="text-red-400" />}
                            {testResult.ok
                                ? `${t('options.aiTestSuccess')} · ${t('options.aiTestDuration')} ${testResult.durationMs} ms`
                                    + `${testResult.model ? ` · ${t('options.aiTestModel')} ${testResult.model}` : ''}`
                                : `${t('options.aiTestFailed')}${testResult.error ? `: ${testResult.error}` : ''}`}
                        </span>
                    )}
                </div>
                {testState === 'done' && testResult?.ok && testResult.reply && (
                    <div className="text-[11px] opacity-55 break-words text-left" style={{ color: 'var(--text-secondary)' }}>
                        {testResult.reply}
                    </div>
                )}

                <div className="text-[10px] opacity-45 text-left" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.aiKeyStoredLocally')}
                </div>

                <div className="space-y-3 pt-1 text-left">
                    {renderDirectorToggle(
                        t('aiDirector.allowAutoMode'),
                        t('aiDirector.allowAutoModeDesc'),
                        directorSettings.autoOnSongChange,
                        (next) => updateDirectorSettings({ autoOnSongChange: next }),
                    )}
                    {renderDirectorToggle(
                        t('aiDirector.allowAutoParams'),
                        t('aiDirector.allowAutoParamsDesc'),
                        directorSettings.applyParams,
                        (next) => updateDirectorSettings({ applyParams: next }),
                    )}
                </div>

                <div className="space-y-2 pt-1 text-left">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('aiDirector.blockedModes')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[380px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('aiDirector.blockedModesDesc')}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {listDirectorModes((key) => t(key)).map((mode) => {
                            const blocked = directorSettings.blockedModes.includes(mode.id);
                            return (
                                <button
                                    key={mode.id}
                                    type="button"
                                    aria-pressed={blocked}
                                    onClick={() => toggleBlockedMode(mode.id)}
                                    title={mode.hint}
                                    className={`px-2.5 py-1 rounded-full border text-xs transition-opacity ${isDaylight ? 'border-black/15' : 'border-white/15'} ${blocked ? 'line-through opacity-55' : 'opacity-90'}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {mode.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 云缓存：紧挨着 AI 歌词配置下面，默认打开；没填 Key 也能拉。
                不再单独套一张带边框的卡 —— 外层已经是 kit 的 Group 卡片，这里再套一层
                就是三层边框。改成组内的一行，用一条发丝线和上面分开。 */}
            <div className="p-4">
                <div className={`flex flex-wrap items-center justify-between gap-4 pb-4 border-b ${rowDividerClass}`}>
                    <div className="space-y-1 text-left min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            <Cloud size={15} className="opacity-70" aria-hidden="true" />
                            {t('options.cloudCache')}
                        </div>
                        <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.cloudCacheDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => updateFoliaCloudSettings({ enabled: !cloudCache.enabled })}
                        aria-pressed={cloudCache.enabled}
                        aria-label={t('options.cloudCache')}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${cloudCache.enabled
                            ? 'bg-[rgba(114,119,134,1)]'
                            : (isDaylight ? 'bg-black/15' : 'bg-white/15')}`}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${cloudCache.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                <div className="pt-4 space-y-3">
                    <label className="block space-y-1 text-left">
                        <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.cloudCacheBaseUrl')}
                        </span>
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={cloudCache.baseUrl}
                            onChange={(event) => updateFoliaCloudSettings({ baseUrl: event.target.value })}
                            placeholder="https://apif.tangbot.xyz"
                            className={fieldClass}
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <span className="block text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.cloudCacheBaseUrlDesc')}
                        </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-3 text-left">
                        <button
                            type="button"
                            onClick={() => void runCacheProbe()}
                            disabled={cacheProbe.state === 'running'}
                            className={ghostButtonClass}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {cacheProbe.state === 'running'
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Cloud size={13} />}
                            {cacheProbe.state === 'running'
                                ? t('options.aiTestRunning')
                                : t('options.cloudCacheProbe')}
                        </button>
                        {cacheProbe.state === 'done' && (
                            <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                {cacheProbe.ok
                                    ? <Check size={12} className="text-green-400" />
                                    : <X size={12} className="text-red-400" />}
                                {cacheProbe.text}
                            </span>
                        )}
                    </div>

                    <div className="text-[10px] opacity-45 text-left" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.cloudCachePrivacy')}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiProviderSettings;
