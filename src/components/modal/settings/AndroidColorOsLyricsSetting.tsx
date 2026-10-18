import React, { useEffect, useState } from 'react';
import { PanelBottom } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getColorOsLyricsSupport, type ColorOsLyricsSupport } from '../../../platform/foliaColorOsLyrics';

// src/components/modal/settings/AndroidColorOsLyricsSetting.tsx
// ColorOS 原生锁屏 / 息屏歌词的状态行（fork 独有）。
//
// 上游把设置子页重写成 pages/* 时，原来挂着它的 IntegrationSettingsSubview 被删了，
// 于是「设置里根本找不到这一项」—— 运行时链路（App.tsx 的 useColorOsLyricFeed、
// MainActivity 里的插件注册）全都还在，只是没有入口。
//
// 它是**探测式**的，没有手动开关：检测到 ColorOS 16+ 就自动启用（见 foliaColorOsLyrics
// 与 android/.../coloros/ColorOsLyricBridge）。所以这一行只报告当前状态。

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

export const AndroidColorOsLyricsSetting: React.FC = () => {
    const { t } = useTranslation();
    const [support, setSupport] = useState<ColorOsLyricsSupport | null>(null);

    // 探测是一次异步的原生调用，结果留在本组件里：设置页每次打开都重新问一次，
    // 免得显示的是上一次启动时的旧结论。
    useEffect(() => {
        if (!isAndroidNativeRuntime()) return undefined;
        let alive = true;
        void getColorOsLyricsSupport().then(result => {
            if (alive) setSupport(result);
        }).catch(() => {
            if (alive) setSupport(null);
        });
        return () => { alive = false; };
    }, []);

    if (!isAndroidNativeRuntime()) return null;

    const active = support?.supported === true;
    const title = t(active ? 'options.colorOsLyricsActive' : 'options.colorOsLyricsInactive');
    const desc = t(active ? 'options.colorOsLyricsActiveDesc' : 'options.colorOsLyricsDesc');

    return (
        <div className="flex items-start gap-3 px-4 py-3">
            <PanelBottom size={16} className="mt-0.5 shrink-0 opacity-70" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-[color:var(--st-t1)]">{title}</div>
                <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">{desc}</div>
                {support && support.colorOsMajor > 0 && (
                    <div className="text-[11px] tabular-nums text-[color:var(--st-t3)]">
                        ColorOS {support.colorOsMajor}
                        {support.detail ? ` · ${support.detail}` : ''}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AndroidColorOsLyricsSetting;
