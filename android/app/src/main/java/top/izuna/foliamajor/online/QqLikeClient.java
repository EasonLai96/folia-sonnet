package top.izuna.foliamajor.online;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * QQ 音乐红心的原生写入：musicu.fcg 直连 u.y.qq.com，WebView 冻结时通知栏红心的兜底。
 *
 * 写入顺序照抄 {@code src/nativeBridge/api/qq.js} 的 handleQQSongLike：
 * PlaylistDetailWrite（Add/DelSonglist，dirId 201 = 「我喜欢」）→ SongFavWrite（Add/DelSong），
 * songType 先 0 再 13；comm 与回包判定照 buildQQAuthComm / qqLikeWriteResult。
 * 回包判定的意义与网易云复查一样：上游不保证回 0 就真的写进去了，逐条核对才敢换心。
 */
public final class QqLikeClient {

    private static final String TAG = "QqLikeClient";
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Safari/537.36";
    private static final String MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg?format=json";

    private QqLikeClient() {
    }

    public static boolean setLiked(String cookieHeader, String songIdText, boolean liked) {
        if (cookieHeader == null || cookieHeader.isEmpty()) {
            return false;
        }
        long songId;
        try {
            songId = Long.parseLong(songIdText.trim());
        } catch (NumberFormatException error) {
            return false;
        }
        if (songId <= 0) {
            return false;
        }
        Map<String, String> cookie = LikeFallback.parseCookie(cookieHeader);
        String uin = qqUin(cookie);
        // 没有账号身份（游客）写不了收藏：写了也白写。
        if (uin.isEmpty()) {
            return false;
        }
        String musicKey = LikeFallback.firstNonBlank(cookie, "qm_keyst", "qqmusic_key",
                "music_key", "p_skey", "skey", "psrf_qqaccess_token", "psrf_qqrefresh_token",
                "wxrefresh_token", "wxskey");
        if (musicKey.isEmpty()) {
            return false;
        }

        try {
            JSONObject comm = new JSONObject()
                    .put("uin", Long.parseLong(uin))
                    .put("format", "json")
                    .put("ct", 19)
                    .put("cv", 0)
                    .put("platform", "yqq.json")
                    .put("authst", musicKey);
            // 微信扫码通道的凭据必须带自己的 tmeLoginType，否则上游按 QQ 通道解析拿不到数据。
            String loginType = cookie.get("tmeLoginType");
            if (loginType != null) {
                try {
                    int type = Integer.parseInt(loginType.trim());
                    if (type > 0) {
                        comm.put("tmeLoginType", type);
                    }
                } catch (NumberFormatException ignored) {
                    // 非数字就当没有。
                }
            }

            String[][] attempts = {
                    {"music.musicasset.PlaylistDetailWrite", liked ? "AddSonglist" : "DelSonglist", "0"},
                    {"music.musicasset.PlaylistDetailWrite", liked ? "AddSonglist" : "DelSonglist", "13"},
                    {"music.musicasset.SongFavWrite", liked ? "AddSong" : "DelSong", "0"},
                    {"music.musicasset.SongFavWrite", liked ? "AddSong" : "DelSong", "13"},
            };
            for (String[] attempt : attempts) {
                JSONObject param;
                if ("music.musicasset.PlaylistDetailWrite".equals(attempt[0])) {
                    param = new JSONObject()
                            .put("dirId", 201)
                            .put("v_songInfo", new JSONArray().put(new JSONObject()
                                    .put("songId", songId)
                                    .put("songType", Integer.parseInt(attempt[2]))));
                } else {
                    param = new JSONObject()
                            .put("uin", Long.parseLong(uin))
                            .put("v_uin", Long.parseLong(uin))
                            .put("dirId", 201)
                            .put("ids", new JSONArray().put(songId))
                            .put("songTypes", new JSONArray().put(Integer.parseInt(attempt[2])));
                }
                JSONObject payload = new JSONObject()
                        .put("comm", comm)
                        .put("req_0", new JSONObject()
                                .put("module", attempt[0])
                                .put("method", attempt[1])
                                .put("param", param));
                JSONObject body = post(payload, cookieHeader);
                JSONObject block = body.optJSONObject("req_0");
                if (writeConfirmed(block, body)) {
                    return true;
                }
                JSONObject data = block == null ? null : block.optJSONObject("data");
                int code = responseCode(block, data, body);
                if (code == 1000) {
                    // 未登录：后面的尝试也一样，直接停。
                    return false;
                }
            }
            return false;
        } catch (Throwable error) {
            Log.w(TAG, "QQ like fallback failed", error);
            return false;
        }
    }

    /** 回包判定，照 qqLikeWriteResult：code 与业务码都对上、没有失败歌单才算写成功。 */
    private static boolean writeConfirmed(JSONObject block, JSONObject root) {
        if (block == null) {
            return false;
        }
        JSONObject data = block.optJSONObject("data");
        int code = responseCode(block, data, root);
        if (code != 0 && code != 200) {
            return false;
        }
        if (data == null) {
            // 上游有时只回 code：code 对上就认。
            return true;
        }
        Object result = data.opt("result");
        if (result instanceof Number) {
            int value = ((Number) result).intValue();
            if (value != 0 && value != 200) {
                return false;
            }
        }
        int business = 0;
        if (data.has("ret")) {
            business = data.optInt("ret", 0);
        } else if (data.has("resultCode")) {
            business = data.optInt("resultCode", 0);
        } else if (data.has("errCode")) {
            business = data.optInt("errCode", 0);
        }
        if (business != 0 && business != 200 && !(result instanceof JSONObject)) {
            return false;
        }
        for (String key : new String[]{"v_failedSongId", "v_failSongId", "vFailedSongId",
                "failedSongIds"}) {
            Object failed = data.opt(key);
            if (failed instanceof JSONArray && ((JSONArray) failed).length() > 0) {
                return false;
            }
        }
        return true;
    }

    private static int responseCode(JSONObject block, JSONObject data, JSONObject root) {
        if (block != null && block.has("code")) {
            return block.optInt("code", 0);
        }
        if (data != null && data.has("code")) {
            return data.optInt("code", 0);
        }
        return root == null ? 0 : root.optInt("code", 0);
    }

    /** uin 取法照 qqCookieUin：微信通道（login_type=2）先 wxuin，QQ 通道先 uin。 */
    private static String qqUin(Map<String, String> cookie) {
        String loginType = cookie.get("login_type");
        String raw;
        if ("2".equals(loginType == null ? "" : loginType.trim())) {
            raw = LikeFallback.firstNonBlank(cookie, "wxuin", "uin", "p_uin");
        } else {
            raw = LikeFallback.firstNonBlank(cookie, "uin", "qqmusic_uin", "wxuin", "p_uin");
        }
        String digits = raw == null ? "" : raw.replaceAll("\\D", "");
        String stripped = digits.replaceFirst("^0+", "");
        return stripped.isEmpty() ? digits : stripped;
    }

    private static JSONObject post(JSONObject payload, String cookieHeader) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MUSICU).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json;charset=UTF-8");
            connection.setRequestProperty("Referer", "https://y.qq.com/");
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Cookie", cookieHeader);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status + " @ musicu.fcg");
            }
            return new JSONObject(text);
        } finally {
            connection.disconnect();
        }
    }
}
