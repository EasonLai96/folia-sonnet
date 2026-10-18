import {
    applyAndroidPhoneFit,
    syncAndroidPhoneFitNative,
    writeStoredAndroidPhoneFitOrientation,
    type AndroidPhoneFitOrientation,
} from './androidPhoneLayout';
import { setDisplayBoost } from '../platform/foliaNative';

// src/services/hdrProjection.ts
// 「HDR 投影」：手机横过来、亮度顶满、整屏左右镜像 —— 屏幕朝上躺在仪表台上，
// 画面经挡风玻璃反射进眼里才是正的。
//
// 为什么是镜像：挡风玻璃是一面镜子，屏幕上「正的」字反射到眼里是反的。所以先把
// 画面翻一次，反射回来就正了。这也是为什么它只在**投射到玻璃**这个用法下才开 ——
// 平时开着只会得到一个左右颠倒的播放器。
//
// 三件事里只有亮度与色彩模式要原生（那是 Activity 窗口的属性，WebView 改不动）；
// 横屏走现成的方向锁，镜像是纯 CSS —— 所以插件不可用时这两半照样生效。

export const HDR_PROJECTION_STORAGE_KEY = 'folia_hdr_projection';

/** 打开之后留给用户的准备时间：把手机放稳，别在翻屏那一刻正拿着它。 */
export const HDR_PROJECTION_COUNTDOWN_SECONDS = 5;

export const readStoredHdrProjection = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(HDR_PROJECTION_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const writeStoredHdrProjection = (enabled: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(HDR_PROJECTION_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // 存不下也要让这一趟生效：投影是临时用法，重开一次拨一下就行。
    }
};

/**
 * 真正落地。
 *
 * 横屏那一份**写进「强制横屏」那个设置**而不是另存一份：那是同一个 Activity 方向锁，
 * 存两份就会互相覆盖（关掉 HDR 时到底该听谁的）；写进去还顺带让设置页那一行跟着变，
 * 用户不会看见「设置里说竖屏、屏幕却是横的」这种自相矛盾。
 */
export const applyHdrProjection = (enabled: boolean): void => {
    const orientation: AndroidPhoneFitOrientation = enabled ? 'landscape' : 'portrait';
    writeStoredAndroidPhoneFitOrientation(orientation);
    applyAndroidPhoneFit(false, orientation);
    syncAndroidPhoneFitNative(true, orientation);

    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-folia-mirror', enabled ? 'true' : 'false');
    }

    void setDisplayBoost(enabled);
};

/* ---------------------------------------------------------------------------
 * 倒计时
 * -------------------------------------------------------------------------
 *
 * 只有一个。手动拨开关与「启动时上次还开着」这两条路都要它 —— 各跑一个的话，
 * 启动那一个会在用户已经拨掉之后照样翻一次屏。所以定时器收在这里，谁都能取消。
 */

let countdownTimer: number | null = null;
let countdownRemaining = 0;
const countdownListeners = new Set<(remaining: number) => void>();

const notifyCountdown = (): void => {
    countdownListeners.forEach((listener) => listener(countdownRemaining));
};

/** 现在还剩几秒（0 = 没有在跑）。组件挂载时靠它接上已经在跑的那一个。 */
export const readHdrProjectionCountdown = (): number => countdownRemaining;

export const subscribeHdrProjectionCountdown = (
    listener: (remaining: number) => void,
): (() => void) => {
    countdownListeners.add(listener);
    return () => {
        countdownListeners.delete(listener);
    };
};

export const cancelHdrProjectionCountdown = (): void => {
    if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
    }
    countdownRemaining = 0;
    notifyCountdown();
};

/** 起一次倒计时：到点写盘并生效。已经在跑的会被顶掉（重新数 5 秒）。 */
export const startHdrProjectionCountdown = (): void => {
    cancelHdrProjectionCountdown();
    countdownRemaining = HDR_PROJECTION_COUNTDOWN_SECONDS;
    notifyCountdown();
    countdownTimer = window.setInterval(() => {
        countdownRemaining -= 1;
        if (countdownRemaining > 0) {
            notifyCountdown();
            return;
        }
        cancelHdrProjectionCountdown();
        writeStoredHdrProjection(true);
        applyHdrProjection(true);
    }, 1000);
};

/**
 * 启动时的恢复：上次开着就走一遍倒计时再生效（「开机后 5 秒再翻横屏」说的就是它）。
 *
 * 镜像**立刻**落 —— 属性晚一帧，开屏那一下会先按正的画面铺一遍再翻过去，看得见跳变。
 * 横屏与亮度没有这个问题：方向锁自己有落盘那份，Activity 起来时早就锁好了；
 * 亮度是窗口属性，下一帧再给也看不出来。
 */
export const installHdrProjectionPreference = (): void => {
    const enabled = readStoredHdrProjection();
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-folia-mirror', enabled ? 'true' : 'false');
    }
    if (!enabled || typeof window === 'undefined') return;
    startHdrProjectionCountdown();
};
