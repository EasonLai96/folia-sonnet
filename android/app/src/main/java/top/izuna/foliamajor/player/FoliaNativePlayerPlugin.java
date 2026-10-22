package top.izuna.foliamajor.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.os.Handler;
import android.os.Looper;

import top.izuna.foliamajor.wallpaper.WallpaperLyricsState;

/**
 * 原生播放内核的桥（P1）。
 *
 * Web 侧只在 `settings.nativePlayback` 打开、且这个插件真的在（Capacitor.isPluginAvailable）
 * 时才走原生；否则一切都还是 WebView 的 `<audio>`。也就是说这一层默认完全不参与播放。
 *
 * 位置是**推**的，不是**拉**的：播放器每 250ms 主动发一次 `foliaNativePlayer` 事件，
 * Web 侧按本地墙钟插值。别改成 Web 侧定时调 getSnapshot —— Capacitor 的桥只有一条，
 * 轮询会跟批量拉取那些操作抢同一条通道。
 *
 * 事件名与 `src/services/playbackEngine/nativePlayerPlugin.ts` 一一对应，改一处两处都要改。
 */
@CapacitorPlugin(name = "FoliaNativePlayer")
public class FoliaNativePlayerPlugin extends Plugin {

    private static final String EVENT = "foliaNativePlayer";

    /** 过桥回到主线程用（播放器那条线程不能直接碰监听器表）。 */
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    /**
     * 服务那边（通知栏 / 锁屏 / 耳机）要能直接碰到播放器，只能走静态引用 ——
     * 与 FoliaPlaybackPlugin 同一个路子：Activity 可能已经不在了，插件实例也可能换过。
     */
    private static volatile FoliaNativePlayerPlugin instance;

    private FoliaNativePlayer player;

