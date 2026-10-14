package top.izuna.foliamajor.export;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.Bridge;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 导出用的**离屏渲染页**。
 *
 * 它存在的全部理由：不能抓主播放页 —— 那一屏上有播放条、系统栏、控制面板，抓下来
 * 就是录屏。这一页只画可视化本身，时钟由导出程序一帧一帧往前推（合成时钟，
 * 不是真实播放），所以录出来的是渲染结果。
 *
 * 取帧走 `View.draw()`：关掉硬件加速之后，WebView 的内容会画进 View 自己的绘制里，
 * 于是可以不显示在屏幕上、直接 `draw` 到一张 Bitmap。这是安卓上唯一一条
 * 「不需要可见就能拿到 WebGL 画面」的路 —— `PixelCopy` 只认已经合成过的窗口，
 * 看不见的 View 它抓不到空白，而硬件加速开着时 `View.draw()` 也拿不到 Surface 上的内容。
 *
 * 这条路有两个不确定，所以都留了降级：
 *
 *  1. **JS 通道 / rAF 可能会停**：这一页必须挂在窗口上才有正常生命周期，但一旦被判定
 *     不可见，Chromium 会掐掉 rAF、节流 renderer —— 那样推帧永远得不到回应。
 *     所以宿主是 **1×1 + VISIBLE + alpha 0**：既要 `onWindowVisibilityChanged(VISIBLE)`，
 *     又要用 alpha 让它看不见。（早先用 `setVisibility(INVISIBLE)` 是错的：那样 WebView
 *     直接收到 INVISIBLE，`document.hidden` 为真，rAF 停摆。）
 *     这两项都在 `loadAndWait()` 里**实测**，不靠猜。
 *  2. **WebGL 可能建不出上下文**：软渲染下 WebGL 走 SwiftShader（CPU），多数机器能用
 *     但不是必然。页面里会真的画一笔并读回像素来确认，不是"建出来就算数"。
 *
 * 两条都不行的时候降级到 `fallbackToVisible()`：同一个页面改成全屏可见 +
 * 硬件加速，改用 PixelCopy 抓主窗口。功能不丢，只是用户会看到一个"渲染中"的页面。
 */
public final class ExportRenderView {

    private static final String TAG = "FoliaExportRender";
    private static final String PAGE = "https://localhost/export.html";

    private static final long LOAD_TIMEOUT_MS = 20000;
    /** 页面就绪之后再等多久「内容真的画出来了」。可视化是懒加载的。 */
    private static final long PAINT_TIMEOUT_MS = 12000;
    private static final long FRAME_TIMEOUT_MS = 5000;
    private static final long POLL_INTERVAL_MS = 8;

    private final Activity activity;
    private final Bridge bridge;
    private final int width;
    private final int height;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private FrameLayout host;
    private WebView webView;
    private LocalAssetClient assetClient;
    private Bitmap scratch;
    private String failure;
    private boolean visibleMode = false;
    private boolean released = false;

    public ExportRenderView(Activity activity, Bridge bridge, int width, int height) {
        this.activity = activity;
        this.bridge = bridge;
        this.width = width;
        this.height = height;
    }

    /** 建出 WebView 并挂进一个 1×1 的隐藏容器。必须在主线程调。 */
    public void attach() {
        if (webView != null || released) {
            return;
        }
        host = new FrameLayout(activity);
        /*
         * **这里必须是 VISIBLE，不能是 INVISIBLE。**
         *
         * `setVisibility(INVISIBLE)` 会让 WebView 收到 INVISIBLE，`document.hidden` 变成
         * true，Chromium 顺势掐掉 rAF 并节流 renderer —— 页面照样能加载到 complete，
         * 但之后的推帧一步都走不动，最后报「没等到就绪信号」。
         * 要"看不见"应该靠 alpha，而不是靠 visibility：alpha 是 View 合成层的属性，
         * 不影响页面自己的可见性判定。
         */
        host.setVisibility(View.VISIBLE);
        host.setAlpha(0f);

        webView = new WebView(activity);
        /*
         * 软件渲染是这套离屏取帧的前提：硬件加速开着的时候 WebView 的内容在
         * Surface 上，`View.draw()` 只画得出一个空壳。
         */
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // 配置是从 localStorage 读的（主应用写、这一页读，同源），不开就只拿到空配置。
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        // 1×1：够让它挂在窗口上、拿到正常的生命周期，又小到看不见也点不到。
        decor.addView(host, new ViewGroup.LayoutParams(1, 1));
        host.addView(webView, new ViewGroup.LayoutParams(1, 1));

        assetClient = new LocalAssetClient();
        webView.setWebViewClient(assetClient);
    }

