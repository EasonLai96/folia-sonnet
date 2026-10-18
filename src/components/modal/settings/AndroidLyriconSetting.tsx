import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './kit';
import { useLyriconStore } from '../../../stores/useLyriconStore';

// src/components/modal/settings/AndroidLyriconSetting.tsx
// Android-only 状态栏歌词（Lyricon）开关。
//
// 上游把设置页重写成 pages/* 那一套时，原来挂着这个开关的 IntegrationSettingsSubview 被删了，
// 于是 useLyriconStore.handleToggleLyricon 一个调用方都不剩 —— 运行时链路（useLyriconFeed、
// 原生插件注册）全都还在，只是**再也打不开**：老用户存着的 folia.lyriconEnabled=true 照常工作，
// 新用户永远开不了，界面也不报错。这里把开关补回来（挂在「连接与集成」页的系统歌词组）。

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const AndroidLyriconSetting: React.FC = () => {
    const { t } = useTranslation();
    const enabled = useLyriconStore(state => state.enabled);
    const connected = useLyriconStore(state => state.connected);
    const setEnabled = useLyriconStore(state => state.handleToggleLyricon);

    if (!isAndroidNativeRuntime()) return null;

    // 开了却连不上（没装 Lyricon）：说一句，别让人以为已经生效。
    const desc = enabled && !connected ? t('options.lyriconNotConnectedDesc') : t('options.lyriconDesc');

    return (
        // 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这一项只是里面的一行
        // （与 AndroidColorOsLyricsSetting 同款）。自带边框会变成「卡里套卡」。
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                    {t('options.enableLyricon')}
                </div>
                <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                    {desc}
                </div>
                {enabled && !connected && (
                    <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                        {t('options.lyriconNotConnected')}
                    </div>
                )}
            </div>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
        </div>
    );
};

export default AndroidLyriconSetting;
