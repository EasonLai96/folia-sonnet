import React from 'react';
import { Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useLyricFlatSettingsStore } from '../../../stores/useLyricFlatSettingsStore';

// src/components/modal/settings/LyricFlatSetting.tsx
// 歌词的扁平化：去掉发光，渐变的字改成纯色。
//
// 只管播放页那一层（App 里 [data-folia-lyric-surface] 标记的容器），命令面板、弹窗里的
// 文字不在作用域内 —— 具体规则见 index.css 的 [data-lyric-flat] 段。

type LyricFlatSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const LyricFlatSetting: React.FC<LyricFlatSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const enabled = useLyricFlatSettingsStore(state => state.flatLyrics);
    const setEnabled = useLyricFlatSettingsStore(state => state.setFlatLyrics);

    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={Type} label={t('options.lyricFlatSection')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.lyricFlat')}
                        </div>
                        <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.lyricFlatDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t('options.lyricFlat')}
                        onClick={() => setEnabled(!enabled)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!enabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LyricFlatSetting;
