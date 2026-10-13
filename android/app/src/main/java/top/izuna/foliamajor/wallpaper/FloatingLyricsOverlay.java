package top.izuna.foliamajor.wallpaper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextPaint;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;

/**
 * 壁纸样式 = 「精简」时挂的那颗**简易桌面歌词悬浮窗**。
 *
 * 为什么要单独一层：精简模式下 `WallpaperOverlay` 那层 WebView 根本不挂（见 shouldShow），
 * 桌面上看到的是原生壁纸那层 GLES 歌词。可用户要的是「像音乐平台那样的悬浮窗」——
 * 能拖、能改大小、能锁、点一下进应用 —— 那是壁纸做不到的：壁纸不收触摸，也没有窗口边界。
 *
 * 所以这一层是**系统悬浮窗**（SYSTEM_ALERT_WINDOW + WindowManager），内容用原生 Canvas 画，
 * 不拉 WebView，也不起 GLES：两行字而已，为一个小窗口背一份 WebView / GL 上下文不划算。
 *
 * 显示逻辑照抄原生壁纸那份「简易」的歌词画法（LyricsRenderer 的常量与曲线搬过来）：
 * 焦点行 + 下一行、换行走入的淡入上滑（easeOutCubic，420ms）、焦点行极缓的呼吸、
 * 逐字（逐词）扫光。区别只有一处：这里**只画两行**（壁纸那层是上下各展开到三行）。
 *
 * 数据复用了现成的 WallpaperLyricsState —— 它就是壁纸 / 叠层 / 锁屏页共用的那一份，
 * 应用推一次，这一层就有；不用另开一条通路。
 */
public final class FloatingLyricsOverlay {

    private static final String TAG = "FloatingLyrics";
    private static final String PREFS = "folia_floating_lyrics";
    private static final String KEY_X = "x";
    private static final String KEY_Y = "y";
    private static final String KEY_W = "w";
    private static final String KEY_H = "h";
    private static final String KEY_LOCKED = "locked";

    /** 巡检间隔：歌词状态是应用推过来的，没有回调可用，只能自己问。 */
    private static final long POLL_INTERVAL_MS = 600L;
    /** 没有存过位置时的默认尺寸（dp）。两行字，够宽就行。 */
    private static final int DEFAULT_WIDTH_DP = 268;
    private static final int DEFAULT_HEIGHT_DP = 96;
    private static final int MIN_WIDTH_DP = 132;
    private static final int MIN_HEIGHT_DP = 58;
    private static final int MAX_WIDTH_DP = 460;
    private static final int MAX_HEIGHT_DP = 260;
    /**
     * 锁定后那颗解锁按钮的边长（dp）。
     *
     * 必须正好是 26：主窗把锁画在 `(宽 - 13dp, 13dp)`，只有以那一点为心的 26dp 方框
     * 才能严丝合缝盖住它 —— 大了会多吃掉一块触摸区，小了点不准。
     */
    private static final int LOCK_CHIP_DP = 26;
    /** 纯音乐要唱过这么久才认定「确实没歌词」，与叠层同一个数。 */
    private static final long INSTRUMENTAL_CONFIRM_MS = 4000L;
    /** 最后一句唱完再留这么久才收窗：片尾那段没有歌词，立刻收会显得突兀。 */
    private static final long LYRICS_END_GRACE_MS = 4000L;
    /** 小窗底色的默认浓度。滑条没推过来时用它（与 store 里那个缺省值同一个数）。 */
    private static final float DEFAULT_BACKGROUND_OPACITY = 0.62f;

    private static volatile FloatingLyricsOverlay instance;

