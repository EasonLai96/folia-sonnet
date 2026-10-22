package top.izuna.foliamajor;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Choreographer;

/**
 * ⚠️ **临时诊断用**，定位完整个文件一起删。
 *
 * 主界面「歌词可视化每隔几秒顿一下」的那个停顿，量出来的形状是：
 *   · 掉帧打点里 `heapMB` 恒为 28 —— **不是 GC**（GC 的话堆会回落）；
 *   · 只在原生播放打开时出现（`native: true`），关掉原生就没有；
 *   · 只发生在 App 内那个 WebView，App 外的悬浮小窗 / 壁纸叠层一点不卡。
 *
 * 最后一条正是指向这里的关键：**App 内那个 WebView 的一帧要由 App 的主线程
 * 合成**，而壁纸 / 悬浮窗是自己往 Surface 上画的，主线程卡一下它们照样出帧。
 * 所以「App 内卡、App 外不卡」＝主线程上有一笔几十到几百毫秒的活，
 * 而 JS 这一侧的打点只能看到结果（两帧之间隔了 80~290ms），看不到是谁干的。
 *
 * 这里补上那一半：给主线程的 Looper 挂一个 Printer，逐条称一下每条消息的耗时，
 * 超过阈值的把**那条消息自己的描述**打出来（`>>>>> Dispatching to Handler (…)` 里
 * 带 handler 的类名与 callback），是谁一目了然。再挂一个 Choreographer 回调，
 * 单独记「主线程上两帧之间隔了多久」，用来跟 JS 那边 `FoliaHitch` 的 atMs 对时间。
 *
 * 用法：`logcat | grep FoliaMainLooper`。
 */
public final class FoliaMainLooperWatchdog {

    private static final String TAG = "FoliaMainLooper";

    /** 单条主线程消息超过这么久就打一条。正常一帧 16ms，40ms 以上就有存在感了。 */
    private static final long SLOW_MESSAGE_MS = 60L;
    /** 主线程上两帧之间超过这么久就打一条。与 JS 侧 FoliaHitch 的阈值一致。 */
    private static final long SLOW_FRAME_MS = 80L;

    private static boolean installed = false;
    /** 当前正在派发的那条消息的描述（Printer 是成对的，中间不会插进别的消息）。 */
    private static String pending = null;
    private static long pendingAtMs = 0L;
    private static long lastFrameAtMs = 0L;

    private FoliaMainLooperWatchdog() {}

    public static synchronized void install() {
        if (installed) {
            return;
        }
        installed = true;
        Looper.getMainLooper().setMessageLogging(new Printer());
        new Handler(Looper.getMainLooper()).post(() -> Choreographer.getInstance().postFrameCallback(new FrameWatch()));
        Log.w(TAG, "installed");
    }

    private static final class Printer implements android.util.Printer {
        @Override
        public void println(String x) {
            if (x == null) {
                return;
            }
            if (x.startsWith(">>>>>")) {
                pending = x;
                pendingAtMs = android.os.SystemClock.uptimeMillis();
                return;
            }
            if (x.startsWith("<<<<<") && pending != null) {
                long cost = android.os.SystemClock.uptimeMillis() - pendingAtMs;
                if (cost >= SLOW_MESSAGE_MS) {
                    Log.w(TAG, "slow message " + cost + "ms | " + shorten(pending));
                }
                pending = null;
            }
        }
    }

    /**
     * 描述里那串对象哈希（`{1a2b3c}`）每次都不一样，留着只会让 logcat 去重失效、
     * 也没法一眼看出「还是同一条」，所以截掉。
     */
    private static String shorten(String line) {
        String text = line;
        int brace = text.indexOf('{');
        if (brace >= 0) {
            int end = text.indexOf('}', brace);
            if (end > brace) {
                text = text.substring(0, brace) + text.substring(end + 1);
            }
        }
        return text.length() > 160 ? text.substring(0, 160) : text;
    }

    private static final class FrameWatch implements Choreographer.FrameCallback {
        @Override
        public void doFrame(long frameTimeNanos) {
            long nowMs = android.os.SystemClock.uptimeMillis();
            if (lastFrameAtMs != 0L) {
                long gap = nowMs - lastFrameAtMs;
                if (gap >= SLOW_FRAME_MS) {
                    Log.w(TAG, "slow frame " + gap + "ms");
                }
            }
            lastFrameAtMs = nowMs;
            Choreographer.getInstance().postFrameCallback(this);
        }
    }
}
