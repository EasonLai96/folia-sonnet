import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './kit';
import { useGlassSurfaceSettingsStore } from '../../../stores/useGlassSurfaceSettingsStore';

// src/components/modal/settings/GlassSurfaceSetting.tsx
// 「关闭毛玻璃」：把界面上那一百多处 backdrop-blur 面板（搜索框、侧栏、命令面板、弹层）
// 换成不透明实色。开着更好看，关掉更省 —— 中低端机上这些模糊层是掉帧的主要来源。
//
// 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这一项只是里面的一行
// （与 AndroidLyriconSetting 同款），自带边框会变成「卡里套卡」。两端都画，不是安卓专属。

const GlassSurfaceSetting: React.FC = () => {
    const { t } = useTranslation();
    // 开关的语义是「关掉」，存的是 disabled，UI 上按「保留毛玻璃」来呈现更直观。
    const disabled = useGlassSurfaceSettingsStore(state => state.glassSurfacesDisabled);
    const setDisabled = useGlassSurfaceSettingsStore(state => state.setGlassSurfacesDisabled);
    const glassEnabled = !disabled;

    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                    {t('options.glassSurface')}
                </div>
                <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                    {t('options.glassSurfaceDesc')}
                </div>
            </div>
            <Toggle checked={glassEnabled} onChange={() => setDisabled(!disabled)} />
        </div>
    );
};

export default GlassSurfaceSetting;
