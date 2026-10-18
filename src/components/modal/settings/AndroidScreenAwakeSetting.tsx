import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './kit';
import { useScreenAwakeSettingsStore } from '../../../stores/useScreenAwakeSettingsStore';

// Android-only 屏幕常亮 switch. It lives in the interface settings because it is a device behaviour
// rather than a playback one; the playback subview keeps its narrower "only while playing" variant.
//
// 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这一项只是里面的一行
// （与 AndroidLyriconSetting 同款）。

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const AndroidScreenAwakeSetting: React.FC = () => {
    const { t } = useTranslation();
    const enabled = useScreenAwakeSettingsStore(state => state.keepScreenAwake);
    const setEnabled = useScreenAwakeSettingsStore(state => state.setKeepScreenAwake);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                    {t('options.keepScreenAwake')}
                </div>
                <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                    {t('options.keepScreenAwakeDesc')}
                </div>
            </div>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
        </div>
    );
};

export default AndroidScreenAwakeSetting;
