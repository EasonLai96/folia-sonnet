export const ANDROID_PHONE_FIT_STORAGE_KEY = 'folia_android_phone_fit';
export const ANDROID_PHONE_FIT_ORIENTATION_STORAGE_KEY = 'folia_android_phone_fit_orientation';

export type AndroidPhoneFitOrientation = 'portrait' | 'landscape';

export const readStoredAndroidPhoneFit = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(ANDROID_PHONE_FIT_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const writeStoredAndroidPhoneFit = (enabled: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(ANDROID_PHONE_FIT_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // A storage failure must not make the switch unusable for the current session.
    }
};

export const readStoredAndroidPhoneFitOrientation = (): AndroidPhoneFitOrientation => {
    if (typeof window === 'undefined') return 'portrait';
    try {
        return localStorage.getItem(ANDROID_PHONE_FIT_ORIENTATION_STORAGE_KEY) === 'landscape'
            ? 'landscape'
            : 'portrait';
    } catch {
        return 'portrait';
    }
};

export const writeStoredAndroidPhoneFitOrientation = (orientation: AndroidPhoneFitOrientation): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(ANDROID_PHONE_FIT_ORIENTATION_STORAGE_KEY, orientation);
    } catch {
        // A storage failure must not make the switch unusable for the current session.
    }
};

/**
 * Applies the Android-only compact layout at the document root.
 *
 * Keeping this as one attribute means every override lives in one stylesheet and upstream
 * components keep their own markup and breakpoints.
 */
export const applyAndroidPhoneFit = (
    enabled: boolean,
    orientation: AndroidPhoneFitOrientation = readStoredAndroidPhoneFitOrientation(),
): void => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-folia-phone-fit', enabled ? 'true' : 'false');
    root.setAttribute('data-folia-phone-orientation', orientation);
};

export const installAndroidPhoneFitPreference = (): void => {
    applyAndroidPhoneFit(readStoredAndroidPhoneFit(), readStoredAndroidPhoneFitOrientation());
};

/**
 * Synchronizes the JS setting with the Android orientation lock. Web and plugin-less runtimes
 * simply keep using the CSS attribute above.
 */
/* ---------------------------------------------------------------------------
 * 设备类型（手机 / 平板）
 * -------------------------------------------------------------------------
 *
 * 平板的屏幕够宽，桌面那套布局直接铺上去就行；手机横过来的时候宽度跟桌面差了一个量级，
 * 同一屏塞不下同样的东西，控件会互相压住。所以问一次是手机还是平板，是手机的话横屏时把
 * 整屏缩一点 —— 东西变小，同一块屏就显示得下了。
 */

export const DEVICE_TYPE_STORAGE_KEY = 'folia_device_type';

export type DeviceType = 'phone' | 'tablet';

export const readStoredDeviceType = (): DeviceType | null => {
    if (typeof window === 'undefined') return null;
    try {
        const stored = localStorage.getItem(DEVICE_TYPE_STORAGE_KEY);
        return stored === 'phone' || stored === 'tablet' ? stored : null;
    } catch {
        return null;
    }
};

export const writeStoredDeviceType = (deviceType: DeviceType | null): void => {
    if (typeof window === 'undefined') return;
    try {
        if (deviceType) {
            localStorage.setItem(DEVICE_TYPE_STORAGE_KEY, deviceType);
        } else {
            localStorage.removeItem(DEVICE_TYPE_STORAGE_KEY);
        }
    } catch {
        // A storage failure must not make the choice unusable for the current session.
    }
};

const isLandscapeNow = (): boolean => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(orientation: landscape)').matches
);

/**
 * 把设备类型与「要不要缩」写到 `<html>`：样式全在 androidPhoneFit.css 里读这两个属性，
 * 组件不需要知道自己是跑在手机还是平板上。
 */
export const applyDeviceProfile = (deviceType: DeviceType | null): void => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-folia-device', deviceType ?? 'unset');
    // 平板横屏本来就够宽，只有手机才需要让路。
    root.setAttribute('data-folia-ui-scale', deviceType === 'phone' && isLandscapeNow() ? 'compact' : 'normal');
};

let deviceProfileListenerInstalled = false;

export const installDeviceProfilePreference = (): void => {
    applyDeviceProfile(readStoredDeviceType());
    if (deviceProfileListenerInstalled || typeof window === 'undefined') return;
    deviceProfileListenerInstalled = true;
    // 转屏要立刻重算：属性不跟着变的话，横过来那一刻布局还是按竖屏那套铺的。
    const update = () => applyDeviceProfile(readStoredDeviceType());
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    if (typeof window.matchMedia === 'function') {
        window.matchMedia('(orientation: landscape)').addEventListener?.('change', update);
    }
};

export const syncAndroidPhoneFitNative = (
    enabled: boolean,
    orientation: AndroidPhoneFitOrientation,
): void => {
    if (typeof window === 'undefined') return;
    const plugin = (window as unknown as {
        Capacitor?: {
            getPlatform?: () => string;
            Plugins?: {
                FoliaNative?: {
                    setPhoneFitLayout?: (options: {
                        enabled: boolean;
                        orientation: AndroidPhoneFitOrientation;
                    }) => Promise<unknown>;
                };
            };
        };
    }).Capacitor?.Plugins?.FoliaNative;
    if (typeof plugin?.setPhoneFitLayout !== 'function') return;
    void plugin.setPhoneFitLayout({ enabled, orientation }).catch(() => undefined);
};
