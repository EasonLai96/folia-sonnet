import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, KeyRound, RotateCcw, Sparkles } from 'lucide-react';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import {
    getDirectorRuntime,
    restoreLyricDirectorSnapshot,
    runLyricDirectorDecision,
    subscribeDirectorRuntime,
} from '../../services/lyricDirector/director';
import {
    getDirectorStateVersion,
    readDirectorSettings,
    subscribeDirectorState,
    updateDirectorSettings,
} from '../../services/lyricDirector/state';
import { modeLabel } from '../../services/lyricDirector/catalog';

// src/components/panelTab/AiDirectorTab.tsx
// The AI director's own tab in the player panel — the entry point this feature
// never had while it was a mod: mods only load in the desktop build, so on
// Android there was nowhere to reach it from.
//
// Everything it shows comes from the service, not from props: the decision runs
// from a command, a song change or this button, and all three have to agree.

interface AiDirectorTabProps {
    isDaylight: boolean;
    onOpenSettings?: () => void;
}

const ToggleRow: React.FC<{
    label: string;
    description: string;
    checked: boolean;
    isDaylight: boolean;
    rowDivider: string;
    onChange: (next: boolean) => void;
}> = ({ label, description, checked, isDaylight, rowDivider, onChange }) => (
    <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`flex w-full items-start gap-3 border-b px-3 py-2.5 text-left last:border-b-0 ${rowDivider}`}
    >
        <span
            className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-[color:var(--accent-color,#8b5cf6)]' : (isDaylight ? 'bg-black/20' : 'bg-white/20')}`}
        >
            <span className={`h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-sm font-medium">{label}</span>
            <span className={`block text-xs leading-relaxed ${isDaylight ? 'text-black/55' : 'text-white/55'}`}>
                {description}
            </span>
        </span>
    </button>
);

const AiDirectorTab: React.FC<AiDirectorTabProps> = ({ isDaylight, onOpenSettings }) => {
    const { t } = useTranslation();
    const runtime = useSyncExternalStore(subscribeDirectorRuntime, getDirectorRuntime);
    // Settings live in the same persisted blob as the memory; this is only the
    // redraw trigger for reads done during render.
    useSyncExternalStore(subscribeDirectorState, getDirectorStateVersion);
    const settings = readDirectorSettings();

    const cardClass = isDaylight ? 'bg-black/[0.04] border-black/10' : 'bg-white/5 border-white/10';
    const rowDivider = isDaylight ? 'border-black/10' : 'border-white/10';
    const muted = isDaylight ? 'text-black/55' : 'text-white/55';

    const aiStatus = !runtime.aiKnown
        ? t('aiDirector.aiStatusChecking')
        : runtime.aiTarget
            ? t('aiDirector.aiStatusReady', { provider: runtime.aiTarget.provider, model: runtime.aiTarget.model })
            : t('aiDirector.aiStatusMissing');

    const decide = async (force: boolean) => {
        const outcome = await runLyricDirectorDecision({ announce: true, force });
        if (outcome.kind === 'no-song') {
            setStatusMessage({ type: 'info', text: t('aiDirector.noSong'), nonce: Date.now() });
        } else if (outcome.kind === 'queued') {
            setStatusMessage({ type: 'info', text: t('aiDirector.queued'), nonce: Date.now() });
        } else if (outcome.kind === 'stale') {
            setStatusMessage({ type: 'info', text: t('aiDirector.stale'), nonce: Date.now() });
        } else if (outcome.kind === 'unavailable') {
            setStatusMessage({ type: 'info', text: t('aiDirector.unavailable'), nonce: Date.now() });
        }
    };

    const restore = () => {
        setStatusMessage({ type: 'info', text: restoreLyricDirectorSnapshot(), nonce: Date.now() });
    };

    return (
        <div className="space-y-3">
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${rowDivider}`}>
                    <Clapperboard size={15} className="shrink-0 opacity-70" />
                    <span className="text-sm font-semibold">{t('aiDirector.title')}</span>
                </div>
                <div className="space-y-1 px-3 py-2.5 text-xs">
                    <div className={muted}>
                        {t('aiDirector.currentMode', { mode: runtime.currentModeLabel })}
                    </div>
                    <div className={`flex items-center gap-1.5 ${muted}`}>
                        <Sparkles size={12} className="shrink-0" />
                        <span className="min-w-0 flex-1">{aiStatus}</span>
                        {!runtime.aiTarget && onOpenSettings && (
                            <button
                                type="button"
                                onClick={onOpenSettings}
                                className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] opacity-80"
                            >
                                <KeyRound size={11} />
                                {t('aiDirector.openAiSettings')}
                            </button>
                        )}
                    </div>
                    {settings.blockedModes.length > 0 && (
                        <div className={muted}>
                            {t('aiDirector.blockedModesLine', {
                                modes: settings.blockedModes.map((mode) => modeLabel(mode, (key) => t(key))).join('、'),
                            })}
                        </div>
                    )}
                </div>
                <div className={`flex flex-wrap gap-2 px-3 py-2.5 border-t ${rowDivider}`}>
                    <button
                        type="button"
                        onClick={() => void decide(false)}
                        disabled={runtime.busy}
                        className="rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                        {runtime.busy ? t('aiDirector.deciding') : t('aiDirector.decide')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void decide(true)}
                        disabled={runtime.busy}
                        className="rounded-full border px-3 py-1.5 text-xs opacity-80 disabled:opacity-40"
                    >
                        {t('aiDirector.decideAgain')}
                    </button>
                    <button
                        type="button"
                        onClick={restore}
                        className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs opacity-80"
                    >
                        <RotateCcw size={11} />
                        {t('aiDirector.restore')}
                    </button>
                </div>
            </div>

            {(runtime.lastReason || runtime.lastSummary) && (
                <div className={`rounded-xl border px-3 py-2.5 text-xs space-y-1 ${cardClass}`}>
                    {runtime.lastSummary && <div>{t('aiDirector.lastResult', { text: runtime.lastSummary })}</div>}
                    {runtime.lastReason && (
                        <div className={muted}>{t('aiDirector.reason', { text: runtime.lastReason })}</div>
                    )}
                </div>
            )}

            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <ToggleRow
                    label={t('aiDirector.allowAutoMode')}
                    description={t('aiDirector.allowAutoModeDesc')}
                    checked={settings.autoOnSongChange}
                    isDaylight={isDaylight}
                    rowDivider={rowDivider}
                    onChange={(next) => updateDirectorSettings({ autoOnSongChange: next })}
                />
                <ToggleRow
                    label={t('aiDirector.settingRemember')}
                    description={t('aiDirector.settingRememberDesc')}
                    checked={settings.rememberPerSong}
                    isDaylight={isDaylight}
                    rowDivider={rowDivider}
                    onChange={(next) => updateDirectorSettings({ rememberPerSong: next })}
                />
                <ToggleRow
                    label={t('aiDirector.allowAutoParams')}
                    description={t('aiDirector.allowAutoParamsDesc')}
                    checked={settings.applyParams}
                    isDaylight={isDaylight}
                    rowDivider={rowDivider}
                    onChange={(next) => updateDirectorSettings({ applyParams: next })}
                />
                <ToggleRow
                    label={t('aiDirector.settingPrefetch')}
                    description={t('aiDirector.settingPrefetchDesc')}
                    checked={settings.prefetchNext}
                    isDaylight={isDaylight}
                    rowDivider={rowDivider}
                    onChange={(next) => updateDirectorSettings({ prefetchNext: next })}
                />
                <div className={`px-3 py-2.5 border-t ${rowDivider}`}>
                    <div className="mb-1 text-sm font-medium">{t('aiDirector.settingHint')}</div>
                    <input
                        type="text"
                        value={settings.userHint}
                        onChange={(event) => updateDirectorSettings({ userHint: event.target.value })}
                        placeholder={t('aiDirector.settingHintPlaceholder')}
                        className={`w-full rounded-lg border bg-transparent px-2 py-1.5 text-xs outline-none ${rowDivider}`}
                    />
                    <div className={`mt-1 text-[11px] leading-relaxed ${muted}`}>
                        {t('aiDirector.settingHintDesc')}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiDirectorTab;
