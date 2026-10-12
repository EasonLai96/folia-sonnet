package top.izuna.foliamajor;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.graphics.Color;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// Capacitor 官方插件。
//
// 这三个都是 Gradle 里已经带进来的模块（见 app/capacitor.build.gradle），但**不会自动注册**：
// 自动注册靠 assets/capacitor.plugins.json，而这个仓库里没有那份文件（capacitor sync
// 才会生成，我们只跑 gradle）。不注册的结果就是 JS 侧一调用就抛
// `"StatusBar" plugin is not implemented on android` —— 那条未处理的 Promise 拒绝就是这么来的，
// 状态栏图标的明暗也跟着一直是默认的。
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.capacitorjs.plugins.splashscreen.SplashScreenPlugin;
import com.capacitorjs.plugins.statusbar.StatusBarPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Folia 的主 Activity。
 *
 * 在 Capacitor 默认实现之上补了一件 Web 层做不到的事：真正隐藏系统栏。
 *
 * 之前只在 web 层调 StatusBar.setOverlaysWebView(true)，那只是让内容延伸到状态栏下方，
 * 状态栏与底部导航栏的图标仍然可见，而且导航栏那块区域留着一块与播放器背景不一致的空白。
 * 这里用 WindowInsetsControllerCompat 把两个栏都隐藏，WebView 铺满整屏；
 * 用户从边缘下滑可临时唤出（BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE），随后自动隐藏。
 */
public class MainActivity extends BridgeActivity {

    /**
     * 播放控制意图由清单注册的 FoliaCommandReceiver 统一接收，不再挂在 Activity 上。
     *
     * 原来的动态接收器只在 Activity 存活时有效，而用户点通知栏时应用通常在后台，
     * 指令全部丢失；且它与新接收器同时匹配 ACTION_WEB_COMMAND，会一次指令派发两遍。
     */

    /**
     * 「从别的应用打开 / 分享过来的音频」认哪些后缀：与 LocalAudioServer.isAudioFileName
     * 同源，外加 App 也能播的那几个无损格式。清单里的 intent-filter 按同一份列表注册。
     */
    private static final String[] SUPPORTED_AUDIO_EXTENSIONS = {
        ".mp3", ".flac", ".m4a", ".aac", ".alac", ".wav", ".ogg", ".opus",
        ".ape", ".wv", ".tta", ".wma", ".aif", ".aiff", ".caf",
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 第一行就装上：崩溃可能就发生在下面 super.onCreate() 的 Bridge 创建过程中。
        FoliaCrashHandler.install(this);

        // 必须在 super.onCreate() **之前**注册。
        //
        // registerPlugin 只是往 bridgeBuilder 里登记类，而真正创建 Bridge
        // （bridgeBuilder.create()）是在 BridgeActivity.onCreate() 内部完成的。
        // 放在 super 之后就太晚了：Bridge 已经建好，这个插件永远不会被实例化，
        // JS 侧调用会静默失败 —— 播放通知因此完全不出现。
        registerPlugin(FoliaPlaybackPlugin.class);
        registerPlugin(FoliaWallpaperPlugin.class);
        registerPlugin(top.izuna.foliamajor.lyricon.FoliaLyriconPlugin.class);
        // 本地登录（内置接口代码 + Cookie/OkHttp）与返回键都在这个插件上。
        registerPlugin(FoliaNativePlugin.class);
        registerPlugin(StatusBarPlugin.class);
        registerPlugin(SplashScreenPlugin.class);
        registerPlugin(BrowserPlugin.class);

        super.onCreate(savedInstanceState);

        checkWebViewSupport();
        applyImmersiveMode();
        applyWebViewPlaybackSettings();
        installBackPressedHandler();
        PhoneLayoutOrientation.apply(this);
        // 挖孔/刘海：沉浸式只管系统栏，屏幕顶部那一条黑边是系统把 cutout inset
        // 垫成了 decor 的 padding，得由 PhoneFitCutout 清掉。
        PhoneFitCutout.apply(this);
        /*
         * 这里**不再**无条件常亮。
         *
         * 常亮是「播放时不要熄屏」这件事的实现，但它有个副作用：应用在前台时屏幕
         * 永远不灭。用户在播放页看歌词是想要的，可在设置里翻两页也想让它亮着就烦人了。
         * 所以改成开关控制、且只在真的在播放时才打开（见 FoliaNativePlugin.setScreenAwake）。
         */
        requestNotificationPermissionIfNeeded();
        // StatusBar 插件是在 Bridge 创建时（super 里）加载并应用配置的，
        // 可能在我们之后才动到 systemUiVisibility；多压几次确保沉浸态最终生效。
        scheduleImmersiveReapply();
        // 这次启动是不是被「用 Folia 打开这个音频」叫起来的：是就把文件交给插件去拷，
        // Web 层起来后取走再问用户要不要导入（ExternalAudioImportHost）。
        handleIncomingAudioIntent(getIntent());
    }

