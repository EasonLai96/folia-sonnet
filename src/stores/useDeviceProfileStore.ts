import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import {
    applyDeviceProfile,
    readStoredDeviceType,
    writeStoredDeviceType,
    type DeviceType,
} from '../services/androidPhoneLayout';

// src/stores/useDeviceProfileStore.ts
// 设备类型（手机 / 平板）。首启引导里问一次，之后在设置里随时改。
//
// 分这个是为了横屏：平板的宽度够铺桌面那套布局，手机横过来就塞不下，控件会互相压住。
// 选了手机的话，横屏时整屏缩一档（见 styles/androidPhoneFit.css 的 [data-folia-ui-scale]）。

/**
 * 引导问过一次了。与 deviceType 分开存：直接关掉对话框的人也是「问过了」——
 * 没选就不该每次启动都再问一遍，设置里随时能改。
 */
const DEVICE_TYPE_ANSWERED_KEY = 'folia_device_type_answered';

export type DeviceProfileState = {
    deviceType: DeviceType | null;
    hasAnsweredDeviceType: boolean;
    setDeviceType: (deviceType: DeviceType) => void;
    markDeviceTypeAnswered: () => void;
};

export const useDeviceProfileStore = create<DeviceProfileState>((set) => ({
    deviceType: readStoredDeviceType(),
    hasAnsweredDeviceType: getStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, false),
    setDeviceType: (deviceType) => {
        writeStoredDeviceType(deviceType);
        applyDeviceProfile(deviceType);
        setStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, true);
        set({ deviceType, hasAnsweredDeviceType: true });
    },
    markDeviceTypeAnswered: () => {
        setStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, true);
        set({ hasAnsweredDeviceType: true });
    },
}));
