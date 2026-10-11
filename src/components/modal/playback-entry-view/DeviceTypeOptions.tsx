import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneArt, TabletArt } from './deviceProfileArt';
import { OnboardingChoiceCards, type OnboardingChoiceCard } from './OnboardingChoiceCards';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import type { DeviceType } from '../../../services/androidPhoneLayout';

// src/components/modal/playback-entry-view/DeviceTypeOptions.tsx
// 首启引导里问「这是手机还是平板」。
//
// 只影响一件事：选了手机的话，横屏时整屏缩一档，同一块屏才塞得下桌面那套布局
// （见 services/androidPhoneLayout 的 applyDeviceProfile）。选了平板就什么都不缩。
// 写入走设置页同一个 store，之后随时能改。

type DeviceTypeOptionsProps = {
    isDaylight: boolean;
    accentColor: string;
};

export const DeviceTypeOptions: React.FC<DeviceTypeOptionsProps> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const setDeviceType = useDeviceProfileStore(state => state.setDeviceType);

    const cards = useMemo<OnboardingChoiceCard<DeviceType>[]>(() => [
        {
            value: 'phone',
            art: PhoneArt,
            title: t('deviceTypeOnboarding.phone.title'),
            description: t('deviceTypeOnboarding.phone.description'),
        },
        {
            value: 'tablet',
            art: TabletArt,
            title: t('deviceTypeOnboarding.tablet.title'),
            description: t('deviceTypeOnboarding.tablet.description'),
        },
    ], [t]);

    return (
        <OnboardingChoiceCards
            cards={cards}
            value={deviceType}
            onChange={setDeviceType}
            isDaylight={isDaylight}
            accentColor={accentColor}
            dataAttribute="data-onboarding-device-type"
            gridClassName="grid-cols-2"
        />
    );
};

export default DeviceTypeOptions;
