import React from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from './kit';
import { useSettingsKitTheme } from './kit/kitTheme';
import { resolveCurrentUiScale, useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import UiScaleSlider from '../../shared/UiScaleSlider';
import { resolveDeviceType, type DeviceType } from '../../../services/androidPhoneLayout';
import { isAndroidNativeRuntime } from '../../../services/nativeLocalMusic';

// src/components/modal/settings/DeviceTypeSetting.tsx
// 设备类型（手机 / 平板）+ 界面缩放。首启引导里问过一次，这里随时改。
//
// 设备类型只影响横屏：选了手机的话横屏时再收一档，同一块屏才塞得下桌面那套布局（见
// services/androidPhoneLayout）。缩放是另一回事，由滑条定，拉过一次就以它为准。
// 桌面端不问也不显示 —— 窗口多宽自己说了算。
//
// 不自带卡片外壳：由所在页的 kit Group 提供那张卡，这一项只是里面的一行
// （与 AndroidLyriconSetting 同款）；滑条占整行宽，单独写在行下面。

const DEVICE_TYPES: readonly DeviceType[] = ['phone', 'tablet'];

const DeviceTypeSetting: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const setDeviceType = useDeviceProfileStore(state => state.setDeviceType);
    const uiScale = useDeviceProfileStore(state => state.uiScale);
    const setUiScale = useDeviceProfileStore(state => state.setUiScale);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[13px] font-medium text-[color:var(--st-t1)]">
                        {t('options.deviceType')}
                    </div>
                    <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">
                        {t('options.deviceTypeDesc')}
                    </div>
                </div>
                <Segmented<DeviceType>
                    value={deviceType}
                    options={DEVICE_TYPES.map(type => ({
                        value: type,
                        label: t(`options.deviceType${type === 'phone' ? 'Phone' : 'Tablet'}`),
                    }))}
                    onChange={setDeviceType}
                />
            </div>
            <div className="px-4 pb-4">
                <UiScaleSlider
                    isDaylight={isDaylight}
                    value={resolveCurrentUiScale(uiScale, deviceType)}
                    onChange={setUiScale}
                    showCompactHint={resolveDeviceType(deviceType) === 'phone'}
                />
            </div>
        </>
    );
};

export default DeviceTypeSetting;
