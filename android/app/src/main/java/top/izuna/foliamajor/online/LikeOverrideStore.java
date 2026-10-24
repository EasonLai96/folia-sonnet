package top.izuna.foliamajor.online;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * 原生补写红心的记录（songKey → 写入结果），落盘。
 *
 * WebView 冻结期间通知栏那颗心原生直报服务器成功之后，JS 手上的账号缓存还是旧的；
 * 它一醒来就会把「旧状态」推回来，通知栏那颗心跟着被翻回去 —— 用户看到的就是
 * 「一打开 app 全部恢复原样」。这张表就是判据：JS 推来的值与记录一致 = 它已经从
 * 服务器读回了真状态，记录解除；不一致 = 它手上是旧缓存，以原生写入为准。
 *
 * App 启动时 JS 也会通过 FoliaPlayback.consumeLikeOverrides 把记录取走、对齐自己的
 * 账号缓存（见 omni.applyNativeLikeOverrides），这样 App 里的心与通知栏一起对上。
 */
public final class LikeOverrideStore {

    private static final String PREFS = "folia_like_overrides";
    private static final String KEY_OVERRIDES = "overrides";
    /** 上限条数：丢最老的，别让长播放把这张表养大。 */
    private static final int MAX_ENTRIES = 32;

    private LikeOverrideStore() {
    }

    /** 全部记录（songKey → {liked, providerId, serverSongId, at}）。没有就是空对象。 */
    public static JSONObject read(Context context) {
        if (context == null) {
            return new JSONObject();
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            return new JSONObject(prefs.getString(KEY_OVERRIDES, "{}"));
        } catch (JSONException error) {
            return new JSONObject();
        }
    }

    public static void save(Context context, JSONObject overrides) {
        if (context == null) {
            return;
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_OVERRIDES, overrides.toString())
                .apply();
    }

    /** 原生补写成功后记账。songKey 为空（拿不到身份）就不记。 */
    public static void record(Context context, String songKey, String providerId,
                              String serverSongId, boolean liked) {
        if (context == null || songKey == null || songKey.isEmpty()) {
            return;
        }
        try {
            JSONObject overrides = read(context);
            JSONObject entry = new JSONObject();
            entry.put("liked", liked);
            entry.put("providerId", providerId == null ? "" : providerId);
            entry.put("serverSongId", serverSongId == null ? "" : serverSongId);
            entry.put("at", System.currentTimeMillis());
            overrides.put(songKey, entry);
            while (overrides.length() > MAX_ENTRIES) {
                String oldest = null;
                long oldestAt = Long.MAX_VALUE;
                java.util.Iterator<String> keys = overrides.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    long at = overrides.optJSONObject(key) == null
                            ? 0L : overrides.optJSONObject(key).optLong("at", 0L);
                    if (at < oldestAt) {
                        oldestAt = at;
                        oldest = key;
                    }
                }
                if (oldest == null) {
                    break;
                }
                overrides.remove(oldest);
            }
            save(context, overrides);
        } catch (JSONException ignored) {
            // 记不上账就没有守卫：最坏回到「JS 旧状态翻回去」的现状。
        }
    }

    /** 取走全部记录并清空（App 启动时 JS 的认领入口）。 */
    public static JSONObject consume(Context context) {
        JSONObject overrides = read(context);
        if (context != null && overrides.length() > 0) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .remove(KEY_OVERRIDES)
                    .apply();
        }
        return overrides;
    }
}
