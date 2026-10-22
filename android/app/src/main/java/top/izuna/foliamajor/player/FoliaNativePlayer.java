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
// ⭐⭐ **线程：这是这个文件里最容易出事的一条。**
//
// Capacitor 的插件方法**不在主线程执行** —— Bridge 自己起了一条 `CapacitorPlugins`
// 的 HandlerThread（com/getcapacitor/Bridge.java：`taskHandler.post(currentThreadTask)`），
// 所有 @PluginMethod 都跑在那上面。而 ExoPlayer 绑定的是**创建时那个线程的 Looper**，
// 之后从别的线程碰它就抛 IllegalStateException（未捕获 = 进程直接死，界面上就是闪退）。
//
// 所以这里两件事都是硬性的：
//   1. 播放器显式建在主线程（`.setLooper(Looper.getMainLooper())`）；
//   2. 每一个入口都经 `runOnMain` 回到主线程 —— 包括建播放器、装地址、播停跳、音量。
// 顺带：位置上报那个 250ms 的定时器也挂在主线程，于是它和播放器是同一个线程。
//
// 绝不做「Web 侧每秒问一次位置」：Capacitor 的桥只有一条，轮询会跟别的东西抢。
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

    // 读的位置/时长走缓存：读可能发生在插件线程上，直接问播放器会跨线程。
    private volatile long cachedPositionMs = 0L;
    private volatile long cachedDurationMs = 0L;
    private volatile boolean cachedPlaying = false;
    private volatile int cachedAudioSessionId = 0;

    private final Runnable positionTick = new Runnable() {
        @Override
        public void run() {
            ExoPlayer current = player;
            if (current == null) {
                tickScheduled = false;
                return;
            }
            long position = current.getCurrentPosition();
            long duration = current.getDuration();
            cachedPositionMs = position;
            cachedDurationMs = duration > 0 ? duration : 0L;
            emit("position", position, cachedDurationMs, null);
            handler.postDelayed(this, POSITION_TICK_MS);
        }
    };

    public FoliaNativePlayer(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    /** 装上地址并缓冲。startPositionMs 小于 0 表示从头播。 */
    public void prepare(String url, long startPositionMs) {
        runOnMain(() -> {
            ExoPlayer current = ensurePlayer();
            current.setMediaItem(MediaItem.fromUri(url));
            current.setRepeatMode(requestedRepeatMode);
            current.setVolume(requestedVolume);
            current.setPlaybackParameters(new PlaybackParameters(requestedSpeed));
            current.prepare();
            if (startPositionMs > 0) {
                current.seekTo(startPositionMs);
            }
            cachedPositionMs = startPositionMs > 0 ? startPositionMs : 0L;
            cachedDurationMs = 0L;
        });
    }

    public void play() {
        runOnMain(() -> {
            ExoPlayer current = ensurePlayer();
            current.setPlayWhenReady(true);
            cachedPlaying = true;
        });
    }

    public void pause() {
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current == null) return;
            current.setPlayWhenReady(false);
            cachedPlaying = false;
            stopTicking();
            cachedPositionMs = current.getCurrentPosition();
            emit("paused", cachedPositionMs, cachedDurationMs, null);
        });
    }

    /** 停下来并丢掉当前媒体（换歌之前的收尾，以及「没有歌了」）。 */
    public void stop() {
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current == null) return;
            current.stop();
            current.setPlayWhenReady(false);
            current.clearMediaItems();
            cachedPlaying = false;
            cachedPositionMs = 0L;
            cachedDurationMs = 0L;
            stopTicking();
            emit("idle", 0L, 0L, null);
        });
    }

    public void seek(long positionMs) {
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current == null) return;
            long target = Math.max(0, positionMs);
            long duration = current.getDuration();
            // C.TIME_UNSET（负数）表示还不知道多长，这时候别去夹。
            if (duration > 0) {
                target = Math.min(target, duration);
            }
            current.seekTo(target);
            cachedPositionMs = target;
            emit("position", target, duration > 0 ? duration : 0L, null);
        });
    }

    public void setVolume(float volume) {
        float clamped = Math.max(0f, Math.min(1f, volume));
        requestedVolume = clamped;
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current != null) current.setVolume(requestedVolume);
        });
    }

    public void setSpeed(float speed) {
        float clamped = Math.max(0.1f, Math.min(4f, speed));
        requestedSpeed = clamped;
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current != null) current.setPlaybackParameters(new PlaybackParameters(requestedSpeed));
        });
    }

    public void setRepeatMode(int repeatMode) {
        requestedRepeatMode = repeatMode;
        runOnMain(() -> {
            ExoPlayer current = player;
            if (current != null) current.setRepeatMode(requestedRepeatMode);
        });
    }

    public void release() {
        runOnMain(() -> {
            stopTicking();
            ExoPlayer current = player;
            player = null;
            cachedPlaying = false;
            cachedAudioSessionId = 0;
            if (current != null) {
                current.removeListener(playerListener);
                current.release();
            }
        });
    }

    /** 缓存值：调用方可能在插件线程上，这里绝不去碰播放器。 */
    public long getPositionMs() {
        return Math.max(0L, cachedPositionMs);
    }

    public long getDurationMs() {
        return cachedDurationMs;
    }

    public boolean isPlaying() {
        return cachedPlaying;
    }

    /** 给后面的频谱用（P2）：Visualizer 挂在这个 session 上，比全局混音的 session 0 准。 */
    public int getAudioSessionId() {
        return cachedAudioSessionId;
    }

    /**
     * 所有碰到播放器的动作都回到主线程。
     *
     * 已经就在主线程时直接跑：`prepare` 之后紧接着的 `play` 不该被排到下一帧去
     * （那一帧的延迟会变成「点播放到出声」的手感）。
     */
    private void runOnMain(Runnable action) {
        if (Looper.myLooper() == handler.getLooper()) {
            try {
                action.run();
            } catch (Throwable error) {
                // 播放器这块出任何意外都不要带崩进程：报给 Web 层，让它按「播不出来」处理。
                emit("error", cachedPositionMs, cachedDurationMs, String.valueOf(error));
            }
            return;
        }
        handler.post(() -> {
            try {
                action.run();
            } catch (Throwable error) {
                emit("error", cachedPositionMs, cachedDurationMs, String.valueOf(error));
            }
        });
    }

    private ExoPlayer ensurePlayer() {
        ExoPlayer current = player;
        if (current != null) return current;

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent(BROWSER_USER_AGENT)
            .setAllowCrossProtocolRedirects(true);

        current = new ExoPlayer.Builder(context)
            // 显式钉在主线程。不写这一句，播放器会绑到「第一次碰它的那个线程」——
            // 也就是 Capacitor 的桥线程，而位置上报跑在主线程，于是每 250ms 跨线程一次。
            .setLooper(Looper.getMainLooper())
            .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory))
            .build();
        // 焦点交给 ExoPlayer 自己管。WebView 那套「把 Chromium 的焦点监听器换成空实现」
        // 的反向 hack（audio/FoliaAudioManager）是为 `<audio>` 做的，原生产不出那种问题。
        current.setAudioAttributes(AudioAttributes.DEFAULT, true);
        current.setVolume(requestedVolume);
        current.addListener(playerListener);
        cachedAudioSessionId = current.getAudioSessionId();
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
                    long duration = current.getDuration();
                    cachedDurationMs = duration > 0 ? duration : 0L;
                    cachedAudioSessionId = current.getAudioSessionId();
                    emit("ready", current.getCurrentPosition(), cachedDurationMs, null);
                    break;
                case Player.STATE_ENDED:
                    cachedPlaying = false;
                    stopTicking();
                    emit("ended", cachedDurationMs, cachedDurationMs, null);
                    break;
                case Player.STATE_BUFFERING:
                    emit("buffering", current.getCurrentPosition(), cachedDurationMs, null);
                    break;
                default:
                    break;
            }
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            ExoPlayer current = player;
            if (current == null) return;
            cachedPlaying = isPlaying;
            cachedPositionMs = current.getCurrentPosition();
            if (isPlaying) {
                cachedAudioSessionId = current.getAudioSessionId();
                startTicking();
                emit("playing", cachedPositionMs, cachedDurationMs, null);
            } else {
                stopTicking();
                emit("paused", cachedPositionMs, cachedDurationMs, null);
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            cachedPlaying = false;
            stopTicking();
            emit("error", cachedPositionMs, cachedDurationMs, error == null ? "unknown" : error.getMessage());
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
