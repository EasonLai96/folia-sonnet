import React from 'react';
import { PanelTop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useLyriconStore } from '../../../stores/useLyriconStore';

// src/components/modal/settings/AndroidLyriconSetting.tsx
// Android-only 状态栏歌词（Lyricon）开关。
//
// 上游把设置页重写成 pages/* 那一套时，原来挂着这个开关的 IntegrationSettingsSubview 被删了，
// 于是 useLyriconStore.handleToggleLyricon 一个调用方都不剩 —— 运行时链路（useLyriconFeed、
// 原生插件注册）全都还在，只是**再也打不开**：老用户存着的 folia.lyriconEnabled=true 照常工作，
// 新用户永远开不了，界面也不报错。这里把开关补回来。

type AndroidLyriconSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const AndroidLyriconSetting: React.FC<AndroidLyriconSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const enabled = useLyriconStore(state => state.enabled);
    const connected = useLyriconStore(state => state.connected);
    const setEnabled = useLyriconStore(state => state.handleToggleLyricon);

    if (!isAndroidNativeRuntime()) return null;

    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';
    // 开了却连不上（没装 Lyricon）：说一句，别让人以为已经生效。
    const desc = enabled && !connected ? t('options.lyriconNotConnectedDesc') : t('options.lyriconDesc');

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={PanelTop} label={t('options.lyricon')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.enableLyricon')}
                        </div>
                        <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {desc}
                        </div>
                        {enabled && !connected && (
                            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.lyriconNotConnected')}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t('options.enableLyricon')}
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

export default AndroidLyriconSetting;
