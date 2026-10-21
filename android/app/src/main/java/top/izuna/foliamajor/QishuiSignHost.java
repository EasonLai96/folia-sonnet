package top.izuna.foliamajor;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * 汽水音乐的签名宿主（安卓版）。
 *
 * 汽水那套接口的签名不是我们算的，是官方的 bdms.js 算的 —— 它改写页面里的 XHR/fetch，
 * 在请求发出前补上签名参数。所以要拿到签名，就必须有一个**真的浏览器页面**在跑它。
 * 桌面端由 Electron 的隐藏 BrowserWindow 提供（electron/qishui/qishui-auth-v6.js），
 * 安卓端没有 Electron，这里用原生起的隐藏 WebView 顶上，并且：
 *
 *   1. 把打包进 assets 的那套页面与脚本挂到一个假的 https 源下
 *      （https://www.qishui.com/__folia/...），让 bdms.js 认为自己就在汽水的站点里；
 *   2. 用 shouldInterceptRequest 把这个页面发出去的跨域请求拦下来，改由 OkHttp 真发，
 *      并补上 CORS 头 —— 否则 https://www.qishui.com 的页面读不到 api.qishui.com 的响应。
 *
 * 页面里的协议层（qishui-api.js 那一份）由此可以在安卓上原样跑，
 * 与桌面端共用同一个 operation 表与同一个返回信封。
 *
 * 线程：所有 WebView 操作都在主线程；shouldInterceptRequest 跑在 WebView 的工作线程上，
 * 所以那里用 OkHttp 的同步 execute() 是安全的（同步阻塞的是那个线程，不是插件线程）。
 */
final class QishuiSignHost {
    private static final String TAG = "QishuiSignHost";

