package top.izuna.foliamajor.player;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import top.izuna.foliamajor.wallpaper.WallpaperAudioTap;
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

    /**
     * 服务那边（通知栏 / 锁屏 / 耳机）要能直接碰到播放器，只能走静态引用 ——
     * 与 FoliaPlaybackPlugin 同一个路子：Activity 可能已经不在了，插件实例也可能换过。
     */
    private static volatile FoliaNativePlayerPlugin instance;

    private FoliaNativePlayer player;

    @Override
    public void load() {
        instance = this;
        // 播放器要在主线程上建（ExoPlayer 的线程约束），load() 已经在主线程。
        player = new FoliaNativePlayer(getContext(), new FoliaNativePlayer.Listener() {
            @Override
            public void onEvent(String type, long positionMs, long durationMs, String message) {
                JSObject payload = new JSObject();
                payload.put("type", type);
                payload.put("positionMs", (double) positionMs);
                payload.put("durationMs", (double) durationMs);
                if (message != null) {
                    payload.put("message", message);
                }
                notifyListeners(EVENT, payload);
                /*
                 * 桌面歌词（壁纸 / 悬浮小窗 / 锁屏）的时间轴锚点：由播放器自己给。
                 *
                 * 那边存的不是「当前行」，而是「整条时间轴 + 一个锚点」，段内按墙钟自己
                 * 往前推（WallpaperLyricsState.positionMs）。所以只要锚点是真的，JS 被
                 * 节流、被挂起都照走。而 Web 那条锚点来自 motion signal（rAF 写的），
                 * 页面一藏就被 Chromium 停掉 —— 锚点冻住，歌词停在原地。
                 *
                 * 只在这几种事件上写：暂停之后就没有 position 了，paused 带的是停住的位置。
                 */
                if ("position".equals(type) || "playing".equals(type)
                    || "paused".equals(type) || "ready".equals(type)) {
                    WallpaperLyricsState.setAnchor(positionMs, "playing".equals(type));
                }
            }

            /**
             * 频谱（P2）。20 帧/秒，每帧 128 段。
             *
             * 只在 Web 侧开着采集的时候才有 —— 后台画给谁看，那条路一藏就关掉了。
             */
            @Override
            public void onSpectrum(WallpaperAudioTap.Frame frame) {
                JSArray spectrum = new JSArray();
                if (frame.spectrum != null) {
                    for (int value : frame.spectrum) {
                        spectrum.put(value);
                    }
                }
                JSObject bands = new JSObject();
                bands.put("bass", frame.bass);
                bands.put("lowMid", frame.lowMid);
                bands.put("mid", frame.mid);
                bands.put("vocal", frame.vocal);
                bands.put("treble", frame.treble);
                bands.put("power", frame.power);
                JSObject payload = new JSObject();
                payload.put("type", "spectrum");
                payload.put("spectrum", spectrum);
                payload.put("bands", bands);
                notifyListeners(EVENT, payload);
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
        result.put("audioSessionId", current.getAudioSessionId());
        call.resolve(result);
    }

    /**
     * 频谱采集的开关（P2）。
     *
     * ⚠️ 必须能关：开着就是每秒 20 帧 × 128 段过桥，而页面藏起来之后既没人看，
     * 也没有意义。Web 侧按可见性开关，不需要它的时候一个字节都不推。
     */
    @PluginMethod
    public void setSpectrumEnabled(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current == null) {
            call.reject("The player is not ready.");
            return;
        }
        Boolean enabled = call.getBoolean("enabled");
        current.setSpectrumEnabled(Boolean.TRUE.equals(enabled));
        call.resolve();
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