    /**
     * 系统 WebView 版本体检。
     *
     * 为什么放在这里：WebView 太旧时报错发生在 WebView 内部（SyntaxError / 缺 API），
     * 原生侧收不到任何异常，崩溃处理器也抓不到，用户看到的就只是「开屏后一直白屏」。
     * 只有原生能在页面加载之后读到引擎版本，也只有原生对话框能在页面已经废掉时弹出来。
     *
     * 用 decorView.post 而不是直接调：onCreate 阶段窗口还没真正挂上，这时 show 对话框
     * 有概率撞 BadTokenException，拖到第一帧之后就稳了。
     */
    private void checkWebViewSupport() {
        getWindow().getDecorView().post(() -> WebViewUpgrade.check(this,
                getBridge() == null ? null : getBridge().getWebView()));
    }

    /**
     * 两件 WebView 默认不干、而播放器必须要的事。
     *
     * `setMediaPlaybackRequiresUserGesture(false)`：默认要用户先点过屏幕才允许播放音频，
     * 于是「点通知栏的播放」或恢复播放时经常静默失败。
     * `MIXED_CONTENT_ALWAYS_ALLOW`：页面本身是 https://localhost，封面与部分音频地址还是
     * http，默认会被拦成混合内容（报错毫无特征：`TypeError: Failed to fetch`）。
     */
    private void applyWebViewPlaybackSettings() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }

    /**
     * 返回键先交给网页：设置面板、弹层之类的层级会自己关掉自己（复用 Escape 的处理），
     * 没人接管才真的退出 —— 否则在设置里按返回会直接把整个 App 关掉。
     */
    private void installBackPressedHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (FoliaNativePlugin.emitBackPressed()) return;
                finish();
            }
        });
    }

    /**
     * 延后重复压几次沉浸态。
     *
     * StatusBar 插件的 setOverlaysWebView 走废弃的 setSystemUiVisibility，
     * 会覆盖 WindowInsetsControllerCompat 的 hide 结果；它在 Bridge 创建时执行，
     * 与我们这里的调用存在竞态。几拍之后内容也加载完了，压最后一次即可收口。
     */
    private void scheduleImmersiveReapply() {
        View decorView = getWindow().getDecorView();
        for (long delay : new long[] { 150L, 500L, 1200L }) {
            decorView.postDelayed(this::applyImmersiveMode, delay);
            // 系统会周期性把 cutout/状态栏的 inset 重新写回 padding，压完沉浸态再压一次挖孔。
            decorView.postDelayed(() -> PhoneFitCutout.apply(this), delay);
        }
    }

    /**
     * Android 13+ 的通知权限必须运行时申请，只在 manifest 里声明是不够的。
     *
     * 没有它，startForeground 照常生效（进程仍能拿到前台优先级），
     * 但通知对用户不可见 —— 用户要的「音乐播放通知」就看不到了。
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 0x1F02);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 系统会在下拉通知栏、权限弹窗、旋转等时机重置沉浸态，回前台时要重新压一次。
        if (hasFocus) {
            applyImmersiveMode();
            PhoneFitCutout.apply(this);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 壁纸叠层要知道「用户现在是在用 App 还是在桌面上」：系统壁纸不是我们的时候，
        // 它没有别的信号可用（壁纸服务压根不会被创建）。见 WallpaperOverlay.setAppForeground。
        top.izuna.foliamajor.wallpaper.WallpaperOverlay.shared(this).setAppForeground(true);
        // 从后台回前台时系统会重新布局，直接 apply 有时会被随后的布局覆盖，
        // 延后一拍再压一次，避免出现一瞬间的状态栏/导航栏残留。
        getWindow().getDecorView().postDelayed(this::applyImmersiveMode, 120);
        getWindow().getDecorView().postDelayed(() -> PhoneFitCutout.apply(this), 120);
    }

    // 必须是 public：BridgeActivity 里的这两个回调是 public，降成 protected 属于收窄
    // 访问权限，javac 直接报「正在尝试分配更低的访问权限」。
    @Override
    public void onStart() {
        super.onStart();
        // 回前台：把渲染放回来。
        FoliaNativePlugin.emitAppBackground(false);
    }

    @Override
    public void onStop() {
        super.onStop();
        // 真的看不见了：让网页停掉整套渲染，把 CPU 让给音频解码。
        //
        // 放在 onStop 而不是 onPause —— 下拉通知栏、切多任务只到 onPause，那时画面还
        // 露着一半，停了会看到动画僵在半途。
        FoliaNativePlugin.emitAppBackground(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // 应用已经在前台（singleTask）时又选中了一个音频文件：只会走 onNewIntent，
        // 不接的话第二次分享进来什么都不会发生。
        setIntent(intent);
        handleIncomingAudioIntent(intent);
    }

    /**
     * 外部送进来的音频（文件管理器「用 Folia 打开」、其它 App 分享）。
     *
     * 只负责把 uri 认出来交给插件，不在这里拷文件、也不在这里决定要不要入库：
     * content:// 的读授权跟着 intent 的生命周期走，拖到用户看完「是否导入」再去读很可能已经
     * 过期；而「要不要真的放进曲库」是 Web 层弹窗那一步的事。
     *
     * 重复的 uri（ClipData 里一份、getData() 里又一份；部分 provider 同时给两种形态）
     * 由插件侧去重。
     */
    private void handleIncomingAudioIntent(Intent intent) {
        List<Uri> uris = collectAudioUris(intent);
        if (uris.isEmpty()) return;
        FoliaNativePlugin.noteExternalAudioUris(uris);
    }

    private static boolean isSupportedAudioName(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        int dot = lower.lastIndexOf('.');
        String extension = dot < 0 ? "" : lower.substring(dot);
        for (String candidate : SUPPORTED_AUDIO_EXTENSIONS) {
            if (candidate.equals(extension)) return true;
        }
        return false;
    }

    /**
     * 认 uris：data、ClipData、ACTION_SEND(_MULTIPLE) 的 EXTRA_STREAM 三种形态都可能出现。
     *
     * mime 是 application/* 一类的值时，用文件名后缀兜底再认一次；后缀也不认识
     * （比如用户分享了一个 pdf）就直接丢掉 —— 否则 App 会出现在各类文件的分享列表里，
     * 然后把每一个 pdf 都「导」进本地音乐。
     */
    private List<Uri> collectAudioUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        boolean isSend = Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);

        Uri data = intent.getData();
        if (!isSend && data != null) addCandidateUri(uris, data, intent);

        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                addCandidateUri(uris, clipData.getItemAt(index).getUri(), intent);
            }
        }

        if (isSend) {
            List<Uri> streams = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri stream = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) streams.add(stream);
            } else if (intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM) != null) {
                for (android.os.Parcelable parcelable : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) {
                    if (parcelable instanceof Uri) streams.add((Uri) parcelable);
                }
            }
            for (Uri stream : streams) addCandidateUri(uris, stream, intent);
        }
        // 视图意图也可能只有 data（没有 ClipData）：上面第一段已经收过了，这里不再重复。
        return uris;
    }

    /** 单个候选：拿到读授权并按后缀 / mime 判定它是不是我们要的音频。 */
    private void addCandidateUri(List<Uri> uris, Uri uri, Intent intent) {
        if (uri == null) return;
        try {
            int grantFlags = intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (grantFlags != 0) {
                getContentResolver().takePersistableUriPermission(uri, grantFlags);
            }
        } catch (Exception ignored) {
            // 大多数 provider 不给可持久化授权；intent 自带的这一次读授权通常仍够用。
        }
        String mime = getContentResolver().getType(uri);
        if (mime != null && mime.startsWith("audio/")) {
            uris.add(uri);
            return;
        }
        // mime 不认识或 provider 给的是通用值时，按文件名后缀再认一次。
        if (isSupportedAudioName(queryExternalDisplayName(uri))) uris.add(uri);
    }

    private String queryExternalDisplayName(Uri uri) {
        if (uri == null) return null;
        try (android.database.Cursor cursor = getContentResolver()
                .query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
            // 读不到列名的 provider 就退回 path。
        }
        return uri.getLastPathSegment();
    }

    @Override
    public void onPause() {
        super.onPause();
        top.izuna.foliamajor.wallpaper.WallpaperOverlay.shared(this).setAppForeground(false);
    }

    /**
     * 全沉浸：隐藏系统栏，并让 WebView 真正铺满整屏。
     *
     * 两件事必须一起做，只做一半就会出现「栏被隐藏了但那一块是空白」：
     *
     * 1. `setDecorFitsSystemWindows(false)`：让内容绘制到系统栏区域**之下**。
     *    这是关键的一步。缺了它，栏虽然被 hide 掉，但窗口仍按「内容避开系统栏」来布局，
     *    顶部/底部就留下一块背景色的空白带 —— 正是用户看到的「那一栏还是空白的」。
     * 2. `controller.hide(systemBars())`：把状态栏与导航栏都隐藏。
     *
     * 另外要把两个栏的背景色设为透明：有些 ROM 即使隐藏了也会留下底色残留。
     *
     * 不能依赖 web 层的 StatusBar.setOverlaysWebView —— 它走的是已废弃的
     * setSystemUiVisibility(SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)，
     * 只覆盖状态栏、不覆盖导航栏，而且它在 JS 加载后才执行，会把这里的 hide 结果冲掉。
     */
    private void applyImmersiveMode() {
        View decorView = getWindow().getDecorView();

        // 内容绘制到系统栏之下（含刘海/挖孔区域）。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 两个栏都设为透明，避免隐藏后残留底色。
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        // 手势导航条也透明，否则底部会留一条白/黑的细线。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), decorView);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());

        // 栏位变了之后 WebView 常常还按上一次的尺寸画着，顶部就留一条与内容无关的黑带。
        // 这一步必须跟着 setDecorFitsSystemWindows 一起做（照 folia-android 的 AdaptiveLayout）。
        requestWebViewRelayout();
    }

    /** 让 WebView 重新量一次：栏位 / 尺寸变化后它不会自己跟着变。 */
    private void requestWebViewRelayout() {
        try {
            getWindow().getDecorView().post(() -> {
                try {
                    WebView webView = getBridge() == null ? null : getBridge().getWebView();
                    if (webView != null) webView.requestLayout();
                } catch (Throwable ignored) {
                    // WebView 还没建好（Bridge 创建之前）就算了，下一拍还会再压。
                }
            });
        } catch (Throwable ignored) {
            // 窗口已经销毁：没有可重新测量的东西。
        }
    }

    /**
     * 转屏 / 分屏 / 折叠屏展开之后系统会把 inset 重新写回来，沉浸态与挖孔都得重压一次。
     *
     * 清单里声明了 configChanges，所以这些变化走的是这里而不是重建 Activity —— 少了这一下，
     * 转完屏顶部就留着一条状态栏的黑条（WebView 也还按上一次的尺寸画着）。
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyImmersiveMode();
        PhoneFitCutout.apply(this);
        getWindow().getDecorView().postDelayed(this::applyImmersiveMode, 200);
        getWindow().getDecorView().postDelayed(() -> PhoneFitCutout.apply(this), 200);
    }

    /**
     * 只切换系统栏图标的明暗，不影响隐藏状态。
     *
     * 从 web 层（useCapacitorSystemBars）调 StatusBar.setStyle 也有同样效果，
     * 但那会连带触发 setSystemUiVisibility，把 hide 的结果冲掉，所以改在这里做。
     */
    public void applySystemBarAppearance(boolean isDaylight) {
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), decorView);
        // 亮色主题下图标用深色，反之为浅色。
        controller.setAppearanceLightStatusBars(isDaylight);
        controller.setAppearanceLightNavigationBars(isDaylight);
    }
}
