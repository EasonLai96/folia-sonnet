package top.izuna.foliamajor.online;

import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import top.izuna.foliamajor.wallpaper.WallpaperLyricsState;

/**
 * 原生平台网关：WebView 冻结 / 已死时，播放延续需要的平台读取直接从这里出网。
 *
 * 为什么要它：应用的取流地址、歌词、红心状态原本全在 Web 层那套 JS 里
 * （nativeBridge/api/*.js），WebView 一冻结整条链就断 —— 原生兜底切歌只能用镜像里
 * 预取过的那几个地址（「连按五首就切不动」），歌词与封面没人拉（壁纸停在上一首），
 * 红心状态也没处问。这个类把**播放延续需要的那一小块**平台逻辑用 Java 复刻：
 *
 *  · 取流地址：网易 weapi /song/enhance/player/url（{@link WeapiCrypto} 现成），
 *    QQ musicu vkey.GetVkeyServer/CgiGetVkey（{@link QqLikeClient} 的 comm 三件套现成）。
 *  · 歌词：网易 /song/lyric/v1（lrc + tlyric，纯文本），QQ GetPlayLyricInfo
 *    （回的是普通 LRC，base64 皮，不需要 QRC 那套 3DES）。
 *
 * 范围刻意收窄：搜索、歌单、登录那些只有前台用得上的交互仍然归 Web 层 —— 前台
 * WebView 活着，没必要两套并存。等哪天前台也出问题再往这里搬。
 *
 * 登录态不另存：WebView 侧的 chrome.cookies 已经接在 CookieManager 上
 * （installCookieShim），直接读同一个罐子。酷狗的签名直连照 KuGouMusicApi
 * 复刻（会话从同一个罐里取）。汽水不走 HTTP：签名必须由签名宿主里那个真页面
 * 算，这里经 {@link top.izuna.foliamajor.QishuiGatewayBridge} 同步要一次 request。
 * 飞牛是纯 HTTP，但凭据（地址 / token / 中继）在 Web 层手里 —— 由它登录后经
 * FoliaNative.setGatewayCredentials 推进来，见 {@link #setFeiniuCredentials}。
 */
public final class MusicGateway {

    private static final String TAG = "MusicGateway";
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Safari/537.36";
    private static final String MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg?format=json";
    private static final String QQ_FALLBACK_SIP = "https://ws.stream.qqmusic.qq.com/";

    private MusicGateway() {
    }

    /** 平台歌词的两个纯文本：主 LRC 与翻译 LRC（都可能为空串）。 */
    public static final class Lyric {
        public final String mainLrc;
        public final String transLrc;

        Lyric(String mainLrc, String transLrc) {
            this.mainLrc = mainLrc == null ? "" : mainLrc;
            this.transLrc = transLrc == null ? "" : transLrc;
        }
    }

    /**
     * 向平台要这首歌的播放地址。拿不到（没登录、VIP 歌、平台拒绝）回 null，
     * 调用方保持原状 —— 通知栏的错误比假装切了歌诚实。
     *
     * @param providerId 平台（netease / qq / kugou）
     * @param songId     服务器侧数字 id（网易曲库 id；QQ 的数字 songId）
     * @param mid        QQ 的 songmid（CgiGetVkey 只认它；网易不用）
     * @param hash       酷狗的文件 hash（/v5/url 只认它；其它平台不用）
     * @param albumAudioId 酷狗的 album_audio_id（与 hash 一起送）
     */
    public static String resolvePlayUrl(String providerId, String songId, String mid,
                                        String hash, String albumAudioId) {
        try {
            if ("netease".equals(providerId)) {
                return neteasePlayUrl(songId);
            }
            if ("qq".equals(providerId)) {
                return qqPlayUrl(mid);
            }
            if ("kugou".equals(providerId)) {
                return kugouPlayUrl(hash, albumAudioId);
            }
            if ("qishui".equals(providerId)) {
                return qishuiPlayUrl(songId);
            }
            if ("feiniu".equals(providerId)) {
                return feiniuPlayUrl(songId);
            }
        } catch (Throwable error) {
            Log.w(TAG, "resolvePlayUrl failed (" + providerId + ")", error);
        }
        return null;
    }

    /** 向平台要歌词。拿不到回 null；文本拿到了但解不出时间轴由调用方兜底。 */
    public static Lyric fetchLyric(String providerId, String songId, String mid,
                                   String hash) {
        try {
            if ("netease".equals(providerId)) {
                return neteaseLyric(songId);
            }
            if ("qq".equals(providerId)) {
                return qqLyric(songId, mid);
            }
            if ("kugou".equals(providerId)) {
                return kugouLyric(hash);
            }
            if ("qishui".equals(providerId)) {
                return qishuiLyric(songId);
            }
            if ("feiniu".equals(providerId)) {
                return feiniuLyric(songId);
            }
        } catch (Throwable error) {
            Log.w(TAG, "fetchLyric failed (" + providerId + ")", error);
        }
        return null;
    }

