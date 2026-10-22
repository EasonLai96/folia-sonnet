package top.izuna.foliamajor.player;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

// 当前文件：Folia 在安卓上的原生播放内核（P1：最小闭环）。
//
// 只做「把这一个地址解码并出声」，不碰任何音效：均衡器、音效链、淡入淡出、automix
// 交叉淡化都还在 WebView 的 Web Audio 图里，原生接管的那一刻它们整体失效（
// createMediaElementSource 是单向不可逆的），那些留给后面的阶段。
//
// 时钟：WebView 侧不再有逐帧的 currentTime 可读，所以这里每 250ms 主动推一次位置，
// Web 侧再按本地墙钟插值补出平滑的进度（见 services/playbackEngine）。刻意不做
// 「Web 侧每秒问一次」——Capacitor 的桥只有一条，轮询会跟别的东西抢。
//
// ⚠️ 依赖：androidx.media3:media3-exoplayer（见 app/build.gradle）。
@UnstableApi
public final class FoliaNativePlayer {

    public interface Listener {
        /** type: ready | playing | paused | ended | position | buffering | error */
        void onEvent(String type, long positionMs, long durationMs, @Nullable String message);
    }

    private static final long POSITION_TICK_MS = 250L;

    /**
     * 伪装成浏览器的 UA。
     *
     * ExoPlayer 默认发的是 `AndroidXMedia3/...`，几个音源的 CDN 不认这种 UA，会被当成
     * 爬虫拒掉 —— 而同样的地址在 WebView 的 `<audio>` 里是能播的（那边的 UA 是浏览器）。
     * 这里对齐浏览器，是为了让「换成原生播放」不引入一批新的取流失败。
     */
    private static final String BROWSER_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Context context;
    private final Listener listener;

    @Nullable private ExoPlayer player;
    private boolean tickScheduled = false;
    private float requestedVolume = 1f;
    private float requestedSpeed = 1f;
    private int requestedRepeatMode = Player.REPEAT_MODE_OFF;

    private final Runnable positionTick = new Runnable() {
        @Override
        public void run() {
            ExoPlayer current = player;
            if (current == null) {
                tickScheduled = false;
                return;
            }
            emit("position", current.getCurrentPosition(), current.getDuration(), null);
            handler.postDelayed(this, POSITION_TICK_MS);
        }
    };

    public FoliaNativePlayer(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    /** 装上地址并缓冲。startPositionMs 小于 0 表示从头播。 */
    public void prepare(String url, long startPositionMs) {
        ExoPlayer current = ensurePlayer();
        current.setMediaItem(MediaItem.fromUri(url));
        current.setRepeatMode(requestedRepeatMode);
        current.setVolume(requestedVolume);
        current.setPlaybackParameters(new PlaybackParameters(requestedSpeed));
        current.prepare();
        if (startPositionMs > 0) {
            current.seekTo(startPositionMs);
        }
    }

    public void play() {
        ExoPlayer current = ensurePlayer();
        current.setPlayWhenReady(true);
    }

    public void pause() {
        ExoPlayer current = player;
        if (current == null) return;
        current.setPlayWhenReady(false);
        stopTicking();
        emit("paused", current.getCurrentPosition(), current.getDuration(), null);
    }

    /** 停下来并丢掉当前媒体（换歌之前的收尾，以及「没有歌了」）。 */
    public void stop() {
        ExoPlayer current = player;
        if (current == null) return;
        current.stop();
        current.setPlayWhenReady(false);
        current.clearMediaItems();
        stopTicking();
        emit("idle", 0L, 0L, null);
    }

    public void seek(long positionMs) {
        ExoPlayer current = player;
        if (current == null) return;
        long target = Math.max(0, positionMs);
        long duration = current.getDuration();
        // C.TIME_UNSET（负数）表示还不知道多长，这时候别去夹。
        if (duration > 0) {
            target = Math.min(target, duration);
        }
        current.seekTo(target);
        emit("position", target, duration, null);
    }

    public void setVolume(float volume) {
        requestedVolume = Math.max(0f, Math.min(1f, volume));
        ExoPlayer current = player;
        if (current != null) current.setVolume(requestedVolume);
    }

    public void setSpeed(float speed) {
        requestedSpeed = Math.max(0.1f, Math.min(4f, speed));
        ExoPlayer current = player;
        if (current != null) current.setPlaybackParameters(new PlaybackParameters(requestedSpeed));
    }

    public void setRepeatMode(int repeatMode) {
        requestedRepeatMode = repeatMode;
        ExoPlayer current = player;
        if (current != null) current.setRepeatMode(repeatMode);
    }

    public void release() {
        stopTicking();
        ExoPlayer current = player;
        player = null;
        if (current != null) {
            current.removeListener(playerListener);
            current.release();
        }
    }

    public long getPositionMs() {
        ExoPlayer current = player;
        return current == null ? 0L : Math.max(0L, current.getCurrentPosition());
    }

    public long getDurationMs() {
        ExoPlayer current = player;
        if (current == null) return 0L;
        long duration = current.getDuration();
        return duration <= 0 ? 0L : duration;
    }

    public boolean isPlaying() {
        ExoPlayer current = player;
        return current != null && current.isPlaying();
    }

    /** 给后面的频谱用（P2）：Visualizer 挂在这个 session 上，比全局混音的 session 0 准。 */
    public int getAudioSessionId() {
        ExoPlayer current = player;
        return current == null ? 0 : current.getAudioSessionId();
    }

    private ExoPlayer ensurePlayer() {
        ExoPlayer current = player;
        if (current != null) return current;

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent(BROWSER_USER_AGENT)
            .setAllowCrossProtocolRedirects(true);

        current = new ExoPlayer.Builder(context)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory))
            .build();
        // 焦点交给 ExoPlayer 自己管。WebView 那套「把 Chromium 的焦点监听器换成空实现」
        // 的反向 hack（audio/FoliaAudioManager）是为 `<audio>` 做的，原生产不出那种问题。
        current.setAudioAttributes(AudioAttributes.DEFAULT, true);
        current.setVolume(requestedVolume);
        current.addListener(playerListener);
        player = current;
        return current;
    }

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int playbackState) {
            ExoPlayer current = player;
            if (current == null) return;
            switch (playbackState) {
                case Player.STATE_READY:
                    emit("ready", current.getCurrentPosition(), current.getDuration(), null);
                    break;
                case Player.STATE_ENDED:
                    stopTicking();
                    emit("ended", current.getDuration(), current.getDuration(), null);
                    break;
                case Player.STATE_BUFFERING:
                    emit("buffering", current.getCurrentPosition(), current.getDuration(), null);
                    break;
                default:
                    break;
            }
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            ExoPlayer current = player;
            if (current == null) return;
            if (isPlaying) {
                startTicking();
                emit("playing", current.getCurrentPosition(), current.getDuration(), null);
            } else {
                stopTicking();
                emit("paused", current.getCurrentPosition(), current.getDuration(), null);
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            stopTicking();
            ExoPlayer current = player;
            long position = current == null ? 0L : current.getCurrentPosition();
            emit("error", position, 0L, error == null ? "unknown" : error.getMessage());
        }
    };

    private void startTicking() {
        if (tickScheduled) return;
        tickScheduled = true;
        handler.post(positionTick);
    }

    private void stopTicking() {
        tickScheduled = false;
        handler.removeCallbacks(positionTick);
    }

    private void emit(String type, long positionMs, long durationMs, @Nullable String message) {
        if (listener != null) {
            listener.onEvent(type, positionMs, durationMs, message);
        }
    }
}
