package top.izuna.foliamajor.wallpaper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.res.Configuration;
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

    /** 开关：小窗直接叠在安全区（状态栏那一条）上面，而不是摆在屏幕里。 */
    private static final String KEY_OVER_SAFE_AREA = "wp.floatingOverSafeArea";
    /** 叠加模式下窗口占屏幕宽度的比例（0 = 没设）。 */
    private static final String KEY_WIDTH = "wp.floatingWidth";
    /** 字号模式：0 = 动态（跟着窗口高度算），1 = 自定义。 */
    private static final String KEY_FONT_SIZE_MODE = "wp.floatingFontSizeMode";
    /** 自定义模式的字号（dp）。只在上面那个开关打开时用。 */
    private static final String KEY_FONT_SIZE = "wp.floatingFontSize";
    /**
     * 叠加模式下窗口高度的下限（dp）。
     *
     * 正常是拿系统的 status_bar_height（一般 24~40dp）。少数 ROM 不提供那个 dimen，
     * 读出来是 0 —— 那时窗口高度会变成 0，整层直接看不见，所以兜一个能画下
     * 一行字的高度。
     */
    private static final float MIN_SAFE_AREA_HEIGHT_DP = 26f;
    /** 左右位置：0 = 贴左，1 = 贴右。只有「叠加安全区」开着时才用得上。 */
    private static final String KEY_OFFSET_X = "wp.floatingOffsetX";
    /**
     * 开关：叠加模式下直接**占满整条安全区**（左右不再留空，宽度滑条让位）。
     *
     * 非竖屏时这一条不生效（见 `fillSafeArea()`）：横屏下状态栏那一条的意义完全不同，
     * 占满只会糊住一整条。
     */
    private static final String KEY_FILL_SAFE_AREA = "wp.floatingFillSafeArea";
    /**
     * 占满时留出来的「避开区域」宽度（占整条宽的比例）。0 = 不避让。
     *
     * 挖孔屏 / 刘海屏上，状态栏正中或某一侧有个洞，字压上去就成了「字被切了一块」。
     * 由于各家 ROM 都不往外报挖孔位置，只能让用户自己指：多宽、在哪边。
     */
    private static final String KEY_AVOID_WIDTH = "wp.floatingAvoidWidth";
    /** 避开区域的左右位置：0 = 贴左，1 = 贴右。 */
    private static final String KEY_AVOID_OFFSET_X = "wp.floatingAvoidOffsetX";
    /**
     * 开关：在 App 里也把这一层挂出来，好让设置页当场看到改动（预览）。
     *
     * 没有它的话「实时预览」是个空话 —— 正常逻辑里 `appForeground` 一命中就不挂，
     * 而调设置恰恰是在 App 里做的，滑条拖到头也看不见任何东西。
     * 由设置页挂载期间置 1、离开置 0。
     */
    private static final String KEY_PREVIEW = "wp.floatingPreview";
    /**
     * 预览又没有歌词可显示时画的占位。
     *
     * 挑一行「什么语言都认识」的：它只是让人看清位置 / 大小 / 避开区域，
     * 长度也要够 —— 太短的话绕不过避开区域，看不到那条缝在哪。
     */
    private static final String PREVIEW_SAMPLE_TEXT = "♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪";
    /** 用户在叠加模式下拖出来的左右位置（0~1）。拖过就以它为准，设置里改了再覆盖。 */
    private static final String KEY_DRAG_RATIO = "drag_ratio";

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
    /** 上一次量到的屏幕尺寸（0 = 还没量过）。转屏时用来把位置按比例搬过去。 */
    private int lastScreenW = 0;
    private int lastScreenH = 0;
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
                        // 叠加模式拖出来的左右位置也一起清：不然「重置」完小窗还在老的那一侧。
                        .remove(KEY_DRAG_RATIO)
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

        /*
         * 预览时**唯独**放行「在应用里」这一条。
         *
         * 正常逻辑在 App 里不挂是怕盖着自己的界面（播放页本身就有歌词），
         * 但调设置恰恰是在 App 里做的 —— 不放行的话，设置页那几根「实时预览」的滑条
         * 拖到头也看不到任何东西（这正是「看不到预览」）。
         * 预览窗口同时被强制成不吃触摸（见 buildParams），不会挡住底下的滑条。
         */
        boolean preview = previewMode();
        if (appForeground && !preview) return false;

        WallpaperLyricsState.Snapshot snapshot = WallpaperLyricsState.get();
        // 只有「精简」样式挂这一层：跟随样式走的是 WebView 叠层（那一层不挂是另一套逻辑）。
        if (!"minimal".equals(snapshot.visualizerMode)) return false;

        /*
         * 预览只看**摆成什么样**，不看该不该出现 —— 暂停中、唱完了、甚至压根没放歌
         * 都得照样画出来，否则用户拨了半天开关面对的是一片空白，
         * 只会以为功能坏了（没歌词时走 onDraw 里那行占位）。
         */
        if (preview) return true;

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

        /*
         * 转屏（或换了分辨率）：位置按**比例**搬过去，不能沿用上一屏的像素坐标。
         *
         * 原来只是把旧坐标夹回新屏幕内 —— 竖屏算出来的 x 是「竖屏宽」的中点，
         * 横过来屏幕一下子宽了一倍多，那个 x 就变成了明显偏左（用户原话：
         * 「横屏状态下没有在最中间」）。安全区那套早就是按比例的（左右位置存 0~1），
         * 所以横屏下它仍然居中 —— 普通模式现在跟它一致：竖屏居中，横屏照样居中；
         * 拖到左边的，横屏也还在左边那个相对位置。
         */
        if (lastScreenW > 0 && lastScreenH > 0
                && (lastScreenW != screenW || lastScreenH != screenH)) {
            float ratioX = clamp01(params.x / (float) Math.max(1, lastScreenW - params.width));
            float ratioY = clamp01(params.y / (float) Math.max(1, lastScreenH - params.height));
            int spanW = Math.max(0, screenW - params.width);
            int spanH = Math.max(0, screenH - params.height);
            int x = clampInt(Math.round(ratioX * spanW), 0, spanW);
            int y = clampInt(Math.round(ratioY * spanH), 0, spanH);
            applyLayout(x, y, params.width, params.height);
            persistLayout();
        }
        lastScreenW = screenW;
        lastScreenH = screenH;

        if (overSafeArea()) {
            // 转屏之后宽度变了，左右比例要按新的屏幕重算一次，不然小窗会跑出去；
            // 高度跟着新的状态栏高度走（横屏时它可能不一样）。
            float density = context.getResources().getDisplayMetrics().density;
            int width = overlayWidthPx(screenW, density, params.width);
            int x = overlayLeftPx(width, screenW);
            int height = statusBarHeightPx();
            /*
             * 「占满」在转屏这一刻可能刚失效（横过来）或刚恢复（竖回来），
             * 所以宽度也要一起比 —— 只比 x 的话横屏下会一直停在整条宽。
             */
            if (x != params.x || width != params.width || params.height != height) {
                applyLayout(x, params.y, width, height);
            }
            // 重新挂过一次之后可能又被系统夹下来了，再顶一遍。
            nudgeIntoCutout();
            return;
        }
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
            // 叠加模式下按实际量到的位置再往上顶一次（有些 ROM 会把这一层夹到状态栏之下）。
            nudgeIntoCutout();
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

        int x;
        int y;
        if (overSafeArea()) {
            /*
             * 叠加在安全区上面：贴着屏幕最顶上那条放（y = 0，盖住状态栏那一带），
             * 左右由比例决定 —— 这个模式下高度方向没有意义，只给左右。
             *
             * 高度**锁死**成状态栏那一条：这个模式要的就是占住那一带，
             * 让用户把它拖成三行高就等于把状态栏整条糊住了。宽度仍然可调（左右大小）。
             */
            height = statusBarHeightPx();
            /*
             * 宽度优先听设置里那根「宽度」滑条（屏幕宽的比例）。
             *
             * 用比例而不是 dp：这个模式要的就是「占住状态栏这一条的多宽」，
             * 说 30% 比说 120dp 直观，换设备也不会变样。
             *
             * 开了「占满」就是整条屏宽 —— 那时这两根滑条都不参与。
             */
            width = overlayWidthPx(screenW, density, width);
            x = overlayLeftPx(width, screenW);
            y = 0;
        } else {
            x = prefs.getInt(KEY_X, Integer.MIN_VALUE);
            y = prefs.getInt(KEY_Y, Integer.MIN_VALUE);
            boolean hasPosition = x != Integer.MIN_VALUE && y != Integer.MIN_VALUE;
            if (!hasPosition) {
                // 默认落在屏幕上方三分之一处居中：桌面歌词放中间会挡住图标，放最上面又压状态栏。
                x = Math.max(0, (screenW - width) / 2);
                y = Math.round(screenH * 0.22f);
            }
            // 换了屏幕（转屏 / 换设备）之后原来那个位置可能已经在屏幕外了，拉回来。
            x = clampInt(x, 0, Math.max(0, screenW - width));
            y = clampInt(y, 0, Math.max(0, screenH - height));
        }

        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        /*
         * 上着锁的话整层不收触摸：让手指直接落到下面的桌面 / 应用上（见 syncLockTouchable）。
         *
         * 预览同理、而且更必要：这一层此刻正压在设置页上面，吃了触摸就等于
         * 底下那几根滑条 / 列表划不动。预览是「只看不动」，拖动本来就该走设置里的滑条。
         */
        if (isLocked() || previewMode()) {
            flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                width, height, x, y, windowType(), flags,
                android.graphics.PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        /*
         * ALWAYS 而不是 SHORT_EDGES：SHORT_EDGES 只在「短边」允许延伸到挖孔区，
         * 横屏 / 某些 ROM 上会被判成不该延伸 —— 这一层要的就是能压到屏幕最顶上，
         * 含挖孔区在内。
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
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

    /*
     * 原来这里有个 openApp()：「点一下悬浮窗回到应用」。
     * 撤掉了 —— 这一层压在别的应用上面，点一下就把我们的应用拽到前台，
     * 既打断别人，也让「想拖一下小窗」变成不可能（手指一碰整屏就切走）。
     * 要回应用走通知栏 / 最近任务，不该让一层装饰性的歌词抢这个动作。
     */

    private static boolean tuningFlag(String key, boolean fallback) {
        java.util.Map<String, Float> tuning = WallpaperLyricsState.tuning();
        Float value = tuning == null ? null : tuning.get(key);
        return value == null ? fallback : value >= 0.5f;
    }

    /** 读一个 wp. 开头的数值开关，缺了就用 fallback。 */
    /**
     * 读一个 tuning 浮点值。
     *
     * 区间要**逐个 key 传** —— 早先这里写死 `clamp(value, 0.05f, 1f)`，
     * 于是自定义字号（10~32dp）被夹成 1dp，画出来只有一两个像素高；
     * 而背景不透明度想调到 0（完全透明）时又被顶回 0.05。
     * 这些 key 的量纲根本不一样，不能共用一个区间。
     */
    private static float tuningFloat(String key, float fallback, float min, float max) {
        java.util.Map<String, Float> tuning = WallpaperLyricsState.tuning();
        Float value = tuning == null ? null : tuning.get(key);
        if (value == null || !Float.isFinite(value)) return fallback;
        return clamp(value, min, max);
    }

    /** 小窗是否直接叠在安全区上面。 */
    private static boolean overSafeArea() {
        return tuningFlag(KEY_OVER_SAFE_AREA, false);
    }

    /** 设置页正开着：即使在 App 里也要挂出来给人看（见 KEY_PREVIEW）。 */
    private static boolean previewMode() {
        return tuningFlag(KEY_PREVIEW, false);
    }

    /**
     * 现在是不是竖屏。
     *
     * 用 `Configuration.orientation` 而不是量宽高：后者在分屏 / 折叠机上会把一个
     * 明明是竖着的应用窗口判成横屏，而这里要的只是「手机有没有被横过来」。
     */
    private boolean portrait() {
        return context.getResources().getConfiguration().orientation
                == Configuration.ORIENTATION_PORTRAIT;
    }

    /**
     * 是否「占满整条安全区」。
     *
     * 三个条件缺一不可：得先开着叠加安全区、得拨了这个开关、还得是竖屏。
     * 横屏下退回宽度滑条给的宽 —— 直接按「不占满」处理，用户转回来就又占满了，
     * 不需要额外记住任何状态。
     */
    private boolean fillSafeArea() {
        return overSafeArea() && tuningFlag(KEY_FILL_SAFE_AREA, false) && portrait();
    }

    /**
     * 叠加模式下窗口占屏幕宽度的比例（设置里那根「宽度」滑条）。0 = 没设，沿用拖出来的宽度。
     *
     * 50%~100% 才是有意义的范围：比一半还窄的话，一行歌词基本每句都要靠横向滚动才看得完。
     */
    private float widthRatio() {
        float value = tuningFloat(KEY_WIDTH, 0f, 0f, 1f);
        return value <= 0f ? 0f : clamp(value, 0.2f, 1f);
    }

    /**
     * 叠加模式下窗口该多宽。
     *
     * 占满时就是整条屏幕宽 —— 那时左右滑条没有意义，宽度滑条也让位。
     */
    private int overlayWidthPx(int screenW, float density, int fallbackWidth) {
        if (fillSafeArea()) return screenW;
        float ratio = widthRatio();
        if (ratio <= 0f) return fallbackWidth;
        return clampInt(Math.round(screenW * ratio),
                Math.round(MIN_WIDTH_DP * density), screenW);
    }

    /** 叠加模式下窗口的左边缘。占满时贴死 0。 */
    private int overlayLeftPx(int width, int screenW) {
        if (fillSafeArea()) return 0;
        return clampInt(Math.round((screenW - width) * offsetRatio()),
                0, Math.max(0, screenW - width));
    }

    /**
     * 让小窗立刻重画一帧。
     *
     * 自绘那套只在「还在播 / 动画没走完」时才排下一帧（省电），所以**暂停时**改了
     * 状态（比如从通知栏拖了进度条）不会自己重画 —— 得有人敲一下。
     */
    public void invalidateOverlay() {
        runOnUi(() -> {
            if (view != null && added) view.invalidate();
        });
    }

    /**
     * 设置里的「左右 / 宽度」改了之后立刻重新摆一次。
     *
     * 为什么必须显式调：tuning 表更新本身不会触发任何布局动作 —— 位置是在
     * `buildParams()` 里算的，而它只在挂窗口和转屏时走。少了这一下，
     * 滑条拖得再欢小窗也一动不动（正是「左右选项没用」）。
     */
    public void applyOverlayTuning() {
        runOnUi(() -> {
            if (view != null && added) view.invalidate();
            if (!overSafeArea() || params == null || !added) return;
            int screenW = context.getResources().getDisplayMetrics().widthPixels;
            int height = statusBarHeightPx();
            int width = overlayWidthPx(
                    screenW, context.getResources().getDisplayMetrics().density, params.width);
            int x = overlayLeftPx(width, screenW);
            if (x != params.x || width != params.width || height != params.height) {
                applyLayout(x, params.y, width, height);
            }
            nudgeIntoCutout();
            // 重摆之后再敲一次：避开区域那两根滑条改的是绘制，不重画就看不出挪了。
            if (view != null) view.invalidate();
        });
    }

    /**
     * 自定义模式的字号（像素）。0 = 没设 / 走动态。
     *
     * 动态字号是**跟着窗口高度算**的（拖大窗口字就跟着大），对多数人够用；
     * 但有人就是想要「字小一点、窗口还是那么大」，或者叠加模式下窗口只有状态栏
     * 那么高、算出来的字号小到看不清 —— 那种情况必须能自己指定。
     */
    private float customFontSizePx() {
        if (!tuningFlag(KEY_FONT_SIZE_MODE, false)) return 0f;
        float dp = tuningFloat(KEY_FONT_SIZE, 0f, 0f, 64f);
        return dp <= 0f
                ? 0f
                : dp * context.getResources().getDisplayMetrics().density;
    }

    /**
     * 状态栏（安全区）的高度。
     *
     * 不能靠网页那边的 `env(safe-area-inset-*)` —— 安卓上它只报挖孔、不报系统栏，
     * 无刘海机型一律返回 0。这里读系统自己的 `status_bar_height`。
     * 读到 0（极少数 ROM 不提供这个 dimen）时给一个能画下一行字的下限，
     * 否则窗口高度会变成 0、整层直接消失。
     */
    private int statusBarHeightPx() {
        int resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
        int value = resId > 0 ? context.getResources().getDimensionPixelSize(resId) : 0;
        int fallback = Math.round(MIN_SAFE_AREA_HEIGHT_DP
                * context.getResources().getDisplayMetrics().density);
        return Math.max(value, fallback);
    }

    /**
     * 把窗口**按实际量到的位置**再往上顶一次。
     *
     * `TYPE_APPLICATION_OVERLAY` 那层在不少 ROM 上会被系统夹到状态栏之下：
     * params.y 写 0，真画出来却掉在状态栏底边。写死一个负偏移在不同 ROM 上会过头
     * （另一批 ROM 本来就不夹，负 y 会把窗口上半截推出屏幕），所以这里反过来量：
     * 拿到窗口在屏幕上的真实顶边，差多少就补多少。
     */
    private void nudgeIntoCutout() {
        if (!overSafeArea() || view == null || params == null || !added) return;
        view.post(() -> {
            if (view == null || params == null) return;
            int[] location = new int[2];
            view.getLocationOnScreen(location);
            int delta = -location[1];
            if (delta != 0) {
                applyLayout(params.x, params.y + delta, params.width, params.height);
            }
        });
    }

    /**
     * 叠加模式下的左右位置（0~1）。
     *
     * 拖过就以拖出来的为准：设置里那根滑条只是给个初值，用户上手一拖就该听他的，
     * 否则每次巡检都用设置值把小窗拽回去，看起来就是「拖不动」。
     */
    private float offsetRatio() {
        float dragged = prefs.getFloat(KEY_DRAG_RATIO, Float.NaN);
        if (Float.isFinite(dragged)) return clamp01(dragged);
        return clamp01(rawTuningFloat(KEY_OFFSET_X, 0.5f));
    }

    /** 读一个 wp. 开头的原始数值（不夹到 0.05：左右位置需要允许取 0）。 */
    private static float rawTuningFloat(String key, float fallback) {
        java.util.Map<String, Float> tuning = WallpaperLyricsState.tuning();
        Float value = tuning == null ? null : tuning.get(key);
        if (value == null || !Float.isFinite(value)) return fallback;
        return value;
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
        /**
         * 长句缩字号的**下限**（原字号的比例）。
         *
         * 缩到 0.5 的老做法对长句等于把字压成一团，还不如让它横向滚 —— 所以缩到
         * 0.72 就收手，剩下的宽度交给滚动跟随。
         */
        private static final float MIN_TEXT_SHRINK = 0.72f;
        /**
         * 滚动的提前量：把正在唱的那个字顶到可视区宽度的这个比例处。
         *
         * 0.35 = 唱的位置大致停在靠前三分之一，右边留着一大截还没唱到的 ——
         * 既不会等到字撞边才动，也不会把后面整句都推出去。
         */
        private static final float SCROLL_LEAD = 0.35f;
        /** 每帧朝滚动目标靠近的比例：直接落位会是一跳，慢慢跟才像滚。 */
        private static final float SCROLL_EASE = 0.16f;

        /**
         * 当前横向滚动了多少像素（句子比可视区宽时才有值）。
         *
         * 存在这里而不是每帧重算：滚动要**平滑**，一帧跳到目标位置看着就是「猛地一拽」。
         */
        private float scrollOffsetPx = 0f;

        /**
         * 「避开区域」在视图坐标里的左右边界。只有「占满安全区」开着才有值。
         *
         * 每帧在 `onDraw` 开头算一次存这里，而不是每行重算：两根滑条一帧内不会变，
         * 而 `drawRow` 一帧要跑两趟（焦点行 + 第二行），另外存成字段才能在
         * `dodgeAvoidZone` 里直接读，不用一路往下传。
         */
        private boolean avoidActive = false;
        private float avoidLeftPx = 0f;
        private float avoidRightPx = 0f;

        private int lastIndex = -1;
        private long transitionStartMs = 0L;
        private long appearStartMs = 0L;
        private int primaryColor = 0xFFFFFFFF;
        private int secondaryColor = 0xB3FFFFFF;
        private int accentColor = 0xFF7C5CFF;
        private int baseColor = 0xFF09090B;
        private long paletteStamp = -1L;
        /**
         * AI 主题里被标了色的那些词（主题的 `wordColors`）。
         *
         * 从叠层那一份主题 JSON 里解析出来（见 WallpaperThemePalette.readThemeJson），
         * 缓存住 —— 那是几百上千字符的 JSON，逐帧解析不划算。
         */
        private FloatingWordColors.Rule[] wordRules = FloatingWordColors.EMPTY;
        /** 解析 wordRules 时用的那份 JSON，用来判断主题换没换。 */
        private String wordThemeJson = null;
        // 下面三个是「当前这一行的片段表」的小缓存：换行的 420ms 里同一行会被画几十帧，
        // 每帧都重新匹配一遍纯属浪费（一次匹配要扫几条短语 × 几十个词）。
        private WallpaperLyricsState.TimedLine cachedSegmentLine = null;
        private FloatingWordColors.Rule[] cachedSegmentRules = null;
        private FloatingWordColors.Segment[] cachedSegments = null;

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
            syncWordRules();
        }

        /**
         * 主题换过就重解析一次 `wordColors`。
         *
         * 不能只挂在 `paletteStamp` 上：换主题走的是 `setAppearance` 那条路，
         * 它不动 stamp（stamp 只在换歌时变）—— 只认 stamp 的话「暂停时换个 AI 主题」
         * 小窗这边就永远看不到新配色。所以每帧自己比一次 JSON 串：
         * SharedPreferences 读出来的是同一份缓存对象，绝大多数帧只是比个引用。
         */
        private void syncWordRules() {
            String themeJson = WallpaperThemePalette.readThemeJson(context);
            if (themeJson == null ? wordThemeJson == null : themeJson.equals(wordThemeJson)) {
                return;
            }
            wordThemeJson = themeJson;
            wordRules = FloatingWordColors.parse(themeJson);
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
            } else {
                syncWordRules();
            }

            long now = android.os.SystemClock.elapsedRealtime();
            float appear = clamp01((now - appearStartMs) / (float) APPEAR_MS);
            appear = easeOutCubic(appear);

            drawBackground(canvas, width, height, appear);

            /*
             * 叠加模式下不画那两颗控件。
             *
             * 窗口只有状态栏那么高，锁那一颗（圆心 13dp、半径 9dp）会占掉整条的一大半
             * 并压在歌词上。而这个模式本来也不需要拖 / 改大小 / 上锁 ——
             * 左右位置和宽度都在设置里调，手势在这里反而是负担。
             */
            boolean showControls = !overSafeArea();

            // 避开区域每帧算一次（两根滑条一帧内不会变，而 drawRow 一帧要跑两趟）。
            updateAvoidZone(width);

            long position = snapshot.positionMs();
            int index = (snapshot.lines == null || snapshot.lines.length == 0)
                    ? -1 : snapshot.indexAt(position);

            /*
             * 下面这一串布局提前算：预览时可能一句歌词都没有，
             * 那行占位也得按同一套位置 / 字号画，不然预览跟真身对不上。
             */
            /*
             * 叠加模式下只有**一行**：窗口高度就是状态栏那一条（二十几到四十 dp），
             * 硬塞两行的话每行只剩几个 dp，字根本画不出来。
             */
            boolean singleRow = overSafeArea();
            float padY = singleRow ? Math.min(dp(6), height * 0.1f) : dp(10);
            float rowHeight = singleRow ? (height - padY * 2f) : (height - padY * 2f) / 2f;
            float focusY = singleRow ? height * 0.5f : padY + rowHeight * 0.5f;
            float secondY = padY + rowHeight * 1.5f;
            float focusSize = singleRow ? rowHeight * 0.82f : rowHeight * 0.62f;
            /*
             * 自定义字号覆盖上面那个「按窗口高度算」的动态值。
             *
             * 仍然夹一行高之内：给个 40dp 而窗口只有 20dp 的话，字会上下被裁掉，
             * 看着像坏了 —— 这时候应该去把窗口拖大，而不是让字溢出。
             */
            float customSize = customFontSizePx();
            if (customSize > 0f) {
                focusSize = Math.min(customSize, singleRow ? rowHeight : rowHeight * 0.95f);
            }

            if (index < 0) {
                if (showControls) {
                    drawControls(canvas, width, height, appear);
                }
                /*
                 * 预览且一句歌词都没有（没放歌 / 纯音乐 / 还没解析出来）：
                 * 画一行占位。这时候什么都不画的话，用户面对一片空白只会以为开关坏了 ——
                 * 他要调的本来就是位置、大小、避开区域，这些靠占位一样看得出来。
                 */
                if (previewMode()) {
                    drawRow(canvas, PREVIEW_SAMPLE_TEXT, width, focusY, focusSize,
                            primaryColor, appear * 0.85f, -1f, null, 0L, false);
                }
                return;
            }
            int previous = lastIndex;
            if (index != lastIndex) {
                lastIndex = index;
                transitionStartMs = now;
            }

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
                        secondY + outShift, focusSize, outAlpha, -1f, 1f, 0L, singleRow);
            }
            float inAlpha = rolled ? enter : 1f;
            float inShift = rolled ? rise * (1f - enter) : 0f;
            drawBlock(canvas, snapshot, index, width, focusY + inShift,
                    secondY + inShift, focusSize, appear * inAlpha, progress,
                    breath, position, singleRow);

            if (showControls) {
                drawControls(canvas, width, height, appear);
            }

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
                               float alpha, float progress, float breath, long position,
                               boolean singleRow) {
            if (index < 0 || index >= snapshot.lines.length || alpha <= 0.004f) return;

            // 焦点行：逐字（逐词）扫光 + 呼吸。
            // 只有焦点行推进滚动状态：退场那格（progress < 0）跟着动的话，
            // 两格会各自去更新同一个 scrollOffsetPx，滚出来就是互相打架。
            drawRow(canvas, snapshot.lines[index].text, width, focusY, focusSize,
                    primaryColor, alpha * breath,
                    progress, snapshot.lines[index], position, progress >= 0f);

            // 叠加模式下没有第二格：那一条只有状态栏那么高，见 onDraw 里的说明。
            if (singleRow) return;

            // 第二行：有翻译且开了就显示翻译，否则显示下一句。
            String translation = snapshot.showTranslation ? snapshot.lines[index].translation : null;
            if (translation != null && !translation.trim().isEmpty()) {
                drawRow(canvas, translation, width, secondY,
                        focusSize * TRANSLATION_FONT_RATIO, secondaryColor,
                        alpha * 0.86f, -1f, null, 0L, false);
            } else if (index + 1 < snapshot.lines.length) {
                drawRow(canvas, snapshot.lines[index + 1].text, width, secondY,
                        focusSize * NEXT_FONT_RATIO, secondaryColor,
                        alpha * 0.62f, -1f, null, 0L, false);
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
            float opacity = tuningFloat("wp.floatingBackgroundOpacity", DEFAULT_BACKGROUND_OPACITY, 0f, 1f);

            /*
             * 叠在安全区上时不画描边。
             *
             * 那条边的本意是「底色调淡之后还能看见窗口在哪」，但贴到状态栏那一条上时
             * 它变成了一根横贯屏幕的细线，跟系统状态栏本身抢视觉 —— 用户要的就是
             * **只有字浮在那儿**。非安全区模式下照旧画（那里还要靠它兜住窗口轮廓）。
             */
            boolean overSafeArea = overSafeArea();

            if (opacity > 0f) {
                backgroundPaint.setStyle(Paint.Style.FILL);
                backgroundPaint.setColor(withAlpha(baseColor, opacity * appear));
                canvas.drawRoundRect(frame, radius, radius, backgroundPaint);
            }

            if (!overSafeArea) {
                // 描边**不跟着一起淡到底**：底色调到很淡时，没有这条边小窗就彻底找不着了。
                borderPaint.setStyle(Paint.Style.STROKE);
                borderPaint.setStrokeWidth(Math.max(1f, dp(1)));
                borderPaint.setColor(withAlpha(accentColor, (0.14f + 0.22f * opacity) * appear));
                canvas.drawRoundRect(frame, radius, radius, borderPaint);
            }
        }

        /**
         * 按当前 tuning 重算避开区域。
         *
         * 宽度是**整条宽的比例**、位置是「区域在剩下空间里的左右比例」——
         * 位置乘的是 `width - zoneW` 而不是 `width`，这样拖到最右时区域右边缘正好贴边，
         * 不会有一半被推出屏幕外。
         */
        private void updateAvoidZone(int width) {
            if (!fillSafeArea()) {
                avoidActive = false;
                return;
            }
            float ratio = tuningFloat(KEY_AVOID_WIDTH, 0f, 0f, 1f);
            if (ratio <= 0f) {
                avoidActive = false;
                return;
            }
            // 留一成：整个屏宽都划成避开区的话就一行字都画不出来了。
            float zoneW = Math.min(ratio * width, width * 0.9f);
            float pos = tuningFloat(KEY_AVOID_OFFSET_X, 0.5f, 0f, 1f);
            avoidLeftPx = clamp(pos * (width - zoneW), 0f, Math.max(0f, width - zoneW));
            avoidRightPx = avoidLeftPx + zoneW;
            avoidActive = zoneW > 0f;
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
                             WallpaperLyricsState.TimedLine line, long positionMs,
                             boolean allowScroll) {
            if (text == null || text.isEmpty() || alpha <= 0.004f) return;

            textPaint.setColor(color);
            textPaint.setTextSize(fontSize);
            textPaint.setTextAlign(Paint.Align.LEFT);

            float padX = dp(14);
            /*
             * 避开区域那一段是**从布局里抽掉**的（字绕过去，不是被裁掉），
             * 所以它占的宽度要从可用宽度里减掉 —— 不然「能不能装下 / 要不要滚」
             * 都是按没洞的宽度算的，右半截会推出屏幕外。
             */
            float holeW = avoidActive ? (avoidRightPx - avoidLeftPx) : 0f;
            float maxWidth = width - padX * 2f - holeW;
            float measured = textPaint.measureText(text);
            if (measured > maxWidth && measured > 0f) {
                /*
                 * 太长的句子先缩字号，但**不缩到看不清**（下限 MIN_TEXT_SHRINK）。
                 * 一直缩到能塞下为止的话，长句会被压成一团蚂蚁，远不如让它横向滚。
                 * 缩到底还是超出，就交给下面的滚动跟随。
                 */
                fontSize = Math.max(fontSize * MIN_TEXT_SHRINK, fontSize * (maxWidth / measured));
                textPaint.setTextSize(fontSize);
                measured = textPaint.measureText(text);
            }

            WallpaperLyricsState.TimedWord[] words = line == null ? null : line.words;
            FloatingWordColors.Segment[] segments =
                    (words != null && words.length > 0) ? segmentsFor(line) : null;

            /*
             * 横向滚动跟随：句子比可视区宽时，跟着唱到的位置往左推。
             *
             * 「提前一点」是关键（SCROLL_LEAD）：目标是把**正在唱的那个字**顶到可视区
             * 靠前 35% 的位置，而不是等它撞到右边界才动 —— 后者看起来就是字先跑出去
             * 半截、然后整行猛地一跳。
             */
            float scroll = scrollOffsetPx;
            if (measured > maxWidth && segments != null && allowScroll) {
                float sungX = measured;
                for (int i = 0; i < words.length; i += 1) {
                    WallpaperLyricsState.TimedWord word = words[i];
                    if (word == null) continue;
                    FloatingWordColors.Segment segment = segments[i];
                    if (segment == null || segment.endOffset <= segment.startOffset) continue;
                    float ratio = sungRatio(word, positionMs);
                    if (ratio >= 1f) continue;
                    float head = textPaint.measureText(text, 0, segment.startOffset);
                    float span = textPaint.measureText(text, segment.startOffset, segment.endOffset);
                    sungX = head + span * ratio;
                    break;
                }
                float target = clamp(sungX - maxWidth * SCROLL_LEAD, 0f, measured - maxWidth);
                // 每帧朝目标靠近一点，别瞬移；差得太远（换句 / 拖进度跳走）就直接落位。
                scroll = Math.abs(target - scrollOffsetPx) > maxWidth
                        ? target
                        : scrollOffsetPx + (target - scrollOffsetPx) * SCROLL_EASE;
                scrollOffsetPx = scroll;
            } else if (measured <= maxWidth) {
                scrollOffsetPx = 0f;
                scroll = 0f;
            }

            /*
             * 居中要按**看得见的那一整段**算：洞只是把布局撑宽了 holeW，
             * 屏上占的地方是 measured + holeW。
             */
            float visible = measured + holeW;
            float x = measured <= maxWidth
                    ? Math.max(padX, (width - visible) / 2f)
                    : padX - scroll;
            /*
             * 洞的左边缘要落在**字符边界**上。
             *
             * 不挪的话跨在边界上的那个字会被劈成两半（左半在洞左边、右半在洞右边）。
             * 要的是「洞夹在字与字之间」，不是一个字被切开。
             * 挪的是整行、最多半个字宽，洞本身的宽度一点不变（右段照旧整体右移 holeW）。
             */
            if (avoidActive) {
                x = snapToCharBoundary(text, x, measured);
            }
            Paint.FontMetrics metrics = textPaint.getFontMetrics();
            float baseline = centerY - (metrics.ascent + metrics.descent) / 2f;

            int textAlpha = Math.round(clamp01(alpha) * 255f);
            float clipTop = centerY - fontSize * 1.2f;
            float clipBottom = centerY + fontSize * 1.2f;

            if (!avoidActive) {
                paintRow(canvas, text, x, baseline, fontSize, color, alpha, progress, line,
                        positionMs, measured, textAlpha, words, segments, clipTop, clipBottom);
                return;
            }

            /*
             * 有避开区域：**同一行画两遍，各自裁一半**。
             *
             * 左段原地；右段整体右移一个区域宽（x + holeW），于是「本来该落进洞里的那些字」
             * 正好从洞的右边缘接着出现 —— 接缝处那一个字左半在洞左边、右半在洞右边，
             * 看着就是字从洞两边绕过去（歌词…歌词 ▌洞▌ 歌词…歌词），一个字都没少。
             *
             * 直接在洞的位置挖一刀不画是错的：那样跨在边界上的字会被削掉半边，
             * 而且每边各削一个，比洞本身还宽。
             */
            canvas.save();
            canvas.clipRect(0f, clipTop, avoidLeftPx, clipBottom);
            paintRow(canvas, text, x, baseline, fontSize, color, alpha, progress, line,
                    positionMs, measured, textAlpha, words, segments, clipTop, clipBottom);
            canvas.restore();

            canvas.save();
            canvas.clipRect(avoidRightPx, clipTop, width, clipBottom);
            paintRow(canvas, text, x + holeW, baseline, fontSize, color, alpha, progress, line,
                    positionMs, measured, textAlpha, words, segments, clipTop, clipBottom);
            canvas.restore();
        }

        /**
         * 把整行的起点挪一挪，让避开区域的左边缘正好压在某个字符的边界上。
         *
         * 挨个试每个字符边界、挑离当前位置最近的那个：位移因此最多半个字宽，
         * 看不出来是「挪过」，但字绝不会被切开。
         *
         * 洞没压在这行字上（在字的左边或右边）时不用挪 —— 那本来就没有字会被切。
         */
        private float snapToCharBoundary(String text, float x, float measured) {
            if (avoidLeftPx <= x || avoidLeftPx >= x + measured) return x;
            float best = x;
            float bestDelta = Float.MAX_VALUE;
            for (int i = 0; i <= text.length(); i += 1) {
                float candidate = avoidLeftPx - textPaint.measureText(text, 0, i);
                float delta = Math.abs(candidate - x);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = candidate;
                }
            }
            return best;
        }

        /**
         * 把一行真正画上去（主色一遍 + 唱过的那一段再来一遍）。
         *
         * 抽成一个方法是因为有避开区域时要**画两遍**（见调用处），
         * 两遍之间只差起点 x。
         */
        private void paintRow(Canvas canvas, String text, float x, float baseline, float fontSize,
                              int color, float alpha, float progress,
                              WallpaperLyricsState.TimedLine line, long positionMs,
                              float measured, int textAlpha,
                              WallpaperLyricsState.TimedWord[] words,
                              FloatingWordColors.Segment[] segments,
                              float clipTop, float clipBottom) {
            textPaint.setColor(color);
            textPaint.setAlpha(textAlpha);
            // 第一遍：整行的主色（还没唱到的那部分）。
            canvas.drawText(text, x, baseline, textPaint);

            if (progress < 0f || line == null) return;

            if (segments == null) {
                // 没有逐词轴：整行按进度线性推进（老做法）。
                float swept = measured * clamp01(progress);
                if (swept <= 0.5f) return;
                canvas.save();
                canvas.clipRect(x - dp(2), clipTop, x + swept + dp(2), clipBottom);
                textPaint.setColor(accentColor);
                textPaint.setAlpha(textAlpha);
                canvas.drawText(text, x, baseline, textPaint);
                canvas.restore();
                return;
            }

            /*
             * 第二遍：**逐词**重画唱过的那一段。
             *
             * 为什么要一个词一个词画而不是整行裁一刀：AI 主题给某些词单独标了颜色，
             * 那些词唱过去时要用它自己的颜色（播放页也是这么做的），
             * 一整行只能有一个颜色，做不到。
             *
             * 每个词画的都是**整行**再裁到它在整行里的那一小段 —— 两者必须对齐到同一个
             * 坐标系（起点都是 x）。写成 drawText(text, wordX, …) 的话整行被整体平移了，
             * 裁出来的就永远是「整行的开头」，也就是第一个字 —— 表现是每个词都把第一个
             * 字重画一遍、往后推。
             */
            for (int i = 0; i < words.length; i += 1) {
                WallpaperLyricsState.TimedWord word = words[i];
                if (word == null || word.text == null || word.text.isEmpty()) continue;
                float ratio = sungRatio(word, positionMs);
                if (ratio <= 0f) continue;
                FloatingWordColors.Segment segment = segments[i];
                if (segment == null || segment.endOffset <= segment.startOffset) continue;
                int start = Math.min(segment.startOffset, text.length());
                int end = Math.min(segment.endOffset, text.length());
                if (end <= start) continue;
                float wordX = x + textPaint.measureText(text, 0, start);
                float wordWidth = textPaint.measureText(text, start, end);
                if (wordWidth <= 0f) continue;
                float swept = ratio >= 1f ? wordWidth : wordWidth * ratio;
                canvas.save();
                canvas.clipRect(wordX, clipTop, wordX + swept, clipBottom);
                textPaint.setColor(segment.color == FloatingWordColors.NO_COLOR
                        ? accentColor
                        : segment.color);
                textPaint.setAlpha(textAlpha);
                canvas.drawText(text, x, baseline, textPaint);
                canvas.restore();
            }
        }

        /**
         * 这一行的片段表（每个词落在整行哪儿、被标了什么颜色）。
         *
         * 只认「同一行 + 同一套规则」：两者都是引用比较，`TimedLine` 没有重写 equals，
         * 而 `wordRules` 只在换主题时才换对象 —— 于是换行的 420ms 里几十帧只算一次。
         */
        private FloatingWordColors.Segment[] segmentsFor(WallpaperLyricsState.TimedLine line) {
            if (cachedSegmentLine == line && cachedSegmentRules == wordRules
                    && cachedSegments != null) {
                return cachedSegments;
            }
            cachedSegmentLine = line;
            cachedSegmentRules = wordRules;
            cachedSegments = FloatingWordColors.segments(line.text, line.words, wordRules);
            return cachedSegments;
        }

        /** 一个词唱过了多少（0..1）。整行没有逐词轴时不走这里。 */
        private float sungRatio(WallpaperLyricsState.TimedWord word, long positionMs) {
            if (positionMs >= word.endMs) return 1f;
            if (positionMs <= word.startMs) return 0f;
            long span = word.endMs - word.startMs;
            if (span <= 0L) return 1f;
            return clamp01((positionMs - word.startMs) / (float) span);
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
                    if (isUp && !moved && touchMode == MODE_LOCK) {
                        setLocked(!isLocked());
                    } else if (moved && (touchMode == MODE_MOVE || touchMode == MODE_RESIZE)) {
                        persistLayout();
                    }
                    /*
                     * 点一下**不再跳回主页面**。
                     *
                     * 原来这里有个 openApp()：这一层是叠在所有窗口之上的「桌面歌词」，
                     * 点它一下就把应用拽到前台，等于每次想拖它、想调它，手指一碰就整屏切走 ——
                     * 尤其叠加在安全区上时，那一条就压在别的应用顶上，误触更是直接打断人家。
                     * 现在单击什么都不做：要动它靠拖（MODE_MOVE），要上锁点右上角那颗锁。
                     */
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
            if (overSafeArea()) {
                // 贴着安全区这个模式只给左右：上下没有意义，y 恒为 0（拖也拖不动）。
                int x = clampInt((int) (startWinX + dx), 0, Math.max(0, screenW - params.width));
                applyLayout(x, 0, params.width, params.height);
                persistOffsetRatio(x, screenW);
                return;
            }
            int x = clampInt((int) (startWinX + dx), 0, Math.max(0, screenW - params.width));
            int y = clampInt((int) (startWinY + dy), 0, Math.max(0, screenH - params.height));
            applyLayout(x, y, params.width, params.height);
        }

        /** 叠加模式下拖出来的左右位置要自己记住：不然下一次巡检又按设置值把它拽回去。 */
        private void persistOffsetRatio(int x, int screenW) {
            int span = Math.max(0, screenW - (params == null ? 0 : params.width));
            float ratio = span <= 0 ? 0f : x / (float) span;
            prefs.edit().putFloat(KEY_DRAG_RATIO, clamp01(ratio)).apply();
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
