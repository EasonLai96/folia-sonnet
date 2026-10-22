package top.izuna.foliamajor.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

    private FoliaNativePlayer player;

    @Override
    public void load() {
        // 播放器要在主线程上建（ExoPlayer 的线程约束），load() 已经在主线程。
        player = new FoliaNativePlayer(getContext(), (type, positionMs, durationMs, message) -> {
            JSObject payload = new JSObject();
            payload.put("type", type);
            payload.put("positionMs", (double) positionMs);
            payload.put("durationMs", (double) durationMs);
            if (message != null) {
                payload.put("message", message);
            }
            notifyListeners(EVENT, payload);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.handleOnDestroy();
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

    @PluginMethod
    public void release(PluginCall call) {
        FoliaNativePlayer current = player;
        if (current != null) {
            current.release();
        }
        call.resolve();
    }
}
