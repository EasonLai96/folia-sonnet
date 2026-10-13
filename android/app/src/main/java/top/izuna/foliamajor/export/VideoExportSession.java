package top.izuna.foliamajor.export;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.view.Surface;

import java.io.FileDescriptor;
import java.nio.ByteBuffer;

/**
 * 一整次「把歌词动画渲染成视频」的会话。
 *
 * 为什么必须自己写这一层：导出能力原来只存在于 Electron 那一侧
 * （`electron/modSystem/exportService.cjs` + ffmpeg），安卓上 `src/mods/ipc.ts`
 * 拿不到 bridge、`reloadMods()` 直接返回空数组 —— 于是「渲染导出」这个模组在手机上
 * 连列表里都看不见。这段就是那条能力在安卓上的替身，并且不经过模组：
 * 它听控制面板那一页的话，不依赖任何模组加载。
 *
 * 三段拼起来：
 *
 *  1. **取帧**：`FrameSource`（实际是 `ExportRenderView`）把离屏渲染页推到第 N 帧的
 *     时间，等它画完，把画面交回来。**这一层不抓屏** —— 抓主窗口会把播放条、
 *     系统栏、控制面板一起录进去，那是录屏不是渲染。
 *  2. **编码**：H.264 走 `createInputSurface()`，把帧用 Canvas 画上去，
 *     YUV 转换由 MediaCodec 自己做 —— 手写一遍既慢又容易在部分机型上出绿边。
 *  3. **合成**：`MediaMuxer` 出 MP4。
 *
 * 帧不是按墙钟走的，而是**一帧一次推进**：把时间往前推一格、等页面画完、取帧、编码。
 * 这样录出来的是确定性的画面，而不是「刚好赶上什么算什么」—— 也顺带让慢机器
 * 不会录出一堆重复帧。
 *
 * 透明：**不做**。MediaCodec 的 VP8/VP9/AV1 在安卓上都不支持 alpha 通道，
 * HEVC alpha / ProRes 也没有；要保住透明只能打包第三方编码器。所以这里是带背景的
 * MP4，背景色由调用方给。
 */
public final class VideoExportSession {

    private static final String TAG = "FoliaVideoExport";
    private static final String MIME = MediaFormat.MIMETYPE_VIDEO_AVC;

    private static final long CODEC_TIMEOUT_US = 10_000L;
    /**
     * 连续多少帧「画面是空的」就认定这条路走不通。
     *
     * 离屏取帧的前提是关掉硬件加速后 WebView 愿意把内容画进 `View.draw()`，
     * 这一条在不同机型 / WebView 版本上不是必然。给它几帧的余量（开头一两句
     * 歌词没到时画面本来就可能很空），过了就换降级路径。
     */
    private static final int BLANK_LIMIT = 30;

    /**
     * 帧从哪儿来。
     *
     * 抽成接口是因为取帧有两条路（离屏 `View.draw()` / 降级后的抓窗口），
     * 而"哪些路能走、什么时候换"是 `ExportRenderView` 自己的事 —— 这里只管要帧。
     */
    public interface FrameSource {
        /** 把画面推进到第 `timeSec` 秒（第 `index` 帧）并取回这一帧。可在后台线程调。 */
        Bitmap captureFrame(double timeSec, int index);

        /** 这一帧是不是空的（什么都没画出来）。 */
        boolean isBlank(Bitmap bitmap);

        /** 换降级路径。返回 false 表示已经没有别的路可走。 */
        boolean fallback();
    }

    /** 一次导出的参数。全部由 Web 侧给。 */
    public static final class Spec {
        public final int width;
        public final int height;
        public final int fps;
        public final int bitrateMbps;
        public final int totalFrames;
        public final double startSec;
        /** 兜底底色。取帧失败那一帧会用它补上。 */
        public final int backgroundColor;

        public Spec(int width, int height, int fps, int bitrateMbps, int totalFrames,
                    double startSec, int backgroundColor) {
            this.width = width;
            this.height = height;
            this.fps = fps;
            this.bitrateMbps = bitrateMbps;
            this.totalFrames = totalFrames;
            this.startSec = startSec;
            this.backgroundColor = backgroundColor;
        }
    }