    /**
     * 加载页面并等它就绪。
     *
     * 返回 WebGL 是不是真的能用；页面起不来返回 null（调用方据此报错，详情取
     * `takeFailure()`）。这个方法会**阻塞**，别在主线程调。
     */
    public Boolean loadAndWait() {
        if (webView == null) {
            return null;
        }
        mainHandler.post(() -> webView.loadUrl(PAGE + "?w=" + width + "&h=" + height));
        sleepQuietly(800);

        /*
         * 先确认 evaluateJavascript 这条路是通的。
         *
         * 取不到值就不能往下走了：后面所有判断（就绪、画完没有、WebGL 能不能用）
         * 全靠它，通了才有意义；不通说明这个 WebView 不愿意在不显示的时候跑 JS。
         */
        if (evalString("String(1)") == null) {
            Log.w(TAG, "离屏状态下 JS 通道没回音，改走可见窗口再试");
            fallbackToVisible();
            sleepQuietly(1000);
            if (evalString("String(1)") == null) {
                noteFailure("WebView 的 JS 通道不通（离屏、可见两种状态下都取不到值）。诊断："
                        + buildDiagnostic());
                return null;
            }
        }

        final long deadline = System.currentTimeMillis() + LOAD_TIMEOUT_MS;
        boolean ready = false;
        while (System.currentTimeMillis() < deadline) {
            // 主资源已经报错就别再干等了（默认要等满 20 秒才报，用户只会以为卡死）。
            if (assetClient != null && assetClient.takeFailure() != null) {
                noteFailure(assetClient.takeFailure());
                return null;
            }
            if (Boolean.TRUE.equals(evalBoolean("!!(window.__foliaExportReady && window.__foliaExport)"))) {
                ready = true;
                break;
            }
            if (!sleepQuietly(120)) {
                break;
            }
        }
        if (!ready) {
            Log.w(TAG, "渲染页在 " + LOAD_TIMEOUT_MS + "ms 内没有就绪");
            noteFailure("渲染页 " + (LOAD_TIMEOUT_MS / 1000) + " 秒没等到就绪信号。诊断："
                    + buildDiagnostic());
            return null;
        }

        if (!awaitRafAlive()) {
            noteFailure("渲染页的 rAF 没有在推进（页面大概率被判定为不可见）。诊断："
                    + buildDiagnostic());
            return null;
        }

        /*
         * 再等「内容真的画出来了」：可视化是动态 import 的，页面就绪 ≠ 画面有了。
         * 等不到不直接失败 —— 后面连续空帧那道闸会兜住（最终降级 / 报错）。
         */
        final long paintDeadline = System.currentTimeMillis() + PAINT_TIMEOUT_MS;
        while (System.currentTimeMillis() < paintDeadline) {
            if (Boolean.TRUE.equals(evalBoolean("!!window.__foliaExportPainted"))) {
                break;
            }
            if (!sleepQuietly(120)) {
                break;
            }
        }
        return evalBoolean("!!window.__foliaExportWebglOk");
    }

    /**
     * rAF 有没有真的在跑。
     *
     * 页面里有一个每帧自增的心跳计数器（见 export.html）。推帧、以及整个
     * "画完了没有"的判定都建立在 rAF 之上 —— 它不动，后面全是死等。
     */
    private boolean awaitRafAlive() {
        Integer before = evalInt("Number(window.__foliaExportRafTicks || 0)");
        sleepQuietly(500);
        Integer after = evalInt("Number(window.__foliaExportRafTicks || 0)");
        if (before != null && after != null && after > before) {
            return true;
        }
        if (visibleMode) {
            return false;
        }
        Log.w(TAG, "离屏状态下 rAF 没有推进，降级到可见窗口再试");
        fallbackToVisible();
        sleepQuietly(1000);
        before = evalInt("Number(window.__foliaExportRafTicks || 0)");
        sleepQuietly(500);
        after = evalInt("Number(window.__foliaExportRafTicks || 0)");
        return before != null && after != null && after > before;
    }

