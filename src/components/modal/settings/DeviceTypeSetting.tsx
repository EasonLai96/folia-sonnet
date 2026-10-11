import React from 'react';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import type { DeviceType } from '../../../services/androidPhoneLayout';
import { isAndroidNativeRuntime } from '../../../services/nativeLocalMusic';

// src/components/modal/settings/DeviceTypeSetting.tsx
// 设备类型（手机 / 平板）。首启引导里问过一次，这里随时改。
//
// 只影响横屏：选了手机的话横屏时整屏缩一档，同一块屏才塞得下桌面那套布局（见
// services/androidPhoneLayout）。桌面端不问也不显示 —— 窗口多宽自己说了算。

const DEVICE_TYPES: readonly DeviceType[] = ['phone', 'tablet'];

type DeviceTypeSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const DeviceTypeSetting: React.FC<DeviceTypeSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const setDeviceType = useDeviceProfileStore(state => state.setDeviceType);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={Smartphone} label={t('options.deviceTypeSection')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="space-y-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.deviceType')}
                    </div>
                    <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.deviceTypeDesc')}
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                    {DEVICE_TYPES.map(type => {
                        const isSelected = deviceType === type;
                        return (
                            <button
                                key={type}
                                type="button"
                                aria-pressed={isSelected}
                                data-device-type-option={type}
                                onClick={() => setDeviceType(type)}
                                className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                                    isSelected
                                        ? ''
                                        : (isDaylight ? 'bg-zinc-100 hover:bg-zinc-200' : 'bg-white/[0.06] hover:bg-white/10')
                                }`}
                                style={isSelected ? { backgroundColor: theme?.secondaryColor || 'rgba(114, 119, 134, 1)', color: '#fff' } : undefined}
                            >
                                {t(`options.deviceType${type === 'phone' ? 'Phone' : 'Tablet'}`)}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default DeviceTypeSetting;