    public interface Listener {
        /** 进度。跑在主线程。 */
        void onProgress(int frame, int total);

        /** 正常收尾。`path` 是给人看的位置描述。跑在主线程。 */
        void onCompleted(String path);

        /** 失败。`message` 是可以直接给用户看的一句话。跑在主线程。 */
        void onFailed(String message);

        void onCancelled();
    }

    private final FrameSource source;
    private final FileDescriptor output;
    private final String outputLabel;
    private final Spec spec;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private HandlerThread workerThread;
    private Handler worker;

    private MediaCodec codec;
    private MediaMuxer muxer;
    private Surface inputSurface;
    private int videoTrackIndex = -1;
    private boolean muxerStarted = false;

    private volatile boolean running = false;
    private volatile boolean cancelled = false;
    private volatile int frameIndex = 0;
    private int blankStreak = 0;
    private boolean usedFallback = false;
    private boolean blankedOut = false;

    private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);

    public VideoExportSession(FrameSource source, FileDescriptor output, String outputLabel,
                              Spec spec, Listener listener) {
        this.source = source;
        this.output = output;
        this.outputLabel = outputLabel;
        this.spec = spec;
        this.listener = listener;
    }

    /** 开跑。重复调用无害。 */
    public void start() {
        if (running) {
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            fail("安卓 8.0（API 26）以下没有可用的取帧路径，无法导出。");
            return;
        }
        running = true;
        workerThread = new HandlerThread("folia-video-export");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        worker.post(this::prepare);
    }

    /** 用户点取消。已经写出去的那部分会正常收尾成一个可播的片段。 */
    public void cancel() {
        cancelled = true;
    }

    private void prepare() {
        try {
            MediaFormat format = MediaFormat.createVideoFormat(MIME, spec.width, spec.height);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            format.setInteger(MediaFormat.KEY_BIT_RATE, spec.bitrateMbps * 1000_000);
            format.setInteger(MediaFormat.KEY_FRAME_RATE, spec.fps);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            /*
             * 不设 KEY_REPEAT_PREVIOUS_FRAME_AFTER：我们要的是「画一帧编一帧」，
             * 让编码器替我们复制上一帧会把慢机器上真实存在的卡顿抹平 ——
             * 看起来是流畅了，实际上是拿重复帧凑数。宁可让它如实卡在那里。
             */
            codec = MediaCodec.createEncoderByType(MIME);
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            inputSurface = codec.createInputSurface();
            codec.start();
            muxer = new MediaMuxer(output, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            /*
             * 屏幕方向：导出期间页面是竖的还是横的由 Web 侧决定（输出宽高就是页面尺寸），
             * 这里只按实际输出写。录完发现是躺着的，改页面方向再来一次即可。
             */
            muxer.setOrientationHint(0);
        } catch (Throwable error) {
            Log.e(TAG, "编码器起不来", error);
            fail("这台机器的 H.264 编码器起不来，导出中止。");
            return;
        }
        worker.post(this::stepFrame);
    }

    /** 一帧的循环：推时间 → 取帧 → 编 → 下一帧。 */
    private void stepFrame() {
        if (!running) {
            return;
        }
        if (cancelled || frameIndex >= spec.totalFrames) {
            finish();
            return;
        }

        final int index = frameIndex;
        final double timeSec = spec.startSec + (index / (double) spec.fps);
        captureAndEncode(index, timeSec);

        if (blankedOut) {
            fail("画面一直是空的：这台机器画不出离屏内容，导出中止。");
            return;
        }

        frameIndex += 1;
        mainHandler.post(() -> listener.onProgress(Math.min(frameIndex, spec.totalFrames), spec.totalFrames));
        worker.post(this::stepFrame);
    }

    /** 取这一帧并交给编码器。取不到就留空（底色），不让整条导出挂掉。 */
    private void captureAndEncode(int index, double timeSec) {
        Bitmap frame = source.captureFrame(timeSec, index);
        if (frame == null || source.isBlank(frame)) {
            blankStreak += 1;
            if (!usedFallback && blankStreak >= BLANK_LIMIT && source.fallback()) {
                usedFallback = true;
                blankStreak = 0;
                Log.w(TAG, "离屏画面一直是空的，降级到可见窗口取帧");
                frame = source.captureFrame(timeSec, index);
            }
            if (frame == null || source.isBlank(frame)) {
                if (blankStreak >= BLANK_LIMIT) {
                    blankedOut = true;
                }
            } else {
                blankStreak = 0;
            }
        } else {
            blankStreak = 0;
        }

        Canvas canvas = null;
        try {
            canvas = inputSurface.lockCanvas(null);
            canvas.drawColor(spec.backgroundColor);
            if (frame != null) {
                canvas.drawBitmap(frame, null,
                        new android.graphics.RectF(0, 0, spec.width, spec.height), paint);
            }
        } catch (Throwable error) {
            Log.w(TAG, "第 " + index + " 帧写入编码器失败", error);
        } finally {
            if (canvas != null) {
                try {
                    inputSurface.unlockCanvasAndPost(canvas);
                } catch (Throwable ignored) {
                    // 表面已经没了（导出被取消/Activity 销毁）。
                }
            }
        }
        drain(false);
    }

    /** 把编码器吐出来的数据搬进 muxer。`end` 时先发 EOS 再排空。 */
    private void drain(boolean end) {
        if (codec == null) {
            return;
        }
        if (end) {
            try {
                codec.signalEndOfInputStream();
            } catch (Throwable error) {
                Log.w(TAG, "EOS 发不出去", error);
            }
        }
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        while (true) {
            int index = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US);
            if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
                break;
            }
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (muxer != null && !muxerStarted) {
                    videoTrackIndex = muxer.addTrack(codec.getOutputFormat());
                    muxer.start();
                    muxerStarted = true;
                }
                continue;
            }
            if (index < 0) {
                continue;
            }
            ByteBuffer buffer = codec.getOutputBuffer(index);
            boolean isEos = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            if (buffer != null && muxerStarted && videoTrackIndex >= 0
                    && (info.size > 0 || isEos)
                    && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                buffer.position(info.offset);
                buffer.limit(info.offset + info.size);
                try {
                    muxer.writeSampleData(videoTrackIndex, buffer, info);
                } catch (Throwable error) {
                    Log.w(TAG, "写入 muxer 失败", error);
                }
            }
            codec.releaseOutputBuffer(index, false);
            if (isEos) {
                break;
            }
        }
    }

    private void finish() {
        if (!running) {
            return;
        }
        running = false;
        try {
            drain(true);
        } catch (Throwable error) {
            Log.w(TAG, "收尾排空失败", error);
        }
        releaseAll();
        if (cancelled) {
            mainHandler.post(listener::onCancelled);
            return;
        }
        // 一个样本都没写进去的话，这个 mp4 打不开，别报成功。
        if (!muxerStarted || videoTrackIndex < 0) {
            mainHandler.post(() -> listener.onFailed("一帧都没录进去，导出中止。"));
            return;
        }
        final String label = outputLabel;
        mainHandler.post(() -> listener.onCompleted(label));
    }

    private void fail(String message) {
        if (!running) {
            return;
        }
        running = false;
        releaseAll();
        mainHandler.post(() -> listener.onFailed(message));
    }

    private void releaseAll() {
        try {
            if (muxer != null) {
                if (muxerStarted) {
                    muxer.stop();
                }
                muxer.release();
            }
        } catch (Throwable error) {
            Log.w(TAG, "muxer 释放失败", error);
        }
        muxer = null;
        try {
            if (codec != null) {
                codec.stop();
                codec.release();
            }
        } catch (Throwable error) {
            Log.w(TAG, "编码器释放失败", error);
        }
        codec = null;
        try {
            if (inputSurface != null) {
                inputSurface.release();
            }
        } catch (Throwable ignored) {
            // 已经随编码器释放了。
        }
        inputSurface = null;
        if (workerThread != null) {
            workerThread.quitSafely();
            workerThread = null;
            worker = null;
        }
    }
}
