import { showNativeToast } from '../../platform/foliaNative';
import { isBackgroundRenderSuspended } from '../../utils/backgroundRenderGate';

// src/services/playbackRecovery/backgroundFailureNotice.ts
// 后台播放出错的「说一声」通道：界面没人看时，把失败原因交给系统小气泡。
//
// 为什么非要原生气泡：Web 层的提示条是页面里的一个节点，退到后台后那块画面根本没渲染
// （rAF 被总闸拦掉），回到前台才会看到一条迟到的消息 —— 用户在那之前只感觉到「放着放着
// 就没声了」。Toast 由系统画在我们的窗口之外，后台照常冒出来。
//
// 只有 Android 上、且界面确实不可见时才弹。前台照旧走页面里的提示条，那是更安静的选择。

/** 同样一句话在这个窗口内不重复弹：连着几首都放不出来时，气泡不该一次盖一次地刷屏。 */
const DEDUPE_WINDOW_MS = 4000;

let lastText = '';
let lastShownAt = 0;

/**
 * 界面现在是不是没人看。
 *
 * 两个来源取或：`document.visibilityState` 覆盖桌面端切标签页与安卓上的兜底；渲染总闸的
 * 状态覆盖安卓原生那条路（Activity onStop —— 下拉通知栏、切多任务时画面还露着，那时不算
 * 后台，不该走气泡）。
 */
export const isPlaybackInterfaceHidden = (): boolean => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
    return isBackgroundRenderSuspended();
};

/**
 * 后台弹一条气泡。不在后台、不是安卓、或这句话刚弹过：什么都不做。
 *
 * 失败一律静默 —— 提示没弹出来不该影响播放本身，更不该把一次错误处理变成一次异常。
 */
export const notifyBackgroundPlaybackNotice = (text: string): void => {
    if (!text) return;
    if (!isPlaybackInterfaceHidden()) return;
    const now = Date.now();
    if (text === lastText && now - lastShownAt < DEDUPE_WINDOW_MS) return;
    lastText = text;
    lastShownAt = now;
    void showNativeToast(text, { long: true });
};

/** 测试用：清掉去重记录。 */
export const resetBackgroundPlaybackNoticeDedupe = (): void => {
    lastText = '';
    lastShownAt = 0;
};