    /** 协议层持久化用的 SharedPreferences 名与键前缀（见 HostBridge.getStore）。 */
    private static final String STORE_PREFS = "folia_qishui";
    private static final String STORE_PREFIX = "car:";

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(STORE_PREFS, Context.MODE_PRIVATE);
    }

    /** 假源：页面挂在这个源下，bdms.js 才会按「在汽水站内」那套规则签名。 */
    static final String PAGE_ORIGIN = "https://www.qishui.com";
    /** assets 里那套页面在这个假源下的挂载点。 */
    private static final String PAGE_PATH_PREFIX = "/__folia/";
    private static final String BOOTSTRAP_URL = PAGE_ORIGIN + PAGE_PATH_PREFIX + "bootstrap.html";
    /** assets 下的目录。 */
    private static final String ASSET_DIR = "qishui/";

    /**
     * 与桌面端 qishui-auth-v6.js 的 UA 保持一致：签名里带了设备指纹，
     * UA 换一套会让风控把这一路判成「换设备」，登录态立刻失效。
     */
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "SodaMusic/3.2.1 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 "
                    + "TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36";

    /** 允许代发请求的主机后缀（其余一律拦掉，避免这个 WebView 变成任意代理）。 */
    private static final String[] ALLOWED_HOST_SUFFIXES = {
            "qishui.com", "douyin.com", "byteimg.com", "volcengine.com", "amemv.com", "snssdk.com",
            // 二次验证（MFA）组件跑在 verify/auth.zijieapi.com，组件脚本与素材在字节静态 CDN 上。
            "zijieapi.com", "yhgfb-cn-static.com", "bytedance.net", "ibytedtos.com",
    };

    /** 官方 bdms.js 的 CDN 地址：上游用 session hook 重定向到本地，这里对同一个 URL 直接回 assets。 */
    private static final String OFFICIAL_BDMS_URL =
            "https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js";

    /** evaluateJavascript 走 IPC 有长度上限；回传大响应（歌单整包）时按块推给页面。 */
    private static final int HTTP_RESULT_CHUNK_CHARS = 512 * 1024;

    private final MainActivity activity;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    // 车机协议（客户端令牌 / ticket-guard）的参考实现用 `redirect: 'error'`：
    // 请求里带着 access_code 与 CSR，一旦上游回 3xx，跟随跳转后**响应头里的
    // bd-ticket-guard-server-data 会丢** —— 表现是请求成功（err_no=0）却读不到
    // guard 数据，登录卡在 ticket 那一拍。所以整座桥都不跟随重定向：协议层所有
    // 端点都不该跳，跳了就是异常，直接把状态码交回页面判定。
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();

    private WebView webView;
    private volatile boolean ready = false;
    private volatile String failureReason = null;
    private final AtomicInteger ticketSeq = new AtomicInteger(1);
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    /** 页面就绪之前发来的请求在这里排队（见 request 与 drainWaiting）。 */
    private final java.util.Queue<Runnable> waiting = new java.util.concurrent.ConcurrentLinkedQueue<>();
    /** 宿主自己要用的 cookie：协议层的「当前会话」就是它。 */
    private volatile String sessionCookie = "";
    /**
     * OkHttp 收到的 set-cookie 自己攒一份。登录态（sessionid 等）正是这么下发的，
     * 而 CookieManager 的读回依赖 WebView 状态、还可能因为不在主线程而失败 ——
     * 不能当唯一来源，所以这里同步记一份，`getCookie` 先给这份再补 CookieManager。
     */
    private final java.util.Map<String, String> jarCookies =
            java.util.Collections.synchronizedMap(new java.util.LinkedHashMap<String, String>());
    /** 加密音频的本地回环代理：主 WebView 的 <audio> 吃这个地址（独立于签名 WebView）。 */
    private final QishuiAudioServer audioServer = new QishuiAudioServer();
    private final java.util.concurrent.ExecutorService executor =
            java.util.concurrent.Executors.newSingleThreadExecutor();

    /**
     * 请求要带的 Cookie 头：自攒的 jar 优先，CookieManager 补缺的名字。
     *
     * 都放在外层是因为两条出口都要用——http() 桥（异步，内部类 HostBridge 里）和
     * shouldInterceptRequest（同步，外层方法）。只在一处实现必然编译不过或漏一半。
     */
    private String cookieHeaderFor(String url) {
        StringBuilder out = new StringBuilder();
        synchronized (jarCookies) {
            for (Map.Entry<String, String> entry : jarCookies.entrySet()) {
                if (out.length() > 0) out.append("; ");
                out.append(entry.getKey()).append('=').append(entry.getValue());
            }
        }
        // CookieManager 可能还存着页面自己那一份，缺的名字补上（已有的不覆盖，
        // 罐里的值可能更旧）。
        String[] pairs = readWebViewCookies(url).split(";");
        for (String pair : pairs) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            String name = pair.substring(0, eq).trim();
            if (name.isEmpty()) continue;
            synchronized (jarCookies) {
                if (jarCookies.containsKey(name)) continue;
            }
            if (out.length() > 0) out.append("; ");
            out.append(name).append('=').append(pair.substring(eq + 1).trim());
        }
        return out.toString();
    }

    private String readWebViewCookies(String url) {
        if (url == null || url.isEmpty()) return "";
        try {
            String value = CookieManager.getInstance().getCookie(url);
            return value == null ? "" : value;
        } catch (Throwable error) {
            Log.w(TAG, "getCookie failed", error);
            return "";
        }
    }

    /** 只保留 `name=value`，丢掉 expires / path / domain 等属性。 */
    private void rememberCookie(String setCookie) {
        if (setCookie == null) return;
        String pair = setCookie.split(";", 2)[0].trim();
        int eq = pair.indexOf('=');
        if (eq <= 0) return;
        String name = pair.substring(0, eq).trim();
        String value = pair.substring(eq + 1).trim();
        if (name.isEmpty()) return;
        // 空值是服务端在清这个 cookie。
        if (value.isEmpty()) jarCookies.remove(name);
        else jarCookies.put(name, value);
    }

    interface Pending {
        void resolve(String json);
    }

    QishuiSignHost(MainActivity activity) {
        this.activity = activity;
    }

    boolean isReady() {
        return ready;
    }

    String getFailureReason() {
        return failureReason;
    }

    /** 主线程上创建隐藏 WebView 并加载引导页；可重复调用（已建好就直接返回）。 */
    void ensureStarted() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(this::ensureStarted);
            return;
        }
        if (webView != null) return;
        WebView created;
        try {
            created = new WebView(activity);
        } catch (Throwable error) {
            failureReason = "webview-create-failed: " + error.getMessage();
            Log.w(TAG, failureReason);
            return;
        }
        webView = created;
        configure(created);
        // 挂到 Activity 的内容视图上（1x1、透明、移到屏幕外）。
        //
        // 不能只 new 一个不挂载的 WebView：没有 attach 的 WebView 不会走完整的
        // 生命周期，JS 定时器与 rAF 会被系统掐掉，bdms.js 的初始化会一直卡住。
        // 也不能用 setVisibility(INVISIBLE) —— 那样同样会被当成不可见而不排帧。
        // 这里让它在布局里真实存在，只是小到看不见。
        try {
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root != null) {
                ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(1, 1);
                created.setLayoutParams(params);
                created.setAlpha(0f);
                created.setBackgroundColor(Color.TRANSPARENT);
                created.setTranslationX(-10000f);
                root.addView(created);
            }
        } catch (Throwable error) {
            Log.w(TAG, "attaching the hidden signing webview failed", error);
        }
        created.addJavascriptInterface(new HostBridge(), "FoliaQishuiHost");
        created.setWebViewClient(new HostClient());
        created.loadUrl(BOOTSTRAP_URL);
        // 音频代理提前起（失败只降级为「无本地代理」，song.url 原样直链）。
        executor.execute(audioServer::start);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configure(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUserAgentString(UA);
        settings.setLoadWithOverviewMode(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 不能缓存：签名参数每次都不一样，缓存下来的响应会被风控认成重放。
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
    }

    /**
     * 一个票据最多等这么久。
     *
     * 比渲染层 accountRead 的 60 秒兜底（WHO_WAIT_MS）短，这样「桥确实没回」会变成一个
     * **明确的错误**（渲染层记一条 warn 并保留账号），而不是一句看不出所以然的
     * "no answer in 60 s"。比 OkHttp 那头的读超时（25 秒）长，正常慢请求不会被误杀。
     */
    private static final long RESPONSE_TIMEOUT_MS = 45_000;

    /**
     * 把一个 operation 交给页面里的协议层。
     *
     * 不能走 evaluateJavascript 的返回值：页面里的协议层是异步的，而
     * evaluateJavascript 只能拿到表达式的**同步**结果。这里改成票据 + 回调：
     * 原生给一个 ticket，页面算完调 FoliaQishuiHost.resolve(ticket, json)。
     */
    void request(String operation, String paramsJson, Pending callback) {
        final String ticket = String.valueOf(ticketSeq.getAndIncrement());
        pending.put(ticket, callback);
        final String script = "window.__foliaQishui && window.__foliaQishui.start("
                + quote(operation) + "," + paramsJson + "," + quote(ticket) + ")";
        final Runnable send = () -> {
            if (webView == null) {
                Pending entry = pending.remove(ticket);
                if (entry != null) entry.resolve(envelopeJson(false, null, "unavailable", "Signing host is not started"));
                return;
            }
            webView.evaluateJavascript(script, null);
        };
        // ⚠ 页面没 ready 就发 = **静默丢单**，这是「重启后账号没了」的直接原因。
        //
        // 脚本开头那个 `window.__foliaQishui && …` 在 protocol.js 执行完之前是
        // undefined：整个表达式短路成 undefined，evaluateJavascript 正常返回，
        // 页面**永远不会**调 resolve(ticket)。这个票据从此没人管，渲染层只能一路
        // 等到 accountRead 的 60 秒兜底 —— 真机日志里那句
        // "who is signed in could not be asked … no answer in 60 s" 就是它。
        // 而 status 那一问正是**续期（renew）的唯一触发点**：它没跑，凭据就一直
        // 是旧的，账号请求被上游判 auth-required，只能退回公共令牌 → VIP 曲子
        // 只剩试听。一个丢单，两个现象。
        if (!ready) {
            synchronized (waiting) { waiting.add(send); }
            Log.i(TAG, "request " + operation + " waits for the page (ticket " + ticket + ")");
        } else {
            mainHandler.post(send);
        }
        // 兜底：无论如何都要给这个票据一个结局，不能让它永远挂着。
        mainHandler.postDelayed(() -> timeoutTicket(ticket, operation), RESPONSE_TIMEOUT_MS);
    }

    private void timeoutTicket(String ticket, String operation) {
        Pending entry = pending.remove(ticket);
        if (entry == null) return;
        Log.w(TAG, "request " + operation + " (ticket " + ticket + ") got no answer in "
                + RESPONSE_TIMEOUT_MS + " ms");
        entry.resolve(envelopeJson(false, null, "network", "The Qishui signing host did not answer in time"));
    }

    /** 页面就绪：把排队等着的请求全部发出去（已在主线程）。 */
    private void drainWaiting() {
        final java.util.List<Runnable> queued;
        synchronized (waiting) {
            if (waiting.isEmpty()) return;
            queued = new java.util.ArrayList<>(waiting);
            waiting.clear();
        }
        Log.i(TAG, "the page is ready; " + queued.size() + " queued request(s) go out now");
        for (Runnable send : queued) send.run();
    }

    void setSessionCookie(String cookie) {
        sessionCookie = cookie == null ? "" : cookie;
    }

    String getSessionCookie() {
        return sessionCookie;
    }

    void dispose() {
        mainHandler.post(() -> {
            if (webView == null) return;
            try {
                webView.stopLoading();
                webView.removeJavascriptInterface("FoliaQishuiHost");
                ViewGroup parent = (ViewGroup) webView.getParent();
                if (parent != null) parent.removeView(webView);
                webView.destroy();
            } catch (Throwable error) {
                Log.w(TAG, "disposing the signing webview failed", error);
            }
            webView = null;
            ready = false;
            audioServer.stop();
            // 还在排队的那几个票据仍挂在 pending 里，下面这一圈会一并把它们结掉。
            synchronized (waiting) { waiting.clear(); }
            for (Map.Entry<String, Pending> entry : pending.entrySet()) {
                entry.getValue().resolve(envelopeJson(false, null, "unavailable", "Signing host was disposed"));
            }
            pending.clear();
        });
    }

    // ─── JS → 原生 ────────────────────────────────────────────────────────

    private final class HostBridge {
        @JavascriptInterface
        public void onReady(String cookie) {
            ready = true;
            failureReason = null;
            if (cookie != null) sessionCookie = cookie;
            Log.i(TAG, "signing host ready");
            // 排队的请求现在可以发了（@JavascriptInterface 跑在桥线程，派发回主线程）。
            mainHandler.post(QishuiSignHost.this::drainWaiting);
        }

        @JavascriptInterface
        public void onFailure(String reason) {
            failureReason = reason;
            Log.w(TAG, "signing host failed: " + reason);
        }

        @JavascriptInterface
        public void resolve(String ticket, String json) {
            Pending entry = pending.remove(ticket);
            if (entry != null) entry.resolve(json);
        }

        /** 页面把当前会话 cookie 回传（登录后 / 登出后都会调）。 */
        @JavascriptInterface
        public void setCookie(String cookie) {
            sessionCookie = cookie == null ? "" : cookie;
        }

        /**
         * 登出时把宿主侧的 cookie 全部清掉。
         *
         * 协议层只清它自己那份（config.cookie 与 COOKIE_FILE），但登录态还留在
         * 这里的两处：自攒的 jarCookies 与 WebView 的 CookieManager —— 请求发
         * 出去时仍然带着旧会话，于是「点了退出却还登着」，下一次扫码也会撞上
         * 上一个会话。
         */
        @JavascriptInterface
        public void clearCookies() {
            synchronized (jarCookies) {
                jarCookies.clear();
            }
            sessionCookie = "";
            try {
                CookieManager.getInstance().removeAllCookies(null);
            } catch (Throwable error) {
                Log.w(TAG, "clearCookies failed", error);
            }
        }

        /**
         * 把 WebView cookie 罐里某个源下的 cookie 回给页面。
         *
         * 登录确认时 passport 的登录态是走 Set-Cookie 下发的（响应体里的
         * session_cookie 字段经常是空的）；这些 cookie 由 OkHttp 收到后转发进
         * CookieManager（见 http() 里的 set-cookie 处理）。上游在 Electron 里靠
         * `session.cookies.get({})` 把它们并回 config，安卓只能从这里读 —— 少了
         * 这一步，`getStatus().loggedIn` 永远是 false，表现成「扫码确认了但账号
         * 出不来」。
         */
        /**
         * 协议层的持久化出口：设备 ID 与登录凭据存这里。
         *
         * WebView 的 localStorage 本来也能持久化，但它依赖 DOM storage 与 WebView
         * 数据目录的状态（系统清理、存储紧张、多进程都会让它丢），表现就是
         * 「登录成功、重启后账号没了」。SharedPreferences 是 App 自己的文件，稳。
         * 页面侧（car/storage.js）仍然双写 localStorage 作为回退。
         *
         * ⚠ 必须用 **commit()**（同步落盘）而不是 apply()：凭据是在扫码确认那一刻
         * 写进来的，用户常常紧接着就把 App 划掉 / 重启。apply() 只是把写盘排进
         * QueuedWork，进程若在这之前被杀（没走完 onPause，QueuedWork 就不会
         * waitToFinish），那一次写入就没了 —— 表现为「登录成功，重启后账号没了」。
         * 一次写入只有几 KB，同步写在这个桥线程上完全付得起。
         *
         * 两条都打点：真机上再说「账号丢了」，`adb logcat | grep QishuiSignHost`
         * 就能看出是**没写进来**还是**读出来是空的**，这是两种完全不同的故障。
         */
        @JavascriptInterface
        public String getStore(String key) {
            if (key == null || key.isEmpty()) return "";
            try {
                String value = prefs().getString(STORE_PREFIX + key, "");
                Log.i(TAG, "getStore " + key + " -> " + (value == null ? "null" : value.length() + " chars"));
                return value == null ? "" : value;
            } catch (Throwable error) {
                Log.w(TAG, "getStore failed", error);
                return "";
            }
        }

        @JavascriptInterface
        public void putStore(String key, String value) {
            if (key == null || key.isEmpty()) return;
            try {
                SharedPreferences.Editor editor = prefs().edit();
                if (value == null) editor.remove(STORE_PREFIX + key);
                else editor.putString(STORE_PREFIX + key, value);
                boolean written = editor.commit();
                Log.i(TAG, "putStore " + key + " -> " + (value == null ? "removed" : value.length() + " chars")
                        + ", committed=" + written);
            } catch (Throwable error) {
                Log.w(TAG, "putStore failed", error);
            }
        }

        @JavascriptInterface
        public String getCookie(String url) {
            // 拼装逻辑放在外层（QishuiSignHost.cookieHeaderFor）：shouldInterceptRequest
            // 那条同步出口也要用同一份并集，不能只在这里实现。
            return cookieHeaderFor(url);
        }


        /**
         * 页面内所有协议请求的真传输（folia-xhr.js 的假 XHR 走这里）。
         *
         * 为什么不让 XHR 真发出去再由 shouldInterceptRequest 代发：那个回调拿不到
         * POST body（登录轮询 check_qrconnect 是 POST），而且签名注入后的 URL 也
         * 只在页面里可见。OkHttp 直发没有 CORS、UA 与 cookie 完全可控。
         * 返回 false 表示宿主已不可用，页面会立刻以网络错误收场。
         */
        @JavascriptInterface
        public boolean http(String ticket, String payloadJson) {
            try {
                JSONObject payload = new JSONObject(payloadJson);
                String url = payload.optString("url", "");
                if (url.isEmpty()) {
                    pushHttpResult(ticket, null, "empty url");
                    return true;
                }
                Request.Builder builder = new Request.Builder().url(url);
                String method = payload.optString("method", "GET").toUpperCase(Locale.US);
                String body = payload.isNull("body") ? null : payload.optString("body", null);
                JSONObject headers = payload.optJSONObject("headers");
                String contentType = null;
                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String name = keys.next();
                        if (name == null) continue;
                        String value = headers.optString(name, "");
                        if ("content-type".equalsIgnoreCase(name)) {
                            contentType = value;
                            continue;
                        }
                        if ("host".equalsIgnoreCase(name) || "content-length".equalsIgnoreCase(name)) continue;
                        try {
                            builder.header(name, value);
                        } catch (IllegalArgumentException ignored) {
                            // 非法头名/头值由页面侧负责，这里跳过避免整条请求报废。
                        }
                    }
                }
                long timeoutMs = payload.optLong("timeoutMs", 0);
                if (timeoutMs <= 0) timeoutMs = payload.optLong("timeout", 20000);
                if (timeoutMs <= 0) timeoutMs = 20000;
                OkHttpClient client = http.newBuilder()
                        .callTimeout(timeoutMs + 2000, TimeUnit.MILLISECONDS)
                        .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                        .build();
                if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
                    byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
                    RequestBody requestBody = RequestBody.create(
                            bytes,
                            MediaType.parse(contentType != null ? contentType : "application/x-www-form-urlencoded"));
                    builder.method(method, requestBody);
                } else {
                    builder.method(method, null);
                }
                final String finalTicket = ticket;
                client.newCall(builder.build()).enqueue(new Callback() {
                    @Override
                    public void onFailure(Call call, IOException error) {
                        pushHttpResult(finalTicket, null, error.getMessage());
                    }

                    @Override
                    public void onResponse(Call call, Response response) throws IOException {
                        try (Response closable = response) {
                            int code = closable.code();
                            // 登录态是 passport 用 Set-Cookie 下发的：/passport/web/get_qrcode/
                            // 就已经开始给，check_qrconnect 拿到确认后再给一次 sessionid。
                            // 这条异步路径是假 XHR 的唯一出口（folia-xhr.js → http 桥），
                            // 少了这里的记录，宿主 cookie 罐永远是空的。
                            final String responseUrl = closable.request().url().toString();
                            for (String value : closable.headers("Set-Cookie")) {
                                try {
                                    CookieManager.getInstance().setCookie(responseUrl, value);
                                } catch (Throwable ignored) {
                                }
                                rememberCookie(value);
                            }
                            String text = closable.body() != null ? closable.body().string() : "";
                            JSONObject resultHeaders = new JSONObject();
                            for (String name : closable.headers().names()) {
                                // set-cookie 可能多值，逗号合并会破坏过期判断；只取第一个足够用。
                                resultHeaders.put(name.toLowerCase(Locale.US), closable.header(name, ""));
                            }
                            JSONObject envelope = new JSONObject();
                            envelope.put("status", code);
                            envelope.put("headers", resultHeaders);
                            envelope.put("body", text);
                            pushHttpResult(finalTicket, envelope, null);
                        } catch (Exception error) {
                            pushHttpResult(finalTicket, null, error.getMessage());
                        }
                    }
                });
                return true;
            } catch (Exception error) {
                Log.w(TAG, "http bridge failed", error);
                pushHttpResult(ticket, null, error.getMessage());
                return true;
            }
        }

        /** MFA 二次验证：页面要用户交互时，把隐藏 WebView 拉成全屏，结束再缩回去。 */
        @JavascriptInterface
        public void setMfaVisible(String visible) {
            mainHandler.post(() -> setWebViewExpanded("1".equals(visible)));
        }

        /**
         * 协议层 song.url 用：把带 #auth= 的加密直链改写成 loopback 解密代理地址。
         * JavascriptInterface 的返回值是同步的，协议层可以直接拿到；服务器未就绪时
         * 返回空串，页面侧回退为原样直链（与桌面「无本地代理」的降级一致）。
         */
        @JavascriptInterface
        public String audioProxyUrl(String cleanUrl, String auth) {
            return audioServer.buildProxyUrl(cleanUrl, auth);
        }
    }

    private void setWebViewExpanded(boolean expanded) {
        if (webView == null) return;
        try {
            ViewGroup.LayoutParams params = webView.getLayoutParams();
            if (expanded) {
                webView.setTranslationX(0f);
                webView.setAlpha(1f);
                webView.setBackgroundColor(Color.WHITE);
                params.width = ViewGroup.LayoutParams.MATCH_PARENT;
                params.height = ViewGroup.LayoutParams.MATCH_PARENT;
            } else {
                params.width = 1;
                params.height = 1;
                webView.setAlpha(0f);
                webView.setBackgroundColor(Color.TRANSPARENT);
                webView.setTranslationX(-10000f);
            }
            webView.setLayoutParams(params);
        } catch (Throwable error) {
            Log.w(TAG, "toggling mfa visibility failed", error);
        }
    }

    /**
     * 把一次 http 结果推回页面。响应可能超过 evaluateJavascript 的 IPC 上限
     * （歌单整包能到几百 KB），所以按块推：页面侧 __foliaHttpChunk 先攒齐再派发。
     */
    private void pushHttpResult(String ticket, JSONObject envelope, String error) {
        String payload;
        try {
            payload = error != null
                    ? new JSONObject().put("error", error == null ? "" : error).toString()
                    : envelope.toString();
        } catch (Exception jsonError) {
            payload = "{\"error\":\"result serialization failed\"}";
        }
        // JS 字符串字面量转义：只推 base64，绕开所有引号/换行问题。
        String encoded = Base64.encodeToString(payload.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        final int totalChunks = Math.max(1, (encoded.length() + HTTP_RESULT_CHUNK_CHARS - 1) / HTTP_RESULT_CHUNK_CHARS);
        mainHandler.post(() -> {
            if (webView == null) return;
            for (int index = 0; index < totalChunks; index++) {
                int start = index * HTTP_RESULT_CHUNK_CHARS;
                int end = Math.min(encoded.length(), start + HTTP_RESULT_CHUNK_CHARS);
                String script = "window.__foliaHttpChunk && window.__foliaHttpChunk("
                        + quote(ticket) + "," + totalChunks + "," + index + "," + quote(encoded.substring(start, end)) + ")";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    // ─── 请求拦截 ─────────────────────────────────────────────────────────

    private final class HostClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return null;
            String url = request.getUrl().toString();
            String host = request.getUrl().getHost() == null ? "" : request.getUrl().getHost().toLowerCase(Locale.US);
            String path = request.getUrl().getPath() == null ? "" : request.getUrl().getPath();

            // 1) 打包在 assets 里的页面与脚本：直接按文件路径喂回去。
            //    直接用 URL 前缀判断：Uri 没有 getProtocol()，只有 getScheme()。
            if (url.startsWith(PAGE_ORIGIN + PAGE_PATH_PREFIX)) {
                return serveAsset(path.substring(PAGE_PATH_PREFIX.length()));
            }
            // 2) sdk-glue 会动态加载官方 CDN 的 bdms.js；上游（Electron）用 session hook
            //    把这个 URL 重定向到本地固定版本，这里同样处理 —— 版本漂移会破坏指纹一致性。
            if (OFFICIAL_BDMS_URL.equals(url)) {
                return serveAsset("bdms.js");
            }
            // 3) 白名单主机的页面级资源（MFA 组件脚本与素材）：代发并补 CORS 头。
            //    协议请求本身不走这里 —— folia-xhr.js 的假 XHR 全部经原生桥直发。
            if (hostAllowed(host)) {
                return proxy(request, url);
            }
            // 4) 其余一律拦掉：这个 WebView 只用来签名，不该碰别的网络。
            return empty(404, "blocked");
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // 页面里没有导航，任何跳转都拦掉，免得把用户带到别处去。
            return true;
        }
    }

    private boolean hostAllowed(String host) {
        for (String suffix : ALLOWED_HOST_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }

    private WebResourceResponse serveAsset(String relative) {
        if (relative.contains("..")) return empty(404, "bad-path");
        try {
            InputStream stream = activity.getAssets().open(ASSET_DIR + relative);
            String mime = mimeFor(relative);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", PAGE_ORIGIN);
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
        } catch (IOException error) {
            return empty(404, "no-asset");
        }
    }

    private WebResourceResponse proxy(WebResourceRequest request, String url) {
        try {
            Request.Builder builder = new Request.Builder().url(url);
            Map<String, String> requestHeaders = request.getRequestHeaders();
            if (requestHeaders != null) {
                for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
                    String name = entry.getKey();
                    if (name == null) continue;
                    if ("cookie".equalsIgnoreCase(name) || "host".equalsIgnoreCase(name)
                            || "content-length".equalsIgnoreCase(name) || "origin".equalsIgnoreCase(name)) continue;
                    builder.header(name, entry.getValue() == null ? "" : entry.getValue());
                }
            }
            // 登录态：优先用宿主自己记的会话 cookie，其次才是 WebView cookie 罐里的。
            // 走 cookieHeaderFor 的并集（自攒的 jar + CookieManager），别只读后者 ——
            // 假 XHR 不走真实网络，CookieManager 里未必有 OkHttp 收到的那批。
            String cookie = sessionCookie != null && !sessionCookie.isEmpty()
                    ? sessionCookie
                    : cookieHeaderFor(url);
            if (cookie != null && !cookie.isEmpty()) builder.header("Cookie", cookie);

            String method = request.getMethod() == null ? "GET" : request.getMethod();
            if ("POST".equalsIgnoreCase(method) && request.getMethod() != null) {
                // 请求体拿不到（shouldInterceptRequest 不给），所以 POST 一律走空体，
                // 由协议层把参数拼进 URL —— 汽水的 web 接口本来就是 GET 为主。
                builder.post(RequestBody.create(null, new byte[0]));
            } else {
                builder.get();
            }

            Response response = http.newCall(builder.build()).execute();
            int code = response.code();
            String body = response.body() != null ? response.body().string() : "";
            Map<String, String> headers = new HashMap<>();
            // 页面是这个源，代发回来的响应必须显式放行，否则 XHR 读不到正文。
            headers.put("Access-Control-Allow-Origin", PAGE_ORIGIN);
            headers.put("Access-Control-Allow-Credentials", "true");
            headers.put("Access-Control-Expose-Headers", "Set-Cookie");
            List<String> setCookies = response.headers("Set-Cookie");
            for (String value : setCookies) {
                try {
                    CookieManager.getInstance().setCookie(url, value);
                } catch (Throwable ignored) {
                }
                rememberCookie(value);
                if (headers.containsKey("Set-Cookie")) {
                    headers.put("Set-Cookie", headers.get("Set-Cookie") + "," + value);
                } else {
                    headers.put("Set-Cookie", value);
                }
            }
            String contentType = response.header("Content-Type", "application/json; charset=utf-8");
            String mime = contentType.contains(";") ? contentType.substring(0, contentType.indexOf(';')) : contentType;
            InputStream stream = new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
            return new WebResourceResponse(mime, "UTF-8", code, "OK", headers, stream);
        } catch (IOException error) {
            return empty(502, "proxy-failed");
        } catch (Throwable error) {
            Log.w(TAG, "proxying " + url + " failed", error);
            return empty(500, "proxy-error");
        }
    }

    private static WebResourceResponse empty(int status, String reason) {
        InputStream stream = new ByteArrayInputStream(new byte[0]);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", PAGE_ORIGIN);
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, headers, stream);
    }

    private static String mimeFor(String relative) {
        if (relative.endsWith(".html")) return "text/html";
        if (relative.endsWith(".js")) return "application/javascript";
        if (relative.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static String quote(String value) {
        return "\"" + String.valueOf(value).replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** 与桌面端 qishuiApiBridge.cjs 的 { ok, data } / { ok, error } 信封一致。 */
    static String envelopeJson(boolean ok, String dataJson, String code, String message) {
        StringBuilder json = new StringBuilder();
        if (ok) {
            json.append("{\"ok\":true,\"data\":").append(dataJson == null ? "null" : dataJson).append("}");
        } else {
            json.append("{\"ok\":false,\"error\":{\"code\":").append(quote(code))
                    .append(",\"message\":").append(quote(message)).append("}}");
        }
        return json.toString();
    }

    /** 给 JS 侧解码用：原生只传 base64，避免转义问题。 */
    static String decodeBase64(String value) {
        try {
            return new String(Base64.decode(value, Base64.DEFAULT), StandardCharsets.UTF_8);
        } catch (Throwable error) {
            return "";
        }
    }
}