    public static synchronized FloatingLyricsOverlay shared(Context context) {
        if (instance == null) {
            instance = new FloatingLyricsOverlay(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final WindowManager windowManager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;

    private LyricsFloatView view = null;
    private WindowManager.LayoutParams params = null;
    private volatile boolean added = false;
    /** 锁定后单独挂的那颗解锁按钮（另一个窗口，见 syncLockChip）。 */
    private LockChipView chipView = null;
    private WindowManager.LayoutParams chipParams = null;
    private boolean chipAdded = false;
    private boolean appForeground = false;
    private volatile boolean screenOn = true;
    private boolean receiverRegistered = false;
    private boolean polling = false;

    private FloatingLyricsOverlay(Context context) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 应用在前台时收起来：桌面歌词是给「不在应用里」的时候看的。 */
    public void setAppForeground(boolean foreground) {
        if (appForeground == foreground) return;
        appForeground = foreground;
        evaluate();
    }

    /**
     * 这一层此刻是不是挂在屏幕上（壁纸那边要拿它决定自己还画不画歌词）。
     *
     * 必须是 volatile：读它的是 GLES 渲染线程，写它的是主线程。
     */
    public boolean isShowing() {
        return added;
    }

    /** 起巡检与屏幕监听。可以重复调用。 */
    public void start() {
        registerScreenReceiver();
        if (!polling) {
            polling = true;
            handler.post(pollTask);
        }
        evaluate();
    }

    public void stop() {
        polling = false;
        handler.removeCallbacks(pollTask);
        detach();
    }

    /**
     * 把拖出去 / 改坏的小窗恢复默认（位置、大小、锁一起清掉）。
     *
     * 必须有这个出口：小窗是靠角上的把手改的，用户把它拖到屏幕角落、或者缩到最小
     * 又上了锁之后，光靠手是很难弄回来的 —— 尤其「锁」这个状态只画一个很小的图标，
     * 看不出来是能点的。设置里给一颗「重置」按钮最省事。
     */
    public void resetLayout() {
        runOnUi(new Runnable() {
            @Override
            public void run() {
                prefs.edit()
                        .remove(KEY_X)
                        .remove(KEY_Y)
                        .remove(KEY_W)
                        .remove(KEY_H)
                        .remove(KEY_LOCKED)
                        .apply();
                if (added && view != null) {
                    WindowManager.LayoutParams fresh = buildParams();
                    applyLayout(fresh.x, fresh.y, fresh.width, fresh.height);
                }
                // 锁也一起解了：buildParams 只按「现在锁不锁」决定 FLAG_NOT_TOUCHABLE，
                // 所以这里要单独把那个标记清掉，否则重置完小窗还是点不动。
                syncLockTouchable();
                syncLockChip();
                if (view != null) view.invalidate();
            }
        });
    }

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            if (!polling) return;
            evaluate();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (intent == null) return;
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                screenOn = false;
            } else if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_USER_PRESENT.equals(action)) {
                screenOn = true;
            }
            evaluate();
        }
    };

    private void registerScreenReceiver() {
        if (receiverRegistered) return;
        receiverRegistered = true;
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                context.registerReceiver(screenReceiver, filter);
            }
        } catch (Throwable error) {
            Log.w(TAG, "register screen receiver failed", error);
        }
    }

    /** 该不该挂着这一层。每一条都对应一种「挂了反而添乱」的情况。 */
    private boolean shouldShow() {
        // 叠层总开关：关掉就一层都不挂（和锁屏页、WebView 叠层同一个开关）。
        if (!tuningFlag("wp.overlayEnabled", true)) return false;
        if (!Settings.canDrawOverlays(context)) return false;
        if (!screenOn) return false;
        // 在应用里就别盖着自己的界面 —— 播放页本身就有歌词。
        if (appForeground) return false;

        WallpaperLyricsState.Snapshot snapshot = WallpaperLyricsState.get();
        // 只有「精简」样式挂这一层：跟随样式走的是 WebView 叠层（那一层不挂是另一套逻辑）。
        if (!"minimal".equals(snapshot.visualizerMode)) return false;
        // 这两条跟随叠层那两个开关：用户在设置里关了「暂停时隐藏 / 唱完隐藏」，
        // 那小窗就该跟着留着 —— 它是同一套桌面歌词，不该自己另立一套规则。
        if (!snapshot.playing && tuningFlag("wp.hideWhenPaused", true)) return false;
        if (snapshot.lines == null || snapshot.lines.length == 0) return false;
        // 纯音乐（原生补的那行占位）：没有真歌词可显示。
        if (snapshot.placeholderOnly && tuningFlag("wp.skipInstrumental", true)
                && snapshot.positionMs() > INSTRUMENTAL_CONFIRM_MS) {
            return false;
        }
        if (!snapshot.placeholderOnly && tuningFlag("wp.hideAfterLyricsEnd", true)) {
            long end = snapshot.lines[snapshot.lines.length - 1].endMs;
            if (end > 0L && snapshot.positionMs() > end + LYRICS_END_GRACE_MS) return false;
        }
        return true;
    }

    private void evaluate() {
        if (!Looper.myLooper().equals(Looper.getMainLooper())) {
            runOnUi(new Runnable() {
                @Override
                public void run() {
                    evaluate();
                }
            });
            return;
        }
        boolean want = shouldShow();
        if (want && !added) {
            attach();
        } else if (!want && added) {
            detach();
        } else if (want && added) {
            // 转屏 / 换分辨率之后原来那个坐标可能已经出屏了，拉回来（不然小窗"消失"了）。
            reclampIfNeeded();
        }
    }

    private void runOnUi(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            handler.post(action);
        }
    }

    private void reclampIfNeeded() {
        if (params == null) return;
        int screenW = context.getResources().getDisplayMetrics().widthPixels;
        int screenH = context.getResources().getDisplayMetrics().heightPixels;
        int x = clampInt(params.x, 0, Math.max(0, screenW - params.width));
        int y = clampInt(params.y, 0, Math.max(0, screenH - params.height));
        if (x != params.x || y != params.y) {
            applyLayout(x, y, params.width, params.height);
            persistLayout();
        }
    }

    private void attach() {
        if (added || view != null) return;
        try {
            view = new LyricsFloatView(context);
            params = buildParams();
            windowManager.addView(view, params);
            added = true;
            // 上过锁的话还得把那颗解锁按钮单独挂起来（主窗已经整体不吃触摸了）。
            syncLockChip();
        } catch (Throwable error) {
            Log.w(TAG, "attach floating lyrics failed", error);
            view = null;
            added = false;
        }
    }

    private void detach() {
        detachLockChip();
        if (!added || view == null) return;
        // 视图自己排的下一帧不能留着：窗口已经摘了，那条 Runnable 还会把 view 拽着不让它回收。
        handler.removeCallbacks(view.frameTask);
        try {
            windowManager.removeView(view);
        } catch (Throwable error) {
            Log.w(TAG, "detach floating lyrics failed", error);
        }
        view = null;
        added = false;
    }

    // ------------------------------------------------------------------
    // 锁定后的触摸：整层穿透，只有右上角那颗锁还能点
    // ------------------------------------------------------------------

    /**
     * 锁定时把主窗设成 `FLAG_NOT_TOUCHABLE`。
     *
     * 这是唯一能让触摸**真的穿过去**的办法 —— `onTouchEvent` 返回 false 不管用：
     * 输入分发是**先按窗口挑一层**的，挑中了我们这一层，事件就落在这一层里，
     * 我们不处理它就只是丢掉，不会退给底下那一层（NOT_TOUCH_MODAL 只管窗口**外面**）。
     * 而 FLAG_NOT_TOUCHABLE 是整窗生效，所以那颗解锁按钮必须另开一个小窗口来接。
     */
    private void syncLockTouchable() {
        if (params == null || !added) return;
        if (isLocked()) {
            params.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        } else {
            params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }
        applyLayout(params.x, params.y, params.width, params.height);
    }

    /**
     * 锁定后挂的那颗解锁按钮：**单独一个窗口**，只有右上角 26dp 见方那么大。
     *
     * 它**什么都不画** —— 锁那个图标是主窗画的（位置严丝合缝：主窗画在
     * `宽 - 13dp, 13dp`，这一块正好是以那一点为心的 26dp 方框），
     * 自己再画一遍就是两个半透明圆叠一起，颜色会变深。它的全部作用就是接触摸。
     */
    private void syncLockChip() {
        if (!added || view == null || !isLocked()) {
            detachLockChip();
            return;
        }
        if (chipAdded && chipView != null) {
            positionLockChip();
            return;
        }
        try {
            chipView = new LockChipView(context);
            chipParams = buildChipParams();
            windowManager.addView(chipView, chipParams);
            chipAdded = true;
        } catch (Throwable error) {
            Log.w(TAG, "attach lock chip failed", error);
            chipView = null;
            chipAdded = false;
        }
    }

    private WindowManager.LayoutParams buildChipParams() {
        float density = context.getResources().getDisplayMetrics().density;
        int size = Math.round(LOCK_CHIP_DP * density);
        int x = params == null ? 0 : params.x + params.width - size;
        int y = params == null ? 0 : params.y;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size, size, x, y, windowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSPARENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        return lp;
    }

    /** 主窗挪过之后要跟着走：这一块是照着主窗右上角算出来的绝对坐标。 */
    private void positionLockChip() {
        if (!chipAdded || chipView == null || chipParams == null || params == null) return;
        int x = params.x + params.width - chipParams.width;
        int y = params.y;
        if (x == chipParams.x && y == chipParams.y) return;
        chipParams.x = x;
        chipParams.y = y;
        try {
            windowManager.updateViewLayout(chipView, chipParams);
        } catch (Throwable error) {
            Log.w(TAG, "move lock chip failed", error);
        }
    }

    private void detachLockChip() {
        if (!chipAdded || chipView == null) return;
        try {
            windowManager.removeView(chipView);
        } catch (Throwable error) {
            Log.w(TAG, "detach lock chip failed", error);
        }
        chipView = null;
        chipParams = null;
        chipAdded = false;
    }

    private int windowType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private WindowManager.LayoutParams buildParams() {
        float density = context.getResources().getDisplayMetrics().density;
        int screenW = context.getResources().getDisplayMetrics().widthPixels;
        int screenH = context.getResources().getDisplayMetrics().heightPixels;

        int width = prefs.getInt(KEY_W, 0);
        int height = prefs.getInt(KEY_H, 0);
        if (width <= 0) width = Math.round(DEFAULT_WIDTH_DP * density);
        if (height <= 0) height = Math.round(DEFAULT_HEIGHT_DP * density);
        width = clampInt(width, Math.round(MIN_WIDTH_DP * density), Math.round(MAX_WIDTH_DP * density));
        height = clampInt(height, Math.round(MIN_HEIGHT_DP * density), Math.round(MAX_HEIGHT_DP * density));

        int x = prefs.getInt(KEY_X, Integer.MIN_VALUE);
        int y = prefs.getInt(KEY_Y, Integer.MIN_VALUE);
        boolean hasPosition = x != Integer.MIN_VALUE && y != Integer.MIN_VALUE;
        if (!hasPosition) {
            // 默认落在屏幕上方三分之一处居中：桌面歌词放中间会挡住图标，放最上面又压状态栏。
            x = Math.max(0, (screenW - width) / 2);
            y = Math.round(screenH * 0.22f);
        }
        // 换了屏幕（转屏 / 换设备）之后原来那个位置可能已经在屏幕外了，拉回来。
        x = clampInt(x, 0, Math.max(0, screenW - width));
        y = clampInt(y, 0, Math.max(0, screenH - height));

        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        // 上着锁的话整层不收触摸：让手指直接落到下面的桌面 / 应用上（见 syncLockTouchable）。
        if (isLocked()) {
            flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                width, height, x, y, windowType(), flags,
                android.graphics.PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        // 让这一层不吃掉窗口 inset：它自己按存的坐标摆，系统栏那一条由用户拖出来的位置决定。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        return lp;
    }

    private void applyLayout(int x, int y, int width, int height) {
        if (params == null || view == null || !added) return;
        params.x = x;
        params.y = y;
        params.width = width;
        params.height = height;
        try {
            windowManager.updateViewLayout(view, params);
        } catch (Throwable error) {
            Log.w(TAG, "update floating lyrics layout failed", error);
        }
        positionLockChip();
    }

    private void persistLayout() {
        if (params == null) return;
        prefs.edit()
                .putInt(KEY_X, params.x)
                .putInt(KEY_Y, params.y)
                .putInt(KEY_W, params.width)
                .putInt(KEY_H, params.height)
                .apply();
    }

    private boolean isLocked() {
        return prefs.getBoolean(KEY_LOCKED, false);
    }

    private void setLocked(boolean locked) {
        prefs.edit().putBoolean(KEY_LOCKED, locked).apply();
        if (view != null) view.invalidate();
        // 顺序有讲究：先把主窗的触摸开关翻过来，再决定那颗解锁按钮挂不挂。
        syncLockTouchable();
        syncLockChip();
    }

    /** 点一下进应用。用 REORDER_TO_FRONT：已经在后台就把它叫回来，不新起一个实例。 */
    private void openApp() {
        try {
            Intent launch = context.getPackageManager()
                    .getLaunchIntentForPackage(context.getPackageName());
            if (launch == null) return;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            context.startActivity(launch);
        } catch (Throwable error) {
            Log.w(TAG, "open app failed", error);
        }
    }

    private static boolean tuningFlag(String key, boolean fallback) {
        java.util.Map<String, Float> tuning = WallpaperLyricsState.tuning();
        Float value = tuning == null ? null : tuning.get(key);
        return value == null ? fallback : value >= 0.5f;
    }

    /** 读一个 wp. 开头的数值开关，缺了就用 fallback。 */
    private static float tuningFloat(String key, float fallback) {
        java.util.Map<String, Float> tuning = WallpaperLyricsState.tuning();
        Float value = tuning == null ? null : tuning.get(key);
        if (value == null || !Float.isFinite(value)) return fallback;
        return clamp(value, 0.05f, 1f);
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    // =========================================================================
    // 悬浮窗本体
    // =========================================================================

    /**
     * 两行歌词的内容视图。
     *
     * 触摸这一块自己做：整层只有这一个 View，拖动 / 改大小 / 锁 / 点开应用全靠
     * 在 onTouchEvent 里按落点分派 —— 不用再往窗口里塞按钮（那会把触摸区吃掉，
     * 歌词本身反而点不到）。
     */
    private final class LyricsFloatView extends View {

        private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint controlPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint textPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final RectF frame = new RectF();

        /** 换行走入的时长（毫秒）与曲线：和原生壁纸那份同一个数，两边观感才一致。 */
        private static final long LINE_ENTER_MS = 420L;
        /** 走入时从下方多远滑上来（单位 = 行距）。 */
        private static final float LINE_ENTER_RISE = 0.16f;
        /** 焦点行极缓的呼吸幅度。 */
        private static final float LINE_BREATH = 0.05f;
        /** 整层淡入（挂上窗口那一刻）。 */
        private static final long APPEAR_MS = 220L;
        /** 次行的字号比例（下一行）与翻译行的字号比例。 */
        private static final float NEXT_FONT_RATIO = 0.86f;
        private static final float TRANSLATION_FONT_RATIO = 0.62f;
        /**
         * 自绘动画的帧间隔（≈30fps）。
         *
         * 这一层叠在所有窗口之上，每画一帧系统就要重新合成一次；两行字的扫光
         * 在 30fps 下看不出差别，但 CPU 与功耗是一半。壁纸那层跑满帧是因为它
         * 是 GLES 且本来就在全屏刷。
         */
        private static final long FRAME_INTERVAL_MS = 33L;

        private int lastIndex = -1;
        private long transitionStartMs = 0L;
        private long appearStartMs = 0L;
        private int primaryColor = 0xFFFFFFFF;
        private int secondaryColor = 0xB3FFFFFF;
        private int accentColor = 0xFF7C5CFF;
        private int baseColor = 0xFF09090B;
        private long paletteStamp = -1L;

        // ---- 触摸 ----
        private static final int MODE_NONE = 0;
        private static final int MODE_MOVE = 1;
        private static final int MODE_RESIZE = 2;
        private static final int MODE_LOCK = 3;
        private int touchMode = MODE_NONE;
        private float startRawX = 0f;
        private float startRawY = 0f;
        private int startWinX = 0;
        private int startWinY = 0;
        private int startWidth = 0;
        private int startHeight = 0;
        private long downAtMs = 0L;
        private boolean moved = false;
        private long lastFrameAtMs = 0L;
        private boolean framePending = false;

        LyricsFloatView(Context ctx) {
            super(ctx);
            appearStartMs = android.os.SystemClock.elapsedRealtime();
            refreshPalette();
            Typeface face = WallpaperLyricsFont.load(context);
            if (face != null) {
                textPaint.setTypeface(face);
            }
        }

        private void refreshPalette() {
            WallpaperLyricsState.Snapshot snapshot = WallpaperLyricsState.get();
            accentColor = snapshot.accent;
            baseColor = snapshot.baseColor;
            String[] palette = WallpaperThemePalette.read(context);
            primaryColor = parseColor(palette[0], 0xFFFFFFFF);
            secondaryColor = parseColor(palette[1], 0xB3FFFFFF);
            paletteStamp = snapshot.stamp;
        }

        private int parseColor(String value, int fallback) {
            if (value == null || value.isEmpty()) return fallback;
            try {
                return Color.parseColor(value);
            } catch (Throwable error) {
                return fallback;
            }
        }

        private float dp(float value) {
            return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                    getResources().getDisplayMetrics());
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int width = getWidth();
            int height = getHeight();
            if (width <= 0 || height <= 0) return;

            WallpaperLyricsState.Snapshot snapshot = WallpaperLyricsState.get();
            if (snapshot.stamp != paletteStamp) {
                refreshPalette();
            }

            long now = android.os.SystemClock.elapsedRealtime();
            float appear = clamp01((now - appearStartMs) / (float) APPEAR_MS);
            appear = easeOutCubic(appear);

            drawBackground(canvas, width, height, appear);

            long position = snapshot.positionMs();
            int index = snapshot.lines.length == 0 ? -1 : snapshot.indexAt(position);
            if (index < 0) {
                drawControls(canvas, width, height, appear);
                return;
            }
            int previous = lastIndex;
            if (index != lastIndex) {
                lastIndex = index;
                transitionStartMs = now;
            }

            float padY = dp(10);
            float rowHeight = (height - padY * 2f) / 2f;
            float focusY = padY + rowHeight * 0.5f;
            float secondY = padY + rowHeight * 1.5f;
            float focusSize = rowHeight * 0.62f;

            float transition = clamp01((now - transitionStartMs) / (float) LINE_ENTER_MS);
            float enter = easeOutCubic(transition);
            // 换行走入的位移：整块内容从下方 0.16 行距处滑到位（和原生壁纸同一个数）。
            float rise = rowHeight * LINE_ENTER_RISE;

            float progress = snapshot.progressAt(position);
            float breath = 1f - LINE_BREATH * 0.5f
                    + LINE_BREATH * 0.5f * (float) (1f + Math.sin(now / 900f)) / 2f;

            /*
             * 只有**两行**：上格是当前句，下格是它的翻译（没有翻译就放下一句）。
             *
             * 那「上一句往哪儿去了」：它和当前句共用上格 —— 换行那 420ms 里旧句往上滑出去
             * 并淡掉，新句从下方滑进来补上，**同一格里做交叉**。
             * 这样既保住了「唱过去的那句滚出去」这个动作，又不会多出第三行 ——
             * 用户要的是两行，多一行就成了壁纸那层（上下各展开到三行）。
             * 跳转（拖动进度）造成的跨行不走这个交叉：那不是「唱过去」，做了反而是乱跳。
             */
            boolean rolled = transition < 1f && previous >= 0 && index == previous + 1;
            if (rolled) {
                float outAlpha = appear * (1f - enter);
                float outShift = -rise * enter;
                drawBlock(canvas, snapshot, previous, width, focusY + outShift,
                        secondY + outShift, focusSize, outAlpha, -1f, 1f, 0L);
            }
            float inAlpha = rolled ? enter : 1f;
            float inShift = rolled ? rise * (1f - enter) : 0f;
            drawBlock(canvas, snapshot, index, width, focusY + inShift,
                    secondY + inShift, focusSize, appear * inAlpha, progress,
                    breath, position);

            drawControls(canvas, width, height, appear);

            // 还在播、或者动画还没走完，就再要一帧。停了就别空转烧 CPU。
            // 限到 ~30fps：这是叠在所有窗口之上的一层，每帧都要系统重新合成一次，
            // 两行字的扫光在 30fps 下看不出差别，但功耗是一半。
            if (snapshot.playing || transition < 1f || appear < 1f) {
                long since = now - lastFrameAtMs;
                if (since >= FRAME_INTERVAL_MS) {
                    lastFrameAtMs = now;
                    postInvalidateOnAnimation();
                } else if (!framePending) {
                    framePending = true;
                    handler.postDelayed(frameTask, FRAME_INTERVAL_MS - since);
                }
            }
        }

        private final Runnable frameTask = new Runnable() {
            @Override
            public void run() {
                framePending = false;
                if (view != null) view.invalidate();
            }
        };

        /**
         * 画「一格两行」：上格是焦点句，下格是它的翻译或下一句。
         *
         * @param progress 小于 0 表示不扫光（退场中的那一格）。
         * @param breath   焦点行的呼吸系数，1 = 不呼吸。
         */
        private void drawBlock(Canvas canvas, WallpaperLyricsState.Snapshot snapshot, int index,
                               int width, float focusY, float secondY, float focusSize,
                               float alpha, float progress, float breath, long position) {
            if (index < 0 || index >= snapshot.lines.length || alpha <= 0.004f) return;

            // 焦点行：逐字（逐词）扫光 + 呼吸。
            drawRow(canvas, snapshot.lines[index].text, width, focusY, focusSize,
                    primaryColor, alpha * breath,
                    progress, snapshot.lines[index], position);

            // 第二行：有翻译且开了就显示翻译，否则显示下一句。
            String translation = snapshot.showTranslation ? snapshot.lines[index].translation : null;
            if (translation != null && !translation.trim().isEmpty()) {
                drawRow(canvas, translation, width, secondY,
                        focusSize * TRANSLATION_FONT_RATIO, secondaryColor,
                        alpha * 0.86f, -1f, null, 0L);
            } else if (index + 1 < snapshot.lines.length) {
                drawRow(canvas, snapshot.lines[index + 1].text, width, secondY,
                        focusSize * NEXT_FONT_RATIO, secondaryColor,
                        alpha * 0.62f, -1f, null, 0L);
            }
        }

        private void drawBackground(Canvas canvas, int width, int height, float appear) {
            float radius = dp(14);
            frame.set(0f, 0f, width, height);
            /*
             * 底色浓度是设置里那根「简易 · 背景不透明度」滑条（wp.floatingBackgroundOpacity）。
             *
             * 每帧现读而不是缓存：tuning 是应用随时推下来的，而这一层的 Snapshot.stamp
             * 只在换了歌 / 换了外观时才变 —— 缓存住的话，用户拖动滑条要等下一首歌才看到效果。
             * 一次 HashMap.get 而已，30fps 下可以忽略。
             */
            float opacity = tuningFloat("wp.floatingBackgroundOpacity", DEFAULT_BACKGROUND_OPACITY);
            backgroundPaint.setStyle(Paint.Style.FILL);
            backgroundPaint.setColor(withAlpha(baseColor, opacity * appear));
            canvas.drawRoundRect(frame, radius, radius, backgroundPaint);

            // 描边**不跟着一起淡到底**：底色调到很淡时，没有这条边小窗就彻底找不着了。
            borderPaint.setStyle(Paint.Style.STROKE);
            borderPaint.setStrokeWidth(Math.max(1f, dp(1)));
            borderPaint.setColor(withAlpha(accentColor, (0.14f + 0.22f * opacity) * appear));
            canvas.drawRoundRect(frame, radius, radius, borderPaint);
        }

        /**
         * 画一行。
         *
         * 扫光是**先画整行的主色、再把唱过的那一段用高亮色重画一遍并裁掉剩下的** ——
         * 原生壁纸那份也是这个做法（drawPerChar 是逐字的变体），两个图层错位就会出重影。
         *
         * @param progress 小于 0 表示这一行不扫光（下一句 / 翻译 / 上一句）。
         */
        private void drawRow(Canvas canvas, String text, int width, float centerY, float fontSize,
                             int color, float alpha, float progress,
                             WallpaperLyricsState.TimedLine line, long positionMs) {
            if (text == null || text.isEmpty() || alpha <= 0.004f) return;

            textPaint.setColor(color);
            textPaint.setTextSize(fontSize);
            textPaint.setTextAlign(Paint.Align.LEFT);

            float maxWidth = width - dp(28);
            float measured = textPaint.measureText(text);
            if (measured > maxWidth && measured > 0f) {
                // 太长的句子缩字号，别撑出窗口（拖小之后尤其常见）。
                fontSize = Math.max(fontSize * 0.5f, fontSize * (maxWidth / measured));
                textPaint.setTextSize(fontSize);
                measured = textPaint.measureText(text);
            }
            float x = Math.max(dp(14), (width - measured) / 2f);
            Paint.FontMetrics metrics = textPaint.getFontMetrics();
            float baseline = centerY - (metrics.ascent + metrics.descent) / 2f;

            textPaint.setAlpha(Math.round(clamp01(alpha) * 255f));
            canvas.drawText(text, x, baseline, textPaint);

            if (progress < 0f || line == null) return;
            float swept = sweptWidth(textPaint, line, text, positionMs, progress);
            if (swept <= 0.5f) return;

            canvas.save();
            canvas.clipRect(x - dp(2), centerY - fontSize * 1.2f, x + swept + dp(2), centerY + fontSize * 1.2f);
            textPaint.setColor(accentColor);
            textPaint.setAlpha(Math.round(clamp01(alpha) * 255f));
            canvas.drawText(text, x, baseline, textPaint);
            canvas.restore();
        }

        /**
         * 唱到哪个位置（像素）。
         *
         * 有逐词时间轴就按词算（和 App 里那份 LRC 的粒度一致）；没有就退化成整行按进度线性推。
         */
        private float sweptWidth(TextPaint paint, WallpaperLyricsState.TimedLine line, String text,
                                 long positionMs, float progress) {
            WallpaperLyricsState.TimedWord[] words = line.words;
            if (words == null || words.length == 0) {
                return paint.measureText(text) * clamp01(progress);
            }
            StringBuilder done = new StringBuilder();
            for (int i = 0; i < words.length; i += 1) {
                WallpaperLyricsState.TimedWord word = words[i];
                if (word == null) continue;
                if (positionMs >= word.endMs) {
                    done.append(word.text);
                    continue;
                }
                float headWidth = done.length() == 0 ? 0f : paint.measureText(done.toString());
                long span = word.endMs - word.startMs;
                float ratio = span <= 0 ? 1f : clamp01((positionMs - word.startMs) / (float) span);
                return headWidth + paint.measureText(word.text) * ratio;
            }
            return paint.measureText(text);
        }

        /** 右上角那颗锁（常驻，锁了也能解锁）与右下角的拉伸把手（锁了就不画）。 */
        private void drawControls(Canvas canvas, int width, int height, float appear) {
            controlPaint.setStyle(Paint.Style.FILL);
            controlPaint.setStrokeWidth(Math.max(1.5f, dp(1.5f)));

            // 锁：右上角一个圆点 + 锁体。锁着时画闭合的锁梁，解锁时画张开的。
            float cx = width - dp(13);
            float cy = dp(13);
            float r = dp(9);
            // 锁着的时候这颗锁是**唯一**还能点的地方（整层都穿透了），
            // 所以画得实一点 —— 否则用户只看到一块半透明歌词，根本不知道该点哪儿解锁。
            float lockAlpha = isLocked() ? 0.92f : 0.72f;
            controlPaint.setColor(withAlpha(baseColor, lockAlpha * appear));
            canvas.drawCircle(cx, cy, r, controlPaint);
            controlPaint.setStyle(Paint.Style.STROKE);
            controlPaint.setColor(withAlpha(primaryColor, lockAlpha * appear));
            // 锁体
            float bodyW = dp(7);
            float bodyH = dp(5.5f);
            canvas.drawRect(cx - bodyW / 2f, cy - dp(0.5f), cx + bodyW / 2f, cy - dp(0.5f) + bodyH, controlPaint);
            // 锁梁：锁着时是完整半圆，解锁时往右上翻开一个口子。
            float shackleTop = cy - dp(3.4f);
            android.graphics.RectF shackle = new android.graphics.RectF(
                    cx - bodyW / 2f + dp(1), shackleTop - bodyH * 0.7f,
                    cx + bodyW / 2f - dp(1), shackleTop + bodyH * 0.5f);
            if (isLocked()) {
                canvas.drawArc(shackle, 180f, 180f, false, controlPaint);
            } else {
                canvas.drawArc(shackle, 200f, 140f, false, controlPaint);
            }

            if (isLocked()) return;

            // 拉伸把手：右下角两道斜线。
            controlPaint.setStyle(Paint.Style.STROKE);
            controlPaint.setColor(withAlpha(primaryColor, 0.42f * appear));
            float gx = width - dp(6);
            float gy = height - dp(6);
            canvas.drawLine(gx - dp(10), gy, gx, gy - dp(10), controlPaint);
            canvas.drawLine(gx - dp(5), gy, gx, gy - dp(5), controlPaint);
        }

        private int withAlpha(int color, float alpha) {
            int a = Math.round(clamp01(alpha) * 255f);
            return Color.argb(a, Color.red(color), Color.green(color), Color.blue(color));
        }

        // ---- 触摸：点 / 拖 / 改大小 / 锁 ----

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (event == null) return false;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startRawX = event.getRawX();
                    startRawY = event.getRawY();
                    downAtMs = android.os.SystemClock.elapsedRealtime();
                    moved = false;
                    touchMode = hitTest(event.getX(), event.getY());
                    if (params != null) {
                        startWinX = params.x;
                        startWinY = params.y;
                        startWidth = params.width;
                        startHeight = params.height;
                    }
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - startRawX;
                    float dy = event.getRawY() - startRawY;
                    if (!moved && Math.abs(dx) + Math.abs(dy) > dp(4)) {
                        moved = true;
                    }
                    if (!moved) return true;
                    if (touchMode == MODE_RESIZE) {
                        resizeBy(dx, dy);
                    } else if (touchMode == MODE_MOVE && !isLocked()) {
                        moveBy(dx, dy);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    boolean isUp = event.getActionMasked() == MotionEvent.ACTION_UP;
                    long held = android.os.SystemClock.elapsedRealtime() - downAtMs;
                    if (isUp && !moved && touchMode == MODE_LOCK) {
                        setLocked(!isLocked());
                    } else if (isUp && !moved && held < ViewConfiguration.getTapTimeout() + 120L) {
                        openApp();
                    } else if (moved && (touchMode == MODE_MOVE || touchMode == MODE_RESIZE)) {
                        persistLayout();
                    }
                    touchMode = MODE_NONE;
                    return true;
                default:
                    return false;
            }
        }

        private int hitTest(float x, float y) {
            int width = getWidth();
            int height = getHeight();
            // 锁（右上角，命中区比画出来的大一圈：手指没那么准）
            if (x >= width - dp(26) && y <= dp(26)) return MODE_LOCK;
            // 拉伸（右下角）
            if (!isLocked() && x >= width - dp(26) && y >= height - dp(26)) return MODE_RESIZE;
            return MODE_MOVE;
        }

        private void moveBy(float dx, float dy) {
            if (params == null) return;
            int screenW = getResources().getDisplayMetrics().widthPixels;
            int screenH = getResources().getDisplayMetrics().heightPixels;
            int x = clampInt((int) (startWinX + dx), 0, Math.max(0, screenW - params.width));
            int y = clampInt((int) (startWinY + dy), 0, Math.max(0, screenH - params.height));
            applyLayout(x, y, params.width, params.height);
        }

        private void resizeBy(float dx, float dy) {
            if (params == null) return;
            float density = getResources().getDisplayMetrics().density;
            int width = clampInt((int) (startWidth + dx),
                    Math.round(MIN_WIDTH_DP * density), Math.round(MAX_WIDTH_DP * density));
            int height = clampInt((int) (startHeight + dy),
                    Math.round(MIN_HEIGHT_DP * density), Math.round(MAX_HEIGHT_DP * density));
            int screenW = getResources().getDisplayMetrics().widthPixels;
            int screenH = getResources().getDisplayMetrics().heightPixels;
            int x = clampInt(params.x, 0, Math.max(0, screenW - width));
            int y = clampInt(params.y, 0, Math.max(0, screenH - height));
            applyLayout(x, y, width, height);
        }
    }

    /**
     * 锁定后那颗解锁按钮所在的小窗口。
     *
     * 它**什么都不画**（见 syncLockChip 里为什么），存在的全部意义是在主窗已经
     * `FLAG_NOT_TOUCHABLE` 的情况下，把右上角那一小块接触摸收下来 —— 于是
     * 「锁定 = 整层穿透，只有解锁按钮能点」这两件事能同时成立。
     */
    private final class LockChipView extends View {

        LockChipView(Context ctx) {
            super(ctx);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            // 故意不画：锁那个图标是主窗画的，再画一遍两个半透明圆会叠深。
            super.onDraw(canvas);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (event == null) return false;
            if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                // 延后一拍再解锁：解锁要把自己这个窗口摘掉，
                // 在触摸派发的中途 removeView 容易撞上「正在派发的窗口没了」。
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        setLocked(false);
                    }
                });
            }
            return true;
        }
    }

    private static float clamp01(float value) {
        return value < 0f ? 0f : value > 1f ? 1f : value;
    }

    /** 与原生壁纸那份同一个缓动：先快后慢，短一点才叫「一点点动画」。 */
    private static float easeOutCubic(float value) {
        float t = clamp01(value);
        float inverse = 1f - t;
        return 1f - inverse * inverse * inverse;
    }
}
