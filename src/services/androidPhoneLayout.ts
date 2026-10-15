import { setSafeAreaBypass } from './phoneInsets';
import { setSystemBarsAlwaysHidden } from '../platform/foliaNative';

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
 * 手机短边的上限（CSS px）。手机横过来时短边就是高度，常见 360~480；平板再小也多在 600 以上。
 * 这里只用来在「没选过」的时候兜个底，选过的一律以选择为准。
 */
const PHONE_SHORT_EDGE_MAX_PX = 520;

/**
 * 没选过设备类型时的自动判断。
 *
 * 引导没答、或者答完又清空的都走这条路 —— 否则这类用户横屏就完全不会出现压缩,而他们恰恰是
 * 最需要它的人。Web / Electron 不在安卓 WebView 里，窗口多宽自己说了算，一律不缩。
 */
export const inferDeviceType = (): DeviceType => {
    if (typeof window === 'undefined') return 'tablet';
    if (typeof navigator === 'undefined' || !/Android/.test(navigator.userAgent)) return 'tablet';
    const shortEdge = Math.min(window.innerWidth, window.innerHeight);
    return shortEdge > 0 && shortEdge <= PHONE_SHORT_EDGE_MAX_PX ? 'phone' : 'tablet';
};

/** 选择优先，没选就自动判断。 */
export const resolveDeviceType = (deviceType: DeviceType | null): DeviceType => (
    deviceType ?? inferDeviceType()
);

/**
 * 把设备类型与「要不要缩」写到 `<html>`：样式全在 androidPhoneFit.css 里读这几个属性，
 * 组件不需要知道自己是跑在手机还是平板上。
 *
 * 两个属性是分开的，别合并：
 * · `data-folia-device` 记的是**用户的选择** —— 没选过就是 `auto`；
 * · `data-folia-device-resolved` 记的是**实际生效的类型** —— `auto` 会先推断再落到这里。
 *
 * 缩一档（92%）的样式挂在 resolved 上：这样没答过引导、但机器本来就是手机的人
 * 竖屏也能缩 —— 他们恰恰是最需要它的一批。挂在 device 上的话，这批人竖屏不缩、
 * 横屏却缩，同一个界面转一下屏尺度就跳一档。
 */
export const applyDeviceProfile = (deviceType: DeviceType | null): void => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // 没选过也照样生效：那批人恰恰是最需要它的（引导没答、或者答完又清了）。
    const resolved = resolveDeviceType(deviceType);
    root.setAttribute('data-folia-device', deviceType ?? 'auto');
    root.setAttribute('data-folia-device-resolved', resolved);
    // 平板横屏本来就够宽，只有手机才需要让路。
    const landscape = isLandscapeNow();
    root.setAttribute('data-folia-ui-scale', resolved === 'phone' && landscape ? 'compact' : 'normal');
    /*
     * 平板与手机横屏都不再做安全区避让，状态栏也一并常驻收起。
     *
     * 只有手机**竖屏**才需要让：顶上状态栏、底下手势条都实实在在压在内容上。
     *   平板：屏一直够宽，让出来的那一条纯属浪费；
     *   手机横屏：高度本来就只有 360~400，再让掉状态栏 + 手势条，内容区就没什么了。
     *
     * 两条结论都跟着设备类型与朝向走，所以挂在这里 —— 这里已经在
     * orientationchange / resize 上装了监听，不用再各自装一套。
     */
    const roomy = resolved === 'tablet' || (resolved === 'phone' && landscape);
    setSafeAreaBypass(roomy);
    void setSystemBarsAlwaysHidden(roomy);
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
