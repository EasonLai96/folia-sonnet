import React from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Segmented } from './kit';
import { useSettingsKitTheme } from './kit/kitTheme';
import { resolveCurrentUiScale, useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import UiScaleSlider from '../../shared/UiScaleSlider';
import { resolveDeviceType, type DeviceType } from '../../../services/androidPhoneLayout';
import { isAndroidNativeRuntime } from '../../../services/nativeLocalMusic';
import { O } from './pages/appearance/options';

// src/components/modal/settings/DeviceTypeSetting.tsx
// 设备类型（手机 / 平板）+ 界面缩放。首启引导里问过一次，这里随时改。
//
// 设备类型只影响横屏：选了手机的话横屏时再收一档，同一块屏才塞得下桌面那套布局（见
// services/androidPhoneLayout）。缩放是另一回事，由滑条定，拉过一次就以它为准。
// 桌面端不问也不显示 —— 窗口多宽自己说了算。
//
// 两行都由 kit 的 Row 画：标签与说明都取自各自的 option 声明（labelKey / noteKey），
// 说明不再铺在标签底下，而是收进「i」。

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
            <Row option={O.deviceType}>
                <Segmented<DeviceType>
                    value={deviceType}
                    options={DEVICE_TYPES.map(type => ({
                        value: type,
                        label: t(`options.deviceType${type === 'phone' ? 'Phone' : 'Tablet'}`),
                    }))}
                    onChange={setDeviceType}
                />
            </Row>
            <Row
                option={O.uiScale}
                below={(
                    <UiScaleSlider
                        isDaylight={isDaylight}
                        value={resolveCurrentUiScale(uiScale, deviceType)}
                        onChange={setUiScale}
                        showCompactHint={resolveDeviceType(deviceType) === 'phone'}
                        compact
                    />
                )}
            />
        </>
    );
};

export default DeviceTypeSetting;