    /**
     * 把画面推进到第 t 秒并取回这一帧。
     *
     * 可以在后台线程调：推时间、轮询、取帧都回主线程做，这里等结果。
     *
     * 「画完了没有」靠页面自己推的计数器（`window.__foliaExportFrameStamp`）：
     * `evaluateJavascript` 会不会替我们 await 一个 Promise 在不同 WebView 版本上
     * 不保证一致，而这个信号错了就是整条片子慢半拍 —— 宁可多一次轮询。
     */
    public Bitmap captureFrame(double tSec, int index) {
        if (webView == null || released) {
            return null;
        }
        final int target = index + 1;
        mainHandler.post(() -> {
            if (released || webView == null) return;
            webView.evaluateJavascript(
                    "window.__foliaExport.renderFrame(" + tSec + "," + index + ")", null);
        });

        final long deadline = System.currentTimeMillis() + FRAME_TIMEOUT_MS;
        boolean drawn = false;
        while (System.currentTimeMillis() < deadline) {
            Integer stamp = evalInt("Number(window.__foliaExportFrameStamp || 0)");
            if (stamp != null && stamp >= target) {
                drawn = true;
                break;
            }
            if (!sleepQuietly(POLL_INTERVAL_MS)) {
                break;
            }
        }
        if (!drawn) {
            Log.w(TAG, "第 " + index + " 帧在 " + FRAME_TIMEOUT_MS + "ms 内没有画完");
            return null;
        }

        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Bitmap> out = new AtomicReference<>(null);
        mainHandler.post(() -> {
            if (released || webView == null) {
                latch.countDown();
                return;
            }
            // 降级路径：画面在屏上，抓窗口（此时窗口里就是这一页）。
            out.set(visibleMode ? copyWindow() : drawOffscreen());
            latch.countDown();
        });
        try {
            latch.await(FRAME_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
        return out.get();
    }

    /** 离屏取帧：手动量到导出尺寸再画到 Bitmap。 */
    private Bitmap drawOffscreen() {
        if (webView == null) {
            return null;
        }
        if (scratch == null) {
            scratch = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        }
        /*
         * 每次都重新量一遍：宿主容器只有 1×1，父布局一有动静就会把 WebView 压回 1×1，
         * 不量到导出尺寸的话画出来就只有一个像素。
         */
        int widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY);
        int heightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY);
        webView.measure(widthSpec, heightSpec);
        webView.layout(0, 0, width, height);
        Canvas canvas = new Canvas(scratch);
        canvas.drawColor(0); // 透明底：能不能拿到 alpha 就看这里。
        webView.draw(canvas);
        return scratch;
    }