    // ==================== 汽水（签名宿主直调） ====================

    /**
     * 汽水的取流地址要过签名宿主里那个隐藏 WebView 的协议层（bdms.js 签名这一步
     * 绕不开），所以这里只是把 request 同步化：拿到的就是协议层 song.url 的信封。
     *
     * 与 Web 层（qishuiProvider.getAudioSource）的一致性：trial（试听段）**不拒**
     * —— 兜底切歌的目标是「别停」，试听总比没得放强；Web 层拒它是因为它还要进
     * 缓存与时长统计，兜底这条路没有那些后续。加密直链（带 #auth=）换成本地
     * 解密代理地址；代理没起来时放弃（给 ExoPlayer 一条解不开的密文没有意义）。
     */
    private static String qishuiPlayUrl(String songId) {
        String id = songId == null ? "" : songId.trim();
        if (id.isEmpty()) {
            return null;
        }
        JSONObject envelope = qishuiRequest("song.url", qishuiParams("id", id, "quality", "standard"));
        if (envelope == null || !envelope.optBoolean("ok", false)) {
            return null;
        }
        JSONObject data = envelope.optJSONObject("data");
        String url = data == null ? "" : data.optString("url", "");
        if (url.isEmpty()) {
            return null;
        }
        int authAt = url.indexOf("#auth=");
        if (authAt < 0) {
            // 明文直链（车机协议）：ExoPlayer 直接吃。
            return url;
        }
        String cleanUrl = url.substring(0, authAt);
        String auth = url.substring(authAt + "#auth=".length());
        String proxied = top.izuna.foliamajor.QishuiGatewayBridge.audioProxyUrlFor(cleanUrl, auth);
        return proxied.isEmpty() ? null : proxied;
    }

    /** 汽水歌词：协议层回 {lyric, tlyric, yrc, ytlrc}，壁纸用整行 LRC 那两个。 */
    private static Lyric qishuiLyric(String songId) {
        String id = songId == null ? "" : songId.trim();
        if (id.isEmpty()) {
            return null;
        }
        JSONObject envelope = qishuiRequest("lyric", qishuiParams("id", id));
        if (envelope == null || !envelope.optBoolean("ok", false)) {
            return null;
        }
        JSONObject data = envelope.optJSONObject("data");
        if (data == null) {
            return null;
        }
        return new Lyric(data.optString("lyric", ""), data.optString("tlyric", ""));
    }

    /**
     * 参数拼成 JSON 字符串（签名宿主的 request 就是收字符串）。JSONObject.put 是
     * 受检异常，链式 new 在 try 外面编译不过 —— 统一在这里包掉：全是字符串对，
     * 理论上抛不出来。
     */
    private static String qishuiParams(String... pairs) {
        try {
            JSONObject params = new JSONObject();
            for (int i = 0; i + 1 < pairs.length; i += 2) {
                params.put(pairs[i], pairs[i + 1]);
            }
            return params.toString();
        } catch (Exception error) {
            return "{}";
        }
    }

    /** 同步过一次签名宿主（后台线程调）；拿不到信封回 null。 */
    private static JSONObject qishuiRequest(String operation, String paramsJson) {
        String envelope = top.izuna.foliamajor.QishuiGatewayBridge.requestSync(
                operation, paramsJson, 12_000L);
        if (envelope == null || envelope.isEmpty()) {
            return null;
        }
        try {
            return new JSONObject(envelope);
        } catch (Exception error) {
            Log.w(TAG, "qishui " + operation + " envelope is not JSON", error);
            return null;
        }
    }

    // ==================== 飞牛（凭据推送 + 纯 HTTP） ====================

    /** 飞牛的会话三件套：地址、token、中继模式 —— 由 Web 层登录后推过来。 */
    public static final class FeiniuCredentials {
        public final String serverUrl;
        public final String token;
        public final boolean relayMode;

        FeiniuCredentials(String serverUrl, String token, boolean relayMode) {
            this.serverUrl = serverUrl;
            this.token = token;
            this.relayMode = relayMode;
        }
    }

    private static volatile FeiniuCredentials feiniuCreds = null;

    /**
     * Web 层登录 / 登出 / 改地址 / 切中继时推送（FoliaNative.setGatewayCredentials）。
     * token 为空视为登出。凭据只进内存：进程活着就有效，死了说明 Web 层同样要重登。
     *
     * 地址先照 Web 层 withSchemeAndPort 补齐：没写 scheme 的按 http；http 又没写
     * 端口的补 5666（fnOS 网关就挂那儿）—— 不补的话拼出来的请求会打到 80 上，
     * 收到一个 HTML 页，表现跟「服务不存在」一模一样。
     */
    public static void setFeiniuCredentials(String serverUrl, String token, boolean relayMode) {
        String cleanUrl = serverUrl == null ? "" : serverUrl.trim().replaceFirst("/+$", "");
        String cleanToken = token == null ? "" : token.trim();
        if (cleanUrl.isEmpty() || cleanToken.isEmpty()) {
            feiniuCreds = null;
            return;
        }
        if (!cleanUrl.matches("(?i)^https?://.*")) {
            cleanUrl = "http://" + cleanUrl;
        }
        if (cleanUrl.regionMatches(true, 0, "http://", 0, 7)) {
            int slash = cleanUrl.indexOf('/', 7);
            String hostPart = slash < 0 ? cleanUrl.substring(7) : cleanUrl.substring(7, slash);
            if (!hostPart.contains(":")) {
                cleanUrl = slash < 0
                        ? cleanUrl + ":5666"
                        : cleanUrl.substring(0, slash) + ":5666" + cleanUrl.substring(slash);
            }
        }
        feiniuCreds = new FeiniuCredentials(cleanUrl, cleanToken, relayMode);
    }

