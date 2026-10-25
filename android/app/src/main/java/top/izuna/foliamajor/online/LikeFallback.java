package top.izuna.foliamajor.online;

import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * WebView 冻结时通知栏红心的原生兜底入口：按平台把「补写收藏」分发到各家的直连客户端。
 *
 * 登录态不另存一份：WebView 侧的 chrome.cookies 已经接在 Android CookieManager 上
 * （见 src/services/nativeAndroidBridge.ts 的 installCookieShim），这里直接读同一个罐子。
 * 支持的平台：netease、QQ（HTTP 直连）、汽水（签名宿主的协议层）、飞牛（凭据推送后的
 * 纯 HTTP）。kugou / bodian 的收藏要过签名与「我喜欢」歌单换发那套，太重，没有原生通道 ——
 * 返回 false 让调用方保持原状，等 JS 醒来再由 Web 层那套 omni.likeSong 处理。
 */
public final class LikeFallback {

    private static final String TAG = "LikeFallback";

    private LikeFallback() {
    }

    /**
     * @return 是否确认写成功。任何一步失败都返回 false：调用方不改状态，
     * 通知栏那颗心保持原样，比显示一个没生效的新状态诚实。
     */
    public static boolean setLiked(String providerId, String songId, boolean liked) {
        if (providerId == null || providerId.isEmpty() || songId == null || songId.isEmpty()) {
            return false;
        }
        try {
            switch (providerId) {
                case "netease":
                    return NeteaseLikeClient.setLiked(cookieFor("https://music.163.com/"),
                            songId, liked);
                case "qq":
                    // u.y.qq.com 的罐子会带上 .qq.com / .y.qq.com 域的全部会话 cookie，
                    // 与 JS 侧合并出来的 Cookie 头等价。
                    return QqLikeClient.setLiked(cookieFor("https://u.y.qq.com/"),
                            songId, liked);
                case "qishui":
                    // 与 App 内同一条协议层（like_song 这个名字是 fork 渲染层在用的，
                    // Android 协议页里有别名）。签名宿主没了（App 划掉）就写不成，返回 false。
                    return qishuiSetLiked(songId, liked);
                case "feiniu":
                    return MusicGateway.feiniuSetLiked(songId, liked);
                default:
                    return false;
            }
        } catch (Throwable error) {
            Log.w(TAG, "native like fallback failed", error);
            return false;
        }
    }

    /** 汽水红心：过签名宿主的协议层（like_song）。 */
    private static boolean qishuiSetLiked(String songId, boolean liked) {
        try {
            JSONObject params = new JSONObject();
            params.put("id", songId);
            params.put("liked", liked);
            String envelope = top.izuna.foliamajor.QishuiGatewayBridge.requestSync(
                    "like_song", params.toString(), 12_000L);
            if (envelope == null || envelope.isEmpty()) {
                return false;
            }
            return new JSONObject(envelope).optBoolean("ok", false);
        } catch (Throwable error) {
            Log.w(TAG, "qishui like fallback failed", error);
            return false;
        }
    }

    /**
     * 读 WebView 的 cookie 罐。CookieManager 的方法线程安全；第一次 getInstance()
     * 会初始化 WebView 的 cookie 层，App 进程里 WebView 一直在跑，没有时机问题。
     */
    private static String cookieFor(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (Throwable error) {
            Log.w(TAG, "CookieManager unavailable", error);
            return null;
        }
    }

    /** `a=1; b=2` → map。值里的 `=` 保留（MUSIC_U 结尾常带）。 */
    static Map<String, String> parseCookie(String header) {
        Map<String, String> out = new LinkedHashMap<>();
        if (header == null) {
            return out;
        }
        for (String part : header.split(";")) {
            int eq = part.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String name = part.substring(0, eq).trim();
            String value = part.substring(eq + 1).trim();
            if (!name.isEmpty() && !value.isEmpty()) {
                out.put(name, value);
            }
        }
        return out;
    }

    /** 依次取第一个非空值，全空回空串。 */
    static String firstNonBlank(Map<String, String> map, String... keys) {
        for (String key : keys) {
            String value = map.get(key);
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    /** 读完整响应体（gzip 由 HttpURLConnection 透明处理；出错回空串）。 */
    static String readAll(HttpURLConnection connection) {
        try {
            InputStream stream = connection.getResponseCode() >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
            if (stream == null) {
                return "";
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) > 0) {
                buffer.write(chunk, 0, read);
            }
            stream.close();
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable error) {
            Log.w(TAG, "failed to read the response", error);
            return "";
        }
    }
}
