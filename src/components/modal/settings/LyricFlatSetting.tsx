import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './kit';
import { useLyricFlatSettingsStore } from '../../../stores/useLyricFlatSettingsStore';

// src/components/modal/settings/LyricFlatSetting.tsx
// 歌词的扁平化：去掉发光，渐变的字改成纯色。
//
// 只管播放页那一层（App 里 [data-folia-lyric-surface] 标记的容器），命令面板、弹窗里的
// 文字不在作用域内 —— 具体规则见 index.css 的 [data-lyric-flat] 段。
//
// 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这一项只是里面的一行
// （与 AndroidLyriconSetting 同款）。两端都画，不是安卓专属。

const LyricFlatSetting: React.FC = () => {
    const { t } = useTranslation();
    const enabled = useLyricFlatSettingsStore(state => state.flatLyrics);
    const setEnabled = useLyricFlatSettingsStore(state => state.setFlatLyrics);

    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                    {t('options.lyricFlat')}
                </div>
                <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                    {t('options.lyricFlatDesc')}
                </div>
            </div>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
        </div>
    );
};

export default LyricFlatSetting;