    /** 飞牛资源请求的 Cookie：中继模式恒带 mode=relay（网关只认这个值）。 */
    private static String feiniuCookieValue(FeiniuCredentials creds) {
        return "music-token=" + creds.token + (creds.relayMode ? "; mode=relay" : "");
    }

    /**
     * 飞牛取流：地址是确定性的（guid 拼出来就是），不用网络往返 ——
     * 直接给直链。ExoPlayer 那一份 Cookie 由 {@link #headersForPlaybackUrl} 补。
     */
    private static String feiniuPlayUrl(String guid) {
        FeiniuCredentials creds = feiniuCreds;
        String id = guid == null ? "" : guid.trim();
        if (creds == null || id.isEmpty()) {
            return null;
        }
        return creds.serverUrl + "/music/api/v1/track/stream?guid=" + urlEncode(id);
    }

    /**
     * 飞牛歌词：/lyric/list 回 {list:[{guid,content}],preferred}，
     * 挑 preferred 那条，没有就第一条（照 Web 层 pickFeiniuLyricText）。
     */
    private static Lyric feiniuLyric(String guid) {
        FeiniuCredentials creds = feiniuCreds;
        String id = guid == null ? "" : guid.trim();
        if (creds == null || id.isEmpty()) {
            return null;
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(creds.serverUrl
                    + "/music/api/v1/lyric/list?trackGUID=" + urlEncode(id)).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("Cookie", feiniuCookieValue(creds));
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300 || text.isEmpty()) {
                return null;
            }
            JSONObject data = new JSONObject(text).optJSONObject("data");
            if (data == null) {
                return null;
            }
            JSONArray list = data.optJSONArray("list");
            if (list == null || list.length() == 0) {
                return null;
            }
            String preferred = data.optString("preferred", "");
            String content = "";
            for (int i = 0; i < list.length(); i++) {
                JSONObject entry = list.optJSONObject(i);
                if (entry == null) continue;
                String value = entry.optString("content", "");
                if (value.isEmpty()) continue;
                if (!preferred.isEmpty() && entry.optString("guid", "").equals(preferred)) {
                    return new Lyric(value, "");
                }
                if (content.isEmpty()) content = value;
            }
            return content.isEmpty() ? null : new Lyric(content, "");
        } catch (Exception error) {
            Log.w(TAG, "feiniu lyric failed", error);
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * 飞牛红心的原生兜底：POST favorite-track/create|delete，
     * body 是 {"trackGUID": guid}（照 Web 层 feiniuMutations.likeSong）。
     */
    public static boolean feiniuSetLiked(String guid, boolean liked) {
        FeiniuCredentials creds = feiniuCreds;
        String id = guid == null ? "" : guid.trim();
        if (creds == null || id.isEmpty()) {
            return false;
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(creds.serverUrl + "/music/api/v1/"
                    + (liked ? "favorite-track/create" : "favorite-track/delete")).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Cookie", feiniuCookieValue(creds));
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            byte[] body = ("{\"trackGUID\":\"" + id.replace("\"", "") + "\"}")
                    .getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception error) {
            Log.w(TAG, "feiniu like failed", error);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    // ==================== 网易「我喜欢」名单（切换后红心状态的真源） ====================

    private static volatile long neteaseUid = 0L;
    private static volatile java.util.Set<Long> neteaseLikedIds = null;
    private static volatile long neteaseLikedReadAtMs = 0L;
    /** 名单缓存多久。刚点过的心以 LikeOverrideStore 为准（服务端名单不保证马上刷新）。 */
    private static final long NETEASE_LIKED_TTL_MS = 10 * 60_000L;

    /** Web 层登录后把网易 uid 推过来（FoliaNative.setGatewayCredentials）；登出推空。 */
    public static void setNeteaseUid(String uid) {
        long parsed = parseSongId(uid);
        if (parsed <= 0) {
            neteaseUid = 0L;
            neteaseLikedIds = null;
            return;
        }
        if (parsed != neteaseUid) {
            // 换了账号：旧名单作废，下一问重新拉。
            neteaseLikedIds = null;
        }
        neteaseUid = parsed;
    }

    /**
     * 这首歌在不在网易「我喜欢」里；名单拿不到回 null（调用方保持原状）。
     *
     * 名单一发就是全部（一次请求、几万 id 也就几百 KB），10 分钟缓存 —— 每次切歌
     * 都拉一遍太重。叫用要在后台线程（里面是 weapi 网络）。
     */
    public static Boolean neteaseIsLiked(String songId) {
        if (neteaseUid <= 0) {
            return null;
        }
        long now = android.os.SystemClock.elapsedRealtime();
        java.util.Set<Long> cached = neteaseLikedIds;
        if (cached == null || now - neteaseLikedReadAtMs > NETEASE_LIKED_TTL_MS) {
            synchronized (MusicGateway.class) {
                cached = neteaseLikedIds;
                now = android.os.SystemClock.elapsedRealtime();
                if (cached == null || now - neteaseLikedReadAtMs > NETEASE_LIKED_TTL_MS) {
                    java.util.Set<Long> fresh = fetchNeteaseLikedList();
                    if (fresh != null) {
                        neteaseLikedIds = fresh;
                        neteaseLikedReadAtMs = now;
                        cached = fresh;
                    }
                    // 拉失败就继续用旧的（可能为 null）：null = 不知道，调用方不动那颗心。
                }
            }
        }
        if (cached == null) {
            return null;
        }
        long id = parseSongId(songId);
        return id > 0 ? cached.contains(id) : null;
    }

    private static java.util.Set<Long> fetchNeteaseLikedList() {
        try {
            String cookie = cookieFor("https://music.163.com/");
            JSONObject body = weapiPost("/api/song/like/get",
                    new JSONObject().put("uid", neteaseUid).put("csrf_token", csrfOf(cookie)), cookie);
            JSONArray ids = body.optJSONArray("ids");
            if (ids == null) {
                return null;
            }
            java.util.Set<Long> out = new java.util.HashSet<>();
            for (int i = 0; i < ids.length(); i++) {
                long value = ids.optLong(i, -1L);
                if (value > 0) {
                    out.add(value);
                }
            }
            Log.i(TAG, "netease liked list refreshed (" + out.size() + " songs)");
            return out;
        } catch (Exception error) {
            Log.w(TAG, "netease liked list fetch failed", error);
            return null;
        }
    }

    /**
     * 取流 / 缓存下载时要附带的请求头：目前只有飞牛要带会话 Cookie
     * （它的音频流认 music-token，不认就不给字节）。其余平台回空表。
     */
    public static Map<String, String> headersForPlaybackUrl(String url) {
        FeiniuCredentials creds = feiniuCreds;
        if (creds == null || url == null || !url.startsWith(creds.serverUrl)) {
            return Collections.emptyMap();
        }
        return Collections.singletonMap("Cookie", feiniuCookieValue(creds));
    }

    // ==================== 网易云（weapi 直连） ====================

    private static String neteasePlayUrl(String songId) throws Exception {
        long id = parseSongId(songId);
        if (id <= 0) {
            return null;
        }
        String cookie = cookieFor("https://music.163.com/");
        // v1 按音质档回地址；标准档免费账号必得。空了再试老接口（br 直报码率）。
        JSONObject data = new JSONObject()
                .put("ids", new JSONArray().put(id))
                .put("level", "standard")
                .put("encodeType", "flac")
                .put("csrf_token", csrfOf(cookie));
        String url = urlOfNeteaseSongUrl(weapiPost("/api/song/enhance/player/url/v1", data, cookie));
        if (url != null && !url.isEmpty()) {
            return url;
        }
        JSONObject legacy = new JSONObject()
                .put("ids", new JSONArray().put(id))
                .put("br", 128000)
                .put("csrf_token", csrfOf(cookie));
        return urlOfNeteaseSongUrl(weapiPost("/api/song/enhance/player/url", legacy, cookie));
    }

    private static String urlOfNeteaseSongUrl(JSONObject body) {
        JSONArray data = body == null ? null : body.optJSONArray("data");
        if (data != null && data.length() > 0) {
            JSONObject first = data.optJSONObject(0);
            if (first != null) {
                String url = first.optString("url", "");
                if (!url.isEmpty()) {
                    return url;
                }
            }
        }
        return null;
    }

    private static Lyric neteaseLyric(String songId) throws Exception {
        long id = parseSongId(songId);
        if (id <= 0) {
            return null;
        }
        String cookie = cookieFor("https://music.163.com/");
        JSONObject data = new JSONObject()
                .put("id", id)
                .put("cp", false)
                .put("tv", 0).put("lv", 0).put("rv", 0).put("kv", 0)
                .put("yv", 0).put("ytv", 0).put("yrv", 0)
                .put("csrf_token", csrfOf(cookie));
        JSONObject body = weapiPost("/api/song/lyric/v1", data, cookie);
        if (body == null) {
            return null;
        }
        return new Lyric(
                textOf(body.optJSONObject("lrc")),
                textOf(body.optJSONObject("tlyric")));
    }

    private static String textOf(JSONObject block) {
        return block == null ? "" : block.optString("lyric", "");
    }

    /** weapi 一发：表单里只有 params 与 encSecKey 两个 WangHome 加密产物。 */
    private static JSONObject weapiPost(String path, JSONObject data, String cookie) throws Exception {
        String[] encrypted = WeapiCrypto.encrypt(data.toString());
        StringBuilder form = new StringBuilder()
                .append("params=").append(urlEncode(encrypted[0]))
                .append("&encSecKey=").append(urlEncode(encrypted[1]));
        HttpURLConnection connection = (HttpURLConnection) new URL("https://music.163.com/weapi/"
                + path.replaceFirst("^/+", "").replaceFirst("^api/", "")).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Referer", "https://music.163.com/");
            if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }
            try (OutputStream out = connection.getOutputStream()) {
                out.write(form.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status + " @ " + path);
            }
            return new JSONObject(text);
        } finally {
            connection.disconnect();
        }
    }

    // ==================== QQ（musicu 直连） ====================

    private static String qqPlayUrl(String mid) throws Exception {
        if (mid == null || mid.isEmpty()) {
            return null;
        }
        String cookie = cookieFor("https://u.y.qq.com/");
        JSONObject comm = qqComm(cookie, 24);
        long uin = comm.optLong("uin", 0L);
        JSONArray mids = new JSONArray().put(mid);
        JSONObject param = new JSONObject()
                .put("guid", randomGuid())
                .put("songmid", mids)
                .put("songtype", new JSONArray().put(0))
                .put("uin", uin)
                .put("loginflag", 1)
                .put("platform", "20");
        JSONObject payload = new JSONObject()
                .put("comm", comm)
                .put("req_0", new JSONObject()
                        .put("module", "vkey.GetVkeyServer")
                        .put("method", "CgiGetVkey")
                        .put("param", param));
        JSONObject body = musicuPost(payload, cookie);
        JSONObject block = body == null ? null : body.optJSONObject("req_0");
        JSONObject data = block == null ? null : block.optJSONObject("data");
        JSONArray infos = data == null ? null : data.optJSONArray("midurlinfo");
        if (infos == null) {
            return null;
        }
        for (int i = 0; i < infos.length(); i++) {
            JSONObject info = infos.optJSONObject(i);
            String purl = info == null ? "" : info.optString("purl", "");
            if (!purl.isEmpty()) {
                String sip = QQ_FALLBACK_SIP;
                JSONArray sips = data.optJSONArray("sip");
                if (sips != null && sips.length() > 0 && !sips.optString(0, "").isEmpty()) {
                    sip = sips.optString(0);
                }
                return sip + purl;
            }
        }
        return null;
    }

    private static Lyric qqLyric(String songId, String mid) throws Exception {
        JSONObject param = new JSONObject();
        if (mid != null && !mid.isEmpty()) {
            param.put("songMID", mid);
        }
        long id = parseSongId(songId);
        if (id > 0) {
            param.put("songID", id);
        }
        if (param.length() == 0) {
            return null;
        }
        JSONObject payload = new JSONObject()
                .put("comm", new JSONObject().put("ct", 24).put("cv", 0))
                .put("lyric", new JSONObject()
                        .put("module", "music.musichallSong.PlayLyricInfo")
                        .put("method", "GetPlayLyricInfo")
                        .put("param", param));
        JSONObject body = musicuPost(payload, cookieFor("https://u.y.qq.com/"));
        JSONObject block = body == null ? null : body.optJSONObject("lyric");
        JSONObject data = block == null ? null : block.optJSONObject("data");
        if (data == null) {
            return null;
        }
        return new Lyric(decodeQQLyricText(data.optString("lyric", "")),
                decodeQQLyricText(data.optString("trans", "")));
    }

    /**
     * comm 照 buildQQAuthComm：没登录是匿名脸（ct 24），有会话换网页脸（ct 19）带
     * authst；微信通道要 tmeLoginType。照抄 {@link QqLikeClient} 的取法。
     */
    private static JSONObject qqComm(String cookie, int anonymousCt) throws Exception {
        Map<String, String> parsed = LikeFallback.parseCookie(cookie);
        String musicKey = LikeFallback.firstNonBlank(parsed, "qm_keyst", "qqmusic_key",
                "music_key", "p_skey", "skey", "psrf_qqaccess_token", "psrf_qqrefresh_token",
                "wxrefresh_token", "wxskey");
        JSONObject comm = new JSONObject()
                .put("uin", qqUinOf(parsed))
                .put("format", "json")
                .put("ct", musicKey.isEmpty() ? anonymousCt : 19)
                .put("cv", 0)
                .put("platform", "yqq.json");
        if (!musicKey.isEmpty()) {
            comm.put("authst", musicKey);
            String loginType = parsed.get("tmeLoginType");
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
        }
        return comm;
    }

    /** uin 取法照 qqCookieUin：微信通道（login_type=2）先 wxuin，QQ 通道先 uin。 */
    private static long qqUinOf(Map<String, String> cookie) {
        String loginType = cookie.get("login_type");
        String raw;
        if ("2".equals(loginType == null ? "" : loginType.trim())) {
            raw = LikeFallback.firstNonBlank(cookie, "wxuin", "uin", "p_uin");
        } else {
            raw = LikeFallback.firstNonBlank(cookie, "uin", "qqmusic_uin", "wxuin", "p_uin");
        }
        String digits = raw == null ? "" : raw.replaceAll("\\D", "");
        String stripped = digits.replaceFirst("^0+", "");
        try {
            return Long.parseLong(stripped.isEmpty() ? digits : stripped);
        } catch (NumberFormatException error) {
            return 0L;
        }
    }

    private static JSONObject musicuPost(JSONObject payload, String cookie) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MUSICU).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json;charset=UTF-8");
            connection.setRequestProperty("Referer", "https://y.qq.com/");
            connection.setRequestProperty("User-Agent", UA);
            if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }
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

    /**
     * QQ 歌词的皮：多数时候就是 base64 过一道，剥了就是普通 LRC。
     * 照 decodeQQLyricText：没有 '[' 且看着像 base64 才解，解完还得像歌词才认。
     */
    private static String decodeQQLyricText(String text) {
        String raw = text == null ? "" : text.trim();
        if (raw.isEmpty()) {
            return "";
        }
        if (!raw.contains("[") && raw.replaceAll("\\s+", "").matches("[A-Za-z0-9+/=]+")) {
            try {
                byte[] bytes = android.util.Base64.decode(raw.replaceAll("\\s+", ""), android.util.Base64.DEFAULT);
                String decoded = new String(bytes, StandardCharsets.UTF_8);
                if (decoded.contains("[") || decoded.matches(".*[\\u4e00-\\u9fa5].*")) {
                    raw = decoded;
                }
            } catch (IllegalArgumentException ignored) {
                // 不是 base64 就按原文用。
            }
        }
        return raw.replace("\r\n", "\n").trim();
    }

    // ==================== 酷狗（Android 网关签名直连） ====================

    private static final String KG_ANDROID_UA =
            "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";
    private static final String KG_SIGN_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
    private static final String KG_TRACKER_SECRET = "185672dd44712f60bb1736df5a377e82";
    private static final String KG_APPID = "3116";
    private static final String KG_CLIENTVER = "11440";
    private static final String KG_TRACKER_CLIENTVER = "11430";
    private static final String KG_SONG_PAGE_ID = "967177915";
    private static final String KG_SONG_PPID = "356753938,823673182,967485191";
    private static final String KG_SONG_PID = "411";
    private static volatile String kgMidCache = null;

    private static String kugouPlayUrl(String hash, String albumAudioId) throws Exception {
        String cleanHash = hash == null ? "" : hash.trim().toLowerCase();
        if (cleanHash.isEmpty()) {
            return null;
        }
        String cookie = cookieFor("https://www.kugou.com/");
        Map<String, String> parsed = LikeFallback.parseCookie(cookie);
        String userId = digitsOr(LikeFallback.firstNonBlank(parsed, "userid", "KugooID"), "0");
        String token = LikeFallback.firstNonBlank(parsed, "token", "t");
        // 没有会话（游客）时 /v5/url 不回地址：直接放弃，等 JS 那边的游客通道。
        if ("0".equals(userId) || token.isEmpty()) {
            return null;
        }
        String mid = kgMid();
        String dfid = LikeFallback.firstNonBlank(parsed, "dfid");
        if (dfid.isEmpty()) {
            dfid = "-";
        }
        long clienttime = System.currentTimeMillis() / 1000L;
        // 参数表照 KuGouMusicApi song_url：key 与 signature 的拼法一字不差。
        java.util.TreeMap<String, String> params = new java.util.TreeMap<>();
        params.put("album_id", "0");
        params.put("album_audio_id", digitsOr(albumAudioId, "0"));
        params.put("area_code", "1");
        params.put("behavior", "play");
        params.put("hash", cleanHash);
        params.put("cmd", "26");
        params.put("pid", KG_SONG_PID);
        params.put("pidversion", "3001");
        params.put("IsFreePart", "0");
        params.put("cdnBackup", "1");
        params.put("module", "");
        params.put("page_id", KG_SONG_PAGE_ID);
        params.put("ppage_id", KG_SONG_PPID);
        params.put("quality", "128");
        params.put("ssa_flag", "is_fromtrack");
        params.put("version", KG_TRACKER_CLIENTVER);
        params.put("clientver", KG_TRACKER_CLIENTVER);
        params.put("appid", KG_APPID);
        params.put("clienttime", String.valueOf(clienttime));
        params.put("dfid", dfid);
        params.put("mid", mid);
        params.put("uuid", "-");
        params.put("userid", userId);
        params.put("token", token);
        // key 兼容官方 signKey：md5(hash + secret + appid + mid + userid)。
        String trackerKey = md5(cleanHash + KG_TRACKER_SECRET + KG_APPID + mid + userId);
        StringBuilder paramsString = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            paramsString.append(entry.getKey()).append('=').append(entry.getValue());
        }
        String signature = md5(KG_SIGN_SALT + paramsString + trackerKey + KG_SIGN_SALT);
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            query.append(query.length() > 0 ? '&' : "")
                    .append(urlEncode(entry.getKey())).append('=').append(urlEncode(entry.getValue()));
        }
        query.append("&key=").append(urlEncode(trackerKey)).append("&signature=").append(urlEncode(signature));
        HttpURLConnection connection = (HttpURLConnection)
                new URL("https://gateway.kugou.com/v5/url?" + query).openConnection();
        try {
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("Cookie", kgLeanCookie(parsed, userId, token, dfid));
            connection.setRequestProperty("User-Agent", KG_ANDROID_UA);
            connection.setRequestProperty("dfid", dfid);
            connection.setRequestProperty("clienttime", String.valueOf(clienttime));
            connection.setRequestProperty("mid", mid);
            connection.setRequestProperty("kg-rc", "1");
            connection.setRequestProperty("kg-thash", "5d816a0");
            connection.setRequestProperty("kg-rec", "1");
            connection.setRequestProperty("kg-rf", "B9EDA08A64250DEFFBCADDEE00F8F25F");
            connection.setRequestProperty("x-router", "trackercdn.kugou.com");
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300) {
                return null;
            }
            return parseKgPlayUrl(new JSONObject(text));
        } finally {
            connection.disconnect();
        }
    }

    /** 照 parseKGPlayUrl：url / backupUrl / data.url 里挑第一个像 http 的。 */
    private static String parseKgPlayUrl(JSONObject body) {
        if (body == null) {
            return null;
        }
        String[] fields = {"url", "backupUrl", "backup_url"};
        for (String field : fields) {
            Object value = body.opt(field);
            String hit = firstHttpOf(value);
            if (hit != null) {
                return hit;
            }
        }
        JSONObject data = body.optJSONObject("data");
        if (data != null) {
            for (String field : fields) {
                String hit = firstHttpOf(data.opt(field));
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
    }

    private static String firstHttpOf(Object value) {
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) {
                String item = array.optString(i, "");
                if (item.startsWith("http://") || item.startsWith("https://")) {
                    return item;
                }
            }
            return null;
        }
        if (value instanceof String) {
            String text = ((String) value).trim();
            return text.startsWith("http://") || text.startsWith("https://") ? text : null;
        }
        return null;
    }

    /**
     * 酷狗歌词的简单通道：m.kugou.com/krc/&lt;hash&gt;.lrc 直出普通 LRC 文本，
     * 不用解 KRC（那套 XOR + zlib 只在逐字轴那条路才需要，壁纸时间轴用不上）。
     */
    private static Lyric kugouLyric(String hash) throws Exception {
        String cleanHash = hash == null ? "" : hash.trim();
        if (cleanHash.isEmpty()) {
            return null;
        }
        HttpURLConnection connection = (HttpURLConnection)
                new URL("https://m.kugou.com/krc/" + cleanHash + ".lrc").openConnection();
        try {
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("User-Agent", KG_ANDROID_UA);
            connection.setRequestProperty("Referer", "https://m.kugou.com/");
            int status = connection.getResponseCode();
            String text = LikeFallback.readAll(connection);
            if (status < 200 || status >= 300 || text.isEmpty()) {
                return null;
            }
            return new Lyric(text, "");
        } finally {
            connection.disconnect();
        }
    }

    /** 精简 cookie：KuGoo 大 Blob 会把网关请求顶爆，只带身份四件套。 */
    private static String kgLeanCookie(Map<String, String> parsed, String userId, String token, String dfid) {
        StringBuilder builder = new StringBuilder();
        if (!"0".equals(userId)) {
            builder.append("userid=").append(userId).append("; KugooID=").append(userId).append("; ");
        }
        if (!token.isEmpty()) {
            builder.append("token=").append(token).append("; t=").append(token).append("; ");
        }
        if (!dfid.isEmpty() && !"-".equals(dfid)) {
            builder.append("dfid=").append(dfid).append("; ");
        }
        return builder.toString();
    }

    /** mid：官方客户端是 32 位 md5 hex；进程内生成一次就钉住（设备身份的语义）。 */
    private static String kgMid() {
        if (kgMidCache == null) {
            synchronized (MusicGateway.class) {
                if (kgMidCache == null) {
                    kgMidCache = md5("mineradio_" + System.currentTimeMillis() + "_" + Math.random());
                }
            }
        }
        return kgMidCache;
    }

    private static String md5(String value) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("MD5");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte item : bytes) {
                builder.append(String.format("%02x", item));
            }
            return builder.toString();
        } catch (Exception error) {
            return "";
        }
    }

    private static String digitsOr(String value, String fallback) {
        String digits = value == null ? "" : value.replaceAll("\\D", "");
        return digits.isEmpty() ? fallback : digits;
    }

    // ==================== LRC → 时间轴 ====================

    /** `[mm:ss.xx]` / `[mm:ss]`；分带毫秒 1~3 位。 */
    private static final Pattern TIMESTAMP = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]");

    /**
     * 把主 LRC 与翻译 LRC 拼成壁纸的时间轴：每行 start 到下一行 start，翻译按
     * 时间戳对上就带上。解不出行（纯音乐、格式不认识）回空表，调用方保持原状。
     */
    public static List<WallpaperLyricsState.TimedLine> parseLrc(String mainLrc, String transLrc) {
        List<long[]> stamps = new ArrayList<>();
        List<String> texts = new ArrayList<>();
        collectLrcLines(mainLrc, stamps, texts);
        if (stamps.isEmpty()) {
            return Collections.emptyList();
        }
        Map<Long, String> translations = new LinkedHashMap<>();
        if (transLrc != null && !transLrc.isEmpty()) {
            List<long[]> transStamps = new ArrayList<>();
            List<String> transTexts = new ArrayList<>();
            collectLrcLines(transLrc, transStamps, transTexts);
            for (int i = 0; i < transStamps.size() && i < transTexts.size(); i++) {
                String value = transTexts.get(i).trim();
                if (!value.isEmpty()) {
                    translations.putIfAbsent(transStamps.get(i)[0], value);
                }
            }
        }
        // 同一毫秒的多段（LRC 偶见）：按时间排序后并进同一行，结束时间取下一行的起点。
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < stamps.size(); i++) {
            order.add(i);
        }
        Collections.sort(order, (a, b) -> Long.compare(stamps.get(a)[0], stamps.get(b)[0]));
        List<WallpaperLyricsState.TimedLine> lines = new ArrayList<>();
        int index = 0;
        while (index < order.size()) {
            long start = stamps.get(order.get(index))[0];
            StringBuilder merged = new StringBuilder();
            long end = start;
            String translation = translations.get(start);
            while (index < order.size() && stamps.get(order.get(index))[0] == start) {
                String text = texts.get(order.get(index)).trim();
                if (!text.isEmpty()) {
                    if (merged.length() > 0) {
                        merged.append(' ');
                    }
                    merged.append(text);
                }
                index += 1;
                // 这一段的结束时间先记下：它就是「下一行起点」的候选。
                end = index < order.size() ? stamps.get(order.get(index))[0] : start + 8000L;
            }
            String value = merged.toString().trim();
            if (!value.isEmpty()) {
                lines.add(new WallpaperLyricsState.TimedLine(value, start,
                        Math.max(end, start + 1L), translation));
            }
        }
        return lines;
    }

    private static void collectLrcLines(String lrc, List<long[]> stamps, List<String> texts) {
        if (lrc == null || lrc.isEmpty()) {
            return;
        }
        for (String rawLine : lrc.split("\n")) {
            String line = rawLine.replace("\r", "");
            // 行首连着的若干时间戳（同一句多次入场很常见），之后是这一段的文本。
            // 行首不是时间戳的（[ti:]、[offset:] 这些元数据）整行跳过。
            Matcher matcher = TIMESTAMP.matcher(line);
            List<Long> lineStamps = new ArrayList<>();
            int textStart = -1;
            int position = 0;
            while (position < line.length() && line.charAt(position) == '['
                    && matcher.region(position, line.length()).lookingAt()) {
                long ms = Long.parseLong(matcher.group(1)) * 60_000L
                        + Long.parseLong(matcher.group(2)) * 1000L;
                String fraction = matcher.group(3);
                if (fraction != null) {
                    double scale = Math.pow(10.0, 3 - fraction.length());
                    ms += (long) (Long.parseLong(fraction) * scale);
                }
                lineStamps.add(Math.max(0L, ms));
                position = matcher.end();
                textStart = position;
            }
            if (lineStamps.isEmpty()) {
                continue;
            }
            String text = textStart < line.length() ? line.substring(textStart).trim() : "";
            for (Long ms : lineStamps) {
                stamps.add(new long[]{ms});
                texts.add(text);
            }
        }
    }

    // ==================== 杂项 ====================

    private static String cookieFor(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (Throwable error) {
            Log.w(TAG, "CookieManager unavailable", error);
            return null;
        }
    }

    private static String csrfOf(String cookie) {
        String csrf = LikeFallback.firstNonBlank(LikeFallback.parseCookie(cookie), "__csrf");
        return csrf.isEmpty() ? "" : csrf;
    }

    private static long parseSongId(String songId) {
        try {
            long id = Long.parseLong((songId == null ? "" : songId.trim()));
            return id > 0 ? id : -1L;
        } catch (NumberFormatException error) {
            return -1L;
        }
    }

    private static String urlEncode(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (Exception error) {
            return "";
        }
    }

    /** CgiGetVkey 的 guid：十位数字串，官方网页端就是这个形状。 */
    private static String randomGuid() {
        StringBuilder builder = new StringBuilder();
        Random random = new Random();
        for (int i = 0; i < 10; i++) {
            builder.append(random.nextInt(10));
        }
        return builder.toString();
    }
}