    @Override
    public void load() {
        instance = this;
        // load() 在主线程上跑，但播放器自己会起一条专用线程（见 FoliaNativePlayer
        // 文件头的「线程」那一节）—— 这里只是把壳子建出来。
        player = new FoliaNativePlayer(getContext(), new FoliaNativePlayer.Listener() {
            @Override
            public void onEvent(String type, long positionMs, long durationMs, String message) {
                /*
                 * ⚠️ 这一下是**播放器线程**上跑的（播放循环在那条专用线程上，见
                 * FoliaNativePlayer 文件头的「线程」那一节），不在主线程。
                 */
                JSObject payload = new JSObject();
                payload.put("type", type);
                payload.put("positionMs", (double) positionMs);
                payload.put("durationMs", (double) durationMs);
                if (message != null) {
                    payload.put("message", message);
                }
                /*
                 * 桌面歌词（壁纸 / 悬浮小窗 / 锁屏）的时间轴锚点：由播放器自己给，
                 * **就在这里写**，不再绕一次主线程 —— 锚点记的是「收到这个位置的那一刻」，
                 * 晚一点写（哪怕只是排到下一轮主线程消息）都会让外推偏慢一截。
                 * `WallpaperLyricsState` 那几个字段是 volatile 的，跨线程写没问题。
                 */
                if ("position".equals(type) || "playing".equals(type)
                    || "paused".equals(type) || "ready".equals(type)) {
                    WallpaperLyricsState.setAnchor(positionMs, !"paused".equals(type));
                }
                /*
                 * 过桥那一下回主线程：`notifyListeners` 里的监听器表不是为并发写的
                 * （`Plugin.eventListeners` 是个普通 HashMap，加 / 删监听器在 JS 那一侧）。
                 * 一次 post 而已 —— 位置本来就只有 250ms 一次。
                 */
                MAIN.post(() -> notifyListeners(EVENT, payload));
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        instance = null;
        super.handleOnDestroy();
    }

    /**
     * 通知栏 / 锁屏按了「播放」之后，服务直接把这一下交给原生播放器。
     *
     * 不能只靠「广播 → 插件 → JS」那条老路：挂了很久之后，WebView 那侧的 JS 会被
     * 节流甚至整个挂起，`resumePlayback` 压根跑不起来 —— 表现就是
     * 「通知中心点了播放，一点反应都没有」。原生这一路不受那条限制。
     *
     * 只有在**确实是用原生在播**时才动手（手上有一首歌），否则交给 Web 那边照旧。
     * JS 那条命令照样会发：它负责界面与歌词，两边各管一半，不冲突。
     */
    public static void resumeFromSystem() {
        FoliaNativePlayerPlugin current = instance;
        if (current == null || current.player == null || !current.player.hasMedia()) return;
        current.player.play();
    }

    /** 同上，方向相反。 */
    public static void pauseFromSystem() {
        FoliaNativePlayerPlugin current = instance;
        if (current == null || current.player == null || !current.player.hasMedia()) return;
        current.player.pause();
    }

    /**
     * 原生手上有没有正在放的一首。
     *
     * 壁纸那边靠它决定「位置该由谁给」：原生在放的时候，Web 推下来的那个位置是插值出来的，
     * 与播放器自己报的采样值交替写入，时间轴会被拽得来回抖 —— 所以那时 Web 那份要让位。
     */
    public static boolean hasActiveMedia() {
        FoliaNativePlayerPlugin current = instance;
        return current != null && current.player != null && current.player.hasMedia();
    }

    /**
     * 原生播放器**此刻是不是在播**。
     *
     * 和 `hasActiveMedia()` 是两件事：手上有一首不等于在播（暂停之后 `lastUrl` 还在）。
     * 谁该给壁纸喂锚点，问的是这一个 —— 暂停之后原生就不再报位置了，那段时间必须
     * 交回 Web，否则锚点谁都不写，叠层按「暂停」把自己收起来（设置里那条
     * 「暂停时自动隐藏」），看上去就是「桌面歌词不见了」。
     */
    public static boolean isNativePlaying() {
        FoliaNativePlayerPlugin current = instance;
        return current != null && current.player != null && current.player.isPlaying();
    }

    /**
     * 原生播放器此刻的位置（毫秒）；没有播放器时给 -1。
     *
     * 通知栏 / 锁屏那条进度条用它：原生在放的时候位置只有播放器知道，而 Web 那一推
     * 要过 Chromium 的定时器节流 —— 挂久了就是「进度条不动」「一直是 00」。
     */
    public static long currentPositionMs() {
        FoliaNativePlayerPlugin current = instance;
        return current != null && current.player != null ? current.player.getPositionMs() : -1L;
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        FoliaNativePlayer current = player;
        String url = call.getString("url");
        if (current == null || url == null || url.isEmpty()) {
            call.reject("A url is required.");
            return;
        }
        Double startPositionMs = call.getDouble("startPositionMs");
        Integer repeatMode = call.getInt("repeatMode");
        if (repeatMode != null) {
            current.setRepeatMode(repeatMode);
        }
        current.prepare(url, startPositionMs == null ? -1L : startPositionMs.longValue());
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void play(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current == null) {
            call.reject("The player is not ready.");
            return;
        }
        current.play();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current == null) {
            call.reject("The player is not ready.");
            return;
        }
        current.pause();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current == null) {
            call.reject("The player is not ready.");
            return;
        }
        current.stop();
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        FoliaNativePlayer current = player;
        Double positionMs = call.getDouble("positionMs");
        if (current == null || positionMs == null) {
            call.reject("positionMs is required.");
            return;
        }
        current.seek(positionMs.longValue());
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        FoliaNativePlayer current = player;
        Float volume = call.getFloat("volume");
        if (current == null || volume == null) {
            call.reject("volume is required.");
            return;
        }
        current.setVolume(volume);
        call.resolve();
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        FoliaNativePlayer current = player;
        Float speed = call.getFloat("speed");
        if (current == null || speed == null) {
            call.reject("speed is required.");
            return;
        }
        current.setSpeed(speed);
        call.resolve();
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current == null) {
            call.reject("The player is not ready.");
            return;
        }
        JSObject result = new JSObject();
        result.put("positionMs", (double) current.getPositionMs());
        result.put("durationMs", (double) current.getDurationMs());
        result.put("playing", current.isPlaying());
        call.resolve(result);
    }

    @PluginMethod
    public void release(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current != null) {
            current.release();
        }
        call.resolve();
    }
}
