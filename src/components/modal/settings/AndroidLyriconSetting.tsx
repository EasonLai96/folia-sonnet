import React from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Toggle } from './kit';
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

    // 开了却连不上（没装 Lyricon）：那句提示替掉 hint 直接显示，别让人以为已经生效 ——
    // 见下面 Row 的 hint。
    if (!isAndroidNativeRuntime()) return null;

    return (
        // 照页面上其它项的样式来：标签 + 一句短说明（hint），完整的那一段进「i」里展开
        // （note）。以前是自己画的一整段说明直接铺在标签底下，跟周围那些项不是一套。
        <Row
            label={t('options.enableLyricon')}
            // 开了却连不上（没装 Lyricon）：这句得直接看得见，不能藏在「i」里 ——
            // 否则界面显示「已开启」而状态栏什么都没有。
            hint={enabled && !connected ? t('options.lyriconNotConnectedDesc') : t('options.lyriconHint')}
            note={t('options.lyriconDesc')}
        >
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
        </Row>
    );
};

export default AndroidLyriconSetting;
