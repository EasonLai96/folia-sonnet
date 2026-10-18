import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './kit';
import { useAndroidLayoutSettingsStore } from '../../../stores/useAndroidLayoutSettingsStore';

// Android-only compact layout switch. It deliberately lives next to, but separate from, the
// native fullscreen switch so upstream layout breakpoints remain untouched when it is off.
//
// 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这两项只是里面的一行
// （与 AndroidLyriconSetting 同款）。

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const AndroidPhoneFitSetting: React.FC = () => {
    const { t } = useTranslation();
    const enabled = useAndroidLayoutSettingsStore(state => state.phoneFitEnabled);
    const orientation = useAndroidLayoutSettingsStore(state => state.phoneFitOrientation);
    const setEnabled = useAndroidLayoutSettingsStore(state => state.setPhoneFitEnabled);
    const setOrientation = useAndroidLayoutSettingsStore(state => state.setPhoneFitOrientation);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                        {t('options.phoneFit')}
                    </div>
                    <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                        {t('options.phoneFitDesc')}
                    </div>
                </div>
                <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
            </div>
            {/* 「横屏时再收一档」只在总开关打开时才说得清，跟着一起出现 / 消失。 */}
            {enabled && (
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                            {t('options.orientationFit')}
                        </div>
                        <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                            {t('options.orientationFitDesc')}
                        </div>
                        <div className="text-[11px] font-semibold text-[color:var(--st-t2)]">
                            {t(orientation === 'landscape' ? 'options.orientationLandscape' : 'options.orientationPortrait')}
                        </div>
                    </div>
                    <Toggle
                        checked={orientation === 'landscape'}
                        onChange={() => setOrientation(orientation === 'landscape' ? 'portrait' : 'landscape')}
                    />
                </div>
            )}
        </>
    );
};

export default AndroidPhoneFitSetting;
