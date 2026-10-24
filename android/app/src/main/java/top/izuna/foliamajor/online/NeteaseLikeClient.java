package top.izuna.foliamajor.online;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 网易云红心的原生写入：weapi 直连 music.163.com，WebView 冻结时通知栏红心的兜底。
 *
 * 端点与写后复查的顺序照抄 {@code src/nativeBridge/api/netease.js} 的 handleSongLike：
 * 先走收藏库那条 {@code /api/song/like}（{@code /api/radio/like} 是私人 FM 的路子，
 * 实测会被风控挡，code=-460），每写一次都用 {@code /api/song/like/check} 复查——
 * 上游无论有没有真的写进收藏库都回 code 200，不复查就是「提示成功但我喜欢的音乐里没有」。
 */
public final class NeteaseLikeClient {

    private static final String TAG = "NeteaseLikeClient";
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Safari/537.36";

    private NeteaseLikeClient() {
    }

    /**
     * @return 写入是否**确认**生效。写请求通了但复查不出来按失败算：宁可让 JS 醒来后再补，
     * 也不让通知栏停在一个没真正写进去的状态上。
     */
    public static boolean setLiked(String cookieHeader, String trackIdText, boolean liked) {
        if (cookieHeader == null || cookieHeader.isEmpty()) {
            return false;
        }
        // 未登录时写入会以匿名身份被服务端丢弃，先按登录事实拦一道。
        java.util.Map<String, String> cookie = LikeFallback.parseCookie(cookieHeader);
        if (!cookie.containsKey("MUSIC_U") && !cookie.containsKey("MUSIC_A")) {
            return false;
        }
        long trackId;
        try {
            trackId = Long.parseLong(trackIdText.trim());
        } catch (NumberFormatException error) {
            return false;
        }
        if (trackId <= 0) {
            return false;
        }

        String[][] attempts = {
                {"/weapi/song/like",
                        "{\"trackId\":" + trackId + ",\"like\":" + liked + "}"},
                {"/weapi/radio/like",
                        "{\"alg\":\"itembased\",\"trackId\":" + trackId
                                + ",\"like\":" + liked + ",\"time\":\"3\"}"},
        };
        for (String[] attempt : attempts) {
            try {
                JSONObject body = weapiPost("https://music.163.com" + attempt[0],
                        attempt[1], cookieHeader);
                if (body.optInt("code", 0) != 200) {
                    continue;
                }
                Boolean after = readLikedNow(cookieHeader, trackId);
                if (after != null && after == liked) {
                    return true;
                }
            } catch (Throwable error) {
                Log.w(TAG, "like write failed: " + attempt[0], error);
            }
        }
        return false;
    }

    /** 写后复查：data 里是 {trackId: bool}，老形状是 ids / songs 数组。认不出回 null。 */
    private static Boolean readLikedNow(String cookieHeader, long trackId) {
        try {
            JSONObject body = weapiPost("https://music.163.com/weapi/song/like/check",
                    "{\"trackIds\":\"[" + trackId + "]\"}", cookieHeader);
            JSONObject data = body.optJSONObject("data");
            if (data != null) {
                Object value = data.opt(String.valueOf(trackId));
                if (value instanceof Boolean) {
                    return (Boolean) value;
                }
            }
            JSONArray ids = body.optJSONArray("ids");
            if (ids == null && data != null) {
                ids = data.optJSONArray("ids");
            }
            if (ids != null) {
                for (int i = 0; i < ids.length(); i++) {
                    if (ids.optLong(i, -1) == trackId) {
                        return true;
                    }
                }
                return false;
            }
            JSONArray songs = body.optJSONArray("songs");
            if (songs == null && data != null) {
                songs = data.optJSONArray("songs");
            }
            if (songs != null) {
                for (int i = 0; i < songs.length(); i++) {
                    if (songs.optJSONObject(i) != null
                            && songs.optJSONObject(i).optLong("id", -1) == trackId) {
                        return true;
                    }
                }
                return false;
            }
        } catch (Throwable ignored) {
            // 复查失败按「无法确认」处理，调用方会换下一条写入路径再试。
        }
        return null;
    }

    /** weapi 请求：体里补 csrf_token，AES 双层加密后按表单发送。 */
    static JSONObject weapiPost(String url, String json, String cookieHeader) throws Exception {
        JSONObject data = new JSONObject(json);
        data.put("csrf_token", LikeFallback.parseCookie(cookieHeader)
                .getOrDefault("__csrf", ""));
        String[] encrypted = WeapiCrypto.encrypt(data.toString());
        String form = "params=" + URLEncoder.encode(encrypted[0], "UTF-8")
                + "&encSecKey=" + URLEncoder.encode(encrypted[1], "UTF-8");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Referer", "https://music.163.com/");
            connection.setRequestProperty("Cookie", cookieHeader);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(form.getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status + " @ " + url);
            }
            return new JSONObject(text);
        } finally {
            connection.disconnect();
        }
    }
}
