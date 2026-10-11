import React from 'react';
import { Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useGlassSurfaceSettingsStore } from '../../../stores/useGlassSurfaceSettingsStore';

// src/components/modal/settings/GlassSurfaceSetting.tsx
// 「关闭毛玻璃」：把界面上那一百多处 backdrop-blur 面板（搜索框、侧栏、命令面板、弹层）
// 换成不透明实色。开着更好看，关掉更省 —— 中低端机上这些模糊层是掉帧的主要来源。

type GlassSurfaceSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const GlassSurfaceSetting: React.FC<GlassSurfaceSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    // 开关的语义是「关掉」，存的是 disabled，UI 上按「保留毛玻璃」来呈现更直观。
    const disabled = useGlassSurfaceSettingsStore(state => state.glassSurfacesDisabled);
    const setDisabled = useGlassSurfaceSettingsStore(state => state.setGlassSurfacesDisabled);
    const glassEnabled = !disabled;

    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={Square} label={t('options.glassSurfaceSection')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.glassSurface')}
                        </div>
                        <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.glassSurfaceDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={glassEnabled}
                        aria-label={t('options.glassSurface')}
                        onClick={() => setDisabled(!disabled)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!glassEnabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: glassEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${glassEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GlassSurfaceSetting;