    /** 降级路径：抓主窗口（此时窗口里显示的是全屏的渲染页）。 */
    private Bitmap copyWindow() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return null;
        }
        if (scratch == null) {
            scratch = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        }
        Window window = activity.getWindow();
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicBoolean ok = new AtomicBoolean(false);
        try {
            PixelCopy.request(window, scratch,
                    result -> {
                        ok.set(result == PixelCopy.SUCCESS);
                        latch.countDown();
                    },
                    mainHandler);
        } catch (Throwable error) {
            Log.w(TAG, "PixelCopy 调用失败", error);
            return null;
        }
        try {
            latch.await(1500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        }
        return ok.get() ? scratch : null;
    }

    /**
     * 降级：同一个页面改成全屏可见 + 硬件加速，改用抓窗口取帧。
     *
     * 什么时候需要：软渲染下 WebGL 建不出上下文、离屏时 JS 通道或 rAF 不动、
     * 或者连续几帧全透明。代价是用户会看到一个"渲染中"的页面，且拿不到 alpha。
     */
    public void fallbackToVisible() {
        if (webView == null || released || visibleMode) {
            return;
        }
        visibleMode = true;
        mainHandler.post(() -> {
            if (released || webView == null) return;
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            if (host != null) {
                host.setAlpha(1f);
                ViewGroup.LayoutParams params = host.getLayoutParams();
                params.width = ViewGroup.LayoutParams.MATCH_PARENT;
                params.height = ViewGroup.LayoutParams.MATCH_PARENT;
                host.setLayoutParams(params);
            }
            ViewGroup.LayoutParams webParams = webView.getLayoutParams();
            webParams.width = ViewGroup.LayoutParams.MATCH_PARENT;
            webParams.height = ViewGroup.LayoutParams.MATCH_PARENT;
            webView.setLayoutParams(webParams);
            webView.requestLayout();
        });
        // 让布局真的落一帧，别让头几帧抓到还没铺开的页面。
        sleepQuietly(400);
    }

    /** 是不是已经降过级（画面已经搬到可见窗口上了）。 */
    public boolean isVisibleMode() {
        return visibleMode;
    }

    /**
     * 渲染页为什么没起来。没有就返回 null。
     *
     * 这一句是要直接给用户看的，所以必须具体到能照着改：统一说一句「渲染页面起不来」，
     * 看的人既不知道是该重新出包、也不知道是不是机器不行，只能来回问。
     */
    public String takeFailure() {
        return failure;
    }

    private void noteFailure(String message) {
        if (failure == null) {
            failure = message;
        }
        Log.w(TAG, "渲染页不可用：" + message);
    }

    /**
     * 把页面端的自检信息（见 export.html 里的 `__foliaExportDiag`）拉回来，压成一句话。
     *
     * 这一页离屏，logcat 常常拿不到、console 更看不见 —— 唯一能带出来的渠道就是
     * 这条错误消息本身。所以宁可啰嗦也不能漏：URL、可见性、有没有挂载上 API、
     * 脚本清单、JS 错误全带上。
     */
    private String buildDiagnostic() {
        String raw = evalString("(window.__foliaExportDiag ? window.__foliaExportDiag() : '{}')");
        if (raw == null) {
            return "（连自检都拉不回来：evaluateJavascript 没有回音）";
        }
        try {
            Object decoded = new JSONTokener(raw).nextValue();
            String json = decoded instanceof String ? (String) decoded : raw;
            JSONObject data = new JSONObject(json);
            StringBuilder out = new StringBuilder();
            out.append("url=").append(data.optString("url", "?"));
            out.append(" readyState=").append(data.optString("readyState", "?"));
            out.append(" visibility=").append(data.optString("visibility", "?"));
            out.append(" api=").append(data.optBoolean("hasApi", false));
            out.append(" ready=").append(data.optBoolean("hasReady", false));
            out.append(" painted=").append(data.optBoolean("hasPainted", false));
            out.append(" root=").append(data.optBoolean("hasRoot", false));
            out.append(" config=").append(data.optBoolean("hasConfig", false));
            out.append(" raf=").append(data.optInt("raf", 0));
            String scripts = data.optJSONArray("scripts") == null
                    ? "" : data.optJSONArray("scripts").toString();
            out.append(" scripts=").append(cut(scripts, 160));
            String errors = data.optJSONArray("errors") == null
                    ? "" : data.optJSONArray("errors").toString();
            out.append(" errors=").append(cut(errors, 300));
            String diagError = data.optString("diagError", "");
            if (!diagError.isEmpty()) {
                out.append(" diagError=").append(cut(diagError, 120));
            }
            return out.toString();
        } catch (Throwable error) {
            Log.w(TAG, "自检信息解析失败", error);
            return "（自检信息解析失败：" + cut(String.valueOf(raw), 200) + "）";
        }
    }

    /** 这一帧是不是空的（全透明）。用来判断画面到底有没有画出来。 */
    public static boolean isBlank(Bitmap bitmap) {
        if (bitmap == null) return true;
        int step = 16; // 抽样：全扫一遍太慢，这里只回答"有没有东西"。
        for (int y = 0; y < bitmap.getHeight(); y += step) {
            for (int x = 0; x < bitmap.getWidth(); x += step) {
                if ((bitmap.getPixel(x, y) & 0xFF000000) != 0) {
                    return false;
                }
            }
        }
        return true;
    }

    private static String cut(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max) + "...";
    }

    /**
     * 本地资源服务。**页面能不能加载出来就看这一层。**
     *
     * `https://localhost/*` 不是一个真的服务器 —— 它是 Capacitor 在自己那个
     * `BridgeWebViewClient.shouldInterceptRequest` 里用 `WebViewLocalServer` 假出来的
     * （见 com/getcapacitor/BridgeWebViewClient.java）。主 WebView 自带这个 client，
     * 所以那里一切正常；而我们 `new` 出来的这个 WebView 默认是**空 client**，它会真的
     * 往 localhost:443 发请求 —— 本机没有这个服务，直接 ERR_CONNECTION_REFUSED。
     *
     * 所以这里把同一个 `WebViewLocalServer` 接过来。另外留了第二条路（直接读
     * assets/public）：万一 Capacitor 换了 `hostname` / `androidScheme`、或者某个请求
     * 它不认，还能从打包进去的那份资源里取到。
     */
    private class LocalAssetClient extends WebViewClient {

        private final AtomicReference<String> failure = new AtomicReference<>(null);

        String takeFailure() {
            return failure.get();
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse served = null;
            if (bridge != null) {
                try {
                    served = bridge.getLocalServer().shouldInterceptRequest(request);
                } catch (Throwable error) {
                    Log.w(TAG, "本地资源服务没能处理这个请求", error);
                }
            }
            if (served != null) {
                return served;
            }
            return readFromAssets(request);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            Log.d(TAG, "渲染页加载完成：" + url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            String detail = error != null
                    ? (error.getErrorCode() + " " + error.getDescription())
                    : "unknown";
            Log.w(TAG, "渲染页主资源加载失败：" + detail + " " + request.getUrl());
            failure.compareAndSet(null, "渲染页加载失败（" + detail + "）");
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            int status = errorResponse != null ? errorResponse.getStatusCode() : 0;
            Log.w(TAG, "渲染页资源 " + status + "：" + request.getUrl());
            if (!request.isForMainFrame() || status == 0) return;
            // 主资源 404 基本只有一种可能：包里的 web 资源是旧的（没有 export.html）。
            failure.compareAndSet(null, status == 404
                    ? "安装包里没有 export.html（" + status + "）：这一版前端资源是旧的，重新构建再出包试试。"
                    : "渲染页加载失败（HTTP " + status + "）");
        }

        private WebResourceResponse readFromAssets(WebResourceRequest request) {
            String path = request.getUrl().getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "/index.html";
            }
            try {
                InputStream stream = activity.getAssets().open("public" + path);
                return new WebResourceResponse(guessMimeType(path), "UTF-8", stream);
            } catch (Throwable ignored) {
                return null;
            }
        }
    }

    /**
     * 猜 MIME。
     *
     * 这一环错了也会被 mute 掉：Chromium 对 ES module 做严格 MIME 检查，
     * `.js` 给成 `application/octet-stream` 的话整个渲染页一行 JS 都不会执行，
     * 表现和"页面没起来"一模一样。
     */
    private static String guessMimeType(String path) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        String type = extension != null
                ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                : null;
        if (type != null) return type;
        int dot = path.lastIndexOf('.');
        String suffix = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.US) : "";
        switch (suffix) {
            case "js":
            case "mjs":
                return "text/javascript";
            case "css":
                return "text/css";
            case "json":
            case "map":
                return "application/json";
            case "svg":
                return "image/svg+xml";
            case "wasm":
                return "application/wasm";
            default:
                return "application/octet-stream";
        }
    }

    private static boolean sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
            return true;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private Boolean evalBoolean(String script) {
        String raw = evalString(script);
        if (raw == null) return null;
        return "true".equals(raw.replace("\"", "").trim()) ? Boolean.TRUE : Boolean.FALSE;
    }

    private Integer evalInt(String script) {
        String raw = evalString(script);
        if (raw == null) return null;
        try {
            return Integer.parseInt(raw.replace("\"", "").trim());
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private String evalString(String script) {
        if (webView == null) {
            return null;
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<String> result = new AtomicReference<>(null);
        mainHandler.post(() -> {
            if (webView == null) {
                latch.countDown();
                return;
            }
            webView.evaluateJavascript("(function(){return String(" + script + ");})()", value -> {
                result.set(value);
                latch.countDown();
            });
        });
        try {
            latch.await(2000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        }
        String raw = result.get();
        // evaluateJavascript 给不了值时会回调 "null"（或者干脆不回调），两种都算不通。
        if (raw == null || "null".equals(raw)) return null;
        try {
            Object decoded = new JSONTokener(raw).nextValue();
            return decoded instanceof String ? (String) decoded : String.valueOf(decoded);
        } catch (Throwable error) {
            return raw;
        }
    }

    /** 收摊。可以在任意线程调（内部回主线程）。 */
    public void release() {
        released = true;
        mainHandler.post(() -> {
            if (webView != null) {
                try {
                    webView.stopLoading();
                    webView.loadUrl("about:blank");
                    webView.destroy();
                } catch (Throwable error) {
                    Log.w(TAG, "WebView 释放失败", error);
                }
                webView = null;
            }
            assetClient = null;
            if (host != null && host.getParent() instanceof ViewGroup) {
                ((ViewGroup) host.getParent()).removeView(host);
                host = null;
            }
            scratch = null;
        });
    }
}
